
global.isSaveCpu = true
global.MIN_CPU = false
global.WHO_AM_I = "an_w"
// Optional work is off by default only when it has no survival value. Override
// a value in Memory.cpuFeatures, for example: Memory.cpuFeatures.market = false.
global.CPU_FEATURES = {
    market: true,
    autoPlanner: true,
    visual: true,
    observer: true,
    outerHarvest: true,
    scouter: true,
    claim: true,
    cleanBuild: true,
    blockRoom: true,
    pillage: true,
    crossShard: true,
    crossShardTrade: true,
    claimCrossShard: true,
    deposits: true,
    powerBank: true,
    GCLRoom: true,
    combat: true,
}
global.CPU_OPT_IN_FEATURES = new Set(["market","autoPlanner","visual","crossShard","crossShardTrade","claimCrossShard","deposits","powerBank","GCLRoom","combat"])
global.isCpuFeatureEnabled = name => {
    let value = (Memory.cpuFeatures || {})[name];
    if(CPU_OPT_IN_FEATURES.has(name))return value === true && CPU_FEATURES[name] !== false;
    return value !== false && CPU_FEATURES[name] !== false;
}
// Creep and spawn naming always require the local shard identifier, even when
// the online cross-shard feature gate is temporarily disabled.
global.LOCAL_SHARD_NAME = Game.shard.name
global.RUNTIME_PROFILE = {
    version: "0.78.109",
    uploadedModules: 72,
    restoredSnapshotModules: 69,
    intentionallyExcluded: []
}

// 数据结构
require("algo_wasm_PriorityQueue")
require("algo_algorithm")

// class
require('class_RoomArray');

// helper
require('helper_consoleLogger');
require('helper_cpuUsed');
require('helper_roomResource');
require('helper_error');
require('helper_visual');
require('helper_consoleDashboard');

// tools and addition
require("utils");
require("utils_task");
require("超级移动优化hotfix 0.9.4");
require('极致建筑缓存 v1.4.3');
require('prototype_creep');
require('prototype_powerCreep');
require('prototype_room');
require('prototype_roomPostiton');
require('prototype_store');
require('prototype_flag');

require('manager_rooms');
require('manager_creeps');
require('manager_flags');
require('manager_planner');
require('manager_autoPlanner');
require('manager_missions');
require('manager_crossShard');

// Advanced combat is shipped as one dependency-complete package. Its tick
// dispatchers remain dormant until Memory.cpuFeatures.combat is explicitly set.
require('war_damageCal');
require('war_cache');
require('war_teamCore');
require('war_teamControl');
require('war_teamFlag');
require('war_attackRoom');
require('war_defenseCore');
require('war_powerCreepOperator');
require('teamL2');

require('station_defense');
require('station_sources');
require('station_minetral');
require('station_hive');
require('station_carry');
require('station_upgrade');
require('station_work');
require('station_tower');
require('station_lab');
require('station_factory');
require('station_observer');

require('strategy_lowLevel');
require('strategy_highLevel');
require('strategy_minSizeRoom');
require('strategy_factoryPowerCreep');
require('strategy_resourceBalance');
require('strategy_outerHarvest');
require('strategy_scouter');
require('strategy_marketPrice');
require('strategy_market');
require('strategy_claim');
require('strategy_tradeCrossShard');
require('strategy_claimCrossShard');
require('strategy_cleanBuild');
require('strategy_blockRoom');
require('strategy_pillage');
require('strategy_deposits');
require('strategy_powerBank');
require('strategy_GCLRoom');
require('strategy_atkL2');
require('strategy_defenserHighWay');
require('team_raL1');

// 闲聊（creep 气泡）。语料 = 模块顶部那一行 `global.Talk = [...]`，换语料只改那里。
// 默认开；`Memory.cpuFeatures.chat = false` 可关。调用点在 main.js 的 exec() 尾巴上。
require('闲聊 v1.0');
// 语料（由 scripts/build-chat-corpus.cjs 从本地歌词包生成）：非空则优先于内置语料。
require('闲聊语料自定义');
