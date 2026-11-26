/**
 * Outer-carrier quota capacity must share the spawn body budget: full hive capacity
 * normally, and the bounded half-hive fallback only when workers and home carriers
 * are both absent. Work-carrier bodies include WORK weight in their road-speed ratio.
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

// ── ① Normal rooms use full hive capacity; only a depleted room gets the bounded fallback ──
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;

    const rcl6 = {
        name: "W26N58", my: true, level: 6, energyCapacityAvailable: 2300,
        getEnergyCapacityAvailable() { return this.energyCapacityAvailable; },
        creeps(role) { return role === "worker" ? [{}] : []; },
    };
    assert.equal(S.outerCarrierTripCapacity(rcl6), 1350,
        "RCL6 non-depleted room uses full hive budget; work-hauler capacity is 1350");

    // Actual normal-spawn body at the full 2,300 hive cap.
    const plain = S.getOuterHarCarrierBodyConfig(2300, 50);
    const build = S.getOuterHarCarrierBuildBodyConfig(2300, 50);
    const carriage = b => b.filter(p => p === CONSTANTS.CARRY).length;
    const roadBuildCounts = {
        carry: carriage(build), move: build.filter(p => p === CONSTANTS.MOVE).length,
        work: build.filter(p => p === CONSTANTS.WORK).length,
        cost: build.reduce((sum, p) => sum + CONSTANTS.BODYPART_COST[p], 0),
    };
    assert.deepEqual(roadBuildCounts, { carry: 27, move: 15, work: 2, cost: 2300 },
        "2300 budget produces the affordable, full-speed 27C15M2W work hauler");
    assert.equal(Math.min(carriage(plain), carriage(build)) * 50, 1350,
        "quota capacity must match the actual full-hive plain/work body pair");

    const depleted = {
        name: "W26N58-depleted", my: true, level: 6, energyCapacityAvailable: 2300,
        energyAvailable: 1150,
        getEnergyCapacityAvailable() { return this.energyCapacityAvailable; },
        getEnergyAvailable() { return this.energyAvailable; },
        creeps() { return []; },
    };
    assert.equal(S.outerCarrierTripCapacity(depleted), 600,
        "1150 current energy under the depleted fallback produces a 600-capacity work hauler");
    const fallbackBuild = S.getOuterHarCarrierBuildBodyConfig(S.outerCarrierSpawnBudget(depleted), 50);
    assert.deepEqual({
        carry: carriage(fallbackBuild),
        move: fallbackBuild.filter(p => p === CONSTANTS.MOVE).length,
        work: fallbackBuild.filter(p => p === CONSTANTS.WORK).length,
        cost: fallbackBuild.reduce((sum, p) => sum + CONSTANTS.BODYPART_COST[p], 0),
    }, { carry: 12, move: 7, work: 2, cost: 1150 }, "1150 fallback body is exactly 12C7M2W");
    const carrierOnly = { ...depleted, name: "carrier-only", creeps(role) { return role === "carrier" ? [{}] : []; } };
    assert.equal(S.outerCarrierSpawnBudget(carrierOnly), 2300,
        "one home carrier prevents the emergency half-hive fallback");

    // ── ② 负对照：同一个满容器，正常体型只配 1 只，救急体型按实际运力要 3 只 ──
    const waiting = 2000;
    const normalQuota = Math.floor(waiting / S.outerCarrierTripCapacity(rcl6));
    const depletedQuota = Math.floor(waiting / S.outerCarrierTripCapacity(depleted));
    assert.equal(normalQuota, 1, "normal RCL6 quota uses its 1350-capacity work hauler");
    assert.equal(depletedQuota, 3, "depleted recovery quota uses the actual 600-capacity body");
    assert.ok(depletedQuota > normalQuota, "bounded emergency body capacity must be reflected by the quota");

    // ── ③ RCL8 大房不受影响：体型本来就接近满编，配额基本不变 ──
    const rcl8 = {
        name: "W33N55", my: true, level: 8, energyCapacityAvailable: 12900,
        getEnergyCapacityAvailable() { return this.energyCapacityAvailable; },
        creeps(role) { return role === "worker" ? [{}] : []; },
    };
    assert.equal(S.outerCarrierTripCapacity(rcl8), 1550,
        "RCL8 normal room produces 31 CARRY = 1550 capacity with 2 WORK");
    assert.equal(Math.floor(6000 / S.outerCarrierTripCapacity(rcl8)), 3,
        "6000 存货在 RCL8 房仍是 3 只（与改前一致，不动大房行为）");

    // ── ④ 拿不到容量（VM 桩 / 极早期）→ 退回满编口径，行为不变 ──
    const unknown = { name: "X", my: true };
    assert.equal(S.outerCarrierTripCapacity(unknown), 1650,
        "capacity unknown falls back to the nominal ordinary body capacity");
    const ordinaryMax = S.getOuterHarCarrierBodyConfig(12900, 50);
    assert.equal(ordinaryMax.filter(p => p === CONSTANTS.CARRY).length, 33,
        "ordinary full body carries 33 parts");
    assert.equal(ordinaryMax.filter(p => p === CONSTANTS.MOVE).length, 17,
        "ordinary full body has enough MOVE for full-speed roads");
    assert.equal(ordinaryMax.filter(p => p === CONSTANTS.CARRY).length * 50, 1650);
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
