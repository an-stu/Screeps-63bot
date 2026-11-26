// 0.78.343 回归：新房「本房 spawn 满能量 + 房内 0 只爬」必须自孵一只，
// 以及走位途中的 worker 必须能在编制房里拿到工地任务。
//
// 现场（2026-11-26 shard2 E58S26，RCL2）：认领 COMPLETE 后本房 0 只爬，
// hive 300/300、spawn 空闲、11 个工地、控制器 5,649 tick 往下掉；唯一的
// 「编制」是 4 只从 E52S29 / E54S28 走着过来的援建 worker（4~9 个房间）。
// 两条路同时被「按 memory.roomName 统计编制」堵死：workerManager 的
// worker+carrier==0 分支与低级房的应急 worker 都认为「已经有 4 只」。
// 其中一只满载 350 能量在 E52S29 (4,25) 站了 800+ tick —— 因为它拿到的
// buildConst 是在**当前房**找工地（E52S29 没有），返回 [] 是空操作。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const lowSource = fs.readFileSync(path.join(root, "modules", "strategy_lowLevel.js"), "utf8");
const workSource = fs.readFileSync(path.join(root, "modules", "station_work.js"), "utf8");

// 断言前剥注释（注释里会原样引用被断言的表达式），并统一行尾。
const low = lowSource.replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── 1) 接线：自孵入口在 exec 里、在防守之后、经济分支之前 ──
{
    const callIdx = low.indexOf("pro.trySpawnLocalBootstrap(room)");
    assert.ok(callIdx >= 0, "exec 必须调用 trySpawnLocalBootstrap");
    assert.ok(callIdx > low.indexOf("trySpawnLowLevelDefense(room)"),
        "自孵必须排在防守爬之后（防守优先）");
    assert.ok(callIdx < low.indexOf("if ((room.getEnergyCapacityAvailable(room) < 800 ))"),
        "自孵必须在低级房经济分支之前（空房先把人孵出来再去派任务）");
}

// ── 2) 行为：只有「本房真空」才孵 ──
function loadLow(stubs = {}, distance = 5) {
    const spawned = [];
    const sandbox = {
        Creep: function Creep() {},
        Game: { time: 100, map: { getRoomLinearDistance: () => distance } },
        Memory: {},
        FIND_MY_CREEPS: "myCreeps",
        FIND_HOSTILE_CREEPS: "hostiles",
        console: { log() {} },
        StationHive: {
            trySpawn: (room, target, body, role) => spawned.push({ room: room.name, body, role }),
            HiveNeedToFill: () => false,
        },
        StationWork: {
            getMiddleLevelWorkerBodyConfig: (room, budget) => (budget >= 200 ? ["w", "c", "m"] : []),
        },
        StrategyHighLevel: { spawnTickBudget: room => room.budget },
        UtilsTask: {},
        ManagerCreeps: {},
        StationSources: { stationName: "stationSources" },
        StationCarry: {},
        StationMineral: {},
        StationUpgrade: {},
        StationDefense: {},
        ManagerAutoPlanner: null,
        ManagerFlags: {},
        ...stubs,
    };
    sandbox.global = sandbox;
    vm.runInNewContext(lowSource, sandbox);
    return { pro: sandbox.StrategyLowLevel, spawned, sandbox };
}

function makeRoom(extra = {}) {
    const room = Object.assign({
        name: "E58S26",
        my: true,
        level: 2,
        budget: 300,
        find: () => [],
        spawn: [{ spawning: null }],
        creeps: () => [],
        memory: {},
    }, extra);
    return room;
}

{
    const { pro, spawned } = loadLow();
    // 正例：房内 0 只爬 + hive 300 + spawn 空闲 ⇒ 孵一只最小 worker
    pro.trySpawnLocalBootstrap(makeRoom());
    assert.equal(spawned.length, 1, "空房 + 满 spawn 必须自孵一只");
    assert.equal(spawned[0].role, "worker");
    assert.equal(spawned[0].room, "E58S26", "必须孵在本房（能量搬不出去）");
}

{
    const { pro, spawned } = loadLow();
    const base = () => spawned.length;
    // 负对照 1：房内已经有人
    pro.trySpawnLocalBootstrap(makeRoom({ find: () => [{ name: "c1" }] }));
    assert.equal(base(), 0, "房内有人时不许再孵（会挤占在岗岗位的能量）");

    // 负对照 2：援建爬已经在隔壁 1 房内 ⇒ 等它，不双份
    const near = { pos: { roomName: "E57S26" } };
    const { pro: proNear, spawned: spawnedNear } = loadLow({}, 1);
    proNear.trySpawnLocalBootstrap(makeRoom({ creeps: role => (role === "worker" ? [near] : []) }));
    assert.equal(spawnedNear.length, 0, "援建爬在相邻房时必须等它，不要双份孵化");
    // 同一只爬但还有 2 个房间的距离 ⇒ 早就在路上了，本房不必干等
    pro.trySpawnLocalBootstrap(makeRoom({ creeps: role => (role === "worker" ? [near] : []) }));
    assert.equal(base(), 1, "援建爬还在 2 房外时本房应自孵（spawn 的能量只能本房用）");

    // 负对照 3：援建房（用户政策：不本产爬）
    const { pro: pro2, spawned: spawned2, sandbox: sb } = loadLow();
    sb.Memory.crossShardBuilds = { E58S26: { roomName: "E58S26" } };
    pro2.trySpawnLocalBootstrap(makeRoom());
    assert.equal(spawned2.length, 0, "crossShardBuilds 里的援建房不许本产爬");

    // 负对照 4：spawn 正在孵
    pro.trySpawnLocalBootstrap(makeRoom({ spawn: [{ spawning: { name: "x" } }] }));
    assert.equal(base(), 1, "spawn 忙时不许再下单");

    // 负对照 5：能量不够最小体型
    pro.trySpawnLocalBootstrap(makeRoom({ budget: 150 }));
    assert.equal(base(), 1, "付不起 [WORK,CARRY,MOVE] 时不许下单");

    // 负对照 6：RCL4+ 不归这条路径管
    pro.trySpawnLocalBootstrap(makeRoom({ level: 5, budget: 1800 }));
    assert.equal(base(), 1, "RCL4+ 由 extinction / workerManager 负责");
}

// ── 4) 行为：房外的满载 worker 不许接 fillHive（它下一 tick 会自己弹掉）──
function runLowExec(workerPos, hiveNeedsFill = true) {
    const tasks = [];
    const site = { id: "siteE58", structureType: "container", pos: { x: 5, y: 5, roomName: "E58S26" } };
    const room = {
        name: "E58S26", my: true, level: 2, spawn: [{}], tower: [],
        controller: { id: "ctrl", ticksToDowngrade: 20000 },
        constructionSite: [site], memory: { stationSources: {} },
        energyAvailable: 100, energyCapacityAvailable: 300,
        hashCode: () => 0, isDownGrade: () => false,
        find: () => [],
        getEnergyCapacityAvailable: () => 300,
        creeps: role => (role === "worker" ? [worker] : []),
    };
    const worker = {
        pos: { roomName: workerPos },
        store: { energy: 350 },
        storeEmpty: () => false,
        isFree: () => true,
        addTask: task => tasks.push(...(Array.isArray(task) ? task : [task])),
        mainRoom: () => room,
    };
    const sandbox = {
        Creep: function Creep() {},
        Game: { time: 0, map: { getRoomLinearDistance: () => 5 }, getObjectById: () => undefined },
        Memory: {},
        FIND_HOSTILE_CREEPS: "hostiles", FIND_MY_CREEPS: "myCreeps", FIND_FLAGS: "flags",
        RESOURCE_ENERGY: "energy", STRUCTURE_ROAD: "road",
        BODYPART_COST: { work: 100, carry: 50, move: 50 },
        HelperError: { catchError: fn => fn() },
        StrategyHighLevel: { spawnTickBudget: () => 0 },
        StationHive: {
            HiveNeedToFill: () => hiveNeedsFill,
            generatorFillHiveTask: () => ({ taskName: "fillHive" }),
            trySpawn: () => null,
        },
        StationSources: {
            stationName: "stationSources", trySpawnHarKeeper() {},
            generatorCarryEnergyTask: () => [], generatorReleaseAbleHarTask: () => ({ taskName: "harvestEnergy" }),
        },
        StationCarry: {
            generatorPickTask: () => [], generatorCarryStorageEnergyTask: () => [],
            roomMassStoreCnt: () => 0,
        },
        StationMineral: { generatorCarryMineralTask: () => [] },
        StationWork: {
            constructionNeedBuild: r => !!(r && r.constructionSite && r.constructionSite.length),
            generatorBuildTask: () => ({ taskName: "buildConst" }),
            getLowLevelWorkerBodyConfig: () => ["w"],
            getMiddleLevelWorkerBodyConfig: () => ["w", "c", "m"],
        },
        StationUpgrade: { generatorUpgradeTask: () => ({ taskName: "upgrade" }) },
        Utils: { getBodyEnergyNeed: () => 200 },
        UtilsTask: { task: () => ({}) },
        ManagerCreeps: {}, ManagerAutoPlanner: null, ManagerFlags: {},
        _: { values: Object.values },
        console: { log() {} },
    };
    sandbox.global = sandbox;
    vm.runInNewContext(lowSource, sandbox);
    sandbox.StrategyLowLevel.exec(room);
    return tasks;
}

{
    const away = runLowExec("E52S29");
    assert.equal(away.some(t => t.taskName === "fillHive"), false,
        "房外的爬不许接 fillHive（fillHive 见 pos.roomName 不等就 popTask，等于每 pass 空转）");
    assert.ok(away.some(t => t.taskName === "buildConst"),
        "房外的满载 worker 必须拿到能把它带回编制房的施工任务");

    // 负对照：同一只爬在房内 ⇒ 仍是 fillHive 优先（原行为不变）
    const inside = runLowExec("E58S26");
    assert.equal(inside[0].taskName, "fillHive", "房内的爬仍先补 hive");
}

// ── 3) 行为：走位途中的 worker 拿到的是**编制房**的工地 ──
{
    const tasks = [];
    const sandbox = {
        Game: { time: 100 },
        Memory: {},
        Creep: function Creep() {},
        FIND_CONSTRUCTION_SITES: "sites",
        STRUCTURE_CONTAINER: "container",
        STRUCTURE_SPAWN: "spawn",
        STRUCTURE_TOWER: "tower",
        STRUCTURE_EXTENSION: "extension",
        UtilsTask: { task: (target, name) => ({ target, name }) },
        ManagerCreeps: {},
        Utils: {},
        console: { log() {} },
    };
    sandbox.global = sandbox;
    vm.runInNewContext(workSource, sandbox);
    const pro = sandbox.StationWork;

    const homeSite = { id: "siteE58", structureType: "container", pos: { x: 5, y: 5, roomName: "E58S26" } };
    const home = {
        name: "E58S26", level: 2,
        constructionSite: [homeSite],
        find: () => [homeSite],
    };
    const away = {
        name: "E52S29", level: 4,
        constructionSite: [],
        find: () => [],
    };
    const creep = {
        room: away,
        mainRoom: () => home,
        pos: {
            roomName: "E52S29",
            x: 4, y: 25,
            findClosestByRange: () => null,
            getRangeTo: () => Infinity,
        },
    };
    const task = pro.generatorBuildTask(creep);
    assert.ok(task, "编制房有工地时不许返回空任务（旧实现就是这里返回 []）");
    assert.equal(task.target.id, "siteE58", "任务必须指向编制房的工地");

    // 负对照：编制房没工地 ⇒ 仍退回当前房（原行为，不许因此乱派）
    const emptyHome = { name: "E58S26", level: 2, constructionSite: [], find: () => [] };
    const noTask = pro.generatorBuildTask(Object.assign({}, creep, { mainRoom: () => emptyHome }));
    assert.equal(noTask.length, 0, "两处都没有工地时必须返回空数组");

    // 原位房：编制房 == 当前房，行为不变（低 RCL 仍按「容器/spawn 优先」排序）
    const inRoom = {
        room: home,
        mainRoom: () => home,
        pos: {
            roomName: "E58S26", x: 5, y: 5,
            findClosestByRange: () => null,
            getRangeTo: () => 1,
        },
    };
    const inRoomTask = pro.generatorBuildTask(inRoom);
    assert.equal(inRoomTask.target.id, "siteE58", "原位房行为不变：仍是本房工地");

    // 原位房 RCL4+：仍走 findClosestByRange（最近优先，不看结构类型）
    const nearSite = { id: "near", structureType: "road", pos: { x: 1, y: 1, roomName: "E58S26" } };
    const bigHome = { name: "E58S26", level: 4, constructionSite: [homeSite], find: () => [homeSite] };
    const bigCreep = {
        room: bigHome,
        mainRoom: () => bigHome,
        pos: { roomName: "E58S26", x: 5, y: 5, findClosestByRange: () => nearSite, getRangeTo: () => 1 },
    };
    assert.equal(pro.generatorBuildTask(bigCreep).target.id, "near",
        "RCL4+ 原位房仍是「最近优先」（不改原有优先级）");
}

// ── 5) 行为：RCL<3 房「spawn 空闲 + hive 付得起本地体型」⇒ 自己生，别排援建队 ──
// 现场（2026-11-26 shard2 E58S26）：2 个源、只 1 只 worker、hive 满 550、spawn 空闲
// 1,280 tick。level 2 < 7 ⇒ `getClosestSpawnRoom` 只返回捐赠房（E51S29 RCL6），
// 援建体型 2,000 对上捐赠房容量 2,100，`deferSpawn` 又排在他自己的经济孵化之后 ⇒
// 结构性抢不到 spawn，而本房 550 能量一直闲着。
function runLowExecSpawn(opts = {}) {
    const spawned = [];
    const deferred = [];
    const loadedWorker = () => ({
        pos: { roomName: "E58S26", x: 5, y: 5 },
        store: { energy: 400 },
        storeEmpty: () => false,
        isFree: () => true,
        headTask: () => null,
        lastTask: () => ({ taskName: "buildConst", roomName: "E58S26" }),
        addTask: () => {},
        mainRoom: () => room,
    });
    const workers = opts.workers === undefined ? [loadedWorker()] : opts.workers;
    const source = { id: "s1", roomName: "E58S26", spawnTime: 0, creeps: [] };
    const room = {
        name: "E58S26", my: true, level: 2,
        spawn: opts.spawn || [{ spawning: null }],
        tower: [],
        controller: { id: "ctrl", ticksToDowngrade: opts.ttd === undefined ? 9000 : opts.ttd },
        constructionSite: [{ id: "siteE58", structureType: "road", pos: { x: 5, y: 5, roomName: "E58S26" } }],
        memory: { stationSources: { s1: source } },
        energyAvailable: opts.energyAvailable === undefined ? 550 : opts.energyAvailable,
        energyCapacityAvailable: 550,
        hashCode: () => 0,
        isDownGrade: () => false,
        find: () => [],
        getEnergyAvailable: () => room.energyAvailable,
        getEnergyCapacityAvailable: () => 550,
        creeps: role => (role === "worker" ? workers : []),
    };
    // 房级缓存：`room[sourceId]`（模块里 posLen 走这条路，不是 Game.getObjectById）。
    room.s1 = { pos: { nearPos: () => [{ walkable: () => true }, { walkable: () => true }] } };
    const sandbox = {
        Creep: function Creep() {},
        Game: { time: 0, map: { getRoomLinearDistance: () => 5 }, getObjectById: () => ({ energy: 1000 }) },
        Memory: {},
        FIND_HOSTILE_CREEPS: "hostiles", FIND_MY_CREEPS: "myCreeps", FIND_FLAGS: "flags",
        RESOURCE_ENERGY: "energy", STRUCTURE_ROAD: "road", STRUCTURE_CONTAINER: "container",
        BODYPART_COST: { work: 100, carry: 50, move: 50 },
        taskDispatchThrottle: false,
        HelperError: { catchError: fn => fn() },
        StrategyHighLevel: { spawnTickBudget: () => 0 },
        StationHive: {
            HiveNeedToFill: () => false,
            generatorFillHiveTask: () => ({ taskName: "fillHive" }),
            trySpawn: (rm, target, body, role) => spawned.push({ room: rm.name, target, body, role }),
            getClosestSpawnRoom: opts.donor === undefined
                ? () => ({ name: "E51S29", level: 6 }) : () => opts.donor,
            deferSpawn: (kind, run) => deferred.push({ kind, run }),
        },
        StationSources: {
            stationName: "stationSources", trySpawnHarKeeper() {},
            generatorCarryEnergyTask: () => [], generatorReleaseAbleHarTask: () => ({ taskName: "harvestEnergy" }),
        },
        StationCarry: {
            generatorPickTask: () => [], generatorCarryStorageEnergyTask: () => [],
            roomMassStoreCnt: () => 0,
        },
        StationMineral: { generatorCarryMineralTask: () => [] },
        StationWork: {
            constructionNeedBuild: r => !!(r && r.constructionSite && r.constructionSite.length),
            generatorBuildTask: () => ({ taskName: "buildConst" }),
            getLowLevelWorkerBodyConfig: () => ["w", "c", "m"],
            getMiddleLevelWorkerBodyConfig: () => ["w", "c", "m"],
        },
        StationUpgrade: { generatorUpgradeTask: () => ({ taskName: "upgrade" }) },
        Utils: { getBodyEnergyNeed: () => 500 },
        UtilsTask: { task: () => ({}) },
        ManagerCreeps: {}, ManagerAutoPlanner: null, ManagerFlags: {},
        _: { values: Object.values, map: (a, f) => a.map(f), filter: (a, f) => a.filter(f) },
        console: { log() {} },
    };
    sandbox.global = sandbox;
    // lodash 在线上把 head() 挂在 Array 原型上。`room.creeps(...)` 返回的是**本文件
    // 这个 realm** 的数组，所以必须补在本 realm 的原型上（vm 上下文的原型管不到它）。
    if (!Array.prototype.head) Array.prototype.head = function () { return this[0]; };
    vm.runInNewContext(lowSource, sandbox);
    sandbox.StrategyLowLevel.exec(room);
    return { spawned, deferred };
}

{
    // 正例：1 只满载 worker + hive 550 + spawn 空闲 ⇒ 本房自孵
    const { spawned, deferred } = runLowExecSpawn();
    assert.equal(spawned.length, 1, "本房 spawn 空闲且付得起时必须自己孵（不许只排援建队）");
    assert.equal(spawned[0].room, "E58S26", "能量只能本房用 ⇒ 必须孵在本房");
    assert.equal(spawned[0].role, "worker");
    assert.equal(deferred.length, 0, "自己孵得出来时不要再向捐赠房请求援建");

    // 负对照 1：编制已有 2 只 worker ⇒ 不本孵，回到援建请求（原行为）
    const two = runLowExecSpawn({ workers: [loaded2(), loaded2()] });
    assert.equal(two.spawned.length, 0, "编制满 2 只时不许再本孵（550 容量的小房会堆满）");
    assert.equal(two.deferred.length, 1, "编制满时仍走原来的援建请求");
    assert.equal(two.deferred[0].kind, "aid");

    // 负对照 2：spawn 正在孵 ⇒ 不本孵，仍排援建
    const busy = runLowExecSpawn({ spawn: [{ spawning: { name: "x" } }] });
    assert.equal(busy.spawned.length, 0, "spawn 忙时不许下单");
    assert.equal(busy.deferred.length, 1, "spawn 忙时援建请求照旧");

    // 负对照 3：hive 只有 300 < 本地体型 500 ⇒ 不本孵
    const poor = runLowExecSpawn({ energyAvailable: 300 });
    assert.equal(poor.spawned.length, 0, "付不起本地体型时必须等，不许缩体型下单");
    assert.equal(poor.deferred.length, 1, "付不起时仍走援建请求");
}

function loaded2() {
    return {
        pos: { roomName: "E58S26", x: 6, y: 6 },
        store: { energy: 400 },
        storeEmpty: () => false,
        isFree: () => true,
        headTask: () => null,
        lastTask: () => ({ taskName: "buildConst", roomName: "E58S26" }),
        addTask: () => {},
        mainRoom: () => null,
    };
}

console.log("lowlevel-local-bootstrap OK");
