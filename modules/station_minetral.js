
Creep.prototype.registerStationMineral = function () {
    let rm = Memory.rooms[this.memory["roomName"]];
    if (rm && rm[pro.stationName]) {
        let mineral = rm[pro.stationName];
        if (this.spawning) {
            mineral["spawnTime"] = Game.time - Math.ceil(this.body.length * 3 / 2) //因为 后面计算的时候又减少一遍了，所以除以2
        }
        let rmHarList = mineral["creeps"];
        if (!rmHarList.contains(this.id))
            rmHarList.push(this.id)
    }
};


Creep.prototype.registerStationMineralCarryInRoom = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.used = room.used || {}
    room.used[this.headTask().id] = true

};

Creep.prototype.concatStationMineral = function () {
    let rm = Memory.rooms[this.memory["roomName"]];
    if (rm && !this.concated) {
        this.concated = true
        let data = rm[pro.stationName];
        // update() 会在 extractor 消失时整条删除 stationMineral 记忆，
        // data 缺失时跳过记账（concated 已置位不会重复进入）
        if (data && data["spawnTime"]) {
            data["spawnTime"] -= Game.time - data["spawnTime"] - 10;// 出生时间 - 接触时间 这样下次走到那边就可以刚刚好前面那只死掉,再缓冲 10tick
        }
    }
    this.popTask();
    this.execLastTask();
};


Creep.prototype.harvestMineralKeeper = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let mineral = Game.getObjectById(task["id"]);
        let station = this.room.memory[pro.stationName];
        // update() 删除 stationMineral 后仍存活的 keeper 会在这里拿不到
        // station：弹任务回家回收，否则每 tick TypeError、爬原地站到老死
        if (!station || !station["container"]) {
            this.popTask()
                .addTask([UtilsTask.taskData("recycleCreep")])
                .execLastTask();
            return;
        }
        let container = Game.getObjectById(station["container"]);
        if (container && !container.pos.isEqualTo(this)) {
            this.addTask(UtilsTask.task(container, "concatStationMineral"));
            this.addTaskAndExec(UtilsTask.task(container, "goToPop"));
            return;
        }
        let policy = pro.getMiningPolicy(station.resType);
        if (this.ticksToLive % 6 == 0) {
            if (container && container.store.getFreeCapacity(station.resType) > 80) {
                // Mineral 的属性是 mineralAmount（amount 是 Deposit 的，
                // 原写法永为 undefined，采尽后的回收/自杀分支是死代码）
                if (mineral && mineral.mineralAmount == 0) {
                    if (this.ticksToLive > 600) {
                        this.popTask()
                            .addTask([UtilsTask.taskData("recycleCreep")])
                            .execLastTask();
                    } else {
                        this.suicide();
                    }
                    return;
                }
                // 该矿物判为不值得采（矿价 ≤ 能量价一半）：暂停采集。
                // 存量上限已移除（0.78.217 有矿就采），多余部分由 autoSellMineral 挂卖单。
                if (!policy.mine) return;
                this.harvest(mineral);
            }
        }
    }
}


let pro = {
    stationName: "stationMineral",
    /**
     * 采集判据（用户 2026-11-07）：**单价 > 能量单价一半** 的矿就采，有矿就采。
     *
     *  · 价格源与市场模块同源（StrategyMarketPrice.getResTypeHistory，14 天成交均价，
     *    缺价退 DEFAULT_PRICE）；能量单价一半 = 采矿 spawn 能量成本的经济红线。
     *  · 取消静态 U/K/Z 黑名单与 20k 存量停采线（2026-10 月旧政策）。按 2026-11-07
     *    shard3 快照，七种基础矿均价（U 10.2 / K 16.3 / Z 18.7 / O 22.1 / H 36.5 /
     *    L 135 / X 304）全部高于能量均价 16.0 的一半（8.0）⇒ 当前全采；某矿价跌破
     *    线（如 U < 8）时自动回到「只买不采」。
     *  · 采集侧**不再设存量上限**（stop 默认 Infinity）：多余矿物由
     *    StrategyMarket.autoSellMineral 直接挂卖单（mineralKeep 默认 2 万，0.78.217）。
     *  · Memory.mineralSettings[resType].stop 仍可显式设上限应急。
     */
    getMiningPolicy(resType) {
        let energyPrice = Number(StrategyMarketPrice
            && StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)) || 0;
        // ⚠️ 价格口径：getResTypeHistory 的价格地图会**过滤掉 stddev>avg 的波动日**，
        // 波动大的矿（如 H：挂单 100+、14 天均价 36+，但整天窗波动 ⇒ 全被滤空）会
        // 掉回 DEFAULT_PRICE（H=1.1），与真实行情严重脱节 ⇒ 政策误判「不值一采」。
        // 这里用**原始** 14 天历史做成交量加权均价兜底取 max——只有所有信号都说
        // 「便宜」时才停采（缺价默认采，有矿就采）。
        let mineralPrice = Number(StrategyMarketPrice
            && StrategyMarketPrice.getResTypeHistory(resType)) || 0;
        let hist = (StrategyMarketPrice && StrategyMarketPrice.getHistory
            ? StrategyMarketPrice.getHistory(resType) : []) || [];
        let tw = 0, tv = 0;
        hist.forEach(e => {
            if (!e || !(e.avgPrice > 0)) return;
            let v = Math.max(1, e.volume || 0);
            tw += e.avgPrice * v;
            tv += v;
        });
        mineralPrice = Math.max(mineralPrice, tv > 0 ? tw / tv : 0);
        let mine = energyPrice <= 0 || mineralPrice > energyPrice / 2;
        let custom = Memory.mineralSettings && Memory.mineralSettings[resType];
        let stop = Number(custom && custom.stop) || Infinity;
        return { mine: mine, stop: stop };
    },
    getMineralStock(room, data) {
        if (!data || !data.resType) return 0;
        let stock = StationCarry.roomMassStoreCnt(room, data.resType);
        let container = Game.getObjectById(data.container);
        if (container) stock += container.store[data.resType] || 0;
        return stock;
    },
    getHarvesterBodyConfig(energy) {
        let current = 0;
        let cost = BODYPART_COST[WORK] * 4 + BODYPART_COST[MOVE];
        let num = 0;
        while (current + cost <= energy) {// 挖矿的不需要carry 直接 4：1 没问题的！ 体型越大越好
            num += 1;
            current += cost
            if (num >= 10) break;
        }
        return ManagerCreeps.calcBodyPart({ [MOVE]: num, [WORK]: num * 4 });
    },
    generatorHarTask(data) {
        return [
            UtilsTask.taskOutView(data["id"], data["roomName"], data["x"], data["y"], "harvestMineralKeeper", "registerStationMineral")
        ]
    },
    /**
     * 返回 1个 任务
     * @param roomName
     * @return {[undefined]}
     */
    generatorCarryMineralTask(roomName) {
        let sm = Memory.rooms[roomName.name || roomName][pro.stationName];
        let room = Game.rooms[roomName.name || roomName]
        room.used = room.used || {}
        let task = [];
        if (sm) {
            let container = Game.getObjectById(sm["container"]);
            if (container &&
                (container.store.getFreeCapacity(sm.resType) < 400 || (container.store.getFreeCapacity(sm.resType) < 2000 && room.mineral.ticksToRegeneration > 0))
                && !room.used[container.id]) {
                _.keys(container.store).forEach(e => {
                    task.push(UtilsTask.task(container, "carryRes", "registerStationMineralCarryInRoom", {
                        resType: e
                    }))
                })
            }
        }
        return [task];
    },
    trySpawnHarKeeper(room) {
        if (room.spawnFailure) return null;
        if (room.mineral.ticksToRegeneration > 0) return; // 如果已经生了，就不生了
        let data = room.memory[StationMineral.stationName]
        if(!data||!data["creeps"])return;// update 尚未执行时（新占领房间）直接返回
        // 如果两个多个连在一起死掉一个
        let allCreeps = data["creeps"].map(e => Game.getObjectById(e)).filter(e => e && e.ticksToLive)
        allCreeps.forEach(a => {
            allCreeps.forEach(b => {
                if (a.id != b.id && a.pos.isNearTo(b)) {
                    if (a.ticksToLive < b.ticksToLive) a.suicide(); else b.suicide();
                }
            })
        })

        // log(Game.time - data["spawnTime"])
        // HelperVisual.commonText(room,1500 - (Game.time - data["spawnTime"]),{x:data.x,y:data.y})
        // log()
        // 清理死掉的creeps
        data["creeps"] = data["creeps"].filter(e => Game.getObjectById(e))
        let container = Game.getObjectById(data["container"]) // change by an_w
        // 采集判据（0.78.217）：矿价 > 能量价一半才采（详见 getMiningPolicy）；
        // 存量上限默认不设（有矿就采），多余部分由 autoSellMineral >2 万挂卖单。
        let policy = pro.getMiningPolicy(data.resType);
        if (!policy.mine) return;
        if (container && room.extractor && (Game.time - data["spawnTime"] > 1500 || data["creeps"].length == 0)) {
            // log("Mineral" + room.name)
            let harBody = StationMineral.getHarvesterBodyConfig(room.getEnergyCapacityAvailable(room))
            let tasks = (StationMineral.generatorHarTask(data))
            StationHive.trySpawn(room, room.name, harBody, "harvestMineralKeeper", tasks)
        }
    },
    update(room) {
        // 清理条件演进：
        //  1) 最早是 `!room.my && !room.extractor`：只有两个条件同时成立才清理，
        //     于是**己方房没有 extractor** 时不会走进来，会为「采不到矿」的房间
        //     写下 stationMineral 记忆，trySpawnHarKeeper 再据此派 harvestMineralKeeper
        //     （我上次修的就是这个）。
        //  2) 但改成 `!room.my || !room.extractor` 又会把**外矿房**的矿物记忆直接删掉
        //     —— 外矿矿物采集（StationSources.trySpawnOuterMineralKeeper）依赖这份
        //     数据来定位 mineral 与 container，删了就永远采不到外矿的 H / X / L。
        //
        // 现在的规则：
        //   1) 没有 extractor、或没有 mineral → 清理，避免为「采不到矿」的房间留下记忆
        //      （我上次修的就是这个：己方房没 extractor 时 trySpawnHarKeeper 会误派
        //      harvestMineralKeeper）。
        //   2) 外矿房（!room.my）必须**挂了 har 旗**才记录。否则别人家的 extractor
        //      （observer 扫到的敌房）也会留下一条我们永远用不上的 stationMineral，
        //      既不采也白占 Memory —— 这是上一版 `!room.my || !room.extractor` 之外
        //      单独要补的边界：外矿物采集只认 har 旗标出来的目标房。
        //   Memory.rooms[room.name] 可能不存在，直接下标删除会抛异常，所以先取再判空。
        let mineral = room.mineral;
        let flagged = !room.my && room.flags && room.flags("har").length > 0;
        if (!room.extractor || !mineral || (!room.my && !flagged)) {
            let rm = Memory.rooms[room.name];
            if (rm) delete rm[pro.stationName];
            return;
        }
        let usedContainer = {};
        let tmp = room.memory[pro.stationName] = room.memory[pro.stationName] || {};

        /** todo 更新寻找的算法 */
        let container = room[STRUCTURE_CONTAINER].filter(c => c.pos.isNearTo(mineral) && !usedContainer[c.id]).head();
        // 单矿房只有一个矿，去重写不写无实际差别；写入保持与 station_sources 一致
        if (container) usedContainer[container.id] = true;
        tmp["roomName"] = room.name;
        tmp["id"] = mineral.id;
        tmp["resType"] = mineral.mineralType;
        tmp["x"] = mineral.pos.x;
        tmp["y"] = mineral.pos.y;
        tmp["creeps"] = tmp["creeps"] || [];
        tmp["spawnTime"] = tmp["spawnTime"] || 0;
        tmp["container"] = container ? container.id : undefined;
    },

};



global.StationMineral = pro;
