// 0.78.279 回归：外矿路线只保护 keeper 的**容器格**，不再抬高矿点 3×3 整圈。
// 现场 E41S29：源 (34,11) 旁的 road (33~35,12) 全被抬到 8，路线被迫拐去 y=13；
// 用户定案「工位就是容器那格」，其余邻格恢复正常代价。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "modules", "station_sources.js"), "utf8");

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

const methods = [
    "outerRoadStructureWalkable(s)",
    "outerRoadTileWalkable(structures)",
    "outerRoadSourceContainerTileSet(room)",
    "outerRoadSourceContainerPassThroughs(path, data)",
    "outerRoadWalkable(path, data)",
    "blueprintWalkableSet(room)",
    "structMapPositions(value)",
    "outerRoadRoomCallback(roomName, useBlueprint, homeRoom, mergePaths)",
    "outerRoadLocalDetour(path, first, last)",
    "spliceOuterRoadWorkTiles(path, crossingSig)",
    "saveOuterRoadPath(data, path, crossingSig)",
    "ensureOuterRoadPath(data, spawnRoom)",
].map(h => extractMethod(src, h));

class CostMatrix {
    constructor() { this.m = new Map(); }
    set(x, y, v) { this.m.set(x + ":" + y, v); }
    get(x, y) { const v = this.m.get(x + ":" + y); return v === undefined ? 0 : v; }
    clone() { const c = new CostMatrix(); this.m.forEach((v, k) => c.m.set(k, v)); return c; }
}

const WALL = 1, SWAMP = 2;
const walls = new Set(["37:12"]);
const terrain = {get: (x, y) => walls.has(x + ":" + y) ? WALL : 0};

const structures = [
    {structureType: "container", pos: {x: 33, y: 11}},
    {id: "upgC", structureType: "container", pos: {x: 30, y: 16, roomName: "E41S29"}},
    {structureType: "road", pos: {x: 33, y: 12}},
    {structureType: "road", pos: {x: 34, y: 12}},
    {structureType: "road", pos: {x: 35, y: 12}},
    {structureType: "road", pos: {x: 36, y: 12}},
    {structureType: "road", pos: {x: 36, y: 16}},
];
const sites = [
    {structureType: "road", pos: {x: 33, y: 13}},
    {structureType: "road", pos: {x: 34, y: 13}},
    {structureType: "road", pos: {x: 35, y: 13}},
    {structureType: "container", pos: {x: 21, y: 20}},
    {structureType: "container", pos: {x: 29, y: 17}},
];
const sources = [
    {id: "src1", pos: {x: 34, y: 11}},
    {id: "src2", pos: {x: 20, y: 20}},
];

const upgradeCreeps = [
    {memory: {role: "upgrader", upgradePosition: {x: 31, y: 16, controllerId: "ctrl"}}},
    {memory: {role: "worker", upgradePosition: {x: 36, y: 16, controllerId: "ctrl"}}},
];
const room = {
    name: "E41S29",
    memory: {stationUpgrade: {container: "upgC"}, structMap: {container: "planned"}},
    controller: {id: "ctrl", my: true, pos: {x: 30, y: 17}},
    getStructures: () => structures,
    constructionSite: sites,
    find: type => type === 104 ? sources : (type === 102 ? upgradeCreeps : []),
    lookForAt(type, x, y) {
        const list = type === "structures" ? structures : type === "sites" ? sites : [];
        return list.filter(e => e.pos.x === x && e.pos.y === y);
    },
};

const sandbox = {
    TERRAIN_MASK_WALL: WALL, TERRAIN_MASK_SWAMP: SWAMP,
    STRUCTURE_ROAD: "road", STRUCTURE_CONTAINER: "container", STRUCTURE_RAMPART: "rampart",
    LOOK_STRUCTURES: "structures", LOOK_CONSTRUCTION_SITES: "sites",
    FIND_SOURCES: 104, FIND_MY_CREEPS: 102,
    OUTER_ROAD_WORK_TILE_COST: 8,
    OUTER_ROAD_SOURCE_CONTAINER_COST: 40,
    PathFinder: {CostMatrix},
    Utils: {decodePosArray: value => value === "planned" ? [{x: 19, y: 20}, {x: 29, y: 18}] : []},
    Game: {rooms: {"E41S29": room}, map: {getRoomTerrain: () => terrain},
        getObjectById: id => id === "upgC" ? structures[1] : null},
    console: {log() {}},
};
sandbox.global = sandbox;
vm.runInNewContext("var pro = {" + methods.join(",\n") + "};", sandbox);
const pro = sandbox.pro;

// homeRoom 传别的房间：排除「主房旧路代价 3」分支，只验证工位保护
const cm = pro.outerRoadRoomCallback("E41S29", true, "X1X1", undefined);

// 1) 只保护容器格本身
assert.equal(cm.get(33, 11), 40, "源旁容器格（keeper 站桩位）要高于道路和空地代价");
assert.equal(cm.get(21, 20), 40, "源容器工地格同样要软惩罚");
assert.equal(cm.get(19, 20), 40, "蓝图内尚未立工地的源容器格也要软惩罚");

// 1b) 升级容器格 + upgrader 当前站位同样保护
assert.equal(cm.get(30, 16), 40, "升级容器格（upgrader 补给位）必须抬高");
assert.equal(cm.get(29, 17), 40, "升级容器工地同样避让");
assert.equal(cm.get(29, 18), 40, "升级容器蓝图同样避让");
assert.equal(cm.get(31, 16), 8, "upgrader 当前站位（memory.upgradePosition）必须抬高");
assert.equal(cm.get(32, 16), 2, "控制器附近普通格不受影响");
assert.equal(cm.get(36, 16), 1, "worker 的临时升级站位不得把 road 抬价（只有专职 upgrader 才保护）");

// 2) 原先被整圈误伤的 road / 源格恢复正常
assert.equal(cm.get(33, 12), 1, "容器隔壁的 road 不再被抬到 8");
assert.equal(cm.get(34, 12), 1);
assert.equal(cm.get(35, 12), 1);
assert.equal(cm.get(36, 12), 1);
assert.equal(cm.get(34, 11), 2, "源格本身不按容器工位惩罚（普通地形 2）");

// 3) 道路工地与不可走地形口径不变
assert.equal(cm.get(33, 13), 1, "道路工地仍按已修好计 1");
assert.equal(cm.get(37, 12), 255, "墙仍然封死");

// E52S29: cached-route repair is local, preserves the already-built cross-room
// suffix, and never falls back to a full search for a merely occupied work tile.
{
    const point = (x,y,roomName = "E52S29") => ({x,y,roomName});
    const route = (...points) => Object.assign(points, {last() { return this.at(-1); }});
    const homePos = point(12,17,"E51S29");
    const end = point(13,17,"E51S29");
    const old = route(point(7,29),point(6,28),point(5,27),end);
    const fullSearchPath = route(point(7,29),point(7,28),point(6,27),point(5,27),end);
    const far = {id: "far", roomName: "E52S29", x: 34, y: 11, roadPathStr: "old", roadPathTick: 1};
    const near = {id: "near", roomName: "E52S29", x: 7, y: 28};
    const sourcePositions = [{pos: point(34,11)}, {pos: point(7,28)}];
    const farStructures = [
        {structureType: "road", pos: point(6,29)},
        {structureType: "extension", pos: point(7,28)},
    ];
    const farSites = [
        {structureType: "container", pos: point(35,11)},
        {structureType: "container", pos: point(6,28)},
    ];
    sandbox.Game.rooms.E52S29 = {
        name: "E52S29", memory: {}, getStructures: () => farStructures,
        lookForAt(type, x, y) {
            const list = type === "structures" ? farStructures : type === "sites" ? farSites : [];
            return list.filter(e => e.pos.x === x && e.pos.y === y);
        },
        find: k => k === sandbox.FIND_SOURCES ? sourcePositions : [],
        constructionSite: farSites,
    };
    pro.stationName = "stationSources";
    let patched;
    pro.getOuterRoadPath = data => data.roadPathStr === "patched" ? patched
        : data.roadPathStr === "invalid" ? fullSearchPath : old;
    pro.serializeOuterRoadPath = p => {
        if (p === old) return "old";
        if (p === fullSearchPath) return "invalid";
        patched = route(...p);
        return "patched";
    };
    let searches = 0;
    sandbox.PathFinder.search = (_, goal) => {
        assert.equal(goal.pos, homePos);
        assert.equal(goal.range, 1);
        searches++;
        return {path: fullSearchPath, incomplete: false};
    };
    Object.assign(sandbox, {
        Memory: {rooms: {}}, OUTER_ROAD_VALIDATE_INTERVAL: 50, OUTER_ROAD_PATH_TTL: 1000,
        RoomPosition: function (x,y,roomName) { return point(x,y,roomName); },
    });
    sandbox.Game.time = 100;
    assert.deepEqual(Array.from(pro.outerRoadSourceContainerPassThroughs(route(point(6,28),point(5,27),end),near)), [],
        "near route may still start at its own container site");
    assert.deepEqual(Array.from(pro.outerRoadSourceContainerPassThroughs(old,far)), ["E52S29:6:28"]);
    const home = {name: "E51S29",storage: {pos: homePos}};
    pro.roadBlockedByBlueprint = pos => pos.roomName === "E52S29" && pos.x === 6 && pos.y === 27;
    const localInterior = pro.outerRoadLocalDetour(old, 1, 1);
    assert.ok(Array.isArray(localInterior) && localInterior.length > 0,
        "a local detour returns only its replacement interior");
    assert.ok(!localInterior.some(p => (p.x === 7 && p.y === 29) || (p.x === 5 && p.y === 27)),
        "the local helper must exclude both unchanged anchors");
    assert.ok(localInterior.every(p => p.roomName === "E52S29"
        && Math.abs(p.x - 6) <= 3 && Math.abs(p.y - 28) <= 3),
        "the local detour must stay in the same room and within radius three");
    assert.ok(localInterior.some(p => p.x === 6 && p.y === 29),
        "the local detour cost must prefer a built road");
    assert.ok(!localInterior.some(p => (p.x === 7 && p.y === 28) || (p.x === 6 && p.y === 27)),
        "existing blockers and planned non-road tiles must be excluded");
    const repaired = pro.ensureOuterRoadPath(far, home);
    assert.equal(repaired, patched);
    assert.equal(far.roadPathStr, "patched");
    assert.ok(!repaired.some(p => p.roomName === "E52S29" && p.x === 6 && p.y === 28),
        "local repair must remove the source-container work-tile crossing");
    assert.ok(repaired.some(p => p.roomName === "E52S29" && p.x === 6 && p.y === 29),
        "equal-length alternatives prefer the already-built road");
    assert.ok(!repaired.some(p => p.roomName === "E52S29" && p.x === 7 && p.y === 28),
        "the detour must not cross an existing blocking extension");
    assert.ok(!repaired.some(p => p.roomName === "E52S29" && p.x === 6 && p.y === 27),
        "the detour must not cross a planned non-road building");
    const repairedEnd = repaired.findIndex(p => p.roomName === "E51S29");
    assert.deepEqual(Array.from(repaired.slice(repairedEnd), p => [p.roomName,p.x,p.y]),
        Array.from(old.slice(3), p => [p.roomName,p.x,p.y]),
        "local repair must preserve the exact cross-room exit/entry suffix");
    assert.equal(searches, 0, "a walkable cached route with a work-tile crossing must not run full PathFinder");
    assert.equal(pro.ensureOuterRoadPath(far, home), patched);
    assert.equal(searches, 0, "the repaired route is reused without a full search");

    // If the local area has no legal detour, keep the proven cache and still do
    // not spend a room-wide search just to resolve a soft work-tile conflict.
    const stuck = {id: "stuck", roomName: "E52S29", x: 34, y: 11,
        roadPathStr: "old", roadPathTick: 1};
    pro.roadBlockedByBlueprint = pos => pos.roomName === "E52S29"
        && Math.abs(pos.x - 6) <= 3 && Math.abs(pos.y - 28) <= 3;
    assert.equal(pro.ensureOuterRoadPath(stuck, home), old,
        "an unfixable local conflict must retain the validated cached path");
    assert.equal(stuck.roadPathStr, "old");
    assert.equal(searches, 0, "an unfixable local conflict must not invoke full PathFinder");

    // A genuinely invalid cached segment (visible non-walkable structure) still
    // follows the existing full-search recovery path.
    const invalid = {id: "invalid", roomName: "E52S29", x: 34, y: 11,
        roadPathStr: "invalid", roadPathTick: 1};
    pro.roadBlockedByBlueprint = () => false;
    assert.equal(pro.ensureOuterRoadPath(invalid, home), fullSearchPath);
    assert.equal(searches, 1, "a visible blocker on the cached route still triggers full PathFinder");
}

console.log("outer road only protects the keeper's container tile");
