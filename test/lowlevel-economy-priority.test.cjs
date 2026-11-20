// 0.78.274 回归：低 RCL 经济按「keeper → carrier → worker → upgrader」排序，
// carrier 从 container 取能填 hive（无 storage 时 300 门槛、允许部分装载），
// 低 RCL 建造优先容器/spawn 而不是道路。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const lowSrc = fs.readFileSync(path.join(root, "modules/strategy_lowLevel.js"), "utf8");
const sourcesSrc = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");
const workSrc = fs.readFileSync(path.join(root, "modules/station_work.js"), "utf8");

// 1) 孵化顺序：收入 keeper 最先，其次 carrier；worker/upgrader 之后
const order = [
    ["worker-rescue", lowSrc.indexOf("Math.min(rescueBudget, 200)")],
    ["keeper", lowSrc.indexOf("StationSources.trySpawnHarKeeper(room);")],
    ["carrier", lowSrc.indexOf("StationCarry.getCarrierBodyConfig(room)")],
    ["worker", lowSrc.indexOf("StationWork.getMiddleLevelWorkerBodyConfig(room)")],
    ["upgrader", lowSrc.indexOf("StationUpgrade.spawnUpgrader(room)")],
];
for (const [name, idx] of order) assert.ok(idx >= 0, name + " 的孵化调用必须存在");
for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1][1] < order[i][1],
        `${order[i - 1][0]} 必须排在 ${order[i][0]} 前面（当前 ${order[i - 1][1]} vs ${order[i][1]}）`);
}

// 1b) carrier 体型：只出满配，付不起就等；小体型在付得起满配时被替换
assert.match(lowSrc, /let fullCarrierBody = StationCarry\.getCarrierBodyConfig\(room\)/);
assert.match(lowSrc, /fullCarrierCnt < carrierTarget/,
    "编制只数满配 carrier：小体型不占名额，付得起就补满配");
assert.match(lowSrc, /carrierBudget >= fullCarrierCost/,
    "付不起满配时不得退化成小 carrier（等 hive 攒够）");
{
    const bodyIdx = lowSrc.indexOf("let fullWorkerBody = StationWork.getMiddleLevelWorkerBodyConfig(room)");
    const costIdx = bodyIdx < 0 ? -1 : lowSrc.indexOf("let fullWorkerCost = Utils.getBodyEnergyNeed(fullWorkerBody)", bodyIdx);
    const gateIdx = bodyIdx < 0 ? -1 : lowSrc.indexOf("workerBudget >= fullWorkerCost", bodyIdx);
    assert.ok(bodyIdx >= 0 && costIdx > bodyIdx && gateIdx > costIdx,
        "worker 也只出满配体型，付不起就等（用户 2026-11-18）");
}

// 2) 低级房 carry 门槛 = 300（不再等 1200 批次），且不要求满装
assert.match(lowSrc, /room\.storage \? \(StationHive\.HiveNeedToFill\(room\) \? 1200 : 300\) : 300/,
    "无 storage 的低级房容器有 300 就搬");
assert.match(sourcesSrc, /requireFullLoad: !!room\.storage/,
    "低级房 carrier 允许部分装载（满装要求会让它永远等不到）");

// 2b) hive 永远第一优先：缺能时不孵 upgrader；满载 worker 不进容器、直接回去填 hive
assert.match(lowSrc, /if \(\(!StationHive\.HiveNeedToFill\(room\) \|\| downgradeUrgent \|\| room\.isDownGrade\(\)\)/,
    "hive 缺能时不得孵化 upgrader（临近降级才例外）");
assert.match(lowSrc, /else if \(pickTasks\.length\) \{\s*\r?\n\s*creep\.addTask\(pickTasks\.shift\(\)\)/,
    "空手 worker 容器没货时也要去捡掉落能量");
assert.match(sourcesSrc, /!\(global\.StationHive && StationHive\.HiveNeedToFill\(this\.room\)\)/,
    "hive 缺能时满载 worker 不得把能量倒进容器，应直接回填 hive");

// 3) 低 RCL 建造优先容器/spawn，其次塔/extension，最后道路
{
    const sites = [
        {id: "road", structureType: "road", pos: {x: 11, y: 17}},
        {id: "container", structureType: "container", pos: {x: 25, y: 32}},
    ];
    const sandbox = {
        Creep: function () {},
        WORK: "work", CARRY: "carry", MOVE: "move",
        FIND_CONSTRUCTION_SITES: "sites",
        STRUCTURE_CONTAINER: "container", STRUCTURE_SPAWN: "spawn",
        STRUCTURE_TOWER: "tower", STRUCTURE_EXTENSION: "extension",
        UtilsTask: {task: (target, name) => ({id: target.id, taskName: name})},
        console: {log() {}},
    };
    sandbox.global = sandbox;
    vm.runInNewContext(workSrc, sandbox);
    const makeCreep = level => ({
        pos: {
            findClosestByRange: () => sites[0],
            getRangeTo(target) {
                const p = target && target.pos ? target.pos : target;
                return Math.abs(11 - p.x) + Math.abs(17 - p.y);
            },
        },
        room: {level, find: () => sites},
    });
    assert.equal(sandbox.StationWork.generatorBuildTask(makeCreep(3)).id, "container",
        "RCL3 必须优先容器工地（道路更近也不行）");
    assert.equal(sandbox.StationWork.generatorBuildTask(makeCreep(5)).id, "road",
        "RCL>=4 保持原行为（最近的工地）");
}

console.log("low-level economy priorities: keeper > carrier > worker > upgrader; containers build first");
