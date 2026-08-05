/**
 * pillage_room_1
 */


Creep.prototype.registerPillage=function () {
    if(this.spawning){
        let flag = this.headTaskFlag();
        if(flag)flag.memory.spawnTime = Game.time
    }
};

Creep.prototype.pillage=function () {
    let flag = this.headTaskFlag()
    // if(!flag)return;
    if ((this.ticksToLive<this.memory.concatTime && this.pos.roomName == this.memory.roomName) || !flag) { // recycle if no time
        if(this.mainRoom()){
             this.popTask().addTask([UtilsTask.taskData("recycleCreep")])
        }
        return;
    }
    if(flag.pos.roomName!=this.pos.roomName||this.pos.isBorder()){
        this.goTo(flag);
        return;
    }
    if(this.store.getFreeCapacity()<=0){
        if(!this.memory.concatTime)this.memory.concatTime=(1500-this.ticksToLive)*2
        return this.fillAll(this.mainRoom().storage)
    }
    let target = this.pos.findClosestByPath(FIND_RUINS,{filter:e=>{
            return e.store&&e.store.getAllResTypeCount()
        },ignoreCreeps:true}); 
    if (!target && this.room.storage) target = this.room.storage.store.getUsedCapacity()?this.room.storage:0;
    if(!target) target = this.pos.findClosestByPath(FIND_STRUCTURES,{filter:e=>{
            return e.store
                &&e.structureType==STRUCTURE_TERMINAL// nuker搬不动，先判断类型避免对无关建筑做昂贵的检查
                &&e.store.getAllResTypeCount()
                &&!e.pos.coverRampart()
                &&(!this.room.my||!e.my) // 如果房间是我的，就搬一下不是我的建筑里面的东西（好像只剩下terminal了）
        },ignoreCreeps:true});
    // if (!target) target=this.pos.findClosestByPath(FIND_TOMBSTONES,{filter:e=>{
    //         return e.store&&e.store.getAllResTypeCount()
    //     });
    let drop = undefined;
    if(!target)drop = this.pos.findClosestByPath(FIND_DROPPED_RESOURCES,{filter:(e)=>e.amount>100,ignoreCreeps:true})
    if(target){
        this.carryAll(target);
        // this.execLastTask();
    }else if(drop){
        return this.addTask(UtilsTask.task(drop,"pickupRes"))
    }else if(flag.name.indexOf("keeper")==-1){
        flag.remove();
        this.popTask();
        this.fillAll(this.mainRoom().storage)
        this.execLastTask();
    }
    else {
        flag.remove();
    }
};

let pro = {
    getPillagerBodyConfig (energy){
        let current=0;
        let cost = BODYPART_COST[CARRY]+BODYPART_COST[MOVE];
        let num=0;
        while (current+cost<=energy){// 挖矿的不需要carry 直接 4：1 没问题的！ 体型越大越好
            num+=1;
            current+=cost
            if(num>=25)break;
        }
        return ManagerCreeps.calcBodyPart({ [CARRY]: num, [MOVE]: num });
    },
    getBoostPillagerBodyConfig(energy){
          
    },
    exec (room) {
        if((Game.time+room.hashCode())%30!=0)return;
        if(!room.storage)return;
        // 全局扫描 pillage 旗子（旗子物理插在目标掠夺房间，可能非己方房间）
        let flags = ManagerFlags.getFlagsByPrefix("pillage");
        if(!flags.length)return;
        flags.forEach(flag=>{
            // 确定派发房间：旗名第二段优先（如 pillage_E41S32_1），否则最近的己方房间
            let spawnRoom = flag.memory.spawnRoom && Game.rooms[flag.memory.spawnRoom];
            if (!spawnRoom || !spawnRoom.my) {
                let namedRoom = Game.rooms[flag.getRoomName()];
                if (namedRoom && namedRoom.my && namedRoom.storage) spawnRoom = namedRoom;
                else spawnRoom = StationHive.getClosestSpawnRoom(flag.pos.roomName, 7, 3, 15);
                if (spawnRoom) flag.memory.spawnRoom = spawnRoom.name;
            }
            // 只有被认领的派发房间负责 spawn，避免多房间重复派发
            if (!spawnRoom || !spawnRoom.storage || spawnRoom.name != room.name) return;
            // 全局检查该旗子的 pillager（出生后即离开派发房间，不能只看房间内）
            let pillager = Object.values(Game.creeps).filter(e => e.memory.role == "pillager"
                && e.headTaskFlag() && e.headTaskFlag().name == flag.name).head();
            if(pillager)return;
            let tasks = [UtilsTask.taskFlag(flag,  "pillage","registerPillage")]
            if (flag.name.indexOf("boost")==-1){
                StationHive.trySpawn(spawnRoom, spawnRoom.name, pro.getPillagerBodyConfig(spawnRoom.getEnergyCapacityAvailable()), "pillager", tasks);
            }
            else if (spawnRoom.level >= 7 && StationLab.boostAble(spawnRoom,{'KH2O': 30*25})) {
                tasks = tasks.concat(StationLab.generatorBoostLevelTask(spawnRoom, "capacity", 25, 1));
                StationHive.trySpawn(spawnRoom, spawnRoom.name, pro.getPillagerBodyConfig(spawnRoom.getEnergyCapacityAvailable()), "pillager", tasks);
            }
        })
    }
}


global.StrategyPillage=pro;
// StrategyPillage.getPillagerBodyConfig( Game.rooms.W9N38.getEnergyCapacityAvailable())
