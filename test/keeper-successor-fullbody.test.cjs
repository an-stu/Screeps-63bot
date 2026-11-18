// 0.78.272 回归：接班 keeper 按【房间容量】定体型（RCL3 满配 WORK6），
// 攒够能量再孵；只有「一只 keeper 都没有」的救急场景才按当前能量缩小。
// 现场：E51S29（RCL3、容量 800）连续孵出 WORK2 的小 keeper，收入锁死在 4/tick。
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
};

function costOf(body) {
    const cost = {work: 100, carry: 50, move: 50, tough: 10, attack: 80, heal: 250, claim: 600, ranged_attack: 150};
    return body.reduce((sum, part) => sum + (cost[part] || 0), 0);
}

function loadStation() {
    const ctx = {
        ...CONSTANTS,
        console: {log() {}},
        isSaveCpu: false,
        _: {values: o => Object.keys(o || {}).map(k => o[k])},
        Game: {time: 100000, cpu: {bucket: 10000}, shard: {name: "shard3"}, getObjectById: () => null, creeps: {}},
        Memory: {rooms: {}},
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { return {x, y, roomName}; },
        ManagerCreeps: {
            calcBodyPart: obj => Object.keys(obj).flatMap(k => new Array(obj[k]).fill(k)),
            getBodyEnergyNeed: body => costOf(body),
        },
        StationMineral: {stationName: "stationMineral"},
        StationHive: {trySpawn: () => "newKeeper"},
        UtilsTask: {task: (t, n) => ({id: t.id, taskName: n}), taskData: n => ({taskName: n})},
        PathFinder: {search: () => ({path: [0, 1, 2]})},
        BODYPART_COST: {work: 100, carry: 50, move: 50, tough: 10, attack: 80, heal: 250, claim: 600, ranged_attack: 150},
        MIN_CPU: false,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, {filename: "station_sources.js"});
    return ctx;
}

function run(hive, ttl = 10) {
    const ctx = loadStation();
    const S = ctx.StationSources;
    const keeper = {
        id: "k1", name: "k1", spawning: false, ticksToLive: ttl,
        body: new Array(5).fill({type: ctx.MOVE}),
        memory: {role: "harvestEnergyKeeper"},
        headTask: () => ({id: "src1", taskName: "harvestEnergyKeeper", roomName: "W1N1"}),
    };
    ctx.Memory.rooms["W1N1"] = {
        [S.stationName]: {src1: {id: "src1", container: undefined, spawnTime: ctx.Game.time - 1490, creeps: ["k1"]}},
    };
    const calls = [];
    const room = {
        name: "W1N1", my: true, level: 3, spawnFailure: false,
        energyAvailable: hive,
        getEnergyAvailable: () => hive,
        getEnergyCapacityAvailable: () => 800,
        creeps(role) {
            if (role === "harvestEnergyKeeper") return [keeper];
            if (role === "carrier") return [{ticksToLive: 1000}];
            return [];
        },
        find: () => [],
        spawn: [{isActive: () => true}],
    };
    ctx.StationSources.outerMineStarvesSpawnRoom = () => false;
    ctx.StationSources.homeMiningPaused = () => false;
    ctx.StationSources.generatorHarTask = () => [];
    ctx.StationSources.generatorOuterHarTask = () => [];
    ctx.StationHive.trySpawn = (rm, target, body) => {
        const spend = costOf(body);
        calls.push({body: body.slice(), spend});
        const left = rm.currentEnergyAvailable === undefined ? rm.getEnergyAvailable() : rm.currentEnergyAvailable;
        if (!body || !body.length || left < spend) return undefined;
        return "newKeeper";
    };
    S.trySpawnOuterHarKeeper("W1N1", room);
    return calls;
}

// 1) 接班时 hive 只有 400：满配 800 付不起 ⇒ 按住不孵（不再降级成 WORK2）。
const poor = run(400);
assert.equal(poor.length, 0, "接班应等满配体型，hive 400 时不得退化成小 keeper");

// 2) hive 满 800：按容量孵 3 组（WORK6 + MOVE3 + CARRY1 = 800）。
const rich = run(800);
assert.equal(rich.length, 1, "hive 800 时必须孵出满配接班 keeper");
assert.equal(rich[0].spend, 800, "满配档 = 800 能量");
assert.equal(rich[0].body.filter(p => p === "work").length, 6, "RCL3 满配 = 6 WORK");
assert.equal(rich[0].body.filter(p => p === "move").length, 3, "6 WORK 配 3 MOVE");
assert.equal(rich[0].body.filter(p => p === "carry").length, 1);

// 3) 老 keeper 还年轻（ttl 1400）但体型偏小：hive 付得起满配时立即换班
const undersizedRich = run(800, 1400);
assert.equal(undersizedRich.length, 1, "小体型 keeper 在 hive 付得起满配时应立即被替换");
assert.equal(undersizedRich[0].spend, 800);

// 4) 同上但 hive 付不起满配（400）：按住，不降级、不重复派
const undersizedPoor = run(400, 1400);
assert.equal(undersizedPoor.length, 0, "付不起满配时不得退化成小 keeper");

console.log("keeper successor keeps the full-capacity body");
