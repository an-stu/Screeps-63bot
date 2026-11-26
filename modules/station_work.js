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
        // **目标房 = 编制房（memory.roomName），不是当前所在房**（2026-11-26 E58S26）。
        // 调用方（`strategy_lowLevel`）判的是 `creep.mainRoom()` 有没有工地，旧实现却
        // 在 `creep.room` 里找工地：走位途中的 worker（去新房的援建爬）本房没有工地
        // ⇒ 返回 `[]` ⇒ `addTask([])` 是空操作 ⇒ 它顶着满载能量原地站到死
        // （实测 shard2_78384441_1 在 E52S29 (4,25) 站了 800+ tick、0 任务、350 能量）。
        // 编制房没工地 / 没视野时退回当前房，保持原行为。
        let home = creep.mainRoom ? creep.mainRoom() : null;
        let room = (home && home.constructionSite && home.constructionSite.length) ? home : creep.room;
        if (!room) return [];
        if (room.level >= 4) {
            // 原位房维持「最近」；跨房走位时距离无意义（getRangeTo 跨房恒 Infinity），
            // 退回清单第一项让它先走过来。
            let target = creep.pos.roomName == room.name
                ? creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES) : undefined
            if (!target) target = room.find(FIND_CONSTRUCTION_SITES)[0]
            if(!target)return []
            return UtilsTask.task(target,"buildConst","registerStationBuild")
        }
        // 低 RCL：容器/spawn 是收入与产能基础设施，必须排在道路/其它工地前面。
        // 10 个工地/房的预算常被道路占满，源容器排在后面永远轮不到（E51S29 实测）。
        let sites = room.find(FIND_CONSTRUCTION_SITES);
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
