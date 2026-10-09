
/**
 * 一处 deposit 挖到「已开采刻度」超过这个值就不再**派新队**（shard3 缺省值）。
 *
 * `lastCooldown` 是**已经挖掉的刻度**：0 = 刚出现，越大越接近耗尽，它单调增长而
 * 剩下的可挖量随之减少。末段的收益/成本比很差 —— 一个矿点要配 1~3 只
 * `harDeposits` + 1 只 `carrierDeposits`，再加单程 pathTime 的跑路，而剩下的
 * 可挖量已经不多；那些爬不如放到新出现的窝上。
 *
 * 用户 10-09 指示「减少采集 deposit、提高效率」，shard3 由 60 降到 **40**
 * （挖到约 2/3 就收手）。
 *
 * **「派新队」和「续派补员」两道闸用同一个数**。原先是「派新队用上限、续派再加
 * `offset = walkableAroundCnt*10-10`（最多 +20）」—— 后者让一个已经挖到上限的窝
 * 还能继续补员到 +20，等于把刚下调的阈值又抬回去（实测：把派新队降到 40 后，
 * 45/56/57 的三个任务照旧在补员）。既然现在的语义是「挖到 N 就收手」，
 * 两道闸就该同源；walkableAroundCnt 只用来定**同时在岗几只**，不再定挖多久。
 */
let MAX_COOL_DOWM_DEFAULT = (() => {
    if (Game.shard.name == "shard3") return 40;
    if (Game.shard.name == "shard2") return 120;
    if (Game.shard.name == "shard1") return 120;
    if (Game.shard.name == "shard0") return 120;
    return 50;
})();
/**
 * 取当前的采集上限。**每次读取时判 Memory**，所以
 * `Memory.marketSettings.depositMaxCooldown` 改完立刻生效，不必重传代码
 * （原写法在模块加载时把常量算死，调参要等下一次 reload）。
 */
let maxCoolDown = () => {
    let knob = Number(Memory.marketSettings && Memory.marketSettings.depositMaxCooldown);
    return knob > 0 ? knob : MAX_COOL_DOWM_DEFAULT;
};
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
            // walkableAroundCnt ≈ 16-24 次 lookFor，按 tick 缓存，避免每 tick 重复计算
            if (!this._walkableCache || this._walkableCache.tick != Game.time || this._walkableCache.id != deposit.id) {
                this._walkableCache = { tick: Game.time, id: deposit.id, value: deposit.pos.walkableAroundCnt(true) };
            }
            if (!this.pos.inRangeTo(deposit, 2) || this._walkableCache.value > 0) // 如果沒得走的時候就放棄，免得消耗太多cpu
                this.goTo(deposit)
        }
        if (deposit && this.pos.isNearTo(deposit) && !this.memory.concated) this.concatDeposit()
    }
};

Creep.prototype.carryDeposit = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) {
        this.goTo(task);
    } else {
        let flag = Game.flags[task.flagName];
        if (!flag) return;//
        flag.memory.harvesters = flag.memory.harvesters || [];
        let deposit = Game.getObjectById(task["id"]);
        if (deposit) {
            flag.memory.lastCooldown = deposit.lastCooldown;
            if (flag.memory.harvesters.length == 0 && deposit && deposit.lastCooldown >= maxCoolDown()) {
                flag.memory.waitTime = (flag.memory.waitTime || 0) + 1
            }
        }
        if (this.ticksToLive < (flag.memory.pathTime || 600) * 1.2 || this.storeFull() || flag.memory.waitTime > 100) {// 回家
            flag.memory.carriers = flag.memory.carriers || []
            // 原写法 `if (!contains(id)) without(id)` 恒为空操作：条件成立时该 id
            // 本来就不在数组里。这里要的是「把自己摘掉」，直接移除即可。
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
        if (needTransferCreep && this.pos.isNearTo(needTransferCreep)) needTransferCreep.transfer(this, needTransferCreep.store.getResTypeList()[0]);
        else if(needTransferCreep)this.moveTo(needTransferCreep)

        if (!needTransferCreep && flag && this.pos.getRangeTo(flag) > 3) {
            this.moveTo(flag);
        }
    }
};

let pro = {

    createOrUpdateDepositMission(targetRoomName, depositData) {//
        if (AVOID_ROOMS.indexOf(targetRoomName) !== -1) return;
        let spawnRoomName = StationObserver.getClosedMyRoomName(targetRoomName);
        if (!spawnRoomName || depositData.lastCooldown > maxCoolDown()) return;
        let flagName = "deposit_" + spawnRoomName + "_" + targetRoomName + "_" + depositData.x + "_" + depositData.y;
        if (!Memory.flags[flagName]) Memory.flags[flagName] = {}
        let flagMemory = Memory.flags[flagName];
        depositData.flagName = flagName;
        depositData.roomName = targetRoomName;
        for (let k in depositData) {
            flagMemory[k] = depositData[k];
        }
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
        ManagerFlags.getFlagsByPrefixAndRoom("deposit", room.name).forEach(flag => {
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
            if (Game.time < flag.memory.disappearTime && flag.memory.lastCooldown < maxCoolDown()
                && (flag.memory.depositType != RESOURCE_MIST || flag.memory.lastCooldown < maxCoolDown())) {// 如果是mist减半，少挖点，没啥用
                if (flag.memory.beAttackTime + ATTACKED_SLEEP > Game.time) return;
                let harTtlCreepCnt = flag.memory.harvesters.map(id => Game.getObjectById(id)).filter(e => e.spawning || e.ticksToLive > (flag.memory.pathTime || 0) + 150).length
                let carrierTtlCreepCnt = flag.memory.carriers.map(id => Game.getObjectById(id)).filter(e => e.spawning || e.ticksToLive > (flag.memory.pathTime || 0) + 300).length
                // spawning creep 不在 flag.memory 数组里，按 headTask.id 补算，
                // 避免 3 tick 生一只导致 deposit 爬超编。
                let harActiveCnt = room.creeps("harDeposits", false).filter(c => {
                    let t = c.headTask && c.headTask();
                    return t && t.id == flag.memory.id;
                }).length;
                let carrierActiveCnt = room.creeps("carrierDeposits", false).filter(c => {
                    let t = c.headTask && c.headTask();
                    return t && t.id == flag.memory.id;
                }).length;
                harTtlCreepCnt = Math.max(harTtlCreepCnt, harActiveCnt);
                carrierTtlCreepCnt = Math.max(carrierTtlCreepCnt, carrierActiveCnt);
                // 已经存在的超编 harDeposits 直接淘汰，保留 TTL 最长的那些。
                if (harActiveCnt > flag.memory.walkableAroundCnt) {
                    let extraHars = room.creeps("harDeposits", false).filter(c => {
                        let t = c.headTask && c.headTask();
                        return t && t.id == flag.memory.id && !c.spawning;
                    }).sort((a, b) => (a.ticksToLive || 0) - (b.ticksToLive || 0));
                    extraHars.slice(0, harActiveCnt - flag.memory.walkableAroundCnt).forEach(c => c.suicide());
                }
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
