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

// ── ④ 高等级路径（strategy_highLevel）：升级补给不能挂在「storage 搬运任务」门后面 ──
//
// 2026-10-23 实测 W26N58（RCL4、刚建好 storage、还没有 link）：hive 已满 + 无 link
// ⇒ `generatorCarryStorageEnergyTask` 返回空 ⇒ 整段 `if (StorageCarryEnergyTasks.length)`
// 被跳过 ⇒ 升级容器 0/2000、upgrader 抱 0 能量、进度冻结 20+ tick。
{
    const highRaw = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");
    const high = highRaw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    const fillIdx = high.indexOf("StationUpgrade.generatorFillEnergyTask(room.name, freeCarries.head()");
    const gateIdx = high.indexOf("if (StorageCarryEnergyTasks.length) {");
    assert.ok(fillIdx >= 0, "高等级路径必须给升级容器派补给");
    assert.ok(gateIdx >= 0, "storage 搬运门应仍然存在（不能为了修这个把门删掉）");
    assert.ok(fillIdx < gateIdx,
        "升级补给必须在 `if (StorageCarryEnergyTasks.length)` **之前**：hive 满 + 无 link 时那个列表是空的，"
        + "挂在里面就永远不会派（实测进度冻结）");
}

// ── ⑤ 高等级路径：升级容器必须排在 hive / storage 之前 ─────────────────────
//
// hive 和 storage 都是无限下沉（storage 容量 100 万，永远填不满）。排在前面
// 就会把空闲运力全吃掉 —— 2026-10-23 实测：唯一一只 carrier 去填 storage(38,9)，
// 控制器容器(8,6) 一直是 0，upgrader 抱 0 能量、进度冻结。
{
    const highRaw2 = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");
    const high2 = highRaw2
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    const fill2 = high2.indexOf("StationUpgrade.generatorFillEnergyTask(room.name, freeCarries[0].getPartCnt(CARRY) * 50)");
    // 只能看 carrierManager **内部**的那个 hive 分支：文件里别处也有 HiveNeedToFill 调用。
    const cmStart = high2.indexOf("carrierManager(room) {");
    const hiveGate = high2.indexOf("if (StationHive.HiveNeedToFill(room)) {", cmStart);
    assert.ok(cmStart >= 0 && hiveGate > cmStart, "应能找到 carrierManager 与它内部的 hive 分支");
    assert.ok(fill2 >= 0, "carrierManager 顶部必须给升级容器发任务");
    assert.ok(hiveGate >= 0, "hive 填充分支应仍然存在");
    assert.ok(fill2 < hiveGate,
        "升级容器必须排在 `if (StationHive.HiveNeedToFill(room))` 之前：hive/storage 是无限下沉，"
        + "排前面会把运力吃光（实测控制器容器饿死到 0）");
}

// ── ⑥ 没有升级 link 的房：搬运编制要 +1（冗余） ──────────────────────────
//
// 2026-10-23 实测：只剩 1 只 carrier 的那段时间控制器容器一直是 0、进度冻结 40+ tick，
// 补到 2 只立刻恢复 10/tick。这类房（RCL4~5）需要一只冗余。
{
    const highRaw3 = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/if \(!upgLink\) carrierTarget = Math\.min\(4, carrierTarget \+ 1\)/.test(highRaw3),
        "无升级 link 的房必须 +1 搬运编制（否则单 carrier 死亡窗口里控制器容器会饿死）");
}

console.log("upgrade fill priority checks passed");
