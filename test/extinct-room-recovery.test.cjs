/**
 * 全灭房（worker / carrier / keeper 全为 0）必须能自己站起来，或者被隔壁救起来。
 *
 * 2026-11-26 05:5x~08:5x shard2 E51S29 实测（RCL6、单 spawn、容量 1,850）：
 *   · `worker / carrier / keeper` 全 0，spawn 空转，`spawnFailure` 粘滞；
 *   · hive 244 → 14（`energyAvailable` 只剩 14，付不起任何一组 [WORK,CARRY,MOVE]=200）；
 *   · storage 9,456、terminal 无、同房两个塔 0 能量；
 *   · 同一 tick 它刚把最后的 244 孵成一只 **外派** worker（memory.roomName=E58S26）
 *     走去隔壁 —— 即"出兵房把最后能量花在外派上"，自己反而饿死。
 *   · 三条自救出口同时关死：
 *       ① `workerManager` 的空 hive 闸：244 < min(2500, 1850*0.5)=925 ⇒ return；
 *       ② `workerHasEnergyToSpend`：storage 9,456 < WORKER_ENERGY_FLOOR 10,000 ⇒ false；
 *       ③ `trySpawnCarrier` 的极端自救要先造满配 carrier（300）⇒ 244 付不起。
 *
 * 修法三件（本文件逐条锁住）：
 *   A. 全灭房（三类全 0）绕过 ①② —— 这两条闸门的理由是"别抢 keeper/升级爬的能量"，
 *      全灭房里没有任何人能来抢；
 *   B. 连 200 都付不起（hive < 200）时，向**自给自足**的隔壁房要一只小搬运爬，
 *      过来把 storage 的能量填进 hive（`trySpawnExtinctionRescue`）；
 *   C. 出兵房必须先养活自己：`getClosestSpawnRoom(..., {requireSelfSustaining})`；
 *      另外空体型不再走 `spawnCreep([])`（会 ERR_INVALID_ARGS 并把 spawnFailure 置真）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const BODY_COST = { move: 50, work: 100, carry: 50, attack: 80, ranged_attack: 150, heal: 250, claim: 600, tough: 10 };
const costOf = body => body.reduce((a, p) => a + (BODY_COST[p] || 0), 0);

// ── ① 纯函数：全灭判定 ───────────────────────────────────────────────────────
function loadHighLevel(opts = {}) {
    const calls = { trySpawn: [], deferred: [] };
    const StationHive = {
        HiveNeedToFill: () => true,
        getClosestSpawnRoom: (...args) => {
            calls.getClosest = args;
            return opts.donor === undefined ? null : opts.donor;
        },
        trySpawn: (...args) => {
            calls.trySpawn.push(args);
            return "creepName";
        },
        deferSpawn: (kind, run) => calls.deferred.push([kind, run]),
    };
    const ctx = {
        console: { log() {} },
        Memory: { rooms: {}, marketSettings: {} },
        Game: { time: 1000, cpu: { bucket: 10000 }, shard: { name: "shard2" }, creeps: {}, rooms: {}, flags: {}, map: {} },
        _: { values: o => Object.keys(o || {}).map(k => o[k]) },
        CARRY: "carry", MOVE: "move", WORK: "work", RESOURCE_ENERGY: "energy",
        OK: 0, LOCAL_SHARD_NAME: "shard2", MIN_CPU: false,
        StationHive,
        StationWork: { getMiddleLevelWorkerBodyConfig: () => [] },
        StationCarry: { getCarrierBodyConfig: () => [] },
        StationDefense: {},
        StationUpgrade: {},
        StationSources: {},
        ManagerRooms: null,
        Utils: { getBodyEnergyNeed: costOf },
        UtilsTask: {
            task: (obj, taskName, regFun, ops) => Object.assign(
                { taskName, id: obj && obj.id, roomName: obj && obj.pos && obj.pos.roomName }, ops || {}),
            taskData: (taskName, regFun, ops) => Object.assign({ taskName }, ops || {}),
        },
        HelperError: { catchError: (fn) => fn() },
        Logger: { log() {} },
        isCpuFeatureEnabled: () => true,
    };
    ctx.global = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, "modules/strategy_highLevel.js"), "utf8"), ctx, { filename: "strategy_highLevel.js" });
    return { StrategyHighLevel: ctx.global.StrategyHighLevel, calls };
}

function fakeRoom({ name = "E51S29", level = 6, energy = 14, cap = 1850, storage = 9456, terminal = 0,
    spawns = 1, worker = 0, carrier = 0, keeper = 0 } = {}) {
    const creepsByRole = { worker, carrier, harvestEnergyKeeper: keeper };
    return {
        name, level, energyAvailable: energy, energyCapacityAvailable: cap, my: true,
        spawn: new Array(spawns).fill({}),
        storage: storage === null ? undefined : { id: "st1", store: { energy: storage }, pos: { roomName: name } },
        terminal: terminal === null ? undefined : { store: { energy: terminal } },
        creeps: (role) => new Array(creepsByRole[role] || 0).fill({}),
    };
}

// 正向：hive 14、storage 9,456、真·全灭 ⇒ 必须让隔壁派一只最小搬运爬过来
{
    const donor = fakeRoom({ name: "E56S29", level: 5, energy: 1400, cap: 1800 });
    const { StrategyHighLevel: P, calls } = loadHighLevel({ donor });
    const room = fakeRoom();
    assert.equal(P.isEconomyExtinct({ worker: 0, carrier: 0, keeper: 0 }), true, "三类全 0 必须判定为全灭");
    P.trySpawnExtinctionRescue(room);
    assert.equal(calls.trySpawn.length, 0, "先让出兵房自己的补员运行");
    assert.equal(calls.deferred.length, 1);
    assert.equal(calls.deferred[0][0], "rescue");
    calls.deferred[0][1]();
    assert.equal(calls.trySpawn.length, 1, "全灭 + hive<200 + storage 有存量 ⇒ 必须向隔壁求一只救命爬");
    const [spawnRoom, target, body, role, tasks] = calls.trySpawn[0];
    assert.equal(spawnRoom.name, "E56S29", "必须用隔壁出兵房（不能自我出兵）");
    assert.equal(target, "E51S29", "爬必须以受灾房为 memory.roomName（否则不会留下）");
    assert.equal(role, "carrier", "救命爬是搬运：storage 里的能量要靠它搬进 hive");
    assert.ok(body.includes("carry") && costOf(body) <= 150, "体型必须是最小可付的搬运（≤150）");
    assert.equal(tasks.length, 1, "必须自带一条取能任务，否则到地方只会站着");
    assert.equal(tasks[0].taskName, "carryRes");
    assert.equal(tasks[0].id, "st1", "任务必须指向受灾房自己的 storage");
    assert.equal(calls.getClosest.at(-1).requireSelfSustaining, true, "出兵房必须要求自给自足");
    assert.equal(calls.getClosest.at(-1).excludeSelf, true, "救援必须来自别处（本房什么都生不出来）");
}

// 负对照 ①：hive 付得起最小体型（≥200）⇒ 本房自己孵，不该外派求援
{
    const donor = fakeRoom({ name: "E56S29", level: 5 });
    const { StrategyHighLevel: P, calls } = loadHighLevel({ donor });
    P.trySpawnExtinctionRescue(fakeRoom({ energy: 244 }));
    assert.equal(calls.trySpawn.length, 0, "hive 244 付得起 [WORK,CARRY,MOVE]=200 ⇒ 走本房 workerManager");
}

// 负对照 ②：还有爬在路上（memory.roomName 已属于本房）⇒ 不重复派
{
    const donor = fakeRoom({ name: "E56S29", level: 5 });
    const { StrategyHighLevel: P, calls } = loadHighLevel({ donor });
    P.trySpawnExtinctionRescue(fakeRoom({ carrier: 1 }));
    assert.equal(calls.trySpawn.length, 0, "已有救兵在路上（carrier 计入编制）⇒ 不重复派");
    P.trySpawnExtinctionRescue(fakeRoom({ worker: 1 }));
    assert.equal(calls.trySpawn.length, 0, "只要有 worker 在编就不算全灭");
}

// 负对照 ③：没存量可搬 / 出兵房付不起 / 找不到健康出兵房 ⇒ 都别派
{
    const donor = fakeRoom({ name: "E56S29", level: 5 });
    const { StrategyHighLevel: P, calls } = loadHighLevel({ donor });
    P.trySpawnExtinctionRescue(fakeRoom({ storage: 500, terminal: 100 }));
    assert.equal(calls.trySpawn.length, 0, "storage+terminal < 2000 ⇒ 派过去也空跑");

    const poor = fakeRoom({ name: "E56S29", level: 5, energy: 100 });
    const poorCase = loadHighLevel({ donor: poor });
    poorCase.StrategyHighLevel.trySpawnExtinctionRescue(fakeRoom());
    assert.equal(poorCase.calls.trySpawn.length, 0, "出兵房付不起 150 ⇒ 这一轮不生");

    const noneCase = loadHighLevel({ donor: null });
    noneCase.StrategyHighLevel.trySpawnExtinctionRescue(fakeRoom());
    assert.equal(noneCase.calls.trySpawn.length, 0, "找不到自给自足的出兵房 ⇒ 不生");

    const selfCase = loadHighLevel({ donor: fakeRoom({ name: "E51S29", level: 6 }) });
    selfCase.StrategyHighLevel.trySpawnExtinctionRescue(fakeRoom());
    assert.equal(selfCase.calls.trySpawn.length, 0, "出兵房 == 本房（0 爬）⇒ 等于自锁，不生");
}

// ── ② 出兵房必须自给自足 ─────────────────────────────────────────────────────
function loadStationHive() {
    const ctx = {
        console: { log() {} },
        Game: {
            time: 1000, rooms: {},
            map: {
                getRoomLinearDistance: () => 5,
                findRoute: () => new Array(3).fill({}),
            },
        },
        Memory: {}, Creep: function () {},
        Utils: { getBodyEnergyNeed: costOf },
        Logger: { log() {} },
        BetterMove: { getAvoidRoomsMap: () => ({}) },
        _: { values: o => Object.keys(o || {}).map(k => o[k]) },
        RESOURCE_ENERGY: "energy", OK: 0,
    };
    ctx.global = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, "modules/station_hive.js"), "utf8"), ctx, { filename: "station_hive.js" });
    return { hive: ctx.global.StationHive, ctx };
}

const { hive, ctx: hiveCtx } = loadStationHive();
// head() 在 VM 外不可见，这里给宿主补一份（station_hive 依赖极简 lodash 补丁）
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}
{
    const dead = fakeRoom({ name: "E51S29", level: 6, worker: 0, carrier: 0 });
    const good = fakeRoom({ name: "E56S29", level: 5, worker: 2, carrier: 1 });
    Object.assign(hiveCtx.Game.rooms, { E51S29: dead, E56S29: good });
    assert.equal(hive.getClosestSpawnRoom("E58S26", 5, 4, 15).name, "E51S29",
        "不带 requireSelfSustaining 时行为不变（离得最近的就选）");
    assert.equal(hive.getClosestSpawnRoom("E58S26", 5, 4, 15, { requireSelfSustaining: true }).name, "E56S29",
        "带 requireSelfSustaining 时必须跳过 worker/carrier 双零的死房");

    // 自锁负对照：本房给自己出兵永远合法（低等级房 0 爬时唯一出路就是用自己 spawn 孵）
    const selfRoom = fakeRoom({ name: "E58S26", level: 5, worker: 0, carrier: 0 });
    Object.assign(hiveCtx.Game.rooms, { E58S26: selfRoom });
    assert.equal(hive.getClosestSpawnRoom("E58S26", 5, 4, 15, { requireSelfSustaining: true }).name, "E58S26",
        "0 爬的房给自己孵不能被过滤掉（否则低等级房永远起不来）");
    assert.equal(hive.getClosestSpawnRoom("E58S26", 5, 4, 15,
        { requireSelfSustaining: true, excludeSelf: true }).name, "E56S29",
        "excludeSelf 只给救援用：必须换别的房");
}

// ── ③ 空体型不许进 spawnCreep ────────────────────────────────────────────────
{
    const spawned = [];
    const room = {
        name: "E51S29", my: true, level: 6, energyAvailable: 14, energyCapacityAvailable: 1850,
        controller: { owner: { username: "me" } },
        spawn: [{ id: "s1", spawning: null, isActive: () => true, spawnCreep: (body, name) => { spawned.push([body, name]); return 0; }, store: { energy: 14 } }],
        getEnergyAvailable: () => 14,
    };
    const r = hive.trySpawn(room, "E51S29", [], "worker", []);
    assert.equal(r, null, "空体型必须直接放弃");
    assert.equal(spawned.length, 0, "不许调 spawnCreep([])（ERR_INVALID_ARGS）");
    assert.ok(!room.spawnFailure, "空体型不许污染 spawnFailure —— 它会把本 tick 后面所有孵化吞掉");
}

// ── ④ 源码侧：全灭房必须绕过两条省能量闸门 ──────────────────────────────────
const highSrc = fs.readFileSync(path.join(root, "modules/strategy_highLevel.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
assert.ok(/let extinct = pro\.isEconomyExtinct\(pro\.roomEconomyCounts\(room\)\);\s*if \(!extinct\) \{\s*if \(StationHive\.HiveNeedToFill\(room\)/.test(highSrc),
    "两条省能量闸门（空 hive / 无存量）必须包在 if (!extinct) 里");
assert.ok(/if \(extinct\) room\.spawnFailure = false;/.test(highSrc),
    "全灭房生 worker 前必须先解粘滞标记（同 pass 的 keeper 大概率刚把它置真）");
assert.ok(/HelperError\.catchError\(\(\) => pro\.trySpawnExtinctionRescue\(room\)/.test(highSrc),
    "自救必须挂进经济 pass（否则永远不会被调用）");

console.log("extinct room recovery checks passed");
