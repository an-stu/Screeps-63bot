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
        return _.values(Game.powerCreeps).filter(e=>e.ticksToLive&&LOCAL_SHARD_NAME==(e.shard||LOCAL_SHARD_NAME))
    },
    init(){

        if(!Memory.powerCreeps)Memory.powerCreeps = {}
        for(let pc of _.values(Game.powerCreeps))//清理pc内存 如果已经死了 或者跨shard了
            if(!pc.ticksToLive
                ||LOCAL_SHARD_NAME!=(pc.shard||LOCAL_SHARD_NAME)) // 私服没有 pc.shard ，坑B dev
                delete Memory.powerCreeps[pc.name];

        for(let pcName in Memory.powerCreeps)
            if(!Game.powerCreeps[pcName])
                delete Memory.powerCreeps[pcName];

        pro.checkPowerCreepRoomPowered();
        pro.powerCreepsGenerateOps();

        pro.otherCreeps = []

        for(let name in Game.creeps){
            if(!Memory.creeps[name]||!Memory.creeps[name].tasks)delete Game.creeps[name];//先删掉，之后跨shard要做处理
        }

        let creeps={};
        for (let name in Memory.creeps) {
            // if (Game.creeps[name]) Game.creeps[name].memory.dontPullMe = false;
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
            }else {
                let roomName = Memory.creeps[name].roomName;
                if(!name.startsWith("!")&&roomName){
                    creeps[roomName]=creeps[roomName]||[];
                    creeps[roomName].push(Game.creeps[name])
                }else{
                    creeps['global']=creeps['global']||[];
                    creeps['global'].push(Game.creeps[name])
                }
            }
        }


        _.keys(creeps).forEach(e=>{if(e!='global'){ Game.rooms[e]&&Game.rooms[e].setCreepsList(creeps[e]) }else{ pro.otherCreeps=creeps[e]}})
        // this.cacheCreeps = creeps ;
        // return creeps;
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
