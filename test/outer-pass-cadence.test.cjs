const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/strategy_outerHarvest.js"), "utf8");

/**
 * 外矿策略**不能自带第二层周期节流**（2026-11-05 W26N58/W26N59 实测）。
 *
 * 调用方已经有节流：StrategyHighLevel 每 economyInterval（7，低桶 14）tick 一次、
 * StrategyLowLevel 是 %3。exec 里再叠 `%6` 后两个周期互质 ⇒ 真正走到补员的
 * 机会只剩约 1/3 的 pass，于是 `trySpawnOuterHarCarrier` 与紧随其后的
 * `StationUpgrade.spawnUpgrader` 争同一个空闲 spawn 时，**后者每次都在场、前者
 * 三分之二的时候不在场** —— keeper → carrier → 外矿 → upgrader 这个靠调用位置
 * 实现的优先级就失效了。
 *
 * 现场：tick 84080184 W26N58 spawn idle、hive 2300/2300 满，`__outerWhy` 却停在
 * `try:carry9,avail2300,budget1150@84080144`；同期 W26N59 容器 2000/2000 满 +
 * 地面 3,800（另一矿点容器 250 + 地面 2,800）在持续衰减，只有 2 只车。
 */

const m = src.match(/\n {4}exec\(room\) \{[\s\S]*?\n {4}\},/);
assert.ok(m, "strategy_outerHarvest.exec 必须存在");
const execSrc = m[0];

// ── 行为层：在相邻的两个「非 %6 对齐」tick 上都必须真的去要 spawn ─────────────
const ctx = {
    console,
    Game: {
        time: 1000,
        rooms: {},
        map: { getRoomLinearDistance: () => 1 },
    },
    Memory: { rooms: {}, outerPaused: {} },
    FIND_MY_CREEPS: 7,
    OUTER_CONGESTION_TICKS: 600,
    OUTER_CONGESTION_PAUSE_CNT: 3,
    ManagerFlags: { getFlagsByPrefix: () => ctx.__flags || [] },
    HelperError: { catchError: fn => fn() },
    StationHive: { getClosestSpawnRoom: () => null, trySpawn: () => null },
    StationSources: {
        stationName: "stationSources",
        update: () => null,
        trySpawnOuterDefenser: () => null,
        trySpawnOuterHarKeeper: () => null,
        trySpawnOuterHarCarrier: (target, spawnRoom) => {
            ctx.__carrierCalls.push([ctx.Game.time, target, spawnRoom && spawnRoom.name]);
        },
    },
};
ctx.global = ctx;
vm.runInNewContext("var pro = {" + execSrc + "\n};\n", ctx, { filename: "strategy_outerHarvest-exec.js" });

// exec 内部会用到这几个 pro 方法：威胁判定关掉、防守编制放行、专队空操作。
Object.assign(ctx.pro, {
    hasStopRemoteFlag: () => false,
    invaderCoreBlocks: () => false,
    roomNeedsDefense: () => false,
    outerDefendersFull: () => true,
    spawnCoreBuster: () => null,
    spawnTowerBuster: () => null,
    shouldHarvestRemoteMineral: () => false,
});
ctx.__carrierCalls = [];

// 出兵房（RCL6 单 spawn）：storage 在手、自己就是 room
ctx.Game.rooms.W26N58 = {
    name: "W26N58",
    my: true,
    storage: { id: "st" },
    hashCode: () => 0,
    find: () => [],
    flags: () => [],
    creeps: () => [],
};
// 矿房：无 controller（Source Keeper / 中立房），有 stationSources 登记
ctx.Game.rooms.W26N59 = { name: "W26N59", my: false, find: () => [], creeps: () => [] };
ctx.Memory.rooms.W26N59 = { stationSources: { s1: {} } };
ctx.__flags = [{
    name: "har_W26N58_W26N59",
    memory: { spawnRoom: "W26N58" },
    pos: { roomName: "W26N59" },
    getRoomName: () => "W26N58",
}];

const spawnRoom = ctx.Game.rooms.W26N58;
// 1000 % 6 = 4、1001 % 6 = 5 —— 旧实现两个 tick 都直接早退
for (const t of [1000, 1001]) {
    ctx.Game.time = t;
    ctx.pro.exec(spawnRoom);
}
assert.deepEqual(ctx.__carrierCalls.map(e => e[0]), [1000, 1001],
    "economy pass 到点就必须真的尝试补外矿搬运（否则空着的 spawn 会被 upgrader 顺手拿走）");
assert.equal(ctx.__carrierCalls[0][1], "W26N59");
assert.equal(ctx.__carrierCalls[0][2], "W26N58");

// ── 同一 tick 被两个调用点各调一次时，只跑一遍 ──────────────────────────────
ctx.__carrierCalls = [];
ctx.Game.time = 1002;
ctx.pro.exec(spawnRoom);
ctx.pro.exec(spawnRoom);
assert.equal(ctx.__carrierCalls.length, 1, "同 tick 重复调用必须幂等（room 对象每 tick 重建，守卫自然失效）");

// ── 负对照：没有 har 旗时什么都不做（不能因为拆了节流就空转） ────────────────
ctx.__carrierCalls = [];
ctx.__flags = [];
ctx.Game.time = 1003;
ctx.pro.exec(spawnRoom);
assert.equal(ctx.__carrierCalls.length, 0, "无 har 旗时不得补员");

// ── 源码层复核：exec 里不得再出现「按 tick 取模就整段早退」的闸门 ────────────
// 上面那条行为断言是主判据（旧实现在这里必然红）；这条是防回归的形状断言。
assert.ok(!/%\s*\d+\s*!=\s*0\)\s*return/.test(execSrc),
    "exec 不得自带 %N 周期节流（会与调用方的 economy pass 周期互质，把补员挡在 2/3 的 pass 之外）");

console.log("outer pass cadence: OK");
