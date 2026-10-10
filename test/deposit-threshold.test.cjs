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
const end = source.indexOf("let AVOID_ROOMS");
assert.ok(start > 0 && end > start, "MAX_COOL_DOWM_DEFAULT / AVOID_ROOMS 必须都在源码里");
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
    vm.runInNewContext(block + "\n__maxCoolDown = maxCoolDown;\n__boostCoolDown = boostCoolDown;",
        ctx, { filename: "deposits-consts.js" });
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

    // ⑤ boost 阈值必须**和采集上限同源**，不能落在可达范围之外（用户 10-10 指示）。
    //    原来写死 90，而采集闸在 80（现在 60）就关了 ⇒ `lastCooldown > 90` 恒假，
    //    deposit 采集爬从来没被 boost 过，准备的 boost 资源也从来没花出去。
    const b = load();
    assert.equal(b.__boostCoolDown(), 20, "shard3 缺省 = maxCoolDown()/2 = 20");
    assert.ok(b.__boostCoolDown() < b.__maxCoolDown(),
        "boost 点必须**严格小于**采集上限，否则永远触发不到（这就是原来那个死代码）");
    // 跟着采集上限走：调上限时 boost 点自动跟着变
    assert.equal(load({ marketSettings: { depositMaxCooldown: 80 } }).__boostCoolDown(), 40,
        "采集上限调到 80 → boost 点跟着变 40");
    assert.equal(load({ marketSettings: { depositBoostCooldown: 12 } }).__boostCoolDown(), 12,
        "boost 点可单独覆盖");

    // ⑥ 调用点必须全部走 maxCoolDown()，不能留硬编码的上限
    //    断言前先剥掉**行注释和块注释**：说明「为什么删掉旧写法/旧常量」的注释里会
    //    原样引用它们（`/** ... *\/` 里写了 `lastCooldown > 90` 恒假），
    //    只剥 `//` 会漏掉块注释 —— 这正是第一次跑这条断言踩的坑。
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!/\bMAX_COOL_DOWM\b/.test(codeOnly.replace(/MAX_COOL_DOWM_DEFAULT/g, "")),
        "不应再残留裸的 MAX_COOL_DOWM 引用（旧常量已改名）");
    assert.ok(codeOnly.includes("maxCoolDown()"), "判定点必须用 maxCoolDown()");
    // boost 断言必须落在**调用点**上：只查常量值抓不到「常量对、但用的时候写死了别的数」
    assert.ok(/lastCooldown\s*>\s*boostCoolDown\(\)/.test(codeOnly),
        "boost 判定点必须调用 boostCoolDown()");
    assert.ok(!/lastCooldown\s*>\s*90\b/.test(codeOnly),
        "不该再有写死的 boost 阈值 90（那样 boost 永远不会触发）");
    // 「派新队」与「续派补员」两道闸必须同源。原来续派会再加 offset
    // （walkableAroundCnt*10-10，最多 +20），把刚下调的阈值又抬回去 ——
    // 实测把派新队降到 40 后，45/56/57 的三个任务照旧在补员。
    assert.ok(!/lastCooldown\s*<\s*maxCoolDown\(\)\s*\+/.test(codeOnly),
        "续派闸不能再用 offset 放宽上限");
    assert.ok(!/let offset = Math\.min\(flag\.memory\.walkableAroundCnt/.test(codeOnly),
        "offset 只用来定在岗只数，不该再参与「挖多久」");
}

console.log("deposit harvest threshold checks passed");
