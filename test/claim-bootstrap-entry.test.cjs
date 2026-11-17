const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "modules", `${name}.js`), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deploy/core-modules.json"), "utf8"));
assert.ok(manifest.includes("strategy_buildCrossShard"), "the worker strategy must ship in the real payload");

const requests = [];
const loaded = new Set();
const actualModules = new Set(["utils_task", "manager_missions", "manager_crossShard", "strategy_claimCrossShard", "strategy_buildCrossShard"]);
const sandbox = {
    Creep: function () {},
    RoomPosition: function (x, y, roomName) { Object.assign(this, { x, y, roomName }); },
    Game: { time: 3000, shard: { name: "shard3" }, cpu: { bucket: 9000 }, rooms: {}, creeps: {}, flags: {}, powerCreeps: {} },
    Memory: { cpuFeatures: { crossShard: true, claimCrossShard: true } },
    ManagerCreeps: { calcBodyPart: parts => Object.keys(parts) },
    ManagerFlags: { hasPrefix: () => true },
    HelperError: { catchError: fn => fn(), runEach: (items, fn) => items.forEach(fn) },
    HelperCpuUsed: { shouldRun: () => false },
    ManagerRooms: { exec() {} },
    Logger: { info() {}, warning() {} },
    console,
    TOUGH: "tough", WORK: "work", MOVE: "move", CARRY: "carry", CLAIM: "claim",
    OK: 0,
};
sandbox.global = sandbox;
const context = vm.createContext(sandbox);
sandbox.require = name => {
    if (loaded.has(name)) return;
    loaded.add(name);
    if (actualModules.has(name)) vm.runInContext(`(function(){\n${read(name)}\n})()`, context, { filename: name });
};
vm.runInContext(`(function(){\n${read("main_mount")}\n})()`, context, { filename: "main_mount" });
assert.ok(loaded.has("strategy_buildCrossShard"), "main_mount must actually require the uploaded strategy");
assert.equal(typeof sandbox.StrategyBuildCrossShard?.start, "function");
assert.equal(typeof sandbox.missionFunc.spawnCrossShardBuilder, "function", "the origin shard must load the builder spawn handler");
assert.equal(typeof sandbox.missionFunc.crossShardBuilderSpawned, "function", "the target shard must load spawn receipt handling");

const flag = {
    name: "claimCrossShard_shard3_E49S31_1",
    pos: { roomName: "E51S29", x: 0, y: 25 },
    memory: { builders: 2 },
};
sandbox.ManagerFlags.getFlagsByPrefix = () => [flag];
sandbox.ManagerCrossShard.addCrossShardRequest = (toShard, mission) => { requests.push({ toShard, mission }); };
sandbox.StrategyClaimCrossShard.exec();
const claim = requests[0].mission.data.tasks[0];
assert.equal(claim.bootstrap.originShard, "shard3");
assert.equal(claim.bootstrap.spawnRoom, "E49S31");
assert.equal(claim.claimFlagShard, "shard3");
assert.equal(claim.roomName, "E51S29");
assert.equal(claim.x, 0);
assert.equal(claim.bootstrap.path.path[0].roomName, "E40S30");

// Use the actual task handler, with unrelated prototype mounting left out.
function loadHandler(name) {
    const source = read("prototype_creep");
    const start = source.indexOf(`Creep.prototype.${name} = function`);
    assert.ok(start >= 0);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) {
            vm.runInContext(source.slice(start, i + 1), context);
            return;
        }
    }
    throw Error("unterminated creep handler");
}
loadHandler("claimRoom");
loadHandler("goTo");
sandbox.Game.shard.name = "shard2";
sandbox.LOCAL_SHARD_NAME = "shard2";
const room = { name: "E51S29", my: false, controller: {} };
const creep = new sandbox.Creep();
Object.assign(creep, {
    name: "shard3_3000_1", room, memory: { tasks: [claim] },
    pos: { isNearTo: () => true },
    lastTask() { return this.memory.tasks[this.memory.tasks.length - 1]; },
    popTask() { this.memory.tasks.pop(); return this; },
    claimController: () => 0,
});
requests.length = 0;
creep.claimRoom();
assert.equal(requests.length, 0, "an OK intent must wait for confirmed ownership before completing claim");
assert.ok(!sandbox.Memory.crossShardBuilds?.E51S29);

room.my = true;
creep.claimRoom();
const cfg = sandbox.Memory.crossShardBuilds?.E51S29;
assert.ok(cfg, "confirmed ownership must persist build configuration before removing the source flag");
assert.equal(cfg.originShard, "shard3");
assert.equal(cfg.spawnRoom, "E49S31");
assert.equal(cfg.path.path[0].roomName, "E40S30");
assert.equal(creep.memory.tasks.length, 0);
assert.equal(requests[0].toShard, "shard3");
assert.equal(requests[0].mission.func, "removeFlag");

// Border-coordinate targets are valid in the task-based movement entry point.
let moved;
creep.moveTo = pos => { moved = pos; };
creep.goTo({ x: 0, y: 25, roomName: "E51S29" });
assert.equal(moved.x, 0);

// Mount the real main module and invoke its normal per-tick dispatcher. The
// dormant optional modules stay absent, while the bootstrap entry is observed.
let calls = 0;
const execute = sandbox.StrategyBuildCrossShard.exec;
sandbox.StrategyBuildCrossShard.exec = () => { calls++; };
sandbox.ManagerFlags.hasPrefix = () => false;
sandbox.module = { exports: {} };
vm.runInContext(`(function(){\n${read("main")}\n})()`, context, { filename: "main" });
sandbox.main.exec();
assert.equal(calls, 1, "the main loop must dispatch a persisted post-claim build operation");
sandbox.StrategyBuildCrossShard.exec = execute;
console.log("claim bootstrap entry checks passed");
