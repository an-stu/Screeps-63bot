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
    /**
     * 无 storage 的低级房：空手 worker 的**低门槛**取能流（0.78.322）。
     *
     * 为什么必须单独一条：本房 carry 门槛是 300（`carryMin`，为 2000 容量容器 +
     * 满装 carrier 定的），而 RCL4 的 worker 只有 250 容量、一趟取 100~200 就能
     * 开工。两条流共用 300 门槛时，carrier 每个 pass 会把 ≥300 的单子认领干净，
     * worker 永远排不上；而空手 worker 就算拿到 `buildConst` 也会被它自己的
     * `storeEmpty()` 当场弹掉（`buildConst` 只允许载货 worker 施工）。
     *
     * 实测 E47S29（shard2 / RCL4 / 无 storage）：4 个工地 10 分钟 0 进度
     * （其中一个 extension 恒 0/3000）、hive 1150/1150 顶格、塔 950/1000、
     * 3 只 worker 全程空手无任务，而两个源容器在 192~384 之间来回 —— 能量明明
     * 有，就是没有一条流能流到 worker 手里。
     *
     * 只在本房「没有 storage 且有工地」时启用（有 storage 的房走现成的
     * storage→工地链，不要在这里抢）；本 pass 已经派给 carrier 的容器要排除，
     * 否则两边奔同一个容器、后到的白跑一趟。
     */
    lowThresholdWorkerPickup(room, minEnergy = 100) {
        if (room.storage) return [];
        if (!room.constructionSite || !room.constructionSite.length) return [];
        const claimed = {};
        (room.creeps("carrier") || []).forEach(creep => {
            (creep.memory.tasks || []).forEach(task => {
                if (task && task.id) claimed[task.id] = 1;
            });
        });
        return StationSources.generatorCarryEnergyTask(room, minEnergy)
            .filter(list => list && list.length && !claimed[list[0].id]);
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
            if (Memory.crossShardBuilds && Memory.crossShardBuilds[room.name]) {
                // 援建房本地产爬停掉（用户政策），但**已在场的本地 worker 不能挂机**：
                // 空手去直采；满载按 hive > 工地 > 升级 的顺序分配（2026-11-18）。
                let localWorkers = room.creeps("worker");
                pro.assignDirectHarvest(room, pro.directHarvestSources(room), localWorkers);
                localWorkers.filter(e => e.isFree()).forEach(creep => {
                    if (creep.storeEmpty()) return;
                    if (StationHive.HiveNeedToFill(room)) creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                    else if (StationWork.constructionNeedBuild(room) && !room.isDownGrade()) creep.addTask(StationWork.generatorBuildTask(creep));
                    else creep.addTask(StationUpgrade.generatorUpgradeTask(room));
                });
                return;
            }
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
                            let spawnRoom = StationHive.getClosestSpawnRoom(room, 7, 5, 15)
                            if (!spawnRoom) {
                                return;
                            }
                            // 用户政策（2026-11-18）：出兵房按容量对应的 RCL<5 一律禁止
                            // 本地援建（小房出兵只能产小体型，援建统一走跨 shard）。
                            if (spawnRoom.name != room.name && (spawnRoom.level || 0) < 5) return;
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
            // 应急 worker 只在 worker 与 carrier 同时为零时生产；临时 hive 低能量
            // 不再触发小体型。能量够多大就用多大，避免 1W1C1M 长期占编制。
            if (!hasWorker && !room.creeps("carrier", false).length) {
                let rescueBudget = room.currentEnergyAvailable === undefined
                    ? room.getEnergyAvailable() : room.currentEnergyAvailable;
                if (rescueBudget >= 200) {
                    room.spawnFailure = false;
                    StationHive.trySpawn(room, room.name,
                        StationWork.getMiddleLevelWorkerBodyConfig(room, rescueBudget), "worker", []);
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
                // 体型与 keeper/carrier 同口径（用户 2026-11-18：援建体型派大一点）：
                // 只出**容量满配** worker（RCL4 = 6 组 WORK6/CARRY6/MOVE6 = 1200），
                // 付不起就等 hive 回满，不再按当 tick 余额缩成 800/400 的小工。
                // 空房救急仍走上面的 200 小 worker（那是唯一的例外）。
                let fullWorkerBody = StationWork.getMiddleLevelWorkerBodyConfig(room);
                let fullWorkerCost = Utils.getBodyEnergyNeed(fullWorkerBody);
                let workerBudget = room.currentEnergyAvailable === undefined
                    ? room.getEnergyAvailable() : room.currentEnergyAvailable;
                if (workerBudget >= fullWorkerCost) {
                    StationHive.trySpawn(room, room.name, fullWorkerBody, "worker", [])
                }
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
            let upgradeContainer = room.memory[StationUpgrade.stationName]
                && Game.getObjectById(room.memory[StationUpgrade.stationName][STRUCTURE_CONTAINER]);
            if ((!StationHive.HiveNeedToFill(room) || downgradeUrgent || room.isDownGrade()) && upgradeContainer) {
                let upgCnt = room.creeps("upgrader", false).length;
                let loadedFree = room.creeps("carrier").filter(e => e.isFree() && e.store[RESOURCE_ENERGY] > 0).length;
                // RCL4 后期结构建满、没有工地时，单只 upgrader 只有 ~10/tick，
                // 房间看起来「不动」。hive 满且升级容器有余量（>300）时允许第 2 只，
                // 把富余能量转成升级速度（用户 2026-11-18）；仍受 3 只上限与缺能闸约束。
                let surplus = !StationHive.HiveNeedToFill(room)
                    && (upgradeContainer.store[RESOURCE_ENERGY] || 0) > 300;
                if (upgCnt == 0 || (upgCnt < 3 && (upgCnt < loadedFree - 1 || (surplus && upgCnt < 2)))) {
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
            // 第三条出口（0.78.322）：上面两条都被 carrier 吃干净时，worker 用自己的
            // 100 门槛再取一次源容器 —— 没有它，工地会在「hive 顶格 + 源容器 200 上下」
            // 这种房里永久冻结（见 lowThresholdWorkerPickup 的注释）。
            const workerPickup = pro.lowThresholdWorkerPickup(room);
            workers.filter(e => e.storeEmpty() && e.isFree()).forEach(creep => {
                if (carryTasks.length) {
                    creep.addTask(carryTasks.pop())
                } else if (pickTasks.length) {
                    creep.addTask(pickTasks.shift())
                } else if (workerPickup.length) {
                    creep.addTask(workerPickup.pop())
                }
            })

            // Hive > 塔 > 升级容器。先给塔派单，避免每轮提前预留升级搬运把塔饿住。
            // 临近降级仍由 assignDowngradeProtection 保留直接升级的 worker。
            const fillTowerTasks = StationTower.generatorFillEnergyTasks(room);
            let upgradeConsidered = false;
            room.creeps("carrier").filter(e => !e.storeEmpty() && e.isFree()).forEach(creep => {
                if (StationHive.HiveNeedToFill(room)) {
                    creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                    return;
                }
                if (fillTowerTasks.length) {
                    creep.addTask(fillTowerTasks.shift());
                    return;
                }
                // 保留原来的余量去向：有 storage 时每轮最多派一只去升级容器。
                if (!room.storage || !upgradeConsidered) {
                    upgradeConsidered = true;
                    const task = StationUpgrade.generatorFillEnergyTask(room.name, creep.getPartCnt(CARRY) * 50);
                    if (task.length) {
                        creep.addTask(task);
                        return;
                    }
                }
                if (room.storage) {
                    creep.addTask(UtilsTask.task(room.storage, "fillRes", undefined, {resType: RESOURCE_ENERGY}));
                }
            });

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
