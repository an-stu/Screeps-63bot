/**
 * 大眼睛看过道
 */

let AVOID_ROOMS = (function () {
    if(Game.shard.name == "shard2")return new Set([
        "E10N21","E10N22","E10N23","E10N24","E10N25","E10N26","E10N27","E10N28","E20N18","E20N19","E20N20",
        // "E2N20","E3N20","E4N20","E12N20","E13N20","E14N20","E15N20","E16N20",
        "E10N1","E10N2","E10N3","E10N4",//"E10N5","E10N6",//"E10N12","E10N13","E10N14","E10N15","E10N16",
        // "E1N10","E2N10","E3N10","E4N10",//"E5N10","E6N10","E7N10","E8N10","E9N10","E10N10","E11N10","E12N10","E13N10","E14N10","E15N10","E16N10",
        // "E19N10",
        // "E9N20","E11N20",
        // "E23N10","E24N10","E25N10","E25N20","E20N14","E20N15","E20N16",
        "E27S30","E28S30","E29S30",
        "E30S30","E30S31","E30S32","E30S33","E30S34",
    ])
    if(Game.shard.name == "shard3")return new Set(["W14N20"
        ,"E0S45","E0S46","E0S47","W0S46"])//nanachi
    return new Set();
})();


let pro={
    stationName:"stationObserver",
    ObserveRoomQueue:{},// id:room
    getClosedMyRoomName (roomName){
        if(AVOID_ROOMS.has(roomName))return;
        Memory.rooms[roomName][pro.stationName] = Memory.rooms[roomName][pro.stationName]||{}

        if (Game.time - (Memory.rooms[roomName][pro.stationName].closedMyRoomLastUpdate || 0) >10000) {
            Memory.rooms[roomName][pro.stationName].closedMyRoom = undefined
        }
        let closedMyRoom = Memory.rooms[roomName][pro.stationName].closedMyRoom;
        if(closedMyRoom){
            if(Game.rooms[closedMyRoom]&&Game.rooms[closedMyRoom].my&&Game.rooms[closedMyRoom].observer){
                return closedMyRoom;
            }
        }
        let visited = {[roomName]:1};
        let currentList = [roomName];
        for(let i=0;i<5;i++){// 计算5个联通房间内的房子
            let tmpList = []
            for(let rn of currentList){
                let nextNames = _.values(Game.map.describeExits(rn)).filter(e=>!visited[e])
                for(let nn of nextNames){
                    tmpList.push(nn)
                    visited[nn]=true;
                    if(Game.rooms[nn]&&Game.rooms[nn]&&Game.rooms[nn].my&&Game.rooms[nn].level==8&&Game.rooms[nn].observer){
                        Memory.rooms[roomName][pro.stationName].closedMyRoom = nn
                        Memory.rooms[roomName][pro.stationName].closedMyRoomLastUpdate = Game.time
                        return nn;
                    }
                }
            }
            currentList = tmpList;
        }
        return undefined;
    },
    getNearRoom(room){
        // Game.map.describeExits();
        let allRoom = []
        let visited = {[room.name]:1};
        let currentList = [room.name];
        for(let i=0;i<5;i++){// 计算5个联通房间内的房子
            let tmpList = []
            for(let rn of currentList){
                let nextNames = _.values(Game.map.describeExits(rn)).filter(e=>!visited[e])
                for(let nn of nextNames){
                    tmpList.push(nn)
                    allRoom.push(nn)
                    visited[nn]=true
                }
            }
            currentList = tmpList;
        }
        return allRoom;
    },
    inNovice(room,Obj){
        if (room.find(FIND_STRUCTURES).find(e => e.structureType == STRUCTURE_WALL)) {//如果有墙壁
            if (room.lookForAtArea(LOOK_STRUCTURES, Math.min(Obj.pos.y, 25), Math.min(Obj.pos.x, 25), Math.max(Obj.pos.y, 25), Math.max(Obj.pos.x, 25),true)
                .find(e => e.structure.structureType == STRUCTURE_WALL)) {
                return true
            }
        }
        return false
    },
    observeLastRoom (room){
        if(AVOID_ROOMS.has(room.name))return;
        let sm=room.memory[pro.stationName]=room.memory[pro.stationName]||{};
        sm.lastUpdateTime= Game.time
        let deposits = room.find(FIND_DEPOSITS);
        let powerBanks = room.find(FIND_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_POWER_BANK});
        deposits.filter(e=>!pro.inNovice(room,e)).map(e=>{return {id:e.id,x:e.pos.x,y:e.pos.y,disappearTime:Game.time+e.ticksToDecay,depositType:e.depositType,lastCooldown:e.lastCooldown}})
            .forEach(data=> StrategyDeposits.createOrUpdateDepositMission(room.name,data));
        // if(Game.shard.name == "shard3")return;
        powerBanks.filter(e=>!pro.inNovice(room,e)).map(e=>{return {id:e.id,x:e.pos.x,y:e.pos.y,disappearTime:Game.time+e.ticksToDecay,power:e.power}})
            .forEach(data=> StrategyPowerBank.createOrUpdatePowerBankMission(room.name,data));

        // sm.powerBanks = powerBanks.map(e=>{return {x:e.pos.x,y:e.pos.y,disappearTime:Game.time+e.ticksToDecay}});
        // log(room.name,sm.powerBanks)
        // log(room.name,sm.deposits )
    },
    obOverRooms (room){
        if(!room.observer||!room.memory[pro.stationName])return;// 如果没有ob就不动
        let lastRoomName = room.memory[pro.stationName].lastRoomName
        if(lastRoomName&&Game.rooms[lastRoomName]){
            // log(room.name,Game.time,pro.ObserveRoomQueue[room.observer.id])
            pro.observeLastRoom(Game.rooms[lastRoomName]);
            delete room.memory[pro.stationName].lastRoomName;
        }
        if(room.observer&&pro.ObserveRoomQueue[room.observer.id]&&pro.ObserveRoomQueue[room.observer.id].head()){
            let roomName = pro.ObserveRoomQueue[room.observer.id].shift();
            room.observer.observeRoom(roomName);
            room.memory[pro.stationName].lastRoomName=roomName;
        }
    },
    update (room) {
        if(!room.observer)return;// 如果没有ob就不动
        // if(room.name=="W1N4")log(pro.getNearRoom(room))
        let checkTimeDelay = 31*7;//checkTimeDelay tick 更新一次
        if((Game.time+room.hashCode())%(checkTimeDelay)!=0)return;
        let sm=room.memory[pro.stationName]=room.memory[pro.stationName]||{};
        sm.roomNames = pro.getNearRoom(room)

        sm.roomNames = sm.roomNames||[]
        let overRoomNames = sm.roomNames.filter(e=>e.indexOf("0")>0)// 过道
        pro.ObserveRoomQueue[room.observer.id] = []
        for(let rn of overRoomNames){
            // sm.lastCheckTime = Game.time;
            if(!Memory.rooms[rn])Memory.rooms[rn] = {}
            let rm=Memory.rooms[rn][pro.stationName]=Memory.rooms[rn][pro.stationName]||{};
            let lastUpdate = rm.lastUpdateTime||0
            if(Game.time - lastUpdate>checkTimeDelay/2){
                pro.ObserveRoomQueue[room.observer.id].push(rn)
            }
        }

    },
};



global.StationObserver=pro;
