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
        let depleted = !room.creeps("worker", false).length && !room.creeps("carrier", false).length;
        if(depleted && caseEnergyLess)totalEnergy = room.getEnergyAvailable(room);
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
    /**
     * 正常补员固定按房间容量取满配；bodyBudget 只在 worker+carrier 双缺的
     * 救急分支生效。调用方用本 tick 预算判断「付不起就等」，不再缩小体型。
     */
    getMiddleLevelWorkerBodyConfig (room, bodyBudget){
        let depleted = room.creeps("worker", false).length + room.creeps("carrier", false).length == 0;
        let totalEnergy = depleted ? room.getEnergyAvailable(room) : room.getEnergyCapacityAvailable(room);
        // 只有 worker+carrier 全没了才允许按预算缩成救急体型；正常运行一律满配。
        if (depleted && bodyBudget !== undefined) totalEnergy = Math.max(200, Math.min(totalEnergy, bodyBudget));
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
    getHighLevelWorkerBodyConfig (room, bodyBudget){
        let depleted = room.creeps("worker", false).length + room.creeps("carrier", false).length == 0;
        let totalEnergy = depleted ? room.getEnergyAvailable(room) : room.getEnergyCapacityAvailable(room);
        let body = ManagerCreeps.calcBodyPart({  [WORK]: 30 ,[CARRY]: 10 ,[MOVE]: 10 });
        if (depleted || Utils.getBodyEnergyNeed(body)>totalEnergy) {
            return pro.getMiddleLevelWorkerBodyConfig(room, depleted ? bodyBudget : undefined)
        }
        return body
    },
    stationName:"stationWork",
    generatorBuildTask(creep){
        if (!creep.room || creep.room.level >= 4) {
            let target=creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES)
            if(!target)return []
            return UtilsTask.task(target,"buildConst","registerStationBuild")
        }
        // 低 RCL：容器/spawn 是收入与产能基础设施，必须排在道路/其它工地前面。
        // 10 个工地/房的预算常被道路占满，源容器排在后面永远轮不到（E51S29 实测）。
        let sites = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (!sites.length) return [];
        let priority = s => (s.structureType == STRUCTURE_CONTAINER || s.structureType == STRUCTURE_SPAWN) ? 0
            : s.structureType == STRUCTURE_TOWER ? 1
            : s.structureType == STRUCTURE_EXTENSION ? 2
            : 3;
        let target = sites
            .map(s => [s, priority(s), creep.pos.getRangeTo(s)])
            .sort((a, b) => a[1] - b[1] || a[2] - b[2])[0][0];
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
