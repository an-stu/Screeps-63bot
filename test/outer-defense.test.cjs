const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const harvestSource = fs.readFileSync(path.join(root, "modules/strategy_outerHarvest.js"), "utf8");
const stationSource = fs.readFileSync(path.join(root, "modules/station_sources.js"), "utf8");

// 项目在游戏里加载了 lodash，.head() 是它的 Array 扩展。测试的桩对象创建于宿主
// realm、模块代码创建于 VM realm —— 两边的 Array.prototype 都要补上等价物。
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

const CONSTANTS = {
    OK: 0,
    ERR_NOT_OWNER: -1,
    ERR_NO_PATH: -2,
    ERR_BUSY: -4,
    ERR_INVALID_TARGET: -7,
    ERR_NOT_IN_RANGE: -9,
    ERR_NO_BODYPART: -12,
    MOVE: "move",
    WORK: "work",
    CARRY: "carry",
    ATTACK: "attack",
    HEAL: "heal",
    TOUGH: "tough",
    RANGED_ATTACK: "ranged_attack",
    LOOK_STRUCTURES: "structures",
    STRUCTURE_KEEPER_LAIR: "keeperLair",
    STRUCTURE_INVADER_CORE: "invaderCore",
    STRUCTURE_RAMPART: "rampart",
    FIND_HOSTILE_CREEPS: 101,
    FIND_MY_CREEPS: 102,
    FIND_HOSTILE_STRUCTURES: 103,
    RESOURCE_ENERGY: "energy",
};

function chebyshev(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 位置桩：支持 getRangeTo / inRangeTo / findClosestByRange / findInRange / lookFor */
function makePos(x, y, roomName) {
    return {
        x, y, roomName,
        getRangeTo(t) { return chebyshev(this, t.pos || t); },
        inRangeTo(t, n) { return chebyshev(this, t.pos || t) <= n; },
        isNearTo(t) { return chebyshev(this, t.pos || t) <= 1; },
        lookFor() { return []; },
        findClosestByRange(list) {
            return list.length ? list.reduce((a, b) =>
                chebyshev(this, b.pos || b) < chebyshev(this, a.pos || a) ? b : a) : undefined;
        },
        // 真 API 的 findInRange 第一参数是 FIND 常量（查房间）；也兼容直接传列表
        findInRange(constant, range, opts) {
            let list = typeof constant == "number"
                ? (this.roomRef ? this.roomRef.find(constant) : [])
                : (constant || []);
            let hit = list.filter(e => chebyshev(this, e.pos || e) <= range);
            return opts && opts.filter ? hit.filter(opts.filter) : hit;
        },
    };
}

function loadHarvest(memory) {
    const context = {
        ...CONSTANTS,
        console,
        Game: { time: 100000, shard: { name: "shard3" } },
        Memory: memory,
        RoomPosition: function (x, y, roomName) { return makePos(x, y, roomName); },
        // 仅 call-time 引用，加载期不触
        ManagerFlags: {}, StationHive: {}, StationSources: {}, StationMineral: {},
        StationLab: {}, StrategyMarket: {}, StrategyMarketPrice: {}, ManagerCreeps: {},
        UtilsTask: {},
    };
    context.global = context;
    vm.runInNewContext(harvestSource, context, { filename: "strategy_outerHarvest.js" });
    return context;
}

{
    // === coreBusterPlan：单只大体型（2026-09-30 定稿） ===
    const ctx = loadHarvest({ rooms: {} });
    const lv1 = ctx.StrategyOuterHarvest.coreBusterPlan(1);
    // VM realm 的对象原型与宿主不同，deepEqual 要先摊平成宿主对象
    assert.deepEqual({ ...lv1 }, { attackCnt: 15, healCnt: 0, moveCnt: 15, perCreep: 1 },
        "level-1 core: one [A15,M15] creep, 450 DPS kills 100k hits in ~222 ticks");
    // lv2 起有塔（150~300/tick 随距离）：远程体型在 range 3 输出，TOUGH 先结算
    // 减伤、3 HEAL（T3 ×48）= 144 > 90 塔打不穿。无 T3 化合物就不派（needsT3）。
    const lv2 = ctx.StrategyOuterHarvest.coreBusterPlan(2);
    assert.deepEqual({ ...lv2 }, {
        toughCnt: 2, healCnt: 3, rangedCnt: 20, moveCnt: 25, perCreep: 1, needsT3: true,
    }, "level-2+ core: ranged T3 plan that out-sustains the tower");
}

{
    // === roomNeedsDefense：失视野后按 lastHostileSeen 记忆处理 ===
    // 场景（W35N55 实测）：invader 小队杀光我们的爬 → 失视野。若只看旗名，
    // 永远不会为该房派防守爬，而 keeper/搬运还在往怪堆里派。
    const mem = { rooms: { W35N55: { lastHostileSeen: 100000 - 100 } } };
    const ctx = loadHarvest(mem);
    const flag = { name: "har_W33N55_W35N55", pos: makePos(25, 25, "W35N55") };
    assert.equal(ctx.StrategyOuterHarvest.roomNeedsDefense(undefined, flag), true,
        "hostiles seen 100 ticks ago must keep the room flagged as needing defense");
    mem.rooms.W35N55.lastHostileSeen = 100000 - 3000;
    assert.equal(ctx.StrategyOuterHarvest.roomNeedsDefense(undefined, flag), false,
        "stale hostile memory must expire");
    mem.rooms.W35N55.lastHostileSeen = 100000 - 2999;
    assert.equal(ctx.StrategyOuterHarvest.roomNeedsDefense(undefined, flag), true,
        "boundary: 2999 ticks is still within the memory window");

    // 有视野且看到敌人：返回 true 并把时间戳写进 memory
    const room = {
        name: "W34N55",
        find(c) {
            if (c == CONSTANTS.FIND_HOSTILE_CREEPS) return [{ pos: makePos(12, 3, "W34N55") }];
            return [];
        },
    };
    assert.equal(ctx.StrategyOuterHarvest.roomNeedsDefense(room, flag), true);
    assert.equal(ctx.Memory.rooms.W34N55.lastHostileSeen, 100000, "must stamp lastHostileSeen");
    // 有视野无敌人且无 lair/core：false
    const calm = { name: "W35N55", find: () => [] };
    assert.equal(ctx.StrategyOuterHarvest.roomNeedsDefense(calm, flag), false,
        "a neutral room with no threats must not require defense");
}

function loadStation(extra) {
    const context = {
        ...CONSTANTS,
        console,
        isSaveCpu: true,
        Game: { time: 100000, shard: { name: "shard3" }, getObjectById: () => null },
        Memory: { rooms: {} },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { return makePos(x, y, roomName); },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => undefined },
        UtilsTask: {
            task: (target, taskName) => ({ id: target.id, taskName }),
            taskData: taskName => ({ taskName }),
        },
        ...extra,
    };
    context.global = context;
    vm.runInNewContext(stationSource, context, { filename: "station_sources.js" });
    return context;
}

/** 防守爬/拆core爬的通用桩 */
function makeCreep(ctx, { x, y, hits = 5000, hitsMax = 5000, body = [], memory = {} }) {
    const calls = [];
    const creep = {
        id: "c" + x + "_" + y,
        name: "test",
        pos: makePos(x, y, "W34N55"),
        room: null,             // 由用例注入
        hits, hitsMax, body,
        memory,
        fatigue: 0,
        getActiveBodyparts(type) { return body.filter(e => e.type == type).length; },
        headTask: () => ({ roomName: "W34N55", id: "core1", x: 11, y: 44 }),
        headTaskObj: () => undefined,
        popTask() { calls.push(["pop"]); return this; },
        addTask(t) { calls.push(["add", t.length]); return this; },
        execLastTask() { calls.push(["exec"]); return this; },
        attack(t) { calls.push(["attack", t && t.id]); return this.attackRet === undefined ? CONSTANTS.OK : this.attackRet; },
        rangedAttack(t) { calls.push(["rangedAttack", t && t.id]); return this.rangedRet === undefined ? CONSTANTS.OK : this.rangedRet; },
        heal(t) { calls.push(["heal", t === this ? "self" : (t && t.id)]); return CONSTANTS.OK; },
        rangedHeal(t) { calls.push(["rangedHeal", t && t.id]); return CONSTANTS.OK; },
        moveTo(t) { calls.push(["moveTo", (t.pos || t) && (t.pos || t).x, (t.pos || t) && (t.pos || t).y]); return CONSTANTS.OK; },
        goTo() { calls.push(["goTo"]); return CONSTANTS.OK; },
        suicide() { calls.push(["suicide"]); },
    };
    creep.calls = calls;
    return creep;
}

{
    // === coreBuster：先拆压在 core 上的 rampart，伤害才吃得到 core 本体 ===
    const ctx = loadStation();
    const rampart = { id: "r1", structureType: "rampart", my: false, hits: 5000 };
    const core = {
        id: "core1",
        pos: Object.assign(makePos(11, 44, "W34N55"), {
            lookFor: () => [rampart],
        }),
    };
    ctx.Game.getObjectById = id => (id === "core1" ? core : null);
    const creep = makeCreep(ctx, { x: 12, y: 43, hits: 100, hitsMax: 300, body: [{ type: "heal" }] });
    creep.room = { name: "W34N55" };
    ctx.Creep.prototype.coreBuster.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "attack" && c[1] === "r1"),
        "a rampart over the core must be attacked first");
    assert.ok(!creep.calls.some(c => c[0] === "attack" && c[1] === "core1"),
        "the core under the rampart must not be attacked through it");
    assert.ok(creep.calls.some(c => c[0] === "heal" && c[1] === "self"),
        "hurt buster with HEAL parts must self-heal while attacking");

    // 没有 barrier 时直接打 core；满血带奶体型不浪费 heal
    core.pos.lookFor = () => [];
    const fresh = makeCreep(ctx, { x: 12, y: 43, hits: 300, hitsMax: 300, body: [{ type: "attack" }] });
    fresh.room = { name: "W34N55" };
    ctx.Creep.prototype.coreBuster.call(fresh);
    assert.ok(fresh.calls.some(c => c[0] === "attack" && c[1] === "core1"),
        "with no rampart the core itself is the target");
    assert.ok(!fresh.calls.some(c => c[0] === "heal"),
        "no HEAL parts -> no wasted heal call");

    // 远程体型（lv2+ 方案）在 range 3 用 rangedAttack 输出，不浪费近战意图
    core.pos.lookFor = () => [];
    const ranged = makeCreep(ctx, { x: 13, y: 43, hits: 4000, hitsMax: 4000, body: [{ type: "ranged_attack" }] });
    ranged.room = { name: "W34N55" };
    ctx.Creep.prototype.coreBuster.call(ranged);
    assert.ok(ranged.calls.some(c => c[0] === "rangedAttack" && c[1] === "core1"),
        "ranged busters must use rangedAttack against the core");
    assert.ok(!ranged.calls.some(c => c[0] === "attack"),
        "a body without ATTACK parts must not attempt melee");

    // core 没了 → 弹任务回收
    ctx.Game.getObjectById = () => null;
    const done = makeCreep(ctx, { x: 12, y: 43 });
    done.room = { name: "W34N55" };
    ctx.Creep.prototype.coreBuster.call(done);
    assert.ok(done.calls.some(c => c[0] === "pop") && done.calls.some(c => c[0] === "add") && done.calls.some(c => c[0] === "exec"),
        "a dead core must pop the bust task and recycle the creep");
}

{
    // === coreBuster：无敌期（未部署）的 core 打不动（attack 恒 -7），立刻回收 ===
    // 实测：同一房间、距离 1、有 ATTACK 部件，attack 恒 ERR_INVALID_TARGET，
    // 几千 tick 零伤害 —— 旧小爬一晚只磨掉了 rampart。与其站到 ttl 耗尽，
    // 不如回收，spawnCoreBuster 在破防临近时重派。
    const ctx = loadStation();
    const core = {
        id: "core1", level: 1, ticksToDeploy: 3000,
        pos: Object.assign(makePos(11, 44, "W34N55"), { lookFor: () => [] }),
    };
    ctx.Game.getObjectById = id => (id === "core1" ? core : null);
    const creep = makeCreep(ctx, { x: 12, y: 43, body: [{ type: "attack" }] });
    creep.attackRet = -7;                      // ERR_INVALID_TARGET
    creep.room = { name: "W34N55" };
    ctx.Creep.prototype.coreBuster.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "pop") && creep.calls.some(c => c[0] === "add"),
        "an invulnerable (undeployed) core must release the buster for recycling");

    // 破防后（ticksToDeploy == 0）-7 不能再触发回收，必须继续走位攻击
    const late = makeCreep(ctx, { x: 12, y: 44, body: [{ type: "attack" }] });
    late.attackRet = -7;
    late.room = { name: "W34N55" };
    core.ticksToDeploy = 0;
    ctx.Creep.prototype.coreBuster.call(late);
    assert.ok(!late.calls.some(c => c[0] === "pop"),
        "once the core is deployed -7 must not release the buster");
    assert.ok(late.calls.some(c => c[0] === "moveTo"),
        "a failed attack must still drive the creep toward the core");
}

{
    // === coreBuster：行军段与攻击段的移动缓存目标必须分离 ===
    // 若行军也指向 core 坐标，跨房路径缓存会被攻击段的同目标 moveTo 复用，
    // 边界上原地不动、被过路爬对穿来回搬运（实测 40 分钟零进度）。
    const ctx = loadStation();
    const creep = makeCreep(ctx, { x: 0, y: 24 });
    creep.room = { name: "W33N55" };
    creep.headTask = () => ({ taskName: "coreBuster", id: "core1", roomName: "W34N55", x: 11, y: 44 });
    ctx.Game.getObjectById = id => (id === "core1"
        ? { id: "core1", pos: makePos(11, 44, "W34N55") } : null);
    ctx.Creep.prototype.coreBuster.call(creep);
    const mv = creep.calls.find(c => c[0] === "moveTo");
    assert.ok(mv && mv[1] === 25 && mv[2] === 25,
        "travel must target the task room's centre, not the core itself");
    assert.ok(!creep.calls.some(c => c[0] === "attack"),
        "no attack attempts while travelling (they return -7 across a border)");
}

{
    // === outerDefense 行军段：目标取房间中心，与房间内目标缓存分离 ===
    // 原来直奔源点坐标，而 keeper 就站在源旁——同目标的跨房缓存跨界后卡死，
    // 防守爬被对穿钉在边境门格上（实测 (0,18) 一个格困死两只，ttl 27 老死在门口）。
    const ctx = loadStation();
    const creep = makeCreep(ctx, { x: 0, y: 18 });
    creep.room = { name: "W33N55" };
    creep.headTask = () => ({ taskName: "outerDefense", id: "src1", roomName: "W34N55", x: 3, y: 17 });
    ctx.Creep.prototype.outerDefense.call(creep);
    assert.ok(creep.calls.some(c => c[0] === "moveTo" && c[1] === 25 && c[2] === 25),
        "travel must target the task room's centre, not the source tile");
    assert.ok(!creep.calls.some(c => c[0] === "goTo"),
        "the source-tile goTo is exactly what wedged defenders at the border door");
}

{
    // === 接战手段跟着体型走：远程体型没有 ATTACK 部件，attack 恒 -12，
    // 原来只判 ERR_NOT_IN_RANGE → moveTo 永远不执行，防守爬站死在门口 ===
    const ctx = loadStation();
    const lair = { pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];
    const keeper = { id: "k1", body: [{ type: "attack" }], pos: makePos(40, 15, "W34N55") };
    ctx.Game.getObjectById = id => (id === "k1" ? keeper : null);

    // 远程体型、目标在射程内：rangedAttack 直接输出，不移动
    const inRange = makeCreep(ctx, { x: 41, y: 15, body: [{ type: "ranged_attack" }] });
    inRange.room = {
        name: "W34N55",
        find(c) {
            if (c == CONSTANTS.FIND_HOSTILE_CREEPS) return [keeper];
            if (c == CONSTANTS.FIND_MY_CREEPS) return [inRange];
            return [];
        },
    };
    ctx.Creep.prototype.outerDefense.call(inRange);
    assert.ok(inRange.calls.some(c => c[0] === "rangedAttack" && c[1] === "k1"),
        "ranged body must engage with rangedAttack");
    assert.ok(!inRange.calls.some(c => c[0] === "moveTo"),
        "in-range ranged attack must not move");

    // 远程体型、目标超出射程：必须推进到 range 3（-12 死锁的回归测试）
    const far = makeCreep(ctx, { x: 49, y: 17, body: [{ type: "ranged_attack" }] });
    far.rangedRet = CONSTANTS.ERR_NOT_IN_RANGE;
    far.room = {
        name: "W34N55",
        find(c) {
            if (c == CONSTANTS.FIND_HOSTILE_CREEPS) return [keeper];
            if (c == CONSTANTS.FIND_MY_CREEPS) return [far];
            return [];
        },
    };
    ctx.Creep.prototype.outerDefense.call(far);
    assert.ok(far.calls.some(c => c[0] === "rangedAttack" && c[1] === "k1"),
        "ranged body attempts the shot even out of range");
    assert.ok(far.calls.some(c => c[0] === "moveTo" && c[1] === 40),
        "out-of-range ranged attack must close to range 3 (the -12 stall regression)");
}

{
    // === outerDefense：不再去啃 invaderCore（9-30 丢 13 只爬的根因之一） ===
    const ctx = loadStation();
    // 老 memory 把 targetId 钉在 core（结构）上
    const core = { id: "core1", structureType: "invaderCore", pos: makePos(11, 44, "W34N55") };
    ctx.Game.getObjectById = id => (id === "core1" ? core : null);
    const lair = { pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];
    const creep = makeCreep(ctx, { x: 42, y: 14, memory: { targetId: "core1", defenseGroup: 0 } });
    creep.room = { name: "W34N55", find: () => [] };
    ctx.Creep.prototype.outerDefense.call(creep);
    assert.equal(creep.memory.targetId, undefined,
        "a structure targetId must be dropped: defenders fight live creeps only, busters handle the core");
    assert.ok(!creep.calls.some(c => c[0] === "attack"),
        "no live enemies -> no attack at all (no core-chasing marches)");

    // 活体敌人每 tick 重查：即便 core id 还挂着，也会换成活体
    //（keeper 贴着窝出怪，真实场景里它必然落在守卫半径内）
    const keeper = { id: "k1", body: [{ type: "attack" }], pos: makePos(40, 15, "W34N55") };
    ctx.Game.getObjectById = id => (id === "core1" ? core : id === "k1" ? keeper : null);
    creep.room.find = c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? [keeper] : []);
    ctx.Creep.prototype.outerDefense.call(creep);
    assert.equal(creep.memory.targetId, "k1", "live enemies take priority every tick");
    assert.ok(creep.calls.some(c => c[0] === "attack" && c[1] === "k1"));
}

{
    // === outerDefense：友军遇袭时，距敌人最近的那只防守爬出手 ===
    const ctx = loadStation();
    const lair = { pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];

    // invader 小队卡在运输路线上（离窝远、贴着我们的 carrier）
    const invader = { id: "inv1", body: [{ type: "attack" }], pos: makePos(12, 3, "W34N55") };
    const carrier = { id: "cv1", memory: { role: "outerHarvestEnergyCarrier" }, pos: makePos(13, 7, "W34N55") };
    // 近处防守爬 (14,6) 与远处防守爬 (42,14)
    const nearDef = makeCreep(ctx, { x: 14, y: 6 });
    nearDef.memory.role = "outerHarvestDefenser";
    const farDef = makeCreep(ctx, { x: 42, y: 14 });
    farDef.memory.role = "outerHarvestDefenser";

    const room = {
        name: "W34N55",
        find(c) {
            if (c == CONSTANTS.FIND_HOSTILE_CREEPS) return [invader];
            if (c == CONSTANTS.FIND_MY_CREEPS) return [nearDef, farDef, carrier];
            return [];
        },
    };
    ctx.Game.getObjectById = id => (id === "inv1" ? invader : null);
    nearDef.room = room;
    nearDef.pos.roomRef = room;
    ctx.Creep.prototype.outerDefense.call(nearDef);
    assert.ok(nearDef.calls.some(c => c[0] === "attack" && c[1] === "inv1"),
        "the nearest defender must engage an invader squad threatening an ally");
    assert.equal(nearDef.memory.targetId, "inv1");

    farDef.room = room;
    ctx.Creep.prototype.outerDefense.call(farDef);
    assert.ok(!farDef.calls.some(c => c[0] === "attack" && c[1] === "inv1"),
        "the farther defender must stay at its post (only the closest one breaks off)");
    assert.equal(farDef.memory.targetId, undefined,
        "the staying defender must not record the target either");
}

console.log("outer defense checks passed");

{
    // === 已接战别的目标的防守爬不参与新目标竞争：次近的空闲者接手 ===
    // 实测两只 keeper 同时在场：(3,16) 的分配给了正在打 (35,27) 的最近者，
    // 两只满血空闲防守爬因"不是最近"袖手，矿工被屠。
    const ctx = loadStation();
    const lair = { pos: makePos(41, 14, "W34N55") };
    const lairWest = { pos: makePos(7, 17, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair, lairWest];
    const west = { id: "kw", body: [{ type: "attack" }], pos: makePos(3, 16, "W34N55") };
    const east = { id: "ke", body: [{ type: "attack" }], pos: makePos(35, 27, "W34N55") };
    const busy = makeCreep(ctx, { x: 35, y: 28, body: [{ type: "ranged_attack" }] });
    busy.memory.role = "outerHarvestDefenser";
    busy.memory.targetId = "ke";                       // 正在打东边那只
    const idleNear = makeCreep(ctx, { x: 42, y: 13, body: [{ type: "ranged_attack" }] });
    idleNear.memory.role = "outerHarvestDefenser";     // 次近且空闲
    const room = {
        name: "W34N55",
        find(c) {
            if (c == CONSTANTS.FIND_HOSTILE_CREEPS) return [west, east];
            if (c == CONSTANTS.FIND_MY_CREEPS) return [busy, idleNear];
            return [];
        },
    };
    ctx.Game.getObjectById = id => (id === "kw" ? west : id === "ke" ? east : null);
    idleNear.room = room;
    ctx.Creep.prototype.outerDefense.call(idleNear);
    assert.ok(idleNear.calls.some(c => c[0] === "rangedAttack" && c[1] === "kw"),
        "an idle defender must take the unclaimed hostile even though a busy one is nearer");
    // 忙碌者保持现有目标不被抢走
    busy.room = room;
    ctx.Creep.prototype.outerDefense.call(busy);
    assert.equal(busy.memory.targetId, "ke", "an engaged defender keeps its own target");
}
