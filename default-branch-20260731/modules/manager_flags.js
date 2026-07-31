
let pro={
    globalFlags:[],
    init(){
        pro.globalFlags = []

        if(!Memory.flags)Memory.flags = {}
        for (let name in Memory.flags) {
            if (!Game.flags[name]) {
                delete Memory.flags[name];
            }
        }

        let flagRoomMap = {}
        let prefixMap = Game._flagPerfixMap = {}

        for (let name in Game.flags) {
            let flag = Game.flags[name]
            let prefix = flag.getPrefix()
            let roomName = flag.pos.roomName
            let room = Game.rooms[roomName]

            if(prefixMap[prefix]) prefixMap[prefix].push(flag)
            else prefixMap[prefix] = [flag]

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
    }

};


global.ManagerFlags = pro;
