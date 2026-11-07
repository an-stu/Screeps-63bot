const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const upgSrc = fs.readFileSync(path.join(root, "modules/station_upgrade.js"), "utf8");
const outerSrc = fs.readFileSync(path.join(root, "modules/strategy_outerHarvest.js"), "utf8");

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * `spawnFailure` 是**整 tick 粘滞**的「本 tick 有过一次失败尝试」，不是「spawn 被占」。
 *
 * 2026-11-05 W26N58（RCL6、容量 2,300）整整一天 0 只 upgrader：外矿房 W26N59 里有一座
 * 敌方塔（12,41 / 13,42 各 3,000 血），于是每个 economy pass 都走 `spawnTowerBuster`
 * 去孵 4,450 能量的 40 部件专队 —— 必然付不起 ⇒ `spawnFailure = true` ⇒ 紧随其后的
 * `spawnUpgrader` 被 `trySpawn` 第一行吞掉。症状：控制器 0 只 upgrader、源容器
 * 2,000/2,000 + 三个 link 全满、地面 8,356 在涨，而 hive 与 spawn 看起来都正常。
 */

// ── 1. trySpawnUpgrader 必须解掉别人的失败标记（行为层） ────────────────────
const m = upgSrc.match(/\n {4}trySpawnUpgrader\(room\) \{[\s\S]*?\n {4}\},/);
assert.ok(m, "StationUpgrade.trySpawnUpgrader 必须存在");

function buildCtx(src) {
    const ctx = {
        console,
        BODYPART_COST: { move: 50, work: 100, carry: 50 },
        MOVE: "move", WORK: "work", CARRY: "carry",
        // 与 StationHive.trySpawn 的关键首行同源：标记为真就直接拒绝
        StationHive: {
            trySpawn: (room, name, body, role) => {
                if (room.spawnFailure) { ctx.__rejected.push(role); return null; }
                ctx.__spawned.push(role);
                return "x";
            },
        },
        ManagerCreeps: {
            calcBodyPart: cfg => Object.keys(cfg).reduce((acc, k) => acc.concat(new Array(cfg[k]).fill(k)), []),
        },
        StationLab: { boostAbleLevel: () => -1 },
    };
    ctx.global = ctx;
    ctx.__spawned = [];
    ctx.__rejected = [];
    vm.runInNewContext("var pro = {" + src + "\n};", ctx, { filename: "trySpawnUpgrader.js" });
    ctx.pro.generatorUpgradeKeeperTask = () => [{}];
    return ctx;
}

const room = (spawnFailure) => ({
    name: "W26N58",
    level: 6,
    storage: { store: {} },
    extension: [],
    spawnFailure,
    energyAvailable: 2300,
    currentEnergyAvailable: 2300,
    getEnergyAvailable: () => 2300,
    getEnergyCapacityAvailable: () => 2300,
});

// 修复后：即使前面某个角色刚失败过，upgrader 也要拿到自己的机会。
const fixed = buildCtx(m[0]);
fixed.pro.trySpawnUpgrader(room(true));
assert.deepEqual(fixed.__spawned, ["upgrader"], "spawnFailure 为真时 upgrader 仍必须真的去要 spawn");
assert.deepEqual(fixed.__rejected, [], "不得被别人的失败标记挡下来");

// 负对照：把 `room.spawnFailure = false` 删掉，行为必须退化（证明断言真的落在调用点上）。
const noFix = buildCtx(m[0].replace(/room\.spawnFailure = false;/, ""));
noFix.pro.trySpawnUpgrader(room(true));
assert.deepEqual(noFix.__spawned, [], "去掉修复后 upgrader 会被 spawnFailure 吞掉（负对照）");
assert.deepEqual(noFix.__rejected, ["upgrader"], "去掉修复后连尝试都到不了 trySpawn 内部");

// 正常情况不受影响
const normal = buildCtx(m[0]);
normal.pro.trySpawnUpgrader(room(false));
assert.deepEqual(normal.__spawned, ["upgrader"], "没有粘滞标记时照常孵化");

// ── 2. 付不起的 towerBuster 不许占位（它正是上面那个标记的来源） ───────────
const tb = outerSrc.match(/\n {4}spawnTowerBuster\(targetRoomName, spawnRoom\) \{[\s\S]*?\n {4}\},/);
assert.ok(tb, "StrategyOuterHarvest.spawnTowerBuster 必须存在");
const tbCode = strip(tb[0]);
assert.ok(/Utils\.getBodyEnergyNeed\(body\) > spawnRoom\.getEnergyCapacityAvailable\(\)/.test(tbCode),
    "付不起 towerBuster 时必须提前返回（否则每个 pass 都会把 spawnFailure 置真）");

const tbCtx = {
    console,
    Game: { rooms: {} },
    FIND_HOSTILE_STRUCTURES: 1,
    STRUCTURE_TOWER: "tower",
    ATTACK: "attack",
    HEAL: "heal",
    MOVE: "move",
    Utils: { getBodyEnergyNeed: body => body.length * 111 },
    UtilsTask: { task: () => ({}) },
    HelperError: { catchError: fn => fn() },
};
tbCtx.global = tbCtx;
tbCtx.__calls = [];
tbCtx.ManagerCreeps = { calcBodyPart: cfg => new Array(Object.values(cfg).reduce((a, b) => a + b, 0)).fill("attack") };
tbCtx.StationHive = { trySpawn: (rm, n, b, role) => { tbCtx.__calls.push(role); return "x"; } };
vm.runInNewContext("Array.prototype.head = function(){ return this.length ? this[0] : undefined; };"
    + "var pro = {" + tb[0] + "\n};", tbCtx, { filename: "spawnTowerBuster.js" });
Array.prototype.head = function () { return this.length ? this[0] : undefined; };

// 弃坑房（W26N59 实测：skyfox 走了，controller 无主，塔/spawn 全部失效）
// —— inactive 塔**不拆**（用户 2026-11-08），也不许占孵化位
const tower = { structureType: "tower", id: "tw", owner: { username: "skyfox" } };
const harRoom = owned => ({
    name: "W26N59",
    find: () => [tower],
    controller: owned ? { owner: { username: "skyfox" } } : null,   // null = 弃坑无主
});
tbCtx.pro.creeps = () => [];

const makeRoom = cap => ({
    name: "W26N58",
    spawnFailure: false,
    creeps: () => [],
    getEnergyCapacityAvailable: () => cap,
});

// inactive：controller 无主 ⇒ 塔开不了火 ⇒ 一次都不试
tbCtx.Game.rooms.W26N59 = harRoom(false);
tbCtx.pro.spawnTowerBuster("W26N59", makeRoom(12900));
assert.deepEqual(tbCtx.__calls, [],
    "弃坑房的失效塔（controller 无主）不拆不派（用户 2026-11-08）");

// active：塔的主人还控制着房（能开火）⇒ 才是真威胁
tbCtx.Game.rooms.W26N59 = harRoom(true);
tbCtx.pro.spawnTowerBuster("W26N59", makeRoom(2300));
assert.deepEqual(tbCtx.__calls, [],
    "容量 2,300 的房付不起 4,450 的 towerBuster ⇒ 一次都不许试（否则会毒化整 tick）");

tbCtx.__calls = [];
tbCtx.pro.spawnTowerBuster("W26N59", makeRoom(12900));
assert.deepEqual(tbCtx.__calls, ["towerBuster"], "付得起（RCL8 12,900）且塔有主时照常派（负对照）");

console.log("sticky spawnFailure: OK");
