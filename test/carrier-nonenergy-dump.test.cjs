/**
 * 载着**非能量**货物的空转 carrier 必须能倒货（2026-11-01 E48S41 实测）。
 *
 * 现场：E48S41 一只 carrier 抱着 `{O:1650}` 在 (16,45) 站了 200+ tick
 * （ttl 1035 → 903），`memory.tasks` 恒空。它进不去任何一条路：
 *   · hive 缺能分支的过滤器带 `!storeContainsEnergyOtherResType()`
 *     —— 载矿物不能填 spawn/extension，排除是对的；
 *   · 唯一的「倒进 storage」出口 `if (!HiveNeedToFill(room))` 要求 hive 已吃饱
 *     —— hive 一缺能就整段跳过。
 * 后果：该房只剩 1 只可用搬运 ⇒ hub link 卡 776、两个矿点 link 800/800 +
 * 容器 2000/2000 全满 ⇒ keeper 满仓只能往地上倒（地面掉落 ~20/tick 递增）。
 *
 * 这里验：
 *   ① 载 O 的空闲 carrier 会拿到 fillRes（倒货目标 = storage）
 *   ② 负对照：载**纯能量**的空闲 carrier 不给 storage 任务（要留给 hive 分支）
 *   ③ 非空闲（有任务）的不动
 *   ④ 源码断言：`dumpNonEnergyCargo(room)` 的**调用点**必须在 hive 分支之前
 *      （该分支 hive 缺能时会 return，放在后面等于没修）
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");

const ctx = { console };
ctx.global = ctx;
vm.runInNewContext(raw, ctx, { filename: "strategy_highLevel.js" });
const High = ctx.StrategyHighLevel;
assert.ok(High && typeof High.dumpNonEnergyCargo === "function", "StrategyHighLevel.dumpNonEnergyCargo 缺失");

/** 与 prototype_creep.js 一致的最小 store 语义 */
function mkStore(obj, cap = 5000) {
    return {
        ...obj,
        getUsedCapacity(res) {
            if (res === undefined) return Object.keys(obj).reduce((a, k) => a + obj[k], 0);
            return obj[res] || 0;
        },
        getFreeCapacity(res) {
            if (res === undefined) return cap - this.getUsedCapacity();
            return cap - (obj[res] || 0);
        },
        getResTypeList() { return Object.keys(obj); },
    };
}

function mkCreep(storeObj, tasks, home) {
    const creep = {
        store: mkStore(storeObj),
        memory: { tasks: tasks || [] },
        _dumped: null,
        homeRoom: home,
        isFree() { return !this.memory.tasks.length; },
        storeEmpty() { return this.store.getUsedCapacity() == 0; },
        storeContainsEnergyOtherResType() {
            const resLs = Object.keys(this.store).filter(k => typeof this.store[k] === "number" && !k.startsWith("get"));
            if (resLs.length > 1) return true;
            if (resLs.length == 0) return false;
            return resLs[0] != "energy";
        },
        mainRoom() { return this.homeRoom; },
        fillAll(target) {
            const resLs = Object.keys(this.store).filter(k => typeof this.store[k] === "number" && !k.startsWith("get"));
            if (resLs.length && target.store.getFreeCapacity(resLs[resLs.length - 1]) > 0) {
                this._dumped = { target: target.id, res: resLs };
                this.memory.tasks.push({ taskName: "fillRes" });
            }
        },
        fillAllMainRoomStorage() {
            const storage = this.mainRoom().storage;
            if (storage && storage.store.getFreeCapacity() > 0) this.fillAll(storage);
        },
    };
    return creep;
}

function mkRoom(creepList) {
    const storage = { id: "stor", store: mkStore({ energy: 40000 }, 1000000) };
    return {
        name: "E48S41",
        storage,
        terminal: { id: "term", store: mkStore({ energy: 50000 }, 300000) },
        creeps() { return creepList; },
    };
}

{
    // ── ① 载 O 的空闲 carrier：必须拿到倒货任务
    const o = mkCreep({ O: 1650 }, []);
    const room = mkRoom([o]);
    o.homeRoom = room;
    High.dumpNonEnergyCargo(room);
    assert.ok(o._dumped, "载 1650 O 的空闲 carrier 必须被安排倒货，实得 tasks=" + JSON.stringify(o.memory.tasks));
    assert.equal(o._dumped.target, "stor", "倒货目标应是 storage");
    assert.deepEqual(o._dumped.res, ["O"], "应把 O 倒进 storage");
}

{
    // ── ② 负对照：载纯能量的空闲 carrier 不受影响（要给 hive 分支留着）
    const e = mkCreep({ energy: 1650 }, []);
    const room = mkRoom([e]);
    e.homeRoom = room;
    High.dumpNonEnergyCargo(room);
    assert.equal(e._dumped, null, "载纯能量的爬不能被这里派 storage 任务（会抢填 hive 的运力）");
}

{
    // ── ③ 有任务的爬不动；复合货（energy+O）也要倒
    const busy = mkCreep({ O: 1650 }, [{ taskName: "x" }]);
    const mixed = mkCreep({ energy: 200, O: 1450 }, []);
    const room = mkRoom([busy, mixed]);
    busy.homeRoom = room;
    mixed.homeRoom = room;
    High.dumpNonEnergyCargo(room);
    assert.equal(busy._dumped, null, "有任务的爬不该被重新派活");
    assert.ok(mixed._dumped, "energy+O 的复合货同样不能滞留在爬身上");
}

{
    // ── ④ 源码断言：调用点必须在 hive 分支之前（否则 hive 缺能 return 会挡掉）
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const call = code.indexOf("pro.dumpNonEnergyCargo(room)");
    assert.ok(call > 0, "carrierManager 里找不到 pro.dumpNonEnergyCargo(room) 的调用点");
    const hiveIf = code.indexOf("if (StationHive.HiveNeedToFill(room))", call);
    assert.ok(hiveIf > call, "dumpNonEnergyCargo 必须在 hive 分支之前调用");
    const between = code.slice(call, hiveIf);
    assert.ok(
        !between.includes("return;"),
        "调用点与 hive 分支之间不能有 return，否则某些路径仍会跳过倒货"
    );
}

console.log("carrier-nonenergy-dump: passed");
