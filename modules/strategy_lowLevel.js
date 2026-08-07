/**
 * 在没有 storage使用的策略
 */


Creep.prototype.lowLevelDefense = function () {
    let em = this.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    if (em) {
        this.attack(em)
        this.moveTo(em)
        return;
    }
    this.memory.dontPullMe = false;
}

let pro = {
    pickTasksMap: {},
    tryCreateCons(pos, struct) {
        let head = pos.lookFor(LOOK_STRUCTURES).filter(e => e.structureType == struct).head()
        if (!head) pos.createConstructionSite(struct)
    },
    trySpawnLowLevelDefense(room) {
        let totalEnergy = room.getEnergyCapacityAvailable(room);
        let attackNeed = BODYPART_COST[ATTACK] + 3 * BODYPART_COST[MOVE]
        let cnt = Math.floor(totalEnergy / attackNeed)
        let body = ManagerCreeps.calcBodyPart({ [MOVE]: cnt * 3, [ATTACK]: cnt })
        StationHive.trySpawn(room, room.name, body, "lowLevelDefense", [UtilsTask.taskData("lowLevelDefense")])
    },
    pickTasks(room, freeCarries, onlyEnergy = false) {
        // 捡起任务 9tick更新一次，比较耗时 缓存起来
        let pickTasks = pro.pickTasksMap[room.name] || []
        if ((Game.time + room.hashCode()) % 9 == 0) {
            pickTasks = StationCarry.generatorPickTask(room, onlyEnergy).concat(StationMineral.generatorCarryMineralTask(room))
        }
        if (freeCarries.length && pickTasks.length) { freeCarries.pop().addTask(pickTasks.shift()); }
        pro.pickTasksMap[room.name] = pickTasks;
    },
    exec(room) {
        if ((Game.time + room.hashCode()) % 3 != 0) {
            return
        }
        if (room.spawn.length && room.find(FIND_HOSTILE_CREEPS).filter(e => e.body.filter(e => e != MOVE).length).length) {// 如果有敌人的爬且不是侦察兵
            if (room.creeps("lowLevelDefense").length < 3 && room.tower.length == 0) pro.trySpawnLowLevelDefense(room)
        }
        // if ((room.getEnergyCapacityAvailable(room) < 800 || (room.storage && !room.storage.my))) {
        if ((room.getEnergyCapacityAvailable(room) < 800 )) {
            // Creating structures from an existing blueprint is core room
            // maintenance, not the expensive auto-planning job. Keep this
            // active even when optional planner computation/visuals are off.
            if (global.ManagerAutoPlanner) ManagerAutoPlanner.tryAutoBuildLowLevel0(room);
            // if((Game.time+room.hashCode()) % 150 == 0  && Game.cpu.bucket>50 && room.memory.structMap){
            //     room.memory.structMap[STRUCTURE_SPAWN].take(1).forEach(e=>{pro.tryCreateCons(new RoomPosition(e[0],e[1],room.name),STRUCTURE_SPAWN)})
            //     room.memory.structMap[STRUCTURE_EXTENSION].take(10).forEach(e=>{pro.tryCreateCons(new RoomPosition(e[0],e[1],room.name),STRUCTURE_EXTENSION)})
            // }
            let creeps = room.creeps("worker").filter(e => e.storeEmpty() && e.isFree())
            pro.pickTasks(room, creeps, true)

            /** 利用 和 生成 新的 worker*/
            _.values(room.memory[StationSources.stationName]).filter(e => Game.getObjectById(e.id).energy)
                .sort((a, b) => Game.getObjectById(b.id) ? Game.getObjectById(b.id).energy - Game.getObjectById(a.id).energy : 0) // 如果有视野 按能量多少从大到小排序
                .forEach(data => {
                    // room[data["id"]].pos.findInRange(FIND_STRUCTURES,1).filter(e=>e.structureType = STRUCTURE_WALL).length;
                    let posLen = room[data["id"]].pos.nearPos(1).filter(e => e.walkable()).length
                    let targetCnt = posLen * 1.5 - room.creeps("worker").filter(e => e.headTask() && e.headTask().id == data["id"]).length;
                    if (Math.min(6, Math.ceil(targetCnt)) > 0) {
                        let creep = room.creeps("worker").filter(e => e.storeEmpty() && e.isFree()).head()
                        // log(StationWork.getLowLevelWorkerBodyConfig(spawnRoom,false))
                        if (creep) creep.addTask(StationSources.generatorReleaseAbleHarTask(data))
                        else if (room.creeps("worker").length < 20 && !room.find(FIND_FLAGS).filter(e => e.getPrefix() == "claimCrossShard").length) {
                            let spawnRoom = StationHive.getClosestSpawnRoom(room, 7, 3, 15)
                            if (!spawnRoom) {
                                return;
                            }
                            if (spawnRoom.name != room.name && room.creeps("worker", false).length >= 4) return;// 如果不是自己的房间最多生4个
                            StationHive.trySpawn(spawnRoom, room.name, StationWork.getLowLevelWorkerBodyConfig(spawnRoom), "worker", [])
                        }
                    }
                });

            creeps = room.creeps("worker").filter(e => e.storeEmpty() && e.isFree())
            if (creeps.length) {
                if (StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY) > 2000) {
                    creeps.pop().addTask(StationCarry.generatorCarryStorageEnergyTask(room));
                }
            }

            room.creeps("worker").filter(e => !e.storeEmpty() && e.isFree()).forEach(creep => {
                if (StationHive.HiveNeedToFill(room)) {
                    creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                } else if (StationWork.constructionNeedBuild(creep.mainRoom()) && !room.isDownGrade()) {
                    creep.addTask(StationWork.generatorBuildTask(creep))
                }
                else {
                    creep.addTask(StationUpgrade.generatorUpgradeTask(room));
                }
            })
        } else { // 3级的时候可以分化creep来了
            if (global.ManagerAutoPlanner) ManagerAutoPlanner.tryAutoBuildLowLevel800(room);

            if (room.creeps("worker", false).length + room.creeps("carrier", false).length == 0)// 如果没用搬运的就直接优先生一个
                StationHive.trySpawn(room, room.name, StationWork.getMiddleLevelWorkerBodyConfig(room), "worker", [])

            StationSources.trySpawnHarKeeper(room);


            let creeps = room.creeps("worker").filter(e => e.storeEmpty() && e.isFree())
            if (creeps.length) {
                if (StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY) > 2000) {
                    creeps.pop().addTask(StationCarry.generatorCarryStorageEnergyTask(room));
                }
            }

            // 挖矿
            _.values(room.memory[StationSources.stationName]).forEach(data => {
                if (data["creeps"].length == 0) {
                    let posLen = room[data["id"]].pos.nearPos(1).filter(e => e.walkable()).length
                    let targetCnt = posLen * 1.5 - room.creeps("worker").filter(e => e.headTask() && e.headTask().id == data["id"]).length;
                    if (Math.min(6, Math.ceil(targetCnt)) > 0) {
                        let creep = room.creeps("worker").filter(e => e.storeEmpty() && e.isFree()).head()
                        if (creep) creep.addTask(StationSources.generatorReleaseAbleHarTask(data))
                    }
                }
            });

            if ((room.constructionSite.length || room.creeps(undefined, false).length == 0)  // 有工地的时候在造worker 或者全死光了
                && (room.creeps("worker", false).length < 2 ||
                    ((room.creeps("carrier").filter(e => e.isFree()).length > room.creeps("worker", false).length)
                        && room.creeps("worker", false).filter(e => e.isFree()).length < 2))) {
                StationHive.trySpawn(room, room.name, StationWork.getMiddleLevelWorkerBodyConfig(room), "worker", [])
            }


            // 生 升级的
            if (Game.getObjectById(room.memory[StationUpgrade.stationName][STRUCTURE_CONTAINER]))
                if (room.creeps("upgrader").length == 0 || room.creeps("upgrader").length < room.creeps("carrier")
                    .filter(e => e.isFree() && e.store[RESOURCE_ENERGY] > 0).length - 1) {
                    StationUpgrade.spawnUpgrader(room)
                }

            // 内矿的能量搬运 和掉落资源
            let pickTasks = StationCarry.generatorPickTask(room, true)
            let carryTasks = StationSources.generatorCarryEnergyTask(room);
            let storageTasks = StationCarry.generatorCarryStorageEnergyTask(room);
            room.creeps("carrier").filter(e => e.storeEmpty() && e.isFree()).forEach(creep => {
                if (StationHive.HiveNeedToFill(room)) {
                    // hive 是第一优先级：空手 carrier 先取容器（keeper 新挖的
                    // 新鲜能量，认领表已防重复），容器没货再取 storage 兜底
                    if (carryTasks.length) {
                        creep.addTask(carryTasks.pop());
                        creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                        return;
                    }
                    if (storageTasks.length) {
                        creep.addTask(storageTasks.shift());
                        creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                        return;
                    }
                }
                if (carryTasks.length) {
                    creep.addTask(carryTasks.pop())
                } else if (pickTasks.length) {
                    creep.addTask(pickTasks.shift())
                }
            })

            if (!creeps.length) creeps = room.creeps("carrier").filter(e => e.storeEmpty() && e.isFree())
            if (creeps.length) {
                if (StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY) > 2000) {
                    creeps.pop().addTask(StationCarry.generatorCarryStorageEnergyTask(room));
                }
            }

            // 如果内矿搬不动了生一个
            if (room.creeps("carrier", false).length < 1 || carryTasks.length) {
                StationHive.trySpawn(room, room.name, StationCarry.getCarrierBodyConfig(room), "carrier", [])
            }

            // 剩下的给 worker 搬运
            room.creeps("worker").filter(e => e.storeEmpty() && e.isFree()).forEach(creep => {
                if (carryTasks.length) {
                    creep.addTask(carryTasks.pop())
                }
            })

            // 填充任务
            let fillTowerTasks = StationTower.generatorFillEnergyTasks(room)
            room.creeps("carrier").filter(e => !e.storeEmpty() && e.isFree()).forEach(creep => {
                if (StationHive.HiveNeedToFill(room)) {
                    creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                } else if (fillTowerTasks.length) {
                    creep.addTask(fillTowerTasks.shift())
                }
            })

            // 分配升级的运送
            let creep = room.creeps("carrier").filter(e => !e.storeEmpty() && e.isFree()).head();
            if (creep) {
                let task = StationUpgrade.generatorFillEnergyTask(room.name, creep.getPartCnt(CARRY) * 50);
                if (task.length > 0) {
                    creep.addTask(task);
                }
            }

            let lowEnergyCarry = StationSources.generatorCarryEnergyTask(room, StationHive.HiveNeedToFill(room) ? 1200 : 500)
            room.creeps("worker").filter(e => e.isFree()).forEach(creep => {
                if (creep.storeEmpty()) {
                    if (lowEnergyCarry.length)
                        creep.addTask(lowEnergyCarry.pop())
                } else {
                    if (StationHive.HiveNeedToFill(room)) {
                        creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                    } else if (StationWork.constructionNeedBuild(creep.mainRoom()) && !room.isDownGrade()) {
                        creep.addTask(StationWork.generatorBuildTask(creep))
                    }
                    else {
                        creep.addTask(StationUpgrade.generatorUpgradeTask(room));
                    }
                }
            })
        }
    }
}


global.StrategyLowLevel = pro;
