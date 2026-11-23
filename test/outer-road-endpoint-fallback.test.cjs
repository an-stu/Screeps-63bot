/**
 * 外矿缓存路的**端点**必须交回 goTo 兜底（2026-11-24 shard2 E33S29 停产现场）。
 *
 * 现场：矿点容器 (35,23) 满 2,000、源满 3,000、地面 113 能量 1/tick 衰减，
 * 4 只空车 + 1 只 keeper 全钉在 `path[0]=(35,21)`（离卸货口还有 2 格），
 * 两只车每十几 tick 互换 (35,21)/(36,20)，所以连「不动」判据都看不见。
 *
 * 根因：缓存路的两端**工作格**是被 `spliceOuterRoadWorkTiles` 故意裁掉的
 * （源/容器周围要留给 keeper 站桩）⇒ `path[0]` 不等于容器格，最后一格靠调用方
 * `if (!moveOuterCarrierOnRoad(...)) goTo(容器)` 兜底。但车正好站在端点格时，
 * 旧代码把 index 夹到 `[0, len-1]` 就地 moveTo：point 就是自己脚下，里面
 * `range == 0` 直接 `return OK` ⇒ 本函数把「走成功」报给调用方 ⇒ 兜底永不触发
 * ⇒ 每 tick 都在端点「成功」一次，实际一格没走（与 0.78.224 的裸 move 同病：
 * 报成功但没动）。
 *
 * 断言全在行为上：同一组输入下「端点返回 false（兜底可触发）」vs「负对照返回
 * true 且一次 moveTo 都没调」。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");

const ARRAY_PATCH = `
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
Array.prototype.last = function () { return this.length ? this[this.length - 1] : undefined; };
Array.prototype.sum = function () { return this.reduce((a, b) => a + b, 0); };
`;

function makeContext(src) {
    const ctx = {
        console,
        isSaveCpu: true,
        Memory: { rooms: {} },
        Game: { time: 84445400, shard: { name: "shard2" }, getObjectById: () => null, map: {}, creeps: {}, rooms: {} },
        Room: { Terrain: function () { this.get = () => 0; } },
        RoomPosition: function (x, y, roomName) {
            this.x = x; this.y = y; this.roomName = roomName;
            this.isBorder = function () { return this.x == 0 || this.y == 0 || this.x == 49 || this.y == 49; };
            this.getRangeTo = function (a, b) {
                let ox = (a && a.x !== undefined) ? a.x : a;
                let oy = (a && a.y !== undefined) ? a.y : b;
                return Math.max(Math.abs(this.x - ox), Math.abs(this.y - oy));
            };
        },
        StationCarry: { stationName: "stationCarry" },
        StationMineral: { stationName: "stationMineral" },
        StationUpgrade: { stationName: "stationUpgrade" },
        _: { values: o => Object.keys(o || {}).map(k => o[k]), keys: o => Object.keys(o || {}) },
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
    vm.runInNewContext(ARRAY_PATCH, ctx);
    vm.runInNewContext(src === undefined ? raw : src, ctx);
    return ctx;
}

// 实测路点（E33S29 源 59f1a53a… 的 roadPathStr 前四点，容器在 (35,23) 不在路上）
const ROAD = [[35, 21], [36, 20], [37, 19], [38, 18]];

function makeCreep(ctx, x, y) {
    const calls = [];
    const creep = {
        pos: new ctx.RoomPosition(x, y, "E33S29"),
        moveTo: (p) => { calls.push([p.x, p.y, p.roomName]); return ctx.OK; },
    };
    return { creep, calls };
}

// 用实测路点替换共享路线缓存（getOuterRoadPath 只做「串→点数组」解码，解码另有测试）
function withRoad(ctx) {
    ctx.StationSources.getOuterRoadPath = () =>
        ROAD.map(([x, y]) => new ctx.RoomPosition(x, y, "E33S29"));
}

// ── ① 车正好站在 path[0]（矿区端）朝 -1 走：必须返回 false，交回 goTo 兜底 ─────
//    负对照：修复前这里返回 true 且 moveTo 一次都没调 ⇒ 调用方的
//    `if (!moveOuterCarrierOnRoad(...)) goTo(container)` 永不触发（现场形态）。
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep } = makeCreep(ctx, 35, 21);
    const task = { returnPathIndex: 0 };

    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, -1), false,
        "站在路线端点（容器还有 2 格）时必须返回 false，否则调用方不会 goTo 兜底");
}

// ── ② 负对照：把端点守卫退回去，同一组输入必须报「成功」但一格没走 ──────────
{
    const broken = raw.replace(
        /let next = index \+ \(direction == 1 \? 1 : -1\);\s*\n\s*if \(next < 0 \|\| next >= path\.length\) return false;\s*\n\s*index = next;/,
        "index += direction;");
    assert.notEqual(broken, raw, "负对照没生效：没改到端点守卫");

    const ctx = makeContext(broken);
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 35, 21);
    const task = { returnPathIndex: 0 };
    const ret = S.moveOuterCarrierOnRoad(creep, task, {}, -1);

    assert.equal(ret, true, "负对照必须复现「报成功」—— 这正是现场每 tick 死循环的形态");
    assert.equal(calls.length, 0, "负对照必须复现「报成功但一格没走」（moveTo 一次都不许调）");
}

// ── ③ 中段推进照旧（不许把整条缓存路废掉）──────────────────────────────────
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 36, 20);
    const task = { returnPathIndex: 1 };
    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, -1), true,
        "站在中段路点上朝 -1 推进必须照旧成功");
    assert.deepEqual(calls, [[35, 21, "E33S29"]], "必须往 path[0] 走一格，实际 " + JSON.stringify(calls));
}

// ── ④ 回程端（+1 走到 path[last]）同样交回 goTo，不许原地报成功 ──────────────
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 38, 18);
    const task = { returnPathIndex: 3 };
    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, 1), false,
        "回程走到路线最后一格时也必须返回 false（主房 storage 侧同样靠 goTo 兜底）");
    assert.equal(calls.length, 0, "端点不许调 moveTo 到脚下那格");
}

// ── ⑤ 端点守卫只挡端点：同一条路、站在端点上朝反方向（离开端点）仍然可行 ─────
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 35, 21);
    const task = { returnPathIndex: 0 };
    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, 1), true,
        "站在 path[0] 朝 +1（回主房/撤退）必须能沿路走，不能被端点守卫误伤");
    assert.deepEqual(calls, [[36, 20, "E33S29"]], "必须往 path[1] 走一格");
}

console.log("outer-road-endpoint-fallback: OK");
