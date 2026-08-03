/**


 PCAtk_OPF3b
 OPSCarry_E4N1_350
 disCtrl_E4N1_950
 memory{
    needHeal:boolean
    healRoomName:string
 }
 */

PowerCreep.prototype.renewFlagRoom = function () {
    let room = this.room
    if(room&&room.my&&room.powerSpawn){
        if(!this.pos.isNearTo(room.powerSpawn)){
            this.moveTo(room.powerSpawn)
        }else{
            if (OK == this.renew(room.powerSpawn)) {
                this.popTask();
            }
        }
    }
}

PowerCreep.prototype.getRoomFullOps = function () {
    let cnt = this.store.getFreeCapacity(RESOURCE_OPS);
    if(cnt<=0)return this.popTask();
    let room = this.room;
    let saveObj = room.storage||room.mineral;
    if(saveObj){
        this.addTask(StationCarry.generatorMassStoreCarry(room,RESOURCE_OPS,cnt));
    }
}

PowerCreep.prototype.registerPowerCreepAttacker = function () {
    let task= this.headTask();
    let flag = Game.flags[task.id];
    flag.powerCreep = this
}
PowerCreep.prototype.powerCreepAttacker = function (){
    this.usePower(PWR_GENERATE_OPS)
    let room = this.room
    let task= this.headTask();
    let flag = Game.flags[task.id];
    if(!flag){
        return this.popTask();
    }
    if(room.my&&room.powerSpawn&&flag.pos.roomName==room.name){
        if(this.ticksToLive+10<POWER_CREEP_LIFE_TIME){
            this.addTask([UtilsTask.taskData("renewFlagRoom")])
        }else if(this.store.getFreeCapacity(RESOURCE_OPS)>0){
            this.addTask([UtilsTask.taskData("getRoomFullOps")])
        }
    }
    if(flag.pos.roomName!=room.name||!this.room.my){
        this.moveTo(flag)
        this.memory.dontPullMe = true;
    }else {
        this.memory.dontPullMe = false;
    }
    if(!room.my&&this.pos.isNearTo(room.controller)&&room.controller.level){
        this.enableRoom(room.controller)
    }
    let dropRes = this.pos.findInRange(FIND_DROPPED_RESOURCES,1).filter(e=>e.resourceType==RESOURCE_OPS).head()
    if(dropRes){
        if(this.pos.isNearTo(dropRes)){
            this.pickup(dropRes)
        }
    }

    if(!room.my&&flag.pos.roomName==room.name){
        if(this.powers[PWR_DISRUPT_SPAWN]&&!this.powers[PWR_DISRUPT_SPAWN].cooldown){
            let spawn = room.find(FIND_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_SPAWN&&e.spawning&&!e._used})
                .find(e=>!e.effects||!e.effects.find(e=>e.power==PWR_DISRUPT_SPAWN))
            if(spawn&&this.pos.inRangeTo(spawn,20)){
                if (this.usePower(PWR_DISRUPT_SPAWN, spawn) == OK) spawn._used = true
                return;
            }
            if(spawn)log("距离不够")
        }
        if(this.powers[PWR_DISRUPT_TOWER]){
            let tower = room.find(FIND_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_TOWER&&e.store[RESOURCE_ENERGY]>=10&&!e._used})
                .find(e=>!e.effects||!e.effects.find(e=>e.power==PWR_DISRUPT_TOWER))
            if(tower){
                if (this.usePower(PWR_DISRUPT_TOWER, tower) == OK) tower._used = true
                return;
            }
        }
    }
}

Creep.prototype.registerHealerPowerCreep=function () {
    let task= this.headTask();
    let flag = Game.flags[task.id];
    if(flag){
        flag.healers = flag.healers || []
        flag.healers.push(this)
    }
};


Creep.prototype.healerPowerCreep=function () {
    let task= this.headTask();
    let flag = Game.flags[task.id];
    if(flag.powerCreep)flag=flag.powerCreep// 直接变成pc
    this.heal(this);
    this.moveTo(flag);
    if(this.pos.isBorder()){
        this.moveOuterBorder(flag)
    }
    let healPowerCreep = this.pos.findInRange(FIND_MY_POWER_CREEPS,1).find(e=>e.hits!=e.hitsMax)
    if(healPowerCreep){
        this.heal(healPowerCreep)
    }
};



Creep.prototype.registerOpsCarrier=function () {
    let task= this.headTask();
    let flag = Game.flags[task.id];
};


Creep.prototype.opsCarrier=function () {
    let task= this.headTask();
    let flag = Game.flags[task.id];
    this.heal(this)
    if(this.room.my&&this.store.getFreeCapacity(RESOURCE_OPS)>0){
        this.addTask(StationCarry.generatorMassStoreCarry(this.room,RESOURCE_OPS,this.store.getFreeCapacity(RESOURCE_OPS)));
    }else{
        if(!this.room.my){
            let needSupplyPC = this.room.find(FIND_MY_POWER_CREEPS)
                .sort((a,b)=> (b.store.getFreeCapacity(RESOURCE_OPS)||0)-(a.store.getFreeCapacity(RESOURCE_OPS)||0))
                .head()
            if(needSupplyPC){
                this.moveTo(needSupplyPC)
                this.transfer(needSupplyPC,RESOURCE_OPS)
            }else this.moveTo(flag);
            if(this.store.isEmpty()){
                let dropRes = this.pos.findInRange(FIND_DROPPED_RESOURCES,50).filter(e=>e.resourceType==RESOURCE_OPS).head()
                if(dropRes){
                    if(this.pickup(dropRes)==ERR_NOT_IN_RANGE){
                        this.moveTo(dropRes)
                    }
                }
            }
        }else
            this.moveTo(flag);
    }
};

Creep.prototype.registerDisableController=function () {
    let task= this.headTask();
    let flag = Game.flags[task.id];
};

Creep.prototype.disableController=function () {
    let task= this.headTask();
    let flag = Game.flags[task.id];
    this.moveto(flag)
    if(!this.room.my){
        if(this.attackController(this.room.controller)!=OK)
            this.heal(this);
        else flag.memory.spawnTime=Game.time+430-this.body.length*3
    }
};


let pro={
    healerBody:()=>ManagerCreeps.calcBodyPart([[TOUGH,11],[MOVE,9],[HEAL,29],[MOVE,1]]),
    healerBoost:()=>{return {[BOOST_RES["damage"][2]]:30*11,[BOOST_RES["fatigue"][2]]:30*10,[BOOST_RES["heal"][2]]:30*29}},
    opsCarBody:()=>ManagerCreeps.calcBodyPart([[TOUGH,3],[MOVE,9],[CARRY,31],[HEAL,6],[MOVE,1]]),
    opsCarBoost:()=>{return {[BOOST_RES["fatigue"][2]]:30*10,[BOOST_RES["damage"][2]]:30*3,[BOOST_RES["heal"][2]]:30*6,[BOOST_RES["capacity"][2]]:30*31}},
    // DisCtrlBody:()=>ManagerCreeps.calcBodyPart([[TOUGH,6],[MOVE,19],[CLAIM,1],[HEAL,12],[MOVE,1]]),
    // DisCtrlBoost:()=>{return {[BOOST_RES["damage"][2]]:30*6,[BOOST_RES["heal"][2]]:30*12}},

    DisCtrlBody:()=>ManagerCreeps.calcBodyPart([ [TOUGH,11],[CLAIM,1],[MOVE,9],[HEAL,23],[MOVE,1]]),
    DisCtrlBoost:()=>{return {[BOOST_RES["damage"][2]]:30*11,[BOOST_RES["fatigue"][2]]:30*10,[BOOST_RES["heal"][2]]:30*23}},
    // DisCtrlBody:()=>ManagerCreeps.calcBodyPart([[TOUGH,3],[MOVE,9],[CLAIM,1],[HEAL,6],[MOVE,1]]),
    // DisCtrlBoost:()=>{return {[BOOST_RES["damage"][2]]:30*3,[BOOST_RES["heal"][2]]:30*6}},
    execSpawnHealer (flag, room, body, boost) {
        if(!room||!room.my||room.level<8){
            flag.remove();console.log(flag.getRoomName()+" 不是你的房间或没8级");
            return;
        }
        if(!StationLab.boostAble(room,boost)){
            console.log(room.name+" Healer 资源不足");
            return;
        }
        let task =  [
            UtilsTask.taskFlag(flag,"healerPowerCreep","registerHealerPowerCreep"),
            StationLab.generatorBoostResTask(boost,room).head()
        ]
        return StationHive.trySpawn(room,"global",body,"PBer",task)
    },
    execSpawnOpsCar (flag, room, body, boost) {
        if(!room||!room.my||room.level<8){
            flag.remove();console.log(flag.getRoomName()+" 不是你的房间或没8级");
            return;
        }
        if(!StationLab.boostAble(room,boost)){
            console.log(room.name+" OpsCar 资源不足");
            return;
        }
        let task =  [
            UtilsTask.taskFlag(flag,"opsCarrier","registerOpsCarrier"),
            StationLab.generatorBoostResTask(boost,room).head()
        ]
        return StationHive.trySpawn(room,"global",body,"PBer",task)
    },
    execDisableController (flag, room, body, boost) {
        if(!room||!room.my||room.level<8){
            flag.remove();console.log(flag.getRoomName()+" 不是你的房间或没8级");
            return;
        }
        if(!StationLab.boostAble(room,boost)){
            console.log(room.name+" OpsCar 资源不足");
            return;
        }
        let task =  [
            UtilsTask.taskFlag(flag,"disableController","registerDisableController"),
            StationLab.generatorBoostResTask(boost,room).head()
        ]
        return StationHive.trySpawn(room,"global",body,"PBer",task)
    },
    exec(){
        ManagerFlags.getFlagsByPrefix("disCtrl").forEach(flag=>{
            let spilted = flag.getNameSplit();
            let fromRoomName = spilted[1]
            let interval = parseInt(spilted[2])
            // log(Game.time - (flag.memory.spawnTime||0))
            if((flag.memory.spawnTime||0)<Game.time){
                let isOK = pro.execDisableController(flag,Game.rooms[fromRoomName],pro.DisCtrlBody(),pro.DisCtrlBoost())
                if(isOK)
                    flag.memory.spawnTime=Game.time+interval
            }
        });
        ManagerFlags.getFlagsByPrefix("OPSCarry").forEach(flag=>{
            let spilted = flag.getNameSplit();
            let fromRoomName = spilted[1]
            let interval = parseInt(spilted[2])
            if((flag.memory.spawnTime||0)<Game.time){
                let isOK = pro.execSpawnOpsCar(flag,Game.rooms[fromRoomName],pro.opsCarBody(),pro.opsCarBoost())
                if(isOK)
                    flag.memory.spawnTime=Game.time+interval
            }
        });
        ManagerFlags.getFlagsByPrefix("PCAtk").forEach(flag=>{
            let pcName = flag.getNameSplit()[1]
            let pc = Game.powerCreeps[pcName]
            if(pc && pc.ticksToLive && (!pc.headTask()||pc.headTask().taskName!="powerCreepAttacker")){
                pc.memory.tasks=[]
                pc.addTask(UtilsTask.taskFlag(flag,"powerCreepAttacker","registerPowerCreepAttacker"))
            }
            if(flag.room&&flag.room.my)flag.memory.healRoomName = flag.room.name
            if(!flag.memory.needHeal)flag.memory.needHeal=false
            if(flag.memory.healRoomName&&flag.memory.needHeal){
                if(!flag.healers||flag.healers&&!flag.healers.find(e=>e.spawning||e.ticksToLive>800)){
                    let room = Game.rooms[flag.memory.healRoomName]
                    if(room.creeps("carrier",false).length){
                        pro.execSpawnHealer(flag,room,pro.healerBody(),pro.healerBoost());
                    }
                }
            }
        });
        if (Game.flags.showDisSpawn) {
            let flag = Game.flags.showDisSpawn
            if(flag.room){
                flag.room.spawn.forEach(e=>{
                    HelperVisual.showLine({x:e.pos.x-20,y:e.pos.y-20,roomName:flag.room.name},{x:e.pos.x-20,y:e.pos.y+20,roomName:flag.room.name})
                    HelperVisual.showLine({x:e.pos.x-20,y:e.pos.y-20,roomName:flag.room.name},{x:e.pos.x+20,y:e.pos.y-20,roomName:flag.room.name})
                    HelperVisual.showLine({x:e.pos.x+20,y:e.pos.y+20,roomName:flag.room.name},{x:e.pos.x-20,y:e.pos.y+20,roomName:flag.room.name})
                    HelperVisual.showLine({x:e.pos.x+20,y:e.pos.y+20,roomName:flag.room.name},{x:e.pos.x+20,y:e.pos.y-20,roomName:flag.room.name})
                })
            }
        }
    }
};

global.WarPowerCreepOperator = pro;
