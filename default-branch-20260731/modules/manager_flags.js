
let pro={
    globalFlags:[],
    init(){
        pro.globalFlags = []

        if(!Memory.flags)Memory.flags = {}
        // `createFlag` can become visible one tick after its Memory entry is
        // written. Keep short-lived spawn queues outside `Memory.flags` until
        // the game exposes the flag, otherwise the generic orphan cleanup
        // below deletes a valid newly-created Power Bank queue.
        let pendingSpawnTeams = Memory.pendingSpawnTeams;
        if (pendingSpawnTeams) {
            for (let name in pendingSpawnTeams) {
                let data = pendingSpawnTeams[name];
                if (Game.flags[name]) {
                    Memory.flags[name] = data;
                    delete pendingSpawnTeams[name];
                } else if (!data || Game.time - (data.createdAt || 0) > 10) {
                    delete pendingSpawnTeams[name];
                }
            }
            if (!Object.keys(pendingSpawnTeams).length) delete Memory.pendingSpawnTeams;
        }
        // `RoomPosition.createFlag` may return its name one tick before the
        // Flag is available through `Game.flags`. PB missions used to write
        // straight into Memory.flags and were then erased by the orphan pass
        // below. Promote their short pending record only after the Flag is
        // visible, matching the spawn-team handoff above.
        let pendingPowerBanks = Memory.pendingPowerBanks;
        if (pendingPowerBanks) {
            for (let name in pendingPowerBanks) {
                let data = pendingPowerBanks[name];
                if (Game.flags[name]) {
                    delete data.createdAt;
                    Memory.flags[name] = data;
                    delete pendingPowerBanks[name];
                } else if (!data || Game.time - (data.createdAt || 0) > 10) {
                    delete pendingPowerBanks[name];
                }
            }
            if (!Object.keys(pendingPowerBanks).length) delete Memory.pendingPowerBanks;
        }
        for (let name in Memory.flags) {
            let flagMemory = Memory.flags[name];
            if (Game.flags[name]) {
                // Drop the transient handoff marker as soon as the engine
                // exposes the Flag normally.
                if (flagMemory) delete flagMemory._flagPendingAt;
                continue;
            }
            // createFlag can be visible a tick later on this shard. Keep all
            // newly written Flag Memory briefly, so Deposit and dynamic combat
            // flags get the same protection as PB queues before orphan cleanup.
            if (flagMemory && !flagMemory._flagPendingAt) {
                flagMemory._flagPendingAt = Game.time;
                continue;
            }
            if (!flagMemory || Game.time - flagMemory._flagPendingAt > 10) {
                delete Memory.flags[name];
            }
        }

        let flagRoomMap = {}
        let prefixMap = Game._flagPerfixMap = {}
        let prefixRoomMap = Game._flagPrefixRoomMap = {}

        for (let name in Game.flags) {
            let flag = Game.flags[name]
            let prefix = flag.getPrefix()
            let roomName = flag.pos.roomName
            let room = Game.rooms[roomName]

            if(prefixMap[prefix]) prefixMap[prefix].push(flag)
            else prefixMap[prefix] = [flag]

            let missionRoomName = flag.getRoomName();
            if (missionRoomName) {
                let roomKey = prefix + ":" + missionRoomName;
                if (prefixRoomMap[roomKey]) prefixRoomMap[roomKey].push(flag);
                else prefixRoomMap[roomKey] = [flag];
            }

            if(room){
                flagRoomMap[roomName] = flagRoomMap[roomName]||[]
                flagRoomMap[roomName].push(flag)
            }
            let nextPos = flag.memory.nextPos;
            if (nextPos) {
                let rp = new RoomPosition(nextPos.x,nextPos.y,nextPos.roomName);
                if(flag.pos.isEqualTo(rp))delete flag.memory.nextPos;
                else flag.setPosition(rp)
            }
        }

        for(let name in flagRoomMap){
            Game.rooms[name].setFlagList(flagRoomMap[name])
        }


    },
    getFlagsByPrefix (prefix){
        return Game._flagPerfixMap[prefix]||[]
    },
    getFlagsByPrefixAndRoom(prefix, roomName) {
        return Game._flagPrefixRoomMap[prefix + ":" + roomName] || [];
    },
    hasPrefix (prefix){
        let flags = Game._flagPerfixMap[prefix];
        return !!(flags && flags.length);
    },
    hasAnyPrefix (prefixes){
        for(let prefix of prefixes){
            if(pro.hasPrefix(prefix))return true;
        }
        return false;
    }

};


global.ManagerFlags = pro;
