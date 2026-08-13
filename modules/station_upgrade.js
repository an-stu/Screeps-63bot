/**
 * upgrade_W5N3_3 至少生3个升级的
 */

let MAX_GCL = 150;
let CONTROLLER_SIGN_VERSION = 2;
let CONTROLLER_SIGNS = [
    "明月松间照，清泉石上流。",
    "海上生明月，天涯共此时。",
    "落霞与孤鹜齐飞，秋水共长天一色。",
    "行到水穷处，坐看云起时。",
    "大鹏一日同风起，扶摇直上九万里。",
    "山重水复疑无路，柳暗花明又一村。",
    "长风破浪会有时，直挂云帆济沧海。",
    "星垂平野阔，月涌大江流。",
    "Hope is the thing with feathers.",
    "A thing of beauty is a joy for ever.",
    "To see a World in a Grain of Sand.",
    "The woods are lovely, dark and deep.",
    "I wandered lonely as a cloud.",
    "The Child is father of the Man.",
    "Beauty is truth, truth beauty.",
    "The moon was a ghostly galleon."
];

function textHash(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    return hash;
}

function controllerSignFor(roomName) {
    let assignments = Memory.controllerSignAssignments = Memory.controllerSignAssignments || {};
    let ownedRooms = Object.values(Game.rooms).filter(room => room.my).map(room => room.name);
    let current = assignments[roomName];
    let duplicated = current && ownedRooms.some(name => name != roomName && assignments[name] == current);
    if (current && !duplicated && (CONTROLLER_SIGNS.includes(current) || current.endsWith(" · " + roomName))) return current;

    let used = new Set(ownedRooms.filter(name => name != roomName).map(name => assignments[name]).filter(Boolean));
    let start = textHash(roomName) % CONTROLLER_SIGNS.length;
    for (let offset = 0; offset < CONTROLLER_SIGNS.length; offset++) {
        let sign = CONTROLLER_SIGNS[(start + offset) % CONTROLLER_SIGNS.length];
        if (!used.has(sign)) return assignments[roomName] = sign;
    }
    return assignments[roomName] = CONTROLLER_SIGNS[start] + " · " + roomName;
}

function isWalkableUpgradePosition(position, controller) {
    if (!position || position.roomName != controller.pos.roomName || !position.inRangeTo(controller, 3)) return false;
    if (Game.map.getRoomTerrain(position.roomName).get(position.x, position.y) == TERRAIN_MASK_WALL) return false;
    return !position.lookFor(LOOK_STRUCTURES).some(structure =>
        structure.structureType == STRUCTURE_CONTROLLER
        || (OBSTACLE_OBJECT_TYPES.includes(structure.structureType) && structure.structureType != STRUCTURE_RAMPART));
}

function isControllerUpgradeTask(creep, controller) {
    let task = creep.memory.tasks && creep.memory.tasks.last();
    return task && task.id == controller.id && (task.taskName == "upgrade" || task.taskName == "upgradeKeeper");
}

function getUpgradeReservations(room, controller) {
    if (room._upgradePositionReservations) return room._upgradePositionReservations;
    let reservations = {};
    room.find(FIND_MY_CREEPS).filter(creep => isControllerUpgradeTask(creep, controller))
        .sort((left, right) => left.name.localeCompare(right.name)).forEach(creep => {
            let data = creep.memory.upgradePosition;
            if (!data || data.controllerId != controller.id) return;
            let position = new RoomPosition(data.x, data.y, room.name);
            let key = position.x + ":" + position.y;
            let structurallyValid = Game.time % 100 != 0 || isWalkableUpgradePosition(position, controller);
            if (position.inRangeTo(controller, 3) && structurallyValid && !reservations[key]) reservations[key] = creep.name;
            else delete creep.memory.upgradePosition;
        });
    room._upgradePositionReservations = reservations;
    return reservations;
}

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
            source["creeps"] = rmHarList.without(this.id)
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
        return;
    }
    let obj = this.lastTaskObj();
    let upgradePosition = obj && pro.getUpgradePosition(this, obj);
    let code = this.upgradeController(obj);
    if (code == ERR_NOT_IN_RANGE) {
        if (upgradePosition) this.moveTo(upgradePosition, {range:0, reusePath:20, visualizePathStyle:{stroke:'#fffa00'}});
        else this.moveTo(obj, { visualizePathStyle: { stroke: '#fffa00' } }, { range: 3 });
    } else if (upgradePosition && !this.pos.isEqualTo(upgradePosition)) {
        this.moveTo(upgradePosition, {range:0, reusePath:20, visualizePathStyle:{stroke:'#fffa00'}});
    }
    if (this.store.getFreeCapacity(RESOURCE_ENERGY) >= 50) {
        // 能量补给点（link/container）几乎不变：缓存 id，10 tick 重扫一次
        let store = undefined;
        if (this.memory.upgradeStoreId && (this.memory.upgradeStoreRefresh || 0) > Game.time) {
            store = Game.getObjectById(this.memory.upgradeStoreId);
        }
        if (!store || store.store[RESOURCE_ENERGY] == 0 || (this.memory.upgradeStoreRefresh || 0) <= Game.time) {
            store = this.pos.findInRange(FIND_STRUCTURES, 4, { filter: e => e.structureType == STRUCTURE_LINK }).head();
            if (!store || store.store[RESOURCE_ENERGY] == 0) store = this.pos.findInRange(FIND_STRUCTURES, 3, { filter: e => e.structureType == STRUCTURE_CONTAINER && e.store[RESOURCE_ENERGY] > 0 }).head();
            this.memory.upgradeStoreId = store ? store.id : undefined;
            this.memory.upgradeStoreRefresh = Game.time + 10;
        }
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
    if (upgradePosition && this.pos.isEqualTo(upgradePosition)) this.memory.dontPullMe = true;
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

    let link = Game.getObjectById(ms["link"]);
    let container = Game.getObjectById(ms["container"]);
    let upgradePosition = pro.getUpgradePosition(this, obj, [link, container].filter(Boolean));

    if (this.store[RESOURCE_ENERGY] > 0) {
        if (!(this.memory.concated && this.room.storage && this.room.storage.store[RESOURCE_ENERGY] < 10000) || this.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) < 10000) { //少于 1w 的时候暂时不更新
            let code = this.upgradeController(obj);
            if (code == ERR_NOT_IN_RANGE && this.ticksToLive % 3 == 0) {
                if (upgradePosition) this.moveTo(upgradePosition, {range:0, reusePath:20});
                else this.moveTo(obj, { range: 3 });
            }
            if (this.pos.inRangeTo(obj, 3)) {
                if (this.memory.needUnboost === undefined) this.memory.needUnboost = this.body.filter(e => e.boost).length
                if (!this.memory.concated) {
                    this.concatStationUpgrade();
                    this.memory.concated = true
                }
            }
        }
    }

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
    if (!moved && upgradePosition && !this.pos.isEqualTo(upgradePosition)) {
        this.moveTo(upgradePosition, {range:0, reusePath:20});
    } else if (!moved && container && !this.pos.isEqualTo(container) && ms["creeps"].length <= 1) {
        this.moveTo(container);
    }
    if (upgradePosition && this.pos.isEqualTo(upgradePosition)) this.memory.dontPullMe = true;
    if (this.ticksToLive % 7 == 0) {
        //修理container
        let container = this.pos.findInRange(FIND_STRUCTURES, 3, { filter: e => e.structureType == STRUCTURE_CONTAINER && e.hits / e.hitsMax < 0.9 }).head();
        if (container) this.repair(container);

    }
    if (this.ticksToLive % 2 > 0)
        this.memory.dontPullMe = !!(upgradePosition && this.pos.isEqualTo(upgradePosition));
    // if(this.store[RESOURCE_ENERGY]==0||this.mainRoom().controller.upgradeBlocked){
    //     this.popTask();
    //     this.execLastTask();
    // }
}

let pro = {
    controllerSignVersion: CONTROLLER_SIGN_VERSION,
    controllerSigns: CONTROLLER_SIGNS,
    getControllerSign(roomName) {
        return controllerSignFor(roomName);
    },
    trySignController(creep) {
        let room = creep.room;
        let controller = room.controller;
        let desired = room._controllerSignText || (room._controllerSignText = controllerSignFor(room.name));
        if (controller.sign && controller.sign.username == WHO_AM_I && controller.sign.text == desired) return false;
        if (!room._controllerSignerId) {
            let candidates = room.find(FIND_MY_CREEPS).filter(unit => !unit.spawning && unit.getActiveBodyparts(MOVE) > 0);
            candidates.sort((left, right) => {
                let leftRole = left.memory.role == "upgrader" ? 0 : left.memory.role == "worker" ? 1 : 2;
                let rightRole = right.memory.role == "upgrader" ? 0 : right.memory.role == "worker" ? 1 : 2;
                return leftRole - rightRole || left.pos.getRangeTo(controller) - right.pos.getRangeTo(controller)
                    || left.name.localeCompare(right.name);
            });
            room._controllerSignerId = candidates.length ? candidates[0].id : "none";
        }
        if (room._controllerSignerId != creep.id) return false;
        if (!creep.pos.isNearTo(controller)) {
            creep.moveTo(controller, {range:1, reusePath:20, visualizePathStyle:{stroke:'#a78bfa'}});
            return true;
        }
        let result = creep.signController(controller, desired);
        if (result == OK) {
            room.memory.controllerSignVersion = CONTROLLER_SIGN_VERSION;
            room.memory.controllerSignText = desired;
            Logger.info("Controller signed", room.name, desired);
        }
        return true;
    },
    getUpgradePosition(creep, controller, supplyTargets = []) {
        if (!controller) return undefined;
        let reservations = getUpgradeReservations(creep.room, controller);
        let stored = creep.memory.upgradePosition;
        if (stored && stored.controllerId == controller.id) {
            let position = new RoomPosition(stored.x, stored.y, creep.room.name);
            let key = position.x + ":" + position.y;
            if (reservations[key] == creep.name) return position;
        }

        let candidates = [];
        for (let x = Math.max(1, controller.pos.x - 3); x <= Math.min(48, controller.pos.x + 3); x++) {
            for (let y = Math.max(1, controller.pos.y - 3); y <= Math.min(48, controller.pos.y + 3); y++) {
                let position = new RoomPosition(x, y, creep.room.name);
                let key = x + ":" + y;
                if (reservations[key] || !isWalkableUpgradePosition(position, controller)) continue;
                let supplyRanges = supplyTargets.map(target => position.getRangeTo(target));
                let supplyPenalty = supplyRanges.filter(range => range > 1).length;
                let supplyRange = supplyRanges.reduce((sum, range) => sum + range, 0);
                let structures = position.lookFor(LOOK_STRUCTURES);
                let paved = structures.some(structure => structure.structureType == STRUCTURE_CONTAINER || structure.structureType == STRUCTURE_ROAD);
                candidates.push({position:position, supplyPenalty:supplyPenalty, supplyRange:supplyRange, paved:paved ? 0 : 1,
                    travel:creep.pos.getRangeTo(position), order:(x * 53 + y * 97 + textHash(creep.name)) % 997});
            }
        }
        candidates.sort((left, right) => left.supplyPenalty - right.supplyPenalty || left.supplyRange - right.supplyRange || left.paved - right.paved
            || left.travel - right.travel || left.order - right.order);
        if (!candidates.length) {
            delete creep.memory.upgradePosition;
            return undefined;
        }
        let selected = candidates[0].position;
        reservations[selected.x + ":" + selected.y] = creep.name;
        creep.memory.upgradePosition = {x:selected.x, y:selected.y, controllerId:controller.id};
        return selected;
    },
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

