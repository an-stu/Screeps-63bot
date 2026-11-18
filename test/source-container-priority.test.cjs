// 0.78.272 回归：源旁容器是低级房唯一的能量出口。
// 没有容器时 keeper 满仓会 `harvestSinkFree=false` 直接停挖（E51S29 的 7d 源零收入），
// 而规划里的源容器工地会被「10 个工地/房」预算挡在后面永远轮不到。
// `ensureSourceContainers` 对没有容器的源单独补一个规划点工地。
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

const method = extractMethod(src, "ensureSourceContainers (room){");
const sandbox = {
    STRUCTURE_CONTAINER: "container",
    LOOK_STRUCTURES: "structures",
    LOOK_CONSTRUCTION_SITES: "sites",
    OK: 0,
    Utils: {decodePosArray: v => sandbox.planned},
    planned: [],
    console: {log() {}},
};
vm.runInNewContext("var pro = { " + method + " };", sandbox);

function makeRoom(opts = {}) {
    const created = [];
    const planned = opts.planned || [{x: 9, y: 9}, {x: 25, y: 32}];
    sandbox.planned = planned;
    const room = {
        my: opts.my !== false,
        memory: {structMap: {container: "encoded"}},
        source: opts.sources || [
            {id: "srcA", pos: {x: 9, y: 10}},
            {id: "srcB", pos: {x: 24, y: 32}},
        ],
        container: opts.containers || [],
        constructionSite: opts.sites || [],
        blockedAt: opts.blockedAt || {},
        lookForAt(type, x, y) {
            let list = [];
            if (type === "structures" || type === "sites") list = this.blockedAt[type] || [];
            return list.filter(e => e.x === x && e.y === y);
        },
        getPositionAt(x, y) {
            return {x, y, createConstructionSite(type) { created.push({x, y, type}); return 0; }};
        },
        created,
    };
    return room;
}

// 1) 10 个工地占满预算 + 源 B 无容器 ⇒ 仍要补 (25,32) 的容器工地
{
    const sites = [];
    for (let i = 0; i < 10; i++) sites.push({structureType: "road", pos: {x: 10 + i, y: 20}});
    const room = makeRoom({
        containers: [{pos: {x: 9, y: 9, isNearTo(p) { return Math.abs(this.x - p.x) <= 1 && Math.abs(this.y - p.y) <= 1; }}}],
        sites,
    });
    sandbox.pro.ensureSourceContainers(room);
    assert.equal(room.created.length, 1, "即使房间工地已满，也要给无容器的源补工地");
    assert.deepEqual(room.created[0], {x: 25, y: 32, type: "container"});
}

// 2) 两个源都有容器 ⇒ 不建
{
    const near = p => ({x: p.x, y: p.y, isNearTo(q) { return Math.abs(this.x - q.x) <= 1 && Math.abs(this.y - q.y) <= 1; }});
    const room = makeRoom({containers: [{pos: near({x: 9, y: 9})}, {pos: near({x: 25, y: 32})}]});
    sandbox.pro.ensureSourceContainers(room);
    assert.equal(room.created.length, 0);
}

// 3) 源旁已有容器【工地】⇒ 不重复建
{
    const near = p => ({x: p.x, y: p.y, isNearTo(q) { return Math.abs(this.x - q.x) <= 1 && Math.abs(this.y - q.y) <= 1; }});
    const room = makeRoom({sites: [
        {structureType: "container", pos: near({x: 9, y: 9})},
        {structureType: "container", pos: near({x: 25, y: 32})},
    ]});
    sandbox.pro.ensureSourceContainers(room);
    assert.equal(room.created.length, 0);
}

// 4) 规划点被结构占住 ⇒ 跳过，不报错
{
    const near = p => ({x: p.x, y: p.y, isNearTo(q) { return Math.abs(this.x - q.x) <= 1 && Math.abs(this.y - q.y) <= 1; }});
    const room = makeRoom({blockedAt: {structures: [{x: 25, y: 32}]}});
    room.container = [{pos: near({x: 9, y: 9})}];
    sandbox.pro.ensureSourceContainers(room);
    assert.equal(room.created.length, 0, "被占住的规划点必须跳过");
}

// 5) 非我方房 ⇒ 不动
{
    const room = makeRoom({my: false});
    sandbox.pro.ensureSourceContainers(room);
    assert.equal(room.created.length, 0);
}

console.log("source containers are prioritized over the site budget");
