// Shard-specific energy-keeper sizing and CPU throttle regression.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

const constants = {
    OK: 0, ERR_NOT_OWNER: -1, ERR_NO_PATH: -2, ERR_BUSY: -4, ERR_INVALID_TARGET: -7,
    ERR_NOT_IN_RANGE: -9, ERR_NO_BODYPART: -12, ERR_NOT_ENOUGH_ENERGY: -6,
    MOVE: "move", WORK: "work", CARRY: "carry", TOUGH: "tough", CLAIM: "claim",
    ATTACK: "attack", HEAL: "heal", RANGED_ATTACK: "ranged_attack",
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
    BODYPART_COST: {move: 50, work: 100, carry: 50, attack: 80, ranged_attack: 150,
        heal: 250, claim: 600, tough: 10},
};

function loadStation({shard = "shard2", saveCpu = true, bucket = 10000, marketSettings = {}} = {}) {
    const ctx = {
        ...constants,
        console: {log() {}},
        isSaveCpu: saveCpu,
        _: {values: o => Object.keys(o || {}).map(k => o[k])},
        Game: {time: 100000, cpu: {bucket}, shard: {name: shard}, getObjectById: () => null, creeps: {}},
        Memory: {rooms: {}, marketSettings},
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { return {x, y, roomName}; },
        ManagerCreeps: {
            calcBodyPart: obj => Object.keys(obj).flatMap(k => new Array(obj[k]).fill(k)),
            getBodyEnergyNeed: body => body.reduce((sum, part) => sum + (constants.BODYPART_COST[part] || 0), 0),
        },
        StationMineral: {stationName: "stationMineral"},
        StationHive: {trySpawn: () => "newKeeper"},
        UtilsTask: {task: (target, name) => ({id: target.id, taskName: name}), taskData: name => ({taskName: name})},
        PathFinder: {search: () => ({path: [0, 1, 2]})},
        MIN_CPU: false,
    };
    ctx.global = ctx;
    vm.runInNewContext(source, ctx, {filename: "station_sources.js"});
    return ctx;
}

function bodyFor(options, energy, isOutRoom, level = 8) {
    return loadStation(options).StationSources.getHarvesterBodyConfig(energy, isOutRoom, level, {
        lastPowerTime: 0, lastPowerLevel: 0,
    });
}

function counts(body) {
    return {
        work: body.filter(part => part === "work").length,
        move: body.filter(part => part === "move").length,
        carry: body.filter(part => part === "carry").length,
    };
}

function assertBodyLimit(body, label) {
    assert.ok(body.length <= 50, `${label} must stay within Screeps' 50-part cap (got ${body.length})`);
}

// Non-shard3 must stay at the standard 6W body even with isSaveCpu enabled and
// a remote-size override configured. The same body is used at home and remotely.
for (const isOutRoom of [false, true]) {
    const body = bodyFor({shard: "shard2", saveCpu: true, marketSettings: {outerMaxPartCnt: 9}}, 800, isOutRoom);
    assert.deepEqual(counts(body), {work: 6, move: 3, carry: 1});
    assertBodyLimit(body, `shard2 ${isOutRoom ? "remote" : "home"}`);
}

// shard3 without CPU-saving mode also uses the standard size, regardless of
// the remote override.
for (const isOutRoom of [false, true]) {
    const body = bodyFor({shard: "shard3", saveCpu: false, marketSettings: {outerMaxPartCnt: 9}}, 800, isOutRoom);
    assert.deepEqual(counts(body), {work: 6, move: 3, carry: 1});
    assertBodyLimit(body, `shard3 non-save ${isOutRoom ? "remote" : "home"}`);
}

// The large profile is exclusive to shard3 CPU-saving mode. At RCL8 it keeps
// the 26W home / 10W remote configurations; below RCL8 it is capped at 8W.
const largeHome = bodyFor({shard: "shard3", saveCpu: true}, 12900, false, 8);
const largeRemote = bodyFor({shard: "shard3", saveCpu: true}, 12900, true, 8);
const lowLevelHome = bodyFor({shard: "shard3", saveCpu: true}, 1200, false, 7);
const lowLevelRemote = bodyFor({shard: "shard3", saveCpu: true}, 1200, true, 7);
assert.deepEqual(counts(largeHome), {work: 26, move: 13, carry: 8});
assert.deepEqual(counts(largeRemote), {work: 10, move: 5, carry: 1});
assert.deepEqual(counts(lowLevelHome), {work: 8, move: 4, carry: 1});
assert.deepEqual(counts(lowLevelRemote), {work: 8, move: 4, carry: 1});
for (const [label, body] of [["large home", largeHome], ["large remote", largeRemote],
    ["low-level home", lowLevelHome], ["low-level remote", lowLevelRemote]]) {
    assertBodyLimit(body, label);
}

// The standard three-group profile shrinks only by whole affordable groups:
// 750 buys two groups (4W), 300 buys one (2W), and <300 buys nothing.
for (const energy of [750, 300, 299]) {
    const body = bodyFor({shard: "shard2", saveCpu: true}, energy, false, 8);
    const expectedWork = energy === 750 ? 4 : energy === 300 ? 2 : 0;
    assert.equal(counts(body).work, expectedWork, `${energy} energy should yield ${expectedWork} WORK`);
    assertBodyLimit(body, `affordability ${energy}`);
}

// CPU harvesting throttling must be inactive on shard2, and on shard3 may only
// skip when the current active WORK rate meets or exceeds source regeneration.
const makeCpuCreep = activeWork => ({
    ticksToLive: 1499, // odd: candidate skip tick when the bucket is low
    getActiveBodyparts: part => part === "work" ? activeWork : 0,
});
const energySource = {energyCapacity: 4000};
const station = {lastPowerTime: 0, lastPowerLevel: 0};
const standardContext = loadStation({shard: "shard2", saveCpu: true, bucket: 4000});
assert.equal(standardContext.StationSources.skipKeeperHarvestForCpu(makeCpuCreep(26), energySource, station), false,
    "non-shard3 keepers must not enter the large-body CPU throttle");
const shard3Context = loadStation({shard: "shard3", saveCpu: true, bucket: 4000});
assert.equal(shard3Context.StationSources.skipKeeperHarvestForCpu(makeCpuCreep(6), energySource, station), false,
    "a 6W keeper must not be throttled below the source's 13.33/tick regeneration rate");
assert.equal(shard3Context.StationSources.skipKeeperHarvestForCpu(makeCpuCreep(26), energySource, station), true,
    "a large shard3 keeper may skip when its WORK rate exceeds regeneration");

console.log("keeper shard sizing checks passed");
