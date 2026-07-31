/**
 * mission {
 *     ttl :  time to live,
 *     func: exec function,
 *     data :{
 *          creepName,creepMmeory,……
 *     } ,
 * }
 */

let TTL = 5000 // 大概4小时

// return true if success else false （py写多了)
global.missionFunc = { //被crossShard引用 ，相当于交叉依赖了
    test (data) {
        log("test        ",data)
        return true;
    },
    setCreepMemory (data) {
         let creep = Game.creeps[data.name]
        if(creep){
            creep.memory = data.memory;
            return true;
        }
        return false;
    },
    /**
     * @param data : {spawnRoom:String,targetRoomName:String,body:[MOVE],role:String,tasks:[]}
     */
    spawnCreepCressShard (data) {
        let room = Game.rooms[data.spawnRoom]
        // log(data)
        if(!room||!room.my){
            console.log(Game.shard.name+ " " +data.spawnRoom+" is not yours")
            return true;
        }
        return StationHive.trySpawn(room, data.targetRoomName, data.body, data.role, data.tasks);
    },
    createSpawnFlagCressShard (data) {
        WarTeamFlag.createSpawnFlag(data)
        return true;
        // Memory.flags[data.flagName] = data.memory
    },
    /** {path:"creeps.xxxx.pos",data:{x:1,y:1,z:1}}
     * {path:"creeps.["xxxx"].pos",data:{x:1,y:1,z:1}}
     * @param data
     */
    setMemoryWithPath(data){
        eval("Memory."+data.path+"="+JSON.stringify(data.data))
        return true;
    },
    // /**
    //  * @param data : {fromRoomName:String,toRoomName:String,resType:ResourceConstant,amount:number}
    //  */
    sendRes (data){
        // data = {fromRoomName:fromRoomName,toRoomName:toRoomName,resType:resType,amount:amount}
        let from = Game.rooms[data.fromRoomName]
        if(from&&from.my){
            let terminal = from.terminal;
            // let resType = data.resType;
            if(terminal){
                terminal._need_hold = terminal._need_hold||{}
                terminal._need_hold[data.resType] = (terminal._need_hold[data.resType]||0) + data.amount
            }
            if(terminal&&from.terminal.cooldown==0){
                let cnt = Math.min(from.terminal.store[data.resType],data.amount);
                if(cnt&&(cnt==data.amount||cnt>=3000)){
                    let code = from.terminal.send(data.resType,cnt,data.toRoomName)
                    // console.log(code)
                    if(code==OK){
                        data.amount -= cnt;
                        if(!data.amount)return true;
                    }
                }
            }
        }
        return false;
    }
}


global.missionCallBack = { //被crossShard引用 ，相当于交叉依赖了
    testCallBack(data){
        log("testCallBack",data)
    },
    setFlagMemory (data) { //todo 测试失败
        let flag = Game.flags[data.flagName]
        if(flag){
            for(let t in data.flagMemory){
                flag.memory[t] = data.flagMemory;
            }
            return true;
        }
        return false;
    },
}

let pro={
    getTaskId (){
        Game._mission_cnt = ( Game._mission_cnt || 0 ) + 1;
        return Game.time +"_"+ Game._mission_cnt;
    },
    addMission(data,id){
        Memory.missions = Memory.missions || {};
        Memory.missions[id?id:pro.getTaskId()] = data;
    },
    init() {
        if(Memory.missions instanceof Array) Memory.missions = {}
        let missions  = (Memory.missions = Memory.missions || {});
        if(!Object.keys(missions).length)return;

        Object.entries(missions).forEach(l=>{
            let id = l[0];
            let e = l[1];
            HelperError.catchError(()=>{
                e.ttl = e.ttl===undefined ? TTL:e.ttl-1;
                if(!e.ttl)delete missions[id];
                else if(missionFunc[e.func]&&missionFunc[e.func](e.data)){
                    if(e.callBack){
                        if(missionCallBack[e.callBack])
                            missionCallBack[e.callBack](e.data)
                        else console.log("no callBack name : "+e.callBack)
                    }
                    delete missions[id];
                }
            },"mission in : "+id)
        })
    },

};

global.sendRes = function(fromRoomName,toRoomName,resType,amount) {
    let data = {data: {fromRoomName:fromRoomName,toRoomName:toRoomName,resType:resType,amount:amount}, func:'sendRes'}
    pro.addMission(data)
    return 0;
};

global.ManagerMissions = pro;
