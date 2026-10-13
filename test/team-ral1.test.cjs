/**
 * raL1 死队的旗要清掉（用户 2026-10-13 选 (a)：队伍死了任务即结束，不重生）。
 *
 * 原来 `flag.memory.creepName` 永不清空 ⇒ `execSpawn` 的重建条件 `!creepName` 恒假 ⇒
 * 队伍死了既不重生、旗也永远不清（`raL1_E59S38_1` 里记的爬 34 万 tick 前就死了）。
 * 这段清理逻辑本来就在文件里、被注释在 execSpawn 下方，现在是把它接回调用点。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/team_raL1.js"), "utf8");

function load({ time = 1000, creeps = {} } = {}) {
    const ctx = {
        console: { log() {} },
        Creep: function () {},
        ManagerCreeps: { calcBodyPart: o => o },
        // 模块顶层就用到了部件常量（体型定义），必须加载前就位
        TOUGH: "tough", ATTACK: "attack", RANGED_ATTACK: "ranged_attack",
        HEAL: "heal", MOVE: "move", WORK: "work", CARRY: "carry",
        CLAIM: "claim", OK: 0,
        Game: { time, creeps, map: { getRoomLinearDistance: () => 1 } },
        Memory: { creeps: {} },
        global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "team_raL1.js" });
    return ctx;
}

function makeFlag({ name = "raL1_E59S38_1", memory = {} } = {}) {
    const calls = [];
    return { name, memory, calls, remove() { calls.push("remove"); } };
}

{
    // ① 非 _keeper 队、爬已死、spawnTime 久远 → 连续 3 次（防抖）后删旗
    const ctx = load({ time: 10000, creeps: {} });
    const S = ctx.TeamRaL1;
    const f = makeFlag({ memory: { creepName: "shard3_83270106_1", spawnTime: 8000 } });
    assert.equal(S.expireDeadTeamFlag(f), false, "第 1 次查不到还不删（防出生竞态）");
    assert.equal(f.calls.length, 0);
    assert.equal(S.expireDeadTeamFlag(f), false, "第 2 次也不删");
    assert.equal(S.expireDeadTeamFlag(f), true, "连续 3 次确认不在 → 删旗");
    assert.deepEqual(f.calls, ["remove"], "只 remove，不做别的");
}

{
    // ② 爬还活着 → 永远不删，而且计数要清零
    const ctx = load({ time: 10000, creeps: { shard3_83270106_1: { name: "shard3_83270106_1" } } });
    const S = ctx.TeamRaL1;
    const f = makeFlag({ memory: { creepName: "shard3_83270106_1", spawnTime: 8000, missingCnt: 2 } });
    for (let i = 0; i < 5; i++) assert.equal(S.expireDeadTeamFlag(f), false, "活着就不删");
    assert.equal(f.memory.missingCnt, 0, "看到活的就把缺失计数清零");
    assert.equal(f.calls.length, 0);
}

{
    // ③ 防出生竞态：刚 spawn 出来的那一两 tick（spawnTime 很近）不能删
    const ctx = load({ time: 10005, creeps: {} });
    const S = ctx.TeamRaL1;
    const f = makeFlag({ memory: { creepName: "new1", spawnTime: 10000 } });
    for (let i = 0; i < 5; i++) assert.equal(S.expireDeadTeamFlag(f), false,
        "距 spawnTime <10 tick 时一律不删（Game.creeps 可能还没这只爬）");
    assert.equal(f.calls.length, 0);
    // 计数被清零过 → 之后要重新累计 3 次
    assert.equal(f.memory.missingCnt, 0);
}

{
    // ④ `_keeper` 型是常驻队（走清名重生的路）→ 不清旗
    const ctx = load({ time: 10000, creeps: {} });
    const S = ctx.TeamRaL1;
    const f = makeFlag({ name: "raL1_keeper_E59S38_1", memory: { creepName: "dead1", spawnTime: 8000 } });
    for (let i = 0; i < 5; i++) assert.equal(S.expireDeadTeamFlag(f), false, "_keeper 队不清旗");
    assert.equal(f.calls.length, 0);
}

{
    // ⑤ 带 taskId 的队由跨片流程管 → 不清旗
    const ctx = load({ time: 10000, creeps: {} });
    const S = ctx.TeamRaL1;
    const f = makeFlag({ memory: { creepName: "dead1", spawnTime: 8000, taskId: "abc" } });
    for (let i = 0; i < 5; i++) assert.equal(S.expireDeadTeamFlag(f), false, "跨片队不清旗");
    assert.equal(f.calls.length, 0);
}

{
    // ⑥ 没有 creepName（还没派过兵）→ 不管，交给下面的派兵逻辑
    const ctx = load({ time: 10000, creeps: {} });
    const S = ctx.TeamRaL1;
    const f = makeFlag({ memory: {} });
    assert.equal(S.expireDeadTeamFlag(f), false, "没记录爬名 → 不删");
    assert.equal(f.calls.length, 0);
}

{
    // ⑦ 调用点必须真的挂上（只测 helper 抓不到「helper 在、但没人调」）
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/if \(pro\.expireDeadTeamFlag\(flag\)\) return;/.test(codeOnly),
        "execSpawn 开头必须挂这道清理");
}

console.log("raL1 dead-team flag checks passed");
