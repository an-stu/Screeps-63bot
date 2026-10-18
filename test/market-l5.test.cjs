const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
// 工作区按 .gitattributes 是 CRLF；这里先归一化，便于按行提取函数。
const priceSource = fs.readFileSync(path.join(root, "modules/strategy_marketPrice.js"), "utf8")
    .replace(/\r\n/g, "\n");
const marketSource = fs.readFileSync(path.join(root, "modules/strategy_market.js"), "utf8")
    .replace(/\r\n/g, "\n");

// ── 日高纯函数：Game.market.getHistory 只有 avgPrice/stddevPrice ──────────────
const start = priceSource.indexOf("function recentDailyHighFromHistory");
const end = priceSource.indexOf("\n}\n", start);
assert.ok(start > 0 && end > start, "recentDailyHighFromHistory must exist in strategy_marketPrice.js");
const block = priceSource.slice(start, end + 3);

const context = { Math };
vm.runInNewContext(`${block}\nthis.fn = recentDailyHighFromHistory;`, context, {
    filename: "recentDailyHighFromHistory.js",
});
const fn = context.fn;

assert.equal(fn([], 1), 0, "empty history → 0");
assert.equal(fn([{ avgPrice: 100, stddevPrice: 10 }], 1), 110, "day high ≈ avg + stddev");
assert.equal(fn([{ avgPrice: 100, stddevPrice: 10 }, { avgPrice: 120, stddevPrice: 5 }], 1), 125,
    "latest day wins for days=1");
assert.equal(fn([{ avgPrice: 100, stddevPrice: 10 }, { avgPrice: 120, stddevPrice: 5 }], 2), 125,
    "days=2 takes the max");
assert.equal(fn([{ avgPrice: 100 }], 1), 100, "missing stddev falls back to avg");
assert.equal(fn([{ avgPrice: 100, stddevPrice: 10 }], 0), 110, "days=0 is clamped to 1");

// ── 卖出侧：L5 用最近日高，L5 最小成交量放宽到 1 ─────────────────────────────
assert.ok(priceSource.includes("getRecentDailyHigh"),
    "strategy_marketPrice must expose getRecentDailyHigh");
assert.ok(marketSource.includes("getRecentDailyHigh(resType)"),
    "L5 deal path must use the recent daily high");
assert.ok(marketSource.includes("dailyHighTolerance"),
    "daily high tolerance must be configurable");
assert.ok(marketSource.includes("commodityLevel >= 5 ? 1 : MARKET_MIN_COMMODITY_DEAL"),
    "L5 min deal must be 1; L0-L4 keep 100");
assert.ok(marketSource.includes("Memory.marketSales"),
    "successful deals must be logged to Memory.marketSales");
assert.ok(marketSource.includes("Memory.diagSell"),
    "L5 sell reference must be logged to Memory.diagSell");

// 负对照：L0~L4 的旧价格门槛必须还在（不能被 L5 的日高逻辑覆盖）
assert.ok(marketSource.includes("historyAvg * (1 + dealPremium)"),
    "L0-L4 must keep the history-average premium gate");

// ── 买入侧：真实利润率门槛，低利润/无买单不许买 ─────────────────────────────
assert.ok(marketSource.includes("bestPriceOf"),
    "high-profit buying must inspect current orders");
assert.ok(marketSource.includes("realMargin < threshold"),
    "high-profit buying must skip low real margins");
assert.ok(marketSource.includes("no-buy-order"),
    "high-profit buying must skip products without a buy order");
assert.ok(marketSource.includes("Memory.diagBuy"),
    "buy decisions must be logged to Memory.diagBuy");
assert.ok(marketSource.includes("keepComponents"),
    "components still needed by a high-profit product must be kept");
assert.ok(marketSource.includes("diag.canceled"),
    "low-profit component buy orders must be canceled and logged");
assert.ok(marketSource.includes("highProfitBuyPremium"),
    "cheap-buy premium must be configurable");
assert.ok(marketSource.includes("highProfitOrderMax"),
    "single component order size must be capped");
assert.ok(marketSource.includes("noCheap"),
    "asks above the cheap-buy ceiling must be logged");
const buyStart = marketSource.indexOf("autoBuyHighProfitComponents()");
const buyEnd = marketSource.indexOf("autoBuyDepo(", buyStart);
assert.ok(buyStart > 0 && buyEnd > buyStart, "autoBuyHighProfitComponents must exist");
const buyBlock = marketSource.slice(buyStart, buyEnd);
assert.ok(!buyBlock.includes("Game.market.createOrder"),
    "high-profit buying must not place resting orders (the 21k metal order)");
assert.ok(buyBlock.includes("maxBuyPrice") && buyBlock.includes("minSellPrice > maxBuyPrice"),
    "only asks at/below history+premium may be bought");

console.log("market L5 / daily-high / real-margin checks passed");
