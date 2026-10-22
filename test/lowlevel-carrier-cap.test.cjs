const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "strategy_lowLevel.js"), "utf8");

// 断言前剥掉注释：解释「为什么这样限」的注释里会原样引用被断言的表达式。
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── ① 低等级分支的搬运必须有编制上限 ───────────────────────────────────────
//
// 2026-10-22 实测 W26N58（RCL3）：原判断是 `carrier 数 < 1 || carryTasks.length`，
// 而源容器只要有能量 `carryTasks` 就非空 ⇒ 每 3 tick 派一只，22 小时攒到 **20 只搬运**，
// 其中 16 只空闲、19 只各抱 500 能量（约 9,500 能量躺在爬身上没法用）；spawn 被这堆
// 400 能量的搬运长期占着 ⇒ 800 能量的 upgrader 永远排不上，升级速率卡在 6/tick。
assert.ok(/let carrierTarget = Math\.max\(2, Math\.min\(3, Math\.ceil\(\(sourceCnt \+ keeperCnt\) \/ 2\)\)\)/.test(code),
    "搬运编制必须有上限（源数 + keeper 数折半，夹在 2~3 只）");

assert.ok(/if \(carrierCnt < 1 \|\| \(carryTasks\.length && carrierCnt < carrierTarget\)\)/.test(code),
    "派搬运必须同时满足「没到编制」；不能只看 carryTasks 非空（否则会无限派）");

// ── ② 编制上限不能自己膨胀 ─────────────────────────────────────────────────
const m = code.match(/let carrierTarget = ([^;]+);/);
assert.ok(m, "carrierTarget 必须存在");
assert.ok(!/carrierTarget \+= 2|carrierTarget = 7/.test(code),
    "低等级分支的编制不能像 RCL8 那样抬到 7（无 storage 的房根本供不起）");

// ── ③ 死房自救：一只都没有时必须无条件补 ──────────────────────────────────
assert.ok(/carrierCnt < 1/.test(code),
    "一个搬运都没有时必须能无条件补一只（否则死房永远起不来）");

// ── ④ 高等级分支的口径没被改坏（同一决策只能有一份阈值精神） ───────────────
const high = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
assert.ok(/carrierTarget = Math\.max\(2, Math\.min\(3, Math\.ceil\(\(sourceCnt \+ keeperCnt\) \/ 2\)\)\)/.test(high),
    "highLevel 的低等级口径应保持一致（2~3 只），改一侧不改另一侧迟早漂移");

console.log("low-level carrier cap checks passed");
