


Creep.prototype.repairWall = function () {

    if (this.store[RESOURCE_ENERGY] == 0) {
        return this.popTask()
    }
    let obj = this.lastTaskObj();
    let code = this.repair(obj);
    if (!obj || obj.hits >= obj.hitsMax) {
        return this.popTask();
    }
    if (code == ERR_NOT_IN_RANGE) {
        this.moveTo(obj, { visualizePathStyle: { stroke: '#fffa00' } });
    }
    if (this.ticksToLive % 3) {
        this.memory.dontPullMe = false;
    }
}


let pro = {
    stationName: "stationDefense",
    levelWallHits: {
        // 1:5000,2:5000,3:5000,4:50000,5:500000,6:1000000,7:3000000,8:(Game.shard.name == "shard3"?10:100)*1000000 // 8级最少修10m墙壁
        1: 5000, 2: 5000, 3: 5000, 4: 5000, 5: 5000, 6: 500000, 7: 5000000, 8: (Game.shard.name == "shard3" ? 300 : 150) * 1000000
    },
    HitsCPUSave: 100 * 1000000,
    // wallListMap:{},
    needBuildWall(room) {
        if (!pro.needRepairWallMap[room.name]) return false;
        let wall = Game.getObjectById(pro.needRepairWallMap[room.name].head());
        return wall && wall.hits < pro.levelWallHits[room.level]*0.999
            || (isSaveCpu && Game.cpu.bucket > 8000 && room.level == 8 && wall && wall.hits < pro.HitsCPUSave);
    },
    needBuildWallWorkerFree(room) {
        if (!pro.needRepairWallMap[room.name]) return false;
        let wall = Game.getObjectById(pro.needRepairWallMap[room.name].head());
        return wall && wall.hits < pro.levelWallHits[room.level];
    },
    generatorRepairTask(room) {
        if (!pro.needRepairWallMap[room.name]) return [];
        let wall = undefined;
        while (pro.needRepairWallMap[room.name].length && !wall) {
            wall = Game.getObjectById(pro.needRepairWallMap[room.name].shift())
        }
        if (wall) return [UtilsTask.task(wall, "repairWall", "registerUsed")]
        return []
    },
    needRepairWallMap: {},
    update(room) {
        let needRepairs = [];

        if (!room.memory.structMap) return;
        if (!room.storage) return;

        let created = false
        let hasConSite = room.find(FIND_CONSTRUCTION_SITES).length
        if (!room.storage || !room.storage.my) return; // 4 级前什么都不做，防不住的

        function createWallOrRampart(pos, structType) {
            let needRepair = pos.lookFor(LOOK_STRUCTURES).filter(e => e.structureType == structType).head();
            if (!needRepair && !hasConSite && !created) {
                if (OK == pos.createConstructionSite(structType))
                    created = true
            }
            if (needRepair) return needRepair
        }

        for (let structs of [STRUCTURE_WALL, STRUCTURE_RAMPART]) {
            if (room.memory.structMap[structs]) {
                needRepairs.push(...Utils.decodePosArray(room.memory.structMap[structs]).map(e =>
                    createWallOrRampart(new RoomPosition(e.x, e.y, room.name), structs)
                ))
            }
        }

        if (created) return;
        needRepairs.push(
            ...room.controller.pos.nearPos(1)
                .filter(e => !e.isTerrainWall())
                .map(pos => createWallOrRampart(pos, STRUCTURE_RAMPART))
        )

        if (created) return;
        // 8级后开始给东西上镀金
        let rampartCover = [STRUCTURE_SPAWN, STRUCTURE_TERMINAL, STRUCTURE_STORAGE, STRUCTURE_TOWER, STRUCTURE_POWER_SPAWN, STRUCTURE_FACTORY, STRUCTURE_NUKER, STRUCTURE_LAB]
        let coverMap = {}
        for (let i = 0; i < rampartCover.length; i++) { coverMap[rampartCover[i]] = i + 1; }
        if (room.level >= 7) {
            needRepairs.push(...room.find(FIND_STRUCTURES, { filter: e => coverMap[e.structureType] })
                .sort((a, b) => coverMap[a.structureType] - coverMap[b.structureType])
                .map(e => createWallOrRampart(e.pos, STRUCTURE_RAMPART)))
        }

        let nukes = room.find(FIND_NUKES);
        // let nukes = room.spawn.concat([room.storage]);
        needRepairs = needRepairs.flat().filter(e => e);
        let nukeHitsMap = {}
        if (nukes.length) {
            needRepairs.forEach((e) => nukes.forEach(n => {
                if (e.hits != e.hitsMax) {
                    if (e.pos.isEqualTo(n)) nukeHitsMap[e.id] = (nukeHitsMap[e.id] || 0) + 10000000
                    else if (e.pos.inRangeTo(n, 3)) nukeHitsMap[e.id] = (nukeHitsMap[e.id] || 0) + 5000000
                }
            }))
        }

        // log(nukeHitsMap)
        // log(needRepairs.sort((a, b) => a.hits-(nukeHitsMap[a.id]||0) - b.hits+(nukeHitsMap[b.id]||0)).map(e=>e.id+" "+(e.hits-(nukeHitsMap[e.id]||0))+" "+nukeHitsMap[e.id]));
        pro.needRepairWallMap[room.name] = needRepairs
            .sort((a, b) => a.hits - (nukeHitsMap[a.id] || 0) - b.hits + (nukeHitsMap[b.id] || 0))
            .map(e => e.id);
            
    },
    checkSafeMode(room) {
        // HelperError.catchError(()=>StationDefense.checkSafeMode(room))
        let hostileCnt = room.find(FIND_HOSTILE_CREEPS, { filter: e => e.owner.username != "Invader" && e.body.filter(e => e.type == HEAL && e.boost).length >= 5 }).length;
        if (!hostileCnt) return;
        // room.controller.pos.createFlag("raL1_W19N21_crossShard_114514")
        let MyRuinCnt = room.find(FIND_RUINS, {
            filter: e => e.structure.owner && e.structure.owner.username == room.controller.owner.username
                && e.structure.structureType != STRUCTURE_ROAD
                && e.structure.structureType != STRUCTURE_CONTAINER
                && e.structure.structureType != STRUCTURE_RAMPART
                && e.structure.structureType != STRUCTURE_EXTRACTOR
                && e.structure.structureType != STRUCTURE_LINK
        }).length
        if (!MyRuinCnt) return;
        room.controller.activateSafeMode()
    }
};



global.StationDefense = pro;
