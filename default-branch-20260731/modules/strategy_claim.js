/**
 * claim 房间 策略
 */

let pro = {
    getSpawnRoom(flag) {
        let configuredRoom = flag.memory.spawnRoom && Game.rooms[flag.memory.spawnRoom];
        if (configuredRoom && configuredRoom.my && configuredRoom.spawn.length) return configuredRoom;
        return StationHive.getClosestSpawnRoom(flag.pos.roomName, 7, 3, 15);
    },
    exec () {
        if(Game.time%3!=0)return;
        if(!ManagerFlags.hasPrefix("claim"))return;
        ManagerFlags.getFlagsByPrefix("claim").forEach(flag=>{
            if (Game.rooms[flag.pos.roomName]&&Game.rooms[flag.pos.roomName].my&&Game.rooms[flag.pos.roomName].spawn.length>0) {
                flag.remove();
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
                    if(Game.rooms[flag.pos.roomName]&&Game.rooms[flag.pos.roomName].my)return;
                    let spawnRoom = pro.getSpawnRoom(flag);
                    if(!spawnRoom){
                        log("no active able room");
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
                }

            }
        });
    }
}


global.StrategyClaim=pro;
