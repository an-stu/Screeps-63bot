// Road-layout migration must preserve fixed worker positions while repairing
// the local planned-road graph wherever a legal route exists.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const utilsSrc = fs.readFileSync(path.join(root, "modules/utils.js"), "utf8");
const plannerSrc = fs.readFileSync(path.join(root, "modules/manager_autoPlanner.js"), "utf8");

function extractMethod(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, "missing " + header);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unterminated " + header);
}

const plannerMethods = [
    extractMethod(plannerSrc, "roadWorkTiles(room) {"),
    extractMethod(plannerSrc, "tryCreateRoads(room, structMap) {"),
    extractMethod(plannerSrc, "planWorkTileRoads(room) {"),
    extractMethod(plannerSrc, "findWorkTileRoadBypass(tile, roads, builtRoads, protectedTiles, blockers, terrain) {"),
].map(method => method.replace(/\bpro\./g, "testPlanner."));
const WALL = 1;
const sandbox = {
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_ROAD: "road",
    STRUCTURE_RAMPART: "rampart",
    FIND_STRUCTURES: 107,
    FIND_CONSTRUCTION_SITES: 114,
    TERRAIN_MASK_WALL: WALL,
    TERRAIN_MASK_SWAMP: 2,
    OBSTACLE_OBJECT_TYPES: ["spawn", "storage", "extension", "tower", "constructedWall", "link", "terminal", "lab"],
    Room: {Terrain: function () { this.get = () => 0; }},
    RoomPosition: function (x,y,roomName) { Object.assign(this,{x,y,roomName}); },
    Game: {rooms: {}, time: 1, getObjectById: () => null},
};
sandbox.global = sandbox;
vm.runInNewContext(utilsSrc, sandbox);
vm.runInNewContext("this.testPlanner={" + plannerMethods.join(",\n") + "};", sandbox);

const Utils = sandbox.Utils;
const ManagerAutoPlanner = sandbox.testPlanner;
const tile = (x, y) => y * 50 + x;
const key = pos => tile(pos.x, pos.y);
const decodeRoads = encoded => Utils.decodeLayoutPositions(encoded).map(key);
const pos = (x, y, roomName = "W7N7") => ({x, y, roomName});

function makeRoom({roads, container, source, structures = [], sites = [], walls = new Set(), otherLayout = {}}) {
    const encodedOther = {};
    for (const [type, positions] of Object.entries(otherLayout)) {
        encodedOther[type] = Utils.encodePosArray(positions);
    }
    const structMap = {
        road: Utils.encodePosArray(roads),
        container: Utils.encodePosArray([container]),
        ...encodedOther,
    };
    const terrain = {get: (x, y) => walls.has(tile(x, y)) ? WALL : 0};
    const allStructures = [{structureType: "container", pos: container}, ...structures];
    const room = {
        name: "W7N7",
        my: true,
        memory: {structMap},
        source: [{pos: source}],
        controller: undefined,
        container: allStructures.filter(s => s.structureType === "container"),
        constructionSite: sites,
        getStructures: () => allStructures,
        find(type) {
            if (type === sandbox.FIND_STRUCTURES) return allStructures;
            if (type === sandbox.FIND_CONSTRUCTION_SITES) return sites;
            return [];
        },
        getTerrain: () => terrain,
        lookForAt(type, x, y) {
            const values = type === "structures" ? allStructures : type === "sites" ? sites : [];
            return values.filter(value => value.pos.x === x && value.pos.y === y);
        },
    };
    return room;
}

function areRoadConnected(roads, from, to) {
    const roadSet = new Set(roads);
    if (!roadSet.has(from) || !roadSet.has(to)) return false;
    const queue = [from];
    const visited = new Set(queue);
    while (queue.length) {
        const current = queue.shift();
        if (current === to) return true;
        const x = current % 50, y = Math.floor(current / 50);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                const next = tile(x + dx, y + dy);
                if (roadSet.has(next) && !visited.has(next)) {
                    visited.add(next);
                    queue.push(next);
                }
            }
        }
    }
    return false;
}

// Two road branches are separated by the source-container work tile. A legal
// local detour exists; a built structure and a construction site block the
// obvious cells beside it, so neither may be selected as a replacement road.
{
    const workTile = pos(10, 10);
    const from = pos(9, 10);
    const to = pos(11, 10);
    const builtObstacle = {structureType: "spawn", pos: pos(10, 9)};
    const siteObstacle = {structureType: "spawn", my: true, pos: pos(10, 11)};
    const original = [from, workTile, to];
    const untouched = {spawn: [pos(3, 4)], extension: [pos(6, 7)]};
    const room = makeRoom({
        roads: original,
        container: workTile,
        source: pos(11, 11),
        structures: [builtObstacle],
        sites: [siteObstacle],
        otherLayout: untouched,
    });
    const otherBefore = Object.assign({}, room.memory.structMap);
    const result = ManagerAutoPlanner.planWorkTileRoads(room);
    assert.ok(result && typeof result.roads === "string", "migration returns an encoded road layout");

    const roads = decodeRoads(result.roads);
    assert.ok(result.removed.includes(key(workTile)), "the removable source work-tile road is reported by tile number");
    assert.ok(!roads.includes(key(workTile)), "the road layout no longer occupies the source container");
    assert.ok(areRoadConnected(roads, key(from), key(to)), "the separated road branches reconnect through a detour");
    assert.ok(result.added.length > 0, "detour additions are reported");
    assert.ok(result.added.every(Number.isInteger), "added road positions are encoded as x + y*50 tile numbers");
    assert.ok(result.added.every(k => ![key(workTile), key(pos(10, 9)), key(pos(10, 11))].includes(k)),
        "detour avoids the fixed work tile, built structure, and construction site");
    assert.ok(!roads.includes(key(pos(10, 9))), "built structures are treated as obstacles");
    assert.ok(!roads.includes(key(pos(10, 11))), "construction sites are treated as obstacles");
    assert.deepEqual(room.memory.structMap, otherBefore,
        "planning does not mutate the encoded blueprint or any non-road layout");
    for (const [type, positions] of Object.entries(untouched)) {
        assert.equal(result[type], undefined, "the result does not rewrite unrelated layout type " + type);
        assert.equal(room.memory.structMap[type], otherBefore[type], "unrelated encoded layout remains unchanged");
        assert.equal(Utils.decodeLayoutPositions(room.memory.structMap[type]).map(key).join(","),
            positions.map(key).join(","));
    }
}

// A full wall line makes the work tile the only bridge between the two road
// components. With no legal detour, migration must retain it in the blueprint.
{
    const workTile = pos(20, 25);
    const from = pos(19, 25);
    const to = pos(21, 25);
    const walls = new Set();
    for (let y = 0; y < 50; y++) if (y !== workTile.y) walls.add(tile(workTile.x, y));
    const room = makeRoom({
        roads: [from, workTile, to],
        container: workTile,
        source: pos(21, 26),
        walls,
        otherLayout: {storage: [pos(4, 5)]},
    });
    const result = ManagerAutoPlanner.planWorkTileRoads(room);
    const roads = decodeRoads(result.roads);
    assert.ok(result.retained.includes(key(workTile)), "no-detour work tile is reported as retained");
    assert.ok(roads.includes(key(workTile)), "the work tile stays in the encoded blueprint when repair is impossible");
    assert.ok(!result.removed.includes(key(workTile)), "an indispensable bridge is not reported as removed");
    assert.ok(areRoadConnected(roads, key(from), key(to)), "retaining the work tile preserves the road connection");
    assert.ok(result.added.every(Number.isInteger) && result.removed.every(Number.isInteger)
        && result.retained.every(Number.isInteger), "all migration deltas use x + y*50 tile numbers");
    assert.equal(room.memory.structMap.storage, Utils.encodePosArray([pos(4, 5)]),
        "non-road structure layouts are never changed by migration");
}

// Extra roads outside the blueprint must not hide a missing bypass, and the
// repair pass must not recreate a road on an occupied or planned work tile.
{
    const bypass = pos(15, 13);
    const room = makeRoom({roads:[pos(14,14), bypass], container:pos(14,14), source:pos(14,15)});
    room.road = [pos(1,1), pos(2,2), pos(3,3)].map(p => ({pos:p, structureType:"road"}));
    const scheduled = [];
    ManagerAutoPlanner.tryCreateCons = p => scheduled.push(key(p));
    ManagerAutoPlanner.tryCreateRoads(room, room.memory.structMap);
    assert.deepEqual(scheduled, [key(bypass)]);
}

console.log("work-tile road migration: OK");
