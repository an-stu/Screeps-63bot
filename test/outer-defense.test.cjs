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
        getDirectionTo(t) {
            let o = t.pos || t;
            let dx = Math.sign(o.x - this.x), dy = Math.sign(o.y - this.y);
            // 1..8 = TOP, TOP_RIGHT, RIGHT, ... 与引擎同序（测试只要求是个方向值）
            return [ [8, 1, 2], [7, 0, 3], [6, 5, 4] ][dy + 1][dx + 1];
        },
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
        // `outerDefenseLairGroups` 用 PathFinder 算「窝 ↔ 窝」的真实寻路距离来决定分组；
        // 桩只要返回一条有长度的路径即可（测试只关心分组/是否重算，不关心具体数值）。
        PathFinder: { search: () => ({ path: [0, 1, 2, 3, 4] }) },
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
        getPartCnt(type) { return body.filter(e => e.type == type).length; },
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
        move(dir) { calls.push(["move", dir]); return CONSTANTS.OK; },
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
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];
    const keeper = { id: "k1", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), pos: makePos(40, 15, "W34N55") };
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
            if (c == CONSTANTS.FIND_HOSTILE_STRUCTURES) return [lair];
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
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
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
    const keeper = { id: "k1", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), pos: makePos(40, 15, "W34N55") };
    ctx.Game.getObjectById = id => (id === "core1" ? core : id === "k1" ? keeper : null);
    // ⚠️ 必须换一个**新的 room 对象**：引擎里 room 对象每 tick 重建，
    // defenseAllies / defenseLairs 这些「同 tick 同房只算一次」的缓存正是靠这个
    // 天然过期。这条测试复用同一个 room 桩跑两次 outerDefense（= 两个 tick），
    // 沿用旧对象会读到上一个 tick 的缓存，把「按 lair 半径判威胁」这条判据整条跳过。
    creep.room = { name: "W34N55", find: c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? [keeper]
        : c == CONSTANTS.FIND_HOSTILE_STRUCTURES ? [lair] : []) };
    ctx.Creep.prototype.outerDefense.call(creep);
    assert.equal(creep.memory.targetId, "k1", "live enemies take priority every tick");
    assert.ok(creep.calls.some(c => c[0] === "attack" && c[1] === "k1"));
}

{
    // === outerDefense：友军遇袭时，距敌人最近的那只防守爬出手 ===
    const ctx = loadStation();
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];

    // invader 小队卡在运输路线上（离窝远、贴着我们的 carrier）
    const invader = { id: "inv1", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), pos: makePos(12, 3, "W34N55") };
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
            if (c == CONSTANTS.FIND_HOSTILE_STRUCTURES) return [lair];
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

{
    // === outerDefense：优先打**已经在流血**的那只（Overmind CombatTargeting 打分） ===
    const ctx = loadStation();
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];
    const healthy = { id: "kFull", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), hits: 5000, hitsMax: 5000, pos: makePos(43, 15, "W34N55") };
    const hurt = { id: "kHurt", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), hits: 2120, hitsMax: 5000, pos: makePos(38, 12, "W34N55") };
    const def = makeCreep(ctx, { x: 42, y: 14 });
    def.memory.role = "outerHarvestDefenser";
    const room = {
        name: "W34N55",
        find: c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? [healthy, hurt]
            : c == CONSTANTS.FIND_HOSTILE_STRUCTURES ? [lair] : []),
    };
    ctx.Game.getObjectById = id => (id === "kHurt" ? hurt : id === "kFull" ? healthy : null);
    def.room = room;
    def.pos.roomRef = room;
    ctx.Creep.prototype.outerDefense.call(def);
    assert.equal(def.memory.targetId, "kHurt",
        "接战半径内优先打残血的（先打死一只就少挨一份伤害）");

    // 同一规则**有界**：残血但在接战半径外的不追（否则会走开、把矿工丢在原地）
    const ctx2 = loadStation();
    ctx2.StationSources.outerDefensePosts = () => [lair];
    const farHurt = { id: "kFar", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), hits: 500, hitsMax: 5000, pos: makePos(49, 14, "W34N55") };
    const near = { id: "kNear", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), hits: 5000, hitsMax: 5000, pos: makePos(34, 15, "W34N55") };
    const def2 = makeCreep(ctx2, { x: 33, y: 14 });
    def2.memory.role = "outerHarvestDefenser";
    const room2 = {
        name: "W34N55",
        find: c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? [near, farHurt]
            : c == CONSTANTS.FIND_HOSTILE_STRUCTURES ? [lair] : []),
    };
    ctx2.Game.getObjectById = id => (id === "kNear" ? near : id === "kFar" ? farHurt : null);
    def2.room = room2;
    def2.pos.roomRef = room2;
    ctx2.Creep.prototype.outerDefense.call(def2);
    assert.equal(def2.memory.targetId, "kNear", "接战半径外的残血目标不追（防走开回归）");
}

{
    // === outerDefense：贴身命中后同 tick 往目标方向推一格（Overmind attackAndChase） ===
    const ctx = loadStation();
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];
    const keeper = { id: "k1", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), hits: 5000, hitsMax: 5000, pos: makePos(43, 15, "W34N55") };
    const def = makeCreep(ctx, { x: 42, y: 14 });
    def.memory.role = "outerHarvestDefenser";
    const room = {
        name: "W34N55",
        find: c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? [keeper]
            : c == CONSTANTS.FIND_HOSTILE_STRUCTURES ? [lair] : []),
    };
    ctx.Game.getObjectById = id => (id === "k1" ? keeper : null);
    def.room = room;
    def.pos.roomRef = room;
    ctx.Creep.prototype.outerDefense.call(def);
    assert.ok(def.calls.some(c => c[0] === "attack" && c[1] === "k1"), "贴身就打");
    assert.ok(def.calls.some(c => c[0] === "move"),
        "命中后同 tick 往目标方向推一格：目标这一步退开也不会丢输出");
}

{
    // === 交战决策：**算得赢才贴脸**（不是无脑贴）===
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    const mkKeeper = (id, x, y, extra = {}) => Object.assign({
        id, owner: { username: "Source Keeper" }, hits: 5000, hitsMax: 5000,
        body: [{ type: CONSTANTS.ATTACK }, { type: CONSTANTS.RANGED_ATTACK }],
        getActiveBodyparts: t => (t === CONSTANTS.ATTACK ? 10 : (t === CONSTANTS.RANGED_ATTACK ? 10 : 0)),
        pos: makePos(x, y, "W34N55"),
    }, extra);
    const mkInvader = (id, x, y) => ({
        id, owner: { username: "Invader" }, hits: 1000, hitsMax: 1000,
        body: [{ type: CONSTANTS.ATTACK }],
        getActiveBodyparts: t => (t === CONSTANTS.ATTACK ? 5 : 0),
        pos: makePos(x, y, "W34N55"),
    });
    // 真实体型：22 ATTACK + 11 HEAL（= 输出 660 + 自愈 132 → 对拼阈值 792）
    const meleeBody = [];
    for (let i = 0; i < 22; i++) meleeBody.push({ type: CONSTANTS.ATTACK });
    for (let i = 0; i < 11; i++) meleeBody.push({ type: CONSTANTS.HEAL });
    function scene(hostiles, creepOpts = {}) {
        const ctx = loadStation();
        ctx.StationSources.outerDefensePosts = () => [lair];
        const def = makeCreep(ctx, Object.assign({ x: 42, y: 14, body: meleeBody, hits: 5000, hitsMax: 5000 }, creepOpts));
        def.memory.role = "outerHarvestDefenser";
        const room = {
            name: "W34N55",
            find: c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? hostiles
                : c == CONSTANTS.FIND_HOSTILE_STRUCTURES ? [lair] : []),
        };
        const byId = {};
        hostiles.forEach(h => byId[h.id] = h);
        ctx.Game.getObjectById = id => byId[id] || null;
        def.room = room;
        def.pos.roomRef = room;
        ctx.Creep.prototype.outerDefense.call(def);
        return def;
    }
    // 单只 keeper：账算得赢（400 < 我们的输出+自愈）→ 贴脸打
    const solo = scene([mkKeeper("k1", 43, 15)]);
    assert.ok(solo.calls.some(c => c[0] === "attack" && c[1] === "k1"), "单只 keeper 能赢 → 贴身对拼");

    // 两只 keeper 夹着（800 > 792）：健康也不贴，退到 range 4 等队友
    const pair = scene([mkKeeper("k1", 43, 15), mkKeeper("k2", 41, 15)]);
    assert.ok(!pair.calls.some(c => c[0] === "attack"), "两把近战夹击算下来赢不了 → 不贴脸");
    assert.ok(pair.calls.some(c => c[0] === "moveTo"),
        "退开（keeper 不追人，range 4 只吃 10/发而自愈 132/发，退开就是免费医院）");
    const pairHurt = scene([mkKeeper("k1", 43, 15), mkKeeper("k2", 41, 15)], { hits: 4000 });
    assert.ok(pairHurt.calls.some(c => c[0] === "heal" && c[1] === "self"),
        "退开的同时自愈（掉血才会 heal，满血不需要）");

    // 重伤（<50%）单 keeper：退到 range 4 自愈
    const hurt = scene([mkKeeper("k1", 43, 15)], { hits: 2000 });
    assert.ok(!hurt.calls.some(c => c[0] === "attack"), "重伤时先退开自愈");
    assert.ok(hurt.calls.some(c => c[0] === "moveTo"));

    // 会追人的敌人（invader）受伤也不退：退了它照样贴上来
    const inv = scene([mkInvader("i1", 43, 15)], { hits: 2000 });
    assert.ok(inv.calls.some(c => c[0] === "attack" && c[1] === "i1"),
        "会追人的敌人不能靠退，照样打");

    // 收尾例外：目标只剩一 tick 的量，夹击也要打死
    const fin = scene([mkKeeper("k1", 43, 15, { hits: 300 }), mkKeeper("k2", 41, 15)]);
    assert.ok(fin.calls.some(c => c[0] === "attack" && c[1] === "k1"),
        "目标残血到一两 tick 能收掉时，即使被夹击也照打");
}

{
    // === 分组纪律：只许本组接自己的窝；跨组必须近 ≥20 格 ===
    const lairA = { id: "lA", structureType: "keeperLair", pos: makePos(7, 17, "W34N55") };
    const lairB = { id: "lB", structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    const lairC = { id: "lC", structureType: "keeperLair", pos: makePos(7, 38, "W34N55") };
    const lairD = { id: "lD", structureType: "keeperLair", pos: makePos(36, 29, "W34N55") };
    const allLairs = [lairA, lairB, lairC, lairD];
    function scene2(myGroup, myPos, mates, keeperPos) {
        const ctx = loadStation();
        ctx.StationSources.outerDefensePosts = () => [lairA, lairB];
        const keeper = {
            id: "k1", owner: { username: "Source Keeper" }, hits: 5000, hitsMax: 5000,
            body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 10 : (t === "ranged_attack" ? 10 : 0)),
            pos: makePos(keeperPos[0], keeperPos[1], "W34N55"),
        };
        // 真实体型：22 ATTACK + 11 HEAL（空体型会被「对拼账」判成打不过 → 不出手）
        const realBody = [];
        for (let i = 0; i < 22; i++) realBody.push({ type: CONSTANTS.ATTACK });
        for (let i = 0; i < 11; i++) realBody.push({ type: CONSTANTS.HEAL });
        const me = makeCreep(ctx, { x: myPos[0], y: myPos[1], body: realBody });
        me.memory.role = "outerHarvestDefenser";
        me.memory.defenseGroup = myGroup;
        const all = [me].concat(mates);
        const room = {
            name: "W34N55",
            memory: { defenseLairGroups: [["lA", "lB"], ["lC", "lD"]],
                      defenseLairGroupsKey: allLairs.map(e => e.id).join(",") },
            find: c => (c == CONSTANTS.FIND_HOSTILE_CREEPS ? [keeper]
                : c == CONSTANTS.FIND_MY_CREEPS ? all
                    : c == CONSTANTS.FIND_HOSTILE_STRUCTURES ? allLairs : []),
        };
        ctx.Game.getObjectById = id => (id === "k1" ? keeper : null);
        me.room = room;
        me.pos.roomRef = room;
        ctx.Creep.prototype.outerDefense.call(me);
        return me;
    }
    const mate = (group, x, y) => {
        const c = { memory: { role: "outerHarvestDefenser", defenseGroup: group }, pos: makePos(x, y, "W34N55") };
        return c;
    };
    // ① 敌人贴着我这组的窝（7,17）→ 我可以打
    const mine = scene2(0, [10, 16], [mate(1, 40, 40)], [7, 16]);
    assert.ok(mine.calls.some(c => c[0] === "attack"), "本组窝旁的敌人照打");

    // ② 敌人在别组窝旁（7,38 = 组1），而组1 的爬就在旁边（距离 1）→ 我不许抢
    const other = scene2(0, [10, 16], [mate(1, 8, 37)], [7, 38]);
    assert.ok(!other.calls.some(c => c[0] === "attack"), "别组窝旁的敌人不许抢（本组爬就在旁边）");

    // ③ 同一情况但组1 的爬远在天边（≥20 格差）→ 允许我接手，别让窝空着
    const far = scene2(0, [10, 37], [mate(1, 45, 5)], [7, 38]);
    assert.ok(far.calls.some(c => c[0] === "attack"), "别组的爬远 ≥20 格 → 允许接手");

    // ④ 本组没人了（另一只在路上还没出生）→ 直接接手
    const solo = scene2(0, [10, 37], [], [7, 38]);
    assert.ok(solo.calls.some(c => c[0] === "attack"), "本组无人时照打，不能把窝晾着");
}

console.log("outer defense checks passed");
{
    // === 已接战别的目标的防守爬不参与新目标竞争：次近的空闲者接手 ===
    // 实测两只 keeper 同时在场：(3,16) 的分配给了正在打 (35,27) 的最近者，
    // 两只满血空闲防守爬因"不是最近"袖手，矿工被屠。
    const ctx = loadStation();
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    const lairWest = { structureType: "keeperLair", pos: makePos(7, 17, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair, lairWest];
    const west = { id: "kw", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), pos: makePos(3, 16, "W34N55") };
    const east = { id: "ke", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), pos: makePos(35, 27, "W34N55") };
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
            if (c == CONSTANTS.FIND_HOSTILE_STRUCTURES) return [lair, lairWest];
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

{
    // === 挨得近的两个敌人由同一只防守爬兼顾，不另派人（用户确认的语义） ===
    const ctx = loadStation();
    const lair = { structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    ctx.StationSources.outerDefensePosts = () => [lair];
    const h1 = { id: "h1", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), pos: makePos(40, 15, "W34N55") };
    const h2 = { id: "h2", body: [{ type: "attack" }], getActiveBodyparts: t => (t === "attack" ? 1 : 0), pos: makePos(42, 16, "W34N55") };
    const busy = makeCreep(ctx, { x: 41, y: 15, body: [{ type: "ranged_attack" }] });
    busy.memory.role = "outerHarvestDefenser";
    busy.memory.targetId = "h1";
    const idle = makeCreep(ctx, { x: 43, y: 13, body: [{ type: "ranged_attack" }] });
    idle.memory.role = "outerHarvestDefenser";
    const room = {
        name: "W34N55",
        find(c) {
            if (c == CONSTANTS.FIND_HOSTILE_CREEPS) return [h1, h2];
            if (c == CONSTANTS.FIND_MY_CREEPS) return [busy, idle];
            if (c == CONSTANTS.FIND_HOSTILE_STRUCTURES) return [lair];
            return [];
        },
    };
    ctx.Game.getObjectById = id => (id === "h1" ? h1 : id === "h2" ? h2 : null);
    idle.room = room;
    ctx.Creep.prototype.outerDefense.call(idle);
    assert.ok(!idle.calls.some(c => c[0] === "attack" || c[0] === "rangedAttack"),
        "a hostile pair within engage spread must be covered by the engaged defender alone");
}

// ───────── stopRemote：常驻停用某矿，判据**不能依赖视野** ─────────
//
// 旧写法 `Game.rooms[rn] && Game.rooms[rn].flags("stopRemote")` 要求先看得见那个房。
// 但常驻停用恰恰要在「爬撤走、失去视野」之后依然生效 —— 一没视野守卫就静默失效、
// 又开始补员，而 keeper 不需要视野也能走进矿里，矿会自己活回来。所以改成遍历
// Game.flags（旗子始终属于账号，不依赖视野）按「名字前缀 + 房名」查。
{
    const ctx = loadHarvest({ rooms: {} });
    const S = ctx.StrategyOuterHarvest;
    ctx.Game.flags = {};

    assert.equal(S.hasStopRemoteFlag("W35N55"), false, "没有旗就是不暂停");

    ctx.Game.flags = { stopRemote_W35N55: { pos: { roomName: "W35N55" } } };
    // 本用例的关键前提：Game 里**根本没有** rooms（= 完全没有视野）
    assert.equal(ctx.Game.rooms, undefined, "前提：没有房间视野");
    assert.equal(S.hasStopRemoteFlag("W35N55"), true, "失去视野也要认出停用旗");
    assert.equal(S.hasStopRemoteFlag("W34N55"), false, "只管自己那个房");

    // 语义与引擎 Room.prototype.flags(name) 一致：**名字前缀**匹配
    ctx.Game.flags = { stopRemote2: { pos: { roomName: "W35N55" } } };
    assert.equal(S.hasStopRemoteFlag("W35N55"), true, "前缀匹配");

    ctx.Game.flags = { har_W33N55_W35N55: { pos: { roomName: "W35N55" } } };
    assert.equal(S.hasStopRemoteFlag("W35N55"), false, "har 旗不是停用旗");

    assert.equal(S.hasStopRemoteFlag(undefined), false, "空房名不能炸");
}

// ───────── 分组表的缓存键必须稳定：调用点不能传不同顺序的 lair 列表 ─────────
//
// outerDefenseLairGroups 的键就是 `lairs.map(id).join(",")`，所以**传入顺序不同 =
// 两个不同的键**。原来 outerDefense 传 room.find 的引擎顺序、outerDefensePosts 传
// 坐标排序顺序 ⇒ 每 tick 互相把对方的缓存打掉，整组 PathFinder（4 个窝 = 6 次跨房
// 寻路）被反复重算。实测 outerHarvestDefenser 3 只吃 3.47 CPU/tick（1.16/只，
// 占全部爬的 37%），主因就是这个。现在三处统一走 defenseLairs。
{
    let searches = 0;
    const ctx = loadStation({ PathFinder: { search: () => { searches++; return { path: [0, 1, 2, 3, 4] }; } } });
    const S = ctx.StationSources;

    // 故意让「引擎顺序」与「坐标排序」不同：(7,17) 的 x 更小，应排到前面
    const east = { id: "a1", structureType: "keeperLair", pos: makePos(41, 14, "W34N55") };
    const west = { id: "b2", structureType: "keeperLair", pos: makePos(7, 17, "W34N55") };
    const room = { name: "W34N55", memory: {}, getHostileStructures: () => [east, west] };

    const lairs = S.defenseLairs(room);
    assert.deepEqual(lairs.map(e => e.id), ["b2", "a1"],
        "defenseLairs 按 x 升序排序（这份顺序就是缓存键），与传入的引擎顺序不同");
    assert.equal(S.defenseLairs(room), lairs, "同 tick 同房只算一次（返回同一份）");

    S.outerDefenseLairGroups(room, lairs);
    const first = searches;
    assert.ok(first > 0, "首次要真算：PathFinder 至少跑一次");

    S.outerDefenseLairGroups(room, lairs);
    assert.equal(searches, first, "同一份列表第二次必须命中缓存，不再寻路");

    // 反过来演示「顺序不同就打掉缓存」—— 这正是原来的 bug 形态，
    // 所以三个调用点必须全部走 defenseLairs，不能自建列表。
    // 注意要传真正的反序（[a1, b2]），排序后的 [b2, a1] 和上面同序、不会让键变化。
    S.outerDefenseLairGroups(room, [east, west]);
    assert.ok(searches > first, "顺序不同就会重算（所以调用点必须同源）");

    // 源码层面兜一层：自建 keeper lair 列表只应出现在 defenseLairs 内部
    const codeOnly = stationSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const builders = codeOnly.match(/filter\(e => e\.structureType == STRUCTURE_KEEPER_LAIR\)/g) || [];
    assert.equal(builders.length, 1,
        "只允许 defenseLairs 内部自建列表；别处自建会让缓存键漂移（曾经因此每 tick 重跑整组寻路）");
    assert.ok(/let lairs = pro\.defenseLairs\(room\)/.test(codeOnly),
        "outerDefensePosts 必须走 defenseLairs");
}

