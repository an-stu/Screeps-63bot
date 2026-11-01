const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules/strategy_resourceBalance.js"), "utf8");

// 提取 freightBudget 函数（对象方法简写），在桩环境里驱动真实实现
const m = raw.match(/    freightBudget\(fromRoom, toRoomName, resType, amount\) \{[\s\S]*?\n    \},/);
assert.ok(m, "freightBudget 必须存在");

function makeCtx(terminalEnergy, costPerUnit) {
    const ctx = {
        console,
        Game: {
            time: 1000,
            market: {
                calcTransactionCost: (amount, from, to) => Math.ceil(amount * costPerUnit),
            },
        },
        RESOURCE_ENERGY: "energy",
        FREIGHT_ENERGY_FLOOR: 2000,
    };
    ctx.global = ctx;
    vm.runInNewContext("var pro = {\n" + m[0] + "\n};", ctx, { filename: "freightBudget.js" });
    const fromRoom = {
        name: "W33N55",
        terminal: { store: { energy: terminalEnergy } },
    };
    return { ctx, fromRoom };
}

{
    // 非能量资源：预算 = (5000-2000)/0.1 = 30000 → amount=3000 不变
    const { ctx, fromRoom } = makeCtx(5000, 0.1);
    assert.equal(ctx.pro.freightBudget(fromRoom, "E59S38", "OH", 3000), 3000,
        "预算充足时按原数量发送");
}
{
    // 非能量资源：terminal 只剩 2100，预算 = 100/0.4 = 250 → 夹到 250
    const { ctx, fromRoom } = makeCtx(2100, 0.4);
    assert.equal(ctx.pro.freightBudget(fromRoom, "E59S38", "OH", 3000), 250,
        "运费预算必须把数量夹到付得起的范围");
}
{
    // 能量本身：costPerUnit = 1+0.1 = 1.1，预算 = 5000/1.1 = 4545
    const { ctx, fromRoom } = makeCtx(7000, 0.1);
    assert.equal(ctx.pro.freightBudget(fromRoom, "E59S38", "energy", 30000), 4545,
        "发能量时运费从同一份能量扣（净到货 = amount - cost）");
}
{
    // 预算紧张：affordable = floor(50/0.4) = 125 ≥ 100 → 返回 125（付得起）
    const { ctx, fromRoom } = makeCtx(2050, 0.4);
    assert.equal(ctx.pro.freightBudget(fromRoom, "E59S38", "OH", 3000), 125,
        "预算内能发多少发多少（运费正好落在保留线上）");
    // 预算不足：affordable = floor(20/0.4) = 50 < 100 → 返回 50，调用方按 <100 跳过
    const { ctx: c2, fromRoom: f2 } = makeCtx(2020, 0.4);
    assert.equal(c2.pro.freightBudget(f2, "E59S38", "OH", 3000), 50,
        "低于 TERMINAL_MIN_SEND 的返回值由调用方跳过");
}
{
    // 单位缓存：同房间对第二次调用不再查 calcTransactionCost
    const { ctx, fromRoom } = makeCtx(5000, 0.1);
    ctx.pro.freightBudget(fromRoom, "E59S38", "OH", 100);
    let calls = 0;
    ctx.Game.market.calcTransactionCost = () => { calls++; return 10; };
    ctx.pro.freightBudget(fromRoom, "E59S38", "OH", 100);
    assert.equal(calls, 0, "每单位运费必须按房间对缓存");
}

// 源码级：全部 terminal.send 调用点都必须先过运费预算
const sends = raw.match(/\.terminal\.send\(/g) || [];
const budgets = raw.match(/freightBudget\(/g) || [];
assert.equal(sends.length, 5, "resourceBalance 的发送点数量变化时请同步接运费预算");
assert.ok(budgets.length >= 6, "freightBudget 必须存在且被各发送点调用（1 定义 + 5 调用）");
assert.ok(raw.indexOf("freightBudget(fromRoom") > 0 || raw.indexOf("freightBudget(room") > 0,
    "freightBudget 必须以方法形式挂在 pro 上");

console.log("freight budget checks passed");
