const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "station_lab.js"), "utf8");

function coordinates(pos) {
    return pos && pos.pos ? pos.pos : pos;
}

function load() {
    const ctx = {
        console,
        Creep: function () {},
        Room: function () {},
        RoomPosition: null,
        Memory: { rooms: {}, creeps: {} },
        Game: {
            time: 1,
            rooms: {},
            creeps: {},
            cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
            getObjectById: id => (ctx.__objs && ctx.__objs[id]) || null,
        },
        REACTIONS: { U: { H: "G" }, H: { U: "G" }, G: { H: "GH" }, O: { GH: "GH2O" } },
        REACTION_TIME: { G: 5, GH: 10, GH2O: 15 },
        BOOSTS: {},
        BOOST_RES: {},
        LAB_REACTIONS: {},
        CONTROLLER_STRUCTURES: { lab: { 5: 0, 6: 3, 7: 6, 8: 10 } },
        _: {
            keys: o => Object.keys(o || {}),
            values: o => Object.keys(o || {}).map(k => o[k]),
        },
        UtilsTask: { task: () => ({}), taskData: () => ({}) },
        Utils: {
            // Blueprint fixtures use JSON here; production passes the same
            // position list through its normal decoder.
            decodePosArray: encoded => encoded ? JSON.parse(encoded) : [],
        },
        HelperVisual: {},
        HelperError: { catchError: fn => fn() },
        __objs: {},
        __blocked: new Set(),
        __constructionSites: new Set(),
        __createdSites: [],
    };

    for (const k of [
        "OK", "ERR_NOT_ENOUGH_ENERGY", "ERR_NOT_IN_RANGE", "ERR_FULL", "ERR_TIRED",
        "ERR_INVALID_TARGET", "ERR_NOT_ENOUGH_RESOURCES", "ERR_BUSY", "ERR_NO_BODYPART",
        "RESOURCE_ENERGY", "RESOURCE_POWER", "RESOURCE_OPS",
        "WORK", "CARRY", "MOVE", "ATTACK", "HEAL", "RANGED_ATTACK", "TOUGH", "CLAIM",
        "STRUCTURE_LAB", "STRUCTURE_CONTAINER", "STRUCTURE_EXTENSION", "STRUCTURE_STORAGE",
        "STRUCTURE_TERMINAL", "STRUCTURE_SPAWN", "STRUCTURE_TOWER", "STRUCTURE_LINK",
        "STRUCTURE_FACTORY", "STRUCTURE_NUKER", "STRUCTURE_OBSERVER", "STRUCTURE_POWER_SPAWN",
        "STRUCTURE_EXTRACTOR", "STRUCTURE_RAMPART", "STRUCTURE_WALL",
        "FIND_STRUCTURES", "FIND_MY_STRUCTURES", "FIND_CREEPS", "FIND_MY_CREEPS",
        "FIND_DROPPED_RESOURCES", "FIND_MINERALS", "FIND_TOMBSTONES",
        "LOOK_STRUCTURES", "LOOK_CREEPS", "LOOK_RESOURCES", "LOOK_CONSTRUCTION_SITES",
    ]) ctx[k] = k;

    ctx.STRUCTURE_LAB = "lab";
    ctx.STRUCTURE_CONTAINER = "container";
    ctx.CONTROLLER_STRUCTURES[ctx.STRUCTURE_LAB] = { 5: 0, 6: 3, 7: 6, 8: 10 };
    ctx.RESOURCE_ENERGY = "energy";
    ctx.RESOURCE_POWER = "power";
    ctx.RESOURCE_OPS = "ops";
    ctx.OK = 0;
    ctx.RoomPosition = function (x, y, roomName) {
        return {
            x, y, roomName,
            isNearTo(other) {
                const p = coordinates(other);
                return Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1;
            },
            walkable() { return !ctx.__blocked.has(`${x}:${y}`); },
            lookFor(type) {
                return type === ctx.LOOK_CONSTRUCTION_SITES && ctx.__constructionSites.has(`${x}:${y}`)
                    ? [{}] : [];
            },
            createConstructionSite(type) {
                ctx.__createdSites.push({ x, y, type });
                return ctx.OK;
            },
        };
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_lab.js" });
    return ctx;
}

function pos(ctx, x, y) {
    return {
        x, y,
        isNearTo(other) {
            const p = coordinates(other);
            return Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1;
        },
        inRangeTo(other, range) {
            const p = coordinates(other);
            return Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= range;
        },
    };
}

function lab(ctx, id, x, y, active = true) {
    return { id, pos: pos(ctx, x, y), active, isActive() { return this.active; } };
}

function roomForLabs(ctx, coords, level = 8, memory = {}) {
    const labs = coords.map(([x, y], i) => lab(ctx, `L${String(i).padStart(2, "0")}`, x, y));
    ctx.__objs = Object.fromEntries(labs.map(e => [e.id, e]));
    const room = {
        name: "E55S29",
        my: true,
        level,
        lab: labs,
        container: [],
        memory: {
            autoBuildLabs: true,
            stationLab: {},
            ...memory,
        },
    };
    return { room, labs };
}

const approvedLabs = [
    [15, 16], [16, 16], [14, 18], [14, 17], [15, 17],
    [15, 14], [17, 15], [16, 14], [17, 14], [14, 16],
];

// The approved layout keeps the first adjacent pair as centers as it expands
// from three to six and then ten built labs.
for (const count of [3, 6, 10]) {
    const ctx = load();
    const { room } = roomForLabs(ctx, approvedLabs.slice(0, count), count === 10 ? 8 : 7);
    assert.ok(ctx.StationLab.checkLabs(room), `${count} approved labs should form a reaction layout`);
    assert.deepEqual(Array.from(room.memory.stationLab.centerLabs), ["L00", "L01"]);
    assert.equal(room.memory.stationLab.otherLabs.length, count - 2);
    assert.equal(ctx.__createdSites.length, 0, "explicit lab blueprint without a shared container slot must not auto-place one");
}

// A live container beside both centers is always reused, even in explicit mode.
{
    const ctx = load();
    const { room, labs } = roomForLabs(ctx, approvedLabs.slice(0, 3));
    const container = { id: "existing-container", pos: pos(ctx, 15, 15) };
    room.container.push(container);
    assert.equal(ctx.StationLab.checkUnboostContainer(room, [labs[0].id, labs[1].id]), container);
    assert.equal(ctx.__createdSites.length, 0);
}

// Missing center IDs are rejected before attempting to access their positions.
{
    const ctx = load();
    const { room, labs } = roomForLabs(ctx, approvedLabs.slice(0, 3));
    assert.doesNotThrow(() => ctx.StationLab.checkUnboostContainer(room, ["destroyed", labs[1].id]));
    assert.equal(ctx.__createdSites.length, 0);
}

// Explicit autoBuildLabs mode only creates at a decoded shared container slot.
{
    const ctx = load();
    const { room, labs } = roomForLabs(ctx, approvedLabs.slice(0, 3));
    room.memory.structMap = { container: JSON.stringify([{ x: 16, y: 17 }]) };
    ctx.__blocked.add("15:16");
    ctx.__blocked.add("16:16");
    assert.equal(ctx.StationLab.checkUnboostContainer(room, [labs[0].id, labs[1].id]), undefined);
    assert.deepEqual(ctx.__createdSites.map(({ x, y }) => [x, y]), [[16, 17]]);
}

// Rooms without the explicit opt-in retain legacy automatic placement.
{
    const ctx = load();
    const { room, labs } = roomForLabs(ctx, approvedLabs.slice(0, 3));
    delete room.memory.autoBuildLabs;
    ctx.__blocked.add("15:16");
    ctx.__blocked.add("16:16");
    assert.equal(ctx.StationLab.checkUnboostContainer(room, [labs[0].id, labs[1].id]), undefined);
    assert.deepEqual(ctx.__createdSites.map(({ x, y }) => [x, y]), [[15, 15]]);
}

// With equal-scoring pairs, a previously selected valid pair and its order win.
{
    const ctx = load();
    const clusters = [
        [10, 10], [11, 10], [10, 11],
        [30, 30], [31, 30], [30, 31],
    ];
    const { room } = roomForLabs(ctx, clusters, 8, {
        stationLab: {
            centerLabs: ["L04", "L03"],
            otherLabs: ["L05"],
            _labCheckedTick: 1,
            _labCheckedLevel: 7,
            _labCheckedLabCount: 6,
        },
    });
    ctx.Game.time = 2;
    assert.ok(ctx.StationLab.checkLabs(room));
    assert.deepEqual(Array.from(room.memory.stationLab.centerLabs), ["L04", "L03"]);
}

// Cached ticks do not enumerate room.lab; a scheduled rescan repairs a lost ID,
// and an RCL change bypasses the cache and clears fewer than three active labs.
{
    const ctx = load();
    const { room, labs } = roomForLabs(ctx, approvedLabs, 8);
    assert.ok(ctx.StationLab.checkLabs(room));
    let labGetterReads = 0;
    Object.defineProperty(room, "lab", {
        configurable: true,
        get() { labGetterReads++; return labs; },
    });
    delete ctx.__objs[labs[9].id];
    labs.splice(9, 1);
    ctx.Game.time = 2;
    assert.ok(ctx.StationLab.checkLabs(room), "the cached layout remains available during its throttle window");
    assert.equal(labGetterReads, 0, "a cached tick must return before enumerating room.lab");

    ctx.Game.time = 31;
    assert.ok(ctx.StationLab.checkLabs(room), "the scheduled rescan repairs the destroyed output lab");
    assert.ok(labGetterReads > 0, "the expired cache must enumerate current labs");
    assert.equal(room.memory.stationLab.otherLabs.length, 7);

    room.level = 7;
    labs.forEach((e, i) => { e.active = i < 2; });
    const readsBeforeDowngrade = labGetterReads;
    ctx.Game.time = 32;
    assert.equal(ctx.StationLab.checkLabs(room), false);
    assert.ok(labGetterReads > readsBeforeDowngrade, "an RCL change must bypass the cached layout");
    assert.deepEqual(Array.from(room.memory.stationLab.centerLabs), []);
    assert.deepEqual(Array.from(room.memory.stationLab.otherLabs), []);
    assert.equal(room.memory.stationLab._labCheckedLevel, 7);
}

// Empty-room negative cache also avoids repeatedly filtering an absent lab list.
{
    const ctx = load();
    const { room } = roomForLabs(ctx, [], 8);
    assert.equal(ctx.StationLab.checkLabs(room), false);
    let labGetterReads = 0;
    Object.defineProperty(room, "lab", {
        configurable: true,
        get() { labGetterReads++; return []; },
    });
    ctx.Game.time = 2;
    assert.equal(ctx.StationLab.checkLabs(room), false);
    assert.equal(labGetterReads, 0, "negative cache should avoid repeated empty-room lab scans");
}

// Destroyed center/output labs during a reaction clear state and invalidate the
// layout cache so the following tick can rescan promptly.
for (const missingId of ["L0", "L2"]) {
    const ctx = load();
    const [a, b] = ctx.LAB_REACTIONS.G;
    const makeCenter = (id, res) => ({
        id,
        store: {
            [res]: 3000,
            getLabReactionResType: () => res,
            getLabReactionCnt: () => 3000,
        },
    });
    ctx.__objs = {
        L0: makeCenter("L0", a),
        L1: makeCenter("L1", b),
        L2: { id: "L2", runReaction: () => ctx.OK },
    };
    delete ctx.__objs[missingId];
    ctx.StationLab.checkLabs = () => true;
    ctx.StationLab.needReaction = () => "G";
    ctx.StationLab.checkBoostLabsNeed = () => {};
    const room = {
        name: "E55S29",
        hashCode: () => 1,
        storage: { store: {} },
        terminal: null,
        memory: {
            stationLab: {
                stat: "reacting",
                reacting: "G",
                centerLabs: ["L0", "L1"],
                otherLabs: ["L2"],
                boostLabMap: {},
                _labCheckedTick: 1,
            },
        },
    };
    assert.doesNotThrow(() => ctx.StationLab.exec(room));
    assert.equal(room.memory.stationLab.stat, "clear");
    assert.equal(room.memory.stationLab.reacting, undefined);
    assert.equal(room.memory.stationLab._labCheckedTick, undefined);
}

console.log("station lab layout safety checks passed");
