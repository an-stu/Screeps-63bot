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
        // 选目标时忽略 creep。移动优化器默认就是 ignoreCreeps=true（见
        // 超级移动优化hotfix 的 ops.ignoreCreeps 初始化），这里显式写 false 会让
        // 选路被爬的位置带偏、并在撞到爬时重新寻路。统一成忽略。
        let struct = this.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: structure => structure.hits && !structure.my && structure.structureType != STRUCTURE_CONTROLLER,
            ignoreCreeps: true,
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
        // 只修**蓝图内**的路。
        //
        // 原来这条没有任何蓝图过滤：只要附近有血量 <50% 的路就去修，
        // 于是会把「不该存在」的废路一直续命，它们永远消失不掉。
        // W33N55 实测有 31 条这种路（既不在蓝图里、也不在任何外矿路线上，
        // 例如 (2,22)）—— 全都该让它自然衰减。
        //
        // 判据复用 StationSources.blueprintWalkableSet（蓝图内 road/container 的坐标集），
        // 与防御塔修路的过滤口径**同一份**，避免两处各写一套「什么算蓝图路」。
        let plannedRoad = (room && room.memory && room.memory.structMap && room.memory.structMap[STRUCTURE_ROAD])
            ? StationSources.blueprintWalkableSet(room)
            : null;
        let struct = this.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: e => e.structureType == STRUCTURE_ROAD && e.hits / e.hitsMax < 0.5
                && (!plannedRoad || plannedRoad.has(e.pos.x + ":" + e.pos.y)),
            range: 3,
        })
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
