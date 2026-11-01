/**
 * worker / carrier 的孵化体型必须**本 tick 真付得起**（2026-11-01，upgrader 同案的同胞）。
 *
 * `StationHive.trySpawn` 的判据是
 *   `if (room.currentEnergyAvailable < spend) { room.spawnFailure = true; return undefined }`
 * —— 付不起就静默放弃，而且 `spawnFailure` 是整 tick 的粘滞标记：本房这次失败会把
 * **后面的** carrier / 外矿补员一起吞掉。所以「按满容量算体型」不是一个保守的写法，
 * 它是「hive 不满格就一只都生不出来」。
 *
 * 本轮修的是同一形态的三处（上一轮已修 upgrader，见 upgrader-affordable-body）：
 *   ① `strategy_highLevel.workerManager`：`HiveNeedToFill && energyAvailable < 2500`
 *      写死 2,500（RCL8 的量级）。RCL6 容量只有 2,300 ⇒ 恒真 ⇒ **hive 一缺能就永不出
 *      worker**，RCL6 房连自己的工地都盖不动。
 *   ② 同一个函数里 worker 的体型按 `getEnergyCapacityAvailable()` 算（2,300），
 *      门槛放行了也付不起。
 *   ③ `trySpawnCarrier`：`>= 2500` 的「按满配补」分支对 cap ≤ 2,500 的房**永不可达**，
 *      只剩 750 的应急小爬；「缺能就不许走 avgBusy 那条」的闸也是写死 2,500。
 *
 * 这里锁住四件事：
 *   ① 体型函数带预算时造价 ≤ 预算；不带预算时仍按容量（负对照：忽略预算参数即失败）
 *   ② RCL6 / hive 1,500 / 有工地 ⇒ worker 必须能派，且体型付得起（旧代码一只都不派）
 *   ③ RCL6 / hive 1,500 ⇒ carrier 走「按预算满配」而不是写死的 750 应急小爬
 *   ④ RCL8 回归：门槛与体型与旧行为完全一致（2,500），别为了修小房把大房改弱
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, "modules", f), "utf8");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const COST = { tough: 10, work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, claim: 600 };
const bodyCost = body => body.reduce((a, p) => a + (COST[p] || 0), 0);

function makeCtx(spawned) {
    const ctx = {
        console,
        Memory: { marketSettings: {}, rooms: {} },
        Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" }, rooms: {}, creeps: {} },
        Creep: { prototype: {} },
        Room: function () {},
        TOUGH: "tough", WORK: "work", CARRY: "carry", MOVE: "move",
        ATTACK: "attack", RANGED_ATTACK: "ranged_attack", HEAL: "heal", CLAIM: "claim",
        BODYPART_COST: COST,
        RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power",
        STRUCTURE_LINK: "link", STRUCTURE_STORAGE: "storage", STRUCTURE_CONTAINER: "container",
        STRUCTURE_TERMINAL: "terminal", STRUCTURE_SPAWN: "spawn", STRUCTURE_EXTENSION: "extension",
        STRUCTURE_LAB: "lab", STRUCTURE_TOWER: "tower", STRUCTURE_ROAD: "road", STRUCTURE_RAMPART: "rampart",
        FIND_MY_CREEPS: 102, FIND_STRUCTURES: 101, FIND_MY_STRUCTURES: 111, FIND_SOURCES: 105,
        FIND_CONSTRUCTION_SITES: 107, FIND_DROPPED_RESOURCES: 108, FIND_FLAGS: 110,
        OK: 0, MIN_CPU: false, isSaveCpu: false, WHO_AM_I: "an_w", MAX_GCL: 150,
        LOCAL_SHARD_NAME: "shard3",
        CONTROLLER_STRUCTURES: { extension: { 8: 60, 7: 50, 6: 40, 5: 30, 4: 20 } },
        ManagerCreeps: {
            calcBodyPart(set) {
                const out = [];
                Object.keys(set).forEach(t => { for (let i = 0; i < set[t]; i++) out.push(t); });
                return out;
            },
        },
        ManagerRooms: {}, ManagerFlags: {}, HelperError: { catchError: fn => fn() },
        Utils: {
            getBodyEnergyNeed: body => bodyCost(body),
            randomGet: a => a,
        },
        UtilsTask: { task: (obj, taskName, regFun, ops) => Object.assign({ taskName, id: obj && obj.id, regFun }, ops || {}) },
        // 真机里能量不够时 trySpawn 只 `return undefined`，桩必须如实失败，
        // 否则「闸门放行但体型付不起」这个 bug 在测试里永远看不见。
        StationHive: {
            trySpawn(room, targetRoomName, body, role) {
                const cost = bodyCost(body);
                const ok = cost <= room.energyAvailable;
                spawned.push({ role, body, cost, ok, avail: room.energyAvailable });
                return ok ? "creep" : undefined;
            },
            HiveNeedToFill: room => room.energyAvailable < room.energyCapacityAvailable,
            isEnergyAbundant: () => true,
        },
        StationSources: {}, StationUpgrade: {}, StationMineral: {}, StationObserver: {},
        StationTower: {}, StationLab: null, StationFactory: {}, StationDefense: {
            getRepairWorkerLimit: () => 1, needBuildWall: () => false,
        },
        StrategyOuterHarvest: {}, isCpuFeatureEnabled: () => true,
        LOG: () => {},
    };
    ctx.global = ctx;
    return vm.createContext(ctx);
}

/** 把模块包在 IIFE 里跑：两份源码都有顶层 `let pro`，同域直接跑会重复声明。 */
function loadModules(ctx, files) {
    vm.runInContext(
        "Array.prototype.sum = function(){ return this.reduce((a,b)=>a+b,0); };" +
        "Array.prototype.head = function(){ return this.length ? this[0] : undefined; };" +
        "Array.prototype.last = function(){ return this.length ? this[this.length-1] : undefined; };",
        ctx);
    files.forEach(f => {
        vm.runInContext("(function(){" + read(f) + "\n})()", ctx, { filename: f });
    });
    return ctx;
}

/** `carryBusy.sum()` 线上是 lodash 挂在 Array 上的；vm 里给宿主数组挂实例方法。 */
function withSum(arr) {
    arr.sum = function () { return this.reduce((a, b) => a + b, 0); };
    return arr;
}

function mkRoom({ level = 6, cap = 2300, avail = 1500, storageEnergy = 49066, sites = 0,
    carriers = 0, workers = 0, keepers = 1, links = 0, hashCode = 50 } = {}) {
    const mkCarrier = busy => ({
        spawning: false, body: [{ type: "carry" }], ticksToLive: 1000,
        store: { getCapacity: () => 800 }, isFree: () => !busy, memory: { role: "carrier" },
        getPartCnt: () => 10,
    });
    const carrierList = Array.from({ length: carriers }, () => mkCarrier(false));
    const workerList = Array.from({ length: workers }, () => ({ spawning: false, memory: { role: "worker" }, ticksToLive: 1000 }));
    const keeperList = Array.from({ length: keepers }, () => ({ spawning: false, memory: { role: "harvestEnergyKeeper" }, ticksToLive: 1000 }));
    return {
        name: "W26N58",
        my: true,
        level,
        energyAvailable: avail,
        energyCapacityAvailable: cap,
        currentEnergyAvailable: undefined,
        storage: { id: "stor", store: { energy: storageEnergy } },
        terminal: { id: "term", my: true, store: { energy: 48500 } },
        link: new Array(links).fill({}),
        source: [{ id: "s0" }, { id: "s1" }],
        constructionSite: Array.from({ length: sites }, (_, i) => ({ id: "site" + i })),
        controller: { level, progress: 100, progressTotal: 3645000, ticksToDowngrade: 120000 },
        memory: { carryBusy: withSum([2, 2, 2]), stationUpgrade: {} },
        getEnergyAvailable() { return avail; },
        getEnergyCapacityAvailable() { return cap; },
        hashCode: () => hashCode,
        flags() { const a = []; a.head = () => undefined; a.filter = () => a; return a; },
        find: () => [],
        creeps(role) {
            if (role === "carrier") return carrierList;
            if (role === "worker") return workerList;
            if (role === "harvestEnergyKeeper") return keeperList;
            return [];
        },
    };
}

// ── ① 体型函数：带预算就必须按预算收缩 ─────────────────────────────────────
{
    const ctx = loadModules(makeCtx([]), ["station_carry.js", "station_work.js"]);

    const rich = mkRoom({ cap: 2300, carriers: 2, keepers: 1 });
    const cheap = mkRoom({ cap: 2300, carriers: 2, keepers: 1 });

    const fullCarrier = ctx.StationCarry.getCarrierBodyConfig(rich);
    const budgetCarrier = ctx.StationCarry.getCarrierBodyConfig(cheap, 600);
    assert.equal(bodyCost(fullCarrier), 2250,
        "不带预算时仍按本房容量 2,300 算（既有行为，别改）");
    assert.ok(bodyCost(budgetCarrier) <= 600,
        "带预算 600 时体型必须付得起，否则 trySpawn 静默失败：cost=" + bodyCost(budgetCarrier));
    assert.ok(budgetCarrier.includes("carry"), "收缩后必须还有 CARRY 部件：" + JSON.stringify(budgetCarrier));

    // 房里有 carrier 时 worker 体型才走「按容量」那条（一只都没有时是 bootstrap 分支）
    const fullWorker = ctx.StationWork.getMiddleLevelWorkerBodyConfig(mkRoom({ sites: 1, carriers: 2 }));
    const budgetWorker = ctx.StationWork.getMiddleLevelWorkerBodyConfig(mkRoom({ sites: 1, carriers: 2 }), 400);
    assert.equal(bodyCost(fullWorker), 2200, "不带预算时 worker 仍按容量 2,300 算");
    assert.ok(bodyCost(budgetWorker) <= 400,
        "带预算 400 时 worker 体型必须付得起：cost=" + bodyCost(budgetWorker));
    assert.ok(budgetWorker.includes("work"), "收缩后必须有 WORK 部件");
}

// ── ② RCL6 / hive 1,500 / 有工地 ⇒ worker 必须派得出来且付得起 ─────────────
{
    const spawned = [];
    const ctx = loadModules(makeCtx(spawned), ["station_carry.js", "station_work.js", "strategy_highLevel.js"]);
    ctx.StrategyHighLevel.workerManager(mkRoom({ sites: 2, avail: 1500, cap: 2300 }));

    assert.equal(spawned.length, 1,
        "hive 1,500（cap 2,300 的 65%）不该挡住 worker：旧门槛写死 2,500 对 RCL6 恒真，"
        + "整房 0 worker、自己的工地永远盖不动");
    assert.equal(spawned[0].role, "worker");
    assert.ok(spawned[0].ok,
        "体型必须 ≤ 本 tick 可用能量，否则 trySpawn 静默失败并把 spawnFailure 置真"
        + `：cost=${spawned[0].cost} avail=${spawned[0].avail}`);
}

// ── ③ RCL6 / hive 1,500 ⇒ carrier 走「按预算满配」，不是写死的 750 小爬 ─────
{
    const spawned = [];
    const ctx = loadModules(makeCtx(spawned), ["station_carry.js", "station_work.js", "strategy_highLevel.js"]);
    ctx.StrategyHighLevel.trySpawnCarrier(mkRoom({ carriers: 2, avail: 1500, cap: 2300 }));

    assert.equal(spawned.length, 1, "hive 有缺口 + 编制不满，必须补一只 carrier");
    assert.ok(spawned[0].ok, `体型必须付得起：cost=${spawned[0].cost} avail=${spawned[0].avail}`);
    assert.ok(spawned[0].cost > 750,
        "必须走「按预算满配」那条分支（旧代码 >= 2500 对 RCL6 永不可达，"
        + `只剩 750 的应急小爬）：cost=${spawned[0].cost}`);
}

// ── ④ RCL8 回归：门槛与体型与旧行为一致（2,500 满配）───────────────────────
{
    const spawned = [];
    const ctx = loadModules(makeCtx(spawned), ["station_carry.js", "station_work.js", "strategy_highLevel.js"]);
    ctx.StrategyHighLevel.trySpawnCarrier(mkRoom({
        level: 8, cap: 12900, avail: 12900, carriers: 1, storageEnergy: 120000, links: 4,
    }));
    assert.equal(spawned.length, 1, "RCL8 / hive 满格 / 编制不满：照旧要补一只");
    assert.equal(spawned[0].cost, 2500,
        "RCL8 的满配体型必须还是 2,500（33 CARRY + 17 MOVE），别为了修小房改大房");
}

// ── ⑤ 源码断言：门槛按容量折算、体型带预算调用 ───────────────────────────
{
    const high = strip(read("strategy_highLevel.js"));
    assert.ok(high.includes("spawnTickBudget(room)"),
        "体型必须按 spawnTickBudget（本 tick 可花的钱）算");
    assert.ok(!/room\.energyAvailable\s*<\s*2500\b/.test(high),
        "负对照：不许再出现写死的 room.energyAvailable < 2500");
    assert.ok(!/room\.energyAvailable\s*>=\s*2500\b/.test(high),
        "负对照：不许再出现写死的 room.energyAvailable >= 2500（对 cap ≤ 2,500 的房永不可达）");
    assert.ok(/carrierBodyMinEnergy\s*=\s*Math\.min\(2500,\s*\(room\.energyCapacityAvailable \|\| 0\) \* 0\.6\)/.test(high),
        "carrier 的「够满配」门槛必须按本房容量折算");
    assert.ok(high.includes("Math.min(2500, room.energyCapacityAvailable * 0.5)"),
        "worker 的空 hive 保护门槛必须按本房容量折算");
    assert.ok(!high.includes("getCarrierBodyConfig(room)"),
        "负对照：carrier 体型必须带预算调用，不许再有无预算的 getCarrierBodyConfig(room)");
    assert.ok(!high.includes("getMiddleLevelWorkerBodyConfig(room)"),
        "负对照：worker 体型必须带预算调用");
}

console.log("spawn-body-budget: passed");
