/**
 * 矿点 link 认领的回归测试（2026-10-31 线上故障）。
 *
 * 故障现象：14 个房、28 个矿点的 `stationSources[*].link` 全部是 undefined，
 * 于是 keeper 既不往 link 塞能量、也不再从容器里掏，容器满 2000 后溢出到地面
 * 衰减（E55S39 两矿在地面压了 17.6k 且以 ~36/tick 继续增长）。
 *
 * 根因：`StationSources.update()` 里 link 的去重键写成了容器 id ——
 *   if (container) usedContainer[container.id] = true;            // 先占位
 *   links = room[STRUCTURE_LINK].filter(e =>
 *       container.pos.isNearTo(e) && !usedContainer[container.id]);  // 恒为假
 * 条件恒假 ⇒ links 永远是空数组 ⇒ link / link2 都被写成 undefined。
 *
 * 直接跑真实模块源码（VM + 桩），负对照很明确：把实现改回
 * `!usedContainer[container.id]`，第 1 段断言立刻失败。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "modules", name), "utf8");

const ARRAY_PATCH = `
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
Array.prototype.last = function () { return this.length ? this[this.length - 1] : undefined; };
Array.prototype.sum = function () { return this.reduce((a, b) => a + b, 0); };
`;

// lodash 的 Array 扩展：宿主 realm（测试里造的桩数组）和 VM realm（模块自己造的）
// 两边都要补 —— 桩里的 `room[STRUCTURE_CONTAINER].filter(...).head()` 走宿主 realm
const ARRAY_EXT = {
    head: function () { return this.length ? this[0] : undefined; },
    last: function () { return this.length ? this[this.length - 1] : undefined; },
    sum: function () { return this.reduce((a, b) => a + b, 0); },
};
for (const name in ARRAY_EXT) {
    if (!Array.prototype[name]) Object.defineProperty(Array.prototype, name, {
        value: ARRAY_EXT[name], enumerable: false, configurable: true, writable: true,
    });
}

const CONSTANTS = {
    OK: 0,
    RESOURCE_ENERGY: "energy",
    CARRY: "carry", MOVE: "move", WORK: "work",
    STRUCTURE_LINK: "link",
    STRUCTURE_CONTAINER: "container",
    LOOK_SOURCES: "source",
    LOOK_STRUCTURES: "structures",
    LOOK_CONSTRUCTION_SITES: "constructionSite",
    FIND_MY_CONSTRUCTION_SITES: 8,
};

function makeContext(extra = {}) {
    const ctx = Object.assign({
        console,
        isSaveCpu: true,
        Memory: { rooms: {} },
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null, creeps: {}, rooms: {} },
        Room: { Terrain: function () { this.get = () => 0; } },
        RoomPosition: function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
        StationCarry: { stationName: "stationCarry" },
        StationMineral: { stationName: "stationMineral" },
        StationUpgrade: { stationName: "stationUpgrade" },
        _: {
            values: obj => Object.keys(obj || {}).map(k => obj[k]),
            keys: obj => Object.keys(obj || {}),
        },
        StationSources: undefined,
        StationHive: { trySpawn: () => undefined },
        ManagerCreeps: { calcBodyPart: () => [] },
        ManagerFlags: { getFlagsByPrefix: () => [] },
        HelperError: { catchError: fn => fn() },
        UtilsTask: {
            task(obj, taskName, regFun, ops = {}) {
                const t = { taskName, id: obj && obj.id, roomName: obj && obj.pos && obj.pos.roomName, regFun };
                for (const k in ops) t[k] = ops[k];
                return t;
            },
            taskData(taskName) { return { taskName }; },
        },
        Creep: function () {},
    }, CONSTANTS, extra);
    ctx.global = ctx;
    vm.runInNewContext(ARRAY_PATCH, ctx);
    return ctx;
}

function pos(x, y, roomName = "W1N1") {
    return {
        x, y, roomName,
        isNearTo(o) {
            const t = o.pos || o;
            return Math.max(Math.abs(this.x - t.x), Math.abs(this.y - t.y)) <= 1;
        },
    };
}

/** 只够 update() 用的房间：2 个源、2 个贴源的容器、若干 link。 */
function makeRoom(linkLayout) {
    const room = { name: "W1N1", memory: {} };
    room[CONSTANTS.LOOK_SOURCES] = [
        { id: "srcA", pos: pos(10, 10), room: { name: "W1N1" } },
        { id: "srcB", pos: pos(40, 40), room: { name: "W1N1" } },
    ];
    room[CONSTANTS.STRUCTURE_CONTAINER] = [
        { id: "contA", pos: pos(11, 11) },
        { id: "contB", pos: pos(41, 41) },
    ];
    room[CONSTANTS.STRUCTURE_LINK] = linkLayout.map(([id, x, y]) => ({ id, pos: pos(x, y) }));
    return room;
}

/** 任意布局（用来复现线上特定房的几何）。 */
function makeRoomWith(sources, containers, links) {
    const room = { name: "W1N1", memory: {} };
    room[CONSTANTS.LOOK_SOURCES] = sources.map(([id, x, y]) => ({ id, pos: pos(x, y), room: { name: "W1N1" } }));
    room[CONSTANTS.STRUCTURE_CONTAINER] = containers.map(([id, x, y]) => ({ id, pos: pos(x, y) }));
    room[CONSTANTS.STRUCTURE_LINK] = links.map(([id, x, y]) => ({ id, pos: pos(x, y) }));
    return room;
}

// ─────────── 1) 每个矿点认领**贴着自己容器**的 link ───────────
{
    const ctx = makeContext();
    // 两个矿点各一个专用 link，外加一个远离矿区的中心 link（不该被认领）
    const room = makeRoom([["linkA", 12, 12], ["linkB", 42, 42], ["linkCenter", 25, 25]]);
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    assert.ok(S && typeof S.update === "function", "StationSources.update 必须存在");

    S.update(room);
    const mem = room.memory[S.stationName];
    assert.ok(mem && mem.srcA && mem.srcB, "两个矿点都要登记");

    assert.equal(mem.srcA.link, "linkA", "矿点 A 必须认领自己的 link（去重键写错时会变成 undefined）");
    assert.equal(mem.srcB.link, "linkB", "矿点 B 必须认领自己的 link");
    assert.equal(mem.srcA.link2, undefined, "只有一个贴着的 link 时 link2 应为空");
    assert.notEqual(mem.srcA.link, "linkCenter", "中心 link 不能被矿点抢走");

    // 幂等：update 每 tick 都会跑
    S.update(room);
    assert.equal(room.memory[S.stationName].srcA.link, "linkA", "update 必须幂等");
    assert.equal(room.memory[S.stationName].srcB.link, "linkB", "update 必须幂等");
}

// ─────────── 2) 双 link 矿点：link / link2 都要登记且不同 ───────────
{
    const ctx = makeContext();
    const room = makeRoom([["l1", 11, 12], ["l2", 12, 11], ["l3", 42, 42]]);
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    S.update(room);
    const a = room.memory[S.stationName].srcA;
    assert.ok(a.link && a.link2, "双 link 矿点必须同时登记 link 与 link2");
    assert.notEqual(a.link, a.link2, "link 与 link2 不能是同一个");
    assert.equal(room.memory[S.stationName].srcB.link, "l3", "另一个矿点仍要拿到自己的 link");
}

// ─────────── 3) 共用 link 簇：宁可共用，也不能有一个矿点拿不到 link ───────────
// 线上 E41S32 的真实几何：两个源只隔 2 格，容器 (20,26)/(20,27) 与
// link (21,26)/(21,27) 互相都在 1 格内。按「一个 link 只归一个矿点」去重
// 的话，后一个源会一只都拿不到（实测过）—— 而 link 能被共用正是因为
// 两个容器彼此相邻，这时候共用本来就是对的。
{
    const ctx = makeContext();
    const room = makeRoomWith(
        [["srcA", 19, 26], ["srcB", 19, 28]],
        [["contA", 20, 26], ["contB", 20, 27]],
        [["lk1", 21, 26], ["lk2", 21, 27]]);
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    S.update(room);
    const mem = room.memory[S.stationName];
    assert.ok(mem.srcA.link, "相邻矿点 A 必须拿到 link");
    assert.ok(mem.srcB.link, "相邻矿点 B 也必须拿到 link（独占去重会让它变 undefined）");
    assert.equal(mem.srcA.link, "lk1");
    assert.equal(mem.srcA.link2, "lk2", "A 的容器贴着两个 link，两个都要登记");
}

// ─────────── 4) 没有容器时不能崩，也不能凭空造 link ───────────
{
    const ctx = makeContext();
    const room = makeRoom([["linkA", 12, 12]]);
    room[CONSTANTS.STRUCTURE_CONTAINER] = [];
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    S.update(room);
    const mem = room.memory[S.stationName];
    assert.equal(mem.srcA.container, undefined, "没有容器就登记 undefined，不能瞎猜");
    assert.equal(mem.srcA.link, undefined, "没有容器就不认领 link");
}

console.log("station-sources-link.test.cjs: passed");
