const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "manager_planner.js"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
assert.ok(/if \(!labFound\) pro\.placeLabPlaza\(roomName, structMap/.test(code),
    "原搜索失败后必须调用最终蓝图兜底");
assert.ok(/if \(labFound\) \{/.test(code), "原搜索成功时仍保留核心区内 lab 广场");
assert.ok(!/roomWalkable\.get\(bx \+ i, by \+ j\)/.test(code), "不得恢复旧的孤立全图扫描");

const start = src.indexOf("    protectLabPlaza (roomName, structMap) {");
const end = src.indexOf("\n    /**", start);
assert.ok(start >= 0 && end > start, "提取 lab 布局函数失败");
const methods = src.slice(start, end).trim().replace(/,$/, "");

const ROOM = "E55S29";
const posKey = (x, y) => `${x},${y}`;

function load(walkable, room) {
    class CostMatrix {
        constructor(data) { this.data = data || new Map(); }
        set(x, y, value) { this.data.set(posKey(x, y), value); }
        get(x, y) { return this.data.get(posKey(x, y)) || 0; }
        clone() { return new CostMatrix(new Map(this.data)); }
    }
    class RoomPosition {
        constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    }
    function search(origin, goal, options) {
        const costs = options.roomCallback(goal.pos.roomName);
        const startKey = posKey(origin.x, origin.y);
        const goalKey = posKey(goal.pos.x, goal.pos.y);
        const distances = new Map([[startKey, 0]]);
        const previous = new Map();
        const queue = [[0, origin.x, origin.y]];
        while (queue.length) {
            queue.sort((a, b) => a[0] - b[0]);
            const [distance, x, y] = queue.shift();
            const currentKey = posKey(x, y);
            if (distance !== distances.get(currentKey)) continue;
            if (currentKey === goalKey) {
                const path = [];
                let cursor = currentKey;
                while (cursor !== startKey) {
                    const [px, py] = cursor.split(",").map(Number);
                    path.push(new RoomPosition(px, py, ROOM));
                    cursor = previous.get(cursor);
                }
                return {path: path.reverse(), incomplete: false};
            }
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                if (!dx && !dy) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= 50 || ny >= 50) continue;
                const cost = costs.get(nx, ny);
                if (cost >= 255) continue;
                const nextKey = posKey(nx, ny);
                const nextDistance = distance + cost;
                if (nextDistance < (distances.has(nextKey) ? distances.get(nextKey) : Infinity)) {
                    distances.set(nextKey, nextDistance);
                    previous.set(nextKey, currentKey);
                    queue.push([nextDistance, nx, ny]);
                }
            }
        }
        return {path: [], incomplete: true};
    }
    const ctx = {
        Game: {rooms: room ? {[ROOM]: room} : {}},
        Room: {Terrain: function () {
            return {get: (x, y) => walkable.has(posKey(x, y)) ? 0 : 1};
        }},
        RoomPosition,
        PathFinder: {CostMatrix, search},
        FIND_STRUCTURES: 1,
        STRUCTURE_ROAD: "road", STRUCTURE_RAMPART: "rampart",
        STRUCTURE_EXTENSION: "extension", STRUCTURE_LAB: "lab",
        TERRAIN_MASK_WALL: 1, TERRAIN_MASK_SWAMP: 2,
    };
    vm.runInNewContext(`globalThis.pro = {${methods}}`, ctx,
        {filename: "manager_planner.labPlacement.js"});
    return {place: ctx.pro.placeLabPlaza, protect: ctx.pro.protectLabPlaza};
}

function rectangle(x0, y0, x1, y1) {
    const result = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.add(posKey(x, y));
    return result;
}

function assertConnected(origin, roads, targets) {
    const roadSet = new Set(roads.map(p => posKey(p[0], p[1])));
    const reached = new Set([posKey(origin.x, origin.y)]);
    const queue = [[origin.x, origin.y]];
    while (queue.length) {
        const [x, y] = queue.shift();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const k = posKey(x + dx, y + dy);
            if (roadSet.has(k) && !reached.has(k)) {
                reached.add(k);
                queue.push([x + dx, y + dy]);
            }
        }
    }
    targets.forEach(p => assert.ok(reached.has(posKey(p[0], p[1])), `lab 道路未连通: ${p}`));
}

function assertReactionTopology(labs) {
    let supported = false;
    for (let a of labs) for (let b of labs) {
        if (a === b) continue;
        if (labs.every(p => Math.max(Math.abs(p[0] - a[0]), Math.abs(p[1] - a[1])) <= 2
            && Math.max(Math.abs(p[0] - b[0]), Math.abs(p[1] - b[1])) <= 2)) supported = true;
    }
    assert.ok(supported, "必须存在两个输入 lab 能在 range 2 内覆盖其余 lab");
}

function assertProtected(map, walkable) {
    const ramparts = new Set((map.rampart || []).map(p => posKey(p[0], p[1])));
    const reached = new Set();
    const queue = [];
    for (let i = 0; i < 50; i++) for (let [x, y] of [[i, 0], [i, 49], [0, i], [49, i]]) {
        const k = posKey(x, y);
        if (walkable.has(k) && !ramparts.has(k) && !reached.has(k)) {
            reached.add(k);
            queue.push([x, y]);
        }
    }
    while (queue.length) {
        const [x, y] = queue.shift();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const nx = x + dx, ny = y + dy, k = posKey(nx, ny);
            if (nx < 0 || ny < 0 || nx >= 50 || ny >= 50 || reached.has(k)) continue;
            if (!walkable.has(k) || ramparts.has(k)) continue;
            reached.add(k);
            queue.push([nx, ny]);
        }
    }
    map.lab.forEach(p => assert.ok(!reached.has(posKey(p[0], p[1])), `lab 暴露在防线外: ${p}`));
}

function assertValidLayout(result, map, origin, extensionCount, walkable) {
    assert.ok(result, "必须找到 lab 广场");
    assert.equal(map.lab.length, 10);
    assert.equal(result.plazaRoads.length, 6);
    assert.equal(map.extension.length, extensionCount, "迁移前后 extension 总数必须不变");
    assert.equal(new Set(map.lab.map(p => posKey(p[0], p[1]))).size, 10, "lab 不得重叠");
    const labSet = new Set(map.lab.map(p => posKey(p[0], p[1])));
    map.road.forEach(p => assert.ok(!labSet.has(posKey(p[0], p[1])), "lab 不得压在道路上"));
    map.extension.forEach(p => {
        assert.ok(!labSet.has(posKey(p[0], p[1])), "extension 不得留在 lab 格");
        assert.ok(!result.plazaRoads.some(r => r[0] === p[0] && r[1] === p[1]),
            "extension 不得留在广场道路格");
    });
    assertConnected(origin, map.road, result.plazaRoads);
    assertReactionTopology(map.lab);
    assertProtected(map, walkable);
    assert.equal(new Set(map.rampart.map(p => posKey(p[0], p[1]))).size, map.rampart.length,
        "rampart 不得重复");
}

{
    const walkable = rectangle(1, 1, 48, 48);
    const {place} = load(walkable);
    const map = {road: [[10, 10]], extension: [], lab: [], storage: [[9, 10]]};
    const result = place(ROOM, map, {x: 10, y: 10});
    assertValidLayout(result, map, {x: 10, y: 10}, 0, walkable);
    assert.equal(result.relocated.length, 0);
}

function constrainedFixture(room) {
    const walkable = rectangle(20, 20, 23, 23);
    [[19, 20], [19, 21], [18, 20], [18, 21]].forEach(p => walkable.add(posKey(p[0], p[1])));
    const {place} = load(walkable, room);
    const map = {road: [[19, 20]], extension: [[20, 20]], lab: []};
    return {place, map, walkable};
}

{
    const {place, map, walkable} = constrainedFixture();
    const result = place(ROOM, map, {x: 19, y: 20});
    assertValidLayout(result, map, {x: 19, y: 20}, 1, walkable);
    assert.equal(result.relocated.length, 1, "唯一合法广场必须迁移未建 extension");
    assert.deepEqual(Array.from(result.relocated[0].from), [20, 20]);
    assert.ok(!map.extension.some(p => p[0] === 20 && p[1] === 20));
}

{
    const walkable = rectangle(1, 1, 48, 48);
    walkable.delete(posKey(19, 35));
    walkable.delete(posKey(19, 36));
    const {protect} = load(walkable);
    const map = {
        lab: [[20, 34], [20, 35], [20, 37], [21, 34], [21, 36], [22, 35], [22, 37], [23, 34], [23, 36], [23, 37]],
        rampart: [[19, 34], [20, 34], [21, 34], [22, 34], [23, 34], [24, 34]],
    };
    const result = protect(ROOM, map);
    assert.equal(result.edge, "north");
    assert.equal(result.naturalWalls, 2);
    assert.equal(result.addedRamparts.length, 10);
    assert.equal(map.rampart.length, 16);
    assertProtected(map, walkable);
    const again = protect(ROOM, map);
    assert.equal(again.addedRamparts.length, 0, "重复执行不得重复添加 rampart");
    assert.equal(map.rampart.length, 16);
}

{
    const built = {pos: {x: 20, y: 20}, structureType: "extension"};
    const room = {extension: [built], constructionSite: [], lab: []};
    const {place, map} = constrainedFixture(room);
    const before = JSON.stringify(map);
    assert.equal(place(ROOM, map, {x: 19, y: 20}), null, "已建成 extension 不得迁移");
    assert.equal(JSON.stringify(map), before, "失败时蓝图必须原样不变");
}

{
    const room = {extension: [], constructionSite: [{pos: {x: 20, y: 20}, structureType: "extension"}], lab: []};
    const {place, map} = constrainedFixture(room);
    const before = JSON.stringify(map);
    assert.equal(place(ROOM, map, {x: 19, y: 20}), null, "已有 extension 工地不得静默迁移");
    assert.equal(JSON.stringify(map), before);
}

{
    const walkable = new Set([posKey(10, 10)]);
    const {place} = load(walkable);
    const map = {road: [[10, 10]], extension: [[20, 20]], lab: []};
    const before = JSON.stringify(map);
    assert.equal(place(ROOM, map, {x: 10, y: 10}), null);
    assert.equal(JSON.stringify(map), before, "无解时不得写入半个广场");
}

{
    const autoSrc = fs.readFileSync(path.join(root, "modules", "manager_autoPlanner.js"), "utf8");
    const autoStart = autoSrc.indexOf("    tryCreateLabRamparts(room) {");
    const autoEnd = autoSrc.indexOf("\n    /**", autoStart);
    assert.ok(autoStart >= 0 && autoEnd > autoStart);
    const autoMethod = autoSrc.slice(autoStart, autoEnd).trim().replace(/,$/, "");
    assert.ok((autoSrc.match(/pro\.tryCreateLabRamparts\(room\)/g) || []).length === 2,
        "低级与高级自动建造都必须补 lab rampart");
    assert.ok(/struct == STRUCTURE_RAMPART \|\| struct == STRUCTURE_WALL/.test(autoSrc),
        "不得放开全房 rampart 建造");
    const calls = [];
    const autoCtx = {
        Utils: {decodePosArray: value => value},
        RoomPosition: function (x, y, roomName) { return {x, y, roomName}; },
        STRUCTURE_LAB: "lab", STRUCTURE_RAMPART: "rampart",
        pro: {tryCreateCons: (pos, type) => calls.push({pos, type})},
    };
    vm.runInNewContext(`pro.tryCreateLabRamparts = function ${autoMethod}`, autoCtx);
    const room = {name: ROOM, level: 3, memory: {structMap: {
        lab: [{x: 20, y: 34}],
        rampart: [{x: 19, y: 35}, {x: 4, y: 25}],
    }}};
    autoCtx.pro.tryCreateLabRamparts(room);
    assert.equal(calls.length, 1, "只能排队 lab 附近的 rampart");
    assert.equal(calls[0].pos.x, 19);
    assert.equal(calls[0].pos.y, 35);
    room.memory.structMap.lab = [];
    autoCtx.pro.tryCreateLabRamparts(room);
    assert.equal(calls.length, 1, "没有 lab 时不得排队 rampart");
}

console.log("planner lab placement: OK");
