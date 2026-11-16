/**
 * T0/T1 扫货回归（用户 11-12 定稿规则）：
 *   ① 节拍必须能从 autoBuy 的实际调用偏移（Game.time % 100 == 81）命中。
 *   ② **不追价、不反复重挂**：已有单即使被超越也不动；只有超过硬上限
 *      （commodityBuyCap，默认 alloy ≤ 10）才一次性重挂到上限。
 *   ③ 成本含买入费（×1.05）、收入取保守价 min(最高买价, 历史均价) 并扣卖出费（×0.95）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "modules/strategy_market.js"), "utf8");
const start = source.indexOf("// ==== T0/T1 扫货决策（纯函数，测试按标记提取）====");
const end = source.indexOf("// ==== end ====");
assert.ok(start > 0 && end > start, "scan helper block must exist in strategy_market.js");

const context = { Game: { time: 0 }, Math };
context.global = context;
// 块内是 let 声明，不会挂到全局对象上；追加一行导出到 global 供测试取用
vm.runInNewContext(
    source.slice(start, end) + ";global.__scanHelpers = { scanUnderpricedDue, commodityBuyDecision, DEFAULT_COMMODITY_BUY_CAP, DEFAULT_CHAIN_CPU_PREMIUM, expandCommodityChain, BASE_TERMINAL_SET };",
    context,
    { filename: "market-scan-helpers.js" });
const { scanUnderpricedDue, commodityBuyDecision, DEFAULT_COMMODITY_BUY_CAP, DEFAULT_CHAIN_CPU_PREMIUM, expandCommodityChain, BASE_TERMINAL_SET } = context.__scanHelpers;

// ① 节拍：autoBuy 的调用 tick = 81 + 100k
const autoBuyTicks = [];
for (let t = 81; t <= 5000; t += 100) autoBuyTicks.push(t);
const oldGateHits = autoBuyTicks.filter(t => t % 500 === 0);
assert.equal(oldGateHits.length, 0, "negative control: 旧 %500==0 限频在 autoBuy 偏移上永不命中");
const dueHits = [];
for (const t of autoBuyTicks) {
    context.Game.time = t;
    if (scanUnderpricedDue()) dueHits.push(t);
}
assert.deepEqual(dueHits.slice(0, 4), [81, 581, 1081, 1581], "新节拍每 500 tick 命中一次");
for (let i = 1; i < dueHits.length; i++) {
    assert.equal(dueHits[i] - dueHits[i - 1], 500, "扫货间隔恒为 500 tick");
}

// ② 定价决策（不追价）
{
    // 无单：目标价 = max(竞争买价×1.02, 历史均价×0.9)
    let d = commodityBuyDecision(undefined, 5, 200, 1000);
    assert.deepEqual([d.action, +d.price.toFixed(2)], ["create", 180]);
}
{
    // 无单 + cap 更低：目标价被上限夹住
    let d = commodityBuyDecision(undefined, 5000, 9000, 1000);
    assert.deepEqual([d.action, d.price], ["create", 1000], "建单不得超过上限");
}
{
    // 已有单被超越，但仍在硬上限内：**不动**（不参与费用战）
    let d = commodityBuyDecision(5, 50, 10, 100);
    assert.equal(d.action, "none", "被超越也不追价");
}
{
    // 已有单超过硬上限：一次性重挂到上限（alloy 126 → 10）
    let d = commodityBuyDecision(126, 5, 140, 10);
    assert.deepEqual([d.action, d.price], ["recreate", 10], "超上限必须纠偏到上限");
}
{
    // 没有竞争买价、也没有历史价：按最小价 0.01 建单
    let d = commodityBuyDecision(undefined, 0, 0, 1000);
    assert.deepEqual([d.action, d.price], ["create", 0.01]);
}

// ④ 完整生产链展开：逐级累计 ops，只把 T0/T1 原料记为待采购量
{
    const COMMODITIES = {
        wire: { amount: 20, level: 1, cooldown: 8, components: { utrium_bar: 20, silicon: 100, energy: 40 } },
        switch: { amount: 10, level: 2, cooldown: 20, components: { wire: 10, utrium_bar: 10 } },
        transistor: { amount: 10, level: 3, cooldown: 40, components: { switch: 10, wire: 10 } },
    };
    const t01 = new Set(["silicon", "metal", "biomass", "mist", "wire", "alloy", "cell", "condensate"]);
    const priceOf = r => ({ utrium_bar: 200, energy: 30 }[r] || 0);
    const exp = expandCommodityChain(COMMODITIES, "transistor", 10, priceOf, 100, t01);
    assert.equal(exp.t01.wire, 20, "链上两处 wire（transistor 直配 10 + switch 消耗 10）都要计入");
    assert.equal(exp.otherCost, 2000, "utrium_bar 10 × 200 计入其他原料成本");
    assert.equal(exp.opsCost, 600, "每一级 ops 都要计入（transistor 4 + switch 2 = 6 ops × 100）");
}

// ⑤ 官方 COMMODITIES 的 bar↔矿物、能量↔电池是**可逆配方**，展开必须终止在基础资源
{
    const COMMODITIES = {
        switch: { amount: 5, level: 1, cooldown: 70, components: { wire: 40, oxidant: 95, utrium_bar: 35, energy: 20 } },
        oxidant: { amount: 100, cooldown: 20, components: { O: 500, energy: 200 } },
        O: { amount: 500, cooldown: 20, components: { oxidant: 100, energy: 200 } },   // 反向压缩，禁止循环
        utrium_bar: { amount: 100, cooldown: 20, components: { U: 500, energy: 200 } },
        U: { amount: 500, cooldown: 20, components: { utrium_bar: 100, energy: 200 } }, // 反向
        battery: { amount: 50, cooldown: 10, components: { energy: 600 } },
        energy: { amount: 500, cooldown: 10, components: { battery: 50 } },             // 反向
    };
    const t01 = new Set(["silicon", "metal", "biomass", "mist", "wire", "alloy", "cell", "condensate"]);
    const priceOf = r => ({ U: 10, O: 10, energy: 30 }[r] || 0);
    const exp = expandCommodityChain(COMMODITIES, "switch", 5, priceOf, 0, t01);
    assert.equal(exp.t01.wire, 40, "wire 作为可采购 T1 原料计入 t01");
    // oxidant 95 → O 475 + energy 190；utrium_bar 35 → U 175 + energy 70；直配 energy 20
    assert.equal(exp.otherCost, 475 * 10 + 175 * 10 + 280 * 30, "bar↔矿物循环必须终止在 U/O，成本只算一次");
    assert.equal(exp.missing, false, "终止集内的资源有价，不应标记缺价");
    // energy↔battery 同样必须终止
    const exp2 = expandCommodityChain(COMMODITIES, "battery", 50, priceOf, 0, t01);
    assert.equal(exp2.otherCost, 600 * 30, "battery 50 → energy 600（终止），不反向展开回 battery");
}

// ③ 默认硬上限与成本口径钉子
assert.equal(DEFAULT_COMMODITY_BUY_CAP.alloy, 10, "alloy 默认出价上限必须 ≤ 10");
assert.equal(DEFAULT_CHAIN_CPU_PREMIUM, 0.1, "完整链 CPU 开销默认按成本 10% 计");
assert.ok(BASE_TERMINAL_SET.has("energy") && BASE_TERMINAL_SET.has("U") && BASE_TERMINAL_SET.has("G"),
    "base terminal set must stop the reversible bar/mineral and energy/battery cycles");
assert.ok(source.includes("scanMarginPct) || 1000"),
    "default scan margin must be 1000% (profit/cost)");
assert.ok(source.includes("(revenue - totalCost) / totalCost * 100"),
    "chain margin must be profit/cost, not profit/revenue");
assert.ok(source.includes("r.revenue / (1 + marginPct / 100)"),
    "new-order cost budget must use revenue / (1 + margin) for profit/cost semantics");
assert.ok(source.includes("getResTypeHistory(RESOURCE_OPS)"),
    "ops must be included in the chain cost");
assert.ok(source.includes("expandCommodityChain(COMMODITIES"),
    "scan must evaluate full production chains, not single recipes");
assert.ok(source.includes("chainCpuPremium"),
    "CPU overhead must be configurable and applied to the chain cost");
assert.ok(source.includes("* (1 + cpuPremium)"),
    "chain cost must include the CPU premium");
assert.ok(source.includes("Math.min(buyHigh, histSale)"),
    "revenue must use the conservative min(top buy, history) price");
assert.ok(source.includes("recipe.amount * salePrice * 0.95"),
    "revenue must deduct the 5% sell-side market fee");
assert.ok(!source.includes("target > ourPrice * 1.02"),
    "competitive repricing branch must be removed");

console.log("market reprice checks passed");
