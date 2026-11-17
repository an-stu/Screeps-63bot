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
        getEnergyAvailable() { return this.currentEnergyAvailable === undefined ? this.energyAvailable : this.currentEnergyAvailable; },
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
    creep.store = {[RESOURCE_ENERGY]:opts.energy || 0};
    creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
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
    assert.equal(request.mission.data.body.filter(part => part == "work").length, 6);
    assert.equal(request.mission.data.body.filter(part => part == "carry").length, 6);
    assert.equal(request.mission.data.body.filter(part => part == "move").length, 12);
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
    const room = makeRoom(sb, "E51S29", {memory:{structMap:{spawn:"encoded"}}});
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
    world.spawnResult = "shard3_1001_1";
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(data), true, "successful spawn acknowledges request");
    assert.equal(world.spawnCalls, 2);
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

    const expired = Object.assign({}, data, {requestId:"expired", slotId:"expired-slot", expiresAt:world.now - 1});
    assert.equal(sb.missionFunc.spawnCrossShardBuilder(expired), true, "expired request returns a retry signal to target");
    assert.equal(world.missions.at(-1).mission.data.expired, true);

    const receiptMemory = sb.Memory.crossShardBuilderReceipts;
    assert.ok(Object.keys(receiptMemory).length <= 200, "source dedup memory stays bounded");
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

// 8. Energy caches are preferred when available, and completed spawns hand the
//    creep back to the ordinary worker economy without suicide or cargo loss.
{
    const sb = makeWorld();
    const cache = {id:"drop", resourceType:RESOURCE_ENERGY, amount:100, pos:new RoomPosition(29, 16, "E51S29")};
    const room = makeRoom(sb, "E51S29", {spawns:[{id:"spawn1"}], drops:[cache], sites:[]});
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

console.log("cross-shard build checks passed");
