const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");

/**
 * 烧 power 有**两个**调用点：
 *   · station_carry.tryProcessPower（试点房 W32N56，带 OPERATE_POWER 配速）
 *   · strategy_highLevel.processPowerSpawn（每房每 tick 都跑）
 *
 * 2026-10-23 实测：10-21 把 `Memory.marketSettings.powerSpawnOtherRooms` 设成 false 之后，
 * 第二个调用点完全无视它，13 个 RCL8 房仍在各烧 1/tick（GPL +13/tick、能量 -650/tick）。
 * 这里锁住三件事：
 *   ① 开关 false ⇒ 非试点房**不烧**
 *   ② 开关 true  ⇒ 非试点房照常烧（原行为不能被改坏）
 *   ③ 试点房**永不走这条路**（否则同一个 powerSpawn 一 tick 烧两遍）
 */
function load(settings, options) {
    const opts = options || {};
    const ctx = {
        console,
        Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" } },
        Memory: { marketSettings: settings || {}, rooms: {} },
        Creep: function () {},
        Room: function () {},
        StationHive: { isEnergyAbundant: () => opts.abundant !== false },
        StationSources: {}, StationWork: {}, StationCarry: {}, StationUpgrade: {},
        StationMineral: {}, StationObserver: {}, StationTower: {}, StationLab: {},
        StationFactory: {}, StrategyOuterHarvest: {}, ManagerCreeps: {}, ManagerFlags: {},
        isCpuFeatureEnabled: () => true,
        MIN_CPU: false,
        OK: 0, RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power",
        STRUCTURE_STORAGE: "storage", STRUCTURE_LINK: "link",
        FIND_STRUCTURES: 101, FIND_MY_STRUCTURES: 111, FIND_MY_CREEPS: 102,
        FIND_HOSTILE_CREEPS: 103, FIND_SOURCES: 105, FIND_MINERALS: 106,
        FIND_CONSTRUCTION_SITES: 107, FIND_DROPPED_RESOURCES: 108,
        CONTROLLER_STRUCTURES: { extension: { 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 } },
        STRUCTURE_EXTENSION: "extension", STRUCTURE_CONTAINER: "container",
        STRUCTURE_ROAD: "road", STRUCTURE_TOWER: "tower", STRUCTURE_SPAWN: "spawn",
        CARRY: "carry", MOVE: "move", WORK: "work", ATTACK: "attack", HEAL: "heal",
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_highLevel.js" });
    return ctx;
}

function makeRoom(name, storageEnergy) {
    const calls = { n: 0 };
    return {
        calls,
        name,
        storage: { store: { energy: storageEnergy }, my: true },
        powerSpawn: {
            store: { energy: 500, power: 10 },
            processPower: () => { calls.n++; return 0; },
        },
    };
}

// ① 开关 false：非试点房不烧（这是本次修的 bug）
{
    const ctx = load({ powerSpawnOtherRooms: false });
    const room = makeRoom("E41S32", 200000);
    ctx.StrategyHighLevel.processPowerSpawn(room);
    assert.equal(room.calls.n, 0,
        "powerSpawnOtherRooms=false ⇒ 非试点房不得烧 power（旧代码无视开关，13 房各烧 1/tick）");
}

// ② 开关 true：非试点房照常烧（不能把原功能改坏）
{
    const ctx = load({ powerSpawnOtherRooms: true });
    const room = makeRoom("E41S32", 200000);
    ctx.StrategyHighLevel.processPowerSpawn(room);
    assert.equal(room.calls.n, 1, "开关打开时非试点房应照常烧 1 次");
}

// ③ 试点房永不走这条路（否则一 tick 烧两遍）
{
    const ctx = load({ powerSpawnOtherRooms: true });
    const room = makeRoom("W32N56", 200000);
    ctx.StrategyHighLevel.processPowerSpawn(room);
    assert.equal(room.calls.n, 0,
        "试点房由 station_carry.tryProcessPower 负责，这里必须跳过");
}

// ④ 原有两道闸不能丢：账号级不充裕 / 本房 storage 低于 3 万 ⇒ 都不烧
{
    const ctx = load({ powerSpawnOtherRooms: true }, { abundant: false });
    const room = makeRoom("E41S32", 200000);
    ctx.StrategyHighLevel.processPowerSpawn(room);
    assert.equal(room.calls.n, 0, "账号级不充裕时不烧（原闸门）");

    const ctx2 = load({ powerSpawnOtherRooms: true });
    const poor = makeRoom("E41S32", 20000);   // < POWER_SPAWN_ENERGY_FLOOR(30000)
    ctx2.StrategyHighLevel.processPowerSpawn(poor);
    assert.equal(poor.calls.n, 0, "本房 storage 低于 floor 时不烧（原闸门）");
}

console.log("process power switch checks passed");
