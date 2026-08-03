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

        if (room.storage.store[RESOURCE_ENERGY] < 3000) {
            _.values(room.memory[StationSources.stationName]).filter(e => Game.getObjectById(e.id).energy).forEach(data => {
                if (data["creeps"].filter(e => Game.getObjectById(e)).length == 0 && room.creeps().filter(e => e.memory.role == "harvestEnergyKeeper").length == 0) {
                    let posLen = room[data["id"]].pos.nearPos(1).filter(e => e.walkable()).length
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
                if (room.creeps("carrier", false).length == 0 && !isCarryFree && StationHive.HiveNeedToFill(room)) {
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
        pro.carrierOperatorBoost(room);

        let freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty());

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

        if (StorageCarryEnergyTasks.length) {
            room.creeps("carrier").filter(e => e.isFree() && !e.storeContainsEnergyOtherResType()).forEach(creep => {
                if (StationHive.HiveNeedToFill(room)) {
                    creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                    if (creep.storeEmpty()) creep.addTask(StorageCarryEnergyTasks);
                } else if (fillTowerTasks.length) {
                    creep.addTask(fillTowerTasks.shift())
                    if (creep.storeEmpty()) creep.addTask(StorageCarryEnergyTasks);
                }
            })
        }
        room.creeps("carrier").filter(e => !e.storeEmpty() && e.isFree()).forEach(e => e.fillAllMainRoomStorage())

        // container 能量
        freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.ticksToLive > 50); // 从这里开始下面的任务最好大于150ttl
        if (room.creeps("harvestEnergyKeeper").length && room.link.length < 6 || room.level < 8) {// 必须要有挖矿的 和 6个 link才会不去搬运能量
            carryLinkTasks = StationSources.generatorCarryEnergyTask(room);
            carryLinkTasks.forEach(e => {
                if (freeCarries.length) { freeCarries.pop().addTask(e); }
            })
        }

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

        if ((room.creeps("carrier", false).length <= 0 && (room.storage[RESOURCE_ENERGY] > 3000 || room.creeps("harvestEnergyKeeper", false).length > 0)) || (
            room.creeps("carrier", false).length <= 7 &&
            avgBusy > room.creeps("carrier", false).filter(e => !e.ticksToLive || e.ticksToLive > e.body.length * 3).length * 0.85)) {
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
        let economyInterval = MIN_CPU ? 10 : 5;
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
        StationMineral.trySpawnHarKeeper(room);
        StationUpgrade.spawnUpgrader(room);


        //最后回收全部资源！
        // room.creeps("carrier").filter(e=>!e.storeEmpty()&&e.isFree()).forEach(e=>{
        //     e.fillAll(room.storage)
        // })


    }
}



global.StrategyHighLevel = pro;
