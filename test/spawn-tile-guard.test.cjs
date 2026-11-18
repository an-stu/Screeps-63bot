// 0.78.272 回归：站在 spawn 格上的爬会阻塞孵化（spawnCreep ⇒ ERR_BUSY）。
// trySpawn 必须把占格的我方爬挪到相邻空格，并在本 tick 标记 spawnFailure。
// 现场：E51S29 采样 37 tick 里有 9 tick（24%）spawn 格被 keeper 占住。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "modules", "station_hive.js"), "utf8");

if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function makeWorld(opts = {}) {
    const world = {spawnCalls: [], moved: null};
    const blockers = opts.blockers || [];
    const spawnPos = {
        x: 11, y: 15,
        lookFor(type) {
            if (type === "creeps") return blockers.filter(b => b.isCreep);
            if (type === "powerCreeps") return blockers.filter(b => !b.isCreep);
            return [];
        },
        nearPos() {
            return [{
                x: 12, y: 15,
                walkable: () => true,
                lookFor: () => [],
            }];
        },
    };
    const spawn = {
        id: "spawn1", pos: spawnPos, spawning: null,
        isActive: () => true,
        spawnCreep(body, name, o) { world.spawnCalls.push({body, name, o}); return 0; },
    };
    const room = {
        name: "E51S29", my: true, level: 3, spawnFailure: false, spawnedMap: {},
        controller: {owner: {username: "an_w"}},
        spawn: [spawn],
        getEnergyAvailable: () => 1000,
        currentEnergyAvailable: 1000,
    };
    const sandbox = {
        console: {log() {}},
        Game: {time: 100000, _name_hash: 0},
        Memory: {},
        LOCAL_SHARD_NAME: "shard2",
        LOOK_CREEPS: "creeps",
        LOOK_POWER_CREEPS: "powerCreeps",
        BODYPART_COST: {work: 100, carry: 50, move: 50},
        OK: 0,
        MOVE: "move", WORK: "work", CARRY: "carry",
        Utils: {getBodyEnergyNeed: body => body.length * 50},
    };
    sandbox.global = sandbox;
    // 只加载 trySpawn 所需的最小上下文：整个文件依赖较多，按函数截取。
    const start = source.indexOf("trySpawn(room, targetRoomName, body, role, tasks, ops)");
    assert.ok(start >= 0, "trySpawn 定义必须存在");
    let open = source.indexOf("{", start);
    let depth = 0, end = -1;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) { end = i; break; }
    }
    assert.ok(end > open, "trySpawn 函数体必须闭合");
    vm.runInNewContext("var StationHive = { " + source.slice(start, end + 1) + " };", sandbox);
    return {world, room, sandbox};
}

// 1) 我方爬站在 spawn 格：挪到相邻空格、本 tick 放弃孵化、置 spawnFailure
{
    const blocker = {my: true, isCreep: true, move(pos) { this.moved = pos; }};
    const {world, room, sandbox} = makeWorld({blockers: [blocker]});
    const name = sandbox.StationHive.trySpawn(room, "E51S29", ["work", "carry", "move"], "harvestEnergyKeeper", []);
    assert.equal(name, undefined, "占格时本 tick 不得孵化");
    assert.equal(world.spawnCalls.length, 0, "不得调用 spawnCreep");
    assert.equal(room.spawnFailure, true, "必须置 spawnFailure，避免同 tick 反复尝试");
    assert.ok(blocker.moved && blocker.moved.x === 12 && blocker.moved.y === 15, "占格爬必须被挪到相邻空格");
}

// 2) 下一个 tick 格子空了：正常孵化
{
    const {world, room, sandbox} = makeWorld();
    const name = sandbox.StationHive.trySpawn(room, "E51S29", ["work", "carry", "move"], "harvestEnergyKeeper", []);
    assert.equal(typeof name, "string", "孵化成功必须返回 creep 名字");
    assert.equal(world.spawnCalls.length, 1, "无占格时必须尝试孵化");
}

// 3) 敌方爬占格：不挪、不孵化（不能替对手做位移）
{
    const enemy = {my: false, isCreep: true, move() { throw new Error("must not move enemy"); }};
    const {world, room, sandbox} = makeWorld({blockers: [enemy]});
    sandbox.StationHive.trySpawn(room, "E51S29", ["work", "carry", "move"], "harvestEnergyKeeper", []);
    assert.equal(world.spawnCalls.length, 1, "敌方占格不应阻止孵化尝试（引擎自行裁决）");
}

// 4) power creep 占格同样要挪（它也能堵 spawn）
{
    const pc = {my: true, isCreep: false, move(pos) { this.moved = pos; }};
    const {world, room, sandbox} = makeWorld({blockers: [pc]});
    sandbox.StationHive.trySpawn(room, "E51S29", ["work", "carry", "move"], "harvestEnergyKeeper", []);
    assert.ok(pc.moved, "power creep 也要挪开");
    assert.equal(world.spawnCalls.length, 0);
}

console.log("spawn tile occupancy is cleared before spawning");
