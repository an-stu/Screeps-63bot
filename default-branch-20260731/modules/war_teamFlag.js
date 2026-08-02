/**
 * 完全以旗帜为管理的战斗系统（适合微操，结束任务）
 *
 * 3600/48/4 每个人带的奶
 * 50- 每个人带的奶-10 == 其他的part
 * 然后你可以算出你需要几个tough
 * 堆在其他part里面就好了
 */



let spawn_pro = {
    getAttack (){
        return ManagerCreeps.calcBodyPart({ [ATTACK]: 25,[MOVE]: 24 })
            .concat(ManagerCreeps.calcBodyPart({ [MOVE]: 1}))
    },
    getRangeAttack (){
        return ManagerCreeps.calcBodyPart({ [RANGED_ATTACK]: 20,[MOVE]: 24, [HEAL]: 5 })
            .concat(ManagerCreeps.calcBodyPart({ [MOVE]: 1}))
    },
    getHeal (){
        return ManagerCreeps.calcBodyPart({ [RANGED_ATTACK]: 5,[MOVE]: 24, [HEAL]: 20 })
            .concat(ManagerCreeps.calcBodyPart({ [MOVE]: 1}))
    },
    getBoostBalanceRangeAttack (){
        return ManagerCreeps.calcBodyPart({ [RANGED_ATTACK]: 5})
            .concat(ManagerCreeps.calcBodyPart({ [TOUGH]: 10,[RANGED_ATTACK]: 10,[MOVE]: 9, [HEAL]: 15 }))
            .concat(ManagerCreeps.calcBodyPart({ [MOVE]: 1}))
    },
    getBoostSingleRangeAttack (){
        return ManagerCreeps.calcBodyPart({ [TOUGH]: 11, [RANGED_ATTACK]: 6, [MOVE]: 10 , [HEAL]: 23 })
    },
    getBoostAttack (){
        return ManagerCreeps.calcBodyPart({ [ATTACK]: 5 ,[TOUGH]: 4, })
            .concat(ManagerCreeps.calcBodyPart({ [ATTACK]: 25 ,[TOUGH]: 6,[MOVE]: 10}))
    },
    getBoostWork (){
        return ManagerCreeps.calcBodyPart({ [WORK]: 5 ,[TOUGH]: 6, })
            .concat(ManagerCreeps.calcBodyPart({ [WORK]: 29,[MOVE]: 10}))
    },
    getBoostRangeAttack (){
        return ManagerCreeps.calcBodyPart({ [RANGED_ATTACK]: 6,[TOUGH]: 6} )
            .concat(ManagerCreeps.calcBodyPart({ [RANGED_ATTACK]: 28,[MOVE]: 5, [HEAL]: 5 })).
            concat(ManagerCreeps.calcBodyPart({ [MOVE]: 5}))
    },
    getBoostHeal (){
        return ManagerCreeps.calcBodyPart({ [HEAL]: 5,[TOUGH]: 6,[MOVE]: 5})
            .concat(ManagerCreeps.calcBodyPart({ [HEAL]: 29 ,[MOVE]: 5}))
    },

    getCreepSpawn(flagName, body, boost=false){
        let out = {
            body:body,
            tasks:[UtilsTask.taskData("doNothing","registerFlag1t",{id:flagName})]
        }
        if(boost){
            out.tasks.push(StationLab.generatorBoostFightBodyTask(body,2).head())
        }
        return out
    },
    rangeAttackKeeper(){
        let r4 = Game.flags.r4;
        if(r4&&Game.flags.targetRoom){
            if(Game.time%300 == 0){
                let name = "spawnTeam_"+r4.room.name+"_"+Game.time;
                let name2 = "f4team_"+Game.time+"_"+Math.random();
                r4.pos.createFlag(name)
                r4.pos.createFlag(name2)
                if(Game.flags[name2])Game.flags[name2].setPosition(r4.pos);
                Memory.flags[name] = { createdAt: Game.time,
                    spawnList:[
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostBalanceRangeAttack(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostBalanceRangeAttack(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostBalanceRangeAttack(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostBalanceRangeAttack(),true)
                    ]
                }
                // r4.remove();

            }

        }

    },
    rangeAttackKeeper1(){
        let r1 = Game.flags.r1;
        if(r1&&Game.flags.targetRoom){
            if(Game.time%1 == 0){
                let name = "spawnTeam_"+r1.room.name+"_"+Game.time;
                let name2 = "f2team_"+Game.time+"_"+Math.random();
                r1.pos.createFlag(name)
                r1.pos.createFlag(name2)
                if(Game.flags[name2])Game.flags[name2].setPosition(r1.pos);
                Memory.flags[name] = { createdAt: Game.time,
                    spawnList:[
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostSingleRangeAttack(),true),
                    ]
                }
                r1.remove();
            }
        }
    },
    attackKeeper(){
        let a4 = Game.flags.a4;
        if(a4&&Game.flags.targetRoom){
            if(Game.time%3 == 0){
                let name = "spawnTeam_"+a4.room.name+"_"+Game.time;
                let name2 = "f4team_"+Game.time+"_"+Math.random();
                a4.pos.createFlag(name)
                a4.pos.createFlag(name2)
                if(Game.flags[name2])Game.flags[name2].setPosition(a4.pos);
                Memory.flags[name] = { createdAt: Game.time,
                    spawnList:[
                        // pro.getCreepSpawn(name2,pro.getBoostRangeAttack(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostAttack(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostHeal(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostWork(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostHeal(),true)
                    ]
                }
                a4.remove();
            }

        }
    },
    attackKeeper2(){
        let a2 = Game.flags.a2;
        if(a2&&Game.flags.targetRoom){
            if(Game.time%1 == 0){
                let name = "spawnTeam_"+a2.room.name+"_"+Game.time;
                let name2 = "f2team_"+Game.time+"_"+Math.random();
                a2.pos.createFlag(name)
                a2.pos.createFlag(name2)
                if(Game.flags[name2])Game.flags[name2].setPosition(a2.pos);
                Memory.flags[name] = { createdAt: Game.time,
                    spawnList:[
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostAttack(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostHeal(),true)
                    ]
                }
                a2.remove();
            }

        }

    },
    attackKeeper3(){
        let w4 = Game.flags.w2;
        if(w4&&Game.flags.targetRoom){
            if(Game.time%3 == 0){
                let name = "spawnTeam_"+w4.room.name+"_"+Game.time;
                let name2 = "f2team_"+Game.time+"_"+Math.random();
                w4.pos.createFlag(name)
                w4.pos.createFlag(name2)
                if(Game.flags[name2])Game.flags[name2].setPosition(w4.pos);
                Memory.flags[name] = { createdAt: Game.time,
                    spawnList:[
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostWork(),true),
                        spawn_pro.getCreepSpawn(name2,spawn_pro.getBoostHeal(),true)
                    ]
                }
                w4.remove();
            }

        }

    },
    exec (targets){
        spawn_pro.attackKeeper();
        spawn_pro.attackKeeper2();
        spawn_pro.attackKeeper3();
        spawn_pro.rangeAttackKeeper();
        spawn_pro.rangeAttackKeeper1();

        ManagerFlags.getFlagsByPrefix("f4team").forEach(flag=>{
            if(targets.length) flag._targets_select = targets
            // flag.remove();
            if(flag.room&&flag.room.my&&ManageTeam.checkSquare(flag)&&Game.flags.targetRoom){
                flag.setPosition(Game.flags.targetRoom.pos)
            }
            ManageTeam.exec(flag)
            if (flag.memory.creeps) {
                if (flag.memory.creeps.length == 4 && !flag.memory.creeps.find(id => Game.getObjectById(id))) {
                    flag.remove();
                }
            }
        })

        ManagerFlags.getFlagsByPrefix("f2team").forEach(flag=>{
            if(targets.length) flag._targets_select = targets
            // flag.remove();
            if(flag.room&&flag.room.my&&ManageTeam.checkSquare(flag)&&Game.flags.targetRoom){
                flag.setPosition(Game.flags.targetRoom.pos)
            }
            ManageTeam.exec(flag)
            if (flag.memory.creeps) {
                if (flag.memory.creeps.length == 2 && !flag.memory.creeps.find(id => Game.getObjectById(id))) {
                    flag.remove();
                }
            }
        })

        // ManagerFlags.getFlagsByPrefix("test").forEach(flag=>{
        //     let name = "spawnTeam_"+flag.room.name+"_1";
        //     let name2 = "team_1";
        //     flag.pos.createFlag(name)
        //     flag.pos.createFlag(name2)
        //     if(Game.flags[name2])Game.flags[name2].setPosition(flag.pos);
        //     // Memory.flags[name] = {
        //     //     spawnList:[pro.getCreepSpawn(name2),pro.getCreepSpawn(name2),pro.getCreepSpawn(name2),pro.getCreepSpawn(name2)]
        //     // }
        //     Memory.flags[name] = {
        //         spawnList:[
        //             pro.getCreepSpawn(name2,pro.getAttack()),
        //             pro.getCreepSpawn(name2,pro.getHeal()),
        //             pro.getCreepSpawn(name2,pro.getRangeAttack()),
        //             pro.getCreepSpawn(name2,pro.getHeal())
        //         ]
        //     }
        //     flag.remove();
        // })

        // ManagerFlags.getFlagsByPrefix("team").forEach(flag=>{
        //     ManageTeam.exec(flag)
        // })
    }
}


global.FLAG_TTL = 1500*2


let pro = {
    /**
     *
     * @param flagName
     * @param body [Body]
     * @param backTasks []
     * @param boost {false, 0,1,2}
     * @return {{body: *, tasks: [*]}}
     */
    getCreepSpawnUnit(flagName, body , backTasks = [] , boost= false){
        let out = {
            body:body,
            tasks:[UtilsTask.taskData("doNothing","registerFlag1t",{id:flagName})].concat(backTasks)
        }
        // console.log(boost)
        if(boost!==false){
            out.tasks.push(StationLab.generatorBoostFightBodyTask(body,boost).head())
        }
        return out
    },
    /**
     * 创建一个省爬任务
     * @param memory : {spawnList:[SpawnUnit],roomName:String}
     * @return {boolean}
     */
    createSpawnFlag(memory){
        let targetRoomName = memory.roomName;
        let room = Game.rooms[targetRoomName];
        if(!room||!room.my){
            console.log(targetRoomName + " is not your room");
            return false;
        }
        let name = "spawnTeam_"+targetRoomName+"_"+randomId();
        room.randomPosition().createFlag(name)
        memory.createdAt = Game.time;
        Memory.flags[name] = memory
    },
    exec (){


        ManagerFlags.getFlagsByPrefix("spawnTeam").forEach(flag=>{
            SpawnTeam.exec(flag)
        })


        let targets = []
        ManagerFlags.getFlagsByPrefix("target").forEach(flag=>{
            if(flag.room)targets.push(...flag.pos.lookFor(LOOK_STRUCTURES))
        })


        spawn_pro.exec(targets);

        /**
         * team_4_123
         * team_{小队人数}_{id}
         */
        ManagerFlags.getFlagsByPrefix("team").forEach(flag=>{
            let targetss = (flag.room)?flag.pos.lookFor(LOOK_STRUCTURES):[]
            if(flag._creeps&&flag._creeps.head()){
                if(!targetss.length)targetss = targets.filter(e=>e.room.name==flag._creeps.head().room.name&&flag.room&&flag.room.name==e.room.name)
                // if(flag._creeps.head().room.name=="W20S40"){
                //     if(Game.flags.target_A)flag.setPositionNextTick(Game.flags.target_A.pos)
                // }
            }
            if(targetss.length) flag._targets_select = targetss
            let split = flag.getNameSplit()
            let teamNum = parseInt(split[1])// 小队里面有多少人

            if(!flag.memory.ttl)flag.memory.ttl = Game.time+FLAG_TTL;
            if(flag.memory.ttl<Game.time)flag.remove(); // 超时删除

            if(flag.memory.setPos){
                let p = flag.memory.setPos
                flag.memory.setPos = undefined
                flag.setPosition(new RoomPosition(p.x,p.y,p.roomName))
            }

            if (flag.memory.creeps) {
                ManageTeam.execCalDamage(flag)
                if(flag.memory.creeps.length >= teamNum) {
                    flag._exec_cal_damage = true
                }
                // if (flag.memory.creeps.length >= teamNum && !flag.memory.creeps.find(id => Game.getObjectById(id)))  // 全死光了
                //     flag.remove();
            }
        })

        let roomMap = {}
        ManagerFlags.getFlagsByPrefix("team").forEach(flag=>{
            if (flag._creeps&&flag._exec_cal_damage&&flag._avoidObj) {
                if(!roomMap[flag.pos.roomName])
                    roomMap[flag.pos.roomName] = [];
                roomMap[flag.pos.roomName].push(...flag._avoidObj)
            }
        })
        
        _.keys(roomMap).forEach(k=>{
            let rampartArea = WarCache.getRampartArea(k)
            roomMap[k]=_.uniq(roomMap[k]).filter(e=>rampartArea.get(e.pos.x,e.pos.y)>3)
        })

        ManagerFlags.getFlagsByPrefix("team").forEach(flag=>{
            WarTeamControl.exec(flag)
            if (flag._creeps&&flag._exec_cal_damage) {
                flag._support_hostile = roomMap[flag.pos.roomName]
                ManageTeam.execCalTarget(flag)
            }
        })
    }
}


global.WarTeamFlag = pro;
