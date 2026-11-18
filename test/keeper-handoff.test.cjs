// Keeper handoff: a successor may coexist with its incumbent only until it reaches
// an operational mining tile in the intended room.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

const CONSTANTS = {
    OK: 0, ERR_NOT_OWNER: -1, ERR_NO_PATH: -2, ERR_BUSY: -4, ERR_INVALID_TARGET: -7,
    ERR_NOT_IN_RANGE: -9, ERR_NO_BODYPART: -12, ERR_NOT_ENOUGH_ENERGY: -6,
    MOVE: "move", WORK: "work", CARRY: "carry", ATTACK: "attack", HEAL: "heal",
    TOUGH: "tough", RANGED_ATTACK: "ranged_attack", CLAIM: "claim",
    LOOK_STRUCTURES: "structures", LOOK_CREEPS: "creeps",
    STRUCTURE_KEEPER_LAIR: "keeperLair", STRUCTURE_INVADER_CORE: "invaderCore",
    STRUCTURE_RAMPART: "rampart", STRUCTURE_CONTAINER: "container",
    STRUCTURE_EXTENSION: "extension", STRUCTURE_SPAWN: "spawn", STRUCTURE_TOWER: "tower",
    STRUCTURE_STORAGE: "storage", STRUCTURE_TERMINAL: "terminal", STRUCTURE_LINK: "link",
    STRUCTURE_LAB: "lab", STRUCTURE_FACTORY: "factory", STRUCTURE_EXTRACTOR: "extractor",
    STRUCTURE_POWER_BANK: "powerBank", STRUCTURE_POWER_SPAWN: "powerSpawn",
    FIND_HOSTILE_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_STRUCTURES: 103,
    FIND_SOURCES: 104, FIND_MY_STRUCTURES: 105, FIND_SOURCES_ACTIVE: 106,
    FIND_DROPPED_RESOURCES: 107, FIND_TOMBSTONES: 108, FIND_DEPOSITS: 109,
    FIND_STRUCTURES: 110, FIND_CONSTRUCTION_SITES: 111, FIND_MINERALS: 112,
    RESOURCE_ENERGY: "energy", RESOURCE_OPS: "ops", RESOURCE_POWER: "power",
    PWR_REGEN_SOURCE: 13,
};

function loadStation() {
    const ctx = {
        ...CONSTANTS,
        console: { log() {} },
        isSaveCpu: false,
        _: { values: o => Object.keys(o || {}).map(k => o[k]) },
        Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" },
            getObjectById: () => null, creeps: {}, rooms: {}, spawns: {} },
        Memory: { rooms: {} },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { return { x, y, roomName }; },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => "newKeeper" },
        UtilsTask: { task: (t, n) => ({ id: t.id, taskName: n }), taskData: n => ({ taskName: n }) },
        PathFinder: { search: () => ({ path: [0, 1, 2] }) },
        MIN_CPU: false,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_sources.js" });
    return ctx;
}

function pos(roomName, x, y) {
    return {
        roomName, x, y,
        getRangeTo(other) { return Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)); },
    };
}

function makeCreep(id, name, { ttl = 1000, spawning = false, roomName = "W1N1", x = 10, y = 10,
    memory = {} } = {}) {
    return {
        id, name, ticksToLive: spawning ? undefined : ttl, spawning,
        pos: pos(roomName, x, y), memory: { role: "harvestEnergyKeeper", ...memory },
        suicided: false,
        suicide() { this.suicided = true; },
    };
}

function cleanup({ targetRoom = "W1N1", sourceRoom = targetRoom,
    successorRoom = targetRoom, successorX = 10, successorY = 10, successorSpawning = false,
    marked = true, withSuccessor = true } = {}) {
    const ctx = loadStation();
    const S = ctx.StationSources;
    const source = { id: "src1", pos: pos(sourceRoom, 10, 10) };
    const incumbent = makeCreep("inc", "incumbent", {
        ttl: 80, roomName: sourceRoom, x: 11, y: 10,
        memory: marked ? { successorSpawned: true, successorName: "successor" } : {},
    });
    const successor = withSuccessor ? makeCreep("succ", "successor", {
        ttl: 1490, spawning: successorSpawning, roomName: successorRoom,
        x: successorX, y: successorY,
    }) : undefined;
    const data = { id: "src1", container: "container", creeps: withSuccessor ? ["inc", "succ"] : ["inc"] };
    const objects = { src1: source, inc: incumbent, container: { id: "container", pos: pos(sourceRoom, 11, 10) } };
    if (successor) objects.succ = successor;
    ctx.Game.getObjectById = id => objects[id] || null;
    ctx.Memory.rooms[targetRoom] = { [S.stationName]: { src1: data } };
    S.cleanupDuplicateKeepers(targetRoom);
    return { incumbent, successor, data };
}

// Local mine: successor has reached a different source-adjacent tile because the
// incumbent occupies the container. The incumbent can now leave without overlap.
{
    const { incumbent, successor, data } = cleanup({
        targetRoom: "W1N1", sourceRoom: "W1N1", successorRoom: "W1N1", successorX: 11, successorY: 11,
    });
    assert.equal(incumbent.suicided, true, "local incumbent retires once replacement is mining-adjacent");
    assert.equal(successor.suicided, false);
    assert.equal(data.creeps.join(","), "succ");
}

// Remote mine takeover uses the target room, not the spawn room, as the physical
// arrival boundary.
{
    const { incumbent, successor, data } = cleanup({
        targetRoom: "W2N2", sourceRoom: "W2N2", successorRoom: "W2N2", successorX: 10, successorY: 11,
    });
    assert.equal(incumbent.suicided, true, "remote incumbent retires after successor reaches the source");
    assert.equal(successor.suicided, false);
    assert.equal(data.creeps.join(","), "succ");
}

// Hatching, a border arrival, or transit is not a handoff.
{
    const hatching = cleanup({ successorSpawning: true });
    assert.equal(hatching.incumbent.suicided, false, "hatching successor cannot displace the incumbent");
    assert.equal(hatching.data.creeps.join(","), "inc", "registered spawning id is pruned while the incumbent stays");

    const border = cleanup({ successorX: 0, successorY: 10 });
    assert.equal(border.incumbent.suicided, false, "border arrival outside mining range is not ready");
    assert.equal(border.successor.suicided, false, "valid in-transit successor is retained");

    const transit = cleanup({ successorRoom: "W1N0", successorX: 25, successorY: 25 });
    assert.equal(transit.incumbent.suicided, false, "successor still in the spawn room is not ready");
    assert.equal(transit.successor.suicided, false);
}

// A missing successor marker must not change ordinary duplicate or stale-id cleanup.
{
    const ctx = loadStation();
    const S = ctx.StationSources;
    const source = { id: "src1", pos: pos("W1N1", 10, 10) };
    const older = makeCreep("older", "older", { ttl: 500 });
    const newer = makeCreep("newer", "newer", { ttl: 1400 });
    const data = { id: "src1", creeps: ["older", "newer", "dead"] };
    ctx.Game.getObjectById = id => {
        const object = { src1: source, older, newer }[id];
        return object && !object.suicided ? object : null;
    };
    ctx.Memory.rooms.W1N1 = { [S.stationName]: { src1: data } };
    S.cleanupDuplicateKeepers("W1N1");
    assert.equal(older.suicided, true, "unmarked true duplicates keep the prior longest-TTL winner");
    assert.equal(newer.suicided, false);
    S.cleanupDuplicateKeepers("W1N1");
    assert.equal(data.creeps.join(","), "newer", "stale ids are still removed");
}

console.log("keeper handoff checks passed");
