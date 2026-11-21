// Source keeper work tiles are walkable, but roads and ordinary traffic should
// prefer a short detour around them. Coordinates are the live E34S29 layout.
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

const sourceTilesMethod = extractMethod(utilsSrc, "sourceContainerTiles(containers, sources)");
const preferMethod = extractMethod(utilsSrc, "preferOffSourceContainers(matrix, sourceTiles)");
const tryCreateConsMethod = extractMethod(plannerSrc, "tryCreateCons(pos,struct){");

class CostMatrix {
    constructor() { this.costs = new Map(); }
    set(x, y, value) { this.costs.set(y * 50 + x, value); }
    get(x, y) { return this.costs.has(y * 50 + x) ? this.costs.get(y * 50 + x) : 0; }
}

const sandbox = {
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_ROAD: "road",
    LOOK_STRUCTURES: "structures",
    LOOK_CONSTRUCTION_SITES: "sites",
    OK: 0,
    CostMatrix,
    Game: {rooms: {}, time: 1, constructionSites: {}},
    Utils: {
        decodePosArray(value) { return value === "planned" ? plannedContainers : []; },
    },
};
const plannedContainers = [
    {x: 39, y: 42}, // second source container (blueprint slot)
    {x: 35, y: 5},  // mineral container: must not be classified as a keeper tile
];
vm.runInNewContext(
    "Array.prototype.head=function(){return this[0]}; this.copyArray=a=>Array.from(a);"
    + "var Utils=Object.assign(Utils,{" + [sourceTilesMethod, preferMethod].join(",\n") + "});"
    + "var pro={" + tryCreateConsMethod + "};",
    sandbox,
);

const UtilsUnderTest = sandbox.Utils;

// Live layout: sources (41,24), (40,43); their containers (40,24), (39,42).
// The controller/upgrader container (28,25) and mineral container (35,5) are
// intentionally present in the same container list but are not source work tiles.
const sourcePositions = [{x: 41, y: 24}, {x: 40, y: 43}];
const containers = [
    {pos: {x: 40, y: 24}},
    {x: 28, y: 25},
    [39, 42],
    {x: 35, y: 5},
];
const sourceTiles = UtilsUnderTest.sourceContainerTiles(containers, sourcePositions);
const tile = (x, y) => y * 50 + x;

assert.equal(sourceTiles.size, 2, "only the two energy-source containers are protected");
assert.ok(sourceTiles.has(tile(40, 24)), "E34S29 source A container is protected");
assert.ok(sourceTiles.has(tile(39, 42)), "E34S29 source B container is protected");
assert.ok(!sourceTiles.has(tile(28, 25)), "the upgrade container is not a source work tile");
assert.ok(!sourceTiles.has(tile(35, 5)), "the mineral container is not a source work tile");
assert.ok(!sourceTiles.has(tile(39, 24)), "the planned link is not misclassified as a source container");

// Preserve blocked structures, discourage even an existing road on the source
// container, and leave non-source road costs alone.
const costs = new CostMatrix();
costs.set(40, 24, 1); // existing road through source A container
costs.set(39, 42, 2); // unroaded source B container
costs.set(28, 25, 1); // upgrade-container tile
costs.set(35, 5, 1);  // mineral-container tile
costs.set(39, 24, 255); // planned link must remain impassable
UtilsUnderTest.preferOffSourceContainers(costs, sourceTiles);
assert.equal(costs.get(40, 24), 40, "source-container road cost is raised to the soft penalty");
assert.equal(costs.get(39, 42), 40, "unroaded source-container tile receives the same penalty");
assert.equal(costs.get(28, 25), 1, "upgrade container is not penalized");
assert.equal(costs.get(35, 5), 1, "mineral container is not penalized");
assert.equal(costs.get(39, 24), 255, "the existing link exclusion is not overwritten");

// Small local Dijkstra using Screeps' 8-way/Chebyshev movement and the matrix
// above. This makes the live route choice explicit: (40,23) -> (39,23) ->
// (38,24) -> (39,25) is cheaper than crossing the keeper's (40,24) tile.
function shortestPath(start, goal, range = 0) {
    const open = [{x: start.x, y: start.y, cost: 0, path: []}];
    const best = new Map([[tile(start.x, start.y), 0]]);
    const bounds = {minX: 37, maxX: 41, minY: 22, maxY: 26};
    while (open.length) {
        open.sort((a, b) => a.cost - b.cost);
        const current = open.shift();
        if (current.cost !== best.get(tile(current.x, current.y))) continue;
        if (Math.max(Math.abs(current.x - goal.x), Math.abs(current.y - goal.y)) <= range) {
            return {cost: current.cost, path: current.path};
        }
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                const x = current.x + dx, y = current.y + dy;
                if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
                const stepCost = costs.get(x, y);
                if (stepCost >= 255) continue;
                const nextCost = current.cost + (stepCost || 2);
                const key = tile(x, y);
                if (nextCost >= (best.get(key) ?? Infinity)) continue;
                best.set(key, nextCost);
                open.push({x, y, cost: nextCost, path: current.path.concat([{x, y}])});
            }
        }
    }
    return undefined;
}

const bypass = shortestPath({x: 40, y: 23}, {x: 39, y: 25});
assert.ok(bypass, "the existing road approach still reaches the intended downstream goal");
assert.ok(bypass.path.some(p => p.x === 39 && p.y === 23), "route uses the first candidate bypass tile");
assert.ok(bypass.path.some(p => p.x === 38 && p.y === 24), "route uses the second candidate bypass tile");
assert.ok(!bypass.path.some(p => p.x === 40 && p.y === 24), "route avoids the source container");
assert.ok(!bypass.path.some(p => p.x === 39 && p.y === 24), "route still avoids the planned link");

const endpoint = shortestPath({x: 38, y: 24}, {x: 40, y: 24}, 1);
assert.ok(endpoint, "the source-container endpoint remains reachable at range 1");
assert.ok(!endpoint.path.some(p => p.x === 40 && p.y === 24), "range-1 endpoint does not require entering the container");

// Construction-time guard also uses the source-only classification: never put
// a road site on either source container, but keep the bypass available.
const created = [];
const room = {
    source: sourcePositions.map(pos => ({pos})),
    container: [{pos: {x: 40, y: 24}}, {pos: {x: 28, y: 25}}],
    memory: {structMap: {container: "planned"}},
    constructionSite: [],
    lookForAt() { return []; },
    getPositionAt(x, y) {
        return {
            x, y, roomName: "E34S29",
            lookFor() { return sandbox.copyArray([]); },
            createConstructionSite(structureType) { created.push({x, y, structureType}); return 0; },
        };
    },
};
sandbox.Game.rooms.E34S29 = room;
const pos = (x, y) => room.getPositionAt(x, y);
assert.equal(sandbox.pro.tryCreateCons(pos(40, 24), "road"), false,
    "do not create road on the existing source container");
assert.equal(sandbox.pro.tryCreateCons(pos(39, 42), "road"), false,
    "do not create road on the planned source container");
assert.equal(sandbox.pro.tryCreateCons(pos(39, 23), "road"), true,
    "the candidate bypass remains eligible for road construction");
assert.deepEqual(created, [{x: 39, y: 23, structureType: "road"}]);

console.log("source container road policy: OK");
