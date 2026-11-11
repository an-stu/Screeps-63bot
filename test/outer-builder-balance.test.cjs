/**
 * 外矿运力动态平衡：修路编制按「路线上真有工地」派 + 在途/在孵车占编制。
 *
 * 现场（2026-11-12，用户报「外矿运力过剩」）：W26N58 → W26N59 两个矿点，
 * 运输需求 ceil(pathTime×2×产出/50) = 32+26 = 58 CARRY ≈ 2 只 32 CARRY 的车，
 * 实际车队 5 只（160 CARRY，全是 2WORK+32CARRY 修路体型），容器 272/360 近空、
 * 地面无掉落 —— 车在等货。两条根因：
 *   ① 修路编制 builderCnt 只数已登记的 WORK 车，孵化 150 tick + 赶路 ~80 tick
 *      的在途窗口看不见新车 ⇒ 每个 pass 都判 <2 一直派（运输路径 2026-10-30
 *      修过的在途扣减，这条分支漏了）；
 *   ② 编制拿 outerRoadComplete（50% 血线）当判据，而沿途维修触发线是 25%/90%：
 *      路线只剩几个高流量格在 26~47% 衰减带、没有任何工地时，仍永久按
 *      每矿点 2 只专职修路爬要 spawn。
 *
 * 负对照（变异验证）：把编制判据改回常量 / 去掉在途计数 / 去掉体型选择的在途
 * WORK 覆盖，对应用例必须如实失败（见文末 mutation 段）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "modules", name), "utf8");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const srcSrc = read("station_sources.js");
const outBody = srcSrc.match(/\n {4}trySpawnOuterHarCarrier\(roomName, spawnRoom\) \{[\s\S]*?\n {4}\},/);
assert.ok(outBody, "trySpawnOuterHarCarrier 必须存在");

// ── 源码层：新判据与在途计数必须真的在代码里 ──────────────────────────────
{
    const code = strip(srcSrc);
    assert.ok(/let siteCnt = pro\.outerRoadSiteCount\(data\);/.test(code),
        "修路编制必须读路线工地数（动态平衡判据）");
    assert.ok(/let builderNeed = siteCnt == 0 \? 0 : OUTER_ROAD_BUILDER_CNT;/.test(code),
        "无工地 ⇒ 不派专职修路爬；有工地 ⇒ 恢复原编制");
    assert.ok(/if \(builderCnt < builderNeed/.test(code),
        "修路补员必须按动态编制判");
    assert.ok(!/if \(builderCnt < OUTER_ROAD_BUILDER_CNT/.test(code),
        "不能再拿常量编制直接判（衰减带会永久超编）");
    assert.ok(/carrierBuildCreep = roomCarriers\.find\(c => \{/.test(code),
        "体型选择必须把在途 WORK 车算作已有修路覆盖");
    assert.ok(/outerRoadSiteCount\(data\) \{/.test(code),
        "outerRoadSiteCount 助手必须存在");
}

// ── 行为层 harness：真函数 + 桩（与 upgrader-first-spawn 同一骨架） ────────
const PLAIN = ["plain-body-marker"];
const BUILD = ["build-body-marker"];

function makeHarness(opts) {
    const registered = opts.registered || [];   // 已登记且寿命够的车
    const inTransit = opts.inTransit || [];     // 在途/在孵（未登记）的车
    const fleet = registered.concat(inTransit);
    const byId = {};
    fleet.forEach(c => { byId[c.id] = c; });
    byId["src1"] = { id: "src1", energy: 1500, energyCapacity: 3000 };

    const harness = {
        console,
        Game: { time: 5000, getObjectById: id => byId[id] || null, rooms: {} },
        Memory: { rooms: {}, marketSettings: {} },
        _: { values: o => Object.values(o || {}) },
        WORK: "work", CARRY: "carry", MOVE: "move",
        HARVEST_POWER: 2, SOURCE_REGEN_TICKS: 300, OUTER_CARRIER_PRESPAWN: 100,
        OUTER_ROAD_BUILDER_CNT: 2,
        STRUCTURE_CONTAINER: "container", STRUCTURE_ROAD: "road",
        FIND_MY_CONSTRUCTION_SITES: "mySites",
        UtilsTask: { task: () => ({}), taskOutView: () => ({}) },
        HelperError: { catchError: fn => fn() },
        StationHive: { trySpawn: (rm, name, body, role) => { harness.__spawned.push({ role, body }); return "x"; } },
        global: null,
    };
    harness.global = harness;
    harness.__spawned = [];
    harness.Memory.rooms.W26N59 = {
        stationSources: {
            src1: {
                id: "src1", x: 10, y: 20, container: "cid",
                pathTime: opts.pathTime || 50,
                carryCreeps: registered.map(c => c.id),
            },
        },
        __outerWhy: "",
    };
    const spawnRoom = {
        name: "W26N58", my: true, level: 8,
        storage: { id: "st" },
        spawn: [{ spawning: null, isActive: () => true }],
        source: [{ id: "a" }, { id: "b" }],
        getEnergyAvailable: () => 6000,
        getEnergyCapacityAvailable: () => 12900,
        energyAvailable: 6000,
        creeps: role => {
            if (role === "harvestEnergyKeeper") return [{}, {}];  // 本房 keeper 满员
            if (role === "outerHarvestEnergyCarrier") return fleet;
            return [{}];
        },
    };
    harness.__spawnRoom = spawnRoom;
    Array.prototype.head = function () { return this.length ? this[0] : undefined; };
    vm.runInNewContext(
        "Array.prototype.head = function(){ return this.length ? this[0] : undefined; };"
        + "var pro = {" + (opts.mutate ? opts.mutate(outBody[0]) : outBody[0]) + "\n};",
        harness, { filename: "trySpawnOuterHarCarrier.js" });
    Object.assign(harness.pro, {
        stationName: "stationSources",
        ensureOuterRoadPath: () => null,
        placeOuterRoadSites: () => null,
        cleanupOuterRoadSites: () => null,
        ensureOuterEdgeLink: () => null,
        migrateOuterCarrierRegistration: () => null,
        outerCarrierFleetCap: () => 15,
        outerMineStarvesSpawnRoom: () => false,
        outerMineWaitingByMine: () => 0,
        outerCarrierTripCapacity: () => 1700,
        getOuterHarCarrierBodyConfig: () => PLAIN,
        getOuterHarCarrierBuildBodyConfig: () => BUILD,
        generatorOuterHarCarryTask: () => [{}],
        outerRoadComplete: () => false,          // 路「未完成」（衰减带）
        outerRoadSiteCount: () => opts.siteCnt,  // 工地数由高到低各用例给定
        getHarvesterBodyConfig: () => new Array(10).fill("work"),
    });
    harness.StationSources = harness.pro;
    harness.global.StrategyHighLevel = {
        upgraderStarved: () => false,
        spawnTickBudget: () => 6000,
    };
    return harness;
}

function makeCarrier(id, work, ttl) {
    return {
        id,
        ticksToLive: ttl,
        body: { length: 50 },
        memory: { tasks: [{}] },
        headTask: () => ({ roomName: "W26N59", id: "src1" }),
        getPartCnt: p => (p === "work" ? work : p === "carry" ? 32 : 0),
    };
}

// 需求口径：pathTime 50 × 2 × min(20, 3000/300=10) / 50 = 20 CARRY。
// 一只 32 CARRY 的在岗车即可盖住（20-2-32 < 0），运输路径不补员 ——
// 于是各用例里唯一的补员来源就是修路分支，差分干净。

// ── ① 无工地：衰减带不派专职修路爬（旧代码会派） ─────────────────────────
{
    const h = makeHarness({ siteCnt: 0, registered: [makeCarrier("reg1", 2, 1000)] });
    h.pro.trySpawnOuterHarCarrier("W26N59", h.__spawnRoom);
    assert.deepEqual(h.__spawned, [],
        "路线没有工地时不得派专职修路爬（衰减由在岗 WORK 车沿途修）");
}

// ── ② 有工地：编制恢复（负对照，证明不是把修路永久关掉） ─────────────────
{
    const h = makeHarness({ siteCnt: 2, registered: [makeCarrier("reg1", 2, 1000)] });
    h.pro.trySpawnOuterHarCarrier("W26N59", h.__spawnRoom);
    assert.equal(h.__spawned.length, 1, "有工地且编制不足必须补修路爬");
    assert.equal(h.__spawned[0].body, BUILD, "补的是修路体型");
}

// ── ③ 在途 WORK 占编制：1 登记 + 1 在途 = 满编，不再派（旧代码会派） ─────
{
    const h = makeHarness({
        siteCnt: 2,
        registered: [makeCarrier("reg1", 2, 1000)],
        inTransit: [makeCarrier("trans1", 2, 1500)],
    });
    h.pro.trySpawnOuterHarCarrier("W26N59", h.__spawnRoom);
    assert.deepEqual(h.__spawned, [],
        "在途/在孵的修路爬必须占编制（孵化+赶路的窗口不许重复派）");
}

// ── ④ 在途 WORK 使运输补员造普通体型（旧代码造修路体型） ─────────────────
{
    // pathTime 200 ⇒ 需求 80 CARRY；在途 32 CARRY 扣完仍缺 46 ⇒ 运输补员触发。
    const h = makeHarness({
        siteCnt: 0, pathTime: 200,
        registered: [],
        inTransit: [makeCarrier("trans1", 2, 1500)],
    });
    h.pro.trySpawnOuterHarCarrier("W26N59", h.__spawnRoom);
    assert.equal(h.__spawned.length, 1, "运力缺口仍在，必须补一只运输车");
    assert.equal(h.__spawned[0].body, PLAIN,
        "已有 WORK 车在途 ⇒ 造普通体型，不重复造修路体型");
}

// ── ⑤ outerRoadSiteCount 本体：只数路点格上的 road 工地，无视野 -1 ────────
{
    const helperSrc = srcSrc.match(/\n {4}outerRoadSiteCount\(data\) \{[\s\S]*?\n {4}\},/);
    assert.ok(helperSrc, "outerRoadSiteCount 必须存在");
    const ctx = {
        Game: { rooms: {} },
        FIND_MY_CONSTRUCTION_SITES: "mySites", STRUCTURE_ROAD: "road",
    };
    ctx.global = ctx;
    vm.runInNewContext("var pro = {" + helperSrc[0] + "\n};", ctx);
    ctx.pro.getOuterRoadPath = () => ctx.__path;
    const site = (x, y, type) => ({ structureType: type || "road", pos: { x, y } });
    ctx.__path = [{ roomName: "R1", x: 1, y: 1 }, { roomName: "R2", x: 2, y: 2 }];
    ctx.Game.rooms.R1 = { find: () => [site(1, 1), site(9, 9), site(1, 1, "extension")] };
    ctx.Game.rooms.R2 = { find: () => [] };
    assert.equal(ctx.pro.outerRoadSiteCount({}), 1,
        "只数路点格上的 road 工地（路外工地/非 road 不算）");
    delete ctx.Game.rooms.R2;
    assert.equal(ctx.pro.outerRoadSiteCount({}), -1,
        "任一路线房无视野 ⇒ -1（调用方退回旧判据，盲飞不误停）");
    ctx.__path = [];
    assert.equal(ctx.pro.outerRoadSiteCount({}), -1, "没有路线缓存 ⇒ -1");
}

// ── ⑥ 变异负对照：改回旧实现，对应用例必须如实失败 ───────────────────────
{
    // M1：编制判据改回常量 ⇒ ① 必须变成「派了」
    const m1 = makeHarness({
        siteCnt: 0, registered: [makeCarrier("reg1", 2, 1000)],
        mutate: s => s.replace("let builderNeed = siteCnt == 0 ? 0 : OUTER_ROAD_BUILDER_CNT;",
            "let builderNeed = OUTER_ROAD_BUILDER_CNT;"),
    });
    m1.pro.trySpawnOuterHarCarrier("W26N59", m1.__spawnRoom);
    assert.equal(m1.__spawned.length, 1, "M1：旧常量编制下无工地也会派（用例①咬得住）");

    // M2：去掉在途计数 ⇒ ③ 必须变成「派了」
    const m2 = makeHarness({
        siteCnt: 2,
        registered: [makeCarrier("reg1", 2, 1000)],
        inTransit: [makeCarrier("trans1", 2, 1500)],
        mutate: s => s.replace("if (c.getPartCnt(WORK) > 0) { builderCnt++; builderIds[c.id] = true; }",
            "if (false) { builderCnt++; }"),
    });
    m2.pro.trySpawnOuterHarCarrier("W26N59", m2.__spawnRoom);
    assert.equal(m2.__spawned.length, 1, "M2：不算在途车时满编仍会派（用例③咬得住）");

    // M3：体型选择忽略在途 WORK ⇒ ④ 必须变成「修路体型」
    const m3 = makeHarness({
        siteCnt: 0, pathTime: 200,
        registered: [],
        inTransit: [makeCarrier("trans1", 2, 1500)],
        mutate: s => s.replace("carrierBuildCreep = roomCarriers.find(c => {",
            "carrierBuildCreep = undefined && roomCarriers.find(c => {"),
    });
    m3.pro.trySpawnOuterHarCarrier("W26N59", m3.__spawnRoom);
    assert.equal(m3.__spawned.length, 1, "M3：运输补员仍触发");
    assert.equal(m3.__spawned[0].body, BUILD, "M3：忽略在途 WORK 时造修路体型（用例④咬得住）");
}

console.log("outer builder balance: OK");