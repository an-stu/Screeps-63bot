/**
 * Link-less keeper deposit (2026-11-27 shard2/E58S26).
 *
 * A keeper that fills up in a room without links had no way to hand its energy
 * over: the `nearFull` transfer only runs when `notLinkFull` (a non-full link
 * exists), and `harvest()` on a full creep returns ERR_FULL — the engine does
 * NOT spill the overflow into the container underneath. So the keeper sat at
 * 50/50 on top of a 10-energy container while carriers (300 threshold) idled
 * and the controller decayed.
 *
 * Negative control: revert the `else if` branch in harvestEnergyKeeper and the
 * first block below fails (no transfer, container never refilled).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceCode = fs.readFileSync(path.join(__dirname, "..", "modules/station_sources.js"), "utf8");
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function makeContext() {
    const objects = Object.create(null);
    const ctx = {
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_NO_PATH: -2, ERR_NO_BODYPART: -12, ERR_FULL: -8,
        MOVE: "move", WORK: "work", CARRY: "carry", ATTACK: "attack", HEAL: "heal",
        TOUGH: "tough", RANGED_ATTACK: "ranged_attack", CLAIM: "claim",
        LOOK_CREEPS: "creeps", LOOK_POWER_CREEPS: "powerCreeps", LOOK_ENERGY: "energy",
        LOOK_TOMBSTONES: "tombstones", RESOURCE_ENERGY: "energy", RESOURCE_OPS: "ops",
        RESOURCE_POWER: "power", STRUCTURE_KEEPER_LAIR: "keeperLair",
        STRUCTURE_INVADER_CORE: "invaderCore", STRUCTURE_RAMPART: "rampart",
        STRUCTURE_CONTAINER: "container", STRUCTURE_EXTENSION: "extension",
        STRUCTURE_SPAWN: "spawn", STRUCTURE_TOWER: "tower", STRUCTURE_STORAGE: "storage",
        STRUCTURE_TERMINAL: "terminal", STRUCTURE_LINK: "link", STRUCTURE_LAB: "lab",
        STRUCTURE_FACTORY: "factory", STRUCTURE_EXTRACTOR: "extractor",
        STRUCTURE_POWER_BANK: "powerBank", STRUCTURE_POWER_SPAWN: "powerSpawn",
        FIND_HOSTILE_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_STRUCTURES: 103,
        FIND_SOURCES: 104, FIND_MY_STRUCTURES: 105, FIND_SOURCES_ACTIVE: 106,
        FIND_DROPPED_RESOURCES: 107, FIND_TOMBSTONES: 108, FIND_DEPOSITS: 109,
        FIND_STRUCTURES: 110, FIND_CONSTRUCTION_SITES: 111, FIND_MINERALS: 112,
        PWR_REGEN_SOURCE: 13,
        console: { log() {} }, isSaveCpu: false, MIN_CPU: false,
        Memory: { rooms: {} },
        Game: {
            time: 1000, cpu: { bucket: 10000 }, shard: { name: "shard3" }, creeps: {},
            getObjectById(id) { return objects[id] || null; },
            map: { getRoomLinearDistance: () => 1 },
        },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => undefined },
        UtilsTask: {
            task: (t, taskName) => ({ id: t && t.id, taskName }),
            taskData: taskName => ({ taskName }),
            taskOutView: (id, roomName, x, y, taskName) => ({ id, roomName, x, y, taskName }),
        },
        PathFinder: { search: () => ({ path: [] }) },
        _: { values: o => Object.keys(o || {}).map(k => o[k]), keys: o => Object.keys(o || {}) },
    };
    ctx.global = ctx;
    vm.runInNewContext(sourceCode, ctx, { filename: "station_sources.js" });
    return { ctx, objects };
}

function makePos(x, y, roomName = "W1N1") {
    return {
        x, y, roomName,
        isEqualTo(other) {
            other = other.pos || other;
            return this.x === other.x && this.y === other.y && this.roomName === other.roomName;
        },
        isNearTo(other) {
            other = other.pos || other;
            return this.roomName === other.roomName
                && Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)) <= 1;
        },
        lookFor() { return []; },
    };
}

/**
 * link: false      -> low-RCL room, no link at all (the E58S26 case)
 * linkEnergy: n    -> link present with that much energy
 */
function makeFixture({ containerEnergy = 10, containerCap = 2000, freeCapacity = 0,
    link = false, linkEnergy = 800, x = 10, y = 10, energy = 4800, sourceEnergy = 2900 } = {}) {
    const { ctx, objects } = makeContext();
    const actions = [];
    const containerPos = makePos(10, 10);
    const container = {
        id: "container", pos: containerPos, hits: 1000, hitsMax: 1000,
        store: {
            energy: containerEnergy,
            getUsedCapacity(res) { return res === "energy" ? this.energy : 0; },
            getFreeCapacity(res) { return res === "energy" ? Math.max(0, containerCap - this.energy) : 0; },
        },
    };
    const source = {
        id: "src", pos: makePos(11, 10), energy: sourceEnergy, energyCapacity: 3000,
        ticksToRegeneration: 300,
    };
    objects.container = container;
    objects.src = source;
    if (link) {
        objects.link = { id: "link", hits: 1000, hitsMax: 1000, store: { energy: linkEnergy, getUsedCapacity: () => linkEnergy } };
    }
    ctx.Memory.rooms.W1N1 = {
        stationSources: { src: { container: "container", link: link ? "link" : undefined } },
    };
    const creep = {
        room: { name: "W1N1", constructionSite: [] },
        pos: makePos(x, y),
        ticksToLive: 90,
        memory: {},
        store: {
            energy,
            getFreeCapacity: () => freeCapacity,
        },
        headTask: () => ({ id: "src", roomName: "W1N1" }),
        moveTo(target) { actions.push(["moveTo", target.id]); },
        harvest(target) { actions.push(["harvest", target.id]); },
        build() {},
        repair(target) { actions.push(["repair", target.id]); },
        transfer(target, res) { actions.push(["transfer", target.id, res]); },
        withdraw(target, res) { actions.push(["withdraw", target.id, res]); },
        pickup() {},
        getPartCnt(type) { return type === "work" ? 6 : 5; },
        getActiveBodyparts(type) { return type === "work" ? 6 : 5; },
    };
    return { ctx, creep, container, actions, run() { ctx.Creep.prototype.harvestEnergyKeeper.call(creep); } };
}

// 1. The bug: no link + full keeper + container headroom => the keeper must hand
//    its load to the container, otherwise it stays full forever (ERR_FULL).
{
    const f = makeFixture({ freeCapacity: 0, containerEnergy: 10 });
    f.run();
    const transfer = f.actions.find(a => a[0] === "transfer");
    assert.ok(transfer, "full keeper in a link-less room transfers into its container");
    assert.equal(transfer[1], "container", "the container under the keeper is the deposit target");
    assert.ok(f.actions.some(a => a[0] === "harvest"), "harvesting keeps running once the store is emptied");
}

// 2. A full container must NOT receive the deposit (energy would decay on the
//    ground); the keeper stops harvesting instead.
{
    const f = makeFixture({ freeCapacity: 0, containerEnergy: 2000, containerCap: 2000 });
    f.run();
    assert.ok(!f.actions.some(a => a[0] === "transfer"), "no deposit into a full container");
    assert.ok(!f.actions.some(a => a[0] === "harvest"), "full keeper + full container stops harvesting");
}

// 3. A keeper that still has room keeps harvesting and does not transfer early.
{
    const f = makeFixture({ freeCapacity: 20, containerEnergy: 10 });
    f.run();
    assert.ok(!f.actions.some(a => a[0] === "transfer"), "not-full keeper keeps its buffer");
    assert.ok(f.actions.some(a => a[0] === "harvest"), "not-full keeper harvests");
}

// 4. Rooms WITH a non-full link keep the existing priority: link before container.
{
    const f = makeFixture({ freeCapacity: 0, containerEnergy: 10, link: true, linkEnergy: 700 });
    f.run();
    const transfers = f.actions.filter(a => a[0] === "transfer");
    assert.equal(transfers.length, 1, "exactly one deposit happens");
    assert.equal(transfers[0][1], "link", "a non-full link still takes priority over the container");
}

// 5. Link rooms keep their old behaviour: a full link means "wait", the keeper
//    neither harvests (ERR_FULL) nor spills into the container. The fix is
//    deliberately scoped to link-less rooms so RCL5+ chains are untouched.
{
    const f = makeFixture({ freeCapacity: 0, containerEnergy: 10, link: true, linkEnergy: 800 });
    f.run();
    assert.ok(!f.actions.some(a => a[0] === "transfer"), "a full link still means no deposit at all");
}

// 6. Source below the regeneration gate: no harvest, and no pointless deposit
//    churn on a keeper that has nothing new to give.
{
    const f = makeFixture({ freeCapacity: 0, containerEnergy: 10, sourceEnergy: 1000 });
    f.run();
    assert.ok(!f.actions.some(a => a[0] === "harvest"), "regeneration gate still blocks a drained source");
}

console.log("keeper container deposit checks passed");
