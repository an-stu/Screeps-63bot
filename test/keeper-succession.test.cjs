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
    // ② **核心**：到点了、老那只还剩 ~60 tick（原来这里被 existingKeepers>0 挡死）→ 必须派
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, keeper, spawnCalls } = setup(ctx, { keeperTtl: 60, spawnTimeAge: 1600 });
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 1, "到点就要提前派（提前量必须生效）");
    assert.equal(spawnCalls[0][3], "harvestEnergyKeeper", "派的是 keeper");
    assert.equal(keeper.memory.successorSpawned, true, "派成功后要在在岗那只身上打标记");
}

{
    // ③ 已经打了标记（接班人在路上/已在岗）→ 不重复派
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, spawnCalls } = setup(ctx, { keeperTtl: 60, spawnTimeAge: 1600, keeperMemory: { successorSpawned: true } });
    S.trySpawnOuterHarKeeper("W1N1", room);
    assert.equal(spawnCalls.length, 0, "带标记就不再重复生");
}

{
    // ④ 派兵失败（spawn 忙/能量不够）→ **不能**打标记，下一 tick 还要能重试
    const ctx = loadStation();
    const S = ctx.StationSources;
    const { room, keeper, spawnCalls } = setup(ctx, { keeperTtl: 60, spawnTimeAge: 1600, spawnOk: false });
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
    // ⑥ 源码层面兜一层：旧的「有人就 return」写法必须已经不存在
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!/if \(existingKeepers > 0\) return;/.test(codeOnly),
        "旧的守卫必须删掉（它把提前量作废了）");
    assert.ok(/if \(mine\.some\(e => e\.memory && e\.memory\.successorSpawned\)\) return;/.test(codeOnly),
        "新守卫必须查 successorSpawned 标记");
    assert.ok(/if \(StationHive\.trySpawn\([\s\S]{0,200}?successorSpawned = true/.test(codeOnly),
        "标记只能在 trySpawn 返回真之后打");
}

console.log("keeper succession checks passed");
