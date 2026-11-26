/**
 * Reaction cadence with actual per-lab cooldowns. shard3 retains its 2-tick
 * state scan; other shards inspect lab readiness every tick.
 *
 * The fake labs set cooldown to REACTION_TIME after a successful reaction and
 * age it once per tick. This verifies the readiness model, odd/even shard3
 * cadence, shard2 low-bucket progress, and independent cooldown phases.
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
    const runLabs = (opt.outputCooldowns || [0]).map((cooldown, i) => {
        const lab = {
            id: `L${i + 2}`,
            cooldown,
            attemptedTicks: [],
            successTicks: [],
            runReaction: () => {
                lab.attemptedTicks.push(ctx.Game.time);
                if (lab.cooldown > 0) return ctx.ERR_TIRED;
                counter.n++;
                lab.successTicks.push(ctx.Game.time);
                lab.cooldown = ctx.REACTION_TIME[res];
                return ctx.OK;
            },
        };
        return lab;
    });
    const L0 = centerLab("L0", a, 3000);
    const L1 = centerLab("L1", b, 3000);
    ctx.__objs = { L0, L1, ...Object.fromEntries(runLabs.map(lab => [lab.id, lab])) };
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
                otherLabs: runLabs.map(lab => lab.id),
                boostLabMap: {},
            },
        },
    };
    return { ctx, room, counter, runLabs, stat: () => room.memory.stationLab.stat };
}

/** Run one script tick, then age the fake lab cooldowns as the engine does. */
function runTick(setupResult, tick) {
    const { ctx, room, runLabs } = setupResult;
    ctx.Game.time = tick;
    ctx.StationLab.exec(room);
    for (const lab of runLabs) if (lab.cooldown > 0) lab.cooldown--;
}

/** 跑 [1..60] 这 60 个 tick，返回成功反应数 */
function runTicks(setupResult) {
    for (let t = 1; t <= 60; t++) {
        runTick(setupResult, t);
    }
    return setupResult.counter.n;
}

// ① Odd RT=5 on shard3: 2-tick state scans plus actual cooldown yield 10 runs / 60.
{
    const s = setup("G");
    assert.equal(s.ctx.REACTION_TIME.G, 5, "前置：G 的反应周期必须是奇数（本用例的前提）");
    const got = runTicks(s);
    assert.equal(got, 10, "shard3 RT=5 with actual cooldown yields 10 reactions per 60 ticks");
    assert.deepEqual(s.runLabs[0].successTicks, [1, 7, 13, 19, 25, 31, 37, 43, 49, 55],
        "shard3 scans every other tick and runs a lab when its cooldown is ready");
}

// ② Even RT=10: actual cooldown yields 6 reactions / 60 on shard3.
{
    const s = setup("GH");
    assert.equal(s.ctx.REACTION_TIME.GH % 2, 0, "前置：GH 的反应周期是偶数");
    const got = runTicks(s);
    assert.equal(got, 6, "shard3 RT=10 with actual cooldown yields 6 reactions per 60 ticks");
    assert.deepEqual(s.runLabs[0].successTicks, [1, 11, 21, 31, 41, 51]);
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

// ④ The odd-cycle state scan reaches the next eligible tick after a skipped scan.
//    Reaction execution itself now follows each output lab's cooldown, not a global phase.
{
    const s = setup("G", { deadCenter: true });
    s.ctx.Game.time = 4;                 // (4+1)%2!=0 ⇒ buffered state scan skips
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.stat(), "reacting", "被缓冲跳过的这一 tick 状态机不该动（缓冲仍在）");
    s.ctx.Game.time = 5;                 // next even phase: inspect the state
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.stat(), "clear", "the next odd-cycle state scan must clear a missing center lab");
}

// Off shard3, low bucket must not halt active reactions. RT=5 is limited only
// by the lab's real five-tick cooldown, so 60 ticks still allow 12 reactions.
{
    const s = setup("G");
    s.ctx.Game.shard.name = "shard2";
    s.ctx.Game.cpu.bucket = 1;
    assert.equal(runTicks(s), 12, "shard2 low bucket must not pause reactions with actual cooldown");
    assert.deepEqual(s.runLabs[0].successTicks, [1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56]);
}

// Each output lab follows its own cooldown phase, rather than one room-level
// reaction timestamp. The second lab starts two ticks behind the first.
{
    const s = setup("G", {outputCooldowns: [0, 2]});
    s.ctx.Game.shard.name = "shard2";
    runTick(s, 1);
    runTick(s, 2);
    runTick(s, 3);
    assert.deepEqual(s.runLabs.map(lab => lab.successTicks), [[1], [3]],
        "a shifted lab cooldown must shift that lab's own ready tick");
    assert.deepEqual(s.runLabs.map(lab => lab.attemptedTicks), [[1], [3]],
        "runReaction must not be called while the output lab cooldown is positive");
}

// shard3 still protects reaction CPU below 8,000, then resumes at the boundary.
{
    const s = setup("G");
    s.ctx.Game.cpu.bucket = 7999;
    s.ctx.Game.time = 1; // hash=1 => eligible state scan
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.counter.n, 0, "shard3 must keep the low-bucket reaction guard");
    s.ctx.Game.cpu.bucket = 8000;
    s.ctx.Game.time = 3; // next eligible scan; lab cooldown is still ready
    s.ctx.StationLab.exec(s.room);
    assert.equal(s.counter.n, 1, "shard3 may resume reactions at bucket 8,000");
}

// shard2 performs the invalid-center state check immediately; only shard3
// retains its buffered state scan.
{
    const d = setup("GH", {deadCenter: true});
    d.ctx.Game.shard.name = "shard2";
    d.ctx.Game.time = 2;
    d.ctx.StationLab.exec(d.room);
    assert.equal(d.stat(), "clear", "shard2 must not defer the invalid-center check");
}

console.log("lab reaction cooldown and shard cadence checks passed");
