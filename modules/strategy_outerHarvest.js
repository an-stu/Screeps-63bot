/**
 * 外矿策略
 */

let pro = {
    exec(room) {
        if ((Game.time + room.hashCode()) % 6 != 0) return;
        if (!room.storage) return;
        let flags = room.flags("har");
        if (!flags.length) return;
        for (let flag of flags) {
            if (Memory.rooms[flag.pos.roomName]) {
                let isInvader = flag.name.includes('invader');
                StationSources.trySpawnOuterDefenser(flag.pos.roomName, room, isInvader);
            }
            if (!Memory.rooms[flag.pos.roomName] || !Memory.rooms[flag.pos.roomName][StationSources.stationName]) {
                let scouter = room.creeps("scouter", false).filter(e => {
                    let task = e.headTask();
                    return task && task.roomName == flag.pos.roomName;
                }).head();
                // log(scouter.headTask().roomName)
                if (!scouter) {
                    let tasks = [UtilsTask.taskOutView(flag.id, flag.pos.roomName, undefined, undefined, "scouterToRoom")]
                    StationHive.trySpawn(room, room.name, [MOVE], "scouter", tasks)
                }
            }
            else {
                let harRoom = Game.rooms[flag.pos.roomName];
                if ((Game.time + room.hashCode()) % 30 == 0 && harRoom) {
                    StationSources.update(harRoom)
                }
                if (harRoom && harRoom.controller && !harRoom.my) { // 先生claimer 再生 har 保证能量获取效率 没有视野会先生 har
                    StationSources.trySpawnOuterHarKeeper(flag.pos.roomName, room, false);
                    let reserver = room.creeps("reserver", false).filter(e => {
                        let task = e.headTask();
                        return task && task.roomName == flag.pos.roomName;
                    }).head();
                    if (!reserver && (!harRoom.controller.reservation || harRoom.controller.reservation.ticksToEnd < 1000)) {
                        let tasks = [UtilsTask.task(harRoom.controller, "reserveOuterHar")]
                        let body = StationSources.getReverserBodyConfig(room.getEnergyCapacityAvailable())
                        StationHive.trySpawn(room, room.name, body, "reserver", tasks)
                    }
                }
                else if (harRoom && !harRoom.controller && flag.name.includes('invader')) { // this is invader room
                    // if there is defender, then spawn harvester
                    let defenser = room.creeps("outerHarvestDefenser", false).filter(e => {
                        let task = e.headTask();
                        return task && task.roomName == harRoom.name;
                    }).head()
                    if (!defenser) continue;
                    // console.log(defenser.name)
                    StationSources.trySpawnOuterHarKeeper(flag.pos.roomName, room, true);
                    // StationSources.trySpawnOuterMineralKeeper(flag.pos.roomName, room);
                }
                StationSources.trySpawnOuterHarCarrier(flag.pos.roomName, room);

            }
        }
    }
}


global.StrategyOuterHarvest = pro;
