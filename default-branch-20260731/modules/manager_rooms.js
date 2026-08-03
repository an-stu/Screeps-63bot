// Station discovery is persisted in room Memory and refreshed on a staggered
// schedule. This keeps script reloads and ordinary ticks inside the 20 CPU cap.

global.SPECIAL_ROOM = new Set([
    "minSizeRoom",
    "GCLRoom",
    "storageEmpty",
]);

const ROOM_MEMORY_TTL = 20000;
const ROOM_REFRESH_INTERVAL = 61;
const MOVEMENT_CACHE_REFRESH_INTERVAL = 301;

const managerRooms = {
    bootstrapRefreshPending: true,

    init() {
        Memory.rooms = Memory.rooms || {};
        for (let roomName in Memory.rooms) {
            let roomMemory = Memory.rooms[roomName];
            if (!roomMemory.ttl) roomMemory.ttl = Game.time + ROOM_MEMORY_TTL;
            if (Game.rooms[roomName]) roomMemory.ttl = Game.time + ROOM_MEMORY_TTL;
            else if (roomMemory.ttl < Game.time) delete Memory.rooms[roomName];
        }
    },

    refreshRoom(room) {
        if (!room.Memory) room.Memory = {};
        room.update();
        StationCarry.update(room);
        StationSources.update(room);
        StationUpgrade.update(room);
        StationTower.update(room);
        StationMineral.update(room);
        StationDefense.update(room);
    },

    // Compatibility for old console commands and cached code during staged
    // deployments. New code should use refreshRoom.
    updateRoom(room) {
        return this.refreshRoom(room);
    },

    getNormalRoom() {
        if (!Game._normal_room) {
            let rooms = Game._coreObjects ? Game._coreObjects.rooms : Object.values(Game.rooms);
            Game._normal_room = rooms.filter(room => room.my && !room.flags().some(flag => SPECIAL_ROOM.has(flag.getPrefix())));
        }
        return Game._normal_room;
    },

    exec(room) {
        if (!MIN_CPU && global.StationObserver && isCpuFeatureEnabled("observer")) {
            StationObserver.update(room);
        }

        let roomHash = room.hashCode();
        let needsBootstrapRefresh = managerRooms.bootstrapRefreshPending;
        if ((Game.time + roomHash) % ROOM_REFRESH_INTERVAL == 0 || needsBootstrapRefresh) {
            HelperError.catchError(() => managerRooms.refreshRoom(room), room.name);
            managerRooms.bootstrapRefreshPending = false;
        }
        if ((Game.time + roomHash) % MOVEMENT_CACHE_REFRESH_INTERVAL == 0 || needsBootstrapRefresh) {
            if (global.BetterMove) BetterMove.deletePathInRoom(room.name);
        }

        if (!room.my) {
            if (global.StrategyGCLRoom && isCpuFeatureEnabled("GCLRoom") && room.flags("GCLRoom").length) {
                HelperError.catchError(() => StrategyGCLRoom.exec(room), room.name);
            }
            return;
        }

        if (global.StationLab && room.lab && room.lab.length) {
            HelperError.catchError(() => StationLab.exec(room), room.name);
        }
        if (global.StationFactory && room.factory) {
            HelperError.catchError(() => StationFactory.exec(room), room.name);
        }
        HelperError.catchError(() => StationTower.exec(room), room.name);

        // A live Power Bank attacker is unsafe without its healer. Dispatch
        // its queue before background worker/upgrader management can consume
        // the only newly-idle Spawn this tick.
        let powerBankActive = !MIN_CPU && global.StrategyPowerBank
            && isCpuFeatureEnabled("powerBank") && ManagerFlags.hasPrefix("powerBank");
        if (powerBankActive) HelperError.catchError(() => StrategyPowerBank.exec(room), room.name);

        if (room.flags("blockRoom").length) return;
        if (global.StrategyGCLRoom && isCpuFeatureEnabled("GCLRoom") && room.flags("GCLRoom").length) {
            HelperError.catchError(() => StrategyGCLRoom.exec(room), room.name);
        } else if (room.flags("minSizeRoom").length) {
            HelperError.catchError(() => StrategyMinSizeRoom.exec(room), room.name);
        } else if (!room.storage || !room.storage.my || room.level < 4) {
            HelperError.catchError(() => StrategyLowLevel.exec(room), room.name);
        } else {
            HelperError.catchError(() => StrategyHighLevel.exec(room), room.name);
        }

        if (global.StrategyResourceBalance) {
            HelperError.catchError(() => StrategyResourceBalance.exec(room), room.name);
        }
        if (global.StrategyOuterHarvest && isCpuFeatureEnabled("outerHarvest") && !room.flags("stopRemote").length) {
            HelperError.catchError(() => StrategyOuterHarvest.exec(room), room.name);
        }
        if (global.StrategyPillage && isCpuFeatureEnabled("pillage") && room.flags("pillage").length) {
            HelperError.catchError(() => StrategyPillage.exec(room), room.name);
        }
        if (!MIN_CPU && global.StationObserver && isCpuFeatureEnabled("observer") && Game.shard.name != "shard1") {
            HelperError.catchError(() => StationObserver.obOverRooms(room), room.name);
        }
        if (!MIN_CPU && global.StrategyDeposits && isCpuFeatureEnabled("deposits") && ManagerFlags.hasPrefix("deposit")) {
            HelperError.catchError(() => StrategyDeposits.exec(room), room.name);
        }
        if (global.StrategyDefenserHighWay && isCpuFeatureEnabled("combat") && room.flags("defenserHighWay").length) {
            HelperError.catchError(() => StrategyDefenserHighWay.exec(room), room.name);
        }

        if (Game.time % 30 == 0 && room.level >= 7 && room.storage && room.storage.store.getFreeCapacity() <= 0) {
            console.log(room.name + " storage is full");
        }
    },
};

global.ManagerRooms = managerRooms;
