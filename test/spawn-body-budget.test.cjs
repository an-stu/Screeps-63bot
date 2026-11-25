/**
 * worker / carrier 的孵化体型必须**本 tick 真付得起**（2026-11-01，upgrader 同案的同胞）。
 *
 * `StationHive.trySpawn` 的判据是
 *   `if (room.currentEnergyAvailable < spend) { room.spawnFailure = true; return undefined }`
 * —— 付不起就静默放弃，而且 `spawnFailure` 是整 tick 的粘滞标记：本房这次失败会把
 * **后面的** carrier / 外矿补员一起吞掉。所以「按满容量算体型」不是一个保守的写法，
 * 它是「hive 不满格就一只都生不出来」。
 *
 * 用户 2026-11-26 定稿：正常补员必须尽量大体型；hive 临时低能量**不得**缩成
 * 小爬，付不起就等。只有 worker 与 carrier 同时为零的极端缺爬阶段才允许使用
 * 当前预算内的救急体型。
 *
 * 这里锁住四件事：
 *   ① 普通 worker/carrier 体型函数忽略临时预算，正常房始终按容量满配
 *   ② RCL6 / hive 1,500 / 无 worker+carrier ⇒ 救急 worker 可出且付得起
 *   ③ RCL6 / hive 1,500 / 已有 carrier ⇒ 不再出 750 小爬；等 hive 达到满配再出
 *   ④ RCL8 回归：满配体型保持 2,500
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

// ── ① 普通房忽略临时预算，始终返回容量满配 ─────────────────────────────────
{
    const ctx = loadModules(makeCtx([]), ["station_carry.js", "station_work.js"]);

    const rich = mkRoom({ cap: 2300, carriers: 2, keepers: 1 });
    const cheap = mkRoom({ cap: 2300, carriers: 2, keepers: 1 });

    const fullCarrier = ctx.StationCarry.getCarrierBodyConfig(rich);
    const budgetCarrier = ctx.StationCarry.getCarrierBodyConfig(cheap, 600);
    assert.equal(bodyCost(fullCarrier), 2250, "正常房 carrier 按本房容量 2,300 满配");
    assert.equal(bodyCost(budgetCarrier), 2250,
        "临时预算 600 不得把正常补员缩成小 carrier；付不起应由调用方等待");

    const fullWorker = ctx.StationWork.getMiddleLevelWorkerBodyConfig(mkRoom({ sites: 1, carriers: 2 }));
    const budgetWorker = ctx.StationWork.getMiddleLevelWorkerBodyConfig(mkRoom({ sites: 1, carriers: 2 }), 400);
    assert.equal(bodyCost(fullWorker), 2200, "正常房 worker 按容量 2,300 满配");
    assert.equal(bodyCost(budgetWorker), 2200,
        "临时预算 400 不得把正常 worker 缩成小体型");

    const lowFull = ctx.StationWork.getLowLevelWorkerBodyConfig(
        mkRoom({ cap: 800, avail: 250, workers: 1, carriers: 1 }));
    assert.equal(bodyCost(lowFull), 750,
        "RCL<3 房只要还有 worker/carrier，低 hive 也必须按容量满配");
    const lowEmergency = ctx.StationWork.getLowLevelWorkerBodyConfig(
        mkRoom({ cap: 800, avail: 250, workers: 0, carriers: 0 }));
    assert.equal(bodyCost(lowEmergency), 250,
        "worker+carrier 双缺时才允许用当前 250 能量出救急 worker");

    const noCarrierButWorker = ctx.StationCarry.getCarrierBodyConfig(
        mkRoom({ cap: 2300, workers: 1, carriers: 0, keepers: 1 }), 600);
    assert.equal(bodyCost(noCarrierButWorker), 2250,
        "还有 worker 时 carrier 也必须满配，临时预算不得缩体型");
}

// ── ② RCL6 / hive 1,500 / 有工地 ⇒ worker 必须派得出来且付得起 ─────────────
{
    const spawned = [];
    const ctx = loadModules(makeCtx(spawned), ["station_carry.js", "station_work.js", "strategy_highLevel.js"]);
    ctx.StrategyHighLevel.workerManager(mkRoom({ sites: 2, avail: 1500, cap: 2300 }));

    assert.equal(spawned.length, 1, "worker+carrier 双缺时必须能出救急 worker");
    assert.equal(spawned[0].role, "worker");
    assert.ok(spawned[0].ok,
        "救急体型必须 ≤ 本 tick 可用能量"
        + `：cost=${spawned[0].cost} avail=${spawned[0].avail}`);
}

// ── ③ 已有 carrier 时 hive 不足：等满配，不再生产 750 小爬 ─────────────────
{
    const spawned = [];
    const ctx = loadModules(makeCtx(spawned), ["station_carry.js", "station_work.js", "strategy_highLevel.js"]);
    ctx.StrategyHighLevel.trySpawnCarrier(mkRoom({ carriers: 2, avail: 1500, cap: 2300 }));
    assert.equal(spawned.length, 0,
        "房里有 carrier、hive 只有 1,500 时必须等满配，不得再产 750 小 carrier");

    const full = [];
    const fullCtx = loadModules(makeCtx(full), ["station_carry.js", "station_work.js", "strategy_highLevel.js"]);
    fullCtx.StrategyHighLevel.trySpawnCarrier(mkRoom({ carriers: 2, avail: 2300, cap: 2300 }));
    assert.equal(full.length, 1, "hive 达到满配后应补一只 carrier");
    assert.equal(full[0].cost, 2250, "补员必须是满配体型，不是 750 应急小爬");
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

// ── ⑤ 源码断言：正常体型满配，预算只用于拒绝/极端救急 ─────────────────────
{
    const high = strip(read("strategy_highLevel.js"));
    assert.ok(high.includes("spawnTickBudget(room)"),
        "付得起性仍必须按 spawnTickBudget（本 tick 可花的钱）判断");
    assert.ok(!/room\.energyAvailable\s*<\s*2500\b/.test(high),
        "负对照：不许再出现写死的 room.energyAvailable < 2500");
    assert.ok(!/room\.energyAvailable\s*>=\s*2500\b/.test(high),
        "负对照：不许再出现写死的 room.energyAvailable >= 2500");
    assert.ok(/carrierBodyMinEnergy\s*=\s*Math\.min\(2500,\s*\(room\.energyCapacityAvailable \|\| 0\) \* 0\.6\)/.test(high),
        "carrier 的「够满配」门槛必须按本房容量折算");
    assert.ok(high.includes("workerCnt == 0 && carrierCnt == 0"),
        "只有 worker+carrier 双缺才允许救急分支");
    assert.ok(!high.includes("getCarrierBodyConfig(room, pro.spawnTickBudget(room))"),
        "正常 carrier 不得再按临时预算缩体型");
    assert.ok(!high.includes("getMiddleLevelWorkerBodyConfig(room, pro.spawnTickBudget(room))"),
        "正常 worker 不得再按临时预算缩体型");
}

console.log("spawn-body-budget: passed");
