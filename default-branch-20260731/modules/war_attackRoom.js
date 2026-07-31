/**
 * warAttackRoom_[roomName]_[crossShard&shard]_[ops:attackController]_1
 *
 * warAttackRoom_W9N38_crossShard&shard2_attackController_1
 *
 * warAttackRoom_W8N7_crossShard&6g3y-station_attackController_1
 * warAttackRoom_W8N7_crossShard&6g3y-station_1
 *
 *
 */

// let filter  =  new Set([STRUCTURE_INVADER_CORE,'road','keeperLair','container','controller','extractor','terminal','storage']); //
let filter = new Set(['powerBank', 'road', 'keeperLair', 'container', 'controller', 'extractor', 'terminal', 'storage']);

Creep.prototype.attackRoom = function () {
    let flag = Game.flags[this.headTask().id];
    // if(!flag)this.suicide();
    let inner = pos => pos.x >= 2 && pos.x <= 48 && pos.y >= 2 && pos.y <= 48;

    let checkStructs = function (e) {
        return !filter.has(e.structureType) && e.hits
    }

    this.atk = function () {
        let em = this.memory.attackRoomTargetUntil >= Game.time
            ? Game.getObjectById(this.memory.attackRoomTargetId) : undefined;
        if(em && em.pos.roomName != this.room.name)em = undefined;
        if (!em) em = this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => checkStructs(e) && e.structureType != STRUCTURE_WALL && !e.pos.coverRampart() });
        if (!em) em = this.pos.findClosestByPath(FIND_HOSTILE_CONSTRUCTION_SITES, { filter: e => e.progress })
        if (!em) em = this.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { filter: e => inner(e.pos) });
        if (!em) em = this.pos.findClosestByPath(FIND_HOSTILE_POWER_CREEPS, { filter: e => inner(e.pos) });
        if (!em) em = this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => e.structureType == STRUCTURE_SPAWN });
        if (!em) em = this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => checkStructs(e) && e.structureType != STRUCTURE_RAMPART });
        if (!em) em = this.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => checkStructs(e) });

        if(em){
            this.memory.attackRoomTargetId = em.id;
            this.memory.attackRoomTargetUntil = Game.time + 3;
        }else{
            delete this.memory.attackRoomTargetId;
            delete this.memory.attackRoomTargetUntil;
        }

        if (em) HelperVisual.showText(em, "X")
        if (em) this.attack(em)
        if (em) this.rangedAttack(em)
        if (em) this.moveTo(em);
        else if (flag) this.moveTo(flag);
    };

    this.heal(this)
    if (!flag) return;
    let tarPos = flag.pos;
    if (this.room.name != flag.pos.roomName) {
        let inner = pos => pos.x > 2 && pos.x < 47 && pos.y > 2 && pos.y < 47;
        if (this.hits != this.hitsMax && !inner(this.pos)) {
            this.moveTo(new RoomPosition(25, 25, this.room.name));
            //let t=this.$moveTo(tarPos);
        } else if (this.hits == this.hitsMax) {
            this.moveTo(tarPos);
        } else {
            this.atk();
        }
    } else {
        this.atk();
    }
};



global.atkRoom2Path = {
    path:
        [{ shard: 'shard2', roomName: 'W10N40', x: 39, y: 38 },
        { shard: 'shard1', roomName: 'W10N40', x: 22, y: 29 },
        { shard: 'shard0', roomName: 'W10N82', x: 44, y: 48 },
        { shard: 'shard0', roomName: 'E69N80', x: 48, y: 35 },
        { shard: 'shard0', roomName: 'E70N20', x: 30, y: 9 },
        { shard: 'shard1', roomName: 'E40N10', x: 23, y: 34 },
        { shard: 'shard0', roomName: 'E70N9', x: 19, y: 1 },
        { shard: 'shard0', roomName: 'E61N10', x: 1, y: 47 },
        { shard: 'shard0', roomName: 'E60S11', x: 12, y: 1 },
        { shard: 'shard0', roomName: 'E39S10', x: 48, y: 16 },
        { shard: 'shard0', roomName: 'E40S0', x: 28, y: 34 },
        { shard: 'shard1', roomName: 'E20S0', x: 37, y: 14 }],
    distance: 528,
    totalRooms: 156,
    startRoom: 'shard2_W9N38',
    endRoom: 'shard2_E20S0'
}

let pro = {

    getBoostWork() {
        return ManagerCreeps.calcBodyPart([[WORK, 5], [TOUGH, 6], [WORK, 29], [MOVE, 10]])
    },
    getBoostAttack() {
        return ManagerCreeps.calcBodyPart([[RANGED_ATTACK, 5], [TOUGH, 5], [ATTACK, 25], [TOUGH, 5], [MOVE, 10]])
    },
    getBoostHeal() {
        return ManagerCreeps.calcBodyPart([[RANGED_ATTACK, 5], [TOUGH, 6], [MOVE, 5], [HEAL, 29], [MOVE, 5]])
    },
    getRangeAttack() {
        return ManagerCreeps.calcBodyPart([[RANGED_ATTACK, 5], [MOVE, 24], [RANGED_ATTACK, 15], [HEAL, 5], [MOVE, 1]])
    },
    getSmallAttack() {
        return ManagerCreeps.calcBodyPart([[MOVE, 8], [ATTACK, 8]])
    },
    getClaimer() {
        // return ManagerCreeps.calcBodyPart([[MOVE,16], [CLAIM,16], [MOVE,16]])
        return ManagerCreeps.calcBodyPart([[CLAIM, 18], [MOVE, 19], [HEAL, 1]])
    },
    workB4Team(flag, spawnRoomName, crossShard) {
        let spawnList = [pro.getBoostWork(), pro.getBoostHeal(), pro.getBoostWork(), pro.getBoostHeal()].map(e =>
            WarTeamFlag.getCreepSpawnUnit(flag.name, e,
                (crossShard && crossShard != Game.shard.name) ? [UtilsTask.taskData("moveCrossShardByPath", undefined, teamL2Path)] : []
                , 2))
        return {
            roomName: spawnRoomName,
            spawnList: spawnList
        }
    },
    range1Team(flag, spawnRoomName, crossShard) {
        let spawnList = [pro.getRangeAttack()].map(e =>
            WarTeamFlag.getCreepSpawnUnit(flag.name, e,
                [UtilsTask.taskFlag(flag, "attackRoom")]
                    .concat((crossShard && crossShard != Game.shard.name) ? [UtilsTask.taskData("moveCrossShardByPath", undefined, teamL2Path)] : [])))
        return {
            roomName: spawnRoomName,
            spawnList: spawnList
        }
    },
    attack1Team(flag, spawnRoomName, crossShard) {
        let spawnList = [pro.getSmallAttack()].map(e =>
            WarTeamFlag.getCreepSpawnUnit(flag.name, e,
                [UtilsTask.taskFlag(flag, "attackRoom")]
                    .concat((crossShard && crossShard != Game.shard.name) ? [UtilsTask.taskData("moveCrossShardByPath", undefined, teamL2Path)] : [])))
        return {
            roomName: spawnRoomName,
            spawnList: spawnList
        }
    },
    claim1Team(flag, spawnRoomName, crossShard) {
        let spawnList = [pro.getClaimer()].map(e =>
            WarTeamFlag.getCreepSpawnUnit(flag.name, e,
                [UtilsTask.taskFlag(flag, "claimRoom")]
                    .concat((crossShard && crossShard != Game.shard.name) ? [UtilsTask.taskData("moveCrossShardByPath", undefined, teamL2Path)] : [])
            ))
        return {
            roomName: spawnRoomName,
            spawnList: spawnList
        }
    },
    // attackB4Team (flag,spawnRoomName,crossShard) {
    //     let spawnList = [pro.getBoostAttack (),pro.getBoostHeal (),pro.getBoostAttack (),pro.getBoostHeal ()].map(e=>
    //         WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
    //             (crossShard&&crossShard!=Game.shard.name)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
    //     let memory = {
    //         roomName:spawnRoomName,
    //         spawnList:spawnList
    //     }
    //     return memory
    // },
    execSpawnWorkB4(flag) {
        if ((flag.memory.workB4SpawnTime || 0) < Game.time - 800) {
            flag.memory.workB4SpawnTime = Game.time
            let split = flag.getNameSplit();
            let spawnRoomName = split[1];
            let toShard = flag.toShard()
            let flagName = "team_4_" + randomId()
            flag.pos.createFlag(flagName)
            ManagerCrossShard.addCrossShardRequest(toShard, {
                func: "createSpawnFlagCressShard",
                data: pro.workB4Team(Game.flags[flagName], spawnRoomName, toShard)
            })

        }
    },
    execSpawnSmall(flag) {
        if ((flag.memory.smallSpawnTime || 0) < Game.time - 500) {
            flag.memory.smallSpawnTime = Game.time
            let split = flag.getNameSplit();
            let spawnRoomName = split[1];
            let toShard = flag.toShard()
            let flagName = "team_1_" + randomId()
            flag.pos.createFlag(flagName)
            ManagerCrossShard.addCrossShardRequest(toShard, {
                func: "createSpawnFlagCressShard",
                data: pro.attack1Team(Game.flags[flagName], spawnRoomName, toShard)
            })

        }
    },
    execSpawnRA1(flag) {
        if ((flag.memory.RA1SpawnTime || 0) < Game.time - 750) {
            flag.memory.RA1SpawnTime = Game.time
            let split = flag.getNameSplit();
            let spawnRoomName = split[1];
            let toShard = flag.toShard()
            let flagName = "team_1_" + randomId()
            flag.pos.createFlag(flagName)
            ManagerCrossShard.addCrossShardRequest(toShard, {
                func: "createSpawnFlagCressShard",
                data: pro.range1Team(Game.flags[flagName], spawnRoomName, toShard)
            })
        }
    },
    execSpawnClaim(flag) {
        if ((flag.memory.claimSpawnTime || 0) <= Game.time - 1000) {
            flag.memory.claimSpawnTime = Game.time
            let split = flag.getNameSplit();
            let spawnRoomName = split[1];
            let toShard = flag.toShard()
            let flagName = "team_1_" + randomId()
            flag.pos.createFlag(flagName)
            ManagerCrossShard.addCrossShardRequest(toShard, {
                func: "createSpawnFlagCressShard",
                data: pro.claim1Team(Game.flags[flagName], spawnRoomName, toShard)
            })
        }
    },
    checkRoomState(flag) {
        if ((flag.memory.lastUpdate || 0) <= Game.time - 12) {
            if (flag.room) {
                if (flag.room.controller) {
                    flag.memory.safeModeTime = flag.room.controller.safeMode + Game.time
                }
                flag.memory.lastUpdate = Game.time
                if (flag.room.find(FIND_STRUCTURES, { filter: e => e.structureType == STRUCTURE_TOWER }).length) { flag.memory.hasTower = Game.time } else { flag.memory.hasTower = undefined }
                if (flag.room.find(FIND_STRUCTURES, { filter: e => e.structureType == STRUCTURE_SPAWN }).length) { flag.memory.hasSpawn = Game.time } else { flag.memory.hasSpawn = undefined }
                if (flag.room.find(FIND_HOSTILE_CREEPS).length) { flag.memory.hasCreep = Game.time } else { flag.memory.hasCreep = undefined }
                let creep = flag.room.find(FIND_MY_CREEPS).head();
                if (creep && creep.pos.findClosestByPath(FIND_STRUCTURES, { filter: e => e.structureType == STRUCTURE_CONTROLLER })) //如果可以打得到controller
                { flag.memory.atackController = Game.time } else { flag.memory.atackController = undefined }

            }
        }
    },
    execSpawn(flag) {
        pro.checkRoomState(flag)
        if (Game.time % 3 != 0) return;
        if (flag.memory.safeModeTime > Game.time) return;
        // if (flag.memory.hasTower||flag.memory.hasSpawn)
        //     pro.execSpawnWorkB4(flag);
        if (!flag.memory.hasTower) {
            // if(flag.memory.hasCreep)
            //     pro.execSpawnRA1(flag);
            if (flag.hasOps("attackController")) { // flag.memory.atackController && 
                pro.execSpawnClaim(flag);
                return;
            }
        }
        pro.execSpawnSmall(flag);
    },
    exec() {
        ManagerFlags.getFlagsByPrefix("warAttackRoom").forEach(flag => {
            pro.execSpawn(flag)
        });
    }
}

global.WarAttackRoom = pro;



