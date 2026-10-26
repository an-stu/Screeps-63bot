const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/极致建筑缓存 v1.4.3.js"), "utf8");

/**
 * room.<资源类型> getter（例：room.energy / room.power）的 per-tick 缓存必须
 * **按房间**存放。原实现把 last_fetch_time/sum 放在原型闭包里按资源类型共享：
 * 同一 tick 先读 A 房再读 B 房，B 直接拿到 A 的数值（mass_stores 完全不同）。
 * 当前业务代码都走 roomMassStoreCnt 没踩到，但库文档（例5/例6）宣称该用法，
 * 这里把语义钉死，防止回归或未来调用者静默拿到错误库存。
 */
function makeContext(roomSpecs, time) {
    const structureTypes = ["spawn", "extension", "road", "wall", "rampart", "keeperLair", "portal",
        "link", "tower", "lab", "container", "powerBank", "observer", "powerSpawn", "extractor",
        "nuker", "factory", "invaderCore"];
    const ctx = {
        console,
        Game: { time: time, getObjectById: () => undefined },
        RESOURCES_ALL: ["energy", "power"],
        LOOK_MINERALS: "mineral", LOOK_SOURCES: "source",
        LOOK_DEPOSITS: "deposit", LOOK_CONSTRUCTION_SITES: "constructionSite",
        FIND_MINERALS: 114, FIND_STRUCTURES: 107,
        _: {
            groupBy: (arr, fn) => arr.reduce((acc, x) => {
                const k = fn(x);
                (acc[k] = acc[k] || []).push(x);
                return acc;
            }, {}),
        },
    };
    structureTypes.forEach(t => {
        ctx["STRUCTURE_" + t.replace(/(^|[a-z])([A-Z])/g, (m, a, b) => a + "_" + b).toUpperCase()] = t;
    });
    ctx.Room = function (name) { this.name = name; };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "structure-cache.js" });

    // 房间实例必须在 VM realm 里创建，getter 的原型链才生效
    const rooms = roomSpecs.map(spec => {
        const room = new ctx.Room(spec.name);
        room.storage = spec.storage;
        room.find = type => type == ctx.FIND_STRUCTURES ? [spec.storage] : []; // 供 mass_stores 解析 id
        room.lookForAtArea = () => [];   // LOOK_* 扫描空结果
        ctx.Room.prototype.update.call(room); // 预热缓存 = new Hub(room)
        return room;
    });
    return { ctx, rooms };
}

function makeRoom(name, storageStore) {
    return { name: name, storage: { id: "st_" + name, store: storageStore }, terminal: undefined };
}

{
    const { ctx, rooms } = makeContext(
        [makeRoom("A", { energy: 100, power: 7 }), makeRoom("B", { energy: 5, power: 77 })], 1000);
    const [A, B] = rooms;

    const get = (room, type) => Object.getOwnPropertyDescriptor(ctx.Room.prototype, type).get.call(room);

    assert.equal(get(A, "energy"), 100, "room A energy");
    assert.equal(get(B, "energy"), 5, "room B energy must not see room A's cached sum (same tick)");
    assert.equal(get(B, "power"), 77, "room B power");
    assert.equal(get(A, "power"), 7, "room A power after reading B (per-room cache, both directions)");

    // 同 tick 重复读走缓存（值不变）
    A.storage.store.energy = 999;
    assert.equal(get(A, "energy"), 100, "same-tick repeat read must stay cached");

    // 下一 tick 重算
    ctx.Game.time = 1001;
    assert.equal(get(A, "energy"), 999, "next tick must recompute after the store changed");
}
console.log("structure-cache resource getters: per-room cache OK");
