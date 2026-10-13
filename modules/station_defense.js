


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
    /**
     * 「本房能量够不够养一只修墙 worker」的门槛（只看 storage）。
     *
     * 修 rampart 是**纯消耗**：1 能量换 100 血，RCL8 满血 3 亿 ⇒ **单个墙约需 300 万能量**，
     * 远超一房 storage 的容量（我们各房 storage 只有 4~10 万）。能量不够还一直修，
     * 等于把这个房的收入持续烧进墙里 —— 用户 10-13 报的
     * 「新房间 worker 修 rampart 应该看本房间能量是否充足，不要一直买」就是这个：
     * 原来 `getRepairWorkerLimit` 里 `energy < 1000000` 只是把编制降到 1，
     * **照样永远保留一只**，跟本房有没有能量无关
     *（实测 E53S21：38 个 rampart 都卡在 29M 血，补到 300M 要约 1 亿能量）。
     *
     * 判据只看本房 storage（terminal 是市场储备，不给可选消耗背书，沿用既有口径），
     * 可用 `Memory.marketSettings.repairWallEnergyFloor` 覆盖。
     */
    get repairWallEnergyFloor() {
        return Number(Memory.marketSettings && Memory.marketSettings.repairWallEnergyFloor)
            || 100000;
    },
    repairWallAffordable(room) {
        if (!room) return false;
        if (!room.storage) return false;      // 还没起 storage 的房：先发展经济，别修墙
        return (room.storage.store[RESOURCE_ENERGY] || 0) >= pro.repairWallEnergyFloor;
    },
    levelWallHits: {
        // 1:5000,2:5000,3:5000,4:50000,5:500000,6:1000000,7:3000000,8:(Game.shard.name == "shard3"?10:100)*1000000 // 8级最少修10m墙壁
        1: 5000, 2: 5000, 3: 5000, 4: 5000, 5: 5000, 6: 500000, 7: 5000000, 8: (Game.shard.name == "shard3" ? 300 : 150) * 1000000
    },
    HitsCPUSave: 100 * 1000000,
    getRepairWorkerLimit(room) {
        // 本房能量不足 → **一只修墙 worker 都不派**（见 repairWallEnergyFloor 的推导）。
        // 返回 0 之后 workerManager 的 `workerCount < workerLimit` 恒假，那一条出兵路径
        // 自然就断了；建造工地走的是另一条分支（`room.constructionSite.length`），不受影响。
        if (!pro.repairWallAffordable(room)) return 0;
        // Rampart work is intentionally sparse near the target. Once a wall
        // reaches the 99.9% maintenance threshold, no replacement is made;
        // the remaining worker expires naturally and a later small deficit
        // starts one new maintenance worker. This avoids permanent repair
        // traffic just to keep RCL8 ramparts near 300M hits.
        let energy = room.storage ? room.storage.store[RESOURCE_ENERGY] || 0 : 0;
        let wall = pro.needRepairWallMap[room.name]
            && Game.getObjectById(pro.needRepairWallMap[room.name].head());
        let target = pro.levelWallHits[room.level] || 0;
        if (!wall || !target || energy < 1000000) return 1;
        // Two workers are reserved for a material defensive deficit, never
        // merely because the storage is large. Three are construction-only.
        return wall.hits < target * 0.6 ? 2 : 1;
    },
    // wallListMap:{},
    /**
     * 「本房有墙要修」—— **且本房修得起**。
     *
     * 这两个谓词是修墙的**全部入口**：`workerManager` 用它决定要不要出修墙 worker，
     * `workerManagerAfterCarrier` 用它决定要不要把空闲 worker 派去修墙。
     * 所以能量闸放在这里，两条路一起管住（`getRepairWorkerLimit` 里那个 0 是第二层）。
     */
    needBuildWall(room) {
        if (!pro.repairWallAffordable(room)) return false;
        if (!pro.needRepairWallMap[room.name]) return false;
        let wall = Game.getObjectById(pro.needRepairWallMap[room.name].head());
        return wall && wall.hits < pro.levelWallHits[room.level]*0.999
            || (isSaveCpu && Game.cpu.bucket > 8000 && room.level == 8 && wall && wall.hits < pro.HitsCPUSave);
    },
    needBuildWallWorkerFree(room) {
        if (!pro.repairWallAffordable(room)) return false;
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
        // 5 级不生成 rampart/wall（也不维护旧 rampart），6 级开始再建墙
        if (room.level < 6) {
            delete pro.needRepairWallMap[room.name];
            return;
        }

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
            // 与 Tower.update 共享同一份每 tick 结构扫描缓存（getStructures）。
            needRepairs.push(...room.getStructures().filter(e => coverMap[e.structureType])
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
    checkSafeMode(room, hostiles) {
        // HelperError.catchError(()=>StationDefense.checkSafeMode(room))
        hostiles = hostiles || room.getHostileCreeps();
        let dangerous = false;
        for(let hostile of hostiles){
            if(hostile.owner.username == "Invader")continue;
            let boostedHeal = 0;
            for(let part of hostile.body){
                if(part.type == HEAL && part.boost && ++boostedHeal >= 5){
                    dangerous = true;
                    break;
                }
            }
            if(dangerous)break;
        }
        if (!dangerous) return;
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
