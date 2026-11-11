/**
 * RoomVisual 只在创建当 tick 有效 —— getRoomVisual 的缓存必须按 tick 失效。
 *
 * 原实现（CODE_REVIEW 4-2  flagged，2026-11-12 修复）：`roomMap` 是模块级永久缓存，
 * `new RoomVisual(...)` 只在房间名第一次出现时创建。引擎的 RoomVisual 指令只收集
 * **创建当 tick** 的绘制，复用上一 tick 的实例画什么都不渲染 ⇒ 每个房间第一次之后
 * 的可视化（塔伤面板 / showText / showLine / showPath）全部静默不显示。
 *
 * 修法：按 tick 缓存 —— 同 tick 复用（省 CPU），跨 tick 重建。
 * 负对照：把按 tick 复位改回永久缓存，第 ② 组必须失败（文末 mutation 段）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "helper_visual.js"), "utf8");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── 源码层：按 tick 复位必须在代码里 ──────────────────────────────────────
{
    const code = strip(src);
    assert.ok(/if \(pro\.roomMapTick !== Game\.time\) \{/.test(code),
        "getRoomVisual 必须按 tick 失效缓存");
    assert.ok(/pro\.roomMap = \{\}/.test(code), "跨 tick 必须重建缓存表");
}

// ── 行为层 harness ────────────────────────────────────────────────────────
function makeHarness(mutate) {
    const ctx = {
        console,
        Game: { time: 100, flags: {}, cpu: { getUsed: () => 0 }, map: { visual: {} } },
        Memory: { rooms: {} },
        isCpuFeatureEnabled: () => true,
        _: { keys: o => Object.keys(o || {}) },
        Utils: {},
        RoomArray: function () { this.init = () => this; },
        CONTROLLER_STRUCTURES: {},
        __visuals: [],
    };
    ctx.global = ctx;
    ctx.RoomVisual = function (roomName) {
        this.roomName = roomName && roomName.name || roomName;
        this.createdTick = ctx.Game.time;
        this.ops = [];
        ctx.__visuals.push(this);
    };
    ctx.RoomVisual.prototype.text = function (...a) { this.ops.push(["text", ...a]); };
    ctx.RoomVisual.prototype.line = function (...a) { this.ops.push(["line", ...a]); };
    ctx.RoomVisual.prototype.poly = function (...a) { this.ops.push(["poly", ...a]); };
    vm.runInNewContext(mutate ? mutate(src) : src, ctx, { filename: "helper_visual.js" });
    return ctx;
}

// ── ① 同 tick 复用：同一房间只建一个实例 ─────────────────────────────────
{
    const ctx = makeHarness();
    const a = ctx.HelperVisual.getRoomVisual("R1");
    const b = ctx.HelperVisual.getRoomVisual("R1");
    assert.equal(a, b, "同 tick 内必须复用同一实例（省 CPU）");
    assert.equal(ctx.__visuals.length, 1, "同 tick 只允许创建一次");
}

// ── ② 跨 tick 重建：旧实例不再被返回（旧永久缓存在这里失败） ─────────────
{
    const ctx = makeHarness();
    const a = ctx.HelperVisual.getRoomVisual("R1");
    ctx.Game.time = 101;
    const b = ctx.HelperVisual.getRoomVisual("R1");
    assert.notEqual(a, b, "跨 tick 必须返回新实例（RoomVisual 只在创建当 tick 有效）");
    assert.equal(b.createdTick, 101, "新实例必须在当前 tick 创建");
    assert.equal(ctx.__visuals.length, 2);
}

// ── ③ 房间对象 / 字符串两种入参同 tick 归一 ──────────────────────────────
{
    const ctx = makeHarness();
    const a = ctx.HelperVisual.getRoomVisual({ name: "R2" });
    const b = ctx.HelperVisual.getRoomVisual("R2");
    assert.equal(a, b, "room 对象与房名同 tick 必须命中同一实例");
    assert.equal(a.roomName, "R2");
}

// ── ④ showText 跨 tick 真的画在新实例上（端到端） ────────────────────────
{
    const ctx = makeHarness();
    ctx.HelperVisual.showText("R1", "hello", { x: 5, y: 6 });
    ctx.Game.time = 101;
    ctx.HelperVisual.showText("R1", "world", { x: 7, y: 8 });
    assert.equal(ctx.__visuals.length, 2, "两个 tick 各建一个实例");
    assert.equal(ctx.__visuals[0].ops.length, 1, "第一 tick 的画在第一实例上");
    assert.equal(ctx.__visuals[1].ops.length, 1, "第二 tick 的画在第二实例上（旧实现这里为 0）");
    assert.equal(ctx.__visuals[1].ops[0][1], "world");
}

// ── ⑤ 变异负对照：改回永久缓存，跨 tick 用例必须如实失败 ─────────────────
{
    const mutated = makeHarness(s => s.replace(
        "if (pro.roomMapTick !== Game.time) {",
        "if (false) {"));
    const a = mutated.HelperVisual.getRoomVisual("R1");
    mutated.Game.time = 101;
    const b = mutated.HelperVisual.getRoomVisual("R1");
    assert.equal(a, b, "M1：永久缓存下跨 tick 返回旧实例（用例②咬得住）");
    mutated.HelperVisual.showText("R1", "lost", { x: 1, y: 1 });
    assert.equal(mutated.__visuals.length, 1, "M1：绘制落在旧实例上 ⇒ 静默不渲染");
}

console.log("visual room cache: OK");