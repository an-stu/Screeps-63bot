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
        UtilsTask: {task: (target, name) => ({taskName: name, id: "auto"})},
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

// ── 升级补给必须在「源容器 → storage」派发之前（有限缓冲先于无限下沉）──
//
// 2026-11-23 W31N51（shard2、RCL4、无升级 link、storage 21 万）实测：carrierTarget=3，
// 两个源容器（1,976 / 774）每 pass 各吃掉一只，第三只也被 `carryEnergyAuto` 补位 ⇒
// 升级容器恒 0、8 只 upgrader 抱 0 能量站了 280+ tick、控制器进度冻结在 197,416，
// 而 `StationUpgrade.generatorFillEnergyTask` 单独调用完全正常（返回 fillRes）。
// 根因是同一 pass 内的派发顺序：它排在源容器搬运后面，就永远只剩"空池"。
{
    const fillCall = high.indexOf("StationUpgrade.generatorFillEnergyTask(room.name, carrier.getPartCnt(CARRY)");
    const towerLoop = high.indexOf("if (fillTowerTasks.length) {");
    const sourceHaul = high.indexOf('let emptyPool = room.creeps("carrier")');
    assert.ok(fillCall >= 0 && towerLoop >= 0 && sourceHaul >= 0, "三个锚点都必须存在");
    assert.ok(fillCall > towerLoop,
        "升级补给必须在塔之后（10-27 事故：抢在 hive/塔之前会把唯一一只车抽走）");
    assert.ok(fillCall < sourceHaul,
        "升级补给必须在 `let emptyPool`（源容器 → storage 派发）之前：那一段会吃掉每一个"
        + "空闲空手 carrier，排在它后面等于永远轮不到（W31N51 容器恒 0、进度冻结 280+ tick）");
}

// ── 行为：源容器抢不走升级容器的最后一只车 ──
{
    const makeCarrier = (id, energy) => ({
        name: id,
        store: {energy, getCapacity: () => 400},
        ticksToLive: 1000,
        isFree() { return !this.tasks.length; },
        storeEmpty() { return !this.store.energy; },
        storeContainsEnergyOtherResType: () => false,
        fillAllMainRoomStorage() { this.tasks.push({taskName: "fillRes", id: "storage"}); },
        addTask(task) { this.tasks.push(...(Array.isArray(task) ? task : [task])); },
        getPartCnt: () => 8,
        tasks: [],
    });
    let upgradeNeeds = true;
    const makeSandbox = () => {
        const box = {
            Game: {time: 1, getObjectById: id => ({store: {energy: id === "src1" ? 1976 : 774}})},
            RESOURCE_ENERGY: "energy", CARRY: "carry",
            _: {values: value => Object.values(value)},
            StationHive: {HiveNeedToFill: () => false},
            StationTower: {generatorFillEnergyTasks: () => []},
            StationSources: {stationName: "stationSources", generatorCarryEnergyFromLinkTask: () => []},
            StationCarry: {generatorCarryStorageEnergyTask: () => [], generatorFillPowerSpawnTask: () => []},
            StationMineral: {generatorCarryMineralTask: () => []},
            UtilsTask: {task: (target, name) => ({taskName: name, id: "auto"})},
            StationUpgrade: {
                generatorFillEnergyTask: () => upgradeNeeds ? [{taskName: "fillRes", id: "upgradeContainer"}] : [],
            },
        };
        box.global = box;
        vm.runInNewContext(highSource, box);
        box.StrategyHighLevel.cleanDirtyContainers = () => {};
        return box;
    };
    const makeRoom = carries => ({
        name: "W31N51", level: 4, hashCode: () => 0, link: [],
        storage: {store: {getFreeCapacity: () => 50000}},
        memory: {stationSources: {one: {container: "src1"}, two: {container: "src2"}}},
        creeps: role => role === "carrier" ? carries : (role === "harvestEnergyKeeper" ? [{}] : []),
    });

    // 3 只车 + 2 个有货的源容器 + 升级容器饿着：必须有一个车拿到升级补给
    {
        const box = makeSandbox();
        const carries = [makeCarrier("a", 0), makeCarrier("b", 0), makeCarrier("c", 0)];
        box.StrategyHighLevel.carrierManager(makeRoom(carries));
        const upg = carries.filter(c => c.tasks.some(t => t.id === "upgradeContainer"));
        // 源容器派发：「只有一条 carryEnergyAuto」的车 = 只拿了搬运任务的那些。
        // 升级容器那只车现在会**多一条**取能任务（见 attachPickupForEmptyFill），
        // 所以不能再用「有 carryEnergyAuto 的车数」当运力计数。
        const src = carries.filter(c => c.tasks.length === 1 && c.tasks[0].taskName === "carryEnergyAuto");
        assert.equal(upg.length, 1, "升级容器必须有恰好 1 只车（不能被源容器全部吃掉）");
        assert.equal(src.length, 2, "剩下的运力仍要派去源容器，不许把搬运全抽走");
    }

    // 关键现场：**同一时刻只有 1 只车空闲**，而两个源容器都有货。
    // 修复前这一只必被源容器搬运吃掉（`availableLoads` 有 2 条，循环把空池吃干），
    // 升级容器永远拿不到车 —— 这正是 W31N51 连续 280+ tick 的真实形态。
    {
        const box = makeSandbox();
        const makes = [makeCarrier("busy1", 400), makeCarrier("busy2", 800), makeCarrier("idle", 0)];
        makes[0].tasks.push({taskName: "fillRes", id: "storage"});
        makes[1].tasks.push({taskName: "carryEnergyAuto", id: "auto"});
        box.StrategyHighLevel.carrierManager(makeRoom(makes));
        assert.equal(makes[2].tasks[0]?.id, "upgradeContainer",
            "唯一一只空闲车必须先补升级容器（有限缓冲），不能被源容器搬运吃掉");
    }

    // 负对照：升级容器不需要补时，三只车全部回到源容器搬运
    {
        upgradeNeeds = false;
        const box = makeSandbox();
        const carries = [makeCarrier("a", 0), makeCarrier("b", 0), makeCarrier("c", 0)];
        box.StrategyHighLevel.carrierManager(makeRoom(carries));
        assert.equal(carries.filter(c => c.tasks.some(t => t.id === "upgradeContainer")).length, 0,
            "容器满时不许再占车");
        assert.equal(carries.filter(c => c.tasks.some(t => t.taskName === "carryEnergyAuto")).length, 2,
            "容器满时的派发应与修复前一致（运力回到源容器）");
        upgradeNeeds = true;
    }

    // 退化情形「只剩 1 个执行者」：hive 已满 ⇒ 这一只先补升级容器（有限缓冲），
    // 容器满后自动回到源容器搬运 —— 不许把它永久钉在升级容器上。
    {
        const box = makeSandbox();
        const only = [makeCarrier("solo", 0)];
        box.StrategyHighLevel.carrierManager(makeRoom(only));
        assert.equal(only[0].tasks[0]?.id, "upgradeContainer", "唯一一只车应先补有限缓冲");

        upgradeNeeds = false;
        const box2 = makeSandbox();
        const solo2 = [makeCarrier("solo", 0)];
        box2.StrategyHighLevel.carrierManager(makeRoom(solo2));
        assert.equal(solo2[0].tasks[0]?.taskName, "carryEnergyAuto",
            "容器满了以后唯一一只车必须回到源容器搬运");
        upgradeNeeds = true;
    }
}

// ── 空手车拿到「光秃秃的 fillRes」会当场丢掉（2026-11-24 shard2 E56S29）──
//
// `Creep.prototype.fillRes` 开头就判 `this.store[resType] == 0` 然后 popTask，
// 它唯一的自救是从 mass store（storage/terminal）重定向取能。**storage 干、
// 能量全在源容器里的 RCL4 房**（E56S29：storage 0~770、三个容器合计 3.4k、无 terminal）
// 两条路都走不通 ⇒ 派发被丢弃。插桩实测：26 tick 内 `generatorFillEnergyTask` 被调 9 次，
// 空手车执行 fillRes 也正好 9 次 —— 9/9 全丢，升级容器从 616 被抽到 368，
// 塔停在 587 反复生成补能任务却拿不到能量。
// 修法：凡是把 fillRes 派给空手车，都必须**后加**一条取能任务（addTask 是栈，后加先跑）。
{
    const makeCarrier = (id, energy) => ({
        name: id,
        tasks: [],
        store: {energy, getCapacity: () => 400},
        ticksToLive: 1000,
        isFree() { return !this.tasks.length; },
        storeEmpty() { return !this.store.energy; },
        storeContainsEnergyOtherResType: () => false,
        fillAllMainRoomStorage() { this.tasks.push({taskName: "fillRes", id: "storage"}); },
        addTask(task) { this.tasks.push(...(Array.isArray(task) ? task : [task])); },
        getPartCnt: () => 8,
    });
    const box = (towerNeeds) => {
        const b = {
            Game: {time: 1, getObjectById: () => null},
            RESOURCE_ENERGY: "energy", CARRY: "carry",
            _: {values: v => Object.values(v)},
            StationHive: {HiveNeedToFill: () => false},
            StationTower: {generatorFillEnergyTasks: () => towerNeeds ? [{taskName: "fillRes", id: "tower"}] : []},
            StationSources: {stationName: "stationSources", generatorCarryEnergyFromLinkTask: () => []},
            // storage 搬运链为空 = E56S29 的现场（storage 里不够一整车）
            StationCarry: {generatorCarryStorageEnergyTask: () => [], generatorFillPowerSpawnTask: () => []},
            StationMineral: {generatorCarryMineralTask: () => []},
            UtilsTask: {task: (target, name) => ({taskName: name, id: "auto"})},
            StationUpgrade: {generatorFillEnergyTask: () => [{taskName: "fillRes", id: "upgradeContainer"}]},
        };
        b.global = b;
        vm.runInNewContext(highSource, b);
        b.StrategyHighLevel.cleanDirtyContainers = () => {};
        return b;
    };
    const room = carries => ({
        name: "E56S29", level: 8, hashCode: () => 0, link: [],
        storage: {store: {getFreeCapacity: () => 50000}},
        memory: {},
        creeps: role => role === "carrier" ? carries : [],
    });

    // 升级容器补给：空手车必须同时拿到取能任务，且取能排在 fillRes **之后**（先跑）
    {
        const b = box(false);
        const c = [makeCarrier("solo", 0)];
        b.StrategyHighLevel.carrierManager(room(c));
        assert.equal(c[0].tasks.length, 2, "空手车必须同时拿到 fillRes 与取能任务");
        assert.equal(c[0].tasks[0].id, "upgradeContainer", "fillRes 在栈底");
        assert.equal(c[0].tasks[1].taskName, "carryEnergyAuto", "取能任务必须在栈顶（先执行）");
    }
    // 塔补给：同一处缺陷（storage 搬运链为空时原来同样丢任务）
    {
        const b = box(true);
        const c = [makeCarrier("solo", 0)];
        b.StrategyHighLevel.carrierManager(room(c));
        assert.equal(c[0].tasks[0].id, "tower", "塔优先");
        assert.equal(c[0].tasks[1].taskName, "carryEnergyAuto", "空手车补塔也必须带取能");
    }
    // 负对照：本来就有载荷的车不许被塞取能任务（它自己就是能量来源）
    {
        const b = box(false);
        const c = [makeCarrier("loaded", 300)];
        b.StrategyHighLevel.carrierManager(room(c));
        assert.equal(c[0].tasks.length, 1, "带载荷的车只拿 fillRes，不许再挂取能");
        assert.equal(c[0].tasks[0].id, "upgradeContainer");
    }
    // 源码钉子：两处塔派发都必须走 helper，不许留着「只挂 storage 链」的裸写法
    {
        const raw = highSource.match(/if \(creep\.storeEmpty\(\) && StorageCarryEnergyTasks\.length\) creep\.addTask\(StorageCarryEnergyTasks\)/g);
        assert.equal(raw, null, "塔派发必须走 attachPickupForEmptyFill，裸写法会让 storage 干的房丢任务");
        const calls = highSource.match(/pro\.attachPickupForEmptyFill\(/g) || [];
        assert.ok(calls.length >= 3, "塔 ×2 + 升级容器 ×1 都应调用 attachPickupForEmptyFill");
    }
}

console.log("upgrade fill priority checks passed");
