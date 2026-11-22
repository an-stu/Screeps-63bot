/**
 * PB 搬运手 / 攻击手在任务结束后必须结束自己，不许搁浅到老死。
 *
 * 2026-11-23 线上实测（shard3，E50S21 任务 `powerBank_E53S21_E50S21_26_21`）：
 *   - `StrategyPowerBank.exec` 在 `powerBank` 被打掉/过期时 `flag.remove()`（唯一删旗路径）；
 *   - 0.78.247 只给 `HealerPB` 补了「旗没了 ⇒ recycleCreep」这条出口，
 *     `carrierPB` 与 `AttackerPB` 都没有：
 *       · 2 只 4,200 hits 的 PBCarrier 空车停在死目标房 (39,0)/(39,49)，在房界来回走位，
 *         任务里 `task.id` 指向已消失的 power bank，ttl 954/1,044 一直烧；
 *       · 1 只 PBer（AttackerPB）在 E50S20 (40,48) 每 6 tick 重算路径、零位移 577 tick
 *         —— 它的 suicide 分支只在 `task.roomName == this.room.name` 时生效，在途永远走不到。
 *   - 三条都是「任务表挂在死 id 上」探针的复采命中项（爬不会自己脱困）。
 *
 * 修法：旗没了 = 任务结束 ⇒ 空车 `recycleCreep` 回主房（没有主房才 suicide）；
 * 攻击手就地 suicide（与它原有的房内分支同一处理）。**有货 / 有掉落的 power 时
 * 仍然先收货**，不许因为任务结束就把 power 丢在地上。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/strategy_powerBank.js"), "utf8");

function load({ flags = {}, rooms = {} } = {}) {
    const ctx = {
        console: { log() {} },
        Creep: function () {},
        Game: { time: 1000, flags, rooms, getObjectById: () => null },
        Memory: { creeps: {}, rooms: {} },
        UtilsTask: {
            taskData: name => ({ taskName: name }),
            task: (obj, name) => ({ taskName: name, id: obj && obj.id }),
        },
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
    ctx._ = { values: o => Object.keys(o || {}).map(k => o[k]) };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_powerBank.js" });
    return ctx.Creep.prototype;
}

/**
 * @param {object} opt
 *  roomName    当前所在房
 *  store       载货量（0 = 空车）
 *  ruins       FIND_RUINS 的结果
 *  drops       FIND_DROPPED_RESOURCES 的结果
 *  hasMainRoom memory.roomName 能不能取到房对象
 */
function fakeCarrier({ roomName = "E50S21", store = 0, ruins = [], drops = [], hasMainRoom = true,
                       flagName = "powerBank_E53S21_E50S21_26_21" } = {}) {
    const calls = [];
    const creep = {
        name: "shard3_84429366_1",
        memory: {
            role: "PBCarrier",
            roomName: "E53S21",
            tasks: [{ taskName: "carrierPB", flagName, index: 4, id: "pbid", roomName: "E50S21", x: 26, y: 21 }],
        },
        calls,
        room: {
            name: roomName,
            my: false,
            find(type) {
                if (type === "ruins") return { filter: () => ({ head: () => ruins[0] }) };
                if (type === "drop") return { filter: () => ({ sort: () => ({ head: () => drops[0] }) }) };
                return [];
            },
        },
        hitsMax: 4200, hits: 4200, ticksToLive: 954,
        pos: { isNearTo: () => true, inRangeTo: () => true },
        storeUsed() { return store; },
        headTask() { return this.memory.tasks[0]; },
        mainRoom() { return hasMainRoom ? { name: "E53S21", storage: { id: "storageid" } } : undefined; },
        suicide() { calls.push("suicide"); },
        popTask() { this.memory.tasks.pop(); calls.push("pop"); return this; },
        addTask(t) { this.memory.tasks.push(t); calls.push("add:" + t.taskName); return this; },
        execLastTask() { calls.push("exec:" + this.memory.tasks[this.memory.tasks.length - 1].taskName); return this; },
        moveTo(t) { calls.push("moveTo:" + (t && (t.taskName || t.id || "obj"))); },
        pickup() { calls.push("pickup"); },
        withdraw() { calls.push("withdraw"); },
    };
    return creep;
}

function fakeAttacker({ roomName = "E50S20", flagName = "powerBank_E53S21_E50S21_26_21" } = {}) {
    const calls = [];
    return {
        name: "shard3_84429489_1",
        memory: {
            role: "PBer",
            roomName: "E53S21",
            tasks: [{ taskName: "AttackerPB", flagName, index: 4, id: "pbid", roomName: "E50S21", x: 26, y: 21 }],
        },
        calls,
        room: { name: roomName, my: false },
        hitsMax: 5000, hits: 5000, ticksToLive: 1101,
        pos: { isCrossRoomNearTo: () => false, inRangeTo: () => false, findClosestByRange: () => null,
               isNearTo: () => false, findInRange: () => [] },
        body: [],
        headTask() { return this.memory.tasks[0]; },
        suicide() { calls.push("suicide"); },
        goTo() { calls.push("goTo"); },
        moveTo() { calls.push("moveTo"); },
        attack() { return 0; },
        say() {},
    };
}

// ① 空车 + 旗没了 ⇒ 转交 recycleCreep 并当 tick 执行，不许原地发呆
{
    const { carrierPB } = load();
    const c = fakeCarrier();
    carrierPB.call(c);
    assert.deepEqual(c.memory.tasks, [{ taskName: "recycleCreep" }],
        "旗没了 ⇒ 任务链只剩 recycleCreep（carrierPB 自己弹出原任务）");
    assert.ok(c.calls.includes("exec:recycleCreep"), "必须当 tick 就执行回收任务");
    assert.ok(!c.calls.includes("suicide"), "有主房可回时必须回收，不能自杀");
    assert.ok(!c.calls.some(x => x.indexOf("moveTo") === 0), "不许再走向已消失的目标");
}

// ② 空车 + 旗没了 + 没有主房可回 ⇒ suicide，别留下永动闲爬
{
    const { carrierPB } = load();
    const c = fakeCarrier({ hasMainRoom: false });
    carrierPB.call(c);
    assert.ok(c.calls.includes("suicide"), "回不去主房时自杀");
    assert.ok(!c.calls.some(x => x.indexOf("recycleCreep") >= 0),
        "回不去主房时不能挂 recycleCreep（mainRoom() 为 undefined 会抛）");
}

// ③ 负对照：旗还在 ⇒ 任务链不许被动过（老行为）
{
    const flag = { name: "powerBank_E53S21_E50S21_26_21", memory: { healer: {} } };
    const { carrierPB } = load({ flags: { [flag.name]: flag } });
    const c = fakeCarrier();
    const before = JSON.stringify(c.memory.tasks);
    carrierPB.call(c);
    assert.equal(JSON.stringify(c.memory.tasks), before, "旗在时任务链不许被动过");
    assert.ok(!c.calls.includes("pop"), "旗在时不许 popTask");
    assert.ok(!c.calls.includes("suicide"), "旗在时不许自杀");
}

// ④ 负对照（重要）：任务虽已结束，但房里有掉落的 power ⇒ 先收货，绝不许直接回家
{
    const { carrierPB } = load();
    const c = fakeCarrier({ drops: [{ resourceType: "power", amount: 1200, id: "droppow" }] });
    carrierPB.call(c);
    assert.ok(c.calls.includes("pickup"), "地上的 power 必须先捡，不能因为任务结束就丢掉");
    assert.ok(!c.calls.includes("pop"), "收货路径不许 popTask");
}

// ⑤ 负对照：残骸里有 power 同上
{
    const { carrierPB } = load();
    const c = fakeCarrier({ ruins: [{ id: "ruin", store: { power: 800 } }] });
    carrierPB.call(c);
    assert.ok(c.calls.includes("withdraw"), "残骸里的 power 必须先 withdraw");
    assert.ok(!c.calls.some(x => x.indexOf("recycleCreep") >= 0));
}

// ⑥ 攻击手：旗没了 + 站在任务房外 ⇒ 就地自杀，不许再 goTo 死目标
{
    const { AttackerPB } = load();
    const c = fakeAttacker();
    AttackerPB.call(c);
    assert.ok(c.calls.includes("suicide"), "旗没了必须自杀（在途也一样）");
    assert.ok(!c.calls.includes("goTo"), "不许再朝已消失的 power bank 走位");
}

// ⑦ 负对照：攻击手旗还在 ⇒ 照常走位，不许误自杀
{
    const flag = { name: "powerBank_E53S21_E50S21_26_21", memory: { healer: {} } };
    const { AttackerPB } = load({ flags: { [flag.name]: flag } });
    const c = fakeAttacker();
    AttackerPB.call(c);
    assert.ok(!c.calls.includes("suicide"), "旗在时不许自杀");
}

// ⑧ 源码钉子：两条出口都必须在「用 flag 之前」判，且用 task.flagName
{
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

    const carrierFn = codeOnly.slice(codeOnly.indexOf("Creep.prototype.carrierPB = function"));
    const carrierBody = carrierFn.slice(0, carrierFn.indexOf("\n};"));
    const carrierGuard = carrierBody.indexOf("if (!flag)");
    const carrierBankUse = carrierBody.indexOf("Game.getObjectById(flag.memory.id)");
    assert.ok(carrierGuard > 0, "carrierPB 必须判旗是否还在");
    assert.ok(carrierBankUse > 0 && carrierGuard < carrierBankUse,
        "判旗必须在读 flag.memory.id 之前（否则还是会原地发呆）");
    assert.ok(/if \(!this\.mainRoom\(\)\) return this\.suicide\(\);/.test(carrierBody),
        "carrierPB 必须先挡 mainRoom 缺失再挂 recycleCreep");

    const atkFn = codeOnly.slice(codeOnly.indexOf("Creep.prototype.AttackerPB = function"));
    const atkBody = atkFn.slice(0, atkFn.indexOf("\n};"));
    const atkGuard = atkBody.indexOf("if (!flag) return this.suicide();");
    const atkGoTo = atkBody.indexOf("if (task.roomName != this.room.name) this.goTo(task);");
    assert.ok(atkGuard > 0, "AttackerPB 必须有旗没了就自杀的出口");
    assert.ok(atkGoTo > 0 && atkGuard < atkGoTo, "自杀必须在 goTo 之前（否则在途的永远走不到）");
}

console.log("power-bank carrier/attacker orphan-recycle checks passed");
