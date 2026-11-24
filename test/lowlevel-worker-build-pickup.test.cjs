// 0.78.322 回归：无 storage 的低级房里，空手 worker 必须有一条**自己的**低门槛
// 取能流，否则工地永远排不上（carrier 把 ≥300 的单子吃干净，而 buildConst 只
// 允许载货 worker 施工）。
//
// 现场（shard2 E47S29，RCL4、无 storage）：4 个工地 10 分钟 0 进度（其中一个
// extension 恒 0/3000）、hive 1150/1150 顶格、3 只 worker 全程空手无任务，
// 两个源容器在 192~384 之间来回。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const lowSource = fs.readFileSync(path.join(root, "modules", "strategy_lowLevel.js"), "utf8");
const sourcesSource = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");

// 断言前必须剥注释：解释「为什么这样排」的注释里会原样引用被断言的表达式。
// 顺便统一行尾：仓库里这些模块是 CRLF，按 "\n" 拼多行串会匹配不到（会静默变成 -1）。
const low = lowSource
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
const sources = sourcesSource.replace(/\r\n/g, "\n");

// ── 1) 真实 generatorCarryEnergyTask 的门槛语义（桩不能和线上漂） ──
assert.match(sources,
    /container\.store\[RESOURCE_ENERGY\] > minEnergy && !room\.used\[container\.id\]/,
    "源容器派车门槛必须仍是「严格大于 minEnergy」——本测试的桩按这个语义写");

// ── 2) 接线：worker 空手出口链的第三档 ──
{
    const pickupIdx = low.indexOf("pro.lowThresholdWorkerPickup(room)");
    const workerLoopIdx = low.indexOf("workers.filter(e => e.storeEmpty() && e.isFree()).forEach");
    const carryIdx = low.indexOf("if (carryTasks.length) {\n                    creep.addTask(carryTasks.pop())");
    assert.ok(low.indexOf("lowThresholdWorkerPickup(room, minEnergy = 100)") >= 0,
        "helper 必须存在，且默认门槛 100（worker 容量 250，一趟 100 就能开工）");
    assert.ok(pickupIdx >= 0, "worker 空手出口必须调用 lowThresholdWorkerPickup");
    assert.ok(workerLoopIdx >= 0 && pickupIdx < workerLoopIdx,
        "低门槛取能清单必须在 worker 派活之前算（否则算不到本 pass 的剩余单子）");
    assert.ok(carryIdx >= 0, "原有的 carryTasks 出口不能删：先给大单，再给碎能量");
    assert.ok(low.indexOf("else if (workerPickup.length)") > carryIdx,
        "低门槛出口必须排在 carryTasks / pickTasks 之后（不许抢 carrier 的大单）");
}

// ── 3) 行为：helper 的选择与排除 ──
{
    const sandbox = {
        Creep: function Creep() {},
        Game: { time: 1 },
        console: { log() {} },
    };
    sandbox.global = sandbox;

    // 忠实复刻 generatorCarryEnergyTask 的门槛：energy > minEnergy 且未被 used
    const containers = {
        c1: { id: "c1", pos: { x: 1, y: 1, roomName: "W0N0" }, store: { energy: 320 } },
        c2: { id: "c2", pos: { x: 2, y: 2, roomName: "W0N0" }, store: { energy: 200 } },
        c3: { id: "c3", pos: { x: 3, y: 3, roomName: "W0N0" }, store: { energy: 40 } },
    };
    sandbox.StationSources = {
        stationName: "stationSources",
        generatorCarryEnergyTask(room, minEnergy = 1200) {
            const out = [];
            const stations = (room.memory && room.memory.stationSources) || {};
            Object.keys(stations).forEach(key => {
                const container = containers[stations[key].container];
                if (container && container.store.energy > minEnergy) out.push([{ id: container.id }]);
            });
            return out;
        },
    };
    sandbox.UtilsTask = {};
    vm.runInNewContext(lowSource, sandbox);
    const pro = sandbox.StrategyLowLevel;

    const makeTask = id => ({ id });
    const carrier = { memory: { tasks: [makeTask("c1")] } };
    const makeRoom = (extra = {}) => Object.assign({
        name: "W0N0",
        memory: { stationSources: { s1: { container: "c1" }, s2: { container: "c2" }, s3: { container: "c3" } } },
        constructionSite: [{}],
        creeps: role => (role === "carrier" ? [carrier] : []),
    }, extra);

    // 无 storage + 有工地：只剩 c2（c1 已被 carrier 认领、c3 不够门槛）
    const picked = pro.lowThresholdWorkerPickup(makeRoom());
    assert.equal(picked.length, 1, "只能派一条，且必须排除已被 carrier 认领的容器");
    assert.equal(picked[0][0].id, "c2",
        "派给 worker 的必须是「carrier 门槛(300)够不到、worker 门槛(100)够得到」的那个容器");

    // 负对照：旧口径（300）下这条流是空的 —— 这正是 freeze 的成因
    assert.equal(sandbox.StationSources.generatorCarryEnergyTask(makeRoom(), 300).length, 1,
        "300 门槛下只有 c1 合格，而 c1 会被 carrier 先领走 ⇒ worker 无单可接");
    assert.equal(picked[0][0].id === "c1", false, "worker 拿到的不能是 carrier 先看中的那一个");

    // 有 storage 的房不许在这里抢（走现成的 storage→工地链）
    assert.equal(pro.lowThresholdWorkerPickup(makeRoom({ storage: { id: "st" } })).length, 0,
        "有 storage 的房间必须返回空：不要把高级房的搬运优先级搅乱");

    // 没工地：worker 待在原地，不必为它抢能量
    assert.equal(pro.lowThresholdWorkerPickup(makeRoom({ constructionSite: [] })).length, 0,
        "没有工地时不该派取能任务（避免取—倒乒乓）");

    // 没 carrier 认领时应当同时看到 c1/c2
    const idleCarrier = { memory: { tasks: [] } };
    const both = pro.lowThresholdWorkerPickup(makeRoom({ creeps: () => [idleCarrier] }));
    assert.deepEqual(both.map(list => list[0].id), ["c1", "c2"],
        "carrier 没认领时两个够门槛的容器都应在清单里，由 addTask 逐只分掉");
}

console.log("lowlevel-worker-build-pickup OK");
