// 0.78.262 回归：moveCrossShardByPath 的 index 必须单调推进并在末段弹出。
// 旧实现的负对照：每 tick 从 i=0 重扫房间名，会把到达对面的 index 拉回 len-1，
// claimer 永远站在虫洞格上（线上实测卡死）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "modules", "manager_crossShard.js"), "utf8");

// lodash 在线上把 .head() 挂到了 Array 原型；测试里补一份（两边的 realm 都要）
Array.prototype.head = Array.prototype.head || function () { return this[0]; };

function extractFn(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, "missing " + header);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error("unterminated function: " + header);
}

function load(header, sandbox) {
    const fn = extractFn(src, header);
    vm.runInNewContext(fn, sandbox);
}

class RoomPosition {
    constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    isNearTo(other) {
        return Math.max(Math.abs(this.x - other.pos.x), Math.abs(this.y - other.pos.y)) <= 1;
    }
}

function makeWorld(opts) {
    const portalPos = opts.portal || null; // {x,y,roomName,destinationShard}
    const sandbox = {
        Creep: function () {},
        RoomPosition,
        Game: {shard: {name: opts.shard}},
        FIND_HOSTILE_CREEPS: "hostile",
        LOOK_STRUCTURES: "structures",
        STRUCTURE_PORTAL: "portal",
        console: {log() {}},
    };
    load("Creep.prototype.moveCrossShardByPath", sandbox);
    load("Creep.prototype.notifyClaimDone", sandbox);
    vm.runInNewContext("Array.prototype.head = function () { return this[0]; };", sandbox);
    sandbox.ManagerCrossShard = {addCrossShardRequest(toShard, mission) { sandbox.requests = sandbox.requests || []; sandbox.requests.push({toShard, mission}); }};
    return {Creep: sandbox.Creep, sandbox};
}

function makeCreep(Creep, shard, x, y, roomName, tasks, portal) {
    const creep = new Creep();
    creep.name = "shard3_84300000_1";
    creep.pos = {
        x, y, roomName,
        findClosestByRange() { return null; },
        isNearTo() { return false; },
    };
    const pos = new RoomPosition(x, y, roomName);
    pos.isNearTo = function (other) {
        return Math.max(Math.abs(this.x - other.pos.x), Math.abs(this.y - other.pos.y)) <= 1;
    };
    // handler 里构造的 RoomPosition 会用真实 isNearTo；lookFor 由坐标决定
    RoomPosition.prototype.lookFor = function (type) {
        if (type !== "structures" || !portal) return [];
        if (this.x === portal.x && this.y === portal.y && this.roomName === portal.roomName) {
            return [{ structureType: "portal", destination: {shard: portal.destinationShard}}];
        }
        return [];
    };
    creep.memory = {tasks};
    creep.autoHeal = function () {};
    creep.rangedAttack = function () {};
    creep.attack = function () {};
    creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
    creep.popTask = function () { this.popped = (this.popped || 0) + 1; this.memory.tasks.pop(); return this; };
    creep.execLastTask = function () { this.exec = (this.exec || 0) + 1; return this; };
    creep.goTo = function (p) { this.goto = (this.goto || []); this.goto.push(p); };
    creep.submitCrossShardCreepMemory = function (toShard) {
        this.submitted = this.submitted || [];
        this.submitted.push(toShard);
    };
    return creep;
}

// 1) 线上实际数据：两段路径，index=1，已在 shard2 的终点（回程虫洞）上。
//    旧代码这里 index 会被拉回 1，永远弹不掉；新代码下一 tick 必须 pop 并执行 claim。
{
    const portal = {x: 42, y: 27, roomName: "E50S30", destinationShard: "shard3"};
    const world = makeWorld({shard: "shard2", portal});
    const claim = {taskName: "claimRoom", id: "claimCrossShard_shard3_E49S31_1", roomName: "E51S29", x: 25, y: 25};
    const move = {taskName: "moveCrossShardByPath", path: [
        {shard: "shard3", roomName: "E50S30", x: 15, y: 5},
        {shard: "shard2", roomName: "E50S30", x: 42, y: 27},
    ], index: 1};
    const creep = makeCreep(world.Creep, "shard2", 42, 27, "E50S30", [claim, move], portal);
    creep.moveCrossShardByPath();
    assert.equal(move.index, 2, "到达末段虫洞后 index 必须推进到 path.length（不得被回扫拉回）");
    assert.ok(!creep.submitted, "站在回程虫洞上不得把 memory 反向递回出发 shard");
    assert.ok(!creep.popped, "弹出发生在下一 tick 的开头");
    creep.moveCrossShardByPath();
    assert.equal(creep.popped, 1, "越过末段后必须弹出移动任务");
    assert.equal(creep.exec, 1, "弹出后必须立刻执行 claim 任务");
    assert.equal(creep.memory.tasks.length, 1, "claim 任务应保留");
}

// 2) 单段路径（新默认）：在 shard3 踩虫洞 → 推进并递 memory 到 shard2。
{
    const portal = {x: 15, y: 5, roomName: "E50S30", destinationShard: "shard2"};
    const world = makeWorld({shard: "shard3", portal});
    const move = {taskName: "moveCrossShardByPath", path: [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}], index: 0};
    const creep = makeCreep(world.Creep, "shard3", 15, 6, "E50S30", [move], portal);
    creep.moveCrossShardByPath();
    assert.equal(move.index, 1, "踩到虫洞后 index 前进");
    assert.deepEqual(creep.submitted, ["shard2"], "最后一段的虫洞必须把 memory 递到目标 shard");
}

// 3) 多段路径的中间跳：到达 shard2 的下一段虫洞 → index 前进并把 memory 递到 shard1。
{
    const portal = {x: 41, y: 20, roomName: "W40S10", destinationShard: "shard1"};
    const world = makeWorld({shard: "shard2", portal});
    const move = {taskName: "moveCrossShardByPath", path: [
        {shard: "shard3", roomName: "W40S10", x: 20, y: 20},
        {shard: "shard2", roomName: "W40S10", x: 41, y: 20},
        {shard: "shard1", roomName: "W40S10", x: 37, y: 34},
    ], index: 1};
    const creep = makeCreep(world.Creep, "shard2", 40, 21, "W40S10", [move], portal);
    creep.moveCrossShardByPath();
    assert.equal(move.index, 2);
    assert.deepEqual(creep.submitted, ["shard1"]);
}

// 4) 末段没有虫洞（落地格不含传送门结构）→ 视为到达，直接弹出。
{
    const world = makeWorld({shard: "shard2", portal: null});
    const claim = {taskName: "claimRoom", id: "x", roomName: "E51S29", x: 25, y: 25};
    const move = {taskName: "moveCrossShardByPath", path: [
        {shard: "shard3", roomName: "E50S30", x: 15, y: 5},
        {shard: "shard2", roomName: "E50S30", x: 42, y: 27},
    ], index: 1};
    const creep = makeCreep(world.Creep, "shard2", 42, 27, "E50S30", [claim, move], null);
    creep.moveCrossShardByPath();
    assert.equal(creep.popped, 1, "末段无虫洞时立即弹出");
    assert.equal(creep.exec, 1);
}

// 5) 旧实现负对照（源码级）：不得再出现「从 i=0 重扫」的回退循环。
{
    const fn = extractFn(src, "Creep.prototype.moveCrossShardByPath");
    assert.ok(!/for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*path\.length/.test(fn),
        "moveCrossShardByPath 不得从 0 重扫 path（会把 index 拉回，claimer 卡死）");
    assert.ok(fn.includes("task.index >= path.length"), "必须按 >= 判定越过末段");
}

// 6) claim 成功通知源 shard 摘旗。
{
    const world = makeWorld({shard: "shard2", portal: null});
    const creep = makeCreep(world.Creep, "shard2", 25, 25, "E51S29", [], null);
    creep.notifyClaimDone("claimCrossShard_shard3_E49S31_1");
    const req = (world.sandbox.requests || [])[0];
    assert.ok(req, "必须发出跨 shard 请求");
    assert.equal(req.toShard, "shard3");
    assert.equal(req.mission.func, "removeFlag");
    assert.equal(req.mission.data.name, "claimCrossShard_shard3_E49S31_1");
    const same = makeCreep(world.Creep, "shard2", 25, 25, "E51S29", [], null);
    same.name = "shard2_84300000_2";
    same.notifyClaimDone("claimCrossShard_shard3_E49S31_1");
    assert.equal((world.sandbox.requests || []).length, 1, "同 shard claim 不重复发跨 shard 请求");
}

// 7) mission 侧必须有幂等的 removeFlag 处理器。
{
    const missionSrc = fs.readFileSync(path.join(__dirname, "..", "modules", "manager_missions.js"), "utf8");
    const sandbox = {
        Game: {flags: {}},
        Memory: {},
        log() {},
        console: {log() {}},
    };
    sandbox.global = sandbox;
    vm.runInNewContext(missionSrc, sandbox);
    let removed = 0;
    sandbox.Game.flags.x = {remove() { removed++; }};
    assert.equal(sandbox.missionFunc.removeFlag({name: "x"}), true);
    assert.equal(removed, 1);
    assert.equal(sandbox.missionFunc.removeFlag({name: "missing"}), true, "旗子已不存在也必须算完成");
}

console.log("cross-shard path checks passed");
