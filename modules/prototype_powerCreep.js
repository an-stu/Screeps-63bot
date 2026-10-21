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
/**
 * 连续多少个 tick **原地不动**（位置完全没变）才认定这个 source 够不到、
 * 先把它记成「暂时不可达」、让 PC 去照顾**另一个** source
 *（用户 10-10：两个 source 都要，否则能量少很多）。
 *
 * ⚠️ 判据必须是「**没移动**」，不能是「累计失败次数」：PC 从 powerSpawn 走到
 * source 要几十格，路上每一 tick 都「不在射程内」但一直在动。10-10 第一版写的
 * 就是无条件计数，结果走到第 3 tick 就被判够不到、把 source 冷藏 200 tick ——
 * 12 只 PC 的 2 个 source 全被标记，**26/26 source 一个 REGEN 都没有**。
 */
let OP_SOURCE_STUCK_ATTEMPTS = 3
/** 记成不可达的时长（tick），到点自动重试，不会永久放弃 */
let OP_SOURCE_UNREACHABLE_TTL = 200
PowerCreep.prototype.needOpSource = function () {
    let pcPower = this.powers[PWR_REGEN_SOURCE]//
    if (pcPower && pcPower.cooldown < OP_SOURCE_WAIT_TIME) {
        let source = this.mainRoom().source;
        // 暂时够不到的先跳过（见 OP_SOURCE_STUCK_ATTEMPTS 的说明）——
        // 不跳的话它会一直返回同一个够不到的 source，另一个永远轮不到。
        let unreach = this.memory.opSourceUnreachable || {};
        for (let s of source) {
            let pathTime = StationSources.sourcePathTime(this.mainRoom(), s);
            if (s.effects && s.effects.length && s.effects.head().ticksRemaining >= pathTime + 5) continue;
            if (unreach[s.id] && unreach[s.id] > Game.time) continue;
            return s
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
        // 必须 return：否则下面会拿着已弹出/undefined 的 source 继续 moveTo+usePower
        this.memory.opSourceStuck = 0;
        this.popTask().execLastTask();
        return;
    }
    // 够不到 / 放不出技能时必须**最终弹栈**，否则任务永久挂着（isFree 恒 false，
    // PC 的其它能力全被堵死）。但计数**只能算「原地不动」**：
    //
    // ⚠️ 10-10 第一版是无条件计数，结果 PC 从 powerSpawn 往 source 走的路上
    // （几十格、每 tick 都在移动）连数 3 tick 就被判「够不到」，把 source 标记成
    // 不可达 —— 12 只 PC 的 2 个 source **全被标记**，26/26 source 一个 REGEN 都没有，
    // `needOpSource` 恒返回 false，整条链看起来「能力没在用」。
    // 现在按位置是否变化计数（与 outerStuck / outerRoadStuck 同一套写法）：
    // 还在赶路就清零，真的贴着墙不动 3 tick 才认。
    let stuck = () => {
        let key = this.pos.roomName + ":" + this.pos.x + ":" + this.pos.y;
        if (this.memory.opSourceLastPos === key) {
            this.memory.opSourceStuck = (this.memory.opSourceStuck || 0) + 1;
        } else {
            this.memory.opSourceLastPos = key;
            this.memory.opSourceStuck = 1;      // 本 tick 就是「待在原地」的第 1 次
        }
        if (this.memory.opSourceStuck < OP_SOURCE_STUCK_ATTEMPTS) return false;
        let u = this.memory.opSourceUnreachable || (this.memory.opSourceUnreachable = {});
        u[source.id] = Game.time + OP_SOURCE_UNREACHABLE_TTL;
        this.memory.opSourceStuck = 0;
        this.popTask().execLastTask();
        return true;
    };
    if (!this.pos.inRangeTo(source, 3)) {
        this.moveTo(source, { range: 3 });
        stuck();
        return;
    }
    if (pcPower.cooldown) return;
    let code = this.usePower(PWR_REGEN_SOURCE, source);
    if (code == OK) {
        this.memory.opSourceStuck = 0;
        delete this.memory.opSourceLastPos;
        if (this.memory.opSourceUnreachable) delete this.memory.opSourceUnreachable[source.id];
        StationSources.powerSource(this.room, source, pcPower.level);// 标记被用power ，使得爬的体积变大
        let mainRoom = this.mainRoom();
        let obj = mainRoom.storage || mainRoom.terminal || mainRoom.powerSpawn
        if (obj) this.popTask().addTask(UtilsTask.task(obj, "goToNearPop")).execLastTask();
        return;
    }
    // 在射程内、冷却也是 0，但技能还是放不出去（ops 不够 / 目标无效）——
    // 这是**另一类**失败，跟「够不到」无关。只弹栈让它去干别的，
    // **不要**打不可达标记：否则会因为一个与可达性无关的原因把这个 source 冷藏 200 tick。
    this.memory.opSourceStuck = 0;
    this.popTask().execLastTask();
}

PowerCreep.prototype.hasPBInRoom = function (room) {
    if (!global.ManagerFlags) return false;
    // 只看持久化的 powerBank 任务旗标；不再每次 find 全房 creep，省 CPU。
    let flags = ManagerFlags.getFlagsByPrefix("powerBank") || [];
    return flags.some(f => f.getRoomName(1) === room.name);
};

PowerCreep.prototype.needOpSpawn = function () {
    let pcPower = this.powers[PWR_OPERATE_SPAWN];
    if (!pcPower || pcPower.cooldown > 0) return false;
    // ops 很贵：至少保留 200 ops（两次效果）。
    if ((this.store[RESOURCE_OPS] || 0) < 200) return false;
    let room = this.mainRoom();
    if (!room || !room.my) return false;
    // 什么时候值得花这笔 ops：
    //  1) PB 任务房（原逻辑）：为了快速把抢 PB 的爬生出来。
    //  2) **出兵压力大的房**。原来只认 PB 房，于是主房（W33N55 要同时给 W34N55 + W35N55
    //     出 keeper / carrier / defenser，只有 3 个 spawn，排队严重。
    //     用 OP_SPAWN（等级 4 ≈ 缩短 40% 生成时间）能直接缓解排队。
    //
    // 判据用「**所有 spawn 都忙**——说明确实在排队。平时不浪费 ops。
    // 这是通用规则，与具体房间无关：任何房只要 spawn 全忙就值得加速。
    if (!this.hasPBInRoom(room)) {
        let spawns = room.spawn || [];
        let busy = spawns.filter(s => s.spawning).length;
        if (!spawns.length || busy < spawns.length) return false;
    }
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
    // **不要用账号级 `isEnergyAbundant()` 当闸门**（用户 2026-10-21：
    // 「op power 之后 1t 可以烧三四点，省掉其他 tick 的 CPU 和时间」）。
    // 实测 W32N56：storage 18.1 万能量、power 6,000、ops 820、PC 的 OPERATE_POWER 4 级、
    // 冷却 0、powerSpawn 无效果 —— 全部就绪，唯独账号级能量标志是 false，
    // 于是这条永远返回 false，op power 一次都没开过。
    // 下面几行已经是**本房级**判据（能量/power/ops），足够保护能量。
    // 一个 OPERATE_POWER 周期能烧掉多少 energy，就要求仓里先有那么多 ——
    // 用户 2026-10-21：「确保一个 OPERATE_POWER 完整烧完，然后休息攒到下一个」。
    // 一次 processPower = (1 + 等级) 个 power，每 power 50 energy，效果约 1000 tick：
    //   4 级 ⇒ 5 个/tick × 1000 tick × 50 = 250,000 energy
    // 不够就不开效果（否则烧到一半效果过期，等于白花 ops）。
    let pcLevel = (this.powers[PWR_OPERATE_POWER] || {}).level || 0;
    let batchEnergy = Number((Memory.marketSettings || {}).powerBatchEnergy) > 0
        ? Number(Memory.marketSettings.powerBatchEnergy)
        : 50 * (1 + pcLevel) * 1000;
    if (this.store[RESOURCE_OPS] < 400 || (room.storage.store[RESOURCE_POWER] || 0) < 3000
        || room.storage.store[RESOURCE_ENERGY] < batchEnergy) return false;
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
        return;
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
        return;
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
        // 没有矿物记忆的房间（新占/无 mineral）obj 为 undefined，直接取 .id 会抛
        // TypeError，被 catchError 吞掉后本 PC 整 tick 后续分支全部跳过
        if (!obj || !obj.id) return false;
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
        return;
    }
    if (!this.pos.inRangeTo(mineral, 3)) {
        this.moveTo(mineral, { range: 3 });
    }
    this.usePower(PWR_REGEN_MINERAL, mineral);
}
