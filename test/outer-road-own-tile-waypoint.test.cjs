/**
 * 外矿缓存路上**不许把「自己脚下」当路点**（2026-11-25 shard2 E57S29 现场）。
 *
 * 现场：E57S29 一格宽的缓存路上 6 只车反向对撞（3 满载回程 + 3 空车进矿），
 * (2,10)/(3,10) 两只每十几 tick 互换位置，两个容器双双顶满 2,000，
 * 矿点吞吐归零 100+ tick，`outerRoadStuck` 恒为 0（脱困闸门一次都没响）。
 *
 * 逐 tick 抓到的关键事实：满载车 (2,10) 连续 13+ tick
 * `outerRoadMoveTarget == "…:2:10"`，也就是**它脚下的那一格**。
 * `moveToOuterRoadPoint` 见到 `range == 0` 直接 `return OK` —— 那是「到达终点」的
 * 语义。于是这一 tick 一次 `creep.moveTo` 都没发。
 *
 * 怎么产生的（代码路径）：`dist == 0` 分支做 `pathIndex += roadDir` 前进一格，若
 * 这一格已经在路线端点之外，下一行的 `Math.min(index, len-1)` 又把它**夹回端点**
 * ——而终点格正是自己脚下。于是「前进」被无意义地撤销，`moveToOuterRoadPoint`
 * 拿到自己的坐标、返回 OK，车不动、计数不涨、对向的爬配不上对。
 *
 * 为什么这就是死锁：对穿 / 让路 / 绕一格**全靠 moveTo 触发**（BetterMove 的交通
 * 逻辑挂在 moveTo 上）。不发 moveTo 的爬等于从交通系统里消失。
 *
 * 修法：沿路行进时若算出的路点正是自己脚下 ⇒ 沿路线再推一格；已经到端点 ⇒
 * 交回任务目标的原生寻路（与 `moveOuterCarrierOnRoad` 的「走到路线尽头」同一
 * 条兜底）。两种情形都保证「这一 tick 一定发出一次移动」。
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

// 实测形态：E57S29 的 (5,10)→(4,10)→(3,10)→(2,10)→(1,10) 一段回程路
const ROOM = "E57S29";
const ROAD = [[5, 10], [4, 10], [3, 10], [2, 10], [1, 10]];

function withRoad(ctx) {
    ctx.StationSources.getOuterRoadPath = () =>
        ROAD.map(([x, y]) => new ctx.RoomPosition(x, y, ROOM));
}

/** 造一只「沿缓存路走、身上有货」的 roadBuilder 爬，站在 route 的第 index 个路点上 */
function makeBuilder(ctx, routeIndex, roadDir) {
    const [x, y] = ROAD[routeIndex];
    const calls = [];
    const creep = Object.assign(new ctx.Creep(), {
        name: "shard2_78372764_1",
        memory: {
            roomName: ROOM,
            tasks: [{
                taskName: "harvestEnergyOuterCarryRoadBuilder", mineRoom: ROOM,
                stationId: "src", roadDir: roadDir, pathIndex: routeIndex,
            }],
        },
        store: { energy: 600, getUsedCapacity: () => 600, getFreeCapacity: () => 0 },
        pos: new ctx.RoomPosition(x, y, ROOM),
        room: { name: ROOM, lookForAt: () => [], lookFor: () => [] },
        // 记录形态：原生坐标 vs 任务对象（`moveTo(target)` 收的是对象）
        moveTo: (p) => { calls.push(p && p.pos ? "task-target" : [p.x, p.y, p.roomName]); return ctx.OK; },
        build: () => ctx.OK, repair: () => ctx.OK,
        $repair: () => ctx.OK, $build: () => ctx.OK,
        transfer: () => ctx.OK,
        popTask: () => { creep.memory.tasks.pop(); },
        addTask: () => {},
        execLastTask: () => {},
        say: () => {},
        getPartCnt: () => 0,          // 纯 CARRY/MOVE：不进铺路分支
        getActiveBodyparts: () => 0,
        mainRoom: () => ({ storage: null, name: ROOM }),
        // 任务端点远在天边 ⇒ 不会误进「已到端点」分支
        lastTaskObj: () => ({ id: "store", store: {}, pos: new ctx.RoomPosition(40, 40, ROOM) }),
    });
    creep.pos.isNearTo = () => false;
    creep.lastTask = () => creep.memory.tasks[creep.memory.tasks.length - 1];
    creep.headTask = creep.lastTask;
    ctx.Memory.rooms[ROOM] = { stationSources: { src: { id: "src", roomName: ROOM } } };
    ctx.Game.creeps = { [creep.name]: creep };
    return { creep, calls };
}

// ── ① 路点被夹回端点 = 自己脚下：必须交回任务目标，不许静默 return OK ─────────
// 回程方向 roadDir=+1；站在最后一个路点上 ⇒ `+= 1` 越界、`min(len-1)` 又夹回自己。
{
    const ctx = makeContext();
    withRoad(ctx);
    const { creep, calls } = makeBuilder(ctx, ROAD.length - 1, 1);

    creep.harvestEnergyOuterCarryRoadBuilder();

    assert.deepEqual(calls, ["task-target"],
        "走到路线端点、又还离任务目标很远时必须 moveTo(target)；"
        + "旧代码在这里拿到自己的坐标、`return OK`，一 tick 一格都没走。实际 "
        + JSON.stringify(calls));
}

// ── ② 负对照：拆掉「自己脚下」这段 ⇒ 同一组输入一次 moveTo 都不发（现场形态）──
{
    const broken = raw.replace(
        /if \(wp\.roomName == this\.pos\.roomName && wp\.x == this\.pos\.x && wp\.y == this\.pos\.y\) \{/,
        "if (false) {");
    assert.ok(broken !== raw, "负对照没生效：没改到「自己脚下」推进块");

    const ctx = makeContext(broken);
    withRoad(ctx);
    const { creep, calls } = makeBuilder(ctx, ROAD.length - 1, 1);
    creep.harvestEnergyOuterCarryRoadBuilder();

    assert.deepEqual(calls, [],
        "负对照必须复现「一次 moveTo 都不发」—— 这正是 (2,10) 那辆车原地钉死、"
        + "`outerRoadStuck` 停在 0 的形态；实际 " + JSON.stringify(calls));
}

// ── ③ 反向（进矿）走同一条路：roadDir=-1 撞端点时同样必须发出移动 ─────────────
{
    const ctx = makeContext();
    withRoad(ctx);
    const { creep, calls } = makeBuilder(ctx, 0, -1);

    creep.harvestEnergyOuterCarryRoadBuilder();

    assert.deepEqual(calls, ["task-target"],
        "roadDir=-1 站在 path[0] 上时同样被夹回自己脚下，必须交回 moveTo(target)；实际 "
        + JSON.stringify(calls));
}

console.log("outer-road-own-tile-waypoint: OK");
