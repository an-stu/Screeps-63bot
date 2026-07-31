
Creep.prototype.moveCrossShardByRoomName = function(){
    let path = this.lastTask().path
    let task = this.lastTask()
    task.index = task.index||0;
    for(let i=0;i<path.length;i++){
        let e = path[i]
        if(e.roomName == this.pos.roomName&& e.shard == Game.shard.name){
            task.index = i ;
        }
    }

    let current = path[task.index];
    if(task.index==path.length) return this.popTask().execLastTask();

    let pos = new RoomPosition(25,25,current.roomName)
    if(this.pos.roomName==current.roomName){
        let tmp = this.room.find(FIND_STRUCTURES).find(e=>e.structureType==STRUCTURE_PORTAL&&e.destination.shard==current.toShard&&
            (!current.toRoomName||e.destination.room==current.toRoomName))
        if(tmp) pos = tmp.pos
        else console.log(this.name+" moveCrossShardByRoomName path error : "+JSON.stringify(current))
    }
    if(pos.isNearTo(this)){
        let portal = pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType==STRUCTURE_PORTAL).head()
        if(portal) task.index += 1
        if(portal&&portal.destination&&portal.destination.shard){ //传送门是跨shard的情况下
            this.submitCrossShardCreepMemory(portal.destination.shard,this.memory)
        }
    }
    this.goTo(pos) //先交换内存再走路,防止cpu用完了
}

//路径
global.tradePathData = {}
global.tradePathData["s2-s1-p1"]= { path:
        [ { shard: 'shard2', roomName: 'E20N10',toShard:'shard1', toRoomName: 'E20N10' }]
}

global.tradePathData["s1-s2-p1"]= { path:
        [ { shard: 'shard1', roomName: 'E20N10',toShard:'shard2', toRoomName: 'E20N10' }]
}


global.tradePathData["s2-s3-p1"]= { path:
        [ { shard: 'shard2', roomName: 'E20N10',toShard:'shard3', toRoomName: 'E20N10' }]
}

global.tradePathData["s3-s2-p1"]= { path:
        [ { shard: 'shard3', roomName: 'E20N10',toShard:'shard2', toRoomName: 'E20N10' }]
}



global.tradePathData["s2-s0-p1"]= { path:
        [ { shard: 'shard2', roomName: 'E20N10',toShard:'shard1', toRoomName: 'E20N10' },
            { shard: 'shard1', roomName: 'E20N10',toShard:'shard0', toRoomName: 'E40N10' }]
}

global.tradePathData["s0-s2-p1"]= { path:
        [ { shard: 'shard0', roomName: 'E40N10',toShard:'shard1', toRoomName: 'E20N10' },
            { shard: 'shard1', roomName: 'E20N10',toShard:'shard2', toRoomName: 'E20N10' }]
}

// global.tradePathData["test1"]= { path:
//         [ { shard: '6g3y-station', roomName: 'W10N10',toShard:'6g3y-station' }]
// }


let resList = null
if(Game.shard.name=="shard0") resList = ["power","H","alloy"];//,"X"
if(Game.shard.name=="shard1") resList = ["H","reductant"];//,"X"
if(Game.shard.name=="shard2") resList = ["machine"]
if(Game.shard.name=="shard3") resList = ["power","H","condensate"]
let resList2 = null
if(Game.shard.name=="shard0") resList2 = ["L","Z","U","K","O"];
if(Game.shard.name=="shard1") resList2 = ["O","H","L"];//,"X"
if(Game.shard.name=="shard2") resList2 = ["machine"]
if(Game.shard.name=="shard3") resList2 = ["K","U"]
Creep.prototype.tradeCarryFull = function (){
    let task = this.lastTask();
    let targetRoom = Game.rooms[task.roomName];
    if(task.vis)return this.popTask();
    _.shuffle(resList2).forEach(e=>this.addTask(StationCarry.generatorMassStoreCarry(targetRoom,e,10000)));
    _.shuffle(resList).forEach(e=>this.addTask(StationCarry.generatorMassStoreCarry(targetRoom,e,10000)));
    task.vis = true;
}

Creep.prototype.tradeResourceCrossShard = function (){
    let task = this.lastTask();
    let data = task.dataList.find(e=>e.shard==Game.shard.name)
    if(!data)throw Error("trade shard error : "+Game.shard.name+ " "+ JSON.stringify(task.dataList))
    let targetRoom = Game.rooms[data.roomName];
    if(!targetRoom||!targetRoom.my)throw Error("trade shard error : " + data.roomName + "not yours");
    if(this.ticksToLive<500){// 回收
        this.memory.roomName = targetRoom.name
        return this.addTask(UtilsTask.taskData("recycleCreep")).execLastTask();
    }
    this.addTask(UtilsTask.taskData("moveCrossShardByRoomName",undefined,global.tradePathData[data.pathName]))
    // if(this.storeUsed()){//&&data.back
    // }
    if(!data.back)this.addTask(UtilsTask.taskData("tradeCarryFull",undefined,data))//.execLastTask();
    else{
        if(this.headTask().id.indexOf("s1")>=0||this.headTask().id.indexOf("s0")>=0){
            if((Memory.trade.shard1.store.machine||0)>=(Memory.trade.shard0.store.machine||0)&&this.headTask().id.indexOf("s0")>=0){
                this.addTask(UtilsTask.taskData("tradeCarryFull",undefined,data))//.execLastTask();
            }
            else if((Memory.trade.shard1.store.machine||0)<=(Memory.trade.shard0.store.machine||0)&&this.headTask().id.indexOf("s1")>=0){
                this.addTask(UtilsTask.taskData("tradeCarryFull",undefined,data))//.execLastTask();
            }
        }
    }
    this.addTask(UtilsTask.task(Game.rooms[data.roomName].storage,"fillAllTask"))
}

let pro = {
    crossTradeBody:ManagerCreeps.calcBodyPart([ [CARRY,16],[[[CARRY,1],[MOVE,1]],17] ]),
    execSpawn (flag,dataList) {
        if((Game.time+flag.room.hashCode())%3!=0)return;
        if(flag.room.creeps("carrier").length==0)return;// 没有搬运的时候不生爬了
        if((flag.memory.spawnTime||0)<Game.time) {
            let task =  [
                UtilsTask.taskFlag(flag,"tradeResourceCrossShard",undefined,{
                    dataList : dataList
                })
            ]
            if(StationHive.trySpawn(flag.room,"global",pro.crossTradeBody,"crossTrade",task)){
                flag.memory.spawnTime=Game.time+300
            }
        }
    },
    exec () {
        if(!Memory.trade)Memory.trade={}
        Object.values(Memory.trade).map(e=>{if(!e.lastTime)e.lastTime=Game.time})
        if(Game.time%1000==17&&typeof InterShardMemory!="undefined"&&Game.shard.name.startsWith("shard")){
            let all = {}
            let addStore = (store,b)=> {for(let v in b) if(b[v]>0)store[v]=(store[v]||0)+b[v];return store}
            ManagerRooms.getNormalRoom().map(room=>{
                if(room.storage)addStore(all,room.storage.store)
                if(room.terminal)addStore(all,room.terminal.store)
            })
            let price={}
            Object.keys(all).forEach(e=>{
                let p = StrategyMarketPrice.getResTypeHistory(e)
                if(p>0)price[e]=p
            })
            for(let shard of["shard0","shard1","shard2","shard3"]){
                ManagerCrossShard.addCrossShardRequest(shard,{
                    func:"setMemoryWithPath",
                    data: {
                        path:"trade."+Game.shard.name,
                        data:{
                            "roomCnt": ManagerRooms.getNormalRoom().length,
                            "store": all,
                            "price": price
                        }
                    }
                },"trade_"+shard)
            }
            pro.lastSendMarket=Game.time
        }
        // if(Game.time%3!=0)return;
        ManagerFlags.getFlagsByPrefix("trade").forEach(flag=>{
            if(flag.name.startsWith("trade_E21N9_s1-s2"))pro.execSpawn(flag,
                [{pathName:"s1-s2-p1", shard:"shard1", roomName:"E21N9",back: false},
                    {pathName:"s2-s1-p1", shard:"shard2", roomName:"E21N9",back: true }])
            if(flag.name.startsWith("trade_E19N11_s3-s2"))pro.execSpawn(flag,
                [{pathName:"s3-s2-p1", shard:"shard3", roomName:"E19N11",back: false},
                    {pathName:"s2-s3-p1", shard:"shard2", roomName:"E21N9",back: true }])
            if(flag.name.startsWith("trade_E39N9_s0-s2"))pro.execSpawn(flag,
                [{pathName:"s0-s2-p1", shard:"shard0", roomName:"E39N9",back: false},
                    {pathName:"s2-s0-p1", shard:"shard2", roomName:"E21N9",back: true }])
            // if(flag.name=="trade_test_1")pro.execSpawn(flag,
            //     [{pathName:"test1", shard:"6g3y-station", roomName:"W9N9",back: false}])
        });
    }
}



global.StrategytradeCrossShard=pro;
