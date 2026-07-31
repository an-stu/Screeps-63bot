const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deploy/core-modules.json"), "utf8"));
const source = JSON.parse(fs.readFileSync(path.join(root, ".screeps-code.json"), "utf8"));
const mounted = [...fs.readFileSync(path.join(root, "modules/main_mount.js"), "utf8").matchAll(/require\(["']([^"']+)["']\)/g)]
    .map(match => match[1]);
const mainMount = fs.readFileSync(path.join(root, "modules/main_mount.js"), "utf8");
const powerCreepStrategy = fs.readFileSync(path.join(root, "modules/strategy_factoryPowerCreep.js"), "utf8");
const powerCreepPrototype = fs.readFileSync(path.join(root, "modules/prototype_powerCreep.js"), "utf8");
const utilsTask = fs.readFileSync(path.join(root, "modules/utils_task.js"), "utf8");
const stationTower = fs.readFileSync(path.join(root, "modules/station_tower.js"), "utf8");
const managerRooms = fs.readFileSync(path.join(root, "modules/manager_rooms.js"), "utf8");
const managerFlags = fs.readFileSync(path.join(root, "modules/manager_flags.js"), "utf8");
const main = fs.readFileSync(path.join(root, "modules/main.js"), "utf8");
const prototypeRoom = fs.readFileSync(path.join(root, "modules/prototype_room.js"), "utf8");
const betterMove = fs.readFileSync(path.join(root, "modules/超级移动优化hotfix 0.9.4.js"), "utf8");

assert.equal(new Set(manifest).size, manifest.length, "core manifest must not duplicate a module");
for (const moduleName of manifest) {
    assert.ok(moduleName === "algo_wasm_PriorityQueue" || fs.existsSync(path.join(root, "modules", `${moduleName}.js`)), `missing ${moduleName}`);
}
for (const moduleName of mounted) {
    assert.ok(manifest.includes(moduleName), `main_mount loads ${moduleName}, but it is not in the core package`);
}
assert.ok(manifest.includes("algo_wasm_priorityqueue"), "PriorityQueue's lowercase WASM runtime must be packaged");
assert.equal(typeof source.modules.algo_wasm_PriorityQueue, "string", "PriorityQueue wrapper must remain JavaScript");
assert.equal(typeof source.modules.algo_wasm_priorityqueue.binary, "string", "PriorityQueue runtime must remain binary data");
assert.ok(mainMount.includes("global.LOCAL_SHARD_NAME = Game.shard.name"), "core mode must initialize its shard name");
assert.ok(manifest.includes("strategy_factoryPowerCreep"), "core mode must keep Power Creeps alive and operating storage");
assert.ok(manifest.includes("strategy_resourceBalance"), "core mode must prevent full storage from blocking the economy");
assert.ok(manifest.includes("station_lab"), "core mode must execute existing boost tasks");
assert.ok(manifest.includes("station_factory"), "core mode must keep owned factories and OPF creeps functional");
assert.ok(manifest.includes("team_raL1"), "core mode must service the active raL3 flag");
assert.ok(powerCreepStrategy.includes("spawnCooldownTime <= Date.now()"), "Power Creeps must respawn after their cooldown expires");
assert.ok(powerCreepPrototype.includes("effect.ticksRemaining < 100"), "storage operation must refresh near expiry");
assert.ok(powerCreepPrototype.includes("return shouldOperate ? storage : false"), "storage operation must return a task target, not a boolean");
assert.ok(utilsTask.includes("roomName:obj.pos.roomName"), "task targets must use their stable RoomPosition room name");
assert.ok(stationTower.includes("pro.lastUpdateMap[room.name]=3"), "peaceful tower repair must be throttled");
assert.ok(!managerRooms.includes("room.find(FIND_FLAGS)"), "room manager must use the per-tick flag index");
assert.ok(managerFlags.includes("let prefixMap = Game._flagPerfixMap = {}"), "flag prefixes must be indexed during initialization");
assert.ok(main.includes("Game._coreObjects"), "main loop must cache tick object arrays");
assert.ok(!main.includes("RawMemory.set(JSON.stringify(Memory))"), "main loop must not serialize all Memory manually");
assert.ok(main.includes("_global_memory_tick + 1 == Game.time"), "Memory cache must only span consecutive ticks");
assert.ok(prototypeRoom.includes("this._flagList = this._flagList || []"), "rooms without flags must expose an empty list");
assert.ok(betterMove.includes("let enableCpuStats = false"), "movement CPU instrumentation must default to off");
assert.ok(betterMove.includes("if (!enableCpuStats) return fn.apply(this, arguments)"), "normal moveTo calls must bypass analyzer timers");
assert.ok(betterMove.includes("setCpuStats(bool)"), "movement CPU instrumentation must remain explicitly switchable");
execFileSync(process.execPath, [path.join(root, "scripts/audit-core-tasks.cjs")], { stdio: "inherit" });

const context = {
    Game: {
        time: 0,
        cpu: {
            bucket: 9000,
            getUsed() { return context.Game.time / 5; },
        },
    },
    console: { log() {} },
};
context.global = context;
vm.runInNewContext(fs.readFileSync(path.join(root, "modules/helper_cpuUsed.js"), "utf8"), context);

for (let time = 1; time < 5; time += 1) {
    context.Game.time = time;
    context.HelperCpuUsed.exec();
}
assert.equal(context.HelperCpuUsed.size, 0, "sampler should skip non-sample ticks");

for (let time = 5; time <= 5 * 605; time += 5) {
    context.Game.time = time;
    context.Game.cpu.bucket = 10000 - time / 5;
    context.HelperCpuUsed.exec();
}
assert.equal(context.HelperCpuUsed.size, 600, "sampler should cap its retained history");
assert.equal(context.HelperCpuUsed.series(context.HelperCpuUsed.cpu).length, 600);
assert.equal(context.HelperCpuUsed.series(context.HelperCpuUsed.cpu)[0], 6, "ring buffer must return chronological samples");
assert.equal(context.HelperCpuUsed.average(context.HelperCpuUsed.cpu, 20), 595.5, "sampler must average only recent values");

console.log("core profile checks passed");
