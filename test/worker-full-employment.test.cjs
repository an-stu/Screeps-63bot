/**
 * 「要么别生，生了必须全程工作」（用户 2026-11-07）——worker 空手出口链补全。
 *
 * 现场：E41S23 shard3_84111958_1（满 boost 30W 高级 worker）tasks 恒 []、
 * 0 能量、原地站桩。四条出路全关：hive 满 / 0 工地 / RCL8 不能升 /
 * 修墙被 storage 98,671 < 100,000 地板闸挡住（差 1,329）。
 *
 * 出口链补全（全在 workerManagerAfterCarrier 的空手分支，按优先级）：
 *   ① storage 取能（workerHasConsumer 有下家，11-03 语义不变）
 *   ② 无 carrier 时挖源（lowEnergyCarry，原样）
 *   ③ 填塔兜底：塔 <600 有缺口 → [fillRes, carryRes] 配对（栈 LIFO：先取能后填塔）
 *   ④ 源容器直运兜底：容器 >1200 且本 tick 未被 carrier 认领 → 取回后走
 *      loaded 分支的 fillAllMainRoomStorage 自动倒库
 *   ⑤ 空闲满 850 tick 且无任何出口 → recycleCreep 回收（动作自带 ttl<700 先
 *      unboost 回收化合物）。迟滞 850 保证从出生就闲的爬 ttl≤650<700 必命中
 *      unboost；豁免 repair 旗编制与「无 carrier 独苗」。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8")
    .replace(/\r\n/g, "\n");

function load(overrides = {}) {
    const ctx = {
        console,
        Memory: { rooms: {}, marketSettings: {} },
        Game: { time: 100000, rooms: {}, shard: { name: "shard3" }, cpu: { bucket: 10000 }, getObjectById: () => null },
        RESOURCE_ENERGY: "energy",
        FIND_MY_CREEPS: 1, FIND_CONSTRUCTION_SITES: 2, FIND_SOURCES: 3, FIND_MY_SPAWNS: 4,
        OK: 0, ERR_FULL: -8,
        StationHive: {
            HiveNeedToFill: room => room.energyAvailable < room.energyCapacityAvailable,
            generatorFillHiveTask: () => [{ taskName: "fillHive" }],
        },
        StationCarry: {
            generatorCarryStorageEnergyTask: room => [{ taskName: "carryRes", id: room.storage.id }],
        },
        StationSources: {
            stationName: "stationSources",
            generatorCarryEnergyTask: () => [],
        },
        StationTower: {
            generatorFillEnergyTasks: () => [],
        },
        StationWork: {
            constructionNeedBuild: room => room._hasBuild === true,
            generatorBuildTask: () => [{ taskName: "build" }],
        },
        StationDefense: {
            needBuildWallWorkerFree: room => room._wallFree === true,
            generatorRepairTask: () => [{ taskName: "repairWall" }],
        },
        StationUpgrade: {
            generatorUpgradeTask: () => [{ taskName: "upgradeKeeper" }],
        },
        StationLab: { boostAbleLevel: () => -1 },
        UtilsTask: {
            task: (obj, taskName, regFun, ops) => Object.assign({ taskName, id: obj && obj.id }, ops || {}),
            taskData: (taskName) => ({ taskName }),
        },
        ...overrides,
    };
    ctx.global = ctx;
    vm.runInNewContext(raw, ctx, { filename: "strategy_highLevel.js" });
    assert.ok(ctx.global.StrategyHighLevel, "StrategyHighLevel 未导出");
    return ctx.global.StrategyHighLevel;
}

function mkStore(obj) {
    return {
        ...obj,
        getUsedCapacity(res) {
            if (res === undefined) return Object.keys(obj).reduce((a, k) => a + obj[k], 0);
            return obj[res] || 0;
        },
    };
}

function mkCreep({ store = {}, ttl = 1200 } = {}) {
    const creep = {
        memory: { role: "worker", tasks: [] },
        store: mkStore(store),
        ticksToLive: ttl,
        pos: { x: 0, y: 0, toString: () => "40,33" },
        _dumped: false,
        isFree() { return !this.memory.tasks.length; },
        storeEmpty() { return this.store.getUsedCapacity() === 0; },
        mainRoom() { return this.homeRoom; },
        addTask(t) {
            const ls = Array.isArray(t) ? t : [t];
            ls.forEach(e => this.memory.tasks.push(e));
        },
        fillAllMainRoomStorage() {
            this._dumped = true;
            this.memory.tasks.push({ taskName: "fillRes", id: this.mainRoom().storage.id });
        },
    };
    return creep;
}

/**
 * E41S23 现场：RCL8、hive 满、无工地、修不起墙。creeps(role) 按角色分桶，
 * _fillTowerTasks 模拟 carrierManager 的同 pass 缓存。
 */
function mkRoom({ workers, carriers = [], storageEnergy = 98671, fillTowerTasks, flags } = {}) {
    const storage = { id: "stor", store: mkStore({ energy: storageEnergy }) };
    const room = {
        name: "E41S23",
        level: 8,
        energyAvailable: 12900,
        energyCapacityAvailable: 12900,
        storage,
        terminal: { id: "term", store: mkStore({ energy: 1778 }) },
        controller: { level: 8 },
        _hasBuild: false,
        _wallFree: false,
        _workers: workers,
        _carriers: carriers,
        creeps(role) { return role === "carrier" ? this._carriers : this._workers; },
        flags() { return flags || []; },
        isDownGrade() { return false; },
        getEnergyAvailable() { return 12900; },
        getEnergyCapacityAvailable() { return 12900; },
    };
    if (fillTowerTasks !== undefined) room._fillTowerTasks = fillTowerTasks;
    workers.forEach(c => { c.homeRoom = room; });
    return room;
}

{   // ── ① 塔有缺口 → [fillRes, carryRes] 配对，栈顶（最后 add）是取能 ──────
    const High = load();
    const w = mkCreep({});
    const room = mkRoom({
        workers: [w],
        fillTowerTasks: [[{ taskName: "fillRes", id: "tw1" }]],
    });
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 2, "塔缺口+storage 有货：应为 [fillRes, carryRes] 配对，实得 "
        + JSON.stringify(w.memory.tasks));
    assert.equal(w.memory.tasks[0].taskName, "fillRes");
    assert.equal(w.memory.tasks[0].id, "tw1");
    assert.equal(w.memory.tasks[1].taskName, "carryRes", "栈顶必须是取能任务（LIFO：先取能后填塔）");
    assert.equal(w.memory.idleSince, undefined, "拿到活必须清空闲计时");
}

{   // ── ② 无任何出口 → 只盖 idleSince，不派活 ─────────────────────────────
    const High = load();
    const w = mkCreep({});
    const room = mkRoom({ workers: [w], fillTowerTasks: [] });
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 0, "无任何出口时不派活（只记空闲）");
    assert.equal(w.memory.idleSince, 100000, "首次空闲要盖 idleSince 时间戳");
}

{   // ── ③ 容器积压 → 直运 carryRes，门槛显式 1200 ─────────────────────────
    const High = load({
        StationSources: {
            stationName: "stationSources",
            generatorCarryEnergyTask: (room, min) => [{ taskName: "carryRes", id: "cont1", min }],
        },
    });
    const w = mkCreep({});
    // 必须有 carrier：无 carrier 时既有的 lowEnergyCarry（500 门槛）会先接走，
    // 这本身就是出口链优先级 ② 在 ④ 之前的证明
    const room = mkRoom({ workers: [w], carriers: [mkCreep({})], fillTowerTasks: [] });
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 1, "容器积压时应派直运 carryRes，实得 "
        + JSON.stringify(w.memory.tasks));
    assert.equal(w.memory.tasks[0].id, "cont1");
    assert.equal(w.memory.tasks[0].min, 1200, "直运门槛必须显式传 1200（与 carrier 派车门槛互补）");
    assert.equal(w.memory.idleSince, undefined, "拿到活必须清空闲计时");
}

{   // ── ④ 空闲满 850 tick + 有 carrier 接班 → 回收 ────────────────────────
    const High = load();
    const w = mkCreep({});
    w.memory.idleSince = 100000 - 900;
    const room = mkRoom({
        workers: [w, mkCreep({})],
        carriers: [mkCreep({ store: { energy: 100 } })],
    });
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 1, "空闲 900 tick 且有 carrier 接班：应回收，实得 "
        + JSON.stringify(w.memory.tasks));
    assert.equal(w.memory.tasks[0].taskName, "recycleCreep");
}

{   // ── ⑤ 豁免一：repair 旗编制（用户明确要人）不回收 ─────────────────────
    const High = load();
    const w = mkCreep({});
    w.memory.idleSince = 100000 - 900;
    const room = mkRoom({
        workers: [w, mkCreep({})],
        carriers: [mkCreep({ store: { energy: 100 } })],
        flags: [{ name: "repairE41S23" }],
    });
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 0, "有 repair 旗不许回收（旗子编制要人）");
    assert.equal(w.memory.idleSince, 100000 - 900, "未回收时空闲计时保留");
}

{   // ── ⑥ 豁免二：无 carrier 且是唯一 worker（bootstrap 独苗）不回收 ──────
    const High = load();
    const w = mkCreep({});
    w.memory.idleSince = 100000 - 900;
    const room = mkRoom({ workers: [w], carriers: [] });
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 0, "独苗 worker 不许回收（空房自杀）");
}

{   // ── ⑦ 未满 850 tick 迟滞：不回收 ─────────────────────────────────────
    const High = load();
    const w = mkCreep({});
    w.memory.idleSince = 100000 - 100;
    const room = mkRoom({
        workers: [w, mkCreep({})],
        carriers: [mkCreep({ store: { energy: 100 } })],
    });
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 0, "空闲 100 tick 仍在迟滞窗口内，不回收");
}

{   // ── ⑧ 有下家照常取货（11-03 语义不受兜底链影响）──────────────────────
    const High = load();
    const w = mkCreep({});
    const room = mkRoom({ workers: [w], carriers: [mkCreep({})] });
    room._hasBuild = true;  // workerHasConsumer 里的 constructionNeedBuild 命中
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 1, "有下家必须照常取货");
    assert.equal(w.memory.tasks[0].taskName, "carryRes");
}

{   // ── ⑩ 修墙配对（0.78.220）：取能 + 修墙一次压栈，取完无缝接修 ─────────
    // 现场：E55S31 worker 修完一车站桩等下个经济 pass（bucket<5000 时长达
    // 14 tick）才拿到下一个 repairWall —— 用户看到的「又在挂机」。
    const High = load();
    const w = mkCreep({});
    const room = mkRoom({ workers: [w], carriers: [mkCreep({})], fillTowerTasks: [] });
    room._wallFree = true;  // workerHasConsumer 经 needBuildWallWorkerFree 命中（缺口存在）
    High.workerManagerAfterCarrier(room);
    assert.equal(w.memory.tasks.length, 2, "墙缺口 + storage 有货 ⇒ [repairWall, carryRes] 配对，实得 "
        + JSON.stringify(w.memory.tasks));
    assert.equal(w.memory.tasks[0].taskName, "repairWall", "栈底是修墙（取完弹栈即接上）");
    assert.equal(w.memory.tasks[1].taskName, "carryRes", "栈顶是取能（LIFO 先执行）");
}

{   // ── ⑨ 源码 pin：出口链顺序、栈配对、迟滞、豁免、carrier 缓存 ──────────
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const iFetch = code.indexOf("pro.workerHasConsumer(room, creep)");
    const iTower = code.indexOf("creep.addTask(towerFillTasks.shift())");
    const iShuttle = code.indexOf("creep.addTask(idleShuttleTasks.pop())");
    const iRecycle = code.indexOf("creep.addTask([UtilsTask.taskData(\"recycleCreep\")])");
    assert.ok(iFetch > 0 && iTower > iFetch && iShuttle > iTower && iRecycle > iShuttle,
        "空手出口链必须是 取能→挖源→填塔→直运→回收 的优先级顺序");
    // LIFO 配对：塔分支里先压 fillRes 后压 carryRes（后 add 先执行）
    const towerBranch = code.slice(iTower, iTower + 240);
    assert.ok(towerBranch.indexOf("creep.addTask(StorageCarryEnergyTasks)") > 0,
        "填塔兜底必须配对取能任务（先压填塔、后压取能 ⇒ 栈顶先取能）");
    assert.ok(code.includes("room._fillTowerTasks = fillTowerTasks"),
        "carrierManager 必须把塔任务缓存到 room._fillTowerTasks 供 worker 复用");
    assert.ok(code.includes("Game.time - creep.memory.idleSince < 850"),
        "回收必须有 850 tick 迟滞（防 storage 地板闸震荡抖动 + 保证 unboost 命中）");
    assert.ok(code.includes('room.flags("repair").length'),
        "回收必须豁免 repair 旗编制");
    assert.ok(code.includes('!room.creeps("carrier").length && room.creeps("worker").length <= 1'),
        "回收必须豁免无 carrier 的独苗 worker");
    assert.ok(code.includes("if (!creep.isFree()) delete creep.memory.idleSince;"),
        "拿到活必须清 idleSince（不清则计时永不归零，一发空闲就永久挂账）");
}

console.log("worker-full-employment: passed");
