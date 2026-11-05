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
 *   ① hive 1,000 / cap 2,300 ⇒ 必须派，且体型造价 ≤ 1,000（旧写法是 2,100，必失败）
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

function mkRoom({ level = 6, cap = 2300, avail = 1000, storageEnergy = 31587, upgraders = 0 }) {
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
            id: "ctl", progress: 348023, progressTotal: 3645000, ticksToDowngrade: 119965,
        },
        memory: { stationUpgrade: { creeps: [], container: "cont", link: "lnk" } },
        getEnergyCapacityAvailable() { return cap; },
        getEnergyAvailable() { return avail; },
        creeps(role) { return role === "upgrader" ? creepList : []; },
        flags() { const a = []; a.head = () => undefined; return a; },
    };
}

{
    // ── ① 低 hive（1,000 / cap 2,300）+ storage 还不富裕：必须派，且体型付得起 ──
    //
    // storage 20,000 < (level-3.5)*1e4 = 25,000 ⇒ 只有「0 只 upgrader」这条分支能放行，
    // 于是这条用例正好卡在修好的那道门槛上：旧门槛 min(cap,4000)=2,300 = 要求满格。
    const { StationUpgrade, attempts } = load();
    StationUpgrade.spawnUpgrader(mkRoom({ avail: 1000, storageEnergy: 20000 }));

    assert.equal(attempts.length, 1,
        "0 只 upgrader + hive 1,000（cap 2,300 的 43%）必须尝试孵化："
        + "旧门槛 Math.min(cap,4000)=2,300 等于要求满格，RCL5/6 房几乎永远等不到");
    assert.equal(attempts[0].role, "upgrader");
    assert.ok(attempts[0].okSpawn,
        "体型必须 ≤ 本 tick 可用能量，否则 StationHive.trySpawn 静默失败（实测控制器 200+ tick 不动）"
        + `：cost=${attempts[0].cost} avail=${attempts[0].avail}`);
    assert.ok(attempts[0].body.filter(p => p === "work").length >= 2,
        "付得起就要有能干的 WORK 部件：" + JSON.stringify(attempts[0].body));
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
    // ── ⑤ 源码断言：体型必须带预算调用，strategy 侧门槛必须按容量折算 ─────────
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const upg = strip(raw);
    assert.ok(upg.includes("getBodyLowLevel(bodyBudget)"),
        "getBodyLowLevel 必须传预算（bodyBudget）调用");
    assert.ok(!/getBodyLowLevel\(\s*\)/.test(upg),
        "负对照：不得再有无预算的 getBodyLowLevel() 调用（那会按 hive 满容量算体型）");
    assert.ok(/bodyBudget\s*=\s*Math\.max\(300,\s*Math\.min\(room\.getEnergyCapacityAvailable\(\),\s*cachedEnergy\)\)/.test(upg),
        "bodyBudget 必须夹在 [300, 本房容量] 之间，且输入是本 tick 真可用能量"
        + "（下限 300 = 最便宜的可用法体型 2 WORK + 1 MOVE + 1 CARRY；"
        + "2026-11-05 实测下限 600 会造出 550 体型的爬，hive 长期 300~500 的房里恒付不起 ⇒ 与「真付得起」自相矛盾）");
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
