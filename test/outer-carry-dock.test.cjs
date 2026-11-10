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
// 宿主 realm 的数组扩展：⑤ 动态平衡用例的 creep.memory.tasks 在宿主创建，
// 而 headTask() 在 VM 里执行 —— 两边都要有 .head/.last（与 sticky 测试同一做法）
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}
if (!Array.prototype.last) {
    Object.defineProperty(Array.prototype, "last", {
        value: function () { return this.length ? this[this.length - 1] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}
// 断言前剥注释：注释里会原样引用被删的表达式（本仓库既有踩坑）
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── ② 待命格几何（跑真实函数）────────────────────────────────────────────
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
    vm.runInNewContext(src === undefined ? raw : src, ctx);
    return ctx;
}

// ── ① 待命判据（纯函数，跑真实代码）──────────────────────────────────────
// 0.78.163 曾经在这里挂过「carryWait < OUTER_CARRY_FILL_WAIT」的上限，结果空车
// 一累到 150 就永久失效（carryWait 只有**有货回程**才清零），于是车被赶回卸货口，
// 死锁原样复发。这一组断言专门锁死「判据只看库存」这件事。
{
    const S = makeContext().StationSources;
    assert.equal(typeof S.outerCarryShouldHold, "function", "outerCarryShouldHold 必须挂在 StationSources 上");
    const cont = energy => ({ store: { energy: energy } });
    const creep = (energy, extra) => Object.assign({ store: { energy: energy } }, extra || {});

    assert.equal(S.outerCarryShouldHold(creep(0), cont(0)), true, "空车 + 干涸卸货口 ⇒ 该退开");
    assert.equal(S.outerCarryShouldHold(creep(0), cont(400)), false, "卸货口有货 ⇒ 去装，不许退");
    assert.equal(S.outerCarryShouldHold(creep(300), cont(0)), false, "带半车货 ⇒ 不许退开");
    // 回归：带上任何「等太久了」的残留计数都必须照样退开（旧版就是把这里判死）
    assert.equal(S.outerCarryShouldHold(creep(0, { memory: { carryWait: 150 } }), cont(0)), true,
        "carryWait 到上限也必须继续退开 —— 否则闸门自锁，死锁复发");
    assert.equal(S.outerCarryShouldHold(creep(0, { memory: { carryWait: 9999 } }), cont(0)), true,
        "更大的残留值同样不能把判据判死");
    assert.equal(S.outerCarryShouldHold(null, cont(0)), false, "没有爬 ⇒ 不动作");
    assert.equal(S.outerCarryShouldHold(creep(0), null), false, "没有容器 ⇒ 不动作");
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

// ── ③ 调用点：待命判定必须在「走到容器」之前，且条件只由库存决定 ──────────
{
    const fn = code.slice(code.indexOf("Creep.prototype.harvestEnergyOuterCarry = function"));
    const body = fn.slice(0, fn.indexOf("\n};"));
    const holdIdx = body.indexOf("pro.outerCarryShouldHold(this, container)");
    const approachIdx = body.indexOf("if (!this.pos.isNearTo(container))");
    assert.ok(holdIdx > 0, "harvestEnergyOuterCarry 里必须调用 outerCarryShouldHold");
    assert.ok(approachIdx > 0, "harvestEnergyOuterCarry 里应有走近容器的分支");
    assert.ok(holdIdx < approachIdx,
        "待命判定必须在「走近容器」之前 —— 否则车已经贴到卸货口了才退，堵还是堵");

    // 调用点不许自己再挂时长上限：闸门必须收敛在 outerCarryShouldHold 里一处
    const guard = body.slice(Math.max(0, holdIdx - 400), holdIdx);
    assert.ok(!/carryWait/.test(guard), "调用点不许再用 carryWait 当闸门（0.78.164 的闸门自锁根因）");
    assert.ok(!/OUTER_CARRY_FILL_WAIT/.test(guard), "待命不许有 FILL_WAIT 上限：空车没有回程可走");
    const holdBlock = body.slice(holdIdx, holdIdx + 300);
    assert.ok(/this\.memory\.holdWait = \(this\.memory\.holdWait \|\| 0\) \+ 1/.test(holdBlock),
        "待命期间应累加到 holdWait（纯观测用，不再当闸门）");
}

// ── ④ 负对照：把「容器有货就不退」的守卫改成恒假，① 必须因此失败 ──────────
// 断言落在**行为**上（同一组输入得到相反结果），不是「源码里少了一行」。
{
    const broken = raw.replace("if (container.store[RESOURCE_ENERGY] > 0) return false;",
        "if (false) return false;");
    assert.notEqual(broken, raw, "负对照没生效：没改到守卫");
    const B = makeContext(broken).StationSources;
    assert.equal(B.outerCarryShouldHold({ store: { energy: 0 } }, { store: { energy: 400 } }), true,
        "负对照应当把「卸货口有货」判成该退开 —— 这正是守卫被拆掉之后的行为");
    assert.equal(makeContext().StationSources
        .outerCarryShouldHold({ store: { energy: 0 } }, { store: { energy: 400 } }), false,
        "真实代码必须与负对照相反（否则说明守卫没起作用）");
}

// ── ④ 待命移动必须带 reusePath（静态目标，MEMORY 记的 10 倍 CPU 差）──────
{
    const tile = raw.slice(raw.indexOf("outerCarryHoldOffRoad(creep, data, container)"));
    const body = tile.slice(0, tile.indexOf("\n    },"));
    assert.ok(/moveTo\(new RoomPosition\([^)]*\), \{ reusePath: \d+ \}\)/.test(body),
        "待命移动的目标是静态格，必须传 reusePath");
    assert.ok(/memory\.holdPos/.test(body), "待命格要缓存，不能每 tick 重扫一片区域");
}

// ── ⑤ 动态平衡（0.78.225，用户：「carrier 有点不平衡，动态平衡」）────────────
// 车与源静态绑死，负载不均/重启期会摆出「一个容器 1896 满仓、另一个 16 空仓」
// 的错位（W26N59 实测 2026-11-08）。空手 + 绑定容器 <400 + 同房另一容器 ≥800
// ⇒ 任务就地换绑（id/x/y/stationId 一起改，returnPathIndex 作废）；两边都低
// 时不动（防两辆空车互相倒腾抖动）。
{
    const C = makeContext(raw);
    const ctA = { id: "ctA", store: { energy: 100 }, pos: { x: 29, y: 5, roomName: "W26N59" } };
    const ctB = { id: "ctB", store: { energy: 1200 }, pos: { x: 28, y: 30, roomName: "W26N59" } };
    // Duplicate stale registration models memory written before retasking began
    // migrating carryCreeps. Stale copies at the pinned source and destination are
    // cleaned immediately; older target registrations are pruned during quota reads.
    const srcA = { id: "srcA", container: "ctA", roomName: "W26N59", x: 29, y: 4, carryCreeps: ["c1", "c1"] };
    const srcB = { id: "srcB", container: "ctB", roomName: "W26N59", x: 27, y: 29, carryCreeps: ["c1", "c1"] };
    C.Memory.rooms.W26N59 = { stationSources: { srcA: srcA, srcB: srcB } };
    C.Game.getObjectById = id => (id == "ctA" ? ctA : id == "ctB" ? ctB : null);

    const creep = new C.Creep();
    Object.assign(creep, {
        id: "c1",
        memory: { tasks: [
            { taskName: "harvestEnergyOuterCarry", id: "srcA", roomName: "W26N59", x: 29, y: 4 },
            { taskName: "harvestEnergyOuterCarryRoadBuilder", mineRoom: "W26N59", stationId: "srcA", roadDir: 1 },
        ] },
        store: { getUsedCapacity: () => 0, getFreeCapacity: () => 1600 },
        storeEmpty() { return this.store.getUsedCapacity() == 0; },
        room: { name: "W26N59" },
        pos: { x: 29, y: 5, roomName: "W26N59", findInRange: () => [], isNearTo: () => false },
        headTask() { return this.memory.tasks.head(); },
        lastTask() { return this.memory.tasks.last(); },
        popTask() { this.memory.tasks.pop(); return this; },
        addTask(t) { [].concat(t).forEach(x => this.memory.tasks.push(x)); return this; },
        execLastTask() { this.__exec = (this.__exec || 0) + 1; return this; },
        moveTo() { return 0; },
        goTo() { return 0; },
        withdraw() { return 0; },
        pickup() { return 0; },
        say() {},
    });
    C.Game.creeps = { c1: creep };
    creep.room.find = () => [];

    C.StationSources && C.StationSources;   // no-op
    const S = C.StationSources;
    creep.harvestEnergyOuterCarry();

    const carryTask = creep.memory.tasks[0];
    const roadTask = creep.memory.tasks[1];
    assert.equal(carryTask.id, "srcB", "绑定容器没货而另一容器 ≥800 ⇒ carry 任务换绑到有货矿点");
    assert.equal(carryTask.x, 27, "换绑必须连坐标一起改（goTo/路线用 x/y）");
    assert.equal(roadTask.stationId, "srcB", "roadBuilder 子任务的 stationId 也要同步换绑");
    assert.ok(!("returnPathIndex" in carryTask), "换绑后旧路线缓存索引必须作废");
    assert.equal(srcA.carryCreeps.length, 0, "动态换绑必须清除旧源的全部 stale 重复登记，避免压住旧源补员");
    assert.equal(srcB.carryCreeps.length, 1, "新源必须恰好登记一次，不因已有 stale 重复而重复计车");
    assert.equal(srcB.carryCreeps[0], "c1", "新源保留当前 creep 的唯一登记");
    assert.ok(creep.__exec >= 1, "换绑后立即按新绑点行动");
}

// ── ⑤b 防抖负对照：两边容器都低（<800）⇒ 不换绑（防两辆空车互相倒腾）──────
{
    const C = makeContext(raw);
    const ctA = { id: "ctA", store: { energy: 100 }, pos: { x: 29, y: 5, roomName: "W26N59" } };
    const ctB = { id: "ctB", store: { energy: 300 }, pos: { x: 28, y: 30, roomName: "W26N59" } };
    const srcA = { id: "srcA", container: "ctA", roomName: "W26N59", x: 29, y: 4 };
    const srcB = { id: "srcB", container: "ctB", roomName: "W26N59", x: 27, y: 29 };
    C.Memory.rooms.W26N59 = { stationSources: { srcA: srcA, srcB: srcB } };
    C.Game.getObjectById = id => (id == "ctA" ? ctA : id == "ctB" ? ctB : null);

    const creep = new C.Creep();
    Object.assign(creep, {
        memory: { tasks: [
            { taskName: "harvestEnergyOuterCarry", id: "srcA", roomName: "W26N59", x: 29, y: 4 },
        ] },
        store: { getUsedCapacity: () => 0, getFreeCapacity: () => 1600 },
        storeEmpty() { return true; },
        room: { name: "W26N59" },
        pos: { x: 29, y: 5, roomName: "W26N59", findInRange: () => [], isNearTo: () => false },
        headTask() { return this.memory.tasks.head(); },
        lastTask() { return this.memory.tasks.last(); },
        popTask() { this.memory.tasks.pop(); return this; },
        addTask(t) { [].concat(t).forEach(x => this.memory.tasks.push(x)); return this; },
        execLastTask() { return this; },
        moveTo() { return 0; },
        goTo() { return 0; },
        withdraw() { return 0; },
        pickup() { return 0; },
        say() {},
    });
    C.Game.creeps = { c1: creep };
    creep.room.find = () => [];

    creep.harvestEnergyOuterCarry();
    assert.equal(creep.memory.tasks[0].id, "srcA",
        "另一容器只有 300（<800 防抖线）⇒ 不许换绑，否则两辆空车互相倒腾");
}

console.log("outer-carry-dock: OK");
