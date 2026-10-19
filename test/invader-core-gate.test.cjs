/**
 * 外矿的 Invader Core 闸门（用户 2026-10-19）：
 * 「如果 Invader Core 存在**并且快长大了**就停止外矿，**足够长时间消失之后再打开**」。
 *
 * 记忆由 `StationObserver.observeLastRoom` 在**有视野时**就地刷新（只给 1 tick 视野，
 * 而外矿策略每 6 tick 才决策一次 ⇒ 不能指望决策时能看见）。判据只读 Memory。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "strategy_outerHarvest.js"), "utf8");

function load(now = 100000, rooms = {}) {
    const ctx = {
        console: { log() {} },
        Memory: { rooms },
        Game: { time: now, flags: {}, rooms: {}, map: { getRoomLinearDistance: () => 1 } },
        global: null,
        _: { values: o => Object.values(o || {}) },
        FIND_MY_CREEPS: 1, FIND_HOSTILE_CREEPS: 2, FIND_STRUCTURES: 3,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_outerHarvest.js" });
    return ctx.StrategyOuterHarvest;
}

{
    // ① 没有任何记忆 ⇒ 不阻塞
    assert.equal(load(100000, {}).invaderCoreBlocks("W34N55"), false, "无记忆时不该阻塞");
}

{
    // ② 核心存在且**快成熟**（还剩 4000 tick ≤ WARN 5000）⇒ 停止外矿
    const pro = load(100000, { W34N55: { invaderCore: { lastSeen: 100000, deployAt: 104000 } } });
    assert.equal(pro.invaderCoreBlocks("W34N55"), true, "核心快成熟 ⇒ 必须停派");
}

{
    // ③ 核心存在但**还早**（还剩 20000 tick）⇒ 照常开采
    const pro = load(100000, { W34N55: { invaderCore: { lastSeen: 100000, deployAt: 120000 } } });
    assert.equal(pro.invaderCoreBlocks("W34N55"), false, "核心还很早 ⇒ 不该停");
}

{
    // ④ 核心**消失足够久**（4000 tick 没再看到 > GONE_CLEAR 3000）⇒ 恢复开采
    const pro = load(100000, { W34N55: { invaderCore: { lastSeen: 96000, deployAt: 96000 } } });
    assert.equal(pro.invaderCoreBlocks("W34N55"), false, "核心久未出现 ⇒ 恢复");
}

{
    // ⑤ 边界：刚到期（lastSeen 2900 tick 前）仍算存在
    const pro = load(100000, { W34N55: { invaderCore: { lastSeen: 97100, deployAt: 104000 } } });
    assert.equal(pro.invaderCoreBlocks("W34N55"), true, "尚在消失阈值内 ⇒ 仍按核心存在处理");
}

{
    // ⑥ 成熟时刻的边界：正好剩 WARN 停，超过 1 tick 就不停
    assert.equal(load(100000, { W34N55: { invaderCore: { lastSeen: 100000, deployAt: 105000 } } })
        .invaderCoreBlocks("W34N55"), true, "正好剩 WARN ⇒ 停");
    assert.equal(load(100000, { W34N55: { invaderCore: { lastSeen: 100000, deployAt: 105001 } } })
        .invaderCoreBlocks("W34N55"), false, "多 1 tick ⇒ 不停");
}

{
    // ⑦ 两个调用点都在（只测 helper 抓不到「helper 在、但没人调」）
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/if \(pro\.invaderCoreBlocks\(targetRoomName\)\) continue;/.test(code),
        "外矿策略必须在派发前调用 invaderCoreBlocks");
    const observer = fs.readFileSync(path.join(root, "modules", "station_observer.js"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/invaderCore = \{\s*lastSeen: Game\.time,\s*deployAt: Game\.time \+ \(core\.ticksToDeploy \|\| 0\),/.test(observer),
        "观察者必须在有视野时就地写入 lastSeen / deployAt");
    assert.ok(/STRUCTURE_INVADER_CORE/.test(observer), "观察者必须按 invaderCore 结构体识别");
}

console.log("invader core gate checks passed");
