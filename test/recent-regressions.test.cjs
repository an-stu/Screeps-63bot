const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const missionSource = fs.readFileSync(path.join(root, "modules/manager_missions.js"), "utf8");

function loadMissionHandler(store, costRate = 0.2) {
    const sent = [];
    const terminal = {
        cooldown: 0,
        store,
        send(resourceType, amount, roomName) {
            sent.push({ resourceType, amount, roomName });
            return 0;
        }
    };
    const context = {
        console,
        global: null,
        Game: {
            rooms: { W1N1: { my: true, terminal } },
            market: { calcTransactionCost: amount => Math.ceil(amount * costRate) }
        },
        Memory: {},
        RESOURCE_ENERGY: "energy",
        OK: 0
    };
    context.global = context;
    vm.runInNewContext(missionSource, context, { filename: "manager_missions.js" });
    return { sendRes: context.missionFunc.sendRes, sent };
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 1000, X: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "X", amount: 5000 };
    assert.equal(sendRes(data), true);
    assert.equal(sent[0].amount, 5000, "mineral amount must not be reduced by energy transaction cost");
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 600, X: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "X", amount: 5000 };
    assert.equal(sendRes(data), false);
    assert.equal(sent[0].amount, 3000, "mineral send must be capped by available transaction energy");
    assert.equal(data.amount, 2000);
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "energy", amount: 5000 };
    assert.equal(sendRes(data), false);
    assert.equal(sent[0].amount, 4166, "energy send must reserve energy for its own transaction cost");
    assert.ok(sent[0].amount + Math.ceil(sent[0].amount * 0.2) <= 5000);
}

// harvestMineralOuterKeeper 的「捡尸体 / 捡掉落物」收尾块写在 if/else 之外，
// 而 mineral / container 原本是 else 块里的 `let` —— 收尾块一执行就必然
// `ReferenceError: container is not defined`（线上实测 errorCount 4198，
// lastErrorTick 83308420）。下面直接在 VM 里跑一遍真实的模块源码：
// 旧实现会抛 ReferenceError，新实现必须跑通并真的调用 transfer/withdraw/pickup。
const stationSourcesSource = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

function loadMineralKeeper({ withContainer = true, harvestCode = 0 } = {}) {
    const calls = [];
    const mineral = { id: "m1", mineralType: "H", mineralAmount: 1000 };
    const container = {
        id: "c1",
        pos: { isEqualTo: () => true },
        hits: 100,
        hitsMax: 100,
        // 新版收尾块会检查容器剩余空间（store.getFreeCapacity() > 50），
        // mock 必须提供 store 才能走到 transfer/withdraw/pickup 分支。
        store: { getFreeCapacity: () => 500 },
    };
    const tombstone = { id: "t1", store: { energy: 500 } };
    const drop = { resourceType: "H", id: "d1" };

    const context = {
        console,
        OK: 0,
        // station_sources 顶层会读这两个全局（1040/1041 行），必须给上，
        // 否则 VM 加载阶段就抛 isSaveCpu is not defined。
        isSaveCpu: true,
        RESOURCE_ENERGY: "energy",
        FIND_TOMBSTONES: 4,
        FIND_DROPPED_RESOURCES: 6,
        StationMineral: { stationName: "stationMineral" },
        UtilsTask: { task: (target, taskName) => ({ id: target.id, taskName }) },
        Memory: {
            rooms: {
                W1N1: {
                    stationMineral: withContainer ? { id: "m1", container: "c1", resType: "H" } : { id: "m1", resType: "H" },
                },
            },
        },
        Game: {
            time: 1000,
            shard: { name: "shard3" },
            getObjectById: id => (id === "m1" ? mineral : id === "c1" ? container : null),
        },
        Creep: function () {},
    };
    context.global = context;
    vm.runInNewContext(stationSourcesSource, context, { filename: "station_sources.js" });

    const creep = {
        name: "k1",
        ticksToLive: 85,               // 85 % 17 == 0 && > 40 → 收尾块会执行
        room: { name: "W1N1" },
        store: { getUsedCapacity: () => 100 },
        pos: {
            isEqualTo: () => true,
            findInRange: type => ({ head: () => (type === 4 ? tombstone : drop) }),
        },
        headTask: () => ({ id: "m1", roomName: "W1N1" }),
        harvest: () => { calls.push(["harvest"]); return harvestCode; },
        transfer: (t, res) => { calls.push(["transfer", t && t.id, res]); return 0; },
        withdraw: (t, res) => { calls.push(["withdraw", t && t.id, res]); return 0; },
        pickup: t => { calls.push(["pickup", t && t.id]); return 0; },
        repair: t => { calls.push(["repair", t && t.id]); return 0; },
        goTo: () => calls.push(["goTo"]),
    };
    context.Creep.prototype.harvestMineralOuterKeeper.call(creep);
    return calls;
}

{
    const calls = loadMineralKeeper();
    assert.ok(calls.some(c => c[0] === "transfer" && c[1] === "c1" && c[2] === "H"),
        "mineral keeper must move its mineral into the container instead of throwing ReferenceError");
    assert.ok(calls.some(c => c[0] === "withdraw" && c[1] === "t1" && c[2] === "energy"),
        "mineral keeper must withdraw energy from a nearby tombstone");
    assert.ok(calls.some(c => c[0] === "pickup" && c[1] === "d1"),
        "mineral keeper must pick up a nearby dropped resource");
    // 体型只有 CARRY:4（200）：捡到的能量若不立刻卸进容器，会占满 store 让
    // harvest 永远 ERR_FULL，而 repair 在容器满血时倒不掉 —— 整只爬卡到老死。
    assert.ok(calls.some(c => c[0] === "transfer" && c[1] === "c1" && c[2] === "energy"),
        "energy looted by the mineral keeper must be offloaded into the container the same tick");
}

{
    // 容器被打掉（stationMineral 里没有 container）时不能抛 TypeError，也不能把 null
    // 交给 repair —— 收尾块整段跳过，harvest 照旧执行。
    const calls = loadMineralKeeper({ withContainer: false, harvestCode: -8 });
    assert.ok(calls.some(c => c[0] === "harvest"), "mineral keeper must still harvest when its container is gone");
    assert.ok(!calls.some(c => c[0] === "transfer" || c[0] === "repair"),
        "a missing container must be skipped, not passed to transfer/repair");
}

console.log("recent regression checks passed");
