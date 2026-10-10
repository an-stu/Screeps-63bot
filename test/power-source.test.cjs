/**
 * OP source（`PWR_REGEN_SOURCE`）的两件事（用户 2026-10-10）：
 *
 *   1. **两个 source 都要照顾到** —— 一个够不到时要去管另一个；
 *   2. **卡住的 OpSource 任务必须能弹栈** —— 原实现只在 `usePower==OK` 时弹栈，
 *      于是 PC 一旦进不了射程（实测 P5/P9 停在 range 4，技能 range 3）就永久挂死：
 *      `isFree()` 恒 false，其它能力全被堵死，source 也永远上不了 REGEN。
 *      实测 26 个 source 里 7 个是这个状态。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "modules/prototype_powerCreep.js"), "utf8");

// lodash 的数组扩展在游戏里由全局提供；宿主 realm 也要有（源码里用了 s.effects.head()）
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function load() {
    const ctx = {
        console,
        PowerCreep: function () {},
        // 模块顶层会把 Creep.prototype 的方法拷到 PowerCreep.prototype（第 5 行），
        // 所以这两个 + lodash 的 `_` 必须在加载前就位。
        Creep: function () {},
        _: { keys: obj => Object.keys(obj) },
        Game: { time: 1000, creeps: {}, powerCreeps: {} },
        Memory: {},
        OK: 0,
        ERR_NOT_IN_RANGE: -9,
        ERR_NOT_ENOUGH_OPS: -11,
        PWR_REGEN_SOURCE: 13,
        PWR_OPERATE_EXTENSION: 14,
        PWR_OPERATE_STORAGE: 15,
        PWR_GENERATE_OPS: 1,
        PWR_OPERATE_SPAWN: 2,
        PWR_OPERATE_TOWER: 3,
        PWR_OPERATE_POWER: 4,
        PWR_OPERATE_LAB: 5,
        RESOURCE_OPS: "ops",
        RESOURCE_POWER: "power",
        RESOURCE_ENERGY: "energy",
        StationSources: { sourcePathTime: () => 5, powerSource: () => {} },
        StationCarry: { roomMassStoreCnt: () => 0 },
        UtilsTask: { task: () => ({ taskName: "goToNearPop" }) },
        global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(source, ctx, { filename: "prototype_powerCreep.js" });
    return ctx;
}

function makeSource(id, x, y, effectTicks) {
    return {
        id, pos: { x, y },
        effects: effectTicks === undefined ? [] : [{ power: 13, ticksRemaining: effectTicks, level: 5 }],
    };
}

function makePC(ctx, { sources, cooldown = 0, inRange = true, usePowerCode = 0 }) {
    const calls = { moveTo: 0, pop: 0, usePower: 0, goTo: 0 };
    const pc = {
        memory: {},
        pos: { inRangeTo: () => inRange, x: 10, y: 10 },
        powers: { 13: { cooldown: cooldown, level: 5 } },
        calls,
        lastTaskObj: () => sources[0],
        mainRoom: () => ({ name: "W33N55", source: sources, storage: { id: "st" }, terminal: null, powerSpawn: null }),
        moveTo() { calls.moveTo++; return 0; },
        usePower() { calls.usePower++; return usePowerCode; },
        popTask() { calls.pop++; return this; },
        addTask() { calls.goTo++; return this; },
        execLastTask() { return this; },
    };
    return pc;
}

{
    const ctx = load();
    const P = ctx.PowerCreep.prototype;

    // ── needOpSource：两个 source 都要照顾 ──
    const a = makeSource("a", 38, 35, 250);   // 效果还很久
    const b = makeSource("b", 5, 42, 250);
    let pc = makePC(ctx, { sources: [a, b] });
    assert.equal(P.needOpSource.call(pc), false, "两个 source 效果都还在 → 不需要动作");

    // a 过期 → 应该返回 a
    a.effects = [];
    assert.equal(P.needOpSource.call(pc), a, "a 没效果 → 返回 a");

    // a 被记成暂时够不到 → **必须换 b**（这是「两个都要照顾到」的核心）
    pc.memory.opSourceUnreachable = { a: ctx.Game.time + 200 };
    b.effects = [];
    assert.equal(P.needOpSource.call(pc), b, "a 暂时够不到 → 换 b，而不是死磕 a");

    // 两个都够不到 → 不做（等 TTL 过期）
    pc.memory.opSourceUnreachable = { a: ctx.Game.time + 200, b: ctx.Game.time + 200 };
    assert.equal(P.needOpSource.call(pc), false, "两个都暂时够不到 → 本轮不做");

    // TTL 过期后要重新尝试
    pc.memory.opSourceUnreachable = { a: ctx.Game.time - 1, b: ctx.Game.time - 1 };
    assert.equal(P.needOpSource.call(pc), a, "TTL 过期 → 重新尝试 a");

    // 冷却未好 → 不做
    const pc2 = makePC(ctx, { sources: [makeSource("c", 1, 1, undefined)], cooldown: 99 });
    assert.equal(P.needOpSource.call(pc2), false, "技能还在冷却 → 不派任务");
}

{
    // ── OpSource：够不到时必须计数并最终弹栈 ──
    const ctx = load();
    const P = ctx.PowerCreep.prototype;
    const src = makeSource("a", 38, 35, undefined);
    const pc = makePC(ctx, { sources: [src], inRange: false });

    P.OpSource.call(pc);
    assert.equal(pc.calls.moveTo, 1, "够不到 → 先 moveTo");
    assert.equal(pc.calls.pop, 0, "第 1 次还不够弹栈");
    P.OpSource.call(pc);
    assert.equal(pc.calls.pop, 0, "第 2 次也不够弹栈");
    P.OpSource.call(pc);
    assert.equal(pc.calls.pop, 1, "连续 3 次够不到 → **弹栈**（原实现会永久挂着）");
    assert.ok(pc.memory.opSourceUnreachable && pc.memory.opSourceUnreachable.a > ctx.Game.time,
        "并把这个 source 记成暂时不可达，让 PC 去照顾另一个");
    assert.equal(pc.memory.opSourceStuck, 0, "计数器复位");
}

{
    // ── OpSource：在射程内但技能放不出去，也要计数并最终弹栈 ──
    const ctx = load();
    const P = ctx.PowerCreep.prototype;
    const src = makeSource("a", 38, 35, undefined);
    const pc = makePC(ctx, { sources: [src], inRange: true, usePowerCode: -11 });
    P.OpSource.call(pc); P.OpSource.call(pc); P.OpSource.call(pc);
    assert.equal(pc.calls.usePower, 3, "一直在试放技能");
    assert.equal(pc.calls.pop, 1, "ops 不够之类的失败也要弹栈，不能永久挂着");
}

{
    // ── OpSource：成功路径（弹栈 + 回去待命 + 清掉不可达标记）──
    const ctx = load();
    const P = ctx.PowerCreep.prototype;
    const src = makeSource("a", 38, 35, undefined);
    const pc = makePC(ctx, { sources: [src], inRange: true, usePowerCode: 0 });
    pc.memory.opSourceUnreachable = { a: ctx.Game.time + 200 };
    pc.memory.opSourceStuck = 2;
    P.OpSource.call(pc);
    assert.equal(pc.calls.usePower, 1, "放技能");
    assert.equal(pc.calls.pop, 1, "成功后弹栈");
    assert.equal(pc.calls.goTo, 1, "回去待命（goToNearPop）");
    assert.equal(pc.memory.opSourceStuck, 0, "计数器清零");
    assert.equal(pc.memory.opSourceUnreachable.a, undefined, "成功即清掉该 source 的不可达标记");
}

console.log("op source / stuck-task checks passed");
