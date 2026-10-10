/**
 * 主房边缘 link（外矿卸货口）+ 外矿搬运/修路爬体型 + 防守满员闸的回归测试。
 *
 * 三块都用 VM 跑**真实模块源码**（桩掉 Game / Memory / Creep / Room），
 * 而不是断言源码字符串 —— 负对照能直接验（把实现改回旧写法，测试必须失败）：
 *   · 边缘 link 选址：必须贴路线、不压路点、不占已有建筑/工地
 *   · 搬运爬回程：link 在位卸 link、满了有界等待后回退 storage（不许楔死）
 *   · 体型：部件数 ≤ 50（旧版修路爬 77 部件，spawnCreep 直接 ERR_INVALID_ARGS）
 *   · 防守满员闸：编制不满时暂停外矿生产（旧版 allDefendersFull 未定义，
 *     每 6 tick 抛 ReferenceError 把整条外矿生产链打断）
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
Array.prototype.maxBy = function (fn) {
    let best, bestV;
    this.forEach(x => { let v = fn(x); if (best === undefined || v > bestV) { best = x; bestV = v; } });
    return best;
};
Array.prototype.sum = function () { return this.reduce((a, b) => a + b, 0); };
`;

// lodash 的 Array 扩展：宿主 realm（桩对象返回值）和 VM realm（模块自己造的数组）
// 两边都要补，否则 `.head()` 只在一边可用
const ARRAY_EXT = {
    head: function () { return this.length ? this[0] : undefined; },
    last: function () { return this.length ? this[this.length - 1] : undefined; },
    sum: function () { return this.reduce((a, b) => a + b, 0); },
    maxBy: function (fn) {
        let best, bestV;
        this.forEach(x => { let v = fn(x); if (best === undefined || v > bestV) { best = x; bestV = v; } });
        return best;
    },
};
for (const name in ARRAY_EXT) {
    if (!Array.prototype[name]) Object.defineProperty(Array.prototype, name, {
        value: ARRAY_EXT[name], enumerable: false, configurable: true, writable: true,
    });
}

const ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 与 StationSources.serializeOuterRoadPath 同一套紧凑编码 */
function encodePath(points) {
    const rooms = [];
    const index = {};
    points.forEach(p => {
        if (index[p.roomName] === undefined) {
            index[p.roomName] = rooms.length;
            rooms.push(p.roomName);
        }
    });
    let code = rooms.join(",") + ";";
    points.forEach(p => { code += ALPHA[index[p.roomName]] + ALPHA[p.x] + ALPHA[p.y]; });
    return code;
}

const CONSTANTS = {
    OK: 0,
    ERR_NOT_IN_RANGE: -9,
    ERR_NO_BODYPART: -12,
    ERR_FULL: -8,
    RESOURCE_ENERGY: "energy",
    CARRY: "carry", MOVE: "move", WORK: "work", TOUGH: "tough", ATTACK: "attack",
    HEAL: "heal", RANGED_ATTACK: "ranged_attack",
    BODYPART_COST: { move: 50, work: 100, carry: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600 },
    STRUCTURE_LINK: "link", STRUCTURE_CONTAINER: "container", STRUCTURE_ROAD: "road",
    STRUCTURE_RAMPART: "rampart", STRUCTURE_KEEPER_LAIR: "keeperLair", STRUCTURE_INVADER_CORE: "invaderCore",
    STRUCTURE_SPAWN: "spawn", STRUCTURE_EXTENSION: "extension", STRUCTURE_TOWER: "tower",
    LOOK_STRUCTURES: "structures", LOOK_CONSTRUCTION_SITES: "constructionSite", LOOK_SOURCES: "source",
    LOOK_MINERALS: "mineral", LOOK_POWER_CREEPS: "powerCreep", LOOK_ENERGY: "energy",
    LOOK_DEPOSITS: "deposit", LOOK_TOMBSTONES: "tombstone",
    FIND_MY_CONSTRUCTION_SITES: 8, FIND_STRUCTURES: 3, FIND_SOURCES: 1, FIND_HOSTILE_CREEPS: 4,
    FIND_HOSTILE_STRUCTURES: 5, FIND_MY_CREEPS: 2, FIND_TOMBSTONES: 4, FIND_DROPPED_RESOURCES: 6,
    TERRAIN_MASK_WALL: 1, TERRAIN_MASK_SWAMP: 2,
    CONTROLLER_STRUCTURES: { link: { 5: 3, 6: 4, 7: 5, 8: 6 } },
    HARVEST_POWER: 2, BUILD_POWER: 5, TOWER_ENERGY_COST: 10, EXTENSION_ENERGY_CAPACITY: { 8: 200 },
};

function makeContext(extra = {}) {
    const ctx = Object.assign({
        console,
        isSaveCpu: true,
        Memory: { rooms: {} },
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null, map: {}, creeps: {}, rooms: {} },
        Room: { Terrain: function () { this.get = () => 0; } },
        RoomPosition: function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
        StationCarry: { stationName: "stationCarry" },
        StationMineral: { stationName: "stationMineral" },
        StationUpgrade: { stationName: "stationUpgrade" },
        // lodash 的 _.values / _.keys（模块里用于遍历 object map）
        _: {
            values: obj => Object.keys(obj || {}).map(k => obj[k]),
            keys: obj => Object.keys(obj || {}),
        },
        StationSources: undefined,
        StationHive: { trySpawn: () => undefined },
        ManagerCreeps: {
            calcBodyPart: spec => {
                const parts = [];
                (Array.isArray(spec) ? spec : Object.keys(spec).map(k => [k, spec[k]]))
                    .forEach(([part, n]) => { for (let i = 0; i < n; i++) parts.push(part); });
                return parts;
            },
        },
        ManagerFlags: { getFlagsByPrefix: () => [] },
        HelperError: { catchError: fn => fn() },
        // UtilsTask.task 的忠实桩（真实模块顶层也声明 `let pro`，同一 context 里
        // 再跑一个模块会撞名，所以这里用等价实现而不是加载源码）
        UtilsTask: {
            task(obj, taskName, regFun, ops = {}) {
                if (!obj || !obj.pos) throw new TypeError("UtilsTask.task: invalid target for " + taskName);
                const t = { taskName, id: obj.id, roomName: obj.pos.roomName, x: obj.pos.x, y: obj.pos.y, regFun };
                for (const k in ops) t[k] = ops[k];
                return t;
            },
            taskOutView(id, roomName, x, y, taskName, regFun, ops = {}) {
                const t = { taskName, id, roomName, x, y, regFun };
                for (const k in ops) t[k] = ops[k];
                return t;
            },
            taskData(taskName, regFun, ops = {}) {
                const t = { taskName, regFun };
                for (const k in ops) t[k] = ops[k];
                return t;
            },
        },
        Creep: function () {},
    }, CONSTANTS, extra);
    ctx.global = ctx;
    vm.runInNewContext(ARRAY_PATCH, ctx);
    return ctx;
}

function makeStore(contents, capacity) {
    return {
        ...contents,
        getUsedCapacity(res) { return res ? (contents[res] || 0) : Object.keys(contents).reduce((s, k) => s + (contents[k] || 0), 0); },
        getFreeCapacity(res) { return capacity - this.getUsedCapacity(res); },
        getCapacity() { return capacity; },
        isEmpty() { return this.getUsedCapacity() === 0; },
    };
}

// ───────────────────────── 1) 搬运/修路爬体型 ─────────────────────────
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;

    const carrier = S.getOuterHarCarrierBodyConfig(12900, 50);
    const cnt = part => carrier.filter(p => p === part).length;
    assert.equal(carrier.length, 50, "满编搬运爬必须是 50 部件");
    assert.equal(cnt(CONSTANTS.CARRY), 34, "34 CARRY -> 1700 容量（用户 10-03 定稿）");
    assert.equal(cnt(CONSTANTS.MOVE), 16, "16 MOVE 配 34 CARRY = 2:1（道路满速比）");
    // [CARRY,CARRY,MOVE] 循环：伤害从 body 前端扣，每扣一组都保持 2:1
    for (let i = 0; i + 2 < 48; i += 3) {
        // 用 join 比较：VM realm 的数组和宿主 realm 的数组字面量 deepStrictEqual 不相等
        assert.equal(carrier.slice(i, i + 3).join(","), "carry,carry,move",
            "搬运爬必须是 [CARRY,CARRY,MOVE] 循环（第 " + i + " 组）");
    }

    const builder = S.getOuterHarCarrierBuildBodyConfig(12900, 50);
    const bcnt = part => builder.filter(p => p === part).length;
    assert.equal(builder.length, 50, "修路爬也必须是 50 部件（旧版 77 部件根本生不出来）");
    assert.equal(bcnt(CONSTANTS.WORK), 2, "修路爬前缀 2 个 WORK");
    assert.equal(bcnt(CONSTANTS.CARRY) + bcnt(CONSTANTS.MOVE) + 2, 50);
    assert.ok(bcnt(CONSTANTS.MOVE) * 2 >= bcnt(CONSTANTS.CARRY),
        "2:1 的 MOVE 数必须撑得住满货道路速度（恢复 = 2×MOVE ≥ 载重 CARRY 数）");

    // 低等级房（能量上限低）按能量收缩，不能算出付不起的体型
    const small = S.getOuterHarCarrierBodyConfig(600, 50);
    const bodyCost = body => body.reduce((s, p) => s + CONSTANTS.BODYPART_COST[p], 0);
    assert.ok(bodyCost(small) <= 600, "low-energy room must shrink the body");
    assert.ok(small.length >= 6, "至少保留最小可用体型");
}

// ───────────────────────── 2) 边缘 link 选址 ─────────────────────────
const TRUNK = [[1, 23], [2, 23], [3, 23], [4, 23], [5, 23], [6, 23], [7, 23], [8, 23], [21, 33]];

function edgeLinkFixture({ links = [], sites = [], roads = [], level = 8 } = {}) {
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);

    // 两条外矿路线：主房外各走各的，进主房后共用上面那条主干
    const routeA = [{ roomName: "W34N55", x: 5, y: 5 }, { roomName: "W34N55", x: 0, y: 23 }]
        .concat(TRUNK.map(([x, y]) => ({ roomName: "W33N55", x, y })));
    const routeB = [{ roomName: "W34N55", x: 9, y: 5 }, { roomName: "W34N55", x: 0, y: 24 }]
        .concat(TRUNK.map(([x, y]) => ({ roomName: "W33N55", x, y })));
    ctx.Memory.rooms = {
        W34N55: {
            stationSources: {
                sA: { id: "sA", x: 3, y: 17, roomName: "W34N55", container: "cA", roadPathStr: encodePath(routeA), roadPathTick: 99999 },
                sB: { id: "sB", x: 9, y: 17, roomName: "W34N55", container: "cB", roadPathStr: encodePath(routeB), roadPathTick: 99999 },
            },
        },
        W33N55: { stationSources: {} },
    };

    const created = [];
    const destroyed = [];
    const spawnRoom = {
        name: "W33N55", my: true, level,
        controller: { level },
        memory: ctx.Memory.rooms.W33N55,
        link: links,
        storage: { id: "st1", pos: { x: 21, y: 34, roomName: "W33N55" }, store: makeStore({ energy: 100 }, 1000000) },
        lookForAt(type, x, y) {
            if (type === CONSTANTS.LOOK_STRUCTURES) {
                return links.concat(roads).filter(l => l.pos.x === x && l.pos.y === y);
            }
            if (type === CONSTANTS.LOOK_CONSTRUCTION_SITES) return sites.filter(s => s.pos.x === x && s.pos.y === y);
            return [];
        },
        find(type) { return type === CONSTANTS.FIND_MY_CONSTRUCTION_SITES ? sites : []; },
        createConstructionSite(x, y, type) {
            created.push({ x, y, type });
            const site = {
                id: "site" + created.length, structureType: type, pos: { x, y, roomName: "W33N55" },
                remove() { const i = sites.indexOf(this); if (i >= 0) sites.splice(i, 1); this.removed = true; },
            };
            sites.push(site);
            return CONSTANTS.OK;
        },
    };
    ctx.Game.rooms = { W33N55: spawnRoom };
    return { ctx, spawnRoom, created, sites, destroyed };
}

{
    const s = edgeLinkFixture();
    const result = s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom);
    assert.equal(s.created.length, 1, "应该立一个 link 工地");
    assert.equal(s.created[0].type, CONSTANTS.STRUCTURE_LINK);
    assert.ok(result && result.structureType === CONSTANTS.STRUCTURE_LINK, "没有 link 时返回工地对象");

    const picked = s.created[0];
    const trunkSet = {};
    TRUNK.forEach(([x, y]) => trunkSet[x + ":" + y] = true);
    assert.ok(!trunkSet[picked.x + ":" + picked.y], "link 绝不能压在共用路点上（会堵死外矿单行道）");
    const adjacent = TRUNK.some(([x, y]) => Math.max(Math.abs(x - picked.x), Math.abs(y - picked.y)) <= 1);
    assert.ok(adjacent, "link 必须贴着共用路段（搬运爬路过时 range 1 才卸得了）");
    assert.equal(picked.x, 1, "要放在离入口最近的那一段旁边");
    assert.equal(s.spawnRoom.memory.stationCarry.edgeLinkPos, picked.x + ":" + picked.y, "位置要记进 memory");
    assert.ok(s.spawnRoom.memory.stationCarry.edgeLinkPosTick >= 100000,
        "选址时要盖 tick 戳，否则路线重算后没法判断记录是否过期");
}

{
    // 路线重算后旧位置**压到了路线上** → 旧工地拆掉、位置作废、重新选。
    // 现场取自线上 W33N55 (4,22)：选址时是废路，1000 tick 后 W34N55(3,17)
    // 那条路线的对角线穿过它，于是这格变成路点 —— 而 link 不可行走，
    // 立在单行道上就是把外矿通道堵死。
    const roads = [];
    const sites = [];
    const s = edgeLinkFixture({ roads, sites });
    const stale = {
        id: "site-stale", structureType: CONSTANTS.STRUCTURE_LINK,
        pos: { x: 2, y: 23, roomName: "W33N55" },       // 2:23 正是 TRUNK 的一段
        remove() { const i = sites.indexOf(this); if (i >= 0) sites.splice(i, 1); this.removed = true; },
    };
    sites.push(stale);
    s.spawnRoom.memory.stationCarry = {
        edgeLinkPos: "2:23", edgeLinkSite: "site-stale", edgeLinkPosTick: 99990,
    };
    // 两条路线的 roadPathTick = 99999 > 99990 → 选址之后路线重算过
    const result = s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom);
    assert.ok(stale.removed, "压在路线上的旧工地必须拆掉");
    assert.ok(!sites.includes(stale), "旧工地要从房间的结构表里消失");
    assert.notEqual(s.spawnRoom.memory.stationCarry.edgeLinkPos, "2:23", "失效的位置必须作废重选");
    assert.ok(s.created.length >= 1, "拆掉旧工地后要在新位置立工地");
    assert.ok(result && result.structureType === CONSTANTS.STRUCTURE_LINK, "重选后返回新工地");
    const trunkSet = {};
    TRUNK.forEach(([x, y]) => trunkSet[x + ":" + y] = true);
    const picked = s.created[0];
    assert.ok(!trunkSet[picked.x + ":" + picked.y], "重选后仍然不能压在路点上");
    const adjacent = TRUNK.some(([x, y]) => Math.max(Math.abs(x - picked.x), Math.abs(y - picked.y)) <= 1);
    assert.ok(adjacent, "重选后仍然要贴着路线");
}

{
    // 负对照：路线**没有**在选址之后重算过（roadPathTick ≤ edgeLinkPosTick）
    // → 即便那格现在在路线上（说明它一直就在，那就不该被选中），也必须继续
    // 信任记录的位置。少了这道闸，每 tick 都会重算一次排序并漂到别的格子去。
    const sites = [];
    const s = edgeLinkFixture({ sites });
    const keep = {
        id: "site-keep", structureType: CONSTANTS.STRUCTURE_LINK,
        pos: { x: 2, y: 23, roomName: "W33N55" },
        remove() { const i = sites.indexOf(this); if (i >= 0) sites.splice(i, 1); this.removed = true; },
    };
    sites.push(keep);
    s.spawnRoom.memory.stationCarry = {
        edgeLinkPos: "2:23", edgeLinkSite: "site-keep", edgeLinkPosTick: 99999,
    };
    const result = s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom);
    assert.equal(result, keep, "路线没重算过就必须信任记录的位置，不许重选");
    assert.ok(!keep.removed, "不许拆掉仍然有效的工地");
    assert.equal(s.created.length, 0, "不许立新工地");
    assert.equal(s.spawnRoom.memory.stationCarry.edgeLinkPos, "2:23");
}

{
    // 预筛负对照：序列化字符串里的房间清单**不含本房**的站点，既不算
    // 「路线重算过」，也不会被解码（全号 30+ 条路线全解码太贵）。
    const sites = [];
    const s = edgeLinkFixture({ sites });
    const away = [
        { roomName: "W36N55", x: 5, y: 5 }, { roomName: "W36N55", x: 9, y: 9 },
    ];
    Object.keys(s.ctx.Memory.rooms.W34N55.stationSources).forEach(k => {
        s.ctx.Memory.rooms.W34N55.stationSources[k].roadPathStr = encodePath(away);
    });
    const keep = {
        id: "site-away", structureType: CONSTANTS.STRUCTURE_LINK,
        pos: { x: 2, y: 23, roomName: "W33N55" },
        remove() { const i = sites.indexOf(this); if (i >= 0) sites.splice(i, 1); this.removed = true; },
    };
    sites.push(keep);
    s.spawnRoom.memory.stationCarry = {
        edgeLinkPos: "2:23", edgeLinkSite: "site-away", edgeLinkPosTick: 99990,
    };
    const result = s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom);
    assert.equal(result, keep, "不经过本房的路线不该让位置作废");
    assert.ok(!keep.removed);
    assert.equal(s.created.length, 0);
}

{
    // 入口区的冗余 road 优先拆掉给 link 腾位（比占干净空地更靠入口）
    const junk = {
        id: "jr", structureType: CONSTANTS.STRUCTURE_ROAD, pos: { x: 2, y: 22, roomName: "W33N55" },
        destroy() { this.destroyed = true; return CONSTANTS.OK; },
    };
    const roads = [junk];
    const s = edgeLinkFixture({ roads });
    // 桩要模拟引擎：拆掉的路从房间结构表里消失（否则下一 tick 还看得见它）
    const origDestroy = junk.destroy.bind(junk);
    junk.destroy = () => {
        s.destroyed.push(junk);
        roads.splice(roads.indexOf(junk), 1);
        return origDestroy();
    };
    const first = s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom);
    assert.equal(first, undefined, "拆路那一 tick 不立工地（destroy 与 create 的意图顺序不保证）");
    assert.ok(junk.destroyed, "冗余 road 必须被拆掉");
    assert.equal(s.created.length, 0, "同一 tick 不重复立工地");
    assert.equal(s.spawnRoom.memory.stationCarry.edgeLinkPos, "2:22", "位置记下来，下一 tick 继续");

    // 下一 tick：路已经没了 → 在同一个位置立 link 工地
    s.spawnRoom.memory.stationCarry.edgeLinkPos = "2:22";
    const second = s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom);
    assert.equal(s.created.length, 1, "路让位后立起 link 工地");
    assert.equal(s.created[0].x + ":" + s.created[0].y, "2:22", "工地就落在拆掉的那格废路上");
    assert.ok(second && second.structureType === CONSTANTS.STRUCTURE_LINK);
}

{
    // 已经有 link → 不再立工地，并且返回 undefined
    const link = { id: "lk", structureType: CONSTANTS.STRUCTURE_LINK, pos: { x: 2, y: 22, roomName: "W33N55" }, store: makeStore({}, 800) };
    const s = edgeLinkFixture({ links: [link] });
    s.spawnRoom.memory.stationCarry = { edgeLink: "lk" };
    s.ctx.Game.getObjectById = id => (id === "lk" ? link : null);
    assert.equal(s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom), undefined);
    assert.equal(s.created.length, 0, "已有 link 时不能再立工地");
    assert.equal(s.ctx.StationSources.outerEdgeLink(s.spawnRoom).id, "lk");
}

{
    // link 上限已满（RCL8 共 6 个）→ 不立工地
    const links = [1, 2, 3, 4, 5, 6].map(i => ({ id: "l" + i, structureType: CONSTANTS.STRUCTURE_LINK, pos: { x: i, y: 40, roomName: "W33N55" } }));
    const s = edgeLinkFixture({ links });
    assert.equal(s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom), undefined);
    assert.equal(s.created.length, 0, "link 到上限就不能再立工地");
}

{
    // Memory 开关关闭 → 不立工地、不返回 link
    const s = edgeLinkFixture();
    s.ctx.Memory.marketSettings = { edgeLink: false };
    assert.equal(s.ctx.StationSources.ensureOuterEdgeLink(s.spawnRoom), undefined);
    assert.equal(s.created.length, 0, "开关关掉后必须完全不动手");
}

{
    // link 被拆：memory 里的 id 立刻作废，调用方回退 storage
    const s = edgeLinkFixture();
    s.spawnRoom.memory.stationCarry = { edgeLink: "gone" };
    s.ctx.Game.getObjectById = () => null;
    assert.equal(s.ctx.StationSources.outerEdgeLink(s.spawnRoom), undefined);
    assert.equal(s.spawnRoom.memory.stationCarry.edgeLink, undefined, "失效的 link id 要清掉");
    assert.equal(s.ctx.StationSources.outerCarryDropOff(s.spawnRoom).id, "st1", "没有 link 时卸货点回退 storage");
}

// ───────────────────────── 3) 搬运爬回程卸货（有界等待 + 回退） ─────────────────────────
function dropOffFixture({ linkFree, linkType = CONSTANTS.STRUCTURE_LINK, keepBuilding, wait } = {}) {
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const calls = [];
    const target = {
        id: linkType === CONSTANTS.STRUCTURE_LINK ? "lk" : "st1",
        structureType: linkType,
        store: makeStore({}, 1e6),
        pos: { x: 2, y: 22, roomName: "W33N55" },
    };
    if (linkFree !== undefined) target.store.getFreeCapacity = () => linkFree;
    const task = { taskName: "harvestEnergyOuterCarryRoadBuilder", id: target.id, roomName: "W33N55", x: 2, y: 22 };
    if (keepBuilding) task.keepBuilding = true;
    if (wait) task.edgeLinkWait = wait;
    const creep = {
        ticksToLive: 500,
        room: { name: "W33N55" },
        store: makeStore({ energy: 1250 }, 1700),
        pos: { isNearTo: () => true, inRangeTo: () => true, getRangeTo: () => 1 },
        getPartCnt: () => 0,
        getActiveBodyparts: () => 0,
        mainRoom: () => ctx.Game.rooms.W33N55,
        lastTask: () => task,
        lastTaskObj: () => target,
        popTask() { calls.push(["pop"]); return this; },
        execLastTask() { calls.push(["exec"]); return this; },
        addTask() { calls.push(["add"]); return this; },
        transfer(t, res, amount) { calls.push(["transfer", t.id, res, amount]); return CONSTANTS.OK; },
        moveTo() { calls.push(["moveTo"]); return CONSTANTS.OK; },
        build() { return CONSTANTS.OK; },
    };
    ctx.Game.rooms = {
        W33N55: { name: "W33N55", storage: { id: "st1", pos: { x: 21, y: 34, roomName: "W33N55" } } },
    };
    ctx.Creep.prototype.harvestEnergyOuterCarryRoadBuilder.call(creep);
    return { calls, task, target };
}

{
    // link 只有 800 空位、身上 1250 → 卸 800 并**留在原地等**（不能 pop 走人）
    const { calls, task } = dropOffFixture({ linkFree: 800 });
    const t = calls.find(c => c[0] === "transfer");
    assert.deepEqual(t, ["transfer", "lk", "energy", 800], "只能卸 link 装得下的部分");
    assert.ok(!calls.some(c => c[0] === "pop"), "还有货没卸完：不能把任务弹掉");
    assert.equal(task.edgeLinkWait || 0, 0, "这一 tick 有进展，不消耗等待配额");
}

{
    // link 满：前几 tick 只是等（记配额），到上限就 pop 让 fillRes(storage) 兜底
    const { calls, task } = dropOffFixture({ linkFree: 0, wait: 0 });
    assert.ok(!calls.some(c => c[0] === "transfer"), "link 满了一克都塞不进，不能再发 transfer");
    assert.ok(!calls.some(c => c[0] === "pop"), "第一 tick 满了还不该放弃，先等一轮");
    assert.equal(task.edgeLinkWait, 1, "没进展的 tick 要记进等待配额");

    const capped = dropOffFixture({ linkFree: 0, wait: 12 });
    assert.ok(capped.calls.some(c => c[0] === "pop"), "等满上限必须 pop，交给 storage 兜底（绝不楔死）");
}

{
    // 卸货点是 storage 时行为不变（旧路径回归）
    const { calls } = dropOffFixture({ linkType: "storage" });
    const t = calls.find(c => c[0] === "transfer");
    assert.deepEqual(t, ["transfer", "st1", "energy", undefined], "storage 卸货保持原样（不带 amount）");
    assert.ok(calls.some(c => c[0] === "pop"), "storage 卸完立刻弹任务");
}

{
    // harvestEnergyOuterCarry：回程任务栈 = [fillRes(storage), fillRes(edgeLink), roadBuilder(edgeLink)]
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const link = { id: "lk", structureType: CONSTANTS.STRUCTURE_LINK, store: makeStore({}, 800), pos: { x: 2, y: 22, roomName: "W33N55" } };
    const storage = { id: "st1", pos: { x: 21, y: 34, roomName: "W33N55" }, store: makeStore({ energy: 5000 }, 1e6) };
    const home = { name: "W33N55", my: true, storage, memory: { stationCarry: { edgeLink: "lk" } } };
    ctx.Memory.rooms = { W34N55: { stationSources: { sA: { id: "sA", roomName: "W34N55", x: 3, y: 17, spawned: true } } } };
    ctx.Game.rooms = { W33N55: home };
    ctx.Game.getObjectById = id => (id === "lk" ? link : id === "st1" ? storage : null);

    const added = [];
    const task = { taskName: "harvestEnergyOuterCarry", id: "sA", roomName: "W34N55", x: 3, y: 17 };
    const creep = {
        room: { name: "W33N55" },
        memory: {},                                  // 新逻辑会写 this.memory.carryWait
        // 必须**装满**才会出发：容量 1700 时 1250 只是半仓以上，新规则要等满
        //（见 harvestEnergyOuterCarry 的「装满再走」）。本用例只验证回程任务栈，
        // 所以直接把爬设成满仓。
        store: makeStore({ energy: 1700 }, 1700),
        pos: { isNearTo: () => true, findInRange: () => [] },
        headTask: () => task,
        lastTask: () => task,
        mainRoom: () => home,
        getPartCnt: () => 0,
        getActiveBodyparts: () => 0,
        ticksToLive: 500,
        addTask(t) { (Array.isArray(t) ? t : [t]).forEach(x => x && added.push(x)); return this; },
        execLastTask() { return this; },
        goTo() { return this; },
        findInRange: () => [],
    };
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.ok(added.length >= 2, "回程必须压上卸货任务");
    const top = added[added.length - 1];
    assert.equal(top.taskName, "harvestEnergyOuterCarryRoadBuilder");
    assert.equal(top.id, "lk", "栈顶（先执行）要走回边缘 link 卸货");
    assert.ok(added.some(t => t.taskName === "fillRes" && t.id === "lk"), "link 卸货层在位");
    assert.ok(added.some(t => t.taskName === "fillRes" && t.id === "st1"), "storage 兜底层必须在栈底接住剩下的能量");
    assert.equal(added[0].id, "st1", "storage 兜底在栈底（最后执行）");

    // 没有 link 时行为与旧版一致：只有 fillRes(storage) + roadBuilder(storage)
    home.memory.stationCarry = {};
    added.length = 0;
    ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
    assert.deepEqual(added.map(t => t.id), ["st1", "st1"], "无 link 时任务栈保持旧行为");
}

// ───────────────────────── 4) link 轮询：边缘 link → hub ─────────────────────────
function linkFixture({ edgeEnergy, hubFree, upgradeFree, threshold = 200 } = {}) {
    const ctx = makeContext();
    ctx.StationSources = { stationName: "stationSources" };
    vm.runInNewContext(read("station_carry.js"), ctx);
    const sent = [];
    const mk = (id, energy, free) => ({
        id, structureType: CONSTANTS.STRUCTURE_LINK,
        store: { ...makeStore({ energy }, 800), getFreeCapacity: () => free },
        transferEnergy(dest) { sent.push([id, dest.id]); return CONSTANTS.OK; },
    });
    const edge = mk("edge", edgeEnergy, 800 - edgeEnergy);
    const hub = mk("hub", 800 - hubFree, hubFree);
    const upgrade = mk("upg", 800 - upgradeFree, upgradeFree);
    ctx.Game.getObjectById = id => ({ edge, hub, upg: upgrade }[id] || null);
    const room = {
        name: "W33N55",
        memory: {
            stationCarry: { link: "hub", edgeLink: "edge" },
            stationUpgrade: { link: "upg" },
            stationSources: {},
        },
    };
    ctx.StationCarry.transformLink(room);
    return sent;
}

{
    assert.deepEqual(linkFixture({ edgeEnergy: 800, hubFree: 800, upgradeFree: 0 }), [["edge", "hub"]],
        "边缘 link 满了要发给 storage 旁的 hub");
    assert.deepEqual(linkFixture({ edgeEnergy: 800, hubFree: 0, upgradeFree: 800 }), [["edge", "upg"]],
        "hub 满了退到升级 link");
    assert.deepEqual(linkFixture({ edgeEnergy: 800, hubFree: 0, upgradeFree: 0 }), [],
        "两边都满就留在 link 里等下一轮");
    assert.deepEqual(linkFixture({ edgeEnergy: 100, hubFree: 800, upgradeFree: 0 }), [],
        "低于阈值不发（不做碎片传输）");
}

// ── 5a) 拥堵熔断写回：Memory.outerPaused 不存在时也不能崩 ──
// 读取侧原来有 `Memory.outerPaused &&` 守卫、写入侧是裸下标赋值。首次触发熔断
// 时这个 map 根本不存在 → TypeError → 被 catchError 吞掉但 exec 已中断 →
// 该出兵房的外矿策略从此每 6 tick 死一次，keeper/carrier 一只都不派
// （实测 W33N55：外矿搬运爬团灭、主房 storage 被抽到 0）。
{
    const ctx = makeContext();
    vm.runInNewContext(read("strategy_outerHarvest.js"), ctx);
    const S = ctx.StrategyOuterHarvest;
    delete ctx.Memory.outerPaused;
    ctx.Memory.rooms = { W34N55: { stationSources: { s1: { id: "s1" } } } };
    const killed = [];
    ctx.Game.creeps = {};
    for (let i = 0; i < 4; i++) {
        ctx.Game.creeps["c" + i] = {
            memory: { role: "outerHarvestEnergyCarrier", outerStuck: { x: 25, y: 25, t: 99000 } },
            pos: { x: 25, y: 25 },
            headTask: () => ({ roomName: "W34N55" }),
            suicide: () => killed.push("c" + i),
        };
    }
    const target = { name: "W34N55", flags: () => [] };
    const room = {
        name: "W33N55", my: true, hashCode: () => 2,      // (Game.time + 2) % 6 == 0
        storage: {},                                      // 没有 storage 的出兵房会被提前跳过
        find: () => Object.values(ctx.Game.creeps),
        flags: () => [],
    };
    ctx.Game.rooms = { W33N55: room, W34N55: target };
    ctx.ManagerFlags = {
        getFlagsByPrefix: () => [{
            name: "har_W33N55_invader_W34N55", pos: { roomName: "W34N55" },
            memory: { spawnRoom: "W33N55" }, getRoomName: () => "W33N55",
        }],
    };
    ctx.StationHive = { getClosestSpawnRoom: () => undefined, trySpawn: () => undefined };
    ctx.Game.time = 100000;
    assert.doesNotThrow(() => S.exec(room),
        "熔断首次触发不能抛异常：写入前必须先把 Memory.outerPaused 建出来");
    assert.equal(killed.length, 4, "熔断要先处决堵路的爬");
    assert.ok(ctx.Memory.outerPaused && ctx.Memory.outerPaused.W34N55 > 100000,
        "熔断要真的把该外矿房停掉（写回成功）");
}

// ── 5b) 能量闸必须认 terminal：只看 storage 会把自己锁死 ──
// W33N55 实测：storage 被抽到 0、terminal 里躺着 9.8 万（别房救济），而 carrier
// 只在 hive 缺能时才去 terminal 取 → storage 永远回不来 → 外矿 carrier 永远不补。
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const mk = (storage, terminal) => ({
        my: true, energyCapacityAvailable: 12900,
        getEnergyAvailable: () => 12900,
        storage: { store: { energy: storage } },
        terminal: terminal === undefined ? undefined : { store: { energy: terminal } },
    });
    assert.equal(S.outerMineStarvesSpawnRoom(mk(0, 98053), true), false,
        "storage 空但 terminal 有 9.8 万 → 不算缺能（实测这里把整条外矿锁死几千 tick）");
    assert.equal(S.outerMineStarvesSpawnRoom(mk(0, 49000), true), true,
        "terminal 只有 4.9 万（未超过 5 万市场储备）→ 仍算缺能");
    assert.equal(S.outerMineStarvesSpawnRoom(mk(10000, 70000), true), false,
        "1 万 storage + terminal 超储备的 2 万 = 3 万 → 够（阈值是 < 3 万）");
    assert.equal(S.outerMineStarvesSpawnRoom(mk(0), true), true, "没有 terminal 时退回只看 storage");
    assert.equal(S.outerMineStarvesSpawnRoom(mk(0, 98053), false), false, "keeper 阈值 2 万，同样认 terminal");
    assert.equal(S.outerMineStarvesSpawnRoom({ my: false }, true), true, "不是自己的房 → 视为缺能");
}

// ── 5c) 没视野不等于「路没修完」 ──
// 原来无视野一律 data.roadComplete=false → 外矿一失视野就持续补 WORK 型修路爬，
// 修路爬反复 keepBuilding 掉头；掉头目标在无视野时是 RoomPosition（没有 .pos），
// 于是 UtilsTask.task 每 tick 抛一次（实测 shard3_83436569_2）。
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const path = [{ x: 25, y: 25, roomName: "W34N55" }, { x: 26, y: 25, roomName: "W34N55" }];
    S.getOuterRoadPath = () => path;
    ctx.Game.rooms = {};                                   // 完全没有视野
    assert.equal(S.outerRoadComplete({ roadPathStr: "x" }), true,
        "没视野且从未判定过 → 视为完成（否则会一直补修路爬、掉头时抛异常）");
    assert.equal(S.outerRoadComplete({ roadPathStr: "x", roadComplete: true }), true, "没视野 → 沿用上次「完成」");
    assert.equal(S.outerRoadComplete({ roadPathStr: "x", roadComplete: false }), false, "没视野 → 沿用上次「未完成」");
    ctx.Game.rooms.W34N55 = { lookForAt: () => [] };       // 有视野且真的缺路
    assert.equal(S.outerRoadComplete({ roadPathStr: "x", roadComplete: true }), false, "看得见且缺路 → 仍然是未完成");
}

// ── 5d) 防守爬跨房行军必须沿外矿路线（跨房 moveTo 的 range 判据是坏的） ──
// 引擎判跨房目标只用**房内格差**：W33N55(8,37) 到 (25,25,W34N55) 返回 17，
// 于是 `moveTo(..., {range:20})` 认为已到达 → 防守爬一出生就站死在出兵房。
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    S.squadDefenderShouldRecycle = () => false;
    ctx.Memory.rooms.W34N55 = { stationSources: { s1: { id: "s1", roomName: "W34N55", x: 3, y: 17 } } };
    const calls = [];
    S.moveOuterCarrierOnRoad = (creep, task, data, dir) => { calls.push([data.id, dir]); return true; };
    let moved = 0;
    const creep = {
        memory: { role: "outerHarvestDefenser", defenseGroup: 0 },
        room: { name: "W33N55" },
        pos: { x: 8, y: 37, roomName: "W33N55", isNearTo: () => false },
        headTask: () => ({ taskName: "outerDefense", id: "s1", roomName: "W34N55", x: 3, y: 17 }),
        moveTo: () => { moved++; },
        goTo: () => { moved += 100; },
    };
    ctx.Creep.prototype.outerDefense.call(creep);
    assert.equal(JSON.stringify(calls), JSON.stringify([["s1", -1]]),
        "跨房行军要沿外矿路线走，方向 -1（路线 index 0 = 矿区、末点 = 主房）");
    assert.equal(moved, 0, "有路线时不许再退回跨房 moveTo/goTo");
    // 没有路线数据时的退路：朝目标房中心走、**不带 range**，而且绝不退回
    // goTo(源点坐标) —— 那正是 outer-defense.test.cjs 断言禁止的旧写法。
    delete ctx.Memory.rooms.W34N55.stationSources.s1;
    const mv = [];
    creep.moveTo = (pos, opts) => { mv.push([pos.x, pos.y, opts && opts.range]); };
    creep.goTo = () => { mv.push(["goTo"]); };
    ctx.Creep.prototype.outerDefense.call(creep);
    assert.equal(mv.length, 1, "没有路线时也要动起来（不能站着不动）");
    assert.equal(mv[0][0] === 25 && mv[0][1] === 25, true, "退路朝目标房中心");
    assert.equal(mv[0][2] === undefined, true, "退路不带 range（跨房 range 会在出兵房里误判到达）");
}

// ───────────────────────── 5) 防守满员闸 ─────────────────────────
/**
 * 计数口径必须是「在役 + 在途」，所以 fixture 显式区分**物理所在房**（room）
 * 和**任务指向的房**（target）：站在外矿房门口/房里的防守爬，用「主房里的爬」
 * 去数是数不到的 —— 那会让闸门永远判不满员，把外矿生产永久锁死。
 */
function defenceGateFixture(defenders) {
    const ctx = makeContext();
    vm.runInNewContext(read("strategy_outerHarvest.js"), ctx);
    // 闸门把「编制 / 在役数量」都委托给 StationSources（单一事实来源），这里给
    // 忠实桩；两个函数本身在下面的 station_sources 用例里单独验。
    ctx.StationSources = {
        stationName: "stationSources",
        outerDefenseQuota: () => 2,
        outerDefenseAssignments: roomName => defenders.filter(d => d.target == roomName),
    };
    ctx.Game.creeps = {};
    defenders.forEach((d, i) => {
        ctx.Game.creeps["d" + i] = {
            memory: { role: "outerHarvestDefenser" },
            room: { name: d.room },
            headTask: () => ({ roomName: d.target }),
        };
    });
    const invaderRoom = { name: "W34N55", find: () => [{ structureType: CONSTANTS.STRUCTURE_KEEPER_LAIR }] };
    const quietRoom = { name: "W35N55", find: () => [] };
    ctx.Game.rooms = { W34N55: invaderRoom, W35N55: quietRoom };
    const flags = [
        { name: "har_W33N55_invader_W34N55", pos: { roomName: "W34N55" }, memory: { spawnRoom: "W33N55" } },
        { name: "har_W33N55_W35N55", pos: { roomName: "W35N55" }, memory: { spawnRoom: "W33N55" } },
    ];
    const spawnRoom = { name: "W33N55", my: true };
    return ctx.StrategyOuterHarvest.outerDefendersFull(spawnRoom, flags);
}

{
    assert.equal(defenceGateFixture([]), false, "威胁房一只防守爬都没有 → 只守不产");
    assert.equal(defenceGateFixture([{ room: "W34N55", target: "W34N55" }]), false,
        "编制 2 只只到了 1 只 → 仍然暂停生产");
    // 在役的那只物理上在 W34N55（不在主房）也照样算 —— 这正是不能按
    // spawnRoom.creeps(role) 计数的原因（那样永远只有 0~1 只 → 永久锁死生产）
    assert.equal(defenceGateFixture([
        { room: "W34N55", target: "W34N55" }, { room: "W33N55", target: "W34N55" },
    ]), true, "在役的 + 在途的接替兵都要算进编制");
    assert.equal(defenceGateFixture([
        { room: "W34N55", target: "W34N55" }, { room: "W34N55", target: "W34N55" },
    ]), true, "威胁房满编、无威胁房 0 编制 → 放行");
}

// ───────────────── 6) 防守编制的「计数口径」与「keeper 加编」 ─────────────────
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;

    // 计数：只数防守爬、按任务栈目标房名、在役（站在外矿房）+ 在途都算
    ctx.Game.creeps = {
        a: { memory: { role: "outerHarvestDefenser" }, headTask: () => ({ roomName: "W34N55" }) },
        b: { memory: { role: "outerHarvestDefenser" }, headTask: () => ({ roomName: "W34N55" }) },
        c: { memory: { role: "outerHarvestDefenser" }, headTask: () => ({ roomName: "W35N55" }) },
        d: { memory: { role: "harvestEnergyKeeper" }, headTask: () => ({ roomName: "W34N55" }) },
        e: { memory: { role: "outerHarvestDefenser" }, headTask: () => undefined },
    };
    assert.equal(S.outerDefenseAssignments("W34N55").length, 2,
        "在役 + 在途的防守爬都算（不看它物理上在哪个房）");
    assert.equal(S.outerDefenseAssignments("W35N55").length, 1);
    assert.equal(S.outerDefenseAssignments("W36N55").length, 0);
    assert.equal(S.outerDefenseAssignments("W34N55").length, 2, "同 tick 复用缓存结果一致");

    // 编制：基线 2（巡逻覆盖）；房里有 keeper → 1 只防守爬对 1 只 keeper，上限 4
    const roomWith = n => ({
        name: "W34N55",
        find: () => Array.from({ length: n }, () => ({ owner: { username: "Source Keeper" } })),
    });
    assert.equal(S.outerDefenseQuota(roomWith(0)), 2, "没有 keeper 也要 2 只（一个盯 2 个窝）");
    assert.equal(S.outerDefenseQuota(roomWith(1)), 2, "1 只 keeper 不需要加编");
    assert.equal(S.outerDefenseQuota(roomWith(3)), 3,
        "3 只 keeper → 3 只防守爬（1 打 2 必死：实测 2 只防守爬 + 4 只矿工一波全灭）");
    assert.equal(S.outerDefenseQuota(roomWith(9)), 4, "上限 4 = lair 数");
    assert.equal(S.outerDefenseQuota(undefined), 2, "没有视野时退回基线，不凭想象加派");

    // 基线可调：设 1 = 只留一只防守爬兜整个房间（用户想试单只时用，不用改代码）
    ctx.Memory.marketSettings = { outerDefenseBase: 1 };
    assert.equal(S.outerDefenseQuota(roomWith(0)), 1, "outerDefenseBase=1 → 无 keeper 时也要 1 只");
    assert.equal(S.outerDefenseQuota(roomWith(3)), 3, "有 3 只 keeper 时仍按 1:1 加编到 3");
    ctx.Memory.marketSettings = { outerDefenseBase: 9 };
    assert.equal(S.outerDefenseQuota(roomWith(0)), 4, "上限 4 兜住，不允许配出 9 只");
    delete ctx.Memory.marketSettings;                 // 别把开关漏给后面的派兵用例

    // invader **远程风筝小队**（≥2 只 Invader 爬）：防守爬这时会换成 T3 远程体型
    // （squadBody），一只就是 880 dps + 288 奶 + XGHO2 减伤，对小队是碾压；
    // 第二只只是把同一套化合物再烧一遍（30 部件 × 30 单位 ≈ 900 单位 T3）。
    // 用户 10-04 指示：一只就够，不要随意浪费 T3。实测 W35N55 白派了
    // shard3_83402855_1 + shard3_83402885_2 两只同体型 T3 爬。
    const invaderRoom = n => ({
        name: "W35N55",
        find: () => Array.from({ length: n }, () => ({ owner: { username: "Invader" } })),
    });
    assert.equal(S.outerDefenseQuota(invaderRoom(2)), 1,
        "2 只 Invader 爬 → 编制 1：T3 小队一只就够（W35N55 实测白派两只）");
    assert.equal(S.outerDefenseQuota(invaderRoom(5)), 1, "5 只 Invader 也一样，一只 T3 碾压整个小队");
    assert.equal(S.outerDefenseQuota(invaderRoom(1)), 2,
        "只有 1 只 Invader 时不是风筝小队（不带 T3），仍按基线 2");
    assert.equal(S.outerDefenseQuota({
        name: "W34N55",
        find: () => [1, 2, 3, 4].map(i => ({ owner: { username: i == 1 ? "Invader" : "Source Keeper" } })),
    }), 3, "1 只 Invader + 3 只 keeper 不算 T3 小队场景，按 keeper 1:1 加编");

    // 派兵：编制按 keeper 加编，且**已经到岗的防守爬**必须算进数量
    //（旧实现按 spawnRoom.creeps 数，到岗的那只看不见 → 每 6 tick 白派一只）
    const spawned = [];
    ctx.StationHive.trySpawn = (room, name, body, role) => { spawned.push({ body, role }); return "newDef"; };
    ctx.WarDamageCal = { possibleBreakDamage: () => 0 };
    ctx.Game.rooms.W34N55 = {
        name: "W34N55",
        getHostileCreeps: () => [{ owner: { username: "Source Keeper" }, possibleDamage: () => 300, possibleHealDamage: () => 0 }],
        find: (c) => (c == CONSTANTS.FIND_HOSTILE_CREEPS
            ? [{ owner: { username: "Source Keeper" }, possibleDamage: () => 300, possibleHealDamage: () => 0 }]
            : []),
    };
    ctx.Memory.rooms.W34N55 = { stationSources: { s1: { id: "s1", roomName: "W34N55", x: 3, y: 17 } } };
    ctx.Game.creeps = {
        a: { memory: { role: "outerHarvestDefenser", hasSendSpawn: false }, ticksToLive: 1200, headTask: () => ({ roomName: "W34N55" }) },
    };
    const spawnRoom = { name: "W33N55", my: true, spawnFailure: false, creeps: () => [] };
    ctx.Game._outerDefAssignTick = undefined;          // 换了 creep 列表 → 让缓存重扫
    ctx.StationSources.trySpawnOuterDefenser("W34N55", spawnRoom, true);
    assert.equal(spawned.length, 1,
        "在役 1 只 < 编制 2 只 → 补 1 只（主房里一只都没有也不例外）");

    spawned.length = 0;
    ctx.Game.creeps = {
        a: { memory: { role: "outerHarvestDefenser", hasSendSpawn: false }, ticksToLive: 1400, headTask: () => ({ roomName: "W34N55" }) },
        b: { memory: { role: "outerHarvestDefenser", hasSendSpawn: false }, ticksToLive: 1300, headTask: () => ({ roomName: "W34N55" }) },
    };
    ctx.Game._outerDefAssignTick = undefined;          // 强制重扫 creep 列表
    ctx.StationSources.trySpawnOuterDefenser("W34N55", spawnRoom, true);
    assert.equal(spawned.length, 0,
        "编制 2 只已到齐（一只在岗、一只在途）→ 不再补员（旧实现会每 6 tick 白派一只）");

    // T3 风筝小队场景：已有 1 只（T3 体型）→ 编制 1 → 绝不再派第二只烧 T3
    spawned.length = 0;
    ctx.StationLab = {
        boostAble: () => true,
        generatorBoostResTask: () => [{ taskName: "boostRes" }],
    };
    const invaders = [1, 2].map(() => ({
        owner: { username: "Invader" }, hits: 1000, hitsMax: 1000,
        possibleDamage: () => 100, possibleHealDamage: () => 0,
    }));
    ctx.Game.rooms.W35N55 = {
        name: "W35N55",
        getHostileCreeps: () => invaders,
        find: c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? invaders : []),
    };
    ctx.Memory.rooms.W35N55 = { stationSources: { s2: { id: "s2", roomName: "W35N55", x: 41, y: 10 } } };
    ctx.Game.creeps = {
        a: { memory: { role: "outerHarvestDefenser", hasSendSpawn: false }, ticksToLive: 1300, headTask: () => ({ roomName: "W35N55" }) },
    };
    ctx.Game._outerDefAssignTick = undefined;
    ctx.StationSources.trySpawnOuterDefenser("W35N55", spawnRoom, true);
    assert.equal(spawned.length, 0,
        "已经是 T3 风筝小队编制（1 只）→ 不再派第二只 T3 强化爬（W35N55 实测白派了两只）");
}

// ───────── 7) 防守体型顺序：MOVE 必须在最前（输出/续航不能拿去当肉盾） ─────────
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const lair = { structureType: CONSTANTS.STRUCTURE_KEEPER_LAIR };
    const room = {
        name: "W34N55",
        getHostileCreeps: () => [],
        find: c => (c === CONSTANTS.FIND_HOSTILE_STRUCTURES ? [lair] : []),
    };
    const melee = ctx.StationSources.getOuterHarDefenseBodyConfig(true, room).body;
    assert.equal(melee.join("+"),
        Array(17).fill(CONSTANTS.MOVE).concat(Array(22).fill(CONSTANTS.ATTACK), Array(11).fill(CONSTANTS.HEAL)).join("+"),
        "近战防守爬必须是 MOVE(17) → ATTACK(22) → HEAL(11)：伤害从前端扣，"
        + "ATTACK 放前面等于拿输出当肉盾（逐 tick 模拟：那样贴身对拼会输给 keeper）");

    // 按敌情算出来的体型也必须把 MOVE 放最前
    const keeper = {
        owner: { username: "Source Keeper" }, hits: 5000, hitsMax: 5000,
        possibleDamage: () => 300, possibleHealDamage: () => 0,
    };
    const room2 = {
        name: "W34N55",
        getHostileCreeps: () => [keeper],
        find: c => (c === CONSTANTS.FIND_HOSTILE_STRUCTURES ? [lair] : []),
    };
    ctx.WarDamageCal = { possibleBreakDamage: () => 0 };
    const computed = ctx.StationSources.getOuterHarDefenseBodyConfig(false, room2).body;
    assert.equal(computed[0], CONSTANTS.MOVE, "按敌情算出的体型同样要把 MOVE 排在第一位");
}

// ────── 8) 搬运爬「身上有零头就不取货」的死锁 + 碎货往返 + 装满再走 + 捡地面掉落 ──────
{
    function carryScene({ storeEnergy, containerEnergy, keeperAlive, wait, drops }) {
        const ctx = makeContext();
        vm.runInNewContext(read("station_sources.js"), ctx);
        const container = {
            id: "c1", structureType: "container",
            store: makeStore({ energy: containerEnergy }, 2000),
            pos: { x: 32, y: 31, roomName: "W34N55", isEqualTo: () => false },
        };
        const storage = { id: "st1", pos: { x: 21, y: 34, roomName: "W33N55" } };
        const keeper = { id: "k1" };
        ctx.Memory.rooms = {
            W34N55: { stationSources: { sA: { id: "sA", roomName: "W34N55", x: 32, y: 32, container: "c1",
                                              creeps: keeperAlive ? ["k1"] : [] } } },
        };
        ctx.Game.rooms = { W33N55: { name: "W33N55", storage } };
        ctx.Game.getObjectById = id => (id === "c1" ? container : id === "k1" ? keeper
            : id === "st1" ? storage : null);
        // 地面掉落桩：忠实实现 findInRange 的 filter 语义（模块给的是
        // `resourceType == energy && amount > 500`）
        const groundDrops = (drops || []).map((d, i) => ({
            id: "d" + i, resourceType: "energy", amount: d.amount,
            pos: { x: d.x === undefined ? 32 : d.x, y: d.y === undefined ? 31 : d.y, roomName: "W34N55" },
        }));
        const calls = [];
        const creep = {
            room: { name: "W34N55" }, memory: { carryWait: wait },
            store: makeStore({ energy: storeEnergy }, 1700),
            ticksToLive: 1000,
            pos: { x: 32, y: 31, roomName: "W34N55", isNearTo: () => true, isEqualTo: () => false,
                   isBorder: () => false, lookFor: () => [],
                   findInRange: (type, range, opts) => {
                       if (type !== CONSTANTS.FIND_DROPPED_RESOURCES) return [];
                       // 忠实实现 findInRange：先按**切比雪夫距离 ≤ range** 筛，再套 filter。
                       // 以前这里把 range 参数丢掉了，于是「身边的堆」和「8 格外的堆」在
                       // 测试里完全等价 —— 可是两者的门槛本来就不同：身边（容器格上
                       // keeper 溢出的那些）不设门槛，绕路去捡才要求 500。
                       const cx = 32, cy = 31;
                       const near = groundDrops.filter(d =>
                           Math.max(Math.abs(d.pos.x - cx), Math.abs(d.pos.y - cy)) <= range);
                       return opts && opts.filter ? near.filter(opts.filter) : near;
                   },
                   getRangeTo: () => 1, inRangeTo: () => true },
            headTask: () => ({ taskName: "harvestEnergyOuterCarry", id: "sA", roomName: "W34N55", x: 32, y: 32 }),
            lastTask: () => ({ taskName: "harvestEnergyOuterCarry", id: "sA", roomName: "W34N55" }),
            lastTaskObj: () => undefined,
            mainRoom: () => ctx.Game.rooms.W33N55,
            getPartCnt: () => 0, getActiveBodyparts: () => 0,
            withdraw(t, res) { calls.push(["withdraw", res]); return CONSTANTS.OK; },
            pickup(t) { calls.push(["pickup", t && t.amount]); return CONSTANTS.OK; },
            transfer(t, res) { calls.push(["transfer", res]); return CONSTANTS.OK; },
            moveTo() { calls.push(["moveTo"]); return CONSTANTS.OK; },
            goTo() { calls.push(["goTo"]); return CONSTANTS.OK; },
            addTask() { calls.push(["addTask"]); return this; },
            execLastTask() { return this; },
            popTask() { return this; },
        };
        ctx.Creep.prototype.harvestEnergyOuterCarry.call(creep);
        return { calls, creep };
    }

    // ① 身上有 20 能量零头（路上捡墓碑留下的）→ 必须能补货（旧代码 storeEmpty() 挡住，永远补不上）
    const top = carryScene({ storeEnergy: 20, containerEnergy: 500, keeperAlive: true, wait: 0 });
    assert.ok(top.calls.some(c => c[0] === "withdraw" && c[1] === "energy"),
        "身上有零头也要能从容器补货（这就是 3 只 carrier 卡在容器边的根因）");

    // ② 容器干涸 + 没 keeper + 刚等：不搬碎货，继续等
    const dry = carryScene({ storeEnergy: 10, containerEnergy: 0, keeperAlive: false, wait: 0 });
    assert.ok(!dry.calls.some(c => c[0] === "addTask"), "容器干涸但才刚开始等 → 别搬 10 能量的碎货");

    // ③ 干涸且已等够 60 tick：带走总比空转强
    const giveUp = carryScene({ storeEnergy: 10, containerEnergy: 0, keeperAlive: false, wait: 60 });
    assert.ok(giveUp.calls.some(c => c[0] === "addTask"), "等够上限就该回主房，不能永远等着");

    // ④ **装满再走**：容量 1700、手上 1300、矿区还在出货 → 不许走（原来半仓就走，
    //    每趟固定成本一样却少运 400，实测常态化只带 1300/1700 回主房）
    const half = carryScene({ storeEnergy: 1300, containerEnergy: 2000, keeperAlive: true, wait: 0 });
    assert.ok(!half.calls.some(c => c[0] === "addTask"), "矿区还在出货 → 必须等装满，不能半仓就走");

    // ⑤ 装满（零空位）→ 立刻走
    const full = carryScene({ storeEnergy: 1700, containerEnergy: 2000, keeperAlive: true, wait: 0 });
    assert.ok(full.calls.some(c => c[0] === "addTask"), "装满就走，一秒都不多等");

    // ⑥ 干涸且没 keeper、已等满干涸上限 → 带着 1300 走（有界，绝不楔死）
    const dryHalf = carryScene({ storeEnergy: 1300, containerEnergy: 0, keeperAlive: false, wait: 60 });
    assert.ok(dryHalf.calls.some(c => c[0] === "addTask"), "真的干涸了，等满上限就带着手上的货走");

    // ⑦ keeper 还活着、容器暂时空的：等（上限 150），不要半仓就跑
    const keeperDry = carryScene({ storeEnergy: 1300, containerEnergy: 0, keeperAlive: true, wait: 0 });
    assert.ok(!keeperDry.calls.some(c => c[0] === "addTask"), "keeper 还在出货 → 继续等它把容器灌满");

    // ⑧ **容器格上的掉落能量**（keeper 溢出）必须捡：范围 1、门槛 500。
    //    keeper 占着容器格，搬运爬只能在旁边，原来 `this.pos.lookFor` 永远看不见。
    const pile = carryScene({ storeEnergy: 200, containerEnergy: 0, keeperAlive: true, wait: 0,
                              drops: [{ amount: 600 }] });
    assert.deepEqual(pile.calls.find(c => c[0] === "pickup"), ["pickup", 600],
        "站在容器旁边就要能捡到容器格上的 600 能量堆");

    // ⑨ **身边（范围 1）的小堆必须无条件捡**：它就在脚下、不用绕路，捡多少都是净赚。
    //    容器满时溢出的正是这种小堆 —— 线上实测 W34N55 容器格 (32,31) 上压着 145、
    //    (9,34) 旁边 191，全都低于 500。旧代码给「身边」也套了 500 门槛，于是它们
    //    永远没人收：容器已经满了、别处也收不走，只能一直躺在地上。
    const small = carryScene({ storeEnergy: 200, containerEnergy: 0, keeperAlive: true, wait: 0,
                               drops: [{ amount: 120 }] });
    assert.ok(small.calls.some(c => c[0] === "pickup" && c[1] === 120),
        "身边的 120 小堆要顺手捡掉，不能因为低于 500 就放着");

    // ⑩ 但**行进途中**（8 格扫描）的小堆不值得占搬运爬一趟的位置：门槛 500。
    const far = carryScene({ storeEnergy: 200, containerEnergy: 0, keeperAlive: true, wait: 0,
                             drops: [{ amount: 120, x: 37, y: 31 }] });
    assert.ok(!far.calls.some(c => c[0] === "pickup"),
        "8 格外的 120 小堆不值得让搬运爬偏离路线");
}

// ───────── 9) 外矿路完整性：掉血到阈值以下算「没修好」，提前派修路爬 ─────────
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const path = [{ x: 10, y: 10, roomName: "W34N55" }, { x: 11, y: 10, roomName: "W34N55" }];
    const data = { id: "sA", roomName: "W34N55", x: 10, y: 10, roadPathStr: encodePath(path) };
    const roadRoom = hits => ({
        name: "W34N55",
        lookForAt: () => [{ structureType: "road", hits: hits, hitsMax: 5000 }],
    });
    ctx.Game.rooms = { W34N55: roadRoom(5000) };
    assert.equal(S.outerRoadComplete(data, true), true, "满血的路 = 完成");
    ctx.Game.rooms.W34N55 = roadRoom(2500);
    assert.equal(S.outerRoadComplete(data, true), true, "正好 50% 仍算完成（阈值是 <）");
    ctx.Game.rooms.W34N55 = roadRoom(2499);
    assert.equal(S.outerRoadComplete(data, true), false,
        "掉到 50% 以下 → 判未完成去修回来。原判据只看「有没有路」，于是路面一路衰减到 0 "
        + "消失，那一格才是真的「没有 road」，而且从 0 重建一格要 5000 能量（修回来只要 250）");
    ctx.Game.rooms.W34N55 = { name: "W34N55", lookForAt: () => [] };
    assert.equal(S.outerRoadComplete(data, true), false, "完全没有路 → 未完成");
}

// ── 10) 外矿路维护不能被「补员闸」挡住（carrier 到上限 / 出兵房缺能量） ──
//
// 实测 W33N55：carrier 数到上限 8 之后 placeOuterRoadSites / ensureOuterEdgeLink
// 一次都没再跑（它们和补员写在同一个循环、被早返回挡住）。现场后果：route 2d16
// 在 83403755 换道经过 W34N55 (34,29)，新路面永远没有工地；边缘 link 的旧工地
// (2,22) 留在路线上、新工地 (5,22) 却一直立不起来。
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const calls = [];
    S.ensureOuterRoadPath = () => calls.push("route");
    S.placeOuterRoadSites = () => calls.push("sites");
    S.cleanupOuterRoadSites = () => calls.push("cleanup");
    S.ensureOuterEdgeLink = () => calls.push("edge");
    S.outerMineStarvesSpawnRoom = () => true;      // 能量闸也为真：维护照样得跑
    S.outerRoadComplete = () => true;
    let spawned = 0;
    ctx.StationHive.trySpawn = () => { spawned++; return "c"; };

    ctx.Game.rooms.W34N55 = {
        name: "W34N55",
        memory: { stationSources: { s1: { id: "s1", roomName: "W34N55", x: 3, y: 17, pathTime: 90, container: "c1" } } },
    };
    const spawnRoom = {
        name: "W33N55", my: true, spawnFailure: true, level: 8,
        creeps: () => new Array(9).fill({}),       // 9 只 carrier，已经超过上限 8
        memory: {}, getEnergyCapacityAvailable: () => 12900,
    };
    S.trySpawnOuterHarCarrier("W34N55", spawnRoom);
    for (const c of ["route", "sites", "cleanup", "edge"]) {
        assert.ok(calls.includes(c), `补员被挡住时「${c}」这类外矿路维护仍必须执行`);
    }
    assert.equal(spawned, 0, "超过 carrier 上限 → 一只都不补（闸门本身照旧）");
}

// ── 11) 边缘 link 的残留工地必须清掉（它钉在路线格上会让那格永远没有 road） ──
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const mkSite = (x, y) => ({
        structureType: "link", pos: { x, y, roomName: "W33N55" }, removed: false,
        remove() { this.removed = true; },
    });
    const planned = mkSite(22, 33);   // 蓝图规划的 link 工地
    const keep = mkSite(5, 22);       // 当前位置记录上的工地
    const orphan = mkSite(2, 22);     // 位置记录挪走后留下的残留（实测 W33N55）
    const room = {
        name: "W33N55",
        memory: { structMap: { link: [{ x: 22, y: 33 }] } },
        find: () => [planned, keep, orphan],
    };
    S.pruneStaleEdgeLinkSites(room, "5:22");
    assert.equal(orphan.removed, true,
        "蓝图外、又不在记录位置上的 link 工地是残留 —— 它占着 link 名额，还让 (2,22) 那格永远铺不了路");
    assert.equal(keep.removed, false, "位置记录上的工地必须留着（边缘 link 就靠它）");
    assert.equal(planned.removed, false, "蓝图规划的 link 工地不许碰（那是规划器的活）");
    // 没有记录位置时不动手：宁可漏删，不可误删
    const orphan2 = mkSite(3, 22);
    room.find = () => [orphan2];
    S.pruneStaleEdgeLinkSites(room, undefined);
    assert.equal(orphan2.removed, false, "没有位置记录时不猜、不删");
}

// ── 12) T3 小队防守爬：invader 清完 → 回主房贴 spawn 回收（不白烧 T3） ──
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const mkCreep = ({ boosted = true, room = "W35N55", invaders = 0, lastSeen } = {}) => {
        const body = [];
        for (let i = 0; i < 50; i++) body.push({ type: "move", boost: boosted && i < 30 ? "XKHO2" : null });
        const hostile = Array.from({ length: invaders }, () => ({ owner: { username: "Invader" } }));
        return {
            name: "d1",
            memory: { role: "outerHarvestDefenser", invaderLastSeen: lastSeen,
                      tasks: [{ taskName: "outerDefense", id: "s1", roomName: "W35N55", x: 41, y: 10 }] },
            body, ticksToLive: 1300,
            room: { name: room, find: c => (c === CONSTANTS.FIND_HOSTILE_CREEPS ? hostile : []) },
            pos: { x: 41, y: 10, roomName: room },
            mainRoom: () => ({ name: "W33N55", storage: null, controller: null, spawn: { head: () => null } }),
            say() {}, moveTo() { return 0; }, goTo() { return this; },
            popTask() { this.memory.tasks.pop(); return this; },
            addTask(t) { (Array.isArray(t) ? t : [t]).forEach(x => x && this.memory.tasks.push(x)); return this; },
            execLastTask() { this.execCount = (this.execCount || 0) + 1; return this; },
            headTask() { return this.memory.tasks.head(); },
        };
    };
    const task = { taskName: "outerDefense", id: "s1", roomName: "W35N55" };

    // ① 没强化过的普通防守爬永远不回收
    assert.equal(S.squadDefenderShouldRecycle(mkCreep({ boosted: false }), task), false,
        "普通近战防守爬不回收（它们要长期守窝）");
    // ② 房里还有 Invader 爬 → 不许撤，并刷新计时
    const fighting = mkCreep({ invaders: 3, lastSeen: ctx.Game.time - 500 });
    assert.equal(S.squadDefenderShouldRecycle(fighting, task), false, "invader 还在就不许撤");
    assert.equal(fighting.memory.invaderLastSeen, ctx.Game.time, "见到 Invader 要刷新计时");
    // ③ 刚清完、还在静默窗口内 → 不回收
    assert.equal(S.squadDefenderShouldRecycle(mkCreep({ lastSeen: ctx.Game.time - 10 }), task), false,
        "刚清完别急着走（等 150 tick 确认不是漏网/下一波）");
    // ④ 到场时就没有 Invader（另一只先清完了）→ 从到场起算
    const fresh = mkCreep({ lastSeen: undefined });
    assert.equal(S.squadDefenderShouldRecycle(fresh, task), false, "没有记录 → 先打点，本 tick 不撤");
    assert.equal(fresh.memory.invaderLastSeen, ctx.Game.time);
    // ⑤ 静默够久 → 回收
    assert.equal(S.squadDefenderShouldRecycle(mkCreep({ lastSeen: ctx.Game.time - 200 }), task), true,
        "Invader 清完 150 tick → 回主房回收（recycle 按 ttl 比例返还 T3，比 unboost 的固定 15/部件多）");
    // ⑥ 还在行军（人不在目标房）→ 不判，避免半路调头
    assert.equal(S.squadDefenderShouldRecycle(mkCreep({ room: "W34N55", lastSeen: ctx.Game.time - 500 }), task),
        false, "行军途中不回收");

    // ⑦ 接线：outerDefense 的第一句就把任务栈换成 recycleCreep 并立刻执行
    const c = mkCreep({ lastSeen: ctx.Game.time - 200 });
    ctx.Creep.prototype.outerDefense.call(c);
    assert.deepEqual(c.memory.tasks.map(t => t.taskName), ["recycleCreep"],
        "触发后任务栈 = [recycleCreep]（它会自己走回主房、贴到 spawn 旁边回收）");
    assert.equal(c.execCount, 1, "必须当场执行回收任务，不能这一 tick 白站");
    // ⑧ 不满足条件时任务栈不许被动
    const c2 = mkCreep({ room: "W34N55", lastSeen: ctx.Game.time - 500 });
    ctx.Creep.prototype.outerDefense.call(c2);
    assert.equal(c2.memory.tasks[0].taskName, "outerDefense", "条件不满足 → 照常走防守逻辑");
}

// ── 13) 搬运爬上限按**矿点数**算，不能拍死一个常数把某些矿点饿死 ──
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const route = encodePath([{ x: 10, y: 10, roomName: "W34N55" }, { x: 11, y: 10, roomName: "W33N55" }]);

    ctx.Memory.rooms = {};
    assert.equal(S.outerCarrierFleetCap({ name: "W33N55" }), 4, "没有外矿路线时退回下限 4");

    ctx.Memory.rooms = { W34N55: { stationSources: {} }, W35N55: { stationSources: {} } };
    for (let i = 0; i < 3; i++) ctx.Memory.rooms.W34N55.stationSources["a" + i] = { id: "a" + i, roadPathStr: route };
    for (let i = 0; i < 3; i++) ctx.Memory.rooms.W35N55.stationSources["b" + i] = { id: "b" + i, roadPathStr: route };
    assert.equal(S.outerCarrierFleetCap({ name: "W33N55" }), 18,
        "6 个矿点 × 3 = 18（缺省 8 是按三矿点估的，会把后两个矿点的补员永久挡住；"
        + "需求公式实测稳态 ≈16 只，18 只挡跑飞不挡稳态）");
    // 别的房为主房的路线不算
    ctx.Memory.rooms.W34N55.stationSources.c = {
        id: "c", roadPathStr: encodePath([{ x: 1, y: 1, roomName: "W40N40" }, { x: 2, y: 1, roomName: "W39N40" }]),
    };
    assert.equal(S.outerCarrierFleetCap({ name: "W33N55" }), 18, "别房为主房的路线不计入本房上限");
    // 显式开关仍然优先（保留硬压回去的能力）
    ctx.Memory.marketSettings = { outerCarrierMax: 8 };
    assert.equal(S.outerCarrierFleetCap({ name: "W33N55" }), 8, "Memory 开关优先于缺省公式");
    delete ctx.Memory.marketSettings;

    // 功能验证：总数 8（旧上限就是 8）时，给「一只 live carrier 都没有」的矿点补员
    const ctx2 = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx2);
    const S2 = ctx2.StationSources;
    const container = { id: "c1", pos: { x: 32, y: 31, roomName: "W35N55" } };
    const source = { id: "s1", energyCapacity: 4000, ticksToRegeneration: 300 };
    const stations = {};
    for (let i = 1; i <= 6; i++) {
        stations["s" + i] = { id: "s" + i, roomName: "W35N55", x: 32, y: 32, roadPathStr: route };
    }
    stations.s1.pathTime = 100;
    stations.s1.container = "c1";
    stations.s1.carryCreeps = ["dead1"];           // 死 id：这个矿点实际一只都没有
    ctx2.Memory.rooms = { W35N55: { stationSources: stations } };
    ctx2.Game.rooms.W35N55 = { name: "W35N55", memory: ctx2.Memory.rooms.W35N55 };
    ctx2.Game.getObjectById = id => (id === "c1" ? container : id === "s1" ? source : null);
    S2.ensureOuterRoadPath = () => {};
    S2.placeOuterRoadSites = () => {};
    S2.cleanupOuterRoadSites = () => {};
    S2.ensureOuterEdgeLink = () => {};
    S2.outerRoadComplete = () => true;
    S2.outerMineStarvesSpawnRoom = () => false;
    S2.getOuterRoadPath = () => new Array(100).fill(0);
    S2.getHarvesterBodyConfig = () => new Array(10).fill("work");
    const spawned = [];
    ctx2.StationHive.trySpawn = (room, name, body, role) => { spawned.push(role); return "c"; };
    const spawnRoom = {
        name: "W33N55", my: true, spawnFailure: false, level: 8,
        creeps: () => new Array(8).fill({}),       // 已经 8 只：旧上限下必然被早返回挡住
        memory: {}, getEnergyCapacityAvailable: () => 12900,
    };
    S2.trySpawnOuterHarCarrier("W35N55", spawnRoom);
    assert.equal(spawned.length, 1,
        "总数 8、但该矿点 0 只 live carrier → 上限按矿点数算（12），必须补员（实测 W35N55 两点 carryCreeps 全死）");
}

// ── 14) 防守爬的「岗位」要记下来，接替兵继承 —— 分工明确（用户 10-04 指出） ──
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const mkLair = (id, x, y) => ({ id, structureType: "keeperLair", pos: { x, y, roomName: "W34N55" } });
    const lW1 = mkLair("l1", 5, 5), lW2 = mkLair("l3", 5, 20), lE1 = mkLair("l2", 40, 5), lE2 = mkLair("l4", 40, 20);
    const lairs = [lW1, lW2, lE1, lE2];              // 与 outerDefensePosts 的按坐标排序一致
    // 分组表走缓存（否则会跑 PathFinder）：西组 [l1,l3]、东组 [l2,l4]
    const mkRoom = creeps => ({
        name: "W34N55",
        memory: {
            defenseLairGroupsKey: "l1,l3,l2,l4",
            defenseLairGroups: [["l1", "l3"], ["l2", "l4"]],
            stationSources: {
                sWest: { id: "sWest", roomName: "W34N55", x: 6, y: 6, pathTime: 85 },
                sEast: { id: "sEast", roomName: "W34N55", x: 41, y: 6, pathTime: 85 },
            },
        },
        find: type => (type === CONSTANTS.FIND_HOSTILE_STRUCTURES ? lairs
            : type === CONSTANTS.FIND_MY_CREEPS ? creeps : []),
    });
    const def = (group, key) => ({ memory: { role: "outerHarvestDefenser", defenseGroup: group, defenseLairIds: key } });

    // 岗位 key：按 id 排序，与传入顺序无关 → 窝重建后组号会变、key 不变
    assert.equal(S.defenseGroupKey([lE1, lE2]), "l2|l4");
    assert.equal(S.defenseGroupKey([lE2, lE1]), "l2|l4", "岗位 key 与传入顺序无关");
    // 这组窝挂在哪个矿点：西组 → 西矿点，东组 → 东矿点
    assert.equal(S.defenseGroupStation(mkRoom([]), [lW1, lW2]).id, "sWest");
    assert.equal(S.defenseGroupStation(mkRoom([]), [lE1, lE2]).id, "sEast");
    assert.equal(S.defenseGroupStation({ memory: {} }, [lE1]), undefined, "找不到矿点就返回 undefined");

    // 接替兵：继承被接替者的岗位（key 优先）
    const front = def(1, "l2|l4");
    const inherit = S.outerDefenseAssignmentForSpawn(mkRoom([front]), front, true);
    assert.equal(inherit.group, 1, "接替兵继承岗位（不是运行时看谁少去哪）");
    assert.equal(inherit.lairIds, "l2|l4", "守的就是老兵那一组窝");
    assert.equal(inherit.station.id, "sEast", "任务挂在离这组窝最近的矿点下");
    // 老 memory 只有组号（本改动前出生的爬）→ 按组号继承
    const oldFront = { memory: { role: "outerHarvestDefenser", defenseGroup: 0 } };
    assert.equal(S.outerDefenseAssignmentForSpawn(mkRoom([oldFront]), oldFront, true).group, 0);
    // 补员兵：挑当时人最少的那组（西组 2 人、东组 0 人 → 东组）
    const w1 = def(0, "l1|l3"), w2 = def(0, "l1|l3");
    const fill = S.outerDefenseAssignmentForSpawn(mkRoom([w1, w2]), undefined, false);
    assert.equal(fill.group, 1, "补员兵补最空的那组");
    assert.equal(fill.lairIds, "l2|l4");
    // 没视野 / 没有窝 → 空（运行时 outerDefensePosts 再补）
    assert.equal(Object.keys(S.outerDefenseAssignmentForSpawn(undefined, front, true)).length, 0,
        "没有视野 → 岗位留空（运行时 outerDefensePosts 再补）");
    assert.equal(Object.keys(S.outerDefenseAssignmentForSpawn({ find: () => [], memory: {} }, front, true)).length, 0,
        "房里没有窝 → 岗位留空");

    // 运行时不换岗：岗位是记下来的，别组更空也不动（避免两只爬来回对调）
    const sticky = def(1, "l2|l4");
    sticky.room = mkRoom([sticky, w1, w2]);
    assert.equal(S.outerDefensePosts(sticky).map(l => l.id).join(","), "l2,l4", "守记下来的那组");
    assert.equal(sticky.memory.defenseGroup, 1, "别组更空也不换岗（分工稳定）");
    // 覆盖兜底：**只补空组**。两组都有人（2/1）→ 谁也不动（分工稳，不对调）
    const s1 = def(0, "l1|l3"), s2 = def(0, "l1|l3"), s3 = def(1, "l2|l4");
    s1.room = mkRoom([s1, s2, s3]);
    S.outerDefensePosts(s1);
    assert.equal(s1.memory.defenseGroup, 0, "两组都有人 → 不拣人少的组、不动岗（不会来回对调）");
    assert.equal(s1.memory.defenseLairIds, "l1|l3");
    // 一组**空了**才去补：两个爬都记着 g0、g1 没人 → 恰好一只补过去
    const e1 = def(0, "l1|l3"), e2 = def(0, "l1|l3");
    e1.room = mkRoom([e1, e2]);
    S.outerDefensePosts(e1);
    assert.equal(e1.memory.defenseGroup, 1, "别组一个人都没有 → 去补空组");
    assert.equal(e1.memory.defenseLairIds, "l2|l4", "补位后岗位跟着改写");
    e2.room = e1.room;                       // 同一间房（此时 e1 已改记为 g1）
    S.outerDefensePosts(e2);
    assert.equal(e2.memory.defenseGroup, 0, "补位只走一只：本组不能走空（剩这只守住 g0）");
    // 从没定过岗 → 挑人最少，并把岗位写下来
    const fresh = { memory: { role: "outerHarvestDefenser" }, room: null };
    fresh.room = mkRoom([fresh, w1, w2]);
    S.outerDefensePosts(fresh);
    assert.equal(fresh.memory.defenseGroup, 1, "没定过岗才做一次均衡");
    assert.equal(fresh.memory.defenseLairIds, "l2|l4", "岗位必须落到 memory 里");
    // 岗位记的窝已经没了（分组表重算）→ 用组号兜，并把新 key 写回
    const stale = def(0, "lX|lY");
    stale.room = mkRoom([stale]);
    S.outerDefensePosts(stale);
    assert.equal(stale.memory.defenseLairIds, "l1|l3", "旧岗位失效 → 按组号兜并改写 key");

    // 端到端：trySpawnOuterDefenser 出生即定岗（任务里带岗位 + 最近的矿点 + memory）
    const ctx2 = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx2);
    const S2 = ctx2.StationSources;
    const room2 = mkRoom([]);
    room2.getHostileCreeps = () => [];
    ctx2.Game.rooms.W34N55 = room2;
    ctx2.Memory.rooms.W34N55 = room2.memory;
    const frontCreep = {
        memory: { role: "outerHarvestDefenser", defenseGroup: 1, defenseLairIds: "l2|l4" },
        ticksToLive: 100, headTask: () => ({ roomName: "W34N55" }),
    };
    const freshCreep = { memory: {} };
    ctx2.Game.creeps = { old1: frontCreep, newDef: freshCreep };
    ctx2.Game._outerDefAssignTick = undefined;
    let spawnedTasks = null;
    ctx2.StationHive.trySpawn = (room, name, body, role, tasks) => { spawnedTasks = tasks; return "newDef"; };
    S2.trySpawnOuterDefenser("W34N55", { name: "W33N55", my: true, spawnFailure: false, memory: {} }, true);
    assert.ok(spawnedTasks, "老兵到了提前量 → 必须派接替兵");
    assert.equal(spawnedTasks[0].id, "sEast",
        "任务目标 = 它真正要守的那组窝所属的矿点（原来一律挂在房里第一个矿点，分工记录是错的）");
    assert.equal(spawnedTasks[0].defenseLairIds, "l2|l4", "岗位随任务一起下达");
    assert.equal(spawnedTasks[0].defenseGroup, 1);
    assert.equal(freshCreep.memory.defenseLairIds, "l2|l4", "新爬 memory 里存着岗位");
    assert.equal(freshCreep.memory.defenseGroup, 1);
    assert.equal(frontCreep.memory.hasSendSpawn, true, "老兵只派一次接替（原有语义不变）");
}

// ── 15) 主房挖掘节流：storage 充裕就暂停本房矿点补员（带滞回） ──
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;
    const mkRoom = (energy, opts) => {
        opts = opts || {};
        return {
            name: "W33N55",
            memory: {},
            storage: { store: { energy: energy } },
            find: type => (type === CONSTANTS.FIND_MY_CONSTRUCTION_SITES ? new Array(opts.sites || 0).fill({}) : []),
            creeps: () => (opts.noCarrier ? [] : [{}]),
        };
    };
    assert.equal(S.homeMiningPaused(mkRoom(500000)), true,
        "storage 充裕 → 暂停本房矿点补员（实测 26 只 keeper ≈3.6 CPU/tick）");
    assert.equal(S.homeMiningPaused(mkRoom(199999)), false, "storage 低于阈值 → 照常挖");
    assert.equal(S.homeMiningPaused(mkRoom(500000, { sites: 3 })), true,
        "有工地也照样暂停：storage 里 20 万+，工地用料由 carrier 从 storage 搬过去");
    assert.equal(S.homeMiningPaused(mkRoom(500000, { noCarrier: true })), false,
        "没有 carrier 的死房不暂停（hive 只能靠本房 keeper 挖的矿救）");
    // 滞回：暂停后要掉到阈值 75% 以下才恢复。第一版拿 HiveNeedToFill 当条件，
    // 它每次 spawn 一忙就翻真 → 翻一次就把 20 个矿点的 keeper 同时塞进 spawn 队列
    // （每只 150 tick = 3000 tick 的 spawn 时间），外矿 carrier 补员全被挡死。
    const h = mkRoom(500000);
    assert.equal(S.homeMiningPaused(h), true);
    assert.equal(h.memory.miningPaused, 1, "暂停状态记在 room.memory 里，瞬时条件不能再翻转它");
    h.storage.store.energy = 160000;                  // 仍高于 0.75 * 200000
    assert.equal(S.homeMiningPaused(h), true, "滞回：略低于阈值仍保持暂停");
    h.storage.store.energy = 140000;                  // 低于 150000
    assert.equal(S.homeMiningPaused(h), false, "掉到滞回下限以下 → 恢复补员");
    assert.equal(h.memory.miningPaused, undefined, "恢复时清掉标记");
    // 开关与阈值
    ctx.Memory.marketSettings = { homeMiningPauseEnergy: 0 };
    assert.equal(S.homeMiningPaused(mkRoom(500000)), false, "开关设 0 → 整个节流关闭");
    ctx.Memory.marketSettings = { homeMiningPauseEnergy: 1000 };
    assert.equal(S.homeMiningPaused(mkRoom(500000)), true, "阈值可用 Memory 调");
    delete ctx.Memory.marketSettings;
    assert.equal(S.homeMiningPaused({ name: "x", find: () => [] }), false, "没有 storage → 不暂停");

    // 接线：暂停时不给本房矿点补 keeper；storage 掉到滞回下限以下立刻恢复
    const ctx2 = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx2);
    const S2 = ctx2.StationSources;
    S2.getHarvesterBodyConfig = () => ["move"];
    const spawned = [];
    ctx2.StationHive.trySpawn = (room, name, body, role) => { spawned.push(role); return "k"; };
    ctx2.Memory.rooms.W33N55 = {
        stationSources: { s1: { id: "s1", roomName: "W33N55", x: 10, y: 10, spawnTime: 0, creeps: [] } },
    };
    const home = {
        name: "W33N55",
        memory: {},
        storage: { store: { energy: 500000 } },
        find: () => [],
        creeps: () => [{}],
        spawnFailure: false,
        energyAvailable: 12900,
        getEnergyCapacityAvailable: () => 12900,
        level: 8,
    };
    ctx2.Game.rooms.W33N55 = home;
    S2.trySpawnOuterHarKeeper("W33N55", home);
    assert.equal(spawned.length, 0, "满足节流条件 → 本房矿点一只 keeper 都不补");
    home.storage.store.energy = 1000;
    S2.trySpawnOuterHarKeeper("W33N55", home);
    assert.equal(spawned.length, 1, "storage 掉到滞回下限以下 → 下一次评估立刻恢复补员");
}

// ────── 10) 外矿补员闸门不能自锁：车全没了 + 外矿有货 = 必须放行 ──────
//
// outerMineStarvesSpawnRoom 的输入（主房能量）恰好是外矿搬运爬的产出，所以一旦
// 车队归零就成环：车没了 → 货回不来 → 主房穷 → 闸门恒真 → 永远不出车。
// 2026-10-04 与 2026-10-07 两次实测都是这个形状。
{
    function gateScene({ storageEnergy, terminalEnergy, containerEnergies, fleet, hiveEnergy }) {
        const ctx = makeContext();
        vm.runInNewContext(read("station_sources.js"), ctx);
        const containers = {};
        const stationSources = {};
        containerEnergies.forEach((amount, i) => {
            const id = "cont" + i;
            containers[id] = { id: id, store: makeStore({ energy: amount }, 2000) };
            const path = [{ roomName: "W34N55", x: 5, y: 5 },
                          { roomName: "W33N55", x: 1, y: 23 },
                          { roomName: "W33N55", x: 21, y: 33 }];
            stationSources["s" + i] = {
                id: "s" + i, roomName: "W34N55", x: 3, y: 17, container: id,
                roadPathStr: encodePath(path), roadPathTick: 99999,
            };
        });
        ctx.Memory.rooms = { W34N55: { stationSources: stationSources }, W33N55: { stationSources: {} } };
        const spawnRoom = {
            name: "W33N55", my: true, level: 8,
            memory: ctx.Memory.rooms.W33N55,
            storage: { id: "st", store: makeStore({ energy: storageEnergy }, 1000000),
                       pos: { x: 21, y: 34, roomName: "W33N55" } },
            terminal: { id: "tm", store: makeStore({ energy: terminalEnergy }, 300000),
                        pos: { x: 22, y: 35, roomName: "W33N55" } },
            energyCapacityAvailable: 12900,
            getEnergyAvailable: () => (hiveEnergy === undefined ? 12900 : hiveEnergy),
            energyAvailable: hiveEnergy === undefined ? 12900 : hiveEnergy,
            spawnFailure: false,
            find: () => [],
            lookForAt: () => [],
            creeps: (role) => (role === "outerHarvestEnergyCarrier" ? fleet : []),
        };
        for (const key in containers) { /* 容器不需要挂在房间里 */ }
        ctx.Game.rooms = { W33N55: spawnRoom };
        ctx.Game.getObjectById = id => containers[id] || null;
        return { S: ctx.StationSources, spawnRoom: spawnRoom };
    }

    // 线上现场：storage 4242 / terminal 48350，外矿三容器 2000/2000 全满，一只车都没有
    const live = gateScene({ storageEnergy: 4242, terminalEnergy: 48350,
                             containerEnergies: [2000, 2000, 2000], fleet: [] });
    assert.equal(live.S.outerMineEnergyWaiting(live.spawnRoom), 6000, "外矿存货 = 三个容器之和");
    assert.equal(live.S.outerCarrierBacklogQuota(live.spawnRoom), 2,
        "6000 存货 / 一只满编车 2500 = 该有 2 只");
    assert.equal(live.S.outerMineStarvesSpawnRoom(live.spawnRoom, true), true,
        "按主房口径仍然算穷（storage + terminal 超额 只有 22592 < 3 万）");
    // 这就是补员闸的最终判据：闸门判真 && 车队 >= 配额 才挡
    const blocked = live.S.outerMineStarvesSpawnRoom(live.spawnRoom, true)
        && live.spawnRoom.creeps("outerHarvestEnergyCarrier", false).length
            >= live.S.outerCarrierBacklogQuota(live.spawnRoom);
    assert.equal(blocked, false, "车队 0 < 配额 2 → 必须放行补员（旧代码在这里死锁）");

    // 负对照 ①：外矿真的没货 → 配额 0 → 闸门照旧挡住，不许凭空出车
    const empty = gateScene({ storageEnergy: 4242, terminalEnergy: 48350,
                              containerEnergies: [0, 0, 0], fleet: [] });
    assert.equal(empty.S.outerCarrierBacklogQuota(empty.spawnRoom), 0, "没货 → 配额 0");
    assert.equal(empty.S.outerMineStarvesSpawnRoom(empty.spawnRoom, true)
        && empty.spawnRoom.creeps("outerHarvestEnergyCarrier", false).length
            >= empty.S.outerCarrierBacklogQuota(empty.spawnRoom), true,
        "没货就老老实实被闸门挡住");

    // 负对照 ②：车队已经到配额 → 不再多出，豁免不会把闸门永久架空
    const stocked = gateScene({ storageEnergy: 4242, terminalEnergy: 48350,
                                containerEnergies: [2000, 2000, 2000], fleet: [{}, {}] });
    assert.equal(stocked.S.outerMineStarvesSpawnRoom(stocked.spawnRoom, true)
        && stocked.spawnRoom.creeps("outerHarvestEnergyCarrier", false).length
            >= stocked.S.outerCarrierBacklogQuota(stocked.spawnRoom), true,
        "车队 2 ≥ 配额 2 → 不再补员");

    // 负对照 ③：主房能量足 → 闸门本来就假，跟豁免无关
    const rich = gateScene({ storageEnergy: 60000, terminalEnergy: 0,
                             containerEnergies: [0, 0, 0], fleet: [] });
    assert.equal(rich.S.outerMineStarvesSpawnRoom(rich.spawnRoom, true), false,
        "storage 6 万 → 不穷");

    // ⑤ **出爬造成的 hive 缺口不该把主房判穷**（2026-10-10 现场）。
    //    原来 disposable = disposableEnergy - (capacity - available)，而 hive 缺口
    //    是瞬时值（12900 容量下动辄几千），keeper 阈值才 2 万 —— 闸门跟着出爬节奏
    //    反复开合，外矿 keeper（主房的能量来源）一关就没收入，房间更穷、闸门更死。
    //    实测 W33N55：storage 17166 / terminal 24212 / hive 7580，disposable 从
    //    21378 被减到 16058 < 20000 ⇒ 判穷 ⇒ W34N55 三个容器全满却没有一只矿工。
    const hiveGap = gateScene({ storageEnergy: 17166, terminalEnergy: 24212,
                                containerEnergies: [2000, 2000, 2000], fleet: [],
                                hiveEnergy: 7580 });
    assert.equal(hiveGap.S.outerMineStarvesSpawnRoom(hiveGap.spawnRoom, false), false,
        "hive 缺口不能把主房判穷（否则外矿矿工永远派不出去）");
    // 但主房真的没能量时仍然要判穷（不能把闸门废掉）
    const reallyPoor = gateScene({ storageEnergy: 1000, terminalEnergy: 0,
                                  containerEnergies: [0, 0, 0], fleet: [],
                                  hiveEnergy: 0 });
    assert.equal(reallyPoor.S.outerMineStarvesSpawnRoom(reallyPoor.spawnRoom, false), true,
        "storage 1000 才是真穷");

    // reserve 口径：市场储备不能比闸门阈值本身还大，否则 terminal 整份作废
    const fromTerminal = gateScene({ storageEnergy: 0, terminalEnergy: 60000,
                                     containerEnergies: [0, 0, 0], fleet: [] });
    assert.equal(fromTerminal.S.outerMineStarvesSpawnRoom(fromTerminal.spawnRoom, true), false,
        "terminal 6 万 - 储备 3 万 = 3 万可支配 → 不该判穷（旧口径 reserve 5 万只剩 1 万，误判穷）");
}

// ────── 11) 存货配额必须**按矿房**算，不能拿全局数比全局车数 ──────
//
// 一辆搬运爬只跑一条矿点路线。用全局配额比全局车数，会把「A 房挤了 5 只、
// B 房一只没有」判成「够了」，B 房就永远没人去清。
// 2026-10-08 实测：W34N55 3070/5 只，W35N55 6000 容器 + 7105 地面/2 只，
// 全局配额 floor(3070/2500)=1，被全局挡住。
{
    const ctx = makeContext();
    vm.runInNewContext(read("station_sources.js"), ctx);
    const S = ctx.StationSources;

    const containers = {};
    const mkRoom = (roomName, amounts) => {
        const stations = {};
        amounts.forEach((amount, i) => {
            const id = roomName + "c" + i;
            containers[id] = { id: id, store: makeStore({ energy: amount }, 2000) };
            stations["s" + i] = {
                id: "s" + i, roomName: roomName, x: 5, y: 5, container: id,
                roadPathStr: encodePath([{ roomName: roomName, x: 5, y: 5 },
                                         { roomName: "W33N55", x: 1, y: 23 }]),
                roadPathTick: 99999,
            };
        });
        return { stationSources: stations };
    };
    ctx.Memory.rooms = {
        W34N55: mkRoom("W34N55", [1700, 1370, 0]),      // 3070
        W35N55: mkRoom("W35N55", [2000, 2000, 2000]),   // 6000
        W33N55: { stationSources: {} },
    };
    ctx.Game.rooms = { W33N55: { name: "W33N55" } };
    ctx.Game.getObjectById = id => containers[id] || null;
    const spawnRoom = { name: "W33N55", my: true };

    assert.equal(S.outerMineEnergyWaiting(spawnRoom, "W34N55"), 3070, "按房取 W34N55 的存货");
    assert.equal(S.outerMineEnergyWaiting(spawnRoom, "W35N55"), 6000, "按房取 W35N55 的存货");
    assert.equal(S.outerMineEnergyWaiting(spawnRoom), 9070, "不传房名 = 全部外矿房之和");
    assert.equal(S.outerCarrierBacklogQuota(spawnRoom, "W34N55"), 1, "W34N55 只喂得起 1 只");
    assert.equal(S.outerCarrierBacklogQuota(spawnRoom, "W35N55"), 2, "W35N55 喂得起 2 只");

    // 关键：全局车数（这里模拟 5 只）已经超过全局配额，但 W35N55 只有 1 只
    // → 对 W35N55 必须仍然放行。
    const globalFleet = 5;
    const onW35 = 1;
    assert.ok(globalFleet >= S.outerCarrierBacklogQuota(spawnRoom),
        "全局判据会误判成「够了」");
    assert.ok(onW35 < S.outerCarrierBacklogQuota(spawnRoom, "W35N55"),
        "按房判据才看得出 W35N55 还缺车 → 必须放行");
}

console.log("edge link / hauler body / defence gate checks passed");