const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

/**
 * 外矿保留者（reserver）的优先级与闸门：
 *   · 未保留 / 快到期的控制器必须派 reserver —— 未保留时源容量 1500（产能减半），
 *     这是外矿产量的总开关（Overmind 式「先保留、后开采」）。
 *   · 原实现埋在旗循环深处，单 spawn 房 100% 忙时永远抢不到坑
 *     （W26N59 `noFreeSpawn` 连续数日、控制器裸奔）→ 现在由 strategy_highLevel
 *     在 home keeper 之后、worker/carrier 之前调用 trySpawnReservers。
 *   · 能量健康闸沿用 0.78.155 原则：本房 keeper 没满员就不派。
 */

// ── ① strategy_highLevel 的调用顺序：keeper 之后、workerManager 之前 ──────
const highSrc = fs.readFileSync(path.join(root, "modules/strategy_highLevel.js"), "utf8");
{
    const iKeeper = highSrc.indexOf("StationSources.trySpawnHarKeeper(room);");
    const iResv = highSrc.indexOf("StationSources.trySpawnReservers(room)");
    const iWorker = highSrc.indexOf("pro.workerManager(room);");
    assert.ok(iKeeper >= 0 && iResv > iKeeper && iWorker > iResv,
        "trySpawnReservers 必须排在 home keeper 之后、worker/carrier 之前（先保留后开采，又不能抢主房 keeper）");
    assert.ok(/isCpuFeatureEnabled\("outerHarvest"\)/.test(
        highSrc.slice(iResv - 200, iResv + 100)), "reserver 早槽必须挂在 outerHarvest 功能开关下");
}

// ── ② 行为测试：提取真实函数，在桩环境里驱动 ────────────────────────────
function extract(name, args) {
    const m = src.match(new RegExp("    " + name + "\\(" + args + "\\) \\{[\\s\\S]*?\\n    \\},"));
    assert.ok(m, name + " 必须存在");
    return m[0];
}
const ctx = {
    console,
    WHO_AM_I: "an_w",
    Game: { time: 1000, rooms: {} },
    Memory: { rooms: {} },
    UtilsTask: {
        task: (obj, name) => ({ taskName: name, id: obj.id, roomName: obj.pos.roomName }),
    },
    ManagerFlags: {
        getFlagsByPrefix: prefix => ctx.__flags || [],
    },
    StrategyOuterHarvest: {
        hasStopRemoteFlag: () => false,
        invaderCoreBlocks: () => false,
    },
    StationHive: {
        trySpawn: (room, target, body, role, tasks) => {
            ctx.__spawned = { body: body, role: role, tasks: tasks };
            return "newCreep";
        },
    },
    BODYPART_COST: { claim: 600, move: 50, work: 100, carry: 50 },
    CLAIM: "claim", MOVE: "move",
    ManagerCreeps: {
        calcBodyPart: spec => {
            const out = [];
            for (const k in spec) for (let i = 0; i < spec[k]; i++) out.push(k);
            return out;
        },
    },
};
ctx.global = ctx;
vm.runInNewContext('var pro = { stationName: "stationSources",\n' + extract("getReverserBodyConfig", "energy") + "\n" + extract("trySpawnReservers", "spawnRoom") + "\n};\n", ctx,
    { filename: "station_sources-extract.js" });

function makeSpawnRoom(opts) {
    return {
        name: "W26N58",
        source: [{ id: "s1" }, { id: "s2" }],
        spawn: opts.spawnFree === false ? [] : [{ spawning: false, isActive: () => true }],
        getEnergyCapacityAvailable: () => 2300,
        creeps(role, spawned) {
            // 真实 Room.creeps 返回**数组**；长度即数量
            if (role == "harvestEnergyKeeper") return Array(opts.keepers === undefined ? 2 : opts.keepers);
            if (role == "reserver") return opts.reservers || [];
            return [];
        },
    };
}
function makeFlag(target, mineMem) {
    ctx.Memory.rooms[target] = mineMem;
    return { name: "har_W26N58_" + target, memory: { spawnRoom: "W26N58" }, pos: { roomName: target } };
}
function drive(spawnRoom, flags) {
    ctx.__spawned = null;
    ctx.__flags = flags;
    ctx.pro.trySpawnReservers(spawnRoom);
    return ctx.__spawned;
}
function makeHarRoom(target, reservation) {
    const room = {
        name: target,
        controller: { id: "ctrl_" + target, my: false, pos: { roomName: target }, reservation: reservation },
    };
    ctx.Game.rooms[target] = room;
    return room;
}

{
    // 正常路径：keeper 满员 + 控制器未保留 + 无在役 reserver ⇒ 必须派
    const spawnRoom = makeSpawnRoom({});
    makeHarRoom("W26N59", null);
    const spawned = drive(spawnRoom, [makeFlag("W26N59", { stationSources: { a: {} } })]);
    assert.ok(spawned, "未保留的控制器必须派 reserver");
    assert.equal(spawned.role, "reserver");
    assert.equal(spawned.body.filter(p => p == "claim").length, 3, "RCL5/6 容量 2300 ⇒ 3 CLAIM（1950）");
    assert.equal(spawned.tasks[0].taskName, "reserveOuterHar");
}
{
    // 0.78.155 原则：本房 keeper 没满员 ⇒ 不派（主房健康优先）
    const spawnRoom = makeSpawnRoom({ keepers: 1 });
    makeHarRoom("W26N59", null);
    assert.equal(drive(spawnRoom, [makeFlag("W26N59", { stationSources: { a: {} } })]), null,
        "本房 keeper 没满员时不得派 reserver");
}
{
    // 已有在役 reserver ⇒ 去重不重派
    const spawnRoom = makeSpawnRoom({
        reservers: [{ headTask: () => ({ roomName: "W26N59" }) }],
    });
    makeHarRoom("W26N59", null);
    assert.equal(drive(spawnRoom, [makeFlag("W26N59", { stationSources: { a: {} } })]), null,
        "已有在役 reserver 时不得重派");
}
{
    // 自己的保留余量充足 ⇒ 不派
    const spawnRoom = makeSpawnRoom({});
    makeHarRoom("W26N59", { username: "an_w", ticksToEnd: 4500 });
    assert.equal(drive(spawnRoom, [makeFlag("W26N59", { stationSources: { a: {} } })]), null,
        "保留余量 >= 1000 时不得重派");
}
{
    // 余量 < 1000 ⇒ 必须续派
    const spawnRoom = makeSpawnRoom({});
    makeHarRoom("W26N59", { username: "an_w", ticksToEnd: 900 });
    assert.ok(drive(spawnRoom, [makeFlag("W26N59", { stationSources: { a: {} } })]),
        "保留余量 < 1000 时必须续派");
}
{
    // spawn 忙 ⇒ 不尝试（trySpawn 会失败，留给下一个 pass）
    const spawnRoom = makeSpawnRoom({ spawnFree: false });
    makeHarRoom("W26N59", null);
    assert.equal(drive(spawnRoom, [makeFlag("W26N59", { stationSources: { a: {} } })]), null,
        "spawn 忙时不做无效尝试");
}
console.log("reserver priority: OK");
