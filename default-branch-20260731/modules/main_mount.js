
global.isSaveCpu = true
global.MIN_CPU = false
global.WHO_AM_I = "an_w"
// Optional work is off by default only when it has no survival value. Override
// a value in Memory.cpuFeatures, for example: Memory.cpuFeatures.market = false.
global.CPU_FEATURES = {
    market: true,
    autoPlanner: false,
    visual: false,
    observer: true,
    outerHarvest: true,
    scouter: true,
}
global.CPU_OPT_IN_FEATURES = new Set(["market"])
global.isCpuFeatureEnabled = name => {
    let value = (Memory.cpuFeatures || {})[name];
    if(CPU_OPT_IN_FEATURES.has(name))return value === true && CPU_FEATURES[name] !== false;
    return value !== false && CPU_FEATURES[name] !== false;
}
// Cross-shard management is intentionally disabled in the core profile, but
// creep and spawn naming still require the local shard identifier.
global.LOCAL_SHARD_NAME = Game.shard.name

// 数据结构
require("algo_wasm_PriorityQueue")
require("algo_algorithm")

// class
require('class_RoomArray');

// helper
require('helper_cpuUsed');
require('helper_roomResource');
require('helper_error');

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
require('team_raL1');
// Optional modules are intentionally not loaded in the 20 CPU bootstrap
// profile. Reintroduce only one group at a time after measuring its impact:
// helper_visual, station_lab, station_observer, station_factory,
// manager_crossShard, manager_autoPlanner, manager_planner, war_cache,
// war_*, team*, strategy_outerHarvest, strategy_pillage, strategy_market,
// strategy_claim*, strategy_deposits, strategy_powerBank, and the remaining
// expansion/combat strategies.





