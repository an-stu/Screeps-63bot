/**
 * Bounded VM regressions for the W31N51 cross-shard garrison protocol.
 * These mocks exercise plan handoff, accepted spawn requests, last-moment
 * portal authorization, and the target-room combat frame without simulating
 * Screeps pathfinding or the full spawn/boost engine.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "team_raL1.js"), "utf8");
const teamL2Src = fs.readFileSync(path.join(root, "modules", "teamL2.js"), "utf8");

function loadTeamL2Bodies(ctx) {
    const team = {
        console: {log() {}},
        Logger: {log() {}},
        global: null,
        ManagerCreeps: ctx.ManagerCreeps,
        TOUGH: ctx.TOUGH,
        RANGED_ATTACK: ctx.RANGED_ATTACK,
        MOVE: ctx.MOVE,
        HEAL: ctx.HEAL,
        ATTACK: ctx.ATTACK,
        WORK: ctx.WORK,
        CARRY: ctx.CARRY,
        CLAIM: ctx.CLAIM,
        UtilsTask: ctx.UtilsTask,
        ManagerCrossShard: ctx.ManagerCrossShard,
        ManagerFlags: ctx.ManagerFlags,
        Game: ctx.Game,
    };
    team.global = team;
    vm.runInNewContext(teamL2Src, team, {filename: "teamL2.js"});
    return {
        teamL2: team.teamL2,
        ra: team.teamL2.getR2H2ra(),
        healer: team.teamL2.getR2H2heal(),
    };
}

function load({time = 100000, shard = "shard3", spawnCount = 4} = {}) {
    let missionSeq = 0;
    let spawnSeq = 0;
    let ctx;
    const acceptedSpawns = [];
    const spawnAttempts = [];
    const partBoost = {
        tough: "XGHO2",
        ranged_attack: "XKHO2",
        move: "XZHO2",
        heal: "XLHO2",
    };

    function profileForSlot(slot) {
        return slot % 2 === 0 ? ctx.TeamL2Bodies.ra : ctx.TeamL2Bodies.healer;
    }
    function toughFrontBody(slot) {
        const body = profileForSlot(slot);
        return [...body.filter(part => part === ctx.TOUGH), ...body.filter(part => part !== ctx.TOUGH)];
    }
    function boostMapForSlot(slot) {
        const body = profileForSlot(slot);
        const counts = body.reduce((out, part) => {
            out[part] = (out[part] || 0) + 1;
            return out;
        }, {});
        return {
            XGHO2: counts[ctx.TOUGH] * 30,
            XKHO2: counts[ctx.RANGED_ATTACK] * 30,
            XZHO2: counts[ctx.MOVE] * 30,
            XLHO2: counts[ctx.HEAL] * 30,
        };
    }
    function acceptedT3Body(body, tasks) {
        if (!Array.isArray(body) || body.length !== 50) return false;
        const task = (tasks || []).find(t => t.taskName === "crossShardGarrison");
        if (!task || !Number.isInteger(task.slot) || task.slot < 0 || task.slot > 3) return false;
        const expected = toughFrontBody(task.slot);
        if (!body.every((part, i) => part === expected[i]) || body.slice(0, 11).some(part => part !== ctx.TOUGH)) return false;
        const boostTask = (tasks || []).find(t => t.taskName === "boostCreepBodyPart");
        if (!boostTask || !boostTask.data) return false;
        const expectedBoosts = boostMapForSlot(task.slot);
        return Object.keys(expectedBoosts).every(resource => boostTask.data[resource] === expectedBoosts[resource])
            && Object.keys(boostTask.data).length === 4;
    }

    ctx = {
        console: {log() {}},
        log() {},
        Logger: {log() {}, warning() {}},
        Creep: function () {},
        RoomPosition: function (x, y, roomName) {
            this.x = x;
            this.y = y;
            this.roomName = roomName;
            this.isEqualTo = other => !!other && this.x === other.x && this.y === other.y
                && this.roomName === other.roomName;
            this.getDirectionTo = other => other.x > this.x ? 3 : other.x < this.x ? 7
                : other.y > this.y ? 5 : other.y < this.y ? 1 : 0;
        },
        ManagerCreeps: {
            calcBodyPart(spec) {
                const out = [];
                (Array.isArray(spec) ? spec : Object.keys(spec).map(k => [k, spec[k]]))
                    .forEach(([part, count]) => {
                        for (let i = 0; i < count; i++) out.push(part);
                    });
                return out;
            },
        },
        ManagerFlags: {getFlagsByPrefix() { return []; }},
        ManagerCrossShard: {
            calls: [],
            addCrossShardRequest(toShard, mission, id) {
                const request = {toShard, id: id || "m" + (++missionSeq), mission};
                this.calls.push(request);
                return request.id;
            },
        },
        StationLab: {
            calls: [],
            boostAble(room, boost) {
                this.calls.push({room, boost});
                return true;
            },
            generatorBoostResTask(boost) {
                return [{taskName: "boostCreepBodyPart", regFun: "registerBoostCreep", data: boost}];
            },
        },
        StationHive: {
            acceptedSpawns,
            spawnAttempts,
            trySpawn(room, targetRoom, body, role, tasks) {
                const call = {room, targetRoom, body: body.slice(), role, tasks: tasks.slice()};
                const isScout = tasks.some(t => t.taskName === "crossShardGarrisonScout");
                const accepted = isScout
                    ? body.length === 1 && body[0] === "move"
                    : acceptedT3Body(body, tasks);
                spawnAttempts.push({...call, accepted});
                if (!accepted) return undefined;
                const spawn = room.spawn.find(s => !s.spawning && !room.spawnedMap[s.id] && s.isActive());
                if (!spawn) return undefined;

                const name = "garrison_" + (++spawnSeq);
                spawn.spawning = {name};
                const creep = {
                    name,
                    spawning: true,
                    ticksToLive: undefined,
                    room: {name: room.name},
                    body: body.map(type => ({type, boost: partBoost[type], hits: 100})),
                    memory: {tasks},
                };
                ctx.Game.creeps[name] = creep;
                const acceptedCall = {...call, name, creep, isScout};
                acceptedSpawns.push(acceptedCall);
                return name;
            },
        },
        Utils: {getBodyEnergyNeed: body => body.length * 100},
        UtilsTask: {
            taskData(taskName, regFun, ops = {}) {
                return {taskName, regFun, ...ops};
            },
            taskFlag(flag, taskName, regFun, ops = {}) {
                return this.taskData(taskName, regFun, {id: flag.name, ...ops});
            },
        },
        TOUGH: "tough",
        ATTACK: "attack",
        RANGED_ATTACK: "ranged_attack",
        MOVE: "move",
        HEAL: "heal",
        WORK: "work",
        CARRY: "carry",
        CLAIM: "claim",
        OK: 0,
        ERR_NOT_IN_RANGE: -9,
        RESOURCE_ENERGY: "energy",
        FIND_HOSTILE_CREEPS: 1,
        FIND_HOSTILE_POWER_CREEPS: 2,
        FIND_HOSTILE_STRUCTURES: 113,
        FIND_STRUCTURES: 4,
        FIND_MY_STRUCTURES: 5,
        FIND_CREEPS: 6,
        TOP: 1,
        RIGHT: 3,
        BOTTOM: 5,
        LEFT: 7,
        STRUCTURE_TOWER: "tower",
        OBSTACLE_OBJECT_TYPES: [],
        TERRAIN_MASK_WALL: 1,
        BOOST_RES: {
            damage: ["G", "GHO2", "XGHO2"],
            rangedAttack: ["K", "KHO2", "XKHO2"],
            fatigue: ["Z", "ZHO2", "XZHO2"],
            heal: ["L", "LHO2", "XLHO2"],
        },
        BOOSTS: {
            tough: {XGHO2: {damage: 0.3}},
            ranged_attack: {XKHO2: {rangedAttack: 4}},
            move: {XZHO2: {fatigue: 2}},
            heal: {XLHO2: {heal: 4, rangedHeal: 4}},
        },
        Game: {
            time,
            shard: {name: shard},
            creeps: {},
            rooms: {},
            flags: {},
            map: {
                getRoomLinearDistance: () => 1,
                getRoomTerrain: () => ({get: () => 0}),
                findExit: () => [],
            },
        },
        PathFinder: {
            calls: [],
            search(start, goals, options) {
                this.calls.push({start, goals, options});
                options?.roomCallback?.(start.roomName);
                return {
                    incomplete: false,
                    path: [new ctx.RoomPosition(start.x + 1, start.y, start.roomName)],
                };
            },
        },
        Memory: {creeps: {}, missions: {}},
        global: null,
    };
    const teamL2 = loadTeamL2Bodies(ctx);
    ctx.teamL2 = teamL2.teamL2;
    ctx.TeamL2Bodies = {ra: teamL2.ra, healer: teamL2.healer};
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, {filename: "team_raL1.js"});
    ctx.acceptedSpawns = acceptedSpawns;
    ctx.spawnAttempts = spawnAttempts;
    return ctx;
}

function makeSpawnRoom(ctx, spawnCount = 4) {
    return {
        name: "W31N55",
        my: true,
        currentEnergyAvailable: 100000,
        energyAvailable: 100000,
        spawnedMap: {},
        spawn: Array.from({length: spawnCount}, (_, i) => ({
            id: "spawn" + i,
            pos: {x: 25 + (i % 2), y: 25 + Math.floor(i / 2), roomName: "W31N55"},
            spawning: null,
            isActive: () => true,
        })),
    };
}

function cfg(ctx, overrides = {}) {
    const value = Object.assign({
        active: true,
        roomName: "W31N51",
        targetShard: "shard2",
        originShard: "shard3",
        spawnRoom: "W31N55",
        anchor: {x: 25, y: 25},
        squad: 4,
        wave: 0,
        leadTicks: 2500,
        path: {path: [{shard: "shard3", roomName: "W30N50", x: 30, y: 8}]},
        landingRoute: ["W30N50", "W30N51", "W31N51"],
    }, overrides);
    ctx.Memory.crossShardGarrisons = {W31N51: value};
    ctx.Game.rooms.W31N55 = makeSpawnRoom(ctx);
    return value;
}

function freshRemote({open = true, members = [], scoutTtl = 0, observedAt = Date.now()} = {}) {
    return {open, members, scoutTtl, observedAt};
}

function roleBody(ctx, slot) {
    const raw = slot % 2 === 0 ? ctx.TeamL2Bodies.ra : ctx.TeamL2Bodies.healer;
    return [...raw.filter(part => part === ctx.TOUGH), ...raw.filter(part => part !== ctx.TOUGH)];
}

function boostMapForSlot(ctx, slot) {
    const body = slot % 2 === 0 ? ctx.TeamL2Bodies.ra : ctx.TeamL2Bodies.healer;
    const counts = body.reduce((out, part) => {
        out[part] = (out[part] || 0) + 1;
        return out;
    }, {});
    return {
        XGHO2: counts[ctx.TOUGH] * 30,
        XKHO2: counts[ctx.RANGED_ATTACK] * 30,
        XZHO2: counts[ctx.MOVE] * 30,
        XLHO2: counts[ctx.HEAL] * 30,
    };
}

function boostedT3Body(ctx, slot = 0) {
    const boost = {tough: "XGHO2", ranged_attack: "XKHO2", move: "XZHO2", heal: "XLHO2"};
    return roleBody(ctx, slot).map(type => ({type, boost: boost[type], hits: 100}));
}

function assertRoleBody(ctx, body, slot, message = "") {
    const expected = roleBody(ctx, slot);
    const counts = expected.reduce((out, part) => {
        out[part] = (out[part] || 0) + 1;
        return out;
    }, {});
    assert.equal(body.length, 50, message + " body is 50 parts");
    assert.deepEqual(Array.from(body), Array.from(expected), message + " ordered teamL2 body with TOUGH front");
    assert.ok(body.slice(0, 11).every(part => part === ctx.TOUGH), message + " has 11 front-loaded TOUGH");
    assert.equal(counts[ctx.TOUGH], 11);
    assert.equal(counts[ctx.MOVE], 10);
    assert.equal(counts[ctx.RANGED_ATTACK], slot % 2 === 0 ? 21 : 8);
    assert.equal(counts[ctx.HEAL], slot % 2 === 0 ? 8 : 21);
}

function memberRecords(names, ttls, wave = 0) {
    return names.map((name, slot) => [slot, name, ttls[slot], true, wave]);
}

// 1. A configured 2500-tick lead is capped at 1000: closed at 2500 and 1001,
// open at 1000. The target reports its decision as a cross-shard plan frame.
{
    const ctx = load({shard: "shard2"});
    const c = cfg(ctx, {leadTicks: 2500});
    const room = {
        name: "W31N51",
        controller: {my: true, safeMode: 2500, safeModeAvailable: 3},
        tower: [],
        getHostileCreeps() { return []; },
    };
    ctx.Game.rooms.W31N51 = room;
    const targetMember = fullMember(ctx, "wave-member", 0);
    targetMember.room = {name: "W31N51"};
    targetMember.ticksToLive = 1000;
    targetMember.memory.tasks[0].wave = 9;
    ctx.Game.creeps[targetMember.name] = targetMember;

    ctx.CrossShardGarrison.exec();
    let plan = ctx.ManagerCrossShard.calls.at(-1).mission.data;
    assert.equal(c.audit.dispatchWindow, 1000);
    assert.deepEqual(Array.from(plan.members[0]), [0, "wave-member", 1000, true, 9],
        "target frame preserves the exact slot and deployment wave");
    assert.equal(plan.open, false, "2500 configured lead must remain capped and closed");

    ctx.Game.time += 20;
    room.controller.safeMode = 1001;
    ctx.CrossShardGarrison.exec();
    plan = ctx.ManagerCrossShard.calls.at(-1).mission.data;
    assert.equal(plan.open, false, "one tick above the cap stays closed");

    ctx.Game.time += 20;
    room.controller.safeMode = 1000;
    ctx.CrossShardGarrison.exec();
    plan = ctx.ManagerCrossShard.calls.at(-1).mission.data;
    assert.equal(plan.open, true, "dispatch opens at the capped threshold");
}

// 2. Origin rejects stale plan frames and will not dispatch from stale or
// current-but-closed remote state.
{
    const ctx = load({shard: "shard3"});
    const c = cfg(ctx, {remote: freshRemote({open: true, observedAt: Date.now() - 200000})});
    const stale = {
        roomName: "W31N51", targetShard: "shard2", observedAt: Date.now() - 200000,
        open: false, members: [], scoutTtl: 0,
    };
    assert.equal(ctx.CrossShardGarrison.receivePlan(stale), false, "stale plan must be rejected");
    assert.equal(c.remote.open, true, "stale closed frame must not overwrite the last plan");

    ctx.CrossShardGarrison.exec();
    assert.equal(ctx.acceptedSpawns.length, 0, "stale open state must fail closed");

    const closed = {
        roomName: "W31N51", targetShard: "shard2", observedAt: Date.now(),
        open: false, members: [], scoutTtl: 0,
    };
    assert.equal(ctx.CrossShardGarrison.receivePlan(closed), true);
    assert.equal(c.dispatchEnabled, false);
    ctx.Game.time += 10;
    delete ctx.Game._crossGarrisonUnits;
    ctx.CrossShardGarrison.exec();
    assert.equal(ctx.acceptedSpawns.length, 0, "fresh closed plan must not spawn a scout or member");
    assert.equal(c.dispatchError, "waiting safe-mode window");
}

// 3. A six-unit request is capped to the four all-in-one slots. The initial
// scout plus three members consume four spawns; once one spawn frees, slot 3
// fills. All four accepted member bodies must be fully T3 and no reserve slots
// may be created or duplicated.
{
    const ctx = load({shard: "shard3"});
    const c = cfg(ctx, {squad: 6, remote: freshRemote()});
    assert.equal(ctx.CrossShardGarrison.squad(c), 4, "six configured requests still produce only four members");
    ctx.CrossShardGarrison.exec();

    const scouts = ctx.acceptedSpawns.filter(call => call.isScout);
    const members = ctx.acceptedSpawns.filter(call => !call.isScout);
    assert.equal(scouts.length, 1);
    assert.deepEqual(Array.from(scouts[0].body), [ctx.MOVE]);
    assert.equal(members.length, 3, "three free spawn slots after the scout should accept multiple members");
    assert.deepEqual(members.map(call => call.tasks[0].slot), [0, 1, 2]);
    assert.ok(members.every(call => Number.isFinite(call.tasks[0].wave)),
        "each accepted member carries a numeric deployment wave");
    assert.ok(members.every(call => call.tasks[0].wave === c.wave),
        "all first-wave members share the current wave identifier");
    for (const call of members) {
        const slot = call.tasks[0].slot;
        assert.equal(call.tasks[0].taskName, "crossShardGarrison");
        assertRoleBody(ctx, Array.from(call.body), slot, "spawn slot " + slot);
        assert.deepEqual({...call.tasks[1].data}, boostMapForSlot(ctx, slot),
            "boost request must match the RA/healer role assigned to this slot");
        assert.deepEqual(
            call.creep.body.reduce((counts, p) => {
                const key = p.type + ":" + p.boost;
                counts[key] = (counts[key] || 0) + 1;
                return counts;
            }, {}),
            {
                ["tough:XGHO2"]: 11,
                ["ranged_attack:XKHO2"]: slot % 2 === 0 ? 21 : 8,
                ["move:XZHO2"]: 10,
                ["heal:XLHO2"]: slot % 2 === 0 ? 8 : 21,
            },
            "accepted creep must match its fully T3-boosted same-slot R2H2 role",
        );
    }
    assert.ok(ctx.acceptedSpawns.every(call => call.isScout
        || (call.body.length === 50 && call.tasks.some(t => t.taskName === "boostCreepBodyPart"))));
    assert.deepEqual(Object.keys(c.roster).sort(), ["0", "1", "2"]);

    ctx.Game.rooms.W31N55.spawn[0].spawning = null;
    ctx.Game.time += 10;
    delete ctx.Game._crossGarrisonUnits;
    ctx.CrossShardGarrison.exec();
    const allMembers = ctx.acceptedSpawns.filter(call => !call.isScout);
    assert.equal(allMembers.length, 4, "the fourth and final member fills slot 3");
    assert.deepEqual(allMembers.map(call => call.tasks[0].slot), [0, 1, 2, 3]);
    assert.ok(allMembers.every(call => call.tasks[0].wave === c.wave));
    assert.deepEqual(Object.keys(c.roster).sort(), ["0", "1", "2", "3"]);
    assert.ok(!Object.keys(c.roster).some(slot => Number(slot) >= 4), "no reserve slots are spawned");

    const count = ctx.acceptedSpawns.length;
    ctx.Game.time += 10;
    delete ctx.Game._crossGarrisonUnits;
    ctx.CrossShardGarrison.exec();
    assert.equal(ctx.acceptedSpawns.length, count, "occupied slots and active scout must not be duplicated");
    assert.deepEqual(Object.keys(c.roster).sort(), ["0", "1", "2", "3"]);
}

// 4. A near-expiry deployed cohort is refreshed as one four-member wave, not
// as an isolated highway replacement. New tasks occupy slots 0-3 together.
{
    const ctx = load({shard: "shard3", spawnCount: 4});
    const names = ["old0", "old1", "old2", "old3"];
    const c = cfg(ctx, {
        wave: 7,
        squad: 6,
        remote: freshRemote({
            members: memberRecords(names, [750, 750, 750, 750], 7),
            scoutTtl: 500,
        }),
        roster: Object.fromEntries(names.map((name, slot) => [slot, {name, tick: 99000, wave: 7}])),
    });
    ctx.CrossShardGarrison.exec();
    const refreshed = ctx.acceptedSpawns.filter(call => !call.isScout);
    assert.equal(refreshed.length, 4, "expiry refreshes the complete 2x2 unit");
    assert.deepEqual(refreshed.map(call => call.tasks[0].slot), [0, 1, 2, 3]);
    assert.ok(refreshed.every(call => call.tasks[0].wave === c.wave && call.tasks[0].wave !== 7),
        "all replacement slots share one new wave ID");
    assert.deepEqual(Object.keys(c.roster).sort(), ["0", "1", "2", "3"]);
    for (const call of refreshed) {
        const slot = call.tasks[0].slot;
        assertRoleBody(ctx, Array.from(call.body), slot, "refreshed slot " + slot);
        assert.deepEqual({...call.tasks[1].data}, boostMapForSlot(ctx, slot));
    }
    assert.equal(ctx.CrossShardGarrison.squad(c), 4);
}

function makePortalContext(options = {}) {
    const remote = Object.hasOwn(options, "remote") ? options.remote : freshRemote();
    const landing = Object.hasOwn(options, "landing")
        ? options.landing
        : {observedAt: Date.now(), room: "W30N50", clear: true};
    const ctx = load({shard: "shard3"});
    const c = cfg(ctx, {remote, landing, wave: 1});
    const portal = {
        id: "portal-1",
        pos: {roomName: "W30N50", x: 30, y: 8},
        destination: {shard: "shard2", room: "W30N50"},
    };
    return {ctx, c, portal};
}

function portalTask(roomName = "W31N51", kind = "member", slot = 0, wave = 1) {
    return {roomName, slot, wave, garrisonPortal: {roomName, kind, slot, wave}};
}

function fullMember(ctx, name, slot = 0) {
    const garrisonTask = {taskName: "crossShardGarrison", roomName: "W31N51", slot, wave: 1};
    return {name, body: boostedT3Body(ctx, slot), memory: {tasks: [garrisonTask]}};
}

// 5. Member portal entry fails closed on missing/stale/closed plans, stale or
// armed landing reports, wrong landing room/portal, and incomplete boosts.
{
    const {ctx, portal} = makePortalContext({remote: undefined});
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "missing"), portalTask(), portal), false);
}
{
    const {ctx, portal} = makePortalContext({
        remote: freshRemote({open: true, observedAt: Date.now() - 200000}),
    });
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "stale"), portalTask(), portal), false);
}
{
    const {ctx, portal} = makePortalContext({remote: freshRemote({open: false})});
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "closed"), portalTask(), portal), false);
}
{
    const {ctx, portal} = makePortalContext({
        landing: {observedAt: Date.now() - 100000, room: "W30N50", clear: true},
    });
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "stale-clear"), portalTask(), portal), false);
}
{
    const {ctx, portal} = makePortalContext({
        landing: {observedAt: Date.now(), room: "W30N50", clear: false},
    });
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "armed-clear"), portalTask(), portal), false);
}
{
    const {ctx, portal} = makePortalContext({
        landing: {observedAt: Date.now(), room: "W31N51", clear: true},
    });
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "wrong-clear-room"), portalTask(), portal), false);
}
{
    const {ctx, portal} = makePortalContext();
    const wrongRoom = {...portal, destination: {...portal.destination, room: "W31N51"}};
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "wrong-portal-room"), portalTask(), wrongRoom), false);
    const wrongShard = {...portal, destination: {...portal.destination, shard: "shard1"}};
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "wrong-portal-shard"), portalTask(), wrongShard), false);
    const partial = {name: "partial", body: [{type: ctx.MOVE, boost: "XZHO2", hits: 100}]};
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(partial, portalTask(), portal), false);
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(fullMember(ctx, "wrong-role", 1),
        portalTask("W31N51", "member", 0), portal), false, "healer setup cannot occupy an RA slot");
    const underBoosted = fullMember(ctx, "under-boosted", 0);
    underBoosted.body.find(p => p.type === ctx.TOUGH).boost = "GHO2";
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(underBoosted, portalTask(), portal), false,
        "one missing same-slot T3 boost blocks portal entry");
}

// 6. The target scout reports an unsafe armed landing and cannot report from
// an unexpected room. The origin accepts only a clear report for the pinned
// landing room, which is then required for member entry.
{
    const target = load({shard: "shard2"});
    const armed = {
        name: "armed-landing-hostile",
        body: [{type: "ranged_attack", hits: 100}],
        getActiveBodyparts(type) { return type === target.RANGED_ATTACK ? 1 : 0; },
    };
    const room = {
        name: "W30N50",
        controller: {},
        getHostileCreeps() { return [armed]; },
        find() { return []; },
    };
    const task = {
        roomName: "W31N51", originShard: "shard3", targetShard: "shard2",
        landingRoom: "W30N50",
    };
    target.CrossShardGarrison.scout({room, ticksToLive: 1000}, task);
    const unsafeFrame = target.ManagerCrossShard.calls[0].mission.data;
    assert.equal(unsafeFrame.landingRoom, "W30N50");
    assert.equal(unsafeFrame.clear, false, "armed hostile makes the landing report unsafe");

    const source = load({shard: "shard3"});
    const c = cfg(source);
    assert.equal(source.CrossShardGarrison.receivePlan({...unsafeFrame, roomName: c.roomName}, true), true);
    const portal = {
        id: "portal-1", pos: {roomName: "W30N50", x: 30, y: 8},
        destination: {shard: "shard2", room: "W30N50"},
    };
    assert.equal(source.CrossShardGarrison.canEnterPortal(fullMember(source, "unsafe"), portalTask(), portal), false);
    assert.equal(source.CrossShardGarrison.receivePlan({
        ...unsafeFrame, roomName: c.roomName, landingRoom: "W30N51", clear: true,
    }, true), false, "origin rejects a clear report from the wrong landing room");

    const wrongRoom = load({shard: "shard2"});
    const wrongTask = {...task, landingRoom: "W30N50"};
    wrongRoom.CrossShardGarrison.scout({
        room: {...room, name: "W30N51"},
        ticksToLive: 1000,
    }, wrongTask);
    assert.equal(wrongRoom.ManagerCrossShard.calls.length, 0, "scout in an unexpected room sends no landing report");
}

// 7. A scout may enter before the member-clear report exists, but only through
// the same live, verified shard+room portal configured for this garrison.
{
    const {ctx, portal} = makePortalContext({landing: undefined});
    const scout = {name: "scout", body: [{type: ctx.MOVE, hits: 100}]};
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(scout, portalTask("W31N51", "scout"), portal), true);
    const wrongRoom = {...portal, destination: {...portal.destination, room: "W31N51"}};
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(scout, portalTask("W31N51", "scout"), wrongRoom), false);
    const wrongShard = {...portal, destination: {...portal.destination, shard: "shard1"}};
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(scout, portalTask("W31N51", "scout"), wrongShard), false);
    const stale = {...portal};
    ctx.Memory.crossShardGarrisons.W31N51.remote = freshRemote({
        open: true, observedAt: Date.now() - 200000,
    });
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(scout, portalTask("W31N51", "scout"), stale), false);
}

// 8. Portal occupancy permits one distinct creep per portal per tick, allows
// retries by that same creep, and resets on the next simulated tick.
{
    const {ctx, portal} = makePortalContext();
    const a = fullMember(ctx, "member-a", 0), b = fullMember(ctx, "member-b", 1);
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(a, portalTask("W31N51", "member", 0), portal), true);
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(a, portalTask("W31N51", "member", 0), portal), true,
        "same creep can retry its own hop");
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(b, portalTask("W31N51", "member", 1), portal), false,
        "second creep cannot share this tick's portal");
    ctx.Game.time += 1;
    ctx.Game._garrisonPortalUsed = {};
    assert.equal(ctx.CrossShardGarrison.canEnterPortal(b, portalTask("W31N51", "member", 1), portal), true,
        "portal can accept the next tick");
}

function combatRoom(ctx, {safeMode = 0, hostiles = []} = {}) {
    const exits = [{x: 49, y: 25, roomName: "W31N55"}];
    return {
        name: "W31N51",
        controller: {my: true, safeMode, pos: {x: 10, y: 10, roomName: "W31N51"}},
        tower: [],
        getHostileCreeps() { return hostiles; },
        find(type) {
            if (type === ctx.RIGHT) return exits;
            if (type === ctx.FIND_STRUCTURES) return [];
            if (type === ctx.FIND_CREEPS) return Object.values(ctx.Game.creeps).filter(c => c.room === this);
            if (type === ctx.FIND_HOSTILE_POWER_CREEPS || type === ctx.FIND_HOSTILE_STRUCTURES) return [];
            return [];
        },
    };
}

function combatCreep(ctx, room, name, slot, pos, {heal = false, hits = 1000, hitsMax = 1000} = {}) {
    const body = [{type: ctx.RANGED_ATTACK, hits: 100}];
    if (heal) body.push({type: ctx.HEAL, boost: "XLHO2", hits: 100});
    const actions = [];
    const task = {
        taskName: "crossShardGarrison", roomName: "W31N51", garrisonRoom: "W31N51",
        slot, originShard: "shard3", targetShard: "shard2",
    };
    return {
        name, room, body, task, actions,
        hits, hitsMax, ticksToLive: 1200, spawning: false,
        pos: {x: pos[0], y: pos[1], roomName: room.name},
        memory: {tasks: [task]},
        getActiveBodyparts(type) {
            return body.filter(p => p.type === type && p.hits > 0).length;
        },
        heal(target) { actions.push(["heal", target.name]); },
        rangedHeal(target) { actions.push(["rangedHeal", target.name]); },
        rangedAttack(target) { actions.push(["rangedAttack", target.name]); },
        moveTo(target, options) { actions.push(["moveTo", target.x, target.y, options]); },
    };
}

function hostile(ctx, name, x, y, {heal = false, hits = 5000, hitsMax = 5000} = {}) {
    const body = [{type: ctx.RANGED_ATTACK, hits: 100}];
    if (heal) body.push({type: ctx.HEAL, boost: "XLHO2", hits: 100});
    return {
        name, id: name, hits, hitsMax, body,
        pos: {x, y, roomName: "W31N51"},
        getActiveBodyparts(type) {
            return body.filter(p => p.type === type && p.hits > 0).length;
        },
    };
}

function installCombatCrew(ctx, room, members) {
    ctx.Game.rooms.W31N51 = room;
    ctx.Game.creeps = Object.fromEntries(members.map(c => [c.name, c]));
}

// 9. A single cached combat frame gives all members the same in-range focus;
// paired healers split two comparable patients, and members do not chase a
// hostile outside the covered firing area.
{
    const ctx = load({shard: "shard2"});
    cfg(ctx, {anchor: {x: 25, y: 25}, squad: 6});
    const enemy = hostile(ctx, "enemy", 27, 25);
    const room = combatRoom(ctx, {hostiles: [enemy]});
    const posts = [[25, 25], [25, 26], [26, 25], [26, 26]];
    const members = [
        combatCreep(ctx, room, "g0", 0, posts[0], {heal: true}),
        combatCreep(ctx, room, "g1", 1, posts[1], {heal: true}),
        combatCreep(ctx, room, "g2", 2, posts[2], {hits: 760}),
        combatCreep(ctx, room, "g3", 3, posts[3], {hits: 800}),
    ];
    installCombatCrew(ctx, room, members);

    const frame = ctx.CrossShardGarrison.combatFrame(room);
    assert.equal(frame.slots.length, 4, "combat formation has no reserve slots");
    assert.deepEqual(Array.from(frame.posts.slice(0, 4), p => [p.x, p.y]), posts);
    assert.equal(frame.formed, true);
    assert.equal(frame.focus, enemy);
    assert.equal(ctx.CrossShardGarrison.towerFocus(room), enemy, "tower and member focus share the same frame");
    assert.equal(frame.heal.get("g0").patient.name, "g2");
    assert.equal(frame.heal.get("g1").patient.name, "g3");
    assert.equal(frame.heal.get("g0").direct, true);
    assert.equal(frame.heal.get("g1").direct, true);

    for (const member of members) ctx.CrossShardGarrison.defend(member, member.task);
    const shots = members.flatMap(c => c.actions.filter(a => a[0] === "rangedAttack"));
    assert.equal(shots.length, 4);
    assert.ok(shots.every(a => a[1] === enemy.name), "all four slots concentrate on the one shared focus");
    assert.ok(members[0].actions.some(a => a[0] === "heal" && a[1] === "g2"));
    assert.ok(members[1].actions.some(a => a[0] === "heal" && a[1] === "g3"));

    const distant = hostile(ctx, "distant", 40, 40);
    const tower = {my: true, pos: {x: 25, y: 25, roomName: "W31N51"}, store: {energy: 1000}};
    const noChaseRoom = combatRoom(ctx, {hostiles: [distant]});
    noChaseRoom.tower = [tower];
    const noChase = posts.map((pos, slot) => combatCreep(ctx, noChaseRoom, "still" + slot, slot,
        slot === 0 ? [20, 20] : pos));
    installCombatCrew(ctx, noChaseRoom, noChase);
    const noChaseFrame = ctx.CrossShardGarrison.combatFrame(noChaseRoom);
    assert.equal(noChaseFrame.focus, undefined, "out-of-range threats are not selected for pursuit");
    for (const member of noChase) ctx.CrossShardGarrison.defend(member, member.task);
    for (const member of noChase) {
        assert.ok(!member.actions.some(a => a[0] === "rangedAttack"), "garrison does not attack a distant target");
        for (const action of member.actions.filter(a => a[0] === "moveTo")) {
            const post = noChaseFrame.posts[member.task.slot];
            assert.deepEqual([action[1], action[2]], [post.x, post.y], "movement only returns to the member's assigned post");
            assert.ok(Math.max(Math.abs(action[1] - tower.pos.x), Math.abs(action[2] - tower.pos.y)) <= 7,
                "hold movement remains within tower coverage");
        }
    }
}

// 10. In Safe Mode, an out-of-position member still assembles at its assigned
// post, while armed visible hostiles are suppressed from focus/attack actions.
{
    const ctx = load({shard: "shard2"});
    cfg(ctx, {anchor: {x: 25, y: 25}, squad: 4});
    const enemy = hostile(ctx, "safe-mode-hostile", 26, 25);
    const room = combatRoom(ctx, {safeMode: 500, hostiles: [enemy]});
    const members = [
        combatCreep(ctx, room, "g0", 0, [20, 20]),
        combatCreep(ctx, room, "g1", 1, [20, 21]),
        combatCreep(ctx, room, "g2", 2, [20, 22]),
        combatCreep(ctx, room, "g3", 3, [20, 23]),
    ];
    installCombatCrew(ctx, room, members);
    const frame = ctx.CrossShardGarrison.combatFrame(room);
    assert.equal(frame.armed.length, 0, "Safe Mode suppresses hostile combat planning");
    assert.equal(frame.focus, undefined);
    assert.equal(frame.formed, false);

    ctx.CrossShardGarrison.defend(members[0], members[0].task);
    assert.ok(members[0].actions.some(a => a[0] === "moveTo"
        && a[1] === frame.posts[0].x && a[2] === frame.posts[0].y),
    "Safe Mode does not disable formation assembly");
    assert.ok(!members[0].actions.some(a => a[0] === "rangedAttack"), "no attack intent while the frame is safe");
}

function transitCreep(ctx, room, name, slot, pos, wave = 4) {
    const task = {
        taskName: "crossShardGarrison", roomName: "W31N51", garrisonRoom: "W31N51",
        slot, wave, originShard: "shard3", targetShard: "shard2",
        homeRoom: "W31N55", landingRoom: "W30N50",
        originRoute: ["W31N55", "W30N50"], landingRoute: ["W30N50", "W30N51", "W31N51"],
        portalPath: [{shard: "shard3", roomName: "W30N50", x: 30, y: 8}],
    };
    const actions = [];
    const body = boostedT3Body(ctx, slot);
    const creepPos = new ctx.RoomPosition(pos.x, pos.y, room.name);
    return {
        name, room, pos: creepPos, body, task, actions,
        spawning: false, fatigue: 0, ticksToLive: 1200, hits: 10000, hitsMax: 10000,
        memory: {tasks: [task]},
        getActiveBodyparts(type) { return body.filter(p => p.type === type && p.hits > 0).length; },
        lastTask() { return task; },
        moveTo(target, options) { actions.push(["moveTo", target.x, target.y, target.roomName, options]); },
        move(direction) { actions.push(["move", direction]); },
        addTask(next) { actions.push(["addTask", next]); return this; },
        execLastTask() { actions.push(["execLastTask"]); return this; },
    };
}

// 11. Three members may assemble locally but never independently begin the
// origin route or portal transit. Once all four are in a 2x2, one shared
// direction step is issued for the entire cohort at most once per tick.
{
    const ctx = load({shard: "shard3"});
    const c = cfg(ctx, {
        wave: 4,
        remote: freshRemote({members: [], scoutTtl: 500}),
        originRoute: ["W31N55", "W30N50"],
    });
    const room = ctx.Game.rooms.W31N55;
    room.find = function (type) {
        if (type === ctx.RIGHT) return [{x: 49, y: 25, roomName: this.name}];
        if (type === ctx.FIND_CREEPS) return Object.values(ctx.Game.creeps).filter(creep => creep.room === this);
        if (type === ctx.FIND_STRUCTURES) return [];
        return [];
    };
    ctx.Game.map.findExit = () => ctx.RIGHT;
    const posts = [[25, 25], [25, 26], [26, 25], [26, 26]];
    const firstThree = posts.slice(0, 3).map((pos, slot) =>
        transitCreep(ctx, room, "partial" + slot, slot,
            slot === 0 ? {x: 20, y: 20} : {x: pos[0], y: pos[1]}));
    ctx.Game.creeps = Object.fromEntries(firstThree.map(creep => [creep.name, creep]));
    let groupMoves = 0, squareChecks = 0;
    ctx.WarCache = {getMoveAbleCostMatrix() { return {}; }};
    ctx.WarTeamCore = {action: {
        team4checkSquarePos({ _creeps }) {
            squareChecks++;
            assert.equal(_creeps.length, 4, "only a complete four-member cohort can make a square step");
            return true;
        },
        moveByDirection({ _creeps, _direction }) {
            groupMoves++;
            assert.equal(_creeps.length, 4);
            return true;
        },
    }};

    ctx.CrossShardGarrison.defend(firstThree[0], firstThree[0].task);
    assert.equal(groupMoves, 0, "partial cohort may not travel as a group");
    assert.equal(ctx.PathFinder.calls.length, 0, "partial cohort does not path toward a portal");
    assert.ok(firstThree[0].actions.some(a => a[0] === "moveTo" && a[3] === room.name),
        "partial cohort may only reposition to its local muster post");
    assert.ok(!firstThree[0].actions.some(a => a[0] === "addTask" || a[0] === "execLastTask"),
        "partial cohort does not start the cross-shard movement task");

    firstThree[0].pos.x = 25;
    firstThree[0].pos.y = 25;
    firstThree[0].actions.length = 0;
    const fourth = transitCreep(ctx, room, "partial3", 3, {x: posts[3][0], y: posts[3][1]});
    ctx.Game.creeps[fourth.name] = fourth;
    ctx.Game._crossGarrisonUnits = {};
    ctx.CrossShardGarrison.defend(firstThree[0], firstThree[0].task);
    for (const member of [firstThree[1], firstThree[2], fourth]) {
        ctx.CrossShardGarrison.defend(member, member.task);
    }
    assert.equal(groupMoves, 1, "complete cohort advances with one shared direction intent per tick");
    assert.equal(squareChecks, 1);
    assert.equal(ctx.PathFinder.calls.length, 1);
    assert.ok([firstThree[0], firstThree[1], firstThree[2], fourth]
        .every(member => !member.actions.some(a => a[0] === "moveTo")),
    "coordinated route step does not fall back to independent creep movement");
}

// 12. The preferred anchor is only a hint: all four posts should fire on
// the mirrored gate even if the nearest square (or road-free one) cannot.
{
    const ctx = load({shard: "shard2"});
    cfg(ctx, {entryGate: {x: 0, y: 18}, entryAnchor: {x: 45, y: 18}});
    const enemy = hostile(ctx, "at-the-border", 49, 18);
    const room = combatRoom(ctx, {hostiles: [enemy]});
    const tower = {my: true, pos: {x: 43, y: 33, roomName: room.name}, store: {energy: 600},
        getDamageTo() { return 300; }};
    room.tower = [tower];
    const members = [[46,18],[46,19],[47,18],[47,19]]
        .map((pos, slot) => combatCreep(ctx, room, "entry" + slot, slot, pos));
    installCombatCrew(ctx, room, members);
    const frame = ctx.CrossShardGarrison.combatFrame(room);
    assert.ok(frame.posts.every(p => Math.max(49 - p.x, Math.abs(18 - p.y)) <= 3),
        "stationary posts prefer a full volley at the entry, not a specific side of the anchor");
    assert.equal(frame.focus, enemy);
    assert.equal(ctx.CrossShardGarrison.towerFocus(room), enemy);
    members.forEach(c => ctx.CrossShardGarrison.defend(c, c.task));
    assert.ok(members.every(c => c.actions.some(a => a[0] === "rangedAttack" && a[1] === enemy.name)),
        "all four members can fire as soon as the creep appears on the entry tile");
}

// 13. Do not file into a neutral post-portal leg without current vision,
// and recheck it even after a shared crossing record has been set.
{
    const ctx = load({shard: "shard2"});
    cfg(ctx);
    const makeRoom = (name, hostiles = []) => {
        const room = combatRoom(ctx, {hostiles});
        room.name = name;
        room.controller = undefined;
        return room;
    };
    const landing = makeRoom("W30N50");
    ctx.Game.rooms[landing.name] = landing;
    ctx.Game.map.findExit = () => ctx.RIGHT;
    const crew = [[47,25],[47,26],[48,25],[48,26]].map(([x,y],slot) =>
        transitCreep(ctx,landing,"landed"+slot,slot,{x,y}));
    const scout = transitCreep(ctx,landing,"scout",null,{x:45,y:25});
    scout.task.taskName = "crossShardGarrisonScout";
    scout.pos.findClosestByRange = () => new ctx.RoomPosition(49,25,landing.name);
    const next = "W30N51";
    ctx.Game.creeps = Object.fromEntries([...crew.slice(0,3),scout].map(c => [c.name,c]));
    ctx.CrossShardGarrison.scout(scout,scout.task);
    assert.equal(scout.actions.length,0,"landing scout stays until all four slots have landed");
    ctx.Game.creeps[crew[3].name] = crew[3];
    ctx.Game._crossGarrisonUnits = {};
    ctx.CrossShardGarrison.scout(scout,scout.task);
    assert.equal(scout.actions[0]?.[0],"moveTo","scout advances to observe the next leg");

    ctx.CrossShardGarrison.travel(crew[0],crew[0].task,true);
    assert.equal(crew[0].task.roomExit,undefined,"no vision means no crossing");
    ctx.Game.rooms[next] = makeRoom(next,[hostile(ctx,"armed",7,39)]);
    ctx.CrossShardGarrison.travel(crew[0],crew[0].task,true);
    assert.equal(crew[0].task.roomExit,undefined,"a visible but armed leg stays closed");
    ctx.Game.rooms[next] = makeRoom(next);
    ctx.CrossShardGarrison.travel(crew[0],crew[0].task,true);
    assert.equal(crew[0].task.roomExit?.to,next,"clear live vision lets the square cross");
    assert.equal(crew[0].actions[0]?.[0],"moveTo");

    delete ctx.Game.rooms[next];
    ctx.CrossShardGarrison.travel(crew[1],crew[1].task,true);
    assert.equal(crew[1].actions.length,0,"a started crossing does not skip the next-tick check");
}

// 14. Boost expiry or a superseded wave can replace a task with recycling
// after ensure() populated the per-tick candidate list. Other creep handlers
// in that tick must ignore the stale assignments instead of throwing.
{
    const ctx = load({shard: "shard3"});
    const c = cfg(ctx, {wave: 4, remote: freshRemote({scoutTtl: 500})});
    const room = ctx.Game.rooms[c.spawnRoom];
    room.find = () => [];
    const crew = [[25,25],[25,26],[26,25],[26,26]].map(([x,y],slot) =>
        transitCreep(ctx,room,"cached"+slot,slot,{x,y}));
    const garrison = ctx.CrossShardGarrison;
    ctx.Game.creeps = Object.fromEntries(crew.map(c => [c.name,c]));
    assert.equal(garrison.units(c.roomName).length,4);
    crew[0].memory.tasks.splice(0,1,{taskName:"recycleCreep"});
    crew[1].memory.tasks = [];
    assert.doesNotThrow(() => garrison.travel(crew[2],crew[2].task,false));
    assert.equal(garrison.units(c.roomName).length,2);
    assert.equal(ctx.PathFinder.calls.length,0,"remaining pair cannot advance independently");
}

// 15. StationLab deletes completed compounds from the actual task data.
// Neither another creep of the same role nor the next wave may share it.
{
    const ctx = load({shard: "shard3", spawnCount: 4});
    const c = cfg(ctx, {remote: freshRemote({scoutTtl: 500})});
    const garrison = ctx.CrossShardGarrison;
    garrison.ensure(c);
    assert.equal(ctx.acceptedSpawns.length,4);
    const data = ctx.acceptedSpawns.map(s => s.tasks[1].data);
    for (const k of Object.keys(data[0])) delete data[0][k];
    for (const k of Object.keys(data[1])) delete data[1][k];
    assert.deepEqual({...data[2]},boostMapForSlot(ctx,2));
    assert.deepEqual({...data[3]},boostMapForSlot(ctx,3));
    ctx.Game.creeps = {};
    ctx.Game.time += 100;
    delete ctx.Game._crossGarrisonUnits;
    c.remote = freshRemote({scoutTtl: 500});
    for (const spawn of ctx.Game.rooms[c.spawnRoom].spawn) spawn.spawning = null;
    garrison.ensure(c);
    assert.equal(ctx.acceptedSpawns.length,8,"subsequent spawns still receive complete T3 recipes");
}

// 16. All fighter slots can be covered at origin while a dead (or expiring)
// scout leaves the portal closed. Refresh vision without spawning any fighters.
{
    const ctx = load({shard: "shard3"});
    const c = cfg(ctx, {wave: 4, remote: freshRemote({scoutTtl: 20})});
    const room = ctx.Game.rooms[c.spawnRoom];
    const members = [[25,25],[25,26],[26,25],[26,26]].map(([x,y],slot) =>
        transitCreep(ctx,room,"awaiting-portal-"+slot,slot,{x,y}));
    ctx.Game.creeps = Object.fromEntries(members.map(c => [c.name,c]));
    ctx.CrossShardGarrison.ensure(c);
    assert.equal(ctx.acceptedSpawns.length,1);
    assert.equal(ctx.acceptedSpawns[0].isScout,true);
}

// 17. The W31N55 exit has legal squares on the far side of a one-tile
// chokepoint. Keeping the old edge goals strands a perfectly formed crew.
{
    const ctx = load({shard: "shard3"});
    const c = cfg(ctx, {wave: 4, remote: freshRemote({scoutTtl: 500})});
    const room = ctx.Game.rooms[c.spawnRoom];
    const exit = x => new ctx.RoomPosition(x,0,room.name);
    room.find = t => t===ctx.TOP ? [exit(38),exit(41)] : [];
    room.getHostileCreeps = () => [];
    ctx.Game.map.findExit = () => ctx.TOP;
    ctx.Game.map.getRoomTerrain = () => ({get:(x,y)=>y===3&&x!==38?ctx.TERRAIN_MASK_WALL:0});
    ctx.WarCache = {getMoveAbleCostMatrix() {return {};}};
    const crew = [[2,14],[2,15],[3,14],[3,15]].map(([x,y],slot) =>
        transitCreep(ctx,room,"north-gate-"+slot,slot,{x,y}));
    for (const m of crew) m.task.originRoute = [room.name,"W31N56","W30N56"];
    ctx.Game.creeps = Object.fromEntries(crew.map(m=>[m.name,m]));
    ctx.CrossShardGarrison.travel(crew[0],crew[0].task,false);
    const goals = ctx.PathFinder.calls[0].goals;
    assert.deepEqual(Array.from(goals,g=>[g.pos.x,g.pos.y]),[[37,4]],"target the reachable side while in formation");
    assert.ok(crew.every(m=>!m.task.roomExit),"no individual movement until the squad reaches staging");
    crew.forEach((m,i)=>{m.pos.x=37+Math.floor(i/2);m.pos.y=4+i%2;});
    for (const m of crew) ctx.CrossShardGarrison.travel(m,m.task,false);
    assert.ok(crew.every(m=>m.task.roomExit?.to==="W31N56"&&m.task.roomExit.exit.x===38));
    assert.ok(crew.every(m=>m.actions.some(a=>a[0]==="moveTo"&&a[1]===38&&a[2]===0)));
}

// 18. A wave split across two origin-route rooms must walk back together.
// Every subset used to muster in its own room forever (forward half waiting
// for four, trailing half waiting for four), so the wave aged out in place
// without ever reaching the portal. Laggards now walk one room forward, but
// only while the next room is clear and only when someone is already ahead.
{
    const build = ({armed = false} = {}) => {
        const ctx = load({shard: "shard3"});
        const c = cfg(ctx, {wave: 4, remote: freshRemote({scoutTtl: 500})});
        const home = ctx.Game.rooms[c.spawnRoom];
        home.find = type => {
            if (type === ctx.TOP) return [new ctx.RoomPosition(38, 0, home.name)];
            if (type === ctx.FIND_CREEPS) return Object.values(ctx.Game.creeps).filter(e => e.room === home);
            return [];
        };
        home.getHostileCreeps = () => [];
        const north = {
            name: "W31N56", controller: undefined,
            find(type) {
                if (type === ctx.FIND_CREEPS) return Object.values(ctx.Game.creeps).filter(e => e.room === north);
                if (type === ctx.FIND_HOSTILE_CREEPS) return armed ? [hostile(ctx, "camp-north", 41, 46)] : [];
                return [];
            },
        };
        ctx.Game.rooms[north.name] = north;
        ctx.Game.map.findExit = () => ctx.TOP;
        const route = ["W31N55", "W31N56", "W30N56"];
        const rear = [[2, 15], [3, 15]].map(([x, y], i) =>
            transitCreep(ctx, home, "rear" + i, [1, 3][i], {x, y}));
        const front = [[41, 47], [42, 47]].map(([x, y], i) =>
            transitCreep(ctx, north, "front" + i, [0, 2][i], {x, y}));
        for (const m of [...rear, ...front]) {
            m.task.originRoute = route;
            m.task.roomExit = undefined;
        }
        ctx.Game.creeps = Object.fromEntries([...rear, ...front].map(m => [m.name, m]));
        return {ctx, home, north, rear, front};
    };

    // A. Split 2/2: the trailing pair walks to the W31N55 north gate, the
    // forward pair holds its muster post and never paths on its own.
    {
        const {ctx, rear, front} = build();
        for (const m of rear) ctx.CrossShardGarrison.travel(m, m.task, false);
        assert.ok(rear.every(m => m.actions.some(a => a[0] === "moveTo" && a[1] === 38 && a[2] === 0)),
            "laggards walk the one room that separates them from the wave");
        assert.equal(ctx.PathFinder.calls.length, 0, "rejoining is a plain border walk, not a route harvest");
        for (const m of front) ctx.CrossShardGarrison.travel(m, m.task, false);
        assert.ok(front.every(m => m.actions.length === 0),
            "the forward half keeps mustering at 41,47/42,47 instead of running ahead");
    }

    // B. An armed camper in the next room stops the walk one border short.
    {
        const {ctx, rear} = build({armed: true});
        for (const m of rear) ctx.CrossShardGarrison.travel(m, m.task, false);
        assert.ok(rear.every(m => !m.actions.some(a => a[0] === "moveTo" && a[1] === 38 && a[2] === 0)),
            "never file a partial squad into an armed room");
        assert.ok(rear.every(m => m.actions.length === 0), "they hold their own muster post instead");
    }

    // C. Nobody ahead on the route: a squad that never left home still may
    // not start the origin route by itself.
    {
        const {ctx, home, front} = build();
        for (const m of [front[0], front[1]]) {
            m.room = home;
            m.pos = new ctx.RoomPosition(m.pos.x === 41 ? 2 : 3, 14, home.name);
        }
        for (const m of front) ctx.CrossShardGarrison.travel(m, m.task, false);
        assert.ok(front.every(m => !m.actions.some(a => a[0] === "moveTo" && a[1] === 38 && a[2] === 0)),
            "a same-room squad regroups locally, it does not begin the route");
    }
}

// 19. The landing leg has the same split-squad deadlock. A wave that crossed
// the portal together can still lose one member at the next border: the three
// who crossed muster in the next room waiting for four, the laggard musters in
// the landing room waiting for four, and `garrisonMuster` never crosses a
// border. The origin-side rejoin step was gated to the origin shard, so the
// wave aged out two rooms short of the target (2026-11-28 live: slots 0/1/2 at
// W30N51 (12,47)+, slot 3 alone at W30N50 (16,3), no movement for ~900 ticks).
{
    const build = ({armed = false, allHome = false} = {}) => {
        const ctx = load({shard: "shard2"});
        const c = cfg(ctx, {wave: 4, remote: freshRemote({scoutTtl: 500})});
        const landing = {
            name: "W30N50", controller: undefined,
            find(type) {
                if (type === ctx.FIND_CREEPS) return Object.values(ctx.Game.creeps).filter(e => e.room === landing);
                if (type === ctx.FIND_HOSTILE_CREEPS) return [];
                return [];
            },
        };
        const next = {
            name: "W30N51", controller: undefined,
            find(type) {
                if (type === ctx.FIND_CREEPS) return Object.values(ctx.Game.creeps).filter(e => e.room === next);
                if (type === ctx.FIND_HOSTILE_CREEPS) return armed ? [hostile(ctx, "camp-next", 20, 20)] : [];
                return [];
            },
        };
        ctx.Game.rooms[landing.name] = landing;
        ctx.Game.rooms[next.name] = next;
        ctx.Game.map.findExit = () => ctx.RIGHT;
        const lag = transitCreep(ctx, landing, "lag", 3, {x: 16, y: 3});
        const front = [[12, 47], [12, 48], [13, 47]].map(([x, y], i) =>
            transitCreep(ctx, next, "front" + i, [0, 1, 2][i], {x, y}));
        for (const m of [lag, ...front]) {
            m.task.originRoute = ["W31N55", "W31N56", "W30N56"];
            m.task.roomExit = undefined;
            m.pos.findClosestByRange = () => new ctx.RoomPosition(49, 25, m.room.name);
        }
        if (allHome) {
            for (const m of front) {
                m.room = landing;
                m.pos = new ctx.RoomPosition(13 + m.task.slot, 47 + (m.task.slot % 2), landing.name);
            }
        }
        ctx.Game.creeps = Object.fromEntries([lag, ...front].map(m => [m.name, m]));
        return {ctx, landing, next, lag, front};
    };
    // The border walk is a `moveTo` onto the x=49 edge tile plus the crossing
    // `move`; mustering never produces either in these fixtures.
    const crossed = m => m.actions.some(a => a[0] === "move")
        || m.actions.some(a => a[0] === "moveTo" && a[1] === 49);

    // A. The single laggard walks the one room that separates it from the
    // squad; the three already across hold their muster square and never
    // advance on the target room by themselves.
    {
        const {ctx, lag, front} = build();
        ctx.CrossShardGarrison.travel(lag, lag.task, true);
        assert.ok(crossed(lag), "the laggard walks to the room the squad already holds");
        assert.equal(ctx.PathFinder.calls.length, 0, "rejoining is a plain border walk, not a route harvest");
        for (const m of front) ctx.CrossShardGarrison.travel(m, m.task, true);
        assert.ok(front.every(m => !crossed(m)),
            "the forward three keep mustering instead of filing into W31N51 alone");
    }

    // B. An armed room stops the walk one border short.
    {
        const {ctx, lag} = build({armed: true});
        ctx.CrossShardGarrison.travel(lag, lag.task, true);
        assert.ok(!crossed(lag), "never walk a lone laggard into an armed room");
    }

    // C. Nobody ahead on the landing route: a squad still all in the landing
    // room regroups locally instead of starting the route by itself.
    {
        const {ctx, lag, front} = build({allHome: true});
        for (const m of [lag, ...front]) ctx.CrossShardGarrison.travel(m, m.task, true);
        assert.ok([lag, ...front].every(m => !crossed(m)),
            "a same-room squad musters, it does not begin the landing route");
    }
}

// 20. A crew that crosses the border far from its post must still walk there.
// `garrisonManeuver` only scores tiles within 6 of the post, and the post
// transfer used to be gated on tower-covered entry posts (`hasEntry`), which a
// room without `entryAnchor` can never have. Four fighters then entered W31N51
// at (49,17), formed a 2x2 at (46,17) and stood there with their post at
// (41,35) — no maneuver tile and no transfer, so nothing ever moved them.
{
    const ctx = load({shard: "shard2"});
    cfg(ctx, {anchor: {x: 25, y: 25}, squad: 4});
    const room = combatRoom(ctx, {hostiles: []});
    const members = [[46, 17], [47, 17], [46, 18], [47, 18]].map(([x, y], slot) =>
        combatCreep(ctx, room, "far" + slot, slot, [x, y]));
    for (const m of members) m.body.push({type: ctx.MOVE, hits: 100});
    installCombatCrew(ctx, room, members);
    const directions = [];
    ctx.WarCache = {getMoveAbleCostMatrix() { return {}; }};
    ctx.WarTeamCore = {
        action: {
            team4checkSquarePos: () => true,
            moveByDirection: ({_direction}) => { directions.push(_direction); return true; },
        },
    };

    const frame = ctx.CrossShardGarrison.combatFrame(room);
    assert.equal(frame.formed, true, "the arriving crew is a legal 2x2");
    assert.ok(frame.transfer, "peacetime: the square walks to its post even without entry posts");
    assert.deepEqual([frame.transfer.post.x, frame.transfer.post.y],
        [frame.posts[0].x, frame.posts[0].y], "the transfer targets the assigned post");

    for (const member of members) ctx.CrossShardGarrison.defend(member, member.task);
    assert.equal(directions.length, 1, "one shared square step per tick, not four individual paths");
    assert.equal(ctx.PathFinder.calls.length, 1, "the whole square shares one path");
}

console.log("cross-shard garrison checks passed");
