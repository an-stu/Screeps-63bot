/** A neutral, cached-route road below the critical threshold must be repaired. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");

// The real Creep handler runs in a VM, while fixture rooms and structures are
// created here in the host realm. Preserve the extension used by the handler.
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function makeContext() {
    const ctx = {
        console,
        isSaveCpu: true,
        Memory: { rooms: {} },
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null, map: {}, creeps: {}, rooms: {} },
        Room: { Terrain: function () { this.get = () => 0; } },
        RoomPosition: function (x, y, roomName) {
            this.x = x; this.y = y; this.roomName = roomName;
            this.isBorder = () => false;
            this.isNearTo = () => false;
            this.getRangeTo = function (a, b) {
                let ox = (a && a.x !== undefined) ? a.x : a;
                let oy = (a && a.y !== undefined) ? a.y : b;
                return Math.max(Math.abs(this.x - ox), Math.abs(this.y - oy));
            };
        },
        StationCarry: { stationName: "stationCarry" },
        StationMineral: { stationName: "stationMineral" },
        StationUpgrade: { stationName: "stationUpgrade" },
        _: { values: obj => Object.keys(obj || {}).map(k => obj[k]), keys: obj => Object.keys(obj || {}) },
        StationHive: { trySpawn: () => undefined },
        ManagerCreeps: { calcBodyPart: () => [] },
        ManagerFlags: { getFlagsByPrefix: () => [] },
        HelperError: { catchError: fn => fn() },
        UtilsTask: { task: () => ({}), taskOutView: () => ({}), taskData: () => ({}) },
        Creep: function () {},
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_FULL: -8, ERR_NO_BODYPART: -12, ERR_NO_PATH: -2,
        RESOURCE_ENERGY: "energy", CARRY: "carry", MOVE: "move", WORK: "work", TOUGH: "tough",
        STRUCTURE_CONTAINER: "container", STRUCTURE_ROAD: "road", STRUCTURE_LINK: "link",
        STRUCTURE_SPAWN: "spawn", STRUCTURE_EXTENSION: "extension", STRUCTURE_TOWER: "tower",
        LOOK_STRUCTURES: "structures", LOOK_CREEPS: "creeps", LOOK_CONSTRUCTION_SITES: "constructionSite",
        LOOK_SOURCES: "source", LOOK_MINERALS: "mineral", LOOK_TOMBSTONES: "tombstone",
        LOOK_POWER_CREEPS: "powerCreep", LOOK_ENERGY: "energy", LOOK_DEPOSITS: "deposit",
        FIND_MY_CONSTRUCTION_SITES: 8, FIND_STRUCTURES: 3, FIND_SOURCES: 1, FIND_HOSTILE_CREEPS: 4,
        FIND_HOSTILE_STRUCTURES: 5, FIND_MY_CREEPS: 2, FIND_TOMBSTONES: 4, FIND_DROPPED_RESOURCES: 6,
        TERRAIN_MASK_WALL: 1, TERRAIN_MASK_SWAMP: 2,
        OBSTACLE_OBJECT_TYPES: ["spawn", "extension", "tower", "wall", "rampart"],
        CONTROLLER_STRUCTURES: { link: { 5: 3, 6: 4, 7: 5, 8: 6 } },
        HARVEST_POWER: 2, BUILD_POWER: 5,
    };
    ctx.global = ctx;
    vm.runInNewContext(`
        Array.prototype.head = function () { return this.length ? this[0] : undefined; };
        Array.prototype.last = function () { return this.length ? this[this.length - 1] : undefined; };
        Array.prototype.maxBy = function (fn) {
            let best, bestV;
            this.forEach(x => { let v = fn(x); if (best === undefined || v > bestV) { best = x; bestV = v; } });
            return best;
        };
        Array.prototype.sum = function () { return this.reduce((a, b) => a + b, 0); };
    `, ctx);
    vm.runInNewContext(raw, ctx);
    return ctx;
}

function runBuilder({ aheadRoads, offRouteRoads = [] }) {
    const ctx = makeContext();
    const S = ctx.StationSources;
    const route = [10, 11, 12, 13, 14].map(x => new ctx.RoomPosition(x, 10, "W1N1"));
    const structuresByTile = new Map();
    const key = (x, y) => `${x}:${y}`;
    const localRoad = { structureType: ctx.STRUCTURE_ROAD, hits: 1000, hitsMax: 1000 };
    structuresByTile.set(key(10, 10), [localRoad]);
    [...aheadRoads, ...offRouteRoads].forEach(road => {
        structuresByTile.set(key(road.x, road.y), [road]);
    });

    const data = { id: "source", roomName: "W1N1" };
    ctx.Memory.rooms.W1N1 = { stationSources: { source: data } };
    // Keep the production handler real, while fixing its path and unrelated
    // optional helpers so this test isolates the critical-repair decision.
    S.getOuterRoadPath = () => route;
    S.outerRoadComplete = () => true;
    S.nearestOuterRoadSite = () => undefined;
    S.moveToOuterRoadPoint = () => ctx.OK;
    S.clearOuterRoadPathFail = () => {};

    const creep = Object.create(ctx.Creep.prototype);
    creep.pos = route[0];
    creep.room = {
        name: "W1N1",
        lookForAt: (_look, x, y) => structuresByTile.get(key(x, y)) || [],
    };
    creep.pos.lookFor = look => look == ctx.LOOK_STRUCTURES ? [localRoad] : [];
    creep.store = { [ctx.RESOURCE_ENERGY]: 50 };
    creep.ticksToLive = 1000;
    creep.getPartCnt = () => 1;
    creep.getActiveBodyparts = () => 1;
    creep.lastTask = () => ({ mineRoom: "W1N1", stationId: "source", pathIndex: 0 });
    creep.lastTaskObj = () => ({ pos: route[4] });
    const repairs = [];
    creep.$repair = road => { repairs.push(road); return ctx.OK; };

    creep.harvestEnergyOuterCarryRoadBuilder();
    return repairs;
}

// The current on-route road is healthy. A critically damaged road two cached
// waypoints ahead is neutral (no `my` property), but remains repairable.
{
    const criticalNeutralRoad = { structureType: "road", x: 12, y: 10, hits: 200, hitsMax: 1000 };
    const repairs = runBuilder({ aheadRoads: [criticalNeutralRoad] });
    assert.deepEqual(repairs, [criticalNeutralRoad],
        "a sub-25% neutral road ahead on the cached route must be repaired");
}

// A healthy on-route road is not urgent, and a critical off-route road must
// not be selected merely because it is in range.
{
    const healthyOnRouteRoad = { structureType: "road", x: 12, y: 10, hits: 300, hitsMax: 1000 };
    const criticalOffRouteRoad = { structureType: "road", x: 11, y: 11, hits: 100, hitsMax: 1000 };
    const repairs = runBuilder({ aheadRoads: [healthyOnRouteRoad], offRouteRoads: [criticalOffRouteRoad] });
    assert.deepEqual(repairs, [], "healthy route roads and critical off-route roads must not be repaired by the look-ahead");
}

console.log("outer-road-critical-repair: OK");
