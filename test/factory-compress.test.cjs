const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_factory.js"), "utf8");

// Screeps 的资源常量值（与引擎一致）
const RESOURCES = {
    RESOURCE_ENERGY: "energy", RESOURCE_BATTERY: "battery",
    RESOURCE_UTRIUM: "U", RESOURCE_LEMERGIUM: "L", RESOURCE_KEANIUM: "K",
    RESOURCE_ZYNTHIUM: "Z", RESOURCE_GHODIUM: "G",
    RESOURCE_SILICON: "silicon", RESOURCE_BIOMASS: "biomass",
    RESOURCE_METAL: "metal", RESOURCE_MIST: "mist",
    RESOURCE_UTRIUM_BAR: "utrium_bar", RESOURCE_LEMERGIUM_BAR: "lemergium_bar",
    RESOURCE_KEANIUM_BAR: "keanium_bar", RESOURCE_ZYNTHIUM_BAR: "zynthium_bar",
    RESOURCE_GHODIUM_MELT: "ghodium_melt",
    RESOURCE_OXIDANT: "oxidant", RESOURCE_REDUCTANT: "reductant",
    RESOURCE_PURIFIER: "purifier",
    RESOURCE_WIRE: "wire", RESOURCE_CELL: "cell",
    RESOURCE_ALLOY: "alloy", RESOURCE_CONDENSATE: "condensate",
};

const COMMODITIES = {
    utrium_bar: { amount: 100, cooldown: 20, components: { U: 500, energy: 200 } },
    lemergium_bar: { amount: 100, cooldown: 20, components: { L: 500, energy: 200 } },
    keanium_bar: { amount: 100, cooldown: 20, components: { K: 500, energy: 200 } },
    zynthium_bar: { amount: 100, cooldown: 20, components: { Z: 500, energy: 200 } },
    oxidant: { amount: 100, cooldown: 20, components: { O: 500, energy: 200 } },
    reductant: { amount: 100, cooldown: 20, components: { H: 500, energy: 200 } },
    purifier: { amount: 100, cooldown: 20, components: { X: 500, energy: 200 } },
    ghodium_melt: { amount: 100, cooldown: 20, components: { G: 500, energy: 200 } },
    battery: { amount: 50, cooldown: 10, components: { energy: 600 } },
    wire: { amount: 20, cooldown: 8, components: { utrium_bar: 20, silicon: 100, energy: 40 } },
    cell: { amount: 20, cooldown: 8, components: { lemergium_bar: 20, biomass: 100, energy: 40 } },
    alloy: { amount: 20, cooldown: 8, components: { zynthium_bar: 20, metal: 100, energy: 40 } },
    condensate: { amount: 20, cooldown: 8, components: { keanium_bar: 20, mist: 100, energy: 40 } },
};

/**
 * 载入真实模块，`counts` 就是该房 mass store 里每种资源的数量（storage+terminal+factory）。
 * 只测 `noLevel(room)` 的决策，不碰生产/搬运。
 */
// 模块顶层还会用到很多别的 RESOURCE_* 常量（composite/crystal/liquid/…）。
// 这些只作标识符用，自动补成「去掉前缀的小写名」即可，避免逐个手写漏掉。
const ALL_RESOURCE_TOKENS = Array.from(new Set(src.match(/RESOURCE_[A-Z0-9_]+/g) || []));

const ALL_BARS = ["utrium_bar", "lemergium_bar", "keanium_bar", "zynthium_bar",
    "oxidant", "reductant", "purifier"];

/**
 * @param counts  本房 mass store 里的资源数量
 * @param margins 各 bar 的毛利率（%）；默认全部 60%，只有专门测门槛的用例才覆盖。
 *                `null` 表示「市场还没扫过」——Memory 里没有 compressBars。
 */
function load(counts, margins) {
    const calls = [];
    const ms = {};
    if (margins !== null) {
        ms.compressMinMargin = 40;
        ms.compressBars = {};
        for (const b of ALL_BARS) ms.compressBars[b] = margins && margins[b] !== undefined ? margins[b] : 60;
    }
    const extra = {};
    for (const tok of ALL_RESOURCE_TOKENS) {
        if (!(tok in RESOURCES)) extra[tok] = tok.slice("RESOURCE_".length).toLowerCase();
    }
    const ctx = Object.assign({}, extra, RESOURCES, {
        console,
        COMMODITIES,
        Game: { time: 100000, shard: { name: "shard3" }, cpu: { bucket: 10000 } },
        Memory: { rooms: {}, marketSettings: ms },
        OK: 0,
        ERR_NOT_ENOUGH_RESOURCES: -6,
        ERR_INVALID_TARGET: -7,
        ERR_FULL: -8,
        ERR_NOT_IN_RANGE: -9,
        ERR_TIRED: -11,
        ERR_NO_BODYPART: -12,
        ORDER_BUY: "buy",
        ORDER_SELL: "sell",
        STRUCTURE_FACTORY: "factory",
        FIND_FLAGS: 110,
        FIND_MY_STRUCTURES: 111,
        // 游戏里全局注入了 lodash；这里只补模块加载期用到的几个
        _: {
            keys: o => Object.keys(o),
            values: o => Object.values(o),
            map: (o, fn) => Object.values(o).map(fn),
            each: (o, fn) => { Object.keys(o).forEach(k => fn(o[k], k)); },
        },
        // 模块会往 Creep.prototype 上挂任务处理器；这里给个空壳即可
        Creep: function () {},
        Room: function () {},
        Resource: function () {},
        Structure: function () {},
        StationCarry: {
            roomMassStoreCnt: (room, res) => counts[res] || 0,
            generatorMassStoreCarry: () => [],
        },
        StationHive: { isEnergyAbundant: () => true },
        StrategyFactoryPowerCreep: { getPowerCreep: () => null, getPowerFactoryLevel: () => 0 },
        UtilsTask: { task: () => ({}) },
    });
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_factory.js" });

    // checkNoLevelRes 是既有实现（含 needs 计算），这里包一层只记录「要压多少根」
    const F = ctx.StationFactory;
    ctx.__calls = calls;
    F.checkNoLevelRes = (room, res, amount) => {
        calls.push({ res, amount });
        return { produceResType: res, needs: [[res, amount]] };
    };
    return ctx;
}

const ENERGY_RICH = { energy: 150000 };

// ① 每房 3,000 原矿（我们的真实现状）：必须能压，且**给实验室留 1,000**
{
    const ctx = load(Object.assign({ U: 3000 }, ENERGY_RICH));
    const out = ctx.StationFactory.noLevel({ name: "W33N53" });
    assert.ok(out, "3,000 原矿必须能触发压缩（旧逻辑要求 ≥6000，13 个工厂从来没压过一次）");
    assert.equal(out.produceResType, "utrium_bar");
    assert.equal(ctx.__calls[0].amount, 200,
        "保留 2,000 → 只压 1,000 原矿 = 200 根（原矿要多留，不能把实验室的料吃光）");
}

// ② 原矿正好等于保留量：一根都不压
{
    const ctx = load(Object.assign({ U: 2000 }, ENERGY_RICH));
    const out = ctx.StationFactory.noLevel({ name: "W33N53" });
    assert.equal(out, undefined, "只够保留量（2,000）时不压（实验室要用）");
    assert.equal(ctx.__calls.length, 0);
}

// ③ 原矿远超保留量：按 100 根取整，且不超过 600 根
{
    const ctx = load(Object.assign({ U: 9000 }, ENERGY_RICH));
    ctx.StationFactory.noLevel({ name: "W33N53" });
    assert.equal(ctx.__calls[0].amount, 600, "一批最多 600 根（3,000 原矿）");
}

// ④ 已经有 1,500 根 bar 以上：停止压缩
{
    const ctx = load(Object.assign({ U: 9000, utrium_bar: 1500 }, ENERGY_RICH));
    const out = ctx.StationFactory.noLevel({ name: "W33N53" });
    assert.equal(ctx.__calls.length, 0, "bar 够用就不再压");
    assert.equal(out, undefined);
}

// ⑤ 能量不足 10 万：整条基础商品线停（既有护栏，别被这次改动带坏）
{
    const ctx = load({ U: 9000, energy: 90000 });
    assert.equal(ctx.StationFactory.noLevel({ name: "W33N53" }), undefined,
        "本房能量 < 10 万时不压（既有护栏）");
    assert.equal(ctx.__calls.length, 0);
}

// ⑥ oxidant 走同一条路（O → oxidant），确认映射没写反
{
    const ctx = load(Object.assign({ O: 3000 }, ENERGY_RICH));
    const out = ctx.StationFactory.noLevel({ name: "E55S31" });
    assert.equal(out.produceResType, "oxidant");
    assert.equal(ctx.__calls[0].amount, 200);
}

// ⑦ 解压**默认不做**：2 万根 bar + 原矿见底 + 15 万能量。
//    这正是旧门槛（>9,000 根 / >12 万能量）会解压、而新门槛（>30,000 根 / >30 万能量）不会的场景
//    —— 用户 10-20：解压要烧能量，能量不便宜。
{
    // 能量给到 40 万（旧门槛的「>12 万」也满足），只有「>30,000 根 bar」这一条能挡住它
    const ctx = load(Object.assign({ utrium_bar: 20000, U: 1000 }, { energy: 400000 }));
    const out = ctx.StationFactory.noLevel({ name: "W33N53" });
    assert.equal(out, undefined, "2 万根 bar + 40 万能量时不许解压");
    assert.equal(ctx.__calls.length, 0, "解压门槛是 30,000 根 + 30 万能量，正常运行时进不来");
}

// ⑧ 极端堆积时才允许解压（确认这条分支只是被抬高、不是被删掉）
{
    const ctx = load({ utrium_bar: 35000, U: 500, energy: 400000 });
    ctx.StationFactory.noLevel({ name: "W33N53" });
    assert.equal(ctx.__calls.length, 1, "3.5 万根 bar + 能量 40 万 ⇒ 允许解压兜底");
    assert.equal(ctx.__calls[0].res, "U", "解压产物是原矿");
    assert.equal(ctx.__calls[0].amount, 15000);
}

// ⑨ 「自己做 bar」的成本必须把**能量**算全：一根 = 5 原矿 + 2 能量。
//    市场那条判断（买 bar 还是自己做）原来只算 1 份能量，把自制成本算低了。
{
    const marketSrc = fs.readFileSync(path.join(root, "modules/strategy_market.js"), "utf8");
    const codeOnly = marketSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/let barPrice = maxPrice \* 5 \+ 2 \* StrategyMarketPrice\.getResTypeHistory\(RESOURCE_ENERGY\)/.test(codeOnly),
        "bar 自制成本必须是 5 原矿 + 2 能量（写 1 份能量会把自制算便宜、更容易去买）");
}

// ⑩ 利润率门槛：低于 40% 一律不压（用户 10-20），没扫过也不压
{
    const low = load(Object.assign({ U: 3000 }, ENERGY_RICH), { utrium_bar: 39.9 });
    assert.equal(low.StationFactory.noLevel({ name: "W33N53" }), undefined,
        "毛利率 39.9% < 40% ⇒ 不压");
    assert.equal(low.__calls.length, 0);

    const edge = load(Object.assign({ U: 3000 }, ENERGY_RICH), { utrium_bar: 40 });
    assert.ok(edge.StationFactory.noLevel({ name: "W33N53" }), "刚好 40% ⇒ 允许（门槛是闭区间）");

    const unscanned = load(Object.assign({ U: 3000 }, ENERGY_RICH), null);
    assert.equal(unscanned.StationFactory.noLevel({ name: "W33N53" }), undefined,
        "市场还没扫过（Memory 无 compressBars）⇒ 不压，宁可等一轮");
}

// ⑪ 扫描侧必须把门槛与逐项毛利率写进 Memory（工厂只读这两个键）
{
    const marketSrc = fs.readFileSync(path.join(root, "modules/strategy_market.js"), "utf8");
    const codeOnly = marketSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/ms\.compressBars = out/.test(codeOnly), "扫描必须写 compressBars");
    assert.ok(/ms\.compressMinMargin = COMPRESS_MIN_MARGIN/.test(codeOnly), "门槛必须写进 Memory（单一口径）");
    assert.ok(/const COMPRESS_MIN_MARGIN = 40|let COMPRESS_MIN_MARGIN = 40/.test(codeOnly), "门槛是 40%");
    assert.ok(/rawAsk \* 5 \+ energy \* 2/.test(codeOnly), "成本必须按 5 原矿 + 2 能量算");
    assert.ok(/Game\.time - ms\.compressScanAt < COMPRESS_SCAN_INTERVAL/.test(codeOnly),
        "扫描必须限频（每 500 tick），不能每 tick 调市场");
}

console.log("factory compress checks passed");
