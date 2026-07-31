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
const stationHive = fs.readFileSync(path.join(root, "modules/station_hive.js"), "utf8");
const managerRooms = fs.readFileSync(path.join(root, "modules/manager_rooms.js"), "utf8");
const managerFlags = fs.readFileSync(path.join(root, "modules/manager_flags.js"), "utf8");
const main = fs.readFileSync(path.join(root, "modules/main.js"), "utf8");
const prototypeRoom = fs.readFileSync(path.join(root, "modules/prototype_room.js"), "utf8");
const betterMove = fs.readFileSync(path.join(root, "modules/超级移动优化hotfix 0.9.4.js"), "utf8");
const market = fs.readFileSync(path.join(root, "modules/strategy_market.js"), "utf8");
const marketPrice = fs.readFileSync(path.join(root, "modules/strategy_marketPrice.js"), "utf8");
const consoleDashboard = fs.readFileSync(path.join(root, "modules/helper_consoleDashboard.js"), "utf8");

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
assert.ok(manifest.includes("strategy_outerHarvest"), "remote harvesting must be independently restorable");
assert.ok(manifest.includes("strategy_scouter"), "flag-driven scouts must have their task handlers loaded");
assert.ok(manifest.includes("strategy_marketPrice") && manifest.includes("strategy_market"), "market runtime and pricing dependency must ship together");
assert.ok(manifest.includes("strategy_claim"), "claim task handlers must ship with planner dependencies");
assert.ok(manifest.includes("strategy_cleanBuild") && manifest.includes("strategy_blockRoom") && manifest.includes("strategy_pillage"), "flag utility task handlers must be restored together");
assert.ok(manifest.includes("strategy_deposits"), "deposit task handlers must remain available behind their opt-in");
assert.ok(manifest.includes("strategy_GCLRoom"), "GCL room task handlers must remain available behind their opt-in");
for (const moduleName of ["war_damageCal", "war_cache", "war_teamCore", "war_teamControl", "war_teamFlag", "war_attackRoom", "war_defenseCore", "war_powerCreepOperator", "teamL2", "strategy_atkL2", "strategy_defenserHighWay"]) {
    assert.ok(manifest.includes(moduleName), `combat package must include ${moduleName}`);
}
assert.ok(manifest.includes("helper_visual") && manifest.includes("manager_planner") && manifest.includes("manager_autoPlanner"), "planner dependencies must ship together");
assert.ok(manifest.includes("helper_consoleDashboard"), "on-demand console dashboard must ship in the runtime package");
assert.ok(consoleDashboard.includes("global.dash"), "console dashboard must expose the short dash() command");
assert.ok(!main.includes("ConsoleDashboard"), "console dashboard must never run from the tick loop");
assert.ok(manifest.includes("manager_missions") && manifest.includes("manager_crossShard"), "cross-shard requests must ship with local mission handlers");
assert.ok(manifest.includes("strategy_tradeCrossShard") && manifest.includes("strategy_claimCrossShard"), "cross-shard strategies must ship with their manager");
assert.ok(manifest.includes("station_lab"), "core mode must execute existing boost tasks");
assert.ok(manifest.includes("station_factory"), "core mode must keep owned factories and OPF creeps functional");
assert.ok(manifest.includes("station_observer"), "observer scanning must be independently restorable");
assert.ok(manifest.includes("team_raL1"), "core mode must service the active raL3 flag");
assert.ok(powerCreepStrategy.includes("spawnCooldownTime <= Date.now()"), "Power Creeps must respawn after their cooldown expires");
assert.ok(powerCreepPrototype.includes("effect.ticksRemaining < 100"), "storage operation must refresh near expiry");
assert.ok(powerCreepPrototype.includes("return shouldOperate ? storage : false"), "storage operation must return a task target, not a boolean");
assert.ok(utilsTask.includes("roomName:obj.pos.roomName"), "task targets must use their stable RoomPosition room name");
assert.ok(stationTower.includes("pro.lastUpdateMap[room.name]=3"), "peaceful tower repair must be throttled");
assert.ok(stationTower.includes("WarDefenseCore.checkNeedDefense(room, hostiles)"), "tower and advanced defense must share one hostile scan");
assert.ok(stationTower.includes("let injured = undefined"), "tower healing target must be shared across towers");
assert.ok(stationHive.includes("this.pos.findClosestByRange(targets)"), "hive filling must avoid a PathFinder call per assignment");
assert.ok(!stationHive.includes("this.pos.findClosestByPath(FIND_MY_STRUCTURES"), "legacy hive target path search must stay removed");
assert.ok(!managerRooms.includes("room.find(FIND_FLAGS)"), "room manager must use the per-tick flag index");
assert.ok(managerFlags.includes("let prefixMap = Game._flagPerfixMap = {}"), "flag prefixes must be indexed during initialization");
assert.ok(main.includes("Game._coreObjects"), "main loop must cache tick object arrays");
assert.ok(!main.includes("RawMemory.set(JSON.stringify(Memory))"), "main loop must not serialize all Memory manually");
assert.ok(main.includes("_global_memory_tick + 1 == Game.time"), "Memory cache must only span consecutive ticks");
assert.ok(main.includes("Game.time % 100 == 0"), "detailed CPU profiling must remain low frequency");
assert.ok(main.includes("room.controller.ticksToDowngrade < 20000"), "upgrader throttling must preserve controllers near downgrade");
assert.ok(main.includes(".filter(shouldRunCreep)"), "creep execution must apply the safe adaptive throttle");
assert.ok(mainMount.includes("global.isCpuFeatureEnabled"), "optional modules must share one runtime feature gate");
assert.ok(mainMount.includes("observer: true"), "observer scanning must be switchable without another upload");
assert.ok(mainMount.includes("outerHarvest: true"), "remote harvesting must be switchable without another upload");
assert.ok(managerFlags.includes("hasPrefix (prefix)"), "dormant flag strategies must have an allocation-free gate");
assert.ok(managerFlags.includes("hasAnyPrefix (prefixes)"), "combat dispatch must support a shared prefix gate");
assert.ok(main.includes('ManagerFlags.hasPrefix("moveto")'), "scouter strategy must not run without a matching flag");
assert.ok(main.includes('ManagerFlags.hasPrefix("claim")'), "claim strategy must not run without a matching flag");
assert.ok(main.includes('ManagerFlags.hasPrefix("cleanBuild")') && main.includes('ManagerFlags.hasPrefix("blockRoom")'), "global flag utilities must use prefix gates");
assert.ok(main.includes('isCpuFeatureEnabled("combat")') && main.includes("ManagerFlags.hasAnyPrefix"), "advanced combat must remain dormant without its opt-in and flags");
for (const feature of ["market", "autoPlanner", "visual", "crossShard", "crossShardTrade", "claimCrossShard", "deposits", "GCLRoom", "combat"]) {
    assert.ok(mainMount.includes(`"${feature}"`), `${feature} must remain explicitly gated`);
}
const crossShard = fs.readFileSync(path.join(root, "modules/manager_crossShard.js"), "utf8");
assert.ok(!crossShard.includes("global.InterShardMemory = undefined"), "cross-shard manager must not shadow the game API");
assert.ok(!crossShard.includes("init(){\n        return;"), "cross-shard manager must be restorable behind its feature gate");
const crossShardClaim = fs.readFileSync(path.join(root, "modules/strategy_claimCrossShard.js"), "utf8");
assert.ok(!crossShardClaim.includes("String, body:"), "cross-shard spawn data must not leak an accidental String field");
const deposits = fs.readFileSync(path.join(root, "modules/strategy_deposits.js"), "utf8");
assert.ok(deposits.includes("let flag1 = Game.flags"), "deposit combat flag lookup must not leak a global");
assert.ok(mainMount.includes('"deposits"'), "deposit harvesting must require an explicit online opt-in");
assert.ok(mainMount.includes("autoPlanner: true") && mainMount.includes("visual: true"), "opt-in features must remain enableable without another upload");
assert.ok(!marketPrice.includes("pro.updatePrice()\nglobal.StrategyMarketPrice"), "market pricing must not run during script initialization");
assert.ok(market.includes("MARKET_SELL_PRICE_TTL = 1000"), "commodity profit prices must be cached across ticks");
assert.ok(market.includes("MARKET_ORDER_TTL = 20"), "market order queries must be cached across ticks");
assert.ok(market.includes(".commodities;"), "market strategy must consume the pricing result payload correctly");
assert.ok(prototypeRoom.includes("this._flagList = this._flagList || []"), "rooms without flags must expose an empty list");
assert.ok(betterMove.includes("let enableCpuStats = false"), "movement CPU instrumentation must default to off");
assert.ok(betterMove.includes("if (!enableCpuStats) return fn.apply(this, arguments)"), "normal moveTo calls must bypass analyzer timers");
assert.ok(betterMove.includes('!isCpuFeatureEnabled("visual")'), "legacy moveTo styles must obey the global visual gate");
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
