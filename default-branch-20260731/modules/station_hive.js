
// let LOCAL_SHARD_NAME_SHARD_HASH = Utils.rnd(Utils.rnd(Utils.hashCode(Game.shard.name)))+1008611
let processName = function () {
    return randomId()
}


// Creep.prototype.registerStationHive=function () {
//     let room = Game.rooms[this.memory["roomName"]];
//     // if(room&&room[""])
// };

Creep.prototype.registerStationHiveCarryInRoom = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.hiveEnergySending = room.hiveEnergySending || 0
    room.hiveEnergySending += this.memory.tasks.length > 2 ? this.store.getCapacity(RESOURCE_ENERGY) : this.store[RESOURCE_ENERGY]

    if (this.memory.tasks.length >= 2) {
        let id = this.memory.tasks[1].id
        room.hiveEnergySendingUsed = room.hiveEnergySendingUsed || {}
        room.hiveEnergySendingUsed[id] = true
    }
};

Creep.prototype.fillHive = function () {
    if (this.store[RESOURCE_ENERGY] == 0) {
        this.popTask()
        return;
    }
    //这里只在自己的房间
    let room = Game.rooms[this.memory["roomName"]]
    room.hiveEnergySendingUsed = room.hiveEnergySendingUsed || {}
    let target = this.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: e =>
            (e.structureType == STRUCTURE_EXTENSION || e.structureType == STRUCTURE_SPAWN) &&
            e.store[RESOURCE_ENERGY] < e.store.getCapacity(RESOURCE_ENERGY) && //&& e.isActive()
            !room.hiveEnergySendingUsed[e.id],
        ignoreCreeps: true
    })
    // room.spawn.concat(room.extension).filter(e=>e.store.getFreeCapacity(RESOURCE_ENERGY))
    //     .map(e=> UtilsTask.task(e,"fillRes","registerStationHive",{resType:RESOURCE_ENERGY}))
    if (target) {
        room.hiveEnergySendingUsed[target.id] = true
        this.addTask(UtilsTask.task(target, "fillRes", undefined, { resType: RESOURCE_ENERGY }))
        this.execLastTask()
    }
    else {
        this.popTask();
    }
};


let pro = {
    stationName: "stationHive",
    // _name_hash:Game.time*100+Math.ceil(Math.random()*100),
    _time: 0,
    generatorFillHiveTask(room, creep) {
        // todo 分配 需要fill的能量
        room.hiveEnergySending += creep.store[RESOURCE_ENERGY] > 0 ? creep.store[RESOURCE_ENERGY] : creep.store.getFreeCapacity(RESOURCE_ENERGY)
        return UtilsTask.task(creep, "fillHive", "registerStationHiveCarryInRoom", { resType: RESOURCE_ENERGY })

    },
    HiveNeedToFill(room) {
        return room.energyAvailable + room.hiveEnergySending < room.energyCapacityAvailable;
    },
    /**
     *
     * @param roomName
     * @param level
     * @param minLevel
     * @param minRoomDistinct
     * @return {room,routeDistance}
     */
    getClosestSpawnRoom(roomName, level = 7, minLevel = 4, minRoomDistinct = 10) {
        roomName = roomName.name || roomName
        if (Game.rooms[roomName] && Game.rooms[roomName].spawn.length > 0 && Game.rooms[roomName].level >= level) {// 三级一下叫隔壁的帮忙生
            return Game.rooms[roomName];
        }
        let avoidRooms = BetterMove.getAvoidRoomsMap();
        const ops = {
            routeCallback(roomName, fromRoomName) {
                if (avoidRooms[roomName]) {    // 回避这个房间
                    return Infinity;
                }
                return 1;
            }
        };
        let room = undefined;
        let getDistinct = function (roomName1, roomName2) {
            let dist = Game.map.getRoomLinearDistance(roomName1, roomName2, false)
            if (dist < minRoomDistinct) dist = Game.map.findRoute(roomName1, roomName2, ops)
            return dist;
        }
        while (!room && level >= minLevel) {
            room = _.values(Game.rooms).filter(e => e.my && e.find(FIND_MY_SPAWNS).length && e.level >= level)
                .map(e => [e, getDistinct(roomName, e.name)]).filter(e => e[1].length < minRoomDistinct)
                .sort((a, b) => a[1].length - b[1].length).map(e => e[0]).head();
            level -= 1;
        }
        if (room) return room
        else if (Game.rooms[roomName] && Game.rooms[roomName].spawn.length > 0) return Game.rooms[roomName]
        else return undefined
    },
    spawnAble(room) {
        if (room.spawnFailue) return false;
        if (!room.spawnedMap) room.spawnedMap = {};
        return room.spawn.filter(e => !e.spawning && !room.spawnedMap[e.id]).head();
    },
    trySpawn(room, targetRoomName, body, role, tasks, ops) {
        if (!room || !room.my) {
            console.log("room not yours cannot spawn in " + targetRoomName);
            return
        }
        if (!room.spawnedMap) room.spawnedMap = {};
        if (room.spawnFailue) return null;
        // log(room.name,role)
        if (room.currentEnergyAvailable == undefined) room.currentEnergyAvailable = room.getEnergyAvailable();//缓存当前的能量
        Game._name_hash = (Game._name_hash || 0) + 1;//防止同一帧冲突名字
        let name = undefined;
        // log(room.controller.owner.username)
        if (room.controller.owner.username == "6g3y")
            name = processName();
        else
            name = LOCAL_SHARD_NAME + "_" + Game.time + "_" + Game._name_hash;// shard+Game.time+第几个生的
        let opts = { memory: { role: role, roomName: targetRoomName, tasks: tasks } };
        if (ops) for (let t in ops) opts[t] = ops[t];
        let spend = Utils.getBodyEnergyNeed(body);
        if (room.currentEnergyAvailable < spend) {
            room.spawnFailue = true; return undefined;
        }
        let spawn = room.find(FIND_MY_SPAWNS).filter(e => !e.spawning && !room.spawnedMap[e.id] && (room.level == 8 || e.isActive())).head();
        if (!spawn) {
            room.spawnFailue = true; return undefined;
        }
        let code = spawn.spawnCreep(body, name, opts);
        if (code == OK) {
            room.spawnedMap[spawn.id] = 1;
            room.currentEnergyAvailable -= spend;
            return name;
        }
        room.spawnFailue = true
        return null;
    },
    update(room) {
    },

};



global.StationHive = pro;
