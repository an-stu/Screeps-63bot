const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "modules", "strategy_claim.js"), "utf8");
class MockCreep {}

let positionState = {structures: [], sites: [], createResult: 0, createCalls: 0};
class MockRoomPosition {
    constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    lookFor(type) {
        const key = type === "structures" ? "structures" : "sites";
        if (positionState.byX && positionState.byX[this.x]) return positionState.byX[this.x][key] || [];
        return positionState[key];
    }
    createConstructionSite() {
        positionState.createCalls += 1;
        positionState.createdAt = {x:this.x, y:this.y};
        return positionState.createResult;
    }
}

const plannerCalls = [];
const context = {
    Creep: MockCreep,
    RoomPosition: MockRoomPosition,
    Game: {time: 1, rooms: {}, getObjectById() {}},
    Memory: {},
    ManagerAutoPlanner: {tryCreateStructs(room, map, type) { plannerCalls.push(type); }},
    Utils: {decodePosArray(value) {
        if (!value) return [];
        return positionState.positions || [{x: 10, y: 10}];
    }},
    Logger: {info() {}, warning() {}},
    STRUCTURE_CONTROLLER: "controller",
    STRUCTURE_STORAGE: "storage",
    STRUCTURE_TERMINAL: "terminal",
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_EXTENSION: "extension",
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_ROAD: "road",
    STRUCTURE_RAMPART: "rampart",
    FIND_MY_SPAWNS: "mySpawns",
    FIND_MY_CONSTRUCTION_SITES: "mySites",
    FIND_STRUCTURES: "allStructures",
    FIND_HOSTILE_STRUCTURES: "hostileStructures",
    LOOK_CONSTRUCTION_SITES: "sites",
    LOOK_STRUCTURES: "structures",
    WORK: "work",
    CARRY: "carry",
    MOVE: "move",
    CLAIM: "claim",
    OK: 0,
    ERR_NOT_IN_RANGE: -9,
    ManagerFlags: {},
    StationObserver: {stationName: "stationObserver"},
    StationSources: {stationName: "stationSources"},
    console: {log() {}},
};
context.global = context;
vm.runInNewContext(source, context);

function roomWith(mySpawns) {
    return {
        name: "E53S21",
        my: true,
        memory: {structMap: {spawn: "spawnPlan", extension: "extensionPlan", container: "containerPlan"}},
        find(type) { return type === "mySpawns" ? mySpawns : []; },
    };
}

positionState = {structures: [{structureType: "spawn"}], sites: [], createResult: 0, createCalls: 0};
let result = context.StrategyClaim.ensureConstructionSites(roomWith([]));
assert.equal(positionState.createCalls, 0, "a structure occupying the planned spawn tile must block site creation");
assert.equal(result.spawnSite, false);

positionState = {structures: [], sites: [], createResult: -14, createCalls: 0};
result = context.StrategyClaim.ensureConstructionSites(roomWith([]));
assert.equal(positionState.createCalls, 1, "a clear planned tile must attempt the first spawn site");
assert.equal(result.createResult, -14, "site-limit/RCL failures must be retained for diagnostics");
assert.equal(result.spawnSite, false);

positionState = {structures: [], sites: [], createResult: 0, createCalls: 0};
result = context.StrategyClaim.ensureConstructionSites(roomWith([]));
assert.equal(result.spawnSite, true, "a successful first-spawn site must be detected");
assert.deepEqual(plannerCalls, [], "secondary sites must wait until an owned spawn exists");

context.StrategyClaim.ensureConstructionSites(roomWith([{my: true}]));
assert.deepEqual(plannerCalls, ["extension", "container"], "secondary sites must follow the completed owned spawn");

// 蓝图多个 spawn 槽位：第一个被结构占住时必须试下一个，不能静默放弃
// （2026-11-27 shard2 W31N51 丢 spawn 后重新援建遇到的坑）。
positionState = {
    structures: [], sites: [], createResult: 0, createCalls: 0,
    positions: [{x: 10, y: 10}, {x: 11, y: 10}],
    byX: {10: {structures: [{structureType: "spawn"}]}, 11: {structures: []}},
};
result = context.StrategyClaim.ensureConstructionSites(roomWith([]));
assert.equal(result.spawnSite, true, "first planned tile blocked => must fall through to the next slot");
assert.equal(positionState.createCalls, 1, "only one site attempt after the blocked slot");
assert.deepEqual(positionState.createdAt, {x: 11, y: 10}, "site must be created on the free spawn slot");

// 负对照：所有槽位都被占 ⇒ 不建站、留 diagnostics，不许假装成功。
positionState = {
    structures: [], sites: [], createResult: 0, createCalls: 0,
    positions: [{x: 10, y: 10}, {x: 11, y: 10}],
    byX: {10: {structures: [{structureType: "spawn"}]}, 11: {structures: [{structureType: "storage"}]}},
};
result = context.StrategyClaim.ensureConstructionSites(roomWith([]));
assert.equal(result.spawnSite, false, "all spawn slots blocked => no site");
assert.equal(positionState.createCalls, 0, "no site attempt on blocked tiles");
delete positionState.positions;
delete positionState.byX;

// 清理不再靠爬（用户 2026-10-21）：已占领的房里直接 `structure.destroy()`。
// 判据与执行都在 StrategyClaim.destroyForeignStructures 里，见 test/claim-cleanup.test.cjs。

console.log("claim flow checks passed");
