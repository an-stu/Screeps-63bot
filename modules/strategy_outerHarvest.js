/**
 * 外矿策略
 * 旗子规则：har_<出生/供给房间>（如 har_E53S21），旗子物理放在矿区（如 E54S21）
 * flag.pos.roomName = 矿区，flag.getRoomName() = 供给房间（旗名第二段）
 */

let pro = {
    exec(room) {
        if ((Game.time + room.hashCode()) % 6 != 0) return;
        let flags = ManagerFlags.getFlagsByPrefix("har");
        if (!flags.length) return;
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
            if (Memory.rooms[targetRoomName]) {
                let isInvader = flag.name.includes('invader');
                StationSources.trySpawnOuterDefenser(targetRoomName, spawnRoom, isInvader);
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
                let harRoom = Game.rooms[targetRoomName];
                if ((Game.time + spawnRoom.hashCode()) % 30 == 0 && harRoom) {
                    StationSources.update(harRoom)
                }
                // 普通外矿不依赖当前视野：任务中已有 source 坐标，keeper 会自行
                // 进入目标房。reserve 仍只在看得见 controller 时决策。
                if (!flag.name.includes('invader')) {
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
                else if (harRoom && !harRoom.controller && flag.name.includes('invader')) { // this is invader room
                    // if there is defender, then spawn harvester
                    let defenser = spawnRoom.creeps("outerHarvestDefenser", false).filter(e => {
                        let task = e.headTask();
                        return task && task.roomName == harRoom.name;
                    }).head()
                    if (!defenser) continue;
                    // console.log(defenser.name)
                    StationSources.trySpawnOuterHarKeeper(targetRoomName, spawnRoom, true);
                }
                // 外矿矿物：只采**市场价格高**的矿（H / X / L）。低价矿（K / Z / O / U）
                // 采回来不值钱，却要占 spawn、carrier 与防守配置，见 shouldHarvestRemoteMineral 的说明。
                if (pro.shouldHarvestRemoteMineral(targetRoomName)) {
                    StationSources.trySpawnOuterMineralKeeper(targetRoomName, spawnRoom);
                }
                StationSources.trySpawnOuterHarCarrier(targetRoomName, spawnRoom);

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
