/**
 * 外矿策略
 * 旗子规则：har_<出生/供给房间>（如 har_E53S21），旗子物理放在矿区（如 E54S21）
 * flag.pos.roomName = 矿区，flag.getRoomName() = 供给房间（旗名第二段）
 */

/** 失去视野后，仍把该房按「有威胁」对待的时长（tick） */
const OUTER_HOSTILE_MEMORY_TICKS = 3000;

/** 拥堵熔断：主房内原地不动多久算堵死（tick） */
const OUTER_CONGESTION_TICKS = 90;
/** 同时堵死多少只就触发暂停 */
const OUTER_CONGESTION_PAUSE_CNT = 4;
/** 暂停派发的时长（tick），到期自动恢复 */
const OUTER_CONGESTION_PAUSE_TICKS = 600;

/**
 * 拆 core 队伍的**提前部署量**：core 在 ticksToDeploy 归零前是无敌的
 * （实测 attack 恒返回 ERR_INVALID_TARGET，几千 tick 伤害为 0），归零时它升级
 * （lv1→lv2，之后每 6 tick 刷 invader）并变为可攻击。提前量要覆盖
 * 生成（30 部件 = 90 tick）+ 跨房行军（~300 tick）+ 余量 —— 到场正好赶上破防。
 */
const CORE_BUSTER_DEPLOY_LEAD = 600;

let pro = {
    /**
     * 该外矿房是否**真的**需要防守。
     *
     * 判据用「实际威胁」而不是房间类别：有活体敌人，或有 lair / invaderCore。
     *
     * 为什么不能只看旗名：中间九房里有一种是**没有 lair / invaderCore** 的
     * （W35N55 就是：3 个源 + 一个 K 矿，完全没有敌人）。按「入侵房」处理会
     * 白白要求先派 2 只防守爬，既浪费兵力，又让矿工永远等不到出兵条件。
     * 没有视野时保守返回 true（此时只能按旗名判断）。
     *
     * **没有视野 ≠ 没有威胁**（2026-09-30 W35N55 实测）：invader 小队把房里的
     * 爬杀光后我们失去视野，若此时完全「失忆」，防守爬永远不会被派（isInvader
     * 恒 false），keeper/搬运却仍按无威胁继续往里派，一只只走进怪堆。
     * 所以：亲眼见到敌人的时刻记进 room.memory.lastHostileSeen；
     * 失视野后 OUTER_HOSTILE_MEMORY_TICKS 内仍按有威胁处理 —— 防守爬照派、
     * 采运暂停，等防守爬进场拿回视野、清完敌人，一切自动恢复。
     */
    roomNeedsDefense(room, flag) {
        if (!room) {
            let mem = Memory.rooms[flag.pos.roomName];
            return flag.name.includes('invader')
                || !!(mem && mem.lastHostileSeen
                    && Game.time - mem.lastHostileSeen < OUTER_HOSTILE_MEMORY_TICKS);
        }
        if (room.find(FIND_HOSTILE_CREEPS).length) {
            let mem = Memory.rooms[room.name] || (Memory.rooms[room.name] = {});
            mem.lastHostileSeen = Game.time;
            return true;
        }
        return room.find(FIND_HOSTILE_STRUCTURES).some(e =>
            e.structureType == STRUCTURE_KEEPER_LAIR || e.structureType == STRUCTURE_INVADER_CORE);
    },
    /**
     * 拆 invaderCore 的**专队规模**，按 core 等级定。
     *
     * **单只大体型**（ATTACK = MOVE = 15），一次打完：
     * core 固定 10 万血（INVADER_CORE_HITS），15 ATTACK = 450 伤害/tick，
     * 贴身 222 tick 拆完；行军约 75 格（外矿道路为主，1:1 攻移比在路上全速）
     * ≈ 150 tick；合计 ~400 tick ≪ 1500 tick 寿命 —— 一只一趟能独立完成。
     *
     * 原方案是 2 只 [ATTACK,ATTACK,MOVE] 小爬：合计 120 DPS（833 tick），
     * 且 1 MOVE 拖 2 部件在平地 0.2 格/tick，光走路就要几百 tick，
     * 实测其中一只十几个探针窗口纹丝不动 —— 拆 core 变成无限期工程。
     *
     * 一级 core 不刷怪（INVADER_CORE_CREEP_SPAWN_TIME lv1 = 0），不用奶；
     * 二级起每 6/3/2/1 tick 刷一只 invader，补 5 HEAL 自奶续站。
     * perCreep = 1：同一时刻只养一只，死了由 spawnCoreBuster 自动补。
     *
     * 通用规则，与具体房间无关：只看 core.level。
     */
    coreBusterPlan(coreLevel) {
        let lv = Math.max(0, coreLevel || 0);
        if (lv <= 1) return { attackCnt: 15, healCnt: 0, moveCnt: 15, perCreep: 1 };
        // 二级 core 有塔（150~300/tick 随距离）。破核爬的生存判据：
        //   · TOUGH 强化**先结算减伤**（XGHO2：伤害×0.3），塔伤 300 → 实际 90；
        //   · HEAL T3（XLHO2）每部件 48/tick：3 部件 144 > 90，塔永远打不穿；
        //   · RANGED T3（XUHO2 ×4）20 部件 = 800 dps，10 万血 core 125 tick，
        //     且在 range 3 就能输出（近战爬贴脸 1 格才会挨塔最狠的那档）；
        //   · MOVE 25 = 部件一半，铺好的外矿道路上全程 1 格/tick。
        // 无 T3 强化时奶量 36 远低于塔伤 —— needsT3：派不出强化就不派，
        // 宁可等 lab 攒够化合物也不送死（死亡循环既丢爬又拆不动）。
        return {
            toughCnt: 2, healCnt: 3, rangedCnt: 20, moveCnt: 25, perCreep: 1,
            needsT3: true,
        };
    },
    /**
     * 外矿房里的 invaderCore 会持续刷 invader 出来打我们的矿工。检测到就派一队去拆。
     *
     * 规模按 core 等级（见 coreBusterPlan）：一级只上 ATTACK；更高等级补 HEAL。
     */
    spawnCoreBuster(targetRoomName, spawnRoom) {
        if (spawnRoom.spawnFailure) return;
        let harRoom = Game.rooms[targetRoomName];
        if (!harRoom) return;   // 没视野就无从判断，也不该盲派
        let core = harRoom.find(FIND_HOSTILE_STRUCTURES)
            .filter(e => e.structureType == STRUCTURE_INVADER_CORE).head();
        if (!core) return;
        // 未部署的 core 打不动（见 CORE_BUSTER_DEPLOY_LEAD 注释），等它临近破防再派。
        // 已破防（被打掉过血）后不受此闸限制，接替兵随时能补。
        if (core.ticksToDeploy !== undefined && core.ticksToDeploy > CORE_BUSTER_DEPLOY_LEAD
            && core.hits >= core.hitsMax) return;

        let busting = spawnRoom.creeps("coreBuster", false).filter(e => {
            let t = e.headTask && e.headTask();
            return t && t.roomName == targetRoomName;
        });
        let plan = pro.coreBusterPlan(core.level);
        if (busting.length >= plan.perCreep) return;
        let body, boostRes = undefined;
        if (plan.rangedCnt) {
            body = ManagerCreeps.calcBodyPart({
                [TOUGH]: plan.toughCnt,
                [HEAL]: plan.healCnt,
                [RANGED_ATTACK]: plan.rangedCnt,
                [MOVE]: plan.moveCnt,
            });
            boostRes = {
                // 键是动作名（"damage" 而非 "tough"）；索引 0/1/2 = T1/T2/T3。
                [BOOST_RES["damage"][2]]: plan.toughCnt * 30,
                [BOOST_RES["heal"][2]]: plan.healCnt * 30,
                [BOOST_RES["rangedAttack"][2]]: plan.rangedCnt * 30,
            };
        } else {
            body = ManagerCreeps.calcBodyPart({
                [ATTACK]: plan.attackCnt,
                [HEAL]: plan.healCnt,
                [MOVE]: plan.moveCnt
                    || Math.ceil((plan.attackCnt + plan.healCnt) / 2),
            });
        }
        let tasks = [UtilsTask.task(core, "coreBuster")];
        if (boostRes) {
            // 塔 (L2+) 对无强化的奶量是碾压：没有 T3 化合物就不派，等 lab。
            if (!global.StationLab || !StationLab.boostAble(spawnRoom, boostRes)) return;
            tasks.unshift(StationLab.generatorBoostResTask(boostRes).head());
        }
        StationHive.trySpawn(spawnRoom, spawnRoom.name, body, "coreBuster", tasks);
    },

    /**
     * 外矿房里的 **invader 塔**（lv2 core 部署后留下，3000 血、射程内 600/tick）：
     * 派一只小近战专职拆掉。体力账：[A15,H10,M15] 450 dps → 塔 ~7 tick 倒；
     * 塔伤 600 - 自奶 120 = 净 -480/tick，4000 血能站 ~8 tick，够拆完。
     * 复用 coreBuster 处理器（taskName 相同，含跨房 -7 / 无部件 -12 的修正），
     * 拆完自回收。
     */
    spawnTowerBuster(targetRoomName, spawnRoom) {
        if (spawnRoom.spawnFailure) return;
        let harRoom = Game.rooms[targetRoomName];
        if (!harRoom) return;
        let tower = harRoom.find(FIND_HOSTILE_STRUCTURES)
            .filter(e => e.structureType == STRUCTURE_TOWER).head();
        if (!tower) return;
        let busting = spawnRoom.creeps("towerBuster", false).filter(e => {
            let t = e.headTask && e.headTask();
            return t && t.roomName == targetRoomName;
        });
        if (busting.length) return;
        let body = ManagerCreeps.calcBodyPart({ [ATTACK]: 15, [HEAL]: 10, [MOVE]: 15 });
        let tasks = [UtilsTask.task(tower, "coreBuster")];
        StationHive.trySpawn(spawnRoom, spawnRoom.name, body, "towerBuster", tasks);
    },
    exec(room) {
        if ((Game.time + room.hashCode()) % 6 != 0) return;
        let flags = ManagerFlags.getFlagsByPrefix("har");
        if (!flags.length) return;
        // 生产优先级按**离主房的线性距离**排（用户 10-03 指示）：主房最高（由
        // 策略执行顺序 + starves 闸保证），外矿近的先于远的。配合防守满员闸：
        // 防守编制不满时全部暂停，满了之后近矿先恢复生产。
        if (flags.length > 1) flags.sort((a, b) =>
            Game.map.getRoomLinearDistance(room.name, a.pos.roomName)
            - Game.map.getRoomLinearDistance(room.name, b.pos.roomName));
        for (let flag of flags) {
            let targetRoomName = flag.pos.roomName;
            // 矿区放 stopRemote 旗则暂停该矿
            if (Game.rooms[targetRoomName] && Game.rooms[targetRoomName].flags("stopRemote").length) continue;
            // 每个旗子只由它选择的派发房间处理，避免多个已方房间重复派发
            let spawnRoom = flag.memory.spawnRoom && Game.rooms[flag.memory.spawnRoom];
            if (!spawnRoom || !spawnRoom.my) {
                // 旗名第二段 = 供给房间（优先），否则取最近的可用房间
                let namedRoom = Game.rooms[flag.getRoomName()];
                if (namedRoom && namedRoom.my) spawnRoom = namedRoom;
                else spawnRoom = StationHive.getClosestSpawnRoom(targetRoomName, 7, 3, 15);
                if (spawnRoom) flag.memory.spawnRoom = spawnRoom.name;
            }
            // 派发房间必须有 storage 接收外矿能量
            if (!spawnRoom || !spawnRoom.storage || spawnRoom.name != room.name) continue;
            // 拥堵熔断（用户 10-02 指示）：该矿的爬在主房里原地不动超过
            // OUTER_CONGESTION_TICKS 即视为堵死——先**处决堵路爬**（尸体能量
            // 顺路可捡），再暂停该矿派发一段时间，防止主房门口被钉死、
            // spawn 网络被饿死（实测 11~15 只外矿爬挤在 storage 周边时，
            // 防守接替兵和矿物链全部生成不出来）。暂停到期自动恢复，
            // 再堵再熔断。已在矿区里干活的爬不受影响。
            let stuckCnt = 0;
            room.find(FIND_MY_CREEPS).forEach(c => {
                let t = c.headTask && c.headTask();
                if (!t || t.roomName != targetRoomName) return;
                let m = c.memory.outerStuck;
                if (m && m.x == c.pos.x && m.y == c.pos.y && Game.time - m.t >= OUTER_CONGESTION_TICKS) {
                    stuckCnt++;
                    c.suicide();
                } else if (!m || m.x != c.pos.x || m.y != c.pos.y) {
                    c.memory.outerStuck = { x: c.pos.x, y: c.pos.y, t: Game.time };
                }
            });
            if (Memory.outerPaused && Memory.outerPaused[targetRoomName] > Game.time) continue;
            if (stuckCnt >= OUTER_CONGESTION_PAUSE_CNT) {
                Memory.outerPaused[targetRoomName] = Game.time + OUTER_CONGESTION_PAUSE_TICKS;
                continue;
            }
            if (Memory.rooms[targetRoomName]) {
                // 按**实际威胁**判断，而不是按旗名/房间类别（见 roomNeedsDefense）
                let isInvader = pro.roomNeedsDefense(Game.rooms[targetRoomName], flag);
                StationSources.trySpawnOuterDefenser(targetRoomName, spawnRoom, isInvader);
                // core 专队：房里有 invaderCore 就派一队去拆（规模按 core 等级）。
                pro.spawnCoreBuster(targetRoomName, spawnRoom);
                // invader 塔（lv2 core 部署后留下）：派小近战专职拆掉。
                pro.spawnTowerBuster(targetRoomName, spawnRoom);
            }
            // Scout 只负责首次建立 source Memory。已有坐标、container ID 与路径
            // 后，keeper 本身可以直接走入不可见的矿区；为重新拿视野而多派 scout
            // 会把外矿恢复额外延后一个往返。
            if (!Memory.rooms[targetRoomName]
                || !Memory.rooms[targetRoomName][StationSources.stationName]) {
                let scouter = spawnRoom.creeps("scouter", false).filter(e => {
                    let task = e.headTask();
                    return task && task.roomName == targetRoomName;
                }).head();
                // log(scouter.headTask().roomName)
                if (!scouter) {
                    let tasks = [UtilsTask.taskOutView(flag.id, targetRoomName, undefined, undefined, "scouterToRoom")]
                    StationHive.trySpawn(spawnRoom, spawnRoom.name, [MOVE], "scouter", tasks)
                }
            }
            else {
                if (!allDefendersFull) continue;   // 防守没满员：本矿本轮只守不产
                let harRoom = Game.rooms[targetRoomName];
                if ((Game.time + spawnRoom.hashCode()) % 30 == 0 && harRoom) {
                    StationSources.update(harRoom)
                }
                // 普通外矿不依赖当前视野：任务中已有 source 坐标，keeper 会自行
                // 进入目标房。reserve 仍只在看得见 controller 时决策。
                if (!pro.roomNeedsDefense(harRoom, flag)) {
                    StationSources.trySpawnOuterHarKeeper(targetRoomName, spawnRoom, false);
                }
                if (harRoom && harRoom.controller && !harRoom.my) { // 先生claimer 再生 har 保证能量获取效率 没有视野会先生 har
                    let reserver = spawnRoom.creeps("reserver", false).filter(e => {
                        let task = e.headTask();
                        return task && task.roomName == targetRoomName;
                    }).head();
                    if (!reserver && (!harRoom.controller.reservation || harRoom.controller.reservation.ticksToEnd < 1000)) {
                        let tasks = [UtilsTask.task(harRoom.controller, "reserveOuterHar")]
                        let body = StationSources.getReverserBodyConfig(spawnRoom.getEnergyCapacityAvailable())
                        StationHive.trySpawn(spawnRoom, spawnRoom.name, body, "reserver", tasks)
                    }
                }
                else if (harRoom && !harRoom.controller) {
                    // 无 controller 的房间（Source Keeper 房 / 无主中立房）。
                    // 判据是「无 controller」而不是「旗名带 invader」—— 否则没有
                    // lair / invaderCore 的中立房（W35N55）永远走不进这个分支，
                    // 矿工根本不会被派出去。
                    // 只有**真有威胁**时才要求「先有防守爬，再派矿工」。
                    if (pro.roomNeedsDefense(harRoom, flag)) {
                        let defenser = spawnRoom.creeps("outerHarvestDefenser", false).filter(e => {
                            let task = e.headTask();
                            return task && task.roomName == harRoom.name;
                        }).head()
                        if (!defenser) continue;
                    }
                    StationSources.trySpawnOuterHarKeeper(targetRoomName, spawnRoom, true);
                }
                // 矿物与搬运的派发有一道「盲区闸」：没视野但记忆里刚见过敌人的房
                // （防守爬正在路上），先把采运停下来，免得新爬一只只走进怪堆。
                // 有视野的威胁房不在这里挡 —— 上面 `!harRoom.controller` 分支的
                // continue 已经统一要求「先有防守爬」；普通无威胁房照常派发。
                //
                // 矿物只采**市场价格高**的矿（H / X / L），低价矿不值得占
                // spawn/carrier/防守配置，见 shouldHarvestRemoteMineral 的说明。
                if (harRoom
                    || !pro.roomNeedsDefense(harRoom, flag)
                    || spawnRoom.creeps("outerHarvestDefenser", false).some(e => {
                        let t = e.headTask();
                        return t && t.roomName == targetRoomName;
                    })) {
                    // Memory.stopOuterMineral = true 一键暂停外矿矿物链的补员
                    // （keeper / carrier / container builder 全部不再生成）。
                    // 在役矿物爬自然老化退役；能量采集线不受影响。
                    if (harRoom && !Memory.stopOuterMineral && pro.shouldHarvestRemoteMineral(targetRoomName)) {
                        StationSources.trySpawnOuterMineralKeeper(targetRoomName, spawnRoom);
                    }
                    StationSources.trySpawnOuterHarCarrier(targetRoomName, spawnRoom);
                }

            }
        }
    },
    /**
     * 这个外矿房的矿物值不值得采。
     *
     * 矿物之间的价格差一个数量级以上，低价矿（K≈15、Z≈12、U≈9）采回来基本
     * 不值钱，却要占用外矿的 spawn 配额、carrier 运力，在中间九房还要额外
     * 承担 keeper 威胁下的防守成本。所以只采贵矿（H≈205、X≈266、L≈160）。
     *
     * **价格必须取真实市场最低卖价，不能用 StrategyMarketPrice.getResTypeHistory**：
     * 那份缓存严重失真 —— 它对 H 记的是 1.1，而 H 在市场上实际卖 200+。用缓存
     * 会把 H 误判成「廉价矿」而漏采。getAllOrdersCacheList 有 100 tick 缓存，开销可控。
     *
     * 门槛用 Memory.marketSettings.minRemoteMineralPrice 调（默认 120，会选中
     * X / H / L，排除 O / K / Z / U）。
     */
    shouldHarvestRemoteMineral(roomName) {
        let roomMemory = Memory.rooms[roomName];
        let data = roomMemory && roomMemory[StationMineral.stationName];
        if (!data || !data["resType"]) return false;
        let resType = data["resType"];
        let threshold = Number(Memory.marketSettings && Memory.marketSettings.minRemoteMineralPrice || 120);
        let sellList = StrategyMarket.getAllOrdersCacheList(resType, ORDER_SELL).filter(e => e.amount > 0);
        let floor = sellList.length
            ? sellList.reduce((min, o) => Math.min(min, o.price), Infinity)
            : 0;
        if (!(floor > 0)) floor = StrategyMarketPrice.getResTypeHistory(resType);   // 没有挂单时退回历史价
        return floor >= threshold;
    },
}


global.StrategyOuterHarvest = pro;
