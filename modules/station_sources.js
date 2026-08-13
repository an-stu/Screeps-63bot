


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
        if (!alive.contains(this.id)) alive.push(this.id)
        source["creeps"] = alive; // 必须始终写回：新 id 的注册不能丢
    }
};


Creep.prototype.registerStationSourcesCarryInRoom = function () {
    let room = Game.rooms[this.memory["roomName"]]
    if (!room) return;
    room.used = room.used || {}
    room.used[this.headTask().id] = true
    // 活跃任务会在每 tick 注册到 room.used；无需把认领关系持久化到
    // Memory。顺便清除早期版本遗留的两种认领表。
    if (room.memory._carryClaim) delete room.memory._carryClaim;
    if (room.memory[pro.stationName] && room.memory[pro.stationName]._carryClaim) {
        delete room.memory[pro.stationName]._carryClaim;
    }
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
        // 去程沿缓存路径走（路径方向 source→storage，去程是反向 -1），不脱离路线
        let data = Memory.rooms[task.roomName] && Memory.rooms[task.roomName][pro.stationName]
            && Memory.rooms[task.roomName][pro.stationName][task["id"]];
        if (!pro.moveOuterCarrierOnRoad(this, task, data, -1)) this.goTo(task);
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
        // 站在容器上挖矿：store 满后的溢出能量自动进入脚下容器（Screeps
        // 机制），无需 transfer。若容器被占只能站旁边，则仍手动 transfer
        // 兜底，避免能量滞留 keeper 身上/掉地上
        if (container && this.store[RESOURCE_ENERGY] > 0) {
            if (container.hits < container.hitsMax * 0.95 && this.ticksToLive % 3 == 0) {
                this.repair(container);
            }
            if (!this.pos.isEqualTo(container)) {
                this.transfer(container, RESOURCE_ENERGY);
            }
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
        return;
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
        // link2 是双 link 房间才有的（少数），缺失时跳过查询省 getObjectById
        let link2 = station["link2"] ? Game.getObjectById(station["link2"]) : undefined;
        if (!link && link2) link = link2;
        if (link && link2 && (link.store.getUsedCapacity(RESOURCE_ENERGY) > link2.store.getUsedCapacity(RESOURCE_ENERGY)) && link.store[RESOURCE_ENERGY] == 800) link = link2
        if (container && !container.pos.isEqualTo(this)) {
            let occupied = container.pos.lookFor(LOOK_CREEPS).length > 0
                || container.pos.lookFor(LOOK_POWER_CREEPS).length > 0;
            if (!occupied) {
                // 站到容器上：creep 站在 container 上挖矿时，store 满后的溢出
                // 能量自动进入脚下的容器（Screeps 机制），无需每 tick transfer。
                this.moveTo(container, { range: 0, visualizePathStyle: { stroke: '#67ffed' } });
                return;
            }
            // 容器被占（worker 顶替挖矿/carrier 站脚）时不能只满足"挨着容器"——
            // 那可能离 source 太远挖不到（(10,5) 卡死事件）。改为直接站到
            // source 相邻格，保证能挖矿。
            if (source && !source.pos.isNearTo(this)) {
                this.moveTo(source, { range: 1, visualizePathStyle: { stroke: '#67ffed' } });
                return;
            }
        } else if (source && !source.pos.isNearTo(this)) {
            // keeper 必须站到 source 相邻格才能挖矿+transfer。用 range:1 的
            // moveTo 直接找 source 周边空格，避免 goToNearPop 反复压栈任务
            this.moveTo(source, { range: 1, visualizePathStyle: { stroke: '#67ffed' } });
            return;
        }
        if ((source.energy + 300) / source.energyCapacity > (source.ticksToRegeneration || 300) / 300 && source.energy) {
            // bucket 吃紧时挖矿降频（每 2 tick 一次），能量产量略降但守住 CPU
            if (Game.cpu.bucket < 5000 && this.ticksToLive % 2 != 0) {
                // 不挖，但保留 harvest 节奏
            } else {
                this.harvest(source);
            }
        }
        let freeEnergyCapacity = this.store.getFreeCapacity(RESOURCE_ENERGY);
        let notLinkFull = link && link.store[RESOURCE_ENERGY] != 800;
        if (this.ticksToLive % 3 == 0 || freeEnergyCapacity <= 0) {
            let nearFull = freeEnergyCapacity < this.getPartCnt(WORK) * 2;
            if (nearFull) {
                // 工地扫描按 9 tick 节流（附近工地几乎不变），避免每 tick filter 全房工地
                if (this.ticksToLive % 9 == 0 || !this.memory.keeperCsId) {
                    let cs = this.room.constructionSite ? this.room.constructionSite.filter(e => e.pos.isNearTo(this)).head() : undefined;
                    this.memory.keeperCsId = cs ? cs.id : undefined;
                }
                let constructionSite = this.memory.keeperCsId ? Game.getObjectById(this.memory.keeperCsId) : undefined;
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
        let dontPullMe = this.ticksToLive % 40 != 0 // add by an_w
        if (this.memory.dontPullMe != dontPullMe) this.memory.dontPullMe = dontPullMe
    }
};



Creep.prototype.harvestEnergy = function () {
    let task = this.lastTask();
    let station = this.room.memory[pro.stationName] && this.room.memory[pro.stationName][task.id];
    // 主房有 storage（高等级）：该源已有活 keeper 时 worker 顶替挖矿结束，
    // 交还任务让出容器格，否则 worker 占容器格会卡死 keeper（E53S21 复现）
    if (this.mainRoom().storage
        && station && station["creeps"] && station["creeps"].some(id => {
            let c = Game.getObjectById(id);
            return c && c.ticksToLive;
        })) {
        this.popTask();
        return;
    }
    // 空手：优先取能量，不随便挖源 —— 先取源旁容器，storage 健康再取 storage；
    // 只有仓库确实没能量才挖源（最后兜底）
    if (this.store[RESOURCE_ENERGY] == 0) {
        let container = station && Game.getObjectById(station.container);
        if (container && container.store[RESOURCE_ENERGY] > 0) {
            if (this.pos.isNearTo(container)) {
                let amount = Math.min(container.store[RESOURCE_ENERGY], this.store.getFreeCapacity(RESOURCE_ENERGY));
                if (this.withdraw(container, RESOURCE_ENERGY, amount) == OK) {
                    this.popTask();
                }
            } else {
                this.moveTo(container);
            }
            return;
        }
        let storage = this.mainRoom().storage;
        if (storage && storage.store[RESOURCE_ENERGY] > 10000) { // storage 健康才取，避免抽干
            if (this.pos.isNearTo(storage)) {
                let amount = Math.min(storage.store[RESOURCE_ENERGY], this.store.getFreeCapacity(RESOURCE_ENERGY));
                if (this.withdraw(storage, RESOURCE_ENERGY, amount) == OK) {
                    this.popTask();
                }
            } else {
                this.moveTo(storage);
            }
            return;
        }
    }
    // 仓库没能量：真的挖源（最后兜底）
    if (this.store.getFreeCapacity(RESOURCE_ENERGY) <= this.getActiveBodyparts(WORK) * 2) {
        // 满载：有 carrier 且源旁有 container 时先放进 container 让 carrier 搬运，
        // 否则自己带回去（worker 自给自足路径，避免 carrier 挂机）
        let container = station && Game.getObjectById(station.container);
        if (container && this.pos.isNearTo(container) && this.room.creeps("carrier", false).length > 0) {
            let code = this.transfer(container, RESOURCE_ENERGY);
            if (code == ERR_FULL || this.store[RESOURCE_ENERGY] == 0) this.popTask();
            return;
        }
        this.popTask()
    }
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let source = Game.getObjectById(task["id"]);
        if (source && !source.pos.isNearTo(this)) {
            this.addTaskAndExec(UtilsTask.task(source, "goToNearPop"));
            return;
        }
        if (!source || source.energy == 0) {
            this.popTask();
            return;
        }
        this.harvest(source);
    }
    // 满载且相邻主房 storage/terminal（或矿区 container）：直接填充，
    // 不依赖 fillRes 任务链——路径终点若未紧贴 storage，任务链可能永不触发填充
    if (this.store[RESOURCE_ENERGY] > 0 && this.room.my) {
        let storage = this.mainRoom().storage;
        if (storage && this.pos.isNearTo(storage)) {
            this.transfer(storage, RESOURCE_ENERGY);
        }
    }

    if (this.ticksToLive % 4 == 0) {
        //捡起掉落的能量
        let dropEnergy = this.pos.lookFor(LOOK_ENERGY).head();
        if (dropEnergy) this.pickup(dropEnergy);
        //捡起尸体的能量
        let tombstone = this.pos.lookFor(LOOK_TOMBSTONES).head();
        if (tombstone) this.withdraw(tombstone, RESOURCE_ENERGY);
        //捡起container的能量
    }
};

/** 预定 */
Creep.prototype.reserveOuterHar = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task); // reserver 目标是控制器，不走矿区道路
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
        if (!alive.contains(this.id)) alive.push(this.id)
        source["carryCreeps"] = alive; // 必须始终写回
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
        if (!alive.contains(this.id)) alive.push(this.id)
        source["defenseCreeps"] = alive; // 必须始终写回
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
    let canBuild = this.getPartCnt(WORK) > 0 && this.getActiveBodyparts(WORK) > 0;
    // Older deployments put every carrier (including pure CARRY/MOVE haulers)
    // into the keepBuilding loop. They can never make progress there, so they
    // kept returning to the source instead of delivering to Storage. Let such
    // legacy haulers immediately resume the normal delivery task, still on the
    // cached road (the builder task moves along it even without WORK parts).
    if (task.keepBuilding && !canBuild && this.store[RESOURCE_ENERGY] > 0) {
        this.popTask();
        this.addTask([
            UtilsTask.task(this.mainRoom().storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
            UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.mineRoom, stationId: task.stationId, roadDir: 1,
            }),
        ]);
        return this.execLastTask();
    }
    // Once the final road site has become a road, do not keep a WORK carrier
    // shuttling empty-handed. Deliver its remaining load before returning to
    // the source container, still walking the cached road.
    if (task.keepBuilding && complete && this.store[RESOURCE_ENERGY] > 0) {
        this.popTask();
        this.addTask([
            UtilsTask.task(this.mainRoom().storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
            UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.mineRoom, stationId: task.stationId, roadDir: 1,
            }),
        ]);
        return this.execLastTask();
    }
    // 到达端点：先填充所有能量到 storage（即使道路未修完也要先送货），
    // 然后才决定掉头修路或返回矿区
    if (this.pos.isNearTo(target) || this.store[RESOURCE_ENERGY] == 0) {
        if (target && target.store && this.store[RESOURCE_ENERGY] > 0) {
            this.transfer(target, RESOURCE_ENERGY);
        }
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
    // 旧任务没有 roadDir 时曾使 pathIndex += undefined 变成 NaN。外矿路径
    // 由 source 指向 storage，默认正向即可兼容历史任务并保持路线唯一。
    let roadDir = task.roadDir == -1 ? -1 : 1;
    task.roadDir = roadDir;
    // 规划路径：固定路线修路，路点索引增量推进（O(1)，不每 tick 全路径扫描）
    let roadPath = data && pro.getOuterRoadPath(data);
    if (roadPath && roadPath.length) {
        // Exit tiles are special: a creep may arrive on a cached border point
        // while its task index still names that same point. Force one exact
        // cached step immediately, otherwise it can repeatedly select the
        // border as its own movement target and never enter the next tile.
        let borderIndex = pro.nextRoadPathIndex(roadPath, this.pos);
        if (this.pos.isBorder() && borderIndex.dist == 0) {
            let nextIndex = borderIndex.index + roadDir;
            if (nextIndex >= 0 && nextIndex < roadPath.length) task.pathIndex = nextIndex;
            let borderCode = pro.stepFromOuterRoadPoint(this, roadPath, borderIndex.index, roadDir);
            if (borderCode != ERR_NO_PATH) return;
        }
        // A road builder must finish the nearest existing road site before
        // continuing along the route. This prevents a single carrier from
        // walking past several sites, spreading a tiny amount of progress
        // across all of them, and then starving Storage indefinitely.
        let pendingSite = canBuild && this.store[RESOURCE_ENERGY] > 0
            ? pro.nearestOuterRoadSite(roadPath, this.pos) : undefined;
        if (pendingSite) {
            task.pathIndex = pendingSite.index;
            if (!this.pos.inRangeTo(pendingSite.site, 3)) {
                this.moveTo(pendingSite.site, { range: 3, reusePath: 10, visualizePathStyle: { stroke: '#fffa00' } });
            } else {
                this.build(pendingSite.site);
            }
            return;
        }
        let pathIndex = task.pathIndex;
        if (pathIndex == undefined) pathIndex = roadDir == 1 ? 0 : roadPath.length - 1;
        let wp = roadPath[Math.max(0, Math.min(pathIndex, roadPath.length - 1))];
        let dist = wp.roomName == this.pos.roomName ? Math.max(Math.abs(wp.x - this.pos.x), Math.abs(wp.y - this.pos.y)) : 999;
        if (dist > 1) {
            // 偏离路径（或路径刚重算）：重新定位到最近路点
            pathIndex = pro.nextRoadPathIndex(roadPath, this.pos).index;
        } else if (dist == 0) {
            pathIndex += roadDir; // 到达当前路点，前进
        }
        pathIndex = Math.max(0, Math.min(pathIndex, roadPath.length - 1));
        task.pathIndex = pathIndex;
        wp = roadPath[pathIndex];
        // 只操作缓存路线的当前/相邻路点。Creep 在被挤开或跨房转向时不能
        // 顺手在偏离路线的格子铺路，否则会消耗全局 construction site 配额。
        let onRoadPath = [pathIndex - 1, pathIndex, pathIndex + 1].some(i => {
            let p = roadPath[i];
            return p && p.roomName == this.pos.roomName && p.x == this.pos.x && p.y == this.pos.y;
        });
        if (canBuild && onRoadPath && !this.pos.isBorder()) {
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
        let code = pro.moveToOuterRoadPoint(this, task, wp);
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
    // 还没有可用缓存时只移动，不临时铺一条随机路线；下一次路径计算会
    // 生成唯一的 source → storage 路径后再开始建设。
    this.moveTo(target, { visualizePathStyle: { stroke: '#fffa00' } })
}

/** 搬运策略 */
Creep.prototype.harvestEnergyOuterCarry = function () {
    let task = this.headTask();
    let rm = Memory.rooms[this.headTask().roomName];
    if (rm && rm[pro.stationName] && rm[pro.stationName][this.headTask().id]) {
        if (task.roomName != this.room.name) {
            let data = rm[pro.stationName][task.id];
            // Return trips use the same cached road in reverse. Apart from
            // keeping roads unique, this avoids a fresh cross-room PathFinder
            // search whenever a carrier leaves Storage for the source.
            if (!pro.moveOuterCarrierOnRoad(this, task, data, -1)) this.goTo(task);
        } else {
            let sm = rm[pro.stationName][this.headTask().id];
            let container = Game.getObjectById(sm[STRUCTURE_CONTAINER]);
            if (container) {
                if (!this.pos.isNearTo(container)) {
                    // 矿区内部也沿缓存路径反向走到 container，避免 BetterMove
                    // 走出与缓存路径不同的新路线（如 18,40 vs 路径 18,39）
                    let data = rm[pro.stationName][task.id];
                    if (!pro.moveOuterCarrierOnRoad(this, task, data, -1)) this.goTo(container);
                    return;
                }
                // 从 source 旁边的 container / 地上掉落取能量：只要相邻且自身空手
                // 就直接取，不依赖 keeper 是否就位、不限最低能量
                if (this.storeEmpty()) {
                    // 优先捡地上的掉落（keeper 掉落的能量堆），不够再拿 container 里的
                    let drop = this.pos.lookFor(LOOK_ENERGY).head();
                    if (drop && this.store.getFreeCapacity(RESOURCE_ENERGY) > 0) this.pickup(drop);
                    if (this.storeEmpty() && container.store[RESOURCE_ENERGY] > 0) {
                        let code = this.withdraw(container, RESOURCE_ENERGY)
                        if (code == ERR_NOT_IN_RANGE)
                            this.moveTo(container)
                    }
                }
                else if (container.store[RESOURCE_ENERGY] != container.store.getUsedCapacity()) { // add by an_w
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

    // 拾取路径附近的尸体能量 / 掉落能量：寿命终止在路径上的旧 carrier
    // 会留下 tombstone 或掉落堆，新 carrier 顺路捡起即可接续搬运，避免
    // 能量白白滞留在外矿。范围限当前房间内 8 格，只捡能量，不偏离路线
    if (this.ticksToLive % 4 == 0) {
        let tombstone = this.pos.findInRange(FIND_TOMBSTONES, 8, {
            filter: e => e.store[RESOURCE_ENERGY] > 0
        }).head();
        if (tombstone) {
            if (this.pos.isNearTo(tombstone)) {
                this.withdraw(tombstone, RESOURCE_ENERGY);
            } else {
                // 尸体不在脚下：沿缓存路径行进中可短暂绕行拾取
                this.goTo(tombstone);
                return;
            }
        }
        let dropEnergy = this.pos.findInRange(FIND_DROPPED_RESOURCES, 8, {
            filter: e => e.resourceType == RESOURCE_ENERGY && e.amount > 50
        }).head();
        if (dropEnergy) {
            if (this.pos.isNearTo(dropEnergy)) {
                this.pickup(dropEnergy);
            } else {
                this.goTo(dropEnergy);
                return;
            }
        }
    }
    if (this.store[RESOURCE_ENERGY] > 0) {
        // 只要有能量就准备回程。keeper 不在时 container 能量少、难以攒满，
        // 不等能量超过自身容量，取到就回（避免 carrier 卡在矿区空转）；
        // keeper 在时攒满再回，减少碎片往返。
        let sm = rm && rm[pro.stationName] && rm[pro.stationName][task.id];
        let keeperAlive = sm && sm["creeps"] && Game.getObjectById(sm["creeps"][0]);
        if (keeperAlive && this.store[RESOURCE_ENERGY] * 2 <= this.store.getCapacity(RESOURCE_ENERGY)) {
            return; // keeper 正常时等攒满
        }
        let data = task.roomName && task.id
            ? (Memory.rooms[task.roomName] && Memory.rooms[task.roomName][pro.stationName]
                && Memory.rooms[task.roomName][pro.stationName][task.id]) : undefined;
        let isRoadBuilder = this.getPartCnt(WORK) > 0 && this.getActiveBodyparts(WORK) > 0;
        if (data && !pro.outerRoadComplete(data) && isRoadBuilder) {
            // 道路未修好时只让带 WORK 的专职 carrier 修路。普通搬运爬
            // 仍然沿缓存路线把能量送入 Storage，不能让修路任务饿死主房。
            this.addTask(UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.roomName, stationId: task.id, keepBuilding: true, roadDir: 1,
            }));
        } else {
            let roadTask = [
                UtilsTask.task(this.mainRoom().storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
                UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                    mineRoom: task.roomName, stationId: task.id, roadDir: 1,
                }) // 想致富先修路：source -> storage
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
    /**
     * 主房能量保护：storage 可支配能量（扣除 spawn/extension 已耗）低于
     * 阈值时，外矿 keeper/carrier 缓生，优先保证主房自身 spawn、worker、
     * carrier、upgrader 的补员与能量供应。防止外矿爬先吃光能量后触发
     * spawnFailure 连锁，把主房经济拖垮（E53S21 事件：storage 7 万、
     * spawn 74、extension 395、tower 0，主房只剩 3 只爬）。
     * 注意：阈值不能太高——外矿 keeper 是主房的能量输入（挖 E52S21 的
     * 矿运回主房），把它也挡了主房永远起不来。storage 有 2 万以上就
     * 允许外矿 keeper；外矿 carrier（纯消耗）要求 8 万。
     */
    outerMineStarvesSpawnRoom(spawnRoom, isCarrier) {
        if (!spawnRoom || !spawnRoom.my) return true;
        if (!spawnRoom.storage) return false; // 无 storage 的低级房不做限制
        let storageEnergy = spawnRoom.storage.store[RESOURCE_ENERGY] || 0;
        // 主房可支配能量：storage 能量减去 spawn/extension 的缺口
        let capacity = (spawnRoom.energyCapacityAvailable || 0);
        let available = spawnRoom.getEnergyAvailable();
        let deficit = Math.max(0, capacity - available);
        let disposable = storageEnergy - deficit;
        // keeper 是能量输入（低阈值 2 万），carrier 是外矿搬运链必要环节
        // （没它 keeper 挖的能量滞留外矿），阈值也放低到 3 万
        return disposable < (isCarrier ? 30000 : 20000);
    },
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
    /** 路径坐标编码：0-49 → 单字符（与房间索引共用 62 字符字母表） */
    rc(n) { return "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[n]; },
    dc(c) { return "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".indexOf(c); },
    /**
     * 外矿路径紧凑序列化：房间名表 + 每路点 3 字符（房间索引 + x + y）。
     * 不依赖 Room.serializePath（其对 PathFinder 路径的房间跨界步编码不稳定）
     */
    serializeOuterRoadPath(path) {
        let rooms = [];
        let roomIndex = {};
        path.forEach(p => {
            if (roomIndex[p.roomName] === undefined) {
                roomIndex[p.roomName] = rooms.length;
                rooms.push(p.roomName);
            }
        });
        let code = rooms.join(",") + ";";
        path.forEach(p => {
            code += pro.rc(roomIndex[p.roomName]) + pro.rc(p.x) + pro.rc(p.y);
        });
        return code;
    },
    /**
     * 外矿修路路径：从矿区容器到主房间 storage 一次性寻路，
     * 主房间按蓝图路网走（规划的其他建筑不可走），结果按房间
     * serializePath 紧凑序列化存储，1000 tick 重算一次
     */
    ensureOuterRoadPath(data, spawnRoom) {
        let to = spawnRoom.storage ? spawnRoom.storage.pos : (spawnRoom.terminal ? spawnRoom.terminal.pos : undefined);
        if (data.roadPathStr && data.roadPathStr.indexOf("undefined") < 0
            && data.roadPathTick && Game.time - data.roadPathTick < 1000) {
            let cached = pro.getOuterRoadPath(data);
            let end = cached && cached.last();
            // PathFinder can return a non-empty but incomplete path. The old
            // code cached it anyway, making a road-builder stop at a room
            // entrance forever instead of ever reaching storage.
            if (end && to && end.roomName == to.roomName
                && Math.max(Math.abs(end.x - to.x), Math.abs(end.y - to.y)) <= 1) return cached;
            delete data.roadPathStr;
            delete data.roadPathTick;
        }
        let from = Game.getObjectById(data.container);
        from = from ? from.pos : new RoomPosition(data.x, data.y, data.roomName);
        if (!from || !to) {
            data.roadPathError = "no endpoints: from=" + (from || "none") + " to=" + (to || "none") + " tick=" + Game.time;
            return undefined;
        }
        let ret;
        try {
            ret = PathFinder.search(from, to, {
            plainCost: 1,
            swampCost: 5,
            maxRooms: 4,
            // 两房路线叠加主房蓝图代价时，默认 2,000 ops 会在刚进主房
            // 就提前结束。此搜索仅在缓存失效时运行，允许一次完整求解。
            maxOps: 8000,
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
                            // Prefer the blueprint road network, but do not
                            // turn unbuilt future structures into an absolute
                            // wall. A hard wall can make the only room exit
                            // unreachable and yields an incomplete path.
                            let cost = (type == 'road' || type == 'container') ? 1 : 50;
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
        } catch (e) {
            data.roadPathError = "search threw: " + e.message + " tick=" + Game.time;
            return undefined;
        }
        // 蓝图约束可能把主房入口到 storage 的所有格子封死。只有在首选
        // 路网确实无解时，退回 Screeps 原生障碍矩阵；这样仍是一条缓存的
        // 唯一路线，但不会把外矿 carrier 永久卡在房间入口。
        if (!ret || ret.incomplete) {
            try {
                ret = PathFinder.search(from, to, {
                    plainCost: 1,
                    swampCost: 5,
                    maxRooms: 4,
                    maxOps: 8000,
                    range: 1,
                });
            } catch (e) {
                data.roadPathError = "fallback search threw: " + e.message + " tick=" + Game.time;
                return undefined;
            }
        }
        let end = ret && ret.path && ret.path.last();
        let reachesDestination = end && to && end.roomName == to.roomName
            && Math.max(Math.abs(end.x - to.x), Math.abs(end.y - to.y)) <= 1;
        if (ret && !ret.incomplete && reachesDestination && ret.path.length > 1) {
            let roadPath = ret.path;
            // 剔除终点=storage/terminal 自身的位置：被建筑占位，爬永远走不上去会卡死。
            // PathFinder 会把被阻挡的 goal（range>0）也放进 path。
            if (end && end.roomName == to.roomName && end.x == to.x && end.y == to.y) {
                roadPath = ret.path.slice(0, -1);
            }
            if (roadPath.length > 1) {
                data.roadPathStr = pro.serializeOuterRoadPath(roadPath);
                data.roadPathTick = Game.time;
                delete data.roadPath;
                delete data.roadPathError;
                return pro.getOuterRoadPath(data);
            }
        }
        data.roadPathError = "no path: ret=" + (ret ? "pathLen=" + (ret.path || []).length + " incomplete=" + ret.incomplete + " ops=" + ret.ops : "undefined")
            + " from=" + from.roomName + ":" + from.x + "," + from.y + " to=" + to.roomName + ":" + to.x + "," + to.y + " tick=" + Game.time;
        return undefined;
    },
    /** 读取外矿路径：反序列化结果按 tick 全局缓存，多只爬共享 */
    getOuterRoadPath(data) {
        let str = data.roadPathStr;
        if (str && str.indexOf("undefined") >= 0) {
            // 无效序列化（旧格式残留），清除待重算
            delete data.roadPathStr;
            delete data.roadPathTick;
            str = undefined;
        }
        if (!str && data.roadPath) {
            // 旧格式（对象数组）迁移为紧凑字符串
            try { str = data.roadPathStr = pro.serializeOuterRoadPath(data.roadPath); } catch (e) {}
            delete data.roadPath;
        }
        if (!str) return undefined;
        let cache = global._outerRoadPathCache = global._outerRoadPathCache || {};
        let key = data.roomName + ":" + data.id;
        let c = cache[key];
        if (!c || c.tick != Game.time) {
            let path = [];
            let sep = str.indexOf(";");
            if (sep < 0) return undefined;
            let rooms = str.slice(0, sep).split(",");
            let body = str.slice(sep + 1);
            for (let i = 0; i + 2 < body.length; i += 3) {
                path.push(new RoomPosition(pro.dc(body[i + 1]), pro.dc(body[i + 2]), rooms[pro.dc(body[i])]));
            }
            cache[key] = c = { tick: Game.time, path: path };
        }
        return c.path;
    },
    /** 清除外矿房中不在缓存路线上的旧 road 工地，释放全局工地配额。 */
    cleanupOuterRoadSites(data, spawnRoom) {
        if (data.roadSiteCleanupTick && Game.time - data.roadSiteCleanupTick < 250) return;
        data.roadSiteCleanupTick = Game.time;
        let path = pro.getOuterRoadPath(data);
        if (!path || !path.length) return;
        let route = {};
        let rooms = {};
        path.forEach(p => {
            route[p.roomName + ":" + p.x + ":" + p.y] = true;
            rooms[p.roomName] = true;
        });
        Object.keys(rooms).forEach(roomName => {
            // 主房蓝图中的道路由本地规划器维护，绝不在这里移除。
            if (roomName == spawnRoom.name) return;
            let room = Game.rooms[roomName];
            if (!room) return;
            room.find(FIND_MY_CONSTRUCTION_SITES)
                .filter(site => site.structureType == STRUCTURE_ROAD
                    && !route[roomName + ":" + site.pos.x + ":" + site.pos.y])
                .forEach(site => site.remove());
        });
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
    /**
     * Advance a normal outer carrier one waypoint along its cached road.
     * `direction` is +1 for mine -> Storage and -1 for Storage -> mine.
     * Returns false only when the cache cannot be used, allowing the caller
     * to take one native-path fallback and trigger a later route rebuild.
     */
    moveOuterCarrierOnRoad(creep, task, data, direction) {
        let path = data && pro.getOuterRoadPath(data);
        if (!path || !path.length) return false;
        let index = task.returnPathIndex;
        if (index == undefined || index < 0 || index >= path.length) {
            let nearest = pro.nextRoadPathIndex(path, creep.pos);
            if (nearest.dist >= 999) return false;
            index = nearest.index;
        }
        let point = path[index];
        let range = point.roomName == creep.pos.roomName
            ? Math.max(Math.abs(point.x - creep.pos.x), Math.abs(point.y - creep.pos.y)) : 999;
        if (range > 1) {
            let nearest = pro.nextRoadPathIndex(path, creep.pos);
            if (nearest.dist >= 999) return false;
            index = nearest.index;
            // 重新定位后必须重算 range：若正好落在路点上（如跨房后到达对面
            // 边界格），需继续推进 index，否则永远停在边界两侧来回横跳
            point = path[index];
            range = point.roomName == creep.pos.roomName
                ? Math.max(Math.abs(point.x - creep.pos.x), Math.abs(point.y - creep.pos.y)) : 999;
        }
        if (range == 0) {
            index += direction;
        }
        index = Math.max(0, Math.min(index, path.length - 1));
        task.returnPathIndex = index;
        point = path[index];
        let code = pro.moveToOuterRoadPoint(creep, task, point);
        if (code != ERR_NO_PATH && code != ERR_NO_BODYPART) return true;
        delete data.roadPathStr;
        delete data.roadPathTick;
        delete task.returnPathIndex;
        return false;
    },
    /**
     * Walk an external route exactly one cached waypoint at a time. Adjacent
     * route points deliberately use `move`, not `moveTo`, so Screeps never
     * spends PathFinder CPU or cuts a parallel road. A creep displaced from
     * the road force-moves back to its nearest cached point with `moveTo`
     * (a single-step move would be blocked by walls/buildings and get
     * misreported as an invalid path).
     */
    moveToOuterRoadPoint(creep, task, point) {
        let positionKey = creep.pos.roomName + ":" + creep.pos.x + ":" + creep.pos.y;
        let targetKey = point.roomName + ":" + point.x + ":" + point.y;
        if (task.outerRoadMovePos == positionKey && task.outerRoadMoveTarget == targetKey) {
            task.outerRoadStuck = (task.outerRoadStuck || 0) + 1;
        } else {
            task.outerRoadStuck = 0;
        }
        task.outerRoadMovePos = positionKey;
        task.outerRoadMoveTarget = targetKey;
        // 同一路点反复无法到达（如路点被建筑永久占据）：返回 ERR_NO_PATH，
        // 让调用方失效缓存路径并触发重算（重算已剔除 storage/terminal 终点）
        if (task.outerRoadStuck >= 10) {
            return ERR_NO_PATH;
        }
        if (creep.pos.roomName == point.roomName) {
            let range = creep.pos.getRangeTo(point);
            if (range == 0) return OK;
            if (range == 1) {
                let code = creep.move(creep.pos.getDirectionTo(point));
                // 单步 move 不经过 BetterMove，手动更新 lastPos 便于诊断
                if (code == OK) {
                    creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName, time: Game.time };
                    return code;
                }
                // 目标格被占/不可走：向目标方向的邻近方向（±45°）试探，
                // 持续向目标靠拢，避免多个爬互相占住对方目标格而死锁
                let dir = creep.pos.getDirectionTo(point);
                for (let i = 1; i <= 7; i += 2) {
                    let d = ((dir - 1 + i + 8) % 8) + 1;
                    code = creep.move(d);
                    if (code == OK) {
                        creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName, time: Game.time };
                        return code;
                    }
                }
                return OK;
            }
            // 偏离路径：强行 moveTo 回到最近缓存路点，绕开墙体/建筑
            return creep.moveTo(point, { range: 0, reusePath: 5, visualizePathStyle: { stroke: '#fffa00' } });
        }
        // 跨房：边界格每 tick 持续 move(exit) 向目标房间位移（用户验证：
        // 一直朝目标方向移动就能通过；不验证位置、不退回、不等待——
        // 退回会造成边界来回弹跳，等待会与对面爬互相传送死锁）。
        if (creep.pos.isBorder()) {
            let exit = Game.map.findExit(creep.pos.roomName, point.roomName);
            if (exit >= TOP && exit <= TOP_LEFT) {
                let code = creep.move(exit);
                if (code == OK) {
                    creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName, time: Game.time };
                }
                return OK;
            }
        }
        return creep.moveTo(point, { range: 0, reusePath: 5, visualizePathStyle: { stroke: '#fffa00' } });
    },
    /** Move exactly from one cached route point to its next point. */
    stepFromOuterRoadPoint(creep, roadPath, index, direction) {
        let next = roadPath[index + direction];
        if (!next) return ERR_NO_PATH;
        if (next.roomName == creep.pos.roomName) {
            return creep.move(creep.pos.getDirectionTo(next));
        }
        let exit = Game.map.findExit(creep.pos.roomName, next.roomName);
        return exit >= TOP && exit <= TOP_LEFT ? creep.move(exit) : ERR_NO_PATH;
    },
    /**
     * Return the closest route-bound road construction site in the creep's
     * current room. Scanning the room's small site list is much cheaper than
     * PathFinder and avoids selecting a site behind an unseen room border.
     */
    nearestOuterRoadSite(roadPath, pos) {
        let room = Game.rooms[pos.roomName];
        if (!room) return undefined;
        let routeIndex = {};
        roadPath.forEach((point, index) => {
            if (point.roomName == pos.roomName) routeIndex[point.x + ":" + point.y] = index;
        });
        let best;
        room.find(FIND_MY_CONSTRUCTION_SITES).forEach(site => {
            if (site.structureType != STRUCTURE_ROAD) return;
            let index = routeIndex[site.pos.x + ":" + site.pos.y];
            if (index == undefined) return;
            let range = pos.getRangeTo(site);
            if (!best || range < best.range || (range == best.range && index < best.index)) {
                best = { site: site, index: index, range: range };
            }
        });
        return best;
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
            // level 8 默认门槛 1600；但调用方显式传了更低门槛（如 hive 满
            // 时抽容器传 300）时以显式参数为准——否则容器 900-1000 能量在
            // level 8 房永远不搬、积压溢出
            if (room.level == 8 && arguments.length < 2) minEnergy = 1600;
            let maxContainerEnergyCnt = 0;
            for (let resm of _.values(rm[pro.stationName])) {
                let container = Game.getObjectById(resm["container"]);
                if (container && container.store[RESOURCE_ENERGY] > maxContainerEnergyCnt)
                    maxContainerEnergyCnt = container.store[RESOURCE_ENERGY]
                if (container && container.store[RESOURCE_ENERGY] > minEnergy && !room.used[container.id]) {
                    tasks.push([UtilsTask.task(container, "carryRes", "registerStationSourcesCarryInRoom", {
                        resType: RESOURCE_ENERGY,
                        requireFullLoad: true,
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
            let centerLink = rm[StationCarry.stationName] && Game.getObjectById(rm[StationCarry.stationName][STRUCTURE_LINK]);
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
    /** 重复 keeper 清理：每个挖矿点只保留 1 只（保留最年轻的），不受生爬失败影响 */
    cleanupDuplicateKeepers(roomName) {
        let harMemory = Memory.rooms[roomName.name || roomName] && Memory.rooms[roomName.name || roomName][StationSources.stationName];
        if (!harMemory) return;
        _.values(harMemory).forEach(data => {
            let harCreeps = (data["creeps"] || []).map(e => Game.getObjectById(e)).filter(e => e && e.ticksToLive)
            if (harCreeps.length > 1) {
                harCreeps.sort((a, b) => b.ticksToLive - a.ticksToLive);
                harCreeps.slice(1).forEach(e => e.suicide());
            }
            // 清理死掉的 creeps（自杀的爬在下 tick 死亡）
            data["creeps"] = (data["creeps"] || []).filter(e => Game.getObjectById(e))
        });
    },
    trySpawnHarKeeper(room) {
        pro.cleanupDuplicateKeepers(room.name);
        if (room.spawnFailure) return null;
        pro.trySpawnOuterHarKeeper(room.name, room);
    },
    trySpawnOuterHarKeeper(roomName, spawnRoom) {
        // 主房能量优先：storage + spawn/extension 可支配能量低于阈值时，
        // 外矿 keeper 缓一缓——否则外矿爬先吃光能量、主房 spawn/worker/
        // carrier 补员被 spawnFailure 连锁挡死，主房经济崩溃（E53S21 事件）。
        // 注意：只挡外矿（roomName != spawnRoom.name），主房自己的 keeper
        // 是能量源头，永远不能挡——否则主房无能量来源，恶性循环
        if (roomName != spawnRoom.name && pro.outerMineStarvesSpawnRoom(spawnRoom, false)) return null;
        // 重复 keeper 清理必须在生爬门槛之前执行：生爬失败（能量不足）时
        // spawnFailure 会挡住后续逻辑，导致重复 keeper 一直无法清理
        pro.cleanupDuplicateKeepers(roomName);
        if (spawnRoom.spawnFailure) return null;
        // log(roomName,spawnRoom.name)
        if (roomName == spawnRoom.name
            && spawnRoom.creeps("harvestEnergyKeeper").filter(e => e.ticksToLive > 300).length
            && spawnRoom.creeps("carrier").filter(e => e.ticksToLive > 300).length == 0) return; // 如果低等级低，有存在har 并且没有搬运的时候，优先生搬运的，避免一直挖而没有搬运的
        delete Memory.rooms[roomName][StationSources.stationName]["undefined"]

        for (let k in Memory.rooms[roomName][StationSources.stationName])
            if (!Memory.rooms[roomName][StationSources.stationName][k]) delete Memory.rooms[roomName][StationSources.stationName][k]

        // 排除非 source 数据（认领表 _carryClaim 等辅助字段），避免被当
        // 成挖矿点遍历、污染 spawnTime
        _.values(Memory.rooms[roomName][StationSources.stationName]).forEach(data => {
            if (!data || typeof data != "object" || !data["id"]) return;
            // 净化被污染的 spawnTime（重复 concat 造成的极端负数会让生爬条件恒真）
            if (!data["spawnTime"] || data["spawnTime"] < -1000 || data["spawnTime"] > Game.time) data["spawnTime"] = Game.time;
            if (Game.time - data["spawnTime"] > 1500 || (data["creeps"] || []).length == 0) {
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
        // 主房 carrier（roomName == spawnRoom.name）负责填 hive/搬 link，
        // 是主房能量循环的一部分，不能挡；只挡外矿 carrier（纯消耗，8 万阈值）
        if (roomName != spawnRoom.name && pro.outerMineStarvesSpawnRoom(spawnRoom, true)) return null;
        if (spawnRoom.spawnFailure) return null;
        let harRoom = Game.rooms[roomName.name || roomName]
        if (!harRoom) return;
        let sm = harRoom.memory[pro.stationName]
        _.values(sm).forEach(data => {
            let pathTime = data["pathTime"];
            let container = Game.getObjectById(data["container"]);
            // 预先计算并缓存固定修路路径（一次性寻路，避免多个修路爬各走各的路线）
            pro.ensureOuterRoadPath(data, spawnRoom);
            pro.cleanupOuterRoadSites(data, spawnRoom);
            // 路线验证/重算不依赖空闲 Spawn。单 Spawn 房若先尝试本地补员，
            // spawnFailure 不能阻止已有外矿 carrier 修正其过期路径。
            if (spawnRoom.spawnFailure) return;
            // container 不可见时仍可按缓存 ID / 坐标孵化；carrier 抵达矿区后
            // 再解析对象即可。否则 keeper 死后失去视野会再次把外矿锁死。
            if (pathTime && data["container"]) {
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
        let sourceMemory = Memory.rooms[roomName.name || roomName];
        let data = sourceMemory && sourceMemory[pro.stationName]
            && _.values(sourceMemory[pro.stationName]).find(e => e && e.id);
        if (!data) return;
        if (isInvader) {
            let defensers = spawnRoom.creeps("outerHarvestDefenser", false).filter(e => e.headTask().roomName == (roomName.name || roomName))
            let defenser = defensers.head()
            if (defenser && defenser.ticksToLive > 170 && !defenser.memory.hasSendSpawn && defensers.length > 1) return;
            let carrierBody = pro.getOuterHarDefenseBodyConfig(isInvader)
            let tasks = pro.generatorOuterHarDefenseTask(data)
            StationHive.trySpawn(spawnRoom, spawnRoom.name, carrierBody, "outerHarvestDefenser", tasks)
            if (defenser) defenser.memory.hasSendSpawn = true
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
    /** 仅在 Memory.visualOuterRoad 配置时绘制缓存外矿路线，零常驻开销。 */
    drawOuterRoadDebug() {
        let debug = Memory.visualOuterRoad;
        if (!debug) return;
        if (debug.until && debug.until < Game.time) {
            delete Memory.visualOuterRoad;
            return;
        }
        let stations = Memory.rooms[debug.roomName] && Memory.rooms[debug.roomName][pro.stationName];
        let data = stations && (debug.stationId ? stations[debug.stationId] : _.values(stations).find(e => e && e.roadPathStr));
        let path = data && pro.getOuterRoadPath(data);
        if (!path || !path.length) return;
        path.forEach((pos, index) => {
            let previous = path[index - 1];
            let visual = new RoomVisual(pos.roomName);
            if (previous && previous.roomName == pos.roomName) {
                visual.line(previous.x, previous.y, pos.x, pos.y, { color: "#00e5ff", width: 0.16, opacity: 0.8 });
            }
            if (index % 10 == 0) visual.text(index, pos.x, pos.y, { color: "#ffffff", font: 0.45, opacity: 0.9 });
        });
        let start = path[0];
        let end = path.last();
        new RoomVisual(start.roomName).circle(start.x, start.y, { radius: 0.42, fill: "#22c55e", opacity: 0.85 });
        new RoomVisual(end.roomName).circle(end.x, end.y, { radius: 0.42, fill: "#f59e0b", opacity: 0.85 });
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
