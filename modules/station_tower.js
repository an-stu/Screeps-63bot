

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

// 和平房间的敌对扫描/安全模式检查不需要每 tick 全量执行。
// 塔的战术扫描原本就是 ~10 tick 一次；把 checkSafeMode 也降到每 3 tick
// 一次（带房间哈希错峰），敌袭出现时 scanTick 会自动连续运行不受影响。
const TOWER_SCAN_INTERVAL=10;
const SAFE_MODE_CHECK_INTERVAL=3;

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
        // 战术扫描 tick 上复用同一份 hostiles；其它 tick 仅让安全模式
        // 检查按 3 tick 节流自己扫描，塔本体逻辑不碰敌人数据。
        let scanTick = !pro.lastUpdateMap[room.name]||pro.lastUpdateMap[room.name] <= 0;
        let hostiles = scanTick ? room.getHostileCreeps() : undefined;
        if ((Game.time + room.hashCode()) % SAFE_MODE_CHECK_INTERVAL == 0) {
            StationDefense.checkSafeMode(room, hostiles);
        }
        if (scanTick) {
            pro.lastUpdateMap[room.name]=TOWER_SCAN_INTERVAL
            if (global.WarDefenseCore && isCpuFeatureEnabled("combat")) WarDefenseCore.checkNeedDefense(room, hostiles);
            let randomAttack = undefined;
            if(hostiles.length){
                pro.lastUpdateMap[room.name] = 0;
                hostiles = hostiles.slice().sort((a,b)=>a.hits/a.hitsMax!=b.hits/b.hitsMax?(a.hits/a.hitsMax-b.hits/b.hitsMax):a.hits-b.hits)
            }

            let injured = undefined;
            if(!hostiles.length){
                let damaged = room.find(FIND_MY_CREEPS, {filter:e=>e.hits < e.hitsMax})
                    .concat(room.find(FIND_MY_POWER_CREEPS, {filter:e=>e.hits < e.hitsMax}));
                injured = damaged.minBy(e=>e.hits/e.hitsMax);
            }

            if(!lastAttackCreepMap[room.name])lastAttackCreepMap[room.name] = {}
            let lastAttack = lastAttackCreepMap[room.name]
            // 优先打奶妈：奶妈不死，坦克被奶住永远打不掉。对整个房间只找一次，
            // 避免每座塔重复 find。
            let healer = hostiles.length ? hostiles.find(e => e.getActiveBodyparts(HEAL) > 0) : undefined;

            room.tower.filter(e=>!e._used).forEach(tower => {

                if(injured){
                    tower.heal(injured)
                    pro.lastUpdateMap[room.name]=1
                    return;
                }

                if(hostiles.length){
                    if (healer) {
                        tower.attack(healer)
                        lastAttackCreepMap[room.name] = healer
                    } else {
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
