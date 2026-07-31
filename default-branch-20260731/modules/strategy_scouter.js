/**
 * claim 房间 策略
 */


Creep.prototype.registerMoveTo=function () {
    if(this.spawning){
        let flag = this.headTaskFlag();
        if(flag)flag.memory.spawnTime = Game.time
    }
};

Creep.prototype.moveto=function () {
    let obj = this.headTaskFlag()
    if(obj&&!this.pos.isEqualTo(obj)){
        this.goTo(obj);
    }else if(!obj){
        this.popTask();
    }
};

let pro = {
    exec () {
        if(Game.time%3!=0)return;
        if(!ManagerFlags.hasPrefix("moveto"))return;
        ManagerFlags.getFlagsByPrefix("moveto").forEach(flag=> {
            let spawnRoom;
            if (Game.rooms[flag.getRoomName()] && Game.rooms[flag.getRoomName()].my) spawnRoom = Game.rooms[flag.getRoomName()]
            else spawnRoom = StationHive.getClosestSpawnRoom(flag.pos.roomName, 1)
            if(!spawnRoom){
                log("no active able room");
                return;
            }

            // log(spawnRoom.name,passByRoomCnt)
            let scouter = spawnRoom.creeps("scouter", false).filter(e => e.headTaskFlag()&&e.headTaskFlag().name == flag.name).head();
            let nameSplit = flag.name.split("_");
            let minTime = 0
            if (nameSplit.length >= 3) {
                minTime = parseInt(nameSplit[2])
            }
            if (!scouter&&Game.time-(flag.memory.spawnTime||0)>minTime) {
                let tasks = [UtilsTask.taskFlag(flag,  "moveto","registerMoveTo")]
                StationHive.trySpawn(spawnRoom, spawnRoom.name, [MOVE], "scouter", tasks)
            }
        });
    }
}


global.StrategyScouter=pro;
