/**
 * 容器清理：**非矿物容器只该装能量**（用户 2026-10-16）。
 *
 * 现场实测 10 个容器混装，来源三类：强化化合物 GO/KO/ZH/UH/OH（boost 残留）、
 * biomass（deposit 残留）、power（powerBank 收回来）。要求：搬回 storage；
 * source 旁边的容器只留能量。**矿物容器豁免**（矿物本来就该在那儿等运矿车）。
 *
 * 用 VM 跑真实模块源码，负对照：把矿物容器豁免去掉 / 把非能量过滤去掉，断言必须失败。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "modules", name), "utf8");

function makeContext() {
    const ctx = {
        console: { log() {} },
        Memory: {},
        isSaveCpu: true,
        MIN_CPU: false,
        RESOURCE_ENERGY: "energy",
        RESOURCE_POWER: "power",
        RESOURCE_OPS: "ops",
        OK: 0,
        FIND_STRUCTURES: 110,
        STRUCTURE_CONTAINER: "container",
        Game: { time: 100000, shard: { name: "shard3" } },
        // lodash 的两三个方法就够
        _: {
            keys: o => Object.keys(o || {}),
            values: o => Object.keys(o || {}).map(k => o[k]),
            filter: (arr, fn) => arr.filter(fn),
        },
        // 只桩到 cleanDirtyContainers 跑得到的程度
        StationHive: {}, StationCarry: {}, StationSources: {}, StationWork: {}, StationLab: {},
        StationDefense: {}, StationFactory: {}, ManagerCreeps: {}, ManagerFlags: {},
        ManagerAutoPlanner: {}, ManagerRooms: {}, StationMinetral: {}, StationUpgrade: {},
        StationTower: {}, HelperError: { catchError: fn => fn(), runEach: () => {} },
        HelperCpuUsed: {}, StrategyMarket: {}, global: null,
        StationMineral: { stationName: "stationMineral" },
        UtilsTask: {
            task: (obj, taskName, register, data) => ({ obj, taskName, register, data }),
            taskData: (taskName, data) => ({ taskName, data }),
        },
    };
    ctx.global = ctx;
    vm.runInNewContext(read("strategy_highLevel.js"), ctx, { filename: "strategy_highLevel.js" });
    return ctx;
}

function makeContainer(id, store, x = 10, y = 10) {
    return { id, structureType: "container", pos: { x, y }, store };
}

function makeCarrier(name = "c1") {
    const calls = [];
    return {
        name, calls,
        addTask(t) { calls.push(...[].concat(t)); return this; },
        fillAllMainRoomStorage() { calls.push("fillAllMainRoomStorage"); return this; },
    };
}

function makeRoom({ containers = [], mineralContainer = undefined, storageFree = 100000 } = {}) {
    return {
        name: "E41S32",
        memory: mineralContainer ? { stationMineral: { container: mineralContainer, resType: arguments[0].mineralRes } } : {},
        storage: { store: { getFreeCapacity: () => storageFree } },
        find(type, opts) { return containers.filter(c => opts.filter(c)); },
    };
}

{
    // ① 源旁容器混了强化化合物 ⇒ 只 withdraw 非能量，然后灌进 storage
    const ctx = makeContext();
    const dirty = makeContainer("cA", { energy: 775, GO: 497, KO: 102 });
    const carrier = makeCarrier();
    ctx.StrategyHighLevel.cleanDirtyContainers(makeRoom({ containers: [dirty] }), [carrier]);

    const kinds = carrier.calls.filter(c => c && c.taskName === "carryRes");
    assert.equal(kinds.length, 2, "应该只对两种非能量资源各排一个 carryRes");
    assert.deepEqual(kinds.map(k => k.data.resType).sort(), ["GO", "KO"], "不能把能量也搬走");
    assert.ok(kinds.every(k => k.obj === dirty), "任务目标是那个脏容器");
    assert.equal(carrier.calls[carrier.calls.length - 1], "fillAllMainRoomStorage", "取完要倒进 storage");
}

{
    // ② 矿物容器：**只豁免它自己那种矿物**，别的照样要搬
    const ctx = makeContext();
    const mineral = makeContainer("cM", { O: 537 });
    const carrier = makeCarrier();
    const room = makeRoom({ containers: [mineral], mineralContainer: "cM", mineralRes: "O" });
    ctx.StrategyHighLevel.cleanDirtyContainers(room, [carrier]);
    assert.equal(carrier.calls.length, 0, "矿物容器里属于自己的矿物必须豁免（在那儿等运矿车）");

    // ②b 同一个矿物容器里混了别的东西（实测 E49S31 的 power / W31N55 的 GH）⇒ 仍要搬
    const ctx2 = makeContext();
    const mixed = makeContainer("cM", { O: 537, power: 100, GH: 25 });
    const carrier2 = makeCarrier();
    const room2 = makeRoom({ containers: [mixed], mineralContainer: "cM", mineralRes: "O" });
    ctx2.StrategyHighLevel.cleanDirtyContainers(room2, [carrier2]);
    const kinds = carrier2.calls.filter(c => c && c.taskName === "carryRes").map(c => c.data.resType).sort();
    assert.deepEqual(kinds, ["GH", "power"], "矿物容器里的非本行矿物仍要搬走，本行矿物(O)留着");
}

{
    // ③ 只有能量的容器：不动，且把 carrier 还回池子
    const ctx = makeContext();
    const clean = makeContainer("cC", { energy: 900 });
    const carrier = makeCarrier();
    const pool = [carrier];
    ctx.StrategyHighLevel.cleanDirtyContainers(makeRoom({ containers: [clean] }), pool);
    assert.equal(carrier.calls.length, 0, "干净容器不该派活");
    assert.equal(pool.length, 1, "没活儿时 carrier 要还回池子（不能被吞掉）");
}

{
    // ④ 没有空闲 carrier：什么都不做，也不能炸
    const ctx = makeContext();
    const dirty = makeContainer("cA", { energy: 10, biomass: 593 });
    ctx.StrategyHighLevel.cleanDirtyContainers(makeRoom({ containers: [dirty] }), []);
    // 没有断言目标，跑通即代表没抛异常
}

{
    // ⑤ storage 满了：不派活（搬过去也没地方放）
    const ctx = makeContext();
    const dirty = makeContainer("cA", { energy: 10, power: 100 });
    const carrier = makeCarrier();
    ctx.StrategyHighLevel.cleanDirtyContainers(
        makeRoom({ containers: [dirty], storageFree: 0 }), [carrier]);
    assert.equal(carrier.calls.length, 0, "storage 满 ⇒ 先别搬");
}

{
    // ⑥ 源码层面：调用点必须挂上（只测函数抓不到「函数在、但没人调」）
    const codeOnly = read("strategy_highLevel.js")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/pro\.cleanDirtyContainers\(room, freeCarries\);/.test(codeOnly),
        "carrier 调度里必须调用 cleanDirtyContainers");
}

console.log("container cleanup checks passed");
