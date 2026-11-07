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
 * ⚠️ 阈值从 3 万抬高到 **10 万**（2026-11-07，用户问「worker 为什么挂机」的排查结论）：
 * 原来的 3 万是 10-08「防饿死房」时代定的，后来修墙闸（StationDefense.repairWallEnergyFloor
 * 默认 10 万，storage 单口径）抬高时没有同步 —— 于是出现一条 **3 万~10 万的窗口带**：
 * 账号充裕 + storage 9.7 万 ⇒ 烧 power 照常（≥3 万），修墙闸却关着（<10 万）⇒
 * worker 生出来无活可干。E41S23 实测：power spawn -48 energy/tick > 全房净收入
 * ~20/tick，storage 在 10 万闸门附近锯齿震荡，worker「生→闲置→回收」循环。
 * 现在默认取 `StationDefense.repairWallEnergyFloor`（与修墙储备**同源**），
 * Memory.marketSettings.powerSpawnEnergyFloor 仍可显式覆盖。
 */
const POWER_SPAWN_ENERGY_FLOOR = 100000;

/**
 * 本房没有可花的能量时**不生 worker**（用户 10-11 指示：「有的主房间没有能量
 * 就不要生产 worker 了，也用不了」）。
 *
 * worker 的活 —— 建造 / 修墙 / 升级 / 送资源 —— **每一步都要耗能量**：
 * 房间没能量时生出来确实干不了活，还要和 spawn / keeper 抢那点存货。
 *
 * 判据两条，满足其一即可：
 *   1. **本房有收入**（还活着 keeper 在挖）→ worker 有能量可花，不算「用不了」；
 *   2. 否则看存量，阈值 `WORKER_ENERGY_FLOOR`（只看 storage —— terminal 是市场
 *      储备，不给可选消耗背书，见 POWER_SPAWN_ENERGY_FLOOR 的推导）。
 * 可用 `Memory.marketSettings.workerEnergyFloor` 覆盖。
 *
 * ⚠️ **「死房自救」那条路刻意不受影响**：`workerManagerAfterCarrier` 里生的是
 * **直接去挖矿**的 worker（它自己就是能量来源，产出是能量本身），
 * 拿存量当门槛会把死房永久锁死。
 */
const WORKER_ENERGY_FLOOR = 10000;

let pro = {
    /**
     * 「本房还在长（RCL<8），却一只 upgrader 都没有」—— 单 spawn 房退化态守卫。
     *
     * 这不是「谁先吃 spawn」的顺序问题，而是**退化态下必须先救生长**：
     * 一个还在升级的房，upgrader 是它**唯一**的能量出口（其余全是 hive/容器/storage
     * 这种无限下沉）。一旦这个出口断了，挖出来的能量就只能在源容器/link 里堆满、
     * 溢出到地面衰减 —— 整个房的经济空转。
     *
     * 2026-11-05 W26N58（RCL6，单 spawn，hive 2,300）实测：
     *   · 两个源容器 2,000/2,000 全满、三个 link 全满、地面 8,356 在涨；
     *   · 控制器 0 只 upgrader；`stationUpgrade.creeps` 为空；
     *   · 经济 pass 的 spawn 队列（`__ts` 埋点，tick 84082272）：
     *     worker(33 部件/2,200 能量) → outerHarvestEnergyCarrier×4(1,050) → upgrader(2,100)。
     *     前者把 2,300 的 hive 一次抽到 100，随后 spawn 被占 99 tick；
     *     接下来几 pass hive 只有 114 / 1,350 / 2,050，而 spawn 一直在孵 →
     *     upgrader 每次都因 `spawnFailure`/占用失败。**队列里排在它前面的
     *     全是后台/可选岗位**（修墙 worker、外矿搬运），它是唯一没人管的。
     *
     * 所以只在**退化态**（0 只 upgrader，且 RCL<8）把可选岗位的补员暂停，
     * 让 spawn 空出来的第一个窗口归 upgrader；一孵出来本守卫立即失效（自清）。
     * 在役的爬一律不动（岗位闸门只控数量，不控在职者干不干活），keeper /
     * 本房 carrier 这两条「主房能量循环」也**不**经过这里。
     */
    upgraderStarved(room) {
        if (!room || !room.my || !room.controller) return false;
        if (room.level >= 8) return false;          // RCL8 不再长，upgrader 只是维持项
        return room.creeps("upgrader", false).length === 0;
    },
    /**
     * 本 tick 还能花在孵化上的能量 —— **体型预算必须以它为准**，不能按本房满容量算。
     *
     * `StationHive.trySpawn` 的判据是
     * `if (room.currentEnergyAvailable < spend) { room.spawnFailure = true; return undefined }`
     * 也就是「付不起就静默放弃」，从外面看和「闸门没通过」一模一样；更糟的是
     * `spawnFailure` 是整 tick 的粘滞标记，本房孵化的**后续**尝试（carrier、外矿搬运）
     * 会被一起吞掉。2026-11-01 W26N58（RCL6、容量 2,300、hive 在 600~1,750 之间被
     * 反复抽干）就是这样：worker/carrier 的体型按 2,300 算，付不起 ⇒ 一次都不生。
     *
     * `room.currentEnergyAvailable` 是本 tick 的孵化预算缓存（首个 trySpawn 初始化、
     * 每次成功孵化扣减；Room 对象每 tick 重建，所以它天然按 tick 复位）。
     * 取它和实时能量的**小值**，再不超本房容量。
     */
    spawnTickBudget(room) {
        let cached = room.currentEnergyAvailable === undefined
            ? room.energyAvailable
            : Math.min(room.energyAvailable, room.currentEnergyAvailable);
        // 真机 Room 一定有这个方法；VM 桩里可能只给了属性（同站内其它地方的写法）。
        let cap = room.getEnergyCapacityAvailable
            ? room.getEnergyCapacityAvailable()
            : (room.energyCapacityAvailable || 0);
        return Math.max(0, Math.min(cap, cached));
    },
    workerManager(room) {
        // 空 hive 保护：hive 缺口大且可用能量很低时不再生 worker，
        // 把 spawn 能量留给 keeper 和 bootstrap carrier（E53S21 教训）。
        //
        // ⚠️ 门槛按**本房容量**折算，不能写死 2,500 —— 那是 RCL8（12,900）的量级，
        // 对 cap ≤ 2,500 的 RCL5/6 房它恒真（hive 满格也只有 1,800 / 2,300），
        // 等于「hive 一缺能就永远不生 worker」，RCL6 房连自己的工地都盖不动
        // （与 2026-11-01 upgrader 那个坑同一形态，见 MEMORY 第 16 条）。
        if (StationHive.HiveNeedToFill(room)
            && room.energyAvailable < Math.min(2500, room.energyCapacityAvailable * 0.5)) return;
        // 本房根本没能量可花 → 不生 worker（见 WORKER_ENERGY_FLOOR 的说明）
        if (!pro.workerHasEnergyToSpend(room)) return;
        // **修墙爬不强化**（用户 11-03：修墙不需要满 boost，CPU 足够时用非 boost 爬，
        // 参考 Overmind —— 常规工地/修墙是后台工作，boost 化合物留给战斗与 upgrade
        // 高价值场景）。只有 isSaveCpu（少爬多活降 CPU）时才走强化路径。
        let spawnWorker = (noBoost) => {
            // 体型按「本 tick 付得起」定（见 spawnTickBudget）：按满容量算的体型在
            // hive 未满时会被 trySpawn 静默吞掉，还会把 spawnFailure 置真挡住后面的
            // carrier / 外矿补员。
            let body = StationWork.getMiddleLevelWorkerBodyConfig(room, pro.spawnTickBudget(room));
            let partCnt = body.filter(e => e == WORK).length;
            let boostLevel = noBoost ? -1 : (global.StationLab ? StationLab.boostAbleLevel(room, "build", partCnt, 1) : -1);
            let isBoost = !noBoost && room.creeps("carrier").length && boostLevel >= 0;
            if (LOCAL_SHARD_NAME == "6g3y-station") isBoost = false
            let task = []
            if (isBoost) task = StationLab.generatorBoostLevelTask(room, "build", partCnt, boostLevel)
            StationHive.trySpawn(room, room.name, body, "worker", task)
        }
        let spawnHighLevelWorker = () => {
            if (!global.StationLab) return spawnWorker();
            let body = StationWork.getHighLevelWorkerBodyConfig(room, pro.spawnTickBudget(room));
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
        } else if (StationDefense.needBuildWall(room) && !MIN_CPU && !pro.upgraderStarved(room)) {
            // 修墙是后台的「无限下沉」：RCL6 的修墙 worker 体型（33 部件 / 2,200 能量）
            // 会把 2,300 的 hive 一次抽到 100，并占住 spawn 99 tick。所以
            // 「本房一只 upgrader 都没有」时先不派它（见 `upgraderStarved` 的实测）。
            if (room.level < 8 && (noWorker || EnergyOver)) { // 8前优先修墙，但受维修编制上限约束
                spawnWorker(true); // 修墙不强化（CPU 足够时用非 boost 爬）
            } else if (((room.storage.store[RESOURCE_ENERGY] > 180000) && noWorker) || EnergyOver) {
                if (isSaveCpu) spawnHighLevelWorker();
                else spawnWorker(true); // 修墙不强化
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
    /**
     * 本房 worker 取到能量之后**还有没有下家**（2026-11-03）。
     *
     * 旧代码给空手 worker **无条件**发「从 storage 取能量」的任务
     * （`StorageCarryEnergyTasks`），但取完之后有没有活干是另一回事。
     * RCL8 房在「hive 满 + 0 工地 + 修墙被能量闸挡住（storage 能量低于
     * `StationDefense.repairWallEnergyFloor`）+ 等级 8 已不能再升级」时，
     * `workerManagerAfterCarrier` 的四条出路**全不成立** ⇒ 车取满 1,500 能量
     * 站在原地把 ttl 站完（实测 W33N55 (22,32) 1,500/1,500、W34N52 (37,18)
     * 1,500/1,500，连续 70+ tick 同一格、`memory.tasks` 恒 []，还会随时间反复出现）。
     *
     * 判据与「有货」分支的四条出路**逐条同源**：只改一边就会变成
     * 「取货有门、卸货无门」或反过来（MEMORY 第 14 条）。
     */
    workerHasConsumer(room, creep) {
        if (!room) return false;
        if (StationHive.HiveNeedToFill(room)) return true;      // 填 spawn/extension
        if (room.isDownGrade()) return false;                   // 不能升级，也不该再搬
        if (room.level < 8) return true;                        // 还能拿去升级
        let mainRoom = creep && creep.mainRoom ? creep.mainRoom() : room;
        if (mainRoom && StationWork.constructionNeedBuild(mainRoom)) return true;
        return !!StationDefense.needBuildWallWorkerFree(room);
    },
    /**
     * 「要么别生，生了必须全程工作」（用户 2026-11-07）—— 空闲 worker 回收判据。
     *
     * workerManagerAfterCarrier 的空手出口链（storage 取能 / 无 carrier 挖源 /
     * 填塔 / 源容器直运）全不成立时，空手 worker 会从出生站到老死（E41S23
     * shard3_84111958_1 实测：满 boost 高级 worker、tasks 恒 []、storage 卡在
     * 修墙地板闸下方 1,329）。与其养一只终生不干活的爬，不如退回 spawn：
     * recycleCreep 动作自带 ttl<700 先 unboost 回收化合物，再 recycle 返还部分
     * 孵化能量；等真有活（工地/修墙越过能量闸/塔 <600/容器积压）时
     * workerManager 的既有闸门会重新孵化。
     *
     * 850 tick 迟滞：既给「storage 在地板闸附近震荡」留出回升窗口（防
     * 回收→重孵抖动），又保证从出生就闲置的爬到回收时 ttl = 1500-850 = 650 < 700，
     * recycleCreep 里的 unboost 门槛必然命中，化合物不浪费。
     * 两类豁免：repair 旗（旗子编制是用户明确要人，回收会与孵化互相打架）；
     * 无 carrier 且这是唯一 worker（空房 bootstrap 独苗，回收等于杀经济）。
     */
    shouldRecycleIdleWorker(room, creep) {
        if (!creep.memory.idleSince) return false;
        if (Game.time - creep.memory.idleSince < 850) return false;
        if (room.flags("repair").length) return false;
        if (!room.creeps("carrier").length && room.creeps("worker").length <= 1) return false;
        return true;
    },
    workerManagerAfterCarrier(room) {
        // worker 核心工作
        let StorageCarryEnergyTasks = StationCarry.generatorCarryStorageEnergyTask(room);
        let lowEnergyCarry = !room.creeps("carrier").length && StationSources.generatorCarryEnergyTask(room, StationHive.HiveNeedToFill(room) ? 1200 : 500)
        // 空手 worker 的两个兜底出口任务源。塔任务由同 pass 的 carrierManager
        // 算好存在 room._fillTowerTasks（room 对象每 tick 重建，无脏缓存）；
        // 直运门槛 1200 与 carrierManager 派车门槛（容量×0.75）互补，容器
        // 1200~75% 区间归 worker，靠 room.used 每 tick 去重不撞车。
        let towerFillTasks = room._fillTowerTasks !== undefined ? room._fillTowerTasks
            : (global.StationTower ? StationTower.generatorFillEnergyTasks(room) : []);
        let idleShuttleTasks = StationSources.generatorCarryEnergyTask(room, 1200);
        room.creeps("worker").filter(e => e.memory.tasks.length <= 1).forEach(creep => { // 优先 unboost 回收t2
            if (creep.ticksToLive < 80 && creep.memory.needUnboost === undefined)
                pro.unboostWorker(room, creep)
        })
        room.creeps("worker").filter(e => e.isFree()).forEach(creep => {
            if (creep.storeEmpty()) {
                if (creep.ticksToLive < 80 && creep.memory.needUnboost === undefined) {
                    pro.unboostWorker(room, creep)
                } else if (StorageCarryEnergyTasks.length > 0 && pro.workerHasConsumer(room, creep)) {
                    // 没有下家就别去 storage 取：取了只能站着（见 workerHasConsumer）
                    creep.addTask(StorageCarryEnergyTasks)
                } else if (lowEnergyCarry && lowEnergyCarry.length) {
                    creep.addTask(lowEnergyCarry.pop())
                } else if (towerFillTasks.length && StorageCarryEnergyTasks.length) {
                    // 填塔兜底：塔 <600 有真实缺口。任务栈是 LIFO（后 add 先执行），
                    // 先压填塔、再压取能 ⇒ 先取能、到塔再 fillRes（与 carrierManager
                    // 给 carrier 的配对完全一致）。
                    creep.addTask(towerFillTasks.shift());
                    creep.addTask(StorageCarryEnergyTasks);
                } else if (idleShuttleTasks.length) {
                    // 源容器直运兜底：容器积压且本 tick 没被 carrier 认领。
                    // 取回后 loaded 分支四条出路全不成立 ⇒ fillAllMainRoomStorage 自动倒库
                    creep.addTask(idleShuttleTasks.pop())
                } else {
                    // 终极兜底（用户 2026-11-07「要么别生，生了必须全程工作」）：
                    // 所有出口全关的空手 worker，空闲满 850 tick 回收（见
                    // shouldRecycleIdleWorker 的迟滞与豁免说明）。
                    if (!creep.memory.idleSince) creep.memory.idleSince = Game.time;
                    if (pro.shouldRecycleIdleWorker(room, creep)) creep.addTask([UtilsTask.taskData("recycleCreep")]);
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
                // 兜底出口：RCL8 + 无工地 + 修墙被能量闸挡住 ⇒ 上面四条全不成立，
                // 载货 worker 会原地站到老死（能量随尸体消失）。倒回 storage/terminal
                // 是唯一有意义的出口；这里 hive 已经满了，不违反「hive 永远第一」。
                // 取货侧已被 workerHasConsumer 挡住，所以不会「取—倒」来回打乒乓。
                if (creep.isFree() && !creep.storeEmpty()) creep.fillAllMainRoomStorage();
            }
            if (!creep.isFree()) delete creep.memory.idleSince; // 拿到活就清空闲计时
        })
    },
    /**
     * 容器清理：**非矿物容器应当只装能量**。
     *
     * 用户 2026-10-16：「有部分 container 里面不止有一种东西，把 container 清理一下，
     * 多余的搬到 storage。source 旁边的应该只有能量。」
     * 实测混进来的三种来源：
     *   · 强化化合物 GO/KO/ZH/UH/OH —— boost 流程的残留
     *   · biomass —— deposit 采集的残留
     *   · power —— 打完 powerBank 收回来的
     * **矿物容器豁免**（StationMineral 登记的那个）—— 矿物本来就该在那里等运矿车。
     *
     * 一轮只派一只 carrier 清一个容器：这是收尾活儿，不能把运力从能量搬运上抽走，
     * 所以先 pop 一只空闲 carrier、没活儿再放回去。
     */
    cleanDirtyContainers(room, freeCarries) {
        if (!room.storage || room.storage.store.getFreeCapacity() == 0) return;
        if (!freeCarries || !freeCarries.length) return;
        let mineral = room.memory[StationMineral.stationName];
        let mineralContainer = mineral && mineral.container;
        let mineralRes = mineral && mineral.resType;
        let carrier = freeCarries.pop();
        // ⚠️ 用 `room.container`（`极致建筑缓存` 的类型 getter，命中缓存）而**不是**
        // `room.find(FIND_STRUCTURES, {filter:...})`：2026-10-19 实测 13 个房
        //   room.container          0.050 CPU
        //   find + filter           0.789 CPU   ← 15 倍
        // 这个清理每 tick 每房都跑，用慢写法等于白烧 ~0.7 CPU/tick。
        // 容器建成后极少变动，getter 即使晚一两 tick 也不影响清理语义。
        let containers = room.container
            || room.find(FIND_STRUCTURES, { filter: e => e.structureType == STRUCTURE_CONTAINER });
        for (let c of containers) {
            let dirty = _.keys(c.store).filter(r => {
                if (r == RESOURCE_ENERGY || !(c.store[r] > 0)) return false;
                // 矿物容器**不是整个豁免**，它只允许装「自己那种矿物」（+能量）：
                // 实测 E49S31 的矿物容器里躺着 power x100、W31N55 里混了 GH x25，
                // 这些照样是多余的，一样要搬走。
                if (c.id == mineralContainer && r == mineralRes) return false;
                return true;
            });
            if (!dirty.length) continue;
            // 逐种资源 withdraw 出来，再统一灌进 storage/terminal（fillAllMainRoomStorage）
            carrier.addTask(dirty.map(r => UtilsTask.task(c, "carryRes", "registerStationCarryDrop", { resType: r })));
            carrier.fillAllMainRoomStorage();
            return;
        }
        freeCarries.push(carrier);   // 没有脏容器 ⇒ 把 carrier 还回去
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
    /**
     * 带**非能量**货物（矿物 / 化合物 / 复合货）的空闲 carrier，无条件倒回 storage。
     *
     * 为什么必须无条件（2026-11-01 E48S41 实测）：
     *   · hive 缺能分支只收 `!storeContainsEnergyOtherResType()` 的爬 —— 抱着 O 的
     *     不能填 hive（会把矿物塞进 spawn/extension），被排除是对的；
     *   · 而唯一的「倒进 storage」出口（carrierManager 里 `if (!HiveNeedToFill)`）
     *     **挂在 hive 吃饱这个前提上** ⇒ hive 长期缺能期间，这只爬两条路都进不去，
     *     `memory.tasks` 恒空，被**永久钉死**（不是"没活干"，是"它自己就是活"）。
     *   现场：carrier 抱 1650 O 在 (16,45) 站了 200+ tick（ttl 1035→903），
     *   E48S41 因此只剩 1 只可用搬运 ⇒ hub link 卡 776、两个矿点 link 800/800 +
     *   容器 2000/2000 全满 ⇒ keeper 满仓只能往地上倒（地面掉落 ~20/tick 递增，
     *   全账号唯一一例，见 2026-11-01 巡检）。
     *
     * 与「hive 永远第一」不冲突：这只爬本来就载不了能量，倒货不会抢走填 hive 的运力。
     */
    dumpNonEnergyCargo(room) {
        room.creeps("carrier")
            .filter(e => e.isFree() && !e.storeEmpty() && e.storeContainsEnergyOtherResType())
            .forEach(e => e.fillAllMainRoomStorage());
    },
    carrierManager(room) {
        // 先把「载着非能量货的空转搬运」放出去（见 dumpNonEnergyCargo）。
        // 必须放在 hive 分支**之前**：hive 缺能时该分支会 `return`，错过就再也轮不到。
        pro.dumpNonEnergyCargo(room);
        // 最高优先级：hive（spawn/extension）缺能时先扣住空闲 carrier 填 hive。
        // 但塔防/维修不能停：hive 缺口期间也预留一只 carrier 填塔，避免
        // tower 空能量、rampart 掉血无人修（E53S21 教训）。
        let freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty());
        let fillTowerTasks = StationTower.generatorFillEnergyTasks(room)
        room._fillTowerTasks = fillTowerTasks; // 同 pass 的 workerManagerAfterCarrier 复用，免得算两遍
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
                let sourceIndex = availableLoads.findIndex(source => source.partial ? source.amount > 0 : source.amount > capacity * 0.75);
                if (sourceIndex < 0) continue;
                availableLoads.splice(sourceIndex, 1);
                creep.addTask(UtilsTask.task(creep, "carryEnergyAuto"));
            }
        }
        freeCarries = room.creeps("carrier").filter(e => e.isFree() && e.ticksToLive > 50);
        // 容器清理：把混进来的非能量搬回 storage（见 pro.cleanDirtyContainers）。
        // 放在这里是因为 freeCarries 刚算好，且本函数就是 room 级的运力调度点。
        pro.cleanDirtyContainers(room, freeCarries);

        // 捡起任务 9tick更新一次，比较耗时 缓存起来
        let pickTasks = pro.pickTasksMap[room.name] || []
        if ((Game.time + room.hashCode()) % 9 == 0) {
            let onlyEnergy = false
            if (room.storage.store.getFreeCapacity() < 5000 && !room.terminal) {
                onlyEnergy = true
            }
            pickTasks = StationCarry.generatorPickTask(room, onlyEnergy).concat(StationMineral.generatorCarryMineralTask(room))
        }
        if (freeCarries.length && pickTasks.length) { freeCarries.pop().addTask(pickTasks.shift()); }
        pro.pickTasksMap[room.name] = pickTasks;


        // 分配升级的运送 —— **必须放在 StorageCarryEnergyTasks 门之外**。
        //
        // 2026-10-23 实测 W26N58（RCL4、刚建好 storage、还没有 link）：
        // hive 已满（1300/1300）而房内无 link ⇒ `generatorCarryStorageEnergyTask`
        // 返回空 ⇒ 下面整段 `if (StorageCarryEnergyTasks.length)` 被跳过 ⇒
        // 升级容器长期 0/2000、upgrader 站在上面抱着 0 能量（ttl 只剩 220）、
        // 控制器进度冻结在 115,043 二十多个 tick。这已经是同一类问题第三次出现
        // （前两次在 strategy_lowLevel：塔抢走搬运、填充排在后面）。
        //
        // `fillRes` 自带「空手先去 storage 取货」的分支（prototype_creep.js:626），
        // 所以这里给空手搬运也有效。
        if (freeCarries.length) {
            // 同上：先取承运爬再按它的容量预订
            let carrier = freeCarries.pop();
            let upgFill = StationUpgrade.generatorFillEnergyTask(room.name, carrier.getPartCnt(CARRY) * 50);
            if (upgFill.length) carrier.addTask(upgFill);
        }

        if (StorageCarryEnergyTasks.length) {
            if (!freeCarries.length) return;

            //填核弹人
            let task = StationCarry.generatorFillNukerTask(room);
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
            // **不要清 `room.currentEnergyAvailable`。** 它是本 tick 的孵化预算缓存
            // （首个 trySpawn 初始化、每次成功孵化扣减），而 `room.energyAvailable`
            // 在同一 tick 内**不会**反映刚花掉的能量（2026-11-05 W26N58 实测：
            // 孵完 2,200 的 worker 之后读回仍是 2,300）。把它清成 undefined，
            // 下一次 trySpawn 就会用满格的旧值重算体型 —— 实测同一 pass 里
            // upgrader 据此算出 2,100 的体型去要 spawn，而实际只剩 100 能量，
            // 白占一个 pass 还把 `spawnFailure` 置真。这里只需要解除上一轮的
            // 「付不起」粘滞标记，预算本身必须保留。
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
            // **没有升级 link 的房（RCL4~5）编制 +1。**
            // 这类房的控制器容器只能靠 carrier 一趟趟送，而 hive/storage 都是
            // 无限下沉；实测 2026-10-23 W26N58：只剩 1 只 carrier 的那段时间
            // （另一只刚死、替补还在孵）控制器容器一直是 0，进度冻结 40+ tick，
            // 补到 2 只立刻恢复到 10/tick。留一只冗余，避免运力被单点卡死。
            let upgLink = room.memory[StationUpgrade.stationName]
                && Game.getObjectById(room.memory[StationUpgrade.stationName][STRUCTURE_LINK]);
            if (!upgLink) carrierTarget = Math.min(4, carrierTarget + 1);
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
            // 用户 2026-10-26：「允许收到 2，但注意房间运营不要出问题」。
            carrierTarget = 2;
            if (room.link.length < 4) carrierTarget += 1;
            // hive 缺能才加编，而且要**真的缺**（缺口 > 容量 30%）**并且**现有搬运
            // 基本都在忙，才 +2。
            //
            // 原来的写法只看 `HiveNeedToFill`（= 没满）就 +2，而活跃房里 hive
            // 几乎总是「没满」（spawn/upgrader 一直在抽），于是目标常年 4；
            // 加上没有回收机制（多余爬只能自然老死），形成
            // 「加编 → 老死 → 再加编」的棘轮 —— 实测 2026-10-26：44 只搬运里
            // **17 只空闲且空手**，而 13 个 L8 房的 carrierTarget 常态只有 2。
            // 收紧后：常态 2；hive 真被抽干且运力打满时才临时 4，缺口一平就回落。
            if (StationHive.HiveNeedToFill(room)) {
                let cap = room.energyCapacityAvailable || 0;
                let deficit = Math.max(0, cap - room.getEnergyAvailable());
                let busyCnt = carrierList.filter(e => !e.spawning && !e.isFree()).length;
                if (deficit > cap * 0.3 && busyCnt >= carrierCnt - 1) carrierTarget += 2;
            }
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
                // 同 spawnCarrierNow：只解粘滞标记，**不动**孵化预算缓存
                // （`room.energyAvailable` 在本 tick 内不反映刚花掉的能量）。
                StationHive.trySpawn(room, room.name, workerBody, "worker", bootTasks);
            }
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        // 「够满配 carrier」的门槛按**本房容量**折算，不能写死 2,500。
        //
        // 2,500 是 RCL8（12,900）的量级：对 cap ≤ 2,500 的 RCL5/6 房
        // （hive 满格只有 1,800 / 2,300）它**永不可达** ⇒ 下面那条「按满配体型补员」
        // 的分支一次都不会进，carrier 只能靠 750 的应急小爬，或者「一只都没有」时
        // 重建，编制目标（hive 有缺口时 +1）形同虚设。2026-11-01 W26N58 实测：
        // 目标 4 只、在职 2 只（+1 在孵），手上 49k storage + 48k terminal 却补不出
        // 第 3 只 —— 与 upgrader 那个坑同一形态（MEMORY 第 16 条）。
        // 折算后 RCL8 仍是 2,500（行为不变），RCL5/6 分别是 1,080 / 1,380。
        let carrierBodyMinEnergy = Math.min(2500, (room.energyCapacityAvailable || 0) * 0.6);
        if (carrierCnt < carrierTarget && (Game.time + room.hashCode()) % 50 == 0
            && StationHive.HiveNeedToFill(room) && room.energyAvailable >= 750 && room.energyAvailable < carrierBodyMinEnergy) {
            let emergencyBody = ManagerCreeps.calcBodyPart({ [MOVE]: 5, [CARRY]: 10 });
            spawnCarrierNow(emergencyBody);
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        // hive 缺口 + 能量已够满配 carrier：不等 avgBusy 门槛（空 hive 时
        // avgBusy 常年在 0.85 以下，单 carrier 永远等不到第二只）。
        if (carrierCnt < carrierTarget && (Game.time + room.hashCode()) % 25 == 0
            && StationHive.HiveNeedToFill(room) && room.energyAvailable >= carrierBodyMinEnergy) {
            spawnCarrierNow(StationCarry.getCarrierBodyConfig(room, pro.spawnTickBudget(room)));
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        if (starved && carrierCnt < carrierTarget && (Game.time + room.hashCode()) % 100 == 0) {
            spawnCarrierNow(StationCarry.getCarrierBodyConfig(room, pro.spawnTickBudget(room)))
            if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
            room.memory.carryBusy.push(0)
            return;
        }
        // **「运力打满」这条判据在只剩 1 只时必须自动放行**，否则这条唯一的
        // 常规补员路径永久不可达（MEMORY 第 4 条：闸门自锁）。
        //
        // `carryBusy` 记的是「忙碌只数」的**绝对数**，阈值 0.85×在册只数；
        // 单只车的样本只有 0/1 两值（两次经济 pass 之间它本来就得等下一批任务），
        // 均值实测 0.692 < 0.85 ⇒ 房一旦掉到 1 只，这里再也不会进。
        // 剩下的出口只有上面「hive 缺口 + (t+hash)%25 撞上本房经济槽」那条，
        // 而经济槽是 %7 ⇒ lcm(7,25)=175 tick 才凑巧对上一次，恰好等于一只
        // 50 部件车的孵化时间 150 tick：等于「死一只 → 半运力空转 3 分钟」。
        //
        // 2026-11-04 E53S21 实地：carrier 只剩 1 只，storage 归零、两个源容器各
        // 2,000 满、地面能量 4.9k→7.1k（+28/tick，正好是全房采矿收入），一直等到
        // %25 相位凑上才补出第 2 只。单只 = 整房经济的单点故障，n=1 时利用率
        // 量不出「够不够」，只能无条件补到编制（编制本身仍由 carrierTarget 封顶，
        // 且 `creeps(role, false)` 把孵化中的算进编制 ⇒ 不会连环刷）。
        let aliveCarrierCnt = carrierList.filter(e => !e.ticksToLive || e.ticksToLive > e.body.length * 3).length;
        let haulerSaturated = carrierCnt <= 1 || avgBusy > aliveCarrierCnt * 0.85;
        // **换代提前量**：aliveCarrierCnt 排除了将死的爬（ttl ≤ 3×body）。
        // 用它（而非含将死的 carrierCnt）对标 carrierTarget ⇒ 老车还没死、
        // 接替车就开始孵，无缝衔接（用户 11-04：carrier 应及时孵化不要等死）。
        // 原来用 carrierCnt：老车死掉 → 编制降 → 才触发补员 → 孵化 150 tick
        // ⇒ 每次换代必然 ~150 tick 运力空档（外矿车队的同一震荡模式）。
        if ((carrierCnt <= 0 && (room.storage.store[RESOURCE_ENERGY] > 3000 || room.creeps("harvestEnergyKeeper", false).length > 0)) || (
            aliveCarrierCnt < carrierTarget &&
            !(StationHive.HiveNeedToFill(room) && room.energyAvailable < carrierBodyMinEnergy) &&
            haulerSaturated)) {
            spawnCarrierNow(StationCarry.getCarrierBodyConfig(room, pro.spawnTickBudget(room)))
        }
        if (room.memory.carryBusy.length > 130) room.memory.carryBusy = room.memory.carryBusy.slice(-100)
        room.memory.carryBusy.push(room.creeps("carrier").filter(e => !e.isFree()).reduce((a) => a + 1, 0))
    },
    /**
     * 本房是否有「可供 worker 消耗」的能量（见 WORKER_ENERGY_FLOOR）。
     *
     * 有 keeper 在挖 = 有收入 = 花掉的会被补回来；否则要求 storage 达到阈值。
     */
    workerHasEnergyToSpend(room) {
        if (!room) return false;
        // 有收入（本房还活着挖矿的 keeper）→ worker 干得了活，不算「用不了」
        if (room.creeps("harvestEnergyKeeper", false).length) return true;
        let floor = Number(Memory.marketSettings && Memory.marketSettings.workerEnergyFloor)
            || WORKER_ENERGY_FLOOR;
        return !!(room.storage && (room.storage.store[RESOURCE_ENERGY] || 0) >= floor);
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
        // 默认与修墙储备闸同源（StationDefense.repairWallEnergyFloor，默认 10 万）：
        // ops 烧制只能在修墙预算**之上**的余量里运行，否则就是 2026-11-07 E41S23
        // 那种「烧 power 把 storage 抽穿 10 万闸 ⇒ worker 无墙可修 ⇒ 挂机」的循环。
        // Memory.marketSettings.powerSpawnEnergyFloor 显式覆盖优先。
        let floor = Number(Memory.marketSettings && Memory.marketSettings.powerSpawnEnergyFloor)
            || (global.StationDefense && StationDefense.repairWallEnergyFloor)
            || POWER_SPAWN_ENERGY_FLOOR;
        return (room.storage.store[RESOURCE_ENERGY] || 0) >= floor;
    },
    processPowerSpawn(room) {
        // **烧 power 的唯一权威开关是 `Memory.marketSettings.powerSpawnOtherRooms`。**
        //
        // 2026-10-23 实测：这个函数（每房每 tick 都跑）完全无视那开关，
        // 所以 10-21 把它设成 false 之后，13 个 RCL8 房**仍在各烧 1/tick**
        // （GPL +13/tick、能量 -650/tick，2.6 小时掉 77 万），
        // 而 station_carry.tryProcessPower（我加的那条）那边是关着的。
        // 同一决策有多个调用点 ⇒ 必须逐个查，这是我第 4/7 条设计错误的重演。
        //
        // 试点房由 tryProcessPower 负责（它带 OPERATE_POWER 配速与批量滞回），
        // 这里**跳过试点房**，避免同一个 powerSpawn 一 tick 烧两遍。
        let ms = Memory.marketSettings || {};
        let target = ms.powerSpawnRoom === undefined ? "W32N56" : ms.powerSpawnRoom;
        if (target && room.name == target) return;
        if (ms.powerSpawnOtherRooms === false) return;
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
        // **link 发送每 tick 执行**（0.78.190）：原来跟经济 pass 共用 %7 门槛，
        // 4 个源 link 轮转一圈要 28 tick——OPERATE_SOURCE 的 40/tick 产出
        // 远超 28/tick 的 link 吞吐 ⇒ 容器 2000 满、keeper 往地上倒。
        // transformLink 本身很便宜（几个 getObjectById + store 检查），
        // 移到门槛前每 tick 执行，link cooldown 由引擎控制发送节奏。
        if (!MIN_CPU && global.StationCarry) {
            HelperError.catchError(() => StationCarry.transformLink(room), room.name + ":transformLink");
        }
        // Task assignment and spawn planning tolerate a short delay. Spreading
        // this expensive economy pass across rooms keeps ordinary ticks below
        // the shard's 20 CPU allowance without delaying tower defense.
        // 中压带（bucket<5000）加密到 14：经济 pass 是每 tick 最大的单个可变
        // 成本（1~3 CPU/房），15 房在 %7 下平均 2.1 房/tick ≈ 4-6 CPU；降到
        // %14 后减半，bucket 回升到 5000+ 自动回到 7。生爬/派任务对 7→14 tick
        // 的延迟不敏感（爬寿命 1500 tick 量级）。
        let economyInterval = MIN_CPU ? 10 : (Game.cpu.bucket < 5000 ? 14 : 7);
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


        // transformLink 已移到 exec 开头每 tick 执行（0.78.190）
        // 能量生产者最优先：先补 keeper（缺矿点/死光时），否则 carrier/worker
        // 会先把空 hive 的 spawn 能量吃光，keeper 永远 spawn 失败（E53S21）。
        StationSources.trySpawnHarKeeper(room);
        // 保留者 = 外矿产量的总开关（Overmind 式顺序：先保留、后开采）。
        // 未保留的控制器让源容量减半（1500 vs 3000）；reserver 便宜且低频，
        // 但原来埋在旗循环深处抢不到单 spawn —— 提到 worker/carrier 之前，
        // 「本房 keeper 满员才派」的能量健康闸在函数内部（0.78.155 原则）。
        if (global.StrategyOuterHarvest && isCpuFeatureEnabled("outerHarvest")) {
            HelperError.catchError(() => StationSources.trySpawnReservers(room), "reserver:" + room.name);
        }
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
        // 「hive 见底就别为 upgrader 抽能量」（90fca62）—— 但**门槛必须按本房容量折算**。
        //
        // 写死的 2,500 是 RCL8 的量级（12,900 的 ~19%）；对 cap ≤ 2,500 的 RCL5/6 房
        // 它恒真（hive 满格也只有 1,800 / 2,300），于是**每次经济 pass 都跳过**
        // `spawnUpgrader`，upgrader 连「试一下」的机会都没有：2026-11-01 W26N58
        // 实测 RCL6、hive 容量 2,300、控制器进度 348,023 连续 200+ tick 不动、
        // storage 31,587 却没人升。改成「本房容量的 20%」后 RCL8（2,580→2,500）
        // 与历轮行为一致，小房则拿到真实存在的窗口。
        let hiveStarvingEnergy = Math.min(2500, room.energyCapacityAvailable * 0.2);
        if (!(StationHive.HiveNeedToFill(room) && room.energyAvailable < hiveStarvingEnergy)) StationUpgrade.spawnUpgrader(room);


        //最后回收全部资源！
        // room.creeps("carrier").filter(e=>!e.storeEmpty()&&e.isFree()).forEach(e=>{
        //     e.fillAll(room.storage)
        // })


    }
}



global.StrategyHighLevel = pro;
