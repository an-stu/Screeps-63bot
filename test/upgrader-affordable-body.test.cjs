/**
 * 0 只 upgrader 时，体型必须**本 tick 真付得起**（2026-11-01 W26N58 实测）。
 *
 * 现场：W26N58（RCL6、hive 容量 2,300、storage 31,587）连续 200+ tick 没有 upgrader，
 * 控制器进度钉在 348,023 一动不动；同一时刻 spawn 正在孵外矿搬运爬，
 * hive 在 600~1,750 之间被反复抽干（每只外矿车要 1,150）。
 *
 * 根因是**两道独立的「满格」门槛**，对 cap ≤ 2,500 的房都等价于「hive 必须满格」：
 *   ① `strategy_highLevel.js`：`HiveNeedToFill(room) && energyAvailable < 2500` ——
 *      写死的 2,500 是 RCL8（12,900）的量级，RCL6 的 hive 满格只有 2,300 ⇒ 恒真 ⇒
 *      `spawnUpgrader` 每次经济 pass 都被整个跳过。
 *   ② `station_upgrade.js`：0 只 upgrader 的分支要求
 *      `energyAvailable >= Math.min(cap, 4000)`（= 2,300，还是满格），
 *      且体型按 `getEnergyCapacityAvailable()` 算成 2,100 ⇒ 即使放行也付不起
 *      （`StationHive.trySpawn` 只静默 return，不报错）。
 *
 * 这里验「付得起 + 正常房不缩水 + 饿的时候别抽」：
 *   ① hive 1,150（cap 2,300 的一半）⇒ 必须派，且体型造价 ≤ 1,150
 *   ①b hive 1,000（低于高 RCL 最小预算）⇒ 不派，等 hive 攒大再孵
 *      （2026-11-27 用户：E56S29 RCL5 时 hive 被抽到 300 就孵出
 *      WORK2/CARRY1/MOVE1 的 4 部件小 upgrader，不要再产这种小体型）
 *   ② hive 2,300（满格）⇒ 体型不缩水（16 WORK / 2,100），正常运行不受影响
 *   ③ hive 900（< cap 的 40%）⇒ 不派（hive 真的在挨饿时不许抽）
 *   ④ 源码断言：`getBodyLowLevel` 必须带预算调用；strategy 侧门槛必须按容量折算
 *      （负对照：不许再出现写死的 `energyAvailable < 2500`）
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "station_upgrade.js"), "utf8");

const COST = { tough: 10, work: 100, carry: 50, move: 50, attack: 80, ranged_attack: 150, heal: 250, claim: 600 };

function load() {
    const attempts = [];
    const ctx = {
        console,
        Memory: { rooms: {}, controllerSignAssignments: {} },
        Game: {
            time: 100000,
            rooms: {},
            cpu: { bucket: 10000 },
            shard: { name: "shard3" },
            getObjectById(id) { return id ? { id } : null; },
        },
        Creep: { prototype: {} },
        Room: { prototype: {} },
        TOUGH: "tough", WORK: "work", CARRY: "carry", MOVE: "move",
        ATTACK: "attack", RANGED_ATTACK: "ranged_attack", HEAL: "heal", CLAIM: "claim",
        BODYPART_COST: COST,
        STRUCTURE_CONTAINER: "container", STRUCTURE_LINK: "link",
        STRUCTURE_CONTROLLER: "controller", STRUCTURE_STORAGE: "storage",
        STRUCTURE_TERMINAL: "terminal", STRUCTURE_SPAWN: "spawn",
        STRUCTURE_EXTENSION: "extension", STRUCTURE_RAMPART: "rampart", STRUCTURE_ROAD: "road",
        TERRAIN_MASK_WALL: 1, LOOK_STRUCTURES: "structure",
        OBSTACLE_OBJECT_TYPES: ["spawn", "extension", "road"],
        FIND_MY_CREEPS: 1, OK: 0, WHO_AM_I: "an_w", MAX_GCL: 150,
        RESOURCE_ENERGY: "energy",
        ManagerCreeps: {
            calcBodyPart(set) {
                const out = [];
                Object.keys(set).forEach(type => { for (let i = 0; i < set[type]; i++) out.push(type); });
                return out;
            },
        },
        ManagerRooms: {},
        HelperError: { catchError: fn => fn() },
        Utils: {
            getBodyEnergyNeed(body) { return body.reduce((a, p) => a + (COST[p] || 0), 0); },
        },
        UtilsTask: {
            task(obj, taskName, regFun, ops) {
                return Object.assign({ taskName, id: obj && obj.id, regFun }, ops || {});
            },
        },
        // 真机里能量不够时 trySpawn 只会 `return undefined`（不抛错）——
        // 桩必须**如实失败**，否则「闸门放行但体型付不起」这个 bug 在测试里永远看不见。
        StationHive: {
            trySpawn(room, targetRoomName, body, role) {
                const cost = body.reduce((a, p) => a + (COST[p] || 0), 0);
                const okSpawn = cost <= room.energyAvailable;
                attempts.push({ role, body, cost, okSpawn, avail: room.energyAvailable });
                return okSpawn ? "creep" : undefined;
            },
            HiveNeedToFill(room) {
                return room.energyAvailable < room.energyCapacityAvailable;
            },
        },
        StationLab: { boostAbleLevel() { return -1; } },
        StationCarry: { stationName: "stationCarry" },
        StationUpgrade: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(raw, ctx, { filename: "station_upgrade.js" });
    return { StationUpgrade: ctx.global.StationUpgrade, attempts };
}

function mkRoom({ level = 6, cap = 2300, avail = 1000, storageEnergy = 31587, upgraders = 0, downgrade = 119965 }) {
    const creepList = Array.from({ length: upgraders }, (_, i) => ({
        id: "c" + i, memory: { role: "upgrader" }, ticksToLive: 900,
    }));
    return {
        name: "W26N58",
        my: true,
        level,
        energyAvailable: avail,
        energyCapacityAvailable: cap,
        currentEnergyAvailable: undefined,
        storage: { id: "stor", store: { energy: storageEnergy } },
        terminal: { id: "term", my: true, store: { energy: 50000 } },
        extension: Array.from({ length: 20 }, (_, i) => ({ id: "e" + i })),
        controller: {
            id: "ctl", progress: 348023, progressTotal: 3645000, ticksToDowngrade: downgrade,
        },
        memory: { stationUpgrade: { creeps: [], container: "cont", link: "lnk" } },
        getEnergyCapacityAvailable() { return cap; },
        getEnergyAvailable() { return avail; },
        creeps(role) { return role === "upgrader" ? creepList : []; },
        flags() { const a = []; a.head = () => undefined; return a; },
    };
}

{
    const { StationUpgrade, attempts } = load();
    for (const [storageEnergy, downgrade, blocked] of [[0, 115000, true], [24999, 5000, true], [25000, 115000, false], [0, 4999, false]]) {
        attempts.length = 0;
        // 未拦截的行要给到高 RCL 最小预算（1,150），否则会被新的体型闸挡住，
        // 测到的就不是「库存闸是否放行」了。
        const room = mkRoom({storageEnergy, downgrade, avail: blocked ? 1000 : 1150});
        assert.equal(StationUpgrade.isSpawnBlockedByEnergyStock(room), blocked);
        StationUpgrade.spawnUpgrader(room);
        assert.equal(attempts.length === 0, blocked, "shared hold state must match the actual spawn decision");
    }
}

{
    // ── ① 攒到容量一半（1,150 / cap 2,300）+ storage 够：必须派，且体型付得起 ──
    //
    // storage 30,000 已高于本 RCL 的 25,000 安全库存；此时「0 只 upgrader」分支
    // 只受 hive 40% 门槛与高 RCL 最小预算约束，验证攒够后仍能孵且体型付得起。
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 1150, storageEnergy: 30000 }));

    assert.equal(attempts.length, 1,
        "0 只 upgrader + hive 1,150（cap 2,300 的一半）必须尝试孵化");
    assert.equal(attempts[0].role, "upgrader");
    assert.ok(attempts[0].okSpawn,
        "体型必须 ≤ 本 tick 可用能量，否则 StationHive.trySpawn 静默失败（实测控制器 200+ tick 不动）"
        + `：cost=${attempts[0].cost} avail=${attempts[0].avail}`);
    assert.ok(attempts[0].body.filter(p => p === "work").length >= 6,
        "高 RCL 最小预算下不该再出 4 部件小体格：" + JSON.stringify(attempts[0].body));
}

{
    // ── ①b hive 1,000（低于高 RCL 最小预算 1,150）⇒ 等待，不出小体型 ──────
    // 2026-11-27 E56S29：RCL5 容量 1,800，hive 被 keeper/carrier 抽到 300 时
    // 立即孵出 4 部件（300 能量）upgrader，成为长期累赘。高 RCL 必须等攒大。
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 1000, storageEnergy: 30000 }));
    assert.equal(attempts.length, 0,
        "hive 1,000 < 最小预算 1,150 时必须等待，不能再产 4 部件小 upgrader");
}

{
    // ── ② hive 满格：体型不缩水（回归保护，别为了修小房把大房改弱）───────────
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 2300 }));

    assert.equal(attempts.length, 1, "hive 满格 + 0 只 upgrader 一定要派");
    assert.equal(attempts[0].body.filter(p => p === "work").length, 16,
        "满格时体型按容量算满（16 WORK），不能因为修小房把正常房也缩了："
        + JSON.stringify(attempts[0].body));
    assert.equal(attempts[0].body.filter(p => p === "move").length, 8);
}

{
    // ── ③ hive 真的挨饿（900 < cap*0.4=920）且 storage 未达加编门槛：不派 ─────
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 900, storageEnergy: 20000 }));
    assert.equal(attempts.length, 0,
        "hive 低于本房容量的 40% 时不许为 upgrader 抽能量（keeper/换班要先用）");
}

{
    // ── ④ 已有 1 只 upgrader 且 storage 很穷：不派（别一路加编）───────────────
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 2300, upgraders: 1 }));
    assert.equal(attempts.length, 0,
        "已经有 upgrader、storage 31,587 未达 (level-3.5)*1e4 的加编门槛，不应再派");
}

{
    // ── ④b 库存低于安全线（RCL6=25k）且降级还远：不得孵 upgrader ───────────────
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 1000, storageEnergy: 378, downgrade: 119965 }));
    assert.equal(attempts.length, 0,
        "storage 378 < 25k 时不得为 upgrader 消耗 hive/施工救命能量");
}

{
    // ── ④c 同样的低库存，但控制器快降级：必须破例孵化 ─────────────────────────
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 1000, storageEnergy: 378, downgrade: 4000 }));
    assert.equal(attempts.length, 1,
        "库存再低，控制器进入 5000 tick 降级余量后仍必须补 upgrader");
    assert.ok(attempts[0].okSpawn, "破例孵化也必须付得起当前 hive");
}

{
    // ── ⑤ 源码断言：体型必须带预算调用，strategy 侧门槛必须按容量折算 ─────────
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const upg = strip(raw);
    assert.ok(upg.includes("getBodyLowLevel(bodyBudget)"),
        "getBodyLowLevel 必须传预算（bodyBudget）调用");
    assert.ok(!/getBodyLowLevel\(\s*\)/.test(upg),
        "负对照：不得再有无预算的 getBodyLowLevel() 调用（那会按 hive 满容量算体型）");
    assert.ok(/bodyBudget\s*=\s*Math\.min\(capacity,\s*cachedEnergy\)/.test(upg),
        "bodyBudget 必须取本 tick 真可用能量与容量的较小值（无强制下限，靠 minBudget 闸等待）");
    assert.ok(/minBudget\s*=\s*room\.level\s*>=\s*4\s*\?\s*Math\.min\(capacity,\s*Math\.max\(1000,\s*Math\.floor\(capacity\s*\*\s*0\.5\)\)\)\s*:\s*300/.test(upg),
        "RCL>=4 的 upgrader 最小预算必须是「容量一半、至少 1,000」（RCL<4 才允许 300 退化体）；"
        + "2026-11-27 E56S29 实测：RCL5 容量 1,800 时 hive 被抽到 300 就出 4 部件小 upgrader");
    assert.ok(upg.includes("bodyBudget < minBudget && !emergency"),
        "攒不到最小预算时必须等待；只有 emergency（0 只在岗 + 快降级）才可破例");
    assert.ok(/zeroUpgraderNeedEnergy\s*=\s*Math\.min\(room\.getEnergyCapacityAvailable\(\)\s*\*\s*0\.4,\s*4000\)/.test(upg),
        "0 只 upgrader 的门槛必须按本房容量折算，不能写死 hive 满格");
    assert.ok(upg.includes("room.energyAvailable >= zeroUpgraderNeedEnergy"),
        "0 只 upgrader 的分支必须用 zeroUpgraderNeedEnergy");

    const high = strip(fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8"));
    assert.ok(/hiveStarvingEnergy\s*=\s*Math\.min\(2500,\s*room\.energyCapacityAvailable\s*\*\s*0\.2\)/.test(high),
        "hive「见底」门槛必须按本房容量折算（写死 2,500 对 cap ≤ 2,500 的房恒真，upgrader 永远不派）");
    assert.ok(high.includes("StationHive.HiveNeedToFill(room) && room.energyAvailable < hiveStarvingEnergy)) StationUpgrade.spawnUpgrader(room)"),
        "upgrader 那一道闸必须用 hiveStarvingEnergy 判「hive 见底」");
    assert.ok(!high.includes("room.energyAvailable < 2500)) StationUpgrade.spawnUpgrader(room)"),
        "负对照：upgrader 闸上不许再出现写死的 energyAvailable < 2500");
}

console.log("upgrader-affordable-body: passed");
