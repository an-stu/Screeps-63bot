

Room.prototype.setCreepsList=function (list) {
    this._creepsList = list||[]
};

Room.prototype.creeps=function (role,spawned=true) {
    if(this._creepsList == null)this._creepsList = []
    if(role){
        let creeps = this[role+"_creepsList"];
        if(creeps == null){
            creeps = this._creepsList.filter(e=>e.memory.role == role);
            this[role+"_creepsList"] = creeps;
        }
        if(spawned){
            if(!this[role+"_creepsListSpawned"])this[role+"_creepsListSpawned"] = creeps.filter(e=>e.spawning!=true);
            return this[role+"_creepsListSpawned"];
        }
        else return creeps
    }
    else {
        if(spawned){
            if(!this._creepsListSpawned)this._creepsListSpawned = this._creepsList.filter(e=>e.spawning!=true);
            return this._creepsListSpawned;
        }
        else return this._creepsList;
    }
};

Room.prototype.setFlagList=function (list) {
    this._flagList = list||[]
};

Room.prototype.flags=function (prefix) {
    this._flagList = this._flagList || []
    if(prefix){
        let flags = this[prefix+"_flagList"];
        if(flags == null){
            flags = this._flagList.filter(e=>e.getPrefix() == prefix);
            this[prefix+"_flagList"] = flags;
        }
        return flags
    }
    else {
        return this._flagList;
    }
};

// Per-tick tactical query caches. Room objects are recreated every tick, so
// these never become stale and let tower/safe-mode/team code share one scan.
Room.prototype.getHostileCreeps=function () {
    if(this._cpuHostileCreepCache === undefined)this._cpuHostileCreepCache = this.find(FIND_HOSTILE_CREEPS);
    return this._cpuHostileCreepCache;
};

Room.prototype.getHostileStructures=function () {
    if(this._cpuHostileStructureCache === undefined)this._cpuHostileStructureCache = this.find(FIND_HOSTILE_STRUCTURES);
    return this._cpuHostileStructureCache;
};


/** roomName 的哈希值 */
Room.prototype.hashCode=function () {
    if(this.memory.hashCode)return this.memory.hashCode
    let hash = Utils.rnd(Utils.hashCode(this.name))
    this.memory.hashCode = hash;
    return hash;
};

Room.prototype.getEnergyCapacityAvailable=function (){
    if(this.isDownGrade()){
        return this.extension.filter(e=>e.isActive()).map(e=>e.store.getCapacity(RESOURCE_ENERGY)).sum()+
            this.find(FIND_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_SPAWN}).filter(e=>e.isActive()).map(e=>e.store.getCapacity(RESOURCE_ENERGY)).sum()
    }
    return this.energyCapacityAvailable
}

Room.prototype.getEnergyAvailable=function () {
    if(this.isDownGrade()){
        return this.extension.filter(e=>e.isActive()).map(e=>e.store[RESOURCE_ENERGY]).sum()+
        this.find(FIND_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_SPAWN}).filter(e=>e.isActive()).map(e=>e.store[RESOURCE_ENERGY]).sum()
    }
    return this.energyAvailable
};

Room.prototype.randomPosition=function () {
    return new RoomPosition(Utils.randomInt(1,49),Utils.randomInt(1,49),this.name)
};


Room.prototype.findUnWalkAbleStructures = function () {
    return this.find(FIND_STRUCTURES).filter(e=> e.structureType != 'road' && e.structureType != 'container' && !(e.structureType == 'rampart' && e.my))
}


Room.prototype.isDownGrade=function () {
    if(this.controller.progressTotal<this.controller.progress)return true
    if(this.extension.length>CONTROLLER_STRUCTURES[this.level])return true
};
