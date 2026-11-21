/**
 * Cross-shard spawn bootstrap.
 *
 * Target-shard configuration lives in Memory.crossShardBuilds[roomName]. The
 * older single-room Memory.crossShardBuild shape is migrated automatically.
 * Each request owns one stable slotId; requestId changes on a timeout, while
 * the source-shard receipt ledger makes retries for that slot idempotent.
 */
const BUILD_INTERVAL = 5;
const PLANNER_MIN_BUCKET = 6000;
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const TRANSIT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SOURCE_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_RECEIPT_TTL_TICKS = 25000;
const SOURCE_RECEIPT_LIMIT = 200;
const MAX_BUILDERS = 4;
const DOWNGRADE_PROTECTION_TICKS = 5000;
// A full body needs up to 150 spawn ticks, followed by the portal route. Old
// workers keep building while the next pair is spawned and travels here.
const BUILDER_REPLACEMENT_LEAD_TICKS = 350;
// When the source room can afford the full body at capacity but is temporarily
// drained, wait for energy to refill rather than spawning a downgraded worker.
// Only the tail of the request window falls back to the largest affordable body.
const FULL_BODY_WAIT_MS = 5 * 60 * 1000;

function copyPath(pathData) {
    if (!pathData || !Array.isArray(pathData.path) || !pathData.path.length) return null;
    let path = [];
    for (let waypoint of pathData.path) {
        if (!waypoint || !/^shard\d+$/.test(waypoint.shard || "") || !validRoomName(waypoint.roomName)
            || !Number.isInteger(waypoint.x) || waypoint.x < 0 || waypoint.x > 49
            || !Number.isInteger(waypoint.y) || waypoint.y < 0 || waypoint.y > 49) return null;
        path.push({shard:waypoint.shard, roomName:waypoint.roomName, x:waypoint.x, y:waypoint.y});
    }
    return {path:path};
}

function now() {
    return Date.now();
}

function ensureBuildMap() {
    Memory.crossShardBuilds = Memory.crossShardBuilds || {};
    return Memory.crossShardBuilds;
}

function normalizeBuilderCount(value, fallback) {
    let count = Number(value);
    if (!isFinite(count) || count < 1) count = fallback || 2;
    return Math.max(1, Math.min(MAX_BUILDERS, Math.floor(count)));
}

function validRoomName(value) {
    return typeof value == "string" && /^[WE]\d+[NS]\d+$/.test(value);
}

function validShardName(value) {
    return typeof value == "string" && /^shard\d+$/.test(value);
}

function getRoomMemory(room) {
    Memory.rooms = Memory.rooms || {};
    if (room.memory) return room.memory;
    return Memory.rooms[room.name] = Memory.rooms[room.name] || {};
}

function copyOptionsInto(cfg, options) {
    options = options || {};
    if (options.originShard !== undefined && typeof options.originShard == "string" && options.originShard) {
        cfg.originShard = options.originShard;
    }
    if (options.spawnRoom !== undefined && validRoomName(options.spawnRoom)) cfg.spawnRoom = options.spawnRoom;
    if (options.builders !== undefined) cfg.builders = normalizeBuilderCount(options.builders, cfg.builders);

    // The first valid route is copied into Memory once. Workers receive a
    // separate copy, so moveCrossShardByPath's mutable index cannot change the
    // configured route (and a later start() cannot silently reroute in-flight
    // workers).
    if (!cfg.path && options.path !== undefined) cfg.path = copyPath(options.path);
}

let pro = {
    /**
     * Persist a room config without resetting request state on repeated calls.
     * Returns the config on valid input, otherwise false.
     */
    start(roomName, options) {
        if (!validRoomName(roomName)) return false;
        options = options || {};
        if (options.originShard !== undefined && !validShardName(options.originShard)) return false;
        if (options.spawnRoom !== undefined && !validRoomName(options.spawnRoom)) return false;
        if (options.path !== undefined && !copyPath(options.path)) return false;
        let builds = ensureBuildMap();
        let cfg = builds[roomName];
        if (!cfg) cfg = builds[roomName] = {roomName:roomName, pending:[], nextSlotSeq:1, nextRequestSeq:1};
        cfg.roomName = roomName;
        cfg.pending = Array.isArray(cfg.pending) ? cfg.pending : [];
        cfg.nextSlotSeq = Math.max(1, Number(cfg.nextSlotSeq) || 1);
        cfg.nextRequestSeq = Math.max(1, Number(cfg.nextRequestSeq) || 1);
        copyOptionsInto(cfg, options);
        cfg.builders = normalizeBuilderCount(cfg.builders, 2);
        return cfg.originShard && cfg.spawnRoom ? cfg : false;
    },

    /** Move the legacy one-room setting into the keyed map and freeze its route. */
    migrateLegacyConfig() {
        let legacy = Memory.crossShardBuild;
        if (!legacy) return;
        let roomName = legacy.roomName || legacy.room;
        if (!validRoomName(roomName)) return;
        let cfg = pro.start(roomName, {
            originShard:legacy.originShard,
            spawnRoom:legacy.spawnRoom,
            builders:legacy.builders,
            path:legacy.path,
        });
        if (!cfg) return;
        cfg.legacy = true;
        if (!cfg.path && global.StrategyClaimCrossShard
            && typeof StrategyClaimCrossShard.getPath == "function") {
            cfg.path = copyPath(StrategyClaimCrossShard.getPath());
        }
        delete Memory.crossShardBuild;
    },

    recordOperation(cfg, state, details) {
        let flag = {
            pos:{roomName:cfg.roomName},
            memory:{originShard:cfg.originShard, spawnRoom:cfg.spawnRoom},
        };
        if (global.StrategyClaim && typeof StrategyClaim.recordOperation == "function") {
            StrategyClaim.recordOperation(flag, state, details || {});
            return;
        }
        Memory.claimOperations = Memory.claimOperations || {};
        let operation = Memory.claimOperations[cfg.roomName]
            = Memory.claimOperations[cfg.roomName] || {roomName:cfg.roomName, startedAt:Game.time, history:[]};
        let changed = operation.state != state;
        operation.state = state;
        operation.updatedAt = Game.time;
        operation.originShard = cfg.originShard;
        operation.spawnRoom = cfg.spawnRoom;
        operation.status = details || {};
        if (changed) {
            operation.history.push({tick:Game.time, state:state});
            if (operation.history.length > 20) operation.history.shift();
        }
    },

    exec() {
        pro.migrateLegacyConfig();
        if (Game.time % BUILD_INTERVAL != 0) return;
        let builds = ensureBuildMap();
        Object.keys(builds).forEach(roomName => {
            let cfg = builds[roomName];
            if (!cfg || cfg.roomName != roomName) return;
            pro.execRoom(cfg);
        });
        pro.recoverBootstrapConfigs(builds);
    },

    /** RCL<3 的已占领跨 shard 房若丢了建设配置（旧版 spawn 建成即 COMPLETE 误删），
     *  从 room.memory.crossShardBootstrap 恢复，保证援建持续到 RCL3。 */
    recoverBootstrapConfigs(builds) {
        Object.keys(Game.rooms || {}).forEach(roomName => {
            let room = Game.rooms[roomName];
            if (!room || !room.my || !room.controller) return;
            if ((room.controller.level || 0) >= 3) return;
            if (room.storage && room.storage.my) return;
            if (builds[roomName]) return;
            let bootstrap = room.memory && room.memory.crossShardBootstrap;
            if (!bootstrap || !bootstrap.originShard || !bootstrap.spawnRoom) return;
            pro.start(roomName, bootstrap);
        });
    },

    execRoom(cfg) {
        let room = Game.rooms[cfg.roomName];
        if (!room || !room.my || !room.controller) {
            pro.recordOperation(cfg, "WAITING_FOR_OWNERSHIP", {visible:!!room});
            return;
        }
        let spawns = room.find(FIND_MY_SPAWNS);
        let level = room.controller.level || 0;
        // RCL<3 持续援建（用户政策）：spawn 建成也不转入本地自产，继续派跨 shard
        // 建筑爬援建剩余工地，直到 RCL3 才 COMPLETE。低级房 spawn 只产防守爬。
        if (spawns.length && level >= 3) {
            pro.recordOperation(cfg, "COMPLETE", {mySpawns:spawns.length, level:level});
            delete ensureBuildMap()[cfg.roomName];
            if (Memory.crossShardBuild && (Memory.crossShardBuild.room == cfg.roomName
                || Memory.crossShardBuild.roomName == cfg.roomName)) delete Memory.crossShardBuild;
            return;
        }

        // This helper only destroys owned-room structures with a foreign owner;
        // in particular, neutral walls/roads/containers remain untouched.
        if (global.StrategyClaim && typeof StrategyClaim.destroyForeignStructures == "function") {
            try { StrategyClaim.destroyForeignStructures(room); } catch (e) { /* retry next pass */ }
        }

        if (spawns.length) {
            // 已有 spawn 但 RCL<3：跳过蓝图/Spawn 工地逻辑，直接持续援建。
            pro.dispatchBuilders(cfg);
            return;
        }

        let roomMemory = getRoomMemory(room);
        let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
        let hasSpawnSite = sites.some(site => site.structureType == STRUCTURE_SPAWN);

        if (!roomMemory.structMap?.[STRUCTURE_SPAWN]?.length && !hasSpawnSite) {
            if (!pro.ensureBlueprint(room, cfg)) return;
            roomMemory = getRoomMemory(room);
            sites = room.find(FIND_MY_CONSTRUCTION_SITES);
            hasSpawnSite = sites.some(site => site.structureType == STRUCTURE_SPAWN);
        }
        if (roomMemory.structMap && global.StrategyClaim
            && typeof StrategyClaim.ensureConstructionSites == "function") {
            try { StrategyClaim.ensureConstructionSites(room); } catch (e) { /* inspect again next pass */ }
            sites = room.find(FIND_MY_CONSTRUCTION_SITES);
            hasSpawnSite = sites.some(site => site.structureType == STRUCTURE_SPAWN);
        }

        if (!hasSpawnSite) {
            pro.recordOperation(cfg, roomMemory.structMap ? "WAITING_FOR_SPAWN_SITE" : "WAITING_FOR_BLUEPRINT", {
                bucket:Game.cpu && Game.cpu.bucket,
                plannerRetryAt:cfg.nextPlannerAttemptAt,
                constructionSites:sites.length,
            });
            return;
        }
        pro.dispatchBuilders(cfg);
    },

    ensureBlueprint(room, cfg) {
        if (!global.StrategyClaim || typeof StrategyClaim.ensureClaimBlueprint !== "function") {
            pro.recordOperation(cfg, "WAITING_FOR_PLANNER", {reason:"claim_planner_unavailable"});
            return false;
        }
        const result = StrategyClaim.ensureClaimBlueprint(room,PLANNER_MIN_BUCKET);
        if (result.ready) {
            delete cfg.nextPlannerAttemptAt;
            delete cfg.lastPlannerError;
            return true;
        }
        cfg.nextPlannerAttemptAt = result.retryAt;
        pro.recordOperation(cfg, result.state, result);
        return false;
    },

    /** Keep pending bounded by the configured concurrent-builder target. */
    dispatchBuilders(cfg) {
        pro.reconcilePending(cfg);
        // Retry expired requests with the same slotId (source deduplication
        // prevents double-spawning), but a fresh requestId and real deadline.
        let timestamp = now();
        for (let index = cfg.pending.length - 1; index >= 0; index--) {
            let pending = cfg.pending[index];
            if (pending.state == "REQUESTED" && pending.deadline <= timestamp) {
                pro.sendBuilderRequest(cfg, pending);
            } else if (pending.state == "SPAWNING" && pending.deadline <= timestamp) {
                // An acknowledged worker that never arrived is presumed lost in
                // transit. Allocate a fresh slot after the long grace period.
                cfg.pending.splice(index, 1);
            }
        }
        let workers = pro.countLocalBuilders(cfg.roomName, BUILDER_REPLACEMENT_LEAD_TICKS);
        let want = normalizeBuilderCount(cfg.builders, 2);
        if (workers + cfg.pending.length >= want) {
            pro.recordOperation(cfg, "BUILDERS_IN_FLIGHT", {
                workers:pro.countLocalBuilders(cfg.roomName), coveringWorkers:workers,
                pending:cfg.pending.length, target:want,
            });
            return;
        }
        if (!cfg.path && cfg.legacy && !cfg.legacyPathChecked) {
            cfg.legacyPathChecked = true;
            if (global.StrategyClaimCrossShard && typeof StrategyClaimCrossShard.getPath == "function") {
                cfg.path = copyPath(StrategyClaimCrossShard.getPath());
            }
        }
        if (!copyPath(cfg.path)) {
            pro.recordOperation(cfg, "BLOCKED_NO_PATH", {legacy:!!cfg.legacy});
            return;
        }
        if (!validShardName(cfg.originShard) || !validRoomName(cfg.spawnRoom) || !global.ManagerCrossShard
            || typeof ManagerCrossShard.addCrossShardRequest != "function") {
            pro.recordOperation(cfg, "BLOCKED_NO_SPAWN_CONFIG", {});
            return;
        }
        let pending = {
            slotId:Game.shard.name + ":" + cfg.roomName + ":" + Game.time + ":" + cfg.nextSlotSeq++,
            state:"REQUESTED",
            attempts:0,
        };
        cfg.pending.push(pending);
        // A malformed config should not let Memory grow without bound.
        while (cfg.pending.length > want) cfg.pending.shift();
        pro.sendBuilderRequest(cfg, pending);
    },

    reconcilePending(cfg) {
        cfg.pending = Array.isArray(cfg.pending) ? cfg.pending : [];
        let present = {};
        Object.keys(Game.creeps || {}).forEach(name => {
            let creep = Game.creeps[name];
            let memory = creep && creep.memory || {};
            if (memory.roomName != cfg.roomName
                || (memory.role != "crossShardBuilder" && memory.crossShardBuildRoom != cfg.roomName)) return;
            let slotId = memory.crossShardBuildSlotId;
            if (!slotId && Array.isArray(memory.tasks)) {
                let task = memory.tasks.find(item => item && item.taskName == "buildCrossShardRoom" && item.slotId);
                if (task) slotId = task.slotId;
            }
            if (slotId) present[slotId] = true;
        });
        cfg.pending = cfg.pending.filter(pending => !present[pending.slotId]);
    },

    countLocalBuilders(roomName, minimumTtl = 0) {
        return Object.keys(Game.creeps || {}).filter(name => {
            let creep = Game.creeps[name];
            let memory = creep && creep.memory || {};
            return memory.roomName == roomName
                && (memory.role == "crossShardBuilder" || memory.crossShardBuildRoom == roomName)
                && (!Number.isFinite(creep.ticksToLive) || creep.ticksToLive > minimumTtl);
        }).length;
    },

    sendBuilderRequest(cfg, pending) {
        let route = copyPath(cfg.path);
        if (!route) return false;
        let requestId = Game.shard.name + ":" + cfg.roomName + ":" + Game.time + ":" + cfg.nextRequestSeq++;
        let deadline = now() + REQUEST_TIMEOUT_MS;
        pending.requestId = requestId;
        pending.state = "REQUESTED";
        pending.deadline = deadline;
        pending.attempts = (pending.attempts || 0) + 1;
        let tasks = [
            {taskName:"buildCrossShardRoom", roomName:cfg.roomName, slotId:pending.slotId},
            {taskName:"moveCrossShardByPath", path:route.path.map(point => ({
                shard:point.shard, roomName:point.roomName, x:point.x, y:point.y,
            })), index:0},
        ];
        // Describe the ideal worker on the target shard. The source handler
        // replaces this with the largest affordable variant at spawn time.
        let body = pro.preferredBuilderBody();
        let mission = {
            func:"spawnCrossShardBuilder",
            data:{
                requestId:requestId,
                slotId:pending.slotId,
                expiresAt:deadline,
                targetShard:Game.shard.name,
                targetRoomName:cfg.roomName,
                originShard:cfg.originShard,
                spawnRoom:cfg.spawnRoom,
                body:body,
                role:"crossShardBuilder",
                tasks:tasks,
            },
        };
        ManagerCrossShard.addCrossShardRequest(cfg.originShard, mission, "crossShardBuilder:" + requestId);
        pro.recordOperation(cfg, "DISPATCHING", {
            workers:pro.countLocalBuilders(cfg.roomName),
            pending:cfg.pending.length,
            requestId:requestId,
            attempts:pending.attempts,
        });
        return true;
    },

    /** Source-shard mission handler. Return false while busy so the request retries. */
    spawnCrossShardBuilder(data) {
        if (!data || !data.requestId || !data.slotId || !validRoomName(data.spawnRoom)
            || !validRoomName(data.targetRoomName) || !Array.isArray(data.body)
            || !data.body.length || !Array.isArray(data.tasks) || data.role != "crossShardBuilder") return false;
        if (data.originShard && data.originShard != Game.shard.name) return false;
        let receiptKey = String(data.targetShard || "") + ":" + String(data.slotId);
        let receipts = pro.cleanupSourceReceipts();
        if (receipts[receiptKey]) {
            return pro.sendSpawnReceipt(data, receipts[receiptKey]);
        }
        if (!data.targetShard || !data.expiresAt || now() >= data.expiresAt) {
            return pro.sendExpiredReceipt(data);
        }
        let room = Game.rooms[data.spawnRoom];
        if (!room || room.name != data.spawnRoom || !room.my || !room.find(FIND_MY_SPAWNS).length) return false;
        // 用户政策（2026-11-18）：**出兵房 RCL 必须 >4**，否则只能产出小体型
        // builder（大房容量才供得起 3000 的满配 50 部件）。请求返回 false 会按
        // mission TTL 重试，不会留下半成品爬。
        if (((room.controller && room.controller.level) || 0) <= 4) return false;
        if (!global.StationHive || typeof StationHive.trySpawn != "function") return false;

        // Requests from older target shards carry a smaller body. Always
        // select against the source room's real remaining tick budget instead
        // of letting that stale request cap the reinforcement size.
        let energyBudget = pro.sourceSpawnEnergyBudget(room);
        let fullCost = pro.bodyCost(pro.preferredBuilderBody());
        let capacity = typeof room.getEnergyCapacityAvailable == "function"
            ? room.getEnergyCapacityAvailable() : room.energyCapacityAvailable;
        // Prefer the full 50-part worker. If the room could afford it at
        // capacity but is momentarily drained, hold the request (return false
        // so the mission retries) until energy refills; near the deadline fall
        // back to the largest affordable body so bootstrap never stalls.
        if (fullCost > 0 && energyBudget < fullCost
            && typeof capacity == "number" && capacity >= fullCost
            && data.expiresAt - now() > FULL_BODY_WAIT_MS) {
            return false;
        }
        let spawnBody = pro.affordableBuilderBody(energyBudget);
        if (!spawnBody.length) return false;
        let spawnCost = pro.bodyCost(spawnBody);
        if (spawnCost > energyBudget) return false;
        if (room.spawnFailure) return false;
        let freeSpawns = room.find(FIND_MY_SPAWNS).filter(spawn => !spawn.spawning
            && !(room.spawnedMap && room.spawnedMap[spawn.id])
            && (room.level == 8 || !spawn.isActive || spawn.isActive()));
        if (!freeSpawns.length) return false;

        let creepName = StationHive.trySpawn(room, data.targetRoomName, spawnBody, data.role, data.tasks);
        if (!creepName) return false;
        let receipt = {creepName:String(creepName), createdAt:now(), createdTick:Game.time};
        receipts[receiptKey] = receipt;
        pro.cleanupSourceReceipts();
        return pro.sendSpawnReceipt(data, receipt);
    },

    /**
     * 与普通援建一致的 **1:1:2**（WORK:CARRY:MOVE）满配：12 组 = 48 部件 / 3000 能量。
     * 用户 2026-11-18：不再用 10:15:25 的重载货体型；且必须**交错排列**
     * `1W1C2M 1W1C2M …`，而不是把 WORK/CARRY/MOVE 分成三段 —— 受伤从 body
     * 前端扣部件时，每掉一组仍保持 1:1:2，不会先掉光某种能力。
     */
    preferredBuilderBody() {
        return pro.aidBodyChunks(12);
    },

    /** 交错 1:1:2 体型：每组 [WORK, CARRY, MOVE, MOVE]（250 能量），最多 12 组。 */
    aidBodyChunks(groups) {
        let body = [];
        for (let i = 0; i < groups; i++) body.push(WORK, CARRY, MOVE, MOVE);
        return body;
    },

    /** 按可用预算生成交错 1:1:2 体型（每组 250 能量），最多 12 组。 */
    affordableBuilderBody(energyBudget) {
        if (typeof energyBudget != "number" || energyBudget < 250) return [];
        return pro.aidBodyChunks(Math.min(12, Math.floor(energyBudget / 250)));
    },

    /** Clamp energy by live availability, the spawn manager's spent-this-tick cache, and hive capacity. */
    sourceSpawnEnergyBudget(room) {
        let available = room.getEnergyAvailable ? room.getEnergyAvailable() : room.energyAvailable;
        if (typeof available != "number" || !isFinite(available)) return 0;
        let budget = available;
        if (typeof room.currentEnergyAvailable == "number" && isFinite(room.currentEnergyAvailable)) {
            budget = Math.min(budget, room.currentEnergyAvailable);
        }
        let capacity = typeof room.getEnergyCapacityAvailable == "function"
            ? room.getEnergyCapacityAvailable() : room.energyCapacityAvailable;
        if (typeof capacity == "number" && isFinite(capacity)) budget = Math.min(budget, capacity);
        return Math.max(0, budget);
    },

    bodyCost(body) {
        if (global.Utils && typeof Utils.getBodyEnergyNeed == "function") return Utils.getBodyEnergyNeed(body);
        // Utils is mounted with StationHive in production. If a minimal test or
        // partial runtime omits it, let StationHive perform the authoritative
        // affordability check instead of maintaining a second cost table.
        return 0;
    },

    cleanupSourceReceipts() {
        let receipts = Memory.crossShardBuilderReceipts = Memory.crossShardBuilderReceipts || {};
        let timestamp = now();
        Object.keys(receipts).forEach(key => {
            let receipt = receipts[key];
            if (!receipt || timestamp - receipt.createdAt > SOURCE_RECEIPT_TTL_MS
                || Game.time - receipt.createdTick > SOURCE_RECEIPT_TTL_TICKS) delete receipts[key];
        });
        let keys = Object.keys(receipts);
        if (keys.length > SOURCE_RECEIPT_LIMIT) {
            keys.sort((left, right) => receipts[left].createdAt - receipts[right].createdAt);
            while (keys.length > SOURCE_RECEIPT_LIMIT) delete receipts[keys.shift()];
        }
        return receipts;
    },

    sendExpiredReceipt(data) {
        if (!data.targetShard || !global.ManagerCrossShard) return false;
        ManagerCrossShard.addCrossShardRequest(data.targetShard, {
            func:"crossShardBuilderSpawned",
            data:{roomName:data.targetRoomName, slotId:data.slotId, requestId:data.requestId, expired:true},
        }, "crossShardBuilderAck:" + data.requestId);
        return true;
    },

    sendSpawnReceipt(data, receipt) {
        if (!data.targetShard || !global.ManagerCrossShard) return false;
        ManagerCrossShard.addCrossShardRequest(data.targetShard, {
            func:"crossShardBuilderSpawned",
            data:{roomName:data.targetRoomName, slotId:data.slotId, requestId:data.requestId,
                creepName:receipt.creepName, spawned:true},
        }, "crossShardBuilderAck:" + data.requestId);
        return true;
    },

    /** Target-shard receipt; repeated acknowledgements are harmless. */
    crossShardBuilderSpawned(data) {
        if (!data || !data.roomName || !data.slotId) return true;
        pro.migrateLegacyConfig();
        let cfg = ensureBuildMap()[data.roomName];
        if (!cfg || !Array.isArray(cfg.pending)) return true;
        let pending = cfg.pending.find(item => item.slotId == data.slotId);
        if (!pending) return true;
        if (data.expired) {
            if (pending.state != "SPAWNING" && pending.requestId == data.requestId) pending.deadline = now();
            return true;
        }
        if (data.spawned && pending.state != "SPAWNING") {
            pending.state = "SPAWNING";
            pending.creepName = data.creepName;
            pending.acceptedAt = now();
            pending.deadline = now() + TRANSIT_TIMEOUT_MS;
            pro.recordOperation(cfg, "WORKER_IN_TRANSIT", {
                slotId:pending.slotId,
                creepName:pending.creepName,
                pending:cfg.pending.length,
            });
        }
        return true;
    },

    /** Compatibility helper retained for callers/tests, blueprint-only. */
    ensureSpawnSite(room) {
        let cfg = ensureBuildMap()[room.name] || {roomName:room.name, pending:[]};
        let roomMemory = getRoomMemory(room);
        let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
        if (sites.some(site => site.structureType == STRUCTURE_SPAWN)) return true;
        if (!roomMemory.structMap?.[STRUCTURE_SPAWN]?.length && !pro.ensureBlueprint(room,cfg)) return false;
        roomMemory = getRoomMemory(room);
        if (roomMemory.structMap && global.StrategyClaim && StrategyClaim.ensureConstructionSites) {
            try { StrategyClaim.ensureConstructionSites(room); } catch (e) { /* retry */ }
        }
        return room.find(FIND_MY_CONSTRUCTION_SITES).some(site => site.structureType == STRUCTURE_SPAWN);
    },
};

function availableEnergyCaches(room) {
    let entries = [];
    let add = (object, kind, amount) => {
        if (object && typeof amount == "number" && amount > 0 && object.pos) {
            entries.push({object:object, kind:kind, amount:amount});
        }
    };
    if (typeof FIND_DROPPED_RESOURCES != "undefined") {
        room.find(FIND_DROPPED_RESOURCES).forEach(resource => {
            if (resource.resourceType == RESOURCE_ENERGY) add(resource, "drop", resource.amount);
        });
    }
    if (typeof FIND_TOMBSTONES != "undefined") {
        room.find(FIND_TOMBSTONES).forEach(tombstone => add(tombstone, "store",
            tombstone.store && tombstone.store[RESOURCE_ENERGY] || 0));
    }
    if (typeof FIND_RUINS != "undefined") {
        room.find(FIND_RUINS).forEach(ruin => add(ruin, "store", ruin.store && ruin.store[RESOURCE_ENERGY] || 0));
    }
    if (typeof FIND_STRUCTURES != "undefined") {
        room.find(FIND_STRUCTURES).forEach(structure => {
            // 绝不从 Hive（spawn/extension）抽能量：那是 invader 来时产防守爬的
            // 储备。援建爬只能从源/掉落/容器/废墟/墓碑取能，并负责把 Hive 填满。
            if (structure.structureType == STRUCTURE_SPAWN || structure.structureType == STRUCTURE_EXTENSION) return;
            if (structure.store) add(structure, "store", structure.store[RESOURCE_ENERGY] || 0);
        });
    }
    return entries;
}

function chooseEnergyTarget(creep, room, task) {
    let cached = availableEnergyCaches(room);
    let sources = room.find(FIND_SOURCES).filter(source => source.energy > 0)
        .map(source => ({object:source, kind:"source", amount:source.energy}));
    let candidates = cached.concat(sources);
    if (task && task.sourceId) {
        let selected = candidates.find(entry => entry.object.id == task.sourceId);
        if (selected) return selected;
    }
    if (cached.length) {
        cached.sort((left, right) => creep.pos.getRangeTo(left.object) - creep.pos.getRangeTo(right.object));
        return cached[0];
    }
    // Builders should spread across active sources. This only scans the local
    // builder set when a source has run dry or a task has no saved sourceId.
    let assigned = {};
    Object.keys(Game.creeps || {}).forEach(name => {
        let other = Game.creeps[name];
        if (other === creep || !other.memory || other.memory.roomName != room.name
            || other.memory.role != "crossShardBuilder") return;
        let tasks = other.memory.tasks || [];
        let buildTask = tasks.find(item => item && item.taskName == "buildCrossShardRoom");
        if (buildTask && buildTask.sourceId) assigned[buildTask.sourceId] = (assigned[buildTask.sourceId] || 0) + 1;
    });
    sources.sort((left, right) => (assigned[left.object.id] || 0) - (assigned[right.object.id] || 0)
        || creep.pos.getRangeTo(left.object) - creep.pos.getRangeTo(right.object));
    return sources[0];
}

function gatherBootstrapEnergy(creep, room, task) {
    let target = chooseEnergyTarget(creep, room, task);
    if (!target) return false;
    task.sourceId = target.object.id;
    let result;
    if (target.kind == "drop") result = creep.pickup(target.object);
    else if (target.kind == "store") result = creep.withdraw(target.object, RESOURCE_ENERGY);
    else result = creep.harvest(target.object);
    if (result == ERR_NOT_IN_RANGE) creep.moveTo(target.object, {range:1, reusePath:20});
    return result == OK || result == ERR_NOT_IN_RANGE;
}

Creep.prototype.buildCrossShardRoom = function () {
    let task = this.lastTask();
    if (!task || !task.roomName) return;
    let roomName = task.roomName;
    this.memory.crossShardBuildRoom = roomName;
    if (task.slotId) this.memory.crossShardBuildSlotId = task.slotId;

    // Observer visibility does not mean the creep is physically in the target.
    if (this.pos.roomName != roomName) {
        this.goTo(new RoomPosition(25, 25, roomName));
        return;
    }
    let room = Game.rooms[roomName];
    if (!room) {
        this.goTo(new RoomPosition(25, 25, roomName));
        return;
    }
    let spawns = room.find(FIND_MY_SPAWNS);
    let level = room.controller ? (room.controller.level || 0) : 0;
    if (spawns.length && level >= 3) {
        // RCL3 起才转入本地经济。不 suicide、不丢货，常规 worker 管理器接手。
        this.memory.role = "worker";
        delete this.memory.crossShardBuildRoom;
        delete this.memory.crossShardBuildSlotId;
        this.memory.tasks.pop();
        return;
    }

    let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    let byRange = (left, right) => this.pos.getRangeTo(left) - this.pos.getRangeTo(right);
    let spawnSite = sites.filter(site => site.structureType == STRUCTURE_SPAWN).sort(byRange)[0];
    // RCL<3 持续援建：spawn 未建时优先 spawn；spawn 已建则援建任意工地
    // （extensions/roads 等），不再只盯 spawn，也不转入本地自产。
    let buildSite = spawnSite || (spawns.length ? sites.slice().sort(byRange)[0] : undefined);
    let nearDowngrade = room.controller && room.controller.ticksToDowngrade !== undefined
        && room.controller.ticksToDowngrade < DOWNGRADE_PROTECTION_TICKS;

    // Once an empty builder starts gathering, fill a complete load before
    // walking back. One harvest intent is only 12 energy for this body, so
    // switching to construction immediately would waste most of its lifetime
    // commuting. Urgent controller upkeep still uses any carried energy.
    let energy = this.store[RESOURCE_ENERGY] || 0;
    if (energy == 0) task.gathering = true;
    if (task.gathering && !(nearDowngrade && energy > 0)) {
        if (this.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            let gathering = gatherBootstrapEnergy(this, room, task);
            if (gathering || energy == 0) return;
        }
        // Full, or temporarily no more energy available. Use the load already
        // carried instead of waiting indefinitely on an exhausted source.
        task.gathering = false;
    }

    // 控制器濒危优先保级（不可逆）。
    if (nearDowngrade && energy > 0 && room.controller && !room.controller.upgradeBlocked) {
        let result = this.upgradeController(room.controller);
        if (result == ERR_NOT_IN_RANGE) this.moveTo(room.controller, {range:3, reusePath:20});
        return;
    }
    if (energy > 0) {
        // 优先填满 Hive（spawn/extension）：保证 invader 来时 spawn 有能量产防守爬。
        // 援建爬只往 Hive 填、绝不从 Hive 抽（gather 已排除 spawn/extension）。
        let hiveTarget = room.find(FIND_STRUCTURES)
            .filter(s => (s.structureType == STRUCTURE_SPAWN || s.structureType == STRUCTURE_EXTENSION)
                && s.store && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
            .sort(byRange)[0];
        if (hiveTarget) {
            if (this.transfer(hiveTarget, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) this.moveTo(hiveTarget, {range:1, reusePath:20});
            return;
        }
        // Hive 已满 → 援建工地（spawn 优先，其余任意）。
        if (buildSite) {
            if (this.build(buildSite) == ERR_NOT_IN_RANGE) this.moveTo(buildSite, {range:3, reusePath:20});
            return;
        }
        // 无工地 → 升级控制器。
        if (room.controller && !room.controller.upgradeBlocked) {
            let result = this.upgradeController(room.controller);
            if (result == ERR_NOT_IN_RANGE) this.moveTo(room.controller, {range:3, reusePath:20});
            return;
        }
    }
    gatherBootstrapEnergy(this, room, task);
};

global.StrategyBuildCrossShard = pro;
global.missionFunc = global.missionFunc || {};
global.missionFunc.spawnCrossShardBuilder = data => pro.spawnCrossShardBuilder(data);
global.missionFunc.crossShardBuilderSpawned = data => pro.crossShardBuilderSpawned(data);
