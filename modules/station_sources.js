


Creep.prototype.registerStationSources = function () {
    // let rm = Memory.rooms[this.memory["roomName"]];
    let rm = Memory.rooms[this.headTask().roomName];
    if (rm && rm[pro.stationName] && rm[pro.stationName][this.headTask().id]) {
        let source = rm[pro.stationName][this.headTask().id];
        if (this.spawning) {
            source["spawnTime"] = Game.time
        }
        let rmHarList = source["creeps"] || [];
        // 清理已死亡的爬，避免列表无限膨胀
        let alive = rmHarList.filter(id => Game.getObjectById(id));
        if (alive.length != rmHarList.length) source["creeps"] = alive;
        if (!alive.contains(this.id))
            alive.push(this.id)
    }
};


Creep.prototype.registerStationSourcesCarryInRoom = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.used = room.used || {}
    room.used[this.headTask().id] = true

};

Creep.prototype.concatStationSources = function () {
    let rm = Memory.rooms[this.headTask().roomName];
    if (rm) {
        let data = rm[pro.stationName][this.headTask().id];
        let pathTime = Game.time - data["spawnTime"];//（出生时间 - 接触时间 = 移动时间）
        data["spawnTime"] -= pathTime + this.body.length * 3 - 6;// （移动时间）+ 生的时间 -  这样下次走到那边就可以刚刚好前面那只死掉,再缓冲 10tick 理论上走到后寿命不足1500t 不和能量重生重合
        data["pathTime"] = pathTime;
    }
    this.popTask();
    this.execLastTask();
};

Creep.prototype.harvestEnergyOuterKeeper = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let source = Game.getObjectById(task["id"]);
        let station = Memory.rooms[this.headTask().roomName][pro.stationName][task["id"]];
        let container = Game.getObjectById(station["container"]);
        if (container && !container.pos.isEqualTo(this)) {
            this.addTask(UtilsTask.task(container, "concatStationSources"));
            this.addTaskAndExec(UtilsTask.task(container, "goToPop"));
            return;
        } else if (source && !source.pos.isNearTo(this)) {
            this.addTask(UtilsTask.task(source, "concatStationSources"));
            this.addTaskAndExec(UtilsTask.task(source, "goToNearPop"));
            return;
        }
        if ((source.energy + 100) / source.energyCapacity > (source.ticksToRegeneration || 300) / 300 && source.energy) {
            this.harvest(source);
        }
        if (!container && this.ticksToLive % 7 == 0) {
            this.pos.createConstructionSite(STRUCTURE_CONTAINER)
        }
        if (this.store.getFreeCapacity(RESOURCE_ENERGY) < this.getPartCnt(WORK) * 2) {
            let constructionSite = this.room.constructionSite ? this.room.constructionSite.filter(e => e.pos.isNearTo(this)).head() : undefined;
            // let inBuild=false;
            if (constructionSite) {
                this.build(constructionSite);
                // inBuild=true;
            }
        }

        if (this.ticksToLive % 7 < 2) {
            //捡起掉落的能量
            let dropEnergy = this.pos.lookFor(LOOK_ENERGY).head();
            if (dropEnergy && container) {
                this.pickup(dropEnergy);
                this.transfer(container, RESOURCE_ENERGY)
            }
            //捡起尸体的能量
            let tombstone = this.pos.lookFor(LOOK_TOMBSTONES).head();
            if (tombstone && container) {
                this.withdraw(tombstone, RESOURCE_ENERGY);
                this.transfer(container, RESOURCE_ENERGY)
            }
            //捡起container的能量
        }
    }
};

Creep.prototype.harvestMineralOuterKeeper = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let mineral = Game.getObjectById(task["id"]);
        let station = Memory.rooms[this.headTask().roomName][pro.stationName][task["id"]];
        let container = Game.getObjectById(station["container"]);
        if (container && !container.pos.isEqualTo(this)) {
            this.addTask(UtilsTask.task(container, "concatStationSources"));
            this.addTaskAndExec(UtilsTask.task(container, "goToPop"));
            return;
        }
        if (mineral.mineralAmount > 0) {
            if (this.harvest(mineral) !== OK && this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.repair(container)
            }
        }
    }
    if (this.ticksToLive % 17 == 0 && this.ticksToLive > 40) {
        // find tombstone range 3 and withdraw the energy
        let tombstone = this.pos.findInRange(FIND_TOMBSTONES, 3).head();
        if (tombstone && tombstone.store[RESOURCE_ENERGY] > 0) {
            // put the mineral into the container first
            this.transfer(container, mineral.mineralType)
            this.withdraw(tombstone, RESOURCE_ENERGY);
        }
        let dropEnergy = this.pos.findInRange(FIND_DROPPED_RESOURCES, 3).head();
        if (dropEnergy) {
            this.transfer(container, mineral.mineralType)
            this.pickup(dropEnergy);
        }
    }
};

Creep.prototype.harvestEnergyKeeper = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let source = Game.getObjectById(task.id);
        let station = Memory.rooms[task.roomName][pro.stationName][task.id];
        let container = Game.getObjectById(station["container"]);

        let link = Game.getObjectById(station["link"]);
        let link2 = Game.getObjectById(station["link2"]);
        if (!link && link2) link = link2;
        if (link && link2 && (link.store.getUsedCapacity(RESOURCE_ENERGY) > link2.store.getUsedCapacity(RESOURCE_ENERGY)) && link.store[RESOURCE_ENERGY] == 800) link = link2
        if (container && !container.pos.isEqualTo(this)) {
            this.addTask(UtilsTask.task(container, "concatStationSources"));
            this.addTaskAndExec(UtilsTask.task(container, "goToPop"));
            return;
        } else if (source && !source.pos.isNearTo(this)) {
            this.addTask(UtilsTask.task(source, "concatStationSources"));
            this.addTaskAndExec(UtilsTask.task(source, "goToNearPop"));
            return;
        }
        if ((source.energy + 300) / source.energyCapacity > (source.ticksToRegeneration || 300) / 300 && source.energy) {
            this.harvest(source);
        }
        let freeEnergyCapacity = this.store.getFreeCapacity(RESOURCE_ENERGY);
        let notLinkFull = link && link.store[RESOURCE_ENERGY] != 800;
        if (this.ticksToLive % 3 == 0 || freeEnergyCapacity <= 0) {
            let nearFull = freeEnergyCapacity < this.getPartCnt(WORK) * 2;
            if (nearFull) {
                let constructionSite = this.room.constructionSite ? this.room.constructionSite.filter(e => e.pos.isNearTo(this)).head() : undefined;

                if (constructionSite) {
                    this.build(constructionSite);
                } else if (container && container.hits / container.hitsMax < 0.9) {
                    this.repair(container);
                } else if (link && link.hits / link.hitsMax < 0.9) {
                    this.repair(link);
                }
            }
            if (notLinkFull && container) {
                if (nearFull) this.transfer(link, RESOURCE_ENERGY);
                if (container.store.getUsedCapacity(RESOURCE_ENERGY) > this.getPartCnt(CARRY) * 50)
                    this.withdraw(container, RESOURCE_ENERGY)
            }
        }

        if (this.ticksToLive % 6 <= 1) {
            //捡起掉落的能量
            let dropEnergy = this.pos.lookFor(LOOK_ENERGY).head();
            if (dropEnergy && container) {
                this.pickup(dropEnergy);
                if (!notLinkFull) this.transfer(container, RESOURCE_ENERGY)
            }
            //捡起尸体的能量
            let tombstone = this.pos.lookFor(LOOK_TOMBSTONES).head();
            if (tombstone && container) {
                this.withdraw(tombstone, RESOURCE_ENERGY);
                if (!notLinkFull) this.transfer(container, RESOURCE_ENERGY)
            }
            //捡起container的能量
        }
        this.memory.dontPullMe = this.ticksToLive % 40 != 0 // add by an_w
    }
};



Creep.prototype.harvestEnergy = function () {
    let task = this.lastTask();
    if (this.store.getFreeCapacity(RESOURCE_ENERGY) <= this.getActiveBodyparts(WORK) * 2) {
        this.popTask()
    }
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let source = Game.getObjectById(task["id"]);
        // let station = this.room.memory[pro.stationName][task["id"]];
        if (source && !source.pos.isNearTo(this)) {
            this.addTaskAndExec(UtilsTask.task(source, "goToNearPop"));
            return;
        }
        // if((source.energy+100)/source.energyCapacity>(source.ticksToRegeneration||300)/300&&source.energy){
        if (source.energy == 0) {
            this.popTask();
            return;
        }
        this.harvest(source);
        // }

        if (this.ticksToLive % 4 == 0) {
            //捡起掉落的能量
            let dropEnergy = this.pos.lookFor(LOOK_ENERGY).head();
            if (dropEnergy) this.pickup(dropEnergy);
            //捡起尸体的能量
            let tombstone = this.pos.lookFor(LOOK_TOMBSTONES).head();
            if (tombstone) this.withdraw(tombstone, RESOURCE_ENERGY);
            //捡起container的能量
        }
    }
};

/** 预定 */
Creep.prototype.reserveOuterHar = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let controller = this.headTaskObj();
        if (controller && controller.reservation && controller.reservation.username != WHO_AM_I) {
            if (this.attackController(controller) == ERR_NOT_IN_RANGE) {
                this.moveTo(controller)
            }
        }
        else if (controller && this.reserveController(controller) == ERR_NOT_IN_RANGE) {
            this.moveTo(controller)
        }
    }
    this.memory.dontPullMe = this.ticksToLive % 3 != 0//给爬让路
}

Creep.prototype.registerStationSourcesCarryOutRoom = function () {
    // let rm = Memory.rooms[this.memory["roomName"]];
    let headTask = this.headTask();
    let rm = Memory.rooms[headTask.roomName];
    if (rm && rm[pro.stationName] && rm[pro.stationName][headTask.id]) {
        let source = rm[pro.stationName][headTask.id];
        let rmHarList = source["carryCreeps"] || [];
        let alive = rmHarList.filter(id => Game.getObjectById(id));
        if (alive.length != rmHarList.length) source["carryCreeps"] = alive;
        if (!alive.contains(this.id))
            alive.push(this.id)
    }
};

/** 防御 */
Creep.prototype.outerDefense = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let target = Game.getObjectById(this.memory.targetId);
        if (this.memory.targetId && !target) delete this.memory.targetId;
        if (!this.memory.targetId) {
            target = this.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
            if (!target) target = this.room.find(FIND_HOSTILE_STRUCTURES).filter(e => e.structureType == STRUCTURE_INVADER_CORE).head();
            if (target) this.memory.targetId = target.id;
        }
        let em = Game.getObjectById(this.memory.targetId);
        if (em) {
            if (this.attack(em) == ERR_NOT_IN_RANGE) {
                this.moveTo(em)
                this.heal(this)
            }
            this.rangedAttack(em)
            return;
        }
        // let injuredCreep =  this.findC(FIND_MY_CREEPS).filter(e=>e.hits!=e.hitsMax).head();
        let injuredCreep = this.pos.findClosestByPath(FIND_MY_CREEPS, { filter: e => e.hits != e.hitsMax })
        if (this.heal(injuredCreep) == ERR_NOT_IN_RANGE) {
            this.moveTo(injuredCreep)
            this.memory.dontPullMe = true;
        }
        if (injuredCreep && injuredCreep.name !== this.name) return;
        this.memory.dontPullMe = false;

        // move to the source keeper lair with the least spawn time
        let sourceKeeper = this.room.find(FIND_HOSTILE_STRUCTURES).filter(e => e.structureType == STRUCTURE_KEEPER_LAIR).sort((a, b) => a.ticksToSpawn - b.ticksToSpawn).head();
        if (sourceKeeper) {
            this.moveTo(sourceKeeper)
            return;
        }

        let mineral = this.headTaskObj();
        if (mineral && !this.pos.inRangeTo(mineral, 3)) {
            this.moveTo(mineral)
        }
    }
};
Creep.prototype.registerStationSourcesDefenseOutRoom = function () {
    // let rm = Memory.rooms[this.memory["roomName"]];
    let rm = Memory.rooms[this.headTask().roomName];
    if (rm && rm[pro.stationName] && rm[pro.stationName][this.headTask().id]) {
        let source = rm[pro.stationName][this.headTask().id];
        let rmHarList = source["defenseCreeps"] || [];
        let alive = rmHarList.filter(id => Game.getObjectById(id));
        if (alive.length != rmHarList.length) source["defenseCreeps"] = alive;
        if (!alive.contains(this.id))
            alive.push(this.id)
    }
};


/** 搬运修路策略 */
Creep.prototype.harvestEnergyOuterCarryRoadBuilder = function () {
    let task = this.lastTask();
    let target = this.lastTaskObj();
    let data = task.mineRoom && Memory.rooms[task.mineRoom]
        && Memory.rooms[task.mineRoom][pro.stationName]
        && Memory.rooms[task.mineRoom][pro.stationName][task.stationId];
    let complete = !data || pro.outerRoadComplete(data);
    // 到达端点：修完（或非 keepBuilding 模式）则结束；未修完则掉头继续修
    if (this.pos.isNearTo(target) || this.store[RESOURCE_ENERGY] == 0) {
        this.popTask();
        if (task.keepBuilding && this.store[RESOURCE_ENERGY] > 0 && data) {
            // 确定完成后再退出：端点强制刷新完成度检查
            complete = pro.outerRoadComplete(data, true);
            if (!complete) {
                let nextTarget = task.roadDir == 1 ? pro.getOuterMineTarget(data) : this.mainRoom().storage;
                if (nextTarget) this.addTask(UtilsTask.task(nextTarget, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                    mineRoom: task.mineRoom,
                    stationId: task.stationId,
                    keepBuilding: true,
                    roadDir: task.roadDir == 1 ? -1 : 1,
                }));
            }
        }
        this.execLastTask();
        return;
    }
    let canBuild = this.getPartCnt(WORK) > 0 && this.getActiveBodyparts(WORK) > 0;
    // 规划路径：固定路线修路，路点索引增量推进（O(1)，不每 tick 全路径扫描）
    let roadPath = data && pro.getOuterRoadPath(data);
    if (roadPath && roadPath.length) {
        let pathIndex = task.pathIndex;
        if (pathIndex == undefined) pathIndex = task.roadDir == 1 ? 0 : roadPath.length - 1;
        let wp = roadPath[Math.max(0, Math.min(pathIndex, roadPath.length - 1))];
        let dist = wp.roomName == this.pos.roomName ? Math.max(Math.abs(wp.x - this.pos.x), Math.abs(wp.y - this.pos.y)) : 999;
        if (dist > 2) {
            // 偏离路径（或路径刚重算）：重新定位到最近路点
            pathIndex = pro.nextRoadPathIndex(roadPath, this.pos).index;
        } else if (dist <= 1) {
            pathIndex += task.roadDir; // 到达当前路点，前进
        }
        pathIndex = Math.max(0, Math.min(pathIndex, roadPath.length - 1));
        task.pathIndex = pathIndex;
        wp = roadPath[pathIndex];
        // 修当前脚下的路
        if (canBuild && !this.pos.isBorder()) {
            let blocked = this.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType != STRUCTURE_ROAD);
            if (!blocked) {
                let road = this.pos.lookFor(LOOK_STRUCTURES).filter(e => e.structureType == STRUCTURE_ROAD).head();
                if (road) {
                    if (road.hits < road.hitsMax / 10 * 9) {
                        this.$repair(road)
                    }
                } else {
                    let cs = this.pos.lookFor(LOOK_CONSTRUCTION_SITES).filter(e => e.structureType == STRUCTURE_ROAD).head();
                    if (cs) {
                        this.$build(cs)
                    } else if (this.ticksToLive > 300 && !pro.roadBlockedByBlueprint(this.pos)
                        && !this.pos.lookFor(LOOK_CONSTRUCTION_SITES).length) {
                        this.pos.createConstructionSite(STRUCTURE_ROAD)
                    }
                }
            }
        }
        let code = this.moveTo(new RoomPosition(wp.x, wp.y, wp.roomName), { range: 0, reusePath: 20, visualizePathStyle: { stroke: '#fffa00' } });
        if (code == ERR_NO_PATH || code == ERR_NO_BODYPART) {
            // 应急：路径不可达（被建筑堵死等），失效缓存退回旧逻辑
            if (data) {
                delete data.roadPathStr;
                delete data.roadPathTick;
            }
            this.moveTo(target, { visualizePathStyle: { stroke: '#fffa00' } })
        }
        return;
    }
    // 无规划路径（应急）：旧行为，走到哪修到哪
    if (canBuild && !this.pos.isBorder()) {
        let road = this.pos.lookFor(LOOK_STRUCTURES).filter(e => e.structureType == STRUCTURE_ROAD).head();
        if (!road) {
            road = this.pos.lookFor(LOOK_CONSTRUCTION_SITES).filter(e => e.structureType == STRUCTURE_ROAD).head();
            if (!road && this.ticksToLive > 300) {
                this.pos.createConstructionSite(STRUCTURE_ROAD)
            } else if (road) {
                this.$build(road)
            } else {
                this.moveTo(target, { visualizePathStyle: { stroke: '#fffa00' } })
            }
        } else if (road) {
            if (road.hits < road.hitsMax / 10 * 9) {
                this.$repair(road)
            }
            if (road.hits > road.hitsMax / 10 * 8)
                this.moveTo(target, { visualizePathStyle: { stroke: '#fffa00' } })
        }
    } else {
        this.moveTo(target, { visualizePathStyle: { stroke: '#fffa00' } })
    }
}

/** 搬运策略 */
Creep.prototype.harvestEnergyOuterCarry = function () {
    let task = this.headTask();
    let rm = Memory.rooms[this.headTask().roomName];
    if (rm && rm[pro.stationName] && rm[pro.stationName][this.headTask().id]) {
        if (task.roomName != this.room.name) {
            this.goTo(task);
        } else {
            let sm = rm[pro.stationName][this.headTask().id];
            let harCreep = Game.getObjectById(sm["creeps"][0])
            let container = Game.getObjectById(sm[STRUCTURE_CONTAINER]);
            if (harCreep && container && harCreep.pos.isNearTo(container) || this.pos.isBorder()) { // 挖矿爬就位才动，避免堵路 ，如果自己在边界的地方也不能停下，两个在一起直接堵路
                if (!this.pos.isNearTo(container)) {
                    this.goTo(container)
                }
                if (container && container.store[RESOURCE_ENERGY] >= this.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    let code = this.withdraw(container, RESOURCE_ENERGY)
                    if (code == ERR_NOT_IN_RANGE)
                        this.moveTo(container)
                }
                else if (container && container.store[RESOURCE_ENERGY] != container.store.getUsedCapacity()) { // add by an_w
                    let ResType = Object.keys(container.store).filter(e => e != RESOURCE_ENERGY).head()
                    if (ResType) {
                        let code = this.withdraw(container, ResType)
                        if (code == ERR_NOT_IN_RANGE)
                            this.moveTo(container)
                    }
                }
            }
        }
    }

    if (this.ticksToLive % 4 == 0) {
        let tombstone = this.pos.lookFor(LOOK_TOMBSTONES).filter(e => e.store[RESOURCE_ENERGY] > 0).head();
        if (tombstone) {
            this.withdraw(tombstone, RESOURCE_ENERGY)
        }
        let dropEnergy = this.pos.lookFor(LOOK_ENERGY).head();
        if (dropEnergy) {
            this.pickup(dropEnergy);
        }
    }
    if (this.store[RESOURCE_ENERGY] * 2 > this.store.getCapacity(RESOURCE_ENERGY)) {
        let data = task.roomName && task.id
            ? (Memory.rooms[task.roomName] && Memory.rooms[task.roomName][pro.stationName]
                && Memory.rooms[task.roomName][pro.stationName][task.id]) : undefined;
        if (data && !pro.outerRoadComplete(data)) {
            // 道路未修好：只修路不搬运，沿路径来回修整直到完整
            this.addTask(UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.roomName, stationId: task.id, keepBuilding: true, roadDir: 1,
            }));
        } else {
            let roadTask = [
                UtilsTask.task(this.mainRoom().storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
                UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, { mineRoom: task.roomName, stationId: task.id }) //想致富先修路
            ]
            this.addTask(roadTask);
        }
        // this.execLastTask();
    }
}



let outerMaxPartCnt = 3
let innerMaxPartCnt = 3
let saveCpuLevel = 8
if (isSaveCpu) innerMaxPartCnt = 13
if (Game.shard.name == '6g3y-station') innerMaxPartCnt = 14
if (Game.shard.name == '6g3y-station') saveCpuLevel = 7


let pro = {
    stationName: "stationSources",
    getHarvesterBodyConfig(energy, isOutRoom, level, data) {
        let regPerTick = 10; // 每tick+10的能量
        if (data["lastPowerTime"] + 3000 > Game.time)
            regPerTick += data["lastPowerLevel"] * 50 / 15 // power了
        // log(regPerTick,Math.max(Math.ceil(regPerTick+0.1)/2,innerMaxPartCnt))
        let maxPart = isOutRoom ? outerMaxPartCnt : Math.max(Math.ceil(regPerTick / 4 + 0.1), innerMaxPartCnt);
        if (level < saveCpuLevel && isSaveCpu) maxPart = 4;
        let current = 0;
        let cost = BODYPART_COST[WORK] * 2 + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy - BODYPART_COST[CARRY] * Math.ceil(num / 5)) {// 超过 10个 work 加一个 carry
            num += 1;
            current += cost
            if (num >= maxPart) break;
        }
        let carryCnt = Math.min(2, Math.ceil(num / 5))
        if (num > 10 && num == innerMaxPartCnt) carryCnt = Math.min(8, 50 - num * 3)
        return ManagerCreeps.calcBodyPart({ [MOVE]: num, [WORK]: num * 2, [CARRY]: carryCnt });
    },
    getMineralHarvesterBodyConfig(energy) {
        return ManagerCreeps.calcBodyPart({ [MOVE]: 15, [WORK]: 30, [CARRY]: 4 });
    },
    getReverserBodyConfig(energy) {
        let current = 0;
        let cost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy) {
            num += 1;
            current += cost
            if (num >= 8) break;
        }
        return ManagerCreeps.calcBodyPart({ [MOVE]: num, [CLAIM]: num });
    },
    getOuterHarCarrierBodyConfig(energy, maxPart) {
        let current = 0;
        let cost = BODYPART_COST[CARRY] * 2 + BODYPART_COST[MOVE];
        let baseCost = BODYPART_COST[WORK] + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy - baseCost) {// 超过 10个 work 加一个 carry
            num += 1;
            current += cost
            if (num >= 17 || maxPart / 2 < num) break;
        }
        return ManagerCreeps.calcBodyPart({ [CARRY]: num < 17 ? num * 2 : num * 2 - 1, [MOVE]: num });
    },
    getOuterHarCarrierBuildBodyConfig(energy, maxPart) {
        let current = 0;
        let cost = BODYPART_COST[CARRY] * 2 + BODYPART_COST[MOVE];
        let baseCost = BODYPART_COST[WORK] + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy - baseCost) {// 超过 10个 work 加一个 carry
            num += 1;
            current += cost
            if (num >= 17 || maxPart / 2 < num) break;
        }
        return ManagerCreeps.calcBodyPart({ [WORK]: 2, [CARRY]: (num < 17 ? num * 2 : num * 2 - 1) - 2, [MOVE]: num });
    },
    getOuterHarDefenseBodyConfig(isInvader) {
        if (isInvader) return ManagerCreeps.calcBodyPart({ [MOVE]: 17, [ATTACK]: 22, [HEAL]: 11 });
        return ManagerCreeps.calcBodyPart({ [ATTACK]: 9, [MOVE]: 10, [HEAL]: 1 });
    },
    generatorHarTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestEnergyKeeper", "registerStationSources")
        ]
    },
    generatorOuterHarTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestEnergyOuterKeeper", "registerStationSources")
        ]
    },
    generatorOuterMineTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestMineralOuterKeeper", "registerStationSources")
        ]
    },
    generatorOuterHarCarryTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestEnergyOuterCarry", "registerStationSourcesCarryOutRoom")
        ]
    },
    /**
     * 蓝图位置归一化：structMap 值为编码字符串或 [[x,y]] 数组
     */
    structMapPositions(value) {
        if (typeof value == 'string') return Utils.decodePosArray(value);
        if (Array.isArray(value)) return value;
        return [];
    },
    /**
     * 外矿修路路径：从矿区容器到主房间 storage 一次性寻路，
     * 主房间按蓝图路网走（规划的其他建筑不可走），结果以 serializePath
     * 紧凑序列化存储，1000 tick 重算一次
     */
    ensureOuterRoadPath(data, spawnRoom) {
        if (data.roadPathStr && data.roadPathTick && Game.time - data.roadPathTick < 1000) return pro.getOuterRoadPath(data);
        let from = Game.getObjectById(data.container);
        from = from ? from.pos : new RoomPosition(data.x, data.y, data.roomName);
        let to = spawnRoom.storage ? spawnRoom.storage.pos : (spawnRoom.terminal ? spawnRoom.terminal.pos : undefined);
        if (!from || !to) return undefined;
        let ret = PathFinder.search(from, to, {
            plainCost: 1,
            swampCost: 5,
            maxRooms: 4,
            range: 1,
            roomCallback(roomName) {
                let room = Game.rooms[roomName];
                let cm = new PathFinder.CostMatrix();
                let terrain = Game.map.getRoomTerrain(roomName);
                for (let y = 0; y < 50; y++) {
                    for (let x = 0; x < 50; x++) {
                        let t = terrain.get(x, y);
                        cm.set(x, y, t == TERRAIN_MASK_WALL ? 255 : (t == TERRAIN_MASK_SWAMP ? 5 : 1));
                    }
                }
                if (room) {
                    // 主房间蓝图：沿规划路网走，规划的其他建筑视为不可走
                    let structMap = room.memory && room.memory.structMap;
                    if (structMap) {
                        for (let type in structMap) {
                            let cost = (type == 'road' || type == 'container') ? 1 : 255;
                            pro.structMapPositions(structMap[type]).forEach(p => {
                                let x = p.x != undefined ? p.x : p[0];
                                let y = p.y != undefined ? p.y : p[1];
                                if (cm.get(x, y) < 254) cm.set(x, y, cost);
                            });
                        }
                    }
                    // 已有建筑：路/容器/己方墙/链接可走，其余不可走
                    room.getStructures().forEach(s => {
                        let walkable = s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER
                            || (s.structureType == STRUCTURE_RAMPART && s.my) || s.structureType == STRUCTURE_LINK;
                        if (!walkable) cm.set(s.pos.x, s.pos.y, 255);
                    });
                }
                return cm;
            },
        });
        if (ret && ret.path && ret.path.length > 1) {
            data.roadPathStr = Room.serializePath(ret.path);
            data.roadPathTick = Game.time;
            delete data.roadPath;
            return pro.getOuterRoadPath(data);
        }
        return undefined;
    },
    /** 读取外矿路径：反序列化结果按 tick 全局缓存，多只爬共享 */
    getOuterRoadPath(data) {
        let str = data.roadPathStr;
        if (!str && data.roadPath) {
            // 旧格式（对象数组）迁移为序列化字符串
            try { str = data.roadPathStr = Room.serializePath(data.roadPath.map(p => new RoomPosition(p.x, p.y, p.roomName))); } catch (e) {}
            delete data.roadPath;
        }
        if (!str) return undefined;
        let cache = global._outerRoadPathCache = global._outerRoadPathCache || {};
        let key = data.roomName + ":" + data.id;
        let c = cache[key];
        if (!c || c.tick != Game.time) {
            cache[key] = c = { tick: Game.time, path: Room.deserializePath(str) };
        }
        return c.path;
    },
    /** 路径上离当前位置最近的路点 */
    nextRoadPathIndex(roadPath, pos) {
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < roadPath.length; i++) {
            let wp = roadPath[i];
            let dist = wp.roomName == pos.roomName ? Math.max(Math.abs(wp.x - pos.x), Math.abs(wp.y - pos.y)) : 999;
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return { index: best, dist: bestDist };
    },
    /** 矿区目标（修路端点）：容器优先，否则源点 */
    getOuterMineTarget(data) {
        let container = Game.getObjectById(data.container);
        return container ? container : new RoomPosition(data.x, data.y, data.roomName);
    },
    /**
     * 外矿道路是否完整：路径上每个可修路的位置都已有 road。
     * 每 10 tick 检查一次并缓存；force 强制刷新；有房间不可见时视为未完成（不搬运）。
     */
    outerRoadComplete(data, force) {
        if (!force && data.roadCompleteTick && Game.time - data.roadCompleteTick < 10) return data.roadComplete;
        data.roadCompleteTick = Game.time;
        let path = pro.getOuterRoadPath(data);
        if (!path || !path.length) { data.roadComplete = false; return false; }
        for (let p of path) {
            let room = Game.rooms[p.roomName];
            if (!room) { data.roadComplete = false; return false; }
            let structures = room.lookForAt(LOOK_STRUCTURES, p.x, p.y);
            if (structures.find(s => s.structureType == STRUCTURE_ROAD)) continue; // 已有路
            if (structures.find(s => s.structureType != STRUCTURE_ROAD)) continue; // 被建筑占位（容器等），无需修路
            data.roadComplete = false;
            return false;
        }
        data.roadComplete = true;
        return true;
    },
    /** 蓝图保护：该位置规划了非道路建筑则不修路 */
    roadBlockedByBlueprint(pos) {
        let room = Game.rooms[pos.roomName];
        if (!room || !room.memory || !room.memory.structMap) return false;
        if (!room._plannedBlockedSet) {
            room._plannedBlockedSet = new Set();
            for (let type in room.memory.structMap) {
                if (type == 'road' || type == 'container') continue;
                pro.structMapPositions(room.memory.structMap[type]).forEach(p => {
                    room._plannedBlockedSet.add((p.x != undefined ? p.x : p[0]) + ":" + (p.y != undefined ? p.y : p[1]));
                });
            }
        }
        return room._plannedBlockedSet.has(pos.x + ":" + pos.y);
    },
    /**
     * 外矿道路维护：只保留路径上的一条路，删除历史遗留的多余道路
     * - 矿区房间：删除所有不在路径上的己方 road（该房间没有蓝图，路都是我们建的）
     * - 主房间：只删除紧邻路径走廊（range<=2）且不在蓝图路网里的己方 road，
     *   避免误删通向其他建筑/其他外矿的路
     */
    maintainOuterRoads(data, spawnRoom) {
        if (data.lastRoadMaintain && Game.time - data.lastRoadMaintain < 100) return;
        data.lastRoadMaintain = Game.time;
        let path = pro.getOuterRoadPath(data);
        if (!path || !path.length) return;
        let pathRoads = new Set();
        let pathTilesByRoom = {};
        path.forEach(p => {
            pathRoads.add(p.roomName + ":" + p.x + ":" + p.y);
            (pathTilesByRoom[p.roomName] = pathTilesByRoom[p.roomName] || []).push(p);
        });
        let mineRoomName = data.roomName;
        [mineRoomName, spawnRoom.name].forEach(roomName => {
            let room = Game.rooms[roomName];
            if (!room) return;
            let plannedRoads = new Set();
            let structMap = room.memory && room.memory.structMap;
            if (structMap) {
                pro.structMapPositions(structMap.road).forEach(p => plannedRoads.add((p.x != undefined ? p.x : p[0]) + ":" + (p.y != undefined ? p.y : p[1])));
            }
            let pathTiles = pathTilesByRoom[roomName];
            let isMainRoom = roomName == spawnRoom.name;
            room.getStructures().filter(s => s.structureType == STRUCTURE_ROAD && s.my).forEach(road => {
                let key = road.pos.roomName + ":" + road.pos.x + ":" + road.pos.y;
                if (pathRoads.has(key)) return; // 路径上的路保留
                if (plannedRoads.has(road.pos.x + ":" + road.pos.y)) return; // 蓝图里的路保留
                if (isMainRoom && pathTiles) {
                    let near = pathTiles.some(t => Math.max(Math.abs(t.x - road.pos.x), Math.abs(t.y - road.pos.y)) <= 2);
                    if (!near) return; // 远离走廊的路不动
                }
                road.destroy();
            });
        });
    },
    generatorOuterHarDefenseTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "outerDefense", "registerStationSourcesDefenseOutRoom")
        ]
    },
    /**
     * 返回1-2个 任务，注意！
     * @param roomName
     * @param minEnergy
     * @return {[undefined]}
     */
    generatorCarryEnergyTask(roomName, minEnergy = 1200) {
        let rm = Memory.rooms[roomName.name || roomName];
        let room = Game.rooms[roomName.name || roomName]
        room.used = room.used || {}
        let tasks = [];
        if (rm) {
            if (room.level == 8) minEnergy = 1600
            let maxContainerEnergyCnt = 0;
            for (let resm of _.values(rm[pro.stationName])) {
                let container = Game.getObjectById(resm["container"]);
                if (container && container.store[RESOURCE_ENERGY] > maxContainerEnergyCnt)
                    maxContainerEnergyCnt = container.store[RESOURCE_ENERGY]
                if (container && container.store[RESOURCE_ENERGY] > minEnergy && !room.used[container.id]) {
                    tasks.push([UtilsTask.task(container, "carryRes", "registerStationSourcesCarryInRoom", {
                        resType: RESOURCE_ENERGY
                    })])
                }
            }
        }
        return tasks;
    },
    generatorCarryEnergyFromLinkTask(roomName, minEnergy = 1200) {
        let rm = Memory.rooms[roomName.name || roomName];
        let room = Game.rooms[roomName.name || roomName]
        let tasks = [];
        if (rm) {
            let needCarry = 0;
            for (let resm of _.values(rm[pro.stationName])) {
                let container = Game.getObjectById(resm["container"]);
                let link = Game.getObjectById(resm["link"]);
                let link2 = Game.getObjectById(resm["link2"]);

                if (!needCarry) {
                    needCarry = (container && container.store[RESOURCE_ENERGY]) > ((link && link2 && (link.store.isFull() && link2.store.isFull())) ? 0 : 800)
                }
            }
            let centerLink = Game.getObjectById(rm[StationCarry.stationName][STRUCTURE_LINK]);
            if (needCarry && centerLink && !centerLink.store.isEmpty() && !room.used[centerLink.id]) {
                if (room.storage) tasks.push([
                    UtilsTask.task(room.storage, "fillRes", "registerStationSourcesCarryInRoom", { resType: RESOURCE_ENERGY }),
                    UtilsTask.task(centerLink, "carryRes", "registerStationSourcesCarryInRoom", { resType: RESOURCE_ENERGY }),
                ])
                else tasks.push([
                    UtilsTask.task(centerLink, "carryRes", "registerStationSourcesCarryInRoom", { resType: RESOURCE_ENERGY })
                ])
            }
        }
        return tasks;
    },
    generatorReleaseAbleHarTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestEnergy")
        ]
    },
    trySpawnHarKeeper(room) {
        if (room.spawnFailure) return null;
        pro.trySpawnOuterHarKeeper(room.name, room);
    },
    trySpawnOuterHarKeeper(roomName, spawnRoom) {
        if (spawnRoom.spawnFailure) return null;
        // log(roomName,spawnRoom.name)
        if (roomName == spawnRoom.name
            && spawnRoom.creeps("harvestEnergyKeeper").filter(e => e.ticksToLive > 300).length
            && spawnRoom.creeps("carrier").filter(e => e.ticksToLive > 300).length == 0) return; // 如果低等级低，有存在har 并且没有搬运的时候，优先生搬运的，避免一直挖而没有搬运的
        delete Memory.rooms[roomName][StationSources.stationName]["undefined"]

        for (let k in Memory.rooms[roomName][StationSources.stationName])
            if (!Memory.rooms[roomName][StationSources.stationName][k]) delete Memory.rooms[roomName][StationSources.stationName][k]

        _.values(Memory.rooms[roomName][StationSources.stationName]).forEach(data => {
            // 如果两个多个连在一起死掉一个
            let harCreeps = data["creeps"].map(e => Game.getObjectById(e)).filter(e => e && e.ticksToLive)
            harCreeps.forEach(a => {
                harCreeps.forEach(b => {
                    if (a.id != b.id && a.pos.isNearTo(b)) {
                        if (a.ticksToLive < b.ticksToLive) a.suicide(); else b.suicide();
                    }
                })
            })

            // 清理死掉的creeps
            data["creeps"] = data["creeps"].filter(e => Game.getObjectById(e))

            if (data["id"] && (Game.time - data["spawnTime"] > 1500 || data["creeps"].length == 0)) {
                let harBody = StationSources.getHarvesterBodyConfig(spawnRoom.getEnergyCapacityAvailable(), roomName != spawnRoom.name, spawnRoom.level, data)
                let tasks = (roomName == spawnRoom.name) ? StationSources.generatorHarTask(data) : StationSources.generatorOuterHarTask(data)
                StationHive.trySpawn(spawnRoom, spawnRoom.name, harBody, "harvestEnergyKeeper", tasks)
            }
        });
    },
    trySpawnOuterMineralKeeper(roomName, spawnRoom) {
        if (spawnRoom.spawnFailure) return null;
        let harRoom = Game.rooms[roomName.name || roomName];
        if (!harRoom) return;
        let data = Memory.rooms[roomName][StationMineral.stationName];
        /** 
            @type {Mineral}
        */
        let mineral = Game.getObjectById(data["id"]);
        let container = Game.getObjectById(data["container"]);
        if (!container) {
            // find construction site near the mineral
            let constructionSite = harRoom.constructionSite ? harRoom.constructionSite.filter(e => e.pos.isNearTo(mineral)).head() : undefined;
            if (!constructionSite) {
                // create construction site near to the mineral and not the TerrainWall
                let pos = mineral.pos;
                const terrian = new Room.Terrain(harRoom.name);
                for (let x = pos.x - 1; x <= pos.x + 1; x++) {
                    for (let y = pos.y - 1; y <= pos.y + 1; y++) {
                        if (terrian.get(x, y) != TERRAIN_MASK_WALL) {
                            harRoom.createConstructionSite(x, y, STRUCTURE_CONTAINER);
                        }
                    }
                }
            }
            else if (harRoom.creeps('worker', false).length == 0) {
                // if the construction site is exist, then spawn a worker to build it
                let workerBody = StationWork.getLowLevelWorkerBodyConfig(spawnRoom)
                StationHive.trySpawn(spawnRoom, spawnRoom.name, workerBody, "worker", [])
            }
        }
        if (mineral && mineral.mineralAmount > 0 && container) {
            let harCreeps = spawnRoom.creeps("harvestMineralOuterKeeper", false).filter(e => e.headTask().roomName == harRoom.name)
            if (harCreeps.length == 0) {
                let harBody = pro.getMineralHarvesterBodyConfig(spawnRoom.getEnergyCapacityAvailable())
                let tasks = pro.generatorOuterMineTask(data)
                StationHive.trySpawn(spawnRoom, spawnRoom.name, harBody, "harvestMineralOuterKeeper", tasks)
            }
        }
    },
    trySpawnOuterHarCarrier(roomName, spawnRoom) {
        if (spawnRoom.spawnFailure) return null;
        let harRoom = Game.rooms[roomName.name || roomName]
        if (!harRoom) return;
        let sm = harRoom.memory[pro.stationName]
        _.values(sm).forEach(data => {
            let pathTime = data["pathTime"];
            let container = Game.getObjectById(data["container"]);
            // 预先计算并缓存固定修路路径（一次性寻路，避免多个修路爬各走各的路线）
            pro.ensureOuterRoadPath(data, spawnRoom);
            if (pathTime && container) {
                data["carryCreeps"] = data["carryCreeps"] || []
                data["carryCreeps"] = data["carryCreeps"].filter(e => Game.getObjectById(e))
                let carrierCreeps = data["carryCreeps"].map(e => Game.getObjectById(e)).filter(e => e && (!e.ticksToLive || e.ticksToLive > e.body.length * 3))
                let carrierBuildCreep = carrierCreeps.filter(e => e.getPartCnt(WORK) > 0).head()
                let EnergyPerTick = 10;
                let NeedCarryPartCnt = Math.ceil(pathTime * 2 * EnergyPerTick / 50) // 来回*2 每个要的tick数量
                let CarryPartCnt = NeedCarryPartCnt - 2 // 两个被换成 work了
                carrierCreeps.forEach(e => CarryPartCnt -= e.getPartCnt(CARRY))
                let maxPart = Math.ceil(NeedCarryPartCnt / Math.ceil(NeedCarryPartCnt / 33)) // 每个 最大32 part 计算每只的数量
                let isNearToAny = carrierCreeps.filter(e => e.pos.isNearTo(container)).head()
                if (CarryPartCnt > 0 && !isNearToAny) {
                    let carrierBody = carrierBuildCreep ?
                        pro.getOuterHarCarrierBodyConfig(spawnRoom.getEnergyCapacityAvailable(), maxPart)
                        : pro.getOuterHarCarrierBuildBodyConfig(spawnRoom.getEnergyCapacityAvailable(), maxPart) // 如果没修路的造一个
                    let tasks = pro.generatorOuterHarCarryTask(data)
                    StationHive.trySpawn(spawnRoom, spawnRoom.name, carrierBody, "outerHarvestEnergyCarrier", tasks)
                }
            }
        })
    },
    trySpawnOuterDefenser(roomName, spawnRoom, isInvader) {
        if (spawnRoom.spawnFailure) return null;
        let harRoom = Game.rooms[roomName.name || roomName]
        let data = Memory.rooms[roomName.name || roomName][StationMineral.stationName];
        if (isInvader) {
            let defensers = spawnRoom.creeps("outerHarvestDefenser", false).filter(e => e.headTask().roomName == (roomName.name || roomName))
            let defenser = defensers.head()
            if (defenser && defenser.ticksToLive > 170 && !defenser.memory.hasSendSpawn && defensers.length > 1) return;
            let carrierBody = pro.getOuterHarDefenseBodyConfig(isInvader)
            let tasks = pro.generatorOuterHarDefenseTask(data)
            StationHive.trySpawn(spawnRoom, spawnRoom.name, carrierBody, "outerHarvestDefenser", tasks)
            defenser.memory.hasSendSpawn = true
            return;
        }
        if (!harRoom) return;
        let em = harRoom.find(FIND_HOSTILE_CREEPS).head();
        if (!em) em = harRoom.find(FIND_HOSTILE_STRUCTURES).filter(e => e.structureType == STRUCTURE_INVADER_CORE || e.structureType == STRUCTURE_KEEPER_LAIR).head();
        if (em) {
            let defenser = spawnRoom.creeps("outerHarvestDefenser", false).filter(e => e.headTask().roomName == harRoom.name).head()
            if (defenser) return;
            let carrierBody = pro.getOuterHarDefenseBodyConfig(isInvader)
            let tasks = pro.generatorOuterHarDefenseTask(data)
            StationHive.trySpawn(spawnRoom, spawnRoom.name, carrierBody, "outerHarvestDefenser", tasks)
        }
    },
    powerSource(room, source, level) {
        let tmp = room.memory[pro.stationName] = room.memory[pro.stationName] || {};
        if (source.id && !tmp[source.id]) tmp[source.id] = {};
        tmp[source.id]["lastPowerTime"] = Game.time;
        tmp[source.id]["lastPowerLevel"] = level;
    },
    sourcePathTime(room, source) {
        let tmp = room.memory[pro.stationName] = room.memory[pro.stationName] || {};
        if (source.id && !tmp[source.id]) tmp[source.id] = {};
        return tmp[source.id]["pathTime"] || 50;
    },
    update(room) {
        let sources = room[LOOK_SOURCES];
        let usedContainer = {};
        let tmp = room.memory[pro.stationName] = room.memory[pro.stationName] || {};

        sources.forEach(e => {
            if (!tmp[e.id]) tmp[e.id] = tmp[e.id] || {};
            /** todo 更新寻找的算法 */
            let container = Game.getObjectById(tmp[e.id]["container"])
            if (!container) container = room[STRUCTURE_CONTAINER].filter(c => c.pos.isNearTo(e) && !usedContainer[c.id]).head();
            let links = [];
            if (container) {
                links = room[STRUCTURE_LINK].filter(e => container.pos.isNearTo(e) && !usedContainer[container.id]);
            }
            tmp[e.id]["roomName"] = e.room.name;
            tmp[e.id]["id"] = e.id;
            tmp[e.id]["x"] = e.pos.x;
            tmp[e.id]["y"] = e.pos.y;
            tmp[e.id]["creeps"] = tmp[e.id]["creeps"] || [];
            tmp[e.id]["spawnTime"] = tmp[e.id]["spawnTime"] || 0;
            tmp[e.id]["pathTime"] = tmp[e.id]["pathTime"] || undefined;
            tmp[e.id]["container"] = container ? container.id : undefined;
            tmp[e.id]["link"] = links[0] ? links[0].id : undefined;
            tmp[e.id]["link2"] = links[1] ? links[1].id : undefined;
        });
    },

};



global.StationSources = pro;
