/**
 * flag.memory.mode
 *  line 小队变成 直线仅四人小队 ，否则退化成 move
 *  move 移动,跑到 flag 的位置
 *  attack 搜索，歼灭 creep, 只有这个模式会 帮助其他人
 *  rash 激进模式，不算伤逃跑,attack模式2
 *  flee 风筝模式,保持距离
 *
 *
 * flag.memory.forceStructs
 *  true 专注建筑
 *  false 也打爬 (工兵除外)
 */




let pro = {
    checkMoveMode(flag){
        let creeps = flag._creeps;
        let currRoom = flag._creeps.head().room;
        let getDistinct=function (roomName1,roomName2) {
            let avoidRooms = BetterMove.getAvoidRoomsMap();
            const ops = {
                routeCallback(roomName) {
                    if(avoidRooms[roomName]) {    // 回避这个房间
                        return Infinity;
                    }
                    return 1;
                }};
            let dist = Game.map.getRoomLinearDistance(roomName1, roomName2, false)
            if(dist<2) dist = Game.map.findRoute(roomName1,roomName2,ops).length
            return dist;
        }
        let dist = getDistinct(creeps.head().room.name , flag.pos.roomName)

        // let hostiles = currRoom.find(FIND_HOSTILE_CREEPS);
        // if (hostiles.find(h => creeps.find(e => e.pos.getRangeTo(h) <= 5))) {
        //     return flag.memory.mode = "flee";
        // }

        if((dist)<=2){//&&flag._creeps.length>=3
            if(currRoom.my){
                let permitArea = WarCache.getPermitArea(currRoom.name,true);
                if(permitArea.get(creeps[0].pos.x,creeps[0].pos.y))
                    return flag.memory.mode = "line"
            }
        }else return flag.memory.mode = "line"
    },
    exec (flag){
        let creeps = flag._creeps;
        if(!creeps||!creeps.length)return;
        if(flag.memory.keepMode)return;
        if(pro.checkMoveMode(flag))return;
        if (!flag.memory.forceStructs) {
            flag.memory.mode="attack"
        }
    }
}


global.WarTeamControl = pro;
