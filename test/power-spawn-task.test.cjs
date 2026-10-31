/**
 * powerSpawn 的补料任务表**不能只有 fillAllTask**（2026-11-01 W32N56 实测）。
 *
 * 现场：W32N56（烧 power 试点房）全房只剩 1 只 carrier，它在 (15,41) 钉了 40+ 分钟
 * （能量恒 0、ttl 一直往下掉），任务栈恒为 `["fillPowerSpawnContinuous"]`。
 * 连锁后果：hub link 卡在 776 没人搬 ⇒ 两个矿点的 link 800/800 + 容器 2000/2000 全满
 * ⇒ keeper 满仓只能往地上倒 ⇒ 地面 8/tick 在涨、约 16/tick 被衰减掉。
 *
 * 根因：`generatorFillPowerSpawnTask` 的入口闸门用 `powerNeed >= fastCarry`，
 * 而下面生成取货任务用的是 `powerNeed > fastCarry`（松一格）。powerSpawn 缺 70 power
 * （正好一格运力）、能量只缺 200 时：闸门放行、一条取货任务都不生成、只 unshift 一个
 * `fillAllTask`。空手爬执行 fillAllTask 立刻 popTask（prototype_creep.js:760），
 * 下一 tick `fillPowerSpawnContinuous` 又生成一次 ⇒ 无限循环、永不取货、永不释放。
 *
 * 这里验：
 *   ① 退化输入（缺 70 power / 缺 200 能量）⇒ 返回空表（让调用方 popTask 把爬放出去）
 *   ② 真缺口（缺 100 power / 缺 3000 能量）⇒ 有 fillAllTask 且**必须有取货任务**
 *   ③ 不变量：只要表里有 fillAllTask，就必须至少有一条 carryRes（否则就是那类退化表）
 *   ④ 源码断言：fillAllTask 的 unshift 必须在 `if (carries.length)` 里面
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "station_carry.js"), "utf8");

function makeCtx(marketSettings) {
    const ctx = {
        console,
        Memory: { marketSettings },
        Game: { time: 100000, rooms: {}, creeps: {} },
        Creep: { prototype: {} },
        RESOURCE_ENERGY: "energy",
        RESOURCE_POWER: "power",
        RESOURCE_OPS: "ops",
        RESOURCE_GHODIUM: "G",
        RESOURCE_UTRIUM: "U",
        RESOURCE_LEMERGIUM: "L",
        RESOURCE_KEANIUM: "K",
        RESOURCE_ZYNTHIUM: "Z",
        RESOURCE_CATALYST: "X",
        RESOURCE_OXYGEN: "O",
        RESOURCE_HYDROGEN: "H",
        STRUCTURE_LINK: "link",
        STRUCTURE_CONTAINER: "container",
        STRUCTURE_STORAGE: "storage",
        STRUCTURE_TERMINAL: "terminal",
        FIND_TOMBSTONES: 5,
        FIND_RUINS: 6,
        FIND_DROPPED_RESOURCES: 7,
        PWR_OPERATE_POWER: 5,
        OK: 0,
        StorageCarryEnergyTasks: [],
        UtilsTask: {
            task(obj, taskName, regFun, ops) {
                return Object.assign({ taskName, id: obj.id, regFun }, ops || {});
            },
        },
        StationSources: { stationName: "stationSources" },
        StationUpgrade: { stationName: "stationUpgrade" },
        StationMinetral: { stationName: "stationMineral" },
        StationFactory: {},
        StationHive: {},
        ManagerRooms: {},
        HelperError: { catchError: fn => fn() },
    };
    ctx.global = ctx;
    vm.runInNewContext(raw, ctx, { filename: "station_carry.js" });
    return ctx;
}

/** 假 store：既要能按资源读，也要能被 roomMassStoreCnt 用 getUsedCapacity 查 */
function mkStore(obj, cap) {
    return {
        ...obj,
        getUsedCapacity(res) {
            if (res === undefined) return Object.keys(obj).reduce((a, k) => a + obj[k], 0);
            return obj[res] || 0;
        },
        getFreeCapacity(res) {
            if (res === undefined) return cap - this.getUsedCapacity();
            return cap - (obj[res] || 0);
        },
        isEmpty() { return this.getUsedCapacity() === 0; },
        isFull() { return this.getFreeCapacity() === 0; },
    };
}

function mkRoom({ spawnEnergy, spawnPower, storageEnergy, powerStock = 6000 }) {
    const room = {
        name: "W32N56",
        level: 8,
        used: {},
        storage: { id: "stor1", store: mkStore({ energy: storageEnergy }, 1000000) },
        terminal: { id: "term1", store: mkStore({ energy: 50000, power: powerStock }, 300000) },
        powerSpawn: {
            id: "ps1",
            store: mkStore({ energy: spawnEnergy, power: spawnPower }, 5000),
            processPower() { room._processed = (room._processed || 0) + 1; return 0; },
        },
    };
    // powerSpawn 的 power 容量是 100，能量 5000 —— 上面的 mkStore 只有一个 cap，
    // 这里补一个按资源区分的 getFreeCapacity 覆盖（真实实现就是这么算的）。
    room.powerSpawn.store.getFreeCapacity = function (res) {
        if (res === "power") return 100 - spawnPower;
        if (res === "energy") return 5000 - spawnEnergy;
        return 300000;
    };
    return room;
}

const flatten = list => list.reduce((a, x) => a.concat(Array.isArray(x) ? flatten(x) : [x]), []);
const names = list => flatten(list).map(t => t && t.taskName);

{
    // ── ① 退化输入：缺 70 power（= fastCarry）+ 缺 200 能量 → 什么都不该生成
    const ctx = makeCtx({ powerBurning: true });
    const room = mkRoom({ spawnEnergy: 4800, spawnPower: 30, storageEnergy: 49123 });
    const out = ctx.StationCarry.generatorFillPowerSpawnTask(room, true);
    assert.deepEqual(
        names(out), [],
        "没有取货任务时不能只派一个 fillAllTask（空手爬会无限 pop/重派，把爬钉死）"
    );

    // ── ② 真缺口：缺 100 power + 缺 3000 能量 → 必须有取货任务 + fillAllTask
    const room2 = mkRoom({ spawnEnergy: 2000, spawnPower: 0, storageEnergy: 49123 });
    const out2 = ctx.StationCarry.generatorFillPowerSpawnTask(room2, true);
    const n2 = names(out2);
    assert.ok(n2.includes("fillAllTask"), "真缺口时仍然要派 fillAllTask：" + JSON.stringify(n2));
    assert.ok(
        n2.filter(x => x === "carryRes").length >= 1,
        "真缺口必须有 carryRes 取货任务：" + JSON.stringify(n2)
    );
    assert.equal(n2[0], "fillAllTask", "fillAllTask 要排在最前（最后执行）");

    // ── ③ 不变量：fillAllTask ⇒ 至少一条 carryRes（就是这次的退化形态）
    [[4800, 30], [2000, 0], [4990, 99], [4200, 40]].forEach(([e, p]) => {
        const r = mkRoom({ spawnEnergy: e, spawnPower: p, storageEnergy: 49123 });
        const n = names(ctx.StationCarry.generatorFillPowerSpawnTask(r, true));
        if (n.includes("fillAllTask")) {
            assert.ok(
                n.filter(x => x === "carryRes").length >= 1,
                `powerSpawn ${e}/${p}：有 fillAllTask 就必须有 carryRes，实得 ${JSON.stringify(n)}`
            );
        }
    });
}

{
    // ── ④ 源码断言：unshift(fillAllTask) 必须在 if (carries.length) 之内
    const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    const idx = code.indexOf('"fillAllTask", "registerUsed"');
    assert.ok(idx > 0, "找不到 fillAllTask 的生成点");
    const guard = code.lastIndexOf("if (carries.length)", idx);
    assert.ok(guard > 0, "fillAllTask 必须被 if (carries.length) 守卫");
    const between = code.slice(guard, idx);
    assert.ok(
        between.length < 400 && !between.includes("}\n            }"),
        "守卫与 fillAllTask 之间不能有闭合块（否则守卫不覆盖它）"
    );
}

console.log("power-spawn-task: passed");
