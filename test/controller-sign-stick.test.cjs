// 控制器签名「签不住」时不许冻结执行者。
//
// 背景（2026-11-26 shard2 E51S26 实测）：新生区/保护区里服务器每 tick 把控制器
// 签回系统口吻，而客户端 `creep.signController()` 照样返回 OK。旧 `trySignController`
// 只判断「当前签名不是我们的」⇒ 每 tick 都 `return true`，而 `execLastTask` 一旦
// 看到它返回真就**跳过本 tick 的任务**。于是「离控制器最近的那只 worker」被永久
// 冻结：任务栈里一条指向已消失掉落物的 `pickupRes` 2900+ tick 一次都没 pop，
// 整只爬零位移站到老死，同房 4 只 worker 只剩 3 只干活。
//
// 新判据：上一 tick 签过且拿到 OK、这一 tick 又不是我们的口吻 ⇒ 记冷却窗口停手。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "modules/station_upgrade.js"), "utf8");

function extract(src, header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, "missing " + header);
    const open = src.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error("unterminated " + header);
}

const BLOCK = 10000;

function makeRuntime({time = 1000, sign = null, memory = {}} = {}) {
    const ctx = {
        Game: {time},
        WHO_AM_I: "me",
        OK: 0,
        ERR_NOT_IN_RANGE: -9,
        ERR_INVALID_TARGET: -7,
        FIND_MY_CREEPS: "myCreeps",
        CONTROLLER_SIGN_VERSION: 2,
        CONTROLLER_SIGN_BLOCK_TICKS: BLOCK,
        Logger: {info() {}, warning() {}},
        global: {Logger: {warning() {}}},
        controllerSignFor: () => "desired",
    };
    vm.runInNewContext(`this.pro = {${extract(source, "trySignController(creep)")}};`, ctx);

    const controller = {id: "ctrl", pos: {x: 16, y: 38, getRangeTo: () => 1}, sign};
    const room = {
        name: "E51S26",
        controller,
        memory,
        _controllerSignerId: "c1",
        find: () => [creep],
    };
    const calls = {sign: 0, move: 0};
    const creep = {
        id: "c1",
        name: "shard2_1_1",
        room,
        memory: {role: "worker", tasks: [{taskName: "pickupRes", id: "dead"}]},
        get spawning() { return false; },
        pos: {isNearTo: () => true, getRangeTo: () => 1},
        getActiveBodyparts: () => 10,
        moveTo() { calls.move++; },
        signController() { calls.sign++; return ctx.__result === undefined ? ctx.OK : ctx.__result; },
    };
    return {ctx, room, creep, controller, calls, pro: ctx.pro, setResult(code) { ctx.__result = code; }};
}

// ① 首签：返回 true（本 tick 让路），记录 pending + 期望文本
{
    const rt = makeRuntime();
    assert.equal(rt.pro.trySignController(rt.creep), true, "首次签名应当占用本 tick");
    assert.equal(rt.calls.sign, 1, "必须真的调用 signController");
    assert.equal(rt.room.memory.signPendingTick, 1000, "签完必须记录 pending tick");
    assert.equal(rt.room.memory.controllerSignText, "desired");
}

// ② 签名粘住：下一 tick 看到我们的口吻 ⇒ 立刻放行，并清掉记账
{
    const rt = makeRuntime({time: 1001, sign: {username: "me", text: "desired"},
        memory: {signPendingTick: 1000}});
    assert.equal(rt.pro.trySignController(rt.creep), false, "已签成期望文本必须放行");
    assert.equal(rt.room.memory.signPendingTick, undefined, "签住了要清 pending");
    assert.equal(rt.room.memory.signBlockedUntil, undefined, "签住了要解除冷却");
    assert.equal(rt.calls.sign, 0);
}

// ③ 关键回归：签过但被系统覆盖 ⇒ 必须放行 + 进冷却，绝不能再冻一只
{
    const rt = makeRuntime({time: 1001,
        sign: {username: "Screeps", text: "A new Novice or Respawn Area is being planned"},
        memory: {signPendingTick: 1000}});
    assert.equal(rt.pro.trySignController(rt.creep), false,
        "签名盖不住时必须返回 false（否则执行者被永久冻结）");
    assert.equal(rt.room.memory.signBlockedUntil, 1001 + BLOCK, "必须记录冷却窗口");
    assert.equal(rt.room.memory.signPendingTick, undefined);
}

// ④ 负对照：同样的现场，但没有 pending 记账（= 旧代码路径）⇒ 仍会返回 true
//    这正是本次修复的锚点：不是「签名失败」本身，而是「没有记账就看不出盖不住」。
{
    const rt = makeRuntime({time: 1001,
        sign: {username: "Screeps", text: "A new Novice or Respawn Area is being planned"},
        memory: {}});
    assert.equal(rt.pro.trySignController(rt.creep), true,
        "负对照：无 pending 记账时旧判据仍会冻结执行者");
}

// ⑤ 冷却窗口内：零 API 调用直接放行
{
    const rt = makeRuntime({time: 2000,
        sign: {username: "Screeps", text: "system"}, memory: {signBlockedUntil: 11001}});
    assert.equal(rt.pro.trySignController(rt.creep), false, "冷却期内必须放行");
    assert.equal(rt.calls.sign, 0, "冷却期内不许再调 signController");
    assert.equal(rt.calls.move, 0, "冷却期内不许再让爬跑去签名");
}

// ⑥ 冷却到期：重试一次（新生区结束后无需人工清 Memory）
{
    const rt = makeRuntime({time: 11002,
        sign: {username: "Screeps", text: "system"}, memory: {signBlockedUntil: 11001}});
    assert.equal(rt.pro.trySignController(rt.creep), true, "冷却到期必须重试一次");
    assert.equal(rt.calls.sign, 1);
}

// ⑦ 引擎直接拒绝：同样进冷却，不许每 tick 重试
{
    const rt = makeRuntime({time: 1000, sign: null, memory: {}});
    rt.setResult(-7);
    assert.equal(rt.pro.trySignController(rt.creep), true);
    assert.equal(rt.room.memory.signBlockedUntil, 1000 + BLOCK, "非 ERR_NOT_IN_RANGE 的拒绝要进冷却");
    assert.equal(rt.room.memory.signPendingTick, undefined, "失败不该留下 pending");
}

// ⑧ 非签名者：不受影响
{
    const rt = makeRuntime({time: 1000, sign: null, memory: {}});
    rt.room._controllerSignerId = "other";
    assert.equal(rt.pro.trySignController(rt.creep), false, "非签名者必须照常执行自己的任务");
}

console.log("controller-sign-stick: passed");
