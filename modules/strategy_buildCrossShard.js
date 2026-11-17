/**
 * 跨 shard 建设（在**目标 shard** 上运行，靠 Memory 配置驱动）。
 *
 * Memory.crossShardBuild = {
 *     room: 'E51S29',          // 目标房（本 shard，已占领）
 *     originShard: 'shard3',   // 从哪个 shard 派工人
 *     spawnRoom: 'E49S31',     // originShard 上靠近虫洞的孵化房
 *     builders: 2,             // 同时在场工人上限
 * }
 *
 * 流程：
 * 1. 目标房没有 spawn ⇒ 生成 structMap（一次性）并建 spawn 工地；
 * 2. 工人在 originShard 孵化，任务链 [buildCrossShardRoom, moveCrossShardByPath]。
 *    任务栈**末尾先执行**（execLastTask），所以先走虫洞，跨过去后自动弹出、
 *    接着执行 buildCrossShardRoom：本地采能 → 修工地；
 * 3. spawn 建成后配置自动删除，工人任务收尾（自杀），不再派新工人。
 *
 * 路径与 claim 流程共用 StrategyClaimCrossShard.getPath()：waypoint 是**出发侧
 * 虫洞**（shard3 E50S30 15,5），目标 shard 由虫洞 destination 决定；不要把
 * 落地格追成第二段（会让 index 在末段来回，见 v0.78.262）。
 */
let pro = {
    exec() {
        let cfg = Memory.crossShardBuild;
        if (!cfg || !cfg.room) return;
        if (Game.time % 5 != 0) return;
        let room = Game.rooms[cfg.room];
        if (!room || !room.my || !room.controller) return;
        if (room.find(FIND_MY_SPAWNS).length) {
            // 阶段完成：后续交给常规房间经济
            delete Memory.crossShardBuild;
            return;
        }
        pro.ensureSpawnSite(room);

        let want = cfg.builders || 2;
        let alive = 0;
        for (let name in Game.creeps) {
            let creep = Game.creeps[name];
            if (creep.memory.role == "crossShardBuilder" && creep.memory.roomName == cfg.room) alive++;
        }
        if (alive >= want) return;
        // 工人在路上时目标 shard 看不到它（只有 origin shard 可见），所以用
        // 真实时间做派车间隔，避免每 5 tick 重复下发 spawn 任务。
        let now = Date.now();
        if (now - (cfg.lastSpawnReal || 0) < 8 * 60 * 1000) return;
        if ((cfg.spawned || 0) >= 6) return;
        cfg.lastSpawnReal = now;
        cfg.spawned = (cfg.spawned || 0) + 1;
        let pathData = (global.StrategyClaimCrossShard && StrategyClaimCrossShard.getPath)
            ? StrategyClaimCrossShard.getPath()
            : undefined;
        ManagerCrossShard.addCrossShardRequest(cfg.originShard, {
            func: "spawnCreepCressShard",
            data: {
                spawnRoom: cfg.spawnRoom,
                targetRoomName: cfg.room,
                body: ManagerCreeps.calcBodyPart({ [WORK]: 6, [CARRY]: 6, [MOVE]: 12 }),
                role: "crossShardBuilder",
                tasks: [
                    UtilsTask.taskData("buildCrossShardRoom", undefined, { roomName: cfg.room }),
                    UtilsTask.taskData("moveCrossShardByPath", undefined, pathData),
                ],
            },
        });
    },

    /** spawn 工地：优先用自动规划的 structMap（后续扩展也靠它），失败时螺旋找空位。 */
    ensureSpawnSite(room) {
        let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
        if (sites.some(s => s.structureType == STRUCTURE_SPAWN)) return true;
        Memory.rooms = Memory.rooms || {};
        let roomMem = Memory.rooms[room.name] = Memory.rooms[room.name] || {};
        if (!roomMem.structMap && global.ManagerAutoPlanner && Game.cpu.bucket >= 1000) {
            try {
                ManagerAutoPlanner.computeRoom({ room: room, pos: room.controller.pos });
            } catch (e) { /* 规划失败就用下面的兜底 */ }
        }
        if (global.StrategyClaim && StrategyClaim.ensureConstructionSites) {
            try {
                StrategyClaim.ensureConstructionSites(room);
            } catch (e) { /* 兜底 */ }
            sites = room.find(FIND_MY_CONSTRUCTION_SITES);
            if (sites.some(s => s.structureType == STRUCTURE_SPAWN)) return true;
        }
        return pro.placeSpawnSite(room);
    },

    /** 兜底：绕 controller 由近到远找第一个可建格。 */
    placeSpawnSite(room) {
        let ctrl = room.controller.pos;
        let terrain = room.getTerrain();
        for (let d = 1; d <= 8; d++) {
            for (let dx = -d; dx <= d; dx++) {
                for (let dy = -d; dy <= d; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) != d) continue;
                    let x = ctrl.x + dx, y = ctrl.y + dy;
                    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                    if (terrain.get(x, y) == TERRAIN_MASK_WALL) continue;
                    if (room.lookForAt(LOOK_STRUCTURES, x, y).length) continue;
                    if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length) continue;
                    if (room.getPositionAt(x, y).createConstructionSite(STRUCTURE_SPAWN) == OK) return true;
                }
            }
        }
        return false;
    },
};

/**
 * 目标房里的建造任务（任务栈末尾执行）。
 * 无 CARRY 时本地采能；有能量就修最近的自己的工地。
 * 工地全部完成且已有 spawn ⇒ 任务完成，自杀收尾。
 */
Creep.prototype.buildCrossShardRoom = function () {
    let task = this.lastTask();
    let room = Game.rooms[task.roomName];
    if (!room) return this.goTo(new RoomPosition(25, 25, task.roomName));
    let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    if (!sites.length) {
        if (room.find(FIND_MY_SPAWNS).length) return this.suicide();
        return;
    }
    let site = task.siteId ? Game.getObjectById(task.siteId) : null;
    if (!site) {
        site = sites.map(s => [s, this.pos.getRangeTo(s)]).sort((a, b) => a[1] - b[1])[0][0];
        task.siteId = site.id;
    }
    if (this.store[RESOURCE_ENERGY] > 0) {
        if (this.build(site) == ERR_NOT_IN_RANGE) {
            this.moveTo(site, { range: 3, reusePath: 20 });
        }
        return;
    }
    let source = task.sourceId ? Game.getObjectById(task.sourceId) : null;
    if (!source) {
        source = room.find(FIND_SOURCES)
            .map(s => [s, s.pos.getRangeTo(site)])
            .sort((a, b) => a[1] - b[1])[0][0];
        if (!source) return;
        task.sourceId = source.id;
    }
    if (this.harvest(source) == ERR_NOT_IN_RANGE) {
        this.moveTo(source, { range: 1, reusePath: 20 });
    }
};

global.StrategyBuildCrossShard = pro;
