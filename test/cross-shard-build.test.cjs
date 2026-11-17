// 跨 shard 建设阶段的回归测试：
// 1) 目标 shard 上建 spawn 工地（规划失败时螺旋兜底）；
// 2) 派工人任务链顺序必须是「先跨 shard，后建造」（任务栈末尾先执行）；
// 3) 派车间隔与人数上限、spawn 建成后配置自动摘除；
// 4) buildCrossShardRoom 的采能/建造/收尾行为。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "modules", "strategy_buildCrossShard.js"), "utf8");

const FIND_MY_SPAWNS = "mySpawns";
const FIND_MY_CONSTRUCTION_SITES = "mySites";
const FIND_SOURCES = "sources";
const STRUCTURE_SPAWN = "spawn";
const TERRAIN_MASK_WALL = 1;
const LOOK_STRUCTURES = "structures";
const LOOK_CONSTRUCTION_SITES = "sites";
const RESOURCE_ENERGY = "energy";
const OK = 0;
const ERR_NOT_IN_RANGE = -9;

class RoomPosition {
    constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    getRangeTo(target) {
        const p = target && target.pos ? target.pos : target;
        return Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y));
    }
    createConstructionSite(structureType) {
        world.created.push({x: this.x, y: this.y, roomName: this.roomName, structureType});
        return OK;
    }
}

let world;
function makeWorld(opts = {}) {
    world = {
        created: [],
        missions: [],
        plannerCalls: 0,
        ensureCalls: 0,
        now: 1000000,
        wall: opts.wall || null,
        ensureCreatesSite: !!opts.ensureCreatesSite,
    };
    const sandbox = {
        Creep: function () {},
        RoomPosition,
        Game: {time: 1000, cpu: {bucket: 8000}, creeps: {}, rooms: {}},
        Memory: {},
        FIND_MY_SPAWNS, FIND_MY_CONSTRUCTION_SITES, FIND_SOURCES,
        STRUCTURE_SPAWN, TERRAIN_MASK_WALL, LOOK_STRUCTURES, LOOK_CONSTRUCTION_SITES,
        RESOURCE_ENERGY, OK, ERR_NOT_IN_RANGE,
        WORK: "work", CARRY: "carry", MOVE: "move",
        Date: {now: () => world.now},
        console: {log() {}},
        ManagerCreeps: {
            calcBodyPart(set) {
                let out = [];
                for (let type in set) for (let i = 0; i < set[type]; i++) out.push(type);
                return out;
            },
        },
        ManagerCrossShard: {
            addCrossShardRequest(toShard, mission) { world.missions.push({toShard, mission}); },
        },
        UtilsTask: {
            taskData(taskName, regFun, ops) { return Object.assign({taskName, regFun}, ops); },
        },
        ManagerAutoPlanner: {computeRoom() { world.plannerCalls++; }},
        StrategyClaim: {
            ensureConstructionSites(room) {
                world.ensureCalls++;
                if (world.ensureCreatesSite) {
                    room.sites.push({id: "spawnSite", structureType: STRUCTURE_SPAWN, pos: new RoomPosition(30, 15, room.name)});
                }
            },
        },
        StrategyClaimCrossShard: {
            getPath() { return {path: [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}]}; },
        },
    };
    sandbox.global = sandbox;
    vm.runInNewContext(source, sandbox);
    return sandbox;
}

function makeRoom(sb, opts = {}) {
    const room = {
        name: "E51S29",
        my: true,
        controller: {pos: new RoomPosition(32, 16, "E51S29")},
        sites: opts.sites || [],
        spawns: opts.spawns || [],
        sources: opts.sources || [],
        find(type) {
            if (type === FIND_MY_SPAWNS) return this.spawns;
            if (type === FIND_MY_CONSTRUCTION_SITES) return this.sites;
            if (type === FIND_SOURCES) return this.sources;
            return [];
        },
        getTerrain() { return {get: (x, y) => (world.wall && world.wall(x, y)) ? TERRAIN_MASK_WALL : 0}; },
        lookForAt() { return []; },
        getPositionAt(x, y) { return new RoomPosition(x, y, this.name); },
    };
    sb.Game.rooms[room.name] = room;
    return room;
}

// 1) 无 spawn、规划不可用 ⇒ 螺旋兜底建 spawn 工地；派 1 个工人（任务顺序：建造在前、移动在末尾）
{
    const sb = makeWorld();
    makeRoom(sb);
    sb.Memory.crossShardBuild = {room: "E51S29", originShard: "shard3", spawnRoom: "E49S31", builders: 2};
    sb.StrategyBuildCrossShard.exec();
    assert.equal(world.created.length, 1, "必须创建 spawn 工地");
    assert.equal(world.created[0].structureType, STRUCTURE_SPAWN);
    assert.equal(world.created[0].x, 31, "从 controller 半径 1 开始找空位");
    assert.equal(world.created[0].y, 15);
    assert.equal(world.missions.length, 1, "必须下发一个跨 shard 孵化任务");
    const m = world.missions[0];
    assert.equal(m.toShard, "shard3");
    assert.equal(m.mission.func, "spawnCreepCressShard");
    assert.equal(m.mission.data.spawnRoom, "E49S31");
    assert.equal(m.mission.data.targetRoomName, "E51S29");
    assert.equal(m.mission.data.role, "crossShardBuilder");
    const body = m.mission.data.body;
    assert.equal(body.filter(e => e === "work").length, 6);
    assert.equal(body.filter(e => e === "carry").length, 6);
    assert.equal(body.filter(e => e === "move").length, 12);
    const tasks = m.mission.data.tasks;
    assert.equal(tasks.length, 2);
    assert.equal(tasks[tasks.length - 1].taskName, "moveCrossShardByPath", "任务栈末尾必须是跨 shard 移动（先执行）");
    assert.deepEqual(tasks[tasks.length - 1].path, [{shard: "shard3", roomName: "E50S30", x: 15, y: 5}],
        "路径必须是单段出发侧虫洞，不能追加落地格");
    assert.equal(tasks[0].taskName, "buildCrossShardRoom");
    assert.equal(tasks[0].roomName, "E51S29");
}

// 2) 真实时间 8 分钟冷却：刚派过就不再派；冷却后才派第二个
{
    const sb = makeWorld();
    makeRoom(sb, {sites: [{id: "s1", structureType: STRUCTURE_SPAWN, pos: new RoomPosition(30, 15, "E51S29")}]});
    sb.Memory.crossShardBuild = {room: "E51S29", originShard: "shard3", spawnRoom: "E49S31", builders: 2};
    sb.Game.time = 1000;
    sb.StrategyBuildCrossShard.exec();
    assert.equal(world.missions.length, 1);
    sb.Game.time = 1005;
    sb.StrategyBuildCrossShard.exec();
    assert.equal(world.missions.length, 1, "8 分钟内不得重复派工人（工人在路上，目标 shard 看不到）");
    world.now += 8 * 60 * 1000 + 1;
    sb.Game.time = 1010;
    sb.StrategyBuildCrossShard.exec();
    assert.equal(world.missions.length, 2, "冷却结束后可以派第二个工人");
}

// 3) 在场工人达到上限 ⇒ 不再派
{
    const sb = makeWorld();
    makeRoom(sb, {sites: [{id: "s1", structureType: STRUCTURE_SPAWN, pos: new RoomPosition(30, 15, "E51S29")}]});
    sb.Memory.crossShardBuild = {room: "E51S29", originShard: "shard3", spawnRoom: "E49S31", builders: 2};
    sb.Game.creeps = {
        a: {memory: {role: "crossShardBuilder", roomName: "E51S29", tasks: []}},
        b: {memory: {role: "crossShardBuilder", roomName: "E51S29", tasks: []}},
    };
    sb.StrategyBuildCrossShard.exec();
    assert.equal(world.missions.length, 0, "工人已满员时不得再派");
}

// 4) spawn 建成 ⇒ 配置自动删除，停止派工
{
    const sb = makeWorld();
    makeRoom(sb, {spawns: [{id: "spawn1"}], sites: []});
    sb.Memory.crossShardBuild = {room: "E51S29", originShard: "shard3", spawnRoom: "E49S31", builders: 2};
    sb.StrategyBuildCrossShard.exec();
    assert.equal(sb.Memory.crossShardBuild, undefined, "spawn 建成后必须摘除配置");
    assert.equal(world.missions.length, 0);
}

// 5) 规划器可用 ⇒ 走 StrategyClaim.ensureConstructionSites，且不重复螺旋兜底
{
    const sb = makeWorld({ensureCreatesSite: true});
    makeRoom(sb);
    sb.Memory.crossShardBuild = {room: "E51S29", originShard: "shard3", spawnRoom: "E49S31", builders: 2};
    sb.StrategyBuildCrossShard.exec();
    assert.equal(world.ensureCalls, 1, "有 planner 时应走既有工地创建流程");
    assert.equal(world.created.length, 0, "已创建工地后不应再螺旋兜底");
    assert.equal(world.missions.length, 1);
}

// 6) buildCrossShardRoom 处理器
{
    const sb = makeWorld();
    const Creep = sb.Creep;

    // 6a. 不在目标房 ⇒ 走向房间中心
    {
        const creep = new Creep();
        creep.memory = {tasks: [{taskName: "buildCrossShardRoom", roomName: "E51S29"}]};
        creep.pos = {getRangeTo() { return 10; }};
        creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
        let target = null;
        creep.goTo = p => { target = p; };
        creep.buildCrossShardRoom();
        assert.ok(target && target.x === 25 && target.y === 25 && target.roomName === "E51S29", "无视野时必须去房间中心");
    }

    // 6b. 有工地、无能量 ⇒ 去采最近 source
    {
        const room = makeRoom(sb, {sites: [
            {id: "s1", structureType: STRUCTURE_SPAWN, pos: new RoomPosition(30, 15, "E51S29")},
        ], sources: [
            {id: "src1", pos: new RoomPosition(20, 20, "E51S29")},
            {id: "src2", pos: new RoomPosition(31, 15, "E51S29")},
        ]});
        sb.Game.getObjectById = id => room.find(FIND_SOURCES).find(s => s.id === id) || null;
        const creep = new Creep();
        creep.memory = {tasks: [{taskName: "buildCrossShardRoom", roomName: "E51S29"}]};
        creep.store = {[RESOURCE_ENERGY]: 0};
        creep.pos = new RoomPosition(30, 16, "E51S29");
        creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
        let movedTo = null, harvested = null;
        creep.moveTo = (t, opts) => { movedTo = {t, opts}; };
        creep.harvest = s => { harvested = s; return ERR_NOT_IN_RANGE; };
        creep.build = () => OK;
        creep.suicide = () => { throw new Error("must not suicide while a site exists"); };
        creep.buildCrossShardRoom();
        assert.equal(harvested.id, "src2", "应选离工地最近的 source");
        assert.ok(movedTo && movedTo.opts.range === 1, "采集要走到 range 1");
        assert.equal(creep.memory.tasks[0].sourceId, "src2", "sourceId 必须写回任务，避免每 tick 重选");
    }

    // 6c. 有能量 ⇒ 修工地
    {
        const room = makeRoom(sb, {sites: [
            {id: "s1", structureType: STRUCTURE_SPAWN, pos: new RoomPosition(30, 15, "E51S29")},
        ]});
        sb.Game.getObjectById = id => (id === "s1" ? room.sites[0] : null);
        const creep = new Creep();
        creep.memory = {tasks: [{taskName: "buildCrossShardRoom", roomName: "E51S29"}]};
        creep.store = {[RESOURCE_ENERGY]: 300};
        creep.pos = new RoomPosition(30, 16, "E51S29");
        creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
        let built = null, movedTo = null;
        creep.build = s => { built = s; return ERR_NOT_IN_RANGE; };
        creep.moveTo = (t, opts) => { movedTo = {t, opts}; };
        creep.harvest = () => { throw new Error("must not harvest with energy"); };
        creep.buildCrossShardRoom();
        assert.equal(built.id, "s1");
        assert.ok(movedTo && movedTo.opts.range === 3, "建造要走到 range 3");
    }

    // 6d. 工地全部完成且 spawn 已建成 ⇒ 收尾自杀
    {
        const room = makeRoom(sb, {sites: [], spawns: [{id: "spawn1"}]});
        const creep = new Creep();
        creep.memory = {tasks: [{taskName: "buildCrossShardRoom", roomName: "E51S29"}]};
        creep.store = {[RESOURCE_ENERGY]: 0};
        creep.pos = new RoomPosition(30, 16, "E51S29");
        creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
        let died = false;
        creep.suicide = () => { died = true; };
        creep.buildCrossShardRoom();
        assert.equal(died, true, "阶段完成后工人应自杀，避免闲置");
    }

    // 6e. 工地没了但 spawn 还没建成 ⇒ 原地等策略补工地，不得自杀
    {
        const room = makeRoom(sb, {sites: [], spawns: []});
        const creep = new Creep();
        creep.memory = {tasks: [{taskName: "buildCrossShardRoom", roomName: "E51S29"}]};
        creep.store = {[RESOURCE_ENERGY]: 0};
        creep.pos = new RoomPosition(30, 16, "E51S29");
        creep.lastTask = function () { return this.memory.tasks[this.memory.tasks.length - 1]; };
        let died = false;
        creep.suicide = () => { died = true; };
        creep.buildCrossShardRoom();
        assert.equal(died, false, "工地被撤销时应等待补建，不得自杀");
    }
}

// 7) 路径来源复用 claim 策略（同一份 Memory 覆盖）；模块不得自带第二份默认路径常量
{
    const claimSrc = fs.readFileSync(path.join(__dirname, "..", "modules", "strategy_claimCrossShard.js"), "utf8");
    assert.ok(claimSrc.includes("getPath()"), "claim 策略必须导出 getPath，避免两份路径默认值漂移");
    assert.ok(!/DEFAULT_CLAIM_PATH/.test(source), "建设策略不应再定义一份默认路径");
}

console.log("cross-shard build checks passed");
