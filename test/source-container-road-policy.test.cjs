// Source and controller containers are fixed worker positions: roads may pass
// through them at a soft path cost, but the planner must not build roads there.
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

const tryCreateConsMethod = extractMethod(plannerSrc, "tryCreateCons(pos,struct){");
const roadWorkTilesMethod = extractMethod(plannerSrc, "roadWorkTiles(room) {");

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
    Game: {rooms: {}, time: 1, constructionSites: {}, getObjectById: id => id === "upgC" ? upgradeContainer : null},
};
sandbox.global = sandbox;
vm.runInNewContext(utilsSrc, sandbox);
vm.runInNewContext(
    "Array.prototype.head=function(){return this[0]};"
    + "this.testPlanner={" + roadWorkTilesMethod + ","
    + tryCreateConsMethod.replace(/\bpro\./g, "testPlanner.") + "};",
    sandbox,
);

const Utils = sandbox.Utils;
const tile = (x, y) => y * 50 + x;
const sourcePositions = [
    {x: 41, y: 24},
    {x: 40, y: 43},
    {x: 18, y: 18},
];
const upgradeContainer = {id: "upgC", structureType: "container", pos: {x: 28, y: 25, roomName: "E34S29"}};
const builtSourceContainer = {pos: {x: 40, y: 24}};
const plannedSourceContainer = {x: 39, y: 42};
const ownSiteSourceContainer = {structureType: "container", my: true, pos: {x: 17, y: 17}};
const mineralContainer = {pos: {x: 35, y: 5}};
const controller = {my: true, pos: {x: 27, y: 25}};

// Keep the legacy source-only helper available for callers that need the
// narrower classification; the combined helper adds controller work tiles.
const legacySourceTiles = Utils.sourceContainerTiles(
    [builtSourceContainer, plannedSourceContainer, ownSiteSourceContainer, upgradeContainer, mineralContainer],
    sourcePositions,
);
assert.equal(legacySourceTiles.size, 3, "legacy helper continues to classify only source-adjacent containers");
assert.ok(legacySourceTiles.has(tile(40, 24)));
assert.ok(legacySourceTiles.has(tile(39, 42)));
assert.ok(legacySourceTiles.has(tile(17, 17)));
assert.ok(!legacySourceTiles.has(tile(28, 25)), "legacy source-only classification excludes the controller container");
assert.ok(!legacySourceTiles.has(tile(35, 5)), "mineral containers are not source work tiles");

const directWorkTiles = Utils.containerWorkTiles(
    [builtSourceContainer, plannedSourceContainer, ownSiteSourceContainer, upgradeContainer, mineralContainer],
    sourcePositions,
    controller,
    upgradeContainer,
);
for (const key of [tile(40, 24), tile(39, 42), tile(17, 17), tile(28, 25)]) {
    assert.ok(directWorkTiles.has(key), "combined work-tile helper includes " + key);
}
assert.ok(!directWorkTiles.has(tile(35, 5)), "combined work-tile helper leaves the mineral container alone");

// The room-level helper must merge built containers, encoded blueprint slots,
// and our own container sites before applying source/controller adjacency.
const plannedLayout = Utils.encodePosArray([
    plannedSourceContainer,
    {x: 35, y: 5}, // mineral slot: deliberately not adjacent to an energy source
]);
const room = {
    name: "E34S29",
    my: true,
    memory: {structMap: {container: plannedLayout}, stationUpgrade: {container: "upgC"}},
    source: sourcePositions.map(pos => ({pos})),
    controller,
    container: [builtSourceContainer, upgradeContainer, mineralContainer],
    constructionSite: [ownSiteSourceContainer],
};
const roomWorkTiles = Utils.roomContainerWorkTiles(room);
for (const key of [tile(40, 24), tile(39, 42), tile(17, 17), tile(28, 25)]) {
    assert.ok(roomWorkTiles.has(key), "room helper includes built/planned/site/controller tile " + key);
}
assert.ok(!roomWorkTiles.has(tile(35, 5)), "room helper does not turn the mineral container into a work tile");

// Softly discourage roads through any work tile without making it impassable;
// existing blocked cells must stay blocked and non-work mineral traffic is intact.
const costs = new CostMatrix();
costs.set(40, 24, 1); // existing road through a built source container
costs.set(39, 42, 2); // planned source work tile
costs.set(17, 17, 3); // own container construction site
costs.set(28, 25, 1); // controller-adjacent upgrade container
costs.set(35, 5, 1);  // mineral container
costs.set(39, 24, 255); // an existing obstacle must never be softened
Utils.preferOffSourceContainers(costs, roomWorkTiles);
assert.equal(costs.get(40, 24), 40, "built source-container road gets the soft penalty");
assert.equal(costs.get(39, 42), 40, "planned source work tile gets the soft penalty");
assert.equal(costs.get(17, 17), 40, "own source-container site gets the soft penalty");
assert.equal(costs.get(28, 25), 40, "controller-adjacent upgrade container gets the soft penalty");
assert.equal(costs.get(35, 5), 1, "mineral container cost remains unchanged");
assert.equal(costs.get(39, 24), 255, "existing obstacle stays impassable");

// A worker can still path directly onto its fixed work tile: the 40 cost is a
// preference, not a hard block (255). This uses Screeps' 8-way movement cost.
function shortestPathCost(start, goal) {
    const keyOf = p => tile(p.x, p.y);
    const open = [{x: start.x, y: start.y, cost: 0}];
    const best = new Map([[keyOf(start), 0]]);
    const bounds = {minX: 38, maxX: 41, minY: 22, maxY: 25};
    while (open.length) {
        open.sort((a, b) => a.cost - b.cost);
        const current = open.shift();
        if (current.cost !== best.get(keyOf(current))) continue;
        if (current.x === goal.x && current.y === goal.y) return current.cost;
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
                open.push({x, y, cost: nextCost});
            }
        }
    }
    return Infinity;
}
assert.equal(shortestPathCost({x: 39, y: 23}, {x: 40, y: 24}), 40,
    "the directly-entered source work tile is reachable at the soft cost");

// Construction-time guard uses the same combined set. It protects source and
// upgrade work tiles regardless of whether the source tile is built, planned,
// or represented by our own construction site, but permits a nearby bypass.
const created = [];
room.lookForAt = () => [];
room.getPositionAt = (x, y) => ({
    x, y, roomName: room.name,
    lookFor() { return vm.runInNewContext("[]", sandbox); },
    createConstructionSite(structureType) { created.push({x, y, structureType}); return 0; },
});
sandbox.Game.rooms[room.name] = room;
const pos = (x, y) => room.getPositionAt(x, y);
assert.equal(sandbox.testPlanner.tryCreateCons(pos(40, 24), "road"), false,
    "do not create a road on a built source container");
assert.equal(sandbox.testPlanner.tryCreateCons(pos(39, 42), "road"), false,
    "do not create a road on a planned source work tile");
assert.equal(sandbox.testPlanner.tryCreateCons(pos(17, 17), "road"), false,
    "do not create a road on an owned source-container site");
assert.equal(sandbox.testPlanner.tryCreateCons(pos(28, 25), "road"), false,
    "do not create a road on the controller-adjacent upgrade container");
assert.equal(sandbox.testPlanner.tryCreateCons(pos(39, 23), "road"), true,
    "the candidate bypass remains eligible for road construction");
assert.deepEqual(created, [{x: 39, y: 23, structureType: "road"}]);

console.log("source and controller container road policy: OK");
