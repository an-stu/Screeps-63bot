/**
 * 实验室反应的「2 tick 缓冲」把奇数周期反应打成半速（2026-11-15 修，0.78.252）。
 *
 * 现场：`StationLab.exec` 为了让 12 次 `getObjectById` 少跑一半，在反应分支入口
 * 挡了一条 `(Game.time + room.hashCode()) % 2 != 0 → return`。而真正的触发判据在
 * 下游是 `(Game.time + hashCode) % REACTION_TIME[res] == 0`：
 *   · RT 为偶数 ⇒ 任何倍数都是偶数 ⇒ 触发点永远落在放行的那一半，行为不变；
 *   · RT 为奇数 ⇒ 每 2*RT 里恰好有一半的触发点落在被跳过的奇偶上
 *     ⇒ 反应按 2*RT 跑，**吞吐打对折**。
 * 线上 `REACTION_TIME` 有 12 个是奇数（G/ZK/UL/LHO2/ZHO2/UHO2/KHO2/UH2O/KH2O=5、
 * LH/GH2O=15、XLH2O=65），正好覆盖 T3 化合物的主链条。
 *
 * 修法：反应周期为奇数时不套缓冲（每 tick 都评估状态机）。
 *
 * 这里验行为，不断言源码：
 *   ① 奇数周期（G，RT=5）：60 tick 内 runReaction 必须被调 **12** 次（旧代码 6 次）
 *   ② 偶数周期（GH，RT=10）：仍是 6 次 —— 触发窗口的数量本来就是这个数，不许变
 *   ③ 偶数周期 + centerLab 有死 id（状态机会置 clear）：奇数奇偶的那一 tick
 *      必须**被缓冲挡住**（stat 保持 reacting）⇒ 证明缓冲本身没被拆掉
 *   ④ 奇数周期 + 同样的死 id：奇数奇偶那一 tick 必须**已经跑过**（stat=clear）
 *      ⇒ 这条是 ① 的定点对照，旧代码在这里会红
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "station_lab.js"), "utf8");

function load() {
    const ctx = {
        console,
        Creep: function () {},
        Room: function () {},
        RoomPosition: function () {},
        Memory: { rooms: {}, creeps: {} },
        Game: {
            time: 1,
            shard: { name: "shard3" },
            rooms: {},
            creeps: {},
            cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
            getObjectById: id => (ctx.__objs && ctx.__objs[id]) || null,
        },
        // 顶层会遍历这三张表建 global.LAB_REACTIONS / LAB_REACTIONS_KEYS
        REACTIONS: { U: { H: "G" }, H: { U: "G" }, G: { H: "GH" }, O: { GH: "GH2O" } },
        REACTION_TIME: { G: 5, GH: 10, GH2O: 15 },
        BOOSTS: {},
        BOOST_RES: {},
        LAB_REACTIONS: {},
        _: { keys: o => Object.keys(o || {}), values: o => Object.keys(o || {}).map(k => o[k]) },
        UtilsTask: { task: () => ({}), taskData: () => ({}) },
        Utils: {},
        HelperVisual: {},
        HelperError: { catchError: fn => fn() },
        __objs: {},
    };
    for (const k of [
        "OK", "ERR_NOT_ENOUGH_ENERGY", "ERR_NOT_IN_RANGE", "ERR_FULL", "ERR_TIRED",
        "ERR_INVALID_TARGET", "ERR_NOT_ENOUGH_RESOURCES", "ERR_BUSY", "ERR_NO_BODYPART",
        "RESOURCE_ENERGY", "RESOURCE_POWER", "RESOURCE_OPS",
        "WORK", "CARRY", "MOVE", "ATTACK", "HEAL", "RANGED_ATTACK", "TOUGH", "CLAIM",
        "STRUCTURE_LAB", "STRUCTURE_CONTAINER", "STRUCTURE_EXTENSION", "STRUCTURE_STORAGE",
        "STRUCTURE_TERMINAL", "STRUCTURE_SPAWN", "STRUCTURE_TOWER", "STRUCTURE_LINK",
        "STRUCTURE_FACTORY", "STRUCTURE_NUKER", "STRUCTURE_OBSERVER", "STRUCTURE_POWER_SPAWN",
        "STRUCTURE_EXTRACTOR", "STRUCTURE_RAMPART", "STRUCTURE_WALL",
        "FIND_STRUCTURES", "FIND_MY_STRUCTURES", "FIND_CREEPS", "FIND_MY_CREEPS",
        "FIND_DROPPED_RESOURCES", "FIND_MINERALS", "FIND_TOMBSTONES",
        "LOOK_STRUCTURES", "LOOK_CREEPS", "LOOK_RESOURCES",
    ]    ) {
        ctx[k] = k;
    }
    // 资源名必须是真值（`store[RESOURCE_ENERGY]` 读的是键名 "energy"）；
    // 上面那圈只给了同名占位，会把「storage 有 20 万能量」读成 0 ⇒ 反应被判停摆。
    ctx.RESOURCE_ENERGY = "energy";
    ctx.RESOURCE_POWER = "power";
    ctx.RESOURCE_OPS = "ops";
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_lab.js" });
    // checkLabs 要扫全房结构，与本用例无关；exec 走的是 `this.checkLabs`
    ctx.StationLab.checkLabs = () => true;
    return ctx;
}

/** center lab 的 store 桩：只提供状态机读的那几个方法 */
function centerLab(id, resType, cnt) {
    return {
        id,
        store: {
            [resType]: cnt,
            getLabReactionResType: () => resType,
            getLabReactionCnt: () => cnt,
        },
    };
}

/**
 * 搭一个「正在反应」的房。
 * @param {string} res 反应产物（决定 RT）
 * @param {object} opt { deadCenter:true } ⇒ centerLabs[1] 换成死 id
 */
function setup(res, opt = {}) {
    const ctx = load();
    const [a, b] = ctx.LAB_REACTIONS[res];
    const counter = { n: 0 };
    const runLab = {
        id: "L2",
        runReaction: () => { counter.n++; return ctx.OK; },
    };
    const L0 = centerLab("L0", a, 3000);
    const L1 = centerLab("L1", b, 3000);
    ctx.__objs = { L0, L1, L2: runLab };
    if (opt.deadCenter) delete ctx.__objs.L1;

    const room = {
        name: "W26N58",
        hashCode: () => 1,
        storage: { store: { energy: 200000, getUsedCapacity: res => (res === "energy" ? 200000 : 0) } },
        terminal: null,
        memory: {
            stationLab: {
                stat: "reacting",
                reacting: res,
                centerLabs: ["L0", "L1"],
                otherLabs: ["L2"],
                boostLabMap: {},
            },
        },
    };
    return { ctx, room, counter, stat: () => room.memory.stationLab.stat };
}

/** 跑 [1..60] 这 60 个 tick，返回调了 runReaction 的次数 */
function runTicks(setupResult) {
    const { ctx, room, counter } = setupResult;
    for (let t = 1; t <= 60; t++) {
        ctx.Game.time = t;
        ctx.StationLab.exec(room);
    }
    return counter.n;
}

// ① 奇数周期 RT=5：60 tick 里 (t+1)%5==0 有 12 次 ⇒ 必须每次都真的跑
{
    const s = setup("G");
    assert.equal(s.ctx.REACTION_TIME.G, 5, "前置：G 的反应周期必须是奇数（本用例的前提）");
    const got = runTicks(s);
    assert.equal(got, 12,
        "RT=5 的奇数周期反应在 60 tick 内应触发 12 次；拿到 " + got +
        " 次说明 2 tick 奇偶缓冲仍在吃掉一半的触发点（旧行为 = 6）");
}

// ② 偶数周期 RT=10：触发窗口本来就是 6 个，修法不许改变它
{
    const s = setup("GH");
    assert.equal(s.ctx.REACTION_TIME.GH % 2, 0, "前置：GH 的反应周期是偶数");
    const got = runTicks(s);
    assert.equal(got, 6, "RT 为偶数时触发窗口 6 个，保持不变（修法只影响奇数周期）");
}

// ③ 负对照：偶数周期下缓冲必须还在
//    centerLabs 有死 id ⇒ 状态机会把 stat 置 clear。奇数奇偶那一 tick 被缓冲挡住，
//    所以 stat 应当还停在 reacting。
{
    const s = setup("GH", { deadCenter: true });
    s.ctx.Game.time = 2;                 // (2 + 1) % 2 != 0 ⇒ 被缓冲跳过
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.stat(), "reacting", "偶数周期仍走 2 tick 缓冲：被跳过的奇偶不许进状态机");
    s.ctx.Game.time = 3;                 // (3 + 1) % 2 == 0 ⇒ 进状态机
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.stat(), "clear", "放行的那一 tick 必须能进状态机并清掉死 id 的反应态");
}

// ④ 定点对照：奇数周期下，被跳过的那一 tick 的下一个放行 tick 必须补上
//    RT=5、hashCode=1：t=4 时 (t+1)=5 是触发点但奇偶被跳过；t=5 时 (t+1)=6，
//    余数 1 —— 只有「余数 <= 1」的容差才会在这里补跑。旧代码（余数 == 0）会漏掉。
{
    const s = setup("G", { deadCenter: true });
    s.ctx.Game.time = 4;                 // 触发点 (4+1)%5==0，但 (4+1)%2!=0 ⇒ 缓冲跳过
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.stat(), "reacting", "被缓冲跳过的这一 tick 状态机不该动（缓冲仍在）");
    s.ctx.Game.time = 5;                 // 下一个放行 tick，(5+1)%5==1 ⇒ 容差窗口
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.stat(), "clear",
        "RT=5 时触发点落在被跳过的奇偶上，下一个放行 tick 的余数是 1，必须靠容差补跑；" +
        "否则这个反应永远按 2*RT 跑");
}

console.log("lab reaction parity buffer checks passed");
{
    const s = setup("G");
    s.ctx.Game.shard.name = "shard2";
    s.ctx.Game.cpu.bucket = 6000;
    assert.equal(runTicks(s),12,"fast shards run once per true odd-cycle window, without duplicate tolerance attempts");
    const d = setup("GH",{deadCenter:true});
    d.ctx.Game.shard.name = "shard2";
    d.ctx.Game.time = 2;
    d.ctx.StationLab.exec(d.room);
    assert.equal(d.stat(),"clear","only shard3 delays the state check to the next even tick");
}
