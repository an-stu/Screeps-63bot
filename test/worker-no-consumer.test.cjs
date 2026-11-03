/**
 * 「取货有门、卸货无门」：RCL8 worker 抱 1,500 能量站到老死（2026-11-03 实测）。
 *
 * 现场：W34N52 (37,18) 与 W33N55 (22,32) 各一只 worker，`store.energy = 1500`、
 * `memory.tasks` 恒空、连续数十 tick 停在同一格。那两只房的共同状态：
 *   · RCL8（不能再升级）、hive 满格 12,900/12,900、0 个工地；
 *   · 修墙被能量闸挡住（`repairWallAffordable` 要求 storage ≥ 100,000，
 *     W33N55 只有 87,532）⇒ `needBuildWallWorkerFree` = false。
 * 于是 `workerManagerAfterCarrier` 里「空手」与「有货」两侧同时断供：
 *   · 空手侧**无条件**发 `StorageCarryEnergyTasks` ⇒ 车去 storage 取 1,500；
 *   · 有货侧四条出路全不成立（hive 不需要 / 没工地 / 修不起墙 / 满级不能升）
 *     ⇒ 取回来的能量再没有任何出口，能量随尸体蒸发。
 *
 * 修法两侧同源（MEMORY 第 14 条）：
 *   · 取货前问 `workerHasConsumer`（判据与有货侧四条出路逐条对应）；
 *   · 有货且仍无人接手时，把货倒回 storage/terminal（唯一有意义的出口）。
 *
 * 这里验：
 *   ① RCL8 + hive 满 + 无工地 + 修不起墙（空手）⇒ **不许**去 storage 取
 *   ② 同上（有货）⇒ 必须倒回 storage
 *   ③ 负对照：同房有工地 / 有墙可修 / 等级 7 / hive 缺能 ⇒ 照常取货
 *   ④ 源码断言：取货闸与四条出路必须同源（任一条件漏掉即失败）
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");

function load() {
    const ctx = {
        console,
        Memory: { rooms: {}, marketSettings: {} },
        Game: { time: 100000, rooms: {}, shard: { name: "shard3" }, cpu: { bucket: 10000 }, getObjectById: () => null },
        RESOURCE_ENERGY: "energy",
        FIND_MY_CREEPS: 1, FIND_CONSTRUCTION_SITES: 2, FIND_SOURCES: 3, FIND_MY_SPAWNS: 4,
        OK: 0, ERR_FULL: -8,
        // 真机语义：hive 未满 ⇔ 有 spawn/extension 要填
        StationHive: {
            HiveNeedToFill: room => room.energyAvailable < room.energyCapacityAvailable,
            generatorFillHiveTask: () => [{ taskName: "fillHive" }],
        },
        StationCarry: {
            // 空手 worker 唯一会拿到的「取货」任务
            generatorCarryStorageEnergyTask: room => [{ taskName: "carryRes", id: room.storage.id }],
        },
        StationSources: {
            stationName: "stationSources",
            generatorCarryEnergyTask: () => [],
        },
        StationWork: {
            constructionNeedBuild: room => room._hasBuild === true,
            generatorBuildTask: () => [{ taskName: "build" }],
        },
        StationDefense: {
            needBuildWallWorkerFree: room => room._wallFree === true,
            generatorRepairTask: () => [{ taskName: "repairWall" }],
        },
        StationUpgrade: {
            generatorUpgradeTask: () => [{ taskName: "upgradeKeeper" }],
        },
        StationLab: { boostAbleLevel: () => -1 },
        UtilsTask: { task: (obj, taskName, regFun, ops) => Object.assign({ taskName, id: obj && obj.id }, ops || {}) },
    };
    ctx.global = ctx;
    vm.runInNewContext(raw, ctx, { filename: "strategy_highLevel.js" });
    assert.ok(ctx.global.StrategyHighLevel, "StrategyHighLevel 未导出");
    return ctx.global.StrategyHighLevel;
}

/** 与 prototype_creep.js 一致的极简 store */
function mkStore(obj) {
    return {
        ...obj,
        getUsedCapacity(res) {
            if (res === undefined) return Object.keys(obj).reduce((a, k) => a + obj[k], 0);
            return obj[res] || 0;
        },
    };
}

function mkCreep({ store = {}, tasks = [], ttl = 1200, pos = "37,18" } = {}) {
    const creep = {
        memory: { role: "worker", tasks: [] },
        store: mkStore(store),
        ticksToLive: ttl,
        pos: { x: 0, y: 0, toString: () => pos },
        _dumped: false,
        isFree() { return !this.memory.tasks.length; },
        storeEmpty() { return this.store.getUsedCapacity() === 0; },
        mainRoom() { return this.homeRoom; },
        headTask() { return this.memory.tasks.head ? this.memory.tasks.head() : undefined; },
        addTask(t) {
            const ls = Array.isArray(t) ? t : [t];
            ls.forEach(e => this.memory.tasks.push(e));
        },
        fillAllMainRoomStorage() {
            this._dumped = true;
            this.memory.tasks.push({ taskName: "fillRes", id: this.mainRoom().storage.id });
        },
    };
    creep.memory.tasks = tasks.slice();
    return creep;
}

/**
 * RCL8 房：hive 满（avail == cap）、storage 低于修墙门槛。
 * `opts` 用来打开四条出路中的某一条作为负对照。
 */
function mkRoom(opts = {}) {
    const {
        level = 8, cap = 12900, avail = 12900,
        storageEnergy = 87532, hasBuild = false, wallFree = false, downGrade = false,
    } = opts;
    const storage = {
        id: "stor", store: mkStore({ energy: storageEnergy }),
    };
    const room = {
        name: "W33N55",
        level,
        energyAvailable: avail,
        energyCapacityAvailable: cap,
        storage,
        terminal: { id: "term", store: mkStore({ energy: 50000 }) },
        controller: { level },
        _hasBuild: hasBuild,
        _wallFree: wallFree,
        creeps() { return this._creeps; },
        isDownGrade() { return downGrade; },
        getEnergyAvailable() { return avail; },
        getEnergyCapacityAvailable() { return cap; },
    };
    room._creeps = [];
    return room;
}

function withCreeps(room, list) {
    room._creeps = list;
    list.forEach(c => { c.homeRoom = room; });
    return room;
}

{
    // ── ① RCL8 + hive 满 + 无工地 + 修不起墙（空手）⇒ 不许去 storage 取 ──────
    const High = load();
    const w = mkCreep({ store: {}, ttl: 1045 });
    const room = withCreeps(mkRoom(), [w]);
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 0,
        "RCL8 房没有下家时，空手 worker 不许再去 storage 取能量（取回来只能站着，能量随尸体蒸发）："
        + JSON.stringify(w.memory.tasks));
}

{
    // ── ② 同上（有货）⇒ 必须倒回 storage ──────────────────────────────────
    const High = load();
    const w = mkCreep({ store: { energy: 1500 }, ttl: 612 });
    const room = withCreeps(mkRoom(), [w]);
    High.workerManagerAfterCarrier(room);
    assert.ok(w._dumped, "载 1,500 能量且四条出路全不成立时必须倒回 storage，实得 tasks=" + JSON.stringify(w.memory.tasks));
    assert.equal(w.memory.tasks[0].taskName, "fillRes");
    assert.equal(w.memory.tasks[0].id, "stor");
}

{
    // ── ③ 四条出路各开一条：照常取货（负对照，别把正常房一起关掉）──────────
    const cases = [
        ["有工地", { hasBuild: true }],
        ["有墙可修", { wallFree: true }],
        ["等级 7（还能升级）", { level: 7, cap: 12900 }],
        ["hive 缺能", { avail: 3000 }],
    ];
    cases.forEach(([label, opts]) => {
        const High = load();
        const w = mkCreep({ store: {}, ttl: 1045 });
        const room = withCreeps(mkRoom(opts), [w]);
        High.workerManagerAfterCarrier(room);
        assert.ok(w.memory.tasks.length > 0,
            label + "：有下家就必须照常取货，实得 tasks=" + JSON.stringify(w.memory.tasks));
    });
}

{
    // ── ④ 升级降级（isDownGrade）⇒ 也不该再搬 ────────────────────────────
    const High = load();
    const w = mkCreep({ store: {}, ttl: 1045 });
    const room = withCreeps(mkRoom({ downGrade: true, level: 5 }), [w]);
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 0, "掉级中的房不该再给 worker 派能量搬运");
}

{
    // ── ⑤ 源码断言：取货闸与四条出路必须同源（MEMORY 第 14 条）─────────────
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(code.includes("pro.workerHasConsumer(room, creep)"),
        "取货点必须问 workerHasConsumer：无条件发 StorageCarryEnergyTasks 就是本次故障");
    assert.ok(/if \(creep\.isFree\(\) && !creep\.storeEmpty\(\)\) creep\.fillAllMainRoomStorage\(\)/.test(code),
        "有货侧必须留一个「倒回 storage」的兜底出口");

    const fnStart = code.indexOf("workerHasConsumer(room, creep)");
    const fnEnd = code.indexOf("workerManagerAfterCarrier(room)", fnStart);
    const fn = code.slice(fnStart, fnEnd);
    [
        ["hive 需要填", "HiveNeedToFill"],
        ["掉级", "isDownGrade"],
        ["还能升级", "level < 8"],
        ["有工地", "constructionNeedBuild"],
        ["有墙可修", "needBuildWallWorkerFree"],
    ].forEach(([label, token]) => {
        assert.ok(fn.includes(token), "workerHasConsumer 必须判「" + label + "」（" + token + "），否则闸与出路不同源");
    });
}

console.log("worker-no-consumer: passed");
