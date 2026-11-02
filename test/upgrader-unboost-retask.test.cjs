/**
 * 卸完强化的 upgrader 不能变成「站着等死」（2026-11-02 W26N58 实测）。
 *
 * 现场：`shard3_84014505_1`（role upgrader）在 ttl 124 左右进入
 * `station_upgrade.js` 的卸强化分支 —— 先 `drop(RESOURCE_ENERGY)`、
 * `unregisterStationUpgrade()`、`popTask().addTask(卸强化任务)`。
 * 卸完强化后 `UnboostCreepBodyPart` 走 `popTask().execLastTask()`，
 * 此时任务栈**空**，而全仓库没有任何地方给「任务栈空了的在职 upgrader」补任务
 * （`workerManagerAfterCarrier` / `StrategyLowLevel` 那些 `generatorUpgradeTask`
 * 只发给 `room.creeps("worker")`）⇒ 它就带着 0 能量停在 lab 旁边把剩余寿命
 * （`pathTime*1.5` = 124 tick）站完。
 *
 * 实测症状：控制器 586,826 连续 ~330 tick 不动、upgrader 停在 (41,7)
 * 紧邻 lab (41,6)、距控制器 (9,7) 32 格、store 0、`memory.tasks` 恒 []。
 * 用户 2026-10-19 明确「在位的爬必须干活」⇒ 卸完必须把升级任务还回去。
 *
 * 这里验：
 *   ① 卸强化完成后，upgrader 的任务栈里重新出现 upgradeKeeper，且重新登记到站点
 *   ② 负对照：同状态的 carrier 不加任务（别人的活儿有各自的 manager）
 *   ③ 负对照：ttl 已到 0 的 upgrader 不加任务（没必要）
 *   ④ 负对照：任务栈非空时不动（不许覆盖已有任务）
 *   ⑤ 源码断言：补任务在 `popTask()` **之后**、`execLastTask()` **之前**
 *      （放到 execLastTask 之后等于这一 tick 白站，放到 popTask 之前会被 pop 掉）
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "station_lab.js"), "utf8");
// 断言前剥注释：本文件注释里原样引用了这些表达式（本仓库既有踩坑）
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── 最小运行环境 ────────────────────────────────────────────────────────
const ctx = {
    console,
    Creep: function () {},
    Game: { time: 100000, rooms: {}, getObjectById: () => null },
    Memory: { rooms: {} },
    STRUCTURE_LAB: "lab",
    STRUCTURE_CONTAINER: "container",
    LAB_UNBOOST_ENERGY: 20,
    LAB_UNBOOST_MINERAL: 15,
    // station_lab.js 顶层会遍历 REACTIONS 建 global.LAB_REACTIONS
    REACTIONS: {},
    REACTION_TIME: {},
    RESOURCE_ENERGY: "energy",
    WORK: "work",
    CARRY: "carry",
    MOVE: "move",
    _: { keys: obj => Object.keys(obj || {}), values: obj => Object.keys(obj || {}).map(k => obj[k]) },
    UtilsTask: { task: () => ({}), taskData: () => ({}) },
    HelperError: { catchError: fn => fn() },
};
ctx.global = ctx;

// Screeps 常量在 node 里不存在，station_lab.js 顶层会用到一批；缺的给个占位名即可
for (const k of [
    "TOUGH", "HEAL", "RANGED_ATTACK", "ATTACK", "CLAIM",
    "STRUCTURE_LAB", "STRUCTURE_CONTAINER", "STRUCTURE_EXTENSION", "STRUCTURE_STORAGE",
    "STRUCTURE_TERMINAL", "STRUCTURE_SPAWN", "STRUCTURE_TOWER", "STRUCTURE_LINK",
    "FIND_STRUCTURES", "FIND_MY_STRUCTURES", "FIND_CREEPS", "FIND_MY_CREEPS",
    "LOOK_STRUCTURES", "LOOK_CREEPS", "OK", "ERR_NOT_IN_RANGE", "ERR_FULL",
    "ERR_NOT_ENOUGH_RESOURCES", "RESOURCE_POWER", "RESOURCE_ENERGY",
]) {
    if (!(k in ctx)) ctx[k] = k;
}
// 顶层代码会遍历它们（`_.values(BOOSTS).forEach(...)`），必须是真的对象
ctx.BOOSTS = {};
ctx.REACTIONS = {};
ctx.REACTION_TIME = {};

let retaskCalls = 0;
ctx.StationUpgrade = {
    generatorUpgradeKeeperTask: room => {
        retaskCalls++;
        return { taskName: "upgradeKeeper", id: room.controller.id, roomName: "W26N58" };
    },
};

vm.runInNewContext(code, ctx, { filename: "station_lab.js" });
const proto = ctx.Creep.prototype;
assert.equal(typeof proto.UnboostCreepBodyPart, "function", "UnboostCreepBodyPart 缺失");

/** 造一只「任务栈里只剩卸强化任务」的爬 */
function mkCreep(opts) {
    const room = {
        name: opts.room || "W26N58",
        memory: { stationLab: { centerLabs: [], otherLabs: [] } },
        controller: { id: "ctrl" + (opts.room || "1") },
    };
    ctx.Game.rooms[room.name] = room;
    const creep = Object.create(proto);
    creep.memory = {
        role: opts.role,
        roomName: room.name,
        tasks: opts.tasks || [],
    };
    creep.ticksToLive = opts.ttl === undefined ? 120 : opts.ttl;
    creep.body = opts.body || [{ type: "work" }];   // 无 boost ⇒ needUnboost = 0
    creep.room = room;
    creep.registered = false;
    creep.executed = 0;
    creep.mainRoom = function () { return ctx.Game.rooms[this.memory.roomName]; };
    creep.lastTaskObj = function () { return opts.container || null; };
    creep.popTask = function () { this.memory.tasks.pop(); return this; };
    creep.addTask = function (t) {
        if (!t) return this;
        if (t.taskName) this.memory.tasks.push(t);
        return this;
    };
    creep.registerStationUpgrade = function () { this.registered = true; return this; };
    creep.execLastTask = function () { this.executed++; return this; };
    return creep;
}

const unboostTask = { taskName: "UnboostCreepBodyPart", id: "cnt1" };

// ① upgrader 卸完强化 → 补回 upgradeKeeper
retaskCalls = 0;
{
    const creep = mkCreep({ role: "upgrader", tasks: [unboostTask] });
    creep.UnboostCreepBodyPart();
    assert.equal(creep.memory.tasks.length, 1, "卸完强化后任务栈必须非空（否则站着等死）");
    assert.equal(creep.memory.tasks[0].taskName, "upgradeKeeper", "补回的必须是 upgradeKeeper");
    assert.equal(creep.registered, true, "必须重新登记到 stationUpgrade（数量/卸强化时长都读它）");
    assert.equal(creep.executed, 1, "补完任务要立刻 execLastTask 一次");
    assert.equal(retaskCalls, 1);
}

// ② 负对照：carrier 不加任务（它有自己的 manager）
retaskCalls = 0;
{
    const creep = mkCreep({ role: "carrier", tasks: [unboostTask] });
    creep.UnboostCreepBodyPart();
    assert.equal(creep.memory.tasks.length, 0, "carrier 不该在这里被补任务");
    assert.equal(creep.registered, false);
    assert.equal(retaskCalls, 0);
}

// ③ 负对照：ttl 0 的 upgrader 不加（马上就死了）
retaskCalls = 0;
{
    const creep = mkCreep({ role: "upgrader", tasks: [unboostTask], ttl: 0 });
    creep.UnboostCreepBodyPart();
    assert.equal(creep.memory.tasks.length, 0);
    assert.equal(retaskCalls, 0);
}

// ④ 负对照：栈里还有别的任务时不动
retaskCalls = 0;
{
    const creep = mkCreep({
        role: "upgrader",
        ttl: 120,
        // 卸强化任务在栈顶，下面还压着一条 fillRes
        tasks: [{ taskName: "fillRes", id: "s1" }, unboostTask],
    });
    creep.body = [];
    creep.UnboostCreepBodyPart();
    assert.equal(creep.memory.tasks.length, 1, "已有任务不能被覆盖");
    assert.equal(creep.memory.tasks[0].taskName, "fillRes");
    assert.equal(creep.registered, false);
    assert.equal(retaskCalls, 0);
}

// ⑤ 源码断言：补任务的位置在 popTask 之后、execLastTask 之前
{
    const elseIdx = code.indexOf("this.popTask();");
    assert.ok(elseIdx > 0, "找不到 popTask 调用点（结构改了？同步改本测试）");
    const popIdx = elseIdx;
    const retaskIdx = code.indexOf("StationUpgrade.generatorUpgradeKeeperTask(mainRoom)", popIdx);
    assert.ok(retaskIdx > popIdx, "补任务必须在 popTask 之后（否则刚加的会被 pop 掉）");
    const execIdx = code.indexOf("this.execLastTask();", popIdx);
    assert.ok(execIdx > retaskIdx, "补任务必须在 execLastTask 之前（否则这一 tick 白站）");
}

// ⑥ 跨路径兜底：`StationUpgrade.rescueIdleUpgraders` 必须能把任何「栈空了」的在职
//    upgrader 救回来（不依赖具体是哪条链把栈弹空的），并且不许动有任务的/还没出生的。
{
    const COST = { tough: 10, work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, claim: 600 };
    const upRaw = fs.readFileSync(path.join(root, "modules", "station_upgrade.js"), "utf8");
    const upCode = upRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const ctx2 = {
        console,
        Memory: { rooms: {}, controllerSignAssignments: {} },
        Game: {
            time: 100000, rooms: {}, cpu: { bucket: 10000 }, shard: { name: "shard3" },
            getObjectById(id) { return id ? { id } : null; },
        },
        Creep: { prototype: {} },
        Room: { prototype: {} },
        TOUGH: "tough", WORK: "work", CARRY: "carry", MOVE: "move",
        ATTACK: "attack", RANGED_ATTACK: "ranged_attack", HEAL: "heal", CLAIM: "claim",
        BODYPART_COST: COST,
        STRUCTURE_CONTAINER: "container", STRUCTURE_LINK: "link",
        STRUCTURE_CONTROLLER: "controller", STRUCTURE_STORAGE: "storage",
        STRUCTURE_TERMINAL: "terminal", STRUCTURE_SPAWN: "spawn",
        STRUCTURE_EXTENSION: "extension", STRUCTURE_RAMPART: "rampart", STRUCTURE_ROAD: "road",
        TERRAIN_MASK_WALL: 1, LOOK_STRUCTURES: "structure",
        OBSTACLE_OBJECT_TYPES: ["spawn", "extension", "road"],
        FIND_MY_CREEPS: 1, OK: 0, WHO_AM_I: "an_w", MAX_GCL: 150,
        RESOURCE_ENERGY: "energy",
        ManagerCreeps: {
            calcBodyPart(set) {
                const out = [];
                Object.keys(set).forEach(t => { for (let i = 0; i < set[t]; i++) out.push(t); });
                return out;
            },
        },
        ManagerRooms: {},
        HelperError: { catchError: fn => fn() },
        Utils: { getBodyEnergyNeed: body => body.reduce((a, p) => a + (COST[p] || 0), 0) },
        UtilsTask: {
            task(obj, taskName, regFun, ops) {
                return Object.assign({ taskName, id: obj && obj.id, regFun }, ops || {});
            },
        },
        StationHive: { trySpawn() { return undefined; }, HiveNeedToFill: () => false },
        StationLab: { boostAbleLevel() { return -1; } },
        StationCarry: { stationName: "stationCarry" },
        StationUpgrade: null,
    };
    ctx2.global = ctx2;
    vm.runInNewContext(upCode, ctx2, { filename: "station_upgrade.js" });
    const Upgrade = ctx2.StationUpgrade;
    assert.equal(typeof Upgrade.rescueIdleUpgraders, "function", "rescueIdleUpgraders 缺失");

    const mk = (opts) => {
        const c = {
            id: opts.id || "u1",
            spawning: !!opts.spawning,
            ticksToLive: opts.ttl === undefined ? 800 : opts.ttl,
            memory: { role: "upgrader", roomName: "W26N58", tasks: opts.tasks },
            added: [],
            registered: 0,
            addTask(t) {
                // 与 prototype_creep.js 一致：数组要摊平
                if (Array.isArray(t)) { t.forEach(x => this.addTask(x)); return this; }
                this.added.push(t); this.memory.tasks.push(t); return this;
            },
            registerStationUpgrade() { this.registered++; },
        };
        return c;
    };

    const idle = mk({ tasks: [] });
    const busy = mk({ id: "u2", tasks: [{ taskName: "fillRes", id: "s1" }] });
    const hatching = mk({ id: "u3", tasks: [], spawning: true });
    const legacy = mk({ id: "u4", tasks: undefined });
    const room = {
        name: "W26N58",
        controller: { id: "ctl" },
        creeps: role => (role === "upgrader" ? [idle, busy, hatching, legacy] : []),
        memory: { stationUpgrade: { creeps: [] } },
    };
    Upgrade.rescueIdleUpgraders(room);

    assert.equal(idle.memory.tasks.length, 1, "栈空的在职 upgrader 必须被补任务");
    assert.equal(idle.memory.tasks[0].taskName, "upgradeKeeper");
    assert.equal(idle.registered, 1, "补任务后必须重新登记到站点");
    assert.equal(busy.memory.tasks.length, 1, "有任务的不能动");
    assert.equal(busy.added.length, 0);
    assert.equal(hatching.added.length, 0, "还在孵化的不能动（它自己有 spawn 任务）");
    assert.equal(legacy.added.length, 0, "任务栈不是数组时宁可不补，不许凭空造");

    // ⑦ 源码断言：兜底必须在 spawnUpgrader 里、且在做孵化决策/早退之前
    const spawnIdx = upCode.indexOf("spawnUpgrader(room) {");
    assert.ok(spawnIdx > 0);
    const rescueCall = upCode.indexOf("pro.rescueIdleUpgraders(room);", spawnIdx);
    assert.ok(rescueCall > spawnIdx, "spawnUpgrader 必须调用 rescueIdleUpgraders");
    const earlyReturn = upCode.indexOf("&& !Game.getObjectById(sm[\"link\"])) return;", spawnIdx);
    assert.ok(earlyReturn > 0 && earlyReturn > rescueCall,
        "兜底必须早于「容器和 link 都没了」的早退，否则那种房里救不到人");
}

console.log("upgrader-unboost-retask: passed");
