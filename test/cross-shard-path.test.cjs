// Regression coverage for monotonic cross-shard path progress and confirmed
// portal transitions. Room names are not unique across shards.
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
        Game: {shard: {name: opts.shard}, rooms: opts.portal ? {[opts.portal.roomName]: {}} : {}},
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
        if (type !== "structures" || !portal || portal.exists === false) return [];
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

// 1) Legacy two-way path ending at the reverse portal must finish here,
//    without sending memory back to the origin shard.
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
    assert.equal(creep.popped, 1, "落在回程虫洞上时应结束路径任务");
    assert.ok(!creep.submitted, "站在回程虫洞上不得把 memory 反向递回出发 shard");
    assert.equal(creep.exec, 1, "弹出后必须立刻执行 claim 任务");
    assert.equal(creep.memory.tasks.length, 1, "claim 任务应保留");
}

// A peaceful haul must not cross a retargeted portal or issue combat intents.
{
    const portal = {x:14,y:8,roomName:"E40S30",destinationShard:"shard1"};
    const world = makeWorld({shard:"shard3",portal});
    const move = {taskName:"moveCrossShardByPath",peaceful:true,expectedDestShard:"shard2",
        path:[{shard:"shard3",roomName:"E40S30",x:14,y:8}]};
    const c = makeCreep(world.Creep,"shard3",14,9,"E40S30",[move],portal);
    c.attack = c.rangedAttack = c.autoHeal = () => assert.fail("peaceful haul must not issue combat intents");
    c.moveCrossShardByPath();
    assert.equal(c.submitted,undefined);
    assert.equal(c.goto,undefined);
    portal.destinationShard = "shard2";
    c.moveCrossShardByPath();
    assert.deepEqual(c.submitted,["shard2"]);
    world.sandbox.Game.shard.name = "shard2";
    c.moveCrossShardByPath();
    assert.equal(c.popped,1);
}

// 2) Failed first crossing: retain the transition and keep approaching the
//    source portal without repeatedly enqueueing the creep memory.
{
    const portal = {x: 15, y: 5, roomName: "E50S30", destinationShard: "shard2"};
    const world = makeWorld({shard: "shard3", portal});
    const move = {taskName: "moveCrossShardByPath", path: [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}], index: 0};
    const creep = makeCreep(world.Creep, "shard3", 15, 6, "E50S30", [move], portal);
    creep.moveCrossShardByPath();
    assert.equal(move.index, 1, "踩到虫洞后 index 前进");
    assert.equal(move.pendingTransition.toShard, "shard2", "递交前记录预期 destination");
    assert.equal(move.pendingTransition.departure.x, 15, "递交前记录出发虫洞");
    assert.deepEqual(creep.submitted, ["shard2"], "最后一段的虫洞必须把 memory 递到目标 shard");
    assert.equal(creep.popped, undefined, "尚未观察到换 shard 时不能完成路径");

    delete world.sandbox.Game.rooms.E50S30; // departure room is temporarily not visible
    creep.moveCrossShardByPath();
    assert.equal(move.pendingTransition.toShard, "shard2", "保留不可见房间中的 pending hop");
    assert.equal(creep.submitted.length, 1, "不可见期间不重复提交 Memory");
    assert.equal(creep.goto.length, 2, "不可见时仍朝缓存的出发点移动");

    world.sandbox.Game.rooms.E50S30 = {};
    creep.moveCrossShardByPath(); // movement was blocked; Game.shard is still shard3
    assert.equal(move.index, 1, "source shard 上保留已排队的 hop");
    assert.equal(creep.submitted.length, 1, "等待期间不重复提交 Memory");
    assert.equal(creep.goto.length, 3, "等待期间继续朝原出发虫洞移动");
    assert.equal(creep.popped, undefined);
}

// 3) The final hop completes only after the expected shard is observed.
{
    const portal = {x: 15, y: 5, roomName: "E50S30", destinationShard: "shard2"};
    const world = makeWorld({shard: "shard3", portal});
    const move = {taskName: "moveCrossShardByPath", path: [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}], index: 0};
    const creep = makeCreep(world.Creep, "shard3", 15, 6, "E50S30", [move], portal);
    creep.moveCrossShardByPath();
    world.sandbox.Game.shard.name = "shard2";
    creep.moveCrossShardByPath();
    assert.equal(creep.popped, 1, "观察到预期 destination 后弹出最后一跳");
    assert.equal(creep.exec, 1);
}

// 4) Legacy source task with index==length retries its source portal.
{
    const portal = {x: 15, y: 5, roomName: "E50S30", destinationShard: "shard2"};
    const world = makeWorld({shard: "shard3", portal});
    const move = {taskName: "moveCrossShardByPath", path: [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}], index: 1};
    const creep = makeCreep(world.Creep, "shard3", 15, 6, "E50S30", [move], portal);
    creep.moveCrossShardByPath();
    assert.equal(creep.popped, undefined, "legacy source task must not be discarded");
    assert.equal(move.index, 1, "retry establishes pending hop without a negative index");
    assert.equal(move.pendingTransition.toShard, "shard2");
    assert.deepEqual(creep.submitted, ["shard2"]);
}

// 5) Legacy single-segment task observed on another shard is complete.
{
    const world = makeWorld({shard: "shard2", portal: null});
    const move = {taskName: "moveCrossShardByPath", path: [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}], index: 1};
    const creep = makeCreep(world.Creep, "shard2", 15, 6, "E50S30", [move], null);
    creep.moveCrossShardByPath();
    assert.equal(creep.popped, 1, "legacy destination-shard task should finish");
}

// 6) Multi-point path: reach the shard2 portal and schedule the shard1 hop.
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
    assert.equal(move.pendingTransition.fromShard, "shard2");
}

// 7) A portal disappearing after submission cancels the stale pending hop,
//    but does not discard the path or submit memory again.
{
    const portal = {x: 15, y: 5, roomName: "E50S30", destinationShard: "shard2"};
    const world = makeWorld({shard: "shard3", portal});
    const move = {taskName: "moveCrossShardByPath", path: [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}], index: 0};
    const creep = makeCreep(world.Creep, "shard3", 15, 6, "E50S30", [move], portal);
    creep.moveCrossShardByPath();
    portal.exists = false;
    creep.moveCrossShardByPath();
    assert.equal(creep.popped, undefined, "portal disappearance must not finish the hop");
    assert.equal(move.pendingTransition, undefined, "discard stale portal expectation");
    assert.equal(move.index, 0, "retry source waypoint without negative index");
    assert.equal(creep.submitted.length, 1, "do not resubmit while the portal is absent");
    assert.equal(creep.goto.length, 2, "continue approaching the source waypoint");
}

// 8) A markerless old multi-entry path may end at a landing-side point without
//    a portal; a source-only missing portal must not be treated as completion.
{
    const oldWorld = makeWorld({shard: "shard2", portal: null});
    const oldMove = {taskName: "moveCrossShardByPath", path: [
        {shard: "shard3", roomName: "E50S30", x: 15, y: 5},
        {shard: "shard2", roomName: "E50S30", x: 42, y: 27},
    ], index: 1};
    const oldCreep = makeCreep(oldWorld.Creep, "shard2", 42, 27, "E50S30", [oldMove], null);
    oldCreep.moveCrossShardByPath();
    assert.equal(oldCreep.popped, 1, "legacy landing endpoint remains completable");

    const sourceWorld = makeWorld({shard: "shard3", portal: null});
    const sourceMove = {taskName: "moveCrossShardByPath", path: [
        {shard: "shard3", roomName: "E50S30", x: 15, y: 5},
    ], index: 0};
    const sourceCreep = makeCreep(sourceWorld.Creep, "shard3", 15, 6, "E50S30", [sourceMove], null);
    sourceCreep.moveCrossShardByPath();
    assert.equal(sourceCreep.popped, undefined, "missing source portal must not finish a route");
}

// 9) The handler must never restart its search at index zero.
{
    const fn = extractFn(src, "Creep.prototype.moveCrossShardByPath");
    assert.ok(!/for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*path\.length/.test(fn),
        "moveCrossShardByPath 不得从 0 重扫 path（会把 index 拉回，claimer 卡死）");
    assert.ok(fn.includes("task.index >= path.length"), "必须按 >= 判定越过末段");
}

// 10) claim 成功通知源 shard 摘旗。
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

// 11) mission 侧必须有幂等的 removeFlag 处理器。
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
