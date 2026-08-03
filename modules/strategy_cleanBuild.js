/**
 * cleanBuild_E4S2_E3S2_6
 * cleanBuild_mainRoom_出生房间_几个worker
 */



Creep.prototype.registerCleanBuild=function () {
    let flag = this.headTaskFlag()
    if(flag){
        if(!flag._creeps)flag._creeps=[]
        flag._creeps.push(this)
    }
};

Creep.prototype.cleanBuild=function () {
    let flag = this.headTaskFlag();
    let mainRoom = this.mainRoom();
    // this.memory.roomName = this.room.name
    if(flag&&this.room.name != flag.pos.roomName)
        this.moveTo(flag);
    else if(this.store.isEmpty()){
        // A newly claimed room may contain an inactive hostile spawn or other
        // ruins that block our RCL structure limit. Dismantle every hostile
        // damageable structure, not only old walls and ramparts.
        let struct = this.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: structure => structure.hits && !structure.my && structure.structureType != STRUCTURE_CONTROLLER,
            ignoreCreeps: false,
        });
        if(struct)this.addTaskAndExec(UtilsTask.task(struct,"collectStructEnergy"))
    }
    else{
        let spawns = mainRoom && mainRoom.find(FIND_MY_SPAWNS);
        if(this.ticksToLive<600&&mainRoom&&spawns.filter(e=>e.my&&!e.spawning&&!e._renew_used).length){
            let spawn = spawns.filter(e=>e.my&&!e.spawning).head()
            if(spawn)return this.addTaskAndExec(UtilsTask.task(spawn,"renewWithEnergy"));
        }
        let cs = this.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES,{filter:e=>e,range:3,ignoreCreeps:true})
        if(cs)return this.addTaskAndExec(UtilsTask.task(cs,"buildConst"));
        let struct = this.pos.findClosestByPath(FIND_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_ROAD&& e.hits/e.hitsMax<0.5,range:3})
        // this.say(struct)
        if(struct)return this.addTaskAndExec(UtilsTask.task(struct,"repairWall"));
        if(mainRoom&&mainRoom.storage&&mainRoom.storage.my)return this.fillAll(mainRoom.storage);
        else if(mainRoom&&mainRoom.my&&mainRoom.level<8)return this.addTaskAndExec(UtilsTask.task(mainRoom.controller,"upgradeWithEnergy"));

    }
};


Creep.prototype.collectStructEnergy=function () {
    let obj = this.lastTaskObj()
    if(!obj||this.storeFull())return this.popTask();
    if(this.dismantle(obj)==ERR_NOT_IN_RANGE){
        this.moveTo(obj)
        if(obj.pos.inRangeTo(this,2)&&this.memory.lastPos&&this.memory.lastPos.time==2){
            return this.popTask();
        }
    }
    if(this.ticksToLive%3==0)
        this.memory.dontPullMe = false;
}

Creep.prototype.renewWithEnergy=function () {
    let obj = this.lastTaskObj()
    if(!obj||obj._renew_used)return this.popTask().execLastTask();
    if(obj)obj._renew_used = true
    if(!this.pos.isNearTo(obj)){
        this.moveTo(obj)
    }else {
        if (obj.renewCreep(this) != OK)
            this.popTask().execLastTask()
        this.transfer(obj,RESOURCE_ENERGY)
    }
    this.memory.dontPullMe = this.ticksToLive%3==0;
}


Creep.prototype.upgradeWithEnergy=function (){
    if(this.store[RESOURCE_ENERGY]==0) {
        return this.popTask()
    }
    let obj=this.lastTaskObj();
    let code = this.upgradeController(obj);
    if(code == ERR_NOT_IN_RANGE) {
        this.moveTo(obj,{range:3});
    }
    if(this.store[RESOURCE_ENERGY]==0||this.mainRoom().controller.upgradeBlocked){
        this.popTask().execLastTask();
    }
    if(this.ticksToLive%3==0)
        this.memory.dontPullMe = false;
}


let pro = {
    exec () {
        if(Game.time%10!=0)return;
        if(!ManagerFlags.hasPrefix("cleanBuild"))return;
        ManagerFlags.getFlagsByPrefix("cleanBuild").forEach(flag=>{
            if(flag.room && flag.room.my && flag.room.find(FIND_HOSTILE_STRUCTURES).length == 0){//全部清理完毕
                return flag.remove();
            }

            if(!flag._creeps)flag._creeps = []
            let workerCount = parseInt(flag.getNameSplit()[3])||1;
            if(flag._creeps.length<workerCount){
                let body = StationWork.getMiddleLevelWorkerBodyConfig(flag.getRoom(2))
                StationHive.trySpawn(flag.getRoom(2),flag.getRoomName(),body,"cleanBuild",[UtilsTask.taskFlag(flag,"cleanBuild","registerCleanBuild")])
            }
        });
    }
}


global.StrategyCleanBuild=pro;
