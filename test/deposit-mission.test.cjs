/**
 * deposit 任务的「不许中途暂停 / 必须做完」（用户 2026-10-10）：
 *
 *   1. 挨打后的 1200 tick 停摆**只能挡住还没派人的任务** —— 已经在干的任务必须做完，
 *      否则队伍烂尾（原来是无条件 return，采集爬掉 1000 血就停 1200 tick）；
 *   2. 任务旗没了（完成/被撤/目标消失）时，**在途的爬也要掉头回家**，
 *      不许朝一个已经没有任务的目标房一直赶（实测 shard3_83543262_1 卡在
 *      去 E57S20 的必经高速房 E53S20 上，站到老死）。
 *
 * 直接加载真模块跑（顶层只依赖 Creep / Game.shard / global）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/strategy_deposits.js"), "utf8");

function load({ flags = {}, memoryFlags = {} } = {}) {
    const ctx = {
        console,
        Creep: function () {},
        Game: { time: 1000, shard: { name: "shard3" }, flags: flags },
        Memory: { flags: memoryFlags },
        UtilsTask: { taskData: n => ({ taskName: n }), task: () => ({ taskName: "t" }) },
        StationSources: { sourcePathTime: () => 5 },
        StationObserver: {}, StationHive: {}, ManagerFlags: {}, StationLab: {},
        StationCarry: {}, RESOURCE_MIST: "mist", isSaveCpu: true,
        global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_deposits.js" });
    return ctx;
}

function makeCreep(ctx, { posRoom, taskRoom, taskFlagName = "deposit_a" }) {
    const calls = [];
    const creep = {
        id: "cr1",
        room: { name: posRoom },
        pos: { roomName: posRoom, x: 20, y: 20 },
        memory: {},
        headTask: () => ({ taskName: "carryDeposit", roomName: taskRoom, flagName: taskFlagName }),
        popTask() { calls.push("pop"); return this; },
        addTask(t) { calls.push(["add", Array.isArray(t) ? t[0].taskName : t.taskName]); return this; },
        fillAllMainRoomStorage() { calls.push("fillHome"); return this; },
        execLastTask() { calls.push("exec"); return this; },
        goTo() { calls.push("goTo"); return this; },
    };
    creep.calls = calls;
    return creep;
}

{
    // ① 旗还在、在途 → 正常赶路
    const ctx = load({ flags: { deposit_a: { name: "deposit_a", memory: {} } } });
    const c = makeCreep(ctx, { posRoom: "E53S20", taskRoom: "E57S20" });
    ctx.Creep.prototype.carryDeposit.call(c);
    assert.deepEqual(c.calls, ["goTo"], "任务还在 → 继续赶路");

    // ② **旗没了、在途** → 必须掉头回家（原来会一直朝目标房赶）
    const ctx2 = load({ flags: {} });
    const c2 = makeCreep(ctx2, { posRoom: "E53S20", taskRoom: "E57S20" });
    ctx2.Creep.prototype.carryDeposit.call(c2);
    assert.ok(c2.calls.includes("pop"), "任务没了要先弹掉任务");
    assert.ok(c2.calls.some(x => Array.isArray(x) && x[0] === "add" && x[1] === "recycleCreep"),
        "要挂回收任务（回家）");
    assert.ok(c2.calls.includes("fillHome"), "顺手把货卸进主房");
    assert.ok(!c2.calls.includes("goTo"),
        "不能再朝一个已经没有任务的目标房赶（这就是卡在 E53S20 的成因）");

    // ③ 旗没了、已经在目标房里 → 同样回家（原来这里是裸 return，原地站到老死）
    const ctx3 = load({ flags: {} });
    const c3 = makeCreep(ctx3, { posRoom: "E57S20", taskRoom: "E57S20" });
    ctx3.Creep.prototype.carryDeposit.call(c3);
    assert.ok(c3.calls.includes("pop") && c3.calls.includes("fillHome"), "到了也要回家，不能发呆");
    assert.ok(!c3.calls.includes("goTo"), "不该继续移动");
}

{
    // ④ 停摆只能挡住「还没派人」的任务
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/harvesters\.length == 0 && flag\.memory\.carriers\.length == 0\)\s*\n?\s*&& flag\.memory\.beAttackTime \+ ATTACKED_SLEEP > Game\.time\) return;/.test(codeOnly),
        "挨打停摆必须带上「harvesters/carriers 都为空」的前提，否则会停掉在做任务");

    // ⑤ harvestDeposit 只能有一份定义（原来顶层重复定义，前一份是死代码）
    const defs = codeOnly.match(/Creep\.prototype\.harvestDeposit\s*=/g) || [];
    assert.equal(defs.length, 1, "harvestDeposit 只能定义一次（重复定义会静默覆盖）");
}

// ───────── PB（power bank）同类问题：不许在队伍还没回来时撤任务 ─────────
//
// 原来 `if (beingAttack && 出不了 T2) return flag.remove();` —— 旗一删，
// 已经派出去/在途的队伍就失去任务引用直接搁浅。改为「只在确定没人可派时才撤」。
{
    const pbSrc = fs.readFileSync(path.join(root, "modules/strategy_powerBank.js"), "utf8");
    const live = {};
    const pctx = {
        console, Creep: function () {},
        Game: { time: 1, shard: { name: "shard3" }, flags: {}, creeps: {},
                getObjectById: id => live[id] || null },
        Memory: { flags: {} }, UtilsTask: {}, StationHive: {}, global: null,
    };
    pctx.global = pctx;
    vm.runInNewContext(pbSrc, pctx, { filename: "strategy_powerBank.js" });
    const PB = pctx.StrategyPowerBank;

    live["a1"] = { id: "a1" };
    const flag = { name: "powerBank_x", memory: { attacker: { 0: "a1" }, healer: {} } };
    assert.equal(PB.pbTeamAlive(flag), true, "还有活着的 attacker → 队伍在");

    delete live["a1"];
    assert.equal(PB.pbTeamAlive(flag), false, "全死了 → 没人可派，可以撤任务");

    // healer 是对象、carrier 是数组，两种形态都要认
    live["h1"] = { id: "h1" };
    assert.equal(PB.pbTeamAlive({ memory: { attacker: {}, healer: { 0: "h1" } } }), true, "healer 要认");
    delete live["h1"];
    live["c1"] = { id: "c1" };
    assert.equal(PB.pbTeamAlive({ memory: { carrier: ["c1"] } }), true, "carrier 数组也要认");
    assert.equal(PB.pbTeamAlive(undefined), false, "拿不到旗不能炸");

    // 调用点必须真的用它（只测 helper 抓不到「helper 在、但没人调」）
    const codeOnly = pbSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/if \(!pro\.pbTeamAlive\(flag\)\) return flag\.remove\(\);/.test(codeOnly),
        "「被打又出不了 T2」必须先在 pbTeamAlive 为空时才撤任务");
}

console.log("deposit + powerBank mission completeness checks passed");
