/**
 GPL榜冲第一失败
 如果你能寻路在N步内走到距离敌人N+d步的地方，那下面的N步都能跟他保持至少d的距离
 所以比如说你findClosestByPath一圈距离敌人距离10+d的地方，你就可以保证10步之内都不会被打到


 teamL2_W19N21_workB2Team_crossShard&shard2_1
 teamL{teamNumber}_{roomName}_{teamType}_{crossShard&shardName}_{idnex}


 teamL4_E11N21_work2B2Team_crossShard&shard2_1
 teamL4_W9N38_workB4Team_crossShard&shard2_1
 teamL4_W9N38_wall2B2Team_crossShard&shard2_1
 teamL4_W9N38_W1H1Team_crossShard&shard2_1

 teamL2_E11N12_InRoomA1H1Team_1
 teamL2_E11N12_InRoomA1H1Team_1

 teamL4_E11N12_R2H2Team_1

 teamL4_E11N12_A2H2Team_1
 teamL4_E21N9_W1R1H2Team_1


 teamL1_E31S29_HighWayR1Team_1
 teamL1_W19N21_cleanBoostW1Team_crossShard&shard2_1

 teamL4_W8N7_work2B2Team_crossShard&6g3y-station_1
 teamL4_W8N7_work2B2Team_1
 teamL42_W8N7_attackB4Team_1

 teamL4_E29S29_R2H2Team_1
 teamL4_E34S29_W2H2Team_1


 teamL4_E11N21_R2H2Team_crossShard&shard2_1
 teamL4_E3S2_R2H2Team_1
 teamL4_E3S2_W2H2Team_1

 teamL4_E3S2_antiAttackTeam_1
 teamL4_W3N4_R2H2Team_1

 teamL4_E7S5_W1H3$3600_1

 */




global.teamL2Path = { path:
        [ { shard: 'shard2', roomName: 'E10N20', x: 6, y: 39 },
            { shard: 'shard1', roomName: 'E10N20', x: 34, y: 30 },
            { shard: 'shard0', roomName: 'E10N31', x: 7, y: 48 },
            { shard: 'shard0', roomName: 'W10N30', x: 22, y: 25 },
            { shard: 'shard1', roomName: 'W10N20', x: 11, y: 35 },
            { shard: 'shard0', roomName: 'W19N40', x: 1, y: 6 },
            { shard: 'shard0', roomName: 'W20N50', x: 43, y: 29 },
            { shard: 'shard1', roomName: 'W10N30', x: 10, y: 13 },
            { shard: 'shard0', roomName: 'W19N60', x: 1, y: 4 },
            { shard: 'shard0', roomName: 'W20N70', x: 39, y: 38 },
            { shard: 'shard1', roomName: 'W10N40', x: 20, y: 39 },
            { shard: 'shard2', roomName: 'W10N40', x:  40, y: 6 }],
    distance: 713,
    totalRooms: 72,
    startRoom: 'shard2_E11N21',
    endRoom: 'shard3_W10N50'
}


global.teamL2Path = { path:
        [ { shard: 'shard2', roomName: 'W10N40', x: 39, y: 38 },
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
            { shard: 'shard1', roomName: 'E20S0', x: 37, y: 14 } ],
    distance: 528,
    totalRooms: 156,
    startRoom: 'shard2_W9N38',
    endRoom: 'shard2_E20S0' }


global.teamL2Path = { path:
        [ { shard: 'shard2', roomName: 'E10N20', x: 6, y: 39 },
            { shard: 'shard1', roomName: 'E10N20', x: 16, y: 21 },
            { shard: 'shard0', roomName: 'E10N41', x: 9, y: 48 },
            { shard: 'shard0', roomName: 'E0N40', x: 38, y: 10 },
            { shard: 'shard1', roomName: 'E0N20', x: 15, y: 24 },
            { shard: 'shard2', roomName: 'W0N20', x: 43, y: 38 } ],
    distance: 155,
    totalRooms: 12,
    startRoom: 'shard2_E11N21',
    endRoom: 'shard3_W0N20' }

global.teamL2Path = { path:
        [ { shard: 'shard2', roomName: 'E50S20', x: 36 , y: 26 }] }

let pro = {

    getHighWayBoostRangeAttack (){
        return ManagerCreeps.calcBodyPart([ [TOUGH,4],[MOVE,9],[RANGED_ATTACK,28],[HEAL,8],[MOVE,1]])
    },
    getBoostWork (){
        return ManagerCreeps.calcBodyPart([ [WORK,3], [TOUGH,11], [WORK,11],[WORK,15],[MOVE,10]])
    },
    getBoostCleanWork (){
        return ManagerCreeps.calcBodyPart([ [RANGED_ATTACK,5],[WORK,5],[WORK,30],[MOVE,10]])
    },
    getBoostCleanWorkRangeAttack (){
        return ManagerCreeps.calcBodyPart([ [WORK,37],[MOVE,10],[RANGED_ATTACK,3]])
    },
    getCleanWork (){
        return ManagerCreeps.calcBodyPart([ [WORK,32],[MOVE,17],[RANGED_ATTACK,1]])
    },
    getInRoomBoostAttack (){
        return ManagerCreeps.calcBodyPart([ [TOUGH,10],[MOVE,10],[ATTACK,30]])
    },
    getBoostAttack (){
        return ManagerCreeps.calcBodyPart([ [TOUGH,5],[TOUGH,10],[ATTACK,25],[MOVE,10]])
    },
    getBoostRangeAttack (){
        return ManagerCreeps.calcBodyPart([ [TOUGH,10],[RANGED_ATTACK,30],[MOVE,10]])
        // return ManagerCreeps.calcBodyPart({[RANGED_ATTACK]: 10} )
        //     .concat(ManagerCreeps.calcBodyPart({ [RANGED_ATTACK]: 25,[TOUGH]: 5,[MOVE]: 10 }))
    },
    getBoostRangeAttackWithHeal (){
        return ManagerCreeps.calcBodyPart([ [TOUGH,5],[RANGED_ATTACK,30],[HEAL,5],[MOVE,10]])
    },
    getBoostHeal (){
        return ManagerCreeps.calcBodyPart([ [TOUGH,11],[MOVE,5],[HEAL,29],[MOVE,5]])
    },
    getBoostHealRA (){
        return ManagerCreeps.calcBodyPart([ [RANGED_ATTACK,5],[TOUGH,6],[MOVE,5],[HEAL,29],[MOVE,5]])
    },
    getBoostWallRangeAttack (){
        return ManagerCreeps.calcBodyPart({ [RANGED_ATTACK]: 35,[HEAL]: 5,[MOVE]: 10 })
    },
    getBoostWallWork (){
        return ManagerCreeps.calcBodyPart([[TOUGH,5],[WORK,35],[MOVE,10]])
    },
    W2H2Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostWork (),pro.getBoostHeal (),pro.getBoostWork (),pro.getBoostHeal ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    cleanBoostW1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostCleanWork ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[],2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    cleanW1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getCleanWork ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[]))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    cleanWR1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostCleanWorkRangeAttack()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[],2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    R1H1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostRangeAttackWithHeal (),pro.getBoostHeal ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    W1R1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostWallWork (),pro.getBoostWallRangeAttack ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    W1H1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostWallWork (),pro.getBoostHealRA ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    InRoomA1H1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getInRoomBoostAttack(),pro.getBoostHeal ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    HighWayR1Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getHighWayBoostRangeAttack()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    getR2H2ra (){
        return ManagerCreeps.calcBodyPart([ [RANGED_ATTACK,5],[TOUGH,11],[MOVE,5],[RANGED_ATTACK,16],[HEAL,8],[MOVE,5]])
    },
    getR2H2heal (){
        return ManagerCreeps.calcBodyPart([ [RANGED_ATTACK,2],[TOUGH,11],[RANGED_ATTACK,6],[MOVE,9],[HEAL,21],[MOVE,1]])
    },
    R2H2Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getR2H2ra(),pro.getR2H2heal (),pro.getR2H2ra (),pro.getR2H2heal ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    W1R1H2Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostWork (),pro.getBoostHeal (),pro.getBoostRangeAttack (),pro.getBoostHeal ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    A2H2Team (flag,spawnRoomName,crossShard) {
        let spawnList = [pro.getBoostAttack (),pro.getBoostHeal (),pro.getBoostAttack (),pro.getBoostHeal ()].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    R1Team (flag,spawnRoomName,crossShard) {
        let ra =  ManagerCreeps.calcBodyPart([ [TOUGH,9],[RANGED_ATTACK,13],[MOVE,9],[HEAL,17],[MOVE,1],[HEAL,1]])
        let spawnList = [ra].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    R3600Team (flag,spawnRoomName,crossShard) {
        let ra =  ManagerCreeps.calcBodyPart([ [TOUGH,11],[RANGED_ATTACK,6],[MOVE,9],[HEAL,22],[MOVE,1],[HEAL,1]])
        let spawnList = [ra].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    antiAttackTeam (flag,spawnRoomName,crossShard) {
        let heal = ManagerCreeps.calcBodyPart([ [TOUGH,10],[MOVE,9],[HEAL,30],[MOVE,1]])
        let attack = ManagerCreeps.calcBodyPart([ [TOUGH,8],[ATTACK,9],[MOVE,9],[ATTACK,8],[TOUGH,3],[ATTACK,12],[MOVE,1]])
        let attack2 = ManagerCreeps.calcBodyPart([ [ATTACK,5],[TOUGH,16],[ATTACK,5],[MOVE,9],[[[TOUGH,1],[ATTACK,1]],7],[MOVE,1]])
        // let range = ManagerCreeps.calcBodyPart([ [TOUGH,11],[RANGED_ATTACK,29],[MOVE,10]])
        let spawnList = [attack2,heal,attack2,heal].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    W1H3$3600 (flag,spawnRoomName,crossShard) {
        let heal = ManagerCreeps.calcBodyPart([ [TOUGH,11],[MOVE,9],[HEAL,29],[MOVE,1]])
        let heal2 = ManagerCreeps.calcBodyPart([ [TOUGH,11],[RANGED_ATTACK,17],[MOVE,9],[HEAL,12],[MOVE,1]])
        let work = ManagerCreeps.calcBodyPart([ [WORK,15],[TOUGH,5],[WORK,20],[MOVE,10]])
        // let range = ManagerCreeps.calcBodyPart([ [TOUGH,11],[RANGED_ATTACK,29],[MOVE,10]])
        let spawnList = [heal2,heal,work,heal].map(e=>
            WarTeamFlag.getCreepSpawnUnit(flag.name ,e ,
                (crossShard)?[UtilsTask.taskData("moveCrossShardByPath",undefined,teamL2Path)]:[], 2))
        let memory = {
            roomName:spawnRoomName,
            spawnList:spawnList
        }
        return memory
    },
    execSpawn(flag,teamNumber){
        if(flag.memory.spawnTime+600>Game.time)return;
        flag.memory.spawnTime = Game.time
        let split = flag.getNameSplit();
        let spawnRoomName = split[1];
        let toShard = flag.name.indexOf("crossShard")>=0?
            split.find(e=>e.indexOf("crossShard")>=0).split("&")[1]
            :undefined
        let flagName = "team_"+ teamNumber +"_"+ randomId()
        console.log(pro[split[2]])
        flag.pos.createFlag(flagName)
            ManagerCrossShard.addCrossShardRequest(toShard,{
            func: "createSpawnFlagCressShard",
            data: pro[split[2]](Game.flags[flagName],spawnRoomName,toShard)
        })
    },
    exec () {
        if(Game.time%3!=0)return;
        ManagerFlags.getFlagsByPrefix("teamL2").forEach(flag=>{
            pro.execSpawn(flag,2)
        });
        ManagerFlags.getFlagsByPrefix("teamL1").forEach(flag=>{
            pro.execSpawn(flag,1)
        });
        ManagerFlags.getFlagsByPrefix("teamL4").forEach(flag=>{
            pro.execSpawn(flag,4)
        });
    }
}

global.teamL2=pro;
