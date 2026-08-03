/**
 */

let avoidRoom = ["W35N50", "W34N50", "W33N50", "W33N60", "W32N60", "W31N60", "E44S40"]
let hostileRoom = ['W30N53', "W30N51", "W30N52", "W30N54", "W30N55", 'W36N50', 'W37N50']

let MIN_POWER = 5000 // 少于这个量的不去挖
// A 3,400-tick launch window leaves room for a 300-tick approach, one PB
// attacker/healer cycle and carrier dispatch, while accepting viable banks
// that the previous 4,200-tick gate rejected.
let MIN_DECAY = 3400 // 第一次看到的消失时间少于此值不采集
let ROOM_MAX_POWER_CNT = 300000 // 房间抛瓦大于这么多就不挖了

// 600/tick 伤害 *（150生爬+(2组 +1）) = 450 ，移动时间最高为300 ，750 * 600 = 450000
let CARRY_WAIT_HITS = 450000 // 生命值少于这么多的时候去运输562500


Creep.prototype.registerAttackerPB = function () {
    let headTask = this.headTask();
    let flag = Game.flags[headTask.flagName];
    if (flag) {
        if (this.pos.inRangeTo(flag, 10)) {// 10格以内认为 concated
            this.memory.concated = true
            let pathTime = Math.min(300, 1500 - this.ticksToLive);
            if (flag && (!flag.memory.pathTime || flag.memory.pathTime > pathTime)) {
                flag.memory.pathTime = pathTime
            }
        }

        flag.memory.attacker = flag.memory.attacker || {}
        flag.memory.attacker[this.headTask().index] = this.id
    }
}

Creep.prototype.registerHealerPB = function () {
    let headTask = this.headTask();
    let flag = Game.flags[headTask.flagName];
    if (flag) {

        flag.memory.healer = flag.memory.healer || {}
        flag.memory.healer[this.headTask().index] = this.id
    }
}

Creep.prototype.registerCarrierPB = function () {
    let headTask = this.headTask();
    let flag = Game.flags[headTask.flagName];
    if (flag) {
        flag.memory.carrier = flag.memory.carrier || []
        if (!flag.memory.carrier.contains(this.id)) {
            flag.memory.carrier.push(this.id)
        }
    }
}

Creep.prototype.AttackerPB = function () {
    let task = this.headTask();
    // this.suicide()
    // if(task.roomName!=this.room.name){
    //     this.goTo(task);
    // }else{
    let flag = Game.flags[task.flagName];
    let healer = flag && flag.memory.healer && flag.memory.healer[this.headTask().index]
    healer = Game.getObjectById(healer)
    // this.say(healer&&!this.pos.isCrossRoomNearTo(healer))
    if (flag && !healer && this.room.my) return;
    if (healer && !this.pos.isCrossRoomNearTo(healer)) {
        this.memory.dontPullMe = true;
        if (!this.pos.inRangeTo(healer, 2)) this.moveTo(healer)
        this.attack(this.pos.findClosestByRange(FIND_HOSTILE_CREEPS))
        return;
    }
    if (task.roomName != this.room.name) this.goTo(task);
    let hostileCreeps = this.pos.findInRange(FIND_HOSTILE_CREEPS, 5)
    // let hostileCreeps= []
    if (hostileCreeps.length) {
        let target = hostileCreeps.filter(e => e.body.filter(e => e.type == ATTACK).length).head()
        if (!target) target = hostileCreeps.filter(e => e.body.filter(e => e.type == HEAL).length).head()
        if (!target) target = hostileCreeps.filter(e => e.body.filter(e => e.type == CARRY).length).head()
        if (target) {
            if (target && target.pos.isBorder()) {
                this.memory.lastTargetPos = target.pos
                return this.addTaskAndExec(UtilsTask.taskData("PBAttackBorder"));
            }
            // if not boost attack
            if (!target.body.find(e => e.type=='attack' && e.boost)) this.moveTo(target);
            if (this.hits >= 1000) {
                if (this.attack(target) != OK) this.attack(this.pos.findClosestByRange(FIND_HOSTILE_CREEPS))
            }
            return;
        }
    }
    let powerBank = Game.getObjectById(task["id"]);
    if (powerBank && !this.pos.isNearTo(powerBank)) {
        this.moveTo(powerBank)
    }
    else if (!powerBank && task.roomName == this.room.name) {
        this.suicide();
        return;
    }
    if (this.hits == this.hitsMax) {
        this.attack(powerBank)
        if (!this.memory.isBoostAttack) this.memory.isBoostAttack = this.body.find(e => e.type == ATTACK && e.boost) ? 1 : -1
        if (this.memory.isBoostAttack == 1 && powerBank) this.memory.dontPullMe = true;
        else {
            this.memory.dontPullMe = this.ticksToLive % 3 != 0// 给boost的让路
        }
    }
};

Creep.prototype.PBAttackBorder = function () {
    if (!this.memory.borderAwait)
        this.memory.borderAwait = 3;
    else this.memory.borderAwait -= 1
    if (this.memory.borderAwait) {
        let host = this.pos.findInRange(FIND_HOSTILE_CREEPS, 1).head()
        if (host) {
            this.attack(host)
            this.memory.borderAwait += 1;
        }
    } else {
        this.popTask().execLastTask();
    }
    this.moveTo(new RoomPosition(this.memory.lastTargetPos.x, this.memory.lastTargetPos.y, this.memory.lastTargetPos.roomName), { range: 1 })
}

Creep.prototype.HealerPB = function () {
    let task = this.headTask();

    let hc = this.getActiveBodyparts(RANGED_ATTACK) && this.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (hc && this.pos.isNearTo(hc)) this.rangedMassAttack();
    else if (hc) this.rangedAttack(hc);

    // if(task.roomName!=this.room.name){
    //     this.goTo(task);
    // }else{
    let flag = Game.flags[task.flagName];
    let attacker = flag && flag.memory.attacker && flag.memory.attacker[this.headTask().index]
    if (attacker) this.memory.attacker = attacker
    else attacker = this.memory.attacker
    attacker = Game.getObjectById(attacker)
    if (flag && !attacker && this.room.my) return;
    if (attacker && flag && !attacker.pos.isCrossRoomNearTo(flag)) {
        this.moveTo(attacker)
        if (this.hitsMax != this.hits || this.heal(attacker) != OK) this.heal(this);
        return;
    }
    if (task.roomName != this.room.name) this.goTo(task);

    let healCarrier = () => {
        if (flag && flag.memory.carrier) {
            let needHeal = flag.memory.carrier.map(e => Game.getObjectById(e)).find(e => e && e.hits != e.hitsMax && this.pos.isNearTo(e));
            if (needHeal) this.heal(needHeal);
        }
    }

    let hostileCreeps = this.pos.findInRange(FIND_HOSTILE_CREEPS, 4)
    if (hostileCreeps.length && attacker) {
        let target = hostileCreeps.filter(e => e.body.filter(e => e.type == HEAL).length).head()
        if (!target) target = hostileCreeps.filter(e => e.body.filter(e => e.type == ATTACK).length).head()
        // if (!target) target = hostileCreeps.filter(e => e.body.filter(e => e.type == CARRY).length).head()
        this.heal(attacker);
        if (target) {
            this.moveTo(attacker);
            if (this.hitsMax != this.hits) this.heal(this);
            return;
        }
    }
    else if (attacker) {
        if (!this.pos.isNearTo(attacker)) {
            this.moveTo(attacker);
            this.rangedHeal(attacker);
        }
        else if ((flag && attacker.pos.isNearTo(flag)) || attacker.hits != attacker.hitsMax) this.heal(attacker)

        if (attacker.hits == attacker.hitsMax)//如果攻击的奶是满的优先奶搬运工
            healCarrier()
    } else {// 如果剩下一个奶妈，只能奶搬运工了
        healCarrier()
    }
    if (this.hitsMax != this.hits) this.heal(this);
};

Creep.prototype.carrierPB = function () {
    let task = this.headTask();
    if (task.roomName != this.room.name) this.goTo(task);
    else {
        if (this.storeUsed() > 0) {
            this.popTask()
                .addTask(UtilsTask.taskData("recycleCreep"))
                .addTask(UtilsTask.task(this.mainRoom().storage, "fillAllTask", "registerCarrierPB"))
                .execLastTask();
            return;
        }
        let ruin = this.room.find(FIND_RUINS).filter(e => e.store[RESOURCE_POWER] > 0).head();
        let power = this.room.find(FIND_DROPPED_RESOURCES)
            .filter(e => e.resourceType == RESOURCE_POWER)
            .sort((a, b) => b.amount - a.amount).head();
        if (ruin) {
            this.moveTo(ruin);
            this.withdraw(ruin, RESOURCE_POWER)
        } else if (power) {
            this.moveTo(power);
            this.pickup(power);
        } else {
            let flag = Game.flags[task.flagName];
            if (flag) {
                if (this.hits == this.hitsMax) {
                    //血满的直接走过去
                    let powerBank = Game.getObjectById(flag.memory.id)
                    if (powerBank && !this.pos.inRangeTo(powerBank, 4)) {
                        this.moveTo(powerBank);
                    } else {
                        this.memory.dontPullMe = this.ticksToLive % 4 != 0;
                    }
                } else {
                    // 如果血没满找人帮忙
                    let healer = _.values(flag.memory.healer || {}).map(e => Game.getObjectById(e)).find(e => e);
                    if (healer && !this.pos.isNearTo(healer)) this.moveTo(healer);
                    else this.memory.dontPullMe = this.ticksToLive % 4 != 0;
                }
            }
        }

    }
};

let NO_BOOST = 0
let BOOST_DAMAGE = 1
let BOOST_L1 = 2
let BOOST_L2 = 3

let pro = {
    recordMissionDecision(targetRoomName, powerBankData, decision, spawnRoomName) {
        // A PB is only visible for the Observer tick in which it was scanned.
        // Keep one compact, replace-in-place decision record so `dash` can
        // explain why a visible bank did or did not become a mission without
        // retaining an ever-growing observation history.
        Memory.rooms[targetRoomName] = Memory.rooms[targetRoomName] || {};
        let observerMemory = Memory.rooms[targetRoomName].stationObserver
            = Memory.rooms[targetRoomName].stationObserver || {};
        observerMemory.lastPowerBank = {
            tick: Game.time,
            id: powerBankData.id,
            power: powerBankData.power,
            remaining: Math.max(0, powerBankData.disappearTime - Game.time),
            spawnRoom: spawnRoomName,
            decision: decision,
        };
    },
    hasValidMissionData(flag) {
        let memory = flag && flag.memory;
        return !!(memory
            && typeof memory.id == "string"
            && Number.isFinite(memory.power)
            && memory.power >= MIN_POWER
            && Number.isFinite(memory.disappearTime)
            && memory.disappearTime > Game.time);
    },
    isPBSpawnFlag(flag) {
        let memory = global.SpawnTeam && SpawnTeam.getQueueMemory(flag);
        return !!(memory && Array.isArray(memory.spawnList)
            && memory.spawnList.some(unit => (unit.tasks || []).some(task =>
                task && (task.taskName == "AttackerPB" || task.taskName == "HealerPB"))));
    },
    execSpawnTeams() {
        if (!global.SpawnTeam) return;
        ManagerFlags.getFlagsByPrefix("spawnTeam")
            .filter(pro.isPBSpawnFlag)
            .forEach(flag => SpawnTeam.exec(flag));
    },
    createOrUpdatePowerBankMission(targetRoomName, powerBankData) {
        if (avoidRoom.contains(targetRoomName)) {
            pro.recordMissionDecision(targetRoomName, powerBankData, "skip:avoid-room");
            return;
        }
        let spawnRoomName = StationObserver.getClosedMyRoomName(targetRoomName);
        let spawnRoom = Game.rooms[spawnRoomName];
        if (!spawnRoom) {
            pro.recordMissionDecision(targetRoomName, powerBankData, "skip:no-rcl8-observer", spawnRoomName);
            return;
        }
        if (!spawnRoom.storage) {
            pro.recordMissionDecision(targetRoomName, powerBankData, "skip:no-storage", spawnRoomName);
            return;
        }
        if (spawnRoom.storage.store[RESOURCE_POWER] > ROOM_MAX_POWER_CNT) {
            pro.recordMissionDecision(targetRoomName, powerBankData, "skip:power-stock-cap", spawnRoomName);
            return;
        }
        if (isSaveCpu && powerBankData.power < Math.min((10000 - Game.cpu.bucket), 5000)) {
            pro.recordMissionDecision(targetRoomName, powerBankData, "skip:cpu-power-threshold", spawnRoomName);
            return;
        }
        if (powerBankData.power < MIN_POWER) {
            pro.recordMissionDecision(targetRoomName, powerBankData, "skip:low-power", spawnRoomName);
            return;
        }
        if (powerBankData.disappearTime - Game.time <= MIN_DECAY) {
            pro.recordMissionDecision(targetRoomName, powerBankData, "skip:insufficient-decay", spawnRoomName);
            return;
        }
        let flagName = "powerBank_" + spawnRoomName + "_" + targetRoomName + "_" + powerBankData.x + "_" + powerBankData.y;
        powerBankData.flagName = flagName;
        powerBankData.roomName = targetRoomName;
        // Do not put a newly-created Flag directly into Memory.flags. The
        // generic orphan cleanup runs before the Flag becomes visible on some
        // ticks and would delete its mission data. ManagerFlags promotes this
        // compact pending record once Game.flags exposes the Flag.
        let pending = Memory.pendingPowerBanks = Memory.pendingPowerBanks || {};
        let flagMemory = Game.flags[flagName] && Game.flags[flagName].memory
            || pending[flagName] || (pending[flagName] = {createdAt: Game.time});
        for (let k in powerBankData) {
            flagMemory[k] = powerBankData[k];
        }
        if (!Game.flags[flagName]) {
            let result = (new RoomPosition(powerBankData.x, powerBankData.y, powerBankData.roomName)).createFlag(flagName);
            // Some shard runtimes create the Flag immediately but return
            // undefined instead of its name. Game.flags is authoritative;
            // otherwise leave the pending record intact for the next tick.
            if (typeof result != "string" && !Game.flags[flagName]) {
                pro.recordMissionDecision(targetRoomName, powerBankData, "mission-pending", spawnRoomName);
                return;
            }
        }
        if (Game.flags[flagName]) {
            delete pending[flagName];
            if (!Object.keys(pending).length) delete Memory.pendingPowerBanks;
        }
        pro.recordMissionDecision(targetRoomName, powerBankData, "mission-created", spawnRoomName);
    },
    taskData(flag, index) {
        // Do not copy the Flag Memory proxy into a creep task. Its enumerable
        // fields can be an incomplete cache during the flag creation tick,
        // leaving the new pair without a room, target id, or flag name.
        let memory = flag.memory;
        return {
            flagName: flag.name,
            id: memory.id,
            roomName: memory.roomName,
            x: memory.x,
            y: memory.y,
            index: index
        };
    },
    PBAttackSpawnData(room, memory, boostType) {
        let tasks = [UtilsTask.taskData("AttackerPB", "registerAttackerPB", memory)]
        let body;
        if (boostType == NO_BOOST) {
            body = ManagerCreeps.calcBodyPart([[MOVE, 19], [ATTACK, 20], [MOVE, 1]])
        } else if (boostType == BOOST_DAMAGE) {
            body = ManagerCreeps.calcBodyPart([[TOUGH, 2], [MOVE, 22], [ATTACK, 21], [MOVE, 1]])
            tasks.push(StationLab.generatorBoostResTask({ [BOOST_RES["damage"][1]]: 30 * 2 }, room).head())
        } else if (boostType == BOOST_L1) {
            body = ManagerCreeps.calcBodyPart([[TOUGH, 5], [MOVE, 24], [ATTACK, 20], [MOVE, 1]])
            tasks.push(StationLab.generatorBoostResTask(
                {
                    [BOOST_RES["damage"][1]]: 30 * 5,
                    [BOOST_RES["attack"][1]]: 30 * 20
                }, room).head())
        } else if (boostType == BOOST_L2) {
            body = ManagerCreeps.calcBodyPart([[TOUGH, 5], [MOVE, 24], [ATTACK, 20], [MOVE, 1]])
            tasks.push(StationLab.generatorBoostResTask(
                {
                    [BOOST_RES["damage"][2]]: 30 * 5,
                    [BOOST_RES["attack"][1]]: 30 * 20
                }, room).head())
        }
        return { body: body, tasks: tasks }
        // return StationHive.trySpawn(room,room.name,body,"PBAttack",tasks)
    },
    PBHealSpawnData(room, memory, boostType) {
        let tasks = [UtilsTask.taskData("HealerPB", "registerHealerPB", memory)]
        let body;
        if (boostType == NO_BOOST) {
            body = ManagerCreeps.calcBodyPart({ [MOVE]: 25, [HEAL]: 25 })
        } else if (boostType == BOOST_DAMAGE) {
            body = ManagerCreeps.calcBodyPart({ [MOVE]: 14, [HEAL]: 14 })
        } else if (boostType == BOOST_L1) {
            body = ManagerCreeps.calcBodyPart([[RANGED_ATTACK, 6], [MOVE, 24], [HEAL, 19], [MOVE, 1]])
            tasks.push(StationLab.generatorBoostResTask({ [BOOST_RES["rangedAttack"][0]]: 30 * 6, [BOOST_RES["heal"][0]]: 30 * 19 }, room).head())
        } else if (boostType == BOOST_L2) {
            body = ManagerCreeps.calcBodyPart([ [MOVE, 24], [HEAL, 25], [MOVE, 1]])
            tasks.push(StationLab.generatorBoostResTask({ [BOOST_RES["heal"][1]]: 30 * 25 }, room).head())
        }

        return { body: body, tasks: tasks }
        // return StationHive.trySpawn(room,room.name,body,"PBHeal", tasks)
    },
    trySpawnPBCarrier(room, memory, needCarry) {
        let tasks = [UtilsTask.taskData("carrierPB", "registerCarrierPB", memory)]
        let carryCnt = Math.ceil(needCarry / 50)
        let moveCnt = Math.ceil(carryCnt / 2)
        // let body = ManagerCreeps.calcBodyPart({ [CARRY]:  carryCnt, [MOVE]: moveCnt});
        let body = ManagerCreeps.calcBodyPart([[CARRY, carryCnt - moveCnt], [[[CARRY, 1], [MOVE, 1]], moveCnt]]);
        return StationHive.trySpawn(room, room.name, body, "PBCarrier", tasks)
    },
    spawnPBTeam(room, flag, boostLevel) {
        if (flag.memory.directSpawnQueue) return false;
        flag.memory.directSpawnQueue = {
            createdAt: Game.time,
            spawnList: [
                pro.PBAttackSpawnData(room, pro.taskData(flag, flag.memory.index || 0), boostLevel),
                pro.PBHealSpawnData(room, pro.taskData(flag, flag.memory.index || 0), boostLevel)
            ]
        };
        return true;
    },
    dispatchPBSpawnQueue(room, flag) {
        let queue = flag.memory.directSpawnQueue;
        if (!queue) return false;
        if (Game.time - queue.createdAt > 2000 || !queue.spawnList.length) {
            delete flag.memory.directSpawnQueue;
            return false;
        }
        // Spawn both halves in the same tick when the room has two idle
        // spawns. With only one spawn, retry on the very next tick instead of
        // waiting for the three-tick PB strategy cadence.
        while (queue.spawnList.length) {
            let head = queue.spawnList[0];
            if (!StationHive.trySpawn(room, room.name, head.body, "PBer", head.tasks)) break;
            queue.spawnList.shift();
        }
        if (!queue.spawnList.length) delete flag.memory.directSpawnQueue;
        return true;
    },
    cleanFlag() {
        if (Game._powerBankCleanFlag) return;
        Game._powerBankCleanFlag = true
        ManagerFlags.getFlagsByPrefix("powerBank").forEach(flag => {
            let roomName = flag.getRoomName();
            if (!roomName || !Game.rooms[roomName] || !Game.rooms[roomName].my) {
                flag.remove()
            }
        })
    },
    exec(room) {
        pro.cleanFlag();
        // Observer data can disappear while a mission flag remains in Memory.
        // Validate it before creating a spawn queue: otherwise an empty legacy
        // record can produce an attacker with no PB target.
        let powerBankFlags = ManagerFlags.getFlagsByPrefixAndRoom("powerBank", room.name)
            .filter(flag => {
                if (pro.hasValidMissionData(flag)) return true;
                flag.remove();
                return false;
            });
        let activeQueues = {};
        powerBankFlags.forEach(flag => activeQueues[flag.name] = pro.dispatchPBSpawnQueue(room, flag));
        if ((Game.time + room.hashCode()) % 3 != 0) return;
        powerBankFlags.forEach(flag => {
            let queueActive = activeQueues[flag.name];
            // HelperVisual.mapShowText(flag,flag.name)
            // flag.memory.lastSpawnTime = 0
            // flag.memory.index = 0
            // log(flag.name)
            // if(room.name!="W7N9")return;

            let respawnTime = 1500 - (50 + (flag.memory.pathTime || 0)) // 死掉 + spawn的时间+走路时间
            let needSpawn = (flag.memory.lastSpawnTime || 0) + respawnTime < Game.time
            if (queueActive) needSpawn = false;
            // if (flag.pos.roomName == "W30N57" && Game.time % 10 == 0) needSpawn = true;

            // if (Game.rooms[flag.pos.roomName] && flag.pos.findInRange(FIND_HOSTILE_CREEPS, 8).filter(e => e.body.find(b => b.type == ATTACK)).length) {
            //     if (!flag.memory.beingAttack) flag.memory.lastSpawnTime = 0
            //     flag.memory.beingAttack = true // 可能已经被打了,这时候出t2
            // }

            flag.memory.index = flag.memory.index || 0
            if (flag.memory.beingAttack) needSpawn = true; // 如果是t2 出1队，否则出3队
            if ((flag.memory.boostModel != BOOST_L1 && (flag.memory.index > 3)) || (flag.memory.boostModel == BOOST_L1 && flag.memory.L1Boosted) || (flag.memory.boostModel == BOOST_L2 && flag.memory.L2Boosted))
                needSpawn = false;// 如果超过上限就不生了

            // log(flag.name,needSpawn,(flag.memory.lastSpawnTime||0)+respawnTime-Game.time,flag.memory.beingAttack ,flag.memory.beingAttack&&flag.memory.boostModel != BOOST_L1)
            if (StationHive.spawnAble(room) && needSpawn) {
                let boostLevel = NO_BOOST
                // if(flag.memory.beingAttack){
                if (StationLab.boostAbleLevel(room, "damage", 3, 1, 1) == 1) boostLevel = BOOST_DAMAGE
                if ((isSaveCpu || flag.memory.beingAttack) && StationLab.boostAble(room,
                    { [BOOST_RES["damage"][1]]: 30 * 5, [BOOST_RES["attack"][1]]: 30 * 20, [BOOST_RES["heal"][0]]: 30 * 19, [BOOST_RES["rangedAttack"][0]]: 30 * 6 }) && !hostileRoom.contains(flag.memory.roomName)
                ) boostLevel = BOOST_L1
                else if ((isSaveCpu || flag.memory.beingAttack) && StationLab.boostAble(room,
                    { [BOOST_RES["damage"][2]]: 30 * 5, [BOOST_RES["attack"][1]]: 30 * 20, [BOOST_RES["heal"][1]]: 30 * 25 }) && hostileRoom.contains(flag.memory.roomName)
                ) boostLevel = BOOST_L2
                if (flag.memory.beingAttack && boostLevel != BOOST_L1 && boostLevel != BOOST_L2) return flag.remove();// 被打了，并且出不了t2就直接不出兵了
                if (boostLevel == BOOST_L1) flag.memory.L1Boosted = true;
                if (boostLevel == BOOST_L2) flag.memory.L2Boosted = true;
                if (!pro.spawnPBTeam(room, flag, boostLevel)) return;
                pro.dispatchPBSpawnQueue(room, flag);
                flag.memory.boostModel = Math.max(boostLevel, flag.memory.boostModel || NO_BOOST)
                flag.memory.index += 1
                flag.memory.lastSpawnTime = Game.time
                // }
                // log(flag.name,needSpawnAttack,needSpawnHeal)
            }
            let powerBank = Game.getObjectById(flag.memory.id);
            if (Game.rooms[flag.pos.roomName]) {
                if (!powerBank) {
                    flag.remove();
                    return;
                }
            } else if (flag.memory.disappearTime < Game.time) {
                flag.remove();
                return;
            }

            if (!flag.memory.needCarry) {
                flag.memory.needCarry = powerBank && powerBank.hits < (CARRY_WAIT_HITS * (BOOST_L1 == flag.memory.boostModel ? 3 : 1))
                flag.memory.carrierCnt = flag.memory.carrierCnt || 0
            }

            if (flag.memory.needCarry && _.values(flag.memory.attacker || {}).map(id => Game.getObjectById(id)).find(e => e)) {
                // log(flag.memory.carrierCnt)
                let carrierCnt = Math.ceil(flag.memory.power / 1650)
                let needCarry = flag.memory.power / carrierCnt
                // let needCarry =1650
                if (flag.memory.carrierCnt < carrierCnt) {
                    if (pro.trySpawnPBCarrier(room, flag.memory, needCarry))
                        flag.memory.carrierCnt++
                }
            }

        })
    },
}


global.StrategyPowerBank = pro;
