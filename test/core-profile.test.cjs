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
const managerCreeps = fs.readFileSync(path.join(root, "modules/manager_creeps.js"), "utf8");
const main = fs.readFileSync(path.join(root, "modules/main.js"), "utf8");
const prototypeRoom = fs.readFileSync(path.join(root, "modules/prototype_room.js"), "utf8");
const prototypeCreep = fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8");
const stationUpgrade = fs.readFileSync(path.join(root, "modules/station_upgrade.js"), "utf8");
const stationDefense = fs.readFileSync(path.join(root, "modules/station_defense.js"), "utf8");
const warTeamCore = fs.readFileSync(path.join(root, "modules/war_teamCore.js"), "utf8");
const warTeamFlag = fs.readFileSync(path.join(root, "modules/war_teamFlag.js"), "utf8");
const highwayDefense = fs.readFileSync(path.join(root, "modules/strategy_defenserHighWay.js"), "utf8");
const attackRoom = fs.readFileSync(path.join(root, "modules/war_attackRoom.js"), "utf8");
const warCache = fs.readFileSync(path.join(root, "modules/war_cache.js"), "utf8");
const teamRaL1 = fs.readFileSync(path.join(root, "modules/team_raL1.js"), "utf8");
const strategyAtkL2 = fs.readFileSync(path.join(root, "modules/strategy_atkL2.js"), "utf8");
const strategyClaim = fs.readFileSync(path.join(root, "modules/strategy_claim.js"), "utf8");
const strategyLowLevel = fs.readFileSync(path.join(root, "modules/strategy_lowLevel.js"), "utf8");
const strategyHighLevel = fs.readFileSync(path.join(root, "modules/strategy_highLevel.js"), "utf8");
const stationObserver = fs.readFileSync(path.join(root, "modules/station_observer.js"), "utf8");
const strategyPowerBank = fs.readFileSync(path.join(root, "modules/strategy_powerBank.js"), "utf8");
const strategyDeposits = fs.readFileSync(path.join(root, "modules/strategy_deposits.js"), "utf8");
const strategyCleanBuild = fs.readFileSync(path.join(root, "modules/strategy_cleanBuild.js"), "utf8");
const betterMove = fs.readFileSync(path.join(root, "modules/超级移动优化hotfix 0.9.4.js"), "utf8");
const market = fs.readFileSync(path.join(root, "modules/strategy_market.js"), "utf8");
const marketPrice = fs.readFileSync(path.join(root, "modules/strategy_marketPrice.js"), "utf8");
const consoleDashboard = fs.readFileSync(path.join(root, "modules/helper_consoleDashboard.js"), "utf8");
const consoleLogger = fs.readFileSync(path.join(root, "modules/helper_consoleLogger.js"), "utf8");
const roomResource = fs.readFileSync(path.join(root, "modules/helper_roomResource.js"), "utf8");
const cpuHelper = fs.readFileSync(path.join(root, "modules/helper_cpuUsed.js"), "utf8");
const strategyOuterHarvest = fs.readFileSync(path.join(root, "modules/strategy_outerHarvest.js"), "utf8");
const stationSources = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

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
assert.ok(strategyOuterHarvest.includes("!Game.rooms[targetRoomName]"), "lost remote vision must respawn a scoped scout instead of trusting stale Memory");
assert.ok(managerRooms.indexOf("StrategyOuterHarvest.exec(room)") < managerRooms.indexOf("StrategyHighLevel.exec(room)"), "remote economy must request Spawn capacity before background high-level workers");
assert.ok(stationSources.includes("let roadDir = task.roadDir == -1 ? -1 : 1"), "legacy road-builder tasks must default to a valid route direction");
assert.ok(manifest.includes("strategy_scouter"), "flag-driven scouts must have their task handlers loaded");
assert.ok(manifest.includes("strategy_marketPrice") && manifest.includes("strategy_market"), "market runtime and pricing dependency must ship together");
assert.ok(manifest.includes("strategy_claim"), "claim task handlers must ship with planner dependencies");
assert.ok(manifest.includes("strategy_cleanBuild") && manifest.includes("strategy_blockRoom") && manifest.includes("strategy_pillage"), "flag utility task handlers must be restored together");
assert.ok(manifest.includes("strategy_deposits"), "deposit task handlers must remain available behind their opt-in");
assert.ok(manifest.includes("strategy_powerBank"), "Power Bank task handlers must remain available behind their opt-in");
assert.ok(manifest.includes("strategy_GCLRoom"), "GCL room task handlers must remain available behind their opt-in");
for (const moduleName of ["war_damageCal", "war_cache", "war_teamCore", "war_teamControl", "war_teamFlag", "war_attackRoom", "war_defenseCore", "war_powerCreepOperator", "teamL2", "strategy_atkL2", "strategy_defenserHighWay"]) {
    assert.ok(manifest.includes(moduleName), `combat package must include ${moduleName}`);
}
assert.ok(manifest.includes("helper_visual") && manifest.includes("manager_planner") && manifest.includes("manager_autoPlanner"), "planner dependencies must ship together");
assert.ok(manifest.includes("helper_consoleDashboard"), "on-demand console dashboard must ship in the runtime package");
assert.ok(manifest.includes("helper_consoleLogger"), "central colored logger must ship before runtime modules");
assert.ok(consoleLogger.includes("[${definition.label}]") && consoleLogger.includes("colorizeResources"), "text logs must include colored levels and resource tokens");
assert.ok(consoleLogger.includes("escapeHtml(text)"), "text logs must escape dynamic content before rich output");
assert.ok(consoleDashboard.includes("global.dash"), "console dashboard must expose the short dash() command");
assert.ok(consoleDashboard.includes("console.logUnsafe(output)"), "rich dashboard output must use the post-security-update console API");
assert.ok(consoleDashboard.includes("Object.keys(object.store)"), "resource details must exclude enumerable Store prototype helpers");
assert.ok(consoleDashboard.includes('addEventListener("pointerenter"') && consoleDashboard.includes('addEventListener("click"') && consoleDashboard.includes("Modules & feature gates"), "dashboard details must support both stable hover and click interactions");
assert.ok(consoleDashboard.includes("global.dash.help"), "dashboard must explain its callable console syntax");
assert.ok(roomResource.includes("console.logUnsafe(html)"), "resource reports must use the rich console API");
assert.ok(roomResource.includes('addEventListener("pointerenter"') && roomResource.includes("tip.innerHTML"), "room resource details must use local console tooltips without an external chart dependency");
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
assert.ok(main.includes("CPU_PROFILE_INTERVAL = 97"), "detailed CPU profiling must use a low-frequency prime interval to avoid aliasing");
assert.ok(main.includes("OPTIONAL_CPU_OFFSETS") && main.includes("marketAutoBuy:19") && main.includes("autoPlanner:7") && main.includes("visual:3"), "optional jobs must use separate CPU schedule offsets");
assert.ok(main.includes("room.controller.ticksToDowngrade < 20000"), "upgrader throttling must preserve controllers near downgrade");
assert.ok(main.includes("Game.cpu.bucket < 9950) return 2"), "near-full buckets must ramp upgrader CPU smoothly");
assert.ok(main.includes("Game.cpu.bucket >= 6000") && !main.includes("plannerAverage <"), "auto planner must stay enabled above the bucket safety floor");
assert.ok(main.includes("health.autoPlanner"), "auto planner CPU must be measured online");
assert.ok(stationUpgrade.includes("getUpgradePosition(creep, controller") && stationUpgrade.includes("upgradePosition"), "upgraders must reserve independent controller positions");
assert.ok(stationUpgrade.includes("CONTROLLER_SIGNS") && stationUpgrade.includes("trySignController(creep)"), "owned controllers must receive the curated sign set");
const signArraySource = stationUpgrade.match(/let CONTROLLER_SIGNS = (\[[\s\S]*?\n\]);/)[1];
const controllerSigns = vm.runInNewContext(signArraySource);
assert.equal(new Set(controllerSigns).size, controllerSigns.length, "controller sign source texts must be unique");
assert.ok(controllerSigns.every(sign => !sign.includes("—") && sign.length <= 100), "controller signs must omit authors and fit the API limit");
assert.ok(stationUpgrade.includes("Memory.controllerSignAssignments") && stationUpgrade.includes("used.has(sign)"), "owned rooms must reserve unique controller signs");
assert.ok(prototypeCreep.includes("StationUpgrade.trySignController(this)"), "all owned rooms need a creep-independent signing hook");
assert.ok(main.includes("&& shouldRunCreep(e)"), "creep execution must apply the safe adaptive throttle");
assert.ok(mainMount.includes("global.isCpuFeatureEnabled"), "optional modules must share one runtime feature gate");
assert.ok(mainMount.includes("observer: true"), "observer scanning must be switchable without another upload");
assert.ok(mainMount.includes("outerHarvest: true"), "remote harvesting must be switchable without another upload");
assert.ok(managerFlags.includes("hasPrefix (prefix)"), "dormant flag strategies must have an allocation-free gate");
assert.ok(managerFlags.includes("hasAnyPrefix (prefixes)"), "combat dispatch must support a shared prefix gate");
assert.ok(managerFlags.includes("getFlagsByPrefixAndRoom(prefix, roomName)"), "remote missions must be indexed by their encoded spawn room");
assert.ok(managerFlags.includes("Memory.pendingSpawnTeams") && managerFlags.includes("Game.flags[name]"), "new spawn-team Memory must survive flag visibility delay");
assert.ok(managerCreeps.includes("Game._alivePowerCreeps"), "Power Creep management must share one filtered tick list");
assert.ok(!managerCreeps.includes("_.keys(creeps)"), "creep grouping must avoid a temporary Lodash key array");
assert.ok(main.includes('ManagerFlags.hasPrefix("moveto")'), "scouter strategy must not run without a matching flag");
assert.ok(main.includes('ManagerFlags.hasPrefix("claim")'), "claim strategy must not run without a matching flag");
assert.ok(strategyClaim.includes("flag.memory.spawnRoom"), "claim operations must support a pinned safe spawn room");
assert.ok(strategyClaim.includes("Creep.prototype.clearClaimRoom") && strategyClaim.includes('this.memory.role = "worker"'), "claim cleanup must automatically become a bootstrap worker");
assert.ok(strategyClaim.includes("[WORK]: 5") && strategyClaim.includes("[CARRY]: 5") && strategyClaim.includes("[MOVE]: 5"), "claim cleanup must use a bounded reusable body");
assert.ok(strategyClaim.includes("claimCleanupTarget") && strategyClaim.includes("findClosestByRange(FIND_STRUCTURES"), "claim cleanup must cache targets instead of path-searching every tick");
assert.ok(strategyClaim.includes("ensureConstructionSites") && strategyClaim.includes("createConstructionSite(STRUCTURE_SPAWN)") && strategyClaim.includes("[STRUCTURE_EXTENSION, STRUCTURE_CONTAINER]"), "claim operations must create blueprint bootstrap sites automatically");
assert.ok(!strategyLowLevel.includes("room.level > 1 && StationWork.constructionNeedBuild"), "RCL1 workers must be allowed to build the first spawn");
assert.ok(strategyLowLevel.includes("if (global.ManagerAutoPlanner) ManagerAutoPlanner.tryAutoBuildLowLevel0(room)"), "saved low-RCL blueprints must build without the optional planner gate");
assert.ok(strategyLowLevel.includes("if (global.ManagerAutoPlanner) ManagerAutoPlanner.tryAutoBuildLowLevel800(room)"), "RCL3 blueprint construction must remain essential room maintenance");
assert.ok(strategyClaim.includes("StationObserver.requestRoom") && strategyClaim.includes("priorityVisibleTick == Game.time"), "claim operations must consume scheduled Observer vision automatically");
assert.ok(stationObserver.includes("PriorityObserveRoomQueue") && stationObserver.includes("getRoomLinearDistance"), "claim observations must use a range-checked priority queue");
assert.ok(strategyClaim.includes("room.find(FIND_MY_SPAWNS)") && !strategyClaim.includes("targetRoom.spawn.length>0"), "hostile spawns must never complete a claim operation");
assert.ok(strategyClaim.includes("isClaimCleanupTarget") && strategyClaim.includes("!isPlannedClaimStructure"), "claim cleanup must remove non-blueprint neutral blockers as well as hostile structures");
assert.ok(strategyClaim.includes("global.claimLog") && strategyClaim.includes("Memory.claimOperations"), "claim operations must retain bounded diagnostics for later inspection");
assert.ok(strategyClaim.includes("operation.history.length > 40"), "claim diagnostics must not grow Memory without a bound");
assert.ok(strategyCleanBuild.includes("FIND_HOSTILE_STRUCTURES") && strategyCleanBuild.includes("!structure.my"), "claim cleanup must remove hostile structures that block a new spawn");
assert.ok(main.includes('ManagerFlags.hasPrefix("cleanBuild")') && main.includes('ManagerFlags.hasPrefix("blockRoom")'), "global flag utilities must use prefix gates");
assert.ok(main.includes('isCpuFeatureEnabled("combat")') && main.includes("ManagerFlags.hasAnyPrefix"), "advanced combat must remain dormant without its opt-in and flags");
for (const feature of ["market", "autoPlanner", "visual", "crossShard", "crossShardTrade", "claimCrossShard", "deposits", "powerBank", "GCLRoom", "combat"]) {
    assert.ok(mainMount.includes(`"${feature}"`), `${feature} must remain explicitly gated`);
}
const crossShard = fs.readFileSync(path.join(root, "modules/manager_crossShard.js"), "utf8");
assert.ok(!crossShard.includes("global.InterShardMemory = undefined"), "cross-shard manager must not shadow the game API");
assert.ok(!crossShard.includes("init(){\n        return;"), "cross-shard manager must be restorable behind its feature gate");
assert.ok(crossShard.includes("pro.localShardData && pro.dirty"), "cross-shard state must only serialize after a material change");
assert.ok(crossShard.includes("Unknown cross-shard mission"), "unknown remote handlers must be rejected without throwing");
const crossShardClaim = fs.readFileSync(path.join(root, "modules/strategy_claimCrossShard.js"), "utf8");
assert.ok(!crossShardClaim.includes("String, body:"), "cross-shard spawn data must not leak an accidental String field");
const deposits = fs.readFileSync(path.join(root, "modules/strategy_deposits.js"), "utf8");
assert.ok(!deposits.includes('"raL3_"') && !deposits.includes("raL3_E49S31_1"), "Deposit harvesting must not create unrelated RaL combat flags");
assert.ok(mainMount.includes('"deposits"'), "deposit harvesting must require an explicit online opt-in");
assert.ok(mainMount.includes('"powerBank"'), "Power Bank harvesting must require an explicit online opt-in");
assert.ok(stationObserver.includes('isCpuFeatureEnabled("powerBank")'), "Observer Power Bank scans must share the feature gate");
assert.ok(managerRooms.includes('isCpuFeatureEnabled("powerBank")') && managerRooms.includes('ManagerFlags.hasPrefix("powerBank")'), "Power Bank room dispatch must remain dormant without missions");
assert.ok(deposits.includes('ManagerFlags.getFlagsByPrefixAndRoom("deposit", room.name)'), "Deposit missions must execute in the spawn room encoded in their flag name");
assert.ok(strategyPowerBank.includes('ManagerFlags.getFlagsByPrefixAndRoom("powerBank", room.name)'), "Power Bank missions must execute in the spawn room encoded in their flag name");
assert.ok(strategyPowerBank.includes("execSpawnTeams()") && strategyPowerBank.includes("AttackerPB") && strategyPowerBank.includes("HealerPB"), "Power Bank teams must spawn even when general combat is disabled");
assert.ok(strategyPowerBank.includes("flag.memory.directSpawnQueue") && strategyPowerBank.includes("dispatchPBSpawnQueue"), "Power Bank teams must keep their pair queue on the persistent PB mission flag");
assert.ok(strategyPowerBank.includes("hasValidMissionData") && strategyPowerBank.includes("typeof memory.id == \"string\""), "stale PB flags must be rejected before they can create an orphaned attacker");
assert.ok(strategyPowerBank.includes("taskData(flag, index)") && strategyPowerBank.includes("flagName: flag.name"), "PB creep tasks must snapshot their flag and target fields explicitly");
assert.ok(strategyPowerBank.includes("flag.memory.lastSpawnTime = Game.time"), "Power Bank respawn requests must be throttled by persistent mission state");
assert.ok(strategyPowerBank.includes("while (queue.spawnList.length)") && strategyPowerBank.includes("activeQueues[flag.name]"), "Power Bank attacker/healer queues must dispatch together when capacity permits");
assert.ok(main.includes("StrategyPowerBank.execSpawnTeams()"), "main loop must independently dispatch Power Bank spawn teams");
assert.ok(mainMount.includes("autoPlanner: true") && mainMount.includes("visual: true"), "opt-in features must remain enableable without another upload");
assert.ok(main.includes("Game.cpu.bucket >= 6000"), "optional auto-planning must keep the bucket safety guard");
assert.ok(!marketPrice.includes("pro.updatePrice()\nglobal.StrategyMarketPrice"), "market pricing must not run during script initialization");
assert.ok(market.includes("MARKET_SELL_PRICE_TTL = 1000"), "commodity profit prices must be cached across ticks");
assert.ok(market.includes("MARKET_ORDER_TTL = 100"), "market order queries must be cached across ticks");
assert.ok(market.includes(".commodities;"), "market strategy must consume the pricing result payload correctly");
assert.ok(market.includes("MARKET_MAX_COMMODITY_DEAL") && market.includes("MARKET_MIN_COMMODITY_DEAL"), "commodity sales must use bounded economical deal sizes");
assert.ok(market.includes("item.level > 0") && market.includes("item.profitMargin >= minimumMargin"), "automatic sales must select profitable higher-level commodities");
assert.ok(marketPrice.includes("COMMODITY_ANALYSIS_TTL = 5000") && marketPrice.includes("commodityAnalysisCache"), "reaction-chain pricing must be cached at a low-frequency interval");
assert.ok(marketPrice.includes("reactionDepth") && marketPrice.includes("minimumSellPrice"), "commodity analysis must expose full reaction depth and cost-based sale floors");
assert.ok(marketPrice.includes("Memory.marketCommodityAnalysis"), "commodity profitability summaries must remain inspectable in Memory");
assert.ok(prototypeRoom.includes("this._flagList = this._flagList || []"), "rooms without flags must expose an empty list");
assert.ok(prototypeRoom.includes("getHostileCreeps") && prototypeRoom.includes("getHostileStructures"), "tactical room queries must be cached per tick");
assert.ok(prototypeRoom.includes("getStructures"), "combat cost matrices must share a per-tick structure scan");
assert.ok(prototypeRoom.includes("_cpuHostileCreepCache") && !prototypeRoom.includes("this._hostileCreeps"), "tactical cache keys must not collide with engine Room internals");
assert.ok(prototypeRoom.includes("Array.isArray(this._cpuHostileCreepCache)"), "Room tactical caches must tolerate the structure-cache prototype Proxy");
assert.ok(stationDefense.includes("checkSafeMode(room, hostiles)"), "safe-mode detection must reuse the immediate hostile scan");
assert.ok(stationDefense.includes("getRepairWorkerLimit(room)") && stationDefense.includes("target * 0.6") && !stationDefense.includes("return 3;"), "near-target ramparts must use one maintenance worker, with only severe deficits scaling to two");
assert.ok(strategyHighLevel.includes("workerLimit") && strategyHighLevel.includes("Math.floor((room.constructionSite.length - 1) / 5)") && !strategyHighLevel.includes("(room.storage.store[RESOURCE_ENERGY] - 250000) / 50000"), "only large construction batches may raise the bounded worker count");
assert.ok(warTeamCore.includes("hostileCreepsByRoom") && warTeamCore.includes("hostileTowersByRoom"), "team damage calculation must share tactical room scans");
assert.ok(warTeamCore.includes("hasSpawnList(flag)") && warTeamCore.includes("Removing invalid spawnTeam flag"), "invalid spawn-team flags must be removed before reading spawnList");
assert.ok(warTeamCore.includes("SPAWN_TEAM_TTL") && warTeamCore.includes("Removing expired spawnTeam flag"), "spawn-team queues expire instead of becoming permanent CPU work");
assert.ok(main.includes("global.TeamRaL1 && isCpuFeatureEnabled(\"combat\")"), "RaL combat spawning honours the emergency combat switch");
assert.ok(teamRaL1.includes("if (!flag) {") && teamRaL1.includes("this.suicide()"), "orphaned RaL creeps must stop safely when their flag is removed");
assert.ok(warTeamFlag.includes("hasPendingSpawnTeam") && warTeamFlag.includes("!pro.hasPendingSpawnTeam(r4.room.name)"), "persistent r4 flags cannot accumulate spawn queues");
assert.ok(consoleDashboard.includes("moduleCpu && Memory.codeHealth.moduleCpu.rooms") && consoleDashboard.includes("avg profile CPU"), "dashboard uses stable room CPU aggregates instead of a single spike");
assert.ok(!highwayDefense.includes("log(code,PathFinder.search"), "highway flee must never repeat PathFinder just for logging");
assert.ok(attackRoom.includes("attackRoomTargetUntil"), "attack-room creeps must keep a short-lived selected target");
assert.ok(warCache.includes("cacheStructsTime[roomName] != Game.time"), "combat structure snapshots must refresh at most once per room per tick");
assert.ok(teamRaL1.includes("raL1TargetUntil") && strategyAtkL2.includes("atkL2TargetUntil"), "legacy combat creeps must reuse selected targets briefly");
assert.ok(betterMove.includes("let enableCpuStats = false"), "movement CPU instrumentation must default to off");
assert.ok(betterMove.includes("if (!enableCpuStats) return fn.apply(this, arguments)"), "normal moveTo calls must bypass analyzer timers");
assert.ok(betterMove.includes('!isCpuFeatureEnabled("visual")'), "legacy moveTo styles must obey the global visual gate");
assert.ok(betterMove.includes("setCpuStats(bool)"), "movement CPU instrumentation must remain explicitly switchable");
assert.ok(betterMove.includes("Memory.betterMoveAvoidRooms"), "manual route exclusions must survive global resets");
assert.ok(cpuHelper.includes("recordLongTerm(cpu)") && cpuHelper.includes("longTermSummary()"), "CPU telemetry must persist exact long-window statistics");
assert.ok(cpuHelper.includes("recordProfile(profile)") && cpuHelper.includes("profileSummary()"), "CPU telemetry must retain phase, role, and room profile averages");
assert.ok(cpuHelper.includes("room && room.my") && cpuHelper.includes("lastRoomPrune"), "CPU telemetry must ignore observer-only room samples and prune old snapshots");
assert.ok(strategyPowerBank.includes("recordMissionDecision") && strategyPowerBank.includes("skip:insufficient-decay"), "PB observation must retain one compact mission-decision diagnostic");
assert.ok(strategyPowerBank.includes("Memory.pendingPowerBanks") && managerFlags.includes("pendingPowerBanks"), "PB Flag data must survive createFlag's delayed visibility");
assert.ok(strategyPowerBank.includes("let MIN_DECAY = 4200"), "PB launches must reserve the safe 4,200-tick lifetime window");
assert.ok(strategyPowerBank.includes("!Game.flags[flagName]") && !strategyPowerBank.includes("delete Memory.flags[flagName]"), "PB Flag creation must trust visible Flags even when createFlag returns undefined");
assert.ok(managerRooms.indexOf("let powerBankActive") < managerRooms.indexOf("StrategyHighLevel.exec(room)"), "PB healer queues must dispatch before background room spawning");
assert.ok(managerFlags.includes("_flagPendingAt") && strategyDeposits.includes("Memory.flags[flagName]"), "Deposit and dynamic Flag Memory must survive delayed Flag visibility");
assert.ok(cpuHelper.includes("console.logUnsafe(output)"), "CPU charts must use the rich console API");
assert.ok(marketPrice.includes('console.logUnsafe(html)') && marketPrice.includes("printCommodityAnalysis"), "market HTML reports must use the rich console API");

const loggerOutput = [];
const loggerContext = {
    Game: {time: 123},
    RESOURCES_ALL: ["energy", "power"],
    console: {log() {}, logUnsafe(html) { loggerOutput.push(html); }},
};
loggerContext.global = loggerContext;
vm.runInNewContext(consoleLogger, loggerContext);
loggerContext.console.log("storage full", "energy");
loggerContext.Logger.error("failed", "power");
assert.ok(loggerOutput[0].includes("[WARNING]") && loggerOutput[0].includes("energy</span>"), "automatic warnings must color resource tokens");
assert.ok(loggerOutput[1].includes("[ERROR]") && loggerOutput[1].includes("power</span>"), "explicit errors must render with resource colors");

assert.ok(main.includes("HelperCpuUsed.recordLongTerm(Game.cpu.getUsed())"), "long-window CPU telemetry must record every completed tick");
assert.ok(main.includes("HelperCpuUsed.recordProfile(Game._coreCpuProfile)"), "low-frequency profiles must feed persistent module telemetry");
assert.ok(main.includes("moduleCpu: HelperCpuUsed.profileSummary()"), "module CPU averages must remain inspectable in code health");
assert.ok(main.includes("Game.time - previousHealth.lastErrorTick > 5000"), "stale code-health errors must expire from Memory");
assert.equal((fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8").match(/Creep\.prototype\.headTask =/g) || []).length, 1, "headTask must have one canonical definition");
assert.ok(!main.includes("space_action") && !main.includes("let P0"), "dead account-specific tick actions must stay removed");
assert.ok(!main.includes("_.keys(WAKE_TASK)"), "wake tasks must not allocate a Lodash key array every tick");
assert.ok(managerRooms.includes("let roomHash = room.hashCode()"), "room management must calculate its scheduling hash only once per room tick");
assert.ok(!stationHive.includes("spawnFailue"), "spawn failure guard must use the corrected property name");
execFileSync(process.execPath, [path.join(root, "scripts/audit-core-tasks.cjs")], { stdio: "inherit" });

const context = {
    Memory: {},
    Game: {
        time: 0,
        rooms: {E1S1: {my: true}, E9S9: {my: false}},
        cpu: {
            bucket: 9000,
            getUsed() { return context.Game.time / 5; },
        },
    },
    console: { log() {} },
};
context.global = context;
vm.runInNewContext(fs.readFileSync(path.join(root, "modules/helper_cpuUsed.js"), "utf8"), context);

context.Game.time = 100;
context.HelperCpuUsed.recordProfile({init:1, unitTasks:4, unitRoles:{carrier:2}, roomDetails:{E1S1:3}});
context.Game.time = 200;
context.HelperCpuUsed.recordProfile({init:3, unitTasks:6, unitRoles:{carrier:4}, roomDetails:{E1S1:1}});
const moduleCpu = context.HelperCpuUsed.profileSummary();
assert.equal(moduleCpu.samples, 2);
assert.equal(moduleCpu.phases.init.average, 2);
assert.equal(moduleCpu.roles.carrier.average, 3);
assert.equal(moduleCpu.rooms.E1S1.average, 2);
context.Game.time = 1200;
context.HelperCpuUsed.recordProfile({roomDetails:{E9S9:9}});
assert.equal(context.HelperCpuUsed.profileSummary().rooms.E9S9, undefined, "observer-only room timings must not enter persistent telemetry");

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
