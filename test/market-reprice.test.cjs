/**
 * T0/T1 扫货的两条回归：
 *   ① 节拍必须能从 autoBuy 的实际调用偏移（Game.time % 100 == 81）命中。
 *      原实现 `Game.time % 500 == 0` 与该同余式互斥 ⇒ 扫货从未执行。
 *   ② 定价决策：无单建单、被超越后按链上限追价、价差不足 2% 不重挂。
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
    source.slice(start, end) + ";global.__scanHelpers = { scanUnderpricedDue, commodityBuyDecision };",
    context,
    { filename: "market-scan-helpers.js" });
const { scanUnderpricedDue, commodityBuyDecision } = context.__scanHelpers;

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

// ② 定价决策
{
    // 无单：目标价 = max(竞争买价×1.02, 历史均价×0.9)
    let d = commodityBuyDecision(undefined, 5, 200, 1000);
    assert.deepEqual([d.action, +d.price.toFixed(2)], ["create", 180]);
}
{
    // 无单 + cap 更低：目标价被链上限夹住
    let d = commodityBuyDecision(undefined, 5000, 9000, 1000);
    assert.deepEqual([d.action, d.price], ["create", 1000], "追价不得超过链上限");
}
{
    // 已是最高买价：不重挂（180 > 180×1.02 不成立）
    let d = commodityBuyDecision(180, 5, 200, 1000);
    assert.equal(d.action, "none");
}
{
    // 被超越超过 2%：撤单重挂到目标价
    let d = commodityBuyDecision(100, 150, 200, 1000);
    assert.deepEqual([d.action, +d.price.toFixed(2)], ["reprice", 180]);
}
{
    // 现价已高于链上限：宁可保持不追（重挂只会亏）
    let d = commodityBuyDecision(1200, 5, 200, 1000);
    assert.equal(d.action, "none");
}
{
    // 没有竞争买价、也没有历史价：按最小价 0.01 建单
    let d = commodityBuyDecision(undefined, 0, 0, 1000);
    assert.deepEqual([d.action, d.price], ["create", 0.01]);
}

// ③ 口径钉子：默认利润率 1000%，margin 按「利润/成本」计算（与
//    StrategyMarketPrice.calculateAllCommoditiesProfit 的 profitMargin 同源），
//    且成本必须计入 ops（COMMODITIES.components 不含 ops）。
assert.ok(source.includes("scanMarginPct) || 1000"),
    "default scan margin must be 1000% (profit/cost)");
assert.ok(source.includes("(revenue - totalCost) / Math.max(totalCost, 1) * 100"),
    "chain margin must be profit/cost, not profit/revenue");
assert.ok(source.includes("r.revenue / (1 + marginPct / 100)"),
    "new-order cost budget must use revenue / (1 + margin) for profit/cost semantics");
assert.ok(source.includes("getResTypeHistory(RESOURCE_OPS)"),
    "ops must be included in the chain cost");
assert.ok(source.includes("recipe.cooldown && opsPrice > 0"),
    "ops cost is charged once per production run based on cooldown");

console.log("market reprice checks passed");
