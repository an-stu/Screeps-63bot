// 0.78.273 回归：低级房孵化顺序必须「付得起」，且失败尝试不能挡住后面的 carrier。
// 现场（E51S29，RCL3，hive 300~500）：
//   · worker 按容量 800 请求 → hive 付不起 → trySpawn 置 spawnFailure；
//   · 紧接着的 carrier（750）第一行就被 spawnFailure 拦下 ⇒ 全房零补员。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const lowSrc = fs.readFileSync(path.join(root, "modules/strategy_lowLevel.js"), "utf8");
const workSrc = fs.readFileSync(path.join(root, "modules/station_work.js"), "utf8");

// 1) 源码钉子：worker 必须带本 tick 预算；carrier 必须解除 spawnFailure 粘滞标记
assert.match(lowSrc, /getMiddleLevelWorkerBodyConfig\(room,\s*workerBudget\)/,
    "低级房 worker 体型必须按本 tick 可花的能量计算");
assert.match(lowSrc, /let workerBudget = room\.currentEnergyAvailable === undefined[\s\S]{0,80}: room\.currentEnergyAvailable;/,
    "workerBudget 优先用 trySpawn 的本 tick 预算缓存");
assert.match(lowSrc, /room\.spawnFailure = false;\s*\r?\n\s*StationHive\.trySpawn\(room, room\.name, StationCarry\.getCarrierBodyConfig\(room\)/,
    "carrier 孵化前必须清掉前面失败尝试留下的 spawnFailure");

// 2) 行为：getMiddleLevelWorkerBodyConfig 的 bodyBudget 真的限制体型
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}
const sandbox = {
    Creep: function () {},
    WORK: "work", CARRY: "carry", MOVE: "move",
    BODYPART_COST: {work: 100, carry: 50, move: 50},
    ManagerCreeps: {
        calcBodyPart(obj) {
            return Object.keys(obj).flatMap(type => new Array(obj[type]).fill(type));
        },
    },
    Utils: {getBodyEnergyNeed: body => body.reduce((sum, part) => sum + sandbox.BODYPART_COST[part], 0)},
    console: {log() {}},
};
sandbox.global = sandbox;
vm.runInNewContext(workSrc, sandbox);

const existingWorker = {memory: {role: "worker"}};
const room = {
    getEnergyCapacityAvailable: () => 800,
    getEnergyAvailable: () => 800,
    creeps(role) {
        if (role === "worker") return [existingWorker];
        return [];
    },
};

const rich = sandbox.StationWork.getMiddleLevelWorkerBodyConfig(room);
assert.equal(sandbox.Utils.getBodyEnergyNeed(rich), 800, "满容量时保持 4 组 800 体型");

const poor = sandbox.StationWork.getMiddleLevelWorkerBodyConfig(room, 400);
assert.equal(sandbox.Utils.getBodyEnergyNeed(poor), 400, "预算 400 时只能要 2 组 400 体型");
assert.equal(poor.filter(p => p === "work").length, 2);

const floor = sandbox.StationWork.getMiddleLevelWorkerBodyConfig(room, 0);
assert.equal(sandbox.Utils.getBodyEnergyNeed(floor), 200, "预算再低也保 1 组 200，避免空体型");

console.log("low-level spawns respect the tick budget and unstick the carrier queue");
