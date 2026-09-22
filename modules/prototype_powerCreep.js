/**
 * 挂载 creep 的方法全部到 powerCreep上
 * 使用这部分代码依赖于 prototype_creep.js
 */
_.keys(Creep.prototype).forEach(key => {
    try {
        if (!PowerCreep.prototype[key])
            PowerCreep.prototype[key] = Creep.prototype[key]
    } catch (e) { // 如果是 代理模式的 会抛异常 这里进行捕获
        // log(key)
    }
})


PowerCreep.prototype.spawnPowerCreep = function (powerSpawn, role, roomName) {
    this.memory = { role: role, roomName: roomName, tasks: [] }
    return this.spawn(powerSpawn)
};


PowerCreep.prototype.needRenewInRoom = function () { // 少于多少开始 renew
    return this.ticksToLive < 1000;
}

PowerCreep.prototype.addRenewMainRoomTask = function () {
    this.addTask([UtilsTask.taskData("renewMainRoom")])
}

PowerCreep.prototype.renewMainRoom = function () {
    let room = this.mainRoom()
    if (room && room.my && room.powerSpawn) {
        if (!this.pos.isNearTo(room.powerSpawn)) {
            this.moveTo(room.powerSpawn)
        } else {
            if (OK == this.renew(room.powerSpawn)) {
                this.popTask().execLastTask();
            }
        }
    }
}


let OPS_MAX_CARRY_CNT = 1900
let OPS_MIN_CARRY_CNT = 200


let OP_SOURCE_WAIT_TIME = 50
PowerCreep.prototype.needOpSource = function () {
    let pcPower = this.powers[PWR_REGEN_SOURCE]//
    if (pcPower && pcPower.cooldown < OP_SOURCE_WAIT_TIME) {
        let source = this.mainRoom().source;
        for (let s of source) {
            let pathTime = StationSources.sourcePathTime(this.mainRoom(), s);
            if (!s.effects || !s.effects.length || s.effects.head().ticksRemaining < pathTime + 5) {
                return s
            }
        }
    }
    return false;
}

PowerCreep.prototype.needOpStorage = function (storage) {
    let pcPower = this.powers[PWR_OPERATE_STORAGE]//
    if (!storage) return false;
    let effect = storage.effects && storage.effects.find(e => e.power == PWR_OPERATE_STORAGE);
    let shouldOperate = pcPower && !pcPower.cooldown && pcPower.level >= 1 &&
        storage.store.getUsedCapacity() > 950000 &&
        (!effect || effect.ticksRemaining < 100);
    return shouldOperate ? storage : false;
}

PowerCreep.prototype.OpStorage = function () {
    let pcPower = this.powers[PWR_OPERATE_STORAGE];
    let storage = this.lastTaskObj();
    if (!pcPower || pcPower.cooldown > 0 || !storage) {
        this.popTask().execLastTask();
        return;
    }
    if (!this.pos.inRangeTo(storage, 3)) {
        this.moveTo(storage, { range: 3 });
        return;
    }
    let code = this.usePower(PWR_OPERATE_STORAGE, storage);
    if (code == OK || code == ERR_INVALID_ARGS || code == ERR_NOT_ENOUGH_RESOURCES) {
        this.popTask().execLastTask();
    }
}

PowerCreep.prototype.OpSource = function () {
    let pcPower = this.powers[PWR_REGEN_SOURCE];
    let source = this.lastTaskObj();
    if (pcPower.cooldown > OP_SOURCE_WAIT_TIME || !source) {
        this.popTask().execLastTask();
    }
    if (!this.pos.inRangeTo(source, 3)) {
        this.moveTo(source, { range: 3 });
    }
    if (pcPower.cooldown) return;
    let code = this.usePower(PWR_REGEN_SOURCE, source);
    if (code == OK) {
        StationSources.powerSource(this.room, source, pcPower.level);// 标记被用power ，使得爬的体积变大
        let mainRoom = this.mainRoom();
        let obj = mainRoom.storage || mainRoom.terminal || mainRoom.powerSpawn
        if (obj) this.popTask().addTask(UtilsTask.task(obj, "goToNearPop")).execLastTask();
    }
}

PowerCreep.prototype.hasPBInRoom = function (room) {
    if (!global.ManagerFlags) return false;
    let flags = ManagerFlags.getFlagsByPrefix("powerBank") || [];
    if (flags.some(f => f.getRoomName(1) === room.name)) return true;
    // PB 队伍已经在房内生成/集结时也算，避免旗子短暂不可见时空转。
    return room.find(FIND_MY_CREEPS).some(c => {
        let role = c.memory && c.memory.role;
        return role == "PBer" || role == "PBCarrier" || role == "PBHeal";
    });
};

PowerCreep.prototype.needOpSpawn = function () {
    let pcPower = this.powers[PWR_OPERATE_SPAWN];
    if (!pcPower || pcPower.cooldown > 0) return false;
    // ops 很贵：只用于 PB 任务房的 spawn，且至少保留 200 ops（两次效果）。
    if ((this.store[RESOURCE_OPS] || 0) < 200) return false;
    let room = this.mainRoom();
    if (!room || !room.my) return false;
    if (!this.hasPBInRoom(room)) return false;
    let spawns = (room.spawn || []).filter(s => !s.effects || !s.effects.some(e => e.power == PWR_OPERATE_SPAWN));
    if (!spawns.length) return false;
    let spawning = spawns.filter(s => s.spawning);
    return spawning[0] || spawns[0];
};

PowerCreep.prototype.OpSpawn = function () {
    let pcPower = this.powers[PWR_OPERATE_SPAWN];
    let spawn = this.lastTaskObj();
    if (!pcPower || pcPower.cooldown > 0 || !spawn) {
        this.popTask().execLastTask();
        return;
    }
    if (!this.pos.inRangeTo(spawn, 3)) {
        this.moveTo(spawn, { range: 3 });
        return;
    }
    let code = this.usePower(PWR_OPERATE_SPAWN, spawn);
    if (code != ERR_NOT_IN_RANGE) this.popTask().execLastTask();
};

PowerCreep.prototype.needOpTower = function () {
    let pcPower = this.powers[PWR_OPERATE_TOWER];
    if (!pcPower || pcPower.cooldown > 0) return false;
    // 只在被攻击时使用；10 ops/100t 也只在战斗期花。
    if ((this.store[RESOURCE_OPS] || 0) < 100) return false;
    let room = this.mainRoom();
    if (!room || !room.my || !room.tower || !room.tower.length) return false;
    let hostile = room.find(FIND_HOSTILE_CREEPS);
    if (!hostile.length && room.find(FIND_HOSTILE_POWER_CREEPS).length == 0) return false;
    let tower = room.tower.find(t => (t.energy || 0) >= 10
        && (!t.effects || !t.effects.some(e => e.power == PWR_OPERATE_TOWER)));
    return tower || false;
};

PowerCreep.prototype.OpTower = function () {
    let pcPower = this.powers[PWR_OPERATE_TOWER];
    let tower = this.lastTaskObj();
    if (!pcPower || pcPower.cooldown > 0 || !tower) {
        this.popTask().execLastTask();
        return;
    }
    if (!this.pos.inRangeTo(tower, 3)) {
        this.moveTo(tower, { range: 3 });
        return;
    }
    let code = this.usePower(PWR_OPERATE_TOWER, tower);
    if (code != ERR_NOT_IN_RANGE) this.popTask().execLastTask();
};


PowerCreep.prototype.needSaveOps = function () {
    let mainRoom = this.mainRoom();
    if (mainRoom.storage && (mainRoom.storage.store[RESOURCE_OPS] < 100000 || mainRoom.storage.store.getFreeCapacity(RESOURCE_OPS) > 100000)) {
        return this.store[RESOURCE_OPS] > OPS_MAX_CARRY_CNT
    }
}

PowerCreep.prototype.saveRoomOps = function () {
    let cnt = (this.store[RESOURCE_OPS] || 0) - OPS_MIN_CARRY_CNT;
    if (cnt <= 0) return;
    let mainRoom = this.mainRoom();
    let saveObj = mainRoom.storage || mainRoom.mineral;
    if (saveObj) {
        this.addTask([
            UtilsTask.task(saveObj, "fillRes", undefined, {
                resType: RESOURCE_OPS,
                resCount: cnt
            })
        ])
    }
}

PowerCreep.prototype.needGetOps = function () {
    return this.store[RESOURCE_OPS] < OPS_MIN_CARRY_CNT && StationCarry.roomMassStoreCnt(this.mainRoom(), RESOURCE_OPS) >= 200
}

PowerCreep.prototype.getRoomOps = function () {
    let cnt = OPS_MIN_CARRY_CNT - (this.store[RESOURCE_OPS] || 0);
    if (cnt <= 0) return;
    let mainRoom = this.mainRoom();
    let saveObj = mainRoom.storage || mainRoom.mineral;
    if (saveObj) {
        this.addTask(StationCarry.generatorMassStoreCarry(mainRoom, RESOURCE_OPS, cnt));
    }
}


PowerCreep.prototype.roomPowerEnable = function () {
    let controller = this.lastTaskObj();
    if (!this.pos.isNearTo(controller)) {
        this.goTo(controller);
    } else {
        this.enableRoom(controller);
        this.popTask().execLastTask();
    }
}


PowerCreep.prototype.needOpPowerSpawn = function () {
    let room = this.mainRoom();
    if (!room || !room.my || !room.storage) return false;
    // ops 很贵：只在能量充裕且 power/ops 有富余时处理 power。
    if (!StationHive.isEnergyAbundant()) return false;
    if (this.store[RESOURCE_OPS] < 400 || (room.storage.store[RESOURCE_POWER] || 0) < 3000 || room.storage.store[RESOURCE_ENERGY] < (90000)) return false;
    if (StationCarry.roomMassStoreCnt(room, RESOURCE_OPS) < 600) return false;
    let pcPower = this.powers[PWR_OPERATE_POWER]//
    if (pcPower && pcPower.cooldown < OP_SOURCE_WAIT_TIME) {
        let s = room.powerSpawn;
        if (!s.effects || !s.effects.length || s.effects.head().ticksRemaining <= 0) {
            return s;
        }
    }
    return false;
}


PowerCreep.prototype.OpPowerSpawn = function () {
    let pcPower = this.powers[PWR_OPERATE_POWER];
    let powerSpawn = this.lastTaskObj();
    if (pcPower.cooldown > 0 || !powerSpawn) {
        this.popTask().execLastTask();
    }
    if (!this.pos.inRangeTo(powerSpawn, 3)) {
        this.moveTo(powerSpawn);
    }
    this.usePower(PWR_OPERATE_POWER, powerSpawn);
}

PowerCreep.prototype.OpFactory = function () {
    let pcPower = this.powers[PWR_OPERATE_FACTORY];
    let factory = this.lastTaskObj();
    if (pcPower.cooldown > 0 || !factory) {
        this.popTask().execLastTask();
    }
    if (!this.pos.inRangeTo(factory, 3)) {
        this.moveTo(factory);
    }
    this.usePower(PWR_OPERATE_FACTORY, factory);
}

PowerCreep.prototype.needOpExt = function () {
    let pcPower = this.powers[PWR_OPERATE_EXTENSION]
    if (pcPower && !pcPower.cooldown && pcPower.level >= 1) {
        let room = this.mainRoom();
        let needFillRatio = 1 - room.energyAvailable / room.energyCapacityAvailable
        if (needFillRatio < (isSaveCpu ? 0.1 : pcPower.level * 0.1 + 0.1)) {
            this.memory.opExtSleep = 0
            return false
        }//
        let t = [room.storage, room.terminal].maxBy(e => e.store[RESOURCE_ENERGY])
        if (t && t.store[RESOURCE_ENERGY] > room.energyCapacityAvailable) {
            if (this.memory.opExtSleep == 1) {
                this.memory.opExtSleep = 0
                return t
            }
            if (!this.memory.opExtSleep) this.memory.opExtSleep = 1;
            else this.memory.opExtSleep += 1;
        }
    }
    return false;
}


PowerCreep.prototype.OpExt = function () {
    let container = this.lastTaskObj();
    if (!container) {
        this.popTask().execLastTask();
        return;
    }
    if (!this.pos.inRangeTo(container, 3)) {
        this.moveTo(container, { range: 3 });
        return;
    }
    let room = this.mainRoom();
    let pcPower = this.powers[PWR_OPERATE_EXTENSION]
    let needFillRatio = 1 - room.energyAvailable / room.energyCapacityAvailable
    if (needFillRatio >= (isSaveCpu ? 0.1 : pcPower.level * 0.1 + 0.1))
        this.usePower(PWR_OPERATE_EXTENSION, container);
    this.popTask().execLastTask();
}

// add by an_w
PowerCreep.prototype.needOpLab = function () {
    let pcPower = this.powers[PWR_OPERATE_LAB]
    if (pcPower && pcPower.level < 4) return false;
    if (pcPower && pcPower.cooldown < OP_SOURCE_WAIT_TIME && Game.time % 5 == 1) {
        let room = this.mainRoom();
        let obj = room.memory[StationLab.stationName];
        // half of the labs need to be Operated
        let otherLabs = obj.otherLabs.map(id => Game.getObjectById(id))
        // let labs = otherLabs.splice(0, Math.ceil(otherLabs.length / 2))
        let labs = otherLabs
        for (let lab of labs) {
            if (Game.cpu.bucket>2000 &&(!lab.effects || !lab.effects.length || lab.effects.head().ticksRemaining < 50)) {
                return lab;
            }
        }
    }
    return false;
}

PowerCreep.prototype.OpLab = function () {
    let pcPower = this.powers[PWR_OPERATE_LAB];
    let lab = this.lastTaskObj();
    if (pcPower.cooldown > 0 || !lab) {
        this.popTask().execLastTask();
    }
    if (!this.pos.inRangeTo(lab, 3)) {
        this.moveTo(lab, { range: 3 });
        return;
    }
    this.usePower(PWR_OPERATE_LAB, lab);
}

PowerCreep.prototype.needOpMineral = function () {
    let pcPower = this.powers[PWR_REGEN_MINERAL]
    if (pcPower && pcPower.cooldown < OP_SOURCE_WAIT_TIME) {
        let room = this.mainRoom();
        let obj = room.memory[StationMineral.stationName]
        let mineral = Game.getObjectById(obj.id)
        if (mineral && !mineral.ticksToRegeneration && (!mineral.effects || !mineral.effects.length || mineral.effects.head().ticksRemaining < 5)) {
            return mineral;
        }
    }
    return false;
}

PowerCreep.prototype.OpMineral = function () {
    let pcPower = this.powers[PWR_REGEN_MINERAL];
    let mineral = this.lastTaskObj();
    if (pcPower.cooldown > 5 || !mineral || !mineral.mineralAmount) {
        this.popTask().execLastTask();
    }
    if (!this.pos.inRangeTo(mineral, 3)) {
        this.moveTo(mineral, { range: 3 });
    }
    this.usePower(PWR_REGEN_MINERAL, mineral);
}
