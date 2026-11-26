const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../modules/strategy_lowLevel.js"), "utf8");

function loadStrategy() {
    const sandbox = {
        Creep: function Creep() {},
        STRUCTURE_ROAD: "road",
        StationHive: {HiveNeedToFill: room => !!room.hiveNeedsFill},
        console: {log() {}},
    };
    sandbox.global = sandbox;
    vm.runInNewContext(source, sandbox);
    return sandbox.StrategyLowLevel;
}

function predicateRoom(overrides = {}) {
    return Object.assign({
        my: true,
        level: 1,
        spawn: [{my: true}],
        controller: {id: "controller", ticksToDowngrade: 20000},
        hiveNeedsFill: false,
        constructionSite: [{id: "road-1", structureType: "road"}],
    }, overrides);
}

function worker(energy, ...tasks) {
    return {
        store: {energy},
        tasks,
        storeEmpty() { return this.store.energy === 0; },
        isFree() { return this.tasks.length === 0; },
        lastTask() { return this.tasks.at(-1); },
        addTask(task) { this.tasks.push(...(Array.isArray(task) ? task : [task])); },
        popTask() { return this.tasks.pop(); },
        mainRoom() { return this.room; },
    };
}

function runLowEnergyRoom({workers = [], hiveNeedsFill = false, sites, downgrade = 20000} = {}) {
    const strategy = loadStrategy();
    const room = {
        name: "W0N0",
        my: true,
        level: 1,
        spawn: [{my: true}],
        tower: [],
        controller: {id: "controller", ticksToDowngrade: downgrade},
        constructionSite: sites || [{id: "road-1", structureType: "road"}],
        hiveNeedsFill,
        memory: {stationSources: {}},
        hashCode: () => 0,
        getEnergyCapacityAvailable: () => 300,
        find: type => (type === "myCreeps" ? workers : []),
        creeps(role) {
            if (role === "worker") return workers;
            if (role === "carrier") return [];
            return [];
        },
        isDownGrade: () => false,
    };
    workers.forEach(creep => { creep.room = room; });

    const sandbox = {
        Creep: function Creep() {},
        Game: {time: 0, getObjectById: () => undefined},
        Memory: {crossShardBuilds: {}},
        FIND_HOSTILE_CREEPS: "hostiles",
        FIND_MY_CREEPS: "myCreeps",
        FIND_FLAGS: "flags",
        HelperError: {catchError: fn => fn()},
        STRUCTURE_ROAD: "road",
        RESOURCE_ENERGY: "energy",
        StationHive: {
            HiveNeedToFill: currentRoom => !!currentRoom.hiveNeedsFill,
            generatorFillHiveTask: () => ({taskName: "fillHive"}),
        },
        StationSources: {stationName: "stationSources"},
        StationCarry: {
            generatorPickTask: () => [],
            roomMassStoreCnt: () => 0,
        },
        StationMineral: {generatorCarryMineralTask: () => []},
        StationWork: {
            constructionNeedBuild: () => true,
            generatorBuildTask: () => ({taskName: "buildConst", roomName: room.name}),
        },
        StationUpgrade: {
            generatorUpgradeTask: currentRoom => ({taskName: "upgrade", id: currentRoom.controller.id}),
        },
        _: {values: Object.values},
        console: {log() {}},
    };
    sandbox.global = sandbox;
    vm.runInNewContext(source, sandbox);
    sandbox.StrategyLowLevel.exec(room);
    return {strategy: sandbox.StrategyLowLevel, room};
}

test("RCL1 road bypass requires an owned spawn, clear hive, and roads only", () => {
    const strategy = loadStrategy();
    assert.equal(strategy.needsRcl1RoadBypass(predicateRoom()), true);

    const negativeCases = [
        ["room is not owned", {my: false}],
        ["no owned spawn", {spawn: []}],
        ["container site", {constructionSite: [{structureType: "container"}]}],
        ["spawn site", {constructionSite: [{structureType: "spawn"}]}],
        ["mixed road and container sites", {constructionSite: [
            {structureType: "road"}, {structureType: "container"},
        ]}],
        ["mixed road and spawn sites", {constructionSite: [
            {structureType: "road"}, {structureType: "spawn"},
        ]}],
        ["hive needs energy", {hiveNeedsFill: true}],
        ["RCL2", {level: 2}],
        ["no construction sites", {constructionSite: []}],
        ["controller is upgrade-blocked", {controller: {id: "controller", upgradeBlocked: 1}}],
    ];
    for (const [label, overrides] of negativeCases) {
        assert.equal(strategy.needsRcl1RoadBypass(predicateRoom(overrides)), false, label);
    }
});

test("low-energy path combines road bypass with downgrade protection and reserves one worker", () => {
    const first = worker(100);
    const second = worker(100);
    const {strategy} = runLowEnergyRoom({workers: [first, second]});

    assert.equal(strategy.needsRcl1RoadBypass(predicateRoom()), true);
    assert.equal(first.lastTask()?.taskName, "upgrade",
        "the RCL1 road-only path uses assignDowngradeProtection for one loaded worker");
    assert.equal(second.lastTask()?.taskName, "buildConst",
        "the remaining loaded worker keeps building instead of joining the upgrade task");
    assert.equal([first, second].filter(creep => creep.lastTask()?.taskName === "upgrade").length, 1,
        "at most one loaded worker is reserved for controller upgrade");

    const blockedHiveWorker = worker(100);
    runLowEnergyRoom({workers: [blockedHiveWorker], hiveNeedsFill: true, downgrade: 5000});
    assert.equal(blockedHiveWorker.lastTask()?.taskName, "upgrade",
        "existing downgrade protection still applies when the road-bypass predicate is false");
});

test("an existing upgrade is preserved; otherwise idle workers beat builders and builders can be interrupted", () => {
    const activeTask = {taskName: "upgrade", id: "controller"};
    const active = worker(100, activeTask);
    const idle = worker(100);
    runLowEnergyRoom({workers: [active, idle]});
    assert.deepEqual(active.tasks, [activeTask], "an active controller upgrader is left unchanged");
    assert.equal(idle.lastTask()?.taskName, "buildConst",
        "once an upgrader exists, another idle worker is not reserved for upgrade");

    const existingBuild = {taskName: "buildConst", id: "road-1", roomName: "W0N0"};
    const builder = worker(100, existingBuild);
    const preferredIdle = worker(100);
    runLowEnergyRoom({workers: [builder, preferredIdle]});
    assert.deepEqual(builder.tasks, [existingBuild], "the builder is not interrupted while a loaded idle worker is available");
    assert.equal(preferredIdle.lastTask()?.taskName, "upgrade", "a loaded idle worker is preferred");

    const loneBuilderTask = {taskName: "buildConst", id: "road-1", roomName: "W0N0"};
    const loneBuilder = worker(100, loneBuilderTask);
    runLowEnergyRoom({workers: [loneBuilder]});
    assert.equal(loneBuilder.tasks.length, 1);
    assert.equal(loneBuilder.lastTask()?.taskName, "upgrade",
        "when no loaded idle worker exists, one in-room builder may be interrupted");
});

console.log("RCL1 road upgrade priority OK");
