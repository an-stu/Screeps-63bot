/**
 * power 相关的两条市场/采集规则（用户 2026-10-08 指示）：
 *
 *   1. **不买 power** —— autoBuyPower 从「建买单」改成「撤销自家的 power 买单」；
 *   2. **PB 采集阈值 5000 → 6000** —— 少于 6000 的 power bank 不去打。
 *
 * 用真实模块源码跑 VM（桩掉 call-time 依赖），负对照可直接验：
 * 把 autoBuyPower 换回旧实现（会建单），断言必须失败。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "modules", name), "utf8");

// ── 游戏常量（模块顶层那个 IIFE 会读） ──
function gameConstants() {
    const out = {};
    for (const name of ["BIOMASS", "SILICON", "METAL", "MIST", "WIRE", "ALLOY", "CONDENSATE",
        "CELL", "DEVICE", "CIRCUIT", "MICROCHIP", "TRANSISTOR", "SWITCH", "MACHINE",
        "HYDRAULICS", "FRAME", "FIXTURES", "TUBE", "ESSENCE", "EMANATION", "SPIRIT",
        "EXTRACT", "CONCENTRATE", "ORGANISM", "ORGANOID", "MUSCLE", "TISSUE", "PHLEGM",
        "ENERGY", "POWER", "OPS", "BATTERY", "UTRIUM", "LEMERGIUM", "ZYNTHIUM", "KEANIUM",
        "OXYDANT", "REDUCTANT", "CATALYST", "GHODIUM", "HYDROGEN", "OXYGEN"]) {
        out["RESOURCE_" + name] = name.toLowerCase();
    }
    out.ORDER_BUY = "buy";
    out.ORDER_SELL = "sell";
    out.STRUCTURE_TERMINAL = "terminal";
    out.STRUCTURE_TERMINAL_MARKET = "terminal";
    out.ERR_NOT_ENOUGH_RESOURCES = -6;
    out.OK = 0;
    out._ = { values: obj => Object.keys(obj || {}).map(k => obj[k]) };
    // lodash 的数组扩展：**旧实现**的路径会用到 maxBy / toSet，
    // 负对照要让旧代码真的跑起来（而不是因为缺桩抛错），否则「拒绝旧实现」
    // 只是桩不全的副作用，证明不了行为。
    out.Array = Array;
    if (!Array.prototype.toSet) {
        Object.defineProperty(Array.prototype, "toSet", {
            value: function () { return new Set(this); }, enumerable: false, configurable: true, writable: true,
        });
    }
    if (!Array.prototype.maxBy) {
        Object.defineProperty(Array.prototype, "maxBy", {
            value: function (fn) {
                let best, bestV;
                this.forEach(x => { let v = fn(x); if (best === undefined || v > bestV) { best = x; bestV = v; } });
                return best;
            }, enumerable: false, configurable: true, writable: true,
        });
    }
    return out;
}

function makeMarket(orders, cancelled, created, repriced) {
    return {
        orders,
        credits: 1000,
        cancelOrder(id) { cancelled.push(id); delete orders[id]; return 0; },
        createOrder(o) { created.push(o); return 0; },
        // 记录而不是抛错：旧实现会走到这里（它会把自家 power 买单抬价到市价）。
        // 抛错会让负对照「因为桩而失败」，证明不了行为 —— 记录则让旧实现跑完，
        // 在真正的行为断言上失败。
        changeOrderPrice(id, p) { repriced.push([id, p]); return 0; },
        deal() { return 0; },
        getAllOrders() { return []; },
    };
}

function loadMarket() {
    const orders = {
        "pb1": { id: "pb1", type: "buy", resourceType: "power", remainingAmount: 3000, price: 1.2, roomName: "W33N55" },
        "pb2": { id: "pb2", type: "buy", resourceType: "power", remainingAmount: 500, price: 0.9, roomName: "E41S23" },
        "en1": { id: "en1", type: "buy", resourceType: "energy", remainingAmount: 40000, price: 0.2, roomName: "W33N55" },
        "op1": { id: "op1", type: "buy", resourceType: "ops", remainingAmount: 12000, price: 0.5, roomName: "W33N55" },
        "sl1": { id: "sl1", type: "sell", resourceType: "power", remainingAmount: 700, price: 3, roomName: "W33N55" },
    };
    const cancelled = [];
    const created = [];
    const repriced = [];
    const ctx = Object.assign({
        console,
        Memory: { marketSettings: {}, stats: {} },
        isSaveCpu: true,
        Game: {
            time: 100000, shard: { name: "shard3" },
            market: makeMarket(orders, cancelled, created, repriced),
            rooms: {}, flags: {}, creeps: {}, cpu: { bucket: 5000, limit: 20 },
        },
        ManagerRooms: { getNormalRoom: () => [] },
        StationHive: { isEnergyAbundant: () => true },
        StationCarry: { roomMassStoreCnt: () => 0 },
        // 旧实现（负对照）要用到这两个；新实现不需要。
        StrategyMarketPrice: { getResTypeHistory: () => 0.1 },
        HelperError: { catchError: fn => fn() },
        global: null,
    }, gameConstants());
    ctx.global = ctx;
    vm.runInNewContext(read("strategy_market.js"), ctx, { filename: "strategy_market.js" });
    // 模块顶层会 `global.StrategyMarket = pro`，所以必须在加载**之后**补这个方法
    // （旧实现的负对照路径会调它；新实现不调）。
    ctx.StrategyMarket.getAllOrdersCacheList = () => [];
    return { S: ctx.StrategyMarket, orders, cancelled, created, repriced };
}

{
    // ① power 买单必须被撤销
    const m = loadMarket();
    m.S.autoBuyPower();
    assert.deepEqual(m.cancelled.sort(), ["pb1", "pb2"], "自家 power 买单要全部撤掉");

    // ② 一张新的都不许建
    assert.equal(m.created.length, 0, "绝不能建新的 power 买单");
    assert.equal(m.repriced.length, 0, "也不该再去改任何买单的价格（旧实现会抬价）");

    // ③ 别的资源不许误伤：energy / ops 的买单、以及 power 的**卖单**都要留着
    assert.ok(m.orders.en1, "energy 买单不能被误撤");
    assert.ok(m.orders.op1, "ops 买单不能被误撤");
    assert.ok(m.orders.sl1, "power 的卖单不能被误撤（只撤买单）");
    assert.equal(Object.keys(m.orders).length, 3, "只应留下 en1 / op1 / sl1");
}

{
    // ④ 没有 power 买单时也不能报错、不能建单
    const m = loadMarket();
    delete m.orders.pb1; delete m.orders.pb2;
    m.S.autoBuyPower();
    assert.equal(m.cancelled.length, 0, "没有 power 买单就没有动作");
    assert.equal(m.created.length, 0, "还是不建单");
}

{
    // ⑤ PB 采集阈值 = 6000（用户要求从 5000 抬到 6000）
    const src = read("strategy_powerBank.js");
    const m = src.match(/let\s+MIN_POWER\s*=\s*(\d+)/);
    assert.ok(m, "strategy_powerBank.js 里必须有 MIN_POWER 常量");
    assert.equal(Number(m[1]), 6000, "PB 采集阈值必须是 6000");
    // 那层「桶自适应」当年取值恒 ≤ 5000（后来的 MIN_POWER），等于死代码，
    // 而且 MIN_POWER 抬到 6000 后它会把阈值偷偷降回 5000 —— 必须删干净。
    // 断言前先剥掉 `//` 行注释：说明「它为什么被删」的注释里会原样引用那句表达式，
    // 直接匹配会误报（这正是第一版断言踩的坑）。
    const codeOnly = src.replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!/powerBankData\.power\s*<\s*Math\.min\(/.test(codeOnly),
        "桶自适应那层必须删掉，否则阈值会被它盖回 5000");
    assert.ok(!/isSaveCpu\s*&&\s*powerBankData\.power\s*</.test(codeOnly),
        "「CPU 模式下的第二道 power 门槛」也应当一并消失");
    // 不该再有硬编码的 5000 power 门槛
    assert.ok(!/power\s*<\s*5000/.test(codeOnly), "不该再有硬编码的 5000 power 门槛");
}

console.log("power market / power bank threshold checks passed");
