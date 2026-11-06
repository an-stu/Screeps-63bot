/**
 * 「本房 0 只 keeper、hive 300~500、storage 满」时，keeper 必须用**真付得起的体型**孵出来。
 *
 * 2026-11-06 08:17 W26N58 实地（RCL6 单 spawn、容量 2,300）：
 *   · storage 99,115 / terminal 44,982，hive 在 228~650 之间打转；
 *   · 两只 keeper 出生 84095966（ttl 1500 ⇒ 84097466 同时老死）之后**连续 650 tick
 *     一只都补不出来**，全房零收入；W26N59 外矿也跟着掉到 1 只 keeper
 *     （`__outerWhy=keeper<src1<2`）、容器 2,000 满 + 地面 5,098；
 *   · hive 一冲到 650（tick 84098118）立刻孵出一只 keeper —— 卡点正是 550 这条线。
 *
 * 病根：`trySpawnOuterHarKeeper` 的 `energyBudget = Math.max(room.energyAvailable, 550)`
 * 把预算**强行抬到 550**（= 2WORK+2MOVE+1CARRY），而 `StationHive.trySpawn` 只要
 * `currentEnergyAvailable < spend` 就静默失败（station_hive.js:177）⇒ hive 长期 < 550 的房
 * 永远孵不出 keeper。与 0.78.193 的 upgrader 下限 600→300（f704f98）同一病根：
 * MEMORY 第 5 条「阈值不能写死成大房量级」。
 *
 * 修法：本房 keeper 按本 tick **真剩余能量**定体型（1 组 = 2WORK+1MOVE+1CARRY = 300），
 * 连 1 组都付不起时返回空体型 ⇒ 跳过这一轮（spawnCreep([]) 会 ERR_INVALID_ARGS）。
 * 外矿 keeper 保留 550 下限（要飞外矿、可能要扛 source keeper，小体型是送人头）。
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
 * 本房矿点、**一只 keeper 都没有**（现场：两只同时老死）。
 * trySpawn 按线上语义：付不起就静默失败。
 */
function runForHive(code, hive) {
    const ctx = loadStation(code);
    const S = ctx.StationSources;
    const stationName = S.stationName;
    ctx.Memory.rooms["W26N58"] = {
        [stationName]: {
            src1: { id: "src1", container: undefined, spawnTime: ctx.Game.time - 1600, creeps: [] },
        },
    };
    const spawnCalls = [];
    const room = {
        name: "W26N58", my: true, level: 6, spawnFailure: false,
        energyAvailable: hive,
        getEnergyAvailable: () => hive,
        getEnergyCapacityAvailable: () => 2300,
        creeps: () => [],
        find: () => [],
    };
    S.outerMineStarvesSpawnRoom = () => false;
    S.homeMiningPaused = () => false;
    S.generatorHarTask = () => [];
    S.generatorOuterHarTask = () => [];
    ctx.StationHive.trySpawn = (rm, target, body, role) => {
        const spend = costOf(body);
        spawnCalls.push({ role, body: body.slice(), spend });
        // 线上 station_hive.js:177 —— 付不起就静默失败
        const left = rm.currentEnergyAvailable === undefined ? rm.getEnergyAvailable() : rm.currentEnergyAvailable;
        if (!body || !body.length || left < spend) return undefined;
        return "newKeeper";
    };
    S.trySpawnOuterHarKeeper("W26N58", room);
    return spawnCalls;
}

// ── 1. 现场复刻：hive 400、storage 9.9 万、0 只 keeper ⇒ 必须孵，且真付得起 ──
const live = runForHive(src, 400);
assert.equal(live.length, 1, "hive 400 + 0 只 keeper 必须派一只（否则全房零收入）");
assert.ok(live[0].spend <= 400, `体型必须付得起（实际 ${live[0].spend} > 400）`);
assert.ok(live[0].body.includes("work"), "keeper 的体型里必须有 WORK，否则挖不了矿");

// ── 2. hive 300（被 carrier/upgrader 抽干后的常态）也要能出 ─────────────
const low = runForHive(src, 300);
assert.equal(low.length, 1, "hive 300 时也该用 300 能量的退化体型顶住");
assert.equal(low[0].spend, 300, "退化档 = 2 WORK + 1 MOVE + 1 CARRY = 300");

// ── 3. hive 富余时体型照样放大（修复不是把 keeper 固定成 2 WORK） ────────
// 本房 keeper 的上限是 innerMaxPartCnt=3 档（6 WORK + 3 MOVE + 1 CARRY = 800）。
const rich = runForHive(src, 2300);
assert.equal(rich.length, 1, "hive 满格照样能孵");
assert.ok(rich[0].spend > low[0].spend, `hive 满格必须按大体系孵（实际 ${rich[0].spend}）`);
assert.equal(rich[0].spend, 800, "满配档 = 3 组（6 WORK + 3 MOVE + 1 CARRY）= 800");
assert.ok(rich[0].spend <= 2300, "且不能超支");

// ── 4. 连 1 组（300）都付不起时不许硬造空体型（spawnCreep([]) 会报错） ────
for (const hive of [100, 200, 250]) {
    const r = runForHive(src, hive);
    for (const s of r) {
        assert.ok(s.spend > 0, `hive ${hive} 时不许派空体型`);
        assert.ok(s.spend <= hive, `hive ${hive} 时派了 ${s.spend} 能量的爬 = 超支`);
    }
}

// ── 5. 负对照：把预算改回 550 下限（并且去掉付得起守卫），第 1 条现场必须孵不出来 ──
const OLD_UPPER = src
    // 单行子串替换（文件是 CRLF，跨行匹配会失败）
    .replace("? Math.min(spawnRoom.getEnergyCapacityAvailable(), budgetLeft)",
        "? Math.min(spawnRoom.getEnergyCapacityAvailable(), Math.max(budgetLeft, 550))")
    .replace("if (ManagerCreeps.getBodyEnergyNeed(harBody) > budgetLeft) return;", "");
assert.notEqual(OLD_UPPER, src, "负对照的源码替换必须命中");
assert.match(OLD_UPPER, /budgetLeft, 550\)\)\s*\r?\n\s*: Math\.min/, "预算必须两路都变成 550 下限");
assert.equal(runForHive(OLD_UPPER, 400).filter(c => c.spend <= 400).length, 0,
    "旧写法（下限 550 ⇒ 550 体型）在 hive 400 时确实孵不出来 —— 这就是 650 tick 的零收入");

console.log("keeper body: OK (home keeper sized by the energy actually left, no 550 floor lock)");
