/**
 * blockRoom_mainRoom_n
 * blockRoom_W4N2_1
 * blockRoom_E53S21_1
 */


Creep.prototype.registerBlockRoom=function () {
    pro.aliveCreep=this.id
};
Creep.prototype.registerBlockRoom2=function () {
    pro.aliveCreep2=this.id
};


Creep.prototype.BlockRoom=function () {
    let headTask = this.headTask();
    let flag = Game.flags[headTask.id];
    if(!flag)return this.popTask();

    if(this.pos.roomName!=flag.pos.roomName){
        return this.moveTo(flag)
    }

    if(this.getPartCnt(CLAIM)){
        if(!this.room.my){
            return this.addTaskAndExec(UtilsTask.taskFlag(flag,"claimRoom"))
        }else{
            this.suicide();
        }
        return ;
    }

    if(this.storeEmpty()){
        let source = this.pos.findClosestByPath(FIND_SOURCES)
        return this.addTaskAndExec(UtilsTask.task(source,"harvestEnergy"))
    }

    if(this.room.level<2){
        let code = this.upgradeController(this.room.controller);
        if(code==ERR_NOT_IN_RANGE && this.ticksToLive%3==0)this.moveTo(this.room.controller,{range:3});
    }

    if(this.pos.findInRange(FIND_SOURCES,1).length){
        return this.moveTo(flag.room.randomPosition())
    }

    let cs = this.room.find(FIND_MY_CONSTRUCTION_SITES)
    if(cs.length){
        this.moveTo(cs.head())
        this.build(cs.head())
        return ;
    }

    let objs = [this.room.controller].concat(this.room.find(FIND_SOURCES))
    for(let obj of objs){
        if(obj.pos.walkableAroundCnt()){
            // log(obj.pos.nearPos(1).filter(e=>e.walkable(false)).map(e=>e.createConstructionSite(STRUCTURE_WALL)))
            obj.pos.nearPos(1).filter(e=>e.walkable(false))
                .forEach(e=>e.createConstructionSite(STRUCTURE_WALL))
            return ;
        }
    }

    // log("room blocked : "+flag.room.name)
    this.suicide();
    if (flag.room.level <= 2) {
        flag.room.controller.unclaim();
    }
    flag.remove();
}

let pro = {
    aliveCreep:"",
    aliveCreep2:"",
    spawnTime:0,
    exec () {
        if(Game.time%10!=0)return;
        if(!ManagerFlags.hasPrefix("blockRoom"))return;
        ManagerFlags.getFlagsByPrefix("blockRoom").take(1).forEach(flag=>{
            if(!Game.getObjectById(pro.aliveCreep)&&pro.spawnTime!=Game.time&&(!flag.room||!flag.room.my)){
                let body = ManagerCreeps.calcBodyPart({  [CLAIM]: 1 ,[MOVE]: 2 })
                if(StationHive.trySpawn(flag.getRoom(1),flag.getRoomName(),body,"BlockRoom",[UtilsTask.taskFlag(flag,"BlockRoom","registerBlockRoom")])){
                    pro.spawnTime=Game.time
                }
            }
            if(!Game.getObjectById(pro.aliveCreep2)&&pro.spawnTime!=Game.time){
                let body = ManagerCreeps.calcBodyPart({  [WORK]: 5 ,[CARRY]: 5 ,[MOVE]: 10 })
                if(StationHive.trySpawn(flag.getRoom(1),flag.getRoomName(),body,"BlockRoom",[UtilsTask.taskFlag(flag,"BlockRoom","registerBlockRoom2")])){
                    pro.spawnTime=Game.time
                }
            }


        });
    }
}


global.StrategyBlockRoom=pro;
