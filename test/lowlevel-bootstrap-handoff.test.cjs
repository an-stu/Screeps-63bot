const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../modules/strategy_lowLevel.js"), "utf8");

function pos(x, y) {
    return {x, y, isNearTo(p) { return Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1; },
        isEqualTo(p) { return x === p.x && y === p.y; }};
}

function creep(energy = 0, ...tasks) {
    return {tasks, store: {energy}, storeEmpty() { return this.store.energy === 0; },
        isFree() { return !tasks.length; }, headTask() { return tasks[0]; }, lastTask() { return tasks.at(-1); },
        addTask(task) { tasks.push(...(Array.isArray(task) ? task : [task])); }, popTask() { tasks.pop(); },
        getPartCnt: () => 2};
}

function makeRoom({workers = [], carriers = [creep()], roomEnergy = 200, downgrade = 16000} = {}) {
    const src = {id: "srcA", pos: pos(10, 10), energy: 3000};
    const objects = {miner: {pos: pos(10, 11), spawning: false}};
    const spawns = [];
    let carryScans = 0;
    const room = {
        name: "E51S29", spawn: [{}], tower: [], source: [src], constructionSite: [],
        controller: {id: "ctrl", ticksToDowngrade: downgrade},
        memory: {stationSources: {srcA: {id: src.id, roomName: "E51S29", creeps: ["miner"]}}},
        creeps(role) {
            if (!role) return [...workers, ...carriers, objects.miner];
            return ({worker: workers, carrier: carriers, harvestEnergyKeeper: [objects.miner]})[role] || [];
        },
        getEnergyAvailable: () => roomEnergy, getEnergyCapacityAvailable: () => 800,
        find: () => [], isDownGrade: () => false, hashCode: () => 0,
    };
    const ctx = {
        Creep: function () {}, CARRY: "carry", RESOURCE_ENERGY: "energy", FIND_HOSTILE_CREEPS: 1,
        Game: {time: 30, getObjectById: id => objects[id]}, Memory: {},
        StationSources: {stationName: "stationSources", trySpawnHarKeeper() {},
            generatorCarryEnergyTask() { carryScans++; return []; },
            generatorReleaseAbleHarTask: data => ({taskName: "harvestEnergy", id: data.id})},
        StationHive: {HiveNeedToFill: () => roomEnergy < 800,
            trySpawn(r, name, body, role) {
                if (spawns.length) return;
                spawns.push({role, body});
                r.currentEnergyAvailable = roomEnergy - Number(body[0] || 0);
                return "new-creep";
            },
            generatorFillHiveTask: () => ({taskName: "fillHive"})},
        StationCarry: {generatorPickTask: () => [], generatorCarryStorageEnergyTask: () => [],
            roomMassStoreCnt: () => 0, getCarrierBodyConfig: () => ["carry", "move"]},
        StationTower: {generatorFillEnergyTasks: () => []},
        StationWork: {getMiddleLevelWorkerBodyConfig: (r, budget) => [budget], constructionNeedBuild: () => false},
        BODYPART_COST: {work: 100, carry: 50, move: 50},
        Utils: {getBodyEnergyNeed: body => body.reduce(sum => sum + 50, 0)},
        StationUpgrade: {stationName: "stationUpgrade", generatorFillEnergyTask: () => [],
            generatorUpgradeTask: r => ({taskName: "upgrade", id: r.controller.id})},
    };
    ctx.global = ctx;
    vm.runInNewContext("Array.prototype.head = function () { return this[0]; };\n" + script, ctx);
    return {room, objects, spawns, run: () => ctx.StrategyLowLevel.exec(room), get carryScans() { return carryScans; }};
}

test("one direct worker per source until the keeper is on a built source container", () => {
    const a = creep(), b = creep();
    const w = makeRoom({workers: [a, b]});
    w.run(); w.run();
    assert.equal(a.lastTask()?.id, "srcA");
    assert.equal(b.lastTask(), undefined, "already assigned worker covers this mine");
    assert.equal(w.carryScans, 2, "one source-container carry scan per pass");

    a.popTask();
    w.room.memory.stationSources.srcA.container = "container";
    w.objects.container = {pos: pos(10, 11)};
    w.objects.miner.spawning = true;
    w.run();
    assert.equal(a.lastTask()?.taskName, "harvestEnergy", "an in-spawn keeper is not yet coverage");

    a.popTask();
    w.objects.miner.spawning = false;
    w.run();
    assert.equal(a.lastTask(), undefined, "ordinary workers stop receiving new direct-harvest tasks after handoff");
});

test("a registered miner and an idle carrier do not suppress an affordable rescue worker", () => {
    const w = makeRoom();
    w.run();
    assert.equal(w.spawns.length, 1);
    assert.equal(w.spawns[0].role, "worker");
    assert.equal(w.spawns[0].body[0], 200);
    const tooPoor = makeRoom({roomEnergy: 199});
    tooPoor.run();
    assert.equal(tooPoor.spawns.length, 0);
});

test("downgrade timer sends just one loaded worker to upgrade without a controller container", () => {
    const task = {taskName: "buildConst", id: "site", roomName: "E51S29"};
    const a = creep(50, task), b = creep(50, task);
    const w = makeRoom({workers: [a, b], downgrade: 5000});
    w.run(); w.run();
    assert.equal(a.lastTask().taskName, "upgrade");
    assert.equal(b.lastTask().taskName, "buildConst");
    const safe = creep(50, task);
    makeRoom({workers: [safe, creep(50, task)], downgrade: 5001}).run();
    assert.equal(safe.lastTask().taskName, "buildConst");
    const blocked = makeRoom({workers: [creep(50, task), creep(50, task)], downgrade: 2});
    blocked.room.controller.upgradeBlocked = 10;
    blocked.run();
    assert.equal(blocked.room.creeps("worker")[0].lastTask().taskName, "buildConst");
});
