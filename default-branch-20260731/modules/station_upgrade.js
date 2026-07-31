/**
 * upgrade_W5N3_3 至少生3个升级的
 */

let MAX_GCL = 150;

Creep.prototype.registerStationUpgrade = function () {
    let rm = Memory.rooms[this.memory["roomName"]];
    if (rm && rm[pro.stationName]) {
        let source = rm[pro.stationName];
        if (this.spawning) {
            source["spawnTime"] = Game.time
        }
        let rmHarList = source["creeps"];
        if (!rmHarList.contains(this.id))
            rmHarList.push(this.id)
    }
};

Creep.prototype.unregisterStationUpgrade = function () {
    let rm = Memory.rooms[this.memory["roomName"]];
    if (rm && rm[pro.stationName]) {
        let source = rm[pro.stationName];
        let rmHarList = source["creeps"];
        if (rmHarList.contains(this.id))
            rmHarList = rmHarList.without(this.id)
    }
};



Creep.prototype.concatStationUpgrade = function () {
    let rm = Memory.rooms[this.headTask().roomName];
    if (rm) {
        let data = rm[pro.stationName];
        let pathTime = Game.time - data["spawnTime"];//（出生时间 - 接触时间 = 移动时间）
        data["spawnTime"] -= pathTime + this.body.length * 3;// （移动时间）+ 生的时间  无缝衔接
        data["pathTime"] = pathTime;
    }
};


Creep.prototype.registerStationUpgradeCarryInRoom = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.used = room.used || {}
    let id = this.headTask().id;
    room.used[id] = (room.used[id] || 0) + this.getPartCnt(CARRY) * 50
};


Creep.prototype.upgrade = function () {
    if (this.store[RESOURCE_ENERGY] == 0) {
        this.popTask()
    }
    let obj = this.lastTaskObj();
    let code = this.upgradeController(obj);
    if (code == ERR_NOT_IN_RANGE) {
        this.moveTo(obj, { visualizePathStyle: { stroke: '#fffa00' } }, { range: 3 });
    }
    if (this.store.getFreeCapacity(RESOURCE_ENERGY) >= 50) {
        let store = this.pos.findInRange(FIND_STRUCTURES, 4, { filter: e => e.structureType == STRUCTURE_LINK }).head();
        if (!store || store.store[RESOURCE_ENERGY] == 0) store = this.pos.findInRange(FIND_STRUCTURES, 3, { filter: e => e.structureType == STRUCTURE_CONTAINER && e.store[RESOURCE_ENERGY] > 0 }).head();
        if (store && store.store[RESOURCE_ENERGY] > 0) {
            let result = this.withdraw(store, RESOURCE_ENERGY);
            if (result == ERR_NOT_IN_RANGE) {
                this.moveTo(store, { visualizePathStyle: { stroke: '#ffffff' } });
            }
        }
    }
    if (this.store[RESOURCE_ENERGY] == 0 || this.mainRoom().controller.upgradeBlocked) {
        this.popTask();
        this.execLastTask();
    }
    if (this.ticksToLive % 300 == 0 && this.room.find(FIND_CONSTRUCTION_SITES).length > 0) {// 如果有工地则不升级
        this.popTask();
        this.execLastTask();
    }
    if (this.ticksToLive % 3 == 0)
        this.memory.dontPullMe = false;
}



Creep.prototype.upgradeKeeper = function () {
    let obj = this.lastTaskObj();
    let mainRoom = this.mainRoom();
    let ms = mainRoom.memory[pro.stationName];
    if (ms && this.ticksToLive < (ms.pathTime || 0) * 1.5) {// 如果寿命将近
        if (!this.memory.unboostCheck && this.memory.needUnboost) {
            let tasks = StationLab.generatorUnboostTask(mainRoom);
            if (tasks.length) {
                this.drop(RESOURCE_ENERGY)
                this.unregisterStationUpgrade();
                this.popTask().addTask(tasks).execLastTask();
                return;
            }
            this.memory.unboostCheck = true;
        }
        else {
            this.memory.unboostCheck = true;
        }
    }

    // if(Game.shard.name=="shard3"&&Game.cpu.bucket<300&&(Game.cpu.bucket&1))return;

    if (this.store[RESOURCE_ENERGY] > 0) {
        if (!(this.memory.concated && this.room.storage && this.room.storage.store[RESOURCE_ENERGY] < 10000) || this.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) < 10000) { //少于 1w 的时候暂时不更新
            let code = this.upgradeController(obj);
            if (code == ERR_NOT_IN_RANGE && this.ticksToLive % 3 == 0) this.moveTo(obj, { range: 3 });
            if (this.pos.inRangeTo(obj, 3)) {
                if (this.memory.needUnboost === undefined) this.memory.needUnboost = this.body.filter(e => e.boost).length
                if (!this.memory.concated) {
                    this.concatStationUpgrade();
                    this.memory.concated = true
                }
            }
        }
    }

    let link = Game.getObjectById(ms["link"]);
    let container = Game.getObjectById(ms["container"]);
    let carryParts = this.getPartCnt(CARRY);
    let workParts = this.getPartCnt(WORK);
    let containerNotFull = container && container.store.getFreeCapacity(RESOURCE_ENERGY) > carryParts * 100;
    let moved = false
    if (this.store.getUsedCapacity(RESOURCE_ENERGY) <= workParts * (containerNotFull ? 2000 : 1)) { //如果没满的情况下 拿全部的这样才能快速填满container
        let isWithdrawLink = false;
        if (link && (link._upgrade_used || 0) <= link.store[RESOURCE_ENERGY] && link.store[RESOURCE_ENERGY] > 0) {
            let result = this.withdraw(link, RESOURCE_ENERGY);
            if (result == ERR_NOT_IN_RANGE) {
                this.moveTo(link, { visualizePathStyle: { stroke: '#ffffff' } });
                moved = true;
            } else {
                link._upgrade_used = (link._upgrade_used || 0) + this.store.getFreeCapacity(RESOURCE_ENERGY)
                isWithdrawLink = true
            }
        }
        if (isWithdrawLink) {
            if (containerNotFull) {
                this.transfer(container, RESOURCE_ENERGY, carryParts * 50 - workParts * 2)
            }
        } else if (!link || this.store.getUsedCapacity(RESOURCE_ENERGY) <= workParts) {
            let result = this.withdraw(container, RESOURCE_ENERGY);
            if (result == ERR_NOT_IN_RANGE) {
                this.moveTo(container, { visualizePathStyle: { stroke: '#ffffff' } });
                moved = true;
            }
        }
    }
    if (!moved) {// 如果没有移动过就移到container上面，放置堵车，死掉直接掉container里面
        if (container && !this.pos.isEqualTo(container) && ms["creeps"].length <= 1) {
            this.moveTo(container)
        }
    }
    if (this.ticksToLive % 7 == 0) {
        //修理container
        let container = this.pos.findInRange(FIND_STRUCTURES, 3, { filter: e => e.structureType == STRUCTURE_CONTAINER && e.hits / e.hitsMax < 0.9 }).head();
        if (container) this.repair(container);

    }
    if (this.ticksToLive % 2 > 0)
        this.memory.dontPullMe = false;
    // if(this.store[RESOURCE_ENERGY]==0||this.mainRoom().controller.upgradeBlocked){
    //     this.popTask();
    //     this.execLastTask();
    // }
}

let pro = {
    trySpawnUpgrader(room) {
        let getBodyLowLevel = function () { //低等级的part 无限多
            let current = 0;
            let cost = BODYPART_COST[WORK] * 2 + BODYPART_COST[MOVE];
            let num = 0;
            let energy = room.getEnergyCapacityAvailable();
            while (current + cost <= energy - BODYPART_COST[CARRY] * Math.ceil(num / 5)) {// 超过 10个 work 加一个 carry
                num += 1;
                current += cost
                if (num >= 16) break;
            }
            let is16 = 0 //16的时候溢出，多两个 carry
            if (num == 16) {
                num -= 1;
                is16 = 2
            }
            return ManagerCreeps.calcBodyPart({ [MOVE]: num, [WORK]: num * 2, [CARRY]: Math.ceil(num / 5) + is16 });
        }

        let body;
        let partCnt = 0;
        let boostLevel = -1;
        if (room.level == 8 && room.extension.length >= 20) {
            partCnt = 15
            body = ManagerCreeps.calcBodyPart({ [MOVE]: 8, [WORK]: 15, [CARRY]: 2 });
            if (room.storage) boostLevel = StationLab.boostAbleLevel(room, "upgradeController", 15, 1);
        } else {
            body = getBodyLowLevel();
            partCnt = body.filter(e => e == WORK).length;
            if (room.storage) boostLevel = StationLab.boostAbleLevel(room, "upgradeController", partCnt, 1);
        }

        let task = pro.generatorUpgradeKeeperTask(room);
        if (boostLevel >= 0) task = task.concat(StationLab.generatorBoostLevelTask(room, "upgradeController", partCnt, boostLevel))
        StationHive.trySpawn(room, room.name, body, "upgrader", task);
    },
    spawnUpgrader(room) {
        let sm = room.memory[pro.stationName];
        if (!sm["creeps"]) sm["creeps"] = []
        if (!Game.getObjectById(sm["container"])) return;

        // let creeps = sm["creeps"].map(e=>Game.getObjectById(e)).filter(e=>e&&e.ticksToLive) // 清理两个爬重叠
        // creeps.forEach(a=>{
        //     creeps.forEach(b=>{
        //         if(a.id!=b.id&&a.pos.isNearTo(b)){
        //             if(a.ticksToLive<b.ticksToLive) a.suicide(); else b.suicide();
        //         }
        //     })
        // })

        sm["creeps"] = sm["creeps"].filter(e => Game.getObjectById(e));
        let unboostTime = 0
        if (room.level == 8) { // 如果有boost 要算上unboost的时间
            let head = Game.getObjectById(sm["creeps"].head());
            if (head && head.memory.needUnboost) {
                unboostTime = sm["pathTime"] * 0.8
            }
        }

        let spawn = function () {
            pro.trySpawnUpgrader(room)
        }
        let upgradeFlag = room.flags("upgrade").head()

        let checkGCL = () => (Game.shard.name.startsWith("shard") || Game.gcl.level < MAX_GCL)
        let checkBucket = () => (!isSaveCpu || Game.cpu.bucket > 9000)
        if (room.level < 8 || !room.storage) {
            let minUpgraderCnt = 0;
            if (upgradeFlag || (upgradeFlag && room.terminal && room.terminal.my)) {
                let split = upgradeFlag.getNameSplit();
                if (split.length >= 2) minUpgraderCnt = parseInt(split[2])
                else upgradeFlag.remove()
            }
            if (!room.storage || room.controller.progress >= room.controller.progressTotal)
                spawn()
            else if (WHO_AM_I == "an_w" && minUpgraderCnt > room.creeps("upgrader", false).length)
                spawn()
            else if (((room.storage.store[RESOURCE_ENERGY] - (room.level - 3.5) * 10000) / 1000000 > room.creeps("upgrader", false).length)
                || room.controller.ticksToDowngrade < 500
                || (room.storage.store[RESOURCE_ENERGY] > 10000 && minUpgraderCnt > room.creeps("upgrader", false).length))
                spawn()
        }
        else if (((checkGCL() && checkBucket() && room.storage.store[RESOURCE_ENERGY] >= 150000) || room.controller.ticksToDowngrade < 5000)
            && (Game.time - sm["spawnTime"] + unboostTime > 1500 || sm["creeps"].length == 0)) { // 8级后无缝衔接
            // room.creeps("upgrader",false).filter(e=>!e.ticksToLive||e.ticksToLive>e.body.length*3).length==0)
            spawn()
            if (upgradeFlag) upgradeFlag.remove()
        }
    },
    stationName: "stationUpgrade",
    generatorUpgradeTask(room) {
        return [UtilsTask.task(room.controller, "upgrade", "registerStationUpgrade")]
    },
    generatorUpgradeKeeperTask(room) {
        return [UtilsTask.task(room.controller, "upgradeKeeper", "registerStationUpgrade")]
    },
    exec(room) {
        let objs = room.memory[pro.stationName];
    },
    update(room) {
        if (!room.my) return delete Memory.rooms[room.name][pro.stationName];
        let objs = room.memory[pro.stationName] || {};
        if (!room.controller) return
        objs["creeps"] = objs["creeps"] || []
        let container = room.controller.pos.findInRange(FIND_STRUCTURES, 1, { filter: e => e.structureType == STRUCTURE_CONTAINER }).head()
        if (container && !Game.getObjectById(objs["container"])) objs["container"] = container.id
        if (container) {
            let link = room[STRUCTURE_LINK].filter(e => container.pos.isNearTo(e)).head();
            if (link) objs[STRUCTURE_LINK] = link.id
        }
        objs[STRUCTURE_CONTROLLER] = {
            id: room.controller.id,
            x: room.controller.pos.x,
            y: room.controller.pos.y,
        }
        room.memory[pro.stationName] = objs;
    },
    generatorFillEnergyTask(roomName, carryCap) {
        let rm = Memory.rooms[roomName];
        let room = Game.rooms[roomName.name || roomName]
        room.used = room.used || {}
        if (rm) {
            let container = Game.getObjectById(rm[pro.stationName][STRUCTURE_CONTAINER]);
            let upgradeLink = Game.getObjectById(rm[pro.stationName][STRUCTURE_LINK]);
            if (!upgradeLink || upgradeLink && upgradeLink.store.isEmpty()) {
                let centerLink = Game.getObjectById(rm[StationCarry.stationName][STRUCTURE_LINK]);
                if (centerLink && upgradeLink && upgradeLink.store.isEmpty() && centerLink.store.isEmpty()) {
                    return [UtilsTask.task(centerLink, "fillRes", "registerStationUpgradeCarryInRoom", { resType: RESOURCE_ENERGY })]
                }
                if (container
                    && ((room.used[container.id] || 0) + container.store[RESOURCE_ENERGY] + Math.min(1000, Math.max((carryCap || 0) - 400, 0)) < 2000)
                    && (!upgradeLink || (container && ((room.used[container.id] || 0) + container.store.getUsedCapacity(RESOURCE_ENERGY) < 800) && upgradeLink.store.isEmpty()))) {
                    return [UtilsTask.task(container, "fillRes", "registerStationUpgradeCarryInRoom", { resType: RESOURCE_ENERGY })]
                }
            }
        }
        return [];
    }

};



global.StationUpgrade = pro;

