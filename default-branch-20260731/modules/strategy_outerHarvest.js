/**
 * 外矿策略
 */

let pro = {
    exec(room) {
        if ((Game.time + room.hashCode()) % 6 != 0) return;
        if (!room.storage) return;
        room.flags("har").sort().forEach(flag => {
            if (Memory.rooms[flag.pos.roomName]) {
                let isInvader = false
                if (flag.name.includes('invader')) {
                    isInvader = true
                }
                StationSources.trySpawnOuterDefenser(flag.pos.roomName, room, isInvader);
            }
        })
        room.flags("har").sort().forEach(flag => {
            if (!Memory.rooms[flag.pos.roomName] || !Memory.rooms[flag.pos.roomName][StationSources.stationName]) {
                let scouter = room.creeps("scouter", false).filter(e => e.headTask().roomName == flag.pos.roomName).head();
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
                    let reserver = room.creeps("reserver", false).filter(e => e.headTask().roomName == flag.pos.roomName).head();
                    if (!reserver && (!harRoom.controller.reservation || harRoom.controller.reservation.ticksToEnd < 1000)) {
                        let tasks = [UtilsTask.task(harRoom.controller, "reserveOuterHar")]
                        let body = StationSources.getReverserBodyConfig(room.getEnergyCapacityAvailable())
                        StationHive.trySpawn(room, room.name, body, "reserver", tasks)
                    }
                }
                else if (harRoom && !harRoom.controller && flag.name.includes('invader')) { // this is invader room
                    // if there is defender, then spawn harvester
                    let defenser = room.creeps("outerHarvestDefenser", false).filter(e => e.headTask().roomName == harRoom.name).head()
                    if (!defenser) return;
                    // console.log(defenser.name)
                    StationSources.trySpawnOuterHarKeeper(flag.pos.roomName, room, true);
                    // StationSources.trySpawnOuterMineralKeeper(flag.pos.roomName, room);
                }
                StationSources.trySpawnOuterHarCarrier(flag.pos.roomName, room);

            }
        })
    }
}


global.StrategyOuterHarvest = pro;
