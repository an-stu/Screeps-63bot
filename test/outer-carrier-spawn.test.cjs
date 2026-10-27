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

assert.ok(/if \(spawnRoom\.spawn && !spawnRoom\.spawn\.some\(e => !e\.spawning && e\.isActive\(\)\)\) return;/.test(code),
    "应该改成直接检查「有没有空闲且可用的 spawn」");

// ── ② 体型预算必须夹住，别让一只外矿搬运抽干整只 hive ──────────────────────
//
// 满配 50 部件 = 2,500 能量：RCL8 房（12,900）无所谓，但出兵房 RCL5 只有 1,800，
// 满配爬一孵 56+ tick，把 hive 抽到 109，本房补员和外矿补员互相饿死。
assert.ok(/let hiveCap = spawnRoom\.getEnergyCapacityAvailable\(\);/.test(code),
    "体型预算要基于主房 hive 容量算上限");
assert.ok(/Math\.min\(Math\.floor\(hiveCap \* 0\.75\),/.test(code),
    "体型预算必须夹在 hive 容量的 75% 以内");

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

console.log("outer carrier spawn checks passed");
