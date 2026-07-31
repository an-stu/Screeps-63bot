/**
 * claim 房间 策略
 */

Creep.prototype.clearClaimRoom = function () {
    let task = this.lastTask();
    if (this.room.name != task.roomName) {
        this.goTo(new RoomPosition(task.x || 25, task.y || 25, task.roomName));
        return;
    }

    let target = this.memory.claimCleanupTarget && Game.getObjectById(this.memory.claimCleanupTarget);
    if (!target || !target.hits || target.room.name != this.room.name) {
        target = this.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
            filter: structure => structure.hits && structure.structureType != STRUCTURE_CONTROLLER,
        });
        if (target) this.memory.claimCleanupTarget = target.id;
        else delete this.memory.claimCleanupTarget;
    }
    if (target) {
        if (this.dismantle(target) == ERR_NOT_IN_RANGE) this.moveTo(target);
        return;
    }

    if (this.room.my) {
        this.memory.role = "worker";
        this.memory.roomName = this.room.name;
        this.memory.tasks = [];
        this.memory.dontPullMe = false;
        delete this.memory.claimCleanupTarget;
    }
};

let pro = {
    getSpawnRoom(flag) {
        let configuredRoom = flag.memory.spawnRoom && Game.rooms[flag.memory.spawnRoom];
        if (configuredRoom && configuredRoom.my && configuredRoom.spawn.length) return configuredRoom;
        return StationHive.getClosestSpawnRoom(flag.pos.roomName, 7, 3, 15);
    },
    spawnCleaner(flag, spawnRoom) {
        let targetRoom = Game.rooms[flag.pos.roomName];
        if (!targetRoom || !targetRoom.find(FIND_HOSTILE_STRUCTURES).some(structure => structure.hits)) return;
        if (targetRoom.creeps("claimCleaner", false).length) return;
        let body = ManagerCreeps.calcBodyPart({[WORK]: 5, [CARRY]: 5, [MOVE]: 5});
        let tasks = [UtilsTask.taskOutView(undefined, flag.pos.roomName, 25, 25, "clearClaimRoom")];
        StationHive.trySpawn(spawnRoom, flag.pos.roomName, body, "claimCleaner", tasks);
    },
    ensureConstructionSites(room) {
        if (!room || !room.my || !room.memory.structMap || !global.ManagerAutoPlanner) return;
        // Bootstrap in dependency order.  The spawn is always attempted first,
        // while extensions and source containers are limited by the current RCL.
        [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_CONTAINER].forEach(structureType => {
            ManagerAutoPlanner.tryCreateStructs(room, room.memory.structMap, structureType);
        });
    },
    exec () {
        if(Game.time%3!=0)return;
        if(!ManagerFlags.hasPrefix("claim"))return;
        ManagerFlags.getFlagsByPrefix("claim").forEach(flag=>{
            let targetRoom = Game.rooms[flag.pos.roomName];
            if (targetRoom && targetRoom.my && targetRoom.spawn.length>0) {
                flag.remove();
                return;
            }
            if (targetRoom && targetRoom.my) {
                pro.ensureConstructionSites(targetRoom);
                let spawnRoom = pro.getSpawnRoom(flag);
                if (spawnRoom) pro.spawnCleaner(flag, spawnRoom);
                return;
            }
            if(!Memory.rooms[flag.pos.roomName]||!Memory.rooms[flag.pos.roomName][StationSources.stationName]){
                let spawnRoom = pro.getSpawnRoom(flag);
                if(!spawnRoom){
                    log("no active able room");
                    return;
                }
                if(Game.rooms[flag.getRoomName()]&&Game.rooms[flag.getRoomName()].my)spawnRoom=Game.rooms[flag.getRoomName()]
                let scouter = spawnRoom.creeps("scouter",false).filter(e=>{
                    let task=e.headTask();
                    return task&&task.roomName == flag.pos.roomName;
                }).head();
                if(!scouter){
                    let tasks = [UtilsTask.taskOutView(flag.id,flag.pos.roomName,undefined,undefined,"scouterToRoom")]
                    StationHive.trySpawn(spawnRoom,spawnRoom.name,[MOVE],"scouter",tasks)
                }
            }else {
                if(!Memory.rooms[flag.pos.roomName].structMap&&flag.room){ // 创建蓝图
                    if(Game.cpu.bucket<9500)return;
                    ManagerAutoPlanner.computeRoom(flag);
                }else {
                    let spawnRoom = pro.getSpawnRoom(flag);
                    if(!spawnRoom){
                        log("no active able room");
                        return;
                    }
                    if(Game.rooms[flag.getRoomName()]&&Game.rooms[flag.getRoomName()].my)spawnRoom=Game.rooms[flag.getRoomName()]
                    pro.spawnCleaner(flag, spawnRoom);
                    // let controller = Memory.rooms[flag.pos.roomName][StationUpgrade.stationName][STRUCTURE_CONTROLLER]
                    let claimer = spawnRoom.creeps("claimer",false).filter(e=>{
                        let task=e.headTask();
                        return task&&task.id==flag.name;
                    }).head();
                    if(!claimer){
                        let task = [UtilsTask.taskFlag(flag,"claimRoom")]
                        StationHive.trySpawn(spawnRoom,spawnRoom.name,[CLAIM,MOVE,MOVE],"claimer",task)
                    }
                }

            }
        });
    }
}


global.StrategyClaim=pro;
