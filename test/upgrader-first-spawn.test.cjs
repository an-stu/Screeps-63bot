const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const hlSrc = fs.readFileSync(path.join(root, "modules/strategy_highLevel.js"), "utf8");
const srcSrc = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

/** 去掉行注释与块注释，源码断言只看代码形状（MEMORY 第 9 条）。 */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * 「还在升级的房（RCL<8）一只 upgrader 都没有」时，必须先救生长。
 *
 * 2026-11-05 W26N58（RCL6、单 spawn、hive 2,300）实测：
 *   · 两个源容器 2,000/2,000 满、三个 link 全满、地面 8,356 且在涨（全账号 +6.4/tick）；
 *   · 控制器 0 只 upgrader，`stationUpgrade.creeps` 空；
 *   · spawn 队列（`__ts` 埋点 tick 84082272）：
 *     worker(33 部件/2,200) → outerHarvestEnergyCarrier×4(1,050) → upgrader(2,100)。
 *     前者把 hive 一次抽到 100 并占住 spawn 99 tick，紧接着的几个 pass
 *     hive 只有 114 / 1,350 / 2,050，upgrader 每次都被占用/付不起挡掉。
 *
 * 修法：退化态（0 只 upgrader 且 RCL<8）暂停**可选岗位**（修墙 worker、外矿搬运）
 * 的补员，把 spawn 空出来的第一个窗口让给 upgrader；孵出即自清。
 */

// ── 1. `upgraderStarved` 的判据本身（行为层） ──────────────────────────────
const helperSrc = hlSrc.match(/\n {4}upgraderStarved\(room\) \{[\s\S]*?\n {4}\},/);
assert.ok(helperSrc, "strategy_highLevel.upgraderStarved 必须存在");

const ctx = {};
vm.runInNewContext("var pro = {" + helperSrc[0] + "\n};", ctx, { filename: "upgraderStarved.js" });
const starved = ctx.pro.upgraderStarved;

const mockRoom = (level, upgraderCnt, opts) => Object.assign({
    my: true,
    level,
    controller: { id: "c" },
    // 本服 `room.creeps(role, false)` 把**孵化中的**也算进编制
    creeps: role => new Array(role === "upgrader" ? upgraderCnt : 0).fill({ id: "x" }),
}, opts || {});

assert.equal(starved(mockRoom(6, 0)), true, "RCL6 + 0 只 upgrader ⇒ 退化态");
assert.equal(starved(mockRoom(6, 1)), false, "孵出第一只后立刻自清");
assert.equal(starved(mockRoom(5, 0)), true, "RCL5 同理");
assert.equal(starved(mockRoom(8, 0)), false, "RCL8 不再长，upgrader 只是维持项 ⇒ 不抢 spawn");
assert.equal(starved(mockRoom(6, 0, { my: false })), false, "别人的房不管");
assert.equal(starved(mockRoom(6, 0, { controller: undefined })), false, "没有控制器不管");
assert.equal(starved(null), false, "空输入不炸");

// ── 2. 两个调用点必须真的用这道闸（源码层，剥注释后看调用形状） ────────────
const hlCode = strip(hlSrc);
assert.ok(/needBuildWall\(room\) && !MIN_CPU && !pro\.upgraderStarved\(room\)/.test(hlCode),
    "修墙 worker 的孵化分支必须被 upgraderStarved 挡住（它 33 部件 / 2,200 能量会抽干 hive）");

const srcCode = strip(srcSrc);
assert.ok(/high\.upgraderStarved\(spawnRoom\)/.test(srcCode),
    "外矿搬运补员必须被 upgraderStarved 挡住（它在调用顺序上排在 upgrader 之前）");

// 闸门必须在「按矿点循环补员」之前 —— 否则第一只车已经孵了才检查。
const gateIdx = srcCode.indexOf("high.upgraderStarved(spawnRoom)");
const loopIdx = srcCode.indexOf("_.values(sm).forEach(data => {", gateIdx - 4000);
assert.ok(gateIdx > 0 && gateIdx > loopIdx, "闸门要落在补员循环之前");

// ── 3. 孵化预算缓存不得被清掉（`room.energyAvailable` 同 tick 内是旧值） ────
const nowSrc = hlSrc.match(/\n {8}let spawnCarrierNow = function \(body\) \{[\s\S]*?\n {8}\};/);
assert.ok(nowSrc, "spawnCarrierNow 必须存在");
const nowCode = strip(nowSrc[0]);
assert.ok(!/currentEnergyAvailable\s*=\s*undefined/.test(nowCode),
    "spawnCarrierNow 不能清 currentEnergyAvailable（会让同一 pass 后面的 upgrader 按满格旧值算体型）");
assert.ok(/spawnFailure\s*=\s*false/.test(nowCode), "但必须解掉 spawnFailure 这个粘滞标记");

// 外矿 carrier 那条同样紧挨着 upgrader，判据同源。
const outBody = srcSrc.match(/\n {4}trySpawnOuterHarCarrier\(roomName, spawnRoom\) \{[\s\S]*?\n {4}\},/);
assert.ok(outBody, "trySpawnOuterHarCarrier 必须存在");
const outCode = strip(outBody[0]);
assert.ok(!/currentEnergyAvailable\s*=\s*undefined/.test(outCode),
    "外矿 carrier 补员也不能清 currentEnergyAvailable");

// ── 4. 行为层：退化态下外矿搬运**真的**不去要 spawn ─────────────────────────
const harness = {
    console,
    Game: {
        time: 5000,
        getObjectById: id => ({ id, energyCapacity: 4000, store: { energy: 2000 } }),
    },
    Memory: { rooms: {}, marketSettings: {} },
    _: { values: o => Object.values(o) },
    WORK: "work",
    CARRY: "carry",
    MOVE: "move",
    HARVEST_POWER: 2,
    SOURCE_REGEN_TICKS: 300,
    OUTER_CARRIER_PRESPAWN: 50,
    OUTER_ROAD_BUILDER_CNT: 1,
    STRUCTURE_CONTAINER: "container",
    UtilsTask: { task: () => ({}) },
    HelperError: { catchError: fn => fn() },
    StationHive: { trySpawn: (rm, name, body, role) => { harness.__spawned.push(role); return "x"; } },
    global: null,
};
harness.global = harness;
harness.__spawned = [];
// 本服 patch 过 Array.prototype（`head()`），VM 是独立 realm，两边都要补。
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
vm.runInNewContext(
    "Array.prototype.head = function(){ return this.length ? this[0] : undefined; };"
    + "var pro = {" + outBody[0] + "\n};", harness, { filename: "trySpawnOuterHarCarrier.js" });

const makeSpawnRoom = upgraderCnt => ({
    name: "W26N58",
    my: true,
    level: 6,
    storage: { id: "st" },
    spawn: [{ spawning: null, isActive: () => true }],
    source: [{ id: "a" }, { id: "b" }],
    getEnergyAvailable: () => 2300,
    getEnergyCapacityAvailable: () => 2300,
    energyAvailable: 2300,
    // keeper 满员（否则会被「keeper<src」那道更早的闸挡住，测不到本例），
    // carrier 0 只 ⇒ 运力缺口必然 > 0
    creeps: role => new Array(role === "harvestEnergyKeeper" ? 2 : role === "upgrader" ? upgraderCnt : 0)
        .fill({ headTask: () => ({ roomName: "W26N59", id: "src1" }), getPartCnt: () => 0 }),
});
harness.Memory.rooms.W26N59 = {
    stationSources: {
        src1: { id: "src1", x: 10, y: 20, container: "cid", pathTime: 50, carryCreeps: [] },
    },
    __outerWhy: "",
};

Object.assign(harness.pro, {
    stationName: "stationSources",
    ensureOuterRoadPath: () => null,
    placeOuterRoadSites: () => null,
    cleanupOuterRoadSites: () => null,
    ensureOuterEdgeLink: () => null,
    outerCarrierFleetCap: () => 6,
    outerMineStarvesSpawnRoom: () => false,
    outerMineWaitingByMine: () => 0,
    outerCarrierTripCapacity: () => 1700,
    getOuterHarCarrierBodyConfig: () => new Array(20).fill("carry"),
    getOuterHarCarrierBuildBodyConfig: () => new Array(20).fill("carry"),
    generatorOuterHarCarryTask: () => [{}],
    outerRoadComplete: () => true,
    getHarvesterBodyConfig: () => new Array(10).fill("work"),
});
harness.StationSources = harness.pro;

// ① 退化态：0 只 upgrader ⇒ 一只车都不许孵
harness.global.StrategyHighLevel = {
    upgraderStarved: room => room.level < 8 && room.creeps("upgrader", false).length === 0,
    spawnTickBudget: () => 2300,
};
harness.__spawned = [];
harness.pro.trySpawnOuterHarCarrier("W26N59", makeSpawnRoom(0));
assert.deepEqual(harness.__spawned, [], "0 只 upgrader 时外矿搬运不得占用 spawn");
assert.ok(/^needUpgrader/.test(harness.Memory.rooms.W26N59.__outerWhy),
    "`__outerWhy` 要写明被哪道闸挡住（- 否则外面只能看到 noFreeSpawn）");

// ② 对照：有 1 只 upgrader ⇒ 正常补员（证明闸门不是把外矿永久关掉）
harness.global.StrategyHighLevel = {
    upgraderStarved: room => room.level < 8 && room.creeps("upgrader", false).length === 0,
    spawnTickBudget: () => 2300,
};
const roomWithUpgrader = makeSpawnRoom(1);
harness.__spawned = [];
harness.pro.trySpawnOuterHarCarrier("W26N59", roomWithUpgrader);
assert.ok(harness.__spawned.includes("outerHarvestEnergyCarrier"),
    "有 upgrader 在岗时外矿补员必须恢复正常（负对照）");

console.log("upgrader-first spawn: OK");
