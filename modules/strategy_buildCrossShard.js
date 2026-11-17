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
const PLANNER_RETRY_TICKS = 250;
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const TRANSIT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SOURCE_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE_RECEIPT_TTL_TICKS = 25000;
const SOURCE_RECEIPT_LIMIT = 200;
const MAX_BUILDERS = 4;
const DOWNGRADE_PROTECTION_TICKS = 5000;

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
    },

    execRoom(cfg) {
        let room = Game.rooms[cfg.roomName];
        if (!room || !room.my || !room.controller) {
            pro.recordOperation(cfg, "WAITING_FOR_OWNERSHIP", {visible:!!room});
            return;
        }
        let spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length) {
            pro.recordOperation(cfg, "COMPLETE", {mySpawns:spawns.length});
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

        let roomMemory = getRoomMemory(room);
        let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
        let hasSpawnSite = sites.some(site => site.structureType == STRUCTURE_SPAWN);

        if (!roomMemory.structMap && !hasSpawnSite) {
            pro.ensureBlueprint(room, cfg, roomMemory);
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

    ensureBlueprint(room, cfg, roomMemory) {
        if (cfg.nextPlannerAttemptAt && Game.time < cfg.nextPlannerAttemptAt) return false;
        if (!global.ManagerAutoPlanner || typeof ManagerAutoPlanner.computeRoom != "function") {
            pro.recordOperation(cfg, "WAITING_FOR_PLANNER", {reason:"planner_unavailable"});
            return false;
        }
        let bucket = Game.cpu && Game.cpu.bucket || 0;
        if (bucket < PLANNER_MIN_BUCKET) {
            pro.recordOperation(cfg, "WAITING_FOR_PLANNER_CPU", {bucket:bucket});
            return false;
        }
        pro.recordOperation(cfg, "PLANNING", {bucket:bucket});
        try {
            ManagerAutoPlanner.computeRoom({room:room, pos:room.controller.pos});
        } catch (e) {
            cfg.lastPlannerError = String(e && e.message || e).slice(0, 120);
        }
        roomMemory = getRoomMemory(room);
        if (roomMemory.structMap) {
            delete cfg.nextPlannerAttemptAt;
            delete cfg.lastPlannerError;
            return true;
        }
        // A failed room planner is expensive; do not rerun it every strategy
        // pass. The tick deadline persists across resets.
        cfg.nextPlannerAttemptAt = Game.time + PLANNER_RETRY_TICKS;
        pro.recordOperation(cfg, "PLANNER_FAILED", {
            bucket:bucket,
            retryAt:cfg.nextPlannerAttemptAt,
            error:cfg.lastPlannerError,
        });
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
        let workers = pro.countLocalBuilders(cfg.roomName);
        let want = normalizeBuilderCount(cfg.builders, 2);
        if (workers + cfg.pending.length >= want) {
            pro.recordOperation(cfg, "BUILDERS_IN_FLIGHT", {workers:workers, pending:cfg.pending.length, target:want});
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
            slotId:Game.shard.name + ":" + cfg.roomName + ":" + cfg.nextSlotSeq++,
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

    countLocalBuilders(roomName) {
        return Object.keys(Game.creeps || {}).filter(name => {
            let memory = Game.creeps[name] && Game.creeps[name].memory || {};
            return memory.roomName == roomName
                && (memory.role == "crossShardBuilder" || memory.crossShardBuildRoom == roomName);
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
        let body = ManagerCreeps.calcBodyPart({[WORK]:6, [CARRY]:6, [MOVE]:12});
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
        if (!global.StationHive || typeof StationHive.trySpawn != "function") return false;

        let spawnCost = pro.bodyCost(data.body);
        if (room.spawnFailure) return false;
        let availableEnergy = room.currentEnergyAvailable === undefined
            ? (room.getEnergyAvailable ? room.getEnergyAvailable() : room.energyAvailable)
            : Math.min(room.currentEnergyAvailable,
                room.getEnergyAvailable ? room.getEnergyAvailable() : room.energyAvailable);
        if (typeof availableEnergy == "number" && availableEnergy < spawnCost) return false;
        let freeSpawns = room.find(FIND_MY_SPAWNS).filter(spawn => !spawn.spawning
            && !(room.spawnedMap && room.spawnedMap[spawn.id])
            && (room.level == 8 || !spawn.isActive || spawn.isActive()));
        if (!freeSpawns.length) return false;

        let creepName = StationHive.trySpawn(room, data.targetRoomName, data.body, data.role, data.tasks);
        if (!creepName) return false;
        let receipt = {creepName:String(creepName), createdAt:now(), createdTick:Game.time};
        receipts[receiptKey] = receipt;
        pro.cleanupSourceReceipts();
        return pro.sendSpawnReceipt(data, receipt);
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
        if (!roomMemory.structMap) pro.ensureBlueprint(room, cfg, roomMemory);
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
    if (!target) return;
    task.sourceId = target.object.id;
    let result;
    if (target.kind == "drop") result = creep.pickup(target.object);
    else if (target.kind == "store") result = creep.withdraw(target.object, RESOURCE_ENERGY);
    else result = creep.harvest(target.object);
    if (result == ERR_NOT_IN_RANGE) creep.moveTo(target.object, {range:1, reusePath:20});
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
    if (spawns.length) {
        // Do not suicide or discard cargo. The regular room worker manager will
        // assign work once this bootstrap task is gone.
        this.memory.role = "worker";
        delete this.memory.crossShardBuildRoom;
        delete this.memory.crossShardBuildSlotId;
        this.memory.tasks.pop();
        return;
    }

    let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    let spawnSite = sites.filter(site => site.structureType == STRUCTURE_SPAWN)
        .sort((left, right) => this.pos.getRangeTo(left) - this.pos.getRangeTo(right))[0];
    let nearDowngrade = room.controller && room.controller.ticksToDowngrade !== undefined
        && room.controller.ticksToDowngrade < DOWNGRADE_PROTECTION_TICKS;

    // Keep the controller alive first if it is at risk; otherwise only build
    // the first spawn blueprint. Never divert bootstrap builders to roads or
    // secondary sites before the room can spawn its own economy.
    if (!spawnSite || nearDowngrade) {
        if (this.store[RESOURCE_ENERGY] > 0 && room.controller && !room.controller.upgradeBlocked) {
            let result = this.upgradeController(room.controller);
            if (result == ERR_NOT_IN_RANGE) this.moveTo(room.controller, {range:3, reusePath:20});
            return;
        }
        gatherBootstrapEnergy(this, room, task);
        return;
    }
    if (this.store[RESOURCE_ENERGY] > 0) {
        if (this.build(spawnSite) == ERR_NOT_IN_RANGE) this.moveTo(spawnSite, {range:3, reusePath:20});
        return;
    }
    gatherBootstrapEnergy(this, room, task);
};

global.StrategyBuildCrossShard = pro;
global.missionFunc = global.missionFunc || {};
global.missionFunc.spawnCrossShardBuilder = data => pro.spawnCrossShardBuilder(data);
global.missionFunc.crossShardBuilderSpawned = data => pro.crossShardBuilderSpawned(data);
