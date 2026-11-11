/**
 * 灌料闸门必须与烧制闸门同源（2026-11-10，0.78.229）。
 *
 * 现场（W33N53 / W33N55，非试点房）：
 *   · W33N53 storage 能量 168,694、powerSpawn 能量 31→1,181 反复、power 57
 *   · W33N55 storage 能量 168,762、powerSpawn 能量 **1**、power 59
 *   · 两房 roomMassStoreCnt(power) 都 ≈ 5,905（差 100 不到 6,000）
 *
 * `tryProcessPower` 的开闸线是 `powerSpawnOpenEnergy`（缺省 floor+50000 = 15 万），
 * 而 `generatorFillPowerSpawnTask` 的非试点分支写死 `energyCnt > 170000`。
 * 落进 15~17 万死区的房间会「被授权烧制、却不给补料」：5,000 能量缓冲烧完
 * （buffer 恰好 100 tick × 50/tick）就归零，processPower 需要 ≥50 能量 ⇒ 每 tick 白调；
 * storage 又永远翻不过 17 万 ⇒ 两只闸互锁、永久停摆。
 *
 * 这里验：
 *   ① 非试点房 168,000 能量（≥15 万、<17 万）⇒ **必须**有补料任务（旧代码返回空表）
 *   ② 负对照：145,000（< 烧制开闸线）⇒ 空表（不许把低能量房也灌满）
 *   ③ 旋钮同源：powerSpawnOpenEnergy=200000 ⇒ 168,000 空表；=160000 ⇒ 165,000 有任务
 *   ④ 源码断言：station_carry.js 里不许再出现写死的 170000 灌料线
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

/**
 * 非试点房（W33N53）：powerSpawn 能量缓冲已烧掉大半，power 还剩 57。
 * storagePower 2,905 + terminalPower 3,000 = 5,905 —— 与现场一致。
 */
function mkOuterRoom({ storageEnergy, spawnEnergy = 100, spawnPower = 57, storagePower = 2905, terminalPower = 3000 }) {
    const room = {
        name: "W33N53",
        level: 8,
        used: {},
        storage: { id: "stor1", store: mkStore({ energy: storageEnergy, power: storagePower }, 5000000) },
        terminal: { id: "term1", store: mkStore({ energy: 50000, power: terminalPower }, 300000) },
        powerSpawn: {
            id: "ps1",
            store: mkStore({ energy: spawnEnergy, power: spawnPower }, 5000),
            processPower() { room._processed = (room._processed || 0) + 1; return 0; },
        },
    };
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
    // ── ① 死区 168,000：旧代码（>170000）返回空表，新代码必须有补料任务
    const ctx = makeCtx({});
    const room = mkOuterRoom({ storageEnergy: 168000 });
    const n = names(ctx.StationCarry.generatorFillPowerSpawnTask(room, true));
    assert.ok(
        n.includes("fillAllTask"),
        "storage 16.8 万（≥烧制开闸线 15 万）必须给 powerSpawn 补料：" + JSON.stringify(n)
    );
    assert.ok(
        n.includes("carryRes"),
        "补料必须带取货任务（空表/只有 fillAllTask 都会让爬白跑）：" + JSON.stringify(n)
    );

    // ── ② 负对照：145,000 在烧制开闸线下方 ⇒ 不许灌料
    const low = mkOuterRoom({ storageEnergy: 145000 });
    assert.deepEqual(
        names(ctx.StationCarry.generatorFillPowerSpawnTask(low, true)), [],
        "storage 14.5 万（< 开闸线 15 万）不该灌料"
    );

    // ── ③ 旋钮同源：改 powerSpawnOpenEnergy 必须同时改灌料行为
    const hi = makeCtx({ powerSpawnOpenEnergy: 200000 });
    assert.deepEqual(
        names(hi.StationCarry.generatorFillPowerSpawnTask(mkOuterRoom({ storageEnergy: 168000 }), true)), [],
        "开闸线抬到 20 万后，16.8 万不该灌料（说明两侧读的是同一个旋钮）"
    );
    const lo = makeCtx({ powerSpawnOpenEnergy: 160000 });
    assert.ok(
        names(lo.StationCarry.generatorFillPowerSpawnTask(mkOuterRoom({ storageEnergy: 165000 }), true))
            .includes("fillAllTask"),
        "开闸线降到 16 万后，16.5 万就该灌料"
    );

    // ── ④ 试点房分支不受影响：wantBurn（powerBurning 运行时状态）走自己的 30k 门槛
    const burnCtx = makeCtx({ powerBurning: true });
    const burn = mkOuterRoom({ storageEnergy: 40000, spawnEnergy: 0, spawnPower: 0 });
    burn.name = "W32N56";
    const nb = names(burnCtx.StationCarry.generatorFillPowerSpawnTask(burn, true));
    assert.ok(
        nb.includes("fillAllTask") && nb.includes("carryRes"),
        "试点房（W32N56）烧制窗口内 4 万能量仍要补料：" + JSON.stringify(nb)
    );
}

{
    // ── ⑤ 源码断言：灌料线不许再写死 170000（剥注释后再查，负对照靠行为）
    const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(
        !code.includes("170000"),
        "灌料闸门不许留写死的 170000（必须与 tryProcessPower 的 floor+50000 同源）"
    );
    assert.ok(
        code.includes("energyCnt >= openC"),
        "灌料闸门必须用与烧制同源的 openC"
    );
    assert.ok(
        code.includes("floorC + 50000"),
        "openC 的缺省值必须与 tryProcessPower 的 floor+50000 一致"
    );
}

{
    // ── ⑥ power 口径同源（0.78.237）：storage 20 万、全房 power 只剩 500。
    //   烧制侧照样烧（`tryProcessPower` 只要 power > powerSpawnLow=100，
    //   `StrategyHighLevel.processPowerSpawn` 只要 ps 里有 ≥1 power），
    //   旧灌料闸却写死 `powerCnt > 1000` ⇒ 烧空 100 power 库存后永久饿死。
    const ctx = makeCtx({});
    const lowPower = mkOuterRoom({ storageEnergy: 200000, storagePower: 500, terminalPower: 0 });
    const n = names(ctx.StationCarry.generatorFillPowerSpawnTask(lowPower, true));
    assert.ok(
        n.includes("fillAllTask") && n.includes("carryRes"),
        "storage 20 万 + 全房 power 500：烧制闸开着就必须给 powerSpawn 补料：" + JSON.stringify(n)
    );

    // ── ⑦ 负对照（行为，不是源码）：全房 power = 0 ⇒ 没有可烧的东西，不许灌料
    const noPower = mkOuterRoom({ storageEnergy: 200000, storagePower: 0, terminalPower: 0, spawnPower: 0 });
    assert.deepEqual(
        names(ctx.StationCarry.generatorFillPowerSpawnTask(noPower, true)), [],
        "全房 power = 0 时灌料毫无意义（负对照必须因行为失败）"
    );

    // ── ⑧ 源码断言：clause1 不许再把 power 下限写死在 1000
    const code2 = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(
        !/powerCnt\s*>\s*1000/.test(code2),
        "灌料闸门的 power 下限不许高于烧制闸（0.78.229 的能量叉子换个字段又长出来了）"
    );
    assert.ok(
        code2.includes("energyCnt >= openC && powerCnt > 0"),
        "能烧 ⇒ 必能补：clause1 必须是 energyCnt >= openC && powerCnt > 0"
    );
}

console.log("power-spawn-fill-gate: passed");
