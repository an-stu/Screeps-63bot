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
    assert.ok(/pro\.destroyForeignStructures\(targetRoom\)/.test(codeOnly),
        "清理必须走 destroy()（用户 2026-10-21：本房内可直接删别人的结构），不派 cleaner");
    // 只剩**未占领时**那一次 spawnCleaner（那时房还不是我们的，destroy 无效）；
    // 「本房是我的」分支里不能再派 cleaner。
    assert.equal((codeOnly.match(/spawnCleaner|claimCleaner|clearClaimRoom/g) || []).length, 0,
        "cleaner 那条链路必须整条删掉（用户 2026-10-21：都打算 claim 了，就别 cleaner 了）");
    assert.ok(/room\.find\(FIND_STRUCTURES\)\.forEach\(structure => \{/.test(codeOnly),
        "destroy 逻辑必须逐结构遍历房间（一次 API 调用删一个）");
}

// ⑧ destroyForeignStructures：只删「别人的有主结构」，中立/自己的/该留的 storage 都不动
{
    const ctx2 = load();
    const destroyed = [];
    const mk = (type, owner, extra = {}) => Object.assign({
        structureType: type, hits: 1000, my: false,
        owner: owner ? { username: owner } : null,
        store: { getUsedCapacity: () => 0 },
        destroy() { destroyed.push(type + "@" + owner); return 0; },
    }, extra);
    const room = {
        name: "W26N58", my: true,
        controller: { level: 3 },
        memory: {},
        find: () => [
            mk("tower", "Rutt"),                                   // 别人的塔 → 删
            mk("extension", "Rutt"),                               // 别人的 extension → 删
            mk("spawn", "Rutt"),                                   // 别人的 spawn → 删
            mk("storage", "Rutt", { hits: 10000 }),                // RCL3 ⇒ 留
            mk("extension", null),                                 // 中立 → 不删
            mk("constructedWall", null),                           // 中立墙 → 不删
            mk("extension", "me", { my: true }),                   // 自己的 → 不删
        ],
    };
    const n = ctx2.StrategyClaim.destroyForeignStructures(room);
    assert.equal(n, 3, "只删 3 个别人的有主结构");
    assert.deepEqual(destroyed.sort(), ["extension@Rutt", "spawn@Rutt", "tower@Rutt"],
        "删的正好是 tower / extension / spawn，中立与自己的都没动");
}

console.log("claim cleanup checks passed");
