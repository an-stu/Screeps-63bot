/**
 * keeper 续派：**只挡真正的重复**（用户 2026-10-14 定案）。
 *
 * 背景：`station_sources.js:331` 把 `data.spawnTime` 倒推 `pathTime + 体型×3 − 6`，
 * 就是为了让续派**提前**在「老 keeper 死前 pathTime+孵化时间−6 tick」发出，交接只差 ~6 tick。
 * 但原守卫 `spawnRoom.creeps(role, false)...length > 0 ⇒ return` 里的 `false` 是
 * 「**不过滤正在孵化的**」（见 prototype_room.js:7），于是老那只还活着时它恒为 1，
 * 提前量判据根本走不到 ⇒ 实际断档 = 整个孵化时间 + 赶路（实测 W33N53 的源因此满仓）。
 *
 * 新判据：派成功时在**在岗那只**的 memory 上打 `successorSpawned`；
 * 同矿点只要还有一只带这个标记的爬（在孵或在岗都算）就不再重复派。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

// lodash 的数组扩展在游戏里由全局加载提供，宿主 realm 也要有（源码用了 .head()）
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

const CONSTANTS = {
    OK: 0, ERR_NOT_OWNER: -1, ERR_NO_PATH: -2, ERR_BUSY: -4, ERR_INVALID_TARGET: -7,
    ERR_NOT_IN_RANGE: -9, ERR_NO_BODYPART: -12, ERR_NOT_ENOUGH_ENERGY: -6,
    MOVE: "move", WORK: "work", CARRY: "carry", ATTACK: "attack", HEAL: "heal",
    TOUGH: "tough", RANGED_ATTACK: "ranged_attack", CLAIM: "claim",
    LOOK_STRUCTURES: "structures", LOOK_CREEPS: "creeps",
    STRUCTURE_KEEPER_LAIR: "keeperLair", STRUCTURE_INVADER_CORE: "invaderCore",
    STRUCTURE_RAMPART: "rampart", STRUCTURE_CONTAINER: "container",
    STRUCTURE_EXTENSION: "extension", STRUCTURE_SPAWN: "spawn", STRUCTURE_TOWER: "tower",
    STRUCTURE_STORAGE: "storage", STRUCTURE_TERMINAL: "terminal", STRUCTURE_LINK: "link",
    STRUCTURE_LAB: "lab", STRUCTURE_FACTORY: "factory", STRUCTURE_EXTRACTOR: "extractor",
    STRUCTURE_POWER_BANK: "powerBank", STRUCTURE_POWER_SPAWN: "powerSpawn",
    FIND_HOSTILE_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_STRUCTURES: 103,
    FIND_SOURCES: 104, FIND_MY_STRUCTURES: 105, FIND_SOURCES_ACTIVE: 106,
    FIND_DROPPED_RESOURCES: 107, FIND_TOMBSTONES: 108, FIND_DEPOSITS: 109,
    FIND_STRUCTURES: 110, FIND_CONSTRUCTION_SITES: 111, FIND_MINERALS: 112,
    RESOURCE_ENERGY: "energy", RESOURCE_OPS: "ops", RESOURCE_POWER: "power",
    PWR_REGEN_SOURCE: 13,
};

function loadStation(extra = {}) {
    const ctx = {
        ...CONSTANTS,
        console: { log() {} },
        isSaveCpu: false,
        _: { values: o => Object.keys(o || {}).map(k => o[k]) },
        Game: {
            time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" },
            getObjectById: () => null, creeps: {}, map: { getRoomLinearDistance: () => 1 },
        },
        Memory: { rooms: {} },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { return { x, y, roomName }; },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => "newKeeper" },
        UtilsTask: { task: (t, n) => ({ id: t.id, taskName: n }), taskData: n => ({ taskName: n }) },
        PathFinder: { search: () => ({ path: [0, 1, 2] }) },
        MIN_CPU: false,
        ...extra,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_sources.js" });
    return ctx;
}

/** 造一个「本房自己的矿点」场景：Memory 里一个 source data + 指定的在岗爬 */
function setup(ctx, { keeperTtl = 60, keeperMemory = {}, spawnOk = true, spawnTimeAge = 1600 } = {}) {
    const stationName = ctx.StationSources.stationName;
    ctx.Memory.rooms["W1N1"] = {
        [stationName]: {
            src1: {
                id: "src1", container: undefined,
                spawnTime: ctx.Game.time - spawnTimeAge,
                creeps: keeperTtl === null ? [] : ["k1"],
            },
        },
    };
    const keeper = keeperTtl === null ? null : {
        id: "k1", name: "k1", spawning: false, ticksToLive: keeperTtl,
        body: [{ type: ctx.MOVE }, { type: ctx.MOVE }, { type: ctx.MOVE },
               { type: ctx.MOVE }, { type: ctx.MOVE }],   // 5 部件 ⇒ 孵化 15 tick
        memory: Object.assign({ role: "harvestEnergyKeeper" }, keeperMemory),
        headTask: () => ({ id: "src1", taskName: "harvestEnergyKeeper" }),
    };
    const spawnCalls = [];
    const carrier = { id: "c1", spawning: false, ticksToLive: 1000, memory: { role: "carrier" }, headTask: () => ({ id: "hx" }) };

    const room = {
        name: "W1N1", my: true, level: 8, spawnFailure: false,
        getEnergyCapacityAvailable: () => 12900, energyAvailable: 12900,
        creeps(role, spawned = true) {
            if (role === "harvestEnergyKeeper") {
                if (!keeper) return [];
                // spawned=false ⇒ 含正在孵化的（这里 keeper 不是 spawning，所以两者相同）
                return spawned ? [keeper] : [keeper];
            }
            if (role === "carrier") return [carrier];
            return [];
        },
        find: () => [],
    };
    ctx.StationSources.outerMineStarvesSpawnRoom = () => false;
    ctx.StationSources.homeMiningPaused = () => false;
    // cleanupDuplicateKeepers 会用 Game.getObjectById 过滤登记表里的死爬：
    // 桩成恒 null 会把内存里的登记清空 ⇒ 反而触发「空矿点立刻补」那条路径。
    ctx.Game.getObjectById = id => (id === "k1" ? keeper : id === "c1" ? carrier : null);
    // 这些在本测试里不是重点，桩掉以免噪音
    ctx.StationSources.getHarvesterBodyConfig = () => [ctx.MOVE];
    ctx.StationSources.generatorHarTask = () => [];
    ctx.StationSources.generatorOuterHarTask = () => [];
    ctx.StationHive.trySpawn = (...args) => { spawnCalls.push(args); return spawnOk ? "newKeeper" : undefined; };
    return { room, keeper, spawnCalls };
}

{
    // ① 在岗那只还早（远不到期）→ 不补
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, spawnCalls } = setup(ctx, { keeperTtl: 1400, spawnTimeAge: 100 });
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 0, "到期还早 ⇒ 不派");
}

{
    // ② **核心**：老那只剩余寿命 ≤ 提前量（赶路+孵化+余量）→ 必须派。
    //    注意 spawnTimeAge = 1490 是**实测的真实值**（所有主房源满足 `记录龄 + ttl = 1500`，
    //    因为 registerStationSources 在孵化期间把 spawnTime 写成出生时刻）—— 旧判据
    //    `Game.time - spawnTime > 1500` 在这个真实值下**不会触发**，正是断档的原因。
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, keeper, spawnCalls } = setup(ctx, { keeperTtl: 10, spawnTimeAge: 1490 });
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 1, "到点就要提前派（提前量必须生效）");
    assert.equal(spawnCalls[0][3], "harvestEnergyKeeper", "派的是 keeper");
    assert.equal(keeper.memory.successorSpawned, true, "派成功后要在在岗那只身上打标记");
}

{
    // ③ 已经打了标记（接班人在路上/已在岗）→ 不重复派
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, spawnCalls } = setup(ctx, { keeperTtl: 10, spawnTimeAge: 1490, keeperMemory: { successorSpawned: true } });
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 0, "带标记就不再重复生");
}

{
    // ③b **已经有接班人在孵化** → 不重复派。
    //     在岗那只死后它的 memory（连同标记）一起消失，此时孵化中的接班人还没标记，
    //     若不看 spawning，`data.creeps.length == 0` 会立刻再派一只
    //     （实测 E41S32 两个源同时 3 只在孵、W33N55 攒到 5 只 keeper）。
    const ctx = loadStation();
    const S = ctx.StationSources;
    const stationName = S.stationName;
    ctx.Memory.rooms["W1N1"] = {
        [stationName]: { src1: { id: "src1", spawnTime: ctx.Game.time - 1600, creeps: [] } },
    };
    const spawning = {
        id: "k2", name: "k2", spawning: true, ticksToLive: undefined, memory: { role: "harvestEnergyKeeper" },
        headTask: () => ({ id: "src1", taskName: "harvestEnergyKeeper" }),
    };
    const spawnCalls = [];
    ctx.StationHive.trySpawn = (...a) => { spawnCalls.push(a); return "x"; };
    ctx.StationSources.outerMineStarvesSpawnRoom = () => false;
    ctx.StationSources.homeMiningPaused = () => false;
    ctx.StationSources.getHarvesterBodyConfig = () => [ctx.MOVE];
    ctx.StationSources.generatorHarTask = () => [];
    ctx.Game.getObjectById = id => (id === "k2" ? spawning : null);
    const room = {
        name: "W1N1", my: true, level: 8, spawnFailure: false,
        getEnergyCapacityAvailable: () => 12900, energyAvailable: 12900,
        creeps(role) {
            if (role === "harvestEnergyKeeper") return [spawning];
            if (role === "carrier") return [{ ticksToLive: 1000 }];
            return [];
        },
        find: () => [],
    };
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 0, "已有接班人在孵化 ⇒ 绝不再派（否则会滚雪球）");
}

{
    // ④ 派兵失败（spawn 忙/能量不够）→ **不能**打标记，下一 tick 还要能重试
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, keeper, spawnCalls } = setup(ctx, { keeperTtl: 10, spawnTimeAge: 1490, spawnOk: false });
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 1, "尝试派了");
    assert.notEqual(keeper.memory.successorSpawned, true, "失败不能打标记，否则永远补不上");
}

{
    // ⑤ 一只都没有 → 立刻补（不依赖 spawnTime 的年龄）
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, spawnCalls } = setup(ctx, { keeperTtl: null, spawnTimeAge: 10 });
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 1, "空矿点立刻补");
}

{
    // ⑥ **提前量公式**（用户 10-14 明确）：移动时间 + 孵化时间 + 余量。
    //    移动时间用爬自己的存活时长量（ticksToLive 孵化完成后才开始扣）。
    const ctx = loadStation();
    const S = ctx.StationSources;
    const stationName = S.stationName;
    ctx.Memory.rooms["W1N1"] = { [stationName]: { src1: { id: "src1" } } };
    S.getOuterRoadPath = () => undefined;          // 内矿没有外矿路线 ⇒ cap = 300

    const lived = 10;                              // 出生到抵达走了 10 tick
    const bodyLen = 20;                            // 孵化 = 20×3 = 60 tick
    const keeper = {
        id: "k1", name: "k1", spawning: false, ticksToLive: 1500 - lived,
        body: new Array(bodyLen).fill({ type: ctx.MOVE }),
        memory: {}, pos: { x: 10, y: 10, roomName: "W1N1" },
        headTask: () => ({ id: "src1", taskName: "harvestEnergyKeeper", roomName: "W1N1" }),
        popTask() { return this; }, execLastTask() { return this; },
    };
    ctx.Creep.prototype.concatStationSources.call(keeper);
    const data = ctx.Memory.rooms["W1N1"][stationName].src1;
    assert.equal(data.spawnTime, ctx.Game.time - (lived + bodyLen * 3 + 10),
        "spawnTime 必须记成「抵达时刻 −（移动 + 孵化 + 余量）」");
    assert.equal(data.pathTime, lived, "pathTime 记的是真实移动时间（不是那个会漂的差值）");

    // 跨代不能累漂：第二代到达时，spawnTime 必须按**它自己的到达时刻**重算，
    // 而不是在上一代的值上再减一段（原来 `-=` 就是这么越派越早，最后被钳成「现在」）。
    const cycle = 1500;
    ctx.Game.time += cycle;
    keeper.ticksToLive = 1500 - lived;             // 新爬同样走 10 tick 抵达
    ctx.Creep.prototype.concatStationSources.call(keeper);
    assert.equal(data.spawnTime, ctx.Game.time - (lived + bodyLen * 3 + 10),
        "第二代必须按自己的到达时刻重算（原 -= 累减会变成「再往前推 80」）");
}

{
    // ⑧ 外矿 + 主房穷 + **本矿点一只在岗 keeper 都没有** → 必须放行。
    //    这是防「闸门自锁」的豁免：keeper 是外矿唯一的能量输入，挡掉等于收入归零。
    const ctx = loadStation({ Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" },
        getObjectById: () => null, creeps: {}, map: { getRoomLinearDistance: () => 1 } } });
    const S = ctx.StationSources;
    S.stationName = "stationSources";
    ctx.Memory.rooms["W2N2"] = { stationSources: { out1: { id: "out1", spawnTime: ctx.Game.time - 3000, creeps: [] } } };
    const calls = [];
    ctx.StationHive.trySpawn = (...a) => { calls.push(a); return "newK"; };
    S.getHarvesterBodyConfig = () => [ctx.MOVE];
    S.generatorOuterHarTask = () => [];
    S.outerMineStarvesSpawnRoom = () => true;          // 主房很穷
    const room = {
        name: "W1N1", my: true, level: 8, spawnFailure: false,
        getEnergyCapacityAvailable: () => 12900, energyAvailable: 12900,
        creeps: () => [], find: () => [],
    };
    S.trySpawnOuterHarKeeper("W2N2", room);
    assert.equal(calls.length, 1, "主房穷、但矿点一只 keeper 都没有 ⇒ 必须派（否则闸门自锁）");
}

{
    // ⑨ 外矿 + 主房穷 + **已有在岗 keeper** → 缓一缓（闸门原本的保护仍然生效）
    const ctx = loadStation();
    const S = ctx.StationSources;
    ctx.Memory.rooms["W2N2"] = { stationSources: { out1: { id: "out1", spawnTime: ctx.Game.time - 3000, creeps: ["k1"] } } };
    const keeper = {
        id: "k1", name: "k1", spawning: false, ticksToLive: 60, body: [ctx.MOVE],
        memory: { role: "harvestEnergyKeeper" },
        headTask: () => ({ id: "out1", taskName: "harvestEnergyOuterKeeper" }),
    };
    const calls = [];
    ctx.StationHive.trySpawn = (...a) => { calls.push(a); return "newK"; };
    S.getHarvesterBodyConfig = () => [ctx.MOVE];
    S.generatorOuterHarTask = () => [];
    S.outerMineStarvesSpawnRoom = () => true;
    ctx.Game.getObjectById = id => (id === "k1" ? keeper : null);
    const room = {
        name: "W1N1", my: true, level: 8, spawnFailure: false,
        getEnergyCapacityAvailable: () => 12900, energyAvailable: 12900,
        creeps: () => [keeper], find: () => [],
    };
    S.trySpawnOuterHarKeeper("W2N2", room);
    assert.equal(calls.length, 0, "主房穷且矿点有人在岗 ⇒ 缓一缓");
}

{
    // ⑪ 主房里搬运爬**全在孵化**（没有长大的）⇒ 不能因此拦住 keeper 续派。
    //    原判据只数 ttl>300 的搬运爬 ⇒ 搬运换班那 ~150 tick 里 keeper 交接被一起挡掉
    //    （实测 W34N52：carrier=[孵,孵] / keeper ttl=71 / carrier>300=0 ⇒ 直接 return）。
    const mkRoom = (ctx, spawningCarriers) => ({
        name: "W1N1", my: true, level: 8, spawnFailure: false,
        getEnergyCapacityAvailable: () => 12900, energyAvailable: 12900,
        creeps(role, spawned = true) {
            // 房里另有一只**长大**的 keeper（另一个源）—— 那条守卫要的正是「有 har 在岗」
            if (role === "harvestEnergyKeeper") return [warmKeeper, matureKeeper];
            if (role === "carrier") return spawned ? [] : spawningCarriers;
            return [];
        },
        find: () => [],
    });
    const warmKeeper = { id: "k1", spawning: false, ticksToLive: 10, body: [0, 1, 2, 3, 4],
        memory: { role: "harvestEnergyKeeper" }, headTask: () => ({ id: "src1" }) };
    // 另一个源上长大的 keeper（ttl>300）⇒ 触发那条「有 har 在岗」的守卫
    const matureKeeper = { id: "k9", spawning: false, ticksToLive: 1000, body: [0, 1],
        memory: { role: "harvestEnergyKeeper" }, headTask: () => ({ id: "src2" }) };

    const ctx = loadStation();
    const S = ctx.StationSources;
    ctx.Memory.rooms["W1N1"] = { [S.stationName]: { src1: { id: "src1", spawnTime: ctx.Game.time - 1490, creeps: ["k1"] } } };
    const calls = [];
    ctx.StationHive.trySpawn = (...a) => { calls.push(a); return "newK"; };
    S.getHarvesterBodyConfig = () => [ctx.MOVE];
    S.generatorHarTask = () => [];
    ctx.Game.getObjectById = id => (id === "k1" ? warmKeeper : null);
    S.trySpawnOuterHarKeeper("W1N1", mkRoom(ctx, [{ spawning: true, memory: { role: "carrier" } }]));
    assert.equal(calls.length, 1, "搬运爬都在孵化时，keeper 续派不能也被挡");

    // ⑫ 连在孵的搬运都没有 ⇒ 仍然「优先生搬运」（原意图保留）
    const ctx2 = loadStation();
    const S2 = ctx2.StationSources;
    ctx2.Memory.rooms["W1N1"] = { [S2.stationName]: { src1: { id: "src1", spawnTime: ctx2.Game.time - 1490, creeps: ["k1"] } } };
    const calls2 = [];
    ctx2.StationHive.trySpawn = (...a) => { calls2.push(a); return "newK"; };
    S2.getHarvesterBodyConfig = () => [ctx2.MOVE];
    S2.generatorHarTask = () => [];
    ctx2.Game.getObjectById = id => (id === "k1" ? warmKeeper : null);
    S2.trySpawnOuterHarKeeper("W1N1", mkRoom(ctx2, []));
    assert.equal(calls2.length, 0, "一只搬运都没有（含孵化中）⇒ 仍然先搬运");
}

{
    // ⑩ 调用点仍在（只测 helper 抓不到「helper 在、但没人调」）
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!/if \(existingKeepers > 0\) return;/.test(codeOnly),
        "旧的守卫必须删掉（它把提前量作废了）");
    assert.ok(/if \(mine\.some\(e => e\.spawning\)\) return;/.test(codeOnly),
        "必须挡住「已有接班人在孵化」的情形，否则会滚雪球");
    assert.ok(/if \(mine\.some\(e => e\.memory && e\.memory\.successorSpawned\)\) return;/.test(codeOnly),
        "新守卫必须查 successorSpawned 标记");
    assert.ok(/if \(StationHive\.trySpawn\([\s\S]{0,200}?successorSpawned = true/.test(codeOnly),
        "标记只能在 trySpawn 返回真之后打");
    assert.ok(!/data\["spawnTime"\] -=/.test(codeOnly),
        "spawnTime 必须是赋值，不能是 -=（累减会让提前量越漂越早）");
    assert.ok(/data\["spawnTime"\] = Game\.time - \(travel \+ this\.body\.length \* 3 \+ KEEPER_SUCCESSION_MARGIN\)/
        .test(codeOnly), "提前量公式必须是 移动 + 孵化 + 余量");
}

console.log("keeper succession checks passed");
