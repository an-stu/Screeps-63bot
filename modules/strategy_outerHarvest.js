/**
 * 外矿策略
 * 旗子规则：har_<出生/供给房间>（如 har_E53S21），旗子物理放在矿区（如 E54S21）
 * flag.pos.roomName = 矿区，flag.getRoomName() = 供给房间（旗名第二段）
 */

let pro = {
    exec(room) {
        if ((Game.time + room.hashCode()) % 6 != 0) return;
        let flags = ManagerFlags.getFlagsByPrefix("har");
        if (!flags.length) return;
        for (let flag of flags) {
            let targetRoomName = flag.pos.roomName;
            // 矿区放 stopRemote 旗则暂停该矿
            if (Game.rooms[targetRoomName] && Game.rooms[targetRoomName].flags("stopRemote").length) continue;
            // 每个旗子只由它选择的派发房间处理，避免多个已方房间重复派发
            let spawnRoom = flag.memory.spawnRoom && Game.rooms[flag.memory.spawnRoom];
            if (!spawnRoom || !spawnRoom.my) {
                // 旗名第二段 = 供给房间（优先），否则取最近的可用房间
                let namedRoom = Game.rooms[flag.getRoomName()];
                if (namedRoom && namedRoom.my) spawnRoom = namedRoom;
                else spawnRoom = StationHive.getClosestSpawnRoom(targetRoomName, 7, 3, 15);
                if (spawnRoom) flag.memory.spawnRoom = spawnRoom.name;
            }
            // 派发房间必须有 storage 接收外矿能量
            if (!spawnRoom || !spawnRoom.storage || spawnRoom.name != room.name) continue;
            if (Memory.rooms[targetRoomName]) {
                let isInvader = flag.name.includes('invader');
                StationSources.trySpawnOuterDefenser(targetRoomName, spawnRoom, isInvader);
            }
            if (!Memory.rooms[targetRoomName] || !Memory.rooms[targetRoomName][StationSources.stationName]) {
                let scouter = spawnRoom.creeps("scouter", false).filter(e => {
                    let task = e.headTask();
                    return task && task.roomName == targetRoomName;
                }).head();
                // log(scouter.headTask().roomName)
                if (!scouter) {
                    let tasks = [UtilsTask.taskOutView(flag.id, targetRoomName, undefined, undefined, "scouterToRoom")]
                    StationHive.trySpawn(spawnRoom, spawnRoom.name, [MOVE], "scouter", tasks)
                }
            }
            else {
                let harRoom = Game.rooms[targetRoomName];
                if ((Game.time + spawnRoom.hashCode()) % 30 == 0 && harRoom) {
                    StationSources.update(harRoom)
                }
                if (harRoom && harRoom.controller && !harRoom.my) { // 先生claimer 再生 har 保证能量获取效率 没有视野会先生 har
                    StationSources.trySpawnOuterHarKeeper(targetRoomName, spawnRoom, false);
                    let reserver = spawnRoom.creeps("reserver", false).filter(e => {
                        let task = e.headTask();
                        return task && task.roomName == targetRoomName;
                    }).head();
                    if (!reserver && (!harRoom.controller.reservation || harRoom.controller.reservation.ticksToEnd < 1000)) {
                        let tasks = [UtilsTask.task(harRoom.controller, "reserveOuterHar")]
                        let body = StationSources.getReverserBodyConfig(spawnRoom.getEnergyCapacityAvailable())
                        StationHive.trySpawn(spawnRoom, spawnRoom.name, body, "reserver", tasks)
                    }
                }
                else if (harRoom && !harRoom.controller && flag.name.includes('invader')) { // this is invader room
                    // if there is defender, then spawn harvester
                    let defenser = spawnRoom.creeps("outerHarvestDefenser", false).filter(e => {
                        let task = e.headTask();
                        return task && task.roomName == harRoom.name;
                    }).head()
                    if (!defenser) continue;
                    // console.log(defenser.name)
                    StationSources.trySpawnOuterHarKeeper(targetRoomName, spawnRoom, true);
                    // StationSources.trySpawnOuterMineralKeeper(flag.pos.roomName, room);
                }
                StationSources.trySpawnOuterHarCarrier(targetRoomName, spawnRoom);

            }
        }
    }
}


global.StrategyOuterHarvest = pro;
