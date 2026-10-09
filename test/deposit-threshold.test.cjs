/**
 * Deposit 采集上限（用户 2026-10-09：「减少采集 deposit、提高效率」）。
 *
 * `lastCooldown` 是**已挖掉的刻度**（0 = 刚出现，越大越接近耗尽）。上限从 60 降到 40，
 * 并且改成**读取时判 Memory**，这样 `Memory.marketSettings.depositMaxCooldown`
 * 改完立刻生效，不必等下一次重传代码。
 *
 * 只切出常量块跑（和 market-phase.test.cjs 同一手法），不加载整个模块 ——
 * strategy_deposits.js 的顶层还有一堆只有游戏里才有的依赖。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "modules/strategy_deposits.js"), "utf8");

const start = source.indexOf("let MAX_COOL_DOWM_DEFAULT");
const end = source.indexOf("let BOOST_COOL_DOWN");
assert.ok(start > 0 && end > start, "MAX_COOL_DOWM_DEFAULT / BOOST_COOL_DOWN 必须都在源码里");
const block = source.slice(start, end);

function load({ shard = "shard3", marketSettings = {} } = {}) {
    const ctx = {
        console,
        Game: { shard: { name: shard } },
        Memory: { marketSettings },
        global: null,
    };
    ctx.global = ctx;
    // `let` 在 VM 里是脚本作用域的，显式挂到 context 上才能读到
    vm.runInNewContext(block + "\n__maxCoolDown = maxCoolDown;", ctx, { filename: "deposits-consts.js" });
    return ctx;
}

{
    // ① shard3 缺省 = 40（原来 60）
    const ctx = load();
    assert.equal(ctx.__maxCoolDown(), 40, "shard3 的 deposit 采集上限必须是 40");

    // ② 其它 shard 保持原值（只动了 shard3）
    assert.equal(load({ shard: "shard2" }).__maxCoolDown(), 120, "shard2 不受影响");
    assert.equal(load({ shard: "shard1" }).__maxCoolDown(), 120, "shard1 不受影响");
    assert.equal(load({ shard: "shard0" }).__maxCoolDown(), 120, "shard0 不受影响");
    assert.equal(load({ shard: "shardX" }).__maxCoolDown(), 50, "未知 shard 走兜底 50");

    // ③ Memory 覆盖
    assert.equal(load({ marketSettings: { depositMaxCooldown: 25 } }).__maxCoolDown(), 25,
        "Memory.marketSettings.depositMaxCooldown 覆盖 shard 缺省");

    // ④ **活读**：改 Memory 立刻生效，不需要重传代码/重载模块
    const live = load({ marketSettings: {} });
    assert.equal(live.__maxCoolDown(), 40, "起始 40");
    live.Memory.marketSettings.depositMaxCooldown = 15;
    assert.equal(live.__maxCoolDown(), 15, "改 Memory 后立刻变 15（证明不是加载时固化的常量）");
    live.Memory.marketSettings.depositMaxCooldown = 0;
    assert.equal(live.__maxCoolDown(), 40, "设 0/非法值 → 回落到 shard 缺省");

    // ⑤ 调用点必须全部走 maxCoolDown()，不能留硬编码的上限
    //    （说明「为什么删掉旧常量」的注释里会引用旧名字，所以先剥 `//` 注释）
    const codeOnly = source.replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!/\bMAX_COOL_DOWM\b/.test(codeOnly.replace(/MAX_COOL_DOWM_DEFAULT/g, "")),
        "不应再残留裸的 MAX_COOL_DOWM 引用（旧常量已改名）");
    assert.ok(codeOnly.includes("maxCoolDown()"), "判定点必须用 maxCoolDown()");
}

console.log("deposit harvest threshold checks passed");
