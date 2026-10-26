const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");

/**
 * RCL8 搬运编制（用户 2026-10-26：「允许收到 2，但注意房间运营不要出问题」）：
 *
 *   常态             = 2
 *   hive 真缺能       = +2（缺口 > 容量 30%）**且**现有搬运基本都在忙
 *
 * 旧写法只看 `HiveNeedToFill`（= 没满）+2，而活跃房 hive 几乎总是不满 ⇒ 目标常年 4，
 * 加上没有回收机制 ⇒ 实测 44 只搬运里 17 只空闲空手。这里锁住四条：
 *   ① 常态只有 2（3 只以上不再补员）
 *   ② hive 只是「没满」但缺口小 ⇒ **不加编**（这是旧行为的棘轮来源）
 *   ③ 缺口大但搬运还闲着 ⇒ 也不加编（说明不是运力问题）
 *   ④ 缺口大 + 搬运都在忙 ⇒ 仍能加到 4（紧急能力不能丢，否则房间会停摆）
 */
function load(spawned) {
    const ctx = {
        console,
        Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" } },
        Memory: { marketSettings: {}, rooms: {} },
        Creep: function () {}, Room: function () {},
        StationHive: { isEnergyAbundant: () => true, trySpawn: (...a) => { spawned.push(a); } },
        StationSources: {}, StationWork: {}, StationCarry: {
            // 真实 calcBodyPart 返回的是**部件字符串数组**（["carry","move"]），
            // 源码里用 `body.some(p => p === CARRY)` 判退化体型，所以桩必须也是字符串。
            getCarrierBodyConfig: () => ["carry", "move"],
        },
        StationUpgrade: {}, StationMineral: {}, StationObserver: {}, StationTower: {},
        StationLab: {}, StationFactory: {}, StrategyOuterHarvest: {}, ManagerFlags: {},
        ManagerCreeps: { calcBodyPart: (o) => Object.keys(o).flatMap(k => Array(o[k]).fill(k)) },
        isCpuFeatureEnabled: () => true,
        MIN_CPU: false,
        OK: 0, CARRY: "carry", MOVE: "move", WORK: "work",
        RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power",
        STRUCTURE_LINK: "link", STRUCTURE_STORAGE: "storage",
        FIND_STRUCTURES: 101, FIND_MY_STRUCTURES: 111, FIND_MY_CREEPS: 102,
        FIND_HOSTILE_CREEPS: 103, FIND_SOURCES: 105, FIND_MINERALS: 106,
        FIND_CONSTRUCTION_SITES: 107, FIND_DROPPED_RESOURCES: 108,
        CONTROLLER_STRUCTURES: { extension: { 8: 60, 7: 50, 6: 40, 5: 30, 4: 20 } },
        STRUCTURE_EXTENSION: "extension",
    };
    ctx.global = ctx;
    // 代码里用到 carryBusy.sum()
    vm.runInNewContext("Array.prototype.sum = function(){ return this.reduce((a,b)=>a+b,0); };", ctx);
    vm.runInNewContext(src, ctx, { filename: "strategy_highLevel.js" });
    return ctx;
}

function withSum(arr) {
    arr.sum = function () { return this.reduce((a, b) => a + b, 0); };
    return arr;
}

function makeRoom(opts) {
    const o = opts || {};
    const creeps = [];
    const mk = (busy) => {
        const c = { spawning: false, body: [{ type: "carry" }], store: { getCapacity: () => 800 },
            isFree: () => !busy, ticksToLive: 1000, memory: { role: "carrier" } };
        return c;
    };
    for (let i = 0; i < (o.carriers || 0); i++) creeps.push(mk(o.busy === true));
    return {
        name: "E41S32",
        level: 8,
        energyCapacityAvailable: 12900,
        getEnergyAvailable: () => (o.available === undefined ? 12900 : o.available),
        storage: { store: { energy: 50000 } },
        link: new Array(o.links === undefined ? 4 : o.links).fill({}),
        controller: { level: 8, progress: 0, progressTotal: 1, ticksToDowngrade: 150000 },
        // 源码用 `carryBusy.sum()`（线上是 lodash 给 Array 加的），这里给数组挂一个自有方法：
        // vm 里的全局改动不会影响宿主数组，所以只能挂在实例上。
        memory: { carryBusy: withSum(o.busyHistory || []), stationUpgrade: {} },
        creeps: (role) => (role === "carrier" ? creeps : []),
        hashCode: () => 7,
        find: () => [],
    };
}

// ① 常态：2 只已到位，hive 满 ⇒ 不补
{
    const spawned = [];
    const ctx = load(spawned);
    ctx.StationHive.HiveNeedToFill = () => false;
    ctx.StrategyHighLevel.trySpawnCarrier(makeRoom({ carriers: 2 }));
    assert.equal(spawned.length, 0, "常态编制 2 只，已到位就不再补（旧代码在 hive 不满时目标会变 4）");
}

// ② hive 只是「没满」但缺口小（<30% 容量）⇒ 不加编
{
    const spawned = [];
    const ctx = load(spawned);
    ctx.StationHive.HiveNeedToFill = () => true;
    ctx.StrategyHighLevel.trySpawnCarrier(makeRoom({ carriers: 2, available: 12900 - 2000, busyHistory: [2, 2, 2] }));
    assert.equal(spawned.length, 0,
        "缺口只有 2000/12900 时不该加编：活跃房 hive 几乎总是不满，这就是棘轮的来源");
}

// ③ 缺口大（>30%）但搬运都闲着 ⇒ 也不加编（不是运力问题）
{
    const spawned = [];
    const ctx = load(spawned);
    ctx.StationHive.HiveNeedToFill = () => true;
    ctx.StrategyHighLevel.trySpawnCarrier(makeRoom({ carriers: 2, available: 3000, busy: false, busyHistory: [2, 2, 2] }));
    assert.equal(spawned.length, 0, "搬运在闲着说明不是运力不足，加编只会增加空闲爬");
}

// ④ 缺口大 + 搬运都在忙 ⇒ 仍要加编（房间不能停摆）
{
    const spawned = [];
    const ctx = load(spawned);
    ctx.StationHive.HiveNeedToFill = () => true;
    ctx.StrategyHighLevel.trySpawnCarrier(makeRoom({ carriers: 2, available: 3000, busy: true, busyHistory: [2, 2, 2] }));
    assert.ok(spawned.length > 0,
        "hive 真被抽干（3000/12900）且两只搬运都在忙时必须补员，否则 spawn/extension 填不满、房间停摆");
}

// ⑤ 超过紧急上限（4 只）后不再补员 —— 回收靠自然老死
{
    const spawned = [];
    const ctx = load(spawned);
    ctx.StationHive.HiveNeedToFill = () => true;
    ctx.StrategyHighLevel.trySpawnCarrier(makeRoom({ carriers: 5, available: 3000, busy: true, busyHistory: [5, 5, 5] }));
    assert.equal(spawned.length, 0, "超过紧急上限后不再补员（回收靠自然老死）");
}

console.log("carrier target tighten checks passed");
