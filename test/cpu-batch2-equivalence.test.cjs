/**
 * CPU batch-2（v0.78.249）低风险三项的可证等价回归。
 *
 * ① carryEnergyAuto 房级 tick 缓存：新旧实现随机布局差分 500 轮 + 多车共享语义；
 * ② keeper link2 条件查询：三态（缺失/不满/满）选择等价 + 查询计数下降；
 * ③ observer watchRoom：存在即不写（写计数），创建时仍写。
 * 负对照：缓存忽略 tick / link2 恢复无条件 / watchRoom 恢复无条件赋值，必须被咬住。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = n => fs.readFileSync(path.join(root, "modules", n), "utf8");
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── 源码层：三项改动必须在代码里 ──────────────────────────────────────────
{
    const creep = strip(read("prototype_creep.js"));
    assert.ok(/let scan = room\._carryAutoScan;/.test(creep), "carryEnergyAuto 必须用房级 tick 缓存");
    assert.ok(/scan\.tick !== Game\.time/.test(creep), "缓存必须按 tick 失效");
    const src = strip(read("station_sources.js"));
    assert.ok(/if \(!link \|\| link\.store\[RESOURCE_ENERGY\] == 800\) \{/.test(src),
        "link2 只在主 link 缺失或满能量时查询");
    const obs = strip(read("station_observer.js"));
    assert.ok(/if \(!watch\) watch = Memory\.observerWatch = \{\};/.test(obs),
        "watchRoom 只在创建时写 Memory");
    assert.ok(!/return Memory\.observerWatch\[roomName\] = Memory\.observerWatch\[roomName\] \|\| \{\};/.test(obs),
        "不能再无条件赋值（每 tick 标脏整份 Memory）");
}

// ── ① carryEnergyAuto 新旧差分 ────────────────────────────────────────────
const creepSrc = read("prototype_creep.js");
const fnMatch = creepSrc.match(/\nCreep\.prototype\.carryEnergyAuto = function \(\) \{[\s\S]*?\n\};/);
assert.ok(fnMatch, "carryEnergyAuto 必须存在");
const NEW_FN = fnMatch[0];
const OLD_FN = NEW_FN.replace(
    /let scan = room\._carryAutoScan;[\s\S]*?scan\.containers\.forEach\(item => \{\s*if \(!room\.used\[item\.object\.id\]\) candidates\.push\(item\);\s*\}\);/,
    `if (room.memory[StationSources.stationName]) {
            _.values(room.memory[StationSources.stationName]).forEach(data => {
                let container = data && Game.getObjectById(data.container);
                if (container && !room.used[container.id]) {
                    candidates.push({object:container, available:container.store[RESOURCE_ENERGY] || 0, type:"container"});
                }
            });
        }`);
assert.notEqual(OLD_FN, NEW_FN, "旧实现还原必须成功（负对照的前提）");

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function loadCarry(fnSrc) {
    const objects = {};
    const ctx = {
        console,
        Creep: function () {},
        Game: { time: 100, getObjectById: id => objects[id] || null },
        Memory: { creeps: {} },
        StationSources: { stationName: "stationSources" },
        _: { values: o => Object.values(o || {}) },
        RESOURCE_ENERGY: "energy", OK: 0,
    };
    ctx.global = ctx;
    vm.runInNewContext(fnSrc, ctx, { filename: "carryEnergyAuto.js" });
    return { ctx, objects, carry: ctx.Creep.prototype.carryEnergyAuto };
}

function makeWorld(rand, objects) {
    // 随机布局：1-4 个源容器 + terminal + storage，随机 used 预约
    const stationSources = {};
    const n = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
        const id = "cont" + i;
        const energy = Math.floor(rand() * 2200);
        objects[id] = { id, store: { energy } };
        stationSources[id] = { container: id };
    }
    const terminal = rand() < 0.8
        ? { id: "term", store: { energy: Math.floor(rand() * 80000) } } : null;
    if (terminal) objects.term = terminal;
    const storage = { id: "stor", store: { energy: Math.floor(rand() * 100000) } };
    objects.stor = storage;
    const used = {};
    for (let i = 0; i < n; i++) if (rand() < 0.3) used["cont" + i] = true;
    if (terminal && rand() < 0.2) used.term = true;
    const room = { used, terminal, storage, memory: { stationSources } };
    return room;
}

function runCarry(carry, objects, room, opts) {
    const task = { taskName: "carryEnergyAuto" };
    if (opts.pinned) { task.sourceId = opts.pinned; task.sourceType = "container"; }
    if (opts.allowStorage) task.allowStorage = true;
    const moves = [], withdraws = [];
    let pops = 0;
    const creep = {
        memory: { tasks: [task] },
        store: { energy: 0, getFreeCapacity: () => opts.load },
        room,
        pos: { isNearTo: () => opts.near },
        lastTask: () => task,
        popTask() { pops++; return creep; },
        execLastTask: () => creep,
        moveTo: t => { moves.push(t.id); return 0; },
        withdraw: (t, res, amt) => { withdraws.push([t.id, amt]); return 0; },
    };
    carry.call(creep);
    return { sourceId: task.sourceId, sourceType: task.sourceType, moves, withdraws, pops };
}

{
    const rand = mulberry32(20261113);
    for (let round = 0; round < 500; round++) {
        const opts = {
            load: 100 + Math.floor(rand() * 1600),
            allowStorage: rand() < 0.4,
            near: rand() < 0.5,
            pinned: rand() < 0.25 ? "cont0" : undefined,
        };
        const a = loadCarry(NEW_FN), b = loadCarry(OLD_FN);
        const roomA = makeWorld(rand, a.objects);
        // 同一布局给旧实现（重建相同对象图；必须填进闭包引用的原 map）
        const bObjects = {};
        const roomB = JSON.parse(JSON.stringify(roomA));
        for (const id in a.objects) bObjects[id] = { id, store: { ...a.objects[id].store } };
        Object.assign(b.objects, bObjects);
        // roomB 的 terminal/storage 引用要指向 bObjects
        if (roomB.terminal) roomB.terminal = bObjects.term;
        roomB.storage = bObjects.stor;
        const ra = runCarry(a.carry, a.objects, roomA, opts);
        const rb = runCarry(b.carry, b.objects, roomB, opts);
        assert.deepEqual(ra, rb, "round " + round + " 新旧选择必须逐例一致");
    }
}

// ── ① b 多车共享缓存：预约演进 + allowStorage 差异，选择仍与旧实现一致 ────
{
    const rand = mulberry32(777);
    const a = loadCarry(NEW_FN), b = loadCarry(OLD_FN);
    const roomA = makeWorld(rand, a.objects);
    const roomB = JSON.parse(JSON.stringify(roomA));
    const bObjects = {};
    for (const id in a.objects) bObjects[id] = { id, store: { ...a.objects[id].store } };
    Object.assign(b.objects, bObjects);
    if (roomB.terminal) roomB.terminal = bObjects.term;
    roomB.storage = bObjects.stor;
    const seq = [
        { load: 800, allowStorage: false, near: false },
        { load: 1600, allowStorage: true, near: true },
        { load: 400, allowStorage: false, near: false },
        { load: 1200, allowStorage: true, near: true },
    ];
    seq.forEach((opts, i) => {
        // 同一 tick 内 room.used 由前一只车写入（两实现同步演进）
        const ra = runCarry(a.carry, a.objects, roomA, opts);
        const rb = runCarry(b.carry, b.objects, roomB, opts);
        assert.deepEqual(ra, rb, "多车序列第 " + i + " 只选择必须一致（共享缓存不改语义）");
    });
}

// ── ① c 缓存 tick 失效：跨 tick 库存变化必须被看见（负对照 M1 咬这里） ────
{
    const a = loadCarry(NEW_FN);
    const room = { used: {}, terminal: null, storage: null,
        memory: { stationSources: { c0: { container: "c0" } } } };
    a.objects.c0 = { id: "c0", store: { energy: 100 } };
    const opts = { load: 800, allowStorage: false, near: false };
    const r1 = runCarry(a.carry, a.objects, room, opts);
    assert.equal(r1.sourceId, undefined, "100 能量不够装 800 ⇒ 不选");
    a.ctx.Game.time = 101;
    a.objects.c0.store.energy = 1500;
    const r2 = runCarry(a.carry, a.objects, room, opts);
    assert.equal(r2.sourceId, "c0", "跨 tick 库存变化必须被新扫描看见");
    // M1：缓存忽略 tick ⇒ 读到旧库存
    const m1 = loadCarry(NEW_FN.replace("if (!scan || scan.tick !== Game.time) {", "if (!scan || false) {"));
    const room2 = { used: {}, terminal: null, storage: null,
        memory: { stationSources: { c0: { container: "c0" } } } };
    m1.objects.c0 = { id: "c0", store: { energy: 100 } };
    runCarry(m1.carry, m1.objects, room2, opts);
    m1.ctx.Game.time = 101;
    m1.objects.c0.store.energy = 1500;
    const r3 = runCarry(m1.carry, m1.objects, room2, opts);
    assert.equal(r3.sourceId, undefined, "M1：忽略 tick 的缓存读旧值（用例①c 咬得住）");
}

// ── ② keeper link2 条件查询：三态选择等价 + 查询计数 ─────────────────────
{
    const src = read("station_sources.js");
    const block = src.match(/let link = station\.link \? Game\.getObjectById\(station\.link\) : undefined;[\s\S]*?link\.store\[RESOURCE_ENERGY\] == 800\) link = link2/);
    assert.ok(block, "link 解析块必须存在");
    const NEW_BLOCK = block[0];
    const OLD_BLOCK = NEW_BLOCK.replace(
        /let link2;\s*if \(!link \|\| link\.store\[RESOURCE_ENERGY\] == 800\) \{\s*link2 = station\["link2"\] \? Game\.getObjectById\(station\["link2"\]\) : undefined;\s*\}/,
        'let link2 = station["link2"] ? Game.getObjectById(station["link2"]) : undefined;');
    assert.notEqual(OLD_BLOCK, NEW_BLOCK, "旧实现还原必须成功");

    function runLink(blockSrc, station, objs) {
        let queries = 0;
        const ctx = {
            Game: { getObjectById: id => { queries++; return objs[id] || null; } },
            RESOURCE_ENERGY: "energy",
            station,
        };
        vm.runInNewContext(blockSrc + "\n;__result = link;", ctx);
        return { link: ctx.__result, queries };
    }
    const mkLink = (id, energy) => ({ id, store: { energy, getUsedCapacity: () => energy } });
    const states = [];
    for (const primary of [null, 0, 400, 800]) {
        for (const secondary of [null, 0, 800]) {
            states.push({ primary, secondary });
        }
    }
    for (const { primary, secondary } of states) {
        const objs = {};
        const station = {};
        if (primary !== null) { station.link = "L1"; objs.L1 = mkLink("L1", primary); }
        if (secondary !== null) { station.link2 = "L2"; objs.L2 = mkLink("L2", secondary); }
        const rn = runLink(NEW_BLOCK, station, objs);
        const ro = runLink(OLD_BLOCK, station, objs);
        assert.equal(rn.link && rn.link.id, ro.link && ro.link.id,
            "link 选择必须等价（primary=" + primary + " secondary=" + secondary + "）");
        if (primary !== null && primary !== 800 && secondary !== null) {
            assert.ok(rn.queries < ro.queries,
                "主 link 不满时必须省掉 link2 查询（新 " + rn.queries + " < 旧 " + ro.queries + "）");
        }
    }
}

// ── ③ observer watchRoom：存在即不写 ─────────────────────────────────────
{
    const obs = read("station_observer.js");
    const fn = obs.match(/\n {4}watchRoom \(roomName\) \{[\s\S]*?\n {4}\},/);
    assert.ok(fn, "watchRoom 必须存在");
    function runWatch(src) {
        let writes = 0;
        const watchStore = {};
        const Memory = {};
        Object.defineProperty(Memory, "observerWatch", {
            get() { return watchStore.__val; },
            set(v) { writes++; watchStore.__val = v; },
            configurable: true,
        });
        const ctx = { Memory };
        vm.runInNewContext("var pro = {" + src + "\n};", ctx);
        return { pro: ctx.pro, writes: () => writes, Memory };
    }
    const w = runWatch(fn[0]);
    const first = w.pro.watchRoom("W1N1");
    assert.ok(first && typeof first === "object", "首次调用创建观察对象");
    assert.equal(w.writes(), 1, "Memory.observerWatch 只在首次创建时赋值一次");
    const again = w.pro.watchRoom("W1N1");
    assert.equal(again, first, "必须返回同一对象");
    assert.equal(w.writes(), 1, "已存在时不得再写 Memory（旧实现每次调用 +1）");
    const other = w.pro.watchRoom("W2N2");
    assert.ok(other && other !== first, "新房创建新观察对象");
    assert.equal(w.writes(), 1, "新房键创建也不得重赋 Memory.observerWatch");
    assert.equal(w.pro.watchRoom("W2N2"), other, "新房第二次调用返回同一对象");
    assert.equal(w.writes(), 1);
    // M3：恢复无条件赋值 ⇒ 每次调用都写
    const m3 = runWatch(fn[0].replace(
        /let watch = Memory\.observerWatch;\s*if \(!watch\) watch = Memory\.observerWatch = \{\};\s*return watch\[roomName\] \|\| \(watch\[roomName\] = \{\}\);/,
        'Memory.observerWatch = Memory.observerWatch || {};\n        return Memory.observerWatch[roomName] = Memory.observerWatch[roomName] || {};'));
    m3.pro.watchRoom("W1N1");
    const before = m3.writes();
    m3.pro.watchRoom("W1N1");
    assert.ok(m3.writes() > before, "M3：无条件赋值每次都写（用例③咬得住）");
}

console.log("cpu batch-2 equivalence: OK");