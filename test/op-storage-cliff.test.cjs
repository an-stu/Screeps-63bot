/**
 * OP_STORAGE 的「容量悬崖」预算（2026-11-12 W31N55 事故）。
 *
 * 现场：W31N55 storage 里 4,741,167 资源（7 种 T3 强化化合物 + power），容量却已经
 * 掉回基础 1M —— `getFreeCapacity()` = **-3,741,167**，整仓进不了货。原因是 OP_STORAGE
 * 效果断了，而这房唯一的 PC（P7）只有 52 ops，`usePower(PWR_OPERATE_STORAGE)` 要 100。
 * 恢复只能靠 PC 自己按 GENERATE_OPS 慢慢产（4 级 = 6 点 / 50 tick ≈ 0.12/tick）。
 *
 * 这里锁住三件事：
 *   ① `needOpStorage` 付不起 100 ops 时**不许挂任务**（原来每 3 tick 挂一次、
 *      下一 tick 必然 ERR_NOT_ENOUGH_RESOURCES 弹掉，PC 整个周期耗在死循环上）；
 *   ② OP_STORAGE 的阈值只有 `OPS_STORAGE_CLIFF_CNT` 一个来源，没有第二份字面量；
 *   ③ 悬崖边上的房，`needOpSpawn` 必须留出 200 + 100 —— 一次 OP_SPAWN 花掉的
 *      100 ops ≈ 该 PC 900 tick 的全部收入，换来的只是孵化提速。
 *   ④ `strategy_GCLRoom` 那条「能量 > 90 万」的第二套阈值必须已经统一到 needOpStorage
 *      （对 T3 储备房它恒假 ⇒ 效果断档后再没人扩容量 = 自锁）。
 *
 * 负对照：把 ① 的判据从源码里剥掉，A 组必须失败（行为，而不是文案）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const pcSrc = fs.readFileSync(path.join(root, "modules", "prototype_powerCreep.js"), "utf8");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

function loadPc(mutate) {
    let src = pcSrc;
    if (mutate) src = mutate(src);
    const sandbox = {
        console,
        _: { keys: o => Object.keys(o || {}) },
        Creep: { prototype: {} },
        PowerCreep: function () { },
        POWER_INFO: {
            1: { effect: [1, 2, 4, 6, 8] },
            2: { ops: 100 },
            4: { ops: 100, duration: 1000 },
            6: { ops: 2 },
        },
        PWR_GENERATE_OPS: 1,
        PWR_OPERATE_SPAWN: 2,
        PWR_OPERATE_TOWER: 3,
        PWR_OPERATE_STORAGE: 4,
        PWR_OPERATE_EXTENSION: 6,
        PWR_OPERATE_FACTORY: 7,
        PWR_OPERATE_POWER: 8,
        PWR_REGEN_SOURCE: 12,
        PWR_REGEN_MINERAL: 13,
        RESOURCE_OPS: "ops",
        RESOURCE_ENERGY: "energy",
        Memory: { marketSettings: {} },
        Game: { time: 100 },
        OK: 0,
        ERR_NOT_IN_RANGE: -9,
    };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox;
}

function makePc(sandbox, opts) {
    const pc = Object.create(sandbox.PowerCreep.prototype);
    const storage = {
        store: {
            getUsedCapacity: () => opts.used,
            getCapacity: () => opts.cap === undefined ? 1000000 : opts.cap,
            ops: opts.storageOps || 0,
        },
        effects: opts.effects || [],
    };
    const spawns = [0, 1, 2].map(() => ({ effects: [], spawning: opts.spawnBusy === false ? null : { name: "x" } }));
    // 默认给 OP_STORAGE + OP_SPAWN 两个技能（P7 的实战配置里两个都有）
    pc.powers = opts.powers || { 2: { level: 1, cooldown: 0 }, 4: { level: 4, cooldown: 0 } };
    pc.store = { ops: opts.ops };
    pc.memory = {};
    pc.mainRoom = () => ({ name: "W31N55", my: true, storage, spawn: spawns });
    pc._storage = storage;
    return pc;
}

// ── ① 付不起 100 ops 时不许挂任务（行为） ─────────────────────────────────
{
    const sb = loadPc();
    const poor = makePc(sb, { used: 4741167, ops: 40 });
    assert.equal(poor.needOpStorage(poor._storage), false,
        "ops(40) < 成本(100) 时 needOpStorage 必须返回 false（否则每 3 tick 白挂一次任务）");

    const exact = makePc(sb, { used: 4741167, ops: 100 });
    assert.equal(exact.needOpStorage(exact._storage), exact._storage,
        "ops 正好等于成本时必须放行（边界不能多算一格）");

    const short = makePc(sb, { used: 4741167, ops: 99 });
    assert.equal(short.needOpStorage(short._storage), false, "ops 99 仍然付不起，必须拦住");

    const cheap = makePc(sb, { used: 500000, ops: 500 });
    assert.equal(cheap.needOpStorage(cheap._storage), false,
        "没用满 95 万的房不该为扩容花 100 ops（线本身不能因为这次修复而放宽）");
}

// ── ① 负对照：剥掉判据后行为必须变回「付不起也挂任务」 ────────────────────
{
    const mutated = loadPc(src => src.replace(
        /if \(\(this\.store\[RESOURCE_OPS\] \|\| 0\) < POWER_INFO\[PWR_OPERATE_STORAGE\]\.ops\) return false;/,
        ""));
    assert.notEqual(mutated, null);
    const poor = makePc(mutated, { used: 4741167, ops: 40 });
    assert.equal(poor.needOpStorage(poor._storage), poor._storage,
        "负对照失败：判据剥掉后应当恢复旧行为（返回 storage），说明本测试确实绑在行为上");
}

// ── ② 阈值只能有一个来源 ──────────────────────────────────────────────────
{
    const code = strip(pcSrc);
    assert.ok(/let OPS_STORAGE_CLIFF_CNT = 950000/.test(code), "容量悬崖线必须有具名常量");
    assert.equal((code.match(/950000/g) || []).length, 1,
        "95 万只能出现一次（同一决策两层阈值必须同源，别再写字面量）");
    assert.ok(/PowerCreep\.prototype\.storageOnCapacityCliff = function \(\) \{/.test(code),
        "悬崖判据必须收敛成一个方法，供 OP_STORAGE 与 OP_SPAWN 共用");
}

// ── ③ 悬崖边上 OP_SPAWN 必须让出 100 ops ─────────────────────────────────
{
    const sb = loadPc();
    const tight = makePc(sb, { used: 4741167, ops: 250 });
    assert.equal(tight.needOpSpawn(), false,
        "storage 在悬崖上时，250 ops 不够（200 底 + 100 留给 OP_STORAGE），不许拿去提速孵化");

    const ok = makePc(sb, { used: 4741167, ops: 300 });
    assert.ok(ok.needOpSpawn(), "留够 200 + 100 之后 OP_SPAWN 必须恢复可用");

    const below = makePc(sb, { used: 500000, ops: 200 });
    assert.ok(below.needOpSpawn(),
        "没到悬崖线的房不受预留影响（原来 200 ops 就能用，不能因为这次修复变成 300）");

    const floor = makePc(sb, { used: 500000, ops: 190 });
    assert.equal(floor.needOpSpawn(), false, "200 ops 的原有底线不能放宽");
}

// ── ④ GCL 分支不得再留第二套阈值 ─────────────────────────────────────────
{
    const gcl = strip(fs.readFileSync(path.join(root, "modules", "strategy_GCLRoom.js"), "utf8"));
    assert.ok(/pc\.needOpStorage\(room\.storage\)/.test(gcl),
        "strategy_GCLRoom 的 OP_STORAGE 分支必须复用 needOpStorage");
    assert.ok(!/storage\.store\[RESOURCE_ENERGY\] > 900000/.test(gcl),
        "「能量 > 90 万」的第二套阈值必须删掉（T3 储备房恒假 = 自锁）");
    assert.ok(!/pc\.store\[RESOURCE_OPS\] >= 100/.test(gcl),
        "ops >= 100 的重复检查也该由 needOpStorage 统一");
}

console.log("op storage cliff budget checks passed");
