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

/**
 * 跨 shard 路径：每一项都是**出发侧虫洞格**，按顺序踩过去；最后一项的
 * destination 就应该是目标 shard。跨过去后当前房间不再匹配任何 waypoint，
 * moveCrossShardByPath 会弹掉本任务、继续执行后面的 claim 任务。
 *
 * ⚠️ 不要把「落地侧」的坐标追加成最后一项：落地格就是回程虫洞，
 * 旧版 handler 每 tick 回扫房间名会把 index 拉回去，形成 index 1↔2 的
 * 死循环（claimer 站在虫洞上不动）。0.78.262 已修复推进逻辑，但路径
 * 语义保持不变更稳。
 *
 * 可用 `Memory.claimCrossShardPath`（{ path: [...] }）覆盖，调整路线不必重传代码。
 * 当前默认：shard3 E50S30(15,5) 虫洞直达 shard2，落地后步行到目标房 claim。
 */
let DEFAULT_CLAIM_PATH = {
    path: [
        { shard: 'shard3', roomName: 'E50S30', x: 15, y: 5 },
    ],
};
let getClaimPath = function () {
    let p = Memory.claimCrossShardPath;
    if (p && Array.isArray(p.path) && p.path.length) return p;
    return DEFAULT_CLAIM_PATH;
};
/**
 * claim 任务必须**自带目标坐标**：旗子只存在于源 shard，目标 shard 上
 * `Game.flags[flag.name]` 为空，claimRoom 处理器会解析不到目标直接 return
 * （实测 shard2 claimer 卡死在虫洞格）。claimRoom 本就支持 roomName/x/y。
 */
let claimTaskFlag = function (flag) {
    return { taskName: "claimRoom", id: flag.name, roomName: flag.pos.roomName, x: flag.pos.x, y: flag.pos.y };
};

// pathData = { path:
//         [{ shard: 'shard2', roomName: 'E20N10', x: 38, y: 29 }]
// }

let pro = {
    /** 供其它跨 shard 策略复用同一份路径（含 Memory.claimCrossShardPath 覆盖）。 */
    getPath() {
        return getClaimPath();
    },
    getClaimerBody(withAttack) {
        if (!withAttack) return ManagerCreeps.calcBodyPart({ [TOUGH]: 15, [MOVE]: 16, [CLAIM]: 1 });
        return ManagerCreeps.calcBodyPart({ [MOVE]: 34, [CLAIM]: 16 });
    },
    exec() {
        if (Game.time % 3 != 0) return;
        if(!ManagerFlags.hasPrefix("claimCrossShard"))return;
        ManagerFlags.getFlagsByPrefix("claimCrossShard").forEach(flag => {
            if (Game.rooms[flag.pos.roomName] && Game.rooms[flag.pos.roomName].my && Game.rooms[flag.pos.roomName].storage && Game.rooms[flag.pos.roomName].storage.my) {//&&Game.rooms[flag.pos.roomName].spawn.length>0
                flag.remove();
                return;
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
                            body: pro.getClaimerBody(withAttack),
                            role: "claimer",
                            tasks: [
                                claimTaskFlag(flag),
                                UtilsTask.taskData("moveCrossShardByPath", undefined, getClaimPath())
                            ],
                        }
                    }
                    flag.memory.spawnTime = Game.time
                    ManagerCrossShard.addCrossShardRequest(split[1], mission)
                }
            } else {
                if (!Memory.rooms[flag.pos.roomName].structMap && flag.room) { // 创建蓝图
                    if(Game.cpu.bucket<9500)return;
                    ManagerAutoPlanner.computeRoom(flag);
                } else {
                    if (Game.time - flag.memory.spawnTime > 300) {
                        let split = flag.name.split("_");
                        let mission = {
                            func: "spawnCreepCressShard",
                            data: {
                                spawnRoom: split[2],
                                targetRoomName: flag.pos.roomName,
                                body: ManagerCreeps.calcBodyPart({ [WORK]: 16, [CARRY]: 18, [MOVE]: 16 }),// 这里写死了
                                role: "worker",
                                tasks: [
                                    UtilsTask.taskData("moveCrossShardByPath", undefined, getClaimPath())
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
