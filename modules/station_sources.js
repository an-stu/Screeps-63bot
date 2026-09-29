
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
/** 每轮最多立多少个外矿道路工地（避免一个 tick 里 createConstructionSite 刷爆 CPU） */
const OUTER_ROAD_SITE_BATCH = 30;
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
        let data = rm[pro.stationName][this.headTask().id];
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
    if (task.roomName != this.room.name) {
        this.goTo(task);
        return;
    } else {
        let mineral = Game.getObjectById(task["id"]);
        // 矿物记录挂在 StationMineral.stationName（一房一条、不按 id 分桶），
        // 不是本模块的 "stationSources"。原来按 [pro.stationName][task["id"]] 取，
        // 拿到的是 undefined，下一行 station["container"] 必定抛 TypeError ——
        // 外矿矿物爬一旦出生就会每 tick 报错。改成取 stationMineral 并判空。
        let station = Memory.rooms[this.headTask().roomName]
            && Memory.rooms[this.headTask().roomName][StationMineral.stationName];
        let container = station && Game.getObjectById(station["container"]);
        if (container && !container.pos.isEqualTo(this)) {
            this.addTask(UtilsTask.task(container, "concatStationSources"));
            this.addTaskAndExec(UtilsTask.task(container, "goToPop"));
            return;
        }
        if (mineral.mineralAmount > 0) {
            if (this.harvest(mineral) !== OK && this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.repair(container)
            }
        }
    }
    if (this.ticksToLive % 17 == 0 && this.ticksToLive > 40) {
        // find tombstone range 3 and withdraw the energy
        let tombstone = this.pos.findInRange(FIND_TOMBSTONES, 3).head();
        if (tombstone && tombstone.store[RESOURCE_ENERGY] > 0) {
            // put the mineral into the container first
            this.transfer(container, mineral.mineralType)
            this.withdraw(tombstone, RESOURCE_ENERGY);
        }
        let dropEnergy = this.pos.findInRange(FIND_DROPPED_RESOURCES, 3).head();
        if (dropEnergy) {
            this.transfer(container, mineral.mineralType)
            this.pickup(dropEnergy);
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
    if (this.store[resType] > 0) {
        let home = Game.rooms[task.homeRoom] || this.mainRoom();
        let storage = home && home.storage;
        if (!storage) return;
        if (!this.pos.isNearTo(storage)) {
            this.moveTo(storage, { reusePath: 20, visualizePathStyle: { stroke: '#fffa00' } });
            return;
        }
        this.transfer(storage, resType);
        return;
    }
    if (!this.pos.isNearTo(container)) {
        this.moveTo(container, { reusePath: 20, visualizePathStyle: { stroke: '#fffa00' } });
        return;
    }
    let cap = this.store.getCapacity(resType) || this.store.getCapacity();
    let stored = container.store[resType] || 0;
    if (stored <= 0) return;
    // 还没攒够一趟：矿物还在就继续等（30 WORK 的采集爬 ~67 tick 就能填满 2000 的容器），
    // 矿物已经采空就把剩下的清回来，避免尾量永远留在外矿
    if (stored < cap * 0.8) {
        let mineral = Game.getObjectById(data["id"]);
        if (mineral && mineral.mineralAmount > 0) return;
    }
    this.withdraw(container, resType);
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
Creep.prototype.outerDefense = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let posts = pro.outerDefensePosts(this);
        let target = Game.getObjectById(this.memory.targetId);
        if (this.memory.targetId && !target) delete this.memory.targetId;
        if (!this.memory.targetId) {
            // 只打自己这组窝附近的敌人（见 OUTER_DEFENSE_GUARD_RADIUS 的说明）
            let hostiles = this.room.find(FIND_HOSTILE_CREEPS).filter(e => pro.nearDefensePosts(e.pos, posts));
            target = hostiles.length ? this.pos.findClosestByRange(hostiles) : undefined;
            if (!target) target = this.room.find(FIND_HOSTILE_STRUCTURES).filter(e => e.structureType == STRUCTURE_INVADER_CORE).head();
            if (target) this.memory.targetId = target.id;
        }
        let em = Game.getObjectById(this.memory.targetId);
        if (em) {
            // Creep.attack 只有相邻（range 1）才返回 OK，够不着才返回
            // ERR_NOT_IN_RANGE 需要走过去。
            //
            // 原来的写法把 heal(this) 放在 ERR_NOT_IN_RANGE 分支里：于是
            // 「贴身近战」时 attack 返回 OK、不进分支，**反而完全不自愈**，
            // 一边硬吃 keeper 的近战+远程（约 400/发）一边不回血，防守爬
            // 必然被打死，然后被补员逻辑再生成一只 —— 死循环。
            // 自愈必须无条件执行；autoHeal 内部已做「满血且附近无敌人就跳过」。
            if (this.attack(em) == ERR_NOT_IN_RANGE) this.moveTo(em);
            if (this.pos.inRangeTo(em, 3)) this.rangedAttack(em);
            this.heal(this);
            return;
        }
        // let injuredCreep =  this.findC(FIND_MY_CREEPS).filter(e=>e.hits!=e.hitsMax).head();
        let injuredCreep = this.pos.findClosestByRange(FIND_MY_CREEPS, { filter: e => e.hits != e.hitsMax })
        if (injuredCreep) {
            if (this.heal(injuredCreep) == ERR_NOT_IN_RANGE) {
                this.moveTo(injuredCreep)
                this.memory.dontPullMe = true;
            } else {
                this.memory.dontPullMe = false;
            }
            if (injuredCreep.name !== this.name) return;
        }
        this.heal(this);
        this.memory.dontPullMe = false;

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
            if (!this.pos.inRangeTo(wp.pos, 1)) {
                this.moveTo(wp.pos, { range: 1, reusePath: 5 });
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
        this.addTask([
            UtilsTask.task(this.mainRoom().storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
            UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
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
        this.addTask([
            UtilsTask.task(this.mainRoom().storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
            UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.mineRoom, stationId: task.stationId, roadDir: 1,
            }),
        ]);
        return this.execLastTask();
    }
    // 到达端点：先填充所有能量到 storage（即使道路未修完也要先送货），
    // 然后才决定掉头修路或返回矿区
    if (this.pos.isNearTo(target) || this.store[RESOURCE_ENERGY] == 0) {
        if (target && target.store && this.store[RESOURCE_ENERGY] > 0) {
            this.transfer(target, RESOURCE_ENERGY);
        }
        this.popTask();
        if (task.keepBuilding && this.store[RESOURCE_ENERGY] > 0 && data) {
            // 确定完成后再退出：端点强制刷新完成度检查
            complete = pro.outerRoadComplete(data, true);
            if (!complete) {
                let nextTarget = task.roadDir == 1 ? pro.getOuterMineTarget(data) : this.mainRoom().storage;
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
        let isRoadBuilder = this.getPartCnt(WORK) > 0 && this.getActiveBodyparts(WORK) > 0;
        if (data && !pro.outerRoadComplete(data) && isRoadBuilder) {
            // 道路未修好时只让带 WORK 的专职 carrier 修路。普通搬运爬
            // 仍然沿缓存路线把能量送入 Storage，不能让修路任务饿死主房。
            this.addTask(UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
                mineRoom: task.roomName, stationId: task.id, keepBuilding: true, roadDir: 1,
            }));
        } else {
            let roadTask = [
                UtilsTask.task(this.mainRoom().storage, "fillRes", undefined, { resType: RESOURCE_ENERGY }),
                UtilsTask.task(this.mainRoom().storage, "harvestEnergyOuterCarryRoadBuilder", undefined, {
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
    getOuterHarCarrierBodyConfig(energy, maxPart) {
        let current = 0;
        let cost = BODYPART_COST[CARRY] * 2 + BODYPART_COST[MOVE];
        let baseCost = BODYPART_COST[WORK] + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy - baseCost) {// 超过 10个 work 加一个 carry
            num += 1;
            current += cost
            if (num >= 17 || maxPart / 2 < num) break;
        }
        return ManagerCreeps.calcBodyPart({ [CARRY]: num < 17 ? num * 2 : num * 2 - 1, [MOVE]: num });
    },
    getOuterHarCarrierBuildBodyConfig(energy, maxPart) {
        let current = 0;
        let cost = BODYPART_COST[CARRY] * 2 + BODYPART_COST[MOVE];
        let baseCost = BODYPART_COST[WORK] + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy - baseCost) {// 超过 10个 work 加一个 carry
            num += 1;
            current += cost
            if (num >= 17 || maxPart / 2 < num) break;
        }
        return ManagerCreeps.calcBodyPart({ [WORK]: 2, [CARRY]: (num < 17 ? num * 2 : num * 2 - 1) - 2, [MOVE]: num });
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
        const bigBody = () => ({body: ManagerCreeps.calcBodyPart({[MOVE]: 17, [ATTACK]: 22, [HEAL]: 11}), boostRes: {}});
        const smallBody = () => ({body: ManagerCreeps.calcBodyPart({[ATTACK]: 9, [MOVE]: 10, [HEAL]: 1}), boostRes: {}});
        if (!harRoom) return isInvader ? bigBody() : smallBody();

        let hostiles = harRoom.getHostileCreeps();
        if (!hostiles.length) {
            // 没有活体敌人：只有 lair / invaderCore 时用能拆掉它的配置即可
            let hasNest = harRoom.find(FIND_HOSTILE_STRUCTURES)
                .some(e => e.structureType == STRUCTURE_KEEPER_LAIR || e.structureType == STRUCTURE_INVADER_CORE);
            if (!hasNest) return {body: ManagerCreeps.calcBodyPart({[ATTACK]: 5, [MOVE]: 6, [HEAL]: 1}), boostRes: {}};
            return isInvader ? bigBody() : smallBody();
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

        // 装不进 50 部件就上 boost：先 boost 奶（1 部件顶 4），再 boost 攻击。
        // 与 getDefenseHighWayData 的思路一致。
        if (attackCnt + healCnt + moveCnt > 50) {
            let boostedHeal = Math.ceil(healCnt / 4);
            let boostedAttack = Math.ceil(attackCnt / 4);
            let boostedMove = Math.ceil((boostedAttack + boostedHeal) / 2);
            if (boostedAttack + boostedHeal + boostedMove <= 50) {
                boostRes[BOOST_RES["heal"][2]] = boostedHeal * 30;
                boostRes[BOOST_RES["attack"][2]] = boostedAttack * 30;
                boostRes[BOOST_RES["damage"][2]] = boostedAttack * 30;
                let body = ManagerCreeps.calcBodyPart([
                    [TOUGH, boostedAttack], [ATTACK, boostedAttack], [HEAL, boostedHeal], [MOVE, boostedMove]
                ]);
                return {body: body, boostRes: boostRes};
            }
            // 还是装不下：按比例压到 50 部件，宁可弱一点也别生成不出来的配置
            let scale = 50 / (attackCnt + healCnt + moveCnt);
            attackCnt = Math.max(1, Math.floor(attackCnt * scale));
            healCnt = Math.max(1, Math.floor(healCnt * scale));
            moveCnt = Math.max(1, Math.ceil((attackCnt + healCnt) / 2));
            if (attackCnt + healCnt + moveCnt > 50) attackCnt = Math.max(1, 50 - healCnt - moveCnt);
        }
        let body = ManagerCreeps.calcBodyPart([[ATTACK, attackCnt], [HEAL, healCnt], [MOVE, moveCnt]]);
        // 中间九房的 source keeper 是满配 50 部件（约 5000 血，贴身时近战+远程
        // 合计约 400/发）。上面是按「当前看得见的那几只、且按 dis=2 只算远程」
        // 估的体型，实战一贴身就会奶量不足被反杀 —— 实测算出来只有
        // 16 ATTACK + 5 HEAL，而满血打赢 keeper 的是 22 ATTACK + 11 HEAL。
        // 所以入侵房（isInvader）一律不低于手工调好的 bigBody。
        if (isInvader) {
            let big = bigBody().body;
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
            if (end && to && end.roomName == to.roomName
                && Math.max(Math.abs(end.x - to.x), Math.abs(end.y - to.y)) <= 1) return cached;
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
            maxRooms: 4,
            // 两房路线叠加主房蓝图代价时，默认 2,000 ops 会在刚进主房
            // 就提前结束。此搜索仅在缓存失效时运行，允许一次完整求解。
            maxOps: 8000,
            range: 1,
            roomCallback(roomName) {
                let room = Game.rooms[roomName];
                let cm = new PathFinder.CostMatrix();
                let terrain = Game.map.getRoomTerrain(roomName);
                for (let y = 0; y < 50; y++) {
                    for (let x = 0; x < 50; x++) {
                        let t = terrain.get(x, y);
                        cm.set(x, y, t == TERRAIN_MASK_WALL ? 255 : (t == TERRAIN_MASK_SWAMP ? 5 : 1));
                    }
                }
                if (room) {
                    // 主房间蓝图：沿规划路网走，规划的其他建筑视为不可走
                    let structMap = room.memory && room.memory.structMap;
                    if (structMap) {
                        for (let type in structMap) {
                            // Prefer the blueprint road network, but do not
                            // turn unbuilt future structures into an absolute
                            // wall. A hard wall can make the only room exit
                            // unreachable and yields an incomplete path.
                            let cost = (type == 'road' || type == 'container') ? 1 : 50;
                            pro.structMapPositions(structMap[type]).forEach(p => {
                                let x = p.x != undefined ? p.x : p[0];
                                let y = p.y != undefined ? p.y : p[1];
                                if (cm.get(x, y) < 254) cm.set(x, y, cost);
                            });
                        }
                    }
                    // 已有建筑：路/容器/己方墙/链接可走，其余不可走
                    room.getStructures().forEach(s => {
                        let walkable = s.structureType == STRUCTURE_ROAD || s.structureType == STRUCTURE_CONTAINER
                            || (s.structureType == STRUCTURE_RAMPART && s.my) || s.structureType == STRUCTURE_LINK;
                        if (!walkable) cm.set(s.pos.x, s.pos.y, 255);
                    });
                }
                return cm;
            },
        });
        } catch (e) {
            data.roadPathError = "search threw: " + e.message + " tick=" + Game.time;
            return undefined;
        }
        // 蓝图约束可能把主房入口到 storage 的所有格子封死。只有在首选
        // 路网确实无解时，退回 Screeps 原生障碍矩阵；这样仍是一条缓存的
        // 唯一路线，但不会把外矿 carrier 永久卡在房间入口。
        if (!ret || ret.incomplete) {
            try {
                ret = PathFinder.search(from, to, {
                    plainCost: 1,
                    swampCost: 5,
                    maxRooms: 4,
                    maxOps: 8000,
                    range: 1,
                });
            } catch (e) {
                data.roadPathError = "fallback search threw: " + e.message + " tick=" + Game.time;
                return undefined;
            }
        }
        let end = ret && ret.path && ret.path.last();
        let reachesDestination = end && to && end.roomName == to.roomName
            && Math.max(Math.abs(end.x - to.x), Math.abs(end.y - to.y)) <= 1;
        if (ret && !ret.incomplete && reachesDestination && ret.path.length > 1) {
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
     * 每 100 tick 才跑一次，每轮最多 OUTER_ROAD_SITE_BATCH 个，避免
     * createConstructionSite 在单个 tick 里刷爆 CPU。
     */
    placeOuterRoadSites(data, spawnRoom) {
        if (data.roadSiteBuildTick && Game.time - data.roadSiteBuildTick < 100) return;
        data.roadSiteBuildTick = Game.time;
        let path = pro.getOuterRoadPath(data);
        if (!path || !path.length) return;
        let created = 0;
        for (let p of path) {
            if (created >= OUTER_ROAD_SITE_BATCH) break;
            // 边界格不能盖路
            if (p.x == 0 || p.x == 49 || p.y == 0 || p.y == 49) continue;
            let room = Game.rooms[p.roomName];
            if (!room) continue;                              // 没视野的房跳过
            if (room.name == spawnRoom.name) continue;        // 主房的路由本地规划器维护
            if (room.lookForAt(LOOK_STRUCTURES, p.x, p.y).length) continue;          // 已有建筑（含路）
            if (room.lookForAt(LOOK_CONSTRUCTION_SITES, p.x, p.y).length) continue;
            if (pro.roadBlockedByBlueprint({ roomName: p.roomName, x: p.x, y: p.y })) continue;
            if (room.createConstructionSite(p.x, p.y, STRUCTURE_ROAD) == OK) created++;
        }
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
            // 主房蓝图中的道路由本地规划器维护，绝不在这里移除。
            if (roomName == spawnRoom.name) return;
            let room = Game.rooms[roomName];
            if (!room) return;
            room.find(FIND_MY_CONSTRUCTION_SITES)
                .filter(site => site.structureType == STRUCTURE_ROAD
                    && !route[roomName + ":" + site.pos.x + ":" + site.pos.y])
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
                let code = creep.move(creep.pos.getDirectionTo(point));
                // 单步 move 不经过 BetterMove，手动更新 lastPos 便于诊断
                if (code == OK) {
                    creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName, time: Game.time };
                    return code;
                }
                // 目标格被占/不可走：向目标方向的邻近方向（±45°）试探，
                // 持续向目标靠拢，避免多个爬互相占住对方目标格而死锁
                let dir = creep.pos.getDirectionTo(point);
                for (let i = 1; i <= 7; i += 2) {
                    let d = ((dir - 1 + i + 8) % 8) + 1;
                    code = creep.move(d);
                    if (code == OK) {
                        creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName, time: Game.time };
                        return code;
                    }
                }
                return OK;
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
            return creep.move(creep.pos.getDirectionTo(next));
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
            let room = Game.rooms[p.roomName];
            if (!room) { data.roadComplete = false; return false; }
            let structures = room.lookForAt(LOOK_STRUCTURES, p.x, p.y);
            if (structures.find(s => s.structureType == STRUCTURE_ROAD)) continue; // 已有路
            if (structures.find(s => s.structureType != STRUCTURE_ROAD)) continue; // 被建筑占位（容器等），无需修路
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
                let EnergyPerTick = 10;
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
                let maxPart = Math.ceil(NeedCarryPartCnt / Math.ceil(NeedCarryPartCnt / 33)) // 每个 最大32 part 计算每只的数量
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
     * 现在的规则：
     *   - 一只都没有 → 生
     *   - 最老的快死了（ttl <= OUTER_DEFENSE_REPLACE_TTL）且还没派过接替 → 生一只接替，并打标记（**一次只派一只**）
     *   - 数量不足常驻目标（中间九房 2 只）→ 生
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

        // 已在场（含正在出生的）的防守爬。Game.creeps 按名字顺序，head() 即最老的一只。
        let defensers = spawnRoom.creeps("outerHarvestDefenser", false).filter(e => {
            let t = e.headTask && e.headTask();
            return t && t.roomName == targetName;
        });
        let front = defensers.head();

        let needSpawn = false;
        let replacingFront = false;
        if (isInvader) {
            if (!front) needSpawn = true;
            else if (front.ticksToLive <= OUTER_DEFENSE_REPLACE_TTL) {
                // 派接替：hasSendSpawn 保证对同一只只派一次
                if (!front.memory.hasSendSpawn) {
                    needSpawn = true;
                    replacingFront = true;
                }
            }
            else if (defensers.length < OUTER_DEFENSE_TARGET_CNT) needSpawn = true;
        } else {
            // 普通外矿：确认有威胁才派
            if (!harRoom) return;
            let em = harRoom.find(FIND_HOSTILE_CREEPS).head();
            if (!em) em = harRoom.find(FIND_HOSTILE_STRUCTURES)
                .filter(e => e.structureType == STRUCTURE_INVADER_CORE || e.structureType == STRUCTURE_KEEPER_LAIR).head();
            if (em && !front) needSpawn = true;
        }
        if (!needSpawn) return;

        // 体型按房间实际敌情算（没有视野时退回固定体型），需要 boost 时先确认 lab 有货
        let cfg = pro.getOuterHarDefenseBodyConfig(isInvader, harRoom);
        let tasks = pro.generatorOuterHarDefenseTask(data);
        if (cfg.boostRes && _.keys(cfg.boostRes).length && StationLab.boostAble(spawnRoom, cfg.boostRes)) {
            tasks.push(StationLab.generatorBoostResTask(cfg.boostRes).head());
        }
        let name = StationHive.trySpawn(spawnRoom, spawnRoom.name, cfg.body, "outerHarvestDefenser", tasks);
        // 只有「为了接替最老那只而生的」才打标记，避免标记落到别的爬身上
        if (replacingFront && name) front.memory.hasSendSpawn = true;
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
        let data = stations && (debug.stationId ? stations[debug.stationId] : _.values(stations).find(e => e && e.roadPathStr));
        let path = data && pro.getOuterRoadPath(data);
        if (!path || !path.length) return;
        path.forEach((pos, index) => {
            let previous = path[index - 1];
            let visual = new RoomVisual(pos.roomName);
            if (previous && previous.roomName == pos.roomName) {
                visual.line(previous.x, previous.y, pos.x, pos.y, { color: "#00e5ff", width: 0.16, opacity: 0.8 });
            }
            if (index % 10 == 0) visual.text(index, pos.x, pos.y, { color: "#ffffff", font: 0.45, opacity: 0.9 });
        });
        let start = path[0];
        let end = path.last();
        new RoomVisual(start.roomName).circle(start.x, start.y, { radius: 0.42, fill: "#22c55e", opacity: 0.85 });
        new RoomVisual(end.roomName).circle(end.x, end.y, { radius: 0.42, fill: "#f59e0b", opacity: 0.85 });
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
