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

// ═══════════════════════════════════════════════════════════════════════════
// 跨 shard T3 RA 驻守 —— 2026-11-27 shard2/W31N51
//
// 现场：W31N51 被一名使用 Overmind 的玩家攻击，控制器已开 safe mode
// （三次可用，本次剩约 1.06 万 tick）。来时编成是 4 人 heal+RA 的 T3 强化
// 小队；Overmind 的 pairDestroy/swarmDestroy 还会带 T3 melee zergling +
// T3 transfuser（见其 CombatSetups.zerglings.boosted_T3 / healers.boosted_T3）。
// 因此本驻守队使用 T3 强化 RA 一体机（TeamRaL1.raBody1/raBoost1），
// 遇到 ATTACK 近战先拉到 4 格风筝；面对 RA+HEAL 则优先集火带 HEAL 的
// 目标、贴到 1 格打满伤害（T3 回复量很高，必须集中火力）。
//
// 出发房：shard3/W31N55（RCL8、3 spawn、X*HO2 库存充足、boostAble=true），
// 路径：shard3/W30N50 (30,8) 虫洞 → shard2/W30N50 → 陆行至 W31N51。
// 配置放在各 shard 自己的 Memory.crossShardGarrisons（Memory 不跨 shard）：
//
//   Memory.crossShardGarrisons.W31N51 = {
//     active: true,
//     roomName: "W31N51", targetShard: "shard2",
//     originShard: "shard3", spawnRoom: "W31N55",
//     anchor: {x:41,y:35},
//     slots: [[0,0],[1,-1],[-1,1],[0,2],[2,2],[-1,0]], // 相对 anchor，避开核心建筑
//     squad: 6,
//     leadTicks: 2500,          // safe mode 剩余 ≤ 该值才允许 origin 派兵
//     dispatchEnabled: false,   // 由 target shard 的 requestDispatch 跨 shard 打开
//     path: {path:[{shard:"shard3", roomName:"W30N50", x:30, y:8}]}
//   }
//
//   安全期（用户 2026-11-27）：safe mode 期间不派兵；target shard 在
//   safeMode 剩余 ≤ leadTicks 时通过 setMemoryWithPath 把 origin 的
//   dispatchEnabled 置 true，origin 才逐只补员。
//
// CODEX AUDIT（以后修改本段/跨 shard 防守时必须做）：
//  1. 监视 W31N51：读取 Memory.crossShardGarrisons.W31N51.audit（本模块每 20
//     tick 写一次）：safeMode 剩余、safeModeAvailable/Cooldown、hostiles 数量与
//     HEAL/RANGED_ATTACK/ATTACK 部件、强化敌人数、garrison 存活与名字、tower 能量。
//     也可在 shard2 console 直接查 Game.rooms.W31N51.controller.safeMode。
//  2. 审计出兵链：shard3 Memory.missions 里 data.garrisonRoom=="W31N51" 的
//     spawnCreepCressShard 任务、W31N55 的 spawn 孵化/boost task、
//     W30N50(30,8) portal.destination.shard 是否仍为 "shard2"。行军会绕开
//     shard3 的他人控制房 W31N51/W31N52/W31N53（前两个在
//     Memory.betterMoveAvoidRooms，W31N53 在移动模块硬编码表）；审计时必须
//     确认这三个房仍在回避列表，禁止穿行控制房（项目长途路径硬规则）。
//     另：W31N55 的 boost lab 填液会被「先填 hive」抢占，若出发前
//     Memory.rooms.W31N55.stationLab.boostLabMap 对应 lab 为空，需先给空闲
//     carrier 派 X*HO2 补给任务，否则 boost 任务 200 tick 后会过期裸奔。
//  3. 若 Overmind 编成从 4 人 RA+heal 变为 swarm/melee/ranged 混编，必须重新
//     核算 squad/body/boost；raBody1 是 50 部件 T3 一体机，不能拿去贴脸扛
//     T3 melee（会被白打），近战威胁交给风筝分支。
//  4. safe mode 不是永久方案：safeModeAvailable 见底或 garrison 连续为空时，按
//     audit 报警并考虑增派第二组（把 squad 调大即可，调度器会逐只补员）。
// ═══════════════════════════════════════════════════════════════════════════

const GARRISON_MEMORY_KEY = "crossShardGarrisons";
const GARRISON_REPLACE_TTL = 700;      // 老车低于该 TTL 就补接班，避免真空
const GARRISON_EXEC_INTERVAL = 10;     // 10 tick 一次，足够及时且几乎不耗 CPU

Creep.prototype.registerCrossShardGarrison = function () {
    let task = (this.memory.tasks || [])[0];
    if (!task || task.taskName != "crossShardGarrison") return;
    this.memory.garrisonRoom = task.garrisonRoom || task.roomName;
    this.memory.garrisonSlot = task.slot;
};

Creep.prototype.crossShardGarrison = function () {
    let tasks = this.memory.tasks || [];
    let task = tasks[tasks.length - 1];
    if (!task || task.taskName != "crossShardGarrison") return;
    let roomName = task.roomName || task.garrisonRoom;
    if (!roomName) return;

    // 自我修复优先于输出；T3 XLHO2 一口 576，能顶住 tower/RA 的持续磨血。
    if (this.hits < this.hitsMax) this.heal(this);
    else if (this.autoHeal) this.autoHeal();

    if (this.room.name != roomName) {
        this.moveTo(new RoomPosition(25, 25, roomName));
        return;
    }

    let hostiles = this.room.getHostileCreeps
        ? this.room.getHostileCreeps()
        : this.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles && hostiles.length) {
        // 先处理近战：保持 4 格风筝，绝不让 T3 melee 贴上来。
        let melee = this.pos.findClosestByRange(hostiles.filter(e =>
            e.getActiveBodyparts && e.getActiveBodyparts(ATTACK) > 0));
        if (melee && this.pos.getRangeTo(melee) <= 3) {
            let flee = PathFinder.search(this.pos, {pos: melee.pos, range: 4}, {flee: true}).path;
            if (flee && flee.length) this.moveByPath(flee);
            if (this.pos.getRangeTo(melee) <= 3) this.rangedAttack(melee);
            return;
        }

        // 目标固定：HEAL 优先（打奶），其次残血，再按距离；所有驻守爬同序 ⇒ 集火。
        let targets = hostiles.slice().sort((a, b) => {
            let ah = a.getActiveBodyparts ? a.getActiveBodyparts(HEAL) : 0;
            let bh = b.getActiveBodyparts ? b.getActiveBodyparts(HEAL) : 0;
            if (ah != bh) return bh - ah;
            if (a.hits != b.hits) return a.hits - b.hits;
            return this.pos.getRangeTo(a) - this.pos.getRangeTo(b);
        });
        let target = targets[0];
        let meleeTarget = target.getActiveBodyparts && target.getActiveBodyparts(ATTACK) > 0;
        let desired = meleeTarget ? 3 : 1;
        if (this.pos.getRangeTo(target) > desired) this.moveTo(target, {range: desired});
        if (this.pos.getRangeTo(target) <= 3) {
            if (this.pos.isNearTo(target)) this.rangedMassAttack();
            else this.rangedAttack(target);
        }
        return;
    }

    let anchor = new RoomPosition(task.x, task.y, roomName);
    if (!this.pos.inRangeTo(anchor, 3)) this.moveTo(anchor);
};

let garrisonPro = {
    memoryKey: GARRISON_MEMORY_KEY,
    replaceTtl: GARRISON_REPLACE_TTL,
    config(roomName) {
        return Memory[GARRISON_MEMORY_KEY] && Memory[GARRISON_MEMORY_KEY][roomName];
    },
    countCreeps(roomName) {
        let out = [];
        for (let name in Game.creeps) {
            let creep = Game.creeps[name];
            if (!creep || !creep.memory) continue;
            if (creep.memory.garrisonRoom == roomName) { out.push(creep); continue; }
            let tasks = creep.memory.tasks || [];
            if (tasks.some(t => t && t.taskName == "crossShardGarrison"
                && (t.garrisonRoom || t.roomName) == roomName)) out.push(creep);
        }
        return out;
    },
    pendingMissions(roomName) {
        let out = [];
        let missions = Memory.missions;
        if (!missions || typeof missions != "object") return out;
        for (let id in missions) {
            let m = missions[id];
            if (m && m.func == "spawnCreepCressShard" && m.data && m.data.garrisonRoom == roomName) {
                out.push(id);
            }
        }
        return out;
    },
    /**
     * 写 W31N51 的攻防审计，供 Codex/控制台排查。
     * 注意：Memory 按 shard 隔离；target shard 的 audit 不会自动出现在 origin shard。
     */
    /**
     * 目标 shard 在 safe mode 快结束时通知 origin 开启/关闭派兵。
     * 不能只看 origin 本地 Memory（两个 shard 的 Memory 不同步），也不能早派：
     * 安全期内派出的 T3 RA 会白烧 1500 tick 生命周期。leadTicks 要覆盖
     * 孵化 150 + boost ~50 + 过洞/陆行 ~500，默认留 2500 的余量。
     */
    requestDispatch(cfg, enabled) {
        if (!global.ManagerCrossShard || !cfg.originShard) return;
        // 每 300 tick 重发一次，丢失/重启也能自愈；状态翻转时立即发。
        if (cfg.requestedDispatch === enabled && Game.time - (cfg.requestTick || 0) < 300) return;
        ManagerCrossShard.addCrossShardRequest(cfg.originShard, {
            func: "setMemoryWithPath",
            data: {
                path: GARRISON_MEMORY_KEY + "." + cfg.roomName + ".dispatchEnabled",
                data: enabled,
            },
        });
        cfg.requestedDispatch = enabled;
        cfg.requestTick = Game.time;
    },
    audit(cfg) {
        let room = Game.rooms[cfg.roomName];
        if (!room || !room.controller) return;
        if (Game.time % 20 != 0 && cfg.audit && Game.time - (cfg.audit.tick || 0) < 20) return;
        let hostiles = room.getHostileCreeps ? room.getHostileCreeps() : room.find(FIND_HOSTILE_CREEPS);
        let partCnt = (creep, part) => creep.getActiveBodyparts
            ? creep.getActiveBodyparts(part)
            : (creep.body || []).filter(p => p.type == part).length;
        let sumParts = part => hostiles.reduce((n, c) => n + partCnt(c, part), 0);
        let towers = typeof FIND_MY_STRUCTURES != "undefined"
            ? room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType == STRUCTURE_TOWER})
            : [];
        let crew = this.countCreeps(cfg.roomName);
        let old = cfg.audit || {};
        cfg.audit = {
            tick: Game.time,
            safeMode: room.controller.safeMode || 0,
            safeModeAvailable: room.controller.safeModeAvailable,
            safeModeCooldown: room.controller.safeModeCooldown || 0,
            hostiles: hostiles.length,
            hostileHeal: sumParts(HEAL),
            hostileRangedAttack: sumParts(RANGED_ATTACK),
            hostileAttack: sumParts(ATTACK),
            hostileBoosted: hostiles.filter(c => (c.body || []).some(p => p.boost)).length,
            hostileNames: hostiles.map(c => c.name).slice(0, 8),
            hostileOwners: Array.from(new Set(hostiles.map(c =>
                c.owner && c.owner.username).filter(Boolean))).slice(0, 4),
            garrison: crew.length,
            garrisonNames: crew.map(c => c.name).slice(0, 12),
            garrisonReady: crew.filter(c => c.ticksToLive === undefined
                || c.ticksToLive > GARRISON_REPLACE_TTL).length,
            towers: towers.map(t => t.store && t.store[RESOURCE_ENERGY] || 0),
            lastHostileTick: hostiles.length ? Game.time : (old.lastHostileTick || 0),
        };
        // 安全期不派兵；只在 safe mode 剩余 ≤ leadTicks 或已经结束时通知 origin。
        // 条件只在翻转时发一次；origin 侧 `dispatchEnabled` 才是真正的派兵闸门。
        let safe = room.controller.safeMode || 0;
        let lead = Math.max(300, Number(cfg.leadTicks) || 2500);
        let shouldDispatch = safe <= 0 || safe <= lead;
        this.requestDispatch(cfg, shouldDispatch);
    },
    ensure(cfg) {
        if (!global.ManagerCrossShard || !global.StationLab || !TeamRaL1) {
            cfg.dispatchError = "missing cross-shard/boost/team dependency";
            return;
        }
        // 目标 shard 在 safe mode 剩余 ≤ leadTicks 时通过跨 shard request 打开；
        // 安全期内保持关闭，已到期的 roster 不再续派。
        if (cfg.dispatchEnabled !== true) {
            if (cfg.dispatchError != "waiting safe-mode window") {
                cfg.dispatchError = "waiting safe-mode window";
            }
            return;
        }
        let spawnRoom = Game.rooms[cfg.spawnRoom];
        if (!spawnRoom || !spawnRoom.my) {
            cfg.dispatchError = "spawn room not visible/owned";
            return;
        }
        let boost = TeamRaL1.raBoost1();
        if (!StationLab.boostAble(spawnRoom, boost)) {
            cfg.dispatchError = "boostAble=false";
            return;
        }
        if (!cfg.path || !cfg.path.path || !cfg.path.path.length) {
            cfg.dispatchError = "missing cross-shard path";
            return;
        }
        let squad = Math.max(1, Number(cfg.squad) || 1);
        // 驻守爬跨过虫洞后就不再出现在 origin 的 Game.creeps 里，无法用本地存活
        // 数判断编制。用「派兵台账」记录每次成功入队的出生批次，按 cycle 到期
        // 退役；每次只保留一个 pending mission，既不会漏派也不会在跨 shard 后
        // 重复刷兵。目标房的真实存活由 target shard 的 audit.garrison 记录。
        let cycle = Math.max(300, Number(cfg.cycle) || 1150);
        let roster = (cfg.dispatches || []).filter(t => Game.time - t < cycle);
        cfg.dispatches = roster;
        if (roster.length >= squad) {
            if (cfg.dispatchError) delete cfg.dispatchError;
            return;
        }
        // 一次只允许一个未完成的出生 mission，避免同一批孵出 2 倍兵力。
        if (this.pendingMissions(cfg.roomName).length) return;

        let slot = roster.length % (cfg.slots && cfg.slots.length || 1);
        let slots = cfg.slots || [[0, 0]];
        let offset = slots[slot % slots.length];
        let anchor = cfg.anchor || {x: 25, y: 25};
        let task = UtilsTask.taskData("crossShardGarrison", "registerCrossShardGarrison", {
            roomName: cfg.roomName,
            garrisonRoom: cfg.roomName,
            x: anchor.x + offset[0],
            y: anchor.y + offset[1],
            slot: slot,
        });
        let tasks = [
            task,
            UtilsTask.taskData("moveCrossShardByPath", undefined, cfg.path),
            StationLab.generatorBoostResTask(boost, spawnRoom)[0],
        ];
        let mission = {
            func: "spawnCreepCressShard",
            data: {
                spawnRoom: cfg.spawnRoom,
                targetRoomName: cfg.roomName,
                body: TeamRaL1.raBody1,
                role: "raL1",
                tasks: tasks,
                garrisonRoom: cfg.roomName,
            },
        };
        let id = ManagerCrossShard.addCrossShardRequest(cfg.originShard, mission);
        roster.push(Game.time);
        cfg.lastDispatch = {tick: Game.time, id: id, slot: slot};
        delete cfg.dispatchError;
    },
    exec() {
        if (Game.time % GARRISON_EXEC_INTERVAL != 0) return;
        if (!Memory[GARRISON_MEMORY_KEY]) return;
        for (let roomName in Memory[GARRISON_MEMORY_KEY]) {
            let cfg = Memory[GARRISON_MEMORY_KEY][roomName];
            if (!cfg || cfg.active === false || !cfg.roomName) continue;
            if (Game.shard.name == cfg.targetShard) this.audit(cfg);
            if (Game.shard.name == cfg.originShard) this.ensure(cfg);
        }
    },
};

global.CrossShardGarrison = garrisonPro;
