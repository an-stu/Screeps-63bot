/*
autoBlueprint
saveBlueprint
showBlueprint

pa sourceA
pb sourceB
pc controller
pm mineral

storagePos
block_范围_后缀

{
    "controller": "Dy",
    "link": "eIgStF",
    "storage": "sF",
    "spawn": "qFsDsH",
    "tower": "rFsEsGqDuDqH",
    "powerSpawn": "uF",
    "road": "rGsIrHqGpFqErDsCtDuEvFuGtHtGrEtEvIvHwGuItJwJxKxGtKrBqAtBuAoEnDnCpArysytyvArJqKpKoJnInHoGwExDxCwBwyxyyAyByEyFyHyIyJoBmJmKnLoLrLsLuLvLwLmGmFmEmBmAnyoyvG",
    "terminal": "uH",
    "factory": "tI",
    "extension": "sBsArAtArCqBpBqCpCoCpDoDpEqypyuyvytCuCuBvBwCwDvDvEpGrIqIpIoIpHoHpJqJwAxByCyDxExFwFsJrKsKoFnEnGnFnJoKnKnAnBoAmCmDmHmI",
    "lab": "wIwHxHxIxJvJuJuKvKwK",
    "observer": "xA",
    "nuker": "vC"
}
 */


let pro={
    /**
     * 更新房间的路线,必须要要8级全部建筑
     * @param room
     * @param structMap
     */
    createRoads (room,roomManor,structMap){
        let storageX = room.storage.pos.x+1
        let storageY = room.storage.pos.y
        let visited = new RoomArray()
        // let roomStructs = new RoomArray()
        let costRoad = new RoomArray().init()
        let costRoad2 = new RoomArray().init()
        let roomWalkable = new RoomArray()

        roomWalkable.init().initRoomTerrainWalkAble(room.name)

        let queMin = new PriorityQueue(true)
        let queMax = new PriorityQueue(false)

        visited.init()
        roomManor.forEach((x,y,val)=>{
            if(roomWalkable.get(x,y)&&val==1){
                let nd = undefined
                roomManor.forNear((x1,y1,val1)=>{
                    if(roomWalkable.get(x1,y1)&&!val1&&!nd)nd = NewNode(1,x,y)
                },x,y)
                if(nd){
                    queMin.push(nd)
                    visited.exec(nd.x,nd.y,1)
                }
            }
        })
        queMin.whileNoEmpty(nd=>{
            roomManor.forNear((x,y,val)=>{
                if(!visited.exec(x,y,1)&&val>0){
                    queMin.push(NewNode(nd.k+1,x,y))
                }
            },nd.x,nd.y)
            roomManor.set(nd.x,nd.y,nd.k)
        })
        roomManor.forEach((x,y,val)=>{HelperVisual.showText(room.name,roomManor.get(x,y),{x:x,y:y},"blue")})

        queMin.push(NewNode(1,storageX,storageY));

        for(let k in structMap){
            structMap[k].forEach(e=>{
                if(k==STRUCTURE_RAMPART&&roomWalkable.get(e.x,e.y))return;
                roomWalkable.set(e.x,e.y,k)
            })
        }


        for(let k in structMap){
            structMap[k].forEach(e=>{
                if(k==STRUCTURE_RAMPART||k==STRUCTURE_WALL||k==STRUCTURE_LINK||k==STRUCTURE_CONTAINER||k==STRUCTURE_EXTRACTOR)return;
                costRoad.forNear((x,y,val)=>{
                    costRoad.set(x,y,1)
                    costRoad2.set(x,y,1)
                },e.x,e.y,1)
            })
        }
        costRoad2.forEach((x,y,val)=>{
            if(val==0){
                costRoad.forNear((x,y,val)=>{
                    costRoad.set(x,y,0)
                },x,y,1)
            }
        })

        visited.init()
        queMin.whileNoEmpty(nd=>{
            roomWalkable.forNear((x,y,val)=>{
                if(!visited.exec(x,y,1)&&(val>0||val==STRUCTURE_RAMPART)){
                    queMin.push(NewNode(nd.k+1,x,y))
                }
            },nd.x,nd.y)
            roomWalkable.set(nd.x,nd.y,nd.k)
        })

        costRoad.forEach((x,y,val)=>{
            if(val&&roomWalkable.get(x,y)>0){
                // HelperVisual.showText(room.name,(""+roomWalkable.get(x,y)).substr(0,2),{x:x,y:y},val>0?"red":"blue")
                queMax.push(NewNode(roomWalkable.get(x,y),x,y))
            }
        })
        queMax.whileNoEmpty(nd=>{
            roomWalkable.forNear((x,y,val)=>{
                if(val<nd.k&&roomWalkable.get(x,y)>0){
                    costRoad.set(x,y,1)
                    if(roomManor.get(x,y)>3)queMax.push(NewNode(val,x,y))
                }
            },nd.x,nd.y)
            // HelperVisual.showText(room.name,roomManor.get(nd.x,nd.y),nd,"blue")
            roomWalkable.set(nd.x,nd.y,STRUCTURE_ROAD)
        })


        structMap["road"] = []
        roomWalkable.forEach((x,y,val)=>{
            if(val==STRUCTURE_ROAD){structMap["road"].push({x:x,y:y})}
        })

        let costs = new PathFinder.CostMatrix;
        let terrain = new Room.Terrain(room.name);
        for(let i=0;i<50;i++){
            for(let j=0;j<50;j++){
                let te = terrain.get(i,j)
                if(i>=40||i<10||j>=40||j<10)
                    costs.set(i,j,te==TERRAIN_MASK_WALL?255:(te==TERRAIN_MASK_SWAMP?5:3))
                else
                    costs.set(i,j,te==TERRAIN_MASK_WALL?255:(te==TERRAIN_MASK_SWAMP?4:2))
            }
        }
        for(let struct of OBSTACLE_OBJECT_TYPES){
            if(structMap[struct]&&struct!=STRUCTURE_RAMPART&&struct!=STRUCTURE_CONTAINER&&struct!=STRUCTURE_ROAD){
                structMap[struct].forEach(e=>{
                    costs.set(e.x,e.y,255)
                })
            }
        }
        for (const o of [room.controller, room.mineral, ...(room.source || [])]) {
            if (o?.pos) costs.set(o.pos.x,o.pos.y,255);
        }
        const workTiles = Utils.roomContainerWorkTiles(room, {planned: structMap["container"] || []});
        structMap["road"] = structMap["road"].filter(({x,y}) => !workTiles.has(y * 50 + x));
        structMap["road"].forEach(e=>{
            if (costs.get(e.x,e.y) < 255) costs.set(e.x,e.y,1)
        })
        Utils.preferOffSourceContainers(costs, workTiles);
        const containers = (structMap["container"] || []).slice().sort((a,b)=>Math.hypot(a.x-storageX,a.y-storageY)-Math.hypot(b.x-storageX,b.y-storageY));
        containers.forEach(e=>{
            let ret = PathFinder.search(
                new RoomPosition(storageX,storageY,room.name),
                {pos:new RoomPosition(e.x,e.y,room.name),range:1},
                {
                    roomCallback:()=>{return costs},
                    maxRooms:1
                }
            )
            if (ret.incomplete) return;
            ret.path.forEach(pos=>{
                if(!workTiles.has(pos.y * 50 + pos.x) && costs.get(pos.x,pos.y) != 1){
                    structMap['road'].push({x:pos.x,y:pos.y})
                    costs.set(pos.x,pos.y,1)
                }
            })

        })

    },
    updateWall(room,structMap){
        let roomStructures= new RoomArray()
        let roomManor= new RoomArray().init()
        let roomWalkable = new RoomArray()
        let visited = new RoomArray()

        roomStructures.init()
        visited.init()
        roomWalkable.init().initRoomTerrainWalkAble(room.name)
        let queMin = new PriorityQueue(true)


        for(let k in structMap){
            structMap[k].forEach(e=>{
                if(k==STRUCTURE_ROAD&&roomWalkable.get(e.x,e.y))return;
                roomStructures.set(e.x,e.y,k)
                if(k!=STRUCTURE_RAMPART&&k!=STRUCTURE_WALL&&k!=STRUCTURE_CONTAINER&&k!=STRUCTURE_LINK&&k!=STRUCTURE_EXTRACTOR&&k!=STRUCTURE_LINK)
                    roomWalkable.forNear((x,y,val)=>{
                        if(roomWalkable.get(x,y)&&!visited.exec(x,y,1)){
                            queMin.push(NewNode(0,x,y))
                        }
                            // roomManor.set(x,y,1)
                    },e.x,e.y,3)
            })
        }

        let WallError = false

        structMap[STRUCTURE_WALL] = []
        structMap[STRUCTURE_RAMPART] = []
        queMin.whileNoEmpty(nd=>{
            let struct = roomStructures.get(nd.x,nd.y);
            roomManor.set(nd.x,nd.y,1)
            if(struct==STRUCTURE_WALL||struct==STRUCTURE_RAMPART){
                return;
            }
            if(!roomWalkable.get(nd.x,nd.y))return;
            HelperVisual.showText(room.name,"▓",{x:nd.x,y:nd.y},'cyan')
            let isBorder = e=>!(e.x>0&&e.y>0&&e.x<49&&e.y<49)
            if(isBorder(nd))WallError=true;
            roomWalkable.forNear((x,y,val)=>{
                if(roomWalkable.get(x,y)&&!visited.exec(x,y,1)){
                    queMin.push(NewNode(0,x,y))
                }
            },nd.x,nd.y)
        })

        if(WallError){
            Logger.log("Planner", "围墙没维好，建筑会被打到")
            return;
        }
        visited.init()
        roomManor.forEach((x,y,val)=>{
            if(!val&&roomWalkable.get(x,y)){
                roomManor.forNear((x,y,val)=>{
                    let struct = roomStructures.get(x,y)
                    if((struct==STRUCTURE_RAMPART||struct==STRUCTURE_WALL)
                        &&!visited.exec(x,y,1) &&roomManor.get(x,y)){
                        structMap[struct].push({x:x,y:y});
                        // HelperVisual.showText(room.name,"▓",{x:x,y:y},'cyan')
                    }
                },x,y)
            }
        })
        return roomManor
    },
    saveStructMap (){
        let s = Game.flags.saveBlueprint;
        if(!s)return
        let room = Game.rooms[s.pos.roomName]
        if(!room||!room.my){
            Logger.log("Planner", "房间不是我的，禁止保存");
            return;
        }
        // let t = Game.cpu.getUsed();
        let structs = room.find(FIND_STRUCTURES,{filter:(e)=>(e.my||e.structureType==STRUCTURE_CONTAINER||e.structureType==STRUCTURE_WALL)&&e.structureType!=STRUCTURE_ROAD&&e.structureType!=STRUCTURE_CONTROLLER})

        let walkAble = new RoomArray().init()
        walkAble.initRoomTerrainWalkAble(room.name)

        let structMap = {}
        structs.forEach(e=>{
            if(!structMap[e.structureType])structMap[e.structureType] = []
            structMap[e.structureType].push(e.pos)
        })

        _.keys(CONTROLLER_STRUCTURES).forEach(struct=>{
            let len = CONTROLLER_STRUCTURES[struct][8]
            if(struct==STRUCTURE_RAMPART||struct==STRUCTURE_WALL||struct==STRUCTURE_ROAD)return;
            if(struct==STRUCTURE_LINK)len = 3
            if(struct==STRUCTURE_CONTAINER)len = 4
            if(!structMap[struct]||structMap[struct].length<len){
                let currentLen = (structMap[struct]?structMap[struct].length:0)
                Logger.log("Planner", struct+" 未使用完:现有"+currentLen+",最少"+len)
            }
        })

        let roomManor = pro.updateWall(room,structMap)
        // updateWall 在墙体圈不完整（WallError）时返回 undefined：继续跑
        // createRoads 会对 undefined.forEach 抛错，跳过末尾的 s.remove()，
        // saveBlueprint 旗子卡死、每 tick 重复报错。此时直接弃旗退出。
        if(!roomManor){
            Logger.log("Planner", "saveBlueprint: 围墙不完整，放弃保存并移除旗标")
            s.remove();
            return;
        }
        pro.createRoads(room,roomManor,structMap)

        // pro.showRoomStructures(room.name,structMap)
        // log(Game.cpu.getUsed()-t)
        _.keys(structMap).forEach(e=>{
            structMap[e] = Utils.encodePosArray(structMap[e].map(t=>{return {x:t.x,y:t.y}}))
        })
        Memory.rooms[s.pos.roomName].structMap = structMap
        s.remove();
    },
    tryCreateCons(pos,struct){
        let room = Game.rooms[pos.roomName];
        let intentKey = pos.x+":"+pos.y;
        if(room._constructIntents&&room._constructIntents[intentKey])return false;
        if ((room._construct_builed || 0) >= (room._blueprintTierSiteCeiling ?? Infinity)) return false;
        if (struct === STRUCTURE_ROAD && pro.roadWorkTiles(room).has(pos.y * 50 + pos.x)) return false;
        if(room.constructionSite.length+(room._construct_builed||0)<10){
            let head = pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType == struct).head()
            let site = pos.lookFor(LOOK_CONSTRUCTION_SITES).filter(e=>e.structureType == struct).head()
            if(!head&&!site){
                let code = pos.createConstructionSite(struct);
                if(code == OK){
                    room._construct_builed=(room._construct_builed||0)+1;
                    room._constructIntents=room._constructIntents||{};
                    room._constructIntents[intentKey]=true;
                    return true;
                }
                // Construction failures were previously silent, which made a
                // global site cap indistinguishable from a broken blueprint.
                // Keep only the latest compact result for console/dashboard
                // diagnosis; no growing error log in Memory.
                if(struct == STRUCTURE_EXTENSION){
                    room.memory.autoBuild = room.memory.autoBuild || {};
                    room.memory.autoBuild.extensionFailure = {
                        tick: Game.time, code: code, x: pos.x, y: pos.y,
                        globalSites: Object.keys(Game.constructionSites || {}).length,
                    };
                }
            }
        }
        return false;
    },
    tryCreateStructs(room,structMap,struct,structCnt=2500){
        if (struct === STRUCTURE_ROAD) return structMap?.[struct] && pro.tryCreateRoads(room, structMap);
        // Generic planning is also used by claim/cross-shard bootstrap. Below
        // RCL6 only containers serving an energy source or controller qualify.
        if (struct === STRUCTURE_CONTAINER && room.level < 6) {
            return pro.ensureSourceContainers(room, structMap);
        }
        structCnt = Math.min(structCnt,CONTROLLER_STRUCTURES[struct][room.level])
        if(structMap[struct]){
            let built = room[struct] && room[struct].length > -1 ? room[struct].length : (room[struct] ? 1 : 0);
            let queued = room.constructionSite.filter(e => e.structureType == struct).length;
            let missing = structCnt - built - queued;
            if(missing > 0){
                // RCL 分级蓝图是有序的：只能使用当前等级的前 N 个槽位，不能
                // 为了补数量提前占用后续 RCL 的 extension 位置。
                let str2Pos = Utils.decodePosArray(structMap[struct]);
                str2Pos.take(structCnt).forEach(e => {
                    if(missing > 0 && pro.tryCreateCons(new RoomPosition(e.x,e.y,room.name),struct)) missing--;
                });
            }
            // if(structCnt)
            // if(structMap[struct].length<structCnt)
        }
    },
    /** 删除当前 RCL 之外的 Extension 工地，保持严格的分级蓝图。 */
    pruneOutOfTierExtensionSites(room){
        let encoded = room.memory.structMap && room.memory.structMap[STRUCTURE_EXTENSION];
        if(!encoded) return;
        let limit = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.level];
        let allowed = {};
        Utils.decodePosArray(encoded).take(limit).forEach(pos => {
            allowed[pos.x + ":" + pos.y] = true;
        });
        room.constructionSite
            .filter(site => site.structureType == STRUCTURE_EXTENSION
                && !allowed[site.pos.x + ":" + site.pos.y])
            .forEach(site => site.remove());
    },
    showRoomStructures  (roomName,structMap){
        let roomStructs = new RoomArray().init()
        const visual = new RoomVisual(roomName);
        if(structMap["road"])structMap["road"].forEach(e=>roomStructs.set(e.x,e.y,"road"))
        _.keys(CONTROLLER_STRUCTURES).forEach(struct=>{
            if(!structMap[struct])return;
            if(struct=="road"){
                structMap[struct].forEach(e=>{
                    roomStructs.forNear((x,y,val)=>{
                        if(val =="road"&&((e.x>=x&&e.y>=y)||(e.x>x&&e.y<y)))visual.line(x,y,e.x,e.y,{color:structuresColor[struct]})
                    },e.x,e.y);
                    visual.text(structuresShape[struct], e.x,e.y+0.25, {color: structuresColor[struct],opacity:0.75,font: 1})
                })
            }
            else structMap[struct].forEach(e=>visual.text(structuresShape[struct], e.x,e.y+0.25, {color: structuresColor[struct],opacity:0.75,font: 1}))
        })
    },
    tryAutoBuildLowLevel0 (room){
        if((Game.time+room.hashCode()) % 150 == 0  && Game.cpu.bucket>50 && room.memory.structMap){
            pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_SPAWN);
            pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_EXTENSION);
            // room.memory.structMap[STRUCTURE_SPAWN].take(1).forEach(e=>{pro.tryCreateCons(new RoomPosition(e[0],e[1],room.name),STRUCTURE_SPAWN)})
            // room.memory.structMap[STRUCTURE_EXTENSION].take(10).forEach(e=>{pro.tryCreateCons(new RoomPosition(e[0],e[1],room.name),STRUCTURE_EXTENSION)})
        }
    },
    /**
     * Low-RCL source and controller containers are infrastructure priorities.
     * Resolve them by matching targets to existing container blueprint positions:
     * source first, controller second. The special pass may exceed the room's
     * 10-site ceiling once, but records its intent so generic planning cannot
     * duplicate the tile or ignore the count later in this tick.
     */
    ensureSourceContainers (room, structMap = room.memory.structMap){
        if (!room.my || !structMap || !structMap[STRUCTURE_CONTAINER]
            || room._priorityContainerIntentTick === Game.time) return;
        let sources = room.source || [];
        let planned = Utils.decodePosArray(structMap[STRUCTURE_CONTAINER]);
        let near = (a, b) => !!a && !!b && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
        let containers = room[STRUCTURE_CONTAINER] || [];
        let sites = room.constructionSite || [];
        let covered = target => containers.some(c => near(c.pos, target))
            || sites.some(s => s.structureType == STRUCTURE_CONTAINER && near(s.pos, target));
        let tryBlueprintContainerNear = target => {
            if (!target || covered(target)) return false;
            for (let spot of planned) {
                if (!near(spot, target)) continue;
                let structures = room.lookForAt(LOOK_STRUCTURES, spot.x, spot.y);
                // Containers may legally share a tile with a road or rampart.
                // Other built structures and any existing site make this slot unusable.
                if (structures.some(s => s.structureType != STRUCTURE_ROAD
                    && s.structureType != STRUCTURE_RAMPART)) continue;
                if (room.lookForAt(LOOK_CONSTRUCTION_SITES, spot.x, spot.y).length) continue;
                let intentKey = spot.x+":"+spot.y;
                if (room._constructIntents && room._constructIntents[intentKey]) continue;
                let pos = room.getPositionAt(spot.x, spot.y);
                if (pos && pos.createConstructionSite(STRUCTURE_CONTAINER) == OK) {
                    room._priorityContainerIntentTick = Game.time;
                    room._construct_builed = (room._construct_builed || 0) + 1;
                    room._constructIntents = room._constructIntents || {};
                    room._constructIntents[intentKey] = true;
                    return true;
                }
            }
            return false;
        };
        for (let source of sources) {
            if (tryBlueprintContainerNear(source.pos)) return;
        }
        // A source with no usable planned tile must not strand the controller
        // forever; after exhausting source candidates, fall through to its own
        // adjacent blueprint slot.
        if (room.controller) tryBlueprintContainerNear(room.controller.pos);
    },
    tryAutoBuildLowLevel800 (room){
        if((Game.time+room.hashCode()) % 150 == 0 && Game.cpu.bucket>50 && room.memory.structMap){
            // Source/controller containers precede other sites. Only RCL6+
            // rooms may also queue the other blueprint slots (e.g. mineral).
            pro.ensureSourceContainers(room);
            // 开始建 road 和 container
            pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_EXTENSION);
            if (room.level >= 6) pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_CONTAINER);
            pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_TOWER);
            if(room.extension&&room.extension.length>=20)
                pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_STORAGE);
                // room.memory.structMap[STRUCTURE_STORAGE].take(1).forEach(e=>{pro.tryCreateCons(new RoomPosition(e[0],e[1],room.name),STRUCTURE_STORAGE)})
            pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_ROAD);
        }
    },
    tryAutoBuildPinnedLabs(room) {
        // An explicitly approved room may build existing lab blueprint
        // points without turning on the shard-wide planner. 17 is coprime
        // with the economy pass (7/14 ticks).
        if (!room.my || room.memory.autoBuildLabs !== true || room.level < 6
            || MIN_CPU || Game.cpu.bucket <= 500 || (Game.time + room.hashCode()) % 17) return;
        const structMap = room.memory.structMap;
        if (structMap?.[STRUCTURE_LAB]) pro.tryCreateStructs(room, structMap, STRUCTURE_LAB);
    },
    /** A level change opens blueprint slots now, without recomputing a layout. */
    tryBuildOnRclChange(room) {
        if (!room.my || !room.memory?.structMap || !room.level) return;
        const last = room.memory.blueprintTierBuild;
        const tier = room.level;
        if (!last || last.rcl !== tier) {
            // Spread the first rollout over a few ticks; real upgrades run immediately.
            room.memory.blueprintTierBuild = {rcl:tier, nextTick:Game.time+(last ? 0 : (room.hashCode() & 3))};
        }
        const check = room.memory.blueprintTierBuild;
        if (MIN_CPU || Game.cpu.bucket <= 500 || check.nextTick == null || Game.time < check.nextTick) return;
        // If an individual damaged blueprint throws, do not repeat it every tick.
        check.nextTick = Game.time+61;
        const result = pro.tryCurrentBlueprintTier(room);
        check.state = result.state;
        if (result.state === "complete") delete check.nextTick;
        else check.nextTick = Game.time+(result.state === "blocked" ? 61 : 5);
        return result;
    },
    /** Queue only approved positions at current RCL, keeping first-spawn and defense policies. */
    tryCurrentBlueprintTier(room) {
        const map = room.memory?.structMap;
        if (!room.my || !map) return {state:"complete", placed:0};
        const sites = room.constructionSite;
        const start = room._construct_builed || 0;
        const used = Game._blueprintTierSiteCount ?? (Game._blueprintTierSiteCount = Object.keys(Game.constructionSites || {}).length);
        const budget = Math.min(100-used,10-sites.length-start);
        if (budget <= 0) return {state:"queued", placed:0};
        const priority = ["spawn","extension","tower","storage","container","link","terminal","extractor",
            "lab","factory","observer","powerSpawn","nuker","road"];
        let pending = false, queued = false;
        room._blueprintTierSiteCeiling = start+budget;
        try {
            for (const type of priority) {
                // Keep low-RCL bootstrap focus on the first spawn until it has been built.
                if (type === "extension" && !room.find(FIND_MY_SPAWNS).length) {
                    queued = !!map.spawn;
                    break;
                }
                if (!map[type] || (type === "lab" && room.memory.autoBuildLabs === false)) continue;
                const limit = CONTROLLER_STRUCTURES[type]?.[room.level] || 0;
                if (!limit) continue;
                const planned = Utils.decodeLayoutPositions(map[type]);
                const structures = Array.isArray(room[type]) ? room[type] : (room[type] ? [room[type]] : []);
                const existing = structures.concat(sites.filter(s=>s.structureType===type));
                let missing;
                if (type === "road") {
                    const key = p => p.x+50*p.y;
                    const occupied = new Set(existing.map(s=>key(s.pos)));
                    const work = pro.roadWorkTiles(room);
                    missing = planned.filter(p=>!occupied.has(key(p))&&!work.has(key(p))).length;
                } else if (type === "container" && room.level < 6) {
                    const near = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))<=1;
                    const targets = [...(room.source || []),room.controller].filter(s=>s?.pos);
                    missing = targets.filter(t=>planned.some(p=>near(p,t.pos))
                        && !existing.some(s=>near(s.pos,t.pos))).length;
                } else {
                    missing = Math.min(limit,planned.length)-existing.length;
                }
                if (missing <= 0) continue;
                const before = room._construct_builed || 0;
                if (before-start >= budget) { queued = true; break; }
                pro.tryCreateStructs(room,map,type);
                const added = (room._construct_builed || 0)-before;
                if (added < missing) {
                    if (added || (room._construct_builed || 0)-start >= budget) queued = true;
                    else pending = true;
                }
            }
        } finally {
            delete room._blueprintTierSiteCeiling;
            Game._blueprintTierSiteCount += (room._construct_builed || 0)-start;
        }
        const placed = (room._construct_builed || 0)-start;
        return {placed,state:queued ? "queued" : pending ? "blocked" : "complete"};
    },
    tryAutoBuildHighLevel (room){
        // min-CPU 模式下 worker（ROLE_PRIORITY -5）不执行，规划出的工地没人
        // 建：跳过 prune/例行扩建/道路补建，省下每个经济 pass 的扫描。
        // 唯一例外：extension 覆盖率 <60% 会直接卡死房间发展（spawn 无法
        // 产大爬），这个逃生门保留 bucket>300 的低门槛。
        if (MIN_CPU) {
            let emergencyLimit = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.level];
            if (room.memory.structMap && room.extension.length < emergencyLimit * 0.6
                && Game.cpu.bucket > 300) {
                pro.tryCreateStructs(room, room.memory.structMap, STRUCTURE_EXTENSION);
            }
            return;
        }
        // Extension 是 Spawn 能力的一部分。只要有缺口，每次经济调度（5 tick）
        // 都立即尝试；满额后才退回零成本的 150-tick 检查。这样升级不会因
        // 时间槽或全局工地上限暂满而长时间少两座 extension。
        if(room.memory.structMap) pro.pruneOutOfTierExtensionSites(room);
        let extensionLimit = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.level];
        let extensionQueued = room.constructionSite.filter(e => e.structureType == STRUCTURE_EXTENSION).length;
        let extensionMissing = room.extension.length + extensionQueued < extensionLimit;
        if(Game.cpu.bucket>500&&room.memory.structMap && (extensionMissing || (Game.time+room.hashCode()) % 150 == 0)){
            pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_EXTENSION);
        }
        // Old off-plan roads must not hide missing bypasses. Spread exact
        // position checks across economy passes instead of decoding every pass.
        if (Game.cpu.bucket > 500 && room.memory.structMap?.[STRUCTURE_ROAD]
            && Game.time >= (room.memory.nextBlueprintRoadCheck || 0)) {
            room.memory.nextBlueprintRoadCheck = Game.time + 25 + (room.hashCode() & 7);
            pro.tryCreateRoads(room, room.memory.structMap);
        }
        if((Game.time+room.hashCode()) % 600 == 0 && Game.cpu.bucket>500&&room.memory.structMap){ // 4级后600tick更新一次
            // 开始建 road 和 container
            _.keys(CONTROLLER_STRUCTURES).forEach(struct=>{
                if(struct == STRUCTURE_RAMPART || struct == STRUCTURE_WALL || struct == STRUCTURE_EXTENSION)return;
                pro.tryCreateStructs(room,room.memory.structMap,struct);
                // room.memory.structMap[struct].take(CONTROLLER_STRUCTURES[struct][room.level]).forEach(e=>{
                //     let pos = new RoomPosition(e[0],e[1],room.name);
                //     let head = pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType == struct).head()
                //     if(!head)pos.createConstructionSite(struct)
                // })
            })
        }
    },
    roadWorkTiles(room) {
        return room._roadContainerWorkTiles || (room._roadContainerWorkTiles = Utils.roomContainerWorkTiles(room));
    },
    tryCreateRoads(room, structMap) {
        if (!structMap?.[STRUCTURE_ROAD]) return;
        const sites = room.constructionSite || [];
        if (sites.length + (room._construct_builed || 0) >= 10) return;
        const protectedTiles = pro.roadWorkTiles(room);
        const occupied = new Set([...(room[STRUCTURE_ROAD] || []), ...sites].map(o => o.pos.y * 50 + o.pos.x));
        for (const p of Utils.decodeLayoutPositions(structMap[STRUCTURE_ROAD])) {
            if (sites.length + (room._construct_builed || 0) >= 10) break;
            if ((room._construct_builed || 0) >= (room._blueprintTierSiteCeiling ?? Infinity)) break;
            const tile = p.y * 50 + p.x;
            if (!protectedTiles.has(tile) && !occupied.has(tile)) {
                pro.tryCreateCons(new RoomPosition(p.x, p.y, room.name), STRUCTURE_ROAD);
            }
        }
    },
    /**
     * Repair only the local road junction around each occupied work tile.
     * A failed repair is transactional: keep the entire original junction.
     * Roads as well as all eight normal walking directions are considered.
     */
    planWorkTileRoads(room) {
        const layout = room.memory?.structMap;
        const encoded = layout?.[STRUCTURE_ROAD];
        const result = {roads:encoded, added:[], removed:[], retained:[]};
        if (!encoded) return result;
        const protectedTiles = pro.roadWorkTiles(room);
        const code = p => { const q = p?.pos || p; return q?.y * 50 + q?.x; };
        const roads = new Set(Utils.decodeLayoutPositions(encoded).map(code));
        const sites = room.constructionSite || [];
        const builtRoads = new Set((room[STRUCTURE_ROAD] || []).map(code));
        const roadSites = new Set(sites.filter(s => s.my !== false && s.structureType === STRUCTURE_ROAD).map(code));
        const conflicts = [...protectedTiles].filter(t => roads.has(t) || builtRoads.has(t) || roadSites.has(t)).sort((a,b) => a-b);
        if (!conflicts.length) return result;
        const blockers = new Set([code(room.controller), code(room.mineral), ...(room.source || []).map(code)]);
        for (const [type, positions] of Object.entries(layout)) {
            if (!OBSTACLE_OBJECT_TYPES.includes(type)) continue;
            for (const p of Utils.decodeLayoutPositions(positions)) blockers.add(code(p));
        }
        const actual = room.getStructures ? room.getStructures() : room.find(FIND_STRUCTURES);
        for (const s of actual.concat(sites)) {
            if (OBSTACLE_OBJECT_TYPES.includes(s.structureType)
                || s.structureType === STRUCTURE_RAMPART && !s.my && !s.isPublic) blockers.add(code(s));
        }
        const terrain = room.getTerrain();
        let changed = false;
        for (const tile of conflicts) {
            const detour = pro.findWorkTileRoadBypass(tile, roads, builtRoads, protectedTiles, blockers, terrain);
            if (!detour) { result.retained.push(tile); continue; }
            changed = roads.delete(tile) || changed;
            result.removed.push(tile);
            for (const t of detour) {
                if (!roads.has(t)) { roads.add(t); result.added.push(t); }
            }
        }
        if (result.added.length || changed) {
            result.roads = Utils.encodePosArray([...roads].map(t => ({x:t % 50, y:Math.floor(t / 50)})));
        }
        return result;
    },
    findWorkTileRoadBypass(tile, roads, builtRoads, protectedTiles, blockers, terrain) {
        const cx = tile % 50, cy = Math.floor(tile / 50), radius = 3;
        const local = new Map();
        for (let y = Math.max(1, cy-radius); y <= Math.min(48, cy+radius); y++) {
            for (let x = Math.max(1, cx-radius); x <= Math.min(48, cx+radius); x++) {
                const t = y * 50 + x;
                if (protectedTiles.has(t) || blockers.has(t)) continue;
                const ground = terrain.get(x,y);
                if (ground & TERRAIN_MASK_WALL) continue;
                local.set(t, roads.has(t) || builtRoads.has(t) ? 1 : (ground & TERRAIN_MASK_SWAMP) ? 10 : 4);
            }
        }
        const neighbors = t => {
            const out = [], x = t % 50;
            for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
                if ((!dx && !dy) || x+dx < 1 || x+dx > 48) continue;
                const n = t + dy*50 + dx;
                if (local.has(n)) out.push(n);
            }
            return out;
        };
        // Two occupied road tiles may be one shared bottleneck. Never delete
        // them one at a time based on incomplete local connectivity evidence.
        for (const t of protectedTiles) {
            if (t !== tile && roads.has(t)
                && Math.max(Math.abs(t % 50-cx), Math.abs(Math.floor(t / 50)-cy)) === 1) return undefined;
        }
        const endpoints = neighbors(tile).filter(t => roads.has(t));
        if (endpoints.length < 2) return [];
        const joined = new Set();
        const addRoads = new Set();
        const flood = start => {
            const queue = [start];
            joined.add(start);
            for (let i=0; i<queue.length; i++) for (const n of neighbors(queue[i])) {
                if (!joined.has(n) && (roads.has(n) || addRoads.has(n))) {
                    joined.add(n);
                    queue.push(n);
                }
            }
        };
        flood(endpoints[0]);
        while (endpoints.some(t => !joined.has(t))) {
            const pending = new Map([...joined].map(t => [t,0]));
            const previous = new Map(), visited = new Set();
            const goals = new Set(endpoints.filter(t => !joined.has(t)));
            let found;
            while (pending.size) {
                let current, best = Infinity;
                for (const [t,d] of pending) if (d < best) { current=t; best=d; }
                pending.delete(current);
                visited.add(current);
                if (goals.has(current)) { found=current; break; }
                for (const n of neighbors(current)) {
                    const d = best + local.get(n);
                    if (visited.has(n) || d >= (pending.get(n) ?? Infinity)) continue;
                    pending.set(n,d);
                    previous.set(n,current);
                }
            }
            if (found === undefined) return undefined;
            let t = found;
            while (!joined.has(t)) {
                if (!roads.has(t)) addRoads.add(t);
                t = previous.get(t);
            }
            flood(t);
        }
        return [...addRoads];
    },
    updateWorkTileRoads(rooms) {
        const due = rooms.filter(r => r.my && r.memory.structMap?.[STRUCTURE_ROAD]
            && (r.memory.workTileRoads?.version !== 1 || r.memory.workTileRoads.next <= Game.time));
        const room = due.find(r => r.memory.workTileRoads?.version !== 1) || due[0];
        if (!room) return;
        const start = Game.cpu.getUsed();
        const result = pro.planWorkTileRoads(room);
        if (result.roads !== room.memory.structMap[STRUCTURE_ROAD]) {
            room.memory.structMap[STRUCTURE_ROAD] = result.roads;
            delete room._plannedRoadSet;
            delete room.memory.nextBlueprintRoadCheck;
        }
        room.memory.workTileRoads = {version:1, tick:Game.time, next:Game.time+3000,
            added:result.added, removed:result.removed, retained:result.retained,
            cpu:Math.round((Game.cpu.getUsed()-start)*1000)/1000};
    },
    exec (){
        pro.computeAnyRoom();
        pro.saveStructMap();
        pro.showRoom();
    },
    showRoom (){
        let show = Game.flags.showBlueprint;
        if(show){
            // showBlueprint 可以插在无视野房间；TTL 清扫会删掉不可见房间的
            // Memory.rooms 条目，之后裸取 .structMap 每 tick 抛 TypeError
            if(Memory.rooms[show.pos.roomName] && Memory.rooms[show.pos.roomName].structMap)
                HelperVisual.showRoomStructures(show.pos.roomName,Memory.rooms[show.pos.roomName].structMap)
        }
    },
    getBlocked(){
        let roomArray = null;
        if (ManagerFlags.getFlagsByPrefix("block").length) {
            roomArray = new RoomArray().init()
            ManagerFlags.getFlagsByPrefix("block").forEach(f=>{
                let size = parseInt(f.getNameSplit()[1]||1)
                roomArray.set(f.pos.x,f.pos.y,TERRAIN_MASK_WALL)
                roomArray.forNear((x,y)=>{
                    roomArray.set(x,y,TERRAIN_MASK_WALL)
                },f.pos.x,f.pos.y,size)
            })
            roomArray.forEach((x,y,val)=>{
                // pa 是可选的布局锚点：只放了 block_ 旗而没有 pa 旗时
                // Game.flags.pa 为 undefined，裸取 .pos 每 tick 抛 TypeError
                // 并让整次蓝图计算失效（getBlocked 在存在性检查之前执行）。
                if(val && Game.flags.pa) HelperVisual.showText(Game.flags.pa.pos.roomName,"*",{x:x,y:y})
            })
        }
        return roomArray;
    },
    computeAnyRoom (){
        let blocked = pro.getBlocked();
        let p = Game.flags.autoBlueprint;
        if(!p)return;
        if(Game.cpu.bucket<300)return;
        let pa = Game.flags.pa;
        let pb = Game.flags.pb;
        let pc = Game.flags.pc;
        let pm = Game.flags.pm;
        if(p&&pa&&pc&&pm) {
            let roomStructsData = ManagerPlanner.computeManor(p.pos.roomName,[pc,pm,pa,pb],blocked)
            if(roomStructsData){
                Memory.rooms[roomStructsData.roomName]=Memory.rooms[roomStructsData.roomName]||{}
                _.keys(roomStructsData.structMap).forEach(e=>{
                    roomStructsData.structMap[e] = Utils.encodePosArray(roomStructsData.structMap[e].map(t=>{return {x:t[0],y:t[1]}}))
                })
                Memory.rooms[roomStructsData.roomName].structMap = roomStructsData.structMap
            }else Logger.log("Planner", "storagePos 位置不合适")
            p.remove()
        }
        else if(Game.rooms[p.pos.roomName]&&Game.rooms[p.pos.roomName].controller){
            const result = pro.computeRoom(p);
            if (!result.ok) Logger.warning("Planner", p.pos.roomName, result.reason);
            p.remove()
        }
    },
    computeRoom (roomObject){
        if(Game.cpu.bucket<300)return {ok:false, reason:"insufficient_cpu"};
        const room = roomObject?.room, name = roomObject?.pos?.roomName || room?.name;
        if (!room?.controller?.pos || !room.mineral?.pos || !room.source?.length || !name) {
            return {ok:false, reason:"missing_room_data"};
        }
        let points = [room.controller.pos, room.mineral.pos, ...room.source.map(e=>e.pos)]
        points = points.map(e=>{return {pos:new RoomPosition(e.x,e.y,name) }} )
        let roomStructsData = ManagerPlanner.computeManor(name,points)
        if (!roomStructsData?.structMap) return {ok:false, reason:"no_valid_layout"};
        if (!roomStructsData.structMap[STRUCTURE_SPAWN]?.some(([x,y]) =>
            Number.isInteger(x) && Number.isInteger(y) && x>0 && x<49 && y>0 && y<49)) {
            return {ok:false, reason:"missing_spawn_slot"};
        }
        _.keys(roomStructsData.structMap).forEach(e=>{
            roomStructsData.structMap[e] = Utils.encodePosArray(roomStructsData.structMap[e].map(t=>{return {x:t[0],y:t[1]}}))
        })
        const rooms = Memory.rooms || (Memory.rooms = {});
        const memory = room.memory || (rooms[name] = rooms[name] || {});
        memory.structMap = roomStructsData.structMap;
        return {ok:true};
    }
};


global.ManagerAutoPlanner = pro;
