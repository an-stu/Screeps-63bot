/**
 * GCLRoom_W7N3_OPF4
 * GCLRoom_E4N1_OPF2a_right
 * GCLRoom_W3N6_OPF3_right
 * GCLRoom_E15N9_s2OPF4b_right
 * GCLRoom_{主房间,从哪里生爬的,PC_NAME,spawn方向}
 *
 * flag.memory.maxUpgraderCnt
 *
 * 空转大概消耗 1 cpu ，特色房间，不优化
 */




Creep.prototype.RegisterGCLCenterCarrier = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    flag.centerCarrier = this
}
let BOOST_HIGH_LEVEL = {
    GH2O:"XGH2O",
    GH:"GH2O"
}
Creep.prototype.GCLCenterCarrier = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    if(!this.pos.isEqualTo(flag.pos))
        this.moveTo(flag)
    else{
        this.memory.dontPullMe = true;
        if(this.ticksToLive<1200&&this.room.level>=6){
            let sps = this.pos.findInRange(FIND_MY_SPAWNS,1,{filter:e=>!e._renew})
            sps.forEach(sp=>{if(sp.renewCreep(this)==OK){sp._renew=1}})
        }
        let storage = this.room.storage
        let terminal = this.room.terminal
        if(!storage||!terminal)return;

        let tower = flag.room.tower.head()
        if(tower&&tower.store[RESOURCE_ENERGY]<500&&flag.room.level>=3){
            let ops = {resType: RESOURCE_ENERGY}
            return this.addTaskAndExec([UtilsTask.task(tower, "fillRes", "registerUsed",ops),
                UtilsTask.task(storage, "carryRes", "registerUsed",ops)])
        }

        if(!this.store.isEmpty()){
            this.fillAll(this.room.terminal)
        }

        let lab = flag.room.lab.head()
        if(lab&&flag.room.level>=6&&Game.time%3==0){
            let room = flag.room
            let resType = lab.store.getLabReactionResType()
            if(resType){
                if(lab.store[resType]+(terminal.store[resType]||0)<3000||(BOOST_HIGH_LEVEL[resType]&&terminal.store[BOOST_HIGH_LEVEL[resType]]>3000)){
                    let ops = {resType: resType,resCount:lab.store.getUsedCapacity(resType)}
                    return this.addTaskAndExec([UtilsTask.task(terminal, "fillRes", "registerUsed",ops),
                        UtilsTask.task(lab, "carryRes", "registerUsed",ops)])
                }else if(lab.store.getFreeCapacity(resType)>0){
                    let ops = {resType: resType,resCount:lab.store.getFreeCapacity(resType)}
                    return this.addTaskAndExec([UtilsTask.task(lab, "fillRes", "registerUsed",ops),
                        UtilsTask.task(terminal, "carryRes", "registerUsed",ops)])
                }
            }else {
                let boostRes = ["XGH2O","GH2O","GH"].find(e=>StationCarry.roomMassStoreCnt(room,e)>=3000)
                if(boostRes){
                    let ops = {resType: boostRes,resCount:lab.store.getFreeCapacity(boostRes)}
                    return this.addTaskAndExec([UtilsTask.task(lab, "fillRes", "registerUsed",ops),
                        UtilsTask.task(terminal, "carryRes", "registerUsed",ops)])
                }

            }
            if(lab.store.getFreeCapacity(RESOURCE_ENERGY)>0){
                let ops = {resType: RESOURCE_ENERGY,resCount:lab.store.getFreeCapacity(RESOURCE_ENERGY)}
                return this.addTaskAndExec([UtilsTask.task(lab, "fillRes", "registerUsed",ops),
                    UtilsTask.task(terminal, "carryRes", "registerUsed",ops)])
            }
        }

        if(storage.store.getFreeCapacity(RESOURCE_ENERGY)>2000&&terminal.store[RESOURCE_ENERGY]>100000){
            let ops = {resType: RESOURCE_ENERGY}
            return this.addTaskAndExec([UtilsTask.task(storage, "fillRes", "registerUsed",ops),
                UtilsTask.task(terminal, "carryRes", "registerUsed",ops)])
        }

        if(storage.store[RESOURCE_ENERGY]>300000&&terminal.store[RESOURCE_ENERGY]<94000&&terminal.store.getFreeCapacity(RESOURCE_ENERGY)>2000){
            let ops = {resType: RESOURCE_ENERGY}
            return this.addTaskAndExec([UtilsTask.task(terminal, "fillRes", "registerUsed",ops),
                UtilsTask.task(storage, "carryRes", "registerUsed",ops)])
        }


        let sp = this.pos.findInRange(FIND_MY_SPAWNS,1,{filter:e=>!e._renew}).head()
        if(sp&&flag.room.level>=1&&sp.store.getFreeCapacity(RESOURCE_ENERGY)>200){
            let ops = {resType: RESOURCE_ENERGY}
            return this.addTaskAndExec([UtilsTask.task(sp, "fillRes", "registerUsed",ops),
                UtilsTask.task(terminal, "carryRes", "registerUsed",ops)])
        }

    }

}

Creep.prototype.RegisterGCLClaim = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    flag.memory.claimer = this.id
}

Creep.prototype.GCLClaim = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    if(this.room.name!=flag.pos.roomName)
        this.moveTo(flag)
    else{
        if(flag.room.my&&flag.room.level>=7&&this.pos.isNearTo(flag.room.controller))flag.room.controller.unclaim()
        this.moveTo(flag.room.controller)
        this.claimController(flag.room.controller);
        if(flag.room.level>=1&&flag.room.level<=6)this.suicide();
    }

}

Creep.prototype.RegisterGCLUpgraderNoStorage = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    if(!flag.memory.upgrader)flag.memory.upgrader = []
    if(!flag.memory.upgrader.contains(this.id))
        flag.memory.upgrader.push(this.id)
}

Creep.prototype.GCLUpgraderNoStorage = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    if(this.room.name!=flag.pos.roomName){
        this.moveTo(flag)
        this.memory.dontPullMe = true;
    }else {
        if(this.memory.gclPos){
            let gclPos = new RoomPosition(this.memory.gclPos.x,this.memory.gclPos.y,this.memory.gclPos.roomName)
            if(this.pos.inRangeTo(gclPos,1)){
                if(!this.pos.isEqualTo(gclPos)){
                    this.moveTo(gclPos)
                }
            }else delete this.memory.gclPos;
        }
        else if(!this.pos.isNearTo(this.room.storage)||!this.pos.isNearTo(this.room.terminal))this.moveTo(flag)

        if(this.room.level>=8)return this.memory.dontPullMe = false;

        this.upgradeController(this.room.controller);

        let dropRes = this.pos.findInRange(FIND_DROPPED_RESOURCES,1,{filter:e=>e.resourceType==RESOURCE_ENERGY}).head();
        this.pickup(dropRes);

        let cs = this.pos.findInRange(FIND_CONSTRUCTION_SITES,3,{filter:e=>e.my}).head()
        this.build(cs);

        if(this.ticksToLive<1495&&this.memory.renewAble){
            let renewCnt = (flag.memory.upgrader||[]).map(e=>Game.getObjectById(e)).filter(e=>e&&e.memory.renewAble).length
            let carrierBlock = flag.centerCarrier&&flag.centerCarrier.ticksToLive<200
            if(!carrierBlock)this.pos.findInRange(FIND_MY_SPAWNS,1,{filter:e=>!e._renew})
                .sort((a,b)=>b.pos.getRangeTo(flag.pos)-a.pos.getRangeTo(flag.pos))
                .take(renewCnt>=2?1:3)
                .forEach(sp=>{if(sp.renewCreep(this)==OK){sp._renew=1}})
        }else if(this.memory.renewAble){
            let lab = flag.room.lab.head()
            if(lab)lab.boostCreep(this);
            delete this.memory.renewAble
        }


        let sp = this.pos.findInRange(FIND_MY_SPAWNS,1,{filter:e=>!e._filled&&e.store.getFreeCapacity(RESOURCE_ENERGY)>50}).head()
        let isTransfer = false
        if(sp){
            isTransfer = this.transfer(sp,RESOURCE_ENERGY) == OK
        }
        if(this.store[RESOURCE_ENERGY]<=50||isTransfer){
            if (this.withdraw(this.room.storage, RESOURCE_ENERGY) != OK) {
                this.withdraw(this.room.terminal, RESOURCE_ENERGY)
            }
        }

        if(Game.time%3==0)this.memory.dontPullMe = false;
    }
}


Creep.prototype.RegisterGCLCarrier = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    // if(this.storeEmpty()){
    //     let creep = this.pos.findInRange(FIND_MY_CREEPS,1,
    //         {filter:e=>e.id!=this.id&&e.storeFull()&&!e._swap&&e.memory.role==this.memory.role}).head()
    //     if(creep){
    //         creep.transfer(this,RESOURCE_ENERGY)
    //         let tmp2=creep.store[RESOURCE_ENERGY]
    //         creep.store[RESOURCE_ENERGY]=this.store[RESOURCE_ENERGY]
    //         this.store[RESOURCE_ENERGY]=tmp2
    //         let tmp = creep.memory.tasks
    //         creep.memory.tasks = this.memory.tasks
    //         this.memory.tasks = tmp
    //         creep._swap = true;
    //         this._swap = true;
    //     }
    // }
    if(!flag.memory.carrier)flag.memory.carrier = []
    if(!flag.memory.carrier.contains(this.id))
        flag.memory.carrier.push(this.id)
}

Creep.prototype.GCLCarrier = function(){
    let flag= Game.flags[this.headTask().id];
    if(!flag)return;
    let spawnRoom = flag.getRoom();
    if(this.storeEmpty())
        this.addTask(UtilsTask.task(spawnRoom.storage,"carryRes",undefined,{resType: RESOURCE_ENERGY}))
    // if(spawnRoom.terminal)this.addTask(UtilsTask.task(spawnRoom.terminal,"carryRes",undefined,{resType: RESOURCE_ENERGY}))
    else if(this.room.name!=flag.pos.roomName)
        this.moveTo(flag)
    else {
        // if(!this.pos.inRangeTo(flag,4)){
        //     this.moveTo(flag)
        //     // if(this.room.storage&&this.room.level>=4)
        //     //     this.addTask(UtilsTask.task(this.room.storage,"fillAllTask"))
        //     // else {
        //     // }
        // }
        let creep = (!this.room.storage||this.room.level<4)&&this.pos.findClosestByRange(FIND_MY_CREEPS,{filter:e=>!e._vis&&e.store&&e.store.getFreeCapacity(RESOURCE_ENERGY)>50&&e.memory.role==pro.upgraderRole})
        if(!creep)creep = this.pos.findInRange(FIND_MY_STRUCTURES,50,{filter:e=>!e._vis&&e.store&&e.store.getFreeCapacity(RESOURCE_ENERGY)>50})
            .sort((a,b)=>a.store[RESOURCE_ENERGY]-b.store[RESOURCE_ENERGY]).head()
        if(creep){
            let result = this.transfer(creep,RESOURCE_ENERGY)
            if(result==ERR_NOT_IN_RANGE)this.moveTo(creep)
            else if(result==OK)creep._vis= 1
        }else if(!this.pos.inRangeTo(flag,4)){
            this.moveTo(flag)
        }
    }
}

let pro = {
    createStructs(flag){
        let rotate = flag.getNameSplit()[3]
        if(rotate=="top")rotate = 1
        if(rotate=="right")rotate = 3
        if(rotate=="bottom")rotate = 5
        if(rotate=="left")rotate = 7

        flag._labPos =       flag.pos.getDirectPos(rotate)
        flag._spawnPos =     flag.pos.getDirectPos(((rotate-1)+7)%8 + 1)
        flag._spawnPos2 =    flag._spawnPos.getDirectPos(((rotate-1)+6)%8 + 1)
        flag._towerPos =     flag.pos.getDirectPos(((rotate-1)+1)%8 + 1)
        flag._storagePos =   flag.pos.getDirectPos(((rotate-1)+5)%8 + 1)
        flag._terminalPos =  flag.pos.getDirectPos(((rotate-1)+3)%8 + 1)
        flag._terminalPos2 = flag._terminalPos.getDirectPos(((rotate-1)+2)%8 + 1)
        // HelperVisual.showText(flag._labPos,structuresShape[STRUCTURE_LAB])
        // HelperVisual.showText(flag._spawnPos,structuresShape[STRUCTURE_SPAWN])
        // HelperVisual.showText(flag._spawnPos2,structuresShape[STRUCTURE_SPAWN])
        // HelperVisual.showText(flag._towerPos,structuresShape[STRUCTURE_TOWER])
        // HelperVisual.showText(flag._storagePos,structuresShape[STRUCTURE_STORAGE])
        // HelperVisual.showText(flag._terminalPos,structuresShape[STRUCTURE_TERMINAL])

        let possA = flag._storagePos.nearPos()
        let possB = flag._terminalPos.nearPos()
        possA.forEach(a=>possB = possB.filter(b=>!a.isEqualTo(b)))
        flag._poss = possA.concat(possB)
            .filter(e=>!e.isEqualTo(flag.pos))
            .map(e=>[e,e.getRangeTo(flag._spawnPos)*10+e.getRangeTo(flag.pos)+(
                e.getRangeTo(flag._spawnPos)>1?1000+e.getRangeTo(flag._terminalPos2) * -100:0
            )])
            .sort((a,b)=>a[1]-b[1]).map(e=>e[0])
        // let i = 0;
        // flag._poss.forEach(e=>HelperVisual.showText(e,i++))

        if(Game.time%61==0){//61是质数 和 3 一起变成 183 tick 检查一次
            ManagerAutoPlanner.tryCreateCons(flag._towerPos,   STRUCTURE_TOWER   )
            ManagerAutoPlanner.tryCreateCons(flag._storagePos, STRUCTURE_STORAGE )
            flag.room.storage&&flag._poss.forEach(e=>ManagerAutoPlanner.tryCreateCons(e,STRUCTURE_ROAD))
            if(flag.room.level>=6){
                ManagerAutoPlanner.tryCreateCons(flag._terminalPos,STRUCTURE_TERMINAL)
                if(flag.room.terminal)  ManagerAutoPlanner.tryCreateCons(flag._labPos,     STRUCTURE_LAB     )
                if(flag.room.lab.length)ManagerAutoPlanner.tryCreateCons(flag._spawnPos,   STRUCTURE_SPAWN   )
                if(flag.room.lab.length)ManagerAutoPlanner.tryCreateCons(flag._spawnPos2,  STRUCTURE_SPAWN   )
            }
        }

    },
    getUpgraderCntNeed(flag,room){
        if(room._upgraderCntNeed!==undefined){
            let upgraderCntNeed = room.storage?(room.storage.store[RESOURCE_ENERGY]/70000):2
            if(room.level>=8)upgraderCntNeed = 0
            // else if(room.level>=7&&flag.centerCarrier)upgraderCntNeed = Math.min(upgraderCntNeed,12)
            else if(room.level>=6&&flag.centerCarrier)upgraderCntNeed = Math.min(upgraderCntNeed,12)
            else upgraderCntNeed = Math.min(upgraderCntNeed,room.isPowerEnabled?7:6)
            room._upgraderCntNeed = Math.min(flag.memory.maxUpgraderCnt||12,upgraderCntNeed)
        }
        return room._upgraderCntNeed
    },
    execSpawn (flag) {
        let room = flag.room;
        let spawnRoom = flag.getRoom();
        if(!spawnRoom)throw Error(flag.getRoomName()+" error : "+flag.name)
        if(spawnRoom.creeps("carrier").length==0)return;

        let energyHold = 900000// 至少要保持住这么多能量才unclaim


        flag.memory.upgrader=(flag.memory.upgrader||[]).filter(e=>Game.getObjectById(e))
        flag.memory.carrier=(flag.memory.carrier||[]).filter(e=>Game.getObjectById(e))
        let upgraderCnt = flag.memory.upgrader.map(e=>Game.getObjectById(e)).filter(e=>room.level>=6||(e.ticksToLive||1500)>150).length
        let carrierCnt = flag.memory.carrier.map(e=>Game.getObjectById(e)).filter(e=>room.level>=6||(e.ticksToLive||1500)>150).length

        let pc = Game.powerCreeps[flag.getNameSplit()[2]]
        if (pc&&pc.ticksToLive>500&&pc.isFree()) {
            if(pc.powers[PWR_OPERATE_STORAGE])energyHold = 2500000
            if(room&&room.my&&!room.controller.isPowerEnabled){
                if(upgraderCnt<=6||room.level>=5)pc.addTask(UtilsTask.task(room.controller,"roomPowerEnable"))
            }
            else if(room.controller.isPowerEnabled&&room.level>=6&&room.storage&&room.terminal&&room.storage.store[RESOURCE_ENERGY]>900000
                &&pc.powers[PWR_OPERATE_STORAGE]&&pc.powers[PWR_OPERATE_STORAGE].cooldown==0
                &&pc.store[RESOURCE_OPS]>=100){
                pc.addTask(UtilsTask.task(pc.mainRoom().storage,"goToNearPop"))
                pc.addTask(UtilsTask.task(room.storage,"OpStorage"))
            }
        }

        if(!room||!room.my||room.level==8||(room.level==7&&room.controller.progressTotal-room.controller.progress<80000)){
            let claimer = Game.getObjectById(flag.memory.claimer)
            if(!claimer&&(!room.storage||room.storage.store[RESOURCE_ENERGY]>energyHold)) {
                let tasks = [UtilsTask.taskFlag(flag,  "GCLClaim","RegisterGCLClaim")]
                StationHive.trySpawn(spawnRoom,spawnRoom.name,pro.claimer,pro.ClaimerRole,tasks)
            }
            // return;
        }

        if(room){
            if (!flag.centerCarrier&&room.level>=6&&room.terminal&&room.storage){
                let tasks = [UtilsTask.taskFlag(flag,  "GCLCenterCarrier","RegisterGCLCenterCarrier")]
                StationHive.trySpawn(spawnRoom,spawnRoom.name,pro.centerCarrier,pro.carrierRole,tasks)
            }

            let carrierCntNeed = (!room.storage)?upgraderCnt*3:(3 - room.storage.store[RESOURCE_ENERGY]/100000)*3
            if(room.level>=6&&room.terminal)carrierCntNeed=0;
            if(!room.terminal&&carrierCnt<carrierCntNeed){
                let tasks = [UtilsTask.taskFlag(flag,  "GCLCarrier","RegisterGCLCarrier")]
                StationHive.trySpawn(spawnRoom,spawnRoom.name,pro.carrier,pro.carrierRole,tasks)
            }

            if((flag.memory.lastSpawnUpgrade||0)<Game.time&&upgraderCnt<pro.getUpgraderCntNeed(flag,room)){
                let tasks = [UtilsTask.taskFlag(flag,  "GCLUpgraderNoStorage","RegisterGCLUpgraderNoStorage")]
                let boostLevel = -1;
                let outRoomBoost = room.level>=6&&room.lab.length>=1;
                let body = outRoomBoost?pro.highLevelUpgrade:pro.lowerLevelUpgrade;
                let partCnt=body.filter(e=>e==WORK).length;
                if(spawnRoom.storage&&!outRoomBoost)boostLevel = StationLab.boostAbleLevel(spawnRoom,"upgradeController",partCnt,2);
                if(boostLevel>=0)tasks = tasks.concat(StationLab.generatorBoostLevelTask(spawnRoom,"upgradeController",partCnt,boostLevel))
                if(StationHive.trySpawn(spawnRoom,spawnRoom.name,body,pro.upgraderRole,tasks)){
                    flag.memory.lastSpawnUpgrade=Game.time+100
                }
            }
        }
        // StationHive.trySpawn(flag.room,spawnRoom.name,pro.crossTradeBody,"crossTrade",task))
    },
    movePos(flag){
        if(!flag.room)return;
        let poss = flag._poss
        let renewCnt = flag.room.level>=6?(flag.room.level>=7?2:1):0
        if (flag.room.lab.length == 0) renewCnt = 0;// 如果没有lab就不要renew了
        let getTTL = (a)=>(a.ticksToLive<12||!a.body.head().boost||a.memory.renewAble)?(a.memory.renewAble?-2000:-a.ticksToLive):a.ticksToLive
        let upgrader = (flag.memory.upgrader||[]).map(e=>Game.getObjectById(e))
            .filter(e=>e&&e.pos.inRangeTo(flag._storagePos,2)||e&&e.pos.inRangeTo(flag._terminalPos,2))
            .sort((a,b)=>getTTL(a)-getTTL(b))

        // if(upgrader.length){//pro.getUpgraderCntNeed(flag,flag.room)+2>=
            for(let i=0;i<Math.min(upgrader.length,renewCnt);i++){
                if(upgrader[i].getPartCnt(WORK)>35&&(upgrader[i].ticksToLive<12||!upgrader[i].body.head().boost))
                    upgrader[i].memory.renewAble = i==0||(i<=1&&upgrader[i].ticksToLive<7);
            }
        // }

        let set = new Set(poss.map(e=>e.hashCode()))
        if(upgrader.find(e=>!set.has(e.pos.hashCode()))){
            bipartiteGraphMatching(upgrader.reverse(),poss,(a,b)=>a.pos.isNearTo(b))
                .forEach(e=>e[0] && (e[0].memory.gclPos = e[1]))
        }else {
            for(let i=0;i<upgrader.length;i++) upgrader[i].p = i
            let nextPosHashMap = {}
            for(let i=1;i<poss.length;i++)
                for(let j=0;j<i;j++)
                    if(poss[i].isNearTo(poss[j]))nextPosHashMap[poss[i].hashCode()]=poss[j]
            let creepHashMap = {}
            upgrader.forEach(e=>creepHashMap[e.pos.hashCode()] = e)

            let i = 0;
            upgrader.find(e=>{
                let nextPos = nextPosHashMap[e.pos.hashCode()];
                let nextCreep = creepHashMap[nextPos&&nextPos.hashCode()]
                if(nextCreep&&e.p<nextCreep.p){
                    e.memory.gclPos=nextCreep.pos
                    nextCreep.memory.gclPos=e.pos
                    return true
                }else if(!nextCreep&&nextPos){
                    e.memory.gclPos=nextPos
                    return true
                }
            })
        }
    },
    terminalProcess(flag,fromRoom){
        let room = flag.room;
        if(!room.terminal||room.level<6)return;

        let boostRes = ["XGH2O","GH2O","GH"].filter(e=>StationCarry.roomMassStoreCnt(room,e)<32000)
        let sentTime = 0;

        let targetRooms = ManagerRooms.getNormalRoom().filter(e=>e.name!=room.name&&e.terminal)
            .map(e=>[e,Game.map.getRoomLinearDistance(e.name,room.name, true)])
            .sort((a,b)=>a[1]-b[1]).map(e=>e[0])

        let avoid = new Set(["XGH2O","GH2O","GH","energy"])
        room.terminal.store.getResTypeList().filter(e=>!avoid.has(e))
            .forEach(e=> room.terminal.send(e,room.terminal.store[e],fromRoom.name))


        targetRooms.filter(e=>!e.terminal._send).forEach(targetRoom=>{
            if(sentTime>7)return;
            boostRes.find(resType=>{
                let resCnt = StationCarry.roomMassStoreCnt(targetRoom,resType)
                if(resCnt>6000){
                    targetRoom.terminal.send(resType,Math.min(resCnt-6000,targetRoom.terminal.store[resType]),room.name);
                    sentTime+=1
                }
            })
        });

        sentTime = 0;
        let myRoomEnergyCnt = StationCarry.roomMassStoreCnt(room,RESOURCE_ENERGY)
        if(room.terminal.store[RESOURCE_ENERGY]<150000){
            targetRooms.filter(e=>Game.map.getRoomLinearDistance(e.name,room.name, true)<=12&&!e.terminal._send).map(fromRoom=>{
                if(sentTime>7)return;
                let energyCnt = StationCarry.roomMassStoreCnt(fromRoom,RESOURCE_ENERGY)
                if(energyCnt>300000||myRoomEnergyCnt<300000&&energyCnt>150000){
                    fromRoom.terminal.send(RESOURCE_ENERGY,20000,room.name);
                    sentTime+=1
                }
            });
        }
    },
    autoBuyGCLEnergyBoost(flag) {
        let room = flag.room
        if(!room||(flag.memory.lastVis||0)>Game.time-30)return;
        if(!room.terminal||!room.level>=6)return;
        flag.memory.lastVis = Game.time;
        let avg = StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)
        // let energyCnt = StationCarry.roomMassStoreCnt(Game.rooms[e.roomName],RESOURCE_ENERGY)
        let myOrder = _.values(Game.market.orders)
            .filter(e=>e.remainingAmount&&e.resourceType=="energy"&&e.type==ORDER_BUY)
            .find(e=>e.roomName==room.name)

        if(!flag.memory.energyPrice)flag.memory.energyPrice=avg// 初始化价格

        let storage = room.storage;
        let needAddPrice = ((storage.store.getFreeCapacity(RESOURCE_ENERGY)-100000) / storage.store.getCapacity(RESOURCE_ENERGY))
        if(needAddPrice>0)needAddPrice = needAddPrice/10
        if(!myOrder){
            if(storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000&&room.terminal.store.getFreeCapacity(RESOURCE_ENERGY)>50000)// 如果还有剩余空间
                Game.market.createOrder({
                    type: ORDER_BUY,
                    resourceType: RESOURCE_ENERGY,
                    price: flag.memory.energyPrice*(needAddPrice>0?0.97:0.94),
                    totalAmount: 50000,
                    roomName: room.name,
                })
        }else if(needAddPrice>0&&room.terminal.store.getFreeCapacity(RESOURCE_ENERGY)>10000){
            let newPrice = Math.min(myOrder.price*(1+needAddPrice),avg*2);
            Game.market.changeOrderPrice(myOrder.id,newPrice)
            flag.memory.energyPrice = newPrice
        }

        // let boostRatios = [["XGH2O",1],["GH2O",0.8],["GH",0.5]]
        // let rooms = [room,flag.getRoom()]
        // if(!Game.market.dealed)Game.market.dealed = {}
        // rooms.forEach(r=>{
        //     boostRatios.find(e=>{
        //         let resType = e[0]
        //         if(StationCarry.roomMassStoreCnt(r,resType)<38000){
        //             let boostRatio = e[1]
        //             let dealPrice = flag.memory.energyPrice*1450*boostRatio/30
        //             let orders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: resType});
        //             let minPrice = 1e5;
        //             let myRoom = r.name;
        //             let minOrder = undefined;
        //             for (let order of orders) {
        //                 if(Game.market.dealed[order.id])continue;
        //                 let energyNeed = Game.market.calcTransactionCost(order.remainingAmount, myRoom, order.roomName);
        //                 let totalPrice = energyNeed * flag.memory.energyPrice + order.remainingAmount * order.price;
        //                 let price = totalPrice / order.remainingAmount;
        //                 if (price < minPrice) {
        //                     minOrder = order;
        //                     minPrice = price;
        //                 }
        //             }
        //             log(minPrice);
        //             if (minPrice<dealPrice&&minOrder) {
        //                 minOrder.price = 1e5;
        //                 let code = Game.market.deal(minOrder.id, Math.min(r.terminal.store[RESOURCE_ENERGY], minOrder.remainingAmount,10000), myRoom);
        //                 console.log("buy GCL : ", r.name, resType, minOrder.remainingAmount, minPrice, minOrder.id, code);
        //                 Game.market.dealed[minOrder.id] = true;
        //                 return code==OK
        //             }
        //         }
        //     })
        // })
    },
    lowerLevelUpgrade:ManagerCreeps.calcBodyPart([ [WORK,32],[CARRY,2],[MOVE,16]]),
    highLevelUpgrade:ManagerCreeps.calcBodyPart([ [WORK,42],[CARRY,2],[MOVE,6]]),
    carrier:ManagerCreeps.calcBodyPart([ [CARRY,25],[MOVE,25]]),
    centerCarrier:ManagerCreeps.calcBodyPart([ [CARRY,40],[MOVE,1]]),
    claimer:ManagerCreeps.calcBodyPart([ [CLAIM,1],[MOVE,1]]),
    carrierRole:"GCLCarrier",
    centerCarrierRole:"GCLCenterCarrier",
    upgraderRole:"GCLUpgrader",
    ClaimerRole:"GCLClaimer",
    exec (room) {
        let flag = room.flags("GCLRoom").head()
        let fromRoom = Game.rooms[flag.getRoomName()];
        if(!fromRoom){console.log("命名错误,GCLRoom_{主房间,从哪里生爬的}_{PC/带有storage的(3M以上的)}");return;}
        if((Game.time+fromRoom.hashCode())%3!=0)return;
        pro.createStructs(flag)
        pro.movePos(flag)
        pro.terminalProcess(flag,fromRoom);
        pro.execSpawn(flag)
        if(Game.shard.name.startsWith("shard"))pro.autoBuyGCLEnergyBoost(flag)
        // if(!room.storage||!room.terminal){
        // }if(room.level<6){
        // }else if(room.level<8){
        //
        // }else if(room.level==8){
        //
        // }
    }
}


global.StrategyGCLRoom=pro;
