/**
 * 外矿搬运「单侧死锁」：一个矿点容器顶格压死 keeper，另一个矿点正常循环，
 * 而车永远只服务后者（2026-11-15 12:xx 实测 W26N59）。
 *
 * 现场（连续 3 次采样，跨度 445 tick）：
 *   · 矿点 (29,4)  容器 **2000/2000 一直满**、keeper 满仓站桩、源从 2,680 回满 3,000
 *     ⇒ 那面源 100% 空转；
 *   · 矿点 (27,29) 容器 440 → 1,082 正常循环，车（1,600 容量）往返这一侧。
 *
 * 根因：`harvestEnergyOuterCarry` 的动态改绑（0.78.225）只写了**一个方向**——
 * `storeEmpty()` 那一刻，若「本矿点容器 < 400 而别的矿点 ≥ 800」才改绑。
 * 而这只车的静态绑定是 (27,29)，它每次空手时 (27,29) 都已经 ≥ 400
 * ⇒ 那条分支结构上不可达，(29,4) 的 2,000 永远没人搬。
 * 反方向（「别的矿点顶格了、keeper 被容器顶死」）从来没有判据。
 *
 * 修法：把触发条件做成双向，并保留原有语义：
 *   ① 本矿点 < 400  ⇒ 阈值仍是 800（原行为，一个字节都不变）；
 *   ② 本矿点 ≥ 400 但别的矿点 ≥ 1900（容器 2,000 的 95%）⇒ 才改绑到顶格那一侧，
 *      且要求明显更满（≥ 本矿点 +200），防止两个都接近顶格时来回倒腾。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");

function load() {
    const ctx = {
        console,
        Memory: { rooms: {}, creeps: {}, flags: {}, marketSettings: {} },
        Game: {
            time: 1000, rooms: {}, creeps: {}, flags: {}, powerCreeps: {},
            cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
            shard: { name: "shard3" }, map: {}, constructionSites: {},
            getObjectById: id => (ctx.__objs && ctx.__objs[id]) || null,
        },
        Creep: function () {}, Room: function () {}, RoomPosition: function () {},
        PathFinder: { search: () => ({ path: [] }) },
        MemorySegment: {},
        Utils: {}, UtilsTask: {}, StationCarry: {}, StationHive: {}, StationLab: {},
        StationFactory: {}, StationWork: {}, StationTower: {}, StationMineral: {},
        StationUpgrade: {}, ManagerCreeps: {}, ManagerFlags: {}, StrategyPowerBank: {},
        StrategyOuterHarvest: {}, StrategyHighLevel: {}, HelperVisual: {},
        HelperCpuUsed: { start: () => 0, end: () => 0 },
        isCpuFeatureEnabled: () => true, isSaveCpu: false, MIN_CPU: false,
        __objs: {},
    };
    const C = {
        OK: 0, ERR_FULL: -8, ERR_NOT_ENOUGH_RESOURCES: -6, ERR_TIRED: -11,
        CARRY_CAPACITY: 50,
        RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power",
        STRUCTURE_CONTAINER: "container", STRUCTURE_ROAD: "road", STRUCTURE_LINK: "link",
        STRUCTURE_STORAGE: "storage", STRUCTURE_LAB: "lab", STRUCTURE_SPAWN: "spawn",
        STRUCTURE_TERMINAL: "terminal", STRUCTURE_TOWER: "tower",
        STRUCTURE_EXTRACTOR: "extractor", STRUCTURE_NUKER: "nuker",
        STRUCTURE_OBSERVER: "observer", STRUCTURE_POWER_SPAWN: "powerSpawn",
        STRUCTURE_FACTORY: "factory", STRUCTURE_WALL: "constructedWall",
        STRUCTURE_RAMPART: "rampart", STRUCTURE_EXTENSION: "extension",
        STRUCTURE_INVADER_CORE: "invaderCore",
        WORK: "work", CARRY: "carry", MOVE: "move", ATTACK: "attack", HEAL: "heal",
        RANGED_ATTACK: "ranged_attack", TOUGH: "tough", CLAIM: "claim",
        TERRAIN_MASK_WALL: 1,
    };
    Object.assign(ctx, C);
    ctx.FIND_STRUCTURES = 101; ctx.FIND_MY_STRUCTURES = 111; ctx.FIND_SOURCES = 105;
    ctx.FIND_CREEPS = 102; ctx.FIND_HOSTILE_CREEPS = 103; ctx.FIND_DROPPED_RESOURCES = 108;
    ctx.FIND_CONSTRUCTION_SITES = 107; ctx.FIND_MINERALS = 106; ctx.FIND_TOMBSTONES = 109;
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_sources.js" });
    return ctx;
}

const ROOM = "W26N59";
const MINE_A = "mineA";   // 静态绑定这一侧
const MINE_B = "mineB";   // 顶格那一侧

/**
 * 搭一个外矿房：两个矿点、各自一个容器。
 * @param {number} eA 本矿点容器能量
 * @param {number} eB 另一矿点容器能量
 */
function setup(eA, eB) {
    const ctx = load();
    const contA = { store: { energy: eA } };
    const contB = { store: { energy: eB } };
    ctx.__objs = { contA, contB };
    const dataA = { id: MINE_A, roomName: ROOM, x: 29, y: 4, container: "contA", carryCreeps: [] };
    const dataB = { id: MINE_B, roomName: ROOM, x: 27, y: 29, container: "contB", carryCreeps: [] };
    // 源码用 data[STRUCTURE_CONTAINER] 取容器 id
    dataA.container = "contA";
    dataA[ctx.STRUCTURE_CONTAINER] = "contA";
    dataB[ctx.STRUCTURE_CONTAINER] = "contB";
    const station = {};
    station[MINE_A] = dataA;
    station[MINE_B] = dataB;
    ctx.Memory.rooms[ROOM] = { stationSources: station };
    if (ctx.StationSources) ctx.StationSources.stationName = "stationSources";

    const task = { taskName: "harvestEnergyOuterCarry", id: MINE_A, roomName: ROOM, x: 29, y: 4, stationId: MINE_A };
    const creep = {
        id: "c1",
        storeEmpty: () => true,
        headTask: () => task,
        execLastTask: () => "exec",
        goTo: () => "go",
        // 不关心装卸/走位（本用例只测「换不换边」），给足以让函数走完的分支桩
        store: { [ctx.RESOURCE_ENERGY]: 0, getFreeCapacity: () => 1600 },
        memory: { tasks: [task] },
        room: { name: ROOM },
        pos: { x: 28, y: 5, roomName: ROOM, isNearTo: () => false, inRangeTo: () => false },
    };
    // 改绑决策之后才会走到的辅助函数，桩掉，避免用例依赖走位/待命逻辑
    ctx.StationSources.outerCarryShouldHold = () => false;
    ctx.StationSources.moveOuterCarrierOnRoad = () => false;
    return { ctx, creep, task, dataA, dataB };
}

// ① 反方向触发：本侧 700（正常循环，够得着货），另一侧顶格 2000 ⇒ 必须改绑过去
{
    const { ctx, creep, task, dataA } = setup(700, 2000);
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_B,
        "另一矿点容器顶格 2000、本侧只有 700 时必须改绑：否则那面源被满容器顶死、100% 空转");
    assert.equal(dataA.carryCreeps.length, 0, "改绑必须同时把登记从旧矿点迁走（补员需求的唯一真源）");
}

// ② 负对照：另一侧只有 1000（还没顶格）⇒ 不许动。这是旧行为，必须原样保留
{
    const { ctx, creep, task } = setup(700, 1000);
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_A, "另一侧没顶格时不该改绑，否则车会在两个矿点之间来回倒腾");
}

// ③ 负对照：两侧都接近顶格（1900 / 2000）⇒ 差距不足 200，不许动
{
    const { ctx, creep, task } = setup(1900, 2000);
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_A, "两侧都在 1900 以上时改绑收益小于一次往返，必须按滞回不动");
}

// ④ 原方向不能被破坏：本侧见底 100、另一侧 900（未顶格）⇒ 仍要改绑（0.78.225 的行为）
{
    const { ctx, creep, task } = setup(100, 900);
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_B, "本矿点见底、另一矿点有货时改绑，是 0.78.225 定下的原行为");
}

// ⑤ 两侧都没货（0 / 100）⇒ 不许动（阈值防抖，两辆空车不许互相倒腾）
{
    const { ctx, creep, task } = setup(0, 100);
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_A, "两侧都没货时不许改绑");
}

// ⑥ 途中不改绑：车还没到矿区（pos 不在任务房）⇒ 即使别处顶格也不换边（防半路掉头）。
{
    const { ctx, creep, task } = setup(700, 2000);
    creep.pos.roomName = "W26N58";   // 还在路上
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_A, "空车在途中不得改绑：先按绑定抵达矿区再决策（防反复横跳）");
}

// ⑦ 改绑冷却：刚改绑过的车（400 tick 内）不许再换边；冷却期满后恢复。
{
    const { ctx, creep, task } = setup(700, 2000);
    task.rebindAt = ctx.Game.time - 10;   // 刚改绑不久
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_A, "改绑后 400 tick 内不得再改绑（防到达新矿点后立刻换回去）");
    task.rebindAt = ctx.Game.time - 401;  // 冷却过期
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.equal(task.id, MINE_B, "冷却期满后按条件正常改绑");
    assert.equal(task.rebindAt, ctx.Game.time, "改绑时记录 rebindAt 冷却起点");
}

console.log("outer carry overflow rebalance checks passed");
