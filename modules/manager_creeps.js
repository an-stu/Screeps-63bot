global.ROLE_PRIORITY= {
    "team":50,
    "raL1":50,
    "atk2":50,
    "heal2":50,
    "PBer":50,
    "PBCarrier":10,
    "defenser":10,
    "harDeposits":9,
    "carrierDeposits":9,
    "carrier":1,
    "harvestEnergyKeeper":1,
    "worker":-5,
    "upgrader":-10,
}





let pro={
    _time:0,
    otherCreeps:[],
    checkPowerCreepRoomPowered(){
        pro.getAllAlivePowerCreeps().filter(pc=>pc.isFree()).forEach(pc=>{
            let room = pc.mainRoom()
            if(room&&room.my&&!room.controller.isPowerEnabled){
                let tasks = [UtilsTask.task(room.controller,"roomPowerEnable")]
                pc.addTask(tasks)
            }
        })
    },
    powerCreepsGenerateOps(){
        pro.getAllAlivePowerCreeps().forEach(pc=>{
            let pcPower = pc.powers[PWR_GENERATE_OPS]//
            if(pcPower&&!pcPower.cooldown){
                let opsCnt = POWER_INFO[PWR_GENERATE_OPS].effect[pcPower.level-1]
                let freeCap = pc.store.getFreeCapacity(RESOURCE_OPS)
                if(freeCap>=opsCnt){
                    pc.usePower(PWR_GENERATE_OPS)
                }
            }
        })
    },
    getAllAlivePowerCreeps(){
        if (!Game._alivePowerCreeps) {
            let powerCreeps = Game._coreObjects ? Game._coreObjects.powerCreeps : Object.values(Game.powerCreeps);
            Game._alivePowerCreeps = powerCreeps.filter(pc => pc.ticksToLive && LOCAL_SHARD_NAME == (pc.shard || LOCAL_SHARD_NAME));
        }
        return Game._alivePowerCreeps;
    },
    init(){

        if(!Memory.powerCreeps)Memory.powerCreeps = {}
        let powerCreeps = Game._coreObjects ? Game._coreObjects.powerCreeps : Object.values(Game.powerCreeps);
        for(let pc of powerCreeps)//清理pc内存 如果已经死了 或者跨shard了
            if(!pc.ticksToLive
                ||LOCAL_SHARD_NAME!=(pc.shard||LOCAL_SHARD_NAME)) // 私服没有 pc.shard ，坑B dev
                delete Memory.powerCreeps[pc.name];

        for(let pcName in Memory.powerCreeps)
            if(!Game.powerCreeps[pcName])
                delete Memory.powerCreeps[pcName];

        pro.checkPowerCreepRoomPowered();
        pro.powerCreepsGenerateOps();

        pro.otherCreeps = [];
        let creeps = {};
        for (let name in Memory.creeps) {
            if (!Game.creeps[name]) delete Memory.creeps[name];
        }
        for (let name in Game.creeps) {
            let creep = Game.creeps[name];
            let creepMemory = Memory.creeps[name];
            if (!creepMemory || !creepMemory.tasks) {
                // Cross-shard arrivals are initialized by the shard manager.
                delete Game.creeps[name];
                continue;
            }
            let roomName = creepMemory.roomName;
            let groupName = !name.startsWith("!") && roomName ? roomName : "global";
            (creeps[groupName] || (creeps[groupName] = [])).push(creep);
        }
        for (let groupName in creeps) {
            if (groupName == "global") pro.otherCreeps = creeps[groupName];
            else if (Game.rooms[groupName]) Game.rooms[groupName].setCreepsList(creeps[groupName]);
        }
    },
    /**=
     * @param bodySet :{ [MOVE]: 8, [WORK]: 15, [CARRY]: 2} | [ [MOVE,8] ,[WORK,9] ,[MOVE,1] ]
     * @return {[]|*[]}
     */
    calcBodyPart(bodySet) {
        if(bodySet.length){
            let ls = []
            bodySet.forEach(e=>{
                for(let i=0;i<e[1];i++){
                    if(e[0] instanceof Array){
                        ls.push(...pro.calcBodyPart(e[0]))
                    }else
                        ls.push(e[0])
                }
            })
            return ls
        }
        // 把身体配置项拓展成如下形式的二维数组
        // [ [ TOUGH ], [ WORK, WORK ], [ MOVE, MOVE, MOVE ] ]
        const bodys = Object.keys(bodySet).map(type => Array(bodySet[type]).fill(type));
        // 把二维数组展平
        return [].concat(...bodys)
    },
    getBodyEnergyNeed(body){
        let need=0;
        body.forEach(e=>{if(BODYPART_COST[e])need+=BODYPART_COST[e]});
        return need;
    },

};


global.ManagerCreeps = pro;
