const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_carry.js"), "utf8");

/**
 * 载入真实模块，只测 `tryProcessPower(room)` 的滞回决策。
 * 用户 2026-10-20：power 攒够一批再烧、烧到低水位就停，试点房 W32N56。
 */
function load(settings, room) {
    const ctx = {
        console,
        Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" } },
        Memory: { marketSettings: settings || {}, rooms: {} },
        Creep: function () {},
        Room: function () {},
        Resource: function () {},
        Structure: function () {},
        UtilsTask: {}, StationHive: {}, StationSources: {}, StationMineral: {},
        StationLab: {}, ManagerFlags: {}, ManagerRooms: {},
        RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power", RESOURCE_UTRIUM: "U",
        OK: 0, ERR_NOT_ENOUGH_RESOURCES: -6, ERR_FULL: -8, ERR_NOT_IN_RANGE: -9,
        STRUCTURE_LINK: "link", STRUCTURE_CONTAINER: "container",
        FIND_MY_STRUCTURES: 111, FIND_STRUCTURES: 101, FIND_DROPPED_RESOURCES: 106,
        FIND_TOMBSTONES: 110, FIND_MY_CREEPS: 102, FIND_HOSTILE_CREEPS: 103,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_carry.js" });
    ctx.__burn = 0;
    room.powerSpawn.processPower = () => { ctx.__burn++; return ctx.OK; };
    // 本房能量总量：用房间字段直接给出，不依赖模块内部的 mass store 统计
    ctx.StationCarry.roomMassStoreCnt = (r, res) => (res == "energy" ? room.__energy : 0);
    return ctx;
}

function makeRoom(power, energy) {
    return {
        name: "W32N56",
        __energy: energy,
        powerSpawn: { store: { power: power, energy: 200 } },
    };
}

// ① 非试点房：一次都不烧
{
    const room = makeRoom(10000, 500000);
    room.name = "E53S21";
    const ctx = load({}, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "非试点房不烧");
}

// ② 还没攒够（低于 high）：不烧，也不置 burning
{
    const room = makeRoom(499, 500000);
    const ms = {};
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "power 未到 high 不开烧");
    assert.ok(!ms.powerBurning, "未开闸");
}

// ③ 攒够了但能量不够：不烧
{
    const room = makeRoom(800, 50000);          // floor 默认 60000
    const ms = {};
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "能量低于下限不烧");
}

// ④ 攒够 + 能量够 → 开烧，并记住 burning
{
    const room = makeRoom(800, 120000);
    const ms = {};
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 1, "达到高水位且能量充足 ⇒ 烧");
    assert.equal(ms.powerBurning, true, "开闸状态要记下来");
}

// ⑤ 烧到低水位（<=100）就停
{
    const room = makeRoom(100, 120000);
    const ms = { powerBurning: true };
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "到低水位停止");
    assert.equal(ms.powerBurning, false, "关闸");
}

// ⑥ 能量掉到下限一半以下：停止，别把试点房抽干
{
    const room = makeRoom(5000, 29000);         // floor*0.5 = 30000
    const ms = { powerBurning: true };
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "能量跌破下限一半 ⇒ 停");
    assert.equal(ms.powerBurning, false);
}

// ⑦ 滞回：关闸后即使 power 还在 low 之上也不会自己续烧（必须重新攒到 high）
{
    const room = makeRoom(400, 120000);
    const ms = {};
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "400 < high(500) ⇒ 不开烧（关闸后不会一停一烧地抖）");
}

// ⑧ 旋钮可以改（Memory 里指定别的房与门槛）
{
    const room = makeRoom(300, 100000);
    room.name = "E53S21";
    const ms = { powerSpawnRoom: "E53S21", powerSpawnHigh: 200, powerSpawnLow: 50, powerSpawnEnergy: 90000 };
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 1, "旋钮换房/换门槛应立即生效");
}

// ⑨ 填充闸门必须认出「正在烧」：源码里 fillGate 用了 burning 分支
{
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/let burning = !!\(Memory\.marketSettings && Memory\.marketSettings\.powerBurning\)/.test(codeOnly),
        "填充闸门必须读 powerBurning");
    assert.ok(/energyCnt > 30000 && powerCnt > 50/.test(codeOnly),
        "开烧时填充门槛要放宽到 3 万能量/50 power，否则烧两下断粮");
    assert.ok(/pro\.tryProcessPower\(room\)/.test(codeOnly), "决策必须被调用");
}

console.log("power spawn burn checks passed");
