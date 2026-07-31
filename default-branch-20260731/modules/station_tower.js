

Creep.prototype.registerTowerCarryInRoom=function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.used = room.used||{}
    let id = this.headTask().id;
    room.used[id] = (room.used[id] || 0)+this.getPartCnt(CARRY)*50
};

StructureTower.prototype.getDamageTo = function (target){
    return global.WarDamageCal ? WarDamageCal.calTowerDamage(this.pos.getRangeTo(target)) : 0
}

let lastAttackCreepMap={}

let pro={
    stationName:"stationTower",
    needRepairsRoomMap:{},
    towerRepairMap:{},
    lastUpdateMap:{},
    lastActiveMap:{},
    update (room) {
        pro.lastUpdateMap[room.name] = (pro.lastUpdateMap[room.name] || 0) - 1;

        let roadNeedRepair = undefined
        if(room.memory.structMap&&room.memory.structMap[STRUCTURE_ROAD]){ // 如果有缓存路只修要缓存的路
            let roadPos = Utils.decodePosArray(room.memory.structMap[STRUCTURE_ROAD])
            roadNeedRepair = {}
            roadPos.forEach(e=>roadNeedRepair[e.x*50+e.y] = 1)
        }

        // 记录要修理的 东西
        pro.needRepairsRoomMap[room.name] = room.find(FIND_STRUCTURES)
            .filter(e => e.structureType != STRUCTURE_WALL && e.structureType != STRUCTURE_RAMPART)
            .filter(e => e.hits / e.hitsMax < 0.8 && e.hits < 10000000)
            .filter(e => (!roadNeedRepair||roadNeedRepair[e.pos.x*50+e.pos.y])||e.structureType != STRUCTURE_ROAD)
            .sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax)
            .map(e => e.id)
    },
    exec (room){
        StationDefense.checkSafeMode(room);
        if (!pro.lastUpdateMap[room.name]||pro.lastUpdateMap[room.name] <= 0) {
            pro.lastUpdateMap[room.name] = 10
            let hostiles = room.find(FIND_HOSTILE_CREEPS);
            if (global.WarDefenseCore && isCpuFeatureEnabled("combat")) WarDefenseCore.checkNeedDefense(room, hostiles);
            let randomAttack = undefined;
            if(hostiles.length){
                pro.lastUpdateMap[room.name] = 0;
                hostiles = hostiles.sort((a,b)=>a.hits/a.hitsMax!=b.hits/b.hitsMax?(a.hits/a.hitsMax-b.hits/b.hitsMax):a.hits-b.hits)
            }

            let injured = undefined;
            if(!hostiles.length){
                let damaged = room.find(FIND_MY_CREEPS, {filter:e=>e.hits < e.hitsMax})
                    .concat(room.find(FIND_MY_POWER_CREEPS, {filter:e=>e.hits < e.hitsMax}));
                injured = damaged.minBy(e=>e.hits/e.hitsMax);
            }

            if(!lastAttackCreepMap[room.name])lastAttackCreepMap[room.name] = {}
            let lastAttack = lastAttackCreepMap[room.name]

            room.tower.filter(e=>!e._used).forEach(tower => {

                if(injured){
                    tower.heal(injured)
                    pro.lastUpdateMap[room.name]=0
                    return;
                }

                if(hostiles.length){
                    let headHostiles = hostiles.head()
                    let lastTickHealAble = headHostiles.id==lastAttack.id&&lastAttack.hits<=headHostiles.hits// 上一秒奶不回去
                    if(!lastTickHealAble&&headHostiles.hits!=headHostiles.hitsMax){
                        tower.attack(headHostiles)
                        lastAttackCreepMap[room.name] = headHostiles
                    }else{
                        if(Game.time%15==0 || Game.time%15==7){
                            randomAttack = randomAttack || Utils.randomGet(hostiles);
                            tower.attack(randomAttack)
                        }
                    }
                    return;
                }

                if (!pro.needRepairsRoomMap[room.name]) pro.needRepairsRoomMap[room.name] =[]
                let id = this.towerRepairMap[tower.id] = this.towerRepairMap[tower.id] || pro.needRepairsRoomMap[room.name].shift();
                let target = Game.getObjectById(id)
                if (!target||target.hits / target.hitsMax > 0.9) {
                    id = this.towerRepairMap[tower.id] = pro.needRepairsRoomMap[room.name].shift();
                    target = Game.getObjectById(id)
                }
                if(target){
                    tower.repair(target)
                    // HelperVisual.commonText(tower.room.name,target.hits/target.hitsMax,target)
                    // Peaceful repairs do not need to run every tick. Hostile
                    // rooms set the interval back to zero above.
                    pro.lastUpdateMap[room.name]=3
                }
            })
        }
        pro.lastUpdateMap[room.name] -= 1
    },
    generatorFillEnergyTasks(roomName){
        let room = Game.rooms[roomName.name||roomName]
        return room.tower.filter(e=>e.store[RESOURCE_ENERGY]+(room.used&&room.used[e.id]||0)<=600).map(e=>
            [UtilsTask.task(e,"fillRes","registerTowerCarryInRoom",{resType:RESOURCE_ENERGY})]
        )
    }


};



global.StationTower=pro;
