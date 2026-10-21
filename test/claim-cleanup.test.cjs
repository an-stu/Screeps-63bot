const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/strategy_claim.js"), "utf8");

/**
 * 载入真实模块，直接测 `isClaimCleanupTarget`。
 *
 * 用户 2026-10-21：claim 进来的房间里若残留别人的 spawn / extension，就**立不了工地**，
 * 必须先拆掉；storage 有资源可以先留，但要建自己的 storage 时必须拆。
 */
function load() {
    const ctx = {
        console,
        Game: { time: 100000, cpu: { bucket: 10000 } },
        Memory: { rooms: {} },
        Creep: function () {},
        Room: function () {},
        RoomPosition: function (x, y, r) { return { x, y, roomName: r }; },
        STRUCTURE_CONTROLLER: "controller",
        STRUCTURE_STORAGE: "storage",
        STRUCTURE_TERMINAL: "terminal",
        STRUCTURE_EXTENSION: "extension",
        STRUCTURE_SPAWN: "spawn",
        STRUCTURE_TOWER: "tower",
        STRUCTURE_CONTAINER: "container",
        STRUCTURE_ROAD: "road",
        STRUCTURE_RAMPART: "rampart",
        STRUCTURE_WALL: "constructedWall",
        Utils: { decodePosArray: s => (s ? JSON.parse(s) : []) },
        ManagerFlags: {}, StationHive: {}, ManagerRooms: {}, StationSources: {}, StationMineral: {},
        UtilsTask: {}, Logger: { info() {}, warning() {} },
        FIND_STRUCTURES: 101, FIND_MY_STRUCTURES: 102,
        OK: 0, ERR_NOT_IN_RANGE: -9, STRUCTURE_SPAWN_SITE: "spawn",
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_claim.js" });
    return ctx;
}

const roll = (level, blueprint = {}) => ({
    name: "W26N58",
    controller: { level: level },
    memory: { structMap: blueprint },
});

const struct = (type, opts = {}) => Object.assign({
    structureType: type,
    hits: 1000,
    hitsMax: 1000,
    store: { getUsedCapacity: () => 0 },
    my: false,
    owner: { username: "Rutt" },
}, opts);

const ctx = load();
const F = ctx.StrategyClaim.isClaimCleanupTarget;

// ① 别人的 spawn / extension / tower：一律要拆（它们占位，立不了工地）
for (const t of ["spawn", "extension", "tower"]) {
    assert.equal(F(roll(3), struct(t)), true, `别人的 ${t} 必须拆（否则创不了工地）`);
}

// ② 别人的 storage：RCL 还建不了自己的时候留着（有货/没货都留）
assert.equal(F(roll(3), struct("storage", { hits: 10000 })), false,
    "RCL3 还建不了 storage ⇒ 别人的 storage 先留着");
assert.equal(F(roll(3), struct("storage", {
    hits: 10000, store: { getUsedCapacity: () => 5000 },
})), false, "有货的 storage 必须保留");

// ③ RCL4 可以建自己的了：空 storage 才拆
assert.equal(F(roll(4), struct("storage", { hits: 10000 })), true,
    "RCL4 且 storage 是空的 ⇒ 拆掉腾位置建自己的");
assert.equal(F(roll(4), struct("storage", {
    hits: 10000, store: { getUsedCapacity: () => 5000 },
})), false, "RCL4 但里面还有货 ⇒ 先留着（别把资源埋了）");

// ④ terminal 同理：有货就留
assert.equal(F(roll(8), struct("terminal", {
    hits: 3000, store: { getUsedCapacity: () => 100 },
})), false, "有货的 terminal 保留");
assert.equal(F(roll(8), struct("terminal", { hits: 3000 })), true,
    "空 terminal 且是自己的房 ⇒ 拆");

// ⑤ 自己的东西和控制器：永远不动
assert.equal(F(roll(3), struct("extension", { my: true })), false, "自己的结构不拆");
assert.equal(F(roll(3), struct("controller", { owner: null })), false, "控制器不拆");
assert.equal(F(roll(3), struct("container", { hits: 0 })), false, "没有 hits 的不算目标");

// ⑥ **无主结构一律不拆**（用户 2026-10-21：别拆中立的建筑比如墙）
const blueprint = { container: JSON.stringify([{ x: 10, y: 10 }]) };
assert.equal(F(roll(3, blueprint), struct("container", { owner: null, pos: { x: 20, y: 20 } })), false,
    "蓝图外的无主容器也不拆（中立建筑不碰）");
assert.equal(F(roll(3), struct("constructedWall", { owner: null })), false,
    "无主的墙绝对不能拆");
assert.equal(F(roll(3), struct("road", { owner: null, hits: 5000 })), false, "无主的路不拆");
assert.equal(F(roll(3), struct("container", { owner: null })), false, "无主容器不拆");

// ⑦ 执行链必须真的会跑（用户 2026-10-21：「spawn 和 Extension 也没拆除」）：
//    COMPLETE 不能只看「有自己的 spawn 了」，不然残留结构再也没人管；
//    本房有 spawn 时要就地出土，体型要按容量缩（RCL3 只有 650 能量，5W/5C/5M 生不出来）。
{
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/ownedSpawns\.length && !cleanupTargets/.test(codeOnly),
        "COMPLETE 必须等清理目标清空（否则旗被删、残留结构永远留着）");
    assert.ok(/ownedSpawns\.length \? targetRoom : pro\.getSpawnRoom\(flag\)/.test(codeOnly),
        "本房有 spawn ⇒ cleaner 就地出土，不要跨房走 400 格");
    assert.ok(/Math\.floor\(\(spawnRoom\.energyCapacityAvailable \|\| 300\) \/ 200\)/.test(codeOnly),
        "cleaner 体型必须按出兵房能量容量缩");
}

console.log("claim cleanup checks passed");
