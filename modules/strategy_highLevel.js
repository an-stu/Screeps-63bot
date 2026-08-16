/**
 * 在有 storage使用的策略
 */
let pro = {
    workerManager(room) {
        let spawnWorker = () => {
            let body = StationWork.getMiddleLevelWorkerBodyConfig(room);
            let partCnt = body.filter(e => e == WORK).length;
            let boostLevel = global.StationLab ? StationLab.boostAbleLevel(room, "build", partCnt, 1) : -1;
            let isBoost = room.creeps("carrier").length && boostLevel >= 0;
            if (LOCAL_SHARD_NAME == "6g3y-station") isBoost = false
            let task = []
            if (isBoost) task = StationLab.generatorBoostLevelTask(room, "build", partCnt, boostLevel)
            StationHive.trySpawn(room, room.name, body, "worker", task)
        }
        let spawnHighLevelWorker = () => {
            if (!global.StationLab) return spawnWorker();
            let body = StationWork.getHighLevelWorkerBodyConfig(room);
            let boostRes = { [BOOST_RES["build"][1]]: 30 * 30, [BOOST_RES["fatigue"][1]]: 10 * 30, [BOOST_RES["capacity"][1]]: 10 * 30 }
            if (body.filter(e => e == WORK).length != 30 || !StationLab.boostAble(room, boostRes) || room.creeps("carrier").length == 0)
                return spawnWorker();

            let task = StationLab.generatorBoostResTask(boostRes, room)
            StationHive.trySpawn(room, room.name, body, "worker", task)
        }
        let workerCount = room.creeps("worker", false).length;
        // Construction and rampart repair are background jobs, not a reason
        // to consume every idle Spawn in a high-stock room. Keep them bounded
        // so critical creeps and CPU remain available.
        let workerLimit = room.constructionSite.length
            // More builders are useful only for a genuinely large batch of
            // sites. Small incremental planner sites stay with one Worker.
            ? Math.min(3, 1 + Math.floor((room.constructionSite.length - 1) / 5))
            : StationDefense.getRepairWorkerLimit(room);
        let EnergyOver = workerCount < workerLimit;
        let noWorker = workerCount < 1;

        if (room.creeps("worker", false).length + room.creeps("carrier", false).length == 0) {// 或者爬都死光了
            spawnWorker();
        } else if (room.constructionSite.length) {//如果有工地也必生
            if (noWorker || (EnergyOver && !isSaveCpu)) // 如果一个都没有就生一个（保证有人去修工地,如果能量够可以多生几个
                spawnWorker();
            // add by an_w
            let num = room.constructionSite.length;
            if (room.creeps("worker", false).length < 3 && num >= 3 && room.level == 8) {// 如果一个都没有就生一个（保证有人去修工地,如果能量够可以多生几个
                spawnWorker();
            }
        } else if (StationDefense.needBuildWall(room) && !MIN_CPU) {//如果需要修墙
            if (room.level < 8 && (noWorker || EnergyOver)) { // 8前优先修墙，但受维修编制上限约束
                spawnWorker();
            } else if (((room.storage.store[RESOURCE_ENERGY] > 180000) && noWorker) || EnergyOver) {
                if (isSaveCpu) spawnHighLevelWorker();
                else spawnWorker();
                // spawnWorker();
            }
        }

        let minWorkerCnt = 0;
        let upgradeFlag = room.flags("repair").head();
        if (upgradeFlag && room.terminal && room.terminal.my) {
            let split = upgradeFlag.getNameSplit();
            if (split.length >= 2) minWorkerCnt = parseInt(split[2])
        }
        if (room.creeps("worker", false).length < minWorkerCnt) {
            spawnWorker();
        }

        // }else if(room.level==8&&(needRepairWalls||room.constructionSite.length)){
        //
        //     if(room.creeps("worker",false).length<1||room.constructionSite.length&&(room.storage.store[RESOURCE_ENERGY]-100000)/50000>room.creeps("worker",false).length) //如果有工地且能量够的情况
        //         spawnWorker();
        // }
        // if((room.constructionSite.length||needRepairWalls||room.creeps("worker",false).length+room.creeps("carrier",false).length==0)  // 有工地的时候在造worker 或者全死光了
        //     &&(room.creeps("worker",false).length<1||(room.storage.store[RESOURCE_ENERGY]-100000)/50000>room.creeps("worker",false).length)){
        //     spawnWorker();
        // }

        // 无 keeper 且 storage 告急时才让 worker 顶替挖矿填容器；
        // storage 有能量时 worker 走正常取货路径（优先取能量），不随便挖源、
        // 也不占容器格（避免卡死 keeper）。
        if (room.creeps("harvestEnergyKeeper").length == 0 && room.storage.store[RESOURCE_ENERGY] < 3000) {
            _.values(room.memory[StationSources.stationName]).filter(e => Game.getObjectById(e.id) && Game.getObjectById(e.id).energy).forEach(data => {
                if ((data["creeps"] || []).filter(e => Game.getObjectById(e)).length == 0 && room.creeps().filter(e => e.memory.role == "harvestEnergyKeeper").length == 0) {
                    let source = Game.getObjectById(data["id"]);
                    if (!source) return;
                    let posLen = source.pos.nearPos(1).filter(e => e.walkable()).length
                    let targetCnt = posLen * 1.5 - room.creeps("worker").filter(e => e.headTask() && e.headTask().id == data["id"]).length;
                    if (Math.min(6, Math.ceil(targetCnt)) > 0) {
                        let creep = room.creeps("worker").filter(e => e.storeEmpty() && e.isFree()).head()
                        if (creep) creep.addTask(StationSources.generatorReleaseAbleHarTask(data))
                    }
                }
            });
        }
    },
    unboostWorker(room, creep) {
        if (!global.StationLab) return;
        if (creep.memory.needUnboost === undefined) creep.memory.needUnboost = creep.body.filter(e => e.boost).length;
        if (creep.memory.needUnboost) {
            let tasks = StationLab.generatorUnboostTask(room);
            if (tasks.length) {
                creep.addTask(tasks);
            }
        }
    },
    workerManagerAfterCarrier(room) {
        // worker 核心工作
        let isCarryFree = room.creeps("carrier").filter(e => e.isFree()).length
        let StorageCarryEnergyTasks = StationCarry.generatorCarryStorageEnergyTask(room);
        let lowEnergyCarry = !room.creeps("carrier").length && StationSources.generatorCarryEnergyTask(room, StationHive.HiveNeedToFill(room) ? 1200 : 500)
        room.creeps("worker").filter(e => e.memory.tasks.length <= 1).forEach(creep => { // 优先 unboost 回收t2
            if (creep.ticksToLive < 80 && creep.memory.needUnboost === undefined)
                pro.unboostWorker(room, creep)
        })
        room.creeps("worker").filter(e => e.isFree()).forEach(creep => {
            if (creep.storeEmpty()) {
                if (creep.ticksToLive < 80 && creep.memory.needUnboost === undefined) {
                    pro.unboostWorker(room, creep)
                } else if (StorageCarryEnergyTasks.length > 0) {
                    creep.addTask(StorageCarryEnergyTasks)
                } else if (lowEnergyCarry && lowEnergyCarry.length) {
                    creep.addTask(lowEnergyCarry.pop())
                }
            } else {
                // hive 需要能量时 worker 自己优先填 spawn/extension（不依赖 carrier）
                if (StationHive.HiveNeedToFill(room)) {
                    creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                } else if (StationWork.constructionNeedBuild(creep.mainRoom()) && !room.isDownGrade()) {
                    creep.addTask(StationWork.generatorBuildTask(creep))
                } else if (StationDefense.needBuildWallWorkerFree(room) && !room.isDownGrade()) {
                    creep.addTask(StationDefense.generatorRepairTask(room))
                }
                else if (!StationDefense.needBuildWallWorkerFree(room) && room.level < 8) {
                    creep.addTask(StationUpgrade.generatorUpgradeTask(room));
                }
            }
        })
    },
    carrierOperatorBoost(room) {
        if (!global.StationLab) return;
        //boost lab 操作
        let freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.ticksToLive > 50 && e.store.getUsedCapacity() == 0);
        let task = StationLab.generatorOperatorBoostTask(room);
        if (task.length && freeCarries.length) freeCarries.pop().addTask(task);
        if (!freeCarries.length) return;

        // 填充lab能量
        task = StationLab.generatorFillEnergyTask(room)
        if (task.length && freeCarries.length) freeCarries.pop().addTask(task);
        if (!freeCarries.length) return;

        // lab 反应
        task = StationLab.generatorClearLabRes(room);
        if (task.length == 0) task = StationLab.generatorFillReactionTask(room);
        if (freeCarries.length && task.length) freeCarries.pop().addTask(task);
        if (!freeCarries.length) return;

    },
    carrierManager(room) {
        // 最高优先级：hive（spawn/extension）缺能时先扣住空闲 carrier 填 hive。
        // E53S21 恢复机制：link/tower/lab 等低优先级派发不得在 hive 缺口
        // 消除前抢跑，否则唯一 carrier 会被 link 整理任务拐走。
        let freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty());

        if (StationHive.HiveNeedToFill(room)) {
            // 已带能量的 carrier 直接填 hive
            room.creeps("carrier").filter(e => e.isFree() && !e.storeEmpty() && !e.storeContainsEnergyOtherResType()).forEach(creep => {
                creep.addTask(StationHive.generatorFillHiveTask(room, creep));
            });
            // 空手 carrier：只派够填 hive 缺口的数量
            let hiveFree = room.energyCapacityAvailable - room.getEnergyAvailable();
            while (hiveFree > 0 && freeCarries.length) {
                let creep = freeCarries.pop();
                creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                creep.addTask(UtilsTask.task(creep, "carryEnergyAuto", undefined, {allowStorage:true}));
                hiveFree -= creep.store.getCapacity(RESOURCE_ENERGY);
            }
            if (StationHive.HiveNeedToFill(room)) return;
            freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty());
        }

        pro.carrierOperatorBoost(room);
        freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty());

        let carryLinkTasks = StationSources.generatorCarryEnergyFromLinkTask(room); // 优先整理中央link的资源，这个最快
        if (carryLinkTasks.length && freeCarries.length) freeCarries.pop().addTask(carryLinkTasks)

        let FillPowerSpawnTasks = StationCarry.generatorFillPowerSpawnTask(room); // 保证烧power的速度
        // if(FillPowerSpawnTasks.length&&freeCarries.length)freeCarries.pop().addTask(FillPowerSpawnTasks)
        if (FillPowerSpawnTasks.length && freeCarries.length)
            freeCarries.pop().addTask(UtilsTask.task(room.powerSpawn, "fillPowerSpawnContinuous", "registerUsed"))

        /**
         * 优先填tower 和 ext
         * 如果填完后还有能量就放回storage
         */
        let fillTowerTasks = StationTower.generatorFillEnergyTasks(room)
        let StorageCarryEnergyTasks = StationCarry.generatorCarryStorageEnergyTask(room);

        if (fillTowerTasks.length) {
            // 填 tower：一只 carrier 一个 tower
            while (fillTowerTasks.length && freeCarries.length) {
                let creep = freeCarries.pop();
                creep.addTask(fillTowerTasks.shift());
                if (creep.storeEmpty() && StorageCarryEnergyTasks.length) creep.addTask(StorageCarryEnergyTasks);
            }
        }
        // hive（spawn/extension）不需要能量时，才把 carrier 的剩余能量放回 storage；
        // 否则能量优先喂 hive，避免 spawn/ext 饥饿导致无法产爬
        if (!StationHive.HiveNeedToFill(room)) {
            room.creeps("carrier").filter(e => !e.storeEmpty() && e.isFree()).forEach(e => e.fillAllMainRoomStorage())
        }

        // container 能量：按需派发——有多少个有能量的源容器 + terminal 超额，派多少只
        let emptyPool = room.creeps("carrier").filter(e => e.isFree() && e.ticksToLive > 50 && e.storeEmpty());
        if (room.creeps("harvestEnergyKeeper").length && room.link.length < 6 || room.level < 8) {// 必须要有挖矿的 和 6个 link才会不去搬运能量
            let availableLoads = [];
            if (room.memory[StationSources.stationName]) {
                _.values(room.memory[StationSources.stationName]).forEach(data => {
                    let c = Game.getObjectById(data["container"]);
                    if (c) availableLoads.push({ amount: c.store[RESOURCE_ENERGY] || 0, partial: false });
                });
            }
            let terminal = room.terminal;
            if (terminal && terminal.store[RESOURCE_ENERGY] > 50000) {
                availableLoads.push({ amount: terminal.store[RESOURCE_ENERGY] - 50000, partial: true });
            }
            // Prefer the largest carrier that can actually take a full load;
            // smaller carriers can still consume sources rejected by it.
            emptyPool.sort((a, b) => b.store.getCapacity(RESOURCE_ENERGY) - a.store.getCapacity(RESOURCE_ENERGY));
            for (let creep of emptyPool) {
                if (!availableLoads.length) break;
                let capacity = creep.store.getCapacity(RESOURCE_ENERGY);
                let sourceIndex = availableLoads.findIndex(source => source.partial ? source.amount > 0 : source.amount > capacity);
                if (sourceIndex < 0) continue;
                availableLoads.splice(sourceIndex, 1);
                creep.addTask(UtilsTask.task(creep, "carryEnergyAuto"));
            }
        }
        freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.ticksToLive > 50);

        // 捡起任务 9tick更新一次，比较耗时 缓存起来
        let pickTasks = pro.pickTasksMap[room.name] || []
        if ((Game.time + room.hashCode()) % 9 == 0) {
            onlyEnergy = false
            if (room.storage.store.getFreeCapacity() < 5000 && !room.terminal) {
                onlyEnergy = true
            }
            pickTasks = StationCarry.generatorPickTask(room, onlyEnergy).concat(StationMineral.generatorCarryMineralTask(room))
        }
        if (freeCarries.length && pickTasks.length) { freeCarries.pop().addTask(pickTasks.shift()); }
        pro.pickTasksMap[room.name] = pickTasks;


        if (StorageCarryEnergyTasks.length) {
            if (!freeCarries.length) return;

            // 分配升级的运送
            let task = StationUpgrade.generatorFillEnergyTask(room.name, freeCarries.head().getPartCnt(CARRY) * 50);
            if (freeCarries.length && task.length)
                freeCarries.pop().addTask(task);
            if (!freeCarries.length) return;

            //填权力巢
            if (freeCarries.length && task.length)
                freeCarries.pop().addTask(task);
            if (!freeCarries.length) return;

            //填核弹人
            task = StationCarry.generatorFillNukerTask(room);
            if (freeCarries.length && task.length)
                freeCarries.pop().addTask(task);
            if (!freeCarries.length) return;

            //填factory
            task = global.StationFactory ? StationFactory.generatorFillTask(room) : [];
            if (freeCarries.length && task.length)
                freeCarries.pop().addTask(task);
            if (!freeCarries.length) return;

            // let con = Game.getObjectById("6669490889bcac4cecd9c259")
            // resType = con.store.getResTypeList()[1]
            // if (resType) {
            //     let ops = { resType: resType, resCount: con.store.getUsedCapacity(resType) }
            //     task = [UtilsTask.task(con, "carryRes", "registerUsed", ops)]
            // }
            // if (freeCarries.length && task.length)
            //     freeCarries.pop().addTask(task);
            // if (!freeCarries.length) return;

            //填Terminal
            // task = StationCarry.generatorFillTerminalTask(room);
            // if (freeCarries.length && task.length)
            //     freeCarries.pop().addTask(task);
            // if (!freeCarries.length) return;

        }


    },
    pickTasksMap: {},
    trySpawnCarrier(room) { // 分配creep个数，最多7个，
        room.memory.carryBusy = room.memory.carryBusy || []
        if (!room.memory.carryBusy.length) room.memory.carryBusy = []
        let avgBusy = room.memory.carryBusy.sum() / room.memory.carryBusy.length
        // log(avgBusy,room.creeps("carrier",false).length,room.creeps("carrier",false).length*0.85)
        // 主房能量循环保护：storage 有能量但 spawn/extension 严重缺电时，
        // 无条件补 carrier（每 100 tick 至少补一只），否则主房永远起不来
        let capacity = room.energyCapacityAvailable || 0;
        let available = room.getEnergyAvailable();
        let deficit = Math.max(0, capacity - available);
        let storageEnergy = room.storage ? (room.storage.store[RESOURCE_ENERGY] || 0) : 0;
        let starved = storageEnergy > deficit && storageEnergy > 50000 && deficit > capacity * 0.3;
        let carrierList = room.creeps("carrier", false);
        let carrierCnt = carrierList.length;
        if (starved && carrierCnt <= 2 && (Game.time + room.hashCode()) % 100 == 0) {
            StationHive.trySpawn(room, room.name, StationCarry.getCarrierBodyConfig(room), "carrier", [])
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        if ((carrierCnt <= 0 && (room.storage.store[RESOURCE_ENERGY] > 3000 || room.creeps("harvestEnergyKeeper", false).length > 0)) || (
            carrierCnt <= 7 &&
            avgBusy > carrierList.filter(e => !e.ticksToLive || e.ticksToLive > e.body.length * 3).length * 0.85)) {
            StationHive.trySpawn(room, room.name, StationCarry.getCarrierBodyConfig(room), "carrier", [])
        }
        if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
        room.memory.carryBusy.push(room.creeps("carrier").filter(e => !e.isFree()).reduce((a) => a + 1, 0))
    },
    processPowerSpawn(room) {
        if (room.powerSpawn) {
            if (room.powerSpawn.store[RESOURCE_ENERGY] >= 50 && room.powerSpawn.store[RESOURCE_POWER] >= 1) {
                room.powerSpawn.processPower()
            }
        }
    },
    exec(room) {
        if (!MIN_CPU) pro.processPowerSpawn(room)// 每tick都要处理
        // Task assignment and spawn planning tolerate a short delay. Spreading
        // this expensive economy pass across rooms keeps ordinary ticks below
        // the shard's 20 CPU allowance without delaying tower defense.
        let economyInterval = MIN_CPU ? 10 : 7;
        if ((Game.time + room.hashCode()) % economyInterval != 0) return;
        if (global.ManagerAutoPlanner && isCpuFeatureEnabled("autoPlanner")) ManagerAutoPlanner.tryAutoBuildHighLevel(room);



        StationCarry.transformLink(room);
        // worker 优先 carrier 的事件
        pro.workerManager(room); // 包括了生爬逻辑
        pro.carrierManager(room);
        // 等搬运工搬运剩下的才让worker帮忙
        pro.workerManagerAfterCarrier(room);



        pro.trySpawnCarrier(room); // 一定要在carrierManager后面
        StationSources.trySpawnHarKeeper(room);
        // 主房 worker/carrier/keeper 优先占用 spawn 之后才轮到外矿，避免
        // 单 spawn 房被外矿抢占补员拖垮主房经济（旧顺序外矿最先，E53S21 崩盘根因之一）。
        if (global.StrategyOuterHarvest && isCpuFeatureEnabled("outerHarvest") && !room.flags("stopRemote").length) {
            HelperError.catchError(() => StrategyOuterHarvest.exec(room), room.name);
        }
        StationMineral.trySpawnHarKeeper(room);
        StationUpgrade.spawnUpgrader(room);


        //最后回收全部资源！
        // room.creeps("carrier").filter(e=>!e.storeEmpty()&&e.isFree()).forEach(e=>{
        //     e.fillAll(room.storage)
        // })


    }
}



global.StrategyHighLevel = pro;
