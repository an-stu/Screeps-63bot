/**
 * 「0 只 upgrader 但 spawn 空着、hive 只有 400~500」时，upgrader 必须能用**退化体型**孵出来。
 *
 * 2026-11-05 W26N58 实地（tick 84084560~84084835，控制器 2,302,949 冻结约 30 分钟）：
 *   · storage 161,167、terminal 151,523、升级容器 1,870、spawn 大段空闲；
 *   · `stationUpgrade.creeps` 为空 —— 一只 upgrader 都没有；
 *   · hive 在 158 / 300 / 464 / 704 之间打转（keeper 950、carrier 1,100~1,500
 *     轮流把它抽干）；唯一一次冲到 1,354 时 spawn 正在孵 keeper（84084680 起 64 tick），
 *     等 spawn 空出来 hive 又掉回 400。
 *
 * 病根：`trySpawnUpgrader` 的 `bodyBudget = Math.max(600, …)` 把预算**强行抬到 600**
 * ⇒ 造出 4 WORK / 550 能量的体型 ⇒ `StationHive.trySpawn` 只要 `currentEnergyAvailable
 * < spend` 就静默失败（`station_hive.js:177`）⇒ hive 长期 < 550 的房里**永远**孵不出
 * upgrader，与它自己的注释「体型必须本 tick 真付得起」正好相反（MEMORY 第 3/5 条：
 * 闸门不许自锁、下限不能写死成大房量级）。
 *
 * 修法：下限改成 300 = `getBodyLowLevel` 的 num=1 档（2 WORK + 1 MOVE + 1 CARRY），
 * 比 keeper（950）便宜 ⇒ 抢不走 keeper 的孵化费；hive 充足时行为不变（按真实能量放大）。
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

function makeRoom(hive, storageEnergy, upgraderCnt) {
    return {
        name: "W26N58",
        my: true,
        level: 6,
        memory: { stationUpgrade: { creeps: [], container: "cid", link: "lid" } },
        storage: { store: { energy: storageEnergy } },
        controller: { progress: 100, progressTotal: 1000, ticksToDowngrade: 120000 },
        energyAvailable: hive,
        getEnergyAvailable: () => hive,
        getEnergyCapacityAvailable: () => 2300,
        creeps: role => new Array(role === "upgrader" ? upgraderCnt : 0).fill({}),
        flags: () => ({ head: () => undefined }),
    };
}

function run(src, hive, storageEnergy, upgraderCnt) {
    const ctx = load(src);
    ctx.StationUpgrade.spawnUpgrader(makeRoom(hive, storageEnergy, upgraderCnt));
    return ctx.spawned;
}

// ── 1. 现场复刻：hive 464、storage 16 万、0 只 upgrader ⇒ 必须孵，且付得起 ──
const live = run(SRC, 464, 161167, 0);
assert.equal(live.length, 1, "hive 464 + storage 16 万 + 0 只 upgrader 必须孵出一只");
assert.ok(live[0].spend <= 464, `体型必须付得起（实际 ${live[0].spend} > 464）`);
assert.ok(live[0].spend >= 300, "也不能退化成 0 WORK 的废物体型");
assert.ok(live[0].body.includes("work"), "upgrader 的体型里必须有 WORK");

// ── 2. hive 300（keeper 刚抽干的常态）也要能出 ──────────────────────────
const low = run(SRC, 300, 161167, 0);
assert.equal(low.length, 1, "hive 300 时也该用 300 能量的退化体型顶住（否则永远 0 只）");
assert.equal(costOf(low[0].body), 300, "退化档 = 2 WORK + 1 MOVE + 1 CARRY = 300");

// ── 3. 体型仍随真实能量放大（修复不是把所有人固定成 2 WORK） ──────────────
const rich = run(SRC, 2300, 161167, 0);
assert.equal(rich.length, 1, "hive 满格照样能孵");
assert.ok(rich[0].spend > 1500, `hive 满格必须按大体系孵（实际 ${rich[0].spend}）`);
assert.ok(rich[0].spend <= 2300, "且不能超支");

// ── 4. 没钱的房不许硬抽：hive 464 但 storage 0 ⇒ 走 40% 闸 + 仍付得起就孵 ──
// （这里只验证「不会超支」这一条硬约束 —— 能量不足时 trySpawn 必须失败而不是造出空体型）
for (const hive of [100, 200, 250]) {
    const r = run(SRC, hive, 161167, 0);
    for (const s of r) assert.ok(s.spend <= hive, `hive ${hive} 时孵出 ${s.spend} 能量的爬 = 超支`);
}

// ── 5. 负对照：把下限改回 600，第 1 条现场必须孵不出来（证明测的是行为） ────
const OLD = SRC.replace("Math.max(300, Math.min(room.getEnergyCapacityAvailable(), cachedEnergy))",
    "Math.max(600, Math.min(room.getEnergyCapacityAvailable(), cachedEnergy))");
assert.notEqual(OLD, SRC, "负对照的源码替换必须命中");
assert.equal(run(OLD, 464, 161167, 0).length, 0,
    "旧写法（下限 600 ⇒ 550 体型）在 hive 464 时确实孵不出来 —— 这就是这 30 分钟的死锁");

console.log("upgrader body floor: OK (300-energy degraded upgrader instead of a 600 budget lock)");
