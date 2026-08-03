require("main_mount");
Logger.info("Script reload", "bucket", Game.cpu.bucket, "version", RUNTIME_PROFILE.version);

const CPU_PROFILE_INTERVAL = 97;
const OPTIONAL_CPU_OFFSETS = {marketAutoBuy:19, autoPlanner:7, visual:3};


let pro = {
    init() {
        // Preserve the manual switch while entering low-CPU mode early enough
        // to protect the 20 CPU baseline from a draining bucket.
        MIN_CPU = !!Memory.mincpu || Game.cpu.bucket < 2000;
        if (MIN_CPU && Game.time % 100 == 0) console.log("warning : min cpu on")
        let objects = getTickObjects();
        objects.rooms.forEach(room => room.used = {});
        if (global.ManagerCrossShard && isCpuFeatureEnabled("crossShard")) HelperError.catchError(() => ManagerCrossShard.init());
        if (global.ManagerMissions) HelperError.catchError(() => ManagerMissions.init());// 依赖 ManagerCrossShard
        HelperError.catchError(() => ManagerCreeps.init());
        HelperError.catchError(() => ManagerRooms.init());
        HelperError.catchError(() => ManagerFlags.init());
    },
    exec() {
        let objects = getTickObjects();
        let cpuProfile = Game._coreCpuProfile;
        let phaseStart = cpuProfile ? Game.cpu.getUsed() : 0;
        HelperError.runEach(objects.creeps, e => e.execRegFun());
        HelperError.runEach(objects.powerCreeps, e => e.ticksToLive && e.execRegFun());
        if (cpuProfile) {
            cpuProfile.registration = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }

        // 出击！
        if (global.teamL2 && isCpuFeatureEnabled("combat") && ManagerFlags.hasAnyPrefix(["teamL1","teamL2","teamL4"])) HelperError.catchError(() => teamL2.exec());
        if (global.StrategyAtkl2 && isCpuFeatureEnabled("combat") && ManagerFlags.hasPrefix("l2")) HelperError.catchError(() => StrategyAtkl2.exec());
        // RaL teams are offensive actions. They used to bypass the combat
        // switch, so an emergency combat pause could still enqueue combat
        // creeps every three ticks.
        if (global.TeamRaL1 && isCpuFeatureEnabled("combat")
            && ManagerFlags.hasAnyPrefix(["raL1", "raL2", "raL3", "raL4", "raL5"])) {
            HelperError.catchError(() => TeamRaL1.exec());
        }
        if (global.WarDefenseCore && isCpuFeatureEnabled("combat") && ManagerFlags.hasAnyPrefix(["defense","defenseAH","defenseRA"])) HelperError.catchError(() => WarDefenseCore.exec());
        if (global.WarPowerCreepOperator && isCpuFeatureEnabled("combat") && ManagerFlags.hasAnyPrefix(["disCtrl","OPSCarry","PCAtk","showDisSpawn"])) HelperError.catchError(() => WarPowerCreepOperator.exec());

        // 配置资源
        let warTeamEnabled = global.WarTeamFlag && isCpuFeatureEnabled("combat")
            && ManagerFlags.hasAnyPrefix(["f4team","f2team","spawnTeam","target","team","r4","r1","a4","a2","w2"]);
        if (warTeamEnabled) HelperError.catchError(() => WarTeamFlag.exec());
        else if (global.StrategyPowerBank && isCpuFeatureEnabled("powerBank") && ManagerFlags.hasPrefix("spawnTeam"))
            HelperError.catchError(() => StrategyPowerBank.execSpawnTeams());
        if (global.WarAttackRoom && isCpuFeatureEnabled("combat") && ManagerFlags.hasPrefix("warAttackRoom")) HelperError.catchError(() => WarAttackRoom.exec());
        if (cpuProfile) {
            cpuProfile.commands = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }
        if (cpuProfile) {
            cpuProfile.roomDetails = {};
            HelperError.runEachProfiled(objects.rooms, room => ManagerRooms.exec(room), room => room.name, cpuProfile.roomDetails);
        } else HelperError.runEach(objects.rooms, room => ManagerRooms.exec(room));
        if (cpuProfile) {
            cpuProfile.rooms = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }
        if (global.StrategyTradeCrossShard && isCpuFeatureEnabled("crossShard") && isCpuFeatureEnabled("crossShardTrade")) HelperError.catchError(() => StrategyTradeCrossShard.exec());
        if (global.StrategyClaim && isCpuFeatureEnabled("claim") && ManagerFlags.hasPrefix("claim")) HelperError.catchError(() => StrategyClaim.exec());
        if (global.StrategyClaimCrossShard && isCpuFeatureEnabled("crossShard") && isCpuFeatureEnabled("claimCrossShard") && ManagerFlags.hasPrefix("claimCrossShard")) HelperError.catchError(() => StrategyClaimCrossShard.exec());
        if (global.StrategyScouter && isCpuFeatureEnabled("scouter") && ManagerFlags.hasPrefix("moveto")) HelperError.catchError(() => StrategyScouter.exec());
        if (global.StrategyFactoryPowerCreep) HelperError.catchError(() => StrategyFactoryPowerCreep.exec());
        if (global.StrategyCleanBuild && isCpuFeatureEnabled("cleanBuild") && ManagerFlags.hasPrefix("cleanBuild")) HelperError.catchError(() => StrategyCleanBuild.exec());
        if (global.StrategyBlockRoom && isCpuFeatureEnabled("blockRoom") && ManagerFlags.hasPrefix("blockRoom")) HelperError.catchError(() => StrategyBlockRoom.exec());
        if (cpuProfile) {
            cpuProfile.flagStrategies = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }

        let activeCreeps = objects.creeps.filter(e => (!MIN_CPU || ROLE_PRIORITY[e.memory.role] > 0) && shouldRunCreep(e));
        if (cpuProfile) {
            cpuProfile.unitRoles = {};
            HelperError.runEachProfiled(objects.powerCreeps, e => e.spawning || (e.ticksToLive && e.execLastTask()), e => "power:" + (e.memory.role || "unknown"), cpuProfile.unitRoles);
            HelperError.runEachProfiled(activeCreeps, e => e.spawning || e.execLastTask(), e => e.memory.role || "unknown", cpuProfile.unitRoles);
        } else {
            HelperError.runEach(objects.powerCreeps, e => e.spawning || (e.ticksToLive && e.execLastTask()));
            HelperError.runEach(activeCreeps, e => e.spawning || e.execLastTask());
        }
        if (cpuProfile) {
            cpuProfile.unitTasks = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }

        // These jobs do not keep creeps alive or defend a room. Spread them
        // over several ticks and make them independently switchable in Memory.
        if (!MIN_CPU && global.StrategyMarket && isCpuFeatureEnabled("market") && HelperCpuUsed.shouldRun(5)) {
            let batch = Math.floor(Game.time / 5) % 4;
            for(let index=batch;index<objects.rooms.length;index+=4){
                HelperError.catchError(() => StrategyMarket.exec(objects.rooms[index]), objects.rooms[index].name);
            }
        }
        if (!MIN_CPU && global.StrategyMarket && isCpuFeatureEnabled("market")
            && HelperCpuUsed.shouldRun(100, OPTIONAL_CPU_OFFSETS.marketAutoBuy))
            HelperError.catchError(() => StrategyMarket.autoBuy());
        if (!MIN_CPU && global.ManagerAutoPlanner && isCpuFeatureEnabled("autoPlanner")
            && Game.cpu.bucket >= 6000
            && HelperCpuUsed.shouldRun(25, OPTIONAL_CPU_OFFSETS.autoPlanner))
            HelperError.catchError(() => {
                let plannerStart = Game.cpu.getUsed();
                ManagerAutoPlanner.exec();
                let used = Game.cpu.getUsed() - plannerStart;
                let health = Memory.codeHealth = Memory.codeHealth || {};
                let stats = health.autoPlanner = health.autoPlanner || {samples:0,total:0,max:0};
                stats.samples++;
                stats.total += used;
                stats.average = stats.total / stats.samples;
                stats.last = used;
                stats.max = Math.max(stats.max, used);
                stats.lastTick = Game.time;
            });
        if (!MIN_CPU && global.HelperVisual && isCpuFeatureEnabled("visual")
            && HelperCpuUsed.shouldRun(10, OPTIONAL_CPU_OFFSETS.visual))
            HelperError.catchError(() => HelperVisual.exec());
        if (cpuProfile) cpuProfile.optional = Game.cpu.getUsed() - phaseStart;
    },
    afterWork() {
        if (global.ManagerCrossShard && isCpuFeatureEnabled("crossShard")) HelperError.catchError(() => ManagerCrossShard.afterWork());
    }
};

/**
 * 命令行执行
 * task 返回 有值 时 tryTime-- ,并且打印结果\
 * 返回 "done" 表示任务完成,删除任务
 * tryTime == 0 时删除任务
 * Game.time%sleep==0 时执行，默认 <=1 为 1
 * WAKE_TASK.taskName = {tryTime:10,sleep:10,task:(thisTask)=>{}}
 * WAKE_TASK.XKHO2_W19S56 = {tryTime:30,sleep:10,task:(thisTask)=>{return Game.rooms.W19S56.terminal.send("XKHO2",3000,"W22N19")==OK}};
 * WAKE_TASK.XKHO2_W19S54 = {tryTime:30,sleep:10,task:(thisTask)=>{return Game.rooms.W19S54.terminal.send("XKHO2",3000,"W22N19")==OK}};
 */
global.WAKE_TASK = {}
let executeWakeTasks = function () {
    for (let name in WAKE_TASK) {
        let wakeTask = WAKE_TASK[name];
        if (wakeTask.sleep > 1 && Game.time % wakeTask.sleep != 0) continue;
        if (!wakeTask.tryTime || !wakeTask.task || wakeTask.tryTime < 0) {
            delete WAKE_TASK[name];
            continue;
        }
        HelperError.catchError(() => {
            let result = wakeTask.task(wakeTask);
            console.log(name, result);
            if (result) wakeTask.tryTime--;
            if (result == "done") delete WAKE_TASK[name];
        }, name);
    }
}


let _global_memory = undefined
let _global_memory_tick = -1

let getTickObjects = function () {
    if (!Game._coreObjects) {
        Game._coreObjects = {
            rooms: Object.values(Game.rooms),
            creeps: Object.values(Game.creeps),
            powerCreeps: Object.values(Game.powerCreeps),
        };
    }
    return Game._coreObjects;
}

// RCL8 controllers have a large downgrade buffer. When the bucket is falling,
// stagger only their upgrader intents; economy, defense and Power Creeps keep
// running at full frequency. Controllers near downgrade always run normally.
let getUpgraderInterval = function () {
    if (Game.cpu.bucket < 5000) return 5;
    if (Game.cpu.bucket < 9000) return 4;
    if (Game.cpu.bucket < 9800) return 3;
    if (Game.cpu.bucket < 9950) return 2;
    return 1;
}

let shouldRunCreep = function (creep) {
    if (creep.memory.role != "upgrader") return true;
    let room = Game.rooms[creep.memory.roomName];
    if (!room || !room.controller || room.controller.level < 8 || room.controller.ticksToDowngrade < 20000) return true;
    let interval = Game._upgraderInterval || (Game._upgraderInterval = getUpgraderInterval());
    return interval == 1 || (Game.time + room.hashCode()) % interval == 0;
}

let updateCodeHealth = function () {
    if (Game.time % 20 != 0) return;
    let previousHealth = Memory.codeHealth || {};
    // Keep the newest failure available for diagnosis, but do not preserve an
    // old stack and a cumulative counter forever after it has stopped being
    // actionable. This also prevents serialized error text from growing the
    // long-lived Memory payload.
    if (previousHealth.lastErrorTick && Game.time - previousHealth.lastErrorTick > 5000) {
        delete previousHealth.lastError;
        delete previousHealth.lastErrorTick;
        delete previousHealth.errorCount;
    }
    let missingTaskHandlers = {};
    let objects = getTickObjects();
    let units = objects.creeps.concat(objects.powerCreeps.filter(e => e.ticksToLive));
    for (let unit of units) {
        for (let task of unit.memory.tasks || []) {
            if (task && task.taskName && typeof unit[task.taskName] != "function") {
                missingTaskHandlers[task.taskName] = (missingTaskHandlers[task.taskName] || 0) + 1;
            }
        }
    }
    Memory.codeHealth = Object.assign(previousHealth, {
        time: Game.time,
        cpu: Game.cpu.getUsed(),
        averageCpu: HelperCpuUsed.average(HelperCpuUsed.cpu, 20),
        cpuLongTerm: HelperCpuUsed.longTermSummary(),
        bucket: Game.cpu.bucket,
        creeps: objects.creeps.length,
        powerCreeps: objects.powerCreeps.filter(e => e.ticksToLive).length,
        upgraderInterval: Game._upgraderInterval || getUpgraderInterval(),
        missingTaskHandlers: missingTaskHandlers,
        phases: Game._coreCpuProfile || Memory.codeHealth.phases || {},
        moduleCpu: HelperCpuUsed.profileSummary(),
    });
}

let main = function () {
    if (_global_memory && _global_memory_tick + 1 == Game.time) {
        delete global.Memory;
        global.Memory = _global_memory;
        RawMemory._parsed = global.Memory;
    } else {
        _global_memory = global.Memory
    }
    _global_memory_tick = Game.time

    if (!global.WHO_AM_I) {
        let myRoom = getTickObjects().rooms.find(e => e.my);
        if (myRoom) global.WHO_AM_I = myRoom.controller.owner.username
    }

    let profileTick = HelperCpuUsed.shouldRun(CPU_PROFILE_INTERVAL);
    let profileStart = profileTick ? Game.cpu.getUsed() : 0;
    pro.init();
    if (profileTick) Game._coreCpuProfile = {init: Game.cpu.getUsed() - profileStart};
    if (Game.cpu.bucket > 40 || !isSaveCpu) pro.exec();
    else {
        let objects = getTickObjects();
        HelperError.runEach(objects.powerCreeps, e => e.spawning || (e.ticksToLive && e.execLastTask()));
        HelperError.runEach(objects.creeps.filter(e => ROLE_PRIORITY[e.memory.role] > 0), e => e.spawning || e.execLastTask());
    }
    let afterWorkStart = Game._coreCpuProfile ? Game.cpu.getUsed() : 0;
    pro.afterWork();
    if (Game._coreCpuProfile) {
        Game._coreCpuProfile.afterWork = Game.cpu.getUsed() - afterWorkStart;
        HelperCpuUsed.recordProfile(Game._coreCpuProfile);
    }

    if (Game.time % 300 == 0) {
        console.log(LOCAL_SHARD_NAME + " bucket : " + Game.cpu.bucket)
    }
    executeWakeTasks();
    HelperError.throwAllError();
    HelperCpuUsed.exec();
    HelperCpuUsed.recordLongTerm(Game.cpu.getUsed());
    updateCodeHealth();
    if (Game.time % 20) return;
  
    if (!Memory.stats) Memory.stats = {}
    
    // 统计 GCL / GPL 的升级百分比和等级
    Memory.stats.gcl = (Game.gcl.progress / Game.gcl.progressTotal) * 100
    Memory.stats.gclLevel = Game.gcl.level
    Memory.stats.gpl = (Game.gpl.progress / Game.gpl.progressTotal) * 100
    Memory.stats.gplLevel = Game.gpl.level
    // CPU 的当前使用量
    Memory.stats.cpu = Game.cpu.getUsed()
    // bucket 当前剩余量
    Memory.stats.bucket = Game.cpu.bucket
    if (!Memory.stats.RCL) Memory.stats.RCL = {};
    // 统计RCL的的百分比
    getTickObjects().rooms.filter(e => e.my && e.level < 8).forEach(room => Memory.stats.RCL[room.name] = room.controller.progress / room.controller.progressTotal * 100);

    
};

global.main = pro;
module.exports.loop = main;
