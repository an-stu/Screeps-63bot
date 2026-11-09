/**
 * upgrader 换代的「有效在岗」计数。
 *
 * 2026-11-09 23:0x W26N58（RCL7、storage 能量 ~85,000、双 spawn、hive 满 5,600）实测：
 *   · 两只 upgrader：一只 ttl 152（还剩 2 分半）、一只 ttl 936；
 *   · 数量闸门 `(85,000 - 35,000) / 30,000 = 1.67` 对裸计数 2 判「够了」⇒ 不补；
 *   · 那只死后裸计数变 1 才放行，而孵一只 50 部件（30 WORK）要 `50 × 3 = 150` tick
 *     ⇒ 控制器在这 150 tick 里只有一只 upgrader 在产（实测速率从 ~115/tick 掉到 ~55/tick）。
 *
 * 外矿搬运早就是 `ttl > body.length*3 + path + PRESPAWN` 的口径，upgrader 这条漏了。
 * 判据只改「什么时候该派」，不改调用顺序（keeper → carrier → 外矿 → upgrader），
 * 稳态下仍是同一只替换同一只。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "modules/station_upgrade.js"), "utf8");

const COST = { work: 100, carry: 50, move: 50 };
const costOf = body => body.reduce((a, p) => a + (COST[p] || 0), 0);

// 线上 Array.prototype 已被 main.js 扩展出 head/last；宿主侧的 mock 数组也要有。
if (typeof Array.prototype.head !== "function") {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        writable: true, configurable: true,
    });
}

function makeCreep() {
    return function Creep() { };
}
makeCreep.prototype = {};

/** 载入 station_upgrade.js；StationHive.trySpawn 按线上语义「付不起就静默失败」。 */
function load(src) {
    const ctx = {
        console,
        Creep: makeCreep(),
        Game: { time: 5000, shard: { name: "shard3" }, getObjectById: id => (id ? { id } : undefined) },
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
            if ((room.currentEnergyAvailable === undefined
                ? room.getEnergyAvailable() : room.currentEnergyAvailable) < spend) return undefined;
            ctx.spawned.push({ body: body.slice(), spend, role });
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

/** 一只 49 部件的 upgrader（30 WORK + 15 MOVE + 4 CARRY），换代窗口 49*3+50 = 197 tick。
 *  memory.tasks 非空 ⇒ rescueIdleUpgraders 不会碰它（本测试不测那条路径）。 */
const upg = (ttl) => ({ body: { length: 49 }, ticksToLive: ttl, spawning: false, memory: { tasks: [{ taskName: "upgradeKeeper" }] } });

function makeRoom(hive, storageEnergy, upgraders, level) {
    return {
        name: "W26N58",
        my: true,
        level: level || 7,
        memory: { stationUpgrade: { creeps: [], container: "cid", link: "lid" } },
        storage: { store: { energy: storageEnergy } },
        controller: { progress: 100, progressTotal: 1000, ticksToDowngrade: 150000 },
        energyAvailable: hive,
        getEnergyAvailable: () => hive,
        getEnergyCapacityAvailable: () => 5600,
        creeps: role => (role === "upgrader" ? upgraders.slice() : []),
        flags: () => ({ head: () => undefined }),
    };
}

function run(src, hive, storageEnergy, upgraders, level) {
    const ctx = load(src);
    ctx.StationUpgrade.spawnUpgrader(makeRoom(hive, storageEnergy, upgraders, level));
    return { spawned: ctx.spawned, ctx };
}

// ── 1. 计数本身 ─────────────────────────────────────────────────────────────
{
    const { ctx } = run(SRC, 5600, 85000, []);
    const cov = ctx.StationUpgrade.upgraderCoverageCount;
    assert.equal(typeof cov, "function", "upgraderCoverageCount 必须存在");
    const room = list => ({ creeps: role => (role === "upgrader" ? list : []) });

    assert.equal(cov(room([upg(152)])), 0, "ttl 152 < 49*3+50=197 ⇒ 已经算「不在岗」");
    assert.equal(cov(room([upg(198)])), 1, "刚刚高于换代窗口（198 > 197）仍算在岗");
    assert.equal(cov(room([upg(197)])), 0, "恰好等于窗口不算（判据是严格大于，留足整个孵化时长）");
    assert.equal(cov(room([upg(936)])), 1, "ttl 936 的健康爬正常计入");
    assert.equal(cov(room([{ spawning: true }])), 1, "孵化中的爬必然计入");
    assert.equal(cov(room([{}])), 1, "缺字段的桩/老记忆保守计入（宁可少孵一只）");
    assert.equal(cov(room([upg(152), upg(936)])), 1, "一老一少 ⇒ 只有 1 只在岗");
}

// ── 2. 现场复刻：配额 1.67、一老一少 ⇒ 必须放行 ────────────────────────────
{
    const live = run(SRC, 5600, 85000, [upg(152), upg(936)]);
    assert.equal(live.spawned.length, 1,
        "W26N58 现场（storage 能量 85,000 / 配额 1.67 / 一只 ttl 152）必须提前补一只，"
        + "否则那只老死后控制器要空转 150 tick 的孵化时间");
    assert.ok(live.spawned[0].spend <= 5600, "体型不能超支");
    assert.equal(live.spawned[0].role, "upgrader", "补的必须是 upgrader");
}

// ── 3. 两只都健康 ⇒ 不许超编（配额 1.67 < 2） ──────────────────────────────
{
    const idle = run(SRC, 5600, 85000, [upg(1000), upg(1000)]);
    assert.equal(idle.spawned.length, 0, "两只是健康的就该按配额停手，不许变成 3 只");
}

// ── 4. storage 兜底不被打穿：能量不够养多一只时仍按配额停手 ────────────────
{
    // (30,000 - 35,000)/30,000 < 0 ⇒ 配额为负；仍有 1 只健康的在岗（不走「0 只」兜底），
    // 一只将死也不该硬抽 storage —— 换代提前量只该在「本来就有配额」时生效。
    const poor = run(SRC, 5600, 30000, [upg(152), upg(1000)]);
    assert.equal(poor.spawned.length, 0,
        "storage 能量 30,000（配额负数）时不许因为「即将老死」就多孵");
}

// ── 5. RCL8 分支行为不变（0 只 / spawnTime 那条仍是裸计数） ─────────────────
{
    const r8 = run(SRC, 5600, 90000, [upg(1000)], 8);
    assert.equal(r8.spawned.length, 0,
        "RCL8 且降级余量 150,000 ⇒ 照旧不补（换代提前量不碰 RCL8 那条分支）");
}

// ── 6. 负对照：换回裸计数，第 2 条现场必须孵不出来 ─────────────────────────
{
    const OLD = SRC.replace("let liveUpgraderCnt = pro.upgraderCoverageCount(room);",
        'let liveUpgraderCnt = room.creeps("upgrader", false).length;');
    assert.notEqual(OLD, SRC, "负对照的源码替换必须命中");
    const old = run(OLD, 5600, 85000, [upg(152), upg(936)]);
    assert.equal(old.spawned.length, 0,
        "旧写法（裸计数 2）在现场确实不孵 —— 这就是那 150 tick 断档的来源");
}

// ── 7. 源码形状：RCL<8 的数量闸门不允许再出现裸计数 ───────────────────────
{
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const body = SRC.match(/\n {4}spawnUpgrader\(room\) \{[\s\S]*?\n {4}stationName: "stationUpgrade"/);
    assert.ok(body, "spawnUpgrader 必须存在");
    const code = strip(body[0]);
    assert.ok(!/upgradeDivisor > room\.creeps\("upgrader", false\)\.length/.test(code),
        "数量闸门不能再拿裸计数比配额（会漏掉即将老死的那只）");
    assert.ok(/pro\.upgraderCoverageCount\(room\)/.test(code),
        "必须用有效在岗计数");
}

console.log("upgrader replace coverage: OK (即将老死的不再占用配额，换代提前一只孵化时长)");
