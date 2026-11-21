const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const plannerSource = fs.readFileSync(path.join(root, "modules/manager_autoPlanner.js"), "utf8");
const roomsSource = fs.readFileSync(path.join(root, "modules/manager_rooms.js"), "utf8");

function extractMethod(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, "missing " + header);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unterminated " + header);
}

const sandbox = {
    MIN_CPU: false,
    Game: {time: 100, cpu: {bucket: 9000}},
    heavyPlannerCalls: 0,
    ManagerPlanner: {computeManor() { sandbox.heavyPlannerCalls++; }},
    testPlanner: {},
};
const triggerMethod = extractMethod(plannerSource, "tryBuildOnRclChange(room) {").replace(/\bpro\./g, "testPlanner.");
vm.runInNewContext(`this.testPlanner = {${triggerMethod}};`, sandbox);
const ManagerAutoPlanner = sandbox.testPlanner;

function makeRoom({level = 6, hash = 0, memory = {structMap: {extension: "blueprint"}}, my = true} = {}) {
    return {
        my,
        level,
        hashCode: () => hash,
        memory,
    };
}

let tierCalls = 0;
let tierResult = {state: "complete", placed: 1};
ManagerAutoPlanner.tryCurrentBlueprintTier = () => {
    tierCalls++;
    return tierResult;
};

// New-room rollout is hash-staggered by at most three ticks; a zero hash is
// immediately eligible even when this is not the regular planner time slot.
{
    sandbox.Game.time = 101;
    const immediate = makeRoom({hash: 0});
    tierCalls = 0;
    assert.deepEqual(ManagerAutoPlanner.tryBuildOnRclChange(immediate), {state: "complete", placed: 1});
    assert.equal(tierCalls, 1, "an RCL blueprint pass should not wait for the periodic planner slot");
    assert.equal(immediate.memory.blueprintTierBuild.rcl, 6);
    assert.equal(immediate.memory.blueprintTierBuild.state, "complete");
    assert.equal("nextTick" in immediate.memory.blueprintTierBuild, false);

    const staggered = makeRoom({hash: 3});
    tierCalls = 0;
    assert.equal(ManagerAutoPlanner.tryBuildOnRclChange(staggered), undefined);
    assert.equal(staggered.memory.blueprintTierBuild.nextTick, 104);
    assert.equal(tierCalls, 0);
    sandbox.Game.time = 103;
    ManagerAutoPlanner.tryBuildOnRclChange(staggered);
    assert.equal(tierCalls, 0, "the first pass must honor its bounded rollout offset");
    sandbox.Game.time = 104;
    ManagerAutoPlanner.tryBuildOnRclChange(staggered);
    assert.equal(tierCalls, 1);
}

// A genuine level transition bypasses an old future retry tick and attempts
// the newly unlocked blueprint tier in the same Game.time.
{
    sandbox.Game.time = 207;
    const room = makeRoom({memory: {
        structMap: {extension: "blueprint"},
        blueprintTierBuild: {rcl: 5, nextTick: 212, state: "queued"},
    }});
    tierCalls = 0;
    tierResult = {state: "queued", placed: 0};
    ManagerAutoPlanner.tryBuildOnRclChange(room);
    assert.equal(tierCalls, 1);
    assert.equal(room.memory.blueprintTierBuild.rcl, 6);
    assert.equal(room.memory.blueprintTierBuild.nextTick, 212,
        "the queued result schedules its next attempt five ticks after the current tick");
}

// Capacity and other temporary failures persist their state and retry cadence.
{
    sandbox.Game.time = 300;
    const room = makeRoom({memory: {
        structMap: {extension: "blueprint"},
        blueprintTierBuild: {rcl: 6, nextTick: 300},
    }});
    tierCalls = 0;
    tierResult = {state: "queued", placed: 0};
    ManagerAutoPlanner.tryBuildOnRclChange(room);
    assert.equal(room.memory.blueprintTierBuild.state, "queued");
    assert.equal(room.memory.blueprintTierBuild.nextTick, 305,
        "site-capacity pressure must remain pending and retry after five ticks");
    sandbox.Game.time = 304;
    ManagerAutoPlanner.tryBuildOnRclChange(room);
    assert.equal(tierCalls, 1, "a queued tier must not retry before its persisted deadline");
    sandbox.Game.time = 305;
    tierResult = {state: "blocked", placed: 0};
    ManagerAutoPlanner.tryBuildOnRclChange(room);
    assert.equal(tierCalls, 2);
    assert.equal(room.memory.blueprintTierBuild.state, "blocked");
    assert.equal(room.memory.blueprintTierBuild.nextTick, 366,
        "a blocked tier must back off for 61 ticks");
    sandbox.Game.time = 366;
    tierResult = {state: "complete", placed: 0};
    ManagerAutoPlanner.tryBuildOnRclChange(room);
    assert.equal(tierCalls, 3);
    assert.equal(room.memory.blueprintTierBuild.state, "complete");
    assert.equal("nextTick" in room.memory.blueprintTierBuild, false,
        "a completed tier should clear its retry deadline");
}

// Nonowners and emergency CPU conditions do not run the blueprint pass, and
// the trigger never invokes the expensive layout planner.
{
    sandbox.Game.time = 400;
    const nonowner = makeRoom({my: false, memory: {structMap: {extension: "blueprint"}}});
    tierCalls = 0;
    ManagerAutoPlanner.tryBuildOnRclChange(nonowner);
    assert.equal(tierCalls, 0);
    assert.equal(nonowner.memory.blueprintTierBuild, undefined);

    const room = makeRoom();
    sandbox.MIN_CPU = true;
    ManagerAutoPlanner.tryBuildOnRclChange(room);
    assert.equal(tierCalls, 0, "MIN_CPU mode must defer non-emergency tier construction");
    sandbox.MIN_CPU = false;
    sandbox.Game.cpu.bucket = 500;
    ManagerAutoPlanner.tryBuildOnRclChange(room);
    assert.equal(tierCalls, 0, "a low CPU bucket must defer tier construction");
    sandbox.Game.cpu.bucket = 9000;
    assert.equal(sandbox.heavyPlannerCalls, 0, "an RCL transition must reuse the saved blueprint, not recompute it");
}

// ManagerRooms reaches the trigger only for owned, unblocked, ordinary rooms.
const roomExec = extractMethod(roomsSource, "exec(room) {");
const ownerGuard = roomExec.indexOf("if (!room.my) {");
const blockGuard = roomExec.indexOf('if (room.flags("blockRoom").length) return;');
const trigger = roomExec.indexOf("ManagerAutoPlanner.tryBuildOnRclChange(room)");
assert.ok(ownerGuard >= 0 && ownerGuard < trigger, "non-owned rooms return before the trigger");
assert.ok(blockGuard >= 0 && blockGuard < trigger, "blockRoom returns before the trigger");
assert.match(roomExec.slice(blockGuard, trigger), /else if \(room\.flags\("minSizeRoom"\)\.length\)/,
    "special min-size rooms should continue to bypass the standard blueprint trigger");

// Exercise the real queueing coordinator with the existing low-level site
// helper stubbed: capacity is shared between rooms and never opens other slots.
{
    const queue = extractMethod(plannerSource, "tryCurrentBlueprintTier(room) {").replace(/\bpro\./g,"testPlanner.");
    vm.runInNewContext(`testPlanner.tryCurrentBlueprintTier=function${queue.slice(queue.indexOf("("))};`,sandbox);
    sandbox.FIND_MY_SPAWNS = "mySpawns";
    sandbox.CONTROLLER_STRUCTURES = {
        spawn:{5:1}, extension:{5:30}, tower:{5:2}, container:{5:5}, lab:{5:3}, constructedWall:{5:2500},
    };
    sandbox.Utils = {decodeLayoutPositions: value=>value};
    const p=(x,y)=>({x,y});
    const room=makeRoom({level:5,memory:{autoBuildLabs:false,structMap:{
        spawn:[p(10,10)],extension:[p(11,10)],tower:[p(12,10)],container:[p(40,40)],
        lab:[p(14,10)],constructedWall:[p(15,10)],
    }}});
    Object.assign(room,{constructionSite:[],spawn:[{pos:p(10,10)}],controller:{pos:p(22,22)},
        source:[{pos:p(12,12)}],find:()=>room.spawn});
    const tried=[];
    ManagerAutoPlanner.tryCreateStructs = (r,map,type)=>{
        assert.equal(map,room.memory.structMap);
        tried.push(type);
        if ((r._construct_builed||0)<r._blueprintTierSiteCeiling) r._construct_builed=(r._construct_builed||0)+1;
    };
    sandbox.Game.constructionSites = Object.fromEntries(Array.from({length:99},(_,i)=>[i,true]));
    assert.equal(ManagerAutoPlanner.tryCurrentBlueprintTier(room).state,"queued");
    assert.deepEqual(tried,["extension"],"one global slot goes to the first deficit");
    assert.equal(sandbox.Game._blueprintTierSiteCount,100);
    assert.equal(ManagerAutoPlanner.tryCurrentBlueprintTier(room).placed,0,"same-tick retries see the shared full cap");
    sandbox.Game._blueprintTierSiteCount=0;
    const next=ManagerAutoPlanner.tryCurrentBlueprintTier(room);
    assert.deepEqual(tried,["extension","extension","tower"]);
    assert.equal(next.placed,2,"no mineral container below RCL6, opted-out lab or defense sites");
    assert.equal(next.state,"complete");
}

console.log("RCL blueprint trigger: OK");
