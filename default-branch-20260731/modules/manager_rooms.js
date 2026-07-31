
// station 保存在内存里面 防止重启后全部重新计算

global.SPECIAL_ROOM = new Set([
    "minSizeRoom",
    "GCLRoom",
    "storageEmpty",
])

let ROOM_MEMORY_TTL=20000
let ROOM_REFRESH_INTERVAL=61

let pro={
    init(){
        for(let name in Memory.rooms) {
            if(!Memory.rooms[name].ttl)Memory.rooms[name].ttl=Game.time+ROOM_MEMORY_TTL
            if (!Game.rooms[name]){
                if(Memory.rooms[name].ttl<Game.time)delete Memory.rooms[name]
            }
            else Memory.rooms[name].ttl=Game.time+ROOM_MEMORY_TTL
            // if(Memory.rooms[name].ttl>Game.time+100)Memory.rooms[name].ttl=Game.time+100
        }
    },
    updateRoom (room){
        if(!room.Memory)room.Memory = {}
        room.update();
        StationCarry.update(room);
        StationSources.update(room);
        StationUpgrade.update(room);
        StationTower.update(room);
        StationMineral.update(room);
        StationDefense.update(room);
    },
    getNormalRoom(){
        if(!Game._normal_room)
            Game._normal_room = (Game._coreObjects ? Game._coreObjects.rooms : _.values(Game.rooms)).filter(e=>e.my&&!e.flags().find(flag=>SPECIAL_ROOM.has(flag.getPrefix())))
        return Game._normal_room
    },
    firstActive : true,
    exec (room) {
        if(!MIN_CPU && global.StationObserver && isCpuFeatureEnabled("observer"))StationObserver.update(room);
        // Full structure/station discovery is expensive and new owned
        // structures do not need sub-minute recognition. Hash staggering keeps
        // the refresh load spread across rooms.
        if((Game.time+room.hashCode())%ROOM_REFRESH_INTERVAL==0||pro.firstActive){
            HelperError.catchError(()=>pro.updateRoom(room))
            pro.firstActive = false;
        }

        if((Game.time+room.hashCode())%301==0||pro.firstActive) {
            if (global.BetterMove) BetterMove.deletePathInRoom(room.name);
        }
        if(!room.my){
            if(global.StrategyGCLRoom && isCpuFeatureEnabled("GCLRoom") && room.flags("GCLRoom").length)
                HelperError.catchError(()=>StrategyGCLRoom.exec(room))
            return; //如果不是自己的房子则不动
        }


        /** updateRoom */


        // room.creeps("carrier").forEach(e=>e.memory.tasks=[])
        // room.creeps("worker").forEach(e=>e.memory.tasks=[])

        if (global.StationLab && room.lab && room.lab.length) HelperError.catchError(()=>StationLab.exec(room));// 先预计算 labs

        if (global.StationFactory && room.factory) HelperError.catchError(()=>StationFactory.exec(room));// 先预计算 factory

        HelperError.catchError(()=>StationTower.exec(room));
        /** strategy */

        if(room.flags("blockRoom").length){
            return;
        }if(global.StrategyGCLRoom && isCpuFeatureEnabled("GCLRoom") && room.flags("GCLRoom").length){
            HelperError.catchError(()=>StrategyGCLRoom.exec(room))
        }else if(room.flags("minSizeRoom").length) //minSizeRoom_W8N8
            HelperError.catchError(()=>StrategyMinSizeRoom.exec(room))
        else if(!room.storage||!room.storage.my||room.level<4)
            HelperError.catchError(()=>StrategyLowLevel.exec(room))
        else
            HelperError.catchError(()=>StrategyHighLevel.exec(room))


        if (global.StrategyResourceBalance) HelperError.catchError(()=>StrategyResourceBalance.exec(room))

        if(global.StrategyOuterHarvest && isCpuFeatureEnabled("outerHarvest") && !room.flags("stopRemote").length) //stopRemote_W8N8 用来停止外矿，进入战斗状态的
            HelperError.catchError(()=>StrategyOuterHarvest.exec(room))

        if (global.StrategyPillage && isCpuFeatureEnabled("pillage") && room.flags("pillage").length) HelperError.catchError(()=>StrategyPillage.exec(room))

        if(!MIN_CPU && global.StationObserver && isCpuFeatureEnabled("observer") && Game.shard.name!="shard1")
            HelperError.catchError(()=>StationObserver.obOverRooms(room))

        if(!MIN_CPU && global.StrategyPowerBank)HelperError.catchError(()=>StrategyPowerBank.exec(room))

        if(!MIN_CPU && global.StrategyDeposits && isCpuFeatureEnabled("deposits"))HelperError.catchError(()=>StrategyDeposits.exec(room))

        if(global.StrategyDefenserHighWay && isCpuFeatureEnabled("combat") && room.flags("defenserHighWay").length)
            HelperError.catchError(()=>StrategyDefenserHighWay.exec(room))


        if(Game.time%30==0&&room.level>=7&&room.storage&&room.storage.store.getFreeCapacity()<=0){
            console.log(room.name+" storage is full")
        }
        // if(LOCAL_SHARD_NAME == "6g3y-station"&&room.storage&&room.storage.store.getFreeCapacity(RESOURCE_ENERGY)<100000) {
        //     let resType = RESOURCE_POWER
        //     // let resType = RESOURCE_ENERGY
        //     // log(resType)
        //     // room.terminal.store.getLessResTypes()
        //     // .filter(e=>e!=RESOURCE_ENERGY && room.terminal.store[e]>6000 )[0]
        //     // if(Game.rooms.W1N3.my&&Game.rooms.W1N3.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W1N3")
        //     if(Game.rooms.W3N4.my&&Game.rooms.W3N4.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W3N4")
        //     if(Game.rooms.W8N7.my&&Game.rooms.W8N7.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W8N7")
        //     if(Game.rooms.W3N6.my&&Game.rooms.W3N6.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W3N6")
        //     if(Game.rooms.W7N3.my&&Game.rooms.W7N3.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W7N3")
        //     if(Game.rooms.W8N2.my&&Game.rooms.W8N2.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W8N2")
        //     if(Game.rooms.W5N3.my&&Game.rooms.W5N3.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W5N3")
        //     if(Game.rooms.W5N8.my&&Game.rooms.W5N8.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W5N8")
        //     if(Game.rooms.W4N9.my&&Game.rooms.W4N9.storage.store.getFreeCapacity(RESOURCE_ENERGY)>100000)room.terminal.send(resType, Math.min(30000,room.terminal.store[resType]), "W4N9")
        // }
        // if(room.name == "W8N3")log(room.name,StationLab.boostAble(room,{"KH":3000}))

        // if(room.name=="W19N11"&& Game.time%30 == 0 && (!Memory.test||!Memory.test.start||Memory.test.start<500)){
        //     let tasks = [
        //         UtilsTask.taskData("testEnd"),
        //         UtilsTask.taskData("moveCrossShardByPath",undefined,ops = {
        //             path : [
        //                 { shard: 'shard3', roomName: 'W20N10', x: 40, y: 16 },
        //                 { shard: 'shard2', roomName: 'W20N10', x: 39, y: 33 },
        //                 { shard: 'shard1', roomName: 'W20N10', x: 41, y: 9 },
        //                 { shard: 'shard0', roomName: 'W29N10', x: 1, y: 19 },
        //                 { shard: 'shard0', roomName: 'W30N30', x: 43, y: 43 },
        //                 { shard: 'shard1', roomName: 'W20N20', x: 38, y: 12 },
        //                 { shard: 'shard0', roomName: 'W30N39', x: 40, y: 1 },
        //                 { shard: 'shard0', roomName: 'W19N40', x: 1, y: 6 },
        //                 { shard: 'shard0', roomName: 'W20N50', x: 43, y: 29 },
        //                 { shard: 'shard1', roomName: 'W10N30', x: 10, y: 13 },
        //                 { shard: 'shard0', roomName: 'W19N60', x: 1, y: 4 },
        //                 { shard: 'shard0', roomName: 'W20N70', x: 39, y: 38 },
        //                 { shard: 'shard1', roomName: 'W10N40', x: 8, y: 25 },
        //                 { shard: 'shard0', roomName: 'W20N79', x: 35, y: 1 },
        //                 { shard: 'shard0', roomName: 'E10N80', x: 36, y: 18 },
        //                 { shard: 'shard1', roomName: 'E10N40', x: 33, y: 6 },
        //                 { shard: 'shard0', roomName: 'E20N82', x: 29, y: 48 },
        //                 { shard: 'shard0', roomName: 'E70N80', x: 33, y: 8 },
        //                 { shard: 'shard1', roomName: 'E40N40', x: 40, y: 19 },
        //                 { shard: 'shard0', roomName: 'E80N69', x: 5, y: 1 },
        //                 { shard: 'shard0', roomName: 'E40N71', x: 28, y: 48 },
        //                 { shard: 'shard0', roomName: 'E50N70', x: 14, y: 38 },
        //                 { shard: 'shard1', roomName: 'E30N40', x: 8, y: 33 },
        //                 { shard: 'shard2', roomName: 'E30N40', x: 13, y: 29 }
        //             ]
        //         }),
        //         UtilsTask.taskData("testStart")
        //     ]
        //     StationHive.trySpawn(room,room.name,[MOVE],"scouterOverShard",tasks)
        // }

        // log(_.keys(BetterMove.creepPathCache).map(e=>Game.creeps[e].memory.role))
        // room.creeps().forEach(e=>{
        //     if(BetterMove.creepPathCache[e.name]){
        //         // HelperVisual.commonText(e,_.values(BetterMove.creepPathCache[e.name]["path"]))
        //         // log(_.values(BetterMove.creepPathCache[e.name]["path"]["posArray"]))
        //         // room.visual.poly(BetterMove.creepPathCache[e.name]["path"]["posArray"])
        //         // log(BetterMove.creepPathCache[e.name]["path"]["posArray"])
        //     }
        // })
        // let path = PathFinder.search(room.storage.pos,room.source[0].pos)
        // log(path)
        // room.visual.poly(path.path)
    }
};


global.ManagerRooms=pro;
