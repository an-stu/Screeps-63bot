/**
 * 修 rampart 必须先看**本房**能量够不够（用户 2026-10-13）。
 *
 * 原来 `getRepairWorkerLimit` 里唯一的能量判据是 `energy < 1000000` ⇒ **只把编制降到 1**，
 * 于是「storage 只有几万」的房照样永远保留一只修墙 worker。修墙是纯消耗
 *（1 能量换 100 血，RCL8 满血 3 亿 ⇒ 单墙约 300 万能量，是一房 storage 的几十倍），
 * 所以能量不足时应该**一只都不派**。
 *
 * 2026-11-07 语义收窄（用户：「阈值控制生产而不是动作，要么别 spawn 要么正常工作」）：
 * 能量闸只管**生产侧**（needBuildWall 出兵 / getRepairWorkerLimit 编制）；
 * **动作侧**（needBuildWallWorkerFree，把空闲 worker 派去修墙）不再看能量 ——
 * 已出生的 worker 只看「墙是否低于目标」，storage 中途跌穿 10 万也不打断
 * （否则就是 E41S23 那种出生时修得起、干到一半闸关了 ⇒ 原地站桩的挂机循环）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_defense.js"), "utf8");

// lodash 的数组扩展在游戏里由全局加载提供，宿主 realm 也要有（源码用了 .head()）
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function load({ storage = undefined, wallHits = undefined, marketSettings = {} } = {}) {
    const wall = wallHits === undefined ? null : { id: "wall1", hits: wallHits };
    const ctx = {
        console: { log() {} },
        Creep: function () {},
        STRUCTURE_RAMPART: "rampart",
        FIND_MY_STRUCTURES: 105,
        RESOURCE_ENERGY: "energy",
        Game: {
            time: 1000, cpu: { bucket: 10000 },
            shard: { name: "shard3" },
            getObjectById: id => (id === "wall1" ? wall : null),
        },
        Memory: { marketSettings },
        global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_defense.js" });
    ctx.wall = wall;
    return ctx;
}

function makeRoom(ctx, { name = "E53S21", level = 8, storageEnergy = 50000, hasStorage = true } = {}) {
    return {
        name, level,
        storage: hasStorage ? { store: { energy: storageEnergy } } : undefined,
    };
}

{
    const ctx = load();
    const S = ctx.StationDefense;

    // ① 门槛：只看本房 storage
    assert.equal(S.repairWallAffordable(makeRoom(ctx, { storageEnergy: 200000 })), true,
        "storage 20 万 → 养得起");
    assert.equal(S.repairWallAffordable(makeRoom(ctx, { storageEnergy: 50000 })), false,
        "storage 5 万 → 养不起（原来照样派 1 只）");
    assert.equal(S.repairWallAffordable(makeRoom(ctx, { storageEnergy: 99999 })), false, "差一点也不行");
    assert.equal(S.repairWallAffordable(makeRoom(ctx, { hasStorage: false })), false,
        "还没起 storage 的房：先发展经济");
    assert.equal(S.repairWallAffordable(undefined), false, "拿不到房间不能炸");

    // ② 阈值可覆盖
    const ctx2 = load({ marketSettings: { repairWallEnergyFloor: 1000 } });
    assert.equal(ctx2.StationDefense.repairWallAffordable(makeRoom(ctx2, { storageEnergy: 5000 })), true,
        "Memory.marketSettings.repairWallEnergyFloor 可覆盖");
}

{
    // ③ getRepairWorkerLimit：能量不足 → **0**（workerManager 那条出兵路径就此断开）
    const ctx = load();
    const S = ctx.StationDefense;
    S.needRepairWallMap["E53S21"] = ["wall1"];
    const poor = makeRoom(ctx, { name: "E53S21", storageEnergy: 46019 });
    assert.equal(S.getRepairWorkerLimit(poor), 0,
        "storage 4.6 万（实测 E53S21）→ 一只都不派");

    // ④ 能量够时维持原行为：storage < 100 万 → 1 只
    const rich = makeRoom(ctx, { name: "E53S21", storageEnergy: 200000 });
    assert.equal(S.getRepairWorkerLimit(rich), 1, "能量够但不到 100 万 → 仍然 1 只");

    // ⑤ storage ≥ 100 万且墙只有目标 60% 以下 → 2 只
    const ctx3 = load({ wallHits: 100000000 });   // RCL8 目标 3 亿，10 亿血 = 目标 33%
    const S3 = ctx3.StationDefense;
    S3.needRepairWallMap["E53S21"] = ["wall1"];
    const veryRich = makeRoom(ctx3, { storageEnergy: 2000000 });
    assert.equal(S3.getRepairWorkerLimit(veryRich), 2, "storage ≥100 万且墙远低于目标 → 2 只");
}

{
    // ⑥ 两个入口的**分工**（2026-11-07 语义）：
    //    needBuildWall（生产侧）保留能量闸 —— 穷房不许开启修墙战役；
    //    needBuildWallWorkerFree（动作侧）**不设能量闸** —— 已出生的 worker 只看
    //    「墙是否低于目标」，穷房也不能把它拦下来（否则就是 E41S23 的站桩循环）。
    const ctx = load({ wallHits: 100000000 });     // 墙远低于 RCL8 目标 3 亿
    const S = ctx.StationDefense;
    S.needRepairWallMap["E53S21"] = ["wall1"];

    const poor = makeRoom(ctx, { name: "E53S21", storageEnergy: 46019 });
    assert.equal(S.getRepairWorkerLimit(poor), 0, "穷房编制 0（生产闸）");
    assert.equal(S.needBuildWall(poor), false, "穷房：不该出兵修墙（生产闸）");
    assert.equal(S.needBuildWallWorkerFree(poor), true,
        "穷房：已出生的 worker 照常派去修墙（动作不受阈值控制，否则干到一半闸关 ⇒ 站桩）");

    const rich = makeRoom(ctx, { name: "E53S21", storageEnergy: 500000 });
    assert.equal(S.needBuildWall(rich), true, "有钱的房墙有缺口 → 照常修");
    assert.equal(S.needBuildWallWorkerFree(rich), true, "有钱的房照常派空闲 worker");
}

{
    // ⑦ 调用点仍在（只测 helper 抓不到「helper 在、但没人调」）
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/if \(!pro\.repairWallAffordable\(room\)\) return 0;/.test(codeOnly),
        "getRepairWorkerLimit 必须先过能量闸");
    assert.equal((codeOnly.match(/if \(!pro\.repairWallAffordable\(room\)\) return false;/g) || []).length, 1,
        "只有生产侧 needBuildWall 挂能量闸；动作侧 needBuildWallWorkerFree 必须无闸（2026-11-07）");
    // 动作侧必须保留「墙低于目标」判据本身（不能把动作闸整个删成 true）
    const fn = codeOnly.slice(codeOnly.indexOf("needBuildWallWorkerFree(room)"),
        codeOnly.indexOf("generatorRepairTask(room)"));
    assert.ok(fn.includes("levelWallHits"), "needBuildWallWorkerFree 仍要判断墙缺口");
    assert.ok(!fn.includes("repairWallAffordable"), "needBuildWallWorkerFree 不得再挂能量闸");
}

console.log("rampart repair energy-floor checks passed");
