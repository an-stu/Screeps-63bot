/**
 * 外矿卡住计数不能自锁（2026-11-08 W26N59 重启现场）。
 *
 * 现场：唯一的外矿搬运爬 shard3_84131356_1 在 W26N58(13,0) / W26N59(13,49)
 * 边境来回弹跳约 450 tick，`task.outerRoadStuck` 一路涨到 **197**。
 * 越过 OUTER_ROAD_STUCK_INVALIDATE(25) 之后每次调用都在第一道闸直接
 * `return ERR_NO_PATH` ⇒ 调用方（moveOuterCarrierOnRoad）每 tick 判「路线
 * 不可达」并 `invalidateOuterRoadPath`，车永久退化成原生 goTo，再也走不回
 * 缓存路线；计数又永远不归零 ⇒ **自锁**（本仓库 MEMORY 第 3 条）。
 *
 * 两处根因、两处修复：
 *   ① 计数只比「同一格 + 同一路点」，隔拍调用（车中途真的挪过）照样累加
 *      ⇒ 加 `outerRoadStuckTick === Game.time - 1`：只统计**连续 tick**。
 *   ② 越过 INVALIDATE 后计数器不归零 ⇒ 判过之后必须清零，下一轮重新数。
 *
 * 断言全部落在**行为**上（同一组调用序列得到不同返回值），负对照是
 * 「把修复退回去」的源码变体，它必须真的锁死。
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
Array.prototype.maxBy = function (fn) {
    let best, bestV;
    this.forEach(x => { let v = fn(x); if (best === undefined || v > bestV) { best = x; bestV = v; } });
    return best;
};
Array.prototype.sum = function () { return this.reduce((a, b) => a + b, 0); };
`;

function makeContext(src) {
    const ctx = {
        console,
        isSaveCpu: true,
        Memory: { rooms: {} },
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null, map: {}, creeps: {}, rooms: {} },
        Room: { Terrain: function () { this.get = () => 0; } },
        RoomPosition: function (x, y, roomName) {
            this.x = x; this.y = y; this.roomName = roomName;
            this.isBorder = function () {
                return this.x == 0 || this.y == 0 || this.x == 49 || this.y == 49;
            };
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

// 一只停在边境格、朝同一条缓存路点走的搬运爬（moveTo 恒定成功）
function makeCreep(ctx, x, y, roomName) {
    return {
        pos: new ctx.RoomPosition(x, y, roomName),
        moveTo: () => ctx.OK,
    };
}

const EST = -2; // ERR_NO_PATH

// ── ① 连续 tick 卡在同一格同一路点：照旧累加、到 FALLBACK 走 moveTo ────────
{
    const ctx = makeContext();
    const S = ctx.StationSources;
    assert.equal(typeof S.moveToOuterRoadPoint, "function", "moveToOuterRoadPoint 必须挂在 StationSources 上");

    const creep = makeCreep(ctx, 13, 0, "W26N58");
    const task = {};
    const point = new ctx.RoomPosition(13, 49, "W26N59");
    ctx.Game.time = 5000;

    let codes = [];
    for (let i = 0; i < 5; i++) {
        ctx.Game.time = 5000 + i;
        codes.push(S.moveToOuterRoadPoint(creep, task, point));
    }
    // 第一次调用只是建立 (位置, 路点) 基准，从第二次起才累加 ⇒ 5 次 = 4
    assert.equal(task.outerRoadStuck, 4, "连续 5 tick 卡住 ⇒ 计数必须是 4，实际 " + task.outerRoadStuck);
    assert.deepEqual(codes, [ctx.OK, ctx.OK, ctx.OK, ctx.OK, ctx.OK],
        "未到 INVALIDATE 之前都必须继续尝试移动（走 moveTo），实际 " + JSON.stringify(codes));
}

// ── ② 隔拍调用（车中途真的挪过）：计数必须重置，绝不累加到 INVALIDATE ──────
// 这正是现场形态：边境两格来回弹跳，隔一拍才回到同一格 + 同一路点。
{
    const ctx = makeContext();
    const S = ctx.StationSources;
    const creep = makeCreep(ctx, 13, 0, "W26N58");
    const task = {};
    const point = new ctx.RoomPosition(13, 49, "W26N59");

    let codes = [];
    let maxStuck = 0;
    for (let i = 0; i < 60; i++) {
        ctx.Game.time = 7000 + i * 2; // 每两次调用之间车已经离开该格（隔拍）
        codes.push(S.moveToOuterRoadPoint(creep, task, point));
        maxStuck = Math.max(maxStuck, task.outerRoadStuck || 0);
    }
    assert.ok(!codes.includes(EST),
        "隔拍不能判「路线不可达」—— 车明明在动，卡住计数必须重置（现场就死在这）");
    assert.equal(maxStuck, 0,
        "隔拍调用下计数必须一直是 0（每次都是「中断过」，不许累积），实际最大 " + maxStuck);
}

// ── ③ 真卡死到 INVALIDATE：判一次 ERR_NO_PATH，之后必须能重新开始 ─────────
{
    const ctx = makeContext();
    const S = ctx.StationSources;
    const creep = makeCreep(ctx, 13, 0, "W26N58");
    const task = {};
    const point = new ctx.RoomPosition(13, 49, "W26N59");

    let sawNoPath = false;
    for (let i = 0; i < 40; i++) {
        ctx.Game.time = 9000 + i;
        if (S.moveToOuterRoadPoint(creep, task, point) === EST) sawNoPath = true;
    }
    assert.ok(sawNoPath, "连续卡满 INVALIDATE 应该判一次 ERR_NO_PATH（否则路线永不重算）");
    assert.ok(task.outerRoadStuck < 25,
        "判过 ERR_NO_PATH 之后计数器必须归零，不能带着 ≥ 阈值进入下一次调用（自锁），实际 "
        + task.outerRoadStuck);

    // 归零之后必须**重新开口**：下一轮的连续调用不能一上来就 ERR_NO_PATH
    const after = [];
    for (let i = 0; i < 5; i++) {
        ctx.Game.time = 9100 + i;
        after.push(S.moveToOuterRoadPoint(creep, task, point));
    }
    assert.deepEqual(after, [ctx.OK, ctx.OK, ctx.OK, ctx.OK, ctx.OK],
        "判过不可达之后必须能重新尝试（否则这只爬永久不走缓存路线），实际 " + JSON.stringify(after));
}

// ── ④ 负对照：把两处修复退回去，② 的序列必须真的锁死 ──────────────────────
{
    const broken = raw
        .replace("\n            && task.outerRoadStuckTick === Game.time - 1) {", ") {")
        .replace(/\r?\n            task\.outerRoadStuck = 0;(\r?\n            return ERR_NO_PATH;)/, "$1");
    assert.notEqual(broken, raw, "负对照没生效：没改到计数条件");
    assert.ok(broken.indexOf("outerRoadStuckTick === Game.time - 1") < 0, "负对照没生效：连续 tick 守卫还在");
    assert.ok(!/task\.outerRoadStuck = 0;\s*\n\s*return ERR_NO_PATH;/.test(broken),
        "负对照没生效：INVALIDATE 之后的归零还在");

    const ctx = makeContext(broken);
    const S = ctx.StationSources;
    const creep = makeCreep(ctx, 13, 0, "W26N58");
    const task = {};
    const point = new ctx.RoomPosition(13, 49, "W26N59");

    let codes = [];
    for (let i = 0; i < 60; i++) {
        ctx.Game.time = 7000 + i * 2;
        codes.push(S.moveToOuterRoadPoint(creep, task, point));
    }
    assert.ok(codes.includes(EST),
        "负对照必须锁死：拆掉修复后，隔拍调用也会累加到 INVALIDATE 并永久返回 ERR_NO_PATH");
    assert.equal(codes[codes.length - 1], EST,
        "负对照的最后一次调用必须仍然是 ERR_NO_PATH（永久锁死，这正是现场 197 的形态）");
}

console.log("outer-road-stuck-latch: OK");
