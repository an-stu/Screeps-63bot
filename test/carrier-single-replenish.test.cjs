/**
 * 「只剩 1 只 carrier 的房补不出第 2 只」：E53S21 实地（2026-11-04 12:35~12:45）。
 *
 * 现场：E53S21（RCL8、3 个空闲 spawn、4 link、2 矿点 2 keeper）只有 1 只 carrier，
 * 于是 storage 归零、两个源容器各 2,000 满、**地面能量 4.9k → 7.1k（+28/tick，
 * 正好等于全房采矿收入）**。同一时刻别的 13 个房地面全是 0。
 *
 * 为什么补不出来（MEMORY 第 4 条：闸门自锁）：
 *   · `carryBusy` 记的是「忙碌只数」的**绝对数**，阈值是 `0.85 × 在册只数`；
 *   · 单只车的样本只有 0/1 两值（两次经济 pass 之间它本来就得等下一批任务），
 *     实测均值 **0.692 < 0.85** ⇒ 这条常规补员路径在 n=1 上**结构上不可达**；
 *   · 唯一还能进的出口是「hive 缺口 + (t+hash)%25 撞上本房经济槽」，而经济槽
 *     是 %7 ⇒ lcm(7,25)=175 tick 才凑巧一次，**恰好等于一只 50 部件车的孵化
 *     时间 150 tick**。实测：carrier 死亡 ~84061017，替补 84061170 才开始孵化。
 *
 * 修法：`haulerSaturated = carrierCnt <= 1 || avgBusy > alive*0.85`。
 * n=1 时利用率量不出「够不够」，单只本身就是整房经济的单点故障，无条件补到
 * 编制；编制仍由 `carrierTarget` 封顶，且 `creeps(role, false)` 把孵化中的算进
 * 编制 ⇒ 一次死亡最多补一只，不会连环刷。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");

function load() {
    const spawned = [];
    const ctx = {
        console,
        Memory: { rooms: {}, marketSettings: {} },
        // Game.time=7：让 (time+hash)%25 与 %50 都不为 0，
        // 隔离掉「hive 缺口应急补员」那两条带相位闸的分支，只测常规补员路径。
        Game: { time: 7, rooms: {}, shard: { name: "shard3" }, cpu: { bucket: 10000 }, getObjectById: () => null },
        RESOURCE_ENERGY: "energy",
        CARRY: "carry", MOVE: "move", WORK: "work",
        STRUCTURE_LINK: "link",
        StationHive: {
            HiveNeedToFill: room => room.energyAvailable < room.energyCapacityAvailable,
            trySpawn: (room, targetRoomName, body, role) => {
                spawned.push({ body, role });
                return "shard3_7_1";
            },
        },
        StationCarry: {
            getCarrierBodyConfig: () => ["carry", "carry", "carry", "move", "move"],
            generatorCarryStorageEnergyTask: () => [],
        },
        StationSources: { stationName: "stationSources" },
        StationUpgrade: { stationName: "stationUpgrade" },
        StationLab: { boostAbleLevel: () => -1 },
        ManagerCreeps: { calcBodyPart: () => ["carry", "carry", "move"] },
        UtilsTask: { task: (obj, taskName, regFun, ops) => Object.assign({ taskName }, ops || {}) },
    };
    ctx.global = ctx;
    const context = vm.createContext(ctx);
    // utils.js 给 Array 挂了 sum()，模块里 `carryBusy.sum()` 依赖它
    vm.runInContext(
        "Array.prototype.sum = function(){ var s = 0; for (var i = 0; i < this.length; i++) s += this[i]; return s; };",
        context,
    );
    vm.runInContext(raw, context, { filename: "strategy_highLevel.js" });
    assert.ok(context.global.StrategyHighLevel, "StrategyHighLevel 未导出");
    return { High: context.global.StrategyHighLevel, spawned };
}

/** 历史采样：busyAvg≈0.69 = 100 个样本里 69 个「忙碌 1 只」 */
function mkBusy(avg) {
    const n = 100;
    const ones = Math.round(n * avg);
    const arr = Array.from({ length: n }, (_, i) => (i < ones ? 1 : 0));
    // Memory 里的数组来自宿主 realm，拿不到 VM 里 patch 的 Array.prototype.sum
    arr.sum = function () { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s; };
    return arr;
}

function mkCarrier({ spawning = false } = {}) {
    return {
        body: [{ type: "carry" }, { type: "move" }],
        spawning,
        ticksToLive: 1200,
        memory: { role: "carrier" },
        isFree() { return false; },
        storeEmpty() { return true; },
    };
}

function mkRoom({ cap = 12900, avail = 11154, storageEnergy = 0, carriers = 1, keepers = 2, busyAvg = 0.69, links = 4 } = {}) {
    const room = {
        name: "E53S21",
        level: 8,
        energyAvailable: avail,
        energyCapacityAvailable: cap,
        storage: { id: "stor", store: { energy: storageEnergy } },
        terminal: null,
        link: new Array(links).fill({}),
        source: [{}, {}],
        memory: { carryBusy: mkBusy(busyAvg) },
        hashCode: () => 0,
        getEnergyAvailable() { return this.energyAvailable; },
        getEnergyCapacityAvailable() { return this.energyCapacityAvailable; },
        creeps(role, spawned = true) {
            const list = role === "carrier" ? this._carriers
                : role === "harvestEnergyKeeper" ? this._keepers : [];
            return spawned ? list.filter(e => !e.spawning) : list.slice();
        },
    };
    room._carriers = Array.from({ length: carriers }, () => mkCarrier());
    room._keepers = Array.from({ length: keepers }, () => ({ memory: { role: "harvestEnergyKeeper" } }));
    return room;
}

{
    // ── ① 只剩 1 只（编制 2）+ 利用率均值 0.69 ⇒ 必须补 ────────────────────
    const { High, spawned } = load();
    const room = mkRoom({ carriers: 1, busyAvg: 0.69 });
    High.trySpawnCarrier(room);
    assert.equal(spawned.length, 1,
        "只剩 1 只 carrier 时补员不许被「利用率 < 0.85」挡住（E53S21 地面能量 +28/tick 的根因）");
    assert.equal(spawned[0].role, "carrier");
}

{
    // ── ② 负对照：编制已满（2 只）时同样的低均值**不许**补 ────────────────
    const { High, spawned } = load();
    const room = mkRoom({ carriers: 2, busyAvg: 0.69 });
    High.trySpawnCarrier(room);
    assert.equal(spawned.length, 0,
        "编制满了就不该再加（0.85 利用率闸对 n≥2 仍然有效），实得 " + JSON.stringify(spawned));
}

{
    // ── ③ 负对照：只剩 1 只但**付不起满配体型** ⇒ 不许补（别把能量闸一起拆了）──
    const { High, spawned } = load();
    const room = mkRoom({ carriers: 1, avail: 1200, busyAvg: 0.69 });
    High.trySpawnCarrier(room);
    assert.equal(spawned.length, 0,
        "hive 缺能且可用能量 < carrierBodyMinEnergy 时不该硬孵（会置 spawnFailure 毒化整 tick）");
}

{
    // ── ④ hive 满格、只剩 1 只 ⇒ 仍要补（单点故障与 hive 缺不缺能无关）────────
    const { High, spawned } = load();
    const room = mkRoom({ carriers: 1, avail: 12900, busyAvg: 0.69 });
    High.trySpawnCarrier(room);
    assert.equal(spawned.length, 1, "hive 满 + 只剩 1 只 carrier 同样是单点故障，应补到编制");
}

{
    // ── ⑤ 超编（3 只 > 编制 2）⇒ 不补也不删 ────────────────────────────────
    const { High, spawned } = load();
    const room = mkRoom({ carriers: 3, busyAvg: 1.0 });
    High.trySpawnCarrier(room);
    assert.equal(spawned.length, 0, "超编时不该再加");
}

{
    // ── ⑥ 源码断言：n=1 的放行必须在常规补员闸里，且不能回退成裸 0.85 ────────
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(code.includes("let haulerSaturated = carrierCnt <= 1 ||"),
        "必须保留「只剩 1 只 ⇒ 视为运力打满」的放行（否则 n=1 时利用率闸永久不可达）");
    assert.ok(!/avgBusy > carrierList\.filter/.test(code),
        "常规补员闸不许再用裸的 avgBusy > 0.85×在册数（E53S21 实测均值 0.692 ⇒ 恒假）");
    const hits = code.split("haulerSaturated").length - 1;
    assert.ok(hits >= 2, "haulerSaturated 必须既被定义又被补员闸使用，实得出现 " + hits + " 次");
}

console.log("carrier-single-replenish: passed");
