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
            creep.memory.lastRoomIndex+=1;
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
            em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>e.body.length>2&&e.body.find(e=>e.type==RANGED_ATTACK)&&!e.pos.coverRampart()&&e.owner.name !== 'lp136'});//
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
            // console.log(em.id);
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
            if (Game.time % 100 == 0) console.log(flag.name + ": cross-shard manager is disabled");
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
            if(!pathData)return console.log(" path error: "+crossData)
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
    execSpawn (flag,raBody,raBoost) {
        if (!flag.memory.concatTime) flag.memory.concatTime = Game.map.getRoomLinearDistance(flag.pos.roomName, flag.getRoomName()) * 50;
        if(!flag.memory.creepName || (flag.name.indexOf("_keeper")>=0 && flag.memory.spawnTime+1450-flag.memory.concatTime<Game.time)){
            let room = Game.rooms[flag.getRoomName()]
            if(!room||!room.my||room.level<8){
                flag.remove();console.log(flag.getRoomName()+" 不是你的房间或没8级");
                return;
            }
            // log(pro.raBoost)
            if(!StationLab.boostAble(room,raBoost)){
                console.log(room.name+" 资源不足");
                return;
            }

            let task =  [
                UtilsTask.taskFlag(flag,"raL1","registerRaL1")
            ]
            if(raBoost)task.push(StationLab.generatorBoostResTask(raBoost).head())
            StationHive.trySpawn(room,"global",raBody,"raL1",task)
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
        if(Game.time%3!=0)return;
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
