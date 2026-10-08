/**
 * PowerSpawn 的「烧能量」闸门：**本房** storage 不够就不许烧。
 *
 * 背景（2026-10-08 用户报）：powerSpawn 每 tick 花 50 energy + 1 power 换 ops，
 * 而原来的唯一闸门是账号级的 `StationHive.isEnergyAbundant()` —— 只要整个号看着
 * 宽裕，一个 storage 见底的房也照烧。实测现场：W33N55 的 storage 是 **0**、
 * terminal 里躺着 41636，照样在烧；E41S32 storage 3077、E41S23 storage 11901
 * 也一样，12 个房全在烧。
 *
 * 用 VM 跑真实模块源码（只桩掉 call-time 依赖）——负对照可直接验：
 * 把 processPowerSpawn 改回只判账号级，下面的断言必须失败。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "modules", name), "utf8");

function makeContext({ abundant = true, marketSettings = {} } = {}) {
    const ctx = {
        console,
        Memory: { marketSettings },
        isSaveCpu: true,
        RESOURCE_ENERGY: "energy",
        RESOURCE_POWER: "power",
        RESOURCE_OPS: "ops",
        OK: 0,
        ERR_NOT_ENOUGH_RESOURCES: -6,
        MIN_CPU: false,
        Game: { time: 100000, shard: { name: "shard3" } },
        // 只桩到「processPowerSpawn 跑得到」的程度：其余都只在别的入口用
        StationHive: { isEnergyAbundant: () => abundant },
        StationCarry: {}, StationSources: {}, StationWork: {}, StationLab: {},
        StationDefense: {}, StationFactory: {}, ManagerCreeps: {}, ManagerFlags: {},
        ManagerAutoPlanner: {}, ManagerRooms: {}, StationMinetral: {}, StationUpgrade: {},
        StationTower: {}, HelperError: { catchError: fn => fn(), runEach: () => {} },
        HelperCpuUsed: {}, UtilsTask: {}, StrategyMarket: {}, global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(read("strategy_highLevel.js"), ctx, { filename: "strategy_highLevel.js" });
    return ctx;
}

function makeRoom(storageEnergy, { hasStorage = true } = {}) {
    const calls = [];
    return {
        name: "W33N55",
        calls,
        storage: hasStorage ? { store: { energy: storageEnergy } } : undefined,
        powerSpawn: {
            store: { energy: 5000, power: 40 },
            processPower() { calls.push("processPower"); return 0; },
        },
    };
}

{
    const ctx = makeContext();

    // ① 线上现场：storage 0（terminal 有钱不算数）→ 不许烧
    const broke = makeRoom(0);
    ctx.StrategyHighLevel.processPowerSpawn(broke);
    assert.equal(broke.calls.length, 0, "storage 0 的房绝不能再烧 50 energy/tick");

    // ② storage 见底（E41S32 实测 3077）→ 不许烧
    const thin = makeRoom(3077);
    ctx.StrategyHighLevel.processPowerSpawn(thin);
    assert.equal(thin.calls.length, 0, "storage 只有 3077 也不许烧");

    // ③ 阈值正下方 → 不许烧
    const justBelow = makeRoom(29999);
    ctx.StrategyHighLevel.processPowerSpawn(justBelow);
    assert.equal(justBelow.calls.length, 0, "29999 低于 3 万门槛");

    // ④ 正好等于阈值 → 允许（>= 语义）
    const atFloor = makeRoom(30000);
    ctx.StrategyHighLevel.processPowerSpawn(atFloor);
    assert.deepEqual(atFloor.calls, ["processPower"], "正好 3 万可以烧");

    // ⑤ 充裕的房照常烧（不能让改动把功能停掉）
    const rich = makeRoom(120000);
    ctx.StrategyHighLevel.processPowerSpawn(rich);
    assert.deepEqual(rich.calls, ["processPower"], "storage 12 万的房要照常产 ops");

    // ⑥ 没有 storage（低等级房）→ 不许烧
    const noStorage = makeRoom(0, { hasStorage: false });
    ctx.StrategyHighLevel.processPowerSpawn(noStorage);
    assert.equal(noStorage.calls.length, 0, "没有 storage 就没有余力");
}

{
    // ⑦ 账号级不充裕时，本房再富也不许烧（原有闸门必须保留）
    const ctx = makeContext({ abundant: false });
    const rich = makeRoom(200000);
    ctx.StrategyHighLevel.processPowerSpawn(rich);
    assert.equal(rich.calls.length, 0, "账号级闸门不能被新判据绕过");
}

{
    // ⑧ Memory 覆盖阈值
    const ctx = makeContext({ marketSettings: { powerSpawnEnergyFloor: 80000 } });
    const mid = makeRoom(50000);
    ctx.StrategyHighLevel.processPowerSpawn(mid);
    assert.equal(mid.calls.length, 0, "覆盖成 8 万后，5 万的房要停");
    const high = makeRoom(90000);
    ctx.StrategyHighLevel.processPowerSpawn(high);
    assert.deepEqual(high.calls, ["processPower"], "9 万仍在覆盖后的门槛之上");
}

console.log("powerSpawn energy floor checks passed");
