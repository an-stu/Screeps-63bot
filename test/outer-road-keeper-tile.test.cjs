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
    "blueprintWalkableSet(room)",
    "structMapPositions(value)",
    "outerRoadRoomCallback(roomName, useBlueprint, homeRoom, mergePaths)",
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
    {structureType: "road", pos: {x: 33, y: 12}},
    {structureType: "road", pos: {x: 34, y: 12}},
    {structureType: "road", pos: {x: 35, y: 12}},
    {structureType: "road", pos: {x: 36, y: 12}},
];
const sites = [
    {structureType: "road", pos: {x: 33, y: 13}},
    {structureType: "road", pos: {x: 34, y: 13}},
    {structureType: "road", pos: {x: 35, y: 13}},
    {structureType: "container", pos: {x: 21, y: 20}},
];
const sources = [
    {id: "src1", pos: {x: 34, y: 11}},
    {id: "src2", pos: {x: 20, y: 20}},
];

const room = {
    name: "E41S29",
    memory: {},
    getStructures: () => structures,
    constructionSite: sites,
    find: type => type === 104 ? sources : [],
    lookForAt(type, x, y) {
        const list = type === "structures" ? structures : type === "sites" ? sites : [];
        return list.filter(e => e.pos.x === x && e.pos.y === y);
    },
};

const sandbox = {
    TERRAIN_MASK_WALL: WALL, TERRAIN_MASK_SWAMP: SWAMP,
    STRUCTURE_ROAD: "road", STRUCTURE_CONTAINER: "container", STRUCTURE_RAMPART: "rampart",
    LOOK_STRUCTURES: "structures", LOOK_CONSTRUCTION_SITES: "sites",
    FIND_SOURCES: 104,
    OUTER_ROAD_WORK_TILE_COST: 8,
    PathFinder: {CostMatrix},
    Utils: {decodePosArray: () => []},
    Game: {rooms: {"E41S29": room}, map: {getRoomTerrain: () => terrain}},
    console: {log() {}},
};
sandbox.global = sandbox;
vm.runInNewContext("var pro = {" + methods.join(",\n") + "};", sandbox);
const pro = sandbox.pro;

// homeRoom 传别的房间：排除「主房旧路代价 3」分支，只验证工位保护
const cm = pro.outerRoadRoomCallback("E41S29", true, "X1X1", undefined);

// 1) 只保护容器格本身
assert.equal(cm.get(33, 11), 8, "源旁容器格（keeper 站桩位）必须保持高代价");
assert.equal(cm.get(21, 20), 8, "容器【工地】格同样要保护（容器还没建好时 keeper 就站在那）");

// 2) 原先被整圈误伤的 road / 源格恢复正常
assert.equal(cm.get(33, 12), 1, "容器隔壁的 road 不再被抬到 8");
assert.equal(cm.get(34, 12), 1);
assert.equal(cm.get(35, 12), 1);
assert.equal(cm.get(36, 12), 1);
assert.equal(cm.get(34, 11), 2, "源格本身不再按工位圈抬高（普通地形 2）");

// 3) 道路工地与不可走地形口径不变
assert.equal(cm.get(33, 13), 1, "道路工地仍按已修好计 1");
assert.equal(cm.get(37, 12), 255, "墙仍然封死");

console.log("outer road only protects the keeper's container tile");
