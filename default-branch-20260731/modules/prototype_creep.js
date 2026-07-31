//-----a sample of whiteList------------
let whiteList = new Set([
    '6g3y',
    'wangyin316',
    'ANATKH',
    'XANFLORP',
    'joe95_1',
    'joe95',
    'Welmen'
]);


/**
 Module: prototype.Whitelist
 Author: Yuandiaodiaodiao
 Date:   20200119
 Import:  require('prototype.Whitelist')
 Usage:
 1.write your whiteList in a Set
 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
 2. return your whiteList in function getWhiteList
 3. all find methods, including Room.find and RoomPosition.findClosestByRange/findInRange/findClosestByPath
 with param type=== FIND_HOSTILE_CONSTRUCTION_SITES
 FIND_HOSTILE_POWER_CREEPS
 FIND_HOSTILE_CREEPS
 FIND_HOSTILE_SPAWNS
 FIND_HOSTILE_STRUCTURES
 now wont include objects which have owner in your whiteList
 4.use lookForAt / lookForAtArea / LookFor and give the first arg with
 "LOOK_FRIEND"   !!!notice its a string
 will return creep in whiteList (not include yourself)
 "LOOK_HOSTILE"   !!!notice its a string
 will return creep not in whiteList (also not include yourself)

 5.example:
 Game.rooms['E25N43'].lookForAt('LOOK_HOSTILE',25,25)
 Game.rooms['E25N43'].find(FIND_HOSTILE_CREEPS)

 */


function getWhitelist() {
    //----return your whiteList here-------------------
    return whiteList
}

//------module code------------


const emptyCostMatrix = new PathFinder.CostMatrix; // 不能修改他

let originFind = Room.prototype.find
Room.prototype.find = function (type, opts) {
    let result = originFind.call(this, type, opts)
    if (type === FIND_HOSTILE_CREEPS
        || type === FIND_HOSTILE_CONSTRUCTION_SITES
        || type === FIND_HOSTILE_POWER_CREEPS
        || type === FIND_HOSTILE_SPAWNS
        || type === FIND_HOSTILE_STRUCTURES) {
        result = _.filter(result, o => !getWhitelist().has(o.owner.username))
    }
    return result
}
let originLookForAt = Room.prototype.lookForAt

function isFriend(o) {
    return getWhitelist().has(o.owner.username) && !o.my
}

function isHostile(o) {
    return !getWhitelist().has(o.owner.username) && !o.my
}

Room.prototype.lookForAt = function (type, firstArg, secondArg) {
    if (type === 'LOOK_FRIEND') {
        let result = originLookForAt.call(this, LOOK_CREEPS, firstArg, secondArg)
        result = _.filter(result, isFriend)
        return result
    } else if (type === 'LOOK_HOSTILE') {
        let result = originLookForAt.call(this, LOOK_CREEPS, firstArg, secondArg)
        result = _.filter(result, isHostile)
        return result
    } else {
        return originLookForAt.call(this, type, firstArg, secondArg)
    }
}
let originLookForAtArea = Room.prototype.lookForAtArea

function solveArea(result, asArray, o) {
    if (!asArray) {
        for (let i in result) {
            let temp = result[i]
            for (let j in temp) {
                let tmp = temp[j]
                if (tmp) {
                    tmp = _.filter(tmp, o => getWhitelist().has(o.owner.username) && !o.my)
                }
                if (tmp.length === 0) {
                    temp[i] = undefined
                } else {
                    temp[i] = tmp
                }
            }
        }
    } else {
        result = _.filter(result, o => getWhitelist().has(o.creep.owner.username) && !o.creep.my)
    }
    return result
}

Room.prototype.lookForAtArea = function (type, top, left, bottom, right, asArray) {
    if (type === 'LOOK_FRIEND') {
        let result = originLookForAtArea.call(this, LOOK_CREEPS, top, left, bottom, right, asArray)
        result = solveArea(result, asArray, isFriend)
        return result
    } else if (type === 'LOOK_HOSTILE') {
        let result = originLookForAtArea.call(this, LOOK_CREEPS, top, left, bottom, right, asArray)
        result = solveArea(result, asArray, isHostile)
        return result
    } else {
        return originLookForAtArea.call(this, type, top, left, bottom, right, asArray)
    }
}
















global.RES_PRIORITY_LIST = ["device", "machine", "essence", "organism", "circuit", "hydraulics", "emanation", "organoid", "microchip", "frame", "spirit", "muscle", "transistor", "fixtures", "extract", "tissue", "switch", "tube", "concentrate", "phlegm", "silicon", "metal", "mist", "biomass", "wire", "alloy", "condensate", "cell", "liquid", "crystal", "composite", "XUHO2", "XZHO2", "XKHO2", "XLHO2", "XGHO2", "XUH2O", "XZH2O", "XKH2O", "XLH2O", "XGH2O", "UHO2", "ZHO2", "KHO2", "LHO2", "GHO2", "UH2O", "ZH2O", "KH2O", "LH2O", "GH2O", "power", "utrium_bar", "purifier", "reductant", "lemergium_bar", "keanium_bar", "zynthium_bar", "oxidant", "ghodium_melt", "battery", "OH","UO", "ZO", "KO", "LO", "GO", "UH", "ZH", "KH", "LH", "GH", "U", "L", "K", "Z", "X", "O", "H", "G", "ops", "energy"]
global.RES_PRIORITY_MAP = {}
for (let i = 0; i < global.RES_PRIORITY_LIST.length; i++) {
    RES_PRIORITY_MAP[RES_PRIORITY_LIST[i]] = RES_PRIORITY_LIST.length - i
}


/**
 * 任务事件的 creep 通用的动作
 */


Creep.prototype.sayHeadTask = function () {
    let head = this.memory.tasks.head();
    if (head) {
        HelperVisual.showText(this, head.taskName)
        // this.say(head.taskName)
    }
};
Creep.prototype.sayLastTask = function () {
    let head = this.memory.tasks.last();
    if (head) {
        HelperVisual.showText(this, head.taskName)
        // this.say(head.taskName)
    }
};

Creep.prototype.execRegFun = function () {
    // if((this.memory.tasks == 1)){
    //     log(this.memory.tasks)
    //     this.memory.tasks = []
    // }
    // if(!(this.memory.tasks instanceof Array)){
    //     log(this.memory.tasks)
    //     this.memory.tasks = []
    // }
    for (let task of this.memory.tasks) {
        if (task && task.regFun && typeof this[task.regFun] == "function") {
            // log(head.regFun)
            this[task.regFun]();
        }

    }
    // let head = this.memory.tasks.head();
    // if (head&&head.regFun) {
    //     // log(head.regFun)
    //     this[head.regFun]();
    // }
};

Creep.prototype.popTask = function () {
    this.memory.tasks.pop()
    return this;
};

Creep.prototype.lastTask = function () {
    return this.memory.tasks.last()
};
Creep.prototype.headTask = function () {
    return this.memory.tasks.head()
};

Creep.prototype.lastTaskObj = function () {
    let last = this.memory.tasks.last();
    if (last) return Game.getObjectById(last.id)
};
Creep.prototype.headTaskObj = function () {
    let head = this.memory.tasks.head();
    if (head) return Game.getObjectById(head.id)
};

Creep.prototype.headTaskFlag = function () {
    let head = this.memory.tasks.head();
    if (head) return Game.flags[head.id] || Game.flags[head.flagName];
};

Creep.prototype.headTask = function () {
    return this.memory.tasks.head()
};

Creep.prototype.addTask = function (task) {
    // log(this.memory.tasks.push(task))
    if (!task) return this;
    if (task.taskName) {
        this.memory.tasks.push(task)
    }
    else if (Array.isArray(task)) for (let t of task) {
        this.addTask(t);
    }
    return this;
};

Creep.prototype.addTaskAndExec = function (task) {
    this.addTask(task);
    this.execLastTask();
    return this;
};

Creep.prototype.execLastTask = function () {
    // this.memory.tasks = this.memory.tasks.flat()
    if (this.memory.tasks.length) {
        // if(!this.memory.tasks.last().taskName)
        //     log(this.memory.tasks)
        let taskName = this.memory.tasks.last().taskName;
        // A bootstrap deployment can deliberately omit optional task modules.
        // Leave such a task intact for a later module restore, but never turn it
        // into an exception on every tick.
        if (typeof this[taskName] == "function") this[taskName]();
    } else {
        this.memory.dontPullMe = false;
    }
    return this;
};

// Creep.prototype.execLastTask=function () {
//     // this.memory.tasks = this.memory.tasks.flat()
//     try{
//         if(this.memory.tasks.length){
//             this[this.memory.tasks.last().taskName]();
//         }else {
//             this.memory.dontPullMe = false;
//         }
//         return this;
//     }catch (e) {
//         log(this.memory.tasks)
//     }
// };

Creep.prototype.isFree = function () {
    // return this.memory.tasks.head()==undefined; 任务数量比较快
    return !this.memory.tasks.length;
};

Creep.prototype.getPartCnt = function (bodyPart) {
    if (this.my) {
        let name = bodyPart + "+";
        if (this.memory[name] == undefined) {
            this.memory[name] = this.body.filter(e => e.type == bodyPart).length;
        }
        return this.memory[name];
    } else {
        let name = bodyPart + "+";
        if (this[name] == undefined) {
            this[name] = this.body.filter(e => e.type == bodyPart).length;
        }
        return this[name];
    }
};

Creep.prototype.getUnBoostPartCnt = function (bodyPart) {
    return this.body.filter(e => e.type == bodyPart && !e.boost).length;
};


// Creep.prototype.getCarryAble=function (bodyPart) {
//     this.getPartCnt(CARRY)*50
// };



/**
 * 默认走到最后一个任务上
 * @param obj
 */
Creep.prototype.goTo = function (obj) {
    if (!obj) obj = this.goTo(this.memory.tasks.last());
    if (obj.pos)
        this.moveTo(obj.pos, { visualizePathStyle: { stroke: '#ff0374' } });
    else if (obj.x)
        this.moveTo(new RoomPosition(obj.x, obj.y, obj.roomName), { visualizePathStyle: { stroke: '#ff0374' } })
};


Creep.prototype.scouterToRoom = function () {
    let obj = this.memory.tasks.last();
    let position = new RoomPosition(25, 25, obj.roomName);
    if (this.room.name == obj.roomName) {
        this.suicide();//自杀！
    }
    if (!Memory.rooms[this.room.name] || !Memory.rooms[this.room.name][StationSources.stationName]) {
        ManagerRooms.refreshRoom(this.room)
    }
    else this.goTo(position, { visualizePathStyle: { stroke: '#67ffed' } })
};

Creep.prototype.claimRoom = function () {
    let obj = this.lastTask();
    if (!obj.roomName && !obj.pos) {
        obj = Game.flags[obj.id];
    }
    if (!this.pos.isNearTo(this.room.controller)) this.autoHeal(this);//this.hitsMax!=this.hits&&
    if (!obj) return;
    if (this.room.name == (obj.roomName || obj.pos.roomName)) {
        if (!this.room.my) {
            if (this.claimController(this.room.controller) != OK) {
                this.goTo(this.room.controller)
                if (this.room.controller.pos.isNearTo(this)) {
                    if (this.attackController(this.room.controller) == OK) {
                        if (this.ticksToLive > 350 && this.mainRoom()) {
                            this.popTask();
                            this.addTask([UtilsTask.taskData("recycleCreep")])
                        }
                        else {
                            this.suicide();
                        }
                    }
                    if (!this.memory.signed && this.signController(this.room.controller, "I want this room") == OK)
                        this.memory.signed = true
                }
            }
        } else if (this.room.my) {
            this.popTask();
        }
    } else {
        this.goTo(obj)
    }
};

/**
 * 默认走到最后一个任务上
 * @param obj
 */
Creep.prototype.goToPop = function () {
    let obj = this.memory.tasks.last();
    let position = new RoomPosition(obj.x, obj.y, obj.roomName);
    if (this.pos.isEqualTo(position)) {
        this.popTask();
        this.execLastTask();
    }
    else this.goTo(position, { visualizePathStyle: { stroke: '#67ffed' } })
};
/**
 * 默认走到最后一个任务上
 * @param obj
 */
Creep.prototype.goToNearPop = function () {
    let obj = this.memory.tasks.last();
    let position = new RoomPosition(obj.x, obj.y, obj.roomName);
    if (this.pos.isNearTo(position)) {
        this.memory.dontPullMe = true;
        this.popTask();
        this.execLastTask();
    }
    else this.moveTo(position, { visualizePathStyle: { stroke: '#67ffed' } })
};

Creep.prototype.storeEmpty = function () {
    return this.store.getUsedCapacity() == 0;
};

/**
 * 爬 除了能量还有别的资源 （空的也不算）
 * @return {boolean}
 */
Creep.prototype.storeContainsEnergyOtherResType = function () {
    let resLs = _.keys(this.store)
    if (resLs.length > 1) return true;
    if (resLs.length == 0) return false;
    return resLs[0] != RESOURCE_ENERGY
};


Creep.prototype.storeUsed = function () {
    // return _.sum(_.values(this.store)) ==  this.store.getCapacity(RESOURCE_ENERGY);
    return this.store.getUsedCapacity();
};
Creep.prototype.storeFull = function () {
    // return _.sum(_.values(this.store)) ==  this.store.getCapacity(RESOURCE_ENERGY);
    return this.store.getFreeCapacity(RESOURCE_ENERGY) <= 0;
};

Creep.prototype.freeCapacity = function () {
    // return _.sum(_.values(this.store)) ==  this.store.getCapacity(RESOURCE_ENERGY);
    return this.store.getFreeCapacity(RESOURCE_ENERGY);
};

Creep.prototype.mainRoom = function () {
    return Game.rooms[this.memory.roomName];
};


Creep.prototype.registerUsed = function () {
    let room = Game.rooms[this.memory["roomName"]]
    room.used = room.used || {}
    room.used[this.headTask().id] = true
};


Creep.prototype.pickupRes = function () {
    let target = this.lastTaskObj();
    if (!target) {
        this.popTask();
        return
    }
    let code = this.pickup(target);
    if (code == ERR_NOT_IN_RANGE) {
        this.moveTo(target)
    }
    else if (code != ERR_NOT_IN_RANGE) {
        this.popTask();
        this.execLastTask();
    }
};



/**
 * Task:
 * resType
 * resCount
 */
Creep.prototype.carryRes = function () {
    let task = this.lastTask();
    let obj = Game.getObjectById(task.id)
    if (!this.pos.isNearTo(obj)) {
        this.moveTo(task, { visualizePathStyle: { stroke: '#67ffed' } })
    }
    if (!obj || obj.store[task.resType] == 0 || this.storeFull()) {
        this.popTask();
        this.execLastTask();
        return;
    }
    if (this._move_res_active) return;
    this._move_res_active = true
    if (task.resType == undefined) throw new Error("resType no found:" + task)

    let code = this.withdraw(obj, task.resType, Math.min(task.resCount ? Math.min(obj.store[task.resType] || 0, this.store.getFreeCapacity(task.resType), task.resCount) : undefined));
    // if(code==ERR_NOT_IN_RANGE){
    //  this.moveTo(task,{visualizePathStyle: {stroke: '#67ffed'}})
    // }
    if (code == OK) {
        this._move_res_active_OK = true
        let number = Math.min(Math.min(Math.max(this.store.getFreeCapacity(task.resType), 0), task.resCount ? task.resCount : 1e5), obj.store[task.resType])
        this.store[task.resType] = (this.store[task.resType] || 0) + number
        obj.store[task.resType] -= number
        this.popTask();
        this.execLastTask();
    } else if (code == ERR_NOT_ENOUGH_RESOURCES) {
        this.popTask();
    }

}

/**
 * Task:
 * resType 资源类型
 * resCount 资源数量
 * fromStorage 如果空了，往storage拿，默认true
 */
Creep.prototype.fillRes = function () {
    let task = this.lastTask();
    if (task.resType == undefined) throw new Error("resType no found:" + task)
    let obj = this.lastTaskObj();

    if (this[task.id]) return this.popTask();
    if (!obj) {
        this[task.id] = true;
        if (this.room.name == task.roomName) return this.popTask().execLastTask();
        else return;
    }
    // if((!this._move_res_active_OK)&&this.storeEmpty()&&this.room.my&&this.room.storage&&obj&&this.room.storage.id!=obj.id&&this.room.storage.store[task.resType]>=(task.resCount||this.store.getFreeCapacity(RESOURCE_ENERGY))&&task.fromStorage!==false){ // 如果满了,找自己的箱子拿东西
    //     this.addTask([UtilsTask.task(this.room.storage, "carryRes", undefined, {resType: task.resType,resCount:task.resCount})])
    //     this.execLastTask();
    //     return ;
    // }
    let carryAbleCnt = task.resCount || this.store.getFreeCapacity(RESOURCE_ENERGY);
    if ((!this._move_res_active_OK) && this.storeEmpty() && this.room.my && this.room.storage && obj && !StationCarry.isRoomMassStore(this.room, obj) && StationCarry.roomMassStoreCnt(this.room, task.resType) >= carryAbleCnt && task.fromStorage !== false) { // 如果满了,找自己的箱子拿东西
        let tasks = StationCarry.generatorMassStoreCarry(this.room, task.resType, carryAbleCnt)
        // log(this.room.name,task.resType,StationCarry.roomMassStoreCnt(this.room,task.resType),tasks.length)
        if (tasks.length) this.addTask(tasks).execLastTask();
        else this.popTask().execLastTask();
        return;
    }
    let objFreeCapacity = obj.store.getFreeCapacity(task.resType);
    if (obj && objFreeCapacity <= 0 || this.store[task.resType] == 0) {
        this[task.id] = true;
        // log(obj.pos.roomName)
        this.popTask().execLastTask();
        return;
    }

    if (this.room.name != task.roomName || !this.pos.isNearTo(obj)) {
        this.moveTo(task, { visualizePathStyle: { stroke: '#67ffed' } })
        this._move_res_active = true
    }
    if (this._move_res_active) return;
    if (this.room.name == task.roomName && this.pos.isNearTo(obj)) {
        let number = Math.min(this.store[task.resType], task.resCount ? task.resCount : 100000);
        number = Math.min(objFreeCapacity, number);
        let code = this.transfer(obj, task.resType, number);
        if (code == OK && task.resCount > number && objFreeCapacity != number) {
            this._move_res_active = true
            task.resCount -= number;
            this.store[task.resType] -= number
            obj.store[task.resType] = (obj.store[task.resType] || 0) + number
            return this.execLastTask();
        }
        if (code == OK) {
            this._move_res_active = true
            this.store[task.resType] -= number
            obj.store[task.resType] = (obj.store[task.resType] || 0) + number
            return this.popTask().execLastTask();
        }
    }
}

Creep.prototype.buildConst = function () {
    let obj = this.lastTaskObj();
    let code = this.build(obj);
    if (code == ERR_NOT_IN_RANGE) {
        this.moveTo(obj, { visualizePathStyle: { stroke: '#00f3ff', ignoreCreeps: false }, range: 3 });
    }
    if (!obj || this.storeEmpty()) {
        this.popTask()
        this.execLastTask()
    }
}

Creep.prototype.fillAllTask = function () {
    let lastTaskObj = this.lastTaskObj();
    if (lastTaskObj && this.store.getResTypeList().length
        && (lastTaskObj.structureType != STRUCTURE_STORAGE || lastTaskObj.store.getFreeCapacity(RESOURCE_ENERGY) > 0)) {// 如果是storage 并且满了就不填充了
        this.fillAll(lastTaskObj)
    } else {
        this.popTask().execLastTask();
    }
}


Creep.prototype.fillAllMainRoomStorage = function () {
    let storage = this.mainRoom().storage;
    if (storage && storage.store.getFreeCapacity() > 0) {
        this.fillAll(storage)
    } else {
        let terminal = this.mainRoom().terminal;
        if (terminal && terminal.store.getFreeCapacity() > 0)
            this.fillAll(terminal)
    }
}

Creep.prototype.fillAll = function (target) {
    let tasks = _.keys(this.store).map(e =>
        UtilsTask.task(target, "fillRes", undefined, {
            resType: e
        })
    );
    if (tasks.length && target.store.getFreeCapacity(tasks.last().resType) > 0) {
        this.addTask(tasks)
        this.execLastTask();
    }
}



Creep.prototype.carryAllTask = function () {
    let lastTaskObj = this.lastTaskObj();
    if (lastTaskObj && lastTaskObj.store.getResTypeList().length && !this.storeFull()) {
        this.carryAll(lastTaskObj, this.lastTask().regFun)
        this.execLastTask();
    } else {
        this.popTask().execLastTask();
    }
}

Creep.prototype.carryAll = function (target, register = "registerStationCarryDrop") {
    if (target)
        this.addTask(_.keys(target.store).sort((a, b) => RES_PRIORITY_MAP[a] - RES_PRIORITY_MAP[b]).map(e =>
            UtilsTask.task(target, "carryRes", register, {
                resType: e
            })
        ))
}

Creep.prototype.suicideTask = function () {
    this.addTask([UtilsTask.taskData("suicide")])
}

Creep.prototype.needUnBoost = function () {
    return this.body.filter(e => e.boost).length
}

Creep.prototype.recycleCreep = function () {
    let task = this.headTask();
    // if(!this.mainRoom())this.suicide()
    if (this.mainRoom().name != this.room.name) {
        this.goTo(this.mainRoom().storage || this.mainRoom().controller);
    } else {
        if (this.needUnBoost() && this.ticksToLive < 700) {
            let taskUnboost = StationLab.generatorUnboostTask(this.mainRoom());
            if (taskUnboost.length) return this.addTask(taskUnboost).execLastTask();
        }
        let spawn = Game.getObjectById(task.id);
        if (!spawn || spawn.structureType != STRUCTURE_SPAWN) {
            spawn = this.mainRoom().spawn.head()
            if (spawn) task.id = spawn.id
        }
        if (spawn) {
            this.say("recycle")
            if (!this.pos.isNearTo(spawn)) {
                this.moveTo(spawn)
            } else {
                spawn.recycleCreep(this)
            }
        }
    }
};


if (!Creep.prototype.$heal) {
    Creep.prototype.$heal = Creep.prototype.heal;
    Creep.prototype.heal = function (creep) {
        let code = this.$heal(creep);
        if (code == OK && creep.id != this.id) this.memory.healLastId = creep.id
        return code
    };
}
/**
 * 自动治疗上一个治疗的爬
 */
Creep.prototype.autoHeal = function () {
    // 如果两个人都血量满了，且没 （有防御塔，或者 范围内有敌方单位） 不消耗cpu了
    let lastHealCreep = Game.getObjectById(this.memory.healLastId)
    if ((this.hits == this.hitsMax && (!lastHealCreep || lastHealCreep.hitsMax == lastHealCreep.hits)) && // 两个都满血
        (
            !this.pos.findInRange(FIND_HOSTILE_CREEPS, 4).length && // 附近没敌人
            (this.room.my || !this.room.find(FIND_STRUCTURES, { filter: e => e.structureType == STRUCTURE_TOWER }).length) // 没防御塔（除了自己房间
        )
    ) return;
    if (this.pos.isNearTo(lastHealCreep) && lastHealCreep.getRealDamage() >= this.getRealDamage()) {
        this.heal(lastHealCreep);
    } else this.heal(this)
}

/** 基础攻击力 */
const BODY_POWER = { [WORK]: DISMANTLE_POWER, [RANGED_ATTACK]: RANGED_ATTACK_POWER, [ATTACK]: ATTACK_POWER, [HEAL]: HEAL_POWER }
/** Boost 对应的倍数*/
const BOOST_POWER = _.values(BOOSTS).map(e => Object.entries(e).map(e => [e[0], _.values(e[1]).head()])).flat().toMap()


/**
 * 获得受到伤害后下一tick剩下的血量
 * @param damage 伤害
 * @return {number} 生命值
 */
Creep.prototype.getHitsNextTick = function (damage) {
    let healthy = this.hits;
    for (const item of this.body) {
        if (item.hits > 0) {
            let damageCarry = (item.type == TOUGH && item.boost) ?
                item.hits / BOOST_POWER[item.boost] : item.hits;
            damage -= damageCarry;
            healthy -= damageCarry - (damage < 0 ? damage : 0);
            if (damage <= 0) break;
        }
    }
    return healthy
}

/**
 * 获取当前爬真实受到的伤害
 * @param dis 距离
 */
Creep.prototype.getRealDamage = function () {
    if (this._realDamage) return this._realDamage
    if (this.hits < this.hitsMax) {
        let getRealHealNumber = 0;
        for (const item of this.body) {
            if (item.hits < 100) {
                if (item.type == TOUGH && item.boost) {
                    const toughBoostType = { 'GO': 0.7, 'GHO2': 0.5, 'XGHO2': 0.3 }
                    getRealHealNumber += ((100 - item.hits) / toughBoostType[item.boost]);
                } else {
                    getRealHealNumber += 100 - item.hits;
                }
            }
        }
        return this._realDamage = getRealHealNumber
    }
    return 0
}

/**
 * 计算一个creep的范围伤害
 * @param bodyType {ATTACK|RANGED_ATTACK|WORK|HEAL}  只能这三种，并且默认远程是
 * @param {number} dis 距离
 * @param {boolean} massAttack 计不计算威胁值（攻击范围之外的creep），默认为false
 * @param {boolean} checkHits 是否检测计算creep的生命值起作用的部分，默认为 true
 */
Creep.prototype.possiblePartTypeDamage = function (bodyType, dis = 1, massAttack = false, checkHits = false) {
    let power = BODY_POWER[bodyType];
    if (massAttack && dis > 1 && dis <= 3 && bodyType == RANGED_ATTACK) power = dis == 2 ? 4 : 1 // mass 10:4:1
    else if (massAttack && dis > 1 && dis <= 3 && bodyType == HEAL) power = RANGED_HEAL_POWER;
    else if (dis > 1 && bodyType != RANGED_ATTACK) power = 0; //近战没效果
    else if (dis > 3) power = 0;

    /** 如果要确认生命值 每次调用都要重新算 这里没缓存 */
    if (checkHits) return power * _.sum(this.body, part => part.type == bodyType && (part.hits || !checkHits) ? (part.boost ? BOOST_POWER[part.boost] : 1) : 0);
    return power * _.sum(this.body, part => part.type == bodyType && (part.boost ? BOOST_POWER[part.boost] : 1))
}
Creep.prototype.possibleRangeDamage = function (dis = 1, massAttack = false, checkHits = false) {
    return this.possiblePartTypeDamage(RANGED_ATTACK, dis, massAttack, checkHits);
}
Creep.prototype.possibleAttackDamage = function (dis = 1, checkHits = false) {
    return this.possiblePartTypeDamage(ATTACK, dis, false, checkHits);
}
Creep.prototype.possibleWorkDamage = function (dis = 1, checkHits = false) {
    return this.possiblePartTypeDamage(WORK, dis, false, checkHits);
}

/**
 * checkHits 这里 的 hits 如果填数值默认是计算血量剩下多少治疗多少
 * @param {number} dis 距离
 * @param {boolean} rangeHeal 是否 范围治疗 默认开启计算
 * @param {number|boolean} checkHits 是否根据血量进行计算 填数字按填数生命值计算
 */
Creep.prototype.possibleHealDamage = function (dis = 1, rangeHeal = true, checkHits = false) {
    if (checkHits > 0 && checkHits !== true) { // 进入虚拟血量环节
        let power = dis > 3 ? 0 : HEAL_POWER
        if (dis > 1 && !rangeHeal) power = 0;
        if (rangeHeal && dis > 1 && dis <= 3) power = RANGED_HEAL_POWER;
        checkHits = Math.ceil(checkHits / 100)
        return power * _.sum(this.body.take(50).reverse().take(checkHits), part => part.type == HEAL && (part.boost ? BOOST_POWER[part.boost] : 1));
    }
    return this.possiblePartTypeDamage(HEAL, dis, rangeHeal, checkHits);
}

/**
 * 计算一个creep的总伤害
 * @param {number} dis 距离
 * @param usedWork 默认拆墙用work 如果有work才会计算 否则不计算
 * @param {boolean} massAttack 计不计算威胁值（攻击范围之外的creep），默认为false
 * @param {boolean} checkHits 是否检测计算creep的生命值起作用的部分，默认为 false
 */
Creep.prototype.possibleDamage = function (usedWork = true, dis = 1, massAttack = false, checkHits = false) {
    let work = usedWork ? this.possibleWorkDamage(dis, checkHits) : 0;// 使用了work
    let atk = work ? 0 : this.possibleAttackDamage(dis, checkHits);// 如果用了work 就没办法用attack了
    return this.possibleRangeDamage(dis, massAttack, checkHits) + work + atk;
}


/**
 * 计算一个 奶的时候最多能承受多少伤害, 在当前治疗下，相当于要多少伤害才能破盾
 * 换句话说，就是 给奶量，需要多少返回需要多少伤害能打穿
 * @param {number} healDamage 治疗量
 * @param {boolean} checkHits 是否检测计算creep的生命值起作用的部分，默认为 false
 */

Creep.prototype.possibleHealHoldRealDamage = function (healDamage, checkHits = false) {
    if (healDamage <= 0) return 0;
    let bodyHits = this.body.map(e => [e.type != TOUGH ? (checkHits ? e.hits : 100) : (checkHits ? e.hits : 100) / (BOOST_POWER[e.boost] || 1), checkHits ? e.hits : 100, e])
    let ToughDamageMax = 0
    let DamageNow = 0
    let hitsNow = 0
    let lastIndex = 0
    for (let i = 0; i < this.body.length; i++) {
        let e = bodyHits[i]
        let damageAble = e[0]
        let hits = e[1]
        let part = e[2]
        // 左边还是右边
        let selectIndex = part.type == TOUGH && (BOOST_POWER[part.boost] || 1) > (BOOST_POWER[bodyHits[lastIndex][2].boost] || 1) ? i : lastIndex// 哪边减伤多选哪边
        ToughDamageMax = Math.max(ToughDamageMax, DamageNow + bodyHits[selectIndex][0])
        // 加上右边的part
        hitsNow += hits
        DamageNow += damageAble
        // 减去左边的part
        while (healDamage <= hitsNow) {
            DamageNow -= bodyHits[lastIndex][0]
            hitsNow -= bodyHits[lastIndex][1]
            lastIndex += 1
        }
    }
    return ToughDamageMax;
}

/**
 * 受到伤害时需要多少奶量（奶满的数量）
 * @param {number} damage 受到的伤害
 * @param {boolean||number} checkHits 是否检测计算creep的生命值起作用的部分，默认为 false
 */
Creep.prototype.possibleDamageHeedRealHeal = function (damage, checkHits = false) {
    const toughBoostType = { 'GO': 0.7, 'GHO2': 0.5, 'XGHO2': 0.3 }
    let needHeal = 0;
    let arr = null;
    if (checkHits && checkHits !== true) {
        arr = []
        for (let i = 0; i < this.body.length; i += 1) {
            if (checkHits > 100) {
                arr.push(100)
                checkHits -= 100
            } else if (checkHits > 0) {
                arr.push(checkHits)
            } else {
                arr.push(0)
            }
        }
        arr.reverse()
    }

    for (let i = 0; i < this.body.length; i += 1) {
        let item = this.body[i]
        let boost = item.type == TOUGH && item.boost ? toughBoostType[item.boost] : 1
        let currentHits = (checkHits === false ? 100 : (arr ? arr[i] : item.hits)) / boost;
        if (damage > currentHits) {
            damage -= currentHits;
            needHeal += 100
        } else if (damage > 0) {
            needHeal += damage * boost
            break;
        }
    }
    return needHeal;
}


/**
 * 计算一个 一体机可以承受的伤害
 * @param {number} checkHits 是否检测计算creep的生命值起作用的部分，默认为 true
 */
Creep.prototype.possibleHealWithToughDamage = function (checkHits = false) {
    let healHits = this.possibleHealDamage(1, false, checkHits)
    return this.possibleHealHoldRealDamage(healHits, checkHits)

}


Creep.prototype.moveOuterBorder = function (nearPosOrObject, retry) {
    if (nearPosOrObject && nearPosOrObject.pos) nearPosOrObject = nearPosOrObject.pos
    if (this.pos.isBorder()) {
        let targetPos = this.pos.nearPos(1).find(e => e.walkable(true) && (!nearPosOrObject || nearPosOrObject.isNearTo(e)))
        if (targetPos) this.moveTo(targetPos)
        else if (retry) {
            targetPos = this.pos.nearPos(1).find(e => e.walkable(true))
            this.moveTo(targetPos)
        }

    }
}


Creep.prototype.fillPowerSpawnContinuous = function () {
    if (!this.memory.sleeped) {
        this.memory.sleeped = true;
        this.goTo(this.mainRoom().storage);
        return;
    }
    let tasks = StationCarry.generatorFillPowerSpawnTask(this.mainRoom(), true);
    this.memory.sleeped = false
    if (tasks.length) {
        this.addTask(tasks).execLastTask();
    } else {
        this.popTask().execLastTask();
    }
}

Creep.prototype.posWalkAble = function (pos, withCreep = false) {
    return pos.walkable(withCreep, this.owner.username)
}

/**
 * 计算多少步走到目标范围
 * 用于数据量小的时候的特殊优化(同一tick有缓存)，每次调用大概0.1cpu不到
 * 适用于10步以内的范围
 *
 * Game.creeps["0x5D88BA1C"].touchAbleNTickInRange(new RoomPosition(46, 46,"E3S2"),150,5)
 * _.values(Game.creeps).forEach(e=>e.touchAbleNTickInRange(new RoomPosition(20, 24,"E3S2"),100,2,5))
 * @param objOrPos 目标位置
 * @param tick 多少步走到
 * @param range
 * @param plainCost 疲劳，走几步停几步
 * @return (RoomPosition|number)[位置,距离]
 */
Creep.prototype.touchAbleNTickInRange = function (objOrPos, tick, range = 1, plainCost = 1) {
    if (objOrPos.pos) objOrPos = objOrPos.pos
    if (tick > 100) throw new Error("range is too high (max:100) : " + range)// 性能限制
    if (tick == 0) return this.pos.inRangeTo(objOrPos, range)
    let username = this.owner.username
    let gol = { pos: objOrPos, range: range };
    let pathData = PathFinder.search(this.pos, [gol], {
        maxCost: tick,
        plainCost: plainCost,
        swampCost: plainCost * 5,
        heuristicWeight: 1.2,
        roomCallback: function (roomName) {
            if (!Game.rooms[roomName]) return emptyCostMatrix
            if (!Game._username_CostMatrix) Game._username_CostMatrix = {}
            if (!Game._username_CostMatrix[username + roomName]) {
                let cm = new PathFinder.CostMatrix()
                let structures = Game.rooms[roomName].find(FIND_STRUCTURES)
                structures.filter(e => e.structureType == STRUCTURE_ROAD).forEach(struct => { cm.set(struct.pos.x, struct.pos.y, 1) })
                structures.filter(e => e.structureType != STRUCTURE_ROAD).forEach(struct => {
                    if (struct.structureType !== STRUCTURE_CONTAINER && struct.structureType !== STRUCTURE_ROAD &&
                        (struct.structureType !== STRUCTURE_RAMPART ||
                            (username != struct.owner.username || struct.isPublic)))
                        cm.set(struct.pos.x, struct.pos.y, 255)
                })
                Game._username_CostMatrix[username + roomName] = cm
            }
            return Game._username_CostMatrix[username + roomName]
        }
    })
    return !pathData.incomplete
}
