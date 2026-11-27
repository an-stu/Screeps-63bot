/**
 * 高 RCL 的 upgrader 体型下限（2026-11-27 用户：不要再产小体型 upgrader）。
 *
 * 现场：shard2/E56S29 `shard2_78408005_2`，体型 WORK2/CARRY1/MOVE1（300），
 * 出生时房间已是 RCL5（容量 1,800）——不是低 RCL 遗留，而是 `trySpawnUpgrader`
 * 的 `Math.max(300, …)` 下限：keeper/carrier 把 hive 抽到 300 时立刻按 300 孵化。
 * 结果 3 只 20 部件正常体随后出生，这只 4 部件爬长期占着「在岗」名额。
 *
 * 新政策：
 *   · RCL>=4：最小预算 = min(容量, max(1,000, 容量的一半))，攒不到就等待；
 *   · 唯一例外 = 有效在岗 0 只 且 控制器 < 5,000 tick 降级（emergency，允许退化体）；
 *   · RCL<4：仍允许 300 退化体（低 RCL 房 hive 本来就只有 300~800）。
 *
 * 旧行为（hive 464 / storage 16 万 / 降级还远也立刻孵 300 体）作为负对照保留：
 * 它正是用户点名要停掉的行为。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "modules/station_upgrade.js"), "utf8");

const COST = { work: 100, carry: 50, move: 50 };
const costOf = body => body.reduce((a, p) => a + (COST[p] || 0), 0);

function makeCreep() {
    return function Creep() { };
}
makeCreep.prototype = {};

/**
 * 载入 station_upgrade.js，返回 { pro, spawned, spawnUpgrader(room) }。
 * `StationHive.trySpawn` 按**线上真实语义**模拟：能量不够就返回 undefined。
 */
function load(src) {
    const ctx = {
        console,
        Creep: makeCreep(),
        Game: { time: 5000, shard: { name: "shard3" }, getObjectById: id => ({ id }) },
        Memory: { rooms: {} },
        WHO_AM_I: "someone",
        STRUCTURE_CONTAINER: "container",
        STRUCTURE_LINK: "link",
        STRUCTURE_CONTROLLER: "controller",
        WORK: "work", CARRY: "carry", MOVE: "move",
        RESOURCE_ENERGY: "energy",
        BODYPART_COST: COST,
        MAX_GCL: 150,
        StationLab: { boostAbleLevel: () => -1, generatorBoostLevelTask: () => [] },
        StationCarry: { stationName: "stationCarry" },
        ManagerCreeps: { calcBodyPart: obj => Object.keys(obj).flatMap(k => new Array(obj[k]).fill(k)) },
        UtilsTask: { task: () => ({}) },
        log: () => { },
    };
    ctx.global = ctx;
    ctx.spawned = [];
    ctx.StationHive = {
        trySpawn: (room, target, body, role) => {
            const spend = costOf(body);
            // 线上 station_hive.js:177 —— 付不起就静默失败
            if ((room.currentEnergyAvailable === undefined
                ? room.getEnergyAvailable() : room.currentEnergyAvailable) < spend) return undefined;
            ctx.spawned.push({ body: body.slice(), spend });
            return "SpawnOK";
        },
    };
    vm.runInNewContext(
        "Array.prototype.head = function(){ return this.length ? this[0] : undefined; };"
        + "Array.prototype.last = function(){ return this.length ? this[this.length - 1] : undefined; };"
        + src,
        ctx, { filename: "station_upgrade.js" });
    return ctx;
}

function makeRoom(hive, storageEnergy, upgraderCnt, options = {}) {
    return {
        name: options.name || "E56S29",
        my: true,
        level: options.level || 6,
        memory: { stationUpgrade: { creeps: [], container: "cid", link: "lid" } },
        storage: options.noStorage ? undefined : { store: { energy: storageEnergy } },
        controller: { progress: 100, progressTotal: 1000, ticksToDowngrade: options.downgrade || 120000 },
        energyAvailable: hive,
        getEnergyAvailable: () => hive,
        getEnergyCapacityAvailable: () => options.cap || 2300,
        creeps: role => new Array(role === "upgrader" ? upgraderCnt : 0).fill({}),
        flags: () => ({ head: () => undefined }),
    };
}

function run(src, hive, storageEnergy, upgraderCnt, options) {
    const ctx = load(src);
    ctx.StationUpgrade.spawnUpgrader(makeRoom(hive, storageEnergy, upgraderCnt, options));
    return ctx.spawned;
}

// ── 1. 新政策：hive 464 + storage 16 万 + 降级还远 ⇒ 不孵，等攒大 ────────
const waiting = run(SRC, 464, 161167, 0);
assert.equal(waiting.length, 0,
    "高 RCL（cap 2,300，最小预算 1,150）时 hive 464 必须等待，不能再孵 4 部件小体型");

// ── 2. 负对照：旧的最小体型地板会立刻孵（证明测试咬的是新闸门）──────────
const OLD = SRC.replace(
    "if (bodyBudget < 300 || (bodyBudget < minBudget && !emergency)) return;",
    "bodyBudget = Math.max(300, bodyBudget);");
assert.notEqual(OLD, SRC, "负对照的源码替换必须命中");
const oldBehavior = run(OLD, 464, 161167, 0);
assert.equal(oldBehavior.length, 1, "旧写法在 hive 464 时确实会孵出小体型（用户点名要停掉的行为）");
assert.equal(oldBehavior[0].spend, 300, "旧写法孵出的就是 300 能量 / 4 部件退化体");

// ── 3. emergency：控制器 <5,000 tick 降级且 0 只在岗 ⇒ 允许退化体 ────────
const emergency = run(SRC, 464, 161167, 0, { downgrade: 4000 });
assert.equal(emergency.length, 1, "快降级且 0 只在岗时必须破例孵一只，体型可以退化");
assert.ok(emergency[0].spend <= 464, `破例体型也必须付得起（实际 ${emergency[0].spend} > 464）`);
assert.ok(emergency[0].spend >= 300, "也不能退化成 0 WORK 的废物体型");

// hive 300 的极端现场：降级还远时等待，快降级时用 300 顶住
assert.equal(run(SRC, 300, 161167, 0).length, 0, "hive 300 + 降级还远 ⇒ 等待");
const low = run(SRC, 300, 161167, 0, { downgrade: 4000 });
assert.equal(low.length, 1, "hive 300 但快降级 ⇒ 用 300 能量的退化体型顶住");
assert.equal(costOf(low[0].body), 300, "退化档 = 2 WORK + 1 MOVE + 1 CARRY = 300");

// ── 4. 体型仍随真实能量放大（修复不是把所有人固定成 2 WORK） ──────────────
const rich = run(SRC, 2300, 161167, 0);
assert.equal(rich.length, 1, "hive 满格照样能孵");
assert.ok(rich[0].spend > 1500, `hive 满格必须按大体系孵（实际 ${rich[0].spend}）`);
assert.ok(rich[0].spend <= 2300, "且不能超支");

// ── 5. 低 RCL（<4）仍允许 300 退化体：hive 本来就只有 300~800 ────────────
const lowRcl = run(SRC, 300, 0, 0, { level: 3, noStorage: true, cap: 800, downgrade: 50000 });
assert.equal(lowRcl.length, 1, "RCL<4 无 storage 的房必须能出 300 小工，否则控制器停摆");
assert.equal(costOf(lowRcl[0].body), 300);

// ── 6. 没钱的房不许硬抽：hive 太小（<300）时不能造空体型 ────────────────
for (const hive of [100, 200, 250]) {
    const r = run(SRC, hive, 161167, 0, { downgrade: 4000 });
    for (const s of r) assert.ok(s.spend <= hive, `hive ${hive} 时孵出 ${s.spend} 能量的爬 = 超支`);
}

console.log("upgrader body floor: high-RCL waits for a real body; degraded only on downgrade emergency");