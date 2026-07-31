
let MAX_COOL_DOWM = (() => {
    if (Game.shard.name == "shard3") return 60;
    if (Game.shard.name == "shard2") return 120;
    if (Game.shard.name == "shard1") return 120;
    if (Game.shard.name == "shard0") return 120;
    return 50;
})();
let BOOST_COOL_DOWN = 90
let ATTACKED_SLEEP = 1200
let AVOID_ROOMS = ["W30N51", "W30N50", "W34N50", "E44S40"]
let ATTACK_ROOMS = ['E50S31', 'E50S30', 'E50S29', 'E50S28', 'E50S27']


Creep.prototype.registerHarvestDepositCarrier = function () {
    let headTask = this.headTask();
    let flag = Game.flags[headTask.flagName];
    if (flag) {
        flag.memory.carriers = flag.memory.carriers || []
        if (!flag.memory.carriers.contains(this.id)) {
            flag.memory.carriers.push(this.id)
        }
    }
};


Creep.prototype.harvestDeposit = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let deposit = Game.getObjectById(task["id"]);
        if (this.freeCapacity() < this.getPartCnt(WORK)) {
        }
        else if (deposit && this.harvest(deposit) == ERR_NOT_IN_RANGE) {
            this.goTo(deposit)
        }
        if (deposit && !this.memory.concated && this.pos.inRangeTo(deposit, 3)) this.concatDeposit()
    }
};

Creep.prototype.registerHarvestDeposit = function () {
    let headTask = this.headTask();
    let flag = Game.flags[headTask.flagName];
    if (flag) {
        flag.memory.harvesters = flag.memory.harvesters || []
        if (!flag.memory.harvesters.contains(this.id)) {
            flag.memory.harvesters.push(this.id)
        }
    }
    if (this.ticksToLive < 50 && this.ticksToLive % 3 == 0) {
        this.memory.dontPullMe = false;
    }
};

Creep.prototype.concatDeposit = function () {
    let headTask = this.headTask();
    this.memory.concated = true
    let flag = Game.flags[headTask.flagName];
    let pathTime = Math.min(300, 1470 - this.ticksToLive); // 预留30tick;
    if (flag && (!flag.memory.pathTime || flag.memory.pathTime > pathTime)) {
        flag.memory.pathTime = pathTime
    }
};

Creep.prototype.harvestDeposit = function () {
    let task = this.headTask();
    if (this.hits < this.hitsMax - 1000 && this.lastTask().flagName) {
        let flag = Game.flags[this.lastTask().flagName];
        if (flag && !this.memory.attacked) {
            flag.memory.beAttackTime = Game.time
            this.memory.attacked = true
        }
    }
    // this.suicide()
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let deposit = Game.getObjectById(task["id"]);
        if (this.freeCapacity() < this.getPartCnt(WORK)) {

        }
        else if (deposit && this.harvest(deposit) == ERR_NOT_IN_RANGE) {
            if (!this.pos.inRangeTo(deposit, 2) || deposit.pos.walkableAroundCnt(true) > 0) // 如果沒得走的時候就放棄，免得消耗太多cpu
                this.goTo(deposit)
        }
        if (deposit && this.pos.isNearTo(deposit) && !this.memory.concated) this.concatDeposit()
        // add by an_w
        flag1 = Game.flags[this.lastTask().flagName];
        if (((Game.time % 50 == 0 && this.pos.findInRange(FIND_HOSTILE_CREEPS, 8).length && !this.pos.isNearTo(deposit)) || this.hits < this.hitsMax) && (!flag1.memory.beAttackTime || Game.time > flag1.memory.beAttackTime + 1700)) {
            const em = this.pos.findInRange(FIND_HOSTILE_CREEPS, 8).filter(e => e.getActiveBodyparts(RANGED_ATTACK) > 0)
            if (em.length) {
                this.room.createFlag(this.pos, "raL3_" + this.memory.roomName, COLOR_RED)
            }
            // create attack flag if no attack flag in this room
            else {
                this.room.createFlag(this.pos, "raL4_"+this.memory.roomName, COLOR_RED)
            }
            flag1.memory.beAttackTime = Game.time
        }
        if ((flag1.memory.beAttackTime && Game.time >= flag1.memory.beAttackTime + 1650) || !flag1.memory.beAttackTime) {
            if (Game.flags["raL4_"+this.memory.roomName]) Game.flags["raL4_"+this.memory.roomName].remove()
            if (Game.flags["raL3_"+this.memory.roomName]) Game.flags["raL3_"+this.memory.roomName].remove()
        }
        
    }
};

Creep.prototype.carryDeposit = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let flag = Game.flags[task.flagName];
        if (!flag) return;//
        let deposit = Game.getObjectById(task["id"]);
        if (deposit) {
            flag.memory.lastCooldown = deposit.lastCooldown;
            if (flag.memory.harvesters.length == 0 && deposit && deposit.lastCooldown >= MAX_COOL_DOWM) {
                flag.memory.waitTime = (flag.memory.waitTime || 0) + 1
            }
        }
        if (this.ticksToLive < (flag.memory.pathTime || 600) * 1.2 || this.storeFull() || flag.memory.waitTime > 100) {// 回家
            flag.memory.carriers = flag.memory.carriers || []
            if (!flag.memory.carriers.contains(this.id))
                flag.memory.carriers = flag.memory.carriers.without(this.id)
            this.popTask();
            this.addTask([UtilsTask.taskData("recycleCreep")])
            this.fillAllMainRoomStorage();
            this.execLastTask();
        }

        if (this.ticksToLive % 20 == 0) {
            let tombstone = this.pos.findClosestByPath(FIND_TOMBSTONES, { filter: e => e.store.getResTypeList().length && e.store.getUsedCapacity('energy') < e.store.getUsedCapacity(), range: 3 });
            this.carryAll(tombstone)
        }

        if (this.ticksToLive % 20 == 10) {
            let dropRes = this.pos.findClosestByPath(FIND_DROPPED_RESOURCES);
            if (dropRes) {
                this.addTask(UtilsTask.task(dropRes, "pickupRes", undefined, {
                    resType: dropRes.resourceType
                }))
                return;
            }
        }

        let needTransferCreep = flag.memory.harvesters.map(id => Game.getObjectById(id)).filter(e => e && e.storeUsed() >= 20).head();
        if (this.pos.isNearTo(needTransferCreep)) needTransferCreep.transfer(this, needTransferCreep.store.getResTypeList()[0]);
        else this.moveTo(needTransferCreep)

        if (!needTransferCreep && flag && this.pos.getRangeTo(flag) > 3) {
            this.moveTo(flag);
        }
    }
};

let pro = {

    createOrUpdateDepositMission(targetRoomName, depositData) {//
        if (AVOID_ROOMS.indexOf(targetRoomName) !== -1) return;
        // if (ATTACK_ROOMS.indexOf(targetRoomName) !== -1) {
        //     if (depositData.lastCooldown < 10 && !Game.flags['raL2_E49S31_keeper']) {
        //         (new RoomPosition(25, 24, targetRoomName)).createFlag('raL3_E49S31_1', COLOR_BLUE);
        //         (new RoomPosition(25, 6, 'E50S27')).createFlag('raL2_E49S31_keeper', COLOR_BLUE);
        //     }
        //     else if (depositData.lastCooldown > 67 && depositData.lastCooldown < 70) {
        //         console.log(depositData.lastCooldown)
        //         if (Game.flags['raL2_E49S31_keeper']) {
        //             Game.flags['raL2_E49S31_keeper'].remove()
        //         }
        //         if (Game.flags['raL3_E49S31_1']) Game.flags['raL3_E49S31_1'].remove()
        //     }
        // }
        let spawnRoomName = StationObserver.getClosedMyRoomName(targetRoomName);
        let flagName = "deposit_" + spawnRoomName + "_" + targetRoomName + "_" + depositData.x + "_" + depositData.y;
        if (!Memory.flags[flagName]) Memory.flags[flagName] = {}
        let flagMemory = Memory.flags[flagName];
        depositData.flagName = flagName;
        depositData.roomName = targetRoomName;
        for (let k in depositData) {
            flagMemory[k] = depositData[k];
        }
        if (!spawnRoomName || depositData.lastCooldown > MAX_COOL_DOWM) return;
        if (!Game.flags[flagName]) {
            (new RoomPosition(depositData.x, depositData.y, targetRoomName)).createFlag(flagName)
        }
    },
    trySpawnHarDeposits(room, memory, needBoost) {
        let body = ManagerCreeps.calcBodyPart({ [WORK]: 22, [CARRY]: 6, [MOVE]: 22 })
        let boostRes = { [BOOST_RES["harvest"][1]]: 30 * 22, [BOOST_RES["capacity"][1]]: 30 * 6 };
        let tasks = [UtilsTask.taskData("harvestDeposit", "registerHarvestDeposit", memory)]
        if (needBoost && StationLab.boostAble(room, boostRes)) {
            tasks.push(StationLab.generatorBoostResTask(boostRes, room).head())
        }
        StationHive.trySpawn(room, room.name, body, "harDeposits", tasks)
    },
    trySpawnCarryDeposits(room, memory, needBoost) {
        let body = []
        for (let i = 0; i < 25; i++)
            body.push(CARRY, MOVE)
        let tasks = [UtilsTask.taskData("carryDeposit", "registerHarvestDepositCarrier", memory)]
        let boostRes = { [BOOST_RES["capacity"][1]]: 30 * 25 };
        if (needBoost && StationLab.boostAble(room, boostRes)) {
            tasks.push(StationLab.generatorBoostResTask(boostRes, room).head())
        }
        StationHive.trySpawn(room, room.name, body, "carrierDeposits", tasks)
    },
    cleanFlag() {
        if (Game._depositCleanFlag) return;
        Game._depositCleanFlag = true
        ManagerFlags.getFlagsByPrefix("deposit").forEach(flag => {
            let roomName = flag.getRoomName();
            if (!roomName || !Game.rooms[roomName] || !Game.rooms[roomName].my) {
                flag.remove()
            }
        })
    },
    exec(room) {
        pro.cleanFlag();
        if ((Game.time + room.hashCode()) % 3 != 0) return;
        room.flags("deposit").forEach(flag => {
            flag.memory.flagName = flag.name
            if (!flag.memory.harvesters) flag.memory.harvesters = []
            else flag.memory.harvesters = flag.memory.harvesters.filter(id => Game.getObjectById(id))
            if (!flag.memory.carriers) flag.memory.carriers = []
            else flag.memory.carriers = flag.memory.carriers.filter(id => {
                let creep = Game.getObjectById(id)
                if (creep) return creep.headTask() && creep.headTask().taskName == "carryDeposit"
                return false
            });
            if (!flag.memory.walkableAroundCnt) {
                flag.memory.walkableAroundCnt = Math.min(flag.pos.walkableAroundCnt(), 3)
            }
            let offset = Math.min(flag.memory.walkableAroundCnt, 3) * 10 - 10
            if (Game.time < flag.memory.disappearTime && flag.memory.lastCooldown < MAX_COOL_DOWM + offset
                && (flag.memory.depositType != RESOURCE_MIST || flag.memory.lastCooldown < MAX_COOL_DOWM)) {// 如果是mist减半，少挖点，没啥用
                if (flag.memory.beAttackTime + ATTACKED_SLEEP > Game.time) return;
                let harTtlCreepCnt = flag.memory.harvesters.map(id => Game.getObjectById(id)).filter(e => e.spawning || e.ticksToLive > (flag.memory.pathTime || 0) + 150).length
                let carrierTtlCreepCnt = flag.memory.carriers.map(id => Game.getObjectById(id)).filter(e => e.spawning || e.ticksToLive > (flag.memory.pathTime || 0) + 300).length
                if (harTtlCreepCnt < flag.memory.walkableAroundCnt && (carrierTtlCreepCnt || harTtlCreepCnt < 2)) {
                    let needBoost = flag.memory.lastCooldown > BOOST_COOL_DOWN // 超过一定值后才boost，避免浪费资源
                        && !flag.memory.harvesters.map(id => Game.getObjectById(id)).find(e => e.memory.isBoost && (e.spawning || e.ticksToLive > (flag.memory.pathTime || 0) + 150))
                    pro.trySpawnHarDeposits(room, flag.memory, needBoost);
                    return;
                }
                if (carrierTtlCreepCnt < 1) {
                    // let needBoost = (flag.memory.lastCooldown<30 && flag.memory.walkableAroundCnt>=2) || (flag.memory.lastCooldown<50 && flag.memory.walkableAroundCnt>=3) || flag.memory.lastCooldown<10
                    // needBoost = needBoost&&!flag.memory.harvesters.map(id=>Game.getObjectById(id)).filter(e=>e.memory.isBoost).filter(e=>e.spawning||e.ticksToLive>(flag.memory.pathTime||0)+150).head()
                    let needBoost = false
                    pro.trySpawnCarryDeposits(room, flag.memory, needBoost);
                    return;
                }
            } else if (flag.memory.harvesters.length == 0 && flag.memory.carriers.length == 0) {
                flag.remove();
            } else if (flag.memory.harvesters.length != 0 && flag.memory.carriers.length == 0) {
                pro.trySpawnCarryDeposits(room, flag.memory);// 如果还有挖矿继续派兵
            }
            // HelperVisual.mapShowText(flag,flag.name)
        })
    }

}


global.StrategyDeposits = pro;
