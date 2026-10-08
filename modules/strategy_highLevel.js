/**
 * 在有 storage使用的策略
 */

/**
 * 本房 storage 能量低于这个数就别再烧 powerSpawn（每 tick 50 energy 换 ops）。
 *
 * 为什么只看 **storage**、不看 terminal：terminal 里那部分是**市场储备**，
 * 不能拿来给「可选的能量消耗」背书。反例（2026-10-08 实测）：W33N55 的
 * storage 是 **0**，却因为在 terminal 里躺着 41636 而被账号级信号算成「充裕」，
 * 照样每 tick 烧 50 energy；同一时刻 E41S32 的 storage 只有 3077、
 * E41S23 只有 11901，12 个房的 powerSpawn 全在烧。
 *
 * 阈值取 3 万：与 StationHive.isEnergyAbundant 的账号级门槛同量级（它要求
 * 每个房 storage+terminal ≥ 4 万才敢开），略低一点是为了不把「本房 storage
 * 3 万、terminal 空」的房也一起停掉。可用 Memory.marketSettings.powerSpawnEnergyFloor
 * 覆盖。
 */
const POWER_SPAWN_ENERGY_FLOOR = 30000;

let pro = {
    workerManager(room) {
        // 空 hive 保护：hive 缺口大且可用能量很低时不再生 worker，
        // 把 spawn 能量留给 keeper 和 bootstrap carrier（E53S21 教训）。
        if (StationHive.HiveNeedToFill(room) && room.energyAvailable < 2500) return;
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
        // 但塔防/维修不能停：hive 缺口期间也预留一只 carrier 填塔，避免
        // tower 空能量、rampart 掉血无人修（E53S21 教训）。
        let freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty());
        let fillTowerTasks = StationTower.generatorFillEnergyTasks(room)
        let StorageCarryEnergyTasks = StationCarry.generatorCarryStorageEnergyTask(room);

        if (StationHive.HiveNeedToFill(room)) {
            // 已带能量的 carrier 直接填 hive
            room.creeps("carrier").filter(e => e.isFree() && !e.storeEmpty() && !e.storeContainsEnergyOtherResType()).forEach(creep => {
                creep.addTask(StationHive.generatorFillHiveTask(room, creep));
            });
            // 空手 carrier：只派够填 hive 缺口的数量；但至少留一只给塔
            let hiveFree = room.energyCapacityAvailable - room.getEnergyAvailable();
            // 只有至少 2 只空闲 carrier 时才预留 1 只给塔；只剩 1 只时
            // 必须优先填 hive，否则空 hive + 单 carrier 会永远去填塔（E53S21）。
            let towerReserve = fillTowerTasks.length && freeCarries.length >= 2 ? 1 : 0;
            let hiveCarries = Math.max(0, freeCarries.length - towerReserve);
            while (hiveFree > 0 && hiveCarries > 0) {
                let creep = freeCarries.pop();
                creep.addTask(StationHive.generatorFillHiveTask(room, creep));
                creep.addTask(UtilsTask.task(creep, "carryEnergyAuto", undefined, {allowStorage:true}));
                hiveFree -= creep.store.getCapacity(RESOURCE_ENERGY);
                hiveCarries--;
            }
            // 塔最低保障：只派一只，避免塔全空
            if (fillTowerTasks.length && freeCarries.length) {
                let creep = freeCarries.pop();
                creep.addTask(fillTowerTasks.shift());
                if (creep.storeEmpty() && StorageCarryEnergyTasks.length) creep.addTask(StorageCarryEnergyTasks);
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
        // 只把**真有搬运能力**的爬算进编制。hive 被抽干时 calcBodyPart 可能按
        // 剩余能量生成退化体型（连 CARRY 部件都没有），而它们照样带 role "carrier"
        // —— 实测 W33N55 三只 0 CARRY 容量的 "carrier" 把编制占满（目标 2 只/房），
        // 真搬运爬不再补员，hive 因此永远填不上（avail 1156 → 406 / 12900），
        // 于是 2600 能量的防守爬与 2500 能量的外矿搬运**永远付不起出兵能量**，
        // 整个外矿链被卡死。带着这种爬的编制数是假的，必须按部件过滤。
        let carrierList = room.creeps("carrier", false)
            .filter(e => !e.body || e.body.some(p => p.type == CARRY));
        let carrierCnt = carrierList.length;
        // keeper 先跑时，昂贵体型失败会把 spawnFailure 锁住整个 tick；
        // carrier 分支按当前真实可用能量重算，避免便宜的 bootstrap carrier 被挡住。
        let spawnCarrierNow = function (body) {
            // 退化体型保护：要造的是**搬运**爬，body 里连一个 CARRY 都没有时
            // 造出来只会占编制（见上面 carrierList 的注释：W33N55 三只 0 CARRY 的
            // "carrier" 把 hive 补给线彻底卡死）。宁可这一轮不补，等能量够了
            // 由后面按满配体型的几条分支来造。
            if (!body || !body.some(p => p === CARRY)) return;
            room.spawnFailure = false;
            room.currentEnergyAvailable = undefined;
            StationHive.trySpawn(room, room.name, body, "carrier", []);
        };
        // 目标 carrier 数量：高等级房保留 7 只上限；低等级房按矿点+keeper
        // 动态计算（E53S21: 2 矿点 + 2 keeper → 基础 2，hive 缺能时 +1）。
        let carrierTarget = 7;
        if (room.level < 8) {
            let sourceCnt = room.source ? room.source.length : 2;
            let keeperCnt = room.creeps("harvestEnergyKeeper", false).length;
            // 动态目标：基础按“矿点 + keeper”折半（E53S21: 2+2 → 2）；
            // hive 出现缺口时额外 +1（→3），缺口消除后自然回落到 2。
            // 不主动 recycle 超编 carrier，让多余的爬自然老死，避免浪费。
            carrierTarget = Math.max(2, Math.min(3, Math.ceil((sourceCnt + keeperCnt) / 2)));
            if (StationHive.HiveNeedToFill(room)) carrierTarget = Math.min(3, carrierTarget + 1);
        }
        else {
            // RCL8 大多通过 link 转运，固定 7 只只会让空闲 carrier 占着 spawn、
            // 吃掉本应留给 upgrader/keeper 的补员能量。
            //
            // 实测（10-04，13 个 L8 房）：**36 只 carrier 里 23 只没有任何任务**、
            // 全部 hive0（spawn/extension 满）—— 也就是 2 只就够，4~5 只纯属占着
            // CPU（每只 ~0.1 CPU/tick，而这正是 tick 超 20 的主因之一）。
            // 压到 2 只；link 少于 4 的房多留一只；hive 真的缺能时 +2
            //（下面几条紧急补员分支都按 carrierTarget 判，所以不会饿死主房）。
            carrierTarget = 2;
            if (room.link.length < 4) carrierTarget += 1;
            if (StationHive.HiveNeedToFill(room)) carrierTarget += 2;
        }
        // 死房自救：没有 carrier、hive 缺能、可用能量 ≤750 时每个 economy
        // pass 立即评估，不再受 %10 与 %7 对齐的偶发限制。
        // 有存量能量可搬 → 150 能量 bootstrap carrier（≤300）；
        // 没有存量能量 → 300 能量 worker 直接挖矿（保底预算 ≤300）。
        if (StationHive.HiveNeedToFill(room)
            && room.energyAvailable >= 150 && room.energyAvailable < 750) {
            // 可用存量 = terminal 全部 + storage 超过 2000 的部分 + container/link。
            // storage 只有几百能量时 carrier 取不出来，应改生 worker 挖矿。
            let terminalEnergy = room.terminal ? (room.terminal.store[RESOURCE_ENERGY] || 0) : 0;
            let storageUsable = room.storage ? Math.max(0, (room.storage.store[RESOURCE_ENERGY] || 0) - 2000) : 0;
            let containerEnergy = room.container.reduce((a, c) => a + (c.store[RESOURCE_ENERGY] || 0), 0);
            let linkEnergy = room.link.reduce((a, l) => a + (l.store[RESOURCE_ENERGY] || 0), 0);
            let haulableEnergy = terminalEnergy + storageUsable + containerEnergy + linkEnergy;
            let noEnergyProducer = room.creeps("harvestEnergyKeeper", false).length == 0
                && room.creeps("worker", false).length == 0;
            if (carrierCnt <= 0 && haulableEnergy > 0) {
                let bootBody = ManagerCreeps.calcBodyPart({ [CARRY]: 2, [MOVE]: 1 });
                spawnCarrierNow(bootBody);
            } else if (noEnergyProducer && haulableEnergy <= 0 && room.energyAvailable >= 200) {
                let workerBody = room.energyAvailable >= 300
                    ? ManagerCreeps.calcBodyPart({ [WORK]: 2, [CARRY]: 1, [MOVE]: 1 })
                    : ManagerCreeps.calcBodyPart({ [WORK]: 1, [CARRY]: 1, [MOVE]: 1 });
                let harData = _.values(room.memory[StationSources.stationName] || {}).find(d => d && d.id);
                let bootTasks = harData ? StationSources.generatorReleaseAbleHarTask(harData) : [];
                room.spawnFailure = false;
                room.currentEnergyAvailable = undefined;
                StationHive.trySpawn(room, room.name, workerBody, "worker", bootTasks);
            }
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        if (carrierCnt < carrierTarget && (Game.time + room.hashCode()) % 50 == 0
            && StationHive.HiveNeedToFill(room) && room.energyAvailable >= 750 && room.energyAvailable < 2500) {
            let emergencyBody = ManagerCreeps.calcBodyPart({ [MOVE]: 5, [CARRY]: 10 });
            spawnCarrierNow(emergencyBody);
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        // hive 缺口 + 能量已够满配 carrier：不等 avgBusy 门槛（空 hive 时
        // avgBusy 常年在 0.85 以下，单 carrier 永远等不到第二只）。
        if (carrierCnt < carrierTarget && (Game.time + room.hashCode()) % 25 == 0
            && StationHive.HiveNeedToFill(room) && room.energyAvailable >= 2500) {
            spawnCarrierNow(StationCarry.getCarrierBodyConfig(room));
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        if (starved && carrierCnt < carrierTarget && (Game.time + room.hashCode()) % 100 == 0) {
            spawnCarrierNow(StationCarry.getCarrierBodyConfig(room))
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        if ((carrierCnt <= 0 && (room.storage.store[RESOURCE_ENERGY] > 3000 || room.creeps("harvestEnergyKeeper", false).length > 0)) || (
            carrierCnt < carrierTarget &&
            !(StationHive.HiveNeedToFill(room) && room.energyAvailable < 2500) &&
            avgBusy > carrierList.filter(e => !e.ticksToLive || e.ticksToLive > e.body.length * 3).length * 0.85)) {
            spawnCarrierNow(StationCarry.getCarrierBodyConfig(room))
        }
        if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
        room.memory.carryBusy.push(room.creeps("carrier").filter(e => !e.isFree()).reduce((a) => a + 1, 0))
    },
    /**
     * 本房是否「有余力做可选的能量消耗」（只看本房 storage，见
     * POWER_SPAWN_ENERGY_FLOOR 的推导）。
     *
     * 与 StationHive.isEnergyAbundant 是两个层次：那个是**账号级**（含滞回，
     * 决定「整个号是不是宽裕」），这个是**本房级**。只判账号级会漏掉
     * 「账号宽裕但本房已经见底」——那正是 2026-10-08 用户报的
     * 「energy 过少的房间不要烧 power」。
     */
    roomEnergyAbundant(room) {
        if (!room || !room.storage) return false;
        let floor = Number(Memory.marketSettings && Memory.marketSettings.powerSpawnEnergyFloor)
            || POWER_SPAWN_ENERGY_FLOOR;
        return (room.storage.store[RESOURCE_ENERGY] || 0) >= floor;
    },
    processPowerSpawn(room) {
        // 50 energy/tick 换 ops 的优先级低于保能量，所以两道闸都要过：
        //   1. 账号级充裕（StationHive.isEnergyAbundant，自带滞回）
        //   2. **本房**有余力（roomEnergyAbundant）
        // 原来只有第 1 道，于是「账号充裕」就能让一个 storage 见底的房一直烧。
        if (!StationHive.isEnergyAbundant()) return;
        if (!pro.roomEnergyAbundant(room)) return;
        if (room.powerSpawn) {
            if (room.powerSpawn.store[RESOURCE_ENERGY] >= 50 && room.powerSpawn.store[RESOURCE_POWER] >= 1) {
                room.powerSpawn.processPower()
            }
        }
    },
    /**
     * 本房在这个 interval 内独占的槽位（0..interval-1）。
     *
     * 用己方房间列表的**序号取模**，让同一 tick 上跑经济 pass 的房间数稳定在
     * 房间总数/interval（13/7 ≈ 2），而不是随机 hashCode 撞车后一次跑 3~4 个。
     * 拿不到列表（特殊房、离线）时退回 hashCode，行为与改动前一致。
     */
    economySlot(room, interval) {
        let rooms = (global.ManagerRooms && ManagerRooms.getNormalRoom)
            ? ManagerRooms.getNormalRoom() : null;
        let idx = rooms ? rooms.indexOf(room) : -1;
        return idx >= 0 ? idx % interval : room.hashCode() % interval;
    },
    exec(room) {
        if (!MIN_CPU) pro.processPowerSpawn(room)// 每tick都要处理
        // Task assignment and spawn planning tolerate a short delay. Spreading
        // this expensive economy pass across rooms keeps ordinary ticks below
        // the shard's 20 CPU allowance without delaying tower defense.
        let economyInterval = MIN_CPU ? 10 : 7;
        // 经济 pass 按**房间序号**错峰，而不是按随机 hashCode。
        //
        // 原来 `(Game.time + room.hashCode()) % 7/10`：13 个房的随机哈希会互相撞车
        // （泊松聚集），某些 tick 上同时跑 3~4 个房的经济 pass。而经济 pass 是每 tick
        // 最大的单个可变成本（生爬规划 + 任务下发，1~3 CPU/房）—— 实测窗口均值 18.5
        // 却有 **37~52% 的 tick 超限**（双峰分布：低谷 ~15、尖峰 ~24），
        // 桶因此在 2000 附近反复被抽干。
        // 改成按「本房在己方房间列表里的序号」取槽位后，同一 tick 最多
        // 房间总数/interval（13/7 ≈ 2）个房跑 pass，方差显著变小。
        if (Game.time % economyInterval != pro.economySlot(room, economyInterval)) return;
        if (global.ManagerAutoPlanner && isCpuFeatureEnabled("autoPlanner")) ManagerAutoPlanner.tryAutoBuildHighLevel(room);



        StationCarry.transformLink(room);
        // 能量生产者最优先：先补 keeper（缺矿点/死光时），否则 carrier/worker
        // 会先把空 hive 的 spawn 能量吃光，keeper 永远 spawn 失败（E53S21）。
        StationSources.trySpawnHarKeeper(room);
        // worker 优先 carrier 的事件
        pro.workerManager(room); // 包括了生爬逻辑
        pro.carrierManager(room);
        // 等搬运工搬运剩下的才让worker帮忙
        pro.workerManagerAfterCarrier(room);



        pro.trySpawnCarrier(room); // 一定要在carrierManager后面
        // 主房 worker/carrier/keeper 优先占用 spawn 之后才轮到外矿，避免
        // 单 spawn 房被外矿抢占补员拖垮主房经济（旧顺序外矿最先，E53S21 崩盘根因之一）。
        if (global.StrategyOuterHarvest && isCpuFeatureEnabled("outerHarvest") && !room.flags("stopRemote").length) {
            HelperError.catchError(() => StrategyOuterHarvest.exec(room), room.name);
        }
        StationMineral.trySpawnHarKeeper(room);
        if (!(StationHive.HiveNeedToFill(room) && room.energyAvailable < 2500)) StationUpgrade.spawnUpgrader(room);


        //最后回收全部资源！
        // room.creeps("carrier").filter(e=>!e.storeEmpty()&&e.isFree()).forEach(e=>{
        //     e.fillAll(room.storage)
        // })


    }
}



global.StrategyHighLevel = pro;
