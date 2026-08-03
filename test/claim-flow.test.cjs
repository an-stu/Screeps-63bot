const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "modules", "strategy_claim.js"), "utf8");
class MockCreep {}

let positionState = {structures: [], sites: [], createResult: 0, createCalls: 0};
class MockRoomPosition {
    constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    lookFor(type) { return type === "structures" ? positionState.structures : positionState.sites; }
    createConstructionSite() { positionState.createCalls += 1; return positionState.createResult; }
}

const plannerCalls = [];
const context = {
    Creep: MockCreep,
    RoomPosition: MockRoomPosition,
    Game: {time: 1, rooms: {}, getObjectById() {}},
    Memory: {},
    ManagerAutoPlanner: {tryCreateStructs(room, map, type) { plannerCalls.push(type); }},
    Utils: {decodePosArray(value) { return value ? [{x: 10, y: 10}] : []; }},
    Logger: {info() {}, warning() {}},
    STRUCTURE_CONTROLLER: "controller",
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

let cleanupFilter;
const creep = new MockCreep();
creep.memory = {};
creep.room = {name: "E53S21", my: false, memory: {structMap: {road: "roadPlan"}}};
creep.lastTask = () => ({roomName: "E53S21"});
creep.pos = {findClosestByRange(type, options) { cleanupFilter = options.filter; }};
creep.clearClaimRoom();
assert.equal(cleanupFilter({hits: 5000, my: false, owner: {username: "other"}, structureType: "spawn", pos: {x: 9, y: 22}}), true,
    "another player's spawn must always be dismantled");
assert.equal(cleanupFilter({hits: 5000, my: false, structureType: "container", pos: {x: 9, y: 22}}), true,
    "an unplanned ownerless blocker must be dismantled");
assert.equal(cleanupFilter({hits: 5000, my: false, structureType: "road", pos: {x: 10, y: 10}}), false,
    "an ownerless structure already used by the blueprint should be retained");
assert.equal(cleanupFilter({hits: 5000, my: true, structureType: "spawn", pos: {x: 10, y: 10}}), false,
    "our own finished spawn must never become a cleanup target");

console.log("claim flow checks passed");
