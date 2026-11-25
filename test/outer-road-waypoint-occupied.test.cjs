/**
 * 外矿缓存路的**路点被别的爬占住**时必须跳过（2026-11-25 shard2 E57S29 现场）。
 *
 * 现场：E57S29 两个矿点，容器就是路线起点 `path[0]`，而 keeper 的岗位
 * 恰恰是容器格（站桩挖矿）。满载车回程时停在容器**旁边**（range 1），
 * `pathIndex` 仍是 0 ⇒ 旧代码 `dist == 1` 既不前进也不跳过，每 tick
 * `moveTo(容器格)`：引擎「目标格被占」静默取消 ⇒ 返回 OK 但一格没走。
 * 实测 `outerRoadStuck` 一路涨到 19~24（(24,5)→(25,4) 与 (30,20)→(31,21)，
 * 两格都是 keeper 站着的容器），到 25 才靠「作废整条共享路线 + 原生 moveTo」
 * 脱身 —— 每趟回程白烧 ~25 tick，还把同矿点所有车共用的缓存路一起删掉。
 *
 * 断言全在行为上：同一组输入下「跳过被占路点、朝下一格走」vs「负对照仍然
 * 往被占格 moveTo 并且报成功」。
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
        CONTROLLER_STRUCTURES: { link: { 5: 3, 6: 4, 7: 8 } },
        HARVEST_POWER: 2, BUILD_POWER: 5,
    };
    ctx.global = ctx;
    vm.runInNewContext(ARRAY_PATCH, ctx);
    vm.runInNewContext(src === undefined ? raw : src, ctx);
    return ctx;
}

// 实测形态：容器 (25,4) 就是 path[0]，keeper 站桩；路线朝 +1 回主房。
const ROOM = "E57S29";
const ROAD = [[25, 4], [25, 5], [26, 6], [27, 7]];

function withRoad(ctx) {
    ctx.StationSources.getOuterRoadPath = () =>
        ROAD.map(([x, y]) => new ctx.RoomPosition(x, y, ROOM));
}

/** occupied: ["25:4"] 这类「格子被别的爬站着」的集合 */
function makeCreep(ctx, x, y, occupied) {
    const calls = [];
    const taken = new Set(occupied || []);
    const creep = {
        name: "carrier",
        pos: new ctx.RoomPosition(x, y, ROOM),
        room: {
            name: ROOM,
            lookForAt: (type, px, py) => {
                if (type !== "creeps") return [];
                return taken.has(px + ":" + py) ? [{ name: "keeper" }] : [];
            },
        },
        moveTo: (p) => { calls.push([p.x, p.y, p.roomName]); return ctx.OK; },
    };
    return { creep, calls };
}

// ── ① 站在容器旁边、容器格被 keeper 占着：必须跳过它，朝下一格走 ──────────────
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 24, 5, ["25:4"]);
    const task = { returnPathIndex: 0 };

    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, 1), true,
        "跳过被占路点后本 tick 仍然要沿路走（不能报失败让调用方 goTo）");
    assert.deepEqual(calls, [[25, 5, ROOM]],
        "必须朝 path[1] 走，而不是往 keeper 站着的容器格；实际 " + JSON.stringify(calls));
    assert.equal(task.returnPathIndex, 1, "跳过后必须把 index 记在下一格，否则下 tick 又从 0 重来");
}

// ── ② 负对照：去掉跳过逻辑，同一组输入必须复现「往被占格 moveTo 且报成功」─────
{
    const broken = raw.replace(
        /if \(here && near <= 1 && pro\.outerRoadPointOccupied\(creep, here\)\) \{[\s\S]*?\n        \}/,
        "");
    assert.notEqual(broken, raw, "负对照没生效：没改到占位跳过块");

    const ctx = makeContext(broken);
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 24, 5, ["25:4"]);
    const task = { returnPathIndex: 0 };

    const ret = S.moveOuterCarrierOnRoad(creep, task, {}, 1);
    assert.equal(ret, true, "负对照必须复现「报成功」—— 这正是现场每 tick 死循环的形态");
    assert.deepEqual(calls, [[25, 4, ROOM]],
        "负对照必须复现「往 keeper 站着的容器格走」（引擎会静默取消，车一格没动）");
}

// ── ③ 路点没人站着时行为不变：照旧朝该路点走 ─────────────────────────────────
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 24, 5, []);
    const task = { returnPathIndex: 0 };

    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, 1), true);
    assert.deepEqual(calls, [[25, 4, ROOM]], "没被占就不许跳格");
    assert.equal(task.returnPathIndex, 0);
}

// ── ④ 被占的正是路线端点（这侧没有下一格）：交回 goTo 兜底 ────────────────────
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 25, 5, ["25:4"]);
    const task = { returnPathIndex: 0 };

    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, -1), false,
        "端点被占且无下一格可跳时必须 return false，让调用方 goTo 兜底");
    assert.equal(calls.length, 0, "端点不许再朝被占格 moveTo");
}

// ── ⑤ 连跳上限：两格都占着时 maxSteps=1 不再硬跳，仍交回兜底 ─────────────────
{
    const ctx = makeContext();
    withRoad(ctx);
    const S = ctx.StationSources;
    const { creep, calls } = makeCreep(ctx, 24, 5, ["25:4", "25:5"]);
    const task = { returnPathIndex: 0 };

    assert.equal(S.moveOuterCarrierOnRoad(creep, task, {}, 1), false,
        "下一格也被占 ⇒ 本 tick 交回 goTo，不许原地空转");
    assert.equal(calls.length, 0);
}

// ── ⑥ 接线：路线维修爬（roadBuilder）那条分支也必须用同一套跳过 ───────────────
{
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(src.includes("pro.skipOccupiedRoadPoint(roadPath, pathIndex, roadDir, this, 3)"),
        "harvestEnergyOuterCarryRoadBuilder 的 pathIndex 推进必须也跳过被占路点"
        + "（否则同样的 25 tick 空转 + 作废共享路线会在它那条链上照旧发生）");
}

console.log("outer-road-waypoint-occupied: OK");
