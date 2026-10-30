/**
 * 外矿卸货口不能空车占位（2026-10-31 W26N59 (29,4) 停摆）。
 *
 * 现场：容器 0/2000、源卡在 1,500 不动；两只空车在 (28,6)/(27,7) **每 tick 互相
 * 对穿**（各自的下一格就是对方，lastPos 一直复位 ⇒ 「不动」判据看不见），
 * keeper 被钉在 (27,8) 三格外 561 tick 没上过容器 ⇒ 容器空 ⇒ 没人采 ⇒ 更空。
 *
 * 修法：容器没货 + 自己没货时，空车退到**矿区路线外 2~4 格**待命，把卸货口
 * 和进门那条单格路让给 keeper。容器一有能量，下一 tick 自然回来装。
 *
 * 这里验三件事：
 *   ① 待命格几何：2~4 格、避开路线、避开设障格（纯函数，可直接跑）
 *   ② 调用点顺序：待命判定必须在「走到容器」之前，否则车已经贴上去了
 *   ③ 负对照：把「容器/自己有货」的守卫去掉，① 之外的②必须失败（条件式断言）
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");
// 断言前剥注释：注释里会原样引用被删的表达式（本仓库既有踩坑）
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── ① 待命格几何（跑真实函数）────────────────────────────────────────────
const ARRAY_PATCH = `
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
Array.prototype.last = function () { return this.length ? this[this.length - 1] : undefined; };
Array.prototype.maxBy = function (fn) {
    let best, bestV;
    this.forEach(x => { let v = fn(x); if (best === undefined || v > bestV) { best = x; bestV = v; } });
    return best;
};
Array.prototype.sum = function () { return this.reduce((a, b) => a + b, 0); };
`;

function makeContext() {
    const ctx = {
        console,
        isSaveCpu: true,
        Memory: { rooms: {} },
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null, map: {}, creeps: {}, rooms: {} },
        Room: { Terrain: function () { this.get = () => 0; } },
        RoomPosition: function (x, y, roomName) {
            this.x = x; this.y = y; this.roomName = roomName;
            this.getRangeTo = function (a, b) {
                let ox = (a && a.x !== undefined) ? a.x : a;
                let oy = (a && a.y !== undefined) ? a.y : b;
                return Math.max(Math.abs(this.x - ox), Math.abs(this.y - oy));
            };
        },
        StationCarry: { stationName: "stationCarry" },
        StationMineral: { stationName: "stationMineral" },
        StationUpgrade: { stationName: "stationUpgrade" },
        _: {
            values: obj => Object.keys(obj || {}).map(k => obj[k]),
            keys: obj => Object.keys(obj || {}),
        },
        StationHive: { trySpawn: () => undefined },
        ManagerCreeps: { calcBodyPart: () => [] },
        ManagerFlags: { getFlagsByPrefix: () => [] },
        HelperError: { catchError: fn => fn() },
        UtilsTask: { task: () => ({}), taskOutView: () => ({}), taskData: () => ({}) },
        Creep: function () {},
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_FULL: -8, ERR_NO_BODYPART: -12,
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
    vm.runInNewContext(ARRAY_PATCH, ctx);
    vm.runInNewContext(raw, ctx);
    return ctx;
}

{
    const S = makeContext().StationSources;
    assert.equal(typeof S.outerCarryHoldTile, "function", "outerCarryHoldTile 必须挂在 StationSources 上");

    const container = new (function () {})();
    container.x = 29; container.y = 5; container.roomName = "W26N59";
    const creepAt = (x, y) => ({ x: x, y: y, roomName: "W26N59", getRangeTo: (a, b) => {
        let ox = (a && a.x !== undefined) ? a.x : a, oy = (a && a.y !== undefined) ? a.y : b;
        return Math.max(Math.abs(x - ox), Math.abs(y - oy));
    } });

    // 空路线 + 全可站：待命格必须落在 2~4 格环上
    let tile = S.outerCarryHoldTile(creepAt(27, 8), container, null, () => true);
    assert.ok(tile, "挑不出待命格");
    let d = Math.max(Math.abs(tile.x - 29), Math.abs(tile.y - 5));
    assert.ok(d >= 2 && d <= 4, "待命格必须在离容器 2~4 格，实际 " + d + " (" + tile.x + "," + tile.y + ")");

    // 路线格必须让开：把整个 2~3 格环都标成路线 ⇒ 只能退到 4 格环
    let road = {};
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= 2) road[(29 + dx) + "," + (5 + dy)] = true;
    }
    tile = S.outerCarryHoldTile(creepAt(27, 8), container, road, () => true);
    assert.ok(tile, "路线挡住 2~3 格后仍应在 4 格环上找到待命格");
    assert.equal(Math.max(Math.abs(tile.x - 29), Math.abs(tile.y - 5)), 4,
        "被路线占满 2~3 格环时必须退到 4 格环");
    assert.ok(!road[tile.x + "," + tile.y], "待命格不能落在矿区路线上");

    // 障碍格必须让开（模拟别人站着 / 墙）
    tile = S.outerCarryHoldTile(creepAt(27, 8), container, null, (x, y) => !(x == 28 && y == 7));
    assert.ok(tile && !(tile.x == 28 && tile.y == 7), "被占的格子不能被选中");

    // 整片封死 ⇒ undefined（调用方按原逻辑走，不许抛）
    assert.equal(S.outerCarryHoldTile(creepAt(27, 8), container, null, () => false), undefined,
        "没有任何可站格时应返回 undefined");
}

// ── ② 调用点：待命判定必须在「走到容器」之前，且条件要求双方都没货 ────────
{
    const fn = code.slice(code.indexOf("Creep.prototype.harvestEnergyOuterCarry = function"));
    const body = fn.slice(0, fn.indexOf("\n};"));
    const holdIdx = body.indexOf("pro.outerCarryHoldOffRoad(this, sm, container)");
    const approachIdx = body.indexOf("if (!this.pos.isNearTo(container))");
    assert.ok(holdIdx > 0, "harvestEnergyOuterCarry 里必须调用 outerCarryHoldOffRoad");
    assert.ok(approachIdx > 0, "harvestEnergyOuterCarry 里应有走近容器的分支");
    assert.ok(holdIdx < approachIdx,
        "待命判定必须在「走近容器」之前 —— 否则车已经贴到卸货口了才退，堵还是堵");

    const guard = body.slice(Math.max(0, holdIdx - 260), holdIdx);
    assert.ok(/!\(container\.store\[RESOURCE_ENERGY\] > 0\)/.test(guard),
        "待命条件必须要求「容器里没货」（有货就该去装）");
    assert.ok(/!\(this\.store\[RESOURCE_ENERGY\] > 0\)/.test(guard),
        "待命条件必须要求「自己空手」（带半车货的不许退开）");
    assert.ok(/OUTER_CARRY_FILL_WAIT/.test(guard),
        "待命必须有时长上限（超时走原来的回程逻辑，不能变成永久驻留）");
    const holdBlock = body.slice(holdIdx - 260, holdIdx + 260);
    assert.ok(/this\.memory\.carryWait = \(this\.memory\.carryWait \|\| 0\) \+ 1/.test(holdBlock),
        "待命期间要累加 carryWait，否则上面那个上限永远到不了");
}

// ── ③ 负对照：把「容器有货」的守卫去掉，②的结构断言必须失败 ──────────────
{
    const broken = code.replace(/!\(container\.store\[RESOURCE_ENERGY\] > 0\)\s*&&\s*!\(this\.store\[RESOURCE_ENERGY\] > 0\)/,
        "true");
    const fn = broken.slice(broken.indexOf("Creep.prototype.harvestEnergyOuterCarry = function"));
    const body = fn.slice(0, fn.indexOf("\n};"));
    const holdIdx = body.indexOf("pro.outerCarryHoldOffRoad(this, sm, container)");
    const guard = body.slice(Math.max(0, holdIdx - 260), holdIdx);
    assert.ok(!/!\(container\.store\[RESOURCE_ENERGY\] > 0\)/.test(guard),
        "负对照没生效：改了守卫之后断言应该看不见那条条件");
}

// ── ④ 待命移动必须带 reusePath（静态目标，MEMORY 记的 10 倍 CPU 差）──────
{
    const tile = raw.slice(raw.indexOf("outerCarryHoldOffRoad(creep, data, container)"));
    const body = tile.slice(0, tile.indexOf("\n    },"));
    assert.ok(/moveTo\(new RoomPosition\([^)]*\), \{ reusePath: \d+ \}\)/.test(body),
        "待命移动的目标是静态格，必须传 reusePath");
    assert.ok(/memory\.holdPos/.test(body), "待命格要缓存，不能每 tick 重扫一片区域");
}

console.log("outer-carry-dock: OK");
