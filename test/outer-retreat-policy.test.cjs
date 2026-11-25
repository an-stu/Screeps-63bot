// 外矿撤退政策（用户 2026-11-26 定稿）：
//   · 任何 Invader 出现 ⇒ 除 defenser 外的所有外矿爬回主房等待；
//   · 恰好 1 个 Invader ⇒ defenser 进场清理；
//   · ≥2 个 Invader ⇒ 不派任何 defenser，只侦察到确认清零；
//   · 解除必须来自实际视野里的 Invader=0（defenser 或侦察兵确认），
//     失视野期间不得自动解除。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, "modules", f), "utf8");
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const src = read("station_sources.js");
const code = strip(src);
const strat = strip(read("strategy_outerHarvest.js"));
const creepCode = strip(read("prototype_creep.js"));

// ① 撤退状态：>=1 落闸；只有实际看到 0 才解除；没有盲态自动解除
{
    const m = /outerRetreatCheck\(roomOrName\) \{[\s\S]*?\n    \},/.exec(code);
    assert.ok(m, "outerRetreatCheck 必须存在");
    const body = m[0];
    assert.ok(/if \(count >= 1\) mem\.outerRetreat = \{tick: Game\.time, count: count\};/.test(body),
        "任何 Invader（>=1）都必须触发全员撤退");
    assert.ok(/else if \(mem\.outerRetreat\) delete mem\.outerRetreat;/.test(body),
        "实际视野里 Invader=0 才解除撤退");
    assert.ok(!/OUTER_RETREAT_BLIND_TICKS/.test(code) && !/OUTER_RETREAT_STALE_TICKS/.test(code),
        "失视野不得靠超时自动解除，必须等 defenser/侦察兵确认清零");
}
{
    const m = /outerRetreatState\(roomName\) \{[\s\S]*?\n    \},/.exec(code);
    assert.ok(m && !/delete mem\.outerRetreat/.test(m[0]),
        "outerRetreatState 不得自行过期删除状态");
}

// ② 除 defenser 外的所有外矿任务都必须先撤退
const RETREAT_TASKS = [
    "harvestEnergyOuterKeeper", "harvestMineralOuterKeeper", "harvestMineralOuterCarry",
    "buildOuterMineralContainer", "reserveOuterHar",
    "harvestEnergyOuterCarry", "harvestEnergyOuterCarryRoadBuilder",
];
for (const name of RETREAT_TASKS) {
    const re = new RegExp(`Creep\\.prototype\\.${name} = function \\(\\) \\{[\\s\\S]{0,450}?outerRetreatCheck`);
    assert.ok(re.test(code), `${name} 必须执行撤退检查`);
}
assert.ok(!/if \(pro\.outerRetreatCheck\(task\.roomName\)\)/.test(code),
    "撤退检查必须先判 task 存在");
assert.ok(/if \(task && task\.mineRoom && pro\.outerRetreatCheck\(task\.mineRoom\)\)/.test(code),
    "路线维修爬用 mineRoom 判撤退");

// ③ defenser：1 只 Invader 留场打；>=2 才撤退
{
    const m = /Creep\.prototype\.outerDefense = function \(\) \{[\s\S]*?\n\};/.exec(code);
    assert.ok(m, "outerDefense 必须可定位");
    const body = m[0];
    assert.ok(/let retreat = task && pro\.outerRetreatCheck\(task\.roomName\);/.test(body),
        "defenser 也要读取当 tick 的撤退状态");
    assert.ok(/if \(retreat && retreat\.count >= 2\) return pro\.outerRetreatMove\(this, false\);/.test(body),
        "defenser 只在 Invader>=2 时撤退；单个 Invader 必须留场清理");
    const retireIdx = body.indexOf("outerDefenderIdleShouldRetire");
    assert.ok(retireIdx > 0 && body.indexOf("outerRetreatCheck") < retireIdx,
        "撤退判断要排在退役判断之前");
    assert.ok(!body.includes("if (task && pro.outerRetreatCheck(task.roomName)) return pro.outerRetreatMove"),
        "不得恢复「任何撤退状态下 defenser 都离场」的旧逻辑");
}

// ④ 派兵顺序：先尝试单 Invader 的 defenser，再让经济生产撤退
{
    const retreatIdx = strat.indexOf("StationSources.outerRetreatCheck(targetRoomName)");
    const defIdx = strat.indexOf("StationSources.trySpawnOuterDefenser(targetRoomName");
    const continueIdx = strat.indexOf("if (outerRetreat) {", defIdx);
    assert.ok(retreatIdx > 0 && defIdx > retreatIdx && continueIdx > defIdx,
        "defenser 派发必须在撤退 continue 之前，保证单 Invader 仍有兵清理");
    assert.ok(/if \(isInvader \|\| outerRetreat\)/.test(strat),
        "有威胁或撤退状态下都要尝试 defenser 派发（>=2 由派兵函数拒绝）");
    assert.ok(/if \(!outerRetreat\) \{[\s\S]{0,300}spawnCoreBuster/.test(strat),
        "core/tower 专队只在未撤退时派");
}

// ⑤ 侦察探头：无视野时每 40 tick 派 1-MOVE 侦察兵确认
assert.ok(/retreatProbe\(flag, spawnRoom, targetRoomName\);/.test(strat),
    "撤退分支必须调用 retreatProbe");
assert.ok(/retreatProbe\(flag, spawnRoom, mineRoom\) \{/.test(strat),
    "retreatProbe 必须存在");
{
    const body = /retreatProbe\(flag, spawnRoom, mineRoom\) \{[\s\S]*?\n    \},/.exec(strat)[0];
    assert.ok(/if \(Game\.rooms\[mineRoom\]\) return;/.test(body), "有视野时不重复派探头");
    assert.ok(/Game\.time - mem\.retreatProbeAt < 40/.test(body), "探头要节流（40 tick）");
    assert.ok(/\[MOVE\], "scouter"/.test(body), "探头必须是最便宜的 1-MOVE scouter");
}
assert.ok(/scouterToRoom = function \(\) \{[\s\S]{0,700}?StationSources\.outerRetreatCheck/.test(creepCode),
    "侦察兵到场必须用真实视野确认是否清零");

// ⑥ >=2 Invader 不派 defenser（视野内或撤退状态缓存都拒绝）
assert.ok(/if \(retreat && retreat\.count >= 2\) return null;/.test(code),
    "撤退状态记录 >=2 时必须停止派防守");
assert.ok(/if \(harRoom && pro\.outerInvaderCount\(harRoom\) >= 2\) return null;/.test(code),
    "当前视野内 >=2 时必须停止派防守");
assert.ok(/if \(invaders\.length >= 2\) return 1;/.test(code),
    "≥2 时编制仍固定 1（但派兵闸会拒绝，不能复活多兵）");

// ⑦ 无威胁的普通矿房：防守爬要退役，不能站到 ttl 耗尽
{
    const body = /Creep\.prototype\.outerDefense = function \(\) \{[\s\S]*?\n\};/.exec(code)[0];
    const retireIdx = body.indexOf("outerDefenderIdleShouldRetire");
    assert.ok(body.indexOf("recycleCreep", retireIdx) > retireIdx,
        "退役要走 recycleCreep（回收能量）");
}

// ⑧ 单只 invader：普通矿房编制 1；keeper 房仍按窝数
{
    const m = /if \(invaders\.length === 1\) \{[\s\S]*?\n        \}/.exec(code);
    assert.ok(m, "1 invader 分支必须存在");
    assert.ok(/if \(lairs\) return Math\.max\(1, Math\.min\(4, Math\.ceil\(lairs \/ 2\)\)\);/.test(code),
        "keeper 房仍按「一爬管两窝」");
    assert.ok(/if \(lairs\) return Math\.max\(1, Math\.min\(4, Math\.ceil\(lairs \/ 2\)\)\);\s*\n\s*return 1;/.test(code),
        "普通矿房（无 lair）单只 invader 返回 1");
}

console.log("outer retreat policy checks passed (1 fights, 2+ scout-only)");