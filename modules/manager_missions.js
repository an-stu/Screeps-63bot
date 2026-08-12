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
        // 安全写入：不再使用 eval 执行远端可控字符串
        let segments = [];
        (data.path || "").split(".").forEach(part => {
            let m = part.match(/^\["([^"]+)"\]$/);
            if (m) segments.push(m[1]);
            else if (part) segments.push(part);
        });
        if (!segments.length) return false;
        let node = Memory;
        for (let i = 0; i < segments.length - 1; i++) {
            let key = segments[i];
            if (key == "__proto__" || key == "constructor" || key == "prototype") return false;
            if (node[key] === undefined || node[key] === null) node[key] = {};
            node = node[key];
        }
        let last = segments[segments.length - 1];
        if (last == "__proto__" || last == "constructor" || last == "prototype") return false;
        node[last] = data.data;
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
                let want = Math.min(from.terminal.store[data.resType],data.amount);
                if(want&&(want==data.amount||want>=3000)){
                    // 交易成本也从源 terminal 扣：先预留 cost，否则想发空 terminal
                    // 时 amount+cost 超仓量会 ERR_NOT_ENOUGH_RESOURCES，mission 永不完成
                    let cost = Game.market.calcTransactionCost(want, data.fromRoomName, data.toRoomName);
                    let cnt = Math.max(0, Math.min(want, from.terminal.store[data.resType] - cost));
                    if(cnt && (cnt==data.amount || cnt>=3000)){
                        let code = from.terminal.send(data.resType,cnt,data.toRoomName)
                        // console.log(code)
                        if(code==OK){
                            data.amount -= cnt;
                            if(!data.amount)return true;
                        }
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
    setFlagMemory (data) {
        let flag = Game.flags[data.flagName]
        if(flag){
            for(let t in data.flagMemory){
                flag.memory[t] = data.flagMemory[t];
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
