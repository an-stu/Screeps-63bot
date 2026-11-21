const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, "modules", f), "utf8");
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const src = read("station_sources.js");
const code = strip(src);
const strat = strip(read("strategy_outerHarvest.js"));

// ── 外矿防守 / 撤退政策（用户 2026-11-21）──────────────────────────────────
//
// 现场问题三条：
//   ① 防守爬有时不去打 invader（卡着）
//   ② 只有一个 invader 却派了两只
//   ③ 多 invader 时要求「所有爬都离开房间直到它们死亡」
// 根因：撤退状态只能靠 5000 tick 硬过期解除（≈4.3 小时停矿），因为全员撤出后
// 房里没视野、数不到 invader；且无视野时编制退回基线 2。

// ① 盲态宽限：必须存在，且在外视野分支里用上
assert.ok(/const OUTER_RETREAT_BLIND_TICKS = \d+;/.test(code), "必须有 OUTER_RETREAT_BLIND_TICKS 常量");
{
    const m = /outerRetreatCheck\(roomOrName\) \{[\s\S]*?\n    \},/.exec(code);
    assert.ok(m, "outerRetreatCheck 必须存在");
    const body = m[0];
    assert.ok(/else if \(mem\.outerRetreat && Game\.time - mem\.outerRetreat\.tick > OUTER_RETREAT_BLIND_TICKS\)/.test(body),
        "没视野时必须按 OUTER_RETREAT_BLIND_TICKS 作废撤退（否则全员撤出后永远解除不了）");
    assert.ok(/delete mem\.outerRetreat;/.test(body), "宽限到期要删掉撤退状态");
}

// ② 编制：无视野时普通矿房（没有 lair 记录）默认 1 只
{
    const m = /outerDefenseQuota\(room, roomName\) \{[\s\S]*?\n    \},/.exec(code);
    assert.ok(m, "outerDefenseQuota 必须存在");
    const body = m[0];
    assert.ok(/let lairs = Number\(mem\.outerLairCount\) \|\| 0;/.test(body), "无视野时要用缓存的 lair 数");
    assert.ok(/if \(lairs\) return Math\.max\(base, Math\.min\(4, Math\.ceil\(lairs \/ 2\)\)\);/.test(body),
        "keeper 房按窝数算编制");
    assert.ok(/return 1;\s*$/m.test(body) || /\n            return 1;/.test(body),
        "普通矿房无视野时编制必须退回 1（不能退回基线 2）");
    assert.ok(/if \(seen && seen\.n >= 1\) return 1;/.test(body), "看到过 ≥1 只 invader ⇒ 1 只");
}
// lair 数要被缓存，否则无视野时算不出 keeper 房编制
assert.ok(/room\.memory\.outerLairCount = lairs\.length;/.test(code), "defenseLairs 必须缓存 outerLairCount");

// ③ 所有外矿爬都要撤退（缺一个就会有人留在房里送死）
const OUTER_TASKS = [
    "harvestEnergyOuterKeeper", "harvestMineralOuterKeeper", "harvestMineralOuterCarry",
    "buildOuterMineralContainer", "reserveOuterHar", "outerDefense",
    "harvestEnergyOuterCarry", "harvestEnergyOuterCarryRoadBuilder",
];
for (const name of OUTER_TASKS) {
    const re = new RegExp(`Creep\\.prototype\\.${name} = function \\(\\) \\{[\\s\\S]{0,400}?outerRetreatCheck`);
    assert.ok(re.test(code), `${name} 必须做撤退检查`);
}
// 空任务栈不能抛 TypeError（那会每 tick 静默卡死）
assert.ok(!/if \(pro\.outerRetreatCheck\(task\.roomName\)\)/.test(code), "撤退检查必须先判 task 存在");
assert.ok(/if \(task && task\.mineRoom && pro\.outerRetreatCheck\(task\.mineRoom\)\)/.test(code), "路线维修爬用 mineRoom 判撤退");

// ④ 撤退闸必须排在派兵之前（否则派进去的兵当 tick 又被撤，在房界来回走）
{
    const retreatIdx = strat.indexOf("StationSources.outerRetreatCheck(targetRoomName)");
    const defIdx = strat.indexOf("StationSources.trySpawnOuterDefenser(targetRoomName");
    // 用带 pro. 前缀的**调用点**，否则 indexOf 会命中更靠前的函数定义
    const coreIdx = strat.indexOf("pro.spawnCoreBuster(targetRoomName");
    assert.ok(retreatIdx > 0 && defIdx > retreatIdx, "撤退闸必须在 trySpawnOuterDefenser 之前");
    assert.ok(coreIdx > retreatIdx, "撤退闸必须在 core 专队之前");
}

// ⑤ 盲态探头：撤退期间派 1-MOVE scouter 拿视野
assert.ok(/retreatProbe\(flag, spawnRoom, targetRoomName\);/.test(strat), "撤退分支必须调用 retreatProbe");
assert.ok(/retreatProbe\(flag, spawnRoom, mineRoom\) \{/.test(strat), "retreatProbe 必须存在");
{
    const m = /retreatProbe\(flag, spawnRoom, mineRoom\) \{[\s\S]*?\n    \},/.exec(strat);
    assert.ok(m, "retreatProbe 实现必须可定位");
    const body = m[0];
    assert.ok(/if \(Game\.rooms\[mineRoom\]\) return;/.test(body), "有视野时不重复派探头");
    assert.ok(/Game\.time - mem\.retreatProbeAt < 40/.test(body), "探头要节流（40 tick）");
    assert.ok(/\[MOVE\], "scouter"/.test(body), "探头必须是最便宜的 1-MOVE scouter");
}

// ⑥ ≥2 invader 时不派防守（撤退政策接管）
assert.ok(/if \(harRoom && pro\.outerInvaderCount\(harRoom\) >= 2\) return null;/.test(code),
    "≥2 invader 时必须停止派防守爬");

// ⑦ 无威胁的普通矿房：防守爬要退役，不能站到 ttl 耗尽
//
// 实测 2026-11-21 shard2 E52S29：outerInvaderSeen={n:0}、outerLairCount=0，
// 却长期站着 2 只防守爬（没有窝就没有岗位，它们只会原地站到死）。
assert.ok(/const OUTER_DEFENDER_IDLE_RECYCLE = \d+;/.test(code), "必须有闲置退役阈值常量");
assert.ok(/outerDefenderIdleShouldRetire\(creep, room\) \{/.test(code), "必须有退役判定函数");
{
    const m = /outerDefenderIdleShouldRetire\(creep, room\) \{[\s\S]*?\n    \},/.exec(code);
    const body = m[0];
    assert.ok(/if \(pro\.defenseLairs\(room\)\.length\) \{ delete creep\.memory\.idleSince; return false; \}/.test(body),
        "keeper 房（有 lair）永不退役");
    assert.ok(/if \(hostiles\.length\) \{ delete creep\.memory\.idleSince; return false; \}/.test(body),
        "有活体敌人时不退役");
    assert.ok(/OUTER_DEFENDER_IDLE_RECYCLE/.test(body), "退役判据要用安静时长");
}
// 必须接在 outerDefense 的**撤退检查之后**、且用回收任务（不是 suicide）
{
    const m = /Creep\.prototype\.outerDefense = function \(\) \{[\s\S]*?\n\};/.exec(code);
    assert.ok(m, "outerDefense 必须可定位");
    const body = m[0];
    const retireIdx = body.indexOf("outerDefenderIdleShouldRetire");
    assert.ok(retireIdx > 0, "outerDefense 必须调用退役判定");
    assert.ok(body.indexOf("recycleCreep", retireIdx) > retireIdx, "退役要走 recycleCreep（回收能量）");
    assert.ok(body.indexOf("outerRetreatCheck") < retireIdx, "撤退检查要排在退役之前（撤退优先）");
}

// ⑧ 没有窝可守时不许朝矿点容器走（对穿根因，用户 2026-11-21）
//
// shard2 E52S29：lair=0 ⇒ outerDefensePosts 返回空 ⇒ 两只防守爬都朝同一个
// station 容器走，每 tick 互相挤开（位置逐 tick 互换）。
{
    const m = /Creep\.prototype\.outerDefense = function \(\) \{[\s\S]*?\n\};/.exec(code);
    const body = m[0];
    assert.ok(!/let mineral = this\.headTaskObj\(\);/.test(body), "旧的「无条件朝任务目标走」必须移除");
    assert.ok(/let mineralTarget = obj && obj\.mineralType !== undefined;/.test(body),
        "只有矿物/存款目标才值得贴上去守");
    assert.ok(/if \(mineralTarget && !this\.pos\.inRangeTo\(obj, 3\)\)/.test(body),
        "能量矿房待命时不再移动");
}

// ⑨ 超编立刻退役：编制 1 却站 2 只时，只留 ttl 最长的一只
assert.ok(/if \(mates\.length > quota\) \{/.test(code), "必须有超编判定");
assert.ok(/\(b\.ticksToLive \|\| 0\) - \(a\.ticksToLive \|\| 0\)/.test(code), "按 ttl 最长者留一只");

// ⑩ 单只 invader 一律 1 只编制（不再按窝数加编）
assert.ok(/if \(invaders\.length === 1\) return 1;/.test(code),
    "单只 invader 必须直接返回 1（用户 2026-11-21）");

console.log("outer retreat policy checks passed");
