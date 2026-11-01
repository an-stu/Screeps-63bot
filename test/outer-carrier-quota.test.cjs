/**
 * 外矿补员配额的分母必须是**本房实际孵得出的体型**运力。
 *
 * 现场（2026-11-01 W26N59，出兵房 W26N58）：
 *   storage 0 / terminal 26,898 ⇒ `outerMineStarvesSpawnRoom(=carrier)` 判真，
 *   此时唯一还能补员的路径是「按存货配额豁免」，而配额写死按满编一趟 1,700 折：
 *     容器 2000/2000 + 容器格溢出 ⇒ floor(2000/1700) = **1 只/矿点**
 *   可这个 RCL6 房被 `min(floor(hiveCap*0.5), ...)` 夹到预算 1,150，实孵的是
 *   `{2 WORK, 12 CARRY, 7 MOVE}` = **600 运力**（修路版），另一版也只有 700。
 *   ⇒ 1 只 600 的车对 13.3/tick 产出、114 tick 往返，吞吐只有 5.3/tick，
 *     容器永远满、keeper 手里 50 能量塞不下、源只出 10/tick（应 26.7）。
 *     `__outerWhy=starves+mineQ1>=1@27,29` 就是这个自锁。
 *
 * 修法：配额分母改用 `outerCarrierTripCapacity(spawnRoom)` —— 按真实体型算，
 * 并以满编 1,700 封顶。**负对照**：把分母改回常量 1,700，本文件的第 ② 组必须失败。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "modules", name), "utf8");

const CONSTANTS = {
    OK: 0, ERR_NOT_IN_RANGE: -9, RESOURCE_ENERGY: "energy",
    CARRY: "carry", MOVE: "move", WORK: "work", TOUGH: "tough",
    BODYPART_COST: { move: 50, work: 100, carry: 50, attack: 80, heal: 250, tough: 10, claim: 600 },
    STRUCTURE_CONTAINER: "container",
    LOOK_RESOURCES: "resource",
};

function makeContext() {
    const ctx = Object.assign({
        console,
        isSaveCpu: true,
        Memory: { rooms: {}, marketSettings: {} },
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null, creeps: {}, rooms: {} },
        Room: { Terrain: function () { this.get = () => 0; } },
        RoomPosition: function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
        StationCarry: { stationName: "stationCarry" },
        StationMineral: { stationName: "stationMineral" },
        StationUpgrade: { stationName: "stationUpgrade" },
        _: { values: o => Object.keys(o || {}).map(k => o[k]), keys: o => Object.keys(o || {}) },
        StationHive: { trySpawn: () => undefined },
        ManagerCreeps: {
            calcBodyPart: spec => {
                const parts = [];
                (Array.isArray(spec) ? spec : Object.keys(spec).map(k => [k, spec[k]]))
                    .forEach(([part, n]) => { for (let i = 0; i < n; i++) parts.push(part); });
                return parts;
            },
        },
        ManagerFlags: { getFlagsByPrefix: () => [] },
        HelperError: { catchError: fn => fn() },
        UtilsTask: {
            task(obj, taskName, regFun, ops = {}) {
                const t = { taskName, id: obj && obj.id, roomName: obj && obj.pos && obj.pos.roomName, regFun };
                for (const k in ops) t[k] = ops[k];
                return t;
            },
            taskOutView(id, roomName, x, y, taskName, regFun, ops = {}) {
                const t = { taskName, id, roomName, x, y, regFun };
                for (const k in ops) t[k] = ops[k];
                return t;
            },
            taskData(taskName, regFun, ops = {}) {
                const t = { taskName, regFun };
                for (const k in ops) t[k] = ops[k];
                return t;
            },
        },
        Creep: function () {},
    }, CONSTANTS);
    ctx.global = ctx;
    return ctx;
}

function makeStore(contents, capacity) {
    return {
        ...contents,
        getUsedCapacity(res) { return res ? (contents[res] || 0) : Object.keys(contents).reduce((s, k) => s + (contents[k] || 0), 0); },
        getFreeCapacity(res) { return capacity - this.getUsedCapacity(res); },
        getCapacity() { return capacity; },
        isEmpty() { return this.getUsedCapacity() === 0; },
    };
}

// ── ① RCL6 出兵房：预算 = floor(2300*0.5) = 1150，实孵 600 运力（修路版）────
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;

    const rcl6 = { name: "W26N58", my: true, level: 6, energyCapacityAvailable: 2300 };
    assert.equal(S.outerCarrierTripCapacity(rcl6), 600,
        "RCL6 出兵房实孵 {2WORK,12CARRY,7MOVE} = 600 运力（不是满编 1700）");

    // 体型侧的同源校验：预算 1150 下真实孵出的 CARRY 数 × 50 必须等于上面的容量
    const budget = Math.floor(2300 * 0.5);
    const plain = S.getOuterHarCarrierBodyConfig(budget, 50);
    const build = S.getOuterHarCarrierBuildBodyConfig(budget, 50);
    const carriage = b => b.filter(p => p === CONSTANTS.CARRY).length;
    assert.equal(Math.min(carriage(plain), carriage(build)) * 50, 600,
        "配额口径必须与 getOuterHarCarrier*BodyConfig 的实际体型同源（MEMORY 第 7 条）");

    // ── ② 负对照：同一个满容器，按 1700 折只配 1 只（旧行为），按真实运力要 3 只 ──
    const waiting = 2000;                       // 容器 2000/2000 满
    const oldQuota = Math.floor(waiting / 1700); // = 1（旧写法）
    const newQuota = Math.floor(waiting / S.outerCarrierTripCapacity(rcl6)); // = 3
    assert.equal(oldQuota, 1, "旧写法下 2000 存货只配 1 只车（就是现场那个自锁）");
    assert.equal(newQuota, 3, "按 600 运力算，2000 存货该配 3 只");
    assert.ok(newQuota > oldQuota, "真实运力更小 ⇒ 配额必须更大（改回去这里就失败）");

    // ── ③ RCL8 大房不受影响：体型本来就接近满编，配额基本不变 ──
    const rcl8 = { name: "W33N55", my: true, level: 8, energyCapacityAvailable: 12900 };
    assert.equal(S.outerCarrierTripCapacity(rcl8), 1600,
        "RCL8 房预算 6450 ⇒ 修路版 32 CARRY = 1600（接近满编，不是 1700 也不是 600）");
    assert.equal(Math.floor(6000 / S.outerCarrierTripCapacity(rcl8)), 3,
        "6000 存货在 RCL8 房仍是 3 只（与改前一致，不动大房行为）");

    // ── ④ 拿不到容量（VM 桩 / 极早期）→ 退回满编口径，行为不变 ──
    const unknown = { name: "X", my: true };
    assert.equal(S.outerCarrierTripCapacity(unknown), 1700,
        "容量未知时退回满编 1700（不改变既有离线测试与极早期行为）");
}

// ── ⑤ 补员闸确实用上了新分母（源码级：两个调用点都要改）───────────────
{
    const raw = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/let quota = Math\.floor\(pro\.outerMineEnergyWaiting\(spawnRoom, roomFilter\) \/ pro\.outerCarrierTripCapacity\(spawnRoom\)\);/.test(code),
        "outerCarrierBacklogQuota 的分母必须是按体型算的运力");
    assert.ok(/let mineQuota = Math\.floor\(pro\.outerMineWaitingByMine\(spawnRoom, targetName, data\) \/ pro\.outerCarrierTripCapacity\(spawnRoom\)\);/.test(code),
        "按矿点的豁免配额也必须用同一个分母（两处同源）");
    assert.ok(!/\/ OUTER_CARRIER_TRIP;/.test(code),
        "不能再拿满编常量直接当分母（小车房会把豁免算小近 3 倍）");
}

console.log("outer carrier quota checks passed");
