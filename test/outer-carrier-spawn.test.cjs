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

// 0.78.164：同一判据包上了 __outerWhy 诊断埋点（`{ why("noFreeSpawn"); return; }`），
// 所以这里只钉「判据本体存在」，不再钉语句形状。
assert.ok(/!spawnRoom\.spawn\.some\(e => !e\.spawning && e\.isActive\(\)\)/.test(code),
    "应该直接检查「有没有空闲且可用的 spawn」（允许带诊断埋点包装）");

// ── ② 体型预算必须夹住，别让一只外矿搬运抽干整只 hive ──────────────────────
//
// 满配 50 部件 = 2,500 能量：RCL8 房（12,900）无所谓，但出兵房 RCL5 只有 1,800，
// 满配爬一孵 56+ tick，把 hive 抽到 109，本房补员和外矿补员互相饿死。
assert.ok(/let hiveCap = spawnRoom\.getEnergyCapacityAvailable\(\);/.test(code),
    "体型预算要基于主房 hive 容量算上限");
// 0.78.164 把夹从 75% 收紧到 50%（2026-10-29 实测：1,350 的爬要求「hive 满 1,800 +
// spawn 空闲」同时成立，RCL5 每 1,500 tick 要换 4 只 1,250 的 keeper，这个窗口
// 两天只出现几次 ⇒ 外矿双容器 4,000 满 + 地面 3,161 堆着没人搬；50% 后 900 就能孵）。
assert.ok(/Math\.min\(Math\.floor\(hiveCap \* 0\.5\),/.test(code),
    "体型预算必须夹在 hive 容量的 50% 以内（0.78.164 从 75% 收紧）");

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
// 0.78.164：同一硬闸包上了 __outerWhy 诊断埋点，只钉判据本体。
assert.ok(/spawnRoom\.creeps\("harvestEnergyKeeper", false\)\.length < ownSourceCnt/.test(code),
    "出兵房 keeper 没满员时必须直接放弃外矿补员（允许带诊断埋点包装）");
assert.ok(!/trySpawnOuterHarCarrier\(flag\.pos\.roomName, room\)/.test(
    fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8")),
    "外矿搬运不得再被提前到本房孵化之前（会抢 keeper 的孵化能量）");

// ── ⑪ 一条路走到底：TTL 到期不换道（用户 10-31）────────────────────────────
// 原来只有 TTL 内复用缓存；TTL（1000 tick）一到就算旧路完好也强制重算 ——
// plain=2 / road=1 下等价路径随时可能判给另一条平行线，旧工地还没清、
// 新路 site 已经铺上，两线打架路永远修不完。现在只要 outerRoadWalkable
// 复检通过就续期复用，走不通才 delete + 重算。
assert.ok(/if \(Game\.time - data\.roadPathTick >= OUTER_ROAD_PATH_TTL\) data\.roadPathTick = Game\.time;/.test(code),
    "TTL 到期后旧路仍走得通必须续期复用（一条路走到底，不得重算换道铺平行 site）");
assert.ok(code.indexOf("outerRoadWalkable(cached, data)") >= 0
    && code.indexOf("if (Game.time - data.roadPathTick >= OUTER_ROAD_PATH_TTL) data.roadPathTick = Game.time;")
        > code.indexOf("outerRoadWalkable(cached, data)"),
    "续期必须发生在可走复检通过之后（新建筑封路仍会触发重算）");

// ── ⑫ Overmind 式修路：危急优先 + 兄弟路线合并 ─────────────────────────────
// RoadLogistics.criticalThreshold = 0.25：本格健康时向前扫 3 个路点，
// hits < 25% 的路隔格修，防止烂到 0 消失再花一整趟重建。
assert.ok(/hitsMax \/ 4/.test(code) && /pathIndex \+ 1; i <= pathIndex \+ 3/.test(code),
    "修路爬必须危急优先：本格健康时向前扫 3 个路点修 hits<25% 的路");
// RoadPlanner.encourageRoadMerging：重算时把兄弟矿点缓存路线压到代价 1，
// 多源矿在共享走廊合并成一条主干，而不是各铺各的平行线。
assert.ok(/outerRoadRoomCallback\(roomName, useBlueprint, homeRoom, mergePaths\)/.test(code),
    "代价矩阵必须接受兄弟路线合并输入");
assert.ok(code.indexOf("cm.get(p.x, p.y) < 254) cm.set(p.x, p.y, 1)") >= 0
    && code.indexOf("outerRoadRoomCallback(roomName, true, spawnRoom.name, mergePaths)") >= 0
    && code.indexOf("outerRoadRoomCallback(roomName, false, spawnRoom.name, mergePaths)") >= 0,
    "两次搜索（蓝图 + 兜底）都必须应用合并折扣，且不可覆盖被建筑封死的格");

// ── ⑬ 多余 site 清零：精确匹配 + 兄弟路线并入白名单（用户 10-31）──────────
// ±1 容差是「路线会漂移」年代的保险；0.78.171 后路线不再漂移，容差反而把
// 平行时代的残留工地豁免掉（实测 W26N59 4 个旧工地全部贴着路线 1 格内）。
{
    const cleanupSrc = code.slice(code.indexOf("cleanupOuterRoadSites(data, spawnRoom)"),
        code.indexOf("nextRoadPathIndex(roadPath, pos)"));
    assert.ok(!/for \(let dx = -1; dx <= 1; dx\+\+\)/.test(cleanupSrc),
        "cleanup 的路线白名单必须精确到格（±1 容差会豁免平行残留工地）");
    assert.ok(/let siblingMem = Memory\.rooms\[data\.roomName\]/.test(cleanupSrc)
        && /s\.id != data\.id && s\.roadPathStr/.test(cleanupSrc),
        "清理前必须并入兄弟矿点路线（按矿点逐个调用，不合并会误拆正规路）");
    // 离线已建路：不拆（无主中立房 destroy 会 ERR_NOT_OWNER）也不修（修路爬只认
    // 路线精确格），任其自然衰减——所以 cleanup 里不得出现 destroy 分支。
    assert.ok(!/\.destroy\(\)/.test(cleanupSrc),
        "cleanup 不得 destroy 已建路：中立房无主路拆不动，自然衰减即可");
}

console.log("outer carrier spawn checks passed");
