const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const highSource = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");

// 断言前**必须剥掉注释**：解释「为什么这样排」的注释里会原样引用被断言的表达式，
// 只查字符串会把注释当成代码命中（这坑在项目里踩过）。
const high = highSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

// ── 高等级路径：升级补给不能挂在「storage 搬运任务」门后面 ──
//
// 2026-10-23 实测 W26N58（RCL4、刚建好 storage、还没有 link）：hive 已满 + 无 link
// ⇒ `generatorCarryStorageEnergyTask` 返回空 ⇒ 整段 `if (StorageCarryEnergyTasks.length)`
// 被跳过 ⇒ 升级容器 0/2000、upgrader 抱 0 能量、进度冻结 20+ tick。
{
    // 接线已改为「先 pop 承运爬、再按它的容量预订」（原 head 算量/pop 派活错配）
    const fillIdx = high.indexOf("StationUpgrade.generatorFillEnergyTask(room.name, carrier.getPartCnt(CARRY)");
    const gateIdx = high.indexOf("if (StorageCarryEnergyTasks.length) {");
    assert.ok(fillIdx >= 0, "高等级路径必须给升级容器派补给");
    assert.ok(gateIdx >= 0, "storage 搬运门应仍然存在（不能为了修这个把门删掉）");
    assert.ok(fillIdx < gateIdx,
        "升级补给必须在 `if (StorageCarryEnergyTasks.length)` **之前**：hive 满 + 无 link 时那个列表是空的，"
        + "挂在里面就永远不会派（实测进度冻结）");
}

// ── 高等级路径：升级容器的补给不能抢走本房唯一一只搬运 ──
//
// 2026-10-27 现场事故：v0.78.144 把「升级容器补给」插到 carrierManager 的最前面，
// 结果 W26N58（只有 1 只搬运）的那只车被派去填控制器容器，**spawn/extension 永远填不满**
// → hive 停在 300 → 本房 keeper 付不起 1,250 的孵化费 → keeper 老死、收入归零 → 全房停摆。
// 结论：hive 是孵化能量的唯一来源，优先级必须高于控制器容器。
// 升级容器补给在 carrierManager 的 Hive 和塔之后。
{
    const early = high.indexOf("StationUpgrade.generatorFillEnergyTask(room.name, freeCarries[0].getPartCnt(CARRY) * 50)");
    const hiveGate = high.indexOf("if (StationHive.HiveNeedToFill(room)) {");
    assert.ok(early < 0,
        "carrierManager 里不得再抢在本房 hive 之前派升级容器任务（会把唯一一只车抽走）");
    assert.ok(hiveGate > 0, "hive 填充分支应仍然存在");
}

// 高等级房：没有空手车时，现成的载荷也能补塔，不必绕回仓库。
{
    const makeCarrier = energy => ({
        tasks: [], store: {energy}, ticksToLive: 1000,
        isFree() { return !this.tasks.length; },
        storeEmpty() { return !this.store.energy; },
        storeContainsEnergyOtherResType: () => false,
        fillAllMainRoomStorage() { this.tasks.push({id: "storage"}); },
        addTask(task) { this.tasks.push(...(Array.isArray(task) ? task : [task])); },
        getPartCnt: () => 10,
    });
    let towerNeedsFill = true;
    const sandbox = {
        Game: {time: 1}, RESOURCE_ENERGY: "energy", CARRY: "carry",
        StationHive: {HiveNeedToFill: () => false},
        StationTower: {generatorFillEnergyTasks: () => towerNeedsFill ? [{id: "tower"}] : []},
        StationSources: {generatorCarryEnergyFromLinkTask: () => []},
        StationCarry: {generatorCarryStorageEnergyTask: () => [], generatorFillPowerSpawnTask: () => []},
        StationUpgrade: {generatorFillEnergyTask: () => [{id: "upgradeContainer"}]},
    };
    sandbox.global = sandbox;
    vm.runInNewContext(highSource, sandbox);
    const pro = sandbox.StrategyHighLevel;
    pro.cleanDirtyContainers = () => {};
    const loaded = makeCarrier(500);
    const room = {name: "W0N0", level: 8, hashCode: () => 0,
        creeps: role => role === "carrier" ? [loaded] : []};
    pro.carrierManager(room);
    assert.equal(loaded.tasks[0]?.id, "tower");

    const empty = makeCarrier(0);
    towerNeedsFill = false;
    room.creeps = role => role === "carrier" ? [empty] : [];
    pro.carrierManager(room);
    assert.equal(empty.tasks[0]?.id, "upgradeContainer", "塔不需要补能时仍派升级任务");
}

console.log("upgrade fill priority checks passed");
