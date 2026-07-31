/*
ofost46865  
Game.market.createOrder({
    type: ORDER_SELL,  
    resourceType: 'ops',  
    price: 105,
    totalAmount: 100000, 
    roomName: "E55S31"    
});
(需要的伤害-塔伤害 )/30*40

11t 6ra 10m 23h

Game.cpu.bucket+" "+Game.cpu.getUsed()

挖墙角策略
StationLab.boostAbleLevel(Game.rooms.W19N11,"upgradeController",15,1);

system.setTickDuration(1)

damege*2 - tough*100/0.3 >heal
3t 3m 6ra
3t 4m 13h
*/ 
console.log("Script Reload In Time " + Game.time + " , bucket " + Game.cpu.bucket);
require("main_mount");


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
        // _.values(Game.creeps).filter(e=>e.memory.role=="carrier").forEach(e=>e.memory.tasks = [])
        // _.values(Game.creeps).forEach(e=>e.sayHeadTask());
        // _.values(Game.creeps).forEach(e=>e.spawning||e.say(e.lastTask().taskName));
        // 注册
        // _.values(Game.creeps).forEach(e=>{try{e.execRegFun()}catch (exc) {log(e.memory.role)}});
        // _.values(Game.creeps).forEach(e=>{e.suicide()});
        HelperError.runEach(objects.creeps, e => e.execRegFun());
        HelperError.runEach(objects.powerCreeps, e => e.ticksToLive && e.execRegFun());
        if (cpuProfile) {
            cpuProfile.registration = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }

        // 出击！
        if (global.teamL2) HelperError.catchError(() => teamL2.exec());
        if (global.StrategyAtkl2) HelperError.catchError(() => StrategyAtkl2.exec());
        if (global.TeamRaL1) HelperError.catchError(() => TeamRaL1.exec());
        if (global.WarDefenseCore) HelperError.catchError(() => WarDefenseCore.exec());
        if (global.WarPowerCreepOperator) HelperError.catchError(() => WarPowerCreepOperator.exec());

        // 配置资源
        if (global.WarTeamFlag) HelperError.catchError(() => WarTeamFlag.exec());
        if (global.WarAttackRoom) HelperError.catchError(() => WarAttackRoom.exec());
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
        if (global.StrategytradeCrossShard) HelperError.catchError(() => StrategytradeCrossShard.exec());
        if (global.StrategyClaim && isCpuFeatureEnabled("claim") && ManagerFlags.hasPrefix("claim")) HelperError.catchError(() => StrategyClaim.exec());
        if (global.StrategyClaimCrossShard) HelperError.catchError(() => StrategyClaimCrossShard.exec());
        if (global.StrategyScouter && isCpuFeatureEnabled("scouter") && ManagerFlags.hasPrefix("moveto")) HelperError.catchError(() => StrategyScouter.exec());
        if (global.StrategyFactoryPowerCreep) HelperError.catchError(() => StrategyFactoryPowerCreep.exec());
        if (global.StrategyCleanBuild && isCpuFeatureEnabled("cleanBuild") && ManagerFlags.hasPrefix("cleanBuild")) HelperError.catchError(() => StrategyCleanBuild.exec());
        if (global.StrategyBlockRoom && isCpuFeatureEnabled("blockRoom") && ManagerFlags.hasPrefix("blockRoom")) HelperError.catchError(() => StrategyBlockRoom.exec());
        if (cpuProfile) {
            cpuProfile.flagStrategies = Game.cpu.getUsed() - phaseStart;
            phaseStart = Game.cpu.getUsed();
        }

        // 执行
        // _.values(Game.creeps).forEach(e=>{try{e.spawning||e.execLastTask()}catch (exc) {e.suicide()}});
        let activeCreeps = (!MIN_CPU ? objects.creeps : objects.creeps.filter(e => ROLE_PRIORITY[e.memory.role] > 0))
            .filter(shouldRunCreep);
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
            if(HelperCpuUsed.shouldRun(100))HelperError.catchError(() => StrategyMarket.autoBuy());
        }
        if (!MIN_CPU && global.ManagerAutoPlanner && isCpuFeatureEnabled("autoPlanner") && HelperCpuUsed.shouldRun(25))
            HelperError.catchError(() => ManagerAutoPlanner.exec());
        if (!MIN_CPU && global.HelperVisual && isCpuFeatureEnabled("visual") && HelperCpuUsed.shouldRun(10))
            HelperError.catchError(() => HelperVisual.exec());
        if (cpuProfile) cpuProfile.optional = Game.cpu.getUsed() - phaseStart;
    },
    afterWork() {
        if (global.ManagerCrossShard && isCpuFeatureEnabled("crossShard")) HelperError.catchError(() => ManagerCrossShard.afterWork());
    }
};

let P0 = function () {
    let flag = Game.flags.P0;
    let pc = Game.powerCreeps["P0"]
    if (flag && flag.room && flag.room.powerSpawn) {
        if (!pc.ticksToLive && (!pc.spawnCooldownTime || pc.spawnCooldownTime <= Date.now())) {
            pc.spawnPowerCreep(flag.room.powerSpawn, "P0", flag.pos.roomName)
        }
    }
    if (!pc || !flag) return;
    if (pc.ticksToLive) {
        // if (!pc.pos.isEqualTo(flag.pos)) pc.moveTo(flag)
        if (pc.room.controller) pc.enableRoom(pc.room.controller);
        if (!pc.room.my) {
            let cap = pc.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1).find(e => e.store && !e.store.isEmpty())
            if (cap) {
                let res = cap.store.getLessResTypes().head()
                pc.withdraw(cap, res, Math.min(cap.store[res], pc.store.getFreeCapacity(res)))
                if (pc.store.isFull()) {
                    let res = pc.store.getLessResTypes().head()
                    pc.drop(res, pc.store[res])
                }
            }
        }
        if (pc.pos.isNearTo(pc.room.powerSpawn)) {
            pc.renew(pc.room.powerSpawn);
        }
        else if (pc.ticksToLive && pc.needRenewInRoom()) {
            pc.addRenewMainRoomTask();
        }
        // regen source
        // pc.OpSource();
        // Op Lab
        // let lab = pc.needOpLab();
        // if (lab) {
        //     pc.OpLab(lab);
        // }
    }
}

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
let exec_wake_task = () => {
    HelperError.catchError(() => _.keys(WAKE_TASK).forEach(name => {
        if (WAKE_TASK[name].sleep > 1 && Game.time % WAKE_TASK[name].sleep != 0) return;
        if (!WAKE_TASK[name].tryTime || !WAKE_TASK[name].task || WAKE_TASK[name].tryTime < 0) return delete WAKE_TASK[name]
        let result = WAKE_TASK[name].task(WAKE_TASK[name]);
        console.log(name, result)
        if (result) WAKE_TASK[name].tryTime--;
        if (result == "done") delete WAKE_TASK[name]
    }));
}

let space_action = {
    // an_w: function () {
    //     if (WHO_AM_I == "an_w" && Game.shard.name == 'shard3') {
    //         if (!isSaveCpu && Game.cpu.bucket < 500) {
    //             global.isSaveCpu = true;
    //         }
    //         else if (isSaveCpu && Game.cpu.bucket > 9000) {
    //             global.isSaveCpu = false;
    //         }
    //     }
    // },
    action_nanachi: function () {
        if (WHO_AM_I == "nanachi" && Game.shard.name == 'shard3') {
            if (Game.rooms["W25S39"].terminal.store['emanation'] >= 18)
                Game.rooms["W25S39"].terminal.send('emanation', 1, 'E19N11')
            if (Game.rooms["W23S59"].terminal.store['machine'] >= 10)
                Game.rooms["W23S59"].terminal.send('machine', 1, 'E19N11')

            // let obs = Game.rooms.W12S41.observer;
            // let roomName = "W9S49";
            // if(obs&&!StationObserver.ObserveRoomQueue[obs.id])StationObserver.ObserveRoomQueue[obs.id]=[];
            // if(obs&&StationObserver.ObserveRoomQueue[obs.id].length==0)//&&Game.time%10==0
            //     StationObserver.ObserveRoomQueue[obs.id].unshift(roomName)
            // if(Game.rooms[roomName]&&Game.rooms[roomName].terminal&&Game.rooms[roomName].storage){
            //     for(let resType of ["oxidant","reductant","ghodium_melt","utrium_bar","lemergium_bar","keanium_bar","zynthium_bar"]){//,"purifier"
            //         if((Game.rooms[roomName].terminal.store[resType]||0)+(Game.rooms[roomName].storage.store[resType]||0)<6000){
            //             let successCnt = _.values(Game.rooms).filter(e=>e.my&&e.terminal&&e.terminal.send(resType,e.terminal.store[resType],roomName)==OK).length
            //             if(successCnt)break;
            //         }
            //     }
            //     for(let resType of ["circuit","hydraulics","emanation","organoid"]){
            //         if((Game.rooms[roomName].terminal.store[resType]||0)+(Game.rooms[roomName].storage.store[resType]||0)<1){
            //             let success = _.values(Game.rooms).find(e=>e.my&&e.terminal&&e.terminal.send(resType,1,roomName)==OK)
            //             if(success)break;
            //         }
            //     }
            // }
        }
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
    Memory.codeHealth = Object.assign(Memory.codeHealth || {}, {
        time: Game.time,
        cpu: Game.cpu.getUsed(),
        averageCpu: HelperCpuUsed.average(HelperCpuUsed.cpu, 20),
        bucket: Game.cpu.bucket,
        creeps: objects.creeps.length,
        powerCreeps: objects.powerCreeps.filter(e => e.ticksToLive).length,
        upgraderInterval: Game._upgraderInterval || getUpgraderInterval(),
        missingTaskHandlers: missingTaskHandlers,
        phases: Game._coreCpuProfile || Memory.codeHealth.phases || {},
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

    let profileStart = Game.time % 100 == 0 ? Game.cpu.getUsed() : 0;
    pro.init();
    if (profileStart) Game._coreCpuProfile = {init: Game.cpu.getUsed() - profileStart};
    if (Game.cpu.bucket > 40 || !isSaveCpu) pro.exec();
    else {
        let objects = getTickObjects();
        HelperError.runEach(objects.powerCreeps, e => e.spawning || (e.ticksToLive && e.execLastTask()));
        HelperError.runEach(objects.creeps.filter(e => ROLE_PRIORITY[e.memory.role] > 0), e => e.spawning || e.execLastTask());
    }
    pro.afterWork();

    // try { if (Game.cpu.bucket >= 10000 && !isSaveCpu && WHO_AM_I != "6g3y") Game.cpu.generatePixel(); } catch (e) { }
    if (Game.time % 300 == 0) {
        console.log(LOCAL_SHARD_NAME + " bucket : " + Game.cpu.bucket)
    }
    // if (WHO_AM_I == "an_w") TalkAll()
    HelperError.catchError(() => _.values(space_action).forEach(e => e()));
    HelperError.catchError(() => exec_wake_task());
    HelperError.throwAllError();
    HelperCpuUsed.exec();
    updateCodeHealth();
    // P0();
    // space_action.an_w();

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

// module.exports.loop=require("调用栈分析器").warpLoop(main);
module.exports.loop = main;
