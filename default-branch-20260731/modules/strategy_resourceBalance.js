/**
 * 房间内的资源平衡策略
 */

/*
storageEmpty storage的东西
storageEmpty_W19N21 传送到指定房间
storageEmpty_random 传送随机房间
storageEmpty 不填   传送最近的房间

 */
let STORAGE_MIN_CAP_CNT = 10000
let NOT_FULL_SEND_RES_SET = [RESOURCE_ENERGY, "U", "L", "K", "Z", "X", "O", "H", "G"].toSet()

let RES_BALANCE_ROOM = function () {
    let obj = {};
    // RESOURCES_ALL.forEach(e=>{
    //     obj[e] = 3000
    // })
    (["O", "L", "H", "X", "K", "Z", "U", "OH", " GH2O", "LH2O", "GH", "LH", "ZHO2", "KH2O", "GHO2", "UHO2", "UH2O", "XLHO2", "XGHO2", "XZHO2", "XZH2O", "XUH2O", "XKHO2", "XGH2O"]).forEach(e => {
        obj[e] = 3000
    })
    obj[RESOURCE_ENERGY] = 50000
    obj[RESOURCE_POWER] = 3000
    obj[RESOURCE_BATTERY] = 3000
    obj[RESOURCE_GHODIUM] = 3000
    obj[RESOURCE_OPS] = 3000

    // 商品
    obj[RESOURCE_SILICON] = 3000
    obj[RESOURCE_BIOMASS] = 3000
    obj[RESOURCE_METAL] = 3000
    obj[RESOURCE_MIST] = 3000
    
    // bar
    obj[RESOURCE_UTRIUM_BAR] = 3000
    obj[RESOURCE_LEMERGIUM_BAR] = 3000
    obj[RESOURCE_ZYNTHIUM_BAR] = 3000
    obj[RESOURCE_ZYNTHIUM_BAR] = 3000
    obj[RESOURCE_KEANIUM_BAR] = 3000
    obj[RESOURCE_GHODIUM_MELT] = 3000
    obj[RESOURCE_OXIDANT] = 3000
    obj[RESOURCE_REDUCTANT] = 3000
    obj[RESOURCE_PURIFIER] = 3000

    return obj
}()

let RES_HOLD_ROOM = function () {
    // console.log(RESOURCES_ALL.length * 3000+ 50000);
    let obj = {};
    RESOURCES_ALL.forEach(e => {
        obj[e] = 3000
    })
    return obj
}()

Creep.prototype.registerBalanceTerminalResource = function () {
    this.room.balancingTerminalResource = true
}


Creep.prototype.balanceTerminalResource = function () {
    let needBalance = pro.resRoomBalanceCache[this.room.name];
    let resTypes = _.keys(needBalance) // 从小到大排序
        .sort((a, b) => (this.room.terminal.store[a] || 0) - (this.room.terminal.store[b] || 0));
    while (resTypes.head()) {
        let resType = resTypes.head()
        let resCnt = RES_BALANCE_ROOM[resType] || RES_HOLD_ROOM[resType];
        let room = this.room;
        if ((room.terminal.store[resType] || 0) != resCnt && room.storage.store[resType] && room.terminal.store.getFreeCapacity(resType) > 0 ||
            (room.terminal.store[resType] || 0) > resCnt && room.storage.store.getFreeCapacity(resType) > 0) break;
        delete needBalance[resTypes.shift()]
    }
    if (this._balanceTerminalResource > 5) return this.popTask();
    this._balanceTerminalResource = (this._balanceTerminalResource || 0) + 1;
    // HelperVisual.showText(this,resTypes.head())
    // this.say(pro.resRoomBalanceCache[this.room.name])
    let resType = resTypes.head();
    if (resType && this.ticksToLive > 30 && this.store.getResTypeList().length == 0) {
        let resCount = (RES_BALANCE_ROOM[resType] || RES_HOLD_ROOM[resType]) - (this.room.terminal.store[resType] || 0)
        let ops = {
            resType: resType,
            resCount: resCount > 0 ? resCount : -resCount
        }
        let fromTo = [this.room.storage, this.room.terminal]
        if (resCount < 0) {
            fromTo = [this.room.terminal, this.room.storage]
        }
        let task = [
            UtilsTask.task(fromTo[1], "fillRes", undefined, ops),
            UtilsTask.task(fromTo[0], "carryRes", undefined, ops)
        ]
        if (resTypes.length == 1 && Math.abs(resCount) <= this.store.getFreeCapacity(resType)) {
            this.popTask();
        }
        this.addTask(task)
        this.execLastTask();
    } else {
        this.popTask();
    }
}



Creep.prototype.roomStorageEmpty = function () {
    if (pro.checkEmptyStorage(this.room) || this.ticksToLive < 30
        || !this.room.find(FIND_FLAGS).filter(e => e.getPrefix() == "storageEmpty").head()) {
        this.popTask();
        this.execLastTask();
    }
    if (this.room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) + this.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) < 50000) {
        let ops = {
            resType: RESOURCE_ENERGY
        }
        let fromTo = [this.room.storage, this.room.terminal]
        let task = [
            UtilsTask.task(fromTo[1], "fillRes", undefined, ops),
            UtilsTask.task(fromTo[0], "carryRes", undefined, ops)
        ]
        this.addTask(task);
        this.execLastTask();
        return;
    }
    let res = this.room.storage.store.getLessResTypesExceptEnergy()
    let fromTo = [this.room.storage, this.room.terminal]
    let resType = res.head();
    if (!resType) resType = RESOURCE_ENERGY
    let ops = {
        resType: resType,
        // resCount: this.room.storage.store[resType]
    }
    let task = [
        UtilsTask.task(fromTo[1], "fillRes", undefined, ops),
        UtilsTask.task(fromTo[0], "carryRes", undefined, ops)
    ]
    this.addTask(task);
    this.execLastTask();
}



let pro = {
    resRoomBalanceCache: {},
    update(room) {
        //RES_HOLD_ROOM[resType]
        let needBalance = pro.resRoomBalanceCache[room.name] = {}
        // _.keys(RES_BALANCE_ROOM).forEach(resType=>{
        //     if((room.storage.store[resType]||0)+(room.terminal.store[resType]||0)>=(RES_BALANCE_ROOM[resType]||0)&&
        //         room.terminal.store[resType]!=(RES_BALANCE_ROOM[resType]||0)){
        //         needBalance[resType]=1;//RES_BALANCE_ROOM[resType]-room.terminal.store[resType]
        //     }
        // })
        // _.keys(room.terminal.store).filter(e => (!RES_BALANCE_ROOM[e])&&room.terminal.store[e] > 0).forEach(resType=> needBalance[resType] = 1)

        RESOURCES_ALL.forEach(resType => {
            let resCnt = RES_BALANCE_ROOM[resType] || RES_HOLD_ROOM[resType];
            if ((room.terminal.store[resType] || 0) != resCnt && room.storage.store[resType] && room.terminal.store.getFreeCapacity(resType) > 0 ||
                (room.terminal.store[resType] || 0) > resCnt && room.storage.store.getFreeCapacity(resType) > 0) {
                needBalance[resType] = 1;//RES_BALANCE_ROOM[resType]-room.terminal.store[resType]
            }
        })
    },

    roomRequire: {},//房间需求
    /**
     * 初始化房间需求
     * @param room
     */
    roomRequireInit(room) {
        pro.roomRequire[room.name] = {};
    },
    /**
     * 房间需求变化，如果为订单为0则删除
     * send cnt 的数量
     */
    roomRequireCal(room, resType, cnt) {
        if (!pro.roomRequire[room.name]) pro.roomRequire[room.name] = {}
        if (pro.roomRequire[room.name][resType] === undefined) pro.roomRequire[room.name][resType] = 0
        pro.roomRequire[room.name][resType] -= cnt
        if (pro.roomRequire[room.name][resType] == 0) delete pro.roomRequire[room.name][resType]
    },
    /**
     * 房间需求数量
     * send cnt 的数量
     */
    roomRequireCnt(room, resType) {
        if (!pro.roomRequire[room.name]) return 0;
        if (pro.roomRequire[room.name][resType] === undefined) return 0;
        return pro.roomRequire[room.name][resType]
    },
    /**
     * 更新房间的需求
     * @param room
     */
    processRoom(room) {
        pro.roomRequireInit(room);
        for (let resType of _.keys(RES_BALANCE_ROOM)) {
            let targetStorageCnt = room.storage ? (room.storage.store[resType] || 0) : 0
            if ((room.terminal.store[resType] || 0) + targetStorageCnt < RES_BALANCE_ROOM[resType] * 2) {
                pro.roomRequireCal(room, resType, -(RES_BALANCE_ROOM[resType] * 2 - ((room.terminal.store[resType] || 0) + targetStorageCnt)));
            }
        }
        // log(room.name,pro.roomRequire[room.name])
    },
    needBalanceWithPowerFactoryRoom(room) { // 富集商品
        if ((Game.time + room.hashCode()) % 10 != 0) return;
        let level = StrategyFactoryPowerCreep.getPowerFactoryLevel(room);
        let trade = room.flags("trade").length > 0 || room.name == 'E21N9'
        if (level && room.terminal && room.storage && !room.terminal.cooldown) {
            let require = BALANCE_POWER_FACTORY_LIST[level].concat(trade ? BALANCE_POWER_FACTORY_LIST[6] : [])
                .filter(e => (room.terminal.store[e[0]] || 0) + (room.storage.store[e[0]] || 0) < Math.min(3000, e[1] * 2)) // 少于2倍进行require
                .reduce((all, e) => { all[e[0]] = Math.max(e[1] * 2 - (room.terminal.store[e[0]] || 0), all[e[0]] || 0); return all }, {})
            let rooms = ManagerRooms.getNormalRoom().filter(e => e.my && e.name != room.name && e.terminal && !e.terminal.cooldown)
                .map(e => [e, StrategyFactoryPowerCreep.getPowerFactoryLevel(e) || 0])
                // .filter(e=>e[1]<level) // 只往高处传
                .sort((a, b) => a[1] - b[1])// 按等级从小到大排序
            // .map(e=>e[0])

            // log(room.name,require)
            for (let resType in require) {
                for (let fromRoomLevel of rooms) {
                    let resCnt = require[resType]
                    if (resCnt <= 0) continue;
                    let fromRoom = fromRoomLevel[0]
                    let fromLevel = fromRoomLevel[1]
                    if (fromRoom.terminal._send) continue;
                    let fromCnt = (fromRoom.terminal.store[resType] || 0) + (fromRoom.storage.store[resType] || 0);

                    // FACTORY_RES_MAX_NEED[resType]
                    if (fromCnt && (!fromLevel || Math.max((BALANCE_POWER_FACTORY_MAP[fromLevel][resType] || 0), trade ? (BALANCE_POWER_FACTORY_MAP[6][resType] || 0) : 0) * 2 < fromCnt)) {
                        let amount = Math.min(fromCnt, resCnt, fromRoom.terminal.store[resType])
                        let code = amount > 0 ? fromRoom.terminal.send(resType, amount, room.name) : ERR_NOT_ENOUGH_RESOURCES
                        if (code == OK) {
                            console.log("factory send ", code, fromRoom.name, resType, amount, room.name, resCnt)
                            require[resType] = require[resType] - amount;
                        }
                    }
                }
            }
        }
    },
    powerPriorityProcess(room) {
        if (StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY) > 250000 && StationCarry.roomMassStoreCnt(room, RESOURCE_POWER) <= 6000) {// 能量严重溢出
            let rooms = ManagerRooms.getNormalRoom().filter(e => e.my && e.name != room.name && e.terminal && !e.terminal._send)
                .map(e => [e, StationCarry.roomMassStoreCnt(e, RESOURCE_POWER)])// power 从大到小排序
                .sort((a, b) => b[1] - a[1]).map(e => e[0])
            let targetRoom = rooms.find(e => !e._power_vis && StationCarry.roomMassStoreCnt(e, RESOURCE_ENERGY) < 210000 && e.terminal.store[RESOURCE_POWER] > 1000)
            if (targetRoom) {
                targetRoom._power_vis = true
                targetRoom.terminal.send(RESOURCE_POWER, targetRoom.terminal.store[RESOURCE_POWER], room.name);
                console.log(targetRoom.name + " -> " + room.name + " power " + targetRoom.terminal.store[RESOURCE_POWER])
            }
        }
    },
    balanceWithOtherRoom(room) {
        if ((Game.time + room.hashCode()) % 10 != 0) return;
        pro.processRoom(room);
        pro.powerPriorityProcess(room);
        /**
         * 平衡房间之间的资源的策略
         * 保证 storage + terminal >= RES_BALANCE_ROOM[resType]个以上
         * 当大于 RES_BALANCE_ROOM[resType] * 3 时供给
         * terminal 控制与 RES_BALANCE_ROOM[resType] 一致
         */
        if (!room.terminal.cooldown && !room.terminal._send) {
            // let t = Game.cpu.getUsed()
            let targetRooms = ManagerRooms.getNormalRoom().filter(e => e.my && e.name != room.name && e.terminal)
                .map(e => [e, Game.map.getRoomLinearDistance(e.name, room.name, true)])
                .sort((a, b) => a[1] - b[1]).map(e => e[0])

            let sendAble = {} // 计算哪些可以发送
            for (let resType of _.keys(RES_BALANCE_ROOM)) {
                let StorageCnt = room.storage ? room.storage.store[resType] : 0
                if (room.terminal.store[resType] + StorageCnt > RES_BALANCE_ROOM[resType] * 3
                    && room.terminal.store[resType] >= RES_BALANCE_ROOM[resType]) {
                    sendAble[resType] = RES_BALANCE_ROOM[resType]
                }
            }
            for (let targetRoom of targetRooms) {
                for (let resType in sendAble) {
                    let requireCnt = pro.roomRequireCnt(targetRoom, resType)
                    if (requireCnt) {
                        let amount = Math.min(requireCnt, sendAble[resType])
                        if (RESOURCE_ENERGY == resType) amount = Math.min(requireCnt, Math.floor(sendAble[resType] / 2))
                        let code = room.terminal.send(resType, amount, targetRoom.name);
                        if (code == OK) {
                            pro.resRoomBalanceCache[room.name][resType] = 1;
                            pro.resRoomBalanceCache[targetRoom.name][resType] = 1;
                            pro.roomRequireCal(targetRoom, resType, amount)
                        }
                        //log(room.name,targetRoom.name,amount,resType,code)
                        return;
                        //break;
                    }
                }
            }

            let storageCnt = room.storage && room.storage.store.getFreeCapacity(RESOURCE_ENERGY)
            if (storageCnt < STORAGE_MIN_CAP_CNT) {
                let maxCnt = 0;
                let maxResType = undefined;
                if (room.storage.store[RESOURCE_ENERGY] > room.storage.store.getCapacity(RESOURCE_ENERGY) * 0.3) {
                    maxCnt = room.storage.store[RESOURCE_ENERGY];
                    maxResType = RESOURCE_ENERGY;
                }
                for (let k in room.storage.store) {
                    let resCnt = room.storage.store[k];
                    if (resCnt > maxCnt && room.terminal.store[k] > 100) {
                        if ((!NOT_FULL_SEND_RES_SET.has(k) && resCnt > 3000) || (resCnt > 100000 && k != RESOURCE_ENERGY)) {
                            maxResType = k
                            maxCnt = resCnt
                        }
                    }
                }
                if (maxCnt) {
                    let sends = (targetRoom, mul) => {
                        if (targetRoom.storage && targetRoom.storage.store.getFreeCapacity(RESOURCE_ENERGY) > STORAGE_MIN_CAP_CNT * mul) {
                            let amount = Math.min(room.terminal.store[maxResType], 3000)
                            let code = room.terminal.send(maxResType, amount, targetRoom.name);
                            if (code == OK) console.log("full storage send : " + room.name + " -> " + targetRoom.name + " = ( " + amount + " , " + maxResType + " ) ")
                            if (code == OK) return true;
                        }
                    }
                    if (targetRooms.find(e => sends(e, 10))) return;
                    if (targetRooms.find(e => sends(e, 5))) return;
                    if (targetRooms.find(e => sends(e, 2))) return;
                }
            }

        }
    },
    checkEmptyStorage(room) {
        if (room.storage && room.terminal) {
            let resTypes = room.storage.store.getResTypeList()
            if (resTypes.filter(e => e != RESOURCE_ENERGY).head()) {
                return false;
            }
            if (room.storage.store[RESOURCE_ENERGY] > 10000) return false;
        }
        return true;
    },
    storageEmpty(room) {
        if ((Game.time + room.hashCode()) % 10 != 0) return;
        if (!room.balancingTerminalResource && !pro.checkEmptyStorage(room)) {
            let carrier = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty() && e.ticksToLive > 90).head();
            if (carrier) carrier.addTask([UtilsTask.task(room.storage, "roomStorageEmpty", "registerBalanceTerminalResource")])
        }
    },
    sendEmptyRoom(room, roomName) {
        if (room.terminal && !room.terminal.cooldown) {
            let targetRoom = undefined;
            if (!roomName) {  // 获得最近的可发送房间
                targetRoom = ManagerRooms.getNormalRoom().filter(e => e.my && e.terminal && e.name != room.name)
                    .map(e => [e, Game.map.getRoomLinearDistance(room.name, e.name, true)])
                    .sort((a, b) => a[1] - b[1]).map(a => a[0]).head()
            } else if (roomName == "random") {
                let rooms = ManagerRooms.getNormalRoom().filter(e => e.my && e.name != room.name
                    && e.terminal && e.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 100000);// 必须要有空闲的容量
                if (rooms.length == 0) console.log("you have not enough rooms")
                targetRoom = Utils.randomGet(_.sample(rooms, 1))
            } else {
                targetRoom = Game.rooms[roomName]
                if (!targetRoom || !targetRoom.my) console.log("storageEmpty_" + roomName + " is not yours")
            }
            if (targetRoom) {
                let res = room.terminal.store.getLessResTypesExceptEnergy()
                let resType = res.head();
                if (!resType) resType = RESOURCE_ENERGY
                let energyCnt = room.terminal.store[RESOURCE_ENERGY];
                if (!energyCnt) return;
                let amount = Math.min(energyCnt / 2, room.terminal.store[resType])
                if (roomName == "random") amount = Math.min(amount, 10000)

                let code = room.terminal.send(resType, amount, targetRoom.name)
                console.log("storageEmpty from ", room.name, "to", targetRoom.name, amount, resType, code)
            } else throw new Error("targetRoom not found")
        }
    },
    exec(room) {
        if ((Game.time + room.hashCode()) % 10 != 0) return;
        if (room.find(FIND_FLAGS).find(flag => SPECIAL_ROOM.has(flag.getPrefix()) && flag.getPrefix() != "storageEmpty")) return;
        let flag = room.find(FIND_FLAGS).filter(e => e.getPrefix() == "storageEmpty").head();
        if (flag) {
            let toRoomName = flag.getRoomName()
            pro.storageEmpty(room)
            if (room.terminal && room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 5000) {
                pro.sendEmptyRoom(room, toRoomName);
            }
        }
        else pro.balance(room);
    },
    balance(room) {
        if (!(room.storage && room.storage.my && room.terminal && room.terminal.my)) return;
        // 如果没更新过，或者30t跟新一次
        if (!pro.resRoomBalanceCache[room.name] || (Game.time + room.hashCode()) % 30 == 0) pro.update(room);

        if (!room.balancingTerminalResource && _.keys(pro.resRoomBalanceCache[room.name]).length > 0) {
            let carrier = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty() && e.ticksToLive > 90).head();
            // if(carrier) carrier.say(_.keys(pro.resRoomBalanceCache[room.name]).length)
            if (carrier) carrier.addTask([UtilsTask.task(room.terminal, "balanceTerminalResource", "registerBalanceTerminalResource")])
        }
        pro.balanceWithOtherRoom(room);
        pro.needBalanceWithPowerFactoryRoom(room);
    }
}


global.StrategyResourceBalance = pro;
