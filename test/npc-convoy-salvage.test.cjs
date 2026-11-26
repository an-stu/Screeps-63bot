const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../modules/strategy_npcConvoy.js"), "utf8");
const missionId = "0123456789abcdef01234567";
const cargoNames = [0, 1, 2].map(i => `creep${missionId}_${i}`);
const resource = "XGH2O";
const salvageRoomName = "E40S30";
const homeRoomName = "E41S32";
const route = [homeRoomName, "E40S32", "E40S31", salvageRoomName];

const boosts = {
    carry: {XKH2O: {capacity: 4}},
    move: {}, tough: {}, ranged_attack: {}, heal: {}, attack: {},
};

function makePos(x, y, roomName) {
    return {
        x, y, roomName,
        inRangeTo(other, range) {
            const p = other.pos || other;
            return Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y)) <= range;
        },
        isNearTo(other) { return this.inRangeTo(other, 1); },
        isEqualTo(other) { const p = other.pos || other; return this.x === p.x && this.y === p.y; },
        lookFor() { return []; },
        getDirectionTo() { return 3; },
        findClosestByRange() { return {x: 49, y: 25, roomName: this.roomName}; },
    };
}

function makeConfig(overrides = {}) {
    return {
        id: missionId,
        deathTick: 100,
        launchUntil: 1000,
        resource,
        cargo: cargoNames.slice(),
        ...overrides,
    };
}

function makeTombstone(name, amount = 1000) {
    return {id: `tomb-${name}`, creep: {name}, store: {[resource]: amount}};
}

function makeLab(id, {my = true, active = true, cooldown = 0, pos} = {}, onUnboost = () => 0) {
    return {
        id, my, cooldown, pos,
        isActive: () => active,
        unboostCreep: onUnboost,
    };
}

function makeWorld(options = {}) {
    const spawns = [];
    const spawnRecords = [];
    const boostChecks = [];
    const boostRegistrations = [];
    const crossShardRequests = [];
    const paths = [];
    const storage = {
        my: true,
        store: {energy: 1000000, getFreeCapacity: () => 1000000},
    };
    const home = {
        name: homeRoomName,
        controller: {my: true, level: 8},
        storage,
        lab: [],
        energyAvailable: options.energy ?? 10000,
        currentEnergyAvailable: options.energy ?? 10000,
        spawnedMap: {},
        spawnFailure: false,
        spawn: Array.from({length: options.spawnCount ?? 4}, (_, i) => ({
            id: `spawn${i}`, spawning: false, isActive: () => true,
        })),
    };

    const portals = [];
    const tombstones = [];
    const hostiles = [];
    const target = {
        name: salvageRoomName,
        hostiles,
        tombstones,
        structures: portals,
        find(kind, options = {}) {
            if (kind === "tombstones") return this.tombstones;
            if (kind === "hostiles") return this.hostiles;
            if (kind === "creeps") return this.hostiles;
            if (kind === "hostilePower") return [];
            if (kind === "hostileStructures") return [];
            if (kind === "structures") return this.structures.filter(options.filter || (() => true));
            return [];
        },
        getHostileCreeps() { return this.hostiles; },
    };

    const ctx = {
        Creep: function () {},
        Memory: {npcConvoySalvage: makeConfig()},
        Game: {
            time: 100,
            shard: {name: "shard3"},
            cpu: {bucket: 10000},
            rooms: {[home.name]: home, [target.name]: target},
            creeps: {},
            getObjectById: () => null,
            map: {
                findExit: () => 3,
                findRoute: () => route.slice(1).map(room => ({room})),
                getRoomLinearDistance: () => 1,
                getRoomTerrain: () => ({get: () => 0}),
            },
        },
        global: null,
        MIN_CPU: false,
        CARRY: "carry", MOVE: "move", TOUGH: "tough", ATTACK: "attack",
        RANGED_ATTACK: "ranged_attack", HEAL: "heal", SYSTEM_USERNAME: "Screeps",
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_TIRED: -11, ERR_FULL: -8,
        ATTACK_POWER: 30, RANGED_ATTACK_POWER: 10, HEAL_POWER: 12,
        CARRY_CAPACITY: 50, LAB_BOOST_MINERAL: 30, LAB_BOOST_ENERGY: 20,
        RESOURCE_ENERGY: "energy", FIND_TOMBSTONES: "tombstones",
        FIND_HOSTILE_CREEPS: "hostiles", FIND_HOSTILE_POWER_CREEPS: "hostilePower",
        FIND_HOSTILE_STRUCTURES: "hostileStructures", FIND_STRUCTURES: "structures", FIND_CREEPS: "creeps",
        LOOK_STRUCTURES: "structuresLook", LOOK_RESOURCES: "resourcesLook", LOOK_CREEPS: "creepsLook",
        STRUCTURE_TOWER: "tower",
        STRUCTURE_PORTAL: "portal", STRUCTURE_RAMPART: "rampart", BOOSTS: boosts,
        OBSTACLE_OBJECT_TYPES: ["terminal", "wall"], TERRAIN_MASK_WALL: 1,
        PathFinder: {
            CostMatrix: class {
                constructor() { this.data = new Uint8Array(2500); }
                set(x,y,n) { this.data[x*50+y] = n; }
                get(x,y) { return this.data[x*50+y]; }
            },
            search(start, goals, opts) {
                const matrix = opts.roomCallback(start.roomName);
                const valid = p => opts.flee ? goals.every(o => !p.inRangeTo(o.pos,o.range))
                    : goals.some(o => p.inRangeTo(o.pos,o.range));
                const queue = [[start,[]]], seen = new Set([start.x*50+start.y]);
                for (let i=0;i<queue.length;i++) {
                    const [p,path] = queue[i];
                    if (valid(p)) { paths.push(path); return {path,incomplete:false}; }
                    for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) {
                        const x=p.x+dx, y=p.y+dy, key=x*50+y;
                        if (x<=0 || y<=0 || x>=49 || y>=49 || seen.has(key) || matrix.get(x,y)>=255) continue;
                        seen.add(key);
                        const next = makePos(x,y,start.roomName);
                        queue.push([next,[...path,next]]);
                    }
                }
                return {path:[],incomplete:true};
            },
        },
        RoomPosition: function (x, y, roomName) { return makePos(x, y, roomName); },
        Utils: {
            getBodyEnergyNeed(body) {
                const costs = {carry: 50, move: 50};
                return body.reduce((sum, part) => sum + (costs[part] || 0), 0);
            },
        },
        UtilsTask: {
            taskData(taskName, _register, data) { return {taskName, ...(data || {})}; },
        },
        isCpuFeatureEnabled: name => name === "crossShard",
        ManagerCrossShard: {
            addCrossShardRequest(shard, request, key) {
                crossShardRequests.push({shard, request, key});
                return options.acceptSignal !== false;
            },
        },
        StationLab: {
            boostAble(_room, requested) {
                boostChecks.push({...requested});
                const reserved = (_room._boost_need || []).reduce((sum, need) => sum + (need.XKH2O || 0), 0);
                return (options.xkh2o ?? 2250) - reserved >= (requested.XKH2O || 0);
            },
            generatorBoostResTask(requested, room) {
                const data = {...requested};
                (room._boost_need || (room._boost_need = [])).unshift(data);
                boostRegistrations.push(data);
                return [{taskName: "boostCreepBodyPart", data}];
            },
            getUnboostContainer(room) { return room.unboostBerth; },
        },
        StationHive: {
            trySpawn(room, targetRoom, body, role, tasks) {
                if (room.spawnFailure) return null;
                const spawn = room.spawn.find(s => !s.spawning && !room.spawnedMap[s.id] && s.isActive());
                const cost = ctx.Utils.getBodyEnergyNeed(body);
                if (!spawn || room.currentEnergyAvailable < cost) {
                    room.spawnFailure = true;
                    return null;
                }
                room.spawnedMap[spawn.id] = true;
                room.currentEnergyAvailable -= cost;
                const name = `salvage${spawnRecords.length}`;
                const record = {room, targetRoom, body: body.slice(), role, tasks, name, spawn: spawn.id};
                spawnRecords.push(record);
                spawns.push(name);
                ctx.Game.creeps[name] = {};
                return name;
            },
        },
        __spawnRecords: spawnRecords,
        __boostChecks: boostChecks,
        __boostRegistrations: boostRegistrations,
        __crossShardRequests: crossShardRequests,
        __target: target,
        __portals: portals,
        __tombstones: tombstones,
        __hostiles: hostiles,
        __paths: paths,
        __spawns: spawns,
    };
    ctx.global = ctx;
    vm.runInNewContext(source, ctx, {filename: "strategy_npcConvoy.js"});
    return ctx;
}

function makeCreep(ctx, {slot, shard, roomName, boosted = true, storeAmount = 0, x = 10, y = 10}) {
    const task = {
        taskName: "npcConvoySalvage", id: missionId, slot, cargo: cargoNames,
        resource, deathTick: 100, returning: false,
    };
    const actions = [];
    const scout = slot === "scout";
    const body = scout
        ? [{type: "move", hits: 100}]
        : [
            ...Array.from({length: 25}, () => ({type: "carry", hits: 100, boost: boosted ? "XKH2O" : undefined})),
            ...Array.from({length: 25}, () => ({type: "move", hits: 100})),
        ];
    const capacity = () => scout ? 0 : body.filter(part => part.type === "carry" && part.hits > 0)
        .reduce((sum, part) => sum + 50 * (part.boost ? boosts[part.type][part.boost].capacity : 1), 0);
    const store = {
        [resource]: storeAmount,
        isEmpty: () => store[resource] === 0,
        getCapacity: () => capacity(),
        getFreeCapacity: () => capacity() - Object.keys(store)
            .filter(key => typeof store[key] === "number").reduce((sum, key) => sum + store[key], 0),
    };
    const room = roomName === salvageRoomName ? ctx.__target : ctx.Game.rooms[homeRoomName];
    const creep = {
        name: `salvage-${slot}`, body, room, store, ticksToLive: 1000,
        hits: 5000, hitsMax: 5000, pos: makePos(x, y, roomName),
        lastTask: () => task,
        addTask(next) { actions.push(["addTask", next]); return this; },
        execLastTask() { actions.push(["execLastTask"]); return this; },
        popTask() { actions.push(["popTask"]); return this; },
        moveTo(target, opts) { actions.push(["moveTo", target, opts]); },
        move(direction) { actions.push(["move", direction]); },
        suicide() { actions.push(["suicide"]); return ctx.OK; },
        withdraw(stash, res) {
            actions.push(["withdraw", stash.id, res]);
            store[res] = Math.min(capacity(), stash.store[res]);
            return ctx.OK;
        },
        transfer(target, res, amount) {
            actions.push(["transfer", target, res, amount]);
            store[res] = Math.max(0, (store[res] || 0) - (amount ?? store[res]));
            return ctx.OK;
        },
        pickup(drop) {
            actions.push(["pickup", drop.resourceType, drop.amount]);
            store[drop.resourceType] = (store[drop.resourceType] || 0) + drop.amount;
            drop.amount = 0;
            return ctx.OK;
        },
    };
    creep.drops = [];
    creep.pos.lookFor = kind => kind === ctx.LOOK_RESOURCES ? creep.drops : [];
    ctx.Game.shard.name = shard;
    return {creep, task, actions, run: () => ctx.Creep.prototype.npcConvoySalvage.call(creep)};
}

test("execSalvage spawns one scout and three independently boosted haulers", () => {
    const ctx = makeWorld();
    ctx.StrategyNpcConvoy.execSalvage();

    assert.equal(ctx.__spawnRecords.length, 4);
    assert.deepEqual(ctx.__spawnRecords.map(s => s.tasks[0].slot), ["scout", ...cargoNames]);
    assert.equal(ctx.__spawnRecords[0].body.length, 1);
    assert.deepEqual(Array.from(ctx.__spawnRecords[0].body), ["move"]);
    for (const record of ctx.__spawnRecords.slice(1)) {
        assert.equal(record.role, "npcSalvage");
        assert.equal(record.body.length, 50);
        assert.equal(record.body.filter(part => part === "carry").length, 25);
        assert.equal(record.body.filter(part => part === "move").length, 25);
        assert.equal(record.tasks[0].taskName, "npcConvoySalvage");
        assert.equal(record.tasks.at(-1).taskName, "boostCreepBodyPart", "boost must execute from the top of the stack");
    }
    assert.deepEqual(ctx.__boostChecks, [{XKH2O: 750}, {XKH2O: 750}, {XKH2O: 750}]);
    assert.deepEqual(ctx.__boostRegistrations, [{XKH2O: 750}, {XKH2O: 750}, {XKH2O: 750}],
        "register exactly one 750 XKH2O request for each hauler");
    assert.equal(ctx.Game.rooms[homeRoomName]._boost_need.length, 3);
    assert.equal(ctx.Game.rooms[homeRoomName].currentEnergyAvailable, 2450,
        "scout plus three 2,500-energy haulers must be debited from the shared tick budget");

    const hauler = makeCreep(ctx, {slot: cargoNames[0], shard: "shard3", roomName: salvageRoomName});
    assert.equal(hauler.creep.store.getCapacity(), 5000,
        "25 XKH2O-boosted CARRY parts × 50 base capacity × 4 boost = 5,000");
});

test("two convoy cargo slots only dispatch one scout and two full haulers", () => {
    const ctx = makeWorld();
    ctx.Memory.npcConvoySalvage = makeConfig({cargo: cargoNames.slice(0, 2)});
    ctx.StrategyNpcConvoy.execSalvage();
    assert.deepEqual(ctx.__spawnRecords.map(s => s.tasks[0].slot), ["scout", ...cargoNames.slice(0, 2)]);
    assert.deepEqual(ctx.__boostChecks, [{XKH2O: 750}, {XKH2O: 750}]);
    assert.equal(Object.keys(ctx.Memory.npcConvoySalvage.units).length, 3);

    for (const cargo of [[], [cargoNames[0], cargoNames[0]], [...cargoNames, `creep${missionId}_3`]]) {
        const invalid = makeWorld();
        invalid.Memory.npcConvoySalvage = makeConfig({cargo});
        invalid.StrategyNpcConvoy.execSalvage();
        assert.equal(invalid.__spawnRecords.length, 0, "reject invalid or oversized staging groups");
    }
});

test("salvageReady accepts only matching mission, shard, death tick, and assigned cargo", () => {
    const cases = [
        [{id: "wrong"}, "mission mismatch"],
        [{shard: "shard3"}, "wrong reporting shard"],
        [{tick: 99}, "before NPC death tick"],
        [{available: []}, "no tombstones"],
        [{available: ["creep-unassigned"]}, "unassigned tombstone"],
    ];
    for (const [patch, label] of cases) {
        const ctx = makeWorld();
        const data = {id: missionId, shard: "shard2", tick: 100, available: [cargoNames[0]], ...patch};
        assert.equal(ctx.missionFunc.npcConvoySalvageReady(data), false, label);
        assert.equal(ctx.Memory.npcConvoySalvage.ready, undefined, `${label} must not unlock haulers`);
    }

    const ctx = makeWorld();
    assert.equal(ctx.missionFunc.npcConvoySalvageReady({
        id: missionId, shard: "shard2", tick: 101, available: [cargoNames[0], cargoNames[2]],
    }), true);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.Memory.npcConvoySalvage.ready)), {
        tick: 101, seenAt: 100, available: [cargoNames[0], cargoNames[2]],
    });
});

test("scout reports only after death, without an armed intruder, with real assigned tombstones", () => {
    const noTombstone = makeWorld();
    noTombstone.Game.shard.name = "shard2";
    const scout0 = makeCreep(noTombstone, {slot: "scout", shard: "shard2", roomName: salvageRoomName, x: 24, y: 43});
    scout0.run();
    assert.equal(noTombstone.__crossShardRequests.length, 0, "no identifiable tombstone means no signal");

    const early = makeWorld();
    early.Game.shard.name = "shard2";
    early.__tombstones.push(makeTombstone(cargoNames[0]));
    early.Memory.npcConvoySalvage.deathTick = 101;
    const earlyScout = makeCreep(early, {slot: "scout", shard: "shard2", roomName: salvageRoomName, x: 24, y: 43});
    earlyScout.task.deathTick = 101;
    earlyScout.run();
    assert.equal(early.__crossShardRequests.length, 0, "scout must wait until the configured death tick");

    const hostile = makeWorld();
    hostile.Game.shard.name = "shard2";
    hostile.__tombstones.push(makeTombstone(cargoNames[0]));
    hostile.__hostiles.push({getActiveBodyparts: type => type === hostile.ATTACK ? 1 : 0, pos: makePos(1, 1, salvageRoomName)});
    makeCreep(hostile, {slot: "scout", shard: "shard2", roomName: salvageRoomName, x: 24, y: 43}).run();
    assert.equal(hostile.__crossShardRequests.length, 0, "a visible armed intruder blocks the signal");

    const assigned = makeWorld();
    assigned.Game.shard.name = "shard2";
    assigned.__tombstones.push(makeTombstone(cargoNames[0]), makeTombstone("creep-unassigned"), makeTombstone(cargoNames[1], 0));
    const scout = makeCreep(assigned, {slot: "scout", shard: "shard2", roomName: salvageRoomName, x: 24, y: 43});
    scout.run();
    assert.equal(assigned.__crossShardRequests.length, 1);
    assert.equal(assigned.__crossShardRequests[0].shard, "shard3");
    assert.deepEqual(assigned.__crossShardRequests[0].request.data.available, [cargoNames[0]],
        "only positive-resource tombstones assigned to this mission may be reported");
});

function npc(name, x, y, offense, store = {}) {
    return {name, owner:{username:"Screeps"}, pos:makePos(x,y,salvageRoomName), store,
        getActiveBodyparts:type => type === offense ? 1 : 0};
}

test("a scout only authorizes early staging after stationary samples and a safe portal-to-cargo path", () => {
    const ctx = makeWorld();
    ctx.Game.shard.name = "shard2";
    ctx.Game.time = 80;
    const reverse = {structureType:"portal",destination:{shard:"shard3"},pos:makePos(30,37,salvageRoomName),ticksToDecay:50};
    ctx.__portals.push(reverse);
    const cargo = npc(cargoNames[0],43,30,null,{[resource]:5000});
    const ranged = npc(`creep${missionId}_3`,40,25,"ranged_attack");
    const melee = npc(`creep${missionId}_4`,48,29,"attack");
    const outsider = {name:"unarmed-looter",owner:{username:"other"},pos:makePos(41,30,salvageRoomName),getActiveBodyparts:()=>0};
    ctx.__hostiles.push(cargo,ranged,melee,outsider);
    const scout = makeCreep(ctx,{slot:"scout",shard:"shard2",roomName:salvageRoomName,x:25,y:43});
    scout.run();
    ctx.Game.time = 84;
    ranged.pos = makePos(39,25,salvageRoomName);
    scout.run();
    assert.equal(ctx.__crossShardRequests.length,0,"moving escorts invalidate the stability sample");
    ctx.Game.time = 88;
    scout.run();
    assert.equal(ctx.__crossShardRequests.length,0,"a return portal decaying before the return window cannot authorize entry");
    reverse.ticksToDecay = 1000;
    ctx.Game.time = 89;
    scout.run();
    assert.equal(ctx.__crossShardRequests[0].request.func,"npcConvoySalvageStage");
    assert.deepEqual(Array.from(ctx.__crossShardRequests[0].request.data.slots),[cargoNames[0]]);
    assert.ok(ctx.__paths.length > 0);
    for (const p of ctx.__paths.flat()) {
        assert.equal(p.inRangeTo(ranged,4),false,"entire path keeps ranged buffer");
        assert.equal(p.inRangeTo(melee,2),false,"entire path keeps melee buffer");
        assert.equal(p.isEqualTo(outsider),false);
    }
    assert.ok(scout.actions.some(a=>a[0]==="move"));
    assert.equal(scout.actions.some(a=>a[0]==="withdraw"),false);
});

test("early portal permission expires and is scoped to the approved cargo slot", () => {
    const ctx = makeWorld();
    ctx.__portals.push({structureType:"portal",destination:{shard:"shard2"},pos:makePos(14,8,salvageRoomName)});
    const data = {id:missionId,shard:"shard2",tick:80,observedAt:Date.now(),slots:[cargoNames[0]]};
    assert.equal(ctx.missionFunc.npcConvoySalvageStage({...data,observedAt:data.observedAt-91000}),false);
    assert.equal(ctx.missionFunc.npcConvoySalvageStage({...data,tick:100}),false);
    assert.equal(ctx.missionFunc.npcConvoySalvageStage({...data,slots:["foreign-slot"]}),false);
    assert.equal(ctx.missionFunc.npcConvoySalvageStage(data),true);

    const accepted = makeCreep(ctx,{slot:cargoNames[0],shard:"shard3",roomName:salvageRoomName});
    const wait = makeCreep(ctx,{slot:cargoNames[1],shard:"shard3",roomName:salvageRoomName});
    accepted.run(); wait.run();
    assert.ok(accepted.actions.some(a=>a[0]==="addTask"&&a[1].peaceful));
    assert.equal(wait.actions.some(a=>a[0]==="addTask"),false);
    ctx.Memory.npcConvoySalvage.stageHint.observedAt -= 91000;
    const late = makeCreep(ctx,{slot:cargoNames[0],shard:"shard3",roomName:salvageRoomName});
    late.run();
    assert.equal(late.actions.some(a=>a[0]==="addTask"),false,"stale approval does not authorize the crossing");
});

test("a staged hauler waits adjacent without attacking and collects only after expiry despite an unarmed rival", () => {
    const ctx = makeWorld();
    ctx.Game.shard.name = "shard2";
    ctx.Game.time = 95;
    ctx.__hostiles.push(npc(cargoNames[0],43,30,null,{[resource]:5000}),
        npc(`creep${missionId}_3`,39,25,"ranged_attack"));
    const h = makeCreep(ctx,{slot:cargoNames[0],shard:"shard2",roomName:salvageRoomName,x:42,y:30});
    ctx.__tombstones.push(makeTombstone(cargoNames[0],2500));
    h.run();
    assert.deepEqual(h.actions,[],"no pickup, attack or detour while waiting by live cargo");
    ctx.Game.time = 100;
    h.run();
    assert.deepEqual(h.actions,[],"reaching the nominal tick does not bypass live escorts");
    ctx.Game.time = 101;
    ctx.__hostiles.splice(0,2,{name:"other-carrier",owner:{username:"other"},pos:makePos(40,30,salvageRoomName),getActiveBodyparts:()=>0});
    h.run();
    assert.deepEqual(h.actions,[["withdraw",`tomb-${cargoNames[0]}`,resource]]);
    assert.equal(h.creep.store[resource],2500);
});

test("a foreign attacker sends a staged hauler back along a safe path", () => {
    const ctx = makeWorld();
    ctx.Game.shard.name = "shard2";
    ctx.Game.time = 93;
    ctx.__portals.push({structureType:"portal",destination:{shard:"shard3"},pos:makePos(30,37,salvageRoomName)});
    const foreign = {name:"fighter",owner:{username:"other"},pos:makePos(35,32,salvageRoomName),
        getActiveBodyparts:type=>type===ctx.RANGED_ATTACK?1:0};
    ctx.__hostiles.push(npc(cargoNames[0],43,30,null,{[resource]:5000}),foreign);
    const h = makeCreep(ctx,{slot:cargoNames[0],shard:"shard2",roomName:salvageRoomName,x:42,y:30});
    h.run();
    assert.equal(h.task.returning,true);
    assert.ok(h.actions.some(a=>a[0]==="move"));
    assert.equal(h.actions.some(a=>a[0]==="withdraw"||a[0]==="addTask"),false,"never leave the route to fight or step directly into danger");
    assert.ok(ctx.__paths.at(-1).every(p=>!p.inRangeTo(foreign,4)));
});

test("scout stays on shard2 until shard3 acknowledges the report, then suicides in place", () => {
    const ctx = makeWorld();
    ctx.Game.shard.name = "shard2";
    ctx.__tombstones.push(makeTombstone(cargoNames[0]));
    ctx.__portals.push({structureType: "portal", destination: {shard: "shard3"}, pos: makePos(30, 37, salvageRoomName)});
    const scout = makeCreep(ctx, {slot: "scout", shard: "shard2", roomName: salvageRoomName, x: 24, y: 43});
    ctx.Game.creeps[scout.creep.name] = scout.creep;
    scout.run();
    const report = ctx.__crossShardRequests[0].request;
    const acknowledge = ctx.missionCallBack[report.callBack];
    assert.equal(report.data.scout, scout.creep.name);
    assert.equal(scout.task.readySent, ctx.Game.time);
    assert.deepEqual(scout.actions, [], "queuing the request has not yet confirmed delivery");

    ctx.Game.time += 141;
    scout.creep.ticksToLive = 200;
    acknowledge({data: {...report.data, id: "wrong-mission"}});
    scout.run();
    assert.equal(ctx.__crossShardRequests.length, 1);
    assert.deepEqual(scout.actions, [], "do not requeue, return, or suicide while awaiting the matching acknowledgement");

    ctx.Game.shard.name = "shard3";
    assert.equal(ctx.missionFunc[report.func](report.data), true);
    assert.deepEqual(Array.from(ctx.Memory.npcConvoySalvage.ready.available), [cargoNames[0]]);
    acknowledge(report);
    assert.equal(scout.task.readyAcknowledged, undefined, "only the sender shard can acknowledge its scout");
    ctx.Game.shard.name = "shard2";
    acknowledge(report);
    scout.run();
    assert.deepEqual(scout.actions, [["suicide"]]);
});

test("scout already returning on shard3 retires only for its matching accepted mission", () => {
    const ctx = makeWorld();
    const scout = makeCreep(ctx, {slot: "scout", shard: "shard3", roomName: salvageRoomName});
    scout.task.returning = true;
    ctx.Memory.npcConvoySalvage.ready = {tick: 100, seenAt: 100, available: [cargoNames[0]]};
    scout.run();
    assert.deepEqual(scout.actions, [["suicide"]]);

    const hauler = makeCreep(ctx, {slot: cargoNames[0], shard: "shard3", roomName: salvageRoomName});
    hauler.task.returning = true;
    hauler.run();
    assert.equal(hauler.actions.some(a => a[0] === "suicide"), false);
});

test("hauler waits for accepted scout signal, crosses only when boosted, then withdraws only its tombstone and returns", () => {
    const ctx = makeWorld();
    ctx.__portals.push(
        {structureType: "portal", destination: {shard: "shard2"}, pos: makePos(14, 8, salvageRoomName)},
        {structureType: "portal", destination: {shard: "shard3"}, pos: makePos(30, 37, salvageRoomName)},
    );

    const hauler = makeCreep(ctx, {slot: cargoNames[1], shard: "shard3", roomName: salvageRoomName, x: 10, y: 10});
    hauler.run();
    assert.equal(hauler.task.returning, false);
    assert.equal(hauler.actions.some(a => a[0] === "addTask" && a[1].expectedDestShard === "shard2"), false,
        "hauler must stage without an accepted scout signal");

    assert.equal(ctx.missionFunc.npcConvoySalvageReady({
        id: missionId, shard: "shard2", tick: 101, available: [cargoNames[1]],
    }), true);
    hauler.run();
    const outbound = hauler.actions.find(a => a[0] === "addTask" && a[1].expectedDestShard === "shard2");
    assert.ok(outbound, "accepted signal for this slot unlocks the outbound portal task");

    const unboosted = makeCreep(ctx, {slot: cargoNames[0], shard: "shard3", roomName: salvageRoomName, boosted: false});
    ctx.Memory.npcConvoySalvage.ready = {tick: 101, seenAt: 100, available: [cargoNames[0]]};
    unboosted.run();
    ctx.Game.time += 3;
    unboosted.run();
    assert.equal(unboosted.task.returning, true, "an unboosted hauler is routed home even if listed as available");
    assert.equal(unboosted.actions.some(a => a[0] === "addTask" && a[1].expectedDestShard === "shard2"), false);

    ctx.Game.shard.name = "shard2";
    const targetRoom = ctx.__target;
    targetRoom.tombstones.push(makeTombstone(cargoNames[0]), makeTombstone(cargoNames[1]), makeTombstone(cargoNames[2]));
    const fieldHauler = makeCreep(ctx, {slot: cargoNames[1], shard: "shard2", roomName: salvageRoomName, x: 24, y: 43});
    fieldHauler.run();
    assert.deepEqual(fieldHauler.actions.find(a => a[0] === "withdraw"), ["withdraw", `tomb-${cargoNames[1]}`, resource],
        "hauler may withdraw only the tombstone assigned to its slot");
    fieldHauler.run();
    const returning = fieldHauler.actions.find(a => a[0] === "addTask" && a[1].expectedDestShard === "shard3");
    assert.ok(returning, `loaded hauler must use the return portal to shard3: ${JSON.stringify({actions:fieldHauler.actions, cached:targetRoom._npcConvoyPortals?.map(p=>({id:p.id,x:p.pos.x,y:p.pos.y,to:p.destination?.shard}))})}`);
});

test("returning hauler unloads loot, waits for an owned active ready lab, unboosts, then recycles", () => {
    const ctx = makeWorld();
    const home = ctx.Game.rooms[homeRoomName];
    const berth = {id: "unboost-berth", pos: makePos(20, 20, homeRoomName)};
    home.unboostBerth = berth;
    const unboostCalls = [];
    const noOpUnboost = () => { throw new Error("ineligible lab must not be selected"); };
    const cooling = makeLab("cooling", {pos: makePos(19, 20, homeRoomName), cooldown: 1}, noOpUnboost);
    const inactive = makeLab("inactive", {pos: makePos(20, 19, homeRoomName), active: false}, noOpUnboost);
    const foreign = makeLab("foreign", {pos: makePos(21, 20, homeRoomName), my: false}, noOpUnboost);
    const ready = makeLab("ready", {pos: makePos(21, 21, homeRoomName)}, creep => {
        unboostCalls.push(creep.name);
        for (const part of creep.body) delete part.boost;
        return ctx.OK;
    });
    home.lab = [foreign, inactive, cooling, ready];

    const hauler = makeCreep(ctx, {slot: cargoNames[0], shard: "shard3", roomName: homeRoomName, storeAmount: 500});
    hauler.task.returning = true;
    hauler.run();
    assert.equal(hauler.creep.store[resource], 0, "cargo unload happens before unboosting");
    assert.equal(hauler.task.delivered, 500);
    assert.equal(unboostCalls.length, 0);

    hauler.creep.pos = makePos(10, 10, homeRoomName);
    hauler.run();
    const berthMove = hauler.actions.find(a => a[0] === "moveTo");
    assert.equal(berthMove[1], berth, "the dedicated StationLab berth is preferred");
    assert.equal(unboostCalls.length, 0, "a boosted hauler must not recycle while traveling to the berth");

    hauler.creep.pos = berth.pos;
    ready.cooldown = 1;
    hauler.run();
    assert.equal(unboostCalls.length, 0, "cooldown blocks unboost without triggering recycle");
    assert.ok(hauler.creep.body.some(part => part.boost), "boost remains while every eligible lab is unavailable");
    assert.equal(hauler.actions.some(a => a[0] === "addTask" && a[1].taskName === "recycleCreep"), false);

    ready.cooldown = 0;
    hauler.run();
    assert.deepEqual(unboostCalls, [hauler.creep.name], "the owned active ready lab performs unboost");
    assert.equal(cooling._used, undefined, "the previously cooling lab remains unused");
    assert.equal(ready._used, true);
    assert.equal(hauler.task.unboostAt, ctx.Game.time);
    assert.equal(hauler.actions.some(a => a[0] === "addTask" && a[1].taskName === "recycleCreep"), false,
        "do not recycle in the same snapshot that still observed boosted body parts");

    hauler.run(); // next body snapshot is unboosted
    assert.equal(hauler.creep.body.some(part => part.boost), false);
    assert.equal(ctx.Memory.npcConvoySalvage.finished[cargoNames[0]], 500);
    assert.equal(ctx.Memory.npcConvoySalvage.unboosted[cargoNames[0]], ctx.Game.time);
    assert.ok(hauler.actions.some(a => a[0] === "addTask" && a[1].taskName === "recycleCreep"));
});

test("fallback unboost overflow XKH2O is delivered but not counted as recovered loot", () => {
    const ctx = makeWorld();
    const home = ctx.Game.rooms[homeRoomName];
    const hauler = makeCreep(ctx, {slot: cargoNames[1], shard: "shard3", roomName: homeRoomName});
    hauler.task.returning = true;
    hauler.task.delivered = 400;
    const overflow = {resourceType: "XKH2O", amount: 750};
    hauler.creep.drops.push(overflow);
    const fallback = makeLab("fallback", {pos: makePos(11, 10, homeRoomName)}, creep => {
        for (const part of creep.body) delete part.boost;
        return ctx.OK;
    });
    home.lab = [fallback]; // no dedicated StationLab berth: use the nearby fallback lab

    hauler.run();
    assert.equal(hauler.task.unboostAt, ctx.Game.time);
    assert.equal(hauler.creep.body.some(part => part.boost), false);
    assert.equal(hauler.actions.some(a => a[0] === "addTask" && a[1].taskName === "recycleCreep"), false);

    hauler.run(); // pick up the XKH2O overflow from the fallback lab
    assert.ok(hauler.actions.some(a => a[0] === "pickup" && a[1] === "XKH2O"));
    hauler.run(); // export the boost resource without increasing loot accounting
    const boostTransfer = hauler.actions.find(a => a[0] === "transfer" && a[2] === "XKH2O");
    assert.ok(boostTransfer, "overflow boost mineral is returned to storage");
    assert.equal(hauler.task.delivered, 400, "XKH2O must not count as the assigned loot resource");
    hauler.run();
    assert.equal(ctx.Memory.npcConvoySalvage.finished[cargoNames[1]], 400);
    assert.ok(hauler.actions.some(a => a[0] === "addTask" && a[1].taskName === "recycleCreep"));
});
