// Memory.taskDispatchThrottle 开关：
//   false = 经济 pass 每 tick 跑，消灭空闲爬接任务前的 multi-tick 空窗。
// shard3 默认开启，其它 shard 强制关闭；任何 shard 都可用 Memory 显式关闭。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, "modules", f), "utf8");

const mount = read("main_mount.js");
const mountCode = mount.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const main = read("main.js");
const low = read("strategy_lowLevel.js");
const high = read("strategy_highLevel.js");

// ① Shard policy: isSaveCpu is shard3-only; even stale Memory=true cannot
// re-enable the dispatch throttle elsewhere. A persisted false disables it on shard3.
const mountPolicy = mountCode.match(/global\.isSaveCpu = Game\.shard\.name === "shard3"\s*global\.taskDispatchThrottle = isSaveCpu && Memory\.taskDispatchThrottle !== false/);
assert.ok(mountPolicy, "main_mount 必须仅在 shard3 启用 CPU 节流，并允许 Memory=false 关闭");
const initThrottle = main.match(/^\s*taskDispatchThrottle = isSaveCpu && Memory\.taskDispatchThrottle !== false;\s*$/m);
assert.ok(initThrottle, "main.init 必须每 tick 按 shard 与 Memory 重读派发开关");
assert.ok(/MIN_CPU = isSaveCpu && \(!!Memory\.mincpu/.test(main),
    "MIN_CPU 保命模式仍只对 isSaveCpu 房间启用");

function mountedPolicy(shard, memoryValue) {
    const ctx = {
        Game: {shard: {name: shard}},
        Memory: memoryValue === undefined ? {} : {taskDispatchThrottle: memoryValue},
    };
    ctx.global = ctx;
    vm.runInNewContext(mountPolicy[0], ctx);
    // main.init repeats this assignment each tick so a Memory toggle takes effect immediately.
    vm.runInNewContext(initThrottle[0], ctx);
    return {isSaveCpu: ctx.isSaveCpu, taskDispatchThrottle: ctx.taskDispatchThrottle};
}
assert.deepEqual(mountedPolicy("shard2", true), {isSaveCpu: false, taskDispatchThrottle: false},
    "shard2 必须忽略旧 Memory=true（不重新打开节流）");
assert.deepEqual(mountedPolicy("shard2", undefined), {isSaveCpu: false, taskDispatchThrottle: false},
    "shard2 未配置时也默认关闭节流");
assert.deepEqual(mountedPolicy("shard3", undefined), {isSaveCpu: true, taskDispatchThrottle: true},
    "shard3 未配置时保留节流默认值");
assert.deepEqual(mountedPolicy("shard3", false), {isSaveCpu: true, taskDispatchThrottle: false},
    "Memory=false 必须能手动关闭 shard3 节流");
assert.deepEqual(mountedPolicy("shard3", true), {isSaveCpu: true, taskDispatchThrottle: true},
    "Memory=true 保留 shard3 节流");

// ② High-RCL economy interval: non-shard3 ignores both stale true and low bucket;
// shard3 retains 7/14-tick cadence unless manually disabled. MIN_CPU still wins.
function intervalFor({shard, throttle, bucket, minCpu = false}) {
    const ctx = {
        MIN_CPU: minCpu,
        Game: {shard: {name: shard}, cpu: {bucket}},
    };
    if (throttle !== undefined) ctx.taskDispatchThrottle = throttle;
    vm.runInNewContext(`this.pro = {${/economyInterval\(\) \{[\s\S]*?\n    \},/.exec(high)[0]}};`, ctx);
    return ctx.pro.economyInterval();
}
const shard2StaleTrue = mountedPolicy("shard2", true);
assert.equal(intervalFor({shard: "shard2", throttle: shard2StaleTrue.taskDispatchThrottle, bucket: 100}), 1,
    "shard2 即使有旧 true 且 bucket 很低，经济 pass 仍每 tick 运行");
assert.equal(intervalFor({shard: "shard3", throttle: false, bucket: 10000}), 1,
    "switch 也允许 shard3 手动关闭节流");
assert.equal(intervalFor({shard: "shard3", throttle: true, bucket: 6000}), 7,
    "shard3 正常桶保持 7 tick");
assert.equal(intervalFor({shard: "shard3", throttle: true, bucket: 4000}), 14,
    "shard3 低桶保持 14 tick");
assert.equal(intervalFor({shard: "shard3", throttle: false, bucket: 10000, minCpu: true}), 10,
    "shard3 的 MIN_CPU 保命模式优先于手动关闭节流");
assert.equal(intervalFor({shard: "shard3", throttle: undefined, bucket: 10000}), 7,
    "隔离 VM 未挂开关变量时保持 shard3 旧的 7 tick 默认节流");

// ③ Low-RCL scheduling: %3 and 9-tick pick cache remain backward-compatible,
// and all migrated optional dispatch gates can be bypassed on non-shard3.
assert.ok(/function isTaskDispatchThrottled\(\) \{[\s\S]{0,120}taskDispatchThrottle/.test(low),
    "低级房必须有统一的节流判定函数");
assert.ok(/if \(isTaskDispatchThrottled\(\) && \(Game\.time \+ room\.hashCode\(\)\) % 3 != 0\)/.test(low),
    "%3 经济 pass 必须可被开关旁路");
assert.ok(/if \(!isTaskDispatchThrottled\(\) \|\| \(Game\.time \+ room\.hashCode\(\)\) % 9 == 0\)/.test(low),
    "关闭节流后拾取任务缓存也必须每 tick 刷新");
assert.ok(!/^\s*if \(\(Game\.time \+ room\.hashCode\(\)\) % 3 != 0\) \{/m.test(low),
    "不得保留无条件的 %3 早退");
assert.ok(!/^\s*if \(\(Game\.time \+ room\.hashCode\(\)\) % 9 == 0\) \{/m.test(low),
    "不得保留无条件的 9-tick 拾取刷新");

const factoryPower = read("strategy_factoryPowerCreep.js");
const scouter = read("strategy_scouter.js");
const deposits = read("strategy_deposits.js");
const powerBank = read("strategy_powerBank.js");
assert.ok(/if \(global\.taskDispatchThrottle !== false && Game\.time % 3 != 0\) return;/.test(factoryPower),
    "OPF flag/task assignment %3 gate must be bypassable");
assert.ok(/if\(global\.taskDispatchThrottle !== false && Game\.time%3!=0\)return;/.test(scouter),
    "scouter dispatch %3 gate must be bypassable");
assert.ok(/if \(global\.taskDispatchThrottle !== false && \(Game\.time \+ room\.hashCode\(\)\) % 3 != 0\) return;/.test(deposits),
    "deposit room dispatch %3 gate must be bypassable");
assert.ok(/if \(global\.taskDispatchThrottle !== false && \(Game\.time \+ room\.hashCode\(\)\) % 3 != 0\) return;/.test(powerBank),
    "powerBank new-wave decision %3 gate must be bypassable");
assert.ok(powerBank.indexOf("pro.dispatchPBSpawnQueue(room, flag)") < powerBank.indexOf("global.taskDispatchThrottle !== false"),
    "powerBank pending spawn queues must keep dispatching before the optional %3 gate");

console.log("task dispatch throttle switch: OK");
