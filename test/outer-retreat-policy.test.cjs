// 0.78.288 回归：外矿「1 个 Invader 可打、≥2 全员撤」政策。
// - outerRetreatCheck 在有视野时维护 Memory.rooms[room].outerRetreat
// - Invader≥2 进入撤退；降到 <2 持续 100 tick 后解除；失去视野 5000 tick 硬过期
// - 派发循环、keeper/carrier/defenser 都会读取该状态
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "station_sources.js"), "utf8");
const outer = fs.readFileSync(path.join(root, "modules", "strategy_outerHarvest.js"), "utf8");

function extractMethod(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, "missing " + header);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unterminated " + header);
}

const METHODS = ["outerInvaderCount(room)", "outerRetreatState(roomName)", "outerRetreatCheck(roomOrName)"]
    .map(h => extractMethod(src, h));

const CLEAR = Number(/const OUTER_RETREAT_CLEAR_TICKS = (\d+)/.exec(src)[1]);
const STALE = Number(/const OUTER_RETREAT_STALE_TICKS = (\d+)/.exec(src)[1]);

function makeWorld() {
    const sandbox = {
        Memory: {rooms: {}},
        Game: {time: 1000, rooms: {}},
        FIND_HOSTILE_CREEPS: "hostiles",
        OUTER_RETREAT_CLEAR_TICKS: CLEAR,
        OUTER_RETREAT_STALE_TICKS: STALE,
        console: {log() {}},
    };
    sandbox.global = sandbox;
    vm.runInNewContext("var pro = {" + METHODS.join(",\n") + "};", sandbox);
    return sandbox;
}

function roomWith(sb, name, invaders) {
    const hostiles = [];
    for (let i = 0; i < invaders; i++) hostiles.push({owner: {username: "Invader"}});
    const room = {name, find: () => hostiles, getHostileCreeps: () => hostiles};
    sb.Game.rooms[name] = room;
    return room;
}

// 1) 1 个 Invader ⇒ 不撤退（可以派防守打）
{
    const sb = makeWorld();
    const room = roomWith(sb, "E42S29", 1);
    assert.equal(sb.pro.outerRetreatCheck(room), null, "单个 invader 不触发撤退");
    assert.equal(sb.Memory.rooms["E42S29"].outerRetreat, undefined);
}

// 2) ≥2 个 Invader ⇒ 进入撤退，Memory 记录
{
    const sb = makeWorld();
    const room = roomWith(sb, "E42S29", 2);
    const retreat = sb.pro.outerRetreatCheck(room);
    assert.ok(retreat, "两个 invader 必须撤退");
    assert.equal(retreat.count, 2);
    assert.ok(sb.Memory.rooms["E42S29"].outerRetreat, "撤退状态写进 Memory（无视野仍然有效）");
}

// 3) 敌人降到 1：撤退状态在 100 tick 内保持，之后解除（1 个可以打）
{
    const sb = makeWorld();
    let room = roomWith(sb, "E42S29", 2);
    sb.pro.outerRetreatCheck(room);
    sb.Game.time += 50;
    room = roomWith(sb, "E42S29", 1);
    assert.ok(sb.pro.outerRetreatCheck(room), "降到 1 后的 100 tick 内仍保持撤退（防止马上回去被反打）");
    sb.Game.time += CLEAR - 49;
    assert.equal(sb.pro.outerRetreatCheck(room), null, "持续 <2 达到 100 tick 后解除撤退");
    assert.equal(sb.Memory.rooms["E42S29"].outerRetreat, undefined);
}

// 4) 失去视野：Memory 状态仍生效，超过 5000 tick 才硬过期
{
    const sb = makeWorld();
    sb.Memory.rooms["E42S29"] = {outerRetreat: {tick: 1000, count: 3}};
    assert.ok(sb.pro.outerRetreatState("E42S29"), "无视野时撤退状态必须继续生效");
    sb.Game.time = 1000 + STALE - 1;
    assert.ok(sb.pro.outerRetreatState("E42S29"));
    sb.Game.time = 1000 + STALE + 1;
    assert.equal(sb.pro.outerRetreatState("E42S29"), null, "超过硬过期时间后允许恢复派发");
    assert.equal(sb.Memory.rooms["E42S29"].outerRetreat, undefined);
}

// 5) 源码钉子：派发循环、三种外矿爬、防守出兵闸都必须接上撤退政策
assert.ok(/StationSources\.outerRetreatCheck\(targetRoomName\)\) continue;/.test(outer),
    "外矿派发循环必须在撤退时暂停");
assert.ok(/defenseCost > defenseCapacity/.test(src),
    "防守体型必须按出兵房容量收缩，避免低 RCL 房永远生不出防守锁死采运");
for (const fn of ["Creep.prototype.harvestEnergyOuterKeeper = function () {",
    "Creep.prototype.harvestEnergyOuterCarry = function () {"]) {
    const idx = src.indexOf(fn);
    assert.ok(idx >= 0, fn + " 必须存在");
    assert.ok(src.slice(idx, idx + 400).includes("outerRetreatCheck"),
        fn + " 必须读取撤退状态");
}
assert.ok(!/Creep\.prototype\.outerDefense = function \(\) \{[\s\S]{0,300}outerRetreatCheck/.test(src),
    "防守爬不得撤退：它必须去接战 invader");
assert.ok(/e\.owner && e\.owner\.username == "Invader"\) \/\/ invader 全房可打/.test(src),
    "invader 在全房任何位置都必须成为防守目标（不能只守窝区）");
assert.ok(/if \(invaders\.length === 1\)/.test(src),
    "单个 invader 的防守编制必须收敛到 1");
assert.ok(/outerInvaderSeen/.test(src),
    "无视野时用最近一次看到的 invader 数决定编制");
assert.ok(!/outerInvaderCount\(harRoom\) >= 2\) return null;/.test(src),
    "≥2 invader 时必须允许派强化小队（不得再禁派）");
assert.ok(src.includes("[RANGED_ATTACK]: 22"), "强化小队远程体型必须保留");

console.log("outer retreat policy: 1 invader fightable, 2+ retreat");