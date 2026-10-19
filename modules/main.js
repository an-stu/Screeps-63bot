require("main_mount");
Logger.info("Script reload", "bucket", Game.cpu.bucket, "version", RUNTIME_PROFILE.version);

const CPU_PROFILE_INTERVAL = 97;
const OPTIONAL_CPU_OFFSETS = {marketAutoBuy:19, autoPlanner:7, visual:3};
/**
 * Power creep 每隔几 tick 才执行一次 task。
 *
 * 它们的 task 绝大多数时间都在等技能冷却（`PWR_OPERATE_FACTORY` 是 800 tick
 * 量级），每 tick 跑一遍纯属浪费 —— 遥测里 `power:OPF` 实测 **1.04 CPU/tick**
 * （12 只 × ~0.09），而且这条路径**连 bucket ≤ 40 的极低桶保护都不跳过**
 * （见下面 `isSaveCpu` 分支），也就是最缺 CPU 的时候照样吃满。
 *
 * 隔 tick 执行：技能最多晚 1 tick 触发（冷却期内本来就无事可做），
 * power creep 移动速度减半（它们不赶时间），省下约 0.5 CPU/tick。
 * `ROLE_PRIORITY` 那套只过滤普通爬，power creep 不在其中，所以必须单独判。
 */
const POWER_CREEP_TICK_INTERVAL = 2;
function shouldRunPowerCreeps() {
    return Game.time % POWER_CREEP_TICK_INTERVAL == 0;
}


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
        // power creep 的 task 也只有在非低桶时跑：它们等的是技能冷却（分钟级），
        // 而实测 `power:OPF` 单项 ~1~2 CPU/tick —— 桶到 MIN_CPU 线以下时先冻掉。
        if (!MIN_CPU && shouldRunPowerCreeps()) HelperError.runEach(objects.powerCreeps, e => e.ticksToLive && e.execRegFun());
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
        // Blueprint rendering is an explicit, user-created Flag action. Keep
        // it outside the 25-tick auto-planner cadence so it remains visible,
        // while adding no cost at all when the Flag is absent.
        if (global.ManagerAutoPlanner && Game.flags.showBlueprint) {
            HelperError.catchError(() => ManagerAutoPlanner.showRoom());
        }
        if (global.StationSources && Memory.visualOuterRoad) {
            HelperError.catchError(() => StationSources.drawOuterRoadDebug());
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

        // MIN_CPU 下按 ROLE_PRIORITY 过滤：只停被显式标成负数的角色。
        // 原写法 `ROLE_PRIORITY[e.memory.role] > 0` 对未列出的角色是
        // `undefined > 0 === false`，会把 reserver / harvestMineralKeeper /
        // outerHarvestEnergyCarrier / minRoomWorker / pillager 等一起静默冻死
        // （没有任何日志），而 ROLE_PRIORITY 里只有 worker(-5)/upgrader(-10) 是
        // 作者显式想停的，语义上「未列出 = 照常运行」。
        let activeCreeps = objects.creeps.filter(e => {
            if (MIN_CPU && !ROLE_PRIORITY_ALLOWED(e.memory.role)) return false;
            return shouldRunCreep(e);
        });
        if (cpuProfile) {
            cpuProfile.unitRoles = {};
            if (!MIN_CPU && shouldRunPowerCreeps()) HelperError.runEachProfiled(objects.powerCreeps, e => e.spawning || (e.ticksToLive && e.execLastTask()), e => "power:" + (e.memory.role || "unknown"), cpuProfile.unitRoles);
            HelperError.runEachProfiled(activeCreeps, e => e.spawning || e.execLastTask(), e => e.memory.role || "unknown", cpuProfile.unitRoles);
        } else {
            if (!MIN_CPU && shouldRunPowerCreeps()) HelperError.runEach(objects.powerCreeps, e => e.spawning || (e.ticksToLive && e.execLastTask()));
            HelperError.runEach(activeCreeps, e => e.spawning || e.execLastTask());
        }
        if (cpuProfile) {
            cpuProfile.unitTasks = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }

        // These jobs do not keep creeps alive or defend a room. Spread them
        // over several ticks and make them independently switchable in Memory.
        if (!MIN_CPU && global.StrategyMarket && isCpuFeatureEnabled("market") && HelperCpuUsed.shouldRun(10)) {
            let batch = Math.floor(Game.time / 10) % 4;
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
        // 闲聊：让 creep 说话（气泡），语料来自 `modules/闲聊 v1.0.js` 顶部的 `global.Talk`
        // —— 原始语料是 6g3y 整理的 8124 条**群聊记录**（2020-10 截止），
        // 换语料只需要改那一行数组，与本文件无关。
        //
        // 开关：默认**开**（`chat` 不在 CPU_OPT_IN_FEATURES 里，语义是 `value !== false`），
        // 置 `Memory.cpuFeatures.chat = false` 即可关。
        // 限流：MIN_CPU / 低桶不跑；**每 tick 一次**（用户 10-16：「1t 一句」）——
        // 每只正在唱的爬每 tick 推进一页（10 字），长句自然分成好几句。
        // 看它有没有真的在跑：控制台读 `__chatAll`（调用次数）/`__chatSays`（说出句数）。
        if (!MIN_CPU && global.TalkAll && isCpuFeatureEnabled("chat")
            && Game.cpu.bucket >= 5000)
            HelperError.catchError(() => TalkAll());
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

/**
 * 每 tick 决定哪些爬执行任务。
 *
 * ⚠️ **upgrader 不再在这里节流**（用户 2026-10-19）：
 * 「在位肯定要工作 —— 能量低 / 快降级是不**派** upgrader，不是**暂停**工作，不要浪费」。
 *
 * 原实现按「降级计时器 >120k 停 / 存量 <30k 停、<60k 半速 / bucket 间隔降频」把**在位的**
 * upgrader 按住不执行。但 `station_upgrade.js:398~429` **本来就有完整的 spawn 闸门**
 * （RCL8 只在 `ticksToDowngrade < 80000` 时补 1 只；低等级另有存量/进度条件），
 * 所以那套节流既**重复**又**纯浪费**：已经付出去的孵化能量和 1500 tick 寿命被白白搁置。
 * 实测 W33N53 的 `shard3_83743327_1`（降级余量 120k、stock 150k、任务栈 `upgradeKeeper`、
 * 身上背着 70 能量）就是这样被冻住的。
 *
 * 现在：**upgrader 与其它角色一样，在位就执行**；要不要有 upgrader 完全交给 spawn 侧决定。
 * （bucket 极低时的 MIN_CPU 紧急路径仍走 `ROLE_PRIORITY` —— 那是 CPU 保命，与本条无关。）
 */
let shouldRunCreep = function (creep) {
    return true;
}

let updateCodeHealth = function () {
    // 97-tick 采样与 20-tick 健康快照错位：把本 tick 的相位采样先落盘，
    // 否则 codeHealth.phases 只能每 lcm(97,20)=1940 tick 才更新一次。
    if (Game._coreCpuProfile) {
        Memory.codeHealth = Memory.codeHealth || {};
        Memory.codeHealth.phases = Game._coreCpuProfile;
    }
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
    let missingTaskHandlers = previousHealth.missingTaskHandlers || {};
    // 纯诊断扫描：78 个 creep × 全部任务每 tick 走一遍是固定开销，
    // 100 tick 的粒度足够发现部署后缺模块的问题。
    if (Game.time % 100 == 0) {
        missingTaskHandlers = {};
        let objects = getTickObjects();
        let units = objects.creeps.concat(objects.powerCreeps.filter(e => e.ticksToLive));
        for (let unit of units) {
            for (let task of unit.memory.tasks || []) {
                if (task && task.taskName && typeof unit[task.taskName] != "function") {
                    missingTaskHandlers[task.taskName] = (missingTaskHandlers[task.taskName] || 0) + 1;
                }
            }
        }
    }
    let objects = getTickObjects();
    Memory.codeHealth = Object.assign(previousHealth, {
        time: Game.time,
        cpu: Game.cpu.getUsed(),
        averageCpu: HelperCpuUsed.average(HelperCpuUsed.cpu, 20),
        // cpuLongTerm / moduleCpu 曾经也落在这里，但它们是
        // HelperCpuUsed.longTermSummary() / profileSummary() 的完整副本：
        // moduleCpu(4.6KB) 与 Memory.cpuModuleTelemetry(4.5KB) 完全重复，
        // cpuLongTerm 又派生自 Memory.cpuTelemetry。两者都改为 dashboard
        // 按需计算（helper_consoleDashboard 里），每 tick 少序列化约 5KB。
        bucket: Game.cpu.bucket,
        creeps: objects.creeps.length,
        powerCreeps: objects.powerCreeps.filter(e => e.ticksToLive).length,
        upgraderInterval: Game._upgraderInterval || getUpgraderInterval(),
        missingTaskHandlers: missingTaskHandlers,
        phases: Game._coreCpuProfile || Memory.codeHealth.phases || {},
    });
    // 一次性清掉历史遗留的两份重复副本，避免老内存继续占体积
    delete Memory.codeHealth.cpuLongTerm;
    delete Memory.codeHealth.moduleCpu;
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
        if (!MIN_CPU && shouldRunPowerCreeps()) HelperError.runEach(objects.powerCreeps, e => e.spawning || (e.ticksToLive && e.execLastTask()));
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
    // 统计RCL的的百分比；只保留仍拥有的房间，清掉易主后的陈旧条目
    // （stats 写入只增不删，丢掉的房间会在 Memory 里留Forever）
    let rclStats = Memory.stats.RCL;
    getTickObjects().rooms.filter(e => e.my && e.level < 8).forEach(room => rclStats[room.name] = room.controller.progress / room.controller.progressTotal * 100);
    for (let name in rclStats) {
        let room = Game.rooms[name];
        if (!room || !room.my) delete rclStats[name];
    }

    
};

global.main = pro;
module.exports.loop = main;
