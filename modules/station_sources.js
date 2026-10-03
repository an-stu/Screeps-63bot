
/**
 * 外矿防守爬的轮换参数。
 *
 * REPLACE_TTL：最老的防守爬剩余寿命低于这个值时，派一只接替，保证防守不断档。
 * 需要覆盖「生成时间（50 部件约 150 tick）+ boost 搬运（约 50~100 tick）+ 行军到外矿房（约 50 tick）」，
 * 取 250 比较稳妥。
 * TARGET_CNT：中间九房（Source Keeper / invader 房）的常驻防守爬数量。轮换时会有两只同时在场。
 */
const OUTER_DEFENSE_REPLACE_TTL = 250;
const OUTER_DEFENSE_TARGET_CNT = 2;
/**
 * 防守爬生成耗时（tick）：50 部件 × 3。
 * 接替兵的提前量至少要覆盖它 + 行军时间，见 outerDefenseReplaceLead。
 */
const OUTER_DEFENSE_SPAWN_TICKS = 150;
/** 接替兵提前量的缓冲（tick），见 outerDefenseReplaceLead */
const OUTER_DEFENSE_REPLACE_MARGIN = 10;
/**
 * 接替兵「重叠期」（tick）：新兵要比老兵**早这么多**站到岗位上。
 *
 * 只按「生成 + 行军」派兵，新兵恰好赶在老兵死的那一刻到 —— 余量为零，
 * 出生队列排一下、或者路上比 1 格/tick 慢一点，就出现**防守空档**，
 * 而空档期正是 keeper 打死我们矿工的时候。
 *
 * 留出重叠期就得到一条硬保证：新兵到位后老兵才死，该组**任何时刻都有防守爬**。
 * 溢出期间同组两只 defenseGroup 会被分组逻辑摊到两组，等于两侧临时都有覆盖。
 */
const OUTER_DEFENSE_REPLACE_OVERLAP = 100;
/** 拿不到路线缓存时的行军时间保守估计（tick） */
const OUTER_DEFENSE_TRAVEL_FALLBACK = 150;
/** keeper 撤离触发距离：敌对爬进入该半径且无防守爬接战就撤（Overmind flee 语义） */
const OUTER_KEEPER_FLEE_RANGE = 6;
/**
 * 「我方矿工工作位」的寻路代价：矿点及其相邻一圈。
 *
 * 为什么要抬高：矿点旁的 container 在代价矩阵里是最低代价 1（为了让寻路复用已有路），
 * 结果**外矿路线会特意从主房 keeper 的岗位上穿过去** —— 实测 W33N55 的路线压在
 * (3,24) 上，而主房 keeper 正是站在那儿挖 (4,25) 的。两者互相挤占，影响正常挖矿。
 *
 * 取 8：比空地 2 / 沼泽 5 都高，足够让寻路宁可多走一两格绕开；但不封死，
 * 万一真没有别的路也还走得通（不会把路线逼成 incomplete）。
 * 这条对任何房间通用：矿区房里那也是我们矿工的工作位，同样不该被踩。
 */
const OUTER_ROAD_WORK_TILE_COST = 8;
/**
 * 巡逻时在每个 keeperLair 驻守点停留多久（tick）。
 *
 * lair 每 300 tick 出一只 keeper。4 个 lair 一圈 = 移动时间（W34N55 约 100 tick）+ 4×停留。
 * 停留 90 tick 时一圈 ≈ 460 tick，对每个 lair 的 300 tick 周期覆盖 ~30%——剩下的靠 keeper 主动来找我们的 miner，defenser 巡逻路上会撞见（findClosestByRange 会截住它们。
 *
 * 想提高覆盖率就调大这个值（一圈变长），或提高 OUTER_DEFENSE_TARGET_CNT 让多只错开巡逻。
 * 可用 Memory.marketSettings.outerDefensePatrolDwell 调。
 */
const OUTER_DEFENSE_PATROL_DWELL = 90;
/**
 * 每只外矿防守爬认领几个 keeperLair。
 *
 * 原来 1 只爬要在一圈里走完 4 个窝：W34N55 一圈约 103 格 + 4×90 停留 ≈ 463 tick，
 * 而 lair 每 300 tick 出一只 keeper —— 某个窝最长要等 460 tick 才有人来，而外矿
 * keeper 只有 17 部件（1700 血），被 source keeper 约 400/发打几下就没了。
 *
 * 改成对半分：组0 守西边两个窝（挨着源 (3,17)/(10,33)），组1 守东边两个窝
 * （挨着源 (32,32) 和矿物 (42,16)），覆盖率从 ~19% 提到 ~45%。
 */
const OUTER_DEFENSE_LAIRS_PER_CREEP = 2;
/**
 * 只打离自己这组窝多近的敌人。
 *
 * 原来是 `findClosestByPath(FIND_HOSTILE_CREEPS)` 全房找最近的一只：defenser
 * 会被另一头的 keeper 一路牵着走，自己该守的矿工反而没人管（W34N55 实测
 * defenser 出现在 (16,3)/(24,32)/(33,2)，离它该守的窝很远）。
 * 现在只在自己的窝附近接战，超出这个半径的交给另一只。
 */
const OUTER_DEFENSE_GUARD_RADIUS = 8;
/**
 * 「友军遇袭」接战半径：敌人在任意己方爬这一距离内，就算威胁到我们的作业，
 * 由**距它最近**的那只防守爬出手（见 outerDefense 的选敌注释）。
 *
 * 来源：invader 小队（1000 血 × 3~4 只）会游荡到窝区守卫半径之外、正卡在我们的
 * 运输路线上（实测 W34N55 北缘 (11~16,3) 一队就贴着去 W35N55 的走廊），
 * 原规则下防守爬在旁边 3 格也不理 —— 矿工/搬运被逐个咬死。
 */
const OUTER_DEFENSE_HELP_RADIUS = 8;
/**
 * 同一只防守爬能兼顾的目标散布半径：已接战的防守爬对这一距离内的其它敌人
 * 仍然"负责"（range 3 对射下换目标只需一两 tick），不另派第二只；超过它
 * 才由空闲的次近者接手。
 */
const OUTER_DEFENSE_ENGAGE_SPREAD = 10;
/**
 * 在两个窝之间来回跑时，每个窝待多久。
 *
 * lair 每 300 tick 出一只 keeper。让「两个窝各待 D + 两趟路上 T」≈ 300，
 * 回到同一个窝时正好赶上它下一次出怪 —— 这就是「确保时间足够」。
 * T 用两窝之间的切比雪夫距离估（外矿还没修路时约 1 格/tick）。
 * W34N55 实测：西组两窝相距 21 格 → D=129；东组相距 16 格 → D=134。
 */
const OUTER_DEFENSE_LAIR_CYCLE = 300;
const OUTER_DEFENSE_MIN_DWELL = 60;
const OUTER_DEFENSE_MAX_DWELL = 240;
/**
 * 道路未完工时，至少保持几只带 WORK 的 carrier 在铺路。
 *
 * 别调太高：外矿路线是单格宽的单行道，去程（keeper）和回程（carrier）共用，
 * 爬一多就互相堵死（W33N55 实测 13 只挤在 12×7 的范围里，19 tick 只挪 1~3 格）。
 * 2 只是「修路能并行 + 不至于把路堵死」的折中，路修完后这里自然不再补。
 */
const OUTER_ROAD_BUILDER_CNT = 2;
/** 每轮每个矿点最多立多少个外矿道路工地（避免一个 tick 里 createConstructionSite 刷爆 CPU） */
const OUTER_ROAD_SITE_BATCH = 30;
/** 两次铺路间隔（tick）。铺路是幂等的，只是别每 tick 都全路线扫一遍 */
const OUTER_ROAD_SITE_REFRESH = 100;
/**
 * 单个房间同时保留多少工地就停手。Screeps 每房上限 100 个工地，而多个外矿路线
 * 常常共用主房（W33N55 同时是 3 个矿点的主房），全速铺很容易撞上限，
 * `createConstructionSite` 会返回 ERR_FULL。留出余量给容器等其他工地。
 */
const OUTER_ROAD_SITE_ROOM_LIMIT = 85;
/**
 * 缓存路线「还走不走得通」的复检间隔（tick）。
 *
 * 主房里随时会盖起新建筑（实测 nuker 一盖好，缓存路线当场被堵死），而路线缓存
 * 原本要等 1000 tick 才重算 —— 期间所有外矿爬全卡在那一段。
 * 每 50 tick 复检一次：3 个矿点 × ~76 个路点 ≈ 4.6 次 lookForAt/tick，开销可接受。
 */
const OUTER_ROAD_VALIDATE_INTERVAL = 50;
/**
 * 外矿路点上连续卡住多久就改用移动优化器（而不是裸 creep.move）。
 * 单格宽单行道上一有互堵，裸 move 会被引擎静默取消；交给 BetterMove 的
 * 交通逻辑（对穿/让路）才解得开。见 moveToOuterRoadPoint 的说明。
 */
const OUTER_ROAD_STUCK_FALLBACK = 3;
/** 卡到这么久才认定路线真的不可达、去重算（原来也是 10，但它同时会删整条缓存） */
const OUTER_ROAD_STUCK_INVALIDATE = 25;
/**
 * 沿缓存外矿路线走不通时，容忍多少 tick 才认定「路线真被堵死」并作废重算。
 *
 * 这份缓存是**同一个矿点所有爬共用的一份**（keeper、carrier、修路爬都读它）。
 * 原来一遇到 ERR_NO_PATH / ERR_NO_BODYPART 就 delete roadPathStr：任何一只爬
 * 在某一 tick 被 keeper 挡了一下、踩到工地或沼泽，整条路线就对所有爬一起消失。
 * 而重建路线的唯一入口 ensureOuterRoadPath 挂在 trySpawnOuterHarCarrier 里，
 * 那个函数开头就被 spawnFailure 挡住 —— 主房 spawn 忙时根本进不去。于是路线
 * 长时间缺失，路点就一直铺不下去（W34N55 实测：3 个矿点 roadPathStr 全空，
 * 路停在 34 条 / 约需 90 条）。
 *
 * 现在单次失败只回退到原生 moveTo（照样走得动），连续失败超过这个 tick 数才作废。
 */
const OUTER_ROAD_FAIL_TOLERANCE = 100;
/**
 * 主房边缘 link（外矿卸货口）：外矿搬运爬把能量倒在**主房内那段共用路线旁边**的
 * link 上就掉头，由 link 送进主房 link 网（link 之间任意距离互传），砍掉它在
 * 主房内的最后一段路。一个 link 服务以该房为主房的所有矿点（路线在主房内共用）。
 * 发送端（攒够多少能量才发给 hub/升级 link）在 StationCarry.transformLink。
 */
/**
 * 搬运爬在边缘 link 边**最多等**多少个 tick（只在「link 满、这一 tick 一克都
 * 塞不进」时计数）。
 *
 * 为什么需要等：link 只有 800 容量，而一趟货 1250+，塞不完的部分本来只能走
 * storage —— 那等于白省（还是得跑完主房那段路）。link 的发送轮询
 * （StationCarry.transformLink）约每 7~10 tick 跑一次，所以在这里等几 tick
 * 比带着货再走二十格划算得多。上限的意义是**绝不楔死**：link 没人收
 * （hub 满 / 被拆 / 关掉了站）时，等满这个数就照旧走 storage。
 */
const OUTER_EDGE_LINK_WAIT = 12;

Creep.prototype.registerStationSources = function () {
    // let rm = Memory.rooms[this.memory["roomName"]];
    let rm = Memory.rooms[this.headTask().roomName];
    if (rm && rm[pro.stationName] && rm[pro.stationName][this.headTask().id]) {
        let source = rm[pro.stationName][this.headTask().id];
        if (this.spawning) {
            source["spawnTime"] = Game.time
        }
        // 只在实际内容变化时写回 Memory：清理死爬、首次注册自己。
        let rmHarList = source["creeps"] || [];
        let changed = false;
        let alive = [];
        for (let id of rmHarList) {
            if (Game.getObjectById(id)) alive.push(id);
            else changed = true;
        }
        if (!alive.includes(this.id)) {
            alive.push(this.id);
            changed = true;
        }
        if (changed) source["creeps"] = alive; // 避免无意义的每 tick 序列化抖动
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
        // 取不到登记表就跳过记账，但必须把任务弹掉再往下走。
        //
        // 任务 id 取的是**根任务**（headTask）的 id，而这个任务既可能挂在 source
        // 上，也可能挂在 container 上（harvestEnergyOuterKeeper /
        // harvestMineralOuterKeeper 都往栈里推过它）。外矿矿物爬的根任务是**矿物**，
        // 登记在 stationMineral 而不是 stationSources —— 于是原来那句
        // `rm[stationName][id]["spawnTime"]` 必然抛 TypeError。
        //
        // 后果不只是刷错误日志：execLastTask 只执行栈顶任务、**不 pop**，抛错的
        // 栈顶会一直留着，爬卡在容器上一动不动直到老死 —— 矿物容器建好之后矿物爬
        // 也永远采不到矿。Memory.codeHealth.lastError 里记的就是这一条
        // （errorCount 4187，lastErrorTick 83305893）。
        let data = rm[pro.stationName] && rm[pro.stationName][this.headTask().id];
        if (!data) {
            this.popTask();
            this.execLastTask();
            return;
        }
        let pathTime = Game.time - data["spawnTime"];//（出生时间 - 接触时间 = 移动时间）
        // pathTime 是实测的「出生 → 抵达矿点」tick 数，正常应该≈路线长度（外矿无路时
        // 1 格/tick）。但它同时被 trySpawnOuterHarCarrier 当**运力需求**用：
        //   NeedCarryPartCnt = ceil(pathTime * 2 * 10 / 50)   // ≈ pathTime * 0.4 个 CARRY 部件
        // 于是形成正反馈：路上堵 → pathTime 变大 → 派更多 carrier → 堵得更厉害。
        // W33N55 实测 pathTime 飙到 843（应约 65），一次性堆了 8 只 carrier，
        // keeper 走 843 tick 才到矿点，源在这期间一直是满的没人采。
        // 用缓存路线长度做上界（留 3 倍余量）把回路掐断。
        // 上界取 1.2×路线长度：路线长度本身就是「1 格/tick 走完」的最佳时间，
        // 而 W33N55 实测一路畅通时也差不多就是这个数。取 3 倍时算出来的运力需求
        // 仍然偏高 —— 3 个矿点会被派到 11 只 carrier，把单格宽的外矿道彻底堵死，
        // 结果 3 个源全停在 4000 没人采。
        let path = pro.getOuterRoadPath(data);
        let cap = path && path.length ? Math.round(path.length * 1.2) : 300;
        if (pathTime > cap) pathTime = cap;
        if (pathTime < 1) pathTime = 1;
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
        // Overmind 式撤离（miner.flee + dropEnergy 的等价实现）：keeper 的命比
        // 一包能量值钱。敌对爬逼近 OUTER_KEEPER_FLEE_RANGE 且本房防守爬不在其
        // OUTER_DEFENSE_GUARD_RADIUS 接战范围内 → 朝主房方向撤，丢掉身上能量减
        // 重。原来站着挖到被杀，两轮巡检的 (3,16)/(4,15) 墓碑都是这么来的。
        let hunter = this.pos.findInRange(FIND_HOSTILE_CREEPS, OUTER_KEEPER_FLEE_RANGE)[0];
        if (hunter && !this.room.find(FIND_MY_CREEPS).some(c =>
            c.memory.role == "outerHarvestDefenser" && c.pos.getRangeTo(hunter.pos) <= OUTER_DEFENSE_GUARD_RADIUS)) {
            let flee = PathFinder.search(this.pos, { pos: hunter.pos, range: OUTER_KEEPER_FLEE_RANGE + 4 },
                { flee: true, maxRooms: 1 }).path[0];
            if (this.store[RESOURCE_ENERGY] > 0 && flee) this.drop(RESOURCE_ENERGY);
            if (flee) this.moveTo(flee);
            return;
        }
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
    // 矿物记录挂在 StationMineral.stationName（一房一条、不按 id 分桶），
    // 不是本模块的 "stationSources"。原来按 [pro.stationName][task["id"]] 取，
    // 拿到的是 undefined，下一行 station["container"] 必定抛 TypeError ——
    // 外矿矿物爬一旦出生就会每 tick 报错。改成取 stationMineral 并判空。
    //
    // mineral / container 必须声明在 if/else **之外**：下面「捡尸体 / 捡掉落物」的
    // 收尾块在 else 块之外，也要用它们；而原来它们是 else 块里的 let，
    // 收尾块一执行就必然 `ReferenceError: container is not defined`（310/315 行）。
    // 症状（实测）：矿物爬身旁 3 格内在(43,15)(42,13)有带能量的墓碑时，
    // 每 17 tick 抛一次异常 —— Memory.codeHealth 里记的就是这一条
    // （errorCount 4198，lastErrorTick 83308420）。后果是收尾逻辑整段失效 +
    // 错误日志污染健康面板。
    let mineral = Game.getObjectById(task["id"]);
    let station = Memory.rooms[task.roomName]
        && Memory.rooms[task.roomName][StationMineral.stationName];
    let container = station && Game.getObjectById(station["container"]);
    if (task.roomName != this.room.name) {
        this.goTo(task);
        return;
    } else {
        if (container && !container.pos.isEqualTo(this)) {
            this.addTask(UtilsTask.task(container, "concatStationSources"));
            this.addTaskAndExec(UtilsTask.task(container, "goToPop"));
            return;
        }
        if (mineral && mineral.mineralAmount > 0) {
            let res = this.harvest(mineral);
            // 容器可能被 keeper 打掉（container 为 null）：harvest 照旧跑，
            // 但不能拿 null 去 repair —— 那会另外抛 TypeError。
            if (res !== OK && container && this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.repair(container)
            }
        }
    }
    if (this.ticksToLive % 17 == 0 && this.ticksToLive > 40 && container
        && container.store.getFreeCapacity() > 50) {
        // 容器没空位就不捡（捡了卸不下，200 容量的爬会被自己拿的东西塞死，
        // harvest ERR_FULL + repair 空操作 = 卡到老死）。搬运爬会来清出空间。
        // find tombstone range 3 and withdraw the energy
        let tombstone = this.pos.findInRange(FIND_TOMBSTONES, 3).head();
        if (tombstone && mineral && tombstone.store[RESOURCE_ENERGY] > 0) {
            // put the mineral into the container first
            this.transfer(container, mineral.mineralType)
            this.withdraw(tombstone, RESOURCE_ENERGY);
        }
        let dropEnergy = this.pos.findInRange(FIND_DROPPED_RESOURCES, 3).head();
        if (dropEnergy && mineral) {
            this.transfer(container, mineral.mineralType)
            this.pickup(dropEnergy);
        }
        // 顺手捡到的能量必须当 tick 卸进容器，不能在身上过夜。
        //
        // 体型是 {MOVE:15, WORK:30, CARRY:4} —— 只有 200 容量。能量留在身上就占满
        // store，之后每一 tick 的 harvest(mineral) 都返回 ERR_FULL；而兜底的
        // this.repair(container) 在容器**满血**时是空操作（(43,15) 常态就是
        // 250000/250000），能量永远倒不掉 —— 整只采集爬会卡到老死为止，而
        // trySpawnOuterMineralKeeper 看到「有采集爬」就不会补员，矿物链断一整轮。
        if (this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            this.transfer(container, RESOURCE_ENERGY);
        }
    }
};

/**
 * 外矿矿物搬运：矿物容器 -> 主房 storage，来回跑。
 *
 * 外矿的矿物**没有任何搬运链**（全代码库搜不到第二个 MineralOuter / 矿物 carrier）：
 * harvestMineralOuterKeeper 是 {MOVE:15,WORK:30,CARRY:4} 的固定采集爬，只会把 H 塞进
 * 旁边的容器；trySpawnOuterHarCarrier 只遍历 stationSources，不认 stationMineral。
 * 也就是说容器满了之后 H 就永远堆在外矿，一条链白建。这里补上搬运那一环。
 *
 * 不走 harvestEnergyOuterCarry 那条路是因为它整条链路都把 RESOURCE_ENERGY 写死了
 * （fillRes / 路点缓存 / 修路任务），改成通用资源要动十几处，风险大得多。
 */
Creep.prototype.harvestMineralOuterCarry = function () {
    let task = this.headTask();
    let rm = Memory.rooms[task.roomName];
    let data = rm && rm[StationMineral.stationName];
    let resType = data && data["resType"];
    let container = data && Game.getObjectById(data["container"]);
    // 记录被清 / 容器没了 → 回主房回收，不留闲爬
    if (!data || !resType || !container) {
        return this.popTask().addTask([UtilsTask.taskData("recycleCreep")]).execLastTask();
    }
    // 身上有**任何**货就回家卸干净。
    //
    // 原来回家条件是 `store[resType] > 0`（只认 H）：「清能量」分支取到身上的能量
    // 永远不算货 → 爬扛着能量站在容器边 withdraw→ERR_FULL 死循环，能量清了但
    // 一克都运不回家，容器照样被堵死（实测 (43,15)：能量 1840 / H 160）。
    if (this.store.getUsedCapacity() > 0) {
        let home = Game.rooms[task.homeRoom] || this.mainRoom();
        let storage = home && home.storage;
        if (!storage) return;
        if (!this.pos.isNearTo(storage)) {
            this.moveTo(storage, { reusePath: 20, visualizePathStyle: { stroke: '#fffa00' } });
            return;
        }
        // 每种资源都卸（H + 顺手清的能量/伴生矿）
        for (let res in this.store) {
            if (this.store[res] > 0) this.transfer(storage, res);
        }
        return;
    }
    if (!this.pos.isNearTo(container)) {
        this.moveTo(container, { reusePath: 20, visualizePathStyle: { stroke: '#fffa00' } });
        return;
    }
    let cap = this.store.getCapacity(resType) || this.store.getCapacity();
    let storedH = container.store[resType] || 0;
    let mineral = Game.getObjectById(data["id"]);
    let mining = mineral && mineral.mineralAmount > 0;
    // H 攒够一趟就搬；矿已采空则把尾量清回来，避免永远留在外矿
    if (storedH > 0 && (storedH >= cap * 0.8 || !mining)) {
        this.withdraw(container, resType);
        return;
    }
    // 容器被**能量**占掉近半 → 主动清能量（这次会真的运回家）。
    //
    // 能量是采集爬捡 keeper/invader 尸体的伴生品，随它积攒会把 2000 的容器
    // 堵死：H 塞不进去、采集爬也卸不下来，整条矿物链双双卡死
    // （实测 (43,15)：2000/2000 里能量 1840、H 160，谁都出不来）。
    // 通用规则：任何外矿容器被非目标资源占满一半以上就清，与房间/资源无关。
    if ((container.store[RESOURCE_ENERGY] || 0) > container.store.getCapacity() / 2) {
        this.withdraw(container, RESOURCE_ENERGY);
        return;
    }
    // 剩下的情况：等 H 攒批。矿没在产、容器也没能量可清时，站到容器边待命。
};

/**
 * 修外矿矿物容器（自循环，不写死任务栈）。
 *
 * 容器 5000 进度，build 是 1 能量换 1 进度，而爬身上只有几百容量，所以必须来回运。
 * 每 tick 看状态自己补一步：能量空了就插一条回主房 storage 取能量的 carryRes，
 * 那条任务取完自己 pop 掉，下一 tick 又回到本任务继续修。
 * 容器建成后（data["container"] 由 StationMineral.update 写上）回收，不留闲爬。
 */
Creep.prototype.buildOuterMineralContainer = function () {
    let task = this.headTask();
    let rm = Memory.rooms[task.roomName];
    let data = rm && rm[StationMineral.stationName];
    let container = data && Game.getObjectById(data["container"]);
    if (!data || container) {
        return this.popTask().addTask([UtilsTask.taskData("recycleCreep")]).execLastTask();
    }
    let site = (data["containerSite"] && Game.getObjectById(data["containerSite"]))
        || Game.getObjectById(task.id);
    if (!site) {
        return this.popTask().addTask([UtilsTask.taskData("recycleCreep")]).execLastTask();
    }
    if (this.store[RESOURCE_ENERGY] == 0) {
        let home = Game.rooms[task.homeRoom];
        let storage = home && home.storage;
        // 主房也没能量就原地等，别空跑去取
        if (!storage || storage.store[RESOURCE_ENERGY] == 0) return;
        this.addTask(UtilsTask.task(storage, "carryRes", undefined, { resType: RESOURCE_ENERGY }));
        return this.execLastTask();
    }
    if (!this.pos.inRangeTo(site, 3)) {
        this.moveTo(site, { range: 3, visualizePathStyle: { stroke: '#fffa00' } });
        return;
    }
    this.build(site);
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
        // 只在内容真的变化时写回。原来是每 tick 无条件重写整个数组（注释还写着
        // "必须始终写回"），满编 carrier 会让 Memory 持续处于脏状态——而整份
        // Memory 每 tick 都要序列化一次。同一文件的 registerStationSources 已经
        // 用了 "changed 才写" 的写法，这里对齐。
        let changed = false;
        let alive = [];
        for (let id of rmHarList) {
            if (Game.getObjectById(id)) alive.push(id);
            else changed = true;
        }
        if (!alive.includes(this.id)) {
            alive.push(this.id);
            changed = true;
        }
        if (changed) source["carryCreeps"] = alive;
    }
};

/** 防御 */
/**
 * 拆 invaderCore 的专队（任务处理器）。
 *
 * 关键：core 上面压着 **rampart** 时，直接打 core 是打不动的 —— rampart 会挡住
 * 对其下方结构的伤害。所以先拆掉压在上面的 rampart，再打 core。
 * 规模由 StrategyOuterHarvest.coreBusterPlan 按 core 等级决定
 * （一级单只 [ATTACK:15,MOVE:15]；二级起带 HEAL，见其注释）。
 */
Creep.prototype.coreBuster = function () {
    let task = this.headTask();
    if (!task) return;
    let core = Game.getObjectById(task.id);
    if (!core) {
        return this.popTask().addTask([UtilsTask.taskData("recycleCreep")]).execLastTask();
    }
    // 行军段与攻击段必须用**两个不同的移动缓存目标**：若都指向 core 坐标，
    // 跨房路径缓存在跨过房间边界后会被攻击段的同目标 moveTo 复用，边界上
    // idx 错位导致爬**原地不动**，再被过路爬的对穿来回搬运 —— 实测在
    // W33N55(0,24)↔W34N55(49,24) 边界上每 15 tick 振荡一次，40 分钟没前进
    // 一格（插桩证据：attack 每 tick 返回 -7、moveTo 从未被调用）。
    // 行军只负责「进房间」，目标取房间中心；进房后改走攻击段的全新短路径。
    // 被对穿弹回另一个房时也会自然走回这里，自愈。
    if (task.roomName != this.room.name) {
        this.moveTo(new RoomPosition(25, 25, task.roomName), { range: 20 });
        return;
    }
    // 压在 core 上的己方外的 rampart（core 自带的护盾）必须先拆。
    let barrier = core.pos.lookFor(LOOK_STRUCTURES)
        .filter(e => e.structureType == STRUCTURE_RAMPART && !e.my).head();
    let target = (barrier && barrier.hits > 0) ? barrier : core;
    // 自愈是独立意图，和攻击同 tick 并行（lv2+ 体型带 HEAL 才实际生效；纯输出体型
    // 没有 HEAL 部件，调了也只返回 ERR_NO_BODYPART，所以先查部件再调）。
    if (this.hits < this.hitsMax && this.getActiveBodyparts(HEAL) > 0) this.heal(this);
    // ranged 体型在 range 3 就能输出：不必贴脸 1 格（塔伤随距离衰减，
    // 而且远程对刷出来的 invader 守卫也能对射）。attack/rangedAttack 隔着
    // 房间边界时返回的都是 **-7 (ERR_INVALID_TARGET)** 而不是 -2
    // (ERR_NOT_IN_RANGE) —— 只判 -2 会把爬钉死在边界格上。所以只要
    // 攻击没真正生效就继续向 core 移动。
    let ranged = this.getActiveBodyparts(RANGED_ATTACK) > 0;
    let ret = ranged ? this.rangedAttack(target) : this.attack(target);
    if (ret == ERR_INVALID_TARGET && !barrier && core.ticksToDeploy > 0) {
        // core 还在无敌期（未部署，attack/rangedAttack 恒 -7，实测几千 tick 零伤害）。
        // 与其让这只爬在旁边站到 ttl 耗尽，不如现在就回收，
        // spawnCoreBuster 会在破防临近（剩 CORE_BUSTER_DEPLOY_LEAD）时重新派队。
        return this.popTask().addTask([UtilsTask.taskData("recycleCreep")]).execLastTask();
    }
    if (ret != OK && ret != ERR_NO_BODYPART) this.moveTo(target, { range: ranged ? 3 : 1 });
};

Creep.prototype.outerDefense = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        // 行军只负责「进房间」，目标取房间中心 —— 和 coreBuster 同一修法。
        //
        // 原来 goTo(task) 直奔任务里的源点坐标，而房间内攻击/贴窝的 moveTo 目标
        // （keeper 就站在源旁）经常就是同一个格子：跨房长路径缓存被房间内的
        // 同目标 moveTo 复用，跨界后 idx 错位，爬钉死在边境门格上被过路爬对穿
        // 搬来搬去 —— 实测 W33N55(0,18) 这一个格 20 分钟里先后困住两只防守爬，
        // 其中一只 ttl 剩 27 老死在门口，replacement 永远进不了场。
        this.moveTo(new RoomPosition(25, 25, task.roomName), { range: 20 });
    } else {
        let posts = pro.outerDefensePosts(this);
        // 防守爬只打**活体敌人**，不再去啃 invaderCore —— 拆 core 是 coreBuster
        // 专队的活（规模按 core 等级，见 StrategyOuterHarvest.coreBusterPlan）。
        //
        // 原来没有活体敌人时会退而求其次去打 core：core 10 万血根本拆不动，
        // 两只防守爬于是离开岗位走几十格围着它敲（实测守 (41,14) 窝的爬走到了
        // 房间东缘 (49,18)），窝区没人守，keeper 一出窝就屠杀矿工 ——
        // 9-30 早上丢 13 只爬的根因之一。而且一级 core 本来就不刷怪
        // （INVADER_CORE_CREEP_SPAWN_TIME lv1 = 0），它的威胁只在升级之后，
        // 而那由专队在升级前拆掉。
        let target = Game.getObjectById(this.memory.targetId);
        if (this.memory.targetId && (!target || !target.body)) {
            // 目标没了；或者还钉在 invaderCore 这类**结构**上（老 memory 遗留）
            // → 一律丢弃，防守爬的 targetId 只会是活体敌人的 id。
            delete this.memory.targetId;
            target = undefined;
        }
        // 活体敌人**每 tick 重查**，优先级高于一切静态目标。
        //
        // 威胁范围有两类：
        //  1) 守卫半径内的窝区敌人（keeper 出窝）；
        //  2) **友军遇袭**：敌人贴着我们任何一只爬（OUTER_DEFENSE_HELP_RADIUS）。
        //     invader 小队会游荡到窝区半径外、正卡在运输路线上——不扩范围的话，
        //     防守爬在旁边 3 格也不理，矿工/搬运被逐个咬死。
        // 然后只有**距目标最近**的那只防守爬出手（本组守窝是它的特例），
        // 其余留在岗位，避免两只同时弃岗、全房失守。
        // 威胁判定**全房统一**：keeper 靠近**任一** lair（不分自己组的），或贴近
        // 任何己方爬。原来按各自组的岗位半径算，会错位——威胁只有组 0 看得见，
        // 最近接手者却是看不见它的组 1，两边都不动（实测 (4,15) keeper 无人接战，
        // 西源矿工被屠）。
        let allies = this.room.find(FIND_MY_CREEPS);
        let allLairs = this.room.find(FIND_HOSTILE_STRUCTURES)
            .filter(e => e.structureType == STRUCTURE_KEEPER_LAIR);
        let hostileCreeps = this.room.find(FIND_HOSTILE_CREEPS)
            .filter(e => allLairs.some(l => e.pos.getRangeTo(l.pos) <= OUTER_DEFENSE_GUARD_RADIUS)
                || allies.some(c => c.pos.getRangeTo(e.pos) <= OUTER_DEFENSE_HELP_RADIUS));
        if (hostileCreeps.length) {
            hostileCreeps = hostileCreeps.filter(h => {
                let d = this.pos.getRangeTo(h.pos);
                return allies.every(c => c === this || c.memory.role != "outerHarvestDefenser"
                    // 已接战别的目标的防守爬不参与本轮竞争——但**邻近**目标例外：
                    // 远程体型 range 3 能兼顾身边一圈的敌人，挨得近的两个由同一只
                    // 打（用户确认的语义），不另派人。
                    || (c.memory.targetId && c.memory.targetId != h.id
                        && c.pos.getRangeTo(h.pos) > OUTER_DEFENSE_ENGAGE_SPREAD)
                    || c.pos.getRangeTo(h.pos) >= d);
            });
        }
        if (hostileCreeps.length) {
            // 目标取舍：**优先打已经在流血的那只**（Overmind CombatTargeting 的打分
            // `hitsMax - hits + healPotential`），但只在接战半径
            // （OUTER_DEFENSE_ENGAGE_SPREAD）内比较 —— 无界地追残血目标会为了几十格
            // 外的一只 keeper 走开，把正在被咬的矿工丢在原地（这是踩过的回归）。
            // 同分（都没掉血）退回「最近」，贴身时天然不抖。
            let wounded = hostileCreeps.filter(h => this.pos.getRangeTo(h.pos) <= OUTER_DEFENSE_ENGAGE_SPREAD
                && h.hits < h.hitsMax);
            let pick;
            if (wounded.length) {
                wounded.sort((a, b) => (b.hitsMax - b.hits) - (a.hitsMax - a.hits)
                    || this.pos.getRangeTo(a.pos) - this.pos.getRangeTo(b.pos));
                pick = wounded.head();
            } else {
                pick = this.pos.findClosestByRange(hostileCreeps);
            }
            if (pick && (!target || target.id != pick.id)) {
                target = pick;
                this.memory.targetId = pick.id;
            }
        } else if (target) {
            // 本 tick 没有活体 → 目标作废，回岗位贴窝（见下面的巡逻分支）。
            // 「当前目标还有效」和「当前目标还值得打」是两回事，优先级必须每 tick 重算。
            delete this.memory.targetId;
            target = undefined;
        }
        // ★ 治疗：**每一 tick 都要做**，不能放进「没有敌人」的分支里。
        //
        // 原来的写法是 `if (em) { attack...; return; }`，只要有目标就直接返回 ——
        // 而那个目标经常是 10 万血、打不动的 invaderCore（见上面选敌的注释）。
        // 于是治疗分支永远执行不到：挖矿爬被 source keeper 咬着掉血，旁边的防守爬
        // 在自顾自地砍 core / 只自愈，矿工就这么被磨死（W34N55 一晚上丢了 13 只爬）。
        //
        // 现在：不管有没有敌人，都先救 3 格内**掉血比例最高**的己方爬（rangedHeal，
        // ≤3 格；贴身时用 heal 效率更高）。没有伤员时才自愈。治疗和攻击是两个独立
        // 意图，同 tick 可以同时进行，不会互相顶掉。
        let hurt = this.pos.findInRange(FIND_MY_CREEPS, 3, { filter: e => e.hits < e.hitsMax });
        let healingAlly = false;
        if (hurt.length) {
            hurt.sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax);
            let ally = hurt[0];
            let code = this.pos.getRangeTo(ally) <= 1 ? this.heal(ally) : this.rangedHeal(ally);
            if (code == ERR_NOT_IN_RANGE) this.moveTo(ally, { range: 1 });
            healingAlly = true;
        } else if (this.hits < this.hitsMax) {
            this.heal(this);
        }
        this.memory.dontPullMe = false;

        let em = Game.getObjectById(this.memory.targetId);
        if (em) {
            // 攻击手段跟着**实际体型**走：远程体型（风筝反制，RA 部件没有 ATTACK）
            // 在 range 3 用 rangedAttack 对射，近战体型贴身 attack。
            //
            // 原来只调 this.attack(em)：远程体型没有 ATTACK 部件，attack 恒返回
            // **ERR_NO_BODYPART（-12）≠ ERR_NOT_IN_RANGE（-9）**，moveTo 永远不会
            // 被调用 —— 防守爬在门口锁定目标后一步都不走，满血站到 ttl 耗尽
            // （实测两只钉死在 (0,17)/(49,17) 门格对上，接替兵进来也接着站）。
            // attack/rangedAttack 没真正生效（含跨房边界的 -7）就继续接近目标。
            let ranged = this.getActiveBodyparts(RANGED_ATTACK) > 0;
            if (!ranged) {
                // ===== 近战对拼规则：**能不能赢算了再打**，不是无脑贴脸 =====
                //
                // 引擎事实（screeps/engine 源码）：
                //   · source keeper **不追人**（creeps/keepers/pretick.js：每 tick 走向
                //     自己记住的 source，只打 range 1 内的目标）→ 打不过可以退，退开它
                //     就回矿点，range 4 只吃 10/发而自愈 132/发 → 4 格是免费医院。
                //   · invader / 玩家爬**会追**（invaders/findAttack.js：findClosestByPath
                //     直追最近的敌人）→ 退了它照样贴上来，白丢一轮输出，还不如站着对拼。
                //   · keeper 伤害：贴身 10 ATTACK×30 + 10 RA×10 = 400/发；range 2 = 100、
                //     range 3 = 40、range 4 = 10、≥5 = 0（远程按距离 [10,10,4,1]/部件）。
                //
                // 对拼账（用**自己的实际部件**算，不写死）：
                //   我们每 tick 输出 30×ATTACK 数、自愈 12×HEAL 数；
                //   对方贴身总伤害 = Σ(30×其 ATTACK + 10×其 RA)。
                //   总伤害 ≥ 输出+自愈 时这场对拼**赢不了**（两只 keeper 贴身 = 800 >
                //   660+132 = 792，实测就是这个数才输的）→ 那就别贴，退到 4 格自愈等队友。
                let keeper = !!(em.owner && em.owner.username == "Source Keeper");
                let ours = 30 * this.getPartCnt(ATTACK) + 12 * this.getPartCnt(HEAL);
                let incoming = 0;
                this.room.find(FIND_HOSTILE_CREEPS).forEach(c => {
                    // 半径 5：这一场里「很快能加入」的敌人都算进来（keeper 平地 0.35 格/tick，
                    // 5 格外 15 tick 内就到场）。只看 3 格会导致「贴上去才发现打不过 →
                    // 退开 → 敌人不在 3 格内又判定能打 → 再贴」的来回抖。
                    if (this.pos.getRangeTo(c.pos) > 5) return;
                    incoming += 30 * c.getActiveBodyparts(ATTACK)
                        + 10 * c.getActiveBodyparts(RANGED_ATTACK);
                });
                let winnable = incoming < ours;
                let hurt = this.hits < this.hitsMax / 2;
                // 收尾例外：目标再两 tick 就能打死（≤2×我们的输出）→ 照打。
                // 否则会出现「两只 keeper 一起守着 → 两只防守爬都退到 4 格干等」
                // 的死局（前面打残的那只没人去收）。
                let finishing = em.hits <= 30 * this.getPartCnt(ATTACK) * 2;
                if (keeper && !finishing && (hurt || !winnable)) {
                    // 不追人的对手 + 这场账算下来赢不了 → 退到 range 4 只自愈
                    //（治疗已在上面治疗分支做过；这里连 attack 都不调）
                    // 注意判据是 getRangeTo < 4：`inRangeTo(em, 4)` 在**贴身时也为真**
                    //（range 1 ≤ 4），原来那句等于「永远不后退」—— 重伤的防守爬其实一直
                    // 站在原地挨 400/发、自愈 132/发，净 -268/tick，只是看起来在「退守」。
                    if (this.pos.getRangeTo(em.pos) < 4) this.moveTo(em, { range: 4 });
                    return;
                }
                // 账算得赢（或对手会追人退不掉）→ 贴脸对拼，输出最大化
                let ret = this.attack(em);
                if (ret == OK) {
                    // Overmind attackAndChase：贴身命中后**同 tick 往目标方向推一格** ——
                    // 目标这一步若往后退，我们照样保持贴身（不推就白丢一轮输出；
                    // 目标不动时这一格移动会被引擎自然取消，没有代价）。
                    this.move(this.pos.getDirectionTo(em.pos));
                    return;
                }
                if (ret != ERR_NO_BODYPART) {
                    this.moveTo(em, { range: 1 });
                }
                return;
            }
            let ret = this.rangedAttack(em);
            if (ret != OK && ret != ERR_NO_BODYPART) this.moveTo(em, { range: 3 });
            // Overmind hydralisk 语义：血 <90% 就风筝后撤一格（保持 3~4 格对射）；
            // 单 keeper 时贴近近战 reaper 当奶妈（rangedHeal 接战中的队友）
            if (this.hits < this.hitsMax * 0.9) {
                let flee = PathFinder.search(this.pos, { pos: em.pos, range: 5 }, { flee: true, maxRooms: 1 }).path[0];
                if (flee) this.moveTo(flee);
            } else if (this.room.find(FIND_HOSTILE_CREEPS).length == 1) {
                let reaper = this.room.find(FIND_MY_CREEPS).filter(c =>
                    c.memory.role == "outerHarvestDefenser" && c != this && c.memory.targetId)[0];
                if (reaper && reaper.hits < reaper.hitsMax && this.pos.getRangeTo(reaper) <= 3) {
                    this.rangedHeal(reaper);
                } else if (reaper && this.pos.getRangeTo(reaper) > 3) {
                    this.moveTo(reaper, { range: 3 });
                }
            }
            // 自愈/救人都已在上面做过；这里只在还在掉血且没在救别人时补一次自愈。
            if (!healingAlly && this.hits < this.hitsMax) this.heal(this);
            return;
        }
        // 有伤员在场（且自己不是那个伤员）就专心救人，先别去巡逻/贴窝。
        if (healingAlly || hurt.length) {
            return;
        }

        // 没有敌人也没有伤员 → 回到自己认领的窝旁边贴守。
        //
        // 两级策略：
        //  1) 有窝在倒计时（ticksToSpawn 有值）→ 守**最快要出**的那个，贴到 range 1。
        //     keeper 出窝那一 tick 就能打到，不会让它先跑去打我们的 keeper。
        //  2) 都没倒计时（窝还没被激活）→ 按 dwell 在这组窝之间轮换，两个都照看。
        // 原来是「一只爬把 4 个窝走一圈」，一圈 463 tick，覆盖率只有 ~19%。

        if (posts.length) {
            // 提前落位：keeperLair.ticksToSpawn 就是「下一只 keeper 还有多久出窝」，
            // 直接站到**最快要出**的那个窝旁边等着。
            //
            // 为什么要提前：keeper 一出窝就扑最近的一只爬。defenser 已经贴着窝，
            // 那最近的爬就是它自己 —— keeper 会原地跟它打，8 tick 内被 22 ATTACK
            // （660/发）打掉，**不会**跑到矿工那边去乱杀。反过来如果出窝时
            // defenser 不在（在另一个窝或路上），keeper 就会一路去找矿工。
            //
            // 这个「守最快出怪的窝」天然就实现了「杀完这只就换另一只」：
            // 清掉之后该窝的倒计时被重置回 ~300，另一个窝立刻成为最小的那个，
            // defenser 自己就走过去了，不需要额外的轮换状态机。
            let counting = posts.filter(e => e.ticksToSpawn !== undefined);
            let wp;
            if (counting.length) {
                wp = counting.reduce((a, b) => a.ticksToSpawn <= b.ticksToSpawn ? a : b);
                delete this.memory.patrolArrive;
            } else {
                // 组内两个窝都还没被激活（ticksToSpawn 为 undefined）→ 没有出怪时间
                // 可依据，按 dwell 在两窝之间轮换，顺便把两个窝都「唤醒」，
                // 免得附近的矿工一直在无防守的窝边上作业。
                let idx = this.memory.patrolIdx || 0;
                if (idx >= posts.length) idx = 0;
                wp = posts[idx];
                if (this.pos.inRangeTo(wp.pos, 1)) {
                    if (this.memory.patrolArrive === undefined) { this.memory.patrolArrive = Game.time; return; }
                    if (Game.time - this.memory.patrolArrive < pro.outerDefenseDwell(posts)) return;
                }
                if (posts.length > 1) {
                    this.memory.patrolIdx = (idx + 1) % posts.length;
                    delete this.memory.patrolArrive;
                    wp = posts[this.memory.patrolIdx];
                }
            }
            // 贴着窝站（range 1）。隔三格是打不到刚出窝的 keeper 的，
            // 而且只有贴着才会成为「最近的爬」，把 keeper 钉在原地。
            // （reusePath 由超级移动优化接管，传了也会被忽略，不传。）
            if (!this.pos.inRangeTo(wp.pos, 1)) {
                this.moveTo(wp.pos, { range: 1 });
            }
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
        // 同 registerStationSourcesCarryOutRoom：内容变化才写回
        let changed = false;
        let alive = [];
        for (let id of rmHarList) {
            if (Game.getObjectById(id)) alive.push(id);
            else changed = true;
        }
        if (!alive.includes(this.id)) {
            alive.push(this.id);
            changed = true;
        }
        if (changed) source["defenseCreeps"] = alive;
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
        // 卸货点同样走 outerCarryDropOff（主房边缘 link 在位就卸它）
        let dropHome = this.mainRoom();
        let dropOff = (dropHome && pro.outerCarryDropOff(dropHome)) || (dropHome && dropHome.storage);
        if (!dropOff) return this.execLastTask();
        this.addTask([
            UtilsTask.task(dropHome.storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
            UtilsTask.task(dropOff, "harvestEnergyOuterCarryRoadBuilder", undefined, {
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
        let doneHome = this.mainRoom();
        let doneDropOff = (doneHome && pro.outerCarryDropOff(doneHome)) || (doneHome && doneHome.storage);
        if (!doneDropOff) return this.execLastTask();
        this.addTask([
            UtilsTask.task(doneHome.storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
            UtilsTask.task(doneDropOff, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.mineRoom, stationId: task.stationId, roadDir: 1,
            }),
        ]);
        return this.execLastTask();
    }
    // 到达端点：先填充所有能量到 storage（即使道路未修完也要先送货），
    // 然后才决定掉头修路或返回矿区。
    //
    // 注意这里原来多了一个 `|| this.store[RESOURCE_ENERGY] == 0`：**空载时不论
    // 人在哪**都会进这个分支并 `popTask()`。任务栈一旦被扒空，全代码库没有任何
    // 地方会再给它补任务 —— 爬就永久闲置在原地。W33N55 实测 6 只空载 carrier
    // （`lastTask()` 已经是 undefined）就这样趴在 storage 附近不动：0 能量、
    // 占着格子、照常吃 CPU，从外面看就是「堵车」。
    // 只有拿不到矿区信息（data 为空、无处可去）时才允许把任务清掉。
    let noRoute = !data;
    if (this.pos.isNearTo(target) || (this.store[RESOURCE_ENERGY] == 0 && noRoute)) {
        if (target && target.store && this.store[RESOURCE_ENERGY] > 0) {
            // 卸货点是**边缘 link** 时：link 只有 800 容量，而这一趟有 1250+。
            // 先把塞得进的塞进去，剩下的**有界地等** link 把能量发给主房
            // （link 轮询约每 7~10 tick 一次）—— 在 link 边等几 tick，比带着
            // 几百能量再走完主房那二十格划算得多。等满
            // OUTER_EDGE_LINK_WAIT 个「link 满、一克都塞不进」的 tick 就收手，
            // 剩下的交给栈里的 fillRes(storage) 兜底（**绝不楔死**）。
            let energy = this.store[RESOURCE_ENERGY];
            if (target.structureType == STRUCTURE_LINK) {
                let free = target.store.getFreeCapacity(RESOURCE_ENERGY);
                let amount = Math.min(energy, free);
                let wait = task.edgeLinkWait || 0;
                if (free <= 0) wait++;                       // 这一 tick 一克都塞不进
                if (amount < energy && wait < OUTER_EDGE_LINK_WAIT) {
                    if (amount > 0) this.transfer(target, RESOURCE_ENERGY, amount);
                    task.edgeLinkWait = wait;
                    return;                                   // 留在 link 边等它发走
                }
                if (amount > 0) this.transfer(target, RESOURCE_ENERGY, amount);
            } else {
                this.transfer(target, RESOURCE_ENERGY);
            }
        }
        this.popTask();
        if (task.keepBuilding && this.store[RESOURCE_ENERGY] > 0 && data) {
            // 确定完成后再退出：端点强制刷新完成度检查
            complete = pro.outerRoadComplete(data, true);
            if (!complete) {
                // 掉头：回程那一趟的卸货点同样走 outerCarryDropOff（边缘 link 在位就卸它）
                let backHome = this.mainRoom();
                let nextTarget = task.roadDir == 1 ? pro.getOuterMineTarget(data)
                    : ((backHome && pro.outerCarryDropOff(backHome)) || (backHome && backHome.storage));
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
            // 走不通：本 tick 先退回原生 moveTo（照样走得动），只有连续失败才作废缓存
            pro.invalidateOuterRoadPath(data);
            this.moveTo(target, { visualizePathStyle: { stroke: '#fffa00' } })
        } else {
            pro.clearOuterRoadPathFail(data);
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
        let home = this.mainRoom();
        if (!home || !home.storage) return;   // 主房/storage 拿不到：本 tick 跳过（此前这里抛 TypeError 刷 lastError）
        // 卸货点：主房边缘 link 在位就卸它（回程同路、先经过它），否则 storage。
        // 到场时 link 满/消失由卸货函数自己回退，见 outerCarryDropOff。
        let dropOff = pro.outerCarryDropOff(home) || home.storage;
        let isRoadBuilder = this.getPartCnt(WORK) > 0 && this.getActiveBodyparts(WORK) > 0;
        if (data && !pro.outerRoadComplete(data) && isRoadBuilder) {
            // 道路未修好时只让带 WORK 的专职 carrier 修路。普通搬运爬
            // 仍然沿缓存路线把能量送入 Storage，不能让修路任务饿死主房。
            this.addTask(UtilsTask.task(dropOff, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.roomName, stationId: task.id, keepBuilding: true, roadDir: 1,
            }));
        } else {
            let roadTask = [
                // 栈底：最终兜底把能量送进 storage（边缘 link 满/被拆时接住剩下的货）
                UtilsTask.task(home.storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
                // 边缘 link 在位时插一层：先往 link 卸，卸不下的往下漏给 storage
                dropOff != home.storage
                    ? UtilsTask.task(dropOff, "fillRes", undefined, { resType: RESOURCE_ENERGY })
                    : undefined,
                // 栈顶：沿缓存路线走回主房，到场（link 或 storage）卸货
                UtilsTask.task(dropOff, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                    mineRoom: task.roomName, stationId: task.id, roadDir: 1,
                }) // 想致富先修路：source -> storage
            ]
            this.addTask(roadTask);
        }
        // this.execLastTask();
    }
}



/**
 * 外矿 keeper 的 WORK 组数上限。
 *
 * 中间九房（Source Keeper 房）的 source 容量是 4000，每 300 tick 重置一次
 * —— 也就是重置速率 4000/300 ≈ **13.33 能量/tick**。
 *
 * 这个值原来是 3，算出来的体型是 {MOVE:3, WORK:6, CARRY:1}，只有 6 个 WORK = 12 能量/tick，**低于重置速率**：source 永远采不完，keeper 一直被 regen 追着跑，3 个矿点合计只出 ~36/tick，却要占 3 个 keeper 的 spawn 与防守成本。
 *
 * 提到 5 → 体型 {MOVE:5, WORK:10, CARRY:2}，10 个 WORK = 20 能量/tick > 13.33，能在 ~200 tick 内把一个矿点采空（留 100 tick 缓冲应对往返与骚扰）。
 *
 * 主房 keeper 不受影响（下面 innerMaxPartCnt）。
 * 想再保守/激进可用 Memory.marketSettings.outerMaxPartCnt 覆盖。
 */
let outerMaxPartCnt = 5
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
        // 外矿：默认 outerMaxPartCnt（见上面注释里 4000/300 tick 的重置速率推导），
        // 可用 Memory.marketSettings.outerMaxPartCnt 覆盖。
        let maxPart = isOutRoom
            ? Number(Memory.marketSettings && Memory.marketSettings.outerMaxPartCnt || outerMaxPartCnt)
            : Math.max(Math.ceil(regPerTick / 4 + 0.1), innerMaxPartCnt);
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
    /**
     * 外矿搬运爬体型：**2:1 的 CARRY:MOVE**，`[CARRY,CARRY,MOVE]` 循环排列
     * （用户 10-03 指示），满编 34 CARRY + 16 MOVE = 50 部件 / **1700 容量**。
     *
     * 为什么是 2:1：路上每格的疲劳 ≈ 部件数 / 2，而 MOVE 提供的额度是 2×MOVE
     * —— 2 CARRY : 1 MOVE 正好在铺好的路上跑满 1 格/tick，同部件数下比 1:1 多装
     * 36% 的货（1700 vs 1250）。循环排列让伤害（从 body 前端往后扣）每扣一组都
     * 保持 2:1，被伏击掉一半部件后在路上依然满速，不会越打越慢。
     * 尾部两个 CARRY 把部件数补到 50。
     *
     * 能量不足时按能量收缩组数（每组 150 能量），否则低等级房会 spawnFailure。
     */
    getOuterHarCarrierBodyConfig(energy, maxPart) {
        let triples = Math.min(Math.floor(maxPart / 3), 16);
        while (triples > 1 && triples * (BODYPART_COST[CARRY] * 2 + BODYPART_COST[MOVE]) > energy) triples--;
        let body = [];
        for (let i = 0; i < triples; i++) body.push(CARRY, CARRY, MOVE);
        if (triples == 16) body.push(CARRY, CARRY);   // 50 部件 / 34 CARRY = 1700
        return body;
    },
    /**
     * 修路爬（前缀 2 个 WORK + 同样的 2:1 组）。
     *
     * **部件数必须 ≤ 50**：上一版写的是 `floor(maxPart / 2)` 组 → 2 + 25×3 = 77
     * 部件，spawnCreep 直接 ERR_INVALID_ARGS，修路爬一只也生不出来（路坏了没人修）。
     * 现在最多 16 组 = 2 + 48 = 50 部件（32 CARRY + 16 MOVE + 2 WORK，容量 1600）。
     */
    getOuterHarCarrierBuildBodyConfig(energy, maxPart) {
        let triples = Math.min(Math.floor((maxPart - 2) / 3), 16);
        while (triples > 1 && triples * (BODYPART_COST[CARRY] * 2 + BODYPART_COST[MOVE])
            + BODYPART_COST[WORK] * 2 > energy) triples--;
        let body = [WORK, WORK];
        for (let i = 0; i < triples; i++) body.push(CARRY, CARRY, MOVE);
        return body;
    },
    /**
     * 外矿防守爬的体型与 boost 需求。
     *
     * 原来只有两套写死的体型（invader 房 50 部件 ATTACK 型、普通房 20 部件），
     * 和房间里实际驻守的 NPC 强度完全无关。中间九房（Source Keeper 房）常驻的
     * keeper 是 tough17 / attack10 / ranged_attack10 / move13 的满编 50 部件单位，
     * 两只同时贴上来约 800 伤害/发，而固定体型只带 11 个 HEAL（132 奶/发）——
     * 防守爬进去就被打死，然后又被无脑补员，形成「生一只、死一只」的循环。
     *
     * 现在按房间里的实际敌情估算：
     *   ATTACK 数 = 打穿对面「能奶起来的最大有效血量」所需的量（ATTACK 部件 30 伤）
     *   HEAL 数   = 扛住入射伤害所需的量（带上 XGHO2 后只有 30% 真正掉血，HEAL 部件 12 奶）
     *
     * 没有视野、或房间里没有活体敌人时退回原来的固定体型，行为不变。
     *
     * @return {{body: string[], boostRes: Object}}
     */
    getOuterHarDefenseBodyConfig(isInvader, harRoom) {
        // invader 4~5 人小队是**远程风筝**打法：纯近战追不上（对方保持 3+ 格
        // 边退边打，我们一格都摸不到），实测被活活磨死。防守改远程对射：
        //   · ranged 在 range 3 与小队对轰，不追、不脱岗；
        //   · TOUGH 强化**先结算减伤**（XGHO2 ×0.3），前排吸收对射伤害；
        //   · heal 续航。
        // 无强化兜底也有 220 dps（近战版在风筝战术下实际 dps ≈ 0）；
        // T3 强化（boostRes 由 trySpawnOuterDefenser 按 boostAble 决定是否附加）
        // 后 880 dps + 288 奶 + tough 减伤，对小队是碾压。
        // 默认**近战** {A22,H11,M17}：打 lair 生成的 keeper 稳赢（660 dps + 132 自奶），
        // 不用强化（用户 10-03 指示），但**部件顺序必须 MOVE → ATTACK → HEAL**。
        //
        // 伤害从 body 前端往后扣（engine: creeps/_recalc-body.js）——**谁放在最前面，
        // 谁就是肉盾**。放在前面用 ATTACK 挡伤害是致命的：打掉前 22 个部件后我们的
        // dps 归零，而 keeper 的两个输出部件藏在 3000 血（17 TOUGH + 13 MOVE）后面，
        // 全程满输出。逐 tick 模拟（`.workbuddy/tmp/edge/keeper_fight_sim.py`，
        // 用引擎规则：部件 100 血、30/ATTACK、远程按距离 [10,10,4,1]、12/HEAL）：
        //   [A22,H11,M17] 贴身对拼 → **输**：17 tick 我们死，keeper 还剩 1850
        //   [M17,A22,H11] 贴身对拼 → **赢**：8 tick 打完，我们还剩 3444
        //   [A22,H11,M17] 靠「掉血退 4 格自愈」的循环 → 赢，但要 38 tick（多挨 4 倍）
        // 把 MOVE 放前排的代价很小：MOVE 每部件 50 能量、只在**行军**时必需
        // （打起来只需贴身，我们的 attack 成功后还会往目标方向推一格），
        // 而 8 tick 的战斗里 MOVE 部件只是掉血、没被销毁（hits>0 就仍然有效）。
        // 保持用户定稿的 {A22,H11,M17} 部件数，只把顺序改对。
        const meleeBody = () => ({
            body: ManagerCreeps.calcBodyPart({[MOVE]: 17, [ATTACK]: 22, [HEAL]: 11}), boostRes: {}});
        const smallBody = () => ({body: ManagerCreeps.calcBodyPart({[MOVE]: 10, [ATTACK]: 9, [HEAL]: 1}), boostRes: {}});
        if (!harRoom) return isInvader ? meleeBody() : smallBody();

        // invader **远程风筝小队**（≥2 只 Invader 爬）：纯近战摸不到边退边打的
        // 小队（实测被磨死），才换强化远程（TOUGH 前置先结算减伤）。资源够时
        // boostAble 通过即挂 T3；拿不出化合物则由 trySpawnOuterDefenser 剥 TOUGH。
        const squadBody = () => ({
            body: ManagerCreeps.calcBodyPart({[TOUGH]: 2, [RANGED_ATTACK]: 22, [HEAL]: 6, [MOVE]: 20}),
            boostRes: {
                [BOOST_RES["damage"][2]]: 2 * 30,
                [BOOST_RES["heal"][2]]: 6 * 30,
                [BOOST_RES["rangedAttack"][2]]: 22 * 30,
            },
        });
        let hostiles = harRoom.getHostileCreeps();
        if (!hostiles.length) {
            // 没有活体敌人：只有 lair / invaderCore 时用能拆掉它的配置即可
            let hasNest = harRoom.find(FIND_HOSTILE_STRUCTURES)
                .some(e => e.structureType == STRUCTURE_KEEPER_LAIR || e.structureType == STRUCTURE_INVADER_CORE);
            if (!hasNest) return {body: ManagerCreeps.calcBodyPart({[MOVE]: 6, [ATTACK]: 5, [HEAL]: 1}), boostRes: {}};
            return isInvader ? meleeBody() : smallBody();
        }

        if (isInvader && hostiles.filter(e => e.owner.username == "Invader").length >= 2) {
            return squadBody();
        }
        let sumDamage = hostiles.map(e => e.possibleDamage(false, 2)).sum();      // 距离 2 时的全部伤害
        let sumHeal = hostiles.map(e => e.possibleHealDamage(1, false)).sum();    // 对面全部奶量
        // 注意：这里原来是 e.possibleToughBeHitsDamage(sumHeal)，那个方法
        // **全代码库都不存在** —— 只要看得见敌人就抛 TypeError，外矿 defenser
        // 直接生不出来。改用 WarDamageCal.possibleBreakDamage（见其注释）。
        let maxTough = hostiles.map(e => WarDamageCal.possibleBreakDamage(e, sumHeal)).maxBy(e => e) || 0;
        let attackCnt = Math.max(1, Math.ceil(maxTough / 30) + Math.ceil(sumDamage * 0.3 / 30));
        let healCnt = Math.max(1, Math.ceil(sumDamage * 0.3 / 12));
        let moveCnt = Math.ceil((attackCnt + healCnt) / 2);
        let boostRes = {};

        // 需求超过 50 部件时**不做 T3 强化**，按比例压到 50 部件即可。
        //
        // T3 强化一只 50 部件的爬要消耗 ~1500 单位化合物（30/部件），市价
        // 150 万信用点起，而外矿的真实威胁（source keeper ~600 伤、invader
        // 小队 1000 血×3~4）实测 50 体型无强化就稳赢（keeper 墓碑远多于我们的）。
        // 临时多出的伤害需求（invader 小队路过）由「最近的防守爬出手」+
        // 第二只防守爬覆盖，多派一只 50 体型 = 7010 能量，比强化便宜三个数量级。
        // 玩家级威胁本来就归 defenseHighWay 的强化体系管，不在这里烧化合物。
        if (attackCnt + healCnt + moveCnt > 50) {
            let scale = 50 / (attackCnt + healCnt + moveCnt);
            attackCnt = Math.max(1, Math.floor(attackCnt * scale));
            healCnt = Math.max(1, Math.floor(healCnt * scale));
            moveCnt = Math.max(1, Math.ceil((attackCnt + healCnt) / 2));
            if (attackCnt + healCnt + moveCnt > 50) attackCnt = Math.max(1, 50 - healCnt - moveCnt);
        }
        // 同上：MOVE 放最前当肉盾，ATTACK/HEAL 放后面保住输出与续航
        let body = ManagerCreeps.calcBodyPart([[MOVE, moveCnt], [ATTACK, attackCnt], [HEAL, healCnt]]);
        // 中间九房的 source keeper 是满配 50 部件（约 5000 血，贴身时近战+远程
        // 合计约 400/发）。上面是按「当前看得见的那几只、且按 dis=2 只算远程」
        // 估的体型，实战一贴身就会奶量不足被反杀 —— 实测算出来只有
        // 16 ATTACK + 5 HEAL，而满血打赢 keeper 的是 22 ATTACK + 11 HEAL。
        // 所以入侵房（isInvader）一律不低于手工调好的 bigBody。
        if (isInvader) {
            let big = meleeBody().body;
            if (body.length < big.length) return { body: big, boostRes: {} };
        }
        return {body: body, boostRes: boostRes};
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
        // regFun 原来是 "registerStationSources"：它把矿物 id 当成 source id 写进
        // stationSources[mineralId]，于是 trySpawnOuterHarKeeper 遍历 stationSources
        // 时会把矿物当成一个矿点，给它派 harvestEnergyKeeper（对着 mineral 挖能量）。
        // 外矿矿物爬的补员由 trySpawnOuterMineralKeeper 按 role + 任务房间判断，
        // 不需要登记表，所以 regFun 置空。
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestMineralOuterKeeper", undefined)
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
     * 外矿路线的寻路代价矩阵（两次搜索都必须用）。
     *
     * 原来兜底那次 `PathFinder.search` **完全没有 roomCallback** —— 等于不加载
     * 任何建筑代价。于是首选搜索因为主房蓝图约束返回 incomplete 时，兜底就会解出
     * 一条**直接从 extension、甚至 constructedWall 上穿过去**的路线。
     *
     * 实测（W34N55 外矿路线，71 个路点）：其中 6 个压在自家建筑上 ——
     * W33N55:(2,19) constructedWall、(13,28) rampart、
     * (16,28)/(19,28)/(20,29)/(21,32) extension。
     * carrier 走到那儿就被挡死、只能在原地来回蹭，同时因为路点永远"还没到"，
     * `outerRoadComplete` 也就永远为假 —— 路看起来"永远修不完"。
     *
     * 代价约定（决定了路线长什么样）：
     *   空地 2 / 沼泽 5 / 不可走建筑 255
     *   已有的路、容器、己方 rampart、link → **1**（最低）
     *   蓝图路网 → 1；蓝图里规划的非路建筑 → 50（软代价，避免把房间唯一出口当成
     *   绝对墙导致无解）
     *
     * 空地故意比建筑高（2 > 1），这样寻路会**优先复用房间里已有的路**，
     * 而不是在旁边的草地上另走一条、逼我们再多铺一段新路。规则对任何房间通用，
     * 没有任何房间特定的部分。
     *
     * useBlueprint=true：首选搜索，按主房蓝图路网走。
     * useBlueprint=false：兜底搜索，不要蓝图，但**必须**保留「已建成建筑不可走」。
     */
    /**
     * 该房蓝图里**规划为可走**（road / container）的格子集合，形如 "x:y"。
     * 按房间对象缓存，一个 tick 只算一次。
     *
     * 用途：主房的路网由本地规划器维护，我们只「复用蓝图内已有的路」；
     * 蓝图之外那些历史遗留的多余道路不修、不铺，让它自然衰减掉。
     */
    /**
     * 缓存路线是否仍然「整条都走得通」。
     *
     * 判据与代价矩阵同一套：路点上出现任何**不可走建筑**（不是 road / container /
     * 己方 rampart / link）就算废了。与具体是什么建筑无关，所以 nuker、塔、lab、
     * extension、墙……任何新盖起来的建筑都会被自动识别。
     *
     * 结果按 OUTER_ROAD_VALIDATE_INTERVAL 缓存，避免每 tick 全路线 lookForAt。
     * 没视野的房间先放过（看不到就无从判断，等有视野再复检）。
     */
    /**
     * 外矿路线上「爬能站上去」的判定 —— **全代码库只允许有这一份**。
     *
     * 只有三种：己方的 rampart、container、road。
     * **link 不算**：Screeps 里除 road / container / 己方 rampart 之外，其余建筑
     * 都会挡住移动。之前代价矩阵把 link 也算可走，等于默许路线穿过 link，爬到那儿
     * 就卡住 —— 和 nuker / extension 是同一类坑。
     *
     * 这个判定被四处共用，任何一处不一致都会造成「寻路认为能走、实际走不了」：
     *   - outerRoadRoomCallback：寻路代价矩阵（可走 → 1，其余 → 255）
     *   - outerRoadWalkable：缓存路线复检
     *   - outerRoadComplete：路线是否已全部铺成路
     *   - placeOuterRoadSites：铺工地时跳过已有建筑
     */
    /** 单个建筑能不能被爬踩：只有路、容器、**己方** rampart 三种。 */
    outerRoadStructureWalkable(s) {
        return s.structureType == STRUCTURE_ROAD
            || s.structureType == STRUCTURE_CONTAINER
            || (s.structureType == STRUCTURE_RAMPART && s.my);
    },
    outerRoadTileWalkable(structures) {
        // 判据就一句：**把可走的建筑滤掉，只要还剩东西，这格就站不上人**。
        //
        // 一格最多只会有一个不可走建筑（rampart 是可以叠的，其他建筑不行），
        // 所以不需要去数、也不需要管多个。
        //
        // 反例（踩过）：原来写的是「some 是路/容器/己方 rampart 就可走」——
        // 等于「有一个可走就算可走」，同格的 rampart 会把 nuker 掩盖掉。
        // 实测 (22,30) 上 nuker 与己方 rampart 共存，判定成可走，寻路直接穿过 nuker。
        return !structures.some(s => !pro.outerRoadStructureWalkable(s));
    },
    outerRoadWalkable(path, data) {
        if (data.roadValidateTick && Game.time - data.roadValidateTick < OUTER_ROAD_VALIDATE_INTERVAL) {
            return data.roadValidateOk !== false;
        }
        data.roadValidateTick = Game.time;
        for (let p of path) {
            let room = Game.rooms[p.roomName];
            if (!room) continue;
            let st = room.lookForAt(LOOK_STRUCTURES, p.x, p.y);
            if (!st.length) continue;
            if (!pro.outerRoadTileWalkable(st)) { data.roadValidateOk = false; return false; }
        }
        data.roadValidateOk = true;
        return true;
    },
    blueprintWalkableSet(room) {
        if (!room._plannedRoadSet) {
            let set = new Set();
            let sm = room.memory && room.memory.structMap;
            if (sm) {
                ['road', 'container'].forEach(type => {
                    if (!sm[type]) return;
                    pro.structMapPositions(sm[type]).forEach(p => {
                        let x = p.x != undefined ? p.x : p[0];
                        let y = p.y != undefined ? p.y : p[1];
                        set.add(x + ":" + y);
                    });
                });
            }
            room._plannedRoadSet = set;
        }
        return room._plannedRoadSet;
    },
    outerRoadRoomCallback(roomName, useBlueprint, homeRoom) {
        let room = Game.rooms[roomName];
        let cm = new PathFinder.CostMatrix();
        let terrain = Game.map.getRoomTerrain(roomName);
        for (let y = 0; y < 50; y++) {
            for (let x = 0; x < 50; x++) {
                let t = terrain.get(x, y);
                // 空地给 2（不是 1）：下面会把「已有的路/容器/己方 rampart/link」压到 1，
                // 空地必须留出一档差距，否则路和草地等价、寻路完全不会偏向已有的路，
                // 于是它顺着草地走，逼我们另外铺一条新路。沼泽仍 5。
                cm.set(x, y, t == TERRAIN_MASK_WALL ? 255 : (t == TERRAIN_MASK_SWAMP ? 5 : 2));
            }
        }
        if (!room) return cm;
        if (useBlueprint) {
            let structMap = room.memory && room.memory.structMap;
            if (structMap) {
                for (let type in structMap) {
                    // 蓝图里的路/容器 → 1；**其余规划建筑 → 255，直接当墙**。
                    //
                    // 原来非路建筑给的是软代价 50（注释担心"硬墙会让房间唯一出口不可达"），
                    // 但那是个误判：当时真正导致 incomplete 的是「storage 自己是建筑、
                    // 目标格不可站」。判据改成 reachesDestination 之后，硬墙完全可行。
                    //
                    // 软代价 50 的后果很严重：路线会**穿过规划中还没盖的建筑**择优，
                    // 等那栋建筑（nuker / 塔 / lab…）真的盖起来，这条缓存路线当场被堵死，
                    // 而缓存要等 1000 tick 才重算 —— 期间所有外矿爬全卡在那儿。
                    // 实测：nuker 一盖好路线就废了。
                    // 规划建筑一并当墙后，路线从规划那一刻起就绕开它，建起来也不受影响。
                    let walkablePlan = (type == 'road' || type == 'container');
                    pro.structMapPositions(structMap[type]).forEach(p => {
                        let x = p.x != undefined ? p.x : p[0];
                        let y = p.y != undefined ? p.y : p[1];
                        if (walkablePlan) {
                            if (cm.get(x, y) < 254) cm.set(x, y, 1);
                        } else {
                            cm.set(x, y, 255);
                        }
                    });
                }
            }
        }
        // 已有建筑：可走的压到最低代价 1，不可走的封死 255。
        //
        // **必须给可走建筑 1 而不是沿用地形代价**：否则房间内已有的路和旁边的草地
        // 同价，寻路毫无理由偏向已有的路，就会在草地/沼泽上另走一条，逼我们为了
        // 这一段又铺一条新路（还要额外占工地、多花能量）。这里是通用规则，
        // 任何房间都是「能复用就复用」。
        let isHome = homeRoom && roomName == homeRoom;
        let planned = pro.blueprintWalkableSet(room);
        // **分两遍写，按「格」而不是按「建筑」下结论。**
        //
        // 一遍写到底会出错：遍历顺序决定谁最后写，同一格上后写的可走建筑（rampart）
        // 会把先写的不可走建筑（nuker）标记覆盖回可走。实测就是这么放过 nuker 的。
        // 先把所有「不可走」的格钉死，再回头给可走的格打折，结果与遍历顺序无关。
        room.getStructures().forEach(s => {
            if (!pro.outerRoadStructureWalkable(s)) cm.set(s.pos.x, s.pos.y, 255);
        });
        room.getStructures().forEach(s => {
            if (!pro.outerRoadStructureWalkable(s)) return;
            if (cm.get(s.pos.x, s.pos.y) >= 254) return;   // 该格另有不可走建筑，保持封死
            // 主房里「蓝图之外」的历史遗留道路：不给优惠（略高于空地 2），
            // 寻路会走回蓝图路网，这些多余的路没人走就会自然衰减掉。
            // 主房**蓝图内**的路仍然是最低代价 1 —— 这就是「复用蓝图内的道路」。
            if (isHome && s.structureType == STRUCTURE_ROAD && !planned.has(s.pos.x + ":" + s.pos.y)) {
                cm.set(s.pos.x, s.pos.y, 3);
                return;
            }
            cm.set(s.pos.x, s.pos.y, 1);
        });
        // 最后再把「我方矿工工作位」（矿点及其相邻一圈）抬高，
        // 免得外矿路线从 keeper 的岗位上穿过去挤占它。见 OUTER_ROAD_WORK_TILE_COST。
        room.find(FIND_SOURCES).forEach(src => {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    let x = src.pos.x + dx, y = src.pos.y + dy;
                    if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                    if (cm.get(x, y) >= 254) continue;   // 已判不可走的别动
                    cm.set(x, y, OUTER_ROAD_WORK_TILE_COST);
                }
            }
        });
        return cm;
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
            // 端点对 + **整条路线当前仍走得通** 才复用缓存。
            // 只校验端点是不够的：主房随时会盖起新建筑，一次新建筑就能把中段堵死，
            // 而缓存原本要等 1000 tick 才重算（实测 nuker 盖好后外矿爬全卡住）。
            if (end && to && end.roomName == to.roomName
                && Math.max(Math.abs(end.x - to.x), Math.abs(end.y - to.y)) <= 1
                && pro.outerRoadWalkable(cached, data)) return cached;
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
            maxRooms: 8,
            // 两房路线叠加主房蓝图代价时，默认 2,000 ops 会在刚进主房
            // 就提前结束。此搜索仅在缓存失效时运行，允许一次完整求解。
            maxOps: 20000,
            range: 1,
            roomCallback: roomName => pro.outerRoadRoomCallback(roomName, true, spawnRoom.name),
        });
        } catch (e) {
            data.roadPathError = "search threw: " + e.message + " tick=" + Game.time;
            return undefined;
        }
        // 蓝图约束可能把主房入口到 storage 的所有格子封死。首选确实无解时，退回
        // **不带蓝图但保留建筑代价**的搜索。
        //
        // 原来这里是一次**完全没有 roomCallback** 的搜索（注释写的是"退回原生障碍
        // 矩阵"）—— 那等于彻底无视建筑，会解出直接穿过 extension / constructedWall
        // 的路线。实测缓存路线 71 个路点里有 6 个压在自家建筑上，carrier 走到那儿
        // 就卡死原地蹭，路也永远"修不完"。现在兜底同样带建筑代价，只是去掉蓝图软代价。
        if (!ret || ret.incomplete) {
            try {
                ret = PathFinder.search(from, to, {
                    plainCost: 1,
                    swampCost: 5,
                    maxRooms: 8,
                    maxOps: 20000,
                    range: 1,
                    roomCallback: roomName => pro.outerRoadRoomCallback(roomName, false, spawnRoom.name),
                });
            } catch (e) {
                data.roadPathError = "fallback search threw: " + e.message + " tick=" + Game.time;
                return undefined;
            }
        }
        let end = ret && ret.path && ret.path.last();
        // 判据只看「终点是否贴着 storage/terminal（≤1 格）」。
        //
        // **不能再用 `!ret.incomplete`**：storage 本身是建筑，在代价矩阵里是 255，
        // PathFinder 够不到目标格时会返回 `incomplete=true`，但路径其实已经停在
        // storage 旁边 —— 那正是我们要的（代码本来就会把终点那格 strip 掉）。
        // 加上这个条件等于永远缓存不了路线：实测同一组参数下
        //   inc=true, ops=2642, path.len=77, last=W33N55:(20,34)  ← 就在 storage 旁边
        // 结果三个矿点全部 `no path`、路一直修不下去。
        // `reachesDestination` 本身就是比 incomplete 更精确的判据：它明确要求
        // 终点在目标 1 格以内，所以既不会缓存半途而废的路线，也不会漏掉合法路线。
        let reachesDestination = end && to && end.roomName == to.roomName
            && Math.max(Math.abs(end.x - to.x), Math.abs(end.y - to.y)) <= 1;
        if (ret && reachesDestination && ret.path.length > 1) {
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
    /**
     * 按缓存路线**批量**把缺失的路点立成工地。
     *
     * 原来的做法是「修路爬走到哪个路点，就在那个路点立工地」，条件极其苛刻：
     * 必须正好站在缓存路点上（onRoadPath）、脚下没有建筑和工地、而且
     * `ticksToLive > 300`。W34N55 实测那只修路爬 ttl 只剩 154，于是**完全
     * 不再立工地**，路就停在 34 条好几天。而且一次只立一格 —— 就算派了
     * 3 只 carrier 也没法并行施工，前一只没修完，后一只走到那儿也不立。
     *
     * 现在一次性把整条路线上缺失的点都立成工地，所有带 WORK 的 carrier
     * 就能并行去修。路修完后 outerRoadComplete 为真，这里自然不再动作。
     *
     * 通用性 / 健壮性要点（都是踩过坑补的，不针对任何具体房间）：
     *  1. **主房只复用蓝图路网，矿区房全铺**。
     *     主房的路网由本地规划器维护：只有蓝图里规划为 road/container 的格子才铺
     *     （`blueprintWalkableSet`），蓝图之外的历史遗留道路不修、不铺，让它自然衰减。
     *     矿区房没有任何蓝图，能走的地方就该有路，按通用判据铺即可
     *     （`roadBlockedByBlueprint`：规划了非路建筑的格子不铺）。
     *     注意 road / container / rampart / wall **不占房间建筑配额**，所以铺路不会
     *     挤掉规划器要盖的建筑。
     *  2. **尊重每房工地上限**：Screeps 每房最多 100 个工地，多个外矿路线常共用同一
     *     个主房，全速铺会撞上限并让 `createConstructionSite` 返回 ERR_FULL。
     *     见 OUTER_ROAD_SITE_ROOM_LIMIT。
     *  3. **幂等**：已有建筑 / 已有工地 / 蓝图占位 / 边界格的都跳过，重复调用无副作用，
     *     所以可以放心每隔 OUTER_ROAD_SITE_REFRESH tick 全路线扫一遍。
     *  4. 每轮每个矿点最多 OUTER_ROAD_SITE_BATCH 个，避免 createConstructionSite
     *     在单个 tick 里刷爆 CPU。
     */
    placeOuterRoadSites(data, spawnRoom) {
        if (data.roadSiteBuildTick && Game.time - data.roadSiteBuildTick < OUTER_ROAD_SITE_REFRESH) return;
        data.roadSiteBuildTick = Game.time;
        let path = pro.getOuterRoadPath(data);
        if (!path || !path.length) return;
        let created = 0;
        let roomSites = {};
        for (let p of path) {
            if (created >= OUTER_ROAD_SITE_BATCH) break;
            // 边界格不能盖路
            if (p.x == 0 || p.x == 49 || p.y == 0 || p.y == 49) continue;
            let room = Game.rooms[p.roomName];
            if (!room) continue;                              // 没视野的房间跳过，等有视野再铺
            // 注意：**这里不再要求主房必须是「蓝图内的路」**。
            //
            // 上一版加过 `if (room.name == spawnRoom.name && !blueprintWalkableSet.has(...)) continue;`，
            // 想着"主房只复用蓝图路网"。但它把「路线怎么走」和「蓝图怎么规划」绑死了：
            // 路线本身不会 100% 落在蓝图路网上（代价只是 1 vs 2 的偏好，不是硬约束），
            // 凡是偏离的格子就**永远没有路**，爬只能走空地 —— 和"确保该路线 road 都要修"冲突。
            // 实测 W33N55 (1,25)/(2,25) 就是这么留下的两个永久缺口。
            //
            // 「复用蓝图道路 + 多余的路自然衰减」这两件事由别处保证，不需要在这里卡：
            //   · 复用：代价矩阵给蓝图内的路和已有的路都是最低代价 1，寻路自然优先走它们
            //   · 冗余衰减：主房里蓝图外的既有道路代价设成 3（比空地 2 还差），
            //     寻路不去踩 → 没有维护流量 → 自然衰减
            // 所以主房也走下面那套通用判据（边界 / 已有建筑 / 已有工地 / 蓝图占位），
            // 与矿区房完全一致，没有任何房间特定的分支。
            // 每房工地余量（见 OUTER_ROAD_SITE_ROOM_LIMIT）
            if (roomSites[p.roomName] === undefined) {
                roomSites[p.roomName] = room.find(FIND_MY_CONSTRUCTION_SITES).length;
            }
            if (roomSites[p.roomName] >= OUTER_ROAD_SITE_ROOM_LIMIT) continue;
            if (room.lookForAt(LOOK_STRUCTURES, p.x, p.y).length) continue;          // 已有建筑（含路）
            if (room.lookForAt(LOOK_CONSTRUCTION_SITES, p.x, p.y).length) continue;
            if (pro.roadBlockedByBlueprint({ roomName: p.roomName, x: p.x, y: p.y })) continue;
            if (room.createConstructionSite(p.x, p.y, STRUCTURE_ROAD) == OK) {
                created++;
                roomSites[p.roomName]++;
            }
        }
        return created;
    },
    cleanupOuterRoadSites(data, spawnRoom) {
        if (data.roadSiteCleanupTick && Game.time - data.roadSiteCleanupTick < 250) return;
        data.roadSiteCleanupTick = Game.time;
        let path = pro.getOuterRoadPath(data);
        if (!path || !path.length) return;
        // 路线附近 ±1 格都算「在路上」。
        //
        // 原来只保留**精确**落在当前路线上的工地，而路线每 1000 tick 会重算一次；
        // 重算时 PathFinder 的 roomCallback 会把「已建成的路」当可走、把蓝图建筑
        // 当高代价，代价矩阵一有变化，解出来的路线就可能整体平移一格。于是刚批量
        // 立好的 56 个工地被清理掉 41 个，路修到一半又没了（W34N55 实测 56 → 1）。
        // 放宽到 ±1 格后，路线小幅漂移不会再把自己的工地删掉。
        let route = {};
        let rooms = {};
        path.forEach(p => {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    route[p.roomName + ":" + (p.x + dx) + ":" + (p.y + dy)] = true;
                }
            }
            rooms[p.roomName] = true;
        });
        Object.keys(rooms).forEach(roomName => {
            let room = Game.rooms[roomName];
            if (!room) return;
            // 主房要额外保护本地规划器：**蓝图内**的路（含规划中未建成的）绝不动。
            //
            // 但「主房一律不清理」是不对的：工地不像建成后的路那样会自然衰减，
            // 一旦有历史遗留的、既不在路线上也没被蓝图规划的修路工地，它会永远
            // 留在那儿白占每房 100 个工地的配额。所以主房里只清「路线外 + 蓝图外」
            // 这种明确的垃圾工地。
            let isHome = roomName == spawnRoom.name;
            let planned = isHome ? pro.blueprintWalkableSet(room) : null;
            room.find(FIND_MY_CONSTRUCTION_SITES)
                .filter(site => site.structureType == STRUCTURE_ROAD
                    && !route[roomName + ":" + site.pos.x + ":" + site.pos.y]
                    && (!isHome || !planned.has(site.pos.x + ":" + site.pos.y)))
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
        if (code != ERR_NO_PATH && code != ERR_NO_BODYPART) {
            pro.clearOuterRoadPathFail(data);
            return true;
        }
        // 同 harvestEnergyOuterCarryRoadBuilder：单次失败只作废本次移动，
        // 连续失败超过 OUTER_ROAD_FAIL_TOLERANCE 才真的丢掉共享路线
        pro.invalidateOuterRoadPath(data);
        delete task.returnPathIndex;
        return false;
    },
    /**
     * 沿缓存路线走不通时的作废判定（见 OUTER_ROAD_FAIL_TOLERANCE 的说明）。
     * 缓存是同矿点所有爬共用的，一次瞬时的挡路不该把它整份抹掉。
     */
    invalidateOuterRoadPath(data) {
        if (!data || !data.roadPathStr) return;
        if (!data.roadPathFailTick) data.roadPathFailTick = Game.time;
        if (Game.time - data.roadPathFailTick < OUTER_ROAD_FAIL_TOLERANCE) return;
        delete data.roadPathStr;
        delete data.roadPathTick;
        delete data.roadPathFailTick;
        delete data.roadPathError;
    },
    /** 成功沿路线走了一步：清掉失败计时 */
    clearOuterRoadPathFail(data) {
        if (data && data.roadPathFailTick) delete data.roadPathFailTick;
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
        // 连续卡住时**先交给移动优化器**，不要死磕裸 creep.move。
        //
        // moveToOuterRoadPoint 沿路点是「一格一格 creep.move(dir)」，完全绕过
        // BetterMove 的交通逻辑（对穿 / 让路 / 绕障）。单格宽的外矿道上只要有
        // 两只爬互相占住对方的下一格，裸 move 就直接被引擎静默取消，谁也过不去。
        // 原来的唯一出路是卡满 10 tick 后返回 ERR_NO_PATH —— 而调用方拿到它
        // 会**删掉整条共享路线缓存**（invalidateOuterRoadPath），于是所有爬一起
        // 退化成原生寻路，路也白修了。一拥堵就更堵，就是这个回路。
        //
        // 现在：卡 OUTER_ROAD_STUCK_FALLBACK 个 tick 就改用 moveTo（仍朝同一路点），
        // 把交通问题交给优化器；只有卡到 OUTER_ROAD_STUCK_INVALIDATE 才认定路线
        // 真的不可达、去重算。
        if (task.outerRoadStuck >= OUTER_ROAD_STUCK_INVALIDATE) {
            return ERR_NO_PATH;
        }
        if (task.outerRoadStuck >= OUTER_ROAD_STUCK_FALLBACK) {
            return creep.moveTo(point, { range: 0, reusePath: 3 });
        }
        if (creep.pos.roomName == point.roomName) {
            let range = creep.pos.getRangeTo(point);
            if (range == 0) return OK;
            if (range == 1) {
                // 这里原来是「creep.move(dir) 试 8 个方向，最后一个 return OK」。
                // 问题：裸 creep.move **在目标格被别的爬占住时会返回 OK，但引擎
                // 会把这次移动静默取消** —— 于是本函数对外报「走成功」，调用方
                // moveOuterCarrierOnRoad 也 return true，可爬一格都没动。
                // 实测 6 只外矿 carrier 全部处于「返回 true 但 pos 不变」，而且
                // 下一格是空的（真正的目标格被同队爬占着）。
                // 裸 move 也做不了对穿/拉人，单格宽单行道上一堵就是死锁。
                // 统一交给 BetterMove 的 moveTo（reusePath 很短，开销可控），
                // 它能做对穿、拉人、绕一格，正是解开这种堵所需的。
                return creep.moveTo(point, { range: 0, reusePath: 3, visualizePathStyle: { stroke: '#fffa00' } });
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
            // 同 moveToOuterRoadPoint：不用裸 move（目标格被占时它返回 OK 但移动
            // 被静默取消，且无法对穿/拉人），交给 BetterMove。
            return creep.moveTo(next, { range: 0, reusePath: 3 });
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
            // 房间边界格（x/y=0/49）在 Screeps 里不能放任何建筑，永远不可能有路。
            // 不跳过它们 complete 永远为假：实测 W34N55/W35N55 六条外矿路线每条
            // 都卡在 2-4 个边界格上（W34N55:49,19 / W33N55:0,19 这类配对），
            // 系统因此一直补 WORK 型修路 carrier、修路爬永远跑 keepBuilding
            // —— 把运力白白换成了修不了的"缺口"。
            if (p.x == 0 || p.x == 49 || p.y == 0 || p.y == 49) continue;
            let room = Game.rooms[p.roomName];
            if (!room) { data.roadComplete = false; return false; }
            let structures = room.lookForAt(LOOK_STRUCTURES, p.x, p.y);
            if (structures.find(s => s.structureType == STRUCTURE_ROAD)) continue; // 已有路
            // 被「可走建筑」（容器 / 己方 rampart）占位：不需要也不该再铺路
            // （rampart 上不能盖路）。判定与代价矩阵同一份，见 outerRoadTileWalkable。
            if (structures.length && pro.outerRoadTileWalkable(structures)) continue;
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
    /**
     * 主房边缘 link（外矿卸货口）：外矿搬运爬把能量倒在**主房内那段共用路线
     * 旁边**的 link 上就掉头，由 link 送进主房 link 网（link 之间任意距离互传），
     * 省掉它在主房内的最后一段路 —— 每趟省十几格往返，还顺带减少 storage 周边拥堵。
     *
     * 记录写在 `room.memory.stationCarry.edgeLink`（与 hub link 同一个 station，
     * 因为 link 的发送轮询在 StationCarry.transformLink）。link 被拆、被换成别的
     * 建筑时立刻清记录，调用方一律回退旧行为（storage）。
     * `Memory.marketSettings.edgeLink === false` 可一键关掉。
     */
    outerEdgeLink(home) {
        if (!home || !home.my) return undefined;
        if (Memory.marketSettings && Memory.marketSettings.edgeLink === false) return undefined;
        let sc = home.memory && home.memory[StationCarry.stationName];
        if (!sc || !sc.edgeLink) return undefined;
        let link = Game.getObjectById(sc.edgeLink);
        if (!link || link.structureType != STRUCTURE_LINK) {
            delete sc.edgeLink;
            return undefined;
        }
        return link;
    },
    /**
     * 外矿搬运爬回程的卸货点：边缘 link 在位就用它，否则回退 storage。
     *
     * 回程路线与 storage 同路且**先经过** link，所以「先去 link 再看」不会多走路。
     * link 满不满不在这里判 —— 那要在**到场那一刻**判（有界等待 + 回退，见
     * harvestEnergyOuterCarryRoadBuilder），否则出发时满、到场时已经空了的 link
     * 会被整趟跳过。
     */
    outerCarryDropOff(home) {
        if (!home) return undefined;
        return pro.outerEdgeLink(home) || home.storage;
    },
    /**
     * 边缘 link 的选址与工地（幂等；只在外矿生产 pass 里调用）。
     *
     * 选址规则（全部满足，取「离矿区入口最近」的一个）：
     *   1. 在主房内（外矿路线在主房的那一段）
     *   2. 与**所有**矿点共用的那段路相邻（切比雪夫 ≤1）—— 一个 link 服务以本房
     *      为主房的全部矿点；只贴某一条路线会漏掉其它矿点的搬运爬
     *   3. 空地、无建筑、无工地
     *   4. **不能压在路点上**：link 不像 road/container 那样能踩上去（见
     *      outerRoadStructureWalkable），压上去等于把外矿单行道堵死；贴在旁边时
     *      搬运爬在路上经过就是 range 1，transfer 照常成立
     *
     * 建好之前返回工地对象。建工地的活不需要专门派爬：工地一出现在主房，
     * strategy_highLevel 就会补 worker，idle 的 worker 走
     * StationWork.generatorBuildTask（挑最近的工地），主房里通常就这一个工地。
     */
    ensureOuterEdgeLink(spawnRoom) {
        if (!spawnRoom || !spawnRoom.my || !spawnRoom.controller) return undefined;
        if (Memory.marketSettings && Memory.marketSettings.edgeLink === false) return undefined;
        if (spawnRoom.level < 5) return undefined;                       // link 要 RCL5
        if (pro.outerEdgeLink(spawnRoom)) return undefined;              // 已经有 link
        let sc = spawnRoom.memory[StationCarry.stationName]
            || (spawnRoom.memory[StationCarry.stationName] = {});
        let cap = CONTROLLER_STRUCTURES[STRUCTURE_LINK][spawnRoom.level] || 0;
        let used = spawnRoom.link.length + spawnRoom.find(FIND_MY_CONSTRUCTION_SITES)
            .filter(s => s.structureType == STRUCTURE_LINK).length;
        if (used >= cap) return undefined;
        // 选过一次就不再重算（路线解码开销不小）：先按记录的位置确认
        if (sc.edgeLinkPos) {
            let xy = sc.edgeLinkPos.split(":");
            let x = parseInt(xy[0], 10), y = parseInt(xy[1], 10);
            let structures = spawnRoom.lookForAt(LOOK_STRUCTURES, x, y);
            let link = structures.find(s => s.structureType == STRUCTURE_LINK);
            if (link) { sc.edgeLink = link.id; return undefined; }
            let site = spawnRoom.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).find(s => s.structureType == STRUCTURE_LINK);
            if (site) { sc.edgeLinkSite = site.id; return site; }
            // 位置空着：通常是上一 tick 刚把那格冗余 road 拆掉 —— 直接在这儿立工地，
            // **不要重选**（road 一消失，排序里的「优先回收废路」就不再成立，
            // 会漂到旁边别的格子上去）。
            if (!structures.length && spawnRoom.createConstructionSite(x, y, STRUCTURE_LINK) == OK) {
                let fresh = spawnRoom.lookForAt(LOOK_CONSTRUCTION_SITES, x, y)
                    .find(s => s.structureType == STRUCTURE_LINK);
                if (fresh) sc.edgeLinkSite = fresh.id;
                return fresh;
            }
            delete sc.edgeLinkPos;      // 被别的东西占了 / 立不起来 → 重新选
            delete sc.edgeLinkSite;
        }
        // 以本房为主房的矿点：缓存路线的**终点**落在本房（一条矿点 = 一条路线）
        let routes = [];
        for (let roomName in Memory.rooms) {
            if (roomName == spawnRoom.name) continue;                    // 主房自己的矿点没有外矿路线
            let stations = Memory.rooms[roomName][pro.stationName];
            if (!stations) continue;
            _.values(stations).forEach(data => {
                if (!data || !data.id || !data.roadPathStr) return;
                let path = pro.getOuterRoadPath(data);
                if (!path || !path.length) return;
                if (path.last().roomName != spawnRoom.name) return;
                routes.push(path);
            });
        }
        if (!routes.length) return undefined;
        // 每条路线在主房内的路点集合 + 每个路点的**最早序号**（越小 = 越靠矿区入口）。
        // 用「路线并集」而不是「交集」来找候选格：交集只覆盖所有路线都重合的那一小段，
        // 会把入口附近大把更好的位置排除掉（实测入口区路线是几条并行的斜线，
        // 交集从 x=6 才开始，而真正合适的位置在 x=4）。
        let routeIdx = {};                    // tile -> 最早序号
        let routeSets = [];
        routes.forEach(path => {
            let set = {};
            path.forEach((p, i) => {
                if (p.roomName != spawnRoom.name) return;
                let key = p.x + ":" + p.y;
                set[key] = true;
                if (routeIdx[key] == undefined || i < routeIdx[key]) routeIdx[key] = i;
            });
            routeSets.push(set);
        });
        // 蓝图里的路/容器是规划器在维护的，不能占（见 blueprintWalkableSet）
        let planned = pro.blueprintWalkableSet(spawnRoom);
        let terrain = new Room.Terrain(spawnRoom.name);
        let cand = {};
        routeSets.forEach((set, ri) => {
            for (let key in set) {
                let xy = key.split(":");
                let tx = parseInt(xy[0], 10), ty = parseInt(xy[1], 10);
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (!dx && !dy) continue;
                        let x = tx + dx, y = ty + dy;
                        let ckey = x + ":" + y;
                        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                        if (routeIdx[ckey] != undefined) continue;    // 压在路点上会把外矿单行道堵死
                        if (terrain.get(x, y) == TERRAIN_MASK_WALL) continue;
                        let structures = spawnRoom.lookForAt(LOOK_STRUCTURES, x, y);
                        let road = structures.find(s => s.structureType == STRUCTURE_ROAD);
                        if (structures.length && !road) continue;      // 有别的建筑，让开
                        if (road && planned.has(ckey)) continue;       // 规划器的路：不动
                        if (spawnRoom.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length) continue;
                        let cur = cand[ckey];
                        if (!cur) cur = cand[ckey] = { x: x, y: y, cover: 0, entry: routeIdx[key], road: road, seen: {} };
                        if (routeIdx[key] < cur.entry) cur.entry = routeIdx[key];
                        if (!cur.seen[ri]) { cur.seen[ri] = true; cur.cover++; }
                    }
                }
            }
        });
        // 排序：覆盖的路线数多 → 更靠矿区入口 → 优先回收冗余 road（见下）→ 坐标
        let list = _.values(cand).sort((a, b) =>
            b.cover - a.cover || a.entry - b.entry || (a.road ? 0 : 1) - (b.road ? 0 : 1)
            || (a.x - b.x) || (a.y - b.y));
        for (let pick of list) {
            // 冗余 road（不在蓝图、也不是任何路线的路点）优先：入口区这种废路很多，
            // 拆一格给 link 比占用一块干净空地好 —— 位置更靠入口（省的路更长），
            // 而且这格路本来就没人在维护、迟早自己衰减掉。
            // link 和 road 不能同格，所以先拆；destroy 与同 tick 的 createConstructionSite
            // 有意图顺序风险，拆完就返回，下一 tick 该格已空、再立工地。
            if (pick.road) {
                if (pick.road.destroy() == OK) {
                    sc.edgeLinkPos = pick.x + ":" + pick.y;
                    return undefined;
                }
                continue;                    // 拆不掉（不该发生）→ 换下一个候选
            }
            if (spawnRoom.createConstructionSite(pick.x, pick.y, STRUCTURE_LINK) != OK) continue;
            sc.edgeLinkPos = pick.x + ":" + pick.y;
            let site = spawnRoom.lookForAt(LOOK_CONSTRUCTION_SITES, pick.x, pick.y)
                .find(s => s.structureType == STRUCTURE_LINK);
            if (site) sc.edgeLinkSite = site.id;
            return site;
        }
        return undefined;
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
            // 跳过认领表等辅助字段，只处理真正的挖矿点
            if (!data || typeof data != "object" || !data.id) return;
            let ids = data.creeps || [];
            if (!ids.length) return;
            let alive = [];
            for (let id of ids) {
                let creep = Game.getObjectById(id);
                if (creep && creep.ticksToLive) alive.push(creep);
            }
            if (alive.length > 1) {
                alive.sort((a, b) => b.ticksToLive - a.ticksToLive);
                alive.slice(1).forEach(e => e.suicide());
            }
            // 只在确实清出死爬时才写回，减少 Memory 抖动
            if (alive.length != ids.length) data["creeps"] = alive.map(e => e.id);
        });
    },
    trySpawnHarKeeper(room) {
        // 清理动作收敛到 trySpawnOuterHarKeeper 内部，避免同一 room 的
        // economy pass 重复执行两次 cleanupDuplicateKeepers。
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
            // 防止 spawn 完成/注册前重复补员：spawning creep 也有 memory.tasks，
            // 直接按目标 source id 计数，避免同一矿点一次生 2~3 只 keeper。
            let existingKeepers = spawnRoom.creeps("harvestEnergyKeeper", false).filter(e => {
                let t = e.headTask && e.headTask();
                return t && t.id == data.id;
            }).length;
            if (existingKeepers > 0) return;
            if (Game.time - data["spawnTime"] > 1500 || (data["creeps"] || []).length == 0) {
                // 空 hive 阶段满配 keeper 要 3650 能量，spawn 永远付不起。
                // 按当前可用能量收缩体型，至少保证 550 能量的基础 keeper，
                // 让 E53S21 这类缺能房先恢复挖矿，而不是 spawnFailure 卡死。
                let energyBudget = Math.min(spawnRoom.getEnergyCapacityAvailable(), Math.max(spawnRoom.energyAvailable, 550));
                let harBody = StationSources.getHarvesterBodyConfig(energyBudget, roomName != spawnRoom.name, spawnRoom.level, data)
                let tasks = (roomName == spawnRoom.name) ? StationSources.generatorHarTask(data) : StationSources.generatorOuterHarTask(data)
                StationHive.trySpawn(spawnRoom, spawnRoom.name, harBody, "harvestEnergyKeeper", tasks)
            }
        });
    },
    /**
     * 外矿矿物：容器工地只放**一个**，并派一只带 WORK 的爬去修。
     *
     * 原实现有两个致命问题，合起来让外矿矿物采集完全跑不起来：
     *  1) 没有容器时，对 mineral 周围**每一格非墙格子**都 createConstructionSite。
     *     W34N55 实测一次落下 (42,15)/(43,15)/(43,16) 三个 container 工地（其余 5 格
     *     是墙、正中那格是 mineral 自己），5000×3 的工程量没人修得完，而且
     *     `isNearTo(mineral)` 只随机命中其中一个，另外两个永久占着工地配额。
     *  2) 工地存在时 spawn 的是 "worker" 且 tasks 是**空数组**：在主房出生、没有任何
     *     任务，只会去修主房自己的工地，永远不会走到外矿房。于是矿物容器永远停在
     *     0/5000，而下面矿爬的生出条件又是 `container` 存在 —— 全服 0 只
     *     harvestMineralOuterKeeper 就是这么来的（W34N55 的 35000 H 一直没人动）。
     */
    trySpawnOuterMineralKeeper(roomName, spawnRoom) {
        if (spawnRoom.spawnFailure) return null;
        let harRoom = Game.rooms[roomName.name || roomName];
        if (!harRoom) return;
        let data = Memory.rooms[roomName] && Memory.rooms[roomName][StationMineral.stationName];
        if (!data || !data["id"]) return;
        /**
            @type {Mineral}
        */
        let mineral = Game.getObjectById(data["id"]);
        if (!mineral) return;
        let container = Game.getObjectById(data["container"]);
        // 容器被拆/过期时把记录清掉，下次重新走建容器流程
        data["container"] = container ? container.id : undefined;
        if (!container) {
            let site = pro.ensureOuterMineralContainerSite(harRoom, mineral, data);
            if (site && mineral.mineralAmount > 0) pro.trySpawnOuterMineralContainerBuilder(roomName, spawnRoom, site);
            return;
        }
        if (mineral.mineralAmount > 0) {
            // 原写法 e.headTask().roomName 在爬还在出生时 headTask() 可能为 undefined
            let harCreeps = spawnRoom.creeps("harvestMineralOuterKeeper", false).filter(e => {
                let t = e.headTask && e.headTask();
                return t && t.roomName == harRoom.name;
            });
            if (harCreeps.length == 0) {
                let harBody = pro.getMineralHarvesterBodyConfig(spawnRoom.getEnergyCapacityAvailable());
                let tasks = pro.generatorOuterMineTask(data);
                StationHive.trySpawn(spawnRoom, spawnRoom.name, harBody, "harvestMineralOuterKeeper", tasks);
            }
            // 采集爬之外还得有搬运，否则 H 只是从矿物搬进了外矿的容器
            pro.trySpawnOuterMineralCarrier(roomName, spawnRoom, data);
        }
    },
    /**
     * 外矿矿物搬运爬。体型纯 CARRY/MOVE：一趟 1250，来回约 160 tick，
     * 约 7.8 H/tick —— 35000 的矿点 28 趟搬完，比让 {CARRY:4} 的采集爬自己
     * 往返（200/趟，1.25 H/tick）快 6 倍。
     */
    trySpawnOuterMineralCarrier(roomName, spawnRoom, data) {
        const role = "outerMineralCarrier";
        let targetName = roomName.name || roomName;
        let carriers = spawnRoom.creeps(role, false).filter(e => {
            let t = e.headTask && e.headTask();
            return t && t.roomName == targetName;
        });
        if (carriers.length) return;
        if (!spawnRoom.storage) return;    // 没有 storage 就没有卸货点
        if (spawnRoom.creeps("harvestMineralOuterKeeper", false).filter(e => {
            let t = e.headTask && e.headTask();
            return t && t.roomName == targetName;
        }).length == 0) return;            // 采集爬不在就先别派搬运，免得空转
        let body = ManagerCreeps.calcBodyPart({ [CARRY]: 25, [MOVE]: 25 });
        if (Utils.getBodyEnergyNeed(body) > spawnRoom.getEnergyCapacityAvailable()) {
            body = ManagerCreeps.calcBodyPart({ [CARRY]: 15, [MOVE]: 15 });
        }
        let tasks = [UtilsTask.taskOutView(data["id"], targetName, data["x"], data["y"],
            "harvestMineralOuterCarry", undefined, { homeRoom: spawnRoom.name })];
        StationHive.trySpawn(spawnRoom, spawnRoom.name, body, role, tasks);
    },
    /**
     * 外矿矿物容器：整房只保留**一个**工地，id 写进 data["containerSite"]。
     *
     * 选格规则（固定顺序，多只爬同时进来也只会选中同一格）：
     *   1. 必须是 mineral 的相邻格（keeper 站上去挖，carrier 贴着取货）
     *   2. 排除墙、排除 mineral 自己那一格（那格只能放 extractor）
     *   3. 候选里挑「周围可走格子最多」的那格，保证 keeper / carrier 站得开
     *   4. 已有 container → 记 id 返回 undefined；已有工地 → 复用，多余的一律清掉
     */
    ensureOuterMineralContainerSite(harRoom, mineral, data) {
        let nearMineral = e => e.pos.isNearTo(mineral.pos);
        let container = harRoom.find(FIND_STRUCTURES)
            .find(e => e.structureType == STRUCTURE_CONTAINER && nearMineral(e));
        if (container) {
            data["container"] = container.id;
            delete data["containerSite"];
            return undefined;
        }
        let sites = harRoom.find(FIND_MY_CONSTRUCTION_SITES)
            .filter(e => e.structureType == STRUCTURE_CONTAINER && nearMineral(e));
        if (sites.length) {
            // 历史遗留的多工地只留一个（留进度最高的），其余清掉
            sites.sort((a, b) => b.progress - a.progress);
            sites.slice(1).forEach(e => e.remove());
            data["containerSite"] = sites[0].id;
            return sites[0];
        }
        let terrain = new Room.Terrain(harRoom.name);
        let candidates = [];
        for (let x = mineral.pos.x - 1; x <= mineral.pos.x + 1; x++) {
            for (let y = mineral.pos.y - 1; y <= mineral.pos.y + 1; y++) {
                if (x == mineral.pos.x && y == mineral.pos.y) continue;   // mineral 自己那格不能盖
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                if (terrain.get(x, y) == TERRAIN_MASK_WALL) continue;
                let open = 0;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (!dx && !dy) continue;
                        if (terrain.get(x + dx, y + dy) != TERRAIN_MASK_WALL) open++;
                    }
                }
                candidates.push({ x: x, y: y, open: open });
            }
        }
        if (!candidates.length) return undefined;
        candidates.sort((a, b) => b.open - a.open || (a.x - b.x) || (a.y - b.y));
        let pick = candidates[0];
        if (harRoom.createConstructionSite(pick.x, pick.y, STRUCTURE_CONTAINER) != OK) return undefined;
        let site = harRoom.find(FIND_MY_CONSTRUCTION_SITES)
            .find(e => e.structureType == STRUCTURE_CONTAINER && e.pos.x == pick.x && e.pos.y == pick.y);
        if (site) data["containerSite"] = site.id;
        return site;
    },
    /**
     * 派一只带 WORK 的爬去修外矿矿物容器。
     *
     * 任务是一条自循环（见 Creep.prototype.buildOuterMineralContainer）：
     *   能量空了 → 回主房 storage 取（carryRes）→ 回到工地修 → 空了再去取 …
     * 容器建成后走 recycleCreep 回主房回收，不留闲爬。
     *
     * 体型 WORK/CARRY 各半、MOVE 补齐：CARRY 决定一趟能修多少（1 能量 = 1 进度，
     * 5000 的容器要运 5000 能量），MOVE 保证在还没修路的外矿房走得动。
     */
    trySpawnOuterMineralContainerBuilder(roomName, spawnRoom, site) {
        const role = "outerMineralContainerBuilder";
        let targetName = roomName.name || roomName;
        let builders = spawnRoom.creeps(role, false).filter(e => {
            let t = e.headTask && e.headTask();
            return t && t.roomName == targetName;
        });
        if (builders.length) return;
        if (!spawnRoom.storage) return;   // 没有 storage 就没有取能量的地方
        let body = ManagerCreeps.calcBodyPart({ [WORK]: 16, [CARRY]: 17, [MOVE]: 17 });
        if (Utils.getBodyEnergyNeed(body) > spawnRoom.getEnergyCapacityAvailable()) {
            body = StationWork.getMiddleLevelWorkerBodyConfig(spawnRoom);
        }
        let tasks = [UtilsTask.taskOutView(site.id, site.pos.roomName, site.pos.x, site.pos.y,
            "buildOuterMineralContainer", undefined, { homeRoom: spawnRoom.name })];
        StationHive.trySpawn(spawnRoom, spawnRoom.name, body, role, tasks);
    },
    trySpawnOuterHarCarrier(roomName, spawnRoom) {
        // 主房 carrier（roomName == spawnRoom.name）负责填 hive/搬 link，
        // 是主房能量循环的一部分，不能挡；只挡外矿 carrier（纯消耗，8 万阈值）
        if (roomName != spawnRoom.name && pro.outerMineStarvesSpawnRoom(spawnRoom, true)) return null;
        // 外矿搬运爬**全局硬上限**（跨所有矿点统计，Memory.marketSettings.outerCarrierMax
        // 可调，缺省 6）：每只 50 部件 = 1650 容量，往返 ~150 tick ≈ 11 能量/tick，
        // 一个 20/tick 的源 2 只就够，三个矿点 6 只封顶。需求公式里 pathTime 一旦
        // 被拥堵抬高就会正反馈多派（10-03 实测涨到 16 只），CPU 与 bucket 双输，
        // 这里一刀切住。短缺靠 50 部件的单体运力兜，不再靠数量。
        let roomCarriers = spawnRoom.creeps("outerHarvestEnergyCarrier", false);
        // 容量 1700/只（2:1 间隔排列），上限同步放宽到 8
        let carrierMax = Number(Memory.marketSettings && Memory.marketSettings.outerCarrierMax) || 8;
        if (roomCarriers.length >= carrierMax) return null;
        // 注意：这里**不能**用 spawnFailure 提前返回。路线是同矿点所有爬共用的一份
        // 缓存，而它一旦缺失，修路爬就没有路点可铺、carrier 也退化成原生 moveTo。
        // 主房 spawn 常年是忙的（spawnFailure 常真），把路线维护挡在后面等于
        // 让路线长时间缺失（W34N55 实测三个矿点的 roadPathStr 同时为空）。
        let harRoom = Game.rooms[roomName.name || roomName]
        if (!harRoom) return;
        let sm = harRoom.memory[pro.stationName]
        _.values(sm).forEach(data => {
            let pathTime = data["pathTime"];
            let container = Game.getObjectById(data["container"]);
            // 路线只在外矿（跨房）才用得上：主房自己的 keeper/carrier 不走这条缓存，
            // 所以主房不做寻路维护，省掉无意义的 PathFinder 开销。
            if (roomName != spawnRoom.name) {
                // 预先计算并缓存固定修路路径（一次性寻路，避免多个修路爬各走各的路线）
                pro.ensureOuterRoadPath(data, spawnRoom);
                pro.placeOuterRoadSites(data, spawnRoom);
                pro.cleanupOuterRoadSites(data, spawnRoom);
                // 主房边缘 link（外矿卸货口）：只与主房有关，重复调用是幂等的。
                // 用 HelperError.catchError 包住：这个函数一旦抛异常，整个外矿
                // pass 会在中途断掉 —— 外矿生产全停（allDefendersFull 那次的
                // 教训），而它只是个可选优化，绝不能拖垮采运。
                HelperError.catchError(() => pro.ensureOuterEdgeLink(spawnRoom), "outerEdgeLink:" + spawnRoom.name);
                // 安全网：任务栈被扒空的 carrier 没有任何地方会补任务，会永久闲置
                // 在原地（见 harvestEnergyOuterCarryRoadBuilder 里 store==0 分支的
                // 注释）。这里发现就立刻把搬运任务派回去，比事后在控制台里一只只
                // 救省事得多。
                (data["carryCreeps"] || []).map(e => Game.getObjectById(e))
                    .filter(e => e && (!e.memory.tasks || !e.memory.tasks.length))
                    .forEach(e => { e.memory.tasks = pro.generatorOuterHarCarryTask(data); });
            }
            // 补员才需要空闲 Spawn：单 Spawn 房若先尝试本地补员，spawnFailure
            // 不能阻止已有外矿 carrier 修正其过期路径。
            if (spawnRoom.spawnFailure) return;
            // container 不可见时仍可按缓存 ID / 坐标孵化；carrier 抵达矿区后
            // 再解析对象即可。否则 keeper 死后失去视野会再次把外矿锁死。
            if (pathTime && data["container"]) {
                data["carryCreeps"] = data["carryCreeps"] || []
                data["carryCreeps"] = data["carryCreeps"].filter(e => Game.getObjectById(e))
                let carrierCreeps = data["carryCreeps"].map(e => Game.getObjectById(e)).filter(e => e && (!e.ticksToLive || e.ticksToLive > e.body.length * 3))
                let carrierBuildCreep = carrierCreeps.filter(e => e.getPartCnt(WORK) > 0).head()
                // 产出速率：**动态算**，不能写死。
                //
                // 原来这里是个常量 `EnergyPerTick = 10`，与实际产出脱节，于是 carrier
                // 数量长期偏少（W34N55 + W35N55 共 6 个矿点只有 2 只 carrier →
                // 容器堆满 → keeper 有货塞不下 → 源回到 4000 没人采）。
                //
                // 真实产出 = min(采集爬的采集速率, 矿点的重生速率)：
                //   · 采集爬速率 = WORK 部件数 × HARVEST_POWER(2)
                //   · 矿点重生速率 = energyCapacity / ticksToRegeneration（源 4000/300 ≈ 13.33/tick）
                //
                // 需求运力 = 往返时间 × 产出速率 / 每个 CARRY 部件容量(50)。
                // 通用规则，与具体房间无关。
                let harBody = StationSources.getHarvesterBodyConfig(spawnRoom.getEnergyCapacityAvailable(), true, spawnRoom.level, data);
                let workCnt = harBody.filter(p => p == WORK).length;
                let harvestRate = workCnt * HARVEST_POWER;                       // 采集爬能挖多快
                let sourceObj = Game.getObjectById(data.id);
                let regenRate = sourceObj
                    ? sourceObj.energyCapacity / (sourceObj.ticksToRegeneration || 300)   // 矿点能生多快
                    : harvestRate;
                let EnergyPerTick = Math.max(1, Math.min(harvestRate, regenRate) || 10);


                // pathTime 在写入端（concatStationSources）已经钳过一次，但**只钳写入端
                // 不够**：Memory 里可能还留着历史畸形值（W33N55 实测 843，正常≈路线长度），
                // 它会一直按老值算运力、继续过量补员 —— 表现就是「杀掉多余 carrier、
                // 下一 tick 立刻又生一批」。两端都夹住才安全。
                let capPath = pro.getOuterRoadPath(data);
                let pathCap = capPath && capPath.length ? Math.round(capPath.length * 1.2) : (pathTime || 300);
                let effPathTime = Math.min(pathTime, pathCap);
                let NeedCarryPartCnt = Math.ceil(effPathTime * 2 * EnergyPerTick / 50) // 来回*2 每个要的tick数量
                let CarryPartCnt = NeedCarryPartCnt - 2 // 两个被换成 work了
                carrierCreeps.forEach(e => CarryPartCnt -= e.getPartCnt(CARRY))
                // 体型拉满：每只都按 50 部件上限（33 CARRY + 17 MOVE）生成，
                // 运力缺口只决定**补几只**，不再把需求摊薄成多只小爬。
                // 小爬多 = 在路上的 creep 多 = CPU 和单格外矿道拥堵都更差；
                // 大爬少 = 同运力下 creep 数最少。生产时间变长由 PC 的
                // operate spawn（needOpSpawn 对全忙 spawn 生效）兜底提速。
                let maxPart = 50
                let isNearToAny = carrierCreeps.filter(e => e.pos.isNearTo(container)).head()
                if (CarryPartCnt > 0 && !isNearToAny) {
                    let carrierBody = carrierBuildCreep ?
                        pro.getOuterHarCarrierBodyConfig(spawnRoom.getEnergyCapacityAvailable(), maxPart)
                        : pro.getOuterHarCarrierBuildBodyConfig(spawnRoom.getEnergyCapacityAvailable(), maxPart) // 如果没修路的造一个
                    let tasks = pro.generatorOuterHarCarryTask(data)
                    StationHive.trySpawn(spawnRoom, spawnRoom.name, carrierBody, "outerHarvestEnergyCarrier", tasks)
                }
                // 路没修完时再补专职修路的 carrier。
                //
                // 上面那套「还差多少 CARRY 才够搬」是**只按把矿运回主房**算的，
                // 修路是额外的活。而修路的吞吐被「跑一趟能带多少能量」卡死
                // （1 能量 = 1 进度），所以只能靠**多几只同时跑**来提速度，
                // 加大 CARRY 或 WORK 都提不了多少（见 getOuterHarCarrierBuildBodyConfig）。
                // W34N55 实测只有 1 只 carrier 带 WORK:2，好几天过去路还停在 34 条。
                // 路修完后 outerRoadComplete 为真，这里自然就不再补了。
                if (!pro.outerRoadComplete(data)) {
                    let builderCnt = carrierCreeps.filter(e => e.getPartCnt(WORK) > 0).length;
                    if (builderCnt < OUTER_ROAD_BUILDER_CNT && !spawnRoom.spawnFailure) {
                        let body = pro.getOuterHarCarrierBuildBodyConfig(spawnRoom.getEnergyCapacityAvailable(), maxPart)
                        let tasks = pro.generatorOuterHarCarryTask(data)
                        StationHive.trySpawn(spawnRoom, spawnRoom.name, body, "outerHarvestEnergyCarrier", tasks)
                    }
                }
            }
        })
    },
    /**
     * 这只防守爬认领的 keeperLair（见 OUTER_DEFENSE_LAIRS_PER_CREEP）。
     *
     * 分组由 outerDefenseLairGroups 按**真实寻路距离**做最优两两配对（不按坐标切）。
     * 分组号写在 memory.defenseGroup；没有分组的爬（本次部署前出生的老爬）
     * 在这里**当场**挑人最少的那组，不需要等它自然死亡就能生效。
     */
    /**
     * 该提前多少 tick 派防守爬接替（老那只 ttl 降到这个值时就生接替兵）。
     *
     * 提前量 = **实测行军时间**（pathTime，退回路线长度）+ **150**（50 部件生成）
     *        + **实测 spawn 排队耗时**（见 defSpawnQueueWait）+ **10**（余量）
     *        + **100**（重叠期，见 OUTER_DEFENSE_REPLACE_OVERLAP）。
     *
     * 只算「生成+行军」是不够的：提前量到了还得**等 spawn 空出来**——主房三个
     * spawn 一忙就是上百 tick 的干等，老兵死了接替还在排队，防守空档照旧。
     * 所以接替请求首次发出时记时刻，成功生成后把差值写回
     * spawnRoom.memory.defSpawnQueueWait（封顶 600），提前量自动长出这一段。
     * 例：W34N55 最长 pathTime 85、排队实测 150 → 150+85+150+10+100 = **495**。
     * 例：W34N55 最长 pathTime 85 → 150 + 85 + 10 + 60 = **305**。
     *
     * 原来是个拍脑袋的固定 250：路线一长就不够（75 格时只剩 25 tick 余量），
     * 一旦路上再堵一下（曾经堵到 0.02 格/tick），接替兵必定赶不到，老那只先死就出现
     * **防守空档**，keeper 直接去打我们的矿工。改成按实际路线长度算，路长多少就多提前多少。
     *
     * 可用 Memory.marketSettings.outerDefenseReplaceTtl 直接指定固定值覆盖。
     */
    outerDefenseReplaceLead(roomName, spawnRoom) {
        let fixed = Number(Memory.marketSettings && Memory.marketSettings.outerDefenseReplaceTtl);
        if (fixed > 0) return fixed;
        // 行军时间优先用**实测值**：`pathTime` 是 keeper 实打实走完这条路花的 tick 数，
        // 已经包含拥堵、沼泽、跨房这些真实因素；拿不到才退回路线长度（1 格/tick 的理想值）。
        // keeper 与防守爬都是 1 格/tick 档，可以直接借用。
        // 取该房**所有矿点里最长的那个** —— 防守爬要能覆盖全房，按最坏情况留提前量。
        let travel = 0;
        let mem = Memory.rooms[roomName.name || roomName];
        let stations = mem && mem[pro.stationName];
        if (stations) {
            _.values(stations).forEach(e => {
                if (!e || !e.id) return;
                let t = e.pathTime > 0 ? e.pathTime : (pro.getOuterRoadPath(e) || []).length;
                if (t > travel) travel = t;
            });
        }
        if (!travel) travel = OUTER_DEFENSE_TRAVEL_FALLBACK;
        // 排队耗时用**实测值**：没观测过就先给 150 的保守底（首次接替按这个算），
        // 每次成功接替后自动校准（见 trySpawnOuterDefenser 的记录逻辑）。
        let queueWait = spawnRoom.memory && spawnRoom.memory.defSpawnQueueWait || 0;
        return OUTER_DEFENSE_SPAWN_TICKS + travel + Math.max(queueWait, 150)
            + OUTER_DEFENSE_REPLACE_MARGIN + OUTER_DEFENSE_REPLACE_OVERLAP;
    },
    outerDefensePosts(creep) {
        let room = creep.room;
        let lairs = room.find(FIND_HOSTILE_STRUCTURES)
            .filter(e => e.structureType == STRUCTURE_KEEPER_LAIR)
            .sort((a, b) => (a.pos.x - b.pos.x) || (a.pos.y - b.pos.y));
        if (!lairs.length) return [];
        let groups = pro.outerDefenseLairGroups(room, lairs);
        // 分组号：默认/越界/或者自己这组已经比别组挤，就重新挑人最少的那组。
        // 统计时排除自己，否则两只爬会互相把对方挤走、来回抖。
        let cnt = [];
        for (let i = 0; i < groups.length; i++) cnt.push(0);
        room.find(FIND_MY_CREEPS).forEach(c => {
            if (c === creep) return;
            if (c.memory.role == "outerHarvestDefenser" && c.memory.defenseGroup >= 0
                && c.memory.defenseGroup < groups.length) cnt[c.memory.defenseGroup]++;
        });
        let least = Math.min.apply(null, cnt);
        let g = creep.memory.defenseGroup;
        if (g === undefined || g < 0 || g >= groups.length || cnt[g] > least) {
            g = cnt.indexOf(least);
            creep.memory.defenseGroup = g;
        }
        return groups[g] || [];
    },
    /**
     * 把 lair 两两配对，使「每组内部来回要走的路」最短 —— **按真实寻路距离**，
     * 不是按坐标排序后对半切。
     *
     * 坐标排序是拍脑袋的：W34N55 里 (7,17) 和 (7,38) 直线只差 21 格，看着像
     * "西边一对"，但中间隔着一道墙，**实际要绕 83 格**；而 (36,29)↔(41,14)
     * 只要 14 格。按坐标切出来的分组是
     *   {(7,17),(7,38)}=83 + {(36,29),(41,14)}=14   合计 97
     * 最优其实是
     *   {(7,17),(41,14)}=42 + {(7,38),(36,29)}=26   合计 68
     * 差了 30%。
     *
     * 这里是小规模（n ≤ 6）的最小权完美匹配：枚举所有「两两配对」的分法，
     * 取代价（各组内部距离之和）最小的一种。lair 不会移动，结果按 lair id
     * 集合缓存进 room.memory，只算一次 —— 不会每 tick 跑 PathFinder。
     */
    /**
     * 该房当前**在役 + 在途**的防守爬（按任务栈的目标房名全局统计）。
     *
     * 为什么不能用 `spawnRoom.creeps("outerHarvestDefenser")`：那只能看到「物理上
     * 还在出兵房里的爬」——已经到岗站在外矿房里的那只看不见，于是
     *   ① 编制判断永远差一只 → 每 6 tick 都再派一只（实测 W34N55 的接替兵
     *      间隔只有 144 tick，一路白吃 spawn 队列和 5300 能量）；
     *   ② 老兵的 ttl 提前量失去意义（真正该被接替的那只根本没进 front）。
     * 防守爬的任务栈在出生时就写好了目标房名（generatorOuterHarDefenseTask），
     * 所以按 headTask().roomName 全局数既能算在役的、也能算在途的。
     *
     * 每 tick 只扫一遍 Game.creeps，结果缓存在 Game 上给全房共用。
     */
    outerDefenseAssignments(roomName) {
        if (Game._outerDefAssignTick != Game.time) {
            Game._outerDefAssignTick = Game.time;
            let all = Game._outerDefAssignAll = {};
            for (let name in Game.creeps) {
                let c = Game.creeps[name];
                if (c.memory.role != "outerHarvestDefenser") continue;
                let t = c.headTask && c.headTask();
                if (!t || !t.roomName) continue;
                (all[t.roomName] = all[t.roomName] || []).push(c);
            }
        }
        return Game._outerDefAssignAll[roomName] || [];
    },
    /**
     * 该外矿房需要几只防守爬（编制）。
     *
     * 基线 `OUTER_DEFENSE_TARGET_CNT`（2）：一只盯 2 个窝轮值，够覆盖出怪周期。
     *
     * **超过 2 只 keeper 时按 1 只防守爬对 1 只 keeper 加编**（上限 4 = lair 数，
     * 同时存在的 keeper 不会多过窝数）。战斗账：{A22,H11,M17} 单挑 keeper 稳赢
     * （8 tick 打完，自身还剩 ~2800/5000 血），但 1 打 2 必死（range 1 吃 800/发，
     * 7 tick 被打空）。实测 W34N55（4 个 lair）攒了 3 只 keeper 时，2 只防守爬
     * 连同 4 只矿工在一波里全被打掉 —— 编制按「窝数/巡逻覆盖」定，没跟上敌情。
     *
     * 这个数同时给「派兵」和「满员闸」用：编制不满 → 该矿只守不产，keeper
     * 先被打掉、防守到位后才放矿工进去。没有视野时退回基线（不凭想象加派）。
     */
    outerDefenseQuota(room) {
        let base = OUTER_DEFENSE_TARGET_CNT;
        if (!room) return base;
        let keepers = room.find(FIND_HOSTILE_CREEPS)
            .filter(c => c.owner && c.owner.username == "Source Keeper").length;
        return Math.max(base, Math.min(4, keepers));
    },
    outerDefenseLairGroups(room, lairs) {
        let key = lairs.map(e => e.id).join(",");
        let mem = room.memory;
        if (mem.defenseLairGroups && mem.defenseLairGroupsKey == key) {
            let byId = {};
            lairs.forEach(e => byId[e.id] = e);
            let cached = mem.defenseLairGroups.map(ids => ids.map(id => byId[id]).filter(e => e));
            if (cached.length && cached.every(x => x.length)) return cached;
        }
        let n = lairs.length;
        let dist = [];
        for (let i = 0; i < n; i++) {
            dist.push([]);
            for (let j = 0; j < n; j++) {
                if (i == j) dist[i].push(0);
                else if (j < i) dist[i].push(dist[j][i]);
                else {
                    let p = PathFinder.search(lairs[i].pos, lairs[j].pos,
                        { maxRooms: 1, plainCost: 1, swampCost: 5, range: 1 });
                    dist[i].push(p && p.path ? p.path.length : 999);
                }
            }
        }
        let target = Math.ceil(n / OUTER_DEFENSE_LAIRS_PER_CREEP);
        let best = null, used = [], cur = [];
        let evalCur = () => {
            if (cur.length != target) return;
            let cost = 0;
            cur.forEach(g => {
                let mx = 0;
                for (let a = 0; a < g.length; a++) {
                    for (let b = a + 1; b < g.length; b++) mx = Math.max(mx, dist[g[a]][g[b]]);
                }
                cost += mx;
            });
            if (!best || cost < best.cost) best = { cost: cost, groups: cur.map(g => g.slice()) };
        };
        let rec = () => {
            if (cur.length > target) return;
            let i = -1;
            for (let k = 0; k < n; k++) if (!used[k]) { i = k; break; }
            if (i < 0) { evalCur(); return; }
            used[i] = true;
            for (let j = i + 1; j < n; j++) {
                if (used[j]) continue;
                used[j] = true;
                cur.push([i, j]);
                rec();
                cur.pop();
                used[j] = false;
            }
            cur.push([i]);
            rec();
            cur.pop();
            used[i] = false;
        };
        rec();
        let groups = best ? best.groups.map(g => g.map(k => lairs[k])) : [lairs];
        mem.defenseLairGroupsKey = key;
        mem.defenseLairGroups = groups.map(g => g.map(e => e.id));
        return groups;
    },
    /**
     * 两个窝之间来回跑时，每个窝待多久（见 OUTER_DEFENSE_LAIR_CYCLE 的推导）。
     * 可用 Memory.marketSettings.outerDefensePatrolDwell 直接指定固定值覆盖。
     */
    outerDefenseDwell(posts) {
        let fixed = Number(Memory.marketSettings && Memory.marketSettings.outerDefensePatrolDwell);
        if (fixed > 0) return fixed;
        if (posts.length < 2) return OUTER_DEFENSE_PATROL_DWELL;
        let a = posts[0].pos, b = posts[1].pos;
        let travel = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        let dwell = Math.round((OUTER_DEFENSE_LAIR_CYCLE - travel * 2) / 2);
        return Math.max(OUTER_DEFENSE_MIN_DWELL, Math.min(OUTER_DEFENSE_MAX_DWELL, dwell));
    },
    /** 该位置是否在这组窝的接战半径内 */
    nearDefensePosts(pos, posts) {
        if (!posts || !posts.length) return true;   // 没有窝就不限制，退回原来的全房接战
        for (let p of posts) {
            if (pos.roomName == p.pos.roomName && pos.getRangeTo(p.pos) <= OUTER_DEFENSE_GUARD_RADIUS) return true;
        }
        return false;
    },
    /**
     * 外矿防守爬的派发与轮换。
     *
     * 原来的轮换条件有 bug：
     *   if (defenser && ttl>170 && !hasSendSpawn && length>1) return;
     * 一旦 hasSendSpawn 被置成 true，`!hasSendSpawn` 恒为 false → 条件恒假 →
     * 每 6 tick（本文件的 exec 频率）补生一只防守爬。加上防守爬进去就被 keeper
     * 打死（体型与敌情脱节 + 贴身不自愈，见 getOuterHarDefenseBodyConfig 与
     * outerDefense 的注释），就成了「生一只、死一只」的无限补员。
     *
     * 现在的规则（编制数见 outerDefenseQuota）：
     *   - 一只都没有 → 生
     *   - 最老的快死了（ttl <= outerDefenseReplaceLead）且还没派过接替 → 生一只接替，并打标记（**一次只派一只**）
     *   - 在役 + 在途的数量不足编制（有威胁的房 2 只起、keeper 更多时按 1:1 加编）→ 生
     *   - 普通外矿房：只有真的看到敌人 / lair / invaderCore 才派，且已有就不派
     */
    trySpawnOuterDefenser(roomName, spawnRoom, isInvader) {
        if (spawnRoom.spawnFailure) return null;
        let targetName = roomName.name || roomName;
        let harRoom = Game.rooms[targetName];
        let sourceMemory = Memory.rooms[targetName];
        let data = sourceMemory && sourceMemory[pro.stationName]
            && _.values(sourceMemory[pro.stationName]).find(e => e && e.id);
        if (!data) return;

        // 在役 + 在途的防守爬（见 outerDefenseAssignments：必须按任务栈全局数，
        // 只数「还站在出兵房里的」会永远差一只 → 每 6 tick 白派一只）。
        // front = 最老的那只（ttl 最小的）；还在出生的（ttl undefined）排最后。
        let defensers = pro.outerDefenseAssignments(targetName).slice();
        defensers.sort((a, b) => (a.ticksToLive || 9999) - (b.ticksToLive || 9999));
        let front = defensers.head();
        let quota = pro.outerDefenseQuota(harRoom);

        let needSpawn = false;
        let replacingFront = false;
        if (isInvader) {
            if (!front) needSpawn = true;
            else if (front.ticksToLive <= pro.outerDefenseReplaceLead(targetName, spawnRoom)) {
                // 派接替：hasSendSpawn 保证「对同一只老爬只派一次」，避免每 6 tick 重复生。
                //
                // 但光有这个标记会把补员锁死：如果那次派出的接替**已经死了**（被打死、
                // 或者路上损耗），标记仍在，老那只又已经低于提前量，就再也不会补 ——
                // 防守直接断档。所以场上数量掉回目标以下时，必须无视标记继续补。
                if (!front.memory.hasSendSpawn || defensers.length < quota) {
                    needSpawn = true;
                    replacingFront = true;
                }
            }
            else if (defensers.length < quota) needSpawn = true;
        } else {
            // 普通外矿：确认有威胁才派
            if (!harRoom) return;
            let em = harRoom.find(FIND_HOSTILE_CREEPS).head();
            if (!em) em = harRoom.find(FIND_HOSTILE_STRUCTURES)
                .filter(e => e.structureType == STRUCTURE_INVADER_CORE || e.structureType == STRUCTURE_KEEPER_LAIR).head();
            if (em && !front) needSpawn = true;
        }
        if (!needSpawn) return;
        // 首次提出接替请求时记下时刻：成功生成后，差值就是「排队+生成」的真实
        // 耗时，写回 spawnRoom.memory.defSpawnQueueWait 供提前量使用（见上）。
        if (replacingFront && front && !front.memory.replaceRequestAt) {
            front.memory.replaceRequestAt = Game.time;
        }

        // 体型按房间实际敌情算（没有视野时退回固定体型），需要 boost 时先确认 lab 有货
        let cfg = pro.getOuterHarDefenseBodyConfig(isInvader, harRoom);
        let tasks = pro.generatorOuterHarDefenseTask(data);
        if (cfg.boostRes && _.keys(cfg.boostRes).length) {
            if (StationLab.boostAble(spawnRoom, cfg.boostRes)) {
                tasks.push(StationLab.generatorBoostResTask(cfg.boostRes).head());
            } else {
                // lab 拿不出化合物：不强化 TOUGH 只是 100 血的普通部件（还排在
                // 吸伤位之外就是双重死重），去掉并把 2 个部件位还给远程输出。
                cfg.body = cfg.body.filter(e => e != TOUGH);
                cfg.body.unshift(RANGED_ATTACK, RANGED_ATTACK);
                cfg.boostRes = {};
            }
        }
        let name = StationHive.trySpawn(spawnRoom, spawnRoom.name, cfg.body, "outerHarvestDefenser", tasks);
        // 只有「为了接替最老那只而生的」才打标记，避免标记落到别的爬身上
        if (replacingFront && name) {
            front.memory.hasSendSpawn = true;
            // 实测本次「请求→成功生成」的排队耗时，回写进提前量公式。
            // 取历史最大值（封顶 600）：宁可提前量偏大多站一会，也不要空档。
            if (front.memory.replaceRequestAt) {
                let mem = spawnRoom.memory;
                let wait = Game.time - front.memory.replaceRequestAt;
                mem.defSpawnQueueWait = Math.min(600, Math.max(wait, mem.defSpawnQueueWait || 0));
                delete front.memory.replaceRequestAt;
            }
        }
        return name;
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
        if (!stations) return;
        // 画**所有矿点**的路线（除非指定 stationId）。原来只取第一个有路线的矿点画一条，
        // 看上去像「只有一条路」，主房出来后的分叉完全看不见。
        let list = debug.stationId
            ? [stations[debug.stationId]].filter(e => e && e.roadPathStr)
            : _.values(stations).filter(e => e && e.id && e.roadPathStr);
        if (!list.length) return;
        let palette = ["#00e5ff", "#ff9f43", "#a78bfa", "#34d399", "#f472b6"];
        list.forEach((data, si) => {
            let path = pro.getOuterRoadPath(data);
            if (!path || !path.length) return;
            let lineColor = palette[si % palette.length];
            path.forEach((pos, index) => {
                let previous = path[index - 1];
                let visual = new RoomVisual(pos.roomName);
                if (previous && previous.roomName == pos.roomName) {
                    visual.line(previous.x, previous.y, pos.x, pos.y, { color: lineColor, width: 0.12, opacity: 0.75 });
                }
                // 每个路点按**当前状态**上色，直接回答「这段路修好了没」：
                //   绿 = 已经是路   黄 = 已立工地   红 = 既无路也无工地（缺口）
                //   灰 = 被其它建筑占位（本来就无需铺路）
                let room = Game.rooms[pos.roomName];
                if (!room) return;
                let state = "gap";
                let st = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                if (st.some(s => s.structureType == STRUCTURE_ROAD)) state = "road";
                else if (st.length) state = "other";
                else if (room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y)
                    .some(s => s.structureType == STRUCTURE_ROAD)) state = "site";
                let color = state == "road" ? "#22c55e"
                    : state == "site" ? "#eab308"
                        : state == "other" ? "#94a3b8" : "#ef4444";
                visual.circle(pos.x, pos.y, { radius: 0.12, fill: color, opacity: 0.9 });
            });
            let start = path[0];
            let end = path.last();
            new RoomVisual(start.roomName).circle(start.x, start.y, { radius: 0.42, fill: "#22c55e", opacity: 0.85 });
            new RoomVisual(end.roomName).circle(end.x, end.y, { radius: 0.42, fill: "#f59e0b", opacity: 0.85 });
        });
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
