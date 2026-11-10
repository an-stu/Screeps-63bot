/**
 * Carrier hot-path regressions:
 *   - discard invalid carryRes work before routing;
 *   - do not issue a withdraw command while travelling;
 *   - never keep an impossible zero-capacity auto-haul task alive;
 *   - only dispatch source loads that carryEnergyAuto can actually withdraw.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const creepSource = fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8");
const highSource = fs.readFileSync(path.join(root, "modules/strategy_highLevel.js"), "utf8");

function loadCreep() {
    const ctx = {
        console: { log() {} },
        Creep: function () {}, Room: function () {}, RoomPosition: function () {},
        Game: { time: 1, getObjectById: id => objects[id] },
        Memory: { creeps: {} },
        PathFinder: { CostMatrix: function () { this.set = () => {}; this.get = () => 0; } },
        RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power", RESOURCE_OPS: "ops",
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_NOT_ENOUGH_RESOURCES: -6,
        ERR_INVALID_TARGET: -7, ERR_FULL: -8, ERR_BUSY: -4, ERR_NOT_OWNER: -1,
        ERR_INVALID_ARGS: -10, ERR_NO_BODYPART: -12, ERR_NO_PATH: -2, ERR_TIRED: -11,
        WORK: "work", BUILD_POWER: 5, STRUCTURE_RAMPART: "rampart",
        STRUCTURE_CONTAINER: "container", STRUCTURE_ROAD: "road", STRUCTURE_TOWER: "tower",
        STRUCTURE_LINK: "link", CARRY: "carry", MOVE: "move", ATTACK: "attack",
        HEAL: "heal", RANGED_ATTACK: "ranged_attack", TOUGH: "tough",
        FIND_CREEPS: 1, FIND_MY_CREEPS: 2, FIND_STRUCTURES: 3, FIND_HOSTILE_CREEPS: 4,
        FIND_CONSTRUCTION_SITES: 8, FIND_MY_CONSTRUCTION_SITES: 8, FIND_SOURCES: 9,
        LOOK_STRUCTURES: "structures", LOOK_CONSTRUCTION_SITES: "constructionSite",
        DISMANTLE_POWER: 50, RANGED_ATTACK_POWER: 10, ATTACK_POWER: 30, HEAL_POWER: 12,
        RANGED_HEAL_POWER: 4, REPAIR_POWER: 100, HARVEST_POWER: 2, CARRY_CAPACITY: 50,
        PWR_OPERATE_STORAGE: 1, PWR_GENERATE_OPS: 2, BOOSTS: {},
        UtilsTask: { task: (target, taskName) => ({ taskName, id: target && target.id }), taskOutView: () => ({ taskName: "x" }) },
        StationUpgrade: { trySignController: () => false },
        StationHive: { HiveNeedToFill: () => false },
        StationCarry: { generatorCarryStorageEnergyTask: () => [] },
        StationSources: { stationName: "stationSources" },
        _: { values: o => Object.values(o || {}), keys: o => Object.keys(o || {}) },
    };
    const objects = {};
    ctx.Game.getObjectById = id => objects[id];
    ctx.global = ctx;
    vm.runInNewContext(`
        Array.prototype.last = function(){ return this[this.length - 1]; };
        Array.prototype.head = function(){ return this.length ? this[0] : undefined; };
        Array.prototype.toMap = function(){ return this.reduce((m,e) => (m[e[0]] = e[1], m), {}); };
        Array.prototype.sum = function(){ return this.reduce((a,b) => a + b, 0); };
    `, ctx);
    vm.runInNewContext(creepSource, ctx, { filename: "prototype_creep.js" });
    return { Creep: ctx.Creep, objects, ctx };
}

function makeCarryResCreep(Creep, objects, { near, amount, capacity = 100 } = {}) {
    const task = { taskName: "carryRes", id: "source", resType: "energy", requireFullLoad: true };
    const target = { id: "source", store: { energy: amount } };
    objects.source = target;
    const calls = { move: 0, withdraw: 0, pop: 0, exec: 0 };
    const creep = Object.create(Creep.prototype);
    creep.memory = { tasks: [task] };
    creep.room = { my: false };
    creep.pos = { isNearTo: () => near };
    creep.store = {
        energy: 0,
        getFreeCapacity: () => capacity,
        getCapacity: () => capacity,
    };
    creep.storeEmpty = () => true;
    creep.storeFull = () => false;
    creep.lastTask = () => creep.memory.tasks[creep.memory.tasks.length - 1];
    creep.moveTo = () => { calls.move++; return 0; };
    creep.withdraw = () => { calls.withdraw++; return 0; };
    creep.popTask = function () { calls.pop++; this.memory.tasks.pop(); return this; };
    creep.execLastTask = function () { calls.exec++; return this; };
    return { creep, target, calls };
}

function loadHighLevel() {
    const ctx = {
        console: { log() {} },
        Memory: { rooms: {}, marketSettings: {} },
        Game: { time: 1, rooms: {}, shard: { name: "shard3" }, cpu: { bucket: 10000 }, getObjectById: id => objects[id] },
        RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power", CARRY: "carry", MOVE: "move", WORK: "work",
        STRUCTURE_LINK: "link", STRUCTURE_STORAGE: "storage", STRUCTURE_EXTENSION: "extension",
        FIND_STRUCTURES: 101, FIND_MY_STRUCTURES: 111, FIND_MY_CREEPS: 102,
        FIND_HOSTILE_CREEPS: 103, FIND_SOURCES: 105, FIND_MINERALS: 106,
        FIND_CONSTRUCTION_SITES: 107, FIND_DROPPED_RESOURCES: 108,
        CONTROLLER_STRUCTURES: { extension: { 8: 60, 7: 50, 6: 40, 5: 30, 4: 20 } },
        StationHive: { HiveNeedToFill: () => false },
        StationCarry: {
            generatorCarryStorageEnergyTask: () => [],
            generatorFillPowerSpawnTask: () => [],
        },
        StationSources: { stationName: "stationSources", generatorCarryEnergyFromLinkTask: () => [] },
        StationTower: { generatorFillEnergyTasks: () => [] },
        StationUpgrade: { stationName: "stationUpgrade", generatorFillEnergyTask: () => [] },
        StationMineral: { stationName: "stationMineral" },
        UtilsTask: { task: (obj, taskName, regFun, ops) => Object.assign({ taskName }, ops || {}) },
        ManagerCreeps: { calcBodyPart: () => [] },
        StationLab: {}, StationFactory: undefined, StrategyOuterHarvest: {}, ManagerFlags: {},
        isCpuFeatureEnabled: () => true, MIN_CPU: false,
        _: { values: o => Object.keys(o || {}).map(k => o[k]) },
    };
    const objects = {};
    ctx.Game.getObjectById = id => objects[id];
    ctx.global = ctx;
    vm.runInNewContext(`Array.prototype.sum = function(){ return this.reduce((a,b)=>a+b,0); };`, ctx);
    vm.runInNewContext(highSource, ctx, { filename: "strategy_highLevel.js" });
    // Exercise carrierManager's ordinary source-dispatch path without unrelated
    // cleanup/boost helpers masking the assignment under test.
    ctx.StrategyHighLevel.carrierOperatorBoost = () => {};
    ctx.StrategyHighLevel.cleanDirtyContainers = () => {};
    return { High: ctx.StrategyHighLevel, objects };
}

function makeRoomWithCarrier(objects, { amount, capacity }) {
    const tasks = [];
    const carrier = {
        memory: { role: "carrier" }, spawning: false, ticksToLive: 1000,
        store: { energy: 0, getCapacity: () => capacity, getFreeCapacity: () => capacity },
        isFree: () => tasks.length === 0,
        storeEmpty: () => true,
        storeContainsEnergyOtherResType: () => false,
        getPartCnt: () => capacity / 50,
        addTask(task) { tasks.push(...(Array.isArray(task) ? task : [task])); return this; },
        fillAllMainRoomStorage() { return this; },
        _tasks: tasks,
    };
    objects.source = { id: "source", store: { energy: amount } };
    const room = {
        name: "E41S32", level: 7, energyCapacityAvailable: 800,
        memory: { stationSources: { source: { container: "source" } } },
        storage: { store: { energy: 10000, getFreeCapacity: () => 100000 } },
        terminal: null, link: [],
        creeps(role) {
            if (role === "carrier") return [carrier];
            if (role === "harvestEnergyKeeper") return [{}];
            return [];
        },
        hashCode: () => 1,
        getEnergyAvailable: () => 800,
    };
    return { room, carrier };
}

// Invalid, under-buffer source tasks are discarded without a wasted route search.
{
    const { Creep, objects } = loadCreep();
    const { creep, calls } = makeCarryResCreep(Creep, objects, { near: false, amount: 100 });
    Creep.prototype.carryRes.call(creep);
    assert.equal(calls.move, 0, "source at exactly one load must be rejected before routing");
    assert.equal(calls.withdraw, 0, "invalid source task must not issue a withdraw");
    assert.equal(creep.memory.tasks.length, 0, "under-buffer task must be removed, not retried");
}

// A valid remote target only needs movement; withdraw is attempted once in range.
{
    const { Creep, objects } = loadCreep();
    const { creep, calls } = makeCarryResCreep(Creep, objects, { near: false, amount: 101 });
    Creep.prototype.carryRes.call(creep);
    assert.equal(calls.move, 1, "valid remote source should still issue movement");
    assert.equal(calls.withdraw, 0, "travel ticks must not issue ERR_NOT_IN_RANGE withdraw no-ops");
    assert.equal(creep.memory.tasks.length, 1, "valid task remains active while travelling");

    creep.pos.isNearTo = () => true;
    Creep.prototype.carryRes.call(creep);
    assert.equal(calls.withdraw, 1, "in-range source should still be withdrawn");
    assert.equal(creep.memory.tasks.length, 0, "successful withdrawal should finish the task");
}

// A zero-capacity creep must not leave carryEnergyAuto alive as a perpetual no-op.
{
    const { Creep } = loadCreep();
    const creep = Object.create(Creep.prototype);
    creep.memory = { tasks: [{ taskName: "carryEnergyAuto" }] };
    creep.store = { energy: 0, getFreeCapacity: () => 0 };
    let popped = 0;
    creep.popTask = function () { popped++; this.memory.tasks.pop(); return this; };
    creep.execLastTask = () => creep;
    Creep.prototype.carryEnergyAuto.call(creep);
    assert.equal(popped, 1, "zero-capacity auto-haul task should be retired immediately");
    assert.equal(creep.memory.tasks.length, 0);
}

// A claimed source stays pinned while the carrier travels; only room.used is
// reset per tick, so a valid task must not rebuild/sort the candidate list.
{
    const { Creep, objects, ctx } = loadCreep();
    const selected = { id: "selected", store: { energy: 200 } };
    const richer = { id: "richer", store: { energy: 10000 } };
    objects.selected = selected;
    objects.richer = richer;
    let candidateScans = 0;
    ctx._.values = object => { candidateScans++; return Object.values(object || {}); };
    const task = { taskName: "carryEnergyAuto", sourceId: "selected", sourceType: "container" };
    const moves = [];
    const creep = Object.create(Creep.prototype);
    creep.memory = { tasks: [task] };
    creep.room = { used: {}, terminal: null, storage: null,
        memory: { stationSources: { selected: { container: "selected" }, richer: { container: "richer" } } } };
    creep.store = { energy: 0, getFreeCapacity: () => 100 };
    creep.pos = { isNearTo: () => false };
    creep.lastTask = () => creep.memory.tasks[creep.memory.tasks.length - 1];
    creep.moveTo = target => { moves.push(target.id); return 0; };
    creep.popTask = function () { this.memory.tasks.pop(); return this; };
    creep.execLastTask = () => creep;
    for (let tick = 0; tick < 3; tick++) {
        creep.room.used = {}; // normal main.init() behavior
        Creep.prototype.carryEnergyAuto.call(creep);
        assert.equal(task.sourceId, "selected", "valid target must remain pinned throughout travel");
    }
    assert.deepEqual(moves, ["selected", "selected", "selected"], "movement must keep using the same cached source");
    assert.equal(candidateScans, 0, "valid cached sources should bypass candidate enumeration and sorting");
    assert.equal(creep.memory.tasks.length, 1, "the haul remains active until arrival");
}

// carrierManager must use the same strict full-load keeper buffer as carryEnergyAuto.
for (const [amount, capacity, expectedTasks] of [
    [750, 1000, 0],  // old 75% prefilter dispatched this task, then auto-haul rejected it
    [1000, 1000, 0], // exactly one load remains reserved for the keeper
    [1001, 1000, 1], // first amount that the actual task can withdraw
    [2000, 0, 0],    // zero-capacity carrier must not be assigned an impossible haul
]) {
    const { High, objects } = loadHighLevel();
    const { room, carrier } = makeRoomWithCarrier(objects, { amount, capacity });
    High.carrierManager(room);
    assert.equal(carrier._tasks.filter(task => task.taskName === "carryEnergyAuto").length, expectedTasks,
        `amount=${amount}, capacity=${capacity}: source task assignment must match executable load policy`);
}

console.log("carrier CPU regressions passed");
