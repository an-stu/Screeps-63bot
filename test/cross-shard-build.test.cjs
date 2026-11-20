// Behavioral regression tests for the blueprint-only cross-shard bootstrap.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "modules", "strategy_buildCrossShard.js"), "utf8");
const FIND_MY_SPAWNS = "mySpawns";
const FIND_MY_CONSTRUCTION_SITES = "mySites";
const FIND_SOURCES = "sources";
const FIND_STRUCTURES = "structures";
const FIND_DROPPED_RESOURCES = "drops";
const FIND_TOMBSTONES = "tombstones";
const FIND_RUINS = "ruins";
const STRUCTURE_SPAWN = "spawn";
const STRUCTURE_EXTENSION = "extension";
const RESOURCE_ENERGY = "energy";
const OK = 0;
const ERR_NOT_IN_RANGE = -9;

class RoomPosition {
    constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    getRangeTo(target) {
        const pos = target && target.pos ? target.pos : target;
        return Math.max(Math.abs(this.x - pos.x), Math.abs(this.y - pos.y));
    }
    createConstructionSite(structureType) {
        world.created.push({x:this.x, y:this.y, roomName:this.roomName, structureType:structureType});
        return OK;
    }
}

let world;
function makeWorld(opts = {}) {
    world = {
        created:[], missions:[], plannerCalls:0, ensureCalls:0, destroyCalls:0,
        operations:[], now:1000000, planSucceeds:opts.planSucceeds !== false,
        ensureCreatesSite:opts.ensureCreatesSite !== false,
        legacyPath:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
        spawnCalls:0, spawnResult:undefined,
        bodyPartCosts:{work:100, carry:50, move:50},
    };
    const sandbox = {
        Creep:function () {},
        RoomPosition,
        Game:{time:1000, cpu:{bucket:8000}, creeps:{}, rooms:{}, shard:{name:"shard2"}},
        Memory:{rooms:{}},
        FIND_MY_SPAWNS, FIND_MY_CONSTRUCTION_SITES, FIND_SOURCES, FIND_STRUCTURES,
        FIND_DROPPED_RESOURCES, FIND_TOMBSTONES, FIND_RUINS,
        STRUCTURE_SPAWN, STRUCTURE_EXTENSION, RESOURCE_ENERGY,
        OK, ERR_NOT_IN_RANGE, WORK:"work", CARRY:"carry", MOVE:"move",
        Date:{now:() => world.now},
        ManagerCreeps:{calcBodyPart(set) {
            let body = [];
            Object.keys(set).forEach(type => { for (let i = 0; i < set[type]; i++) body.push(type); });
            return body;
        }},
        ManagerCrossShard:{addCrossShardRequest(toShard, mission, id) { world.missions.push({toShard, mission, id}); return id; }},
        ManagerAutoPlanner:{computeRoom(context) {
            world.plannerCalls++;
            if (world.planSucceeds) {
                sandbox.Memory.rooms[context.room.name].structMap = {spawn:"encoded-spawn"};
            }
        }},
        StrategyClaim:{
            recordOperation(flag, state, details) { world.operations.push({roomName:flag.pos.roomName, state, details}); },
            destroyForeignStructures(room) { world.destroyCalls++; return 0; },
            ensureConstructionSites(room) {
                world.ensureCalls++;
                if (world.ensureCreatesSite && !room.sites.some(site => site.structureType == STRUCTURE_SPAWN)) {
                    room.sites.push({id:"spawnSite", structureType:STRUCTURE_SPAWN,
                        pos:new RoomPosition(30, 15, room.name)});
                }
            },
        },
        StrategyClaimCrossShard:{getPath() { return world.legacyPath; }},
        Utils:{getBodyEnergyNeed(body) { return body.reduce((sum, part) => sum + world.bodyPartCosts[part], 0); }},
        StationHive:{trySpawn(room, targetRoomName, body, role, tasks) {
            world.spawnCalls++;
            world.lastSpawn = {room:room.name, targetRoomName, body, role, tasks};
            return world.spawnResult;
        }},
        console:{log(){}},
    };
    sandbox.global = sandbox;
    vm.runInNewContext(source, sandbox, {filename:"strategy_buildCrossShard.js"});
    return sandbox;
}

function makeRoom(sb, name = "E51S29", opts = {}) {
    const room = {
        name, my:opts.my !== false,
        memory:sb.Memory.rooms[name] = opts.memory || sb.Memory.rooms[name] || {},
        controller:{id:"controller:" + name, level:opts.level || 1, ticksToDowngrade:opts.ticksToDowngrade || 20000,
            upgradeBlocked:false, pos:new RoomPosition(32, 16, name)},
        sites:opts.sites || [], spawns:opts.spawns || [], sources:opts.sources || [],
        drops:opts.drops || [], tombstones:opts.tombstones || [], ruins:opts.ruins || [], structures:opts.structures || [],
        level:opts.level || 1,
        energyAvailable:opts.energyAvailable === undefined ? 5000 : opts.energyAvailable,
        energyCapacityAvailable:opts.energyCapacityAvailable === undefined ? 5000 : opts.energyCapacityAvailable,
        currentEnergyAvailable:opts.currentEnergyAvailable,
        find(type) {
            if (type === FIND_MY_SPAWNS) return this.spawns;
            if (type === FIND_MY_CONSTRUCTION_SITES) return this.sites;
            if (type === FIND_SOURCES) return this.sources;
            if (type === FIND_DROPPED_RESOURCES) return this.drops;
            if (type === FIND_TOMBSTONES) return this.tombstones;
            if (type === FIND_RUINS) return this.ruins;
            if (type === FIND_STRUCTURES) return this.structures;
            return [];
        },
        getEnergyAvailable() { return this.energyAvailable; },
        getEnergyCapacityAvailable() { return this.energyCapacityAvailable; },
    };
    sb.Game.rooms[name] = room;
    return room;
}

function makeBuilder(sb, roomName, opts = {}) {
    const creep = new sb.Creep();
    creep.name = opts.name || "builder";
    creep.memory = opts.memory || {role:"crossShardBuilder", roomName:roomName,
        tasks:[{taskName:"buildCrossShardRoom", roomName:roomName, slotId:opts.slotId || "slot-1"}]};
    creep.pos = opts.pos || new RoomPosition(30, 16, roomName);
    creep.store = {
        [RESOURCE_ENERGY]:opts.energy || 0,
        getFreeCapacity() { return 300 - this[RESOURCE_ENERGY]; },
    };
    creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
    creep.upgradeController = () => OK;
    return creep;
}

function runExec(sb, time) {
    sb.Game.time = time;
    sb.StrategyBuildCrossShard.exec();
}

// 1. Legacy migration is automatic, route fallback is saved once, and the
//    task stack is ordered for LIFO execution (move first, then build).
{
    const sb = makeWorld({ensureCreatesSite:true});
    const room = makeRoom(sb, "E51S29", {memory:{structMap:{spawn:"encoded"}}});
    sb.Memory.crossShardBuild = {room:"E51S29", originShard:"shard3", spawnRoom:"E49S31", builders:2};
    runExec(sb, 1000);
    const cfg = sb.Memory.crossShardBuilds.E51S29;
    assert.ok(cfg, "legacy config migrates into the keyed config map");
    assert.equal(sb.Memory.crossShardBuild, undefined, "legacy singleton is removed after migration");
    assert.equal(JSON.stringify(cfg.path), JSON.stringify(world.legacyPath), "legacy route fallback is persisted");
    assert.equal(world.destroyCalls, 1, "owned-room cleanup helper is reused");
    assert.equal(world.missions.length, 1, "one worker request is sent");
    const request = world.missions[0];
    assert.equal(request.toShard, "shard3");
    assert.equal(request.mission.func, "spawnCrossShardBuilder");
    assert.equal(request.mission.data.spawnRoom, "E49S31");
    assert.ok(request.mission.data.requestId && request.mission.data.expiresAt > world.now,
        "request has a unique id and real-time expiration");
    const tasks = request.mission.data.tasks;
    assert.equal(tasks.length, 2);
    assert.equal(tasks[tasks.length - 1].taskName, "moveCrossShardByPath", "LIFO task ordering moves across shard first");
    assert.equal(JSON.stringify(tasks[tasks.length - 1].path), JSON.stringify(world.legacyPath.path));
    assert.equal(tasks[0].taskName, "buildCrossShardRoom");
    assert.equal(tasks[0].roomName, "E51S29");
    assert.ok(tasks[0].slotId, "each builder task has a stable source-dedup slot");
    assert.equal(request.mission.data.body.length, 48, "request advertises the 1:1:2 full-size worker");
    assert.equal(sb.StrategyBuildCrossShard.bodyCost(request.mission.data.body), 3000);
    assert.equal(request.mission.data.body.filter(part => part == "work").length, 12);
    assert.equal(request.mission.data.body.filter(part => part == "carry").length, 12);
    assert.equal(request.mission.data.body.filter(part => part == "move").length, 24);
    // 交错排列：1W1C2M 循环，而不是三段式
    const chunk = ["work", "carry", "move", "move"];
    for (let i = 0; i < request.mission.data.body.length; i += 4) {
        assert.deepEqual(Array.from(request.mission.data.body.slice(i, i + 4)), chunk,
            "body 每 4 个部件必须是一组 1W1C2M（损伤时保持比例）");
    }
}

// 2. start() is idempotent, copies the saved route, and honors explicitly
//    configured paths without consulting the legacy claim route.
{
    const sb = makeWorld({ensureCreatesSite:true});
    const room = makeRoom(sb, "E51S29", {memory:{structMap:{spawn:"encoded"}}});
    const inputPath = {path:[{shard:"shard1", roomName:"E20N20", x:11, y:12}]};
    const cfg = sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:4, path:inputPath,
    });
    assert.ok(cfg, "valid start returns its persisted config");
    inputPath.path[0].x = 49;
    assert.equal(cfg.path.path[0].x, 11, "saved path is not aliased to caller memory");
    runExec(sb, 1000);
    const dispatchedPath = world.missions[0].mission.data.tasks[1].path;
    cfg.path.path[0].x = 48;
    assert.equal(dispatchedPath[0].x, 11, "worker task gets its own immutable path copy");
    assert.equal(world.missions[0].mission.data.targetRoomName, room.name);
    assert.equal(world.missions[0].mission.data.role, "crossShardBuilder");
    assert.equal(sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:4,
        path:{path:[{shard:"shard0", roomName:"W1N1", x:1, y:1}]},
    }), cfg, "repeated start reuses config and does not reroute in-flight workers");
    assert.equal(cfg.path.path[0].shard, "shard1");
}

// 3. The local worker quota and pending requests are counted together. A
//    target creep arriving frees a slot, and a real-deadline retry reuses the
//    same slotId with a fresh requestId rather than flooding every strategy pass.
{
    const sb = makeWorld({ensureCreatesSite:true});
    makeRoom(sb, "E51S29", {memory:{structMap:{spawn:"encoded"}},
        sites:[{id:"spawnSite", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(30, 15, "E51S29")}]});
    const cfg = sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:2,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
    });
    runExec(sb, 1000);
    assert.equal(world.missions.length, 1);
    const first = world.missions[0].mission.data;
    runExec(sb, 1005);
    runExec(sb, 1010);
    assert.equal(world.missions.length, 2, "dispatch fills the configured two-worker in-flight quota");
    assert.equal(cfg.pending.length, 2);
    assert.notEqual(cfg.pending[0].slotId, cfg.pending[1].slotId, "each concurrent worker has a distinct idempotency slot");

    const local = makeBuilder(sb, "E51S29", {slotId:first.slotId});
    sb.Game.creeps.local = local;
    runExec(sb, 1015);
    assert.equal(cfg.pending.length, 1, "arrival removes the matching pending slot");
    assert.equal(world.missions.length, 2, "the remaining in-flight worker still fills the quota");

    sb.Game.creeps = {};
    const waiting = cfg.pending[0];
    const priorId = waiting.requestId;
    world.now += 15 * 60 * 1000 + 1;
    runExec(sb, 1020);
    assert.ok(world.missions.length >= 3, "expired in-flight request is safely retried");
    const retries = world.missions.map(entry => entry.mission.data).filter(entry => entry.slotId == waiting.slotId);
    const retry = retries[retries.length - 1];
    assert.equal(retry.slotId, waiting.slotId, "retry retains the idempotency slot");
    assert.notEqual(retry.requestId, priorId, "retry gets a fresh request id");
}

// Full pending quota must still check deadlines. Otherwise a failed spawn
// request would permanently occupy its only slot before the retry loop runs.
{
    const sb = makeWorld({ensureCreatesSite:true});
    makeRoom(sb, "E51S29", {memory:{structMap:{spawn:"encoded"}}});
    const cfg = sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:1,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
    });
    runExec(sb, 1000);
    const original = world.missions[0].mission.data;
    world.now = original.expiresAt + 1;
    runExec(sb, 1005);
    assert.equal(world.missions.length, 2, "a full quota must not suppress an expired-request retry");
    assert.equal(cfg.pending.length, 1);
    const retry = world.missions[1].mission.data;
    assert.equal(retry.slotId, original.slotId);
    assert.notEqual(retry.requestId, original.requestId);
}

// Restarting construction for the same room must not reuse source-side receipt
// slots from a previous completed operation.
{
    const sb = makeWorld({ensureCreatesSite:true});
    const room = makeRoom(sb, "E51S29", {level:3, memory:{structMap:{spawn:"encoded"}}});
    const options = {originShard:"shard3", spawnRoom:"E49S31", builders:1,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]}};
    sb.StrategyBuildCrossShard.start(room.name, options);
    runExec(sb, 1000);
    const originalSlot = world.missions[0].mission.data.slotId;
    room.spawns = [{id:"spawn1"}];
    runExec(sb, 1005);
    assert.equal(sb.Memory.crossShardBuilds[room.name], undefined);
    room.spawns = [];
    sb.StrategyBuildCrossShard.start(room.name, options);
    runExec(sb, 1010);
    assert.notEqual(world.missions[1].mission.data.slotId, originalSlot,
        "old receipt must not acknowledge a new operation's first worker without spawning it");
}

// Retiring builders keep working but no longer occupy replacement coverage.
// Pending replacements and newly arrived healthy builders prevent extra waves.
{
    const sb = makeWorld({ensureCreatesSite:true});
    const room = makeRoom(sb, "E51S29", {memory:{structMap:{spawn:"encoded"}}});
    const cfg = sb.StrategyBuildCrossShard.start(room.name, {
        originShard:"shard3", spawnRoom:"E49S31", builders:2,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
    });
    const old1 = makeBuilder(sb, room.name, {name:"old1", slotId:"old-slot-1"});
    const old2 = makeBuilder(sb, room.name, {name:"old2", slotId:"old-slot-2"});
    old1.ticksToLive = 350;
    old2.ticksToLive = 100;
    sb.Game.creeps = {old1, old2};
    assert.equal(sb.StrategyBuildCrossShard.countLocalBuilders(room.name), 2);
    runExec(sb, 1000);
    runExec(sb, 1005);
    runExec(sb, 1010);
    assert.equal(world.missions.length, 2, "two retiring workers request exactly two replacements");
    assert.equal(old1.memory.role, "crossShardBuilder", "old workers must continue contributing");
    assert.equal(old2.memory.tasks[0].taskName, "buildCrossShardRoom");
    assert.ok(world.missions.every(m => m.mission.data.body.length === 48));
    const next = makeBuilder(sb, room.name, {name:"next", slotId:cfg.pending[0].slotId});
    next.ticksToLive = 1200;
    sb.Game.creeps.next = next;
    runExec(sb, 1015);
    assert.equal(cfg.pending.length, 1);
    assert.equal(world.missions.length, 2, "healthy arrivals and remaining transit slots still fill coverage");
}

// 4. Failed heavy planning is throttled and there is no random-placement path.
{
    const sb = makeWorld({planSucceeds:false, ensureCreatesSite:true});
    makeRoom(sb);
    sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:2,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
    });
    runExec(sb, 1000);
    runExec(sb, 1005);
    runExec(sb, 1010);
    assert.equal(world.plannerCalls, 1, "failed computeRoom is not called every five ticks");
    assert.equal(world.created.length, 0, "no spiral/manual construction-site fallback is allowed");
    assert.equal(world.ensureCalls, 0, "site creation waits for a blueprint");
    assert.equal(world.missions.length, 0, "workers are not sent without a spawn blueprint site");
    assert.ok(world.operations.some(entry => entry.state == "PLANNER_FAILED"));
    runExec(sb, 1250);
    assert.equal(world.plannerCalls, 2, "planning retries after the persisted throttle interval");
}

// 5. Acknowledgements are idempotent; expired requests can be refreshed and
//    the source retries a busy spawn rather than consuming the mission.
{
    const sb = makeWorld();
    sb.Game.shard.name = "shard3";
    const sourceRoom = makeRoom(sb, "E49S31", {level:8, spawns:[
        {id:"spawn1", isActive:() => true}, {id:"spawn2", isActive:() => true}, {id:"spawn3", isActive:() => true},
    ]});
    sourceRoom.currentEnergyAvailable = 5000;
    const data = {
        requestId:"shard2:E51S29:1000:1", slotId:"shard2:E51S29:1", expiresAt:world.now + 10000,
        targetShard:"shard2", targetRoomName:"E51S29", originShard:"shard3", spawnRoom:"E49S31",
        body:["work", "carry", "move"], role:"crossShardBuilder",
        tasks:[{taskName:"buildCrossShardRoom", roomName:"E51S29"}],
    };
    world.spawnResult = undefined;
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(data), false, "busy spawn leaves mission retryable");
    assert.equal(world.spawnCalls, 1);
    assert.equal(world.missions.length, 0, "a failed spawn is not acknowledged to the target");
    world.spawnResult = "shard3_1001_1";
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(data), true, "successful spawn acknowledges request");
    assert.equal(world.spawnCalls, 2);
    assert.equal(world.lastSpawn.body.length, 48, "an old small-body request still spawns the preferred 1:1:2 body when affordable");
    assert.equal(world.lastSpawn.body.filter(part => part == "work").length, 12);
    assert.equal(world.lastSpawn.body.filter(part => part == "carry").length, 12);
    assert.equal(world.lastSpawn.body.filter(part => part == "move").length, 24);
    assert.equal(world.missions.at(-1).mission.func, "crossShardBuilderSpawned");
    assert.equal(world.missions.at(-1).mission.data.creepName, "shard3_1001_1");

    const duplicate = Object.assign({}, data, {requestId:"shard2:E51S29:1000:2"});
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(duplicate), true, "same slot replays receipt without another spawn");
    assert.equal(world.spawnCalls, 2, "source-side slot receipt prevents duplicate spawning");
    assert.equal(world.missions.at(-1).mission.data.creepName, "shard3_1001_1");

    assert.equal(sb.missionFunc.crossShardBuilderSpawned({roomName:"E51S29", slotId:data.slotId,
        requestId:data.requestId, spawned:true, creepName:"shard3_1001_1"}), true);
    const cfg = sb.StrategyBuildCrossShard.start("E51S29", {originShard:"shard3", spawnRoom:"E49S31",
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]}});
    cfg.pending.push({slotId:data.slotId, requestId:data.requestId, state:"REQUESTED", deadline:world.now});
    sb.missionFunc.crossShardBuilderSpawned({roomName:"E51S29", slotId:data.slotId,
        requestId:data.requestId, spawned:true, creepName:"shard3_1001_1"});
    assert.equal(cfg.pending[0].state, "SPAWNING", "target records the successful source receipt");
    assert.ok(cfg.pending[0].deadline > world.now);
    const acceptedDeadline = cfg.pending[0].deadline;
    sb.missionFunc.crossShardBuilderSpawned({roomName:"E51S29", slotId:data.slotId,
        requestId:data.requestId, spawned:true, creepName:"shard3_1001_1"});
    assert.equal(cfg.pending[0].deadline, acceptedDeadline, "duplicate receipt is harmless");

    const badSpawn = Object.assign({}, data, {requestId:"bad-room", slotId:"bad-slot", spawnRoom:"E49S30"});
    const callsBeforeBadRoom = world.spawnCalls;
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(badSpawn), false, "wrong or unavailable spawn room is never accepted");
    assert.equal(world.spawnCalls, callsBeforeBadRoom);

    // 出兵房 RCL<=4 只能产小体型 = 不接援建请求（用户 2026-11-18）
    makeRoom(sb, "E49S30", {level:4, spawns:[{id:"lowSpawn", isActive:() => true}]});
    const lowLevel = Object.assign({}, data, {requestId:"low-rcl", slotId:"low-rcl-slot", spawnRoom:"E49S30"});
    const callsBeforeLow = world.spawnCalls;
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(lowLevel), false, "出兵房 RCL<=4 不得接援建");
    assert.equal(world.spawnCalls, callsBeforeLow);

    const expired = Object.assign({}, data, {requestId:"expired", slotId:"expired-slot", expiresAt:world.now - 1});
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(expired), true, "expired request returns a retry signal to target");
    assert.equal(world.missions.at(-1).mission.data.expired, true);

    const receiptMemory = sb.Memory.crossShardBuilderReceipts;
    assert.ok(Object.keys(receiptMemory).length <= 200, "source dedup memory stays bounded");
}

// The source derives a body from live availability, the spent-this-tick cache,
// and room capacity. Scaled bodies keep the requested WORK:CARRY:MOVE ratio.
{
    const cases = [
        {label:"capacity limit", available:5000, cached:5000, capacity:1800, cost:1750, work:7, carry:7, move:14},
        {label:"spent-this-tick cache", available:3000, cached:1200, capacity:5000, cost:1000, work:4, carry:4, move:8},
        {label:"small affordable body", available:5000, cached:5000, capacity:250, cost:250, work:1, carry:1, move:2},
    ];
    for (const sample of cases) {
        const sb = makeWorld();
        sb.Game.shard.name = "shard3";
        makeRoom(sb, "E49S31", {level:8, energyAvailable:sample.available,
            currentEnergyAvailable:sample.cached, energyCapacityAvailable:sample.capacity,
            spawns:[{id:"spawn1"}]});
        world.spawnResult = "spawned-" + sample.label;
        const data = {
            requestId:"request-" + sample.label, slotId:"slot-" + sample.label,
            expiresAt:world.now + 10000, targetShard:"shard2", targetRoomName:"E51S29",
            originShard:"shard3", spawnRoom:"E49S31", body:["work", "carry", "move"],
            role:"crossShardBuilder", tasks:[{taskName:"buildCrossShardRoom", roomName:"E51S29"}],
        };
        assert.equal(sb.missionFunc.spawnCrossShardBuilder(data), true, sample.label + " body spawns successfully");
        const body = world.lastSpawn.body;
        assert.equal(body.length, sample.work + sample.carry + sample.move, sample.label + " body stays within budget/capacity");
        assert.ok(sb.StrategyBuildCrossShard.bodyCost(body) <= Math.min(sample.available, sample.cached, sample.capacity));
        assert.equal(body.filter(part => part == "work").length, sample.work);
        assert.equal(body.filter(part => part == "carry").length, sample.carry);
        assert.equal(body.filter(part => part == "move").length, sample.move);
    }

    const sb = makeWorld();
    sb.Game.shard.name = "shard3";
    makeRoom(sb, "E49S31", {level:8, energyAvailable:5000, currentEnergyAvailable:5000,
        energyCapacityAvailable:199, spawns:[{id:"spawn1"}]});
    const tooPoor = {
        requestId:"request-too-poor", slotId:"slot-too-poor", expiresAt:world.now + 10000,
        targetShard:"shard2", targetRoomName:"E51S29", originShard:"shard3", spawnRoom:"E49S31",
        body:["work", "carry", "move"], role:"crossShardBuilder",
        tasks:[{taskName:"buildCrossShardRoom", roomName:"E51S29"}],
    };
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(tooPoor), false, "less than 200 energy cannot fund even the minimum body");
    assert.equal(world.spawnCalls, 0);
    assert.equal(world.missions.length, 0, "an unaffordable body is not acknowledged");
}

// Full-size preference: a momentarily drained room that can afford the 50-part
// body at capacity waits for energy instead of downgrading, until the request
// deadline approaches. A room that can never afford it spawns the largest
// affordable body immediately.
{
    function builderRequest(overrides) {
        return Object.assign({
            requestId:"request-full", slotId:"slot-full", expiresAt:world.now + 400000,
            targetShard:"shard2", targetRoomName:"E51S29", originShard:"shard3", spawnRoom:"E49S31",
            body:["work", "carry", "move"], role:"crossShardBuilder",
            tasks:[{taskName:"buildCrossShardRoom", roomName:"E51S29"}],
        }, overrides);
    }

    const waiting = makeWorld();
    waiting.Game.shard.name = "shard3";
    makeRoom(waiting, "E49S31", {level:8, energyAvailable:5000, currentEnergyAvailable:1200,
        energyCapacityAvailable:5000, spawns:[{id:"spawn1"}]});
    assert.equal(waiting.missionFunc.spawnCrossShardBuilder(builderRequest()), false,
        "drained but capable room holds the request for a full-size worker");
    assert.equal(world.spawnCalls, 0);
    assert.equal(world.missions.length, 0, "a waiting request is not acknowledged");

    const deadline = makeWorld();
    deadline.Game.shard.name = "shard3";
    makeRoom(deadline, "E49S31", {level:8, energyAvailable:5000, currentEnergyAvailable:1200,
        energyCapacityAvailable:5000, spawns:[{id:"spawn1"}]});
    world.spawnResult = "spawned-deadline";
    assert.equal(deadline.missionFunc.spawnCrossShardBuilder(builderRequest({expiresAt:world.now + 10000})), true,
        "near the deadline the largest affordable body spawns instead of stalling");
    assert.equal(world.lastSpawn.body.filter(part => part == "work").length, 4);
    assert.equal(world.lastSpawn.body.filter(part => part == "carry").length, 4);
    assert.equal(world.lastSpawn.body.filter(part => part == "move").length, 8);

    const full = makeWorld();
    full.Game.shard.name = "shard3";
    makeRoom(full, "E49S31", {level:8, energyAvailable:5000, currentEnergyAvailable:5000,
        energyCapacityAvailable:5000, spawns:[{id:"spawn1"}]});
    world.spawnResult = "spawned-full";
    assert.equal(full.missionFunc.spawnCrossShardBuilder(builderRequest()), true,
        "a funded room spawns the full 1:1:2 worker");
    assert.equal(world.lastSpawn.body.length, 48);
    assert.equal(world.lastSpawn.body.filter(part => part == "work").length, 12);
    assert.equal(world.lastSpawn.body.filter(part => part == "carry").length, 12);
    assert.equal(world.lastSpawn.body.filter(part => part == "move").length, 24);

    const poorRoom = makeWorld();
    poorRoom.Game.shard.name = "shard3";
    makeRoom(poorRoom, "E49S31", {level:8, energyAvailable:5000, currentEnergyAvailable:1200,
        energyCapacityAvailable:1800, spawns:[{id:"spawn1"}]});
    world.spawnResult = "spawned-poor-room";
    assert.equal(poorRoom.missionFunc.spawnCrossShardBuilder(builderRequest()), true,
        "a room that can never afford the full body does not wait");
    assert.equal(world.lastSpawn.body.filter(part => part == "work").length, 4);
}

// 6. Creep task explicitly enters the target room even while it is visible.
{
    const sb = makeWorld();
    makeRoom(sb, "E51S29", {sites:[]});
    const creep = makeBuilder(sb, "E51S29", {pos:new RoomPosition(10, 10, "E50S30")});
    let destination;
    creep.goTo = pos => { destination = pos; };
    creep.buildCrossShardRoom();
    assert.ok(destination && destination.roomName == "E51S29" && destination.x == 25,
        "remote visibility does not skip physical room entry");
}

// 7. Spawn site has priority over non-spawn blueprint sites. Near downgrade,
//    controller upgrade takes priority; no-site workers upgrade instead of spin.
{
    const sb = makeWorld();
    let room = makeRoom(sb, "E51S29", {sites:[
        {id:"extensionSite", structureType:STRUCTURE_EXTENSION, pos:new RoomPosition(29, 15, "E51S29")},
        {id:"spawnSite", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(31, 15, "E51S29")},
    ]});
    let creep = makeBuilder(sb, "E51S29", {energy:100});
    let built;
    creep.build = site => { built = site; return OK; };
    creep.upgradeController = () => OK;
    creep.buildCrossShardRoom();
    assert.equal(built.id, "spawnSite", "first spawn site wins over extensions");

    room.controller.ticksToDowngrade = 1000;
    built = null;
    let upgradeCalls = 0;
    creep.upgradeController = () => { upgradeCalls++; return OK; };
    creep.buildCrossShardRoom();
    assert.equal(upgradeCalls, 1, "near-downgrade controller protection pauses construction");
    assert.equal(built, null);

    room.controller.ticksToDowngrade = 20000;
    room.sites = [];
    let source1 = {id:"source1", energy:3000, pos:new RoomPosition(20, 20, room.name)};
    let source2 = {id:"source2", energy:3000, pos:new RoomPosition(30, 30, room.name)};
    room.sources = [source1, source2, {id:"empty", energy:0, pos:new RoomPosition(29, 16, room.name)}];
    creep.store[RESOURCE_ENERGY] = 0;
    let upgraded = 0, harvested = null;
    creep.upgradeController = () => { upgraded++; return OK; };
    creep.harvest = source => { harvested = source; return OK; };
    creep.moveTo = () => {};
    creep.buildCrossShardRoom();
    assert.equal(upgraded, 0, "empty builder gathers energy while downgrade is safe");
    assert.equal(harvested.id, "source1", "nearest available source is used; depleted source is excluded");

    let second = makeBuilder(sb, "E51S29", {name:"builder2", energy:0});
    second.harvest = source => { harvested = source; return OK; };
    second.moveTo = () => {};
    sb.Game.creeps = {builder1:creep, builder2:second};
    second.buildCrossShardRoom();
    assert.equal(harvested.id, "source2", "builders spread across the least-assigned active source");

    // With no build sites, the bootstrap task remains useful by upgrading the
    // controller rather than creating an off-blueprint road/site or idling.
    room.sources = [];
    creep.store[RESOURCE_ENERGY] = 100;
    upgraded = 0;
    creep.upgradeController = () => { upgraded++; return OK; };
    creep.buildCrossShardRoom();
    assert.equal(upgraded, 1, "no-site builder helps upgrade the controller");
    assert.equal(world.created.length, 0, "creep logic never creates sites outside the blueprint");
}

// Gathering persists after one small harvest and ends at a full load. Urgent
// controller upkeep may still use a partial load before the gathering finishes.
{
    const sb = makeWorld();
    const room = makeRoom(sb, "E51S29", {
        sites:[{id:"spawnSite", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(11, 15, "E51S29")}],
        sources:[{id:"source", energy:3000, pos:new RoomPosition(9, 10, "E51S29")}],
    });
    const creep = makeBuilder(sb, room.name);
    let harvests = 0, builds = 0, upgrades = 0;
    creep.harvest = () => { harvests++; return OK; };
    creep.build = () => { builds++; return OK; };
    creep.upgradeController = () => { upgrades++; return OK; };
    creep.buildCrossShardRoom();
    creep.store[RESOURCE_ENERGY] = 12;
    creep.buildCrossShardRoom();
    assert.deepEqual([harvests, builds], [2, 0], "a partial load must not send the worker back after one harvest");
    creep.store[RESOURCE_ENERGY] = 300;
    creep.buildCrossShardRoom();
    assert.equal(builds, 1, "a full builder must switch to construction immediately");
    creep.lastTask().gathering = true;
    creep.store[RESOURCE_ENERGY] = 12;
    room.controller.ticksToDowngrade = 1000;
    creep.buildCrossShardRoom();
    assert.equal(upgrades, 1, "urgent controller upkeep takes a partial load");
    room.controller.ticksToDowngrade = 20000;
    room.sources = [];
    creep.buildCrossShardRoom();
    assert.equal(builds, 2, "temporarily exhausted sources must not strand energy already carried");
}

// 8. Energy caches are preferred when available, and completed spawns hand the
//    creep back to the ordinary worker economy without suicide or cargo loss.
{
    const sb = makeWorld();
    const cache = {id:"drop", resourceType:RESOURCE_ENERGY, amount:100, pos:new RoomPosition(29, 16, "E51S29")};
    const room = makeRoom(sb, "E51S29", {level:3, spawns:[{id:"spawn1"}], drops:[cache], sites:[]});
    const creep = makeBuilder(sb, "E51S29", {energy:75});
    let picked;
    creep.pickup = target => { picked = target; return OK; };
    creep.suicide = () => { throw new Error("bootstrap worker must not suicide"); };
    creep.buildCrossShardRoom();
    assert.equal(creep.memory.role, "worker", "spawn completion converts builder to normal worker");
    assert.equal(creep.store[RESOURCE_ENERGY], 75, "existing cargo is untouched");
    assert.equal(creep.memory.tasks.length, 0, "bootstrap-only task is removed for normal economy assignment");
    assert.equal(picked, undefined, "handoff happens before any harvest action");

    room.spawns = [];
    room.sites = [];
    let cacheWorker = makeBuilder(sb, "E51S29", {energy:0});
    cacheWorker.pickup = target => { picked = target; return OK; };
    cacheWorker.upgradeController = () => OK;
    cacheWorker.buildCrossShardRoom();
    assert.equal(picked.id, "drop", "available energy cache is chosen before harvesting");
}

// 9. The previous lifetime cap is gone; only the configured concurrent target
//    limits active requests, and future free slots continue to dispatch.
{
    const sb = makeWorld({ensureCreatesSite:true});
    makeRoom(sb, "E51S29", {memory:{structMap:{spawn:"encoded"}},
        sites:[{id:"spawnSite", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(30, 15, "E51S29")}]});
    const cfg = sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:4,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
    });
    for (let i = 0; i < 7; i++) {
        // Simulate each acknowledged worker arriving; no lifetime counter can
        // stop the next slot from being dispatched once the prior one is gone.
        if (cfg.pending.length) {
            const prior = cfg.pending[0];
            sb.Game.creeps = {};
            sb.missionFunc.crossShardBuilderSpawned({roomName:"E51S29", slotId:prior.slotId,
                requestId:prior.requestId, spawned:true, creepName:"origin_" + i});
            prior.deadline = world.now - 1;
            prior.state = "SPAWNING";
            cfg.pending = [];
        }
        runExec(sb, 1000 + i * 5);
    }
    assert.ok(world.missions.length >= 7, "more than six builders may be dispatched over the operation lifetime");
}

// 10. RCL<3 持续援建政策：spawn 已建但 RCL<3 时，建筑爬不转 worker，继续援建任意工地。
{
    const sb = makeWorld();
    const extSite = {id:"ext1", structureType:STRUCTURE_EXTENSION, pos:new RoomPosition(31, 16, "E51S29")};
    makeRoom(sb, "E51S29", {level:2, spawns:[{id:"spawn1"}], sites:[extSite]});
    const creep = makeBuilder(sb, "E51S29", {energy:100});
    let built;
    creep.build = target => { built = target; return OK; };
    creep.moveTo = () => OK;
    creep.upgradeController = () => { throw new Error("RCL<3 有工地时不应转去升级"); };
    creep.buildCrossShardRoom();
    assert.equal(creep.memory.role, "crossShardBuilder", "RCL<3 spawn 已建也不转 worker（持续援建）");
    assert.equal(built, extSite, "RCL<3 援建任意工地（extensions），不再只盯 spawn");
    assert.equal(creep.memory.tasks.length, 1, "援建任务保留");
}

// 11. execRoom：RCL<3 + spawn 不 COMPLETE，配置保留并继续派建筑爬。
{
    const sb = makeWorld({ensureCreatesSite:true});
    makeRoom(sb, "E51S29", {level:2, spawns:[{id:"spawn1"}], memory:{structMap:{spawn:"encoded"}}, sites:[]});
    sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:2,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
    });
    runExec(sb, 1000);
    assert.ok(sb.Memory.crossShardBuilds["E51S29"], "RCL<3 配置必须保留（持续援建）");
    assert.ok(!world.operations.some(op => op.state === "COMPLETE"), "RCL<3 不得 COMPLETE");
    assert.ok(world.missions.length >= 1, "RCL<3 继续派跨 shard 建筑爬");
}

// 12. execRoom：RCL>=3 + spawn 才 COMPLETE 并删配置。
{
    const sb = makeWorld({ensureCreatesSite:true});
    makeRoom(sb, "E51S29", {level:3, spawns:[{id:"spawn1"}], memory:{structMap:{spawn:"encoded"}}, sites:[]});
    sb.StrategyBuildCrossShard.start("E51S29", {
        originShard:"shard3", spawnRoom:"E49S31", builders:2,
        path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]},
    });
    runExec(sb, 1000);
    assert.ok(!sb.Memory.crossShardBuilds["E51S29"], "RCL3 COMPLETE 后删配置");
    assert.ok(world.operations.some(op => op.state === "COMPLETE"), "RCL3 必须 COMPLETE");
}

// 13. 配置丢失恢复：RCL<3 已占领房从 room.memory.crossShardBootstrap 恢复援建配置。
{
    const sb = makeWorld();
    makeRoom(sb, "E51S29", {level:2, spawns:[{id:"spawn1"}],
        memory:{crossShardBootstrap:{originShard:"shard3", spawnRoom:"E49S31", builders:2,
            path:{path:[{shard:"shard3", roomName:"E50S30", x:15, y:5}]}}}});
    assert.ok(!sb.Memory.crossShardBuilds || !sb.Memory.crossShardBuilds["E51S29"], "前置：无配置");
    runExec(sb, 1000);
    assert.ok(sb.Memory.crossShardBuilds["E51S29"], "必须从 room.memory 恢复援建配置");
    assert.equal(sb.Memory.crossShardBuilds["E51S29"].spawnRoom, "E49S31");
}

// 14. 源码层：lowLevel 援建闸 + claimRoom 持久化援建配置必须存在。
{
    const low = fs.readFileSync(path.join(__dirname, "..", "modules", "strategy_lowLevel.js"), "utf8");
    assert.ok(/if \(Memory\.crossShardBuilds && Memory\.crossShardBuilds\[room\.name\]\) \{[\s\S]{0,900}assignDirectHarvest[\s\S]{0,900}return;/.test(low),
        "lowLevel 援建房：不产新爬，但必须给在场 worker 派任务（不能挂机）");
    const creepSrc = fs.readFileSync(path.join(__dirname, "..", "modules", "prototype_creep.js"), "utf8");
    assert.ok(/this\.room\.memory\.crossShardBootstrap = JSON\.parse\(JSON\.stringify\(bootstrap\)\);/.test(creepSrc),
        "claimRoom 必须持久化援建配置以供恢复");
}

// 15. 援建爬带能量优先填满 Hive（spawn/extension），保证 invader 来时能产防守爬。
{
    const sb = makeWorld();
    const spawnStruct = {id:"sp", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(30, 15, "E51S29"),
        store:{[RESOURCE_ENERGY]:100, getFreeCapacity:() => 200}};
    const extStruct = {id:"ext", structureType:STRUCTURE_EXTENSION, pos:new RoomPosition(31, 15, "E51S29"),
        store:{[RESOURCE_ENERGY]:0, getFreeCapacity:() => 50}};
    const site = {id:"road1", structureType:"road", pos:new RoomPosition(32, 16, "E51S29")};
    makeRoom(sb, "E51S29", {level:2, spawns:[{id:"sp"}], structures:[spawnStruct, extStruct], sites:[site]});
    const creep = makeBuilder(sb, "E51S29", {energy:100});
    let transferred, built;
    creep.transfer = t => { transferred = t; return OK; };
    creep.build = t => { built = t; return OK; };
    creep.moveTo = () => OK;
    creep.upgradeController = () => OK;
    creep.buildCrossShardRoom();
    assert.equal(transferred, spawnStruct, "有能量优先填最近的缺能 Hive 建筑");
    assert.equal(built, undefined, "Hive 未满时不先去建工地");
    assert.equal(creep.memory.role, "crossShardBuilder", "RCL<3 不转 worker");
}

// 16. Hive 已满 → 援建爬转去建工地。
{
    const sb = makeWorld();
    const spawnFull = {id:"sp", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(30, 15, "E51S29"),
        store:{[RESOURCE_ENERGY]:300, getFreeCapacity:() => 0}};
    const site = {id:"extSite", structureType:STRUCTURE_EXTENSION, pos:new RoomPosition(31, 16, "E51S29")};
    makeRoom(sb, "E51S29", {level:2, spawns:[{id:"sp"}], structures:[spawnFull], sites:[site]});
    const creep = makeBuilder(sb, "E51S29", {energy:100});
    let built;
    creep.build = t => { built = t; return OK; };
    creep.transfer = () => { throw new Error("Hive 已满不应再填"); };
    creep.moveTo = () => OK;
    creep.upgradeController = () => OK;
    creep.buildCrossShardRoom();
    assert.equal(built, site, "Hive 已满 → 援建工地");
}

// 17. 援建爬绝不从 Hive 抽能量：空载时从源/掉落取能，spawn/extension 不算能量源。
{
    const sb = makeWorld();
    const spawnWithEnergy = {id:"sp", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(30, 15, "E51S29"),
        store:{[RESOURCE_ENERGY]:500, getFreeCapacity:() => 0}};
    const source = {id:"src", energy:1000, pos:new RoomPosition(20, 20, "E51S29")};
    makeRoom(sb, "E51S29", {level:1, spawns:[], structures:[spawnWithEnergy], sources:[source],
        sites:[{id:"spawnSite", structureType:STRUCTURE_SPAWN, pos:new RoomPosition(30, 15, "E51S29")}]});
    const creep = makeBuilder(sb, "E51S29", {energy:0});
    let harvested, withdrawn;
    creep.harvest = t => { harvested = t; return OK; };
    creep.withdraw = t => { withdrawn = t; return OK; };
    creep.pickup = t => { withdrawn = t; return OK; };
    creep.moveTo = () => OK;
    creep.buildCrossShardRoom();
    assert.equal(harvested, source, "空载援建爬从源取能");
    assert.equal(withdrawn, undefined, "绝不从 Hive（spawn/extension）抽能量");
}

console.log("cross-shard build checks passed");
