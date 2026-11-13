/**
 * 跨房走位的「永不踏入」名单必须包含 W31N59（Daozen 的 RCL8 塔房）。
 *
 * 2026-11-13 线上实测（shard3）：
 *   - `deposit_W31N55_W31N60_22_33`（silicon，lastCooldown 0）派出的队伍从 W31N55 北上，
 *     `Game.map.findRoute` 的最短路是 W31N56,57,58,**59**,60 —— W31N59 是 Daozen 的 RCL8 房，
 *     2 座塔 + 42 面墙/rampart，进去就是死；
 *   - W31N59 内 3 座我方墓碑（2 只 22WORK 采集 + 1 只 23CARRY 搬运，ttd 167/176/189 同批阵亡），
 *     全部停在 (17,48) 南入口，合计 1,583 能量白扔；随后 `beAttackTime` 又刷新 ⇒ 替换爬在往里走。
 *
 * 判据落在「名单」上而不是「某只爬的路径」上：`strategy_deposits` 只用 `moveTo(flag)`，
 * 跨房路线由 BetterMove 的 `routeCallback` 按这份名单裁剪，名单缺房 = 无人拦截。
 *
 * 负对照：`W31N60`（deposit 目标房）绝不能被拉黑，否则任务永远到不了；
 * 同时断言只在注释里出现的房间名不会被当成名单成员（防止「剥注释」退化成裸文本匹配）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/超级移动优化hotfix 0.9.4.js"), "utf8");

/** 剥掉行注释与块注释（字符串里的 // 不处理：这份文件没有 URL 字面量）。 */
function stripComments(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** 取出 `let avoidRooms = [ ... ]` 里的房间名。 */
function readAvoidRooms(code) {
    const m = stripComments(code).match(/let\s+avoidRooms\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(m, "没找到 avoidRooms 数组字面量");
    return [...m[1].matchAll(/["']([A-Z]\d+[NSEW]\d+)["']/g)].map(x => x[1]);
}

const clean = stripComments(src);
const rooms = readAvoidRooms(src);

// 1) 名单读取本身要可用
assert.ok(rooms.length >= 13, "avoidRooms 至少应保留原有的 13 个房间，实际 " + rooms.length);
assert.ok(rooms.includes("W35N51"), "原有房间 W35N51 丢失，说明解析跑偏");

// 2) 本次修复：W31N59 必须在名单里
assert.ok(
    rooms.includes("W31N59"),
    "W31N59（Daozen RCL8 塔房）必须在 avoidRooms 里，否则 deposit 队伍会继续走最短路送死"
);

// 3) 负对照 A：剥注释之前就能命中的房间名（只在注释里出现）不得进名单
//    W19N13 只出现在 `// 永不踏入这些房间 ,'E8N19','E8N18','W19N13'` 这条注释里。
assert.ok(/W19N13/.test(src), "负对照前提失效：源码里已经没有只在注释出现的 W19N13");
assert.ok(!rooms.includes("W19N13"), "注释里的房间名被当成名单成员 ⇒ 剥注释失效，断言不可信");

// 4) 负对照 B：deposit 目标房不能被拉黑，否则任务永远到不了
assert.ok(!rooms.includes("W31N60"), "W31N60 是 deposit 目标房，不能被 avoidRooms 拉黑");

// 5) 名单进入运行时映射的方式没被改坏（Memory 追加 + 载入时建 map）
assert.ok(/avoidRooms\s*=\s*avoidRooms\.reduce/.test(clean), "avoidRooms 必须在载入时转成 map");
assert.ok(
    /Memory\.betterMoveAvoidRooms/.test(clean),
    "Memory.betterMoveAvoidRooms 的运行时追加通道必须保留（临时拉黑不依赖发版）"
);

console.log("deposit-route-avoid: passed (" + rooms.length + " 个回避房, W31N59 在列)");
