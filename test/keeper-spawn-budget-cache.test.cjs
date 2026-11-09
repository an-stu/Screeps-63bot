/**
 * keeper 补员不许清掉本 tick 的孵化预算缓存 `currentEnergyAvailable`。
 *
 * 2026-11-10 巡检（W26N58 双 spawn、W26N59 keeper ttl 26 无接班人）复盘代码时发现：
 * `StationSources.trySpawnOuterHarKeeper` 在 `trySpawn` 前留着一行
 * `spawnRoom.currentEnergyAvailable = undefined;` —— 它是 2026-10-30（06fc3725）
 * 从 carrier 路径照抄的「两个缓存一起清」，而 2026-11-05（9542722）已经证伪了清预算
 * 那半边（carrier / 外矿搬运两条路径都删掉了，keeper 这条漏了）：
 *
 *   `currentEnergyAvailable` 是本 tick 的孵化预算缓存（首个 trySpawn 初始化、每次成功
 *   孵化扣减），而 `room.energyAvailable` 在同一 tick 内**不反映刚花掉的能量**
 *   （9542722 实测：孵完 2,200 的 worker 后读回仍是 2,300）。
 *
 * 清掉它 ⇒ trySpawn 用旧满格值重新初始化 ⇒ 同一 pass 里排在 keeper 后面的角色
 * （carrier / upgrader 走 `spawnTickBudget = min(energyAvailable, currentEnergyAvailable)`）
 * 都按**虚高**的预算定体型 ⇒ spawnCreep 被引擎以 ERR_NOT_ENOUGH_ENERGY 拒绝、
 * spawnFailure 置真 ⇒ 白丢一个 spawn pass。这正是 0.78.2xx 系列反复修的同一病根。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

const CONSTANTS = {
    OK: 0, ERR_NOT_OWNER: -1, ERR_NO_PATH: -2, ERR_BUSY: -4, ERR_INVALID_TARGET: -7,
    ERR_NOT_IN_RANGE: -9, ERR_NO_BODYPART: -12, ERR_NOT_ENOUGH_ENERGY: -6,
    MOVE: "move", WORK: "work", CARRY: "carry", ATTACK: "attack", HEAL: "heal",
    TOUGH: "tough", RANGED_ATTACK: "ranged_attack", CLAIM: "claim",
    LOOK_STRUCTURES: "structures", LOOK_CREEPS: "creeps",
    STRUCTURE_KEEPER_LAIR: "keeperLair", STRUCTURE_INVADER_CORE: "invaderCore",
    STRUCTURE_RAMPART: "rampart", STRUCTURE_CONTAINER: "container",
    STRUCTURE_EXTENSION: "extension", STRUCTURE_SPAWN: "spawn", STRUCTURE_TOWER: "tower",
    STRUCTURE_STORAGE: "storage", STRUCTURE_TERMINAL: "terminal", STRUCTURE_LINK: "link",
    STRUCTURE_LAB: "lab", STRUCTURE_FACTORY: "factory", STRUCTURE_EXTRACTOR: "extractor",
    STRUCTURE_POWER_BANK: "powerBank", STRUCTURE_POWER_SPAWN: "powerSpawn",
    FIND_HOSTILE_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_STRUCTURES: 103,
    FIND_SOURCES: 104, FIND_MY_STRUCTURES: 105, FIND_SOURCES_ACTIVE: 106,
    FIND_DROPPED_RESOURCES: 107, FIND_TOMBSTONES: 108, FIND_DEPOSITS: 109,
    FIND_STRUCTURES: 110, FIND_CONSTRUCTION_SITES: 111, FIND_MINERALS: 112,
    RESOURCE_ENERGY: "energy", RESOURCE_OPS: "ops", RESOURCE_POWER: "power",
    PWR_REGEN_SOURCE: 13,
    BODYPART_COST: { move: 50, work: 100, carry: 50, attack: 80, ranged_attack: 150, heal: 250, claim: 600, tough: 10 },
};

const costOf = body => body.reduce((a, p) => a + (CONSTANTS.BODYPART_COST[p] || 0), 0);

function loadStation(code) {
    const ctx = {
        ...CONSTANTS,
        console: { log() {} },
        isSaveCpu: false,
        _: { values: o => Object.keys(o || {}).map(k => o[k]) },
        Game: {
            time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" },
            getObjectById: () => null, creeps: {}, map: { getRoomLinearDistance: () => 1 },
        },
        Memory: { rooms: {} },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { return { x, y, roomName }; },
        ManagerCreeps: {
            calcBodyPart: obj => Object.keys(obj).flatMap(k => new Array(obj[k]).fill(k)),
            getBodyEnergyNeed: body => costOf(body),
        },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => "newKeeper" },
        UtilsTask: { task: (t, n) => ({ id: t.id, taskName: n }), taskData: n => ({ taskName: n }) },
        PathFinder: { search: () => ({ path: [0, 1, 2] }) },
        MIN_CPU: false,
    };
    ctx.global = ctx;
    vm.runInNewContext(code, ctx, { filename: "station_sources.js" });
    return ctx;
}

/**
 * 现场形态：本房矿点一只 keeper 都没有（两只同时老死 ⇒ 立刻要补）。
 *
 * `energyAvailable` = 3,400（引擎在本 tick 内**不更新**的旧值）
 * `realLeft`       = 1,200（本 tick 早些时候已被另一只爬花掉 2,200 的真实余量）
 * `currentEnergyAvailable` = 1,200（正确的预算缓存）
 *
 * trySpawn 按线上语义（station_hive.js:166/177/188 + 引擎真实扣能）：
 *   · 缓存为 undefined ⇒ 用 `getEnergyAvailable()`（旧满格值）重新初始化；
 *   · 缓存 < spend ⇒ 静默失败并置 spawnFailure；
 *   · 真实余量 < spend ⇒ 引擎 ERR_NOT_ENOUGH_ENERGY，同样失败置标记；
 *   · 成功 ⇒ 缓存与真实余量都扣减。
 */
function runKeeper(code) {
    const ctx = loadStation(code);
    const S = ctx.StationSources;
    ctx.Memory.rooms["W26N58"] = {
        [S.stationName]: {
            src1: { id: "src1", container: undefined, spawnTime: ctx.Game.time - 1600, creeps: [] },
        },
    };
    const state = { realLeft: 1200, cacheInitFrom: null, spend: 0, rejected: 0 };
    const room = {
        name: "W26N58", my: true, level: 6, spawnFailure: false,
        energyAvailable: 3400,
        currentEnergyAvailable: 1200,
        getEnergyAvailable: () => 3400,
        getEnergyCapacityAvailable: () => 5600,
        creeps: () => [],
        find: () => [],
    };
    S.outerMineStarvesSpawnRoom = () => false;
    S.homeMiningPaused = () => false;
    S.generatorHarTask = () => [];
    S.generatorOuterHarTask = () => [];
    ctx.StationHive.trySpawn = (rm, target, body, role) => {
        const spend = costOf(body);
        if (rm.currentEnergyAvailable === undefined) {
            state.cacheInitFrom = "energyAvailable";
            rm.currentEnergyAvailable = rm.getEnergyAvailable();
        }
        if (!body || !body.length || rm.currentEnergyAvailable < spend) { rm.spawnFailure = true; return undefined; }
        if (spend > state.realLeft) { // 引擎按真实余量拒绝
            state.rejected++;
            rm.spawnFailure = true;
            return null;
        }
        rm.currentEnergyAvailable -= spend;
        state.realLeft -= spend;
        state.spend = spend;
        return "newKeeper";
    };
    S.trySpawnOuterHarKeeper("W26N58", room);
    // 同一 pass 里紧随其后的角色（carrier / upgrader）用的预算口径
    const nextBudget = Math.min(room.energyAvailable, room.currentEnergyAvailable);
    return { state, room, nextBudget };
}

// ── 1. 源码层：keeper 补员只解 spawnFailure，不许清预算缓存 ─────────────────
const fn = src.match(/\n {4}trySpawnOuterHarKeeper\(roomName, spawnRoom\) \{[\s\S]*?\n {4}\},/);
assert.ok(fn, "StationSources.trySpawnOuterHarKeeper 必须存在");
const body = fn[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(/spawnRoom\.spawnFailure = false;/.test(body), "keeper 补员前必须解掉粘滞的 spawnFailure");
assert.ok(!/currentEnergyAvailable\s*=\s*undefined/.test(body),
    "keeper 补员不许清 currentEnergyAvailable（本 tick 的孵化预算缓存）");

// ── 2. 行为层：keeper 孵化后缓存必须是「预算 - 花费」，不是旧满格值 - 花费 ────
const live = runKeeper(src);
assert.equal(live.state.rejected, 0, "keeper 本身必须孵得出来");
assert.ok(live.state.spend > 0, "keeper 必须真的花了能量");
assert.equal(live.room.currentEnergyAvailable, 1200 - live.state.spend,
    `缓存必须继续记着本 tick 已花掉的 2,200（实际 ${live.room.currentEnergyAvailable}）`);
assert.equal(live.nextBudget, 1200 - live.state.spend,
    "同一 pass 里后续角色读到的预算必须等于真实余量，不能虚高");

// ── 3. 负对照：把那行清缓存加回去，后续角色的预算就会被抬高 ─────────────────
const OLD_WIPE = src.replace(
    "                spawnRoom.spawnFailure = false;\r\n",
    "                spawnRoom.spawnFailure = false;\r\n                spawnRoom.currentEnergyAvailable = undefined;\r\n");
assert.notEqual(OLD_WIPE, src, "负对照的源码替换必须命中（CRLF）");
const buggy = runKeeper(OLD_WIPE);
assert.equal(buggy.state.cacheInitFrom, "energyAvailable",
    "旧写法确实会用旧满格值重新初始化缓存");
assert.ok(buggy.nextBudget > live.nextBudget,
    `旧写法下后续预算必须虚高（${buggy.nextBudget} > ${live.nextBudget}）`);
assert.ok(buggy.nextBudget > buggy.state.realLeft,
    "旧写法下后续预算必须超过真实余量 —— 这就是白丢一个 spawn pass 的机制");

console.log("keeper spawn budget: OK (keeper succession keeps the tick's energy cache)");
