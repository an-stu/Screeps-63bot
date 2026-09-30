const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const stationSource = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

// lodash 的 Array 扩展在游戏里由全局加载提供；宿主/VM 两个 realm 都要用
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

const CONSTANTS = {
    OK: 0,
    RESOURCE_ENERGY: "energy",
    FIND_TOMBSTONES: 4,
    FIND_DROPPED_RESOURCES: 6,
    LOOK_STRUCTURES: "structures",
};

/** 简易 store 桩：支持数字下标读取 / getUsedCapacity / getFreeCapacity / getCapacity */
function makeStore(contents, capacity) {
    return {
        ...contents,
        getUsedCapacity(res) {
            if (res) return contents[res] || 0;
            return Object.keys(contents).reduce((s, k) => s + (contents[k] || 0), 0);
        },
        getFreeCapacity(res) { return capacity - this.getUsedCapacity(res); },
        getCapacity() { return capacity; },
    };
}

function makeContext() {
    const context = {
        ...CONSTANTS,
        console,
        isSaveCpu: true,
        Creep: function () {},
        StationMineral: { stationName: "stationMineral" },
        UtilsTask: {
            task: (target, taskName) => ({ id: target.id, taskName }),
            taskData: taskName => ({ taskName }),
        },
        Memory: { rooms: { W34N55: { stationMineral: { id: "m1", container: "c1", resType: "H", x: 43, y: 15 } } } },
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null },
    };
    context.global = context;
    vm.runInNewContext(stationSource, context, { filename: "station_sources.js" });
    return context;
}

function makeCreep(ctx, { x, y, roomName, store, capacity, near }) {
    const calls = [];
    const creep = {
        id: "cr1",
        pos: {
            x, y, roomName,
            isNearTo(t) { return near(t); },
            findInRange: () => [],
        },
        room: { name: roomName },
        store: null,
        headTask: () => ({ taskName: "harvestMineralOuterCarry", id: "m1", roomName: "W34N55", x: 43, y: 15, homeRoom: "W33N55" }),
        headTaskObj: () => undefined,
        mainRoom: () => ctx.Game.rooms.W33N55,
        popTask() { calls.push(["pop"]); return this; },
        addTask(t) { calls.push(["add"]); return this; },
        execLastTask() { calls.push(["exec"]); return this; },
        withdraw(t, res) { calls.push(["withdraw", res]); return 0; },
        transfer(t, res) { calls.push(["transfer", res]); return 0; },
        moveTo(t) { calls.push(["moveTo", t.x || (t.pos && t.pos.x)]); return 0; },
        repair() { calls.push(["repair"]); return 0; },
        harvest() { calls.push(["harvest"]); return 0; },
        pickup() { calls.push(["pickup"]); return 0; },
        goTo() { calls.push(["goTo"]); return 0; },
    };
    // withdraw/transfer 的量由引擎决定，这里手动维护 store 模拟真实流动
    creep.store = store;
    creep.calls = calls;
    return creep;
}

{
    // === 搬运回路：容器(能量1840+H160, 满仓)、矿床已采空 ===
    // 旧实现的死锁：清能量分支把能量取到身上，但回家条件只认 H → 爬扛着能量
    // 永远不回家，在容器边 withdraw→ERR_FULL 死循环，容器照样堵死。
    const ctx = makeContext();
    const container = {
        id: "c1", pos: { x: 43, y: 15, roomName: "W34N55" },
        store: makeStore({ energy: 1840, H: 160 }, 2000),
    };
    const mineral = { id: "m1", pos: { x: 43, y: 16, roomName: "W34N55" }, mineralAmount: 0 };
    ctx.Game.getObjectById = id => (id === "c1" ? container : id === "m1" ? mineral : null);
    const storage = { id: "s1", pos: { x: 21, y: 34, roomName: "W33N55" }, store: { energy: 50000 } };
    ctx.Game.rooms = { W33N55: { name: "W33N55", storage } };

    let store = makeStore({}, 1250);                     // CARRY:25
    const creep = makeCreep(ctx, { x: 44, y: 15, roomName: "W34N55", store });
    creep.pos.isNearTo = t => t.id === "c1";             // 站在容器边

    // 1) 矿床空了：H 尾量 160 直接清，不等攒批
    ctx.Creep.prototype.harvestMineralOuterCarry.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "withdraw" && c[1] === "H"), "tail H must be withdrawn");
    container.store = makeStore({ energy: 1840 }, 2000);   // H 已被取走

    // 2) 身上有货（H160）→ 立刻回家，而不是回容器继续取
    store = makeStore({ H: 160 }, 1250); creep.store = store;
    ctx.Creep.prototype.harvestMineralOuterCarry.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "moveTo" && c[1] === 21), "carrying H must head home");

    // 3) 到家：把 H 卸掉
    creep.pos.isNearTo = t => t.id === "s1";
    ctx.Creep.prototype.harvestMineralOuterCarry.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "transfer" && c[1] === "H"), "H must be transferred at storage");

    // 4) 回到容器：没有 H 但能量 1840 过半 → 清能量
    creep.pos.isNearTo = t => t.id === "c1";
    store = makeStore({}, 1250); creep.store = store;
    ctx.Creep.prototype.harvestMineralOuterCarry.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "withdraw" && c[1] === "energy"),
        "energy over half the container must be cleared");

    // 5) 关键回归：身上只有能量（没有 H）→ 必须回家卸货（旧实现死循环在这里）
    store = makeStore({ energy: 1250 }, 1250); creep.store = store;
    creep.calls.length = 0;
    ctx.Creep.prototype.harvestMineralOuterCarry.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "moveTo" && c[1] === 21),
        "carrying ONLY energy must still head home (the wedge regression)");

    // 6) 到家：能量也要卸掉
    creep.pos.isNearTo = t => t.id === "s1";
    ctx.Creep.prototype.harvestMineralOuterCarry.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "transfer" && c[1] === "energy"),
        "cleared energy must actually be delivered home");

    // 7) 矿还在产、H 没攒够批、能量也没过半 → 站着等，不瞎取
    mineral.mineralAmount = 35000;
    container.store = makeStore({ energy: 200, H: 100 }, 2000);
    store = makeStore({}, 1250); creep.store = store;
    creep.pos.isNearTo = t => t.id === "c1";
    creep.calls.length = 0;
    ctx.Creep.prototype.harvestMineralOuterCarry.call(creep);
    assert.ok(!creep.calls.some(c => c[0] === "withdraw") && !creep.calls.some(c => c[0] === "moveTo"),
        "must wait for the H batch instead of making tiny trips");
}

{
    // === 采集爬：容器没空位就不再捡能量（捡了卸不下会把自己塞死） ===
    const ctx = makeContext();
    const container = {
        id: "c1", pos: { x: 43, y: 15, roomName: "W34N55", isEqualTo: () => true },
        store: makeStore({ energy: 2000 }, 2000),
    };
    const mineral = { id: "m1", pos: { x: 43, y: 16, roomName: "W34N55" }, mineralType: "H", mineralAmount: 0 };
    ctx.Game.getObjectById = id => (id === "c1" ? container : id === "m1" ? mineral : null);

    const calls = [];
    const keeper = {
        id: "k1", ticksToLive: 85,
        pos: {
            x: 43, y: 16, roomName: "W34N55",
            isEqualTo: () => true,
            findInRange(type) {
                if (type == CONSTANTS.FIND_TOMBSTONES) return [{ id: "t1", store: { energy: 500 } }];
                if (type == CONSTANTS.FIND_DROPPED_RESOURCES) return [{ id: "d1", resourceType: "energy" }];
                return [];
            },
        },
        room: { name: "W34N55" },
        store: makeStore({}, 200),
        headTask: () => ({ id: "m1", roomName: "W34N55" }),
        harvest() { calls.push(["harvest"]); return 0; },
        transfer(t, res) { calls.push(["transfer", res]); return 0; },
        withdraw(t, res) { calls.push(["withdraw", res]); return 0; },
        pickup(t) { calls.push(["pickup"]); return 0; },
        repair(t) { calls.push(["repair"]); return 0; },
        addTask() { return this; },
        addTaskAndExec() { return this; },
    };
    ctx.Creep.prototype.harvestMineralOuterKeeper.call(keeper);
    assert.ok(!calls.some(c => c[0] === "withdraw") && !calls.some(c => c[0] === "pickup"),
        "a full container must stop the keeper from looting more energy");
}

console.log("outer mineral checks passed");
