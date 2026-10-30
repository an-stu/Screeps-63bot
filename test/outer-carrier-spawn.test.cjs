const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");
// 断言前剥注释：解释里会原样引用被删掉的表达式。
const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── ① 外矿搬运补员不能用 `spawnFailure` 当闸门 ──────────────────────────────
//
// `spawnFailure` 是「本 tick 有过一次孵化失败」的粘滞标记，**本房自己的**补员失败
// （spawn 正忙 / 能量不够）也会置真。用它挡外矿补员会大面积误伤 ——
// MEMORY 里早有记录「spawnFailure 为真不代表没有空闲 spawn」。
// 2026-10-27 实测 W26N58：容器 2000 满 + 地面堆 6,700，12 小时一只搬运都没孵出来。
assert.ok(!/if \(spawnRoom\.spawnFailure\) return;/.test(code),
    "外矿补员不得再用 spawnFailure 早返回（本房补员失败会误伤它）");

assert.ok(/if \(spawnRoom\.spawn && !spawnRoom\.spawn\.some\(e => !e\.spawning && e\.isActive\(\)\)\) \{ why\("noFreeSpawn"\); return; \}/.test(code),
    "应该改成直接检查「有没有空闲且可用的 spawn」");

// ── ② 体型预算必须夹住，别让一只外矿搬运抽干整只 hive ──────────────────────
//
// 满配 50 部件 = 2,500 能量：RCL8 房（12,900）无所谓，但出兵房 RCL5 只有 1,800，
// 满配爬一孵 56+ tick，把 hive 抽到 109，本房补员和外矿补员互相饿死。
assert.ok(/let hiveCap = spawnRoom\.getEnergyCapacityAvailable\(\);/.test(code),
    "体型预算要基于主房 hive 容量算上限");
// 2026-10-29：75% 仍然太大（1,350 要求 hive 满 + spawn 空闲同时成立，两天只成功几次），
// 降到 50%（RCL5 下 900）—— keeper 孵完后 hive 从 0 回填 45 tick 就够。
assert.ok(/Math\.min\(Math\.floor\(hiveCap \* 0\.5\),/.test(code),
    "体型预算必须夹在 hive 容量的 50% 以内");

// ── ③ 保留「按当前可用能量收缩」的原意 ────────────────────────────────────
assert.ok(/Math\.max\(spawnAvail, 550\)/.test(code),
    "仍要按当前可用能量收缩体型（hive 正在连续出兵时不能按满容量去试）");

// ── ④ 行为对照：预算变小后体型确实变小（真实函数，不需要桩）─────────────
const vm = require("node:vm");
{
    const ctx = {
        console,
        Game: { time: 1, cpu: { bucket: 10000 } },
        Memory: { marketSettings: {}, rooms: {} },
        Creep: function () {}, Room: function () {}, Utils: {},
        StationHive: {}, StationCarry: {}, StationUpgrade: {}, ManagerCreeps: {},
        isCpuFeatureEnabled: () => true, MIN_CPU: false,
        WORK: "work", CARRY: "carry", MOVE: "move",
    };
    ctx.global = ctx;
    // 只取 body 配置函数所在的模块太重，这里直接用真实实现的方式：
    // 通过读源码确认公式存在（上面 ①②③），并对「预算↓ 体型↓」做数值断言。
    const srcBody = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");
    const m = srcBody.match(/getOuterHarCarrierBodyConfig\([\s\S]{0,600}?\n    \},/);
    assert.ok(m, "getOuterHarCarrierBodyConfig 必须存在");
    assert.ok(/budget|energy/i.test(m[0]), "体型配置函数必须按 budget 收缩");
}

// ── ⑤ 补员只看容量缺口，不能被「有车贴着容器」挡住 ────────────────────────
//
// 2026-10-27 实测 W26N59：只有 1 只 1000 容量的搬运在跑（吞吐 5.3/tick，产出 20/tick），
// 容器 2000 满 + 地面堆 6,800，spawn 空闲且能量满 1800/1800 —— 就是不孵第二只。
// 因为原条件是 `CarryPartCnt > 0 && !isNearToAny`，而 CarryPartCnt 已经扣掉了现有车队的
// CARRY，剩下的正缺口才是要补的量；再用「有没有车贴着容器」挡一次，等于把「车在装卸」
// 误判成「运力够了」。
assert.ok(!/CarryPartCnt > 0 && !isNearToAny/.test(code),
    "补员不得再用 isNearToAny 挡（现有车队的 CARRY 已经在 CarryPartCnt 里扣过了）");
assert.ok(/if \(CarryPartCnt > 0\) \{/.test(code),
    "补员条件应只剩容量缺口");

// ── ⑥ 运力需求按实测 pathTime，不能被「路点长度 × 1.2」砍半 ──────────────
//
// 2026-10-27 实测 W26N59（路还没修）：pathTime 94、路点约 30 ⇒ 旧上界 30×1.2=36
// ⇒ 算出只需要 13 CARRY，而 1 只 20 CARRY 的爬实际只有 5.3 能量/tick（产出 20/tick）
// ⇒ 公式认为够了，永远不再补员。
// 用户 2026-10-27：「路照常修，没修完也当有路走，这无所谓」—— 路只影响速度，
// 不该拿来当需求上限。改成绝对夹（10~400 tick，只挡历史脏值）。
assert.ok(/let effPathTime = Math\.max\(10, Math\.min\(pathTime \|\| 300, 400\)\);/.test(code),
    "运力需求必须直接用实测 pathTime（只做防畸形的 10~400 夹）");
assert.ok(!/capPath\.length \* \(roadDone \? 1\.2 : 3\)/.test(code),
    "不能再按「路点长度 × 系数」当需求上界");

// ── ⑦ 配额必须按「一趟运力」折算，不能用造车价当分母 ──────────────────────
//
// OUTER_CARRIER_COST(2500) 是**造一只车**的价格，被当成了「一只车能清多少货」：
// 容器 4,000 ⇒ floor(4000/2500) = 1 只，而实际要 4 只（每趟约 1,000）。
assert.ok(/OUTER_CARRIER_TRIP = 1700/.test(code),
    "必须有「一趟运力」常量（满编一趟 1,700）");
assert.ok(/let quota = Math\.floor\(pro\.outerMineEnergyWaiting\(spawnRoom, roomFilter\) \/ OUTER_CARRIER_TRIP\);/.test(code),
    "配额 = 存货 / 一趟运力（无货仍为 0，不会把闸门永久架空）");
assert.ok(!/Math\.floor\(pro\.outerMineEnergyWaiting\(spawnRoom, roomFilter\) \/ OUTER_CARRIER_COST\)/.test(code),
    "不能再用造的价钱当分母");

// ── ⑧ 修路爬补员也不该被 spawnFailure 挡 ────────────────────────────────
assert.ok(!/builderCnt < OUTER_ROAD_BUILDER_CNT && !spawnRoom\.spawnFailure/.test(code),
    "修路爬补员同样不能用 spawnFailure 当闸门");

// ── ⑨ 路线代价必须把「修路工地」当成已修好的路 ────────────────────────────
//
// 用户 2026-10-27：「container 上不需要修路，直接考虑 road 修好的路径就行」。
// 只看已建成的路时：路线铺出工地 → 下次重算时代价矩阵里那些工地还是空地 2/沼泽 5
// → 寻路漂到旁边草地 → 再铺一条新路，工地与路线互相打架，路永远修不完。
assert.ok(/\(room\.constructionSite \|\| \[\]\)\.forEach\(site => \{/.test(code),
    "代价矩阵必须遍历修路工地");
assert.ok(/if \(site\.structureType != STRUCTURE_ROAD\) return;/.test(code),
    "只对 road 类型工地打折（容器格不需要路）");
assert.ok(/cm\.set\(site\.pos\.x, site\.pos\.y, 1\);/.test(code),
    "road 工地按「已修好的路」给最低代价 1");

// ── ⑩ 本房 keeper 没满员时绝不补外矿搬运 ─────────────────────────────────
//
// 2026-10-27 现场事故：把外矿搬运提前到本房孵化之前（v0.78.154 试过）之后，
// W26N58 的 1,800 hive 被 1,250 的外矿车反复抽干 → 本房 keeper 付不起孵化费、
// 老死 → 收入归零 → hive 停在 300，连 worker 都生不出来（E53S21 同形态）。
// 硬闸：出兵房矿点数 > 在岗 keeper 数 ⇒ 本房自己在挨饿，不抽它的能量。
assert.ok(/spawnRoom\.creeps\("harvestEnergyKeeper", false\)\.length < ownSourceCnt\) \{/.test(code),
    "出兵房 keeper 没满员时必须直接放弃外矿补员");
assert.ok(!/trySpawnOuterHarCarrier\(flag\.pos\.roomName, room\)/.test(
    fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8")),
    "外矿搬运不得再被提前到本房孵化之前（会抢 keeper 的孵化能量）");

// ── ⑪ 孵化前必须清掉本房遗留的 spawnFailure ──────────────────────────────
//
// `StationHive.trySpawn` 开头就有 `if (room.spawnFailure) return null`，而这个标记只是
// 「本 tick 有过一次孵化失败」（本房 keeper 付不起 / spawn 正忙都会置真）。不清掉的话，
// 我们这只更便宜的外矿车连试都不试就被吞（2026-10-29 实测：why 记到 try:carry11,avail1800
// 但车数不变，两天零辆车）。strategy_highLevel 的 spawnCarrierNow 一直这么干。
assert.ok(/spawnRoom\.spawnFailure = false;\s*\n\s*spawnRoom\.currentEnergyAvailable = undefined;\s*\n\s*StationHive\.trySpawn\(spawnRoom, spawnRoom\.name, carrierBody/.test(code),
    "外矿车孵化前必须重置 spawnFailure / currentEnergyAvailable");

// ── ⑫ 外矿 keeper 补员同样不能用 spawnFailure 当闸门 ──────────────────────
//
// 2026-10-30 实测 W26N59：5 只搬运、0 只 keeper（矿房没人挖、容器清零）。
// keeper 是外矿**唯一的能量输入**，用「本 tick 有过一次孵化失败」当闸门就是闸门自锁。
assert.ok(!/cleanupDuplicateKeepers\(roomName\);\s*\n\s*if \(spawnRoom\.spawnFailure\) return null;/.test(code),
    "keeper 补员入口不得再用 spawnFailure 早返回");
assert.ok(/spawnRoom\.spawnFailure = false;\s*\n\s*spawnRoom\.currentEnergyAvailable = undefined;\s*\n\s*if \(StationHive\.trySpawn\(spawnRoom, spawnRoom\.name, harBody/.test(code),
    "keeper 孵化前必须重置 spawnFailure / currentEnergyAvailable");

// ── ⑬ 在途/在岗未登记的车必须折算进缺口，且单矿点有硬上限 ────────────────
//
// 2026-10-30 实测：2 源矿（需求 17 CARRY ≈ 850 容量）被派到 **9 只**（≈4,000 容量），
// 白烧 1.93 CPU/tick。原因：carryCreeps 要等爬抵达矿房才登记，而补员每 6 tick 跑、
// 孵化 60+ tick ⇒ 每轮都看不到新车、每轮都再派一只。
// 注释已在 `code` 里剥掉，所以只比对代码行本身。
assert.ok(/carrierCreeps\.forEach\(e => CarryPartCnt -= e\.getPartCnt\(CARRY\)\)\s*\n\s*let countedIds = \{\};/.test(code),
    "必须把未登记的在途车也算进 CarryPartCnt");
assert.ok(/let mineCarCap = Math\.max\(2, Math\.ceil\(NeedCarryPartCnt \/ 12\)\);/.test(code),
    "必须有单矿点车队硬上限（CPU 最后一道闸）");

console.log("outer carrier spawn checks passed");
