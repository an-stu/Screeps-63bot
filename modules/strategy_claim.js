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
    // 别人的**存储类建筑先留着**（用户 2026-10-21）：
    //   「storage 有资源可以先保留，但是需要建自己的 storage 的时候必须摧毁别人的」
    // 判据：本房还建不了 storage（RCL < 4）或里面还有东西 ⇒ 留着；否则才拆。
    // terminal 同理（有货就留）。
    if (structure.structureType == STRUCTURE_STORAGE) {
        let hasGoods = structure.store && structure.store.getUsedCapacity() > 0;
        let canBuildOwn = room.controller && room.controller.level >= 4;
        if (hasGoods || !canBuildOwn) return false;
    }
    if (structure.structureType == STRUCTURE_TERMINAL) {
        let hasGoods = structure.store && structure.store.getUsedCapacity() > 0;
        if (hasGoods) return false;
    }
    // **只拆「有主的、别人的」结构**（用户 2026-10-21：「别拆中立的建筑比如墙」）。
    //
    // 原来还会把「蓝图里没有的无主建筑」一起拆 —— 结果 cleaner 去啃中立的
    // constructedWall，白耗 WORK 和寿命，还把房间原有的地形防护拆了。
    // 无主的墙 / 路 / 容器一律不碰；挡路的格子交给规划器绕开，真要清再人工处理。
    return !!structure.owner;
};

Creep.prototype.clearClaimRoom = function () {
    let task = this.lastTask();
    if (this.room.name != task.roomName) {
        this.goTo(new RoomPosition(task.x || 25, task.y || 25, task.roomName));
        return;
    }

    let target = this.memory.claimCleanupTarget && Game.getObjectById(this.memory.claimCleanupTarget);
    // 缓存的目标必须**重新过一遍判据**：判据改了（例如不再拆无主墙）之后，
    // memory 里那个旧目标可能已经不是合法目标，否则它会一直啃下去。
    if (target && !isClaimCleanupTarget(this.room, target)) {
        delete this.memory.claimCleanupTarget;
        target = undefined;
    }
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
    /**
     * 直接删掉本房里**别人的**结构：`Structure.destroy()`。
     *
     * 用户 2026-10-21：在自己房间里 `structure.destroy()` 可以直接删除别人的建筑，
     * **不用派 cleaner 爬过去拆**。实测（W26N58 的 Rutt 留下的 extension）返回 OK(0)，
     * 结构当场消失。成本 = 每结构一次 API 调用，没有爬、没有寻路、
     * 也不会浪费「带 CLAIM 的爬只有 600 tick」那种寿命。
     *
     * 保留规则仍由 `isClaimCleanupTarget` 决定（别人的 storage/terminal 按存量与 RCL 判断）。
     */
    destroyForeignStructures(room) {
        if (!room || !room.my) return 0;
        let n = 0;
        room.find(FIND_STRUCTURES).forEach(structure => {
            if (!isClaimCleanupTarget(room, structure)) return;
            if (structure.destroy() == OK) n++;
        });
        return n;
    },
    spawnCleaner(flag, spawnRoom) {
        let targetRoom = Game.rooms[flag.pos.roomName];
        if (!targetRoom) return;
        if (targetRoom.creeps("claimCleaner", false).length) return;
        // 体型必须按**出兵房的能量容量**缩：新占的房 RCL3 只有 650 容量，
        // 而 5W/5C/5M 要 1000 能量 ⇒ 一只都孵不出来，cleaner 永远不会出现。
        let affordable = Math.floor((spawnRoom.energyCapacityAvailable || 300) / 200); // 一组 W+C+M = 200
        let sets = Math.max(1, Math.min(5, affordable));
        let body = ManagerCreeps.calcBodyPart({[WORK]: sets, [CARRY]: sets, [MOVE]: sets});
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
            // 观测可见性记账已从 Memory.rooms[*].stationObserver 迁到
            // Memory.observerWatch（p = priorityVisibleTick）。
            let watch = Memory.observerWatch && Memory.observerWatch[flag.pos.roomName];
            let priorityVisionTick = targetRoom && watch
                && watch.p == Game.time;
            if (Game.time % 3 != 0 && !priorityVisionTick) return;
            if (!targetRoom && global.StationObserver && isCpuFeatureEnabled("observer")) {
                flag.memory.observerRoom = StationObserver.requestRoom(flag.pos.roomName, flag.memory.observerRoom)
                    || flag.memory.observerRoom;
            }
            let constructionStatus = targetRoom && targetRoom.my
                ? pro.ensureConstructionSites(targetRoom) : undefined;
            let ownedSpawns = pro.mySpawns(targetRoom);
            // 残留结构必须先拆干净才能立工地（用户 2026-10-21）：
            // 别人的 spawn / extension 会占住位置，`createConstructionSite` 直接失败。
            // 原来 COMPLETE 只看「有自己的 spawn 了」就删旗 ⇒ 房间里的 tower/extension
            // 再也没人管（实测 W26N58：Rutt 的塔和 2 个 extension 一直留着）。
            let cleanupTargets = targetRoom && targetRoom.my
                ? targetRoom.find(FIND_STRUCTURES)
                    .filter(structure => isClaimCleanupTarget(targetRoom, structure)).length
                : 0;
            if (targetRoom && targetRoom.my && ownedSpawns.length && !cleanupTargets) {
                pro.recordOperation(flag, "COMPLETE", {
                    level: targetRoom.controller.level,
                    mySpawns: ownedSpawns.length,
                    constructionSites: targetRoom.find(FIND_MY_CONSTRUCTION_SITES).length,
                });
                flag.remove();
                return;
            }
            if (targetRoom && targetRoom.my) {
                // 别人的结构**直接 destroy**（用户 2026-10-21），不派 cleaner 爬过去拆。
                // 实测 destroy() 在本房内对别人的结构返回 OK；一次调用即删，零 CPU、零寿命浪费。
                let destroyed = pro.destroyForeignStructures(targetRoom);
                pro.recordOperation(flag, cleanupTargets ? "CLEANING" : "BUILDING_SPAWN", {
                    level: targetRoom.controller.level,
                    cleanupTargets: cleanupTargets,
                    destroyed: destroyed,
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


pro.isClaimCleanupTarget = isClaimCleanupTarget;
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
