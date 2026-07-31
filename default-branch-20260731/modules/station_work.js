/**
 * 整个房间杂物由他管理
 */



Creep.prototype.registerStationBuild=function () {
    // let room = this.mainRoom();
};

let pro={
    /** 还没有 800 的时候 */
    getLowLevelWorkerBodyConfig (room,caseEnergyLess = true){
        let totalEnergy = room.getEnergyCapacityAvailable(room);
        if(!room.creeps("worker").length&&caseEnergyLess)totalEnergy = room.getEnergyAvailable(room);
        let body = [WORK,CARRY,MOVE,MOVE];
        let bodyEnergy = Utils.getBodyEnergyNeed(body)
        let out= []
        let cnt = 0
        for(let i=1;i*bodyEnergy<=totalEnergy;i++){
            out = out.concat(body)
            cnt+=1
            if(cnt>=12)break;
        }
        return out
    },
    /** 超过800 的时候 */
    getMiddleLevelWorkerBodyConfig (room){
        let totalEnergy = room.getEnergyCapacityAvailable(room);
        if (room.creeps("worker", false).length + room.creeps("carrier", false).length == 0) {
            totalEnergy = room.getEnergyAvailable(room);
        }
        let body = [WORK,CARRY,MOVE];
        let bodyEnergy = Utils.getBodyEnergyNeed(body)
        let num = 0
        for(let i=1;i*bodyEnergy<=totalEnergy;i++){
            if(num>=17)break;
            num+=1
        }
        return ManagerCreeps.calcBodyPart({  [WORK]: num<17?num:num-1 ,[CARRY]: num ,[MOVE]: num });//

    },
    /** 超过800 的时候 */
    getHighLevelWorkerBodyConfig (room){
        let totalEnergy = room.getEnergyCapacityAvailable(room);
        let body = ManagerCreeps.calcBodyPart({  [WORK]: 30 ,[CARRY]: 10 ,[MOVE]: 10 });
        if (room.creeps("worker", false).length + room.creeps("carrier", false).length == 0||
            Utils.getBodyEnergyNeed(body)>totalEnergy) {
            return pro.getMiddleLevelWorkerBodyConfig(room)
        }
        return body
    },
    stationName:"stationWork",
    generatorBuildTask(creep){
        let target=creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES)
        if(!target)return []
        return UtilsTask.task(target,"buildConst","registerStationBuild")

    },
    constructionNeedBuild(room){
        return room.constructionSite && room.constructionSite.length != 0
    },
    exec(room){
        let objs=room.memory[pro.stationName];
    },
    update (room) {
        let objs={};
        room.memory[pro.stationName]=objs;
    },

};



global.StationWork=pro;
