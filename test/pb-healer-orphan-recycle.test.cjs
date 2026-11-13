/**
 * PB 奶妈在任务结束后必须回收，不许搁浅到老死。
 *
 * 2026-11-13 线上实测（shard3，E60S39）：
 *   - `StrategyPowerBank.exec` 在 `powerBank` 被打掉/过期时 `flag.remove()`（唯一删旗路径）；
 *   - 队伍里活下来的 `HealerPB` 奶妈 `task.flagName` 从此指不到旗 ⇒
 *     `let flag = Game.flags[task.flagName]` 为 undefined ⇒ 函数里所有 `flag && ...`
 *     条件全部短路 ⇒ 只剩结尾 `heal(this)`，**原地站到老死**；
 *   - 实测对象 shard3_84237650_2：flag 已删、`memory.attacker` 已死、
 *     `task.id` 指向的 powerBank 也 `getObjectById` = null、ttl 447、零位移，
 *     是全账号「死任务 id」探针唯一命中项（55 条任务里 1 条）。
 *
 * 修法：旗没了 = 任务结束 ⇒ 走 `recycleCreep`（自带跨房走位，ttl<700 先 unboost
 * 回收化合物 —— 奶妈必带 boost，回收有实际收益）。没有主房可回时按 AttackerPB 的
 * 老做法 suicide，避免留下永动的闲爬。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/strategy_powerBank.js"), "utf8");

function load({ flags = {} } = {}) {
    const ctx = {
        console: { log() {} },
        Creep: function () {},
        Game: { time: 1000, flags, rooms: {}, getObjectById: () => null },
        Memory: { creeps: {}, rooms: {} },
        UtilsTask: { taskData: name => ({ taskName: name }) },
        StationHive: { trySpawn: () => true },
        FIND_HOSTILE_CREEPS: "hostile",
        FIND_RUINS: "ruins",
        FIND_DROPPED_RESOURCES: "drop",
        RESOURCE_POWER: "power",
        RESOURCE_ENERGY: "energy",
        ATTACK: "attack",
        HEAL: "heal",
        RANGED_ATTACK: "ranged_attack",
        TOUGH: "tough",
        MOVE: "move",
        CARRY: "carry",
        WORK: "work",
        global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_powerBank.js" });
    return ctx.Creep.prototype.HealerPB;
}

/** 只桩到「早退点」为止：getActiveBodyparts 返 0 ⇒ 不会碰 pos。 */
function fakeCreep({ flagName = "powerBank_E59S38_E60S39_31_44", hasMainRoom = true } = {}) {
    const calls = [];
    const creep = {
        name: "shard3_84237650_2",
        memory: {
            role: "PBer",
            roomName: "E59S38",
            attacker: "deadbeef",
            tasks: [{ taskName: "HealerPB", flagName, index: 1, id: "pbid", roomName: "E60S39", x: 31, y: 44 }],
        },
        calls,
        room: { name: "E60S39", my: false },
        hitsMax: 100, hits: 100,
        pos: {
            findClosestByRange: () => null,
            findInRange: () => [],
            isNearTo: () => true,
            inRangeTo: () => true,
        },
        headTask() { return this.memory.tasks[0]; },
        getActiveBodyparts() { return 0; },
        mainRoom() { return hasMainRoom ? { name: "E59S38" } : undefined; },
        suicide() { calls.push("suicide"); },
        popTask() { this.memory.tasks.pop(); calls.push("pop"); return this; },
        addTask(t) { this.memory.tasks.push(t); calls.push("add:" + t.taskName); return this; },
        execLastTask() { calls.push("exec:" + this.memory.tasks[this.memory.tasks.length - 1].taskName); return this; },
        heal() { calls.push("heal"); },
        rangedAttack() {}, rangedMassAttack() {}, moveTo() {}, goTo() {},
    };
    return creep;
}

// ① 旗已删（= 任务结束）⇒ 必须转交 recycleCreep 并立刻执行，不许原地发呆
{
    const HealerPB = load();
    const c = fakeCreep();
    HealerPB.call(c);
    assert.deepEqual(c.memory.tasks, [{ taskName: "recycleCreep" }],
        "旗没了 ⇒ 任务链只剩 recycleCreep（HealerPB 自己弹出）");
    assert.ok(c.calls.includes("exec:recycleCreep"), "必须当 tick 就执行回收任务，不要等下一轮");
    assert.ok(!c.calls.includes("suicide"), "有主房可回时必须回收（返还能量 + 回收化合物），不能自杀");
}

// ② 没主房可回（memory.roomName 视野丢失/为空）⇒ suicide，别留下永动闲爬
{
    const HealerPB = load();
    const c = fakeCreep({ hasMainRoom: false });
    HealerPB.call(c);
    assert.ok(c.calls.includes("suicide"), "回不去主房时按 AttackerPB 的老做法自杀");
    assert.ok(!c.calls.some(x => x.indexOf("recycleCreep") >= 0),
        "回不去主房时不能挂 recycleCreep（mainRoom() 为 undefined 会抛）");
}

// ③ 负对照：旗还在 ⇒ 照常执行任务，绝不能误回收
{
    const flag = { name: "powerBank_E59S38_E60S39_31_44", memory: { attacker: {}, healer: {} } };
    const HealerPB = load({ flags: { [flag.name]: flag } });
    const c = fakeCreep();
    const before = JSON.stringify(c.memory.tasks);
    HealerPB.call(c);
    assert.equal(JSON.stringify(c.memory.tasks), before, "旗在时任务链不许被动过");
    assert.ok(!c.calls.includes("pop"), "旗在时不许 popTask");
    assert.ok(!c.calls.includes("suicide"), "旗在时不许自杀");
}

// ④ 源码钉子：判旗必须发生在「找敌人/治疗」之前，且用的是 task.flagName
{
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const fn = codeOnly.slice(codeOnly.indexOf("Creep.prototype.HealerPB = function"));
    const body = fn.slice(0, fn.indexOf("\n};"));
    const guardAt = body.indexOf("if (!missionFlag)");
    const hostileAt = body.indexOf("findClosestByRange(FIND_HOSTILE_CREEPS)");
    assert.ok(guardAt > 0, "HealerPB 必须判旗是否还在");
    assert.ok(hostileAt > 0 && guardAt < hostileAt, "判旗必须在找敌对/治疗之前（否则还是会原地发呆）");
    assert.ok(/let missionFlag = Game\.flags\[task\.flagName\];/.test(body),
        "判据必须取自任务自己的 flagName");
}

console.log("power-bank healer orphan-recycle checks passed");
