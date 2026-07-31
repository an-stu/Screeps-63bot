/**
 * 过道防御
 */


Creep.prototype.registerDefenseHighWay=function () {
    if(this.spawning){
        let flag = this.headTaskFlag();
        if(flag)flag.memory.spawnTime = Game.time
        flag.memory.creep = this.id
    }
};

Creep.prototype.defenseHighWay=function () {
    let flag = this.headTaskFlag()
    this.autoHeal();
    if(!flag)return;
    let em = this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>e.body.find(e=>e.type==ATTACK)});//遇到 attack 拉开距离
    if(em && this.pos.inRangeTo(em,2)){
        em.range = 4
        let path = PathFinder.search(this.pos,em,{flee:true}).path;
        let code = this.moveByPath(path)
        this.rangedAttack(em);
        log(code,PathFinder.search(this.pos,em,{flee:true}))
        return;
    }

    if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>!e.body.find(e=>e.type==HEAL||e.type==RANGED_ATTACK)});
    if(!this.memory.myDamage) this.memory.myDamage = this.possibleRangeDamage()
    if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>e.possibleHealWithToughDamage()<this.memory.myDamage});
    if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_POWER_CREEPS);

    if(em){
        this.moveTo(em);
        if(!this.pos.isNearTo(em))this.rangedAttack(em);
        else this.rangedMassAttack();
    }

    if(!em&&(!this.pos.inRangeTo(flag,4)||this.pos.isBorder())){
        this.moveTo(flag);
    }
};

let pro = {
    getDefenseHighWayData(flagName,room,spawnRoom){
        let flag = Game.flags[flagName];
        if(!flag)return;
        let sumDamage =  room.find(FIND_HOSTILE_CREEPS).map(e=>e.possibleDamage(false,2)).sum();// ra的全部伤害
        let sumHeal =  room.find(FIND_HOSTILE_CREEPS).map(e=>e.possibleHealDamage(1,false)).sum();// 全部奶量
        let maxToughDamage =  room.find(FIND_HOSTILE_CREEPS).map(e=>e.possibleToughBeHitsDamage(sumHeal)).maxBy(e=>e);// 单个能奶起来的最大值
        let rangeNeedCnt = Math.ceil(maxToughDamage/10+5)
        let toughNeedCnt = Math.ceil(sumDamage*0.3/100)
        let healNeedCnt = Math.ceil(sumDamage*0.3/12)||1
        let canSpawn = true

        let boostRes = {};
        let boostHeal = false
        let boostRangedAttack = false
        let boostFatigue = false
        if(rangeNeedCnt+toughNeedCnt+healNeedCnt<=25){// 不用boost
        }
        else if(rangeNeedCnt+toughNeedCnt+Math.ceil(healNeedCnt/4)<=25){// 要用boost 奶
            boostHeal = true
        } else if(Math.ceil(rangeNeedCnt/4)+toughNeedCnt+Math.ceil(healNeedCnt/4)<=25){// 要用boost 奶+ra
            boostRangedAttack = boostHeal = true
        }else if(Math.ceil(rangeNeedCnt/4)+toughNeedCnt+Math.ceil(healNeedCnt/4)<=40){// 要用boost 奶+ra+腿
            boostFatigue = boostRangedAttack = boostHeal = true
        }else{
            canSpawn = false
        }
        if(canSpawn){// 如果生的出来
            if(toughNeedCnt)boostRes[[BOOST_RES["damage"][2]]]=toughNeedCnt*30
            if(boostHeal)healNeedCnt = Math.ceil(healNeedCnt/4)
            if(boostHeal)boostRes[[BOOST_RES["heal"][2]]]=healNeedCnt*30
            if(boostRangedAttack)rangeNeedCnt = Math.ceil(rangeNeedCnt/4)
            if(boostRangedAttack)boostRes[[BOOST_RES["rangedAttack"][2]]]=rangeNeedCnt*30
            let MoveNeedCnt = rangeNeedCnt+toughNeedCnt+healNeedCnt
            if(boostFatigue)MoveNeedCnt = Math.ceil(MoveNeedCnt/4)
            if(boostFatigue)boostRes[[BOOST_RES["fatigue"][2]]]=MoveNeedCnt*30
            // log(rangeNeedCnt,toughNeedCnt,healNeedCnt,MoveNeedCnt)
            // log(boostRes)
            if (StationLab.boostAble(spawnRoom,boostRes)) {
                let task =  [
                    UtilsTask.taskFlag(flag,"defenseHighWay","registerDefenseHighWay")
                ]
                if(_.keys(boostRes).length)task.push(StationLab.generatorBoostResTask(boostRes).head())
                let body = ManagerCreeps.calcBodyPart([ [TOUGH,toughNeedCnt],[MOVE,MoveNeedCnt-1],[RANGED_ATTACK,rangeNeedCnt],[HEAL,healNeedCnt],[MOVE,1]])
                return {task:task, body:body}
            }
        }else {
            console.log(room.name+" damage too high to spawn defenseHighWay")
        }
    },
    checkDefense(flagName,room,spawnRoom){
        if(!Memory.flags[flagName])Memory.flags[flagName]={}
        if(!Memory.flags[flagName].spawnData&&(Memory.flags[flagName].spawnDefenseTime||0)<Game.time){
            let data = pro.getDefenseHighWayData(flagName,room,spawnRoom)
            if(data)Memory.flags[flagName].spawnData = data
        }
    },
    exec (room) {
        if(!room.storage)return;
        room.flags("defenserHighWay").forEach(flag=>{
            if(flag.memory.spawnData){
                if(StationHive.trySpawn(room, room.name,flag.memory.spawnData.body , "raL1", flag.memory.task)){
                    delete flag.memory.spawnData
                    flag.memory.spawnDefenseTime=Game.time+1200
                }
            }
        })
    }
}


global.StrategyDefenserHighWay=pro;
