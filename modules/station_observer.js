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
    PriorityObserveRoomQueue:{},
    // 观测调度的每房间记账原本散在 Memory.rooms[rn].stationObserver 里，
    // 123 个过道房间积了 ~30KB，而整份 Memory 每 tick 都要重新序列化。
    // 收敛到 Memory.observerWatch 扁平 map + 短键：u=lastUpdateTime,
    // c=closedMyRoom, cl=closedMyRoomLastUpdate, p=priorityVisibleTick,
    // pb=lastPowerBank。迁移在首次 update 时执行一次。
    watchRoom (roomName) {
        Memory.observerWatch = Memory.observerWatch || {};
        return Memory.observerWatch[roomName] = Memory.observerWatch[roomName] || {};
    },
    migrateWatchMemory () {
        if (Memory.observerWatchMigratedV2) return;
        for (let rn in Memory.rooms) {
            let om = Memory.rooms[rn].stationObserver;
            if (om) {
                let w = pro.watchRoom(rn);
                if (om.lastUpdateTime) w.u = om.lastUpdateTime;
                if (om.closedMyRoom) w.c = om.closedMyRoom;
                if (om.closedMyRoomLastUpdate) w.cl = om.closedMyRoomLastUpdate;
                if (om.priorityVisibleTick) w.p = om.priorityVisibleTick;
                if (om.lastPowerBank) w.pb = om.lastPowerBank;
                delete Memory.rooms[rn].stationObserver;
            }
            // 观测遗留条目：非拥有房间若只剩 ttl（和已迁移的 stationObserver），
            // 没有任何业务数据，TTL 巡检却会不断给它续命——整个条目直接清除。
            // 有其它键（structMap、station 数据等）的条目一律保留。
            let roomObj = Game.rooms[rn];
            if (!(roomObj && roomObj.my)
                && !Object.keys(Memory.rooms[rn]).some(k => k != "ttl" && k != "stationObserver")) {
                delete Memory.rooms[rn];
            }
        }
        Memory.observerWatchMigratedV2 = true;
    },
    pruneWatch (checkTimeDelay) {
        let watch = Memory.observerWatch || {};
        for (let rn in watch) {
            let w = watch[rn];
            if (!w || !(w.u || w.cl || w.p || w.pb)) { delete watch[rn]; continue; }
            // 观测环内的房间每 ~checkTimeDelay 刷新一次 u；u 长期不刷新说明
            // 已退出观测范围。closedMyRoom 缓存新鲜时保留，避免重复 BFS。
            if ((Game.time - (w.u || 0)) > checkTimeDelay * 3
                && !(w.c && Game.time - (w.cl || 0) < 10000)) delete watch[rn];
        }
    },
    requestRoom(roomName, preferredObserverRoom) {
        if (Game.rooms[roomName]) return preferredObserverRoom;
        let preferred = preferredObserverRoom && Game.rooms[preferredObserverRoom];
        let observerRoom = preferred && preferred.my && preferred.observer
            && Game.map.getRoomLinearDistance(preferred.name, roomName) <= 10
            ? preferred
            : Object.values(Game.rooms)
                .filter(room => room.my && room.observer && Game.map.getRoomLinearDistance(room.name, roomName) <= 10)
                .sort((left, right) => Game.map.getRoomLinearDistance(left.name, roomName)
                    - Game.map.getRoomLinearDistance(right.name, roomName))[0];
        if (!observerRoom) return;
        let queue = pro.PriorityObserveRoomQueue[observerRoom.observer.id]
            = pro.PriorityObserveRoomQueue[observerRoom.observer.id] || [];
        if (!queue.includes(roomName)) queue.push(roomName);
        return observerRoom.name;
    },
    getClosedMyRoomName (roomName){
        if(AVOID_ROOMS.has(roomName))return;
        let w = pro.watchRoom(roomName);
        if (Game.time - (w.cl || 0) >10000) {
            w.c = undefined
        }
        let closedMyRoom = w.c;
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
                        w.c = nn
                        w.cl = Game.time
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
        pro.watchRoom(room.name).u= Game.time
        let deposits = global.StrategyDeposits && isCpuFeatureEnabled("deposits") ? room.find(FIND_DEPOSITS) : [];
        let powerBanks = global.StrategyPowerBank && isCpuFeatureEnabled("powerBank")
            ? room.find(FIND_STRUCTURES,{filter:e=>e.structureType==STRUCTURE_POWER_BANK}) : [];
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
        if(!room.observer)return;// 如果没有ob就不动
        let stationMemory = room.memory[pro.stationName] = room.memory[pro.stationName] || {};
        let lastRoomName = stationMemory.lastRoomName
        if(lastRoomName&&Game.rooms[lastRoomName]){
            // log(room.name,Game.time,pro.ObserveRoomQueue[room.observer.id])
            pro.observeLastRoom(Game.rooms[lastRoomName]);
            delete stationMemory.lastRoomName;
        }
        let priorityQueue = pro.PriorityObserveRoomQueue[room.observer.id];
        let regularQueue = pro.ObserveRoomQueue[room.observer.id];
        let isPriorityObservation = priorityQueue && priorityQueue.length;
        let roomName = isPriorityObservation
            ? priorityQueue.shift()
            : regularQueue && regularQueue.length ? regularQueue.shift() : undefined;
        if(roomName){
            let observeResult = room.observer.observeRoom(roomName);
            if (observeResult == OK && isPriorityObservation) {
                pro.watchRoom(roomName).p = Game.time + 1;
            }
            if (observeResult == OK) stationMemory.lastRoomName=roomName;
            else if (isPriorityObservation && !priorityQueue.includes(roomName)) priorityQueue.unshift(roomName);
        }
    },
    update (room) {
        if(!room.observer)return;// 如果没有ob就不动
        pro.migrateWatchMemory();
        // if(room.name=="W1N4")log(pro.getNearRoom(room))
        let checkTimeDelay = 31*7;//checkTimeDelay tick 更新一次
        if((Game.time+room.hashCode())%(checkTimeDelay)!=0)return;
        // 邻居清单只在本次调度内使用，不再持久化到观测者房间的 Memory。
        let roomNames = pro.getNearRoom(room)
        let overRoomNames = roomNames.filter(e=>e.indexOf("0")>0)// 过道
        pro.ObserveRoomQueue[room.observer.id] = []
        for(let rn of overRoomNames){
            let lastUpdate = (Memory.observerWatch[rn]||{}).u||0
            if(Game.time - lastUpdate>checkTimeDelay/2){
                pro.ObserveRoomQueue[room.observer.id].push(rn)
            }
        }
        pro.pruneWatch(checkTimeDelay);
    },
};



global.StationObserver=pro;
