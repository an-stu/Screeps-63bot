/**
 * keeper 工地 tile 索引（qoder.md v2 第一批 item 5，单独提交）的排序一致性回归。
 *
 * 索引必须与旧实现 `sites.find(e => e.pos.isNearTo(this))` 完全同果：
 *   ① 多个邻接工地 → 取列表序号最早者（不是最近者）
 *   ② 同格多个工地 → 同样取最早序号
 *   ③ 房间边缘（0/49）不得越界、不得漏掉贴边邻格
 *   ④ 下一 tick 新增工地立即可见（索引按 tick 重建）
 *   ⑤ 已缓存 keeperCsId 失效 → 按原节奏重扫并回退维修
 * 另锁：同房同 tick 多 keeper 共享一次工地表读取；keeperCsId 值变才写。
 * 负对照：把查表改回 .find，扫描计数与源码锁定必须 fail。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sourceCode = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

// ── 源码锁定（负对照）──────────────────────────────────────────────────────
assert.ok(sourceCode.includes("function getKeeperSiteTileIndex(room)"), "必须有 tile 索引构建函数");
assert.ok(sourceCode.includes("function keeperNearestSite(room, pos)"), "必须有 O(9) 查表函数");
assert.ok(sourceCode.includes("let cs = keeperNearestSite(this.room, this.pos);"),
    "keeper 维护块必须走查表（负对照：改回 .find 即 fail）");
assert.ok(!sourceCode.includes("sites.find(e => e.pos.isNearTo(this))"),
    "不得再对全房工地逐 tick .find(isNearTo)");
assert.ok(sourceCode.includes("if (this.memory.keeperCsId != csId) this.memory.keeperCsId = csId;"),
    "keeperCsId 必须值变才写");
assert.ok(sourceCode.includes("if (this.ticksToLive % 9 == 0 || !this.memory.keeperCsId)"),
    "9 tick 重扫节奏必须保留");

// ── 提取索引实现，与 .find 参照做随机差分 ──────────────────────────────────
const blockMatch = sourceCode.match(/let keeperEmptyConstructionRoomsTick[\s\S]*?function keeperNearestSite\(room, pos\) \{[\s\S]*?\n\}/);
assert.ok(blockMatch, "必须能提取工地缓存 + 索引实现块");

function loadIndex() {
    const ctx = { Game: { time: 1000 }, console };
    vm.runInNewContext(blockMatch[0], ctx, { filename: "keeper-site-index.js" });
    return ctx;
}
function makeRoom(ctx, sites) {
    const reads = { count: 0 };
    return {
        reads,
        room: {
            name: "W1N1",
            get constructionSite() { reads.count++; return sites; },
        },
    };
}
function pos(x, y) { return { x, y, roomName: "W1N1" }; }
// 旧实现的判定参照：列表顺序第一个 Chebyshev≤1 的同房工地
function referenceFind(sites, p) {
    return sites.find(s => s.pos.roomName == p.roomName
        && Math.max(Math.abs(s.pos.x - p.x), Math.abs(s.pos.y - p.y)) <= 1);
}
// 可复现伪随机
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

{
    const ctx = loadIndex();
    const rnd = mulberry32(20261111);
    for (let iter = 0; iter < 500; iter++) {
        const n = Math.floor(rnd() * 16);
        const sites = [];
        for (let i = 0; i < n; i++) {
            // 故意制造同格重复与贴边坐标
            const x = rnd() < 0.25 ? (rnd() < 0.5 ? 0 : 49) : Math.floor(rnd() * 50);
            const y = rnd() < 0.25 ? (rnd() < 0.5 ? 0 : 49) : Math.floor(rnd() * 50);
            sites.push({ id: "s" + iter + "_" + i, pos: pos(x, y) });
        }
        const { room } = makeRoom(ctx, sites);
        const keepers = [];
        const k = 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < k; j++) {
            const x = rnd() < 0.3 ? (rnd() < 0.5 ? 0 : 49) : Math.floor(rnd() * 50);
            const y = rnd() < 0.3 ? (rnd() < 0.5 ? 0 : 49) : Math.floor(rnd() * 50);
            keepers.push(pos(x, y));
        }
        for (const p of keepers) {
            const got = ctx.keeperNearestSite(room, p);
            const want = referenceFind(sites, p);
            assert.equal(got, want,
                "iter " + iter + " keeper(" + p.x + "," + p.y + ") 查表必须与 .find 同果");
        }
        // 下一 tick：索引必须重建（换一批工地）
        ctx.Game.time++;
        const sites2 = sites.slice(0, Math.max(0, n - 1)).concat([{ id: "new" + iter, pos: pos(25, 25) }]);
        const r2 = makeRoom(ctx, sites2);
        for (const p of keepers) {
            assert.equal(ctx.keeperNearestSite(r2.room, p), referenceFind(sites2, p),
                "iter " + iter + " 下一 tick 必须按新工地表重建索引");
        }
        ctx.Game.time++;
    }
}

// ── 显式排序用例：最早序号优先，与距离无关 ─────────────────────────────────
{
    const ctx = loadIndex();
    const far = { id: "far", pos: pos(30, 30) };
    const nearLate = { id: "nearLate", pos: pos(10, 11) };
    const nearEarly = { id: "nearEarly", pos: pos(11, 10) };
    const { room } = makeRoom(ctx, [far, nearLate, nearEarly]);
    assert.equal(ctx.keeperNearestSite(room, pos(10, 10)), nearLate,
        "两个邻接工地必须取列表序号最早者（nearLate 在 nearEarly 之前）");

    // 同格多工地：取最早序号（推进 tick：索引按 房名+tick 缓存，
    // 生产环境同一 tick 一个房名只有一个 Room 对象）
    ctx.Game.time++;
    const sameA = { id: "sameA", pos: pos(11, 10) };
    const sameB = { id: "sameB", pos: pos(11, 10) };
    const r2 = makeRoom(ctx, [far, sameB, sameA]);
    assert.equal(ctx.keeperNearestSite(r2.room, pos(10, 10)), sameB, "同格工地取列表最早序号");

    // 边缘：keeper(0,0)，三个贴边邻格 + 一个远端
    ctx.Game.time++;
    const e1 = { id: "e1", pos: pos(0, 1) };
    const e2 = { id: "e2", pos: pos(1, 0) };
    const e3 = { id: "e3", pos: pos(1, 1) };
    const corner = { id: "corner", pos: pos(49, 49) };
    const r3 = makeRoom(ctx, [corner, e3, e1, e2]);
    assert.equal(ctx.keeperNearestSite(r3.room, pos(0, 0)), e3, "角落 keeper 取最早序号的贴边邻格");
    assert.equal(ctx.keeperNearestSite(r3.room, pos(49, 49)), corner, "对角 keeper 命中自己的邻格");
    assert.equal(ctx.keeperNearestSite(r3.room, pos(25, 25)), undefined, "无邻接工地 → undefined");

    // 空表：undefined，且同 tick 共享负缓存
    ctx.Game.time++;
    const r4 = makeRoom(ctx, []);
    assert.equal(ctx.keeperNearestSite(r4.room, pos(10, 10)), undefined);
    assert.equal(ctx.keeperNearestSite(r4.room, pos(11, 11)), undefined);
    assert.equal(r4.reads.count, 1, "空房同 tick 只读一次工地表");
}

// ── 扫描计数：多 keeper 共享索引，不再逐爬 .find ───────────────────────────
{
    const ctx = loadIndex();
    let isNearToCalls = 0;
    const sites = [];
    for (let i = 0; i < 12; i++) {
        sites.push({
            id: "s" + i,
            pos: {
                x: 30 + (i % 4), y: 30 + Math.floor(i / 4), roomName: "W1N1",
                isNearTo() { isNearToCalls++; return false; },
            },
        });
    }
    const { room, reads } = makeRoom(ctx, sites);
    for (let k = 0; k < 5; k++) {
        assert.equal(ctx.keeperNearestSite(room, pos(10 + k, 10)), undefined);
    }
    assert.equal(reads.count, 1, "5 只 keeper 同 tick 必须共享一次工地表读取（负对照核心：旧实现读 5 次）");
    assert.equal(isNearToCalls, 0, "查表路径不得调用 isNearTo（旧实现 5×12 次）");
}

// ── 端到端：整模块 VM 跑 harvestEnergyKeeper ───────────────────────────────
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}
function makeContext() {
    const objects = Object.create(null);
    const ctx = {
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_NO_PATH: -2, ERR_NO_BODYPART: -12,
        MOVE: "move", WORK: "work", CARRY: "carry", ATTACK: "attack", HEAL: "heal",
        TOUGH: "tough", RANGED_ATTACK: "ranged_attack", CLAIM: "claim",
        LOOK_CREEPS: "creeps", LOOK_POWER_CREEPS: "powerCreeps", LOOK_ENERGY: "energy",
        LOOK_TOMBSTONES: "tombstones", RESOURCE_ENERGY: "energy", RESOURCE_OPS: "ops",
        RESOURCE_POWER: "power", STRUCTURE_KEEPER_LAIR: "keeperLair",
        STRUCTURE_INVADER_CORE: "invaderCore", STRUCTURE_RAMPART: "rampart",
        STRUCTURE_CONTAINER: "container", STRUCTURE_EXTENSION: "extension",
        STRUCTURE_SPAWN: "spawn", STRUCTURE_TOWER: "tower", STRUCTURE_STORAGE: "storage",
        STRUCTURE_TERMINAL: "terminal", STRUCTURE_LINK: "link", STRUCTURE_LAB: "lab",
        STRUCTURE_FACTORY: "factory", STRUCTURE_EXTRACTOR: "extractor",
        STRUCTURE_POWER_BANK: "powerBank", STRUCTURE_POWER_SPAWN: "powerSpawn",
        FIND_HOSTILE_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_STRUCTURES: 103,
        FIND_SOURCES: 104, FIND_MY_STRUCTURES: 105, FIND_SOURCES_ACTIVE: 106,
        FIND_DROPPED_RESOURCES: 107, FIND_TOMBSTONES: 108, FIND_DEPOSITS: 109,
        FIND_STRUCTURES: 110, FIND_CONSTRUCTION_SITES: 111, FIND_MINERALS: 112,
        PWR_REGEN_SOURCE: 13,
        console: { log() {} }, isSaveCpu: false, MIN_CPU: false,
        Memory: { rooms: {} },
        Game: {
            time: 1000, cpu: { bucket: 10000 }, shard: { name: "shard3" }, creeps: {},
            getObjectById(id) { return objects[id] || null; },
            map: { getRoomLinearDistance: () => 1 },
        },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => undefined },
        UtilsTask: {
            task: (t, taskName) => ({ id: t && t.id, taskName }),
            taskData: taskName => ({ taskName }),
            taskOutView: (id, roomName, x, y, taskName) => ({ id, roomName, x, y, taskName }),
        },
        PathFinder: { search: () => ({ path: [] }) },
        _: { values: o => Object.keys(o || {}).map(k => o[k]), keys: o => Object.keys(o || {}) },
    };
    ctx.global = ctx;
    vm.runInNewContext(sourceCode, ctx, { filename: "station_sources.js" });
    return { ctx, objects };
}
function makePos(x, y) {
    return {
        x, y, roomName: "W1N1",
        isEqualTo(other) { other = other.pos || other; return this.x === other.x && this.y === other.y && this.roomName === other.roomName; },
        isNearTo(other) {
            other = other.pos || other;
            return this.roomName === other.roomName
                && Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)) <= 1;
        },
        lookFor() { return []; },
    };
}
function makeFixture({ sites = [], ttl = 90, containerHits = 1000, x = 10, y = 10 } = {}) {
    const { ctx, objects } = makeContext();
    let reads = 0;
    const room = { name: "W1N1", get constructionSite() { reads++; return sites; } };
    const actions = [];
    const container = {
        id: "container", pos: makePos(10, 10), hits: containerHits, hitsMax: 1000,
        store: { energy: 0, getUsedCapacity: () => 0, getFreeCapacity: () => 2000 },
    };
    const source = { id: "src", pos: makePos(11, 10), energy: 3000, energyCapacity: 3000, ticksToRegeneration: 300 };
    const link = { id: "link", hits: 1000, hitsMax: 1000, store: { energy: 800, getUsedCapacity: () => 800 } };
    objects.src = source; objects.container = container; objects.link = link;
    for (const s of sites) objects[s.id] = s;
    ctx.Memory.rooms.W1N1 = { stationSources: { src: { container: "container", link: "link" } } };
    let csWrites = 0;
    const memory = {};
    let csValue;
    Object.defineProperty(memory, "keeperCsId", {
        get() { return csValue; },
        set(v) { csWrites++; csValue = v; },
        configurable: true,
    });
    const creep = {
        room, pos: makePos(x, y), ticksToLive: ttl, memory,
        store: { energy: 100, getFreeCapacity: () => 0 },
        headTask: () => ({ id: "src", roomName: "W1N1" }),
        moveTo(t, o) { actions.push(["moveTo", t.id, o && o.range]); },
        harvest(t) { actions.push(["harvest", t.id]); },
        build(t) { actions.push(["build", t.id]); },
        repair(t) { actions.push(["repair", t.id]); },
        transfer(t, r) { actions.push(["transfer", t.id, r]); },
        withdraw(t, r) { actions.push(["withdraw", t.id, r]); },
        pickup(t) { actions.push(["pickup", t.id]); },
        getPartCnt(type) { return type === "work" ? 2 : 1; },
    };
    return {
        ctx, creep, actions, objects, memory,
        get reads() { return reads; },
        get csWrites() { return csWrites; },
        setSites(next) { sites = next; for (const s of next) objects[s.id] = s; },
        run() { ctx.Creep.prototype.harvestEnergyKeeper.call(creep); },
    };
}

// 端到端 ①：两个邻接工地，build 必须打列表最早者（与距离无关）
{
    const nearLate = { id: "nearLate", pos: makePos(10, 11) };
    const nearEarly = { id: "nearEarly", pos: makePos(11, 10) };
    const f = makeFixture({ sites: [{ id: "far", pos: makePos(30, 30) }, nearLate, nearEarly] });
    f.run();
    assert.ok(f.actions.some(a => a[0] === "build" && a[1] === "nearLate"),
        "端到端：多个邻接工地必须 build 列表最早者");
    assert.ok(!f.actions.some(a => a[0] === "repair"), "build 优先于维修（锁定不变）");
}
// 端到端 ②：同格多工地取最早序号
{
    const sameA = { id: "sameA", pos: makePos(11, 10) };
    const sameB = { id: "sameB", pos: makePos(11, 10) };
    const f = makeFixture({ sites: [sameB, sameA] });
    f.run();
    assert.ok(f.actions.some(a => a[0] === "build" && a[1] === "sameB"), "同格工地 build 最早序号");
}
// 端到端 ③：keeperCsId 值变才写（连续两个重扫 tick 结果相同 → 只写一次）
{
    const site = { id: "site-x", pos: makePos(11, 10) };
    const f = makeFixture({ sites: [site], ttl: 90 });
    f.run();
    assert.equal(f.memory.keeperCsId, "site-x");
    assert.equal(f.csWrites, 1);
    f.ctx.Game.time++;
    f.creep.ticksToLive = 99; // 99 % 9 == 0 → 再次重扫，结果不变
    f.run();
    assert.equal(f.csWrites, 1, "结果不变不得重复写 Memory（负对照：去掉守卫即 fail）");
    f.ctx.Game.time++;
    f.creep.ticksToLive = 100; // 100 % 9 != 0 且有缓存 → 不重扫
    const readsBefore = f.reads;
    f.run();
    assert.equal(f.reads, readsBefore, "有缓存且非重扫 tick 不得再读工地表");
}
// 端到端 ④：缓存 ID 失效 → 回退维修；到重扫 tick 清掉失效 ID
{
    const f = makeFixture({ sites: [], ttl: 100, containerHits: 500 });
    f.memory.keeperCsId = "gone"; // 工地已消失（objects 里没有）
    f.run();
    assert.ok(f.actions.some(a => a[0] === "repair" && a[1] === "container"),
        "失效工地 ID 必须回退修容器");
    f.ctx.Game.time++;
    f.creep.ticksToLive = 108; // 108 % 9 == 0 → 重扫
    f.run();
    assert.equal(f.memory.keeperCsId, undefined, "重扫无果必须清掉失效 ID");
}
// 端到端 ⑤：下一 tick 新增工地立即可见（索引不得跨 tick 复用）
{
    const f = makeFixture({ sites: [], ttl: 90 });
    f.run();
    assert.ok(!f.actions.some(a => a[0] === "build"));
    f.ctx.Game.time++;
    f.creep.ticksToLive = 99;
    f.setSites([{ id: "site-new", pos: makePos(11, 10) }]);
    f.run();
    assert.ok(f.actions.some(a => a[0] === "build" && a[1] === "site-new"),
        "下一 tick 新增工地必须立即被发现");
}
// 端到端 ⑥：同房同 tick 两只 keeper 共享一次工地表读取
{
    const f = makeFixture({ sites: [{ id: "far", pos: makePos(30, 30) }], ttl: 90 });
    f.run();
    const second = { ...f.creep, memory: {}, ticksToLive: 99, pos: makePos(10, 10) };
    f.ctx.Creep.prototype.harvestEnergyKeeper.call(second);
    assert.equal(f.reads, 1, "两只 keeper 同 tick 共享索引，只读一次工地表（负对照核心）");
}
// 端到端 ⑦：边缘 keeper（0,0）贴边工地可建
{
    const site = { id: "edge-site", pos: makePos(0, 1) };
    const f = makeFixture({ sites: [site], ttl: 90, x: 0, y: 0 });
    // 让 keeper 直接处于源邻格：source 在 (1,0)
    f.objects.src.pos = makePos(1, 0);
    f.objects.container.pos = makePos(0, 0);
    f.run();
    assert.ok(f.actions.some(a => a[0] === "build" && a[1] === "edge-site"),
        "房间角落的 keeper 必须能命中贴边邻格工地");
}

console.log("keeper site tile-index consistency checks passed");