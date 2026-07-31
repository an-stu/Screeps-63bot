/**
 * claim 房间 策略
 */

let isPlannedClaimStructure = function (room, structure) {
    let encodedPositions = room.memory.structMap && room.memory.structMap[structure.structureType];
    if (!encodedPositions) return false;
    return Utils.decodePosArray(encodedPositions)
        .some(pos => pos.x == structure.pos.x && pos.y == structure.pos.y);
};

let isClaimCleanupTarget = function (room, structure) {
    if (!structure.hits || structure.structureType == STRUCTURE_CONTROLLER || structure.my) return false;
    // Structures with another owner can never become ours.  Ownerless roads,
    // containers, and walls are retained only when the generated blueprint
    // explicitly uses the same type at the same position.
    return !!structure.owner || !isPlannedClaimStructure(room, structure);
};

Creep.prototype.clearClaimRoom = function () {
    let task = this.lastTask();
    if (this.room.name != task.roomName) {
        this.goTo(new RoomPosition(task.x || 25, task.y || 25, task.roomName));
        return;
    }

    let target = this.memory.claimCleanupTarget && Game.getObjectById(this.memory.claimCleanupTarget);
    if (!target || !target.hits || target.room.name != this.room.name) {
        target = this.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: structure => isClaimCleanupTarget(this.room, structure),
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
    recordOperation(flag, state, details) {
        Memory.claimOperations = Memory.claimOperations || {};
        let operation = Memory.claimOperations[flag.pos.roomName]
            = Memory.claimOperations[flag.pos.roomName] || {
                roomName: flag.pos.roomName,
                startedAt: Game.time,
                history: [],
            };
        let changed = operation.state != state;
        operation.state = state;
        operation.updatedAt = Game.time;
        operation.spawnRoom = flag.memory.spawnRoom;
        operation.observerRoom = flag.memory.observerRoom;
        operation.status = details || {};
        if (changed) {
            operation.history.push({tick: Game.time, state: state});
            if (operation.history.length > 40) operation.history.shift();
            if (global.Logger) {
                if (state.indexOf("BLOCKED_") == 0) Logger.warning("Claim", flag.pos.roomName, state);
                else Logger.info("Claim", flag.pos.roomName, state);
            }
        }
        return changed;
    },
    mySpawns(room) {
        return room ? room.find(FIND_MY_SPAWNS) : [];
    },
    getSpawnRoom(flag) {
        let configuredRoom = flag.memory.spawnRoom && Game.rooms[flag.memory.spawnRoom];
        if (configuredRoom && configuredRoom.my && pro.mySpawns(configuredRoom).length) return configuredRoom;
        return StationHive.getClosestSpawnRoom(flag.pos.roomName, 7, 3, 15);
    },
    spawnCleaner(flag, spawnRoom) {
        let targetRoom = Game.rooms[flag.pos.roomName];
        if (!targetRoom) return;
        if (targetRoom.creeps("claimCleaner", false).length) return;
        let body = ManagerCreeps.calcBodyPart({[WORK]: 5, [CARRY]: 5, [MOVE]: 5});
        let tasks = [UtilsTask.taskOutView(undefined, flag.pos.roomName, 25, 25, "clearClaimRoom")];
        StationHive.trySpawn(spawnRoom, flag.pos.roomName, body, "claimCleaner", tasks);
    },
    ensureConstructionSites(room) {
        if (!room || !room.my || !room.memory.structMap || !global.ManagerAutoPlanner) return {};
        // Build the first spawn before secondary sites so the bootstrap worker
        // cannot spend its lifetime on containers while the room is spawnless.
        let result = {spawnSite: false};
        if (!pro.mySpawns(room).length) {
            let spawnPositions = Utils.decodePosArray(room.memory.structMap[STRUCTURE_SPAWN] || "");
            let spawnPosition = spawnPositions[0];
            if (spawnPosition) {
                let position = new RoomPosition(spawnPosition.x, spawnPosition.y, room.name);
                result.spawnSite = position.lookFor(LOOK_CONSTRUCTION_SITES)
                    .some(site => site.my && site.structureType == STRUCTURE_SPAWN);
                let blockingStructure = position.lookFor(LOOK_STRUCTURES)
                    .some(structure => structure.structureType != STRUCTURE_ROAD
                        && structure.structureType != STRUCTURE_RAMPART);
                if (!result.spawnSite && !blockingStructure) {
                    result.createResult = position.createConstructionSite(STRUCTURE_SPAWN);
                    result.spawnSite = result.createResult == OK;
                }
            }
        }
        if (!pro.mySpawns(room).length) return result;
        [STRUCTURE_EXTENSION, STRUCTURE_CONTAINER].forEach(structureType =>
            ManagerAutoPlanner.tryCreateStructs(room, room.memory.structMap, structureType));
        return result;
    },
    exec () {
        if(!ManagerFlags.hasPrefix("claim"))return;
        ManagerFlags.getFlagsByPrefix("claim").forEach(flag=>{
            let targetRoom = Game.rooms[flag.pos.roomName];
            let targetObserverMemory = Memory.rooms[flag.pos.roomName]
                && Memory.rooms[flag.pos.roomName][StationObserver.stationName];
            let priorityVisionTick = targetRoom && targetObserverMemory
                && targetObserverMemory.priorityVisibleTick == Game.time;
            if (Game.time % 3 != 0 && !priorityVisionTick) return;
            if (!targetRoom && global.StationObserver && isCpuFeatureEnabled("observer")) {
                flag.memory.observerRoom = StationObserver.requestRoom(flag.pos.roomName, flag.memory.observerRoom)
                    || flag.memory.observerRoom;
            }
            let constructionStatus = targetRoom && targetRoom.my
                ? pro.ensureConstructionSites(targetRoom) : undefined;
            let ownedSpawns = pro.mySpawns(targetRoom);
            if (targetRoom && targetRoom.my && ownedSpawns.length) {
                pro.recordOperation(flag, "COMPLETE", {
                    level: targetRoom.controller.level,
                    mySpawns: ownedSpawns.length,
                    constructionSites: targetRoom.find(FIND_MY_CONSTRUCTION_SITES).length,
                });
                flag.remove();
                return;
            }
            if (targetRoom && targetRoom.my) {
                let spawnRoom = pro.getSpawnRoom(flag);
                if (spawnRoom) pro.spawnCleaner(flag, spawnRoom);
                let cleanupTargets = targetRoom.find(FIND_STRUCTURES)
                    .filter(structure => isClaimCleanupTarget(targetRoom, structure)).length;
                pro.recordOperation(flag, cleanupTargets ? "CLEANING" : "BUILDING_SPAWN", {
                    level: targetRoom.controller.level,
                    cleanupTargets: cleanupTargets,
                    constructionSites: targetRoom.find(FIND_MY_CONSTRUCTION_SITES).length,
                    spawnSite: constructionStatus.spawnSite,
                    createResult: constructionStatus.createResult,
                });
                return;
            }
            if (targetRoom && (!Memory.rooms[flag.pos.roomName]
                || !Memory.rooms[flag.pos.roomName][StationSources.stationName])) {
                ManagerRooms.refreshRoom(targetRoom);
            }
            if(!Memory.rooms[flag.pos.roomName]||!Memory.rooms[flag.pos.roomName][StationSources.stationName]){
                let spawnRoom = pro.getSpawnRoom(flag);
                if(!spawnRoom){
                    pro.recordOperation(flag, "BLOCKED_NO_SPAWN");
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
                pro.recordOperation(flag, flag.memory.observerRoom ? "OBSERVING" : "SCOUTING", {
                    scouter: !!scouter,
                });
            }else {
                if(!Memory.rooms[flag.pos.roomName].structMap&&flag.room){ // 创建蓝图
                    if(Game.cpu.bucket<9500){
                        pro.recordOperation(flag, "WAITING_FOR_PLANNER_CPU", {bucket: Game.cpu.bucket});
                        return;
                    }
                    pro.recordOperation(flag, "PLANNING", {bucket: Game.cpu.bucket});
                    ManagerAutoPlanner.computeRoom(flag);
                }else {
                    let spawnRoom = pro.getSpawnRoom(flag);
                    if(!spawnRoom){
                        pro.recordOperation(flag, "BLOCKED_NO_SPAWN");
                        return;
                    }
                    if(Game.rooms[flag.getRoomName()]&&Game.rooms[flag.getRoomName()].my)spawnRoom=Game.rooms[flag.getRoomName()]
                    // let controller = Memory.rooms[flag.pos.roomName][StationUpgrade.stationName][STRUCTURE_CONTROLLER]
                    let claimer = spawnRoom.creeps("claimer",false).filter(e=>{
                        let task=e.headTask();
                        return task&&task.id==flag.name;
                    }).head();
                    if(!claimer){
                        let task = [UtilsTask.taskFlag(flag,"claimRoom")]
                        StationHive.trySpawn(spawnRoom,spawnRoom.name,[CLAIM,MOVE,MOVE],"claimer",task)
                    }
                    pro.spawnCleaner(flag, spawnRoom);
                    pro.recordOperation(flag, "CLAIMING", {
                        visible: !!targetRoom,
                        claimer: !!claimer,
                        hostileStructures: targetRoom ? targetRoom.find(FIND_HOSTILE_STRUCTURES).length : undefined,
                    });
                }

            }
        });
    }
}


global.StrategyClaim=pro;
global.claimLog = function (roomName) {
    let operation = Memory.claimOperations && Memory.claimOperations[roomName];
    if (!operation) {
        Logger.warning("Claim", roomName, "no saved operation log");
        return;
    }
    console.log(JSON.stringify(operation, null, 2));
    return operation;
};
global.claimLog.help = 'claimLog("E53S21") — show the saved claim state and bounded history';
