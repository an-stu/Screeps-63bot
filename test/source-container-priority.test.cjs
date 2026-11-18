// RCL3 priority containers must come from their matching blueprint slots, ahead
// of generic mineral/road planning, without double-queueing construction intents.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "modules/manager_autoPlanner.js"), "utf8");

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

const priorityMethod = extractMethod(src, "ensureSourceContainers (room){");
const genericMethod = extractMethod(src, "tryCreateCons(pos,struct){");
const lowLevelMethod = extractMethod(src, "tryAutoBuildLowLevel800 (room){");
const sandbox = {
    STRUCTURE_CONTAINER: "container",
    STRUCTURE_ROAD: "road",
    STRUCTURE_RAMPART: "rampart",
    STRUCTURE_EXTENSION: "extension",
    LOOK_STRUCTURES: "structures",
    LOOK_CONSTRUCTION_SITES: "sites",
    OK: 0,
    Utils: {decodePosArray: () => sandbox.planned},
    planned: [],
    Game: {rooms: {}, time: 1, constructionSites: {}},
    console: {log() {}},
};
vm.runInNewContext("Array.prototype.head=function(){return this[0]}; var pro = { "
    + priorityMethod + "," + genericMethod + "," + lowLevelMethod + " };", sandbox);

function makeRoom(opts = {}) {
    const created = [];
    const attempted = [];
    const planned = opts.planned || [{x: 9, y: 9}, {x: 25, y: 32}, {x: 15, y: 15}, {x: 25, y: 25}];
    sandbox.planned = planned;
    const room = {
        name: "W0N0",
        my: opts.my !== false,
        memory: {structMap: {container: "encoded"}},
        source: opts.sources || [
            {id: "srcA", pos: {x: 9, y: 10}},
            {id: "srcB", pos: {x: 24, y: 32}},
        ],
        controller: opts.controller === null ? null : {pos: opts.controller || {x: 24, y: 24}},
        container: opts.containers || [],
        constructionSite: opts.sites || [],
        blockedAt: opts.blockedAt || {},
        lookForAt(type, x, y) {
            let list = (this.blockedAt[type] || []).filter(e => e.x === x && e.y === y);
            if (type === "structures") {
                list = list.concat(this.container
                    .filter(e => e.pos.x === x && e.pos.y === y)
                    .map(e => ({structureType: "container", x, y})));
            } else if (type === "sites") {
                list = list.concat(this.constructionSite
                    .filter(e => e.pos.x === x && e.pos.y === y));
            }
            return list;
        },
        getPositionAt(x, y) {
            return {
                x, y, roomName: room.name,
                lookFor(type) { return room.lookForAt(type, x, y); },
                createConstructionSite(type) {
                    attempted.push({x, y, type});
                    const result = room.failAt && room.failAt[x + ":" + y];
                    if (result !== undefined) return result;
                    created.push({x, y, type});
                    return 0;
                },
            };
        },
        created,
        attempted,
        failAt: opts.failAt || {},
    };
    sandbox.Game.rooms[room.name] = room;
    return room;
}

function nearPos(pos) {
    return {x: pos.x, y: pos.y};
}

// Keep the existing 150-tick gate and run the purpose-aware pass before generic
// container (mineral) and road placement.
assert.match(lowLevelMethod, /% 150 == 0/);
assert.ok(lowLevelMethod.indexOf("pro.ensureSourceContainers(room)")
    < lowLevelMethod.indexOf("pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_CONTAINER,3)"));
assert.ok(lowLevelMethod.indexOf("pro.tryCreateStructs(room,room.memory.structMap,STRUCTURE_CONTAINER,3)")
    < lowLevelMethod.indexOf("STRUCTURE_ROAD"));

// 1) The fourth blueprint container slot is the controller slot. It still wins
// with the site ceiling full and ten unrelated road sites already queued.
{
    const sites = [];
    for (let i = 0; i < 10; i++) sites.push({structureType: "road", pos: {x: 10 + i, y: 20}});
    const room = makeRoom({
        containers: [{pos: nearPos({x: 9, y: 9})}, {pos: nearPos({x: 25, y: 32})}],
        sites,
    });
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created, [{x: 25, y: 25, type: "container"}],
        "the controller must use its fourth planned slot despite a full room site budget");
    assert.equal(room._construct_builed, 1, "priority intent must count toward this tick's site budget");
}

// 2) Uncovered sources are processed before controller, one successful priority
// site per call. Once sources are covered, the controller gets the next pass.
{
    const room = makeRoom();
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created[0], {x: 9, y: 9, type: "container"});
    assert.equal(room.created.length, 1, "only one priority container is submitted per pass");

    room.constructionSite.push({structureType: "container", pos: {x: 9, y: 9}});
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created[1], {x: 25, y: 32, type: "container"}, "second source precedes controller");

    room.constructionSite.push({structureType: "container", pos: {x: 25, y: 32}});
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created[2], {x: 25, y: 25, type: "container"}, "controller is next after source coverage");
    assert.equal(room.created.length, 3);
}

// 3) A road/rampart on a planned source tile is a legal container co-location.
{
    const room = makeRoom({blockedAt: {structures: [
        {x: 9, y: 9, structureType: "road"},
    ]}});
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created[0], {x: 9, y: 9, type: "container"});
}
{
    const room = makeRoom({
        containers: [{pos: nearPos({x: 9, y: 9})}, {pos: nearPos({x: 25, y: 32})}],
        blockedAt: {structures: [{x: 25, y: 25, structureType: "rampart"}]},
    });
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created[0], {x: 25, y: 25, type: "container"},
        "a controller container may share its planned tile with a built rampart");
}

// 4) If the first matching blueprint slot is blocked, keep looking at other
// matching slots. If every source tile is unusable, let the controller proceed.
{
    const room = makeRoom({
        planned: [{x: 9, y: 9}, {x: 10, y: 9}, {x: 25, y: 32}, {x: 15, y: 15}, {x: 25, y: 25}],
        blockedAt: {structures: [{x: 9, y: 9, structureType: "spawn"}]},
    });
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created[0], {x: 10, y: 9, type: "container"},
        "a blocked source slot must fall through to another slot adjacent to that source");
}
{
    const room = makeRoom({blockedAt: {structures: [
        {x: 9, y: 9, structureType: "spawn"},
        {x: 25, y: 32, structureType: "spawn"},
    ]}});
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created[0], {x: 25, y: 25, type: "container"},
        "unusable source slots must not starve the controller forever");
}

// 5) Existing matching container sites suppress duplicates; successful priority
// intents are also visible to the same-tick generic call before sites refresh.
{
    const room = makeRoom({sites: [
        {structureType: "container", pos: {x: 9, y: 9}},
        {structureType: "container", pos: {x: 25, y: 32}},
        {structureType: "container", pos: {x: 25, y: 25}},
    ]});
    sandbox.pro.ensureSourceContainers(room);
    assert.equal(room.created.length, 0, "existing source/controller sites cover all priority purposes");

    const fresh = makeRoom();
    sandbox.pro.ensureSourceContainers(fresh);
    const duplicate = sandbox.pro.tryCreateCons(fresh.getPositionAt(9, 9), "container");
    assert.equal(duplicate, false, "generic planning must see a same-tick priority intent");
    assert.equal(sandbox.pro.tryCreateCons(fresh.getPositionAt(9, 9), "road"), false,
        "the engine accepts only one construction site per tile, even with different types");
    assert.equal(fresh.created.length, 1);
}

// 6) Priority can exceed the 10-site room budget once, while generic work still
// respects the ceiling and doesn't duplicate the reserved priority tile.
{
    const sites = [];
    for (let i = 0; i < 10; i++) sites.push({structureType: "road", pos: {x: 10 + i, y: 20}});
    const room = makeRoom({sites});
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created, [{x: 9, y: 9, type: "container"}], "source is the single budget exception");
    assert.equal(sandbox.pro.tryCreateCons(room.getPositionAt(9, 9), "container"), false);
    assert.equal(sandbox.pro.tryCreateCons(room.getPositionAt(25, 25), "container"), false,
        "generic site creation remains capped after the priority intent");
    assert.equal(room.created.length, 1);
}

// 7) No off-blueprint position is synthesized, and non-owned rooms remain read-only.
{
    const room = makeRoom({planned: [], my: true});
    sandbox.pro.ensureSourceContainers(room);
    assert.deepEqual(room.created, [], "no source/controller-adjacent plan position means no build");
    const hostile = makeRoom({my: false});
    sandbox.pro.ensureSourceContainers(hostile);
    assert.deepEqual(hostile.created, []);
}

console.log("source and controller blueprint containers are prioritized safely");
