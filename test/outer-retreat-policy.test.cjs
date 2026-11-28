// 外矿撤退政策（用户 2026-11-26 / 2026-11-28 定稿）：
//   · 任何 Invader 出现 ⇒ 除 defenser 外的所有外矿爬退到矿区房外 1~2 格等待
//     （不再跑回主房 storage，Invader 清零后马上回矿）；
//   · 恰好 1 个 Invader ⇒ defenser 进场清理；
//   · ≥2 个 Invader ⇒ 不派任何 defenser，只按最后目击 TTL 等自然死；
//   · 有视野 ⇒ 直接按 Invader=0 解除；
//   · 无视野 ⇒ 按最后目击时的剩余 TTL 推算自然死亡，过期自动解除。
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

// ① 撤退状态：>=1 落闸；有视野看到 0 直接解除；无视野按最后目击 TTL 过期
{
    const m = /outerRetreatCheck\(roomOrName\) \{[\s\S]*?\n    \},/.exec(code);
    assert.ok(m, "outerRetreatCheck 必须存在");
    const body = m[0];
    assert.ok(/if \(count >= 1\) \{/.test(body) && /count: count/.test(body)
        && /expireAt: Game\.time \+ maxTtl \+ OUTER_INVADER_EXPIRE_MARGIN/.test(body),
        "任何 Invader（>=1）都必须触发撤退，并记录自然死亡到期时间");
    assert.ok(/else if \(mem\.outerRetreat\) delete mem\.outerRetreat;/.test(body),
        "有视野且 Invader=0 时必须直接解除撤退");
    assert.ok(code.includes("OUTER_INVADER_LIFE_FALLBACK") && code.includes("OUTER_INVADER_EXPIRE_MARGIN"),
        "无视野兜底必须使用 Invader 寿命常量");
}
{
    const m = /outerRetreatState\(roomName\) \{[\s\S]*?\n    \},/.exec(code);
    assert.ok(m && /if \(Game\.time > state\.expireAt\)/.test(m[0])
        && /delete mem\.outerRetreat/.test(m[0]),
        "无视野的撤退状态必须在最后目击 TTL 到期后自动解除");
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
assert.ok(code.includes("outerRetreatEdgeDistance(creep.pos, mineRoom)"),
    "撤退必须计算矿区边界距离");
assert.ok(/if \(waiting\) return;/.test(code),
    "已在矿区房外 1~2 格时必须原地等待，不得继续回主房");
assert.ok(/moveOuterCarrierOnRoad\(creep, task, data, -1\)/.test(code),
    "房外但还太远时必须反向朝矿区边界靠拢，而不是继续回主房");

// ②b 高优先级 reserver 补员也必须服从撤退：Invader 在场时连 claimer/reserver
// 都不许生（用户 2026-11-29 的 shard2_78439166_2 白跑案例）。
{
    const m = /trySpawnReservers\(spawnRoom\) \{[\s\S]*?\n    \},/.exec(code);
    assert.ok(m, "trySpawnReservers 必须可定位");
    assert.ok(/if \(pro\.outerRetreatCheck && pro\.outerRetreatCheck\(targetRoomName\)\) continue;/.test(m[0]),
        "reserver 补员必须先查 outerRetreat，Invader 在场时不得生 claimer/reserver");
}

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

// ⑤ 撤退期不再派 scouter：有 defenser 直接确认，没 defenser 等 TTL 自然到期
assert.ok(!strat.includes("retreatProbe"),
    "撤退分支不得再派 scouter/retreatProbe（用户 2026-11-29）");
assert.ok(/if \(outerRetreat\) \{[\s\S]{0,220}?continue;/.test(strat),
    "撤退状态仍必须直接 continue，不能进入外矿生产");

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