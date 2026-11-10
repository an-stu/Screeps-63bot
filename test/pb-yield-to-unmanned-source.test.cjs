/**
 * PB 让位闸：出兵房自己的矿点没人挖时，PB 不许再新派/推进队伍。
 *
 * 2026-11-10 线上实测的死锁（E53S21，3 spawn / 2 矿点 / har 旗在 E52S20）：
 *   - `dispatchPBSpawnQueue` 跑在 exec 的 `%3` 闸门**之前**，每 tick 一次 ⇒
 *     任何一个 spawn 空出来就被 PB 填走（26 tick × 10 次采样，idle=0 一次没空过，
 *     三只全在孵 PBer）；主房 keeper 补员只在 economy pass（%7，bucket<5000 时 %14）
 *     里试一次 ⇒ 永远抢不到；
 *   - 第 2 个矿点 bc20 `spawnTime=84177216` 之后 `creeps: []`，**~740 tick 无 keeper**；
 *   - 该矿点容器 2,000/2,000 顶满、矿点 link 800/800、keeper 往地上倒
 *     （地面 2,502→3,427 在涨）、storage 一路掉。
 * 这就是 MEMORY 第 3 条「闸门不许自锁」：无限波次 ⇒ spawn 全被占 ⇒ keeper 补不上
 * ⇒ 矿点无人 ⇒ 没有任何机制让 PB 让位。
 *
 * 本测试锁死三件事：判据本身（含换代/负对照）、两处调用点、以及「不碰阈值」。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/strategy_powerBank.js"), "utf8");

/**
 * 在 vm 里加载模块。
 * @param alive     getObjectById 返回 { ticksToLive: 900 } 的 id
 * @param spawning  getObjectById 返回 { spawning: true }（无 ticksToLive）的 id
 * @param rooms     Memory.rooms 桩
 */
function load({ time = 1000, alive = [], spawning = [], rooms = {} } = {}) {
    const live = new Set(alive);
    const hatch = new Set(spawning);
    const ctx = {
        console: { log() {} },
        Creep: function () {},
        Game: {
            time,
            flags: {},
            rooms: {},
            getObjectById: id => {
                if (live.has(id)) return { id, ticksToLive: 900 };
                if (hatch.has(id)) return { id, spawning: true };
                return null;
            },
        },
        Memory: { creeps: {}, rooms },
        FIND_HOSTILE_CREEPS: "hostile",
        FIND_RUINS: "ruins",
        FIND_DROPPED_RESOURCES: "drop",
        RESOURCE_POWER: "power",
        RESOURCE_ENERGY: "energy",
        ATTACK: "attack",
        HEAL: "heal",
        RANGED_ATTACK: "ranged_attack",
        TOUGH: "tough",
        MOVE: "move",
        CARRY: "carry",
        WORK: "work",
        global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_powerBank.js" });
    const S = ctx.StrategyPowerBank;
    /** 房间桩：`creeps(role, false)` 与真 `prototype_room.js` 同形。 */
    S.__room = (name, { mem = {}, keepersN = 0 } = {}) => ({
        name,
        memory: { stationSources: mem },
        creeps: role => (role === "harvestEnergyKeeper"
            ? Array.from({ length: keepersN }, (_, i) => ({ name: "k" + i, spawning: false }))
            : []),
    });
    return S;
}

// 两个矿点：srcA 有 keeper 在挖，srcB 一只都没有
const TWO_SRC_ONE_DEAD = {
    srcA: { id: "srcA", x: 10, y: 10, creeps: ["k1"] },
    srcB: { id: "srcB", x: 30, y: 30, creeps: [] },
};

// ① 线上那一幕：两个矿点、srcB 无人 + keeper 只有 1 ⇒ 必须让位
{
    const S = load({ alive: ["k1"] });
    assert.equal(
        S.spawnRoomMiningBroken(S.__room("E53S21", { mem: TWO_SRC_ONE_DEAD, keepersN: 1 })),
        true,
        "srcB 的 creeps 空 + keeper 1 < 矿点 2 ⇒ 本房挖矿已破，PB 必须让位");
}

// ② 负对照：同样的 creeps 数据，但 keeper 数已经够（2）⇒ **不许**误报。
//    只判「某矿点 creeps 空」的实现会在这里报警，把正常 PB 全部停掉。
{
    const S = load({ alive: ["k1"] });
    assert.equal(
        S.spawnRoomMiningBroken(S.__room("E53S21", { mem: TWO_SRC_ONE_DEAD, keepersN: 2 })),
        false,
        "负对照：keeper 数 == 矿点数时不能报破（否则 PB 被永久停派）");
}

// ③ 换代窗口：接手的是**在孵**的 keeper（ttl undefined、spawning=true）⇒ 算有人
{
    const srcs = {
        srcA: { id: "srcA", x: 10, y: 10, creeps: ["hatch1"] },
        srcB: { id: "srcB", x: 30, y: 30, creeps: ["k2"] },
    };
    const S = load({ alive: ["k2"], spawning: ["hatch1"] });
    assert.equal(
        S.spawnRoomMiningBroken(S.__room("E53S21", { mem: srcs, keepersN: 1 })),
        false,
        "在孵的接班人（ticksToLive undefined 但 spawning=true）必须算「有人」");
}

// ④ 死 id：creeps 里挂着已经消失的爬 ⇒ 仍然算无人（登记表只增不减的那一半）
{
    const S = load({ alive: [] });
    assert.equal(
        S.spawnRoomMiningBroken(S.__room("E53S21", { mem: TWO_SRC_ONE_DEAD, keepersN: 1 })),
        true,
        "getObjectById 返 null 的 id 不能算在岗");
}

// ⑤ 没有登记表 ⇒ 不猜、不报警（负对照）
{
    const S = load({});
    assert.equal(S.spawnRoomMiningBroken(S.__room("W1N1", { mem: null, keepersN: 0 })), false,
        "没有 stationSources 记忆时不能凭空报警");
    assert.equal(S.spawnRoomMiningBroken(null), false, "room 为空也不能抛");
}

// ⑥ 单矿点房：keeper 已经 1 只 ⇒ 不破（把比较写反成 `>` 会在这里挂）
{
    const srcs = { srcA: { id: "srcA", x: 10, y: 10, creeps: [] } };
    const S = load({});
    assert.equal(
        S.spawnRoomMiningBroken(S.__room("E41S32", { mem: srcs, keepersN: 1 })),
        false,
        "keeper 数 == 矿点数 ⇒ 不破，哪怕该矿点的 creeps 列表是空的");
}

// ⑦ 调用点：两处闸门都必须真的存在，且顺序正确
//    （只闸「新建波次」拦不住每 tick 的队列派发）
{
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/if \(needSpawn && pro\.spawnRoomMiningBroken\(room\)\) needSpawn = false;/.test(codeOnly),
        "exec 必须在 needSpawn 为真时用 spawnRoomMiningBroken 让位");
    assert.ok(/if \(pro\.spawnRoomMiningBroken\(room\)\) return false;/.test(codeOnly),
        "dispatchPBSpawnQueue 必须在派发前早退（这条路径每 tick 跑，是抢 spawn 的主力）");
    const dispatch = codeOnly.slice(codeOnly.indexOf("dispatchPBSpawnQueue(room, flag)"));
    const gateAt = dispatch.indexOf("pro.spawnRoomMiningBroken(room)");
    const loopAt = dispatch.indexOf("while (queue.spawnList.length)");
    assert.ok(gateAt > 0 && loopAt > 0 && gateAt < loopAt, "让位闸必须在 trySpawn 循环**之前**");
    assert.ok(!/flag\.remove\(\);\s*return;\s*\}\s*if \(pro\.spawnRoomMiningBroken/.test(codeOnly),
        "让位不许删旗");
    assert.ok(/if \(flag\.memory\.beingAttack\) needSpawn = true;/.test(codeOnly),
        "被打就补波的策略原封不动（让位只加一条状态闸，不改上限）");
}

console.log("power-bank mining-yield checks passed");
