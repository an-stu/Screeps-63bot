const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "strategy_lowLevel.js"), "utf8");

// 断言前**必须剥掉注释**：解释「为什么这样排」的注释里会原样引用被断言的表达式，
// 只查字符串会把注释当成代码命中（这坑在项目里踩过）。
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── ① 升级容器的补给必须排在塔之前 ─────────────────────────────────────────
//
// 2026-10-21 实测 W26N58（RCL3、无 storage）：塔被修理动作持续抽干，于是
// `fillTowerTasks` 永远非空；原来是「先塔、后升级容器」，每一只空闲搬运都被塔吃掉，
// 结果控制器旁容器长期 0/2000、upgrader 抱 0 能量站着、控制器进度冻结在 12,336，
// 而降级计时器按 1/tick 往下走。升级容器上限只有 2000，先给它一只不挤占别人。
const upgFill = "StationUpgrade.generatorFillEnergyTask(room.name, upgCreep.getPartCnt(CARRY) * 50)";
const towerFill = "let fillTowerTasks = StationTower.generatorFillEnergyTasks(room)";
const upgIdx = code.indexOf(upgFill);
const towerIdx = code.indexOf(towerFill);

assert.ok(upgIdx >= 0, "升级容器的补给任务必须存在（否则 upgrader 永远拿不到能量）");
assert.ok(towerIdx >= 0, "塔的填充任务必须存在");
assert.ok(upgIdx < towerIdx,
    "升级容器的补给必须排在塔的填充任务**之前**：塔在低 RCL 是无限下沉，排前面会把搬运全吃掉");

// ── ② 塔已满且没有 storage 时，富余能量也要送去升级容器 ─────────────────────
//
// 没有这条兜底，搬运会抱着 500 能量原地待机（实测同房常态 1~4 只），
// 而控制器容器空着 —— 能量有，只是没人送。
assert.ok(/else\s*\{\s*let rest = StationUpgrade\.generatorFillEnergyTask\(/.test(code),
    "无 storage 且塔已满时，必须把富余能量送去升级容器（否则搬运抱电待机）");

// ── ③ 不能把「就地待机」写回去：升级容器任务不能在塔任务之前被 shift 消耗 ────
//
// 反向保险：这段代码里空集合分支不能再出现 `else { }`（空分支）而吞掉任务。
assert.ok(!/else\s*\{\s*\}/.test(code), "不能留空分支吞掉搬运任务");

console.log("upgrade fill priority checks passed");
