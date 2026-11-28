/**
 * 一体机
 * raL1[_roomName][_keeper][_hash]
 * raL1_W1N4_1
 * raL1_W3N8_1
 * raL1_W23N19_1
 * raL1_E48S19_crossShard&s2WE50S20-s1E50S20_keeper_1
 */



global.raL1Target = ""

global.pathData= {}

// Keep persisted cross-shard tasks inert until manager_crossShard is restored.
// The full manager replaces this placeholder when it is mounted first.
if (!Creep.prototype.moveCrossShardByPath) {
    Creep.prototype.moveCrossShardByPath = function () {
        if (Game.time % 100 == 0) this.say("cross paused");
    }
}

// shard1 / E50S20

Creep.prototype.registerRaL1=function () {
    let flag= Game.flags[this.headTask().id];
    if(flag&&flag.memory){
        flag.memory.creepName = this.name
        if(this.spawning)flag.memory.spawnTime = Game.time
    }
}

let roundRoom = [
    "E51S21",
    "E51S19",
    "E52S21",
    "E53S19",
    "E55S21",
    "E57S19",
    "E59S18",
    "E58S18",
    "E58S16",
    "E56S17",
    "E57S15",
    "E53S16",
    "E54S18",
    "E52S17",
]

let funChangePos = (flag,creep)=>{
    if(creep.memory.lastRoomIndex===undefined){
        creep.memory.lastRoomIndex=0;
        flag.setPositionNextTick(new RoomPosition(25,25,roundRoom[creep.memory.lastRoomIndex]))
    }
    else if(roundRoom[creep.memory.lastRoomIndex]==creep.room.name){
        creep.memory.lastRoomTick+=1;
        if(creep.memory.lastRoomTick>50){
            // roundRoom 只有 14 项，下标必须取模；原来一直自增，越界后
            // roundRoom[i] 为 undefined，new RoomPosition(25,25,undefined) 抛错，
            // 环形巡游直接停摆。
            creep.memory.lastRoomIndex=(creep.memory.lastRoomIndex+1)%roundRoom.length;
            flag.setPositionNextTick(new RoomPosition(25,25,roundRoom[creep.memory.lastRoomIndex]))
        }
    }else {
        creep.memory.lastRoomTick = 0;
    }
}

Creep.prototype.raL1=function () {
    let flag= Game.flags[this.headTask().id];
    if (!flag) {
        this.suicide();
        return;
    }
    if(flag&&flag.memory.roundRoom)funChangePos(flag,this);
    // let inner=pos=> pos.x>=2&&pos.x<=48&&pos.y>=2&&pos.y<=48;
    this.atk=function(){
        let forcedTarget = Game.getObjectById(raL1Target);
        let cachedTarget = this.memory.raL1TargetUntil >= Game.time ? Game.getObjectById(this.memory.raL1TargetId) : undefined;
        if(cachedTarget && cachedTarget.pos.roomName != this.room.name)cachedTarget = undefined;
        let em=forcedTarget || cachedTarget;//this.pos.findClosestByPath(FIND_HOSTILE_CREEPS);//
        let isHostileCreep = !!(em && em.body);
        let isHostileConstruction = false;
        let isSite = !!(em && em.progressTotal !== undefined && em.hits === undefined);
        if(!em)em = flag.room&&flag.pos.lookFor(LOOK_STRUCTURES).find(e=>!e.my && e.structureType !== STRUCTURE_CONTAINER)
        if(!em) em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{range:3,filter:e=>e.hits&&e.structureType!=STRUCTURE_WALL&&e.structureType!=STRUCTURE_POWER_BANK&&!e.pos.coverRampart()});
        if(!em){
            // owner 是 {username} 对象：原写法 e.owner.name 恒 undefined，
            // 白名单豁免（lp136）完全无效，raL1 会照打白名单玩家
            em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>e.body.length>2&&e.body.find(e=>e.type==RANGED_ATTACK)&&!e.pos.coverRampart()&&e.owner.username !== 'lp136'});//
            if(em)isHostileCreep = true;
        }
        if(!em){
            em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>e.body.length>2&&!e.body.find(e=>e.type==TOUGH && e.boost)&&!e.pos.coverRampart()});//
            if(em)isHostileCreep = true;
        }
        if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_POWER_CREEPS);
        if(!em){
            em=this.pos.findClosestByPath(FIND_HOSTILE_CONSTRUCTION_SITES,{filter:e=>e.progress })
            if (em) isSite=true
        }
        if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_SPAWN&& e.structureType!=STRUCTURE_POWER_BANK});
        if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{filter:e=>e.hits&&e.structureType!=STRUCTURE_RAMPART&& e.structureType!=STRUCTURE_POWER_BANK});//&&e.structureType!=STRUCTURE_SPAWN
        if(!em&&this.room.controller&&this.room.controller.owner&&!this.room.my){
            em=this.pos.findClosestByPath(FIND_STRUCTURES,{filter:e=>e.hits});
        }//&&e.structureType!=STRUCTURE_SPAWN
        if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{filter:e=>e.structureType!=STRUCTURE_INVADER_CORE&&e.structureType!=STRUCTURE_CONTROLLER && e.structureType!=STRUCTURE_POWER_BANK});
        if(!em){
            em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>!e.pos.coverRampart()});//,{filter:e=>e.body.filter(e=>e.type==ATTACK||e.type==RANGED_ATTACK)}
            if(em)isHostileCreep = true;
        }

        if(!em)em = this.pos.findInRange(FIND_HOSTILE_CREEPS,3,{filter:e=>!e.pos.coverRampart()}).head()
        if(!em)em = this.pos.findInRange(FIND_HOSTILE_STRUCTURES,3, {filter:e=>e.structureType!=STRUCTURE_POWER_BANK}).head()

        if(em && !forcedTarget && !cachedTarget){
            this.memory.raL1TargetId = em.id;
            this.memory.raL1TargetUntil = Game.time + 3;
        }else if(!em){
            delete this.memory.raL1TargetId;
            delete this.memory.raL1TargetUntil;
        }

        if(em && global.HelperVisual && isCpuFeatureEnabled("visual"))HelperVisual.showText(em,"X")
        if(em&&em.structureType)isHostileConstruction=true
        if(isHostileConstruction){
            if ( !this.pos.inRangeTo(em, 2)) {
                this.moveTo(em)
            }
            else if (isSite) {
                this.moveTo(em)
            }
            if(this.pos.isNearTo(em)&&(em.pos.coverRampart()||em.owner)){
                let em1 = this.pos.findInRange(FIND_HOSTILE_CREEPS,3,{filter:e=>!e.pos.coverRampart()&&!this.pos.isNearTo(e)}).head();// 找附近的爬
                // if(!em1)em1 = this.pos.findInRange(FIND_STRUCTURES,3,{filter:e=>e.hits<=25000&&!e.owner&&!e.pos.coverRampart()}).head();// 没事就找建筑打
                if(em1) this.rangedAttack(em1)
                else this.rangedMassAttack()
            }else if(this.rangedAttack(em)==ERR_NOT_IN_RANGE){//||!inner(this.pos)
                // this.rangedMassAttack()
                // if (em) this.moveTo(em)
                if(this.room.controller&&this.room.controller.owner&&!this.room.my){
                    em= this.pos.findClosestByRange(FIND_STRUCTURES,{filter:e=>e.hits})
                    this.rangedAttack(em)
                }
            }
            let em1 = this.pos.findInRange(FIND_HOSTILE_CREEPS,3,{filter:e=>!e.pos.coverRampart()&&!this.pos.isNearTo(e)}).head();// 找附近的爬
            if(em1) this.rangedAttack(em1)
        } else if(isHostileCreep){
            // Logger.log("TeamRaL1", em.id);
            this.moveTo(em);
            if(this.pos.isNearTo(em)&& em && em.body && this.body.find(e=>e.type==RANGED_ATTACK)) {this.rangedMassAttack()}
            else if (this.pos.isNearTo(em)&& em && em.body && this.body.find(e=>e.type==ATTACK)) {this.attack(em)}
            else if(this.rangedAttack(em)==ERR_NOT_IN_RANGE){//||!inner(this.pos)
                // this.rangedMassAttack()
                if(this.room.controller&&this.room.controller.owner&&!this.room.my){
                    em= this.pos.findClosestByRange(FIND_STRUCTURES,{filter:e=>e.hits})
                    this.rangedAttack(em)
                }
                else if (this.pos.isNearTo(em)&&em.structureType!=STRUCTURE_WALL&&em.structureType!=STRUCTURE_ROAD&&em.structureType!=STRUCTURE_CONTAINER) {
                    this.rangedMassAttack()
                }
            }
            // if(this.pos.inRangeTo(em,2)){
            //     em.range = 4
            //     let path = PathFinder.search(this.pos,em,{flee:true}).path;
            //     let code = this.moveByPath(path)
            //     // log(code,PathFinder.search(this.pos,em,{flee:true}))
            // }
        }else if(em){
            if(this.rangedAttack(em)==ERR_NOT_IN_RANGE){//||!inner(this.pos)
                this.rangedMassAttack()
            }
            if(!this.pos.inRangeTo(em,1)){
                this.moveTo(em)
            }
        } else if(!em&&!this.pos.isEqualTo(tarPos)){
            this.moveTo(tarPos);
        }
        if(this.hits+1002<this.hitsMax){
            let exit=this.pos.findClosestByPath(FIND_EXIT);
            if(exit)this.moveTo(exit);
        }
    };
    if (this.body.find(e=>e.type==HEAL) && (this.hits < this.hitsMax || !this.body.find(e=>e.type==ATTACK)))
    this.heal(this);

    // let attackHostile = this.pos.findInRange(FIND_HOSTILE_CREEPS,3).find(e=>e.body.find(t=>t.boost == "XUH2O"))
    // if(attackHostile) {
    //     if (flag.pos.roomName == "E28N5"&&this.pos.roomName=="E28N5"||flag.pos.roomName == "E28N6"&&this.pos.roomName=="E28N6"){
    //         let k = _.shuffle(this.room.find(FIND_STRUCTURES,{filter:e=>e.pos.y==2&&this.pos.inRangeTo(e,12)})).head()
    //         if(k)flag.setPositionNextTick(new RoomPosition(k.pos.x||9, 47, "E28N6"))
    //     }
    //     flag.memory.attackConcat = Game.time + 12
    // }
    // // else if(this.pos.findInRange(FIND_HOSTILE_CREEPS,7).find(e=>e.body.find(t=>t.boost == "XKHO2"||t.type==ATTACK))){
    // //     this.moveTo(new RoomPosition( 4, 13, "E28N5"))
    // // }
    // if(flag.pos.roomName=="E28N6"&&this.pos.roomName=="E28N6"){
    //     // log(flag.memory.attackConcat)
    //     if(((flag.memory.attackConcat||0)<Game.time||this.pos.isNearTo(flag))&&flag.room.find(FIND_HOSTILE_CREEPS).length==0){
    //         flag.setPositionNextTick(new RoomPosition( flag.pos.x, 2, "E28N5"))
    //     }
    // }

    var attackHostile = null
    attackHostile = this.pos.findInRange(FIND_HOSTILE_CREEPS,3).find(e=>e.body.find(t=>t.boost == "XUH2O"))
    if(attackHostile){
        if(this.room.controller&&this.room.controller.owner&&!this.room.my&&this.room.tower.length){//如果房间有塔就往外面跑
            // let em = attackHostile;
            // if(this.pos.inRangeTo(em,5)&&!this.pos.isNearTo(em)){// 距离等于5的时候开始风筝
            //     em.range = this.pos.getRangeTo(em)+1
            //     let path = PathFinder.search(this.pos,em,{flee:true}).path;
            //     this.moveByPath(path)
            //     this.rangedAttack(em)
            // }
            // let exit=this.pos.findClosestByPath(FIND_EXIT);
            // if(exit&&this.pos.isNearTo(exit))this.moveTo(exit);

            let exit=this.pos.findClosestByPath(FIND_EXIT);
            this.moveTo(exit);

            this.rangedMassAttack();
            if(flag.name.indexOf("_skip")>=0) {
                if (this.pos.roomName == "E24N3") flag.setPositionNextTick(new RoomPosition( 8, 48, "E28N5"))
                if (this.pos.roomName == "E28N5") flag.setPositionNextTick(new RoomPosition(39, 34, "E25N1"))
            }
        }else{// 跑到外面还在追就风筝他！
            let em = attackHostile;
            if(this.pos.inRangeTo(em,2)){// 距离等于2的时候开始风筝
                em.range = this.pos.getRangeTo(em)+1
                let path = PathFinder.search(this.pos,em,{flee:true}).path;
                this.moveByPath(path)
                this.rangedAttack(em)

                let exit=this.pos.findClosestByPath(FIND_EXIT);
                if(exit&&this.pos.isNearTo(exit)&&this.pos.isNearTo(em))this.moveTo(exit);
            }
        }
        return;
    }

    this.atkOutRoom=function () {
        let creeps = this.pos.findInRange(FIND_HOSTILE_CREEPS,1);
        if (creeps.length) {
            return this.rangedMassAttack();
        }
        creeps = this.pos.findInRange(FIND_HOSTILE_CREEPS,3);
        if(creeps.length){
            this.rangedAttack(creeps.maxBy(e=>-e.hits));
        }
    }

    if(!flag)return;
    let tarPos =flag.pos;
    if(this.room.name!=flag.pos.roomName) {
        let inner=pos=> pos.x>2&&pos.x<47&&pos.y>2&&pos.y<47;
        if(this.hits+1002<this.hitsMax&&!inner(this.pos)&&!this.room.tower.find(e=>!e.my)){
            this.atkOutRoom();
            this.moveTo(new RoomPosition(25,25,this.room.name));
            //let t=this.$moveTo(tarPos);
        }else if(this.hits+1002>=this.hitsMax){
            this.atkOutRoom();
            this.moveTo(tarPos);
        }else{
            this.atk();
        }
    }else{
        if(this.hits+1002>=this.hitsMax){ // change
            this.atk();
        }else{
            this.atkOutRoom();
            this.moveTo(new RoomPosition(25,25,this.room.name));
        }
    }
};

let pro = {

    // raBody1:ManagerCreeps.calcBodyPart({ [TOUGH]: 11, [RANGED_ATTACK]: 6, [MOVE]: 10 , [HEAL]: 23 }),
    raBody1:ManagerCreeps.calcBodyPart([ [TOUGH,6],[RANGED_ATTACK,22],[MOVE,9],[HEAL,12],[MOVE,1]]),
    raBoost1:()=>{return {[BOOST_RES["damage"][2]]:30*6,[BOOST_RES["rangedAttack"][2]]:30*22,[BOOST_RES["fatigue"][2]]:30*10,[BOOST_RES["heal"][2]]:30*12}},
    raBody2:ManagerCreeps.calcBodyPart([[TOUGH,4],[RANGED_ATTACK,28],[MOVE,10],[HEAL,8]]),
    // raBody2:ManagerCreeps.calcBodyPart({ [TOUGH]: 7, [RANGED_ATTACK]: 19, [MOVE]: 10 , [HEAL]: 14 }),
    raBoost2:()=>{return {[BOOST_RES["damage"][2]]:30*4,[BOOST_RES["fatigue"][2]]:30*10,[BOOST_RES["rangedAttack"][2]]:30*28,[BOOST_RES["heal"][2]]:30*8}},
    raBody4:ManagerCreeps.calcBodyPart([[ATTACK,10],[MOVE,11],[HEAL,1]]),
    raBody3:ManagerCreeps.calcBodyPart([[RANGED_ATTACK,20],[MOVE,25],[HEAL,5]]),
    raBoost3:()=>{return {[BOOST_RES["rangedAttack"][0]]:30*5}},
    raBody5:ManagerCreeps.calcBodyPart([[RANGED_ATTACK,7],[MOVE,7]]),

    // raBody3:ManagerCreeps.calcBodyPart({ [TOUGH]: 1, [RANGED_ATTACK]: 1, [MOVE]: 1 , [HEAL]: 1 , [CARRY]: 1 , [ATTACK]: 1, [WORK]: 1 }),
    // raBoost3:{[BOOST_RES["damage"][0]]:30*1,[BOOST_RES["fatigue"][0]]:30*1,[BOOST_RES["rangedAttack"][0]]:30*1,[BOOST_RES["heal"][0]]:30*1,[BOOST_RES["capacity"][0]]:30*1,[BOOST_RES["attack"][0]]:30*1,[BOOST_RES["build"][0]]:30*1},
    execSpawnCrossShard (flag,raBody,raBoost) {
        if (!global.ManagerCrossShard) {
            if (Game.time % 100 == 0) Logger.log("TeamRaL1", flag.name + ": cross-shard manager is disabled");
            return;
        }
        if(flag.name.indexOf("_keeper")>=0){
            if(flag.memory.taskId && flag.memory.spawnTime+1400<Game.time){
                delete flag.memory.taskId;
                log(flag.name,"spawn")
            }
            else if(!flag.memory.taskId){
                flag.memory.spawnTime = Game.time
            }
        }
        if(!flag.memory.taskId){
            let crossData = flag.getCrossShardParams()[0]
            let pathData = global.pathData[crossData]
            if(!pathData)return Logger.log("TeamRaL1", " path error: "+crossData)
            let mission = {
                func:"spawnCreepCressShard",
                // callBack:"setFlagMemory",
                data: {
                    flagName:flag.name,
                    // flagMemory:{
                    //     spawnTime:Game.time+150
                    // },
                    spawnRoom:flag.getRoomName(),
                    targetRoomName:flag.pos.roomName,
                    body:raBody,
                    role:"raL1",
                    tasks:[
                        UtilsTask.taskFlag(flag,"raL1","registerRaL1"),
                        UtilsTask.taskData("moveCrossShardByPath",undefined,pathData)
                    ],
                }
            }
            if(raBoost)mission.data.tasks.push(StationLab.generatorBoostResTask(raBoost).head())
            flag.memory.spawnTime = Game.time
            flag.memory.taskId = ManagerCrossShard.addCrossShardRequest("shard2",mission)
        }
    },
    /**
     * 死队的旗该不该清掉（用户 2026-10-13 选 (a)：队伍死了任务即结束，**不重生**）。
     *
     * 这段逻辑本来就有，被注释在 `execSpawn` 下面（352-364 行）：
     *   `if(!Game.creeps[flag.memory.creepName]) { ... else { flag.remove(); } }`
     * 注释掉之后，`flag.memory.creepName` 永远不会被清空，于是
     * `execSpawn` 第一行的重建条件 `!flag.memory.creepName` 恒假 ——
     * **队伍死了既不重生、旗也永远不被清**，变成僵尸旗
     * （实测 `raL1_E59S38_1` 里记的爬 34 万 tick 前就死了，旗一直挂着）。
     *
     * 返回 true 表示这面旗已经处理完（删了），调用方直接 return。
     *
     * 几个保守条件，避免误杀：
     *  · `_keeper` 型是常驻队，走「清名重生」那条路，不清旗；
     *  · 带 `taskId` 的队由跨片流程管（`execSpawnCrossShard`），不清旗；
     *  · **防抖**：刚 `trySpawn` 出来的那一两 tick 里 `Game.creeps` 可能还没有这只爬，
     *    直接删会误杀正在出生的队伍 —— 要连续 3 次查不到（exec 每 3 tick 一次，
     *    即约 9 tick）才算，且距 spawnTime 至少 10 tick。
     */
    expireDeadTeamFlag (flag) {
        let name = flag.memory.creepName;
        if (!name) return false;
        if (flag.name.indexOf("_keeper") >= 0) return false;
        if (flag.memory.taskId) return false;
        // 孵化中（Game.spawns 的 spawning 队列能查到占位名）按存活算：
        // 否则 150 tick 孵化期一过 10 tick 宽限就 3 连 miss 误删旗。
        // 原生 JS 遍历 Game.spawns（测试 VM 没有 lodash 的 _）。
        let spawningSomewhere = false;
        for (let sn in Game.spawns) {
            if (Game.spawns[sn].spawning && Game.spawns[sn].spawning.name == name) {
                spawningSomewhere = true;
                break;
            }
        }
        if (Game.creeps[name] || spawningSomewhere
            || !flag.memory.spawnTime || Game.time - flag.memory.spawnTime < 10) {
            flag.memory.missingCnt = 0;
            return false;
        }
        flag.memory.missingCnt = (flag.memory.missingCnt || 0) + 1;
        if (flag.memory.missingCnt < 3) return false;
        flag.remove();
        return true;
    },
    execSpawn (flag,raBody,raBoost) {
        if (pro.expireDeadTeamFlag(flag)) return;
        if (!flag.memory.concatTime) flag.memory.concatTime = Game.map.getRoomLinearDistance(flag.pos.roomName, flag.getRoomName()) * 50;
        if(!flag.memory.creepName || (flag.name.indexOf("_keeper")>=0 && flag.memory.spawnTime+1450-flag.memory.concatTime<Game.time)){
            let room = Game.rooms[flag.getRoomName()]
            if(!room||!room.my||room.level<8){
                flag.remove();Logger.log("TeamRaL1", flag.getRoomName()+" 不是你的房间或没8级");
                return;
            }
            // log(pro.raBoost)
            if(!StationLab.boostAble(room,raBoost)){
                Logger.log("TeamRaL1", room.name+" 资源不足");
                return;
            }

            let task =  [
                UtilsTask.taskFlag(flag,"raL1","registerRaL1")
            ]
            if(raBoost)task.push(StationLab.generatorBoostResTask(raBoost).head())
            // 占位：trySpawn 返回爬名后立即写入 creepName——孵化约 150 tick，
            // 期间 Game.creeps 还没有这只爬，没有占位会每 3 tick 重复排队
            // （多 spawn 房能把 3 个 spawn 全排满）。registerRaL1 写同名。
            let name = StationHive.trySpawn(room,"global",raBody,"raL1",task)
            if(name) flag.memory.creepName = name
        }
        // if(!Game.creeps[flag.memory.creepName]){
            // if(flag.name.indexOf("_keeper")>=0){
            //     if(flag.memory.spawnTime+1300<Game.time || !flag.memory.spawnTime){
            //         delete flag.memory.creepName;
            //         // if(flag.name.indexOf("_skip")>=0){
            //         //     flag.setPositionNextTick(new RoomPosition( 25, 2,"E24N3"))
            //         // }
            //     }
            // }
            // else{
            //     flag.remove();
            // }
        // }
    },
    exec () {
        if(global.taskDispatchThrottle !== false && Game.time%3!=0)return;
        ManagerFlags.getFlagsByPrefix("raL1").forEach(flag=>{
            if(flag.name.indexOf("crossShard")>0)
                pro.execSpawnCrossShard(flag,pro.raBody1,pro.raBoost1())
            else
                pro.execSpawn(flag,pro.raBody1,pro.raBoost1())
        });
        ManagerFlags.getFlagsByPrefix("raL2").forEach(flag=>{
            if(flag.name.indexOf("crossShard")>0)
                pro.execSpawnCrossShard(flag,pro.raBody2,pro.raBoost2())
            else
                pro.execSpawn(flag,pro.raBody2,pro.raBoost2())
        });
        ManagerFlags.getFlagsByPrefix("raL3").forEach(flag=>{
            if(flag.name.indexOf("crossShard")>0)
                pro.execSpawnCrossShard(flag,pro.raBody3, pro.raBoost3())
            else
                pro.execSpawn(flag,pro.raBody3, pro.raBoost3())
        });
        ManagerFlags.getFlagsByPrefix("raL4").forEach(flag=>{
            if(flag.name.indexOf("crossShard")>0)
                pro.execSpawnCrossShard(flag,pro.raBody4)
            else
                pro.execSpawn(flag,pro.raBody4)
        });
        ManagerFlags.getFlagsByPrefix("raL5").forEach(flag=>{
            if(flag.name.indexOf("crossShard")>0)
                pro.execSpawnCrossShard(flag,pro.raBody5)
            else
                pro.execSpawn(flag,pro.raBody5)
        });
    }
}

global.TeamRaL1=pro;

// Opt-in defense on the two shards that own the source and target configs.
// Target W31N51 owns the Safe Mode dispatch decision; W31N55 owns spawning.
// A disposable scout reports the entire landing room, because the exact
// landing square is not guaranteed. Fighters travel single-file, then rally
// as a four-member 2x2 in their tower zone. Do not chase outside that zone.
const GARRISON_MEMORY_KEY = "crossShardGarrisons";
const GARRISON_REPLACE_TTL = 750;
const GARRISON_PLAN_MAX_AGE = 150000;
const GARRISON_LANDING_MAX_AGE = 90000;
const GARRISON_MAX_LEAD = 1000;
const GARRISON_EXEC_INTERVAL = 10;
// Ranged slots 0/2 face the historically observed northern approach.
const GARRISON_OFFSETS = [[0,0],[0,1],[1,0],[1,1]];
// W31N55 has no east exit into W30N55. The verified northern route
// bypasses both that dead edge and the foreign W31N51/52/53 rooms.
const GARRISON_W31_ORIGIN_ROUTE = ["W31N55","W31N56","W30N56","W30N55","W30N54","W30N53","W30N52","W30N51","W30N50"];
const GARRISON_W31_MUSTER = {W31N55:{x:2,y:14},W31N56:{x:41,y:47},W30N56:{x:1,y:45},W30N55:{x:5,y:1}};
// W31N55's north border has open 2x2 tiles behind a one-tile gap in the
// wall line at y=3. Hold the square on the reachable side of that gap.
const GARRISON_W31_GATES = {
    W31N55:{x:38,y:0,staging:{x:37,y:4}},W31N56:{x:49,y:46},W30N56:{x:6,y:49},
};
const garrisonTravelPaths = Object.create(null);
const garrisonMusterCache = Object.create(null);

function garrisonRange(a,b) {
    const p = a?.pos || a, q = b?.pos || b;
    if (!p || !q || (p.roomName && q.roomName && p.roomName !== q.roomName)) return Infinity;
    return Math.max(Math.abs(p.x-q.x), Math.abs(p.y-q.y));
}

const garrisonBodySpecs = Object.create(null);
function garrisonBodySpec(slot) {
    const healer=Number.isInteger(slot)&&slot%2===1;
    const key=healer?"heal":"ranged";
    if(garrisonBodySpecs[key])return garrisonBodySpecs[key];
    const preset=healer?global.teamL2?.getR2H2heal?.():global.teamL2?.getR2H2ra?.();
    if(!Array.isArray(preset)||preset.length!==50)return;
    // Keep the TeamL2 R2H2 part counts, with armor first to protect active
    // ranged/heal parts while the hostile four-RA volley is being absorbed.
    const body=preset.filter(p=>p===TOUGH).concat(preset.filter(p=>p!==TOUGH));
    const parts=[[TOUGH,"XGHO2"],[RANGED_ATTACK,"XKHO2"],[MOVE,"XZHO2"],[HEAL,"XLHO2"]]
        .map(([type,boost])=>[type,boost,body.filter(p=>p===type).length]);
    const boosts=Object.fromEntries(parts.map(([,boost,n])=>[boost,n*30]));
    return garrisonBodySpecs[key]={body,parts,boosts};
}
function garrisonBodyReady(creep,slot) {
    const design=garrisonBodySpec(slot);
    return !!design&&design.parts.every(([type,boost,n])=>creep.body?.filter(p=>
        p.type===type&&p.boost===boost&&p.hits>0).length>=n);
}

function garrisonFresh(frame,maxAge) {
    const age = Date.now() - frame?.observedAt;
    return age >= 0 && age <= maxAge;
}

function garrisonPower(creep,type,ability,base) {
    return (creep.body || []).reduce((n,p) => n + (p.type===type&&p.hits>0
        ? base * (global.BOOSTS?.[type]?.[p.boost]?.[ability] || 1) : 0), 0);
}

function garrisonIncoming(creep, hostiles) {
    return hostiles.reduce((sum,h) => sum + (garrisonRange(h,creep)<=1
        ? garrisonPower(h,ATTACK,"attack",30) : 0) + (garrisonRange(h,creep)<=3
        ? garrisonPower(h,RANGED_ATTACK,"rangedAttack",10) : 0), 0);
}

function garrisonDamageAfterTough(creep, incoming) {
    let actual = 0;
    for (const p of creep.body || []) {
        if (!incoming || !(p.hits > 0)) continue;
        const factor = p.type === TOUGH ? global.BOOSTS?.[TOUGH]?.[p.boost]?.damage || 1 : 1;
        const portion = Math.min(incoming,p.hits / factor);
        incoming -= portion;
        actual += portion * factor;
    }
    return actual + incoming;
}

function garrisonHostiles(room) {
    return room.getHostileCreeps ? room.getHostileCreeps() : room.find(FIND_HOSTILE_CREEPS);
}

function garrisonArmed(hostile) {
    return hostile.getActiveBodyparts(ATTACK) > 0 || hostile.getActiveBodyparts(RANGED_ATTACK) > 0;
}

function garrisonLandingClear(room) {
    return !room.controller?.owner && !garrisonHostiles(room).some(garrisonArmed)
        && !room.find(FIND_HOSTILE_POWER_CREEPS).length
        && !room.find(FIND_HOSTILE_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_TOWER}).length;
}

function garrisonCanAdvance(next, task, arrived) {
    if(next===task.roomName)return true; // The owned room may need active defense.
    const room=Game.rooms[next];
    if(arrived)return !!room&&(room._garrisonRouteClear??=garrisonLandingClear(room));
    return !room||(!room.controller?.owner||room.controller.my)&&!garrisonHostiles(room).some(garrisonArmed);
}

function garrisonLandmarks(cfg) {
    const exit = cfg.path?.path?.[0];
    if (cfg.path?.path?.length !== 1 || !exit || exit.shard !== cfg.originShard) return;
    // Inter-shard arrival is somewhere in the destination room, not on
    // the paired return portal. Only the room name is pinned here.
    const landingRoom=cfg.landingRoom||exit.roomName;
    const route=cfg.landingRoute||(cfg.roomName==="W31N51"?["W30N50","W30N51","W31N51"]:[landingRoom,cfg.roomName]);
    if (!Array.isArray(route)||route[0]!==landingRoom||route.at(-1)!==cfg.roomName) return;
    const originRoute=cfg.originRoute||(cfg.roomName==="W31N51"?GARRISON_W31_ORIGIN_ROUTE:[cfg.spawnRoom,exit.roomName]);
    if(!Array.isArray(originRoute)||originRoute[0]!==cfg.spawnRoom||originRoute.at(-1)!==exit.roomName)return;
    return {path:cfg.path.path,landingRoom,route,originRoute};
}

function garrisonTravel(creep,nextRoom,chosen) {
    const exit = Game.map.findExit(creep.room.name,nextRoom);
    if (exit < 0) return;
    const border = chosen ? new RoomPosition(chosen.x,chosen.y,creep.room.name) : creep.pos.findClosestByRange(exit);
    if (!border) return;
    if (creep.pos.isEqualTo(border)) creep.move(exit);
    else creep.moveTo(border,{range:0,maxRooms:1,reusePath:8,maxOps:1200,costCallback:(name,matrix)=>{
        if(name!==creep.room.name)return matrix;
        for(const obj of creep.room.find(FIND_STRUCTURES,{filter:s=>s.structureType==="portal"}))
            matrix.set(obj.pos.x,obj.pos.y,255);
        return matrix;
    }});
}

function garrisonPivot(crew) {
    if(crew.length!==4||!crew.every(c=>c.room.name===crew[0].room.name))return;
    const x=Math.min(...crew.map(c=>c.pos.x)),y=Math.min(...crew.map(c=>c.pos.y));
    if(new Set(crew.map(c=>c.pos.x*50+c.pos.y)).size!==4
        ||crew.some(c=>c.pos.x>x+1||c.pos.y>y+1))return;
    return new RoomPosition(x,y,crew[0].room.name);
}

function garrisonBlocks(room,crew) {
    const closed=new Set(),own=new Set(crew.map(c=>c.id||c.name));
    for(const s of room.find(FIND_STRUCTURES))if(s.structureType==="portal"||OBSTACLE_OBJECT_TYPES.includes(s.structureType)
        ||(s.structureType==="rampart"&&!s.my&&!s.isPublic))closed.add(s.pos.x*50+s.pos.y);
    for(const c of room.find(FIND_CREEPS))if(!own.has(c.id||c.name))closed.add(c.pos.x*50+c.pos.y);
    return closed;
}

function garrisonSquareLegal(room, x,y,closed,terrain) {
    return x>=1&&y>=1&&x<48&&y<48&&GARRISON_OFFSETS.slice(0,4).every(([dx,dy])=>
        terrain.get(x+dx,y+dy)!==TERRAIN_MASK_WALL&&!closed.has((x+dx)*50+y+dy));
}

/**
 * Walk one room forward when the wave is split across a travel route.
 *
 * `garrisonMuster` only ever regroups members **inside** one room, so a wave
 * that lost `roomExit` (or whose trailing pair never got it) deadlocks:
 * the forward half waits for four at its muster post, the trailing half waits
 * for four at its own, and nobody walks the single room between them. Both
 * halves then age out on the spot (2026-11-28 live: wave 84534470 = slots 0/2
 * parked at W31N56 (41,47) and slots 1/3 at W31N55 (2,15), zero movement for
 * 1,300+ ticks, 136 ticks to live, `cfg.wave` unchanged so `ensure()` sees a
 * fully covered roster and never refreshes).
 *
 * Only a subset that is **behind** someone already on the route moves, and
 * only into a room `garrisonCanAdvance` calls clear — a squad that has never
 * left home still may not start the route on its own (test 11), and an armed
 * room still stops the walk one border short instead of feeding creeps in.
 */
function garrisonRejoinStep(creep,task,crew,arrived) {
    // The same deadlock exists on the landing leg, one shard later: the three
    // who crossed the border hold the muster post waiting for four while the
    // laggard holds its own post a room back (2026-11-28 live: wave 84542970
    // slots 0/1/2 at W30N51 (12,47)+, slot 3 alone at W30N50 (16,3), zero
    // movement for ~900 ticks). Muster never crosses a border, so the landing
    // route needs the identical one-room step.
    if(Game.shard.name!==(arrived?task.targetShard:task.originShard))return false;
    const route=arrived?task.landingRoute:task.originRoute;
    if(!Array.isArray(route))return false;
    const index=route.indexOf(creep.room.name);
    if(index<0)return false;
    const ahead=crew.some(c=>c!==creep&&!c.spawning&&c.room.name!==creep.room.name
        &&route.indexOf(c.room.name)>index);
    if(!ahead)return false;
    const next=route[index+1];
    if(!next)return false;
    // On the origin leg only the full crew may cross, and only through the
    // portal; the target room is reached as a complete wave.
    if(!arrived&&next===task.roomName)return false;
    if(!garrisonCanAdvance(next,task,arrived))return false;
    const gate=arrived?undefined:GARRISON_W31_GATES[creep.room.name];
    garrisonTravel(creep,next,gate?{x:gate.x,y:gate.y}:undefined);
    return true;
}

function garrisonMuster(creep,task,crew,baseOverride) {
    // Assembling at home or after a split crossing is the only independent
    // movement in an ordinary room. No member leaves it until the square is complete.
    const room=creep.room,key=room.name+":"+task.roomName+":"+task.wave+(baseOverride?":handover":"");
    let p=garrisonMusterCache[key];
    if(!p||Game.time-p.tick>30){
        const preferred=task.roomName==="W31N51"&&Game.shard.name===task.originShard&&GARRISON_W31_MUSTER[room.name];
        const base=baseOverride||preferred||(task.roomExit?.to===room.name&&task.roomExit.landing)
            ||(room.name===task.homeRoom && room.spawn?.[0]?.pos)||creep.pos;
        const terrain=Game.map.getRoomTerrain(room.name),closed=garrisonBlocks(room,crew);
        let best,rank=Infinity;
        for(let x=base.x-5;x<=base.x+5;x++)for(let y=base.y-5;y<=base.y+5;y++){
            if(!garrisonSquareLegal(room,x,y,closed,terrain))continue;
            const r=garrisonRange({x,y},base);
            if(r<rank){rank=r;best={x,y,tick:Game.time};}
        }
        p=best;
        if(p)garrisonMusterCache[key]=p;
    }
    const slot=GARRISON_OFFSETS[task.slot];
    if(!p||!slot)return;
    const post=new RoomPosition(p.x+slot[0],p.y+slot[1],room.name);
    if(!creep.pos.isEqualTo(post))creep.moveTo(post,{range:0,maxRooms:1,reusePath:3,maxOps:700});
}

function garrisonMoveSquare(crew,direction,key) {
    if(!direction||crew.some(c=>c.fatigue||c.getActiveBodyparts(MOVE)<=0))return false;
    const moves=Game._garrisonMoveIssued||(Game._garrisonMoveIssued={});
    if(moves[key])return false;
    moves[key]=true;
    const war=global.WarTeamCore?.action;
    if(!war?.team4checkSquarePos({ _creeps:crew }))return false;
    return war.moveByDirection({_creeps:crew,_direction:direction});
}

function garrisonNavigateSquare(crew, pivot, goals, key) {
    if(!goals.length||crew.some(c=>c.fatigue))return;
    const {room}=crew[0], goalKey=goals.map(g=>g.pos.x+":"+g.pos.y+":"+g.range).join(";");
    const terrain=Game.map.getRoomTerrain(room.name),closed=garrisonBlocks(room,crew);
    let data=garrisonTravelPaths[key];
    if(data?.goalKey===goalKey&&data.path[0]?.isEqualTo(pivot))data.path.shift();
    let next=data?.goalKey===goalKey&&data.path[0];
    if(!next||garrisonRange(next,pivot)!==1||!garrisonSquareLegal(room,next.x,next.y,closed,terrain)){
        if(!global.WarCache)return;
        const result=PathFinder.search(pivot,goals,{maxRooms:1,maxOps:2400,
            roomCallback:name=>name===room.name?WarCache.getMoveAbleCostMatrix(name,crew,1000,undefined,0,true,true,false,5):false});
        if(result.incomplete)return;
        garrisonTravelPaths[key]={goalKey,path:result.path,tick:Game.time};
        next=result.path[0];
    }
    if(garrisonTravelPaths[key])garrisonTravelPaths[key].tick=Game.time;
    if(next&&garrisonSquareLegal(room,next.x,next.y,closed,terrain))
        garrisonMoveSquare(crew,pivot.getDirectionTo(next),key);
}

function garrisonExitPlan(room,next,pivot,crew,pin) {
    const dir=Game.map.findExit(room.name,next);
    if(dir<0)return;
    const exits=room.find(dir).filter(p=>!pin||p.x===pin.x&&p.y===pin.y);
    const closed=garrisonBlocks(room,crew),terrain=Game.map.getRoomTerrain(room.name);
    if(pin?.staging){
        const {x,y}=pin.staging;
        return exits.length&&garrisonSquareLegal(room,x,y,closed,terrain)
            ? [{pos:new RoomPosition(x,y,room.name),range:0,exit:{x:pin.x,y:pin.y},dir}] : [];
    }
    const choices=[],seen=new Set();
    for(const e of exits){
        // Approach the edge as a square; the one/two-tile threshold itself
        // is handled by a bounded, shared crossing record.
        for(let offset=0;offset<2;offset++){
            const x=dir===RIGHT?47:dir===LEFT?1:e.x-offset;
            const y=dir===BOTTOM?47:dir===TOP?1:e.y-offset;
            if(seen.has(x*50+y)||!garrisonSquareLegal(room,x,y,closed,terrain))continue;
            seen.add(x*50+y);
            choices.push({pos:new RoomPosition(x,y,room.name),range:0,exit:{x:e.x,y:e.y},dir});
        }
    }
    if(!choices.length&&exits.length) {
        // Some real gates narrow to one tile several steps before the edge.
        // Keep the full square until an interior holding square can reach
        // the same exit in <=8 single-file steps for all four members.
        const pass=(x,y)=>x>=0&&y>=0&&x<50&&y<50
            &&terrain.get(x,y)!==TERRAIN_MASK_WALL&&!closed.has(x*50+y);
        for(const e of exits){
            const dist=new Map([[e.x*50+e.y,0]]),queue=[[e.x,e.y,0]];
            for(let i=0;i<queue.length;i++){
                const [x,y,d]=queue[i];if(d>=8)continue;
                for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){
                    const X=x+a,Y=y+b,k=X*50+Y;
                    if(pass(X,Y)&&!dist.has(k)){dist.set(k,d+1);queue.push([X,Y,d+1]);}
                }
            }
            let depth=Infinity, best=[];
            for(const [x,y,d] of queue){
                if(!garrisonSquareLegal(room,x,y,closed,terrain))continue;
                if(!GARRISON_OFFSETS.every(([a,b])=>dist.has((x+a)*50+y+b)))continue;
                const score=Math.max(...GARRISON_OFFSETS.map(([a,b])=>dist.get((x+a)*50+y+b)));
                if(score<depth){depth=score;best=[];}
                if(score===depth)best.push({pos:new RoomPosition(x,y,room.name),range:0,exit:{x:e.x,y:e.y},dir});
            }
            choices.push(...best);
        }
    }
    choices.sort((a,b)=>garrisonRange(pivot,a.pos)-garrisonRange(pivot,b.pos));
    return choices.slice(0,48);
}

function garrisonBestSlots(units,spec) {
    const list=Array(4).fill(null);
    for(const c of units){
        const i=spec(c).slot;
        if(Number.isInteger(i)&&i>=0&&i<4&&(!list[i]||(c.ticksToLive||0)>(list[i].ticksToLive||0)))list[i]=c;
    }
    return list;
}

function garrisonManeuver(room,crew,posts,hostiles,focus,uncovered,towerRange=8) {
    const pivot=garrisonPivot(crew),home=posts[0];
    if(!pivot||!home||crew.some(c=>c.fatigue||c.getActiveBodyparts(MOVE)<=0))return;
    const target=focus||hostiles.filter(h=>garrisonRange(h,home)<=9)
        .sort((a,b)=>garrisonRange(a,home)-garrisonRange(b,home)||String(a.id||a.name).localeCompare(String(b.id||b.name)))[0];
    if(!target&&garrisonRange(pivot,home)===0)return;
    const retreat=crew.some(c=>c.hits<c.hitsMax*0.7||(uncovered.get(c.name)||0)>c.hits*0.22);
    const closed=garrisonBlocks(room,crew),terrain=Game.map.getRoomTerrain(room.name);
    const towers=(room.tower||[]).filter(t=>t.my!==false&&(t.store?.[RESOURCE_ENERGY]||0)>=10);
    const healBudget=crew.reduce((n,c)=>n+garrisonPower(c,HEAL,"heal",12),0);
    const firepower=crew.map(c=>garrisonPower(c,RANGED_ATTACK,"rangedAttack",10));
    const pressure=(x,y)=>crew.map(c=>{
        const a={x:x+c.pos.x-pivot.x,y:y+c.pos.y-pivot.y,roomName:room.name};
        return garrisonDamageAfterTough(c,garrisonIncoming(a,hostiles));
    });
    const before=pressure(pivot.x,pivot.y);
    const deathPressure=(p)=>Math.max(...p.map((n,i)=>n/Math.max(1,crew[i].hits)));
    let best=-Infinity,next=null;
    // Include staying still. Ties never cause wandering or an independent chase.
    for(const [dx,dy] of [[0,0],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]){
        const x=pivot.x+dx,y=pivot.y+dy, pos={x,y,roomName:room.name};
        if(garrisonRange(pos,home)>6||!garrisonSquareLegal(room,x,y,closed,terrain))continue;
        if(GARRISON_OFFSETS.some(([a,b])=>garrisonRange({x:x+a,y:y+b},room.controller)<=2))continue;
        if(towers.length&&!GARRISON_OFFSETS.every(([a,b])=>towers.some(t=>garrisonRange({x:x+a,y:y+b},t)<=towerRange)))continue;
        const after=pressure(x,y), damage=after.reduce((n,v)=>n+v,0), prevDamage=before.reduce((n,v)=>n+v,0);
        if((dx||dy)&&!retreat&&((damage>healBudget*0.95&&damage>prevDamage)||deathPressure(after)>0.5))continue;
        const d=garrisonRange(pos,home), targetDistance=target?garrisonRange(pos,target):0;
        const shots=target?crew.reduce((n,c,i)=>n+(garrisonRange({x:x+c.pos.x-pivot.x,y:y+c.pos.y-pivot.y},target)<=3?firepower[i]:0),0):0;
        const metric=retreat?-damage-deathPressure(after)*1500-d*25
            :target?shots*0.4-targetDistance*28-d*4-damage*0.08:-d*100;
        if(metric>best){best=metric;next=(dx||dy)?new RoomPosition(x,y,room.name):null;}
    }
    return next?pivot.getDirectionTo(next):null;
}

const garrisonPostCache = Object.create(null);
const garrisonFallBackUntil = Object.create(null);
function garrisonEntryTile(gate) {
    if(!gate||![gate.x,gate.y].every(v=>Number.isInteger(v)&&v>=0&&v<=49))return;
    if(gate.x===0||gate.x===49)return {x:49-gate.x,y:gate.y};
    if(gate.y===0||gate.y===49)return {x:gate.x,y:49-gate.y};
}

function garrisonPositions(room,cfg,count) {
    const anchor = cfg.anchor || {x:41,y:35};
    const range=cfg.towerRange||7, entry=cfg.entry;
    const key=room.name+":"+anchor.x+":"+anchor.y+":"+count+":"+range+":"+(entry?entry.x+":"+entry.y:"-"), cached=garrisonPostCache[key];
    if(cached&&Game.time-cached.tick<20)return cached.posts;
    const terrain = Game.map.getRoomTerrain(room.name);
    const blockers = new Set(), roads = new Set();
    for (const obj of room.find(FIND_STRUCTURES)) {
        const p=obj.pos.x*50+obj.pos.y;
        if (obj.structureType==="road") roads.add(p);
        if (obj.structureType==="portal" || obj.structureType==="container"
            || OBSTACLE_OBJECT_TYPES.includes(obj.structureType)
            || (obj.structureType==="rampart" && !obj.my && !obj.isPublic)) blockers.add(p);
    }
    const towers = (room.tower || []).filter(t=>t.my!==false);
    const legal = (x,y) => x>0&&y>0&&x<49&&y<49&&terrain.get(x,y)!==TERRAIN_MASK_WALL
        && !blockers.has(x*50+y) && garrisonRange({x,y},room.controller)>3
        && (!towers.length || towers.some(t=>garrisonRange({x,y},t)<=range));
    let best, bestCoverage=0, score=Infinity;
    for(let x=anchor.x-4;x<=anchor.x+4;x++) for(let y=anchor.y-4;y<=anchor.y+4;y++){
        const slots=GARRISON_OFFSETS.slice(0,Math.max(4,count)).map(([dx,dy])=>[x+dx,y+dy]);
        if(!slots.slice(0,4).every(([a,b])=>legal(a,b)))continue;
        const extras=slots.slice(4).map(([a,b])=>legal(a,b)?[a,b]:null);
        const posts=[...slots.slice(0,4),...extras];
        // Fire on the tile across the border from the pinned exit. Prefer a
        // full four-creep volley; do not tie the square to a side of the gate.
        const coverage=entry?posts.slice(0,4).filter(([a,b])=>garrisonRange({x:a,y:b},entry)<=3).length:0;
        if(entry&&!coverage)continue;
        const value=garrisonRange({x,y},anchor)*4+extras.filter(p=>!p).length*5
            + posts.filter(p=>p&&roads.has(p[0]*50+p[1])).length*7;
        if(coverage>bestCoverage||(coverage===bestCoverage&&value<score)){
            bestCoverage=coverage;score=value;best=posts;
        }
    }
    if(entry&&!best){garrisonPostCache[key]={tick:Game.time,posts:[]};return [];}
    const free=[];
    for(let x=anchor.x-5;x<=anchor.x+5;x++)for(let y=anchor.y-5;y<=anchor.y+5;y++){
        if(legal(x,y)&&!best?.some(p=>p&&p[0]===x&&p[1]===y))free.push([x,y]);
    }
    free.sort((a,b)=>Number(roads.has(a[0]*50+a[1]))-Number(roads.has(b[0]*50+b[1]))
        ||garrisonRange({x:a[0],y:a[1]},anchor)-garrisonRange({x:b[0],y:b[1]},anchor));
    const posts=(best||Array(count).fill(null)).map(p=>p||free.shift()).map(p=>p&&new RoomPosition(p[0],p[1],room.name));
    garrisonPostCache[key]={tick:Game.time,posts};
    return posts;
}

const garrisonPro = {
    memoryKey:GARRISON_MEMORY_KEY,
    replaceTtl:GARRISON_REPLACE_TTL,
    config(name) { return Memory[GARRISON_MEMORY_KEY]?.[name]; },
    squad() { return 4; },
    units(name) {
        const tick = Game._crossGarrisonUnits || (Game._crossGarrisonUnits = {});
        const assigned = c => {
            const task = this.spec(c);
            return task && (task.garrisonRoom || task.roomName) === name;
        };
        // Spawn/boost/defend can pop an assignment mid-tick. Cache the global
        // search, not membership: revalidate the small candidate list on use.
        if (tick[name]) return tick[name].filter(assigned);
        return tick[name] = Object.values(Game.creeps).filter(assigned);
    },
    spec(creep) {
        return creep.memory?.tasks?.find(t=>t?.taskName==="crossShardGarrison"||t?.taskName==="crossShardGarrisonScout");
    },
    receivePlan(data,landing=false) {
        const cfg = data && this.config(data.roomName);
        if (!cfg || cfg.active===false || cfg.originShard!==Game.shard.name || cfg.targetShard!==data.targetShard
            || !garrisonFresh(data,GARRISON_PLAN_MAX_AGE)) return false;
        if(landing){
            if(data.landingRoom!==garrisonLandmarks(cfg)?.landingRoom)return false;
            if (!cfg.landing || data.observedAt >= cfg.landing.observedAt) cfg.landing = {
                observedAt:data.observedAt,clear:data.clear===true,room:data.landingRoom,
            };
        } else if(!cfg.remote || data.observedAt>=cfg.remote.observedAt){
            if(!Array.isArray(data.members))return false;
            cfg.remote={observedAt:data.observedAt,open:data.open===true,members:data.members.slice(0,16),scoutTtl:data.scoutTtl||0};
            cfg.dispatchEnabled=cfg.remote.open;
        }
        return true;
    },
    canEnterPortal(creep,task,portal) {
        const cfg=this.config(task.garrisonPortal.roomName),route=cfg&&garrisonLandmarks(cfg);
        if(!cfg||!route||cfg.active===false||cfg.originShard!==Game.shard.name
            ||portal.destination?.shard!==cfg.targetShard||portal.destination?.room!==route.landingRoom
            ||!garrisonFresh(cfg.remote,GARRISON_PLAN_MAX_AGE)||!cfg.remote.open) return false;
        const scout=task.garrisonPortal.kind==="scout";
        if(!scout&&task.garrisonPortal.wave!==undefined&&task.garrisonPortal.wave!==cfg.wave)return false;
        if(!scout&&(!garrisonBodyReady(creep,task.garrisonPortal.slot)||!garrisonFresh(cfg.landing,GARRISON_LANDING_MAX_AGE)
            ||cfg.landing.room!==route.landingRoom||!cfg.landing.clear))return false;
        const used=Game._garrisonPortalUsed||(Game._garrisonPortalUsed={});
        const key=portal.id||portal.pos.roomName+":"+portal.pos.x+":"+portal.pos.y;
        if(used[key]&&used[key]!==creep.name)return false;
        used[key]=creep.name;
        return true;
    },
    audit(cfg) {
        const room=Game.rooms[cfg.roomName];
        if(!room?.controller||!room.controller.my)return;
        if(cfg.audit&&Game.time-cfg.audit.tick<20)return;
        const safe=room.controller.safeMode||0;
        const lead=Math.min(GARRISON_MAX_LEAD,Math.max(650,Number(cfg.leadTicks)||GARRISON_MAX_LEAD));
        const hostiles=garrisonHostiles(room), units=this.units(cfg.roomName);
        const fighters=units.filter(c=>this.spec(c).taskName==="crossShardGarrison");
        const members=fighters.map(c=>[this.spec(c).slot,c.name,c.ticksToLive??1500,c.room.name===cfg.roomName,this.spec(c).wave]);
        const scoutTtl=Math.max(0,...units.filter(c=>this.spec(c).taskName==="crossShardGarrisonScout").map(c=>c.ticksToLive??1500));
        const inRoom=fighters.filter(c=>c.room.name===cfg.roomName);
        cfg.audit={tick:Game.time,safeMode:safe,safeModeAvailable:room.controller.safeModeAvailable,
            hostiles:hostiles.length,hostileOwners:[...new Set(hostiles.map(c=>c.owner?.username))].slice(0,4),
            hostileHeal:hostiles.reduce((n,c)=>n+c.getActiveBodyparts(HEAL),0),
            hostileRangedAttack:hostiles.reduce((n,c)=>n+c.getActiveBodyparts(RANGED_ATTACK),0),
            hostileAttack:hostiles.reduce((n,c)=>n+c.getActiveBodyparts(ATTACK),0),
            hostileBoosted:hostiles.filter(c=>c.body?.some(p=>p.boost)).length,
            garrison:inRoom.length,garrisonNames:inRoom.map(c=>c.name),garrisonReady:inRoom.filter(c=>garrisonBodyReady(c,this.spec(c).slot)).length,
            inTransit:fighters.length-inRoom.length,towers:(room.tower||[]).map(t=>t.store[RESOURCE_ENERGY]||0),
            lastHostileTick:hostiles.length?Game.time:(cfg.audit?.lastHostileTick||0),dispatchWindow:lead,
        };
        if (hostiles.length) cfg.lastAttack=Object.assign({tick:Game.time}, {
            creeps:hostiles.slice(0,8).map(c=>[c.owner?.username,c.name,c.pos.x,c.pos.y,
                (c.body||[]).filter(p=>p.hits>0).reduce((n,p)=>{const k=p.type+(p.boost?":"+p.boost:"");n[k]=(n[k]||0)+1;return n;},{})]),
        });
        ManagerCrossShard.addCrossShardRequest(cfg.originShard,{
            func:"crossShardGarrisonPlan",data:{roomName:cfg.roomName,targetShard:cfg.targetShard,
                observedAt:Date.now(),open:safe<=lead,members,scoutTtl},
        },"garrison-plan:"+cfg.roomName+":"+Game.time);
    },
    covered(cfg,slot,units) {
        const all=cfg.remote.members.filter(x=>x[0]===slot&&x[4]===cfg.wave);
        const record=cfg.roster[slot];
        if(all.some(x=>x[2]>0))return true;
        const here=units.find(c=>this.spec(c).slot===slot&&this.spec(c).taskName==="crossShardGarrison"
            && this.spec(c).wave===cfg.wave && (c.spawning || (c.ticksToLive||0)>180));
        if(here){
            if(record?.name===here.name)record.lastSeen=Game.time;
            return true;
        }
        if(!record)return false;
        if(all.some(x=>x[1]===record.name)){record.landed=true;return false;}
        // Between leaving origin Game.creeps and arriving in the next target
        // report, a real spawn must still occupy its slot.
        return !record.landed && Game.time-(record.lastSeen||record.tick)<90;
    },
    ensure(cfg) {
        if(!garrisonFresh(cfg.remote,GARRISON_PLAN_MAX_AGE)||!cfg.remote.open){
            cfg.dispatchError="waiting safe-mode window";
            return;
        }
        const room=Game.rooms[cfg.spawnRoom],land=garrisonLandmarks(cfg);
        if(!room?.my||!land||!global.StationLab||!global.StationHive)return;
        const units=this.units(cfg.roomName);
        const atTarget=cfg.remote.members.filter(x=>x[3]&&x[4]===cfg.wave);
        const complete=new Set(atTarget.map(x=>x[0])).size>=4;
        if(complete)cfg.waveDeployed=true;
        if(!cfg.wave||(cfg.waveDeployed&&(!complete||atTarget.some(x=>x[2]<=GARRISON_REPLACE_TTL)))){
            cfg.wave=Game.time; cfg.waveDeployed=false;cfg.roster={};
        }
        cfg.roster=cfg.roster||{};
        let missing=Array.from({length:this.squad(cfg)},(_,i)=>i).filter(i=>!this.covered(cfg,i,units));
        if(missing.length&&Object.keys(cfg.roster).length>=4&&(
            cfg.remote.members.some(x=>x[4]===cfg.wave)
            ||units.some(c=>this.spec(c).wave===cfg.wave&&c.room.name!==cfg.spawnRoom))){
            // A member lost after departure must not cause a lone highway
            // reinforcement. Launch a fresh complete wave instead.
            cfg.wave=Game.time;cfg.waveDeployed=false;cfg.roster={};
            missing=[0,1,2,3];
        }
        const available=()=>room.currentEnergyAvailable??room.energyAvailable;
        const free=()=>room.spawn.some(s=>!s.spawning&&!room.spawnedMap?.[s.id]&&s.isActive());
        const tasksFor=(kind,slot)=>{
            const task=UtilsTask.taskData(kind==="scout"?"crossShardGarrisonScout":"crossShardGarrison",
                "registerCrossShardGarrison",{roomName:cfg.roomName,garrisonRoom:cfg.roomName,slot,
                originShard:cfg.originShard,targetShard:cfg.targetShard,homeRoom:cfg.spawnRoom,
                landingRoom:land.landingRoom,landingRoute:land.route,originRoute:land.originRoute,
                portalPath:land.path,wave:cfg.wave});
            return [task];
        };
        // A filled roster can still be entirely on the source shard. It
        // needs a fresh landing report until the whole wave reaches the post.
        if((missing.length||!complete)&&cfg.remote.scoutTtl<180&&!units.some(c=>this.spec(c).taskName==="crossShardGarrisonScout"
            && (c.spawning||(c.ticksToLive||0)>180)) && Game.time-(cfg.scoutSentAt??-Infinity)>70 && free()&&available()>=50){
            const scout=StationHive.trySpawn(room,cfg.roomName,[MOVE],"raL1",tasksFor("scout",null));
            if(scout)cfg.scoutSentAt=Game.time;
        }
        for(const slot of missing){
            const spec=garrisonBodySpec(slot);
            if(!spec){cfg.dispatchError="missing TeamL2 R2H2 bodies";return;}
            const {body,boosts}=spec,cost=Utils.getBodyEnergyNeed(body);
            if(!free()||available()<cost) {cfg.dispatchError="waiting spawn capacity";return;}
            if(!StationLab.boostAble(room,boosts)) {cfg.dispatchError="boostAble=false";return;}
            // StationLab consumes task.data in place. Do not hand it the
            // role's cached recipe, or two same-role spawns share one order.
            const tasks=tasksFor("member",slot).concat(StationLab.generatorBoostResTask({...boosts},room));
            if(tasks.length<2) {cfg.dispatchError="no boost task";return;}
            const name=StationHive.trySpawn(room,cfg.roomName,body,"raL1",tasks);
            if(!name){cfg.dispatchError="spawn rejected";return;}
            cfg.roster[slot]={name,tick:Game.time};
            cfg.lastDispatch={tick:Game.time,name,slot};
        }
        delete cfg.dispatchError;
    },
    startPortal(creep,task,kind) {
        const cfg=this.config(task.roomName);
        if(!cfg||!garrisonFresh(cfg.remote,GARRISON_PLAN_MAX_AGE)||!cfg.remote.open){
            if(creep.ticksToLive<180){creep.memory.roomName=task.homeRoom;creep.popTask().addTask(UtilsTask.taskData("recycleCreep"));}
            return;
        }
        if(kind==="member"&&!garrisonBodyReady(creep,task.slot)){
            task.boostWaitAt ??= Game.time;
            if(Game.time-task.boostWaitAt>3){creep.memory.roomName=task.homeRoom;creep.popTask().addTask(UtilsTask.taskData("recycleCreep"));}
            return;
        }
        if(kind==="member"&&!task.portalReleased)return;
        if(!task.portalPath?.length)return;
        creep.addTask(UtilsTask.taskData("moveCrossShardByPath",undefined,{path:task.portalPath,
            expectedDestShard:task.targetShard,peaceful:true,garrisonPortal:{roomName:task.roomName,kind,wave:task.wave,slot:task.slot}})).execLastTask();
    },
    scout(creep,task) {
        if(Game.shard.name===task.originShard)return this.startPortal(creep,task,"scout");
        if(Game.shard.name!==task.targetShard)return;
        const room=creep.room, route=task.landingRoute, index=route?.indexOf(room.name)??-1;
        const atLanding=room.name===task.landingRoom;
        if(atLanding){
            const clear=garrisonLandingClear(room);
            if(task.landingClear!==clear||Game.time-(task.landingReportAt??-Infinity)>=8){
                task.landingClear=clear;task.landingReportAt=Game.time;
                ManagerCrossShard.addCrossShardRequest(task.originShard,{
                    func:"crossShardGarrisonLanding",data:{roomName:task.roomName,targetShard:task.targetShard,
                        observedAt:Date.now(),landingRoom:task.landingRoom,clear},
                },"garrison-landing:"+task.roomName+":"+Game.time);
            }
            if(!clear||Game.time<(task.scoutRetryAt||0))return;
        }
        if(index<0||!route[index+1]||route.length<=2)return;
        const fighters=this.units(task.roomName).filter(c=>!c.spawning&&this.spec(c).taskName==="crossShardGarrison");
        const wave=Math.max(-Infinity,...fighters.map(c=>this.spec(c).wave??0));
        const crew=garrisonBestSlots(fighters.filter(c=>(this.spec(c).wave??0)===wave),c=>this.spec(c));
        const full=crew.every(Boolean);
        if(!atLanding){
            const threatened=garrisonHostiles(room).some(c=>garrisonArmed(c)&&garrisonRange(c,creep)<=5);
            if(threatened)task.scoutRetryAt=Game.time+25;
            if(threatened||!full||crew.every(c=>c.room.name===task.roomName))return garrisonTravel(creep,route[index-1]);
            const {x,y}=creep.pos;
            if(x===0||x===49||y===0||y===49){ // Keep vision without stepping back across the boundary.
                const inside=new RoomPosition(Math.max(1,Math.min(48,x)),Math.max(1,Math.min(48,y)),room.name);
                return creep.move(creep.pos.getDirectionTo(inside));
            }
        }
        // Stay on the landing side until all four have crossed the portal.
        // Then give the fighters current vision of the first unowned leg.
        const next=route[index+1];
        if(full&&next!==task.roomName&&crew.some(c=>c.room.name===room.name))return garrisonTravel(creep,next);
    },
    travel(creep,task,arrived) {
        if(!arrived){
            const cfg=this.config(task.roomName);
            const fresh=garrisonFresh(cfg?.remote,GARRISON_PLAN_MAX_AGE);
            if(!cfg||cfg.wave!==task.wave||(fresh&&!cfg.remote.open)){
                if(creep.room.name===task.homeRoom){creep.memory.roomName=task.homeRoom;creep.popTask().addTask(UtilsTask.taskData("recycleCreep"));}
                return;
            }
            if(!fresh)return;
        }
        const key=task.roomName+":"+task.wave+":"+creep.room.name;
        const available=this.units(task.roomName).filter(c=>{
            const s=this.spec(c);
            return !c.spawning && s.taskName==="crossShardGarrison"&&s.wave===task.wave
                && c.lastTask()?.taskName==="crossShardGarrison"&&(arrived||garrisonBodyReady(c,s.slot));
        });
        const crew=garrisonBestSlots(available,c=>this.spec(c)).filter(Boolean);
        const s=task.roomExit;
        if(s){
            if(creep.room.name===s.from){
                if(!arrived||garrisonCanAdvance(s.to,task,true))return garrisonTravel(creep,s.to,s.exit);
                return;
            }
            if(creep.room.name===s.to){
                if(crew.length!==4||crew.some(c=>c.room.name!==s.to))return garrisonMuster(creep,task,crew.filter(c=>c.room.name===s.to));
                for(const c of crew)delete this.spec(c).roomExit;
            }
        }
        if(!arrived&&task.portalReleased)return this.startPortal(creep,task,"member");
        if(crew.length!==4||crew.some(c=>c.room.name!==creep.room.name)){
            // Boosted units may gather next to their spawn or landing tile,
            // but do not travel out of that room independently — unless the
            // rest of the wave is already a room ahead on the same route, in
            // which case the laggards walk the one room that separates them
            // (see garrisonRejoinStep; otherwise nobody ever moves).
            if(arrived||garrisonBodyReady(creep,task.slot)){
                if(garrisonRejoinStep(creep,task,crew,arrived))return;
                return garrisonMuster(creep,task,crew.filter(c=>c.room.name===creep.room.name));
            }
            return this.startPortal(creep,task,"member");
        }
        const pivot=garrisonPivot(crew);
        if(!pivot)return garrisonMuster(creep,task,crew);
        const room=creep.room, seen=garrisonHostiles(room);
        if(seen.some(garrisonArmed))return;
        const route=arrived?task.landingRoute:task.originRoute;
        const index=route?.indexOf(room.name)??-1;
        if(index<0)return;
        const next=route[index+1];
        if(!next){
            if(arrived)return;
            const p=task.portalPath[0];
            if(crew.every(c=>garrisonRange(c,p)<=4)){
                for(const c of crew)this.spec(c).portalReleased=true;
                return this.startPortal(creep,task,"member");
            }
            return garrisonNavigateSquare(crew,pivot,[{pos:new RoomPosition(p.x,p.y,p.roomName),range:3}],key);
        }
        if(!garrisonCanAdvance(next,task,arrived))return;
        const pinnedNext=GARRISON_W31_ORIGIN_ROUTE[GARRISON_W31_ORIGIN_ROUTE.indexOf(room.name)+1];
        const pin=arrived&&next===task.roomName?this.config(task.roomName)?.entryGate:
            !arrived&&task.roomName==="W31N51"&&next===pinnedNext?GARRISON_W31_GATES[room.name]:undefined;
        const chosen=garrisonExitPlan(room,next,pivot,crew,pin)||[],near=chosen.find(x=>x.pos.isEqualTo(pivot));
        if(near){
            const landing={x:near.exit.x,y:near.exit.y};
            if(near.dir===LEFT)landing.x=49;else if(near.dir===RIGHT)landing.x=0;
            else if(near.dir===TOP)landing.y=49;else landing.y=0;
            const crossing={from:room.name,to:next,exit:near.exit,landing};
            for(const c of crew)this.spec(c).roomExit=crossing;
            return garrisonTravel(creep,next,near.exit);
        }
        return garrisonNavigateSquare(crew,pivot,chosen,key);
    },
    combatFrame(room) {
        if(room._garrisonCombatFrame)return room._garrisonCombatFrame;
        const cfg=this.config(room.name);
        if(!cfg||cfg.active===false||cfg.targetShard!==Game.shard.name)return;
        const all=this.units(room.name).filter(c=>!c.spawning&&c.room.name===room.name
            && this.spec(c).taskName==="crossShardGarrison");
        if(!all.length)return;
        const waves=new Map();
        for(const c of all){
            const w=this.spec(c).wave;
            if(!waves.has(w))waves.set(w,[]);
            waves.get(w).push(c);
        }
        const ready=[...waves.entries()].map(([wave,cs])=>{
            const slots=garrisonBestSlots(cs,c=>this.spec(c)), crew=slots.filter(Boolean);
            return {wave,slots,count:crew.length,formed:!!garrisonPivot(crew)};
        });
        ready.sort((a,b)=>b.count-a.count || Number(b.formed)-Number(a.formed) || (b.wave||0)-(a.wave||0));
        const slots=ready[0].slots;
        const crew=slots.filter(Boolean);
        const innerPosts=garrisonPositions(room,cfg,slots.length);
        const entryPosts=cfg.entryAnchor
            ? garrisonPositions(room,{anchor:cfg.entryAnchor,entry:garrisonEntryTile(cfg.entryGate),towerRange:19},slots.length) : [];
        const fallbackPosts=cfg.entryFallback
            ? garrisonPositions(room,{anchor:cfg.entryFallback,towerRange:16},slots.length) : innerPosts;
        const armed=room.controller?.safeMode?[]:garrisonHostiles(room);
        const incoming=new Map(crew.map(c=>[c.name,garrisonDamageAfterTough(c,garrisonIncoming(c,armed))]));
        const projected=new Map(crew.map(c=>[c.name,c.hitsMax-c.hits+incoming.get(c.name)]));
        const heal=new Map();
        for(const c of crew){
            if(c.getActiveBodyparts(HEAL)<=0)continue;
            const patients=crew.filter(e=>garrisonRange(c,e)<=3&&projected.get(e.name)>0)
                .sort((a,b)=>(projected.get(b.name)-b.hits*0.15)-(projected.get(a.name)-a.hits*0.15)||a.name.localeCompare(b.name));
            const patient=patients[0];
            if(!patient)continue;
            const direct=garrisonRange(c,patient)<=1;
            heal.set(c.name,{patient,direct});
            projected.set(patient.name,projected.get(patient.name)-garrisonPower(c,HEAL,direct?"heal":"rangedHeal",direct?12:4));
        }
        let focus, best=-Infinity;
        for(const e of armed){
            const shooters=crew.filter(c=>garrisonRange(c,e)<=3&&c.getActiveBodyparts(RANGED_ATTACK)>0
                &&heal.get(c.name)?.direct!==false);
            if(!shooters.length)continue; // never chase enemies outside the defended area
            const damage=shooters.reduce((n,c)=>n+garrisonPower(c,RANGED_ATTACK,"rangedAttack",10),0)
                +(room.tower||[]).filter(t=>(t.store[RESOURCE_ENERGY]||0)>=10).reduce((n,t)=>n+(t.getDamageTo?.(e)||0),0);
            const repair=armed.reduce((n,h)=>{
                const d=garrisonRange(h,e);
                return n+(d<=3?garrisonPower(h,HEAL,d<=1?"heal":"rangedHeal",d<=1?12:4):0);
            },0);
            const net=garrisonDamageAfterTough(e,damage)-repair;
            const value=(net>=e.hits?10000:0)+net+garrisonPower(e,HEAL,"heal",12)*0.3-e.hits*0.08;
            if(value>best||(value===best&&String(e.id||e.name)<String(focus?.id||focus?.name))){
                best=value;focus=e;
            }
        }
        const pivot=garrisonPivot(crew),formed=!!pivot;
        const danger=armed.length&&crew.some(c=>c.hits<c.hitsMax*0.7||(projected.get(c.name)||0)>c.hits*0.22);
        if(danger&&entryPosts.every(Boolean)&&entryPosts.length===4)garrisonFallBackUntil[room.name]=Game.time+35;
        const fallBack=(garrisonFallBackUntil[room.name]||0)>Game.time;
        const hasEntry=entryPosts.length===4&&entryPosts.every(Boolean)&&
            (room.tower||[]).some(t=>(t.store?.[RESOURCE_ENERGY]||0)>=10);
        const posts=hasEntry?(fallBack&&fallbackPosts.every(Boolean)&&fallbackPosts.length===4?fallbackPosts:entryPosts):innerPosts;
        // If the approach/retreat is longer than a combat maneuver, route
        // the entire 2x2 to the prepared post. The four never break to chase.
        // In peacetime the walk is always allowed: `garrisonManeuver` only
        // considers tiles within 6 of the post, so a crew that crosses the
        // border far from its post (no `entryAnchor` ⇒ no covered entry posts)
        // had no way to get there at all — four fighters stood 18 tiles short
        // for hundreds of ticks (2026-11-29 live, W31N51 at (46,17) vs (41,35)).
        const transfer=formed&&posts[0]&&garrisonRange(pivot,posts[0])>2
            && (fallBack || !armed.length || hasEntry);
        const direction=formed&&!transfer&&garrisonManeuver(room,crew,posts,armed,focus,projected,hasEntry?19:8);
        return room._garrisonCombatFrame={slots,posts,focus,heal,formed,direction,armed,wave:ready[0].wave,
            transfer:transfer?{pivot,post:posts[0]}:null};
    },
    towerFocus(room) { return this.combatFrame(room)?.focus; },
    towerSupplyUrgent(room) {
        const cfg=this.config(room.name);
        return !!(cfg&&cfg.active!==false&&cfg.targetShard===Game.shard.name&&!room.controller?.safeMode
            &&garrisonHostiles(room).some(garrisonArmed));
    },
    defend(creep,task) {
        if(Game.shard.name===task.originShard&&task.portalPath)return this.travel(creep,task,false);
        if(task.targetShard&&Game.shard.name!==task.targetShard)return;
        if(creep.room.name!==task.roomName){
            if(creep.hits<creep.hitsMax)creep.heal(creep);
            if(task.landingRoute)return this.travel(creep,task,true);
            // Existing stationary garrisons without the new route remain
            // compatible, but an unexpected new landing is not chased.
            if(!task.landingRoute)creep.moveTo(new RoomPosition(25,25,task.roomName));
            return;
        }
        const f=this.combatFrame(creep.room);
        if(!f)return;
        const i=task.slot,other=f.slots[i],post=f.posts[i];
        if(other!==creep){
            if((task.wave||0)>(f.wave||0)){
                const batch=this.units(task.roomName).filter(c=>c.room.name===creep.room.name&&this.spec(c).wave===task.wave);
                return garrisonMuster(creep,task,batch,this.config(task.roomName)?.anchor||{x:41,y:35});
            }
            if(!f.armed.length&&other&&f.slots.every(Boolean)){
                creep.popTask().addTask(UtilsTask.taskData("recycleCreep"));
            } else if(creep.hits<creep.hitsMax)creep.heal(creep);
            return;
        }
        const heal=f.heal.get(creep.name);
        if(heal)creep[heal.direct?"heal":"rangedHeal"](heal.patient);
        // Keep the full direct-heal + ranged volley in formation. If an
        // unformed unit needs ranged rescue, reserve this creep's action.
        if(heal?.direct!==false&&f.focus&&garrisonRange(creep,f.focus)<=3)creep.rangedAttack(f.focus);
        if(f.transfer)garrisonNavigateSquare(f.slots,f.transfer.pivot,[{pos:f.transfer.post,range:0}],task.roomName+":post-transfer");
        else if(f.formed)garrisonMoveSquare(f.slots,f.direction,task.roomName+":combat");
        else if(post&&garrisonRange(creep,post)>0) {
            // Moving individually here only reforms a broken square. Combat
            // advance and retreat are issued through WarTeamCore together.
            creep.moveTo(post,{range:0,maxRooms:1,reusePath:4,maxOps:600});
        }
    },
    exec() {
        if(Game.time%GARRISON_EXEC_INTERVAL!==0)return;
        if(Game.time%200===0)for(const cache of [garrisonTravelPaths,garrisonMusterCache,garrisonPostCache])
            for(const [k,v] of Object.entries(cache))if(Game.time-v.tick>600)delete cache[k];
        for(const cfg of Object.values(Memory[GARRISON_MEMORY_KEY]||{})){
            if(!cfg||cfg.active===false||!cfg.roomName)continue;
            if(Game.shard.name===cfg.targetShard)this.audit(cfg);
            if(Game.shard.name===cfg.originShard)this.ensure(cfg);
        }
    },
};

Creep.prototype.registerCrossShardGarrison = function () {
    const t=(this.memory.tasks||[])[0];
    if(t?.taskName==="crossShardGarrison"||t?.taskName==="crossShardGarrisonScout"){
        this.memory.garrisonRoom=t.garrisonRoom||t.roomName;
        this.memory.garrisonSlot=t.slot;
    }
};
Creep.prototype.crossShardGarrison = function () { garrisonPro.defend(this,this.lastTask()); };
Creep.prototype.crossShardGarrisonScout = function () { garrisonPro.scout(this,this.lastTask()); };

global.missionFunc=global.missionFunc||{};
global.missionFunc.crossShardGarrisonPlan=d=>garrisonPro.receivePlan(d);
global.missionFunc.crossShardGarrisonLanding=d=>garrisonPro.receivePlan(d,true);
global.CrossShardGarrison=garrisonPro;
