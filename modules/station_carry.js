
global.STORE_IN = 0;
global.STORE_CACHE = 1;
global.STORE_OUT = 2;//只存储能量


Creep.prototype.registerStationCarryDrop = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.dropUsed = room.dropUsed || {}
    let id = this.headTask().id;
    room.dropUsed[id] = true
};


let pro = {
    stationName: "stationCarry",
    isRoomMassStore(room, obj) {
        if (room.storage && room.storage.id == obj.id) return true
        if (room.terminal && room.terminal.id == obj.id) return true
        // if(room.factory&&room.factory.id==obj.id) return true
        return false;
    },
    roomMassStoreCnt(room, resType) {
        let cnt = 0;
        if (room.storage) cnt += room.storage.store.getUsedCapacity(resType);
        if (room.terminal) cnt += room.terminal.store.getUsedCapacity(resType);
        // if(room.factory) cnt += room.factory.store.getUsedCapacity(resType);
        return cnt;
    },
    generatorMassStoreCarry(room, resType, resCount, regFun) {
        let tasks = []
        for (let target of [room.storage, room.terminal]) {//,room.factory
            if (!target) continue;
            let currentCnt = Math.min(target.store[resType] || 0, resCount);
            resCount -= currentCnt
            if (currentCnt) tasks.push(UtilsTask.task(target, "carryRes", regFun, { resType: resType, resCount: currentCnt }))
            if (resCount < 0) break;
        }
        return tasks;
    },
    getCarrierBodyConfig(room) {
        let totalEnergy = room.getEnergyCapacityAvailable(room);
        let body = [CARRY, CARRY, MOVE];
        let bodyEnergy = Utils.getBodyEnergyNeed(body)
        let num = 0
        // 仅当 keeper 和 carrier 都缺失（房间挨饿/bootstrap 阶段）时，按实际可用能量
        // 定身体并保证最小 300 能量；正常运行用完整的按容量配置
        let starving = room.creeps("harvestEnergyKeeper", false).length == 0
            && room.creeps("carrier", false).length == 0;
        let budget = starving ? Math.max(300, Math.min(totalEnergy, room.energyAvailable)) : totalEnergy;
        for (let i = 1; i * bodyEnergy <= budget; i++) {
            if (num >= 17) break;
            num += 1
        }
        if (starving) num = Math.max(2, num); // 最小 2 组 = 300 能量
        return ManagerCreeps.calcBodyPart({ [CARRY]: num < 17 ? num * 2 : num * 2 - 1, [MOVE]: num });//
    },
    generatorCarryStorageEnergyTask(room, energyCnt = 6600) {
        if (room.storage && room.storage.store[RESOURCE_ENERGY] > 2000) {
            return [UtilsTask.task(room.storage, "carryRes", undefined, {
                resType: RESOURCE_ENERGY, resCount: energyCnt
            })]
        }
        let resCnt = pro.roomMassStoreCnt(room, RESOURCE_ENERGY);
        if (resCnt > Math.max(energyCnt, 2000)) {
            return pro.generatorMassStoreCarry(room, RESOURCE_ENERGY, Math.min(energyCnt, resCnt))
        }
        return []
    },
    generatorPickTask(room, onlyEnergy = false) { // 可能有bug\
        // 拿全部的
        room.dropUsed = room.dropUsed || {}
        let tasks = room.find(FIND_TOMBSTONES).concat(room.find(FIND_RUINS))
            .filter(e => !room.dropUsed[e.id])
            .map(drops => {
                if (drops.store.getUsedCapacity(onlyEnergy ? RESOURCE_ENERGY : undefined)) {
                    if (onlyEnergy)
                        return [UtilsTask.task(drops, "carryRes", "registerStationCarryDrop", {
                            resType: RESOURCE_ENERGY
                        })]
                    else
                        return _.keys(drops.store).map(e =>
                            UtilsTask.task(drops, "carryRes", "registerStationCarryDrop", {
                                resType: e
                            })
                        )
                }
                return null
            }).filter(e => e);
        return room.find(FIND_DROPPED_RESOURCES)
            .filter(e => !room.dropUsed[e.id])
            .filter(e => (e.resourceType != RESOURCE_ENERGY || e.amount > 100) && (onlyEnergy ? e.resourceType == RESOURCE_ENERGY : true)).map(dropRes => {
                return [UtilsTask.task(dropRes, "pickupRes", "registerStationCarryDrop", {
                    resType: dropRes.resourceType
                })]
            }).concat(tasks);
        // return
    },
    transformLink(room) {
        if (!room.memory[StationUpgrade.stationName] || !room.memory[pro.stationName]) return;
        let upgradeLink = Game.getObjectById(room.memory[StationUpgrade.stationName][STRUCTURE_LINK])
        let centerLink = Game.getObjectById(room.memory[pro.stationName][STRUCTURE_LINK])

        _.values(room.memory[StationSources.stationName]).forEach(e => {
            let link = Game.getObjectById(e["link"]);
            let link2 = Game.getObjectById(e["link2"]);
            let minFreeSend = 100
            if (link && link2) {
                if (link.store.getFreeCapacity(RESOURCE_ENERGY) > minFreeSend || link.cooldown)
                    link = link2
            }
            let container = Game.getObjectById(e[STRUCTURE_CONTAINER]);
            if (!link) return;
            let sendAble = link.store.getFreeCapacity(RESOURCE_ENERGY) <= minFreeSend
            if (!sendAble) return;
            if (upgradeLink && sendAble && upgradeLink.store.isEmpty()) {
                link.transferEnergy(upgradeLink);
                upgradeLink = null
                return;
            }

            if (centerLink && sendAble && centerLink.store.isEmpty()) {
                if (container && container.store[RESOURCE_ENERGY] > ((link && link2 && (link.store.isFull() && link2.store.isFull())) ? 0 : 800)) {
                    link.transferEnergy(centerLink);
                    centerLink = null
                }
            }
        })

        if (upgradeLink && upgradeLink.store.isEmpty() && centerLink && !centerLink.store.isEmpty()) {
            centerLink.transferEnergy(upgradeLink);
        }
        // room.
    },
    update(room) {
        if (!room.my) return delete room.memory[pro.stationName];
        let objs = room.memory[pro.stationName] || {};
        let centerLink = null;
        if (room.storage) room.link.forEach(e => {
            if (e.pos.isNearTo(room.storage)) {
                centerLink = e
            }
        })

        if (centerLink) {
            objs[STRUCTURE_LINK] = centerLink.id
        }

        room.memory[pro.stationName] = objs;
    },
    generatorFillNukerTask(room) {
        room.used = room.used || {};
        if (room.storage && room.nuker && !room.used[room.nuker.id]) {
            let gNeed = room.nuker.store.getFreeCapacity(RESOURCE_GHODIUM);
            if (gNeed > 0 && room.storage.store[RESOURCE_GHODIUM] >= 1650) {
                let ops = { resType: RESOURCE_GHODIUM, resCount: gNeed }
                return [UtilsTask.task(room.nuker, "fillRes", "registerUsed", ops),
                UtilsTask.task(room.storage, "carryRes", "registerUsed", ops)]
            }
            let enNeed = room.nuker.store.getFreeCapacity(RESOURCE_ENERGY);
            if (enNeed) {
                let nukerRatio = ((room.nuker.cooldown || 0) - 3000) / NUKER_COOLDOWN;
                let enTotal = room.nuker.store.getCapacity(RESOURCE_ENERGY);
                if (room.storage.store[RESOURCE_ENERGY] > 50000 && nukerRatio < (enNeed / enTotal)) {
                    let ops = { resType: RESOURCE_ENERGY, resCount: enNeed }
                    return [UtilsTask.task(room.nuker, "fillRes", "registerUsed", ops),
                    UtilsTask.task(room.storage, "carryRes", "registerUsed", ops)]
                }
            }
        }
        return [];
    },
    /**
     * change by an_w
     * @param {Room} room
     * @param {string} ResType
     * @param {number} resCount
     */
    generatorFillTerminalTask(room) {
        // get type and amount from flag
        room.used = room.used || {};
        let ResType = "OH"
        let resCount = 50000
        if (room.storage && room.terminal && !room.used[room.terminal.id] && room.terminal.store.getUsedCapacity(ResType) < resCount) {
            let need = room.terminal.store.getFreeCapacity(ResType);
            if (need > 0 && room.storage.store[ResType] >= resCount) {
                let ops = { resType: ResType, resCount: resCount }
                return [UtilsTask.task(room.terminal, "fillRes", "registerUsed", ops),
                UtilsTask.task(room.storage, "carryRes", "registerUsed", ops)]
            }
        }
        return [];
    },
    /**
     *
     * @param room
     * @param continuous 是不是持续工作的
     * @return {[]}
     */
    generatorFillPowerSpawnTask(room, continuous = false) {
        room.used = room.used || {};
        let tasks = []
        let energyCnt = pro.roomMassStoreCnt(room, RESOURCE_ENERGY);
        let powerCnt = pro.roomMassStoreCnt(room, RESOURCE_POWER);
        if (room.level >= 8 && room.storage && room.terminal && room.powerSpawn && (!room.used[room.powerSpawn.id] || continuous)
            && (energyCnt > 170000 && powerCnt > 1000 || energyCnt > 100000 && powerCnt > 6000
                || energyCnt > 100000 && powerCnt > 100 && room.powerSpawn.effects && room.powerSpawn.effects.length)) {
            let powerNeed = room.powerSpawn.store.getFreeCapacity(RESOURCE_POWER);

            let s = room.powerSpawn;
            let fastCarry = 70;
            if (s.effects && s.effects.length) {
                fastCarry -= (s.effects.head().level - 1) * 10
            }
            let enNeed = room.powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);

            if (StationCarry.roomMassStoreCnt(room, RESOURCE_POWER) > powerNeed && powerNeed >= fastCarry || enNeed > 1650) {
                if (powerNeed > fastCarry) tasks.unshift(StationCarry.generatorMassStoreCarry(room, RESOURCE_POWER, powerNeed))
                if (enNeed > 800) tasks.unshift(StationCarry.generatorMassStoreCarry(room, RESOURCE_ENERGY, enNeed, "registerUsed"))
                tasks.unshift(UtilsTask.task(room.powerSpawn, "fillAllTask", "registerUsed"))
            }
        }
        return tasks;
    },
};



global.StationCarry = pro;
