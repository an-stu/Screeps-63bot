
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

        for (let name in Game.flags) {
            let strLs = name.split("_");
            let prefix = strLs[0]
            let roomName = strLs.length>=1?strLs[1]:undefined
            let room = Game.rooms[roomName]

            if(room){
                flagRoomMap[roomName] = flagRoomMap[roomName]||[]
                flagRoomMap[roomName].push(Game.flags[name])
            }
            let nextPos = Game.flags[name].memory.nextPos;
            if (nextPos) {
                let rp = new RoomPosition(nextPos.x,nextPos.y,nextPos.roomName);
                if(Game.flags[name].pos.isEqualTo(rp))delete Game.flags[name].memory.nextPos;
                else Game.flags[name].setPosition(rp)
            }
        }

        for(let name in flagRoomMap){
            Game.rooms[name].setFlagList(flagRoomMap[name])
        }


    },
    getFlagsByPrefix (prefix){
        if(!Game._flagPerfixMap){
            let map = Game._flagPerfixMap = {}
            _.values(Game.flags).forEach(flag=>{
                let p = flag.getPrefix();
                if(map[p]) map[p].push(flag);
                else map[p] = [flag]
            })
        }
        return Game._flagPerfixMap[prefix]||[]
    }

};


global.ManagerFlags = pro;
