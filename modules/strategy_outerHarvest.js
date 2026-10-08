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
    /**
     * 防守满员闸（用户 10-03 定稿的优先级：主房 → 防守满员 → 外矿按距离）：
     * spawnRoom 负责的**每个**外矿房防守编制都到位才返回 true，否则该矿本轮
     * 只守不产 —— 先把保命的防守爬配齐，再让 keeper / carrier / 矿物链进去。
     *
     * 编制（`StationSources.outerDefenseQuota`）＝有威胁的房 2 只起，房里活着的
     * source keeper 更多时按 1 只防守爬对 1 只 keeper 加编（上限 4 = lair 数）；
     * 无威胁的房 0 只。判据复用 roomNeedsDefense（活体敌人 / lair / invaderCore /
     * 失去视野后 OUTER_HOSTILE_MEMORY_TICKS 内的威胁记忆）—— 与
     * StationSources.trySpawnOuterDefenser 派兵用的是同一份判据，两边不会打架。
     *
     * 在役数量走 `StationSources.outerDefenseAssignments`（按任务栈目标房名全局数，
     * 在役 + 在途都算）—— 只数「还站在出兵房里的爬」会永远判不满员，把外矿
     * 生产永久锁死（比原来那个 ReferenceError 更糟）。
     *
     * 注意这只是**派发闸**，不是派兵闸：trySpawnOuterDefenser 在它之前无条件
     * 执行，所以满员闸挡住生产时，防守爬照补，补满即自动放行。
     *
     * 历史：0d55a80 引入这个闸时漏了定义（`allDefendersFull` 从未赋值），exec
     * 每 6 tick 在 else 分支抛一次 ReferenceError，被 HelperError.catchError 吞掉
     * 后**外矿生产整段失效**——keeper / carrier / 矿物链一只都不派，现场表现是
     * 「外矿房一个矿工都没有、主房门口一只搬运爬都没有」，而防守爬（异常之前
     * 派发）看起来还正常。
     */
    outerDefendersFull(spawnRoom, flags) {
        for (let flag of flags) {
            let roomName = flag.pos.roomName;
            // 该旗子由别的房间负责派发时不计在本房头上
            if (flag.memory.spawnRoom && flag.memory.spawnRoom != spawnRoom.name) continue;
            let room = Game.rooms[roomName];
            if (!pro.roomNeedsDefense(room, flag)) continue;   // 无威胁：0 编制，直接放行
            let need = StationSources.outerDefenseQuota(room);
            if (StationSources.outerDefenseAssignments(roomName).length < need) return false;
        }
        return true;
    },
    /**
     * 目标矿区里是否有 `stopRemote*` 旗（= 该矿常驻停用）。
     *
     * 语义与引擎的 `Room.prototype.flags(name)` 一致：**名字前缀**匹配。
     * 但**不依赖视野** —— 遍历 `Game.flags`（旗子一直属于账号，任何房间的旗都读得到），
     * 因为常驻停用必须在失去视野之后仍然生效。
     *
     * 用途：用户 10-08 指示「砍掉更远的那个房间的外矿」来给 CPU 预算腾空间 ——
     * W35N55 离主房 W33N55 隔两房，单程路线 88~125 格（W34N55 只有 43~78），
     * 同样的运力要占一倍的在途时间。用旗子停用是**可逆**的：撤旗即恢复，
     * 而且容器里已存的能量不会消失，将来重新开矿还在。
     */
    hasStopRemoteFlag(targetRoomName) {
        if (!targetRoomName) return false;
        for (let name in Game.flags) {
            if (name.indexOf("stopRemote") != 0) continue;
            let flag = Game.flags[name];
            if (flag && flag.pos && flag.pos.roomName == targetRoomName) return true;
        }
        return false;
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
            // 矿区放 stopRemote 旗则暂停该矿（常驻停用）。
            //
            // ⚠️ 判据**不能依赖视野**。原来写的是
            // `Game.rooms[targetRoomName] && Game.rooms[targetRoomName].flags("stopRemote")`
            // —— 它要求我们先看得见那个房间，而常驻停用恰恰要在「爬撤走、失去视野」
            // 之后依然生效。一没视野这个守卫就失效、又开始补员，而 keeper 不需要
            // 视野也能走进去（见下面「普通外矿不依赖当前视野」那段），矿会自己活回来。
            // 所以改用 Game.flags 按「名字前缀 + 所在房名」查，不依赖视野。
            if (pro.hasStopRemoteFlag(targetRoomName)) continue;
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
                if (m && m.room == c.pos.roomName && m.x == c.pos.x && m.y == c.pos.y
                    && Game.time - m.t >= OUTER_CONGESTION_TICKS) {
                    stuckCnt++;
                    c.suicide();
                } else if (!m || m.room != c.pos.roomName || m.x != c.pos.x || m.y != c.pos.y) {
                    // 记上房间名：原来只有 x/y，跨房同坐标会被当成「没动过」——
                    // 实测据此误读成「防守爬卡了 1076 tick」，其实它是在岗位上驻守。
                    c.memory.outerStuck = { room: c.pos.roomName, x: c.pos.x, y: c.pos.y, t: Game.time };
                }
            });
            if (Memory.outerPaused && Memory.outerPaused[targetRoomName] > Game.time) continue;
            if (stuckCnt >= OUTER_CONGESTION_PAUSE_CNT) {
                // **必须先建好 map 再写**：读取侧原来有 `Memory.outerPaused &&` 守卫，
                // 写入侧却是裸下标赋值。`Memory.outerPaused` 不存在时（第一次触发
                // 熔断就是这种情况）这一行抛
                // `TypeError: Cannot set properties of undefined (setting 'W34N55')`，
                // 被 HelperError.catchError 吞掉不会崩 tick，**但 exec 已经中断** ——
                // 该出兵房的外矿策略从此每 6 tick 死一次，keeper / carrier /
                // 防守爬一只都不派。实测 W33N55（2026-10-04）：4 只防守爬在出兵房
                // 堵死后熔断触发 → 崩 → 外矿搬运爬团灭没人补 → 主房 storage 被抽到
                // **0** → `outerMineStarvesSpawnRoom` 反过来把外矿彻底锁死，
                // 整条链死了几千 tick 直到发现这行。
                if (!Memory.outerPaused) Memory.outerPaused = {};
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
                // 防守满员闸：本房负责的外矿房防守编制没满就只守不产（见
                // outerDefendersFull 的说明；这里原来是未定义的 allDefendersFull）
                if (!pro.outerDefendersFull(spawnRoom, flags)) continue;
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
