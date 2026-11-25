// Memory.taskDispatchThrottle 开关：
//   true  = 沿用 shard3 的省 CPU 派发节流；
//   false = 经济 pass 每 tick 跑，消灭空闲爬接任务前的 multi-tick 空窗。
// 默认只在 shard3 开启，其他 shard 默认关闭。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, "modules", f), "utf8");

const mount = read("main_mount.js");
const main = read("main.js");
const low = read("strategy_lowLevel.js");
const high = read("strategy_highLevel.js");

// ① 默认值：shard3 开、其他 shard 关；Memory 布尔值可覆盖
assert.ok(/global\.taskDispatchThrottle = typeof Memory\.taskDispatchThrottle === "boolean"[\s\S]{0,120}Game\.shard\.name === "shard3"/.test(mount),
    "main_mount 必须按 shard 设置派发节流默认值（仅 shard3 开）");
assert.ok(/taskDispatchThrottle = typeof Memory\.taskDispatchThrottle === "boolean"[\s\S]{0,120}Game\.shard\.name === "shard3"/.test(main),
    "main.init 必须每 tick 重读 Memory.taskDispatchThrottle，使控制台切换立即生效");

// ② 高 RCL：economyInterval=false 时每 tick 一次
function intervalFor({shard, throttle, bucket, minCpu = false}) {
    const ctx = {
        MIN_CPU: minCpu,
        Game: {shard: {name: shard}, cpu: {bucket}},
    };
    if (throttle !== undefined) ctx.taskDispatchThrottle = throttle;
    vm.runInNewContext(`this.pro = {${/economyInterval\(\) \{[\s\S]*?\n    \},/.exec(high)[0]}};`, ctx);
    return ctx.pro.economyInterval();
}
assert.equal(intervalFor({shard: "shard2", throttle: false, bucket: 10000}), 1,
    "shard2 关闭节流后经济 pass 必须每 tick 运行");
assert.equal(intervalFor({shard: "shard3", throttle: false, bucket: 10000}), 1,
    "switch 也允许 shard3 手动关闭节流");
assert.equal(intervalFor({shard: "shard2", throttle: true, bucket: 10000}), 5,
    "显式开启节流时恢复 shard2 原 5 tick 间隔");
assert.equal(intervalFor({shard: "shard3", throttle: true, bucket: 6000}), 7,
    "shard3 正常桶保持 7 tick");
assert.equal(intervalFor({shard: "shard3", throttle: true, bucket: 4000}), 14,
    "shard3 低桶保持 14 tick");
assert.equal(intervalFor({shard: "shard2", throttle: false, bucket: 100, minCpu: true}), 10,
    "MIN_CPU 是低桶保命模式，所有 shard 仍限流");
assert.equal(intervalFor({shard: "shard2", throttle: undefined, bucket: 10000}), 5,
    "VM/离线环境没有开关变量时保持旧行为（默认节流）");

// ③ 低 RCL：%3 与 9-tick 拾取缓存都受开关控制
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

console.log("task dispatch throttle switch: OK");