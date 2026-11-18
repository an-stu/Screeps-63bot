/**
 * 在没有 storage使用的策略
 */


const DOWNGRADE_PROTECTION_TICKS = 5000;

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
    directHarvestSources(room) {
        const stations = room.memory[StationSources.stationName];
        if (!stations) return [];
        return (room.source || []).filter(source => {
            const data = stations[source.id];
            if (!data) return false;
            const ids = data.creeps || [];
            if (room.storage) return ids.length === 0;
            const container = data.container && Game.getObjectById(data.container);
            const ready = container && container.pos.isNearTo(source.pos) && ids.some(id => {
                const keeper = Game.getObjectById(id);
                return keeper && !keeper.spawning && keeper.pos.isEqualTo(container.pos);
            });
            return !ready;
        });
    },
    assignDirectHarvest(room, sources, workers) {
        if (!sources.length) return;
        const assigned = new Set();
        const available = [];
        for (const worker of workers) {
            const task = worker.headTask();
            if (task && task.taskName === "harvestEnergy") assigned.add(task.id);
            if (worker.isFree() && worker.storeEmpty()) available.push(worker);
        }
        for (const source of sources) {
            if (!available.length) break;
            if (!source.energy || assigned.has(source.id)) continue;
            available.shift().addTask(StationSources.generatorReleaseAbleHarTask(room.memory[StationSources.stationName][source.id]));
        }
    },
    needsDowngradeProtection(room) {
        const controller = room.controller;
        return !!(room.spawn.length && controller && !controller.upgradeBlocked
            && controller.ticksToDowngrade <= DOWNGRADE_PROTECTION_TICKS);
    },
    assignDowngradeProtection(room, workers, urgent = pro.needsDowngradeProtection(room)) {
        if (!urgent) return;
        // 临近降级只保留一只应急 worker；优先空闲满载者，必要时中断施工。
        if (workers.some(worker => {
            const task = worker.lastTask();
            return task && task.taskName === "upgrade" && task.id === room.controller.id && !worker.storeEmpty();
        })) return;
        let builder;
        for (const worker of workers) {
            if (worker.storeEmpty()) continue;
            if (worker.isFree()) {
                worker.addTask(StationUpgrade.generatorUpgradeTask(room));
                return;
            }
            const task = worker.lastTask();
            if (!builder && task && task.taskName === "buildConst" && task.roomName === room.name) builder = worker;
        }
        if (builder) {
            builder.popTask();
            builder.addTask(StationUpgrade.generatorUpgradeTask(room));
        }
    },
    exec(room) {
        if ((Game.time + room.hashCode()) % 3 != 0) {
            return
        }
        // 内层变量原来遮蔽外层：部件对象与字符串 MOVE 比较恒不等，
        // 过滤器形同虚设——纯 MOVE 侦察兵也会触发防御生产。
        // 低 RCL 防不住时允许对 invader 产防守爬（用户政策）；safe mode 另由
        // checkSafeMode 对 NPC 免疫，二者不冲突。
        if (room.spawn.length && room.find(FIND_HOSTILE_CREEPS).filter(e => e.body.filter(p => p.type != MOVE).length).length) {// 如果有敌人的爬且不是侦察兵
            if (room.creeps("lowLevelDefense").length < 3 && room.tower.length == 0) pro.trySpawnLowLevelDefense(room)
        }
        // if ((room.getEnergyCapacityAvailable(room) < 800 || (room.storage && !room.storage.my))) {
        if ((room.getEnergyCapacityAvailable(room) < 800 )) {
            // Creating structures from an existing blueprint is core room
            // maintenance, not the expensive auto-planning job. Keep this
            // active even when optional planner computation/visuals are off.
            if (global.ManagerAutoPlanner) ManagerAutoPlanner.tryAutoBuildLowLevel0(room);
            // RCL<3 跨 shard 援建房：建设由跨 shard 建筑爬负责，本地 spawn 只产防守爬
            // （上面入侵分支已处理），不本地产 worker / 采集 / 升级（用户政策：一直援建、不自产）。
            if (Memory.crossShardBuilds && Memory.crossShardBuilds[room.name]) return;
            pro.assignDowngradeProtection(room, room.creeps("worker"));
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

            const workers = room.creeps("worker");
            const fallbackSources = pro.directHarvestSources(room);
            const downgradeUrgent = pro.needsDowngradeProtection(room);
            pro.assignDowngradeProtection(room, workers, downgradeUrgent);

            // 低 RCL 孵化优先级（用户 2026-11-18）：**keeper（收入）→ carrier（搬运）
            // → worker → upgrader**；但**全空房**先给一只 200 的救急 worker —— 没有
            // 容器时 keeper 满 50 就停挖（harvestSinkFree=false），必须有人先挖矿填
            // hive，否则 keeper/loader 谁也付不起。原顺序是 worker/upgrader 先吃满
            // 预算，hive 800 时一只工人就把能量花光，keeper 与 carrier 同 pass 都排不上。
            const hasWorker = room.creeps("worker", false).length > 0;
            // 有 carrier 却没有可搬的源容器时，也必须保留一条自采自用的启动链。
            if (!hasWorker && (!room.creeps("carrier", false).length || downgradeUrgent
                || (!room.storage && fallbackSources.length > 0 && fallbackSources.length === room.source.length))) {
                let rescueBudget = room.currentEnergyAvailable === undefined
                    ? room.getEnergyAvailable() : room.currentEnergyAvailable;
                if (rescueBudget >= 200) {
                    room.spawnFailure = false;
                    StationHive.trySpawn(room, room.name,
                        StationWork.getMiddleLevelWorkerBodyConfig(room, Math.min(rescueBudget, 200)), "worker", []);
                }
            }

            StationSources.trySpawnHarKeeper(room);

            const carryMin = room.storage ? (StationHive.HiveNeedToFill(room) ? 1200 : 300) : 300;
            const carryTasks = StationSources.generatorCarryEnergyTask(room, carryMin);
            {
                let keeperCnt = room.creeps("harvestEnergyKeeper", false).length;
                let sourceCnt = room.source ? room.source.length : 2;
                let carrierTarget = Math.max(2, Math.min(3, Math.ceil((sourceCnt + keeperCnt) / 2)));
                if (StationHive.HiveNeedToFill(room)) carrierTarget = Math.min(3, carrierTarget + 1);
                let carrierCnt = room.creeps("carrier", false).length;
                // 无 storage 的低级房：容器有 300 就值得搬（不再等 1200 的批次门槛，
                // 那是给 RCL8 大容器准备的；2000 上限的容器经常攒不到）。
                let carrierBudget = room.currentEnergyAvailable === undefined
                    ? room.getEnergyAvailable() : room.currentEnergyAvailable;
                // 体型策略与 keeper 一致（用户 2026-11-18：尽可能大）：只在付得起
                // **满配**时出 carrier。编制只数**满配** carrier —— 小体型不占编制，
                // 否则 3 只小 carrier 会把名额占满、永远不换（E51S29 实测 4/6/8 各一只）。
                let fullCarrierBody = StationCarry.getCarrierBodyConfig(room);
                let fullCarrierCost = Utils.getBodyEnergyNeed(fullCarrierBody);
                let partCost = part => (typeof BODYPART_COST != "undefined"
                    ? (BODYPART_COST[part.type] || 0) : 50);
                let fullCarrierCnt = room.creeps("carrier", false).filter(c => c.body && c.body.length
                    && c.body.reduce((sum, p) => sum + partCost(p), 0) >= fullCarrierCost).length;
                let needCarrier = fullCarrierCnt < carrierTarget
                    || (carryTasks.length && carrierCnt < carrierTarget);
                if (needCarrier && carrierBudget >= fullCarrierCost) {
                    room.spawnFailure = false;
                    StationHive.trySpawn(room, room.name, fullCarrierBody, "carrier", []);
                }
            }
            // 与 high-level 一致：主房 keeper 之后才排外矿（外矿需 storage
            // 接收能量，无 storage 的低级房此调用为空操作）
            if (global.StrategyOuterHarvest && isCpuFeatureEnabled("outerHarvest") && !room.flags("stopRemote").length) {
                HelperError.catchError(() => StrategyOuterHarvest.exec(room), room.name);
            }


            let creeps = room.creeps("worker").filter(e => e.storeEmpty() && e.isFree())
            if (creeps.length) {
                if (StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY) > 2000) {
                    creeps.pop().addTask(StationCarry.generatorCarryStorageEnergyTask(room));
                }
            }

            // 新矿工仅登记、尚未到位或源容器仍是工地时，每源留一只可释放的直采 worker。
            pro.assignDirectHarvest(room, fallbackSources, workers);

            if ((room.constructionSite.length || room.creeps(undefined, false).length == 0)  // 有工地的时候在造worker 或者全死光了
                && (room.creeps("worker", false).length < 2 ||
                    ((room.creeps("carrier").filter(e => e.isFree()).length > room.creeps("worker", false).length)
                        && room.creeps("worker", false).filter(e => e.isFree()).length < 2))) {
                // 体型必须按**本 tick 真能花出去**的能量算：按容量 800 请求而 hive 只有
                // 400 时 trySpawn 静默失败并置 spawnFailure，把同 pass 后面本可付得起的
                // 750 carrier 一起挡住（与 station_upgrade / station_sources 同一病根）。
                let workerBudget = room.currentEnergyAvailable === undefined
                    ? room.getEnergyAvailable() : room.currentEnergyAvailable;
                if (workerBudget >= 200) StationHive.trySpawn(room, room.name, StationWork.getMiddleLevelWorkerBodyConfig(room, workerBudget), "worker", [])
            }


            // 生 升级的 —— **上限 3 只**。hive 缺能时**不孵**：低级房的第一优先级
            // 永远是把 spawn/extension 填满（用户 2026-11-18），升级爬会和 keeper/
            // carrier 抢本 tick 的孵化预算。控制器临近降级时例外。
            //
            // 原条件把「空闲且有货的搬运数 - 1」当目标，正常房（2~3 只搬运）等于 1~2 只；
            // 但搬运一旦超编（2026-10-22 实测 W26N58 有 19 只）它就恒真，
            // 会一路派到十几只 upgrader，每只要 800 能量，而本房收入只有 ~20 能量/tick。
            // 3 只 × 6 WORK = 18/tick 正好吃满收入，再多为纯浪费（占 spawn 槽 + CPU）。
            // 计数用 `spawned=false`（**含孵化中**），否则连派。
            // station 记忆由 refreshRoom（每 61 tick 错峰）首次写入：新占房在
            // 首次 refresh 前该键不存在，裸取 [STRUCTURE_CONTAINER] 抛 TypeError
            // 让整个 lowLevel pass 中断到多 61 tick。
            if ((!StationHive.HiveNeedToFill(room) || downgradeUrgent || room.isDownGrade())
                && room.memory[StationUpgrade.stationName] && Game.getObjectById(room.memory[StationUpgrade.stationName][STRUCTURE_CONTAINER])) {
                let upgCnt = room.creeps("upgrader", false).length;
                let loadedFree = room.creeps("carrier").filter(e => e.isFree() && e.store[RESOURCE_ENERGY] > 0).length;
                if (upgCnt == 0 || (upgCnt < 3 && upgCnt < loadedFree - 1)) {
                    StationUpgrade.spawnUpgrader(room)
                }
            }

            // 内矿的能量搬运 和掉落资源
            let pickTasks = StationCarry.generatorPickTask(room, true)
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

            // 剩下的给 worker 搬运。容器没货时也去捡地上的掉落（keeper 满仓溢出），
            // 捡满后下一 tick 会按「hive 优先」填进去 —— 低级房不能只靠 carrier。
            workers.filter(e => e.storeEmpty() && e.isFree()).forEach(creep => {
                if (carryTasks.length) {
                    creep.addTask(carryTasks.pop())
                } else if (pickTasks.length) {
                    creep.addTask(pickTasks.shift())
                }
            })

            // 给升级容器预留一只搬运，优先于塔；平时不得抢在 Hive 之前。
            //
            // 2026-10-21 实测 W26N58（RCL3，无 storage）：塔被修理动作持续抽干，
            // `fillTowerTasks` 永远非空，于是「先塔、后升级容器」让每一只空闲搬运
            // 都被塔吃掉 ⇒ 控制器旁容器长期 0/2000、upgrader 抱着 0 能量站着、
            // 控制器进度冻结在 12,336 达数十 tick，而降级计时器 1/tick 往下走。
            // 升级容器上限只有 2000，先给它一只搬运不会挤占别的需求。
            let upgCreep = room.creeps("carrier").find(e => !e.storeEmpty() && e.isFree());
            if (upgCreep && (downgradeUrgent || !StationHive.HiveNeedToFill(room))) {
                let task = StationUpgrade.generatorFillEnergyTask(room.name, upgCreep.getPartCnt(CARRY) * 50);
                if (task.length > 0) {
                    upgCreep.addTask(task);
                }
            }

            // 填充任务
            let fillTowerTasks = StationTower.generatorFillEnergyTasks(room)
            room.creeps("carrier").filter(e => !e.storeEmpty() && e.isFree()).forEach(creep => {
                if (StationHive.HiveNeedToFill(room)) {
                    creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                } else if (fillTowerTasks.length) {
                    creep.addTask(fillTowerTasks.shift())
                } else if (room.storage) {
                    // hive 满且塔满：把身上能量放回 storage，防止容器/身上
                    // 能量滞留溢出
                    creep.addTask(UtilsTask.task(room.storage, "fillRes", undefined, {
                        resType: RESOURCE_ENERGY,
                    }))
                } else {
                    // 没有 storage 且塔已满：富余能量送去升级容器。
                    // 否则这些搬运会抱着 500 能量原地待机（实测同房常态 1~4 只），
                    // 而控制器容器空着、upgrader 在挨饿 —— 能量有、只是没人送。
                    let rest = StationUpgrade.generatorFillEnergyTask(room.name, creep.getPartCnt(CARRY) * 50);
                    if (rest.length > 0) creep.addTask(rest);
                }
            })

            workers.filter(e => !e.storeEmpty() && e.isFree()).forEach(creep => {
                if (StationHive.HiveNeedToFill(room)) {
                    creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                } else if (StationWork.constructionNeedBuild(creep.mainRoom()) && !room.isDownGrade()) {
                    creep.addTask(StationWork.generatorBuildTask(creep));
                } else {
                    creep.addTask(StationUpgrade.generatorUpgradeTask(room));
                }
            })
        }
    }
}


global.StrategyLowLevel = pro;
