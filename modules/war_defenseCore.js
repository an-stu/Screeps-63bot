/**
 * 缓存全局的 CostMatrix
 * 塔伤
 * 建筑
 */

Creep.prototype.registerDefenseAttacker = function (){
    let headTask = this.headTask();
    let flag = Game.flags[headTask.flagName];
    if(flag) {
        flag.memory.attacker = this.id
    }
}
Creep.prototype.registerDefenseHealer = function (){
    let headTask = this.headTask();
    let flag = Game.flags[headTask.flagName];
    if(flag) {
        flag.memory.healer = this.id
    }
}

Creep.prototype.defenseAttacker=function () {
    let task= this.headTask();
    let flag = Game.flags[task.flagName];
    // let healer = flag&&flag.memory.healer
    // healer = Game.getObjectById(healer)
    // this.room.tower.forEach(e=>e.heal(this))
    if(flag && (flag.memory.changeTime||0)+300<Game.time && this.pos!=flag.pos){
        flag.setPosition(this.pos)
        flag.memory.changeTime=Game.time
    }
    let target = this.pos.findInRange(FIND_HOSTILE_CREEPS,1).sort(e=>e.hits).head()
    if(target&&this.room.my){
        this.room.tower.forEach(e=>e.attack(target))
        this.moveTo(target);
        let healer = Game.getObjectById(flag.memory.healer)
        if(healer)healer.moveTo(this)
    }
    // flag.memory.changeTime= 0
    // log(flag && (flag.memory.changeTime||0)+15<Game.time && this.pos.findInRange(FIND_HOSTILE_CREEPS,7).length)
    if(flag && (flag.memory.changeTime||0)+10<Game.time && this.pos.findInRange(FIND_HOSTILE_CREEPS,7).length){
        let targetPos = this.pos.findClosestByRange(FIND_HOSTILE_CREEPS).pos
        if(!targetPos.isBorder())flag.setPosition(targetPos)
        flag.memory.changeTime=Game.time
    }
};

Creep.prototype.defenseHealer=function () {
    // let task= this.headTask();
    // let flag = Game.flags[task.flagName];
    // let attacker = flag&&flag.memory.attacker
    // attacker = Game.getObjectById(attacker)

};

let pro={
    getBoostAttack (room){
        let totalEnergy = room.getEnergyCapacityAvailable();
        let body = [ATTACK,ATTACK,ATTACK,ATTACK,MOVE];
        let bodyEnergy = Utils.getBodyEnergyNeed(body);
        let num = 0
        for(let i=1;i*bodyEnergy<=totalEnergy;i++){
            if(num>=10)break;
            num+=1
        }
        return ManagerCreeps.calcBodyPart([[ATTACK,4*num],[MOVE,num]]);

    },
    isFullSpawn(room){
        return room.getEnergyCapacityAvailable()>=9300;
    },
    getFullBoostAttack (){
        return ManagerCreeps.calcBodyPart([ [ATTACK,6],[TOUGH,10],[MOVE,9],[ATTACK,24],[MOVE,1]])
    },
    getFullBoostHeal (){
        return ManagerCreeps.calcBodyPart([ [TOUGH,10],[MOVE,9],[HEAL,30],[MOVE,1]])
    },

    checkNeedDefense(room, hostiles){
        // let upgradeFlag = room.flags("defense").head()
        // if(upgradeFlag)return true;
        // if((Game.time+room.hashCode())%30!=0)return;
        if(room.level < 7)return;
        hostiles = hostiles || room.getHostileCreeps();
        let healCnt = 0;
        for(let hostile of hostiles){
            if(hostile.owner.username == "Invader")continue;
            for(let part of hostile.body){
                if(part.type == HEAL && part.boost == "XLHO2")healCnt++;
            }
        }
        let flag  = Game.flags["defense_"+room.name];
        if(room.level==8&&healCnt>=12||(room.level==7&&healCnt>=6)){
            if(!flag)room.randomPosition().createFlag("defense_"+room.name);
            if(flag)flag.memory.lastCheck=Game.time+2000
        }
        if(flag&&flag.memory.lastCheck<Game.time)flag.remove();
    },

    exec(){
        // let t1 = Game.cpu.getUsed()
        ManagerFlags.getFlagsByPrefix("defense").forEach(flag=>{
            let room = flag.room
            if((Game.time+room.hashCode())%3!=0)return;// 和tick同步，没创建的时候不计算，省点cpu

            if(!flag.memory.lastSpawnTime)flag.memory.lastSpawnTime=Game.time-290;

            if (!room.find(FIND_HOSTILE_CREEPS).length&&(flag.memory.lastHostileTime||0)+200>Game.time)
                return flag.remove();
            flag.lastHostileTime = Game.time

            if((flag.memory.lastSpawnTime||0)+300>Game.time)return;

            if(pro.isFullSpawn(room)){
                if(room.flags("defenseAH").length<2){//先出两人小队
                    room.randomPosition().createFlag("defenseAH_"+room.name+"_"+Game.time)
                    flag.memory.lastSpawnTime = Game.time
                }else{// 再出ra

                }
            }else {// 7级的策略吧
                // let attackBoostResMap = StationLab.getFightBodyResMap(pro.getBoostAttack(flag.room),2)
                // log(StationLab.boostAble(flag.room,attackBoostResMap))
            }


            // flag.
        })
        ManagerFlags.getFlagsByPrefix("defenseAH").forEach(flag=>{
            if(!flag.memory.attacker){
                let body = pro.getFullBoostAttack ();
                let tasks=[
                    UtilsTask.taskData("doNothing","registerDefenseAttacker",{flagName:flag.name}),
                    UtilsTask.taskData("defenseAttacker","registerFlag1t",{flagName:flag.name}),
                    StationLab.generatorBoostFightBodyTask(body,2).head()
                ]
                StationHive.trySpawn(flag.room,flag.room.name,body,"team",tasks)
            }
            if(!flag.memory.healer){
                let body = pro.getFullBoostHeal();
                let tasks=[
                    UtilsTask.taskData("doNothing","registerDefenseHealer",{flagName:flag.name}),
                    UtilsTask.taskData("defenseHealer","registerFlag1t",{id:flag.name}),
                    StationLab.generatorBoostFightBodyTask(body,2).head()
                ]
                StationHive.trySpawn(flag.room,flag.room.name,body,"team",tasks)
            }
            if(flag.memory.attacker&&!Game.getObjectById(flag.memory.attacker)
                &&flag.memory.healer&&!Game.getObjectById(flag.memory.healer)){
                flag.remove()
            }
            if(flag._creeps && flag._creeps.length){
                ManageTeam.execCalDamage(flag);
                ManageTeam.execCalTarget(flag);
            }
        });
        ManagerFlags.getFlagsByPrefix("defenseRA").forEach(flag=>{
            // 清理内存
            if(!flag.memory.creeps)flag.memory.creeps = [];
            let creeps = flag.memory.creeps.map(e=>Game.getObjectById(e)).filter(e=>e)
            flag.memory.creeps = creeps.map(e=>e.id)

        });
        // log(Game.cpu.getUsed()-t1)
    }
};

global.WarDefenseCore = pro;
