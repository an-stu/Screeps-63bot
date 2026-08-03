
Creep.prototype.registerStationMineral = function () {
    let rm = Memory.rooms[this.memory["roomName"]];
    if (rm && rm[pro.stationName]) {
        let mineral = rm[pro.stationName];
        if (this.spawning) {
            mineral["spawnTime"] = Game.time - Math.ceil(this.body.length * 3 / 2) //因为 后面计算的时候又减少一遍了，所以除以2
        }
        let rmHarList = mineral["creeps"];
        if (!rmHarList.contains(this.id))
            rmHarList.push(this.id)
    }
};


Creep.prototype.registerStationMineralCarryInRoom = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.used = room.used || {}
    room.used[this.headTask().id] = true

};

Creep.prototype.concatStationMineral = function () {
    let rm = Memory.rooms[this.memory["roomName"]];
    if (rm && !this.concated) {
        this.concated = true
        let data = rm[pro.stationName];
        data["spawnTime"] -= Game.time - data["spawnTime"] - 10;// 出生时间 - 接触时间 这样下次走到那边就可以刚刚好前面那只死掉,再缓冲 10tick
    }
    this.popTask();
    this.execLastTask();
};


Creep.prototype.harvestMineralKeeper = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let mineral = Game.getObjectById(task["id"]);
        let station = this.room.memory[pro.stationName];
        let container = Game.getObjectById(station["container"]);
        if (container && !container.pos.isEqualTo(this)) {
            this.addTask(UtilsTask.task(container, "concatStationMineral"));
            this.addTaskAndExec(UtilsTask.task(container, "goToPop"));
            return;
        }
        if (this.ticksToLive % 6 == 0) {
            if (container && container.store.getFreeCapacity(station.resType) > 80) {
                if (mineral && mineral.amount == 0) {
                    if (this.ticksToLive > 600) {
                        this.popTask()
                            .addTask([UtilsTask.taskData("recycleCreep")])
                            .execLastTask();
                    } else {
                        this.suicide();
                    }

                }
                this.harvest(mineral);
            }
        }
    }
};



let pro = {
    stationName: "stationMineral",
    getHarvesterBodyConfig(energy) {
        let current = 0;
        let cost = BODYPART_COST[WORK] * 4 + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy) {// 挖矿的不需要carry 直接 4：1 没问题的！ 体型越大越好
            num += 1;
            current += cost
            if (num >= 10) break;
        }
        return ManagerCreeps.calcBodyPart({ [MOVE]: num, [WORK]: num * 4 });
    },
    generatorHarTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestMineralKeeper", "registerStationMineral")
        ]
    },
    /**
     * 返回 1个 任务
     * @param roomName
     * @return {[undefined]}
     */
    generatorCarryMineralTask(roomName) {
        let sm = Memory.rooms[roomName.name || roomName][pro.stationName];
        let room = Game.rooms[roomName.name || roomName]
        room.used = room.used || {}
        let task = [];
        if (sm) {
            let container = Game.getObjectById(sm["container"]);
            if (container &&
                (container.store.getFreeCapacity(sm.resType) < 400 || (container.store.getFreeCapacity(sm.resType) < 2000 && room.mineral.ticksToRegeneration > 0))
                && !room.used[container.id]) {
                _.keys(container.store).forEach(e => {
                    task.push(UtilsTask.task(container, "carryRes", "registerStationMineralCarryInRoom", {
                        resType: e
                    }))
                })
            }
        }
        return [task];
    },
    trySpawnHarKeeper(room) {
        if (room.spawnFailure) return null;
        if (room.mineral.ticksToRegeneration > 0) return; // 如果已经生了，就不生了
        let data = room.memory[StationMineral.stationName]
        if(!data||!data["creeps"])return;// update 尚未执行时（新占领房间）直接返回
        // 如果两个多个连在一起死掉一个
        let allCreeps = data["creeps"].map(e => Game.getObjectById(e)).filter(e => e && e.ticksToLive)
        allCreeps.forEach(a => {
            allCreeps.forEach(b => {
                if (a.id != b.id && a.pos.isNearTo(b)) {
                    if (a.ticksToLive < b.ticksToLive) a.suicide(); else b.suicide();
                }
            })
        })

        // log(Game.time - data["spawnTime"])
        // HelperVisual.commonText(room,1500 - (Game.time - data["spawnTime"]),{x:data.x,y:data.y})
        // log()
        // 清理死掉的creeps
        data["creeps"] = data["creeps"].filter(e => Game.getObjectById(e))
        let container = Game.getObjectById(data["container"]) // change by an_w
        if (container && room.extractor && room[room.mineral.mineralType] < 200000 && (Game.time - data["spawnTime"] > 1500 || data["creeps"].length == 0)) {
            // log("Mineral" + room.name)
            let harBody = StationMineral.getHarvesterBodyConfig(room.getEnergyCapacityAvailable(room))
            let tasks = (StationMineral.generatorHarTask(data))
            StationHive.trySpawn(room, room.name, harBody, "harvestMineralKeeper", tasks)
        }
    },
    update(room) {
        if (!room.my&&!room.extractor) return delete Memory.rooms[room.name][pro.stationName];
        let mineral = room.mineral;
        if (!mineral) return;
        let usedContainer = {};
        let tmp = room.memory[pro.stationName] = room.memory[pro.stationName] || {};

        /** todo 更新寻找的算法 */
        let container = room[STRUCTURE_CONTAINER].filter(c => c.pos.isNearTo(mineral) && !usedContainer[c.id]).head();
        tmp["roomName"] = room.name;
        tmp["id"] = mineral.id;
        tmp["resType"] = mineral.mineralType;
        tmp["x"] = mineral.pos.x;
        tmp["y"] = mineral.pos.y;
        tmp["creeps"] = tmp["creeps"] || [];
        tmp["spawnTime"] = tmp["spawnTime"] || 0;
        tmp["container"] = container ? container.id : undefined;
    },

};



global.StationMineral = pro;
