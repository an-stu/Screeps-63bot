/**
 * 两人小队策略
 */

Creep.prototype.registerAtk2=function () {
    let flag= Game.flags[this.headTask().id];
    if(flag&&flag.memory)
        flag.memory.attackerName = this.name
    // log(this.pos.roomName)
}
Creep.prototype.registerHeal2=function () {
    let flag= Game.flags[this.headTask().id];
    if(flag&&flag.memory)
        flag.memory.healerName = this.name
    // log(this.pos.roomName)
}

global.atkl2Target = undefined

Creep.prototype.heal2=function () {
    let flag= Game.flags[this.headTask().id];
    // if(!flag)this.suicide();
    let attacker=flag&&Game.creeps[flag.memory.attackerName];
    // if(attacker)this.pull(attacker)
    if(!attacker || attacker.spawning){
        if(this.hitsMax-this.hits>0)this.heal(this);
        let needHeal=this.pos.findClosestByPath(FIND_MY_CREEPS,{
            filter(creep) {
                return creep.hitsMax-creep.hits>100;
            }
        });
        if(this.heal(needHeal)==ERR_NOT_IN_RANGE){
            this.moveTo(needHeal);
        }
    }
    else if(!attacker.spawning){
        if(attacker)
            this.$moveTo(attacker.pos);
        if(attacker){
            this.heal(attacker);
        }
        if(this.hitsMax-this.hits>0){
            this.heal(this);
        }
        let needHeal=this.pos.findClosestByPath(FIND_MY_CREEPS,{
            filter(creep) {
                return creep.hitsMax-creep.hits>100;
            }
        });
        if(this.heal(needHeal)==ERR_NOT_IN_RANGE){
            this.moveTo(needHeal);
        }
        if(needHeal)this.moveTo(needHeal);
    }
    this.memory.dontPullMe = false;
};
Creep.prototype.attack2=function () {
    let flag= Game.flags[this.headTask().id];
    // if(!flag)this.suicide();
    let inner=pos=> pos.x>=2&&pos.x<=48&&pos.y>=2&&pos.y<=48;
    let healer=flag&&Game.creeps[flag.memory.healerName];
    // if(healer)this.pull(healer)
    let walkAble = !this.fatigue&&(!healer||(!healer.fatigue&&this.pos.isCrossRoomNearTo(healer)))
    this.atk=function(){
        let forcedTarget = Game.getObjectById(atkl2Target)
        let cachedTarget = this.memory.atkL2TargetUntil >= Game.time ? Game.getObjectById(this.memory.atkL2TargetId) : undefined;
        if(cachedTarget && cachedTarget.pos.roomName != this.room.name)cachedTarget = undefined;
        let em=forcedTarget || cachedTarget//this.pos.findClosestByPath(FIND_HOSTILE_CREEPS);//
        // if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_POWER_CREEPS);
        if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_CREEPS,{filter:e=>inner(e.pos)});
        if(!em)em=this.room.find(FIND_HOSTILE_STRUCTURES).filter(e=>e.structureType==STRUCTURE_INVADER_CORE).head();
        // if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{filter:e=>!e.my&&e.structureType==STRUCTURE_SPAWN});
        if(!this.room.my){
            if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{filter:e=>!e.my
                    &&e.structureType!=STRUCTURE_CONTROLLER &&e.structureType!=STRUCTURE_RAMPART
                    &&e.structureType!=STRUCTURE_WALL&&e.structureType!=STRUCTURE_POWER_BANK && e.structureType!=STRUCTURE_SPAWN
            });
            // if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{filter:e=>e.structureType!=STRUCTURE_CONTROLLER&&e.hits<=10000000});
            // if(!em)em=this.pos.findClosestByPath(FIND_STRUCTURES,{filter:e=>e.structureType!=STRUCTURE_CONTROLLER&&e.hits<=5000});//10000000
            if(!em)em=this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES,{filter:e=>!e.my&&e.structureType!=STRUCTURE_CONTROLLER
                    &&e.structureType!=STRUCTURE_WALL&&e.structureType!=STRUCTURE_POWER_BANK &&e.structureType!=STRUCTURE_SPAWN
            });
            if(!em)em=this.pos.findClosestByPath(FIND_STRUCTURES,{filter:e=>!e.my&&e.structureType!=STRUCTURE_CONTROLLER
                    &&e.structureType!=STRUCTURE_POWER_BANK &&e.structureType!=STRUCTURE_SPAWN
            });
        }
        if(em && !forcedTarget && !cachedTarget){
            this.memory.atkL2TargetId = em.id;
            this.memory.atkL2TargetUntil = Game.time + 3;
        }else if(!em){
            delete this.memory.atkL2TargetId;
            delete this.memory.atkL2TargetUntil;
        }
        // if(em&&(inner(em.pos))){
        if(em){
            if(this.attack(em)==ERR_NOT_IN_RANGE){
            }
            if(walkAble)this.$moveTo(em);
        }else if(!em&&!this.pos.isEqualTo(tarPos)){
            if(walkAble||!inner(this.pos))this.$moveTo(tarPos);
        }
        if(this.hits+4400<this.hitsMax){
            let exit=this.pos.findClosestByPath(FIND_EXIT);
            if(exit&&walkAble)this.$moveTo(exit);
        }

        if(!em){
            let con = this.pos.findClosestByPath(FIND_HOSTILE_CONSTRUCTION_SITES)
            if(con)
                this.moveTo(con)
        }
    };

    if(!flag)return;
    let tarPos =flag.pos;
    if(this.room.name!=flag.pos.roomName) {
        let inner=pos=> pos.x>2&&pos.x<47&&pos.y>2&&pos.y<47;
        if(healer&&(this.hits!=this.hitsMax||healer.hits!=healer.hitsMax)&&!inner(this.pos)){
            if(walkAble||inner(this.pos))this.$moveTo(new RoomPosition(25,25,this.room.name));
            //let t=this.$moveTo(tarPos);
        }else if(this.hits==this.hitsMax&&healer&&healer.hits==healer.hitsMax){
            if(healer&&!healer.spawning&&walkAble) this.$moveTo(tarPos);
        }else{
            this.atk();
        }
    }else{
        this.atk();
    }
    if(walkAble) this.memory.dontPullMe = true;
    else this.memory.dontPullMe = false;
};

let pro = {

    attackBody_l6:ManagerCreeps.calcBodyPart({ [TOUGH]: 8, [ATTACK]: 14, [MOVE]: 22 }),
    healBody_l6:ManagerCreeps.calcBodyPart({ [TOUGH]: 3, [MOVE]: 10, [HEAL]: 7 }),
    attackBody_l8:ManagerCreeps.calcBodyPart({ [MOVE]: 25, [ATTACK]: 25 }),
    healBody_l8:ManagerCreeps.calcBodyPart({ [MOVE]: 25, [HEAL]: 25 }),

    // attackBody_boost:ManagerCreeps.calcBodyPart({ [TOUGH]: 11, [ATTACK]: 29, [MOVE]: 10 }),
    // attackBoostRes:{[BOOST_RES["damage"][2]]:30*8,[BOOST_RES["attack"][2]]:30*32,[BOOST_RES["fatigue"][2]]:30*10},
    // healBody_boost:ManagerCreeps.calcBodyPart({ [TOUGH]: 11, [HEAL]: 29, [MOVE]: 10 }),
    // healBoostRes:{[BOOST_RES["damage"][2]]:30*8,[BOOST_RES["heal"][2]]:30*32,[BOOST_RES["fatigue"][2]]:30*10},
    attackBody_boost:ManagerCreeps.calcBodyPart({ [ATTACK]: 40, [MOVE]: 10 }),
    attackBoostRes:{[BOOST_RES["attack"][2]]:30*40,[BOOST_RES["fatigue"][2]]:30*10},
    healBody_boost:ManagerCreeps.calcBodyPart({  [HEAL]: 40,[MOVE]: 10 }),
    healBoostRes:{[BOOST_RES["heal"][2]]:30*40,[BOOST_RES["fatigue"][2]]:30*10},
    getAttackBody(spawnRoom){
        return pro.attackBody_boost
    },
    getHealBody(spawnRoom){
        return pro.healBody_boost
    },
    execSpawn (flag) {
        // 死亡清理：原实现只读不删。某一只阵亡后 `!flag.memory.xxxName`
        // 仍为 false，函数会一直走 t==1 的分支直接 return —— 缺员永远补不回来，
        // flag 也永远删不掉（t 到不了 2）。
        if(flag.memory.attackerName && !Game.creeps[flag.memory.attackerName]) delete flag.memory.attackerName;
        if(flag.memory.healerName && !Game.creeps[flag.memory.healerName]) delete flag.memory.healerName;
        // 刚出生、还没跑到 register 的爬会有一小段空窗期，用冷却窗口杜绝重复补员
        if((flag.memory.lastSpawnTime||0)+10>Game.time) return;
        let wasFull = !!flag.memory.wasFull;
        if(wasFull && !flag.memory.attackerName && !flag.memory.healerName){
            // 两只都阵亡：本小队结束
            flag.remove();
            return;
        }
        let lev=8
        let spawnRoom = StationHive.getClosestSpawnRoom(flag.pos.roomName, lev);
        if(!spawnRoom){
            log("no active able room");
            return;
        }
        // 这里原本是 `if(spawnRoom && spawnRoom.length<=8)`。
        // getClosestSpawnRoom 返回的是 Room 对象（station_hive.js:108-137），
        // Room 上没有 length 属性 -> undefined<=8 恒为 false -> 整段生成逻辑
        // 从未执行，l2 小队一次兵都没出过（线上 Game.rooms.W33N53.length 实测
        // 为 undefined，(undefined<=8)===false）。
        let spawned = false;
        if(!flag.memory.healerName){//生一个 治疗（boost 版）
            let task =  [
                UtilsTask.taskFlag(flag,"heal2","registerHeal2"),
                StationLab.generatorBoostResTask(pro.healBoostRes).head()
            ]
            spawned = !!StationHive.trySpawn(spawnRoom,"global",pro.getHealBody(spawnRoom),"heal2",task) || spawned
        }
        if(!flag.memory.attackerName){//生一个 近战（boost 版）
            let task =  [
                UtilsTask.taskFlag(flag,"attack2","registerAtk2"),
                StationLab.generatorBoostResTask(pro.attackBoostRes).head()
            ]
            spawned = !!StationHive.trySpawn(spawnRoom,"global",pro.getAttackBody(spawnRoom),"atk2",task) || spawned
        }
        if(spawned){
            flag.memory.lastSpawnTime = Game.time;
            flag.memory.wasFull = true;
        }
    },
    exec () {
        // if(Game.time%3!=0)return;
        ManagerFlags.getFlagsByPrefix("l2").forEach(flag=>{
            pro.execSpawn(flag)
        });
    }
}

global.StrategyAtkl2=pro;
