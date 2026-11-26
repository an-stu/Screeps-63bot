const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../modules/strategy_deposits.js"), "utf8");
const HOME = "E41S32";
const TARGET = "E40S30";

function makeFlag(name, memory, removed = []) {
    return {
        name,
        memory,
        getRoomName: () => HOME,
        remove() { removed.push(name); },
    };
}

function load({
    shard = "shard2", time = 1000, bucket = 10000, marketSettings = {}, flags = [],
    homeCreeps = {}, objects = {},
} = {}) {
    const removed = [];
    const created = [];
    const roomDispatches = [];
    const home = {
        name: HOME, my: true, controller: {my: true, level: 8},
        hashCode: () => 0,
        creeps(role) { return homeCreeps[role] || []; },
    };
    const ctx = {
        Creep: function () {},
        RoomPosition: function (x, y, roomName) {
            return {x, y, roomName, createFlag(name) {
                created.push(name);
                ctx.Game.flags[name] = makeFlag(name, ctx.Memory.flags[name], removed);
                flags.push(ctx.Game.flags[name]);
                return 0;
            }};
        },
        RESOURCE_MIST: "mist",
        Game: {
            time, shard: {name: shard}, cpu: {bucket},
            flags: Object.create(null), rooms: {[HOME]: home},
            getObjectById: id => objects[id] || null,
        },
        Memory: {flags: Object.create(null), marketSettings},
        StationObserver: {getClosedMyRoomName: () => HOME},
        ManagerFlags: {
            getFlagsByPrefix(prefix) { return prefix === "deposit" ? flags : []; },
            getFlagsByPrefixAndRoom(prefix, roomName) {
                roomDispatches.push([prefix, roomName]);
                return [];
            },
        },
        UtilsTask: {taskData: name => ({taskName: name}), task: () => ({})},
        StationSources: {}, StationHive: {}, StationLab: {}, StationCarry: {},
        ManagerCreeps: {}, BOOST_RES: {}, WORK: "work", CARRY: "carry", MOVE: "move",
        global: null,
    };
    for (const flag of flags) {
        ctx.Game.flags[flag.name] = flag;
        ctx.Memory.flags[flag.name] = flag.memory;
    }
    ctx.global = ctx;
    vm.runInNewContext(source + "\nthis.__canHarvestDeposit = canHarvestDeposit;", ctx,
        {filename: "strategy_deposits.js"});
    return {ctx, home, flags, removed, created, roomDispatches};
}

function depositData({lastCooldown = 0, depositType = "silicon", disappearTime = 1100, x = 3, y = 4} = {}) {
    return {id: `dep-${x}-${y}`, depositType, lastCooldown, disappearTime, x, y};
}

function assignedCreep(id, flagName, taskName, {spawning = false, ttl = 1000} = {}) {
    return {
        id, spawning, ticksToLive: spawning ? undefined : ttl,
        headTask: () => ({flagName, taskName}),
    };
}

test("shared eligibility uses strict effective cooldown caps and future disappear time", () => {
    const {ctx} = load(); // shard2 default cap = 120
    assert.equal(ctx.__canHarvestDeposit(depositData({lastCooldown: 119})), true);
    assert.equal(ctx.__canHarvestDeposit(depositData({lastCooldown: 120})), false,
        "equality at the ordinary cap is closed");
    assert.equal(ctx.__canHarvestDeposit(depositData({depositType: "mist", lastCooldown: 59})), true);
    assert.equal(ctx.__canHarvestDeposit(depositData({depositType: "mist", lastCooldown: 60})), false,
        "MIST uses half the cap and equality is closed");
    assert.equal(ctx.__canHarvestDeposit(depositData({lastCooldown: 0, disappearTime: 1000})), false,
        "the deposit must still be alive at the current tick");
});

test("mission creation closes at equality, while an existing flag still receives fresh metadata", () => {
    const {ctx, flags, removed, created} = load();
    const stale = depositData({lastCooldown: 120});
    ctx.StrategyDeposits.createOrUpdateDepositMission(TARGET, stale);
    const staleName = `deposit_${HOME}_${TARGET}_${stale.x}_${stale.y}`;
    assert.equal(created.includes(staleName), false, "do not create a new flag at the ordinary cap");
    assert.equal(ctx.Memory.flags[staleName], undefined);

    const mist = depositData({depositType: "mist", lastCooldown: 60, x: 5, y: 6});
    ctx.StrategyDeposits.createOrUpdateDepositMission(TARGET, mist);
    const mistName = `deposit_${HOME}_${TARGET}_${mist.x}_${mist.y}`;
    assert.equal(created.includes(mistName), false, "do not create a new MIST flag at its half-cap");

    const expired = depositData({lastCooldown: 10, disappearTime: ctx.Game.time, x: 7, y: 8});
    ctx.StrategyDeposits.createOrUpdateDepositMission(TARGET, expired);
    assert.equal(created.some(name => name.endsWith("_7_8")), false,
        "do not create a flag for an expired deposit");

    const existingName = `deposit_${HOME}_${TARGET}_9_10`;
    const existingMemory = {lastCooldown: 5, oldField: true};
    const existing = makeFlag(existingName, existingMemory, removed);
    flags.push(existing);
    ctx.Game.flags[existingName] = existing;
    ctx.Memory.flags[existingName] = existingMemory;
    ctx.StrategyDeposits.createOrUpdateDepositMission(TARGET,
        {...depositData({lastCooldown: 120, x: 9, y: 10}), observedAt: 99});
    assert.equal(existingMemory.lastCooldown, 120, "refresh an existing assignment after it becomes ineligible");
    assert.equal(existingMemory.observedAt, 99);
    assert.equal(existingMemory.flagName, existingName);
    assert.equal(created.length, 0, "refreshing existing metadata must not recreate the flag");
});

test("cleanup removes ended or stale-ID flags but preserves live and spawning transit assignments", () => {
    const removedFlags = [];
    const expired = makeFlag("deposit_E41S32_E40S30_1_1",
        {...depositData({lastCooldown: 120, x: 1, y: 1}), harvesters: [], carriers: []}, removedFlags);
    const mistAtCap = makeFlag("deposit_E41S32_E40S30_2_2",
        {...depositData({depositType: "mist", lastCooldown: 60, x: 2, y: 2}), harvesters: [], carriers: []}, removedFlags);
    const staleId = makeFlag("deposit_E41S32_E40S30_3_3",
        {...depositData({lastCooldown: 120, x: 3, y: 3}), harvesters: ["dead-harvester"], carriers: ["dead-carrier"]}, removedFlags);
    const liveFlag = makeFlag("deposit_E41S32_E40S30_4_4",
        {...depositData({lastCooldown: 120, x: 4, y: 4}), harvesters: ["live-harvester"], carriers: []}, removedFlags);
    const spawningFlag = makeFlag("deposit_E41S32_E40S30_5_5",
        {...depositData({lastCooldown: 120, x: 5, y: 5}), harvesters: [], carriers: []}, removedFlags);
    const wrongAssignment = makeFlag("deposit_E41S32_E40S30_6_6",
        {...depositData({lastCooldown: 120, x: 6, y: 6}), harvesters: ["wrong-task"], carriers: []}, removedFlags);

    const objects = {
        "live-harvester": assignedCreep("live-harvester", liveFlag.name, "harvestDeposit"),
        "wrong-task": assignedCreep("wrong-task", wrongAssignment.name, "carryDeposit"),
    };
    const homeCreeps = {
        // The transit/spawning carrier is not yet in the flag roster. It still
        // counts because room.creeps(role, false) includes spawning creeps.
        carrierDeposits: [assignedCreep("spawn-carrier", spawningFlag.name, "carryDeposit", {spawning: true})],
    };
    const {ctx} = load({
        flags: [expired, mistAtCap, staleId, liveFlag, spawningFlag, wrongAssignment],
        objects, homeCreeps,
    });
    ctx.StrategyDeposits.cleanFlag();

    assert.deepEqual(removedFlags.sort(), [expired.name, mistAtCap.name, staleId.name, wrongAssignment.name].sort(),
        "equality, stale IDs, and mismatched task assignments must not keep a flag alive");
    assert.equal(liveFlag.memory.harvesters[0], "live-harvester");
    assert.equal(spawningFlag.memory.carriers.length, 0, "transit/spawning assignment is discovered independently of roster IDs");
});

test("cleanup runs before low-bucket and dispatch-phase returns", () => {
    const lowRemoved = [];
    const lowFlag = makeFlag("deposit_E41S32_E40S30_7_7",
        {...depositData({lastCooldown: 120, x: 7, y: 7}), harvesters: [], carriers: []}, lowRemoved);
    const low = load({flags: [lowFlag], bucket: 4000});
    low.ctx.isSaveCpu = true;
    low.ctx.taskDispatchThrottle = false;
    low.ctx.StrategyDeposits.exec(low.home);
    assert.deepEqual(lowRemoved, [lowFlag.name]);
    assert.equal(low.roomDispatches.length, 0, "low bucket still blocks dispatch after cleanup");

    const phaseRemoved = [];
    const phaseFlag = makeFlag("deposit_E41S32_E40S30_8_8",
        {...depositData({lastCooldown: 120, x: 8, y: 8}), harvesters: [], carriers: []}, phaseRemoved);
    const phase = load({flags: [phaseFlag], time: 1000});
    phase.ctx.isSaveCpu = false;
    phase.ctx.taskDispatchThrottle = true;
    phase.home.hashCode = () => 0; // (1000 + 0) % 3 !== 0
    phase.ctx.StrategyDeposits.exec(phase.home);
    assert.deepEqual(phaseRemoved, [phaseFlag.name]);
    assert.equal(phase.roomDispatches.length, 0, "cleanup is not held behind the dispatch cadence");
});
