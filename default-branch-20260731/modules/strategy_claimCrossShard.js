/**
 * claimCrossShard 房间 策略
 * claimCrossShard_shard3_W19N21_1
 * claimCrossShard_shard2_E11N21_1
 * claimCrossShard_shard2_E22N12_1
 *
 * claimCrossShard_shard2_W9N38_1
 * claimCrossShard_shard2_W9N38_withAttack_1
 */

// let pathData = {
//     path: [
//         { shard: 'shard3', roomName: 'W20N20', x: 13, y: 24 },
//         { shard: 'shard2', roomName: 'W20N20', x: 13, y: 12 },
//         { shard: 'shard1', roomName: 'W20N20', x: 38, y: 12 },
//         { shard: 'shard0', roomName: 'W30N39', x: 40, y: 1 },
//         { shard: 'shard0', roomName: 'W20N40', x: 24, y: 23 },
//         { shard: 'shard1', roomName: 'W10N20', x: 14, y: 38 },
//         { shard: 'shard0', roomName: 'W10N31', x: 37, y: 48 },
//         { shard: 'shard0', roomName: 'E10N30', x: 41, y: 22 },
//         { shard: 'shard1', roomName: 'E10N20', x: 25, y: 8 }
//     ],
//     distance: 269,
//     totalRooms: 19
// }
// let pathData = { path:
//         [ { shard: 'shard3', roomName: 'W40S10', x: 20, y: 20 },
//             { shard: 'shard2', roomName: 'W40S10', x: 41, y: 20 },
//             { shard: 'shard1', roomName: 'W40S10', x: 37, y: 34 },
//             { shard: 'shard0', roomName: 'W71S20', x: 48, y: 36 },
//             { shard: 'shard0', roomName: 'W70S79', x: 43, y: 47 },
//             { shard: 'shard0', roomName: 'W40S80', x: 22, y: 4 },
//             { shard: 'shard1', roomName: 'W20S40', x: 34, y: 39 },
//             { shard: 'shard0', roomName: 'W30S79', x: 38, y: 48 },
//             { shard: 'shard0', roomName: 'W20S80', x: 27, y: 4 },
//             { shard: 'shard1', roomName: 'W10S40', x: 7, y: 34 },
//             { shard: 'shard0', roomName: 'W10S71', x: 44, y: 1 },
//             { shard: 'shard0', roomName: 'E40S70', x: 18, y: 13 },
//             { shard: 'shard1', roomName: 'E20S40', x: 9, y: 21 },
//             { shard: 'shard0', roomName: 'E31S70', x: 1, y: 2 },
//             { shard: 'shard0', roomName: 'E30S50', x: 30, y: 14 },
//             { shard: 'shard1', roomName: 'E20S30', x: 42, y: 29 },
//             { shard: 'shard2', roomName: 'E20S30', x: 15, y: 32 },
//             { shard: 'shard3', roomName: 'E30S30', x: 5, y: 16 }
//         ],
//     distance: 318,
//     totalRooms: 89 }
// let pathData ={ path: [ { shard: 'shard3', roomName: 'E30S30', x: 5, y: 16 } ],
//     distance: 0,
//     totalRooms: 75 }

// let pathData = { path:
//   [ { shard: 'shard3', roomName: 'W40S10', x: 20, y: 20 },
//      { shard: 'shard2', roomName: 'W40S10', x: 41, y: 20 },
//      { shard: 'shard1', roomName: 'W40S10', x: 37, y: 34 },
//      { shard: 'shard0', roomName: 'W71S20', x: 48, y: 36 },
//      { shard: 'shard0', roomName: 'W70S79', x: 43, y: 47 },
//      { shard: 'shard0', roomName: 'W40S80', x: 22, y: 4 },
//      { shard: 'shard1', roomName: 'W20S40', x: 34, y: 39 },
//      { shard: 'shard0', roomName: 'W30S79', x: 38, y: 48 },
//      { shard: 'shard0', roomName: 'W20S80', x: 27, y: 4 },
//      { shard: 'shard1', roomName: 'W10S40', x: 18, y: 42 },
//      { shard: 'shard2', roomName: 'W10S40', x: 18, y: 22 } ],
//   distance: 164,
//   totalRooms: 22 }

let pathData = {
    path:
        [{ shard: 'shard2', roomName: 'E10N20', x: 6, y: 39 },
        { shard: 'shard1', roomName: 'E10N20', x: 34, y: 30 },
        { shard: 'shard0', roomName: 'E10N31', x: 7, y: 48 },
        { shard: 'shard0', roomName: 'W10N30', x: 22, y: 25 },
        { shard: 'shard1', roomName: 'W10N20', x: 11, y: 35 },
        { shard: 'shard0', roomName: 'W19N40', x: 1, y: 6 },
        { shard: 'shard0', roomName: 'W20N50', x: 43, y: 29 },
        { shard: 'shard1', roomName: 'W10N30', x: 10, y: 13 },
        { shard: 'shard0', roomName: 'W19N60', x: 1, y: 4 },
        { shard: 'shard0', roomName: 'W20N70', x: 39, y: 38 },
        { shard: 'shard1', roomName: 'W10N40', x: 20, y: 39 }],
    distance: 224,
    totalRooms: 95
}

pathData = {
    path:
        [{ shard: 'shard3', roomName: 'W25N55', x: 21, y: 33 }],
    startRoom: 'shard3_W25N57',
    endRoom: 'shard3_E55S31'
}

// pathData = { path:
//         [{ shard: 'shard2', roomName: 'E20N10', x: 38, y: 29 }]
// }

let pro = {
    getClaimerBody(withAttack) {
        if (!withAttack) return ManagerCreeps.calcBodyPart({ [TOUGH]: 15, [MOVE]: 16, [CLAIM]: 1 });
        return ManagerCreeps.calcBodyPart({ [MOVE]: 34, [CLAIM]: 16 });
    },
    exec() {
        if (Game.time % 3 != 0) return;
        ManagerFlags.getFlagsByPrefix("claimCrossShard").forEach(flag => {
            if (Game.rooms[flag.pos.roomName] && Game.rooms[flag.pos.roomName].my && Game.rooms[flag.pos.roomName].storage && Game.rooms[flag.pos.roomName].storage.my) {//&&Game.rooms[flag.pos.roomName].spawn.length>0
                flag.remove()
            }
            if (!flag.memory.spawnTime) flag.memory.spawnTime = 0
            let room = Game.rooms[flag.pos.roomName]
            let withAttack = flag.name.indexOf("withAttack") >= 0
            if (!room || !room.my) {// 如果房间不是我的
                if (Game.time - flag.memory.spawnTime > (withAttack ? 1000 : 300)) {
                    let split = flag.name.split("_");
                    let mission = {
                        func: "spawnCreepCressShard",
                        data: {
                            spawnRoom: split[2],
                            targetRoomName: flag.pos.roomName,
                            String, body: pro.getClaimerBody(withAttack),
                            role: "claimer",
                            tasks: [
                                UtilsTask.taskFlag(flag, "claimRoom"),
                                UtilsTask.taskData("moveCrossShardByPath", undefined, pathData)
                            ],
                        }
                    }
                    flag.memory.spawnTime = Game.time
                    ManagerCrossShard.addCrossShardRequest(split[1], mission)
                }
            } else {
                if (!Memory.rooms[flag.pos.roomName].structMap && flag.room) { // 创建蓝图
                    ManagerAutoPlanner.computeRoom(flag);
                } else {
                    if (Game.time - flag.memory.spawnTime > 300) {
                        let split = flag.name.split("_");
                        let mission = {
                            func: "spawnCreepCressShard",
                            data: {
                                spawnRoom: split[2],
                                targetRoomName: flag.pos.roomName,
                                String, body: ManagerCreeps.calcBodyPart({ [WORK]: 16, [CARRY]: 18, [MOVE]: 16 }),// 这里写死了
                                role: "worker",
                                tasks: [
                                    UtilsTask.taskData("moveCrossShardByPath", undefined, pathData)
                                ],
                            }
                        }
                        flag.memory.spawnTime = Game.time
                        ManagerCrossShard.addCrossShardRequest(split[1], mission)
                    }
                }
            }
        });
    }
}


global.StrategyClaimCrossShard = pro;
