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
    // 按价值选目标：比较 storage/terminal/废墟里所有资源的市场单价×数量，
    // 优先搬价值最高的（如 XGHO2 远贵于 energy），而不是固定先搬 storage
    let best = pro.getBestPillageTarget(this);
    if (best) {
        this.addTask(UtilsTask.task(best.target, "carryRes", undefined, { resType: best.resType }));
        return;
    }
    let drop = this.pos.findClosestByPath(FIND_DROPPED_RESOURCES,{filter:(e)=>e.amount>100,ignoreCreeps:true})
    if(drop){
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
    /**
     * 在 storage / terminal / 废墟 中找出当前单位价值最高的可搬资源。
     * 每趟容量固定（约 2500），按单价而非总价值排序，一趟收益最大。
     * 价值用固定排序 RES_PRIORITY_LIST（从高到低，XGHO2 等化合物靠前）。
     * 返回 {target, resType}
     */
    getBestPillageTarget(creep) {
        let candidates = [];
        let pushStore = (target) => {
            if (!target || !target.store) return;
            for (let resType in target.store) {
                let amount = target.store[resType];
                if (!amount || amount <= 0) continue;
                candidates.push({ target: target, resType: resType, amount: amount });
            }
        };
        // 废墟
        let ruin = creep.pos.findClosestByPath(FIND_RUINS, {
            filter: e => e.store && e.store.getAllResTypeCount(),
            ignoreCreeps: true,
        });
        if (ruin) pushStore(ruin);
        // storage（废弃房间的 storage 也能搬）
        if (creep.room.storage && creep.room.storage.store.getUsedCapacity()) pushStore(creep.room.storage);
        // terminal：只搬非己方建筑内的（己方 terminal 由市场/平衡逻辑处理）
        let terminal = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: e => e.store
                && e.structureType == STRUCTURE_TERMINAL
                && e.store.getAllResTypeCount()
                && !e.pos.coverRampart()
                && (!creep.room.my || !e.my),
            ignoreCreeps: true,
        });
        if (terminal) pushStore(terminal);
        if (!candidates.length) return undefined;
        // 按单位价值降序：市场单价优先，无价资源用优先级兜底
        candidates.sort((a, b) => pro.resUnitValue(b) - pro.resUnitValue(a));
        return candidates[0];
    },
    resUnitValue(c) {
        if (c.unitValue !== undefined) return c.unitValue;
        // 固定价值排序：RES_PRIORITY_LIST 按价值从高到低排列，
        // XGHO2 等化合物权重远高于 energy，保证优先搬高价值资源
        c.unitValue = RES_PRIORITY_MAP[c.resType] || 0;
        return c.unitValue;
    },
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
