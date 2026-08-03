/**
 *
 */


Creep.prototype.registerMinRoom=function () {
    let mainRoom = this.mainRoom()
    if(!mainRoom)return;
    let flag = mainRoom.flags("minSizeRoom").head()
    if (flag) {
        flag.memory.creeps = flag.memory.creeps || []
        if(!flag.memory.creeps.contains(this.id))
            flag.memory.creeps.push(this.id)
    }
};


Creep.prototype.minRoom=function () {
    let task = this.lastTask();
    let obj = this.lastTaskObj();
    if(this.room.name!=task.roomName){
        this.moveTo(task,{visualizePathStyle: {stroke: '#67ffed'}})
    }
};

Creep.prototype.minRoomRecycleCreep=function () {
    if(this.ticksToLive<=1500)this.headTaskObj().recycleCreep(this);
}


Creep.prototype.minRoomUpgrade=function () {
    let flag= Game.flags[this.lastTask().id];
    if(!flag)return;
    if(!this.pos.isEqualTo(flag)) this.moveTo(flag)
    if(this.minRoomAutoBuild()==OK)return;
    this.minRoomAutoPick()
    let spawn = this.room.spawn.filter(e=>e.pos.isNearTo(flag)).head();
    let renew = "ERR"
    if(this.ticksToLive<1480&&((this.lastTask().lastRenewTimes||0)<=3)){//&&((this.lastTask().lastSpawnTime||0)<Game.time)
        renew = spawn.renewCreep(this)
    }
    // this.say(renew)
    if (spawn&&this.pos.isNearTo(spawn)) {
        if(renew=="ERR"){
            this.lastTask().lastRenewTimes = 0
            let task = [UtilsTask.task(spawn,"minRoomRecycleCreep")]
            let energyStructures = this.room[STRUCTURE_EXTENSION]
            StationHive.trySpawn(this.room,this.room.name,[WORK,MOVE],"suicide",task,{directions:[RIGHT],energyStructures:energyStructures})
        }
        if(renew==OK){
            this.lastTask().lastRenewTimes = (this.lastTask().lastRenewTimes||0)+1
        }
        // if(spawn.spawning)this.lastTask().lastSpawnTime = Game.time+1
        let container = this.pos.findInRange(FIND_STRUCTURES,1).filter(e=>e.structureType==STRUCTURE_CONTAINER&&e.store[RESOURCE_ENERGY]).head()
        if(container&&container.hits/container.hitsMax<0.95) this.repair(container);
        else{
            let rampart = spawn.pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType==STRUCTURE_RAMPART).head();
            if(!rampart)spawn.pos.createConstructionSite(STRUCTURE_RAMPART)

            if(this.room.terminal){
                let terminal = this.room.terminal.pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType==STRUCTURE_RAMPART).head();
                if(!rampart)terminal.pos.createConstructionSite(STRUCTURE_RAMPART)
            }

            rampart = this.pos.findInRange(FIND_STRUCTURES,1,{filter:e=>e.structureType==STRUCTURE_RAMPART&&e.my}).maxBy(e=>-e.hits)
            this.repair(rampart)
            // if(rampart&&rampart.hits==rampart.hitsMax&&this.storeUsed()>this.store.getFreeCapacity()){
            //     // let rampart = this.pos.findInRange(FIND_STRUCTURES,3).filter(e=>e.structureType==STRUCTURE_RAMPART).sort(((a, b) => a.hits-b.hits)).head()
            //     this.repair(rampart)
            // }
        }

    }
    this.upgradeController(this.room.controller);
    this.memory.dontPullMe = false;
};

Creep.prototype.minRoomHarvest = function () {
    let flag= this.room.flags("minSizeRoom").head();
    if(!flag||!flag.memory.sourcePos)return;
    let obj = this.lastTaskObj();
    let opos = flag.memory.sourcePos[obj.id].pos
    let pos = new RoomPosition(opos.x,opos.y,this.room.name);
    if((obj.energy+500)/obj.energyCapacity>(obj.ticksToRegeneration||300)/300&&obj.energy){
        this.harvest(obj);
    }
    this.minRoomAutoBuild()
    this.minRoomAutoPick()
    if(!this.pos.isEqualTo(pos)) this.moveTo(pos)
};


Creep.prototype.minRoomAutoBuild = function () {
    if(this.storeUsed()>0&&this.ticksToLive%2==0){
        let target = this.pos.findInRange(FIND_STRUCTURES,1,{filter:e=>e.structureType!=STRUCTURE_SPAWN&&e.structureType!=STRUCTURE_CONTAINER&&e.store&&e.store.getFreeCapacity(RESOURCE_ENERGY)>0}).head()
        if(target) return this.transfer(target,RESOURCE_ENERGY)
        target = this.pos.findInRange(FIND_CONSTRUCTION_SITES,3).head()
        if(target) return this.build(target);
    }
}
Creep.prototype.minRoomAutoPick = function () {
    if(!this.storeFull()){
        let target = this.pos.findInRange(FIND_DROPPED_RESOURCES,1).filter(e=>e.resourceType==RESOURCE_ENERGY).head()
        if(target) return this.pickup(target)
        target = this.pos.findInRange(FIND_TOMBSTONES,1).filter(e=>e.store[RESOURCE_ENERGY]).head()
        if(target) return this.withdraw(target,RESOURCE_ENERGY)
        target = this.pos.findInRange(FIND_STRUCTURES,1).filter(e=>e.structureType==STRUCTURE_CONTAINER&&e.store[RESOURCE_ENERGY]).head()
        if(target) return this.withdraw(target,RESOURCE_ENERGY)
    }
}

// Creep.prototype.build()


let pro = {
    workerBody : ManagerCreeps.calcBodyPart({ [WORK]: 12, [CARRY]: 10, [MOVE]: 12 }),
    findSourceHarvestPos (source){
        let cnt = 0;
        let finalPos = undefined;
        source.pos.nearPos().forEach(pos=>{
            if(pos.walkable()){
                let ableCnt = pos.walkableAroundCnt()
                if(cnt<ableCnt){
                    cnt = ableCnt;
                    finalPos = pos;
                }
            }
        })
        return finalPos;
    },
    generatorSourcePos (room,flag){
        // flag.memory.sourcePos = undefined
        if(!flag.memory.sourcePos){
            let pos1 = pro.findSourceHarvestPos(room.source[0])
            let pos2 = pro.findSourceHarvestPos(room.source[1])

            let exit1 = PathFinder.search(pos1, { pos: flag.pos, range: 0 }).path[0]
            let exit2 = PathFinder.search(pos2, { pos: flag.pos, range: 0 }).path[0]

            flag.memory.sourcePos = {
                [room.source[0].id]:{pos:{x:pos1.x,y:pos1.y},exit:{x:exit1.x,y:exit1.y}},
                [room.source[1].id]:{pos:{x:pos2.x,y:pos2.y},exit:{x:exit2.x,y:exit2.y}}
            }
        }
        // _.values(flag.memory.sourcePos).forEach(e=>{
        //     HelperVisual.showText(room.name,"*",e.pos)
        //     HelperVisual.showText(room.name,"!",e.exit)
        // })
    },
    tryCreateStructs(room,flag){
        new RoomPosition(flag.pos.x,flag.pos.y+1,room.name).createConstructionSite(STRUCTURE_SPAWN)
        if(!room.spawn.length||room.level<2)return;
        if(flag.memory.sourcePos){
            _.values(flag.memory.sourcePos).forEach(e=>{
                // new RoomPosition(e.pos.x,e.pos.y,room.name).nearPos(1)
                //     .filter(p=>(p.x!=e.exit.x||p.y!=e.exit.y)&&p.walkable())
                //     .map(e=>HelperVisual.showText(room.name,"*",e))
                let t = 0;
                new RoomPosition(e.pos.x,e.pos.y,room.name).nearPos(1)
                    .filter(p=>(p.x!=e.exit.x||p.y!=e.exit.y)&&(p.walkable()||p.lookFor(LOOK_STRUCTURES).length||p.lookFor(LOOK_CONSTRUCTION_SITES).length))
                    .take(4)
                    .forEach(p=>{
                        if(t!=0)p.createConstructionSite(STRUCTURE_EXTENSION)
                        else p.createConstructionSite(STRUCTURE_TOWER)
                        t++;
                    })
            })
        }
        // new RoomPosition(flag.pos.x-1,flag.pos.y-1,room.name).createConstructionSite(STRUCTURE_TOWER)
        // new RoomPosition(flag.pos.x-1,flag.pos.y+1,room.name).createConstructionSite(STRUCTURE_TOWER)
        new RoomPosition(flag.pos.x+1,flag.pos.y,room.name).createConstructionSite(STRUCTURE_TOWER)
        new RoomPosition(flag.pos.x-1,flag.pos.y,room.name).createConstructionSite(STRUCTURE_TOWER)
        new RoomPosition(flag.pos.x,flag.pos.y-1,room.name).createConstructionSite(STRUCTURE_TOWER)
        new RoomPosition(flag.pos.x+1,flag.pos.y-1,room.name).createConstructionSite(STRUCTURE_TERMINAL)
        new RoomPosition(flag.pos.x+1,flag.pos.y+1,room.name).createConstructionSite(STRUCTURE_CONTAINER)
    },
    workWithNoRenew (room){
        _.values(room.memory[StationSources.stationName]).filter(e=>Game.getObjectById(e.id).energy)
            .sort((a,b)=>Game.getObjectById(b.id)?Game.getObjectById(b.id).energy-Game.getObjectById(a.id).energy:0) // 如果有视野 按能量多少从大到小排序
            .forEach(data=>{
                // room[data["id"]].pos.findInRange(FIND_STRUCTURES,1).filter(e=>e.structureType = STRUCTURE_WALL).length;
                let posLen = room[data["id"]].pos.nearPos(1).filter(e=>e.walkable()).length
                let targetCnt = posLen*1.5 - room.creeps("minRoomWorker").filter(e=>e.headTask()&&e.headTask().id == data["id"]).length;
                if(Math.min(6,Math.ceil(targetCnt))>0){
                    let creep = room.creeps("minRoomWorker").filter(e=>e.storeEmpty()&&e.isFree()).head()
                    // log(StationWork.getLowLevelWorkerBodyConfig(spawnRoom,false))
                    if(creep)creep.addTask(StationSources.generatorReleaseAbleHarTask(data))
                }
            });

        room.creeps("minRoomWorker").filter(e=>!e.storeEmpty()&&e.isFree()).forEach(creep=>{
            if(StationWork.constructionNeedBuild(creep.mainRoom())){
                creep.addTask(StationWork.generatorBuildTask(creep))
            } else {
                creep.addTask(StationUpgrade.generatorUpgradeTask(room));
            }
        })
    },
    exec (room) {
        let flag = room.flags("minSizeRoom").head();
        let tasks = [UtilsTask.task(room.controller,"minRoom","registerMinRoom")];
        let hostileCnt = room.find(FIND_HOSTILE_CREEPS,{filter:e => e.owner.username != "Invader" && e.body.filter(e=>e.type==HEAL).length >= 5 }).length;
        if(hostileCnt){
            flag.memory.hostileFindTime = Game.time // 如果发现敌人就暂时不生小兵，躲几波
        }
        if (room.creeps("minRoomWorker",false).length < 3 && ((Game.time+room.hashCode())%7==0) && Game.time>(flag.memory.hostileFindTime||0)+1500) {
            // if(!Game.time%3==0)return;
            // let spawnRoom = Game.rooms.E7N18//?Game.rooms.E7N18:StationHive.getClosestSpawnRoom(room,6,6)
            let spawnRoom = StationHive.getClosestSpawnRoom(room,6,6)//Game.rooms.W8N7//?Game.rooms.W8N7:StationHive.getClosestSpawnRoom(room,6,6)
            // if(!spawnRoom)spawnRoom = Game.rooms.E7N18
            if(!spawnRoom){
                log("no active able room");
                return;
            }
            // log(spawnRoom.name)
            StationHive.trySpawn(spawnRoom,room.name,pro.workerBody,"minRoomWorker", tasks)
        }
        flag.memory.creeps = flag.memory.creeps || []
        flag.memory.creeps = flag.memory.creeps.filter(id=>Game.getObjectById(id))
        let creeps = flag.memory.creeps.map(id=>Game.getObjectById(id)).filter(e=>e.room.name == room.name).sort((a,b)=>b.ticksToLive-a.ticksToLive)
        pro.generatorSourcePos(room,flag);
        if(Game.time%30==0){ 
            pro.tryCreateStructs(room,flag);
        }
        if(room.level<2||!room.spawn.length){//room.constructionSite.length||
            creeps.filter(e=>e.headTask()&&e.headTask().taskName=="minRoom").forEach(e=>e.memory.tasks = [])
            pro.workWithNoRenew(room)
            return;
        }
        let needExchange = creeps.filter(e=>e.memory.tasks.length!=2).length
        if((Game.time+room.hashCode())%600==0||needExchange){//交换任务
            let source = room.source.sort((a,b)=> a.id.localeCompare(b.id))
            if(creeps.length>=1){
                creeps.head().memory.tasks = [tasks[0],UtilsTask.task(source[0],"minRoomHarvest")]
            }
            if(creeps.length==3){
                creeps[1].memory.tasks = [tasks[0],UtilsTask.task(source[1],"minRoomHarvest")]
            }
            if(creeps.length>1){
                creeps.last().memory.tasks = [tasks[0],UtilsTask.taskFlag(flag,"minRoomUpgrade")]
            }
        }
    }
}


global.StrategyMinSizeRoom=pro;
