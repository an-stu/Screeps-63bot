const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const missionSource = fs.readFileSync(path.join(root, "modules/manager_missions.js"), "utf8");

// lodash/项目给 Array 挂的扩展：宿主 realm 与 VM realm 都要有（两边的数组会混用）
for (const [name, fn] of [
    ["head", function () { return this.length ? this[0] : undefined; }],
    ["sum", function () { return this.reduce((a, b) => a + b, 0); }],
    ["minBy", function (f) {
        let best, bestV;
        this.forEach(x => { let v = f(x); if (best === undefined || v < bestV) { best = x; bestV = v; } });
        return best;
    }],
    ["maxBy", function (f) {
        let best, bestV;
        this.forEach(x => { let v = f(x); if (best === undefined || v > bestV) { best = x; bestV = v; } });
        return best;
    }],
    ["toMap", function () { return this.reduce((m, e) => { m[e[0]] = e[1]; return m; }, {}); }],
]) {
    if (!Array.prototype[name]) Object.defineProperty(Array.prototype, name, {
        value: fn, enumerable: false, configurable: true, writable: true,
    });
}

function loadMissionHandler(store, costRate = 0.2) {
    const sent = [];
    const terminal = {
        cooldown: 0,
        store,
        send(resourceType, amount, roomName) {
            sent.push({ resourceType, amount, roomName });
            return 0;
        }
    };
    const context = {
        console,
        global: null,
        Game: {
            rooms: { W1N1: { my: true, terminal } },
            market: { calcTransactionCost: amount => Math.ceil(amount * costRate) }
        },
        Memory: {},
        RESOURCE_ENERGY: "energy",
        OK: 0
    };
    context.global = context;
    vm.runInNewContext(missionSource, context, { filename: "manager_missions.js" });
    return { sendRes: context.missionFunc.sendRes, sent };
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 1000, X: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "X", amount: 5000 };
    assert.equal(sendRes(data), true);
    assert.equal(sent[0].amount, 5000, "mineral amount must not be reduced by energy transaction cost");
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 600, X: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "X", amount: 5000 };
    assert.equal(sendRes(data), false);
    assert.equal(sent[0].amount, 3000, "mineral send must be capped by available transaction energy");
    assert.equal(data.amount, 2000);
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "energy", amount: 5000 };
    assert.equal(sendRes(data), false);
    assert.equal(sent[0].amount, 4166, "energy send must reserve energy for its own transaction cost");
    assert.ok(sent[0].amount + Math.ceil(sent[0].amount * 0.2) <= 5000);
}

// harvestMineralOuterKeeper 的「捡尸体 / 捡掉落物」收尾块写在 if/else 之外，
// 而 mineral / container 原本是 else 块里的 `let` —— 收尾块一执行就必然
// `ReferenceError: container is not defined`（线上实测 errorCount 4198，
// lastErrorTick 83308420）。下面直接在 VM 里跑一遍真实的模块源码：
// 旧实现会抛 ReferenceError，新实现必须跑通并真的调用 transfer/withdraw/pickup。
const stationSourcesSource = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

function loadMineralKeeper({ withContainer = true, harvestCode = 0 } = {}) {
    const calls = [];
    const mineral = { id: "m1", mineralType: "H", mineralAmount: 1000 };
    const container = {
        id: "c1",
        pos: { isEqualTo: () => true },
        hits: 100,
        hitsMax: 100,
        // 新版收尾块会检查容器剩余空间（store.getFreeCapacity() > 50），
        // mock 必须提供 store 才能走到 transfer/withdraw/pickup 分支。
        store: { getFreeCapacity: () => 500 },
    };
    const tombstone = { id: "t1", store: { energy: 500 } };
    const drop = { resourceType: "H", id: "d1" };

    const context = {
        console,
        OK: 0,
        // station_sources 顶层会读这两个全局（1040/1041 行），必须给上，
        // 否则 VM 加载阶段就抛 isSaveCpu is not defined。
        isSaveCpu: true,
        RESOURCE_ENERGY: "energy",
        FIND_TOMBSTONES: 4,
        FIND_DROPPED_RESOURCES: 6,
        StationMineral: { stationName: "stationMineral" },
        UtilsTask: { task: (target, taskName) => ({ id: target.id, taskName }) },
        Memory: {
            rooms: {
                W1N1: {
                    stationMineral: withContainer ? { id: "m1", container: "c1", resType: "H" } : { id: "m1", resType: "H" },
                },
            },
        },
        Game: {
            time: 1000,
            shard: { name: "shard3" },
            getObjectById: id => (id === "m1" ? mineral : id === "c1" ? container : null),
        },
        Creep: function () {},
    };
    context.global = context;
    vm.runInNewContext(stationSourcesSource, context, { filename: "station_sources.js" });

    const creep = {
        name: "k1",
        ticksToLive: 85,               // 85 % 17 == 0 && > 40 → 收尾块会执行
        room: { name: "W1N1" },
        store: { getUsedCapacity: () => 100 },
        pos: {
            isEqualTo: () => true,
            findInRange: type => ({ head: () => (type === 4 ? tombstone : drop) }),
        },
        headTask: () => ({ id: "m1", roomName: "W1N1" }),
        harvest: () => { calls.push(["harvest"]); return harvestCode; },
        transfer: (t, res) => { calls.push(["transfer", t && t.id, res]); return 0; },
        withdraw: (t, res) => { calls.push(["withdraw", t && t.id, res]); return 0; },
        pickup: t => { calls.push(["pickup", t && t.id]); return 0; },
        repair: t => { calls.push(["repair", t && t.id]); return 0; },
        goTo: () => calls.push(["goTo"]),
    };
    context.Creep.prototype.harvestMineralOuterKeeper.call(creep);
    return calls;
}

{
    const calls = loadMineralKeeper();
    assert.ok(calls.some(c => c[0] === "transfer" && c[1] === "c1" && c[2] === "H"),
        "mineral keeper must move its mineral into the container instead of throwing ReferenceError");
    assert.ok(calls.some(c => c[0] === "withdraw" && c[1] === "t1" && c[2] === "energy"),
        "mineral keeper must withdraw energy from a nearby tombstone");
    assert.ok(calls.some(c => c[0] === "pickup" && c[1] === "d1"),
        "mineral keeper must pick up a nearby dropped resource");
    // 体型只有 CARRY:4（200）：捡到的能量若不立刻卸进容器，会占满 store 让
    // harvest 永远 ERR_FULL，而 repair 在容器满血时倒不掉 —— 整只爬卡到老死。
    assert.ok(calls.some(c => c[0] === "transfer" && c[1] === "c1" && c[2] === "energy"),
        "energy looted by the mineral keeper must be offloaded into the container the same tick");
}

{
    // 容器被打掉（stationMineral 里没有 container）时不能抛 TypeError，也不能把 null
    // 交给 repair —— 收尾块整段跳过，harvest 照旧执行。
    const calls = loadMineralKeeper({ withContainer: false, harvestCode: -8 });
    assert.ok(calls.some(c => c[0] === "harvest"), "mineral keeper must still harvest when its container is gone");
    assert.ok(!calls.some(c => c[0] === "transfer" || c[0] === "repair"),
        "a missing container must be skipped, not passed to transfer/repair");
}

// buildConst 的叶子任务一旦指向「已经不存在的工地」，必须**先弹任务**再干别的：
// 拿 null 去调 this.build() 万一抛异常，异常被外层 runEach 吞掉，叶子任务永远弹不掉，
// 爬就顶着一条死任务原地不动（实测一只 worker 在 storage 边站了十几分钟）。
{
    const creepSource = fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8");
    const ctx = {
        console,
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_INVALID_TARGET: -7,
        WORK: "work", BUILD_POWER: 5, STRUCTURE_RAMPART: "rampart",
        Creep: function () {}, Memory: { creeps: {} }, Game: { time: 100, getObjectById: () => null },
        UtilsTask: { task: (t, name) => ({ taskName: name, id: t && t.id }), taskOutView: () => ({ taskName: "x" }) },
        StationUpgrade: { trySignController: () => false },
        PathFinder: { CostMatrix: function () { this.set = () => {}; this.get = () => 0; } },
        Room: function () {}, RoomPosition: function () {},
        FIND_CREEPS: 1, FIND_MY_CREEPS: 2, FIND_HOSTILE_CREEPS: 4, FIND_STRUCTURES: 3,
        FIND_CONSTRUCTION_SITES: 8, FIND_MY_CONSTRUCTION_SITES: 8, FIND_SOURCES: 9,
        RESOURCE_ENERGY: "energy", STRUCTURE_CONTAINER: "container", STRUCTURE_ROAD: "road",
        STRUCTURE_TOWER: "tower", STRUCTURE_LINK: "link", LOOK_STRUCTURES: "structures",
        LOOK_CONSTRUCTION_SITES: "constructionSite", CARRY: "carry", MOVE: "move",
        ATTACK: "attack", HEAL: "heal", RANGED_ATTACK: "ranged_attack", TOUGH: "tough",
        ERR_FULL: -8, ERR_NOT_ENOUGH_RESOURCES: -6, ERR_BUSY: -4, ERR_NOT_OWNER: -1,
        ERR_INVALID_ARGS: -10, ERR_NO_BODYPART: -12, ERR_NO_PATH: -2, ERR_TIRED: -11,
        DISMANTLE_POWER: 50, RANGED_ATTACK_POWER: 10, ATTACK_POWER: 30, HEAL_POWER: 12,
        RANGED_HEAL_POWER: 4, REPAIR_POWER: 100, HARVEST_POWER: 2, CARRY_CAPACITY: 50,
        RESOURCE_POWER: "power", PWR_OPERATE_STORAGE: 1, PWR_GENERATE_OPS: 2,
        BOOSTS: {},
        _: { values: o => Object.values(o || {}), keys: o => Object.keys(o || {}),
             head: a => (a && a.length ? a[0] : undefined), sum: a => (a || []).reduce((x, y) => x + y, 0) },
    };
    ctx.global = ctx;
    // 项目在游戏里由 utils.js 给 Array 挂了一堆 lodash 扩展，VM 里要补上
    vm.runInNewContext(`
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
Array.prototype.toMap = function () { return this.reduce((m, e) => { m[e[0]] = e[1]; return m; }, {}); };
Array.prototype.sum = function () { return this.reduce((a, b) => a + b, 0); };
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
`, ctx);
    vm.runInNewContext(creepSource, ctx, { filename: "prototype_creep.js" });

    const calls = [];
    const creep = {
        memory: { tasks: [{ taskName: "buildConst", id: "dead" }] },
        storeEmpty: () => false,
        getActiveBodyparts: () => 10,
        lastTaskObj: () => null,                       // ← 工地已被撤/被建好
        build: t => { calls.push(["build", t]); return ctx.ERR_INVALID_TARGET; },
        moveTo: () => 0,
        popTask() { calls.push(["pop"]); this.memory.tasks.pop(); return this; },
        execLastTask() { calls.push(["exec"]); return this; },
        addTask() { return this; },
    };
    ctx.Creep.prototype.buildConst.call(creep);
    assert.ok(calls.some(c => c[0] === "pop"), "missing target must pop the leaf task");
    assert.ok(!calls.some(c => c[0] === "build"), "must not call build() with a null target");
    assert.equal(creep.memory.tasks.length, 0, "the dead task must really be gone");
}

// ── StationTower：塔必须奶「本房受伤的爬」，包括从**外矿**带伤回城的 ──
//
// 0.78.38 为了省 CPU 把「扫描受伤 creep」改成只在**本房**最近 400 tick 内见过
// 敌人时才跑。判据是错的：外矿战斗全部发生在外矿房，主房的 lastHostileTimeMap
// 永远打不上，于是带伤回城的 keeper / 防守爬 / 搬运爬一只都奶不到（用户 10-04
// 报告）。现在改用 ManagerCreeps.init 每 tick 打好的 Game._injuredRoomTick[房名]。
const stationTowerSource = fs.readFileSync(path.join(root, "modules/station_tower.js"), "utf8");
function towerScene({ injured, markTick, lastHostileTime }) {
    const healed = [];
    const damaged = { name: "outer", hits: 100, hitsMax: 500 };
    const tower = { id: "t1", _used: false, heal: c => healed.push(c), attack: () => {}, repair: () => {} };
    const room = {
        name: "W33N55",
        memory: {},
        tower: [tower],
        getHostileCreeps: () => [],
        getStructures: () => [],
        hashCode: () => 1,                             // (100000+1)%3 != 0 → 不跑 safeMode
        find: (type, opts) => {
            if (type !== "FIND_MY_CREEPS") return [];
            const list = injured ? [damaged] : [];
            return opts && opts.filter ? list.filter(opts.filter) : list;
        },
    };
    const ctx = {
        console, global: null,
        Game: { time: 100000, getObjectById: () => null,
                _injuredRoomTick: markTick === undefined ? {} : { W33N55: markTick } },
        Memory: { rooms: { W33N55: {} } },
        Creep: function () {},
        StructureTower: function () {},
        FIND_MY_CREEPS: "FIND_MY_CREEPS", FIND_MY_POWER_CREEPS: "FIND_MY_POWER_CREEPS",
        LOOK_STRUCTURES: "structures", LOOK_CONSTRUCTION_SITES: "constructionSite",
        STRUCTURE_WALL: "constructedWall", STRUCTURE_RAMPART: "rampart", STRUCTURE_ROAD: "road",
        isCpuFeatureEnabled: () => false,
        StationDefense: { checkSafeMode: () => {} },
        Utils: { decodePosArray: () => [] },
        WarDamageCal: { calTowerDamage: () => 600 },
        _: { values: o => Object.values(o || {}), keys: o => Object.keys(o || {}) },
    };
    ctx.global = ctx;
    vm.runInNewContext(`
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
Array.prototype.minBy = function (fn) {
    let best, bestV;
    this.forEach(x => { let v = fn(x); if (best === undefined || v < bestV) { best = x; bestV = v; } });
    return best;
};
`, ctx);
    vm.runInNewContext(stationTowerSource, ctx, { filename: "station_tower.js" });
    if (lastHostileTime !== undefined) ctx.StationTower.lastHostileTimeMap.W33N55 = lastHostileTime;
    ctx.StationTower.update(room);
    ctx.StationTower.exec(room);
    return healed;
}

{
    // 外矿带伤回城：主房从没见过敌人（lastHostileTimeMap 为空），但 ManagerCreeps
    // 已经在本 tick 给「本房有受伤爬」打了标记 → 必须开奶
    const healed = towerScene({ injured: true, markTick: 100000 });
    assert.equal(healed.length, 1, "外矿战斗受伤后回城的爬必须被塔奶到（0.78.38 的判据漏掉了这一整类）");
}
{
    // 本房确实见过敌人 → 400 tick 窗口内照旧扫描（原行为保留）
    const healed = towerScene({ injured: true, lastHostileTime: 99950 });
    assert.equal(healed.length, 1, "本房刚打过 → 400 tick 窗口内继续奶");
}
{
    // 和平房、没受伤标记 → 一次全房 find 都不做（省 CPU 的初衷不能回退）
    const healed = towerScene({ injured: false, lastHostileTime: 90000 });
    assert.equal(healed.length, 0, "和平房不许开扫描");
}

console.log("recent regression checks passed");
