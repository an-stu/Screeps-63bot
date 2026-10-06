global.ROLE_PRIORITY= {
    "team":50,
    "raL1":50,
    "atk2":50,
    "heal2":50,
    // ⚠️ 负值 = bucket 低于 MIN_CPU 阈值时**也冻掉**（见 ROLE_PRIORITY_ALLOWED）。
    //
    // power bank（PBer/PBCarrier）与存款矿（harDeposits/carrierDeposits）原来分别
    // 是 50/10/9/9（>0 ⇒ 低桶时照样运行），实测它们合计 ~3~4 CPU/tick —— 当桶已经
    // 掉到 MIN_CPU 线以下、连 carrier/keeper 这条能量命脉都在被 tick 截断时，
    // 继续跑这些**产资源但不产能量**的可选作业是净亏：桶被打到 0 就再也回不来。
    // 现在低桶时一并冻结，桶回血到 2000 以上自动恢复（不需要人工干预）。
    "PBer":-1,
    "PBCarrier":-1,
    "defenser":10,
    "harDeposits":-1,
    "carrierDeposits":-1,
    "carrier":1,
    "harvestEnergyKeeper":1,
    "worker":-5,
    "upgrader":-10,
}

/**
 * MIN_CPU 紧急模式下该角色是否继续执行。
 *
 * 语义：**只有被显式写成负数的角色才停**。未列出的角色（reserver、
 * harvestMineralKeeper、outerHarvestEnergyCarrier、minRoomWorker、pillager 等
 * 经济命脉）照常运行。原实现用 `ROLE_PRIORITY[role] > 0` 判断，未列出的角色是
 * `undefined > 0 === false`，会被静默冻死且没有任何日志。
 */
global.ROLE_PRIORITY_ALLOWED = role => {
    let priority = ROLE_PRIORITY[role];
    return priority === undefined || priority > 0;
};





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
                // 跨分片到达的爬由 shard manager 负责写入真正的任务。原来这里是
                // `delete Game.creeps[name]; continue;`，三个问题：
                //   1. pro.init() 里的 getTickObjects() 已经生成了 Game._coreObjects
                //      快照，删除对后面的执行阶段毫无影响，pro.exec() 照样会跑到它；
                //   2. memory.tasks 仍是 undefined，execRegFun（for...of undefined）
                //      与 execLastTask（.length）每 tick 抛 TypeError，被 runEach
                //      捕获后白烧 CPU 并污染 codeHealth.errorCount；
                //   3. delete 引擎提供的 Game.creeps 对象属未定义行为。
                // 改成补齐最小内存让它安全空转，真正的任务仍由 shard manager 写入。
                if (!creepMemory) creepMemory = Memory.creeps[name] = {};
                creepMemory.tasks = creepMemory.tasks || [];
                creepMemory.role = creepMemory.role || "crossShardPending";
            }
            let roomName = creepMemory.roomName;
            let groupName = !name.startsWith("!") && roomName ? roomName : "global";
            (creeps[groupName] || (creeps[groupName] = [])).push(creep);
            // 受伤标记：StationTower 的「受伤扫描」在 0.78.38 之后只在**本房**
            // 最近见过敌人时才跑，但外矿战斗全部发生在外矿房 —— 主房永远不会
            // 因此打上 lastHostileTimeMap，带伤回城的 keeper / 防守爬 / 搬运爬
            // 一只都奶不到（用户 10-04 报告）。这里在「每 tick 本来就要遍历
            // 全部 Game.creeps」的循环里顺手记一下哪个房间有己方受伤爬，塔按
            // 这个标记决定扫不扫：成本只有一次 hits 比较，而且对伤害来源
            // （外矿 keeper、invader、摔落……）完全免疫。
            if (creep.hits < creep.hitsMax) {
                let p = creep.pos;
                if (p && Game.rooms[p.roomName]) {
                    (Game._injuredRoomTick || (Game._injuredRoomTick = {}))[p.roomName] = Game.time;
                }
            }
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
