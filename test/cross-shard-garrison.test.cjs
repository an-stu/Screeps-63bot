/**
 * 跨 shard T3 RA 驻守（2026-11-27 W31N51）。
 *
 * 现场：shard2/W31N51 被 Overmind 玩家的 4 人 heal+RA T3 小队攻击，safe mode
 * 剩约 1.06 万 tick。防守从 shard3/W31N55 经 W30N50(30,8) 虫洞派 T3 RA，
 * 到达后用 crossShardGarrison 行为驻守：近战风筝、HEAL 目标优先集火。
 *
 * 本测试覆盖：
 *  ① 调度器只按缺员派一只，mission 里任务栈/路径/boost/目标房正确；
 *  ② 已在任务队列里的 mission 会阻止重复派兵；
 *  ③ 目标 shard 的 audit 记录 safe mode、敌方 HEAL/RA/ATTACK、驻守数量；
 *  ④ 驻守行为在无敌人时回 anchor，有敌人时优先打 HEAL 单位；
 *  ⑤ 源码钉：CODEX AUDIT 注释和 main 调用点必须在。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "team_raL1.js"), "utf8");
const main = fs.readFileSync(path.join(root, "modules", "main.js"), "utf8");

function partBody(...parts) {
    return parts.map(type => ({type, boost: undefined}));
}

function load({ time = 100000, shard = "shard3" } = {}) {
    let missionSeq = 0;
    const ctx = {
        console: {log() {}},
        log() {},
        Logger: {log() {}, warning() {}},
        Creep: function () {},
        RoomPosition: function (x, y, roomName) {
            this.x = x; this.y = y; this.roomName = roomName;
        },
        ManagerCreeps: {
            calcBodyPart: spec => {
                const out = [];
                (Array.isArray(spec) ? spec : Object.keys(spec).map(k => [k, spec[k]]))
                    .forEach(([part, n]) => { for (let i = 0; i < n; i++) out.push(part); });
                return out;
            },
        },
        ManagerFlags: {getFlagsByPrefix() { return []; }},
        ManagerCrossShard: {
            calls: [],
            addCrossShardRequest(toShard, mission) {
                const id = "m" + (++missionSeq);
                this.calls.push({toShard, id, mission});
                ctx.Memory.missions[id] = mission;
                return id;
            },
        },
        StationLab: {
            boostAble() { return true; },
            generatorBoostResTask(boost, room) {
                return [{taskName: "boostCreepBodyPart", regFun: "registerBoostCreep", data: boost}];
            },
        },
        StationHive: {},
        UtilsTask: {
            taskData(taskName, regFun, ops = {}) {
                const t = {taskName, regFun};
                for (let k in ops) t[k] = ops[k];
                return t;
            },
            taskFlag(flag, taskName, regFun, ops = {}) {
                return this.taskData(taskName, regFun, {id: flag.name, ...ops});
            },
        },
        TOUGH: "tough", ATTACK: "attack", RANGED_ATTACK: "ranged_attack",
        HEAL: "heal", MOVE: "move", WORK: "work", CARRY: "carry", CLAIM: "claim",
        OK: 0, ERR_NOT_IN_RANGE: -9,
        RESOURCE_ENERGY: "energy",
        FIND_HOSTILE_CREEPS: 1,
        FIND_MY_STRUCTURES: 2,
        STRUCTURE_TOWER: "tower",
        BOOST_RES: {
            damage: ["G", "GHO2", "XGHO2"],
            rangedAttack: ["K", "KHO2", "XKHO2"],
            fatigue: ["Z", "ZHO2", "XZHO2"],
            heal: ["L", "LHO2", "XLHO2"],
        },
        Game: {time, shard: {name: shard}, creeps: {}, rooms: {}, flags: {}, map: {getRoomLinearDistance: () => 1}},
        Memory: {creeps: {}, missions: {}},
        global: null,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, {filename: "team_raL1.js"});
    return ctx;
}

function cfg(ctx, overrides = {}) {
    ctx.Memory.crossShardGarrisons = {
        W31N51: Object.assign({
            active: true,
            roomName: "W31N51",
            targetShard: "shard2",
            originShard: "shard3",
            spawnRoom: "W31N55",
            anchor: {x: 41, y: 35},
            slots: [[0, 0], [1, -1], [-1, 1], [0, 2], [2, 2], [-1, 0]],
            squad: 2,
            dispatchEnabled: true,
            path: {path: [{shard: "shard3", roomName: "W30N50", x: 30, y: 8}]},
        }, overrides),
    };
    ctx.Game.rooms.W31N55 = {name: "W31N55", my: true};
    return ctx.Memory.crossShardGarrisons.W31N51;
}

// ── ① 缺员时派一只：任务栈顺序/路径/boost/目标房必须正确 ─────────────────
{
    const ctx = load({time: 100000, shard: "shard3"});
    const c = cfg(ctx, {squad: 1});
    ctx.CrossShardGarrison.exec();
    assert.equal(ctx.ManagerCrossShard.calls.length, 1, "空编制应派一只");
    const call = ctx.ManagerCrossShard.calls[0];
    assert.equal(call.toShard, "shard3", "应在 origin shard 本地 spawn");
    const d = call.mission.data;
    assert.equal(d.spawnRoom, "W31N55");
    assert.equal(d.targetRoomName, "W31N51");
    assert.equal(d.garrisonRoom, "W31N51");
    assert.equal(d.body.length, 50, "T3 RA 一体机必须是 50 部件");
    assert.equal(d.tasks.map(t => t.taskName).join(","),
        "crossShardGarrison,moveCrossShardByPath,boostCreepBodyPart",
        "LIFO：boost 最后压栈、先执行；其次是虫洞；最后驻守");
    assert.deepEqual(d.tasks[1].path, c.path.path, "虫洞路径必须来自配置");
    assert.ok(d.tasks[2].data.XKHO2 >= 30 * 22, "RA 必须带满 XKHO2 T3 强化");
    assert.equal(c.lastDispatch.slot, 0, "第一只使用 0 号驻守位");

    // ── ② mission 还没孵化时不能重复派 ──────────────────────────────────
    ctx.CrossShardGarrison.exec();
    assert.equal(ctx.ManagerCrossShard.calls.length, 1, "编制已满（1 只在途）时不得重复派兵");

    // 跨过虫洞后 origin 的 Game.creeps 看不到它，只能靠台账；cycle 到期才换班。
    ctx.Memory.missions = {};
    ctx.Game.time += 1200;
    ctx.CrossShardGarrison.exec();
    assert.equal(ctx.ManagerCrossShard.calls.length, 2, "台账到期后必须补新一只（不能因跨 shard 失联而不补）");
    assert.equal(c.dispatches.length, 1, "旧台账过期，只保留新一批");
}

// ── ③ 目标 shard 的 audit：safe mode / 敌方部件 / 驻守数量 ────────────────
{
    const ctx = load({time: 100000, shard: "shard2"});
    const c = cfg(ctx);
    const hostileHealer = {
        name: "enemyHealer", hits: 4800, body: [{type: "heal", boost: "XLHO2"}],
        owner: {username: "enemy"},
        getActiveBodyparts(part) { return part === "heal" ? 30 : 0; },
    };
    const hostileRa = {
        name: "enemyRa", hits: 3200, body: [{type: "ranged_attack", boost: "XKHO2"}],
        owner: {username: "enemy"},
        getActiveBodyparts(part) { return part === "ranged_attack" ? 20 : 0; },
    };
    const room = {
        name: "W31N51",
        controller: {safeMode: 10598, safeModeAvailable: 3, safeModeCooldown: 40598},
        getHostileCreeps() { return [hostileHealer, hostileRa]; },
        find(type, opts) {
            if (type === ctx.FIND_MY_STRUCTURES) {
                return [{structureType: "tower", store: {energy: 840}}].filter(opts.filter);
            }
            return [];
        },
    };
    ctx.Game.rooms.W31N51 = room;
    ctx.Game.creeps = {
        g1: {name: "g1", ticksToLive: 1200, memory: {garrisonRoom: "W31N51"}},
    };
    ctx.CrossShardGarrison.exec();
    assert.equal(c.audit.safeMode, 10598, "audit 必须记录 safe mode 剩余");
    assert.equal(c.audit.safeModeAvailable, 3);
    assert.equal(c.audit.hostiles, 2);
    assert.equal(c.audit.hostileHeal, 30, "敌方 HEAL 部件必须可读");
    assert.equal(c.audit.hostileRangedAttack, 20);
    assert.equal(c.audit.hostileBoosted, 2);
    assert.equal(c.audit.hostileOwners.join(","), "enemy");
    assert.equal(c.audit.garrison, 1);
    assert.equal(c.audit.garrisonReady, 1);
    assert.equal(c.audit.towers.join(","), "840");
    const req = ctx.ManagerCrossShard.calls.find(x => x.mission.func === "setMemoryWithPath");
    assert.ok(req, "safe mode 期间必须把 origin 的 dispatchEnabled 关掉");
    assert.equal(req.toShard, "shard3");
    assert.equal(req.mission.data.data, false);
    assert.ok(req.mission.data.path.includes("dispatchEnabled"));
}

// ── ③b safe mode 剩余 ≤ leadTicks：通知 origin 开启派兵 ───────────────────
{
    const ctx = load({time: 100000, shard: "shard2"});
    const c = cfg(ctx, {leadTicks: 2500});
    const room = {
        name: "W31N51",
        controller: {safeMode: 1500, safeModeAvailable: 3, safeModeCooldown: 31500},
        getHostileCreeps() { return []; },
        find() { return []; },
    };
    ctx.Game.rooms.W31N51 = room;
    ctx.CrossShardGarrison.exec();
    const req = ctx.ManagerCrossShard.calls.find(x => x.mission.func === "setMemoryWithPath");
    assert.ok(req, "safe mode 快结束必须通知 origin");
    assert.equal(req.mission.data.data, true, "剩余 1500 ≤ lead 2500 ⇒ 开启");
}

// ── ③c 安全期 dispatchEnabled=false 时 origin 一只也不派 ─────────────────
{
    const ctx = load({time: 100000, shard: "shard3"});
    cfg(ctx, {dispatchEnabled: false});
    ctx.CrossShardGarrison.exec();
    assert.equal(ctx.ManagerCrossShard.calls.length, 0, "安全期不得派兵（用户 2026-11-27 要求）");
    assert.equal(ctx.Memory.crossShardGarrisons.W31N51.dispatchError, "waiting safe-mode window");
}

// ── ④ 驻守行为：无敌人回 anchor；有 HEAL 目标优先集火 ────────────────────
{
    const ctx = load({time: 100000, shard: "shard2"});
    const task = {
        taskName: "crossShardGarrison", roomName: "W31N51", garrisonRoom: "W31N51",
        x: 41, y: 35,
    };
    const calls = [];
    function makeCreep(hostiles) {
        return {
            name: "g1",
            room: {name: "W31N51", getHostileCreeps: () => hostiles},
            pos: {
                inRangeTo(pos) { return true; },
                isNearTo() { return false; },
                getRangeTo(target) { return target && target.name ? 2 : 5; },
                findClosestByRange(list) { return list[0]; },
            },
            hits: 5000, hitsMax: 5000,
            memory: {tasks: [task]},
            heal() { calls.push("heal"); },
            autoHeal() { calls.push("autoHeal"); },
            rangedAttack(t) { calls.push(["rangedAttack", t.name]); },
            rangedMassAttack() { calls.push("rangedMassAttack"); },
            moveTo(t) { calls.push(["moveTo", t && t.name || "anchor"]); },
            moveByPath() { calls.push("moveByPath"); },
        };
    }
    const empty = makeCreep([]);
    empty.pos.inRangeTo = () => false;
    ctx.Creep.prototype.crossShardGarrison.call(empty);
    assert.ok(calls.some(c => c[0] === "moveTo"), "无敌人且不在 anchor 时必须回防");

    calls.length = 0;
    function hostile(name, heal, hits) {
        return {
            name, hits,
            getActiveBodyparts(part) { return part === "heal" ? heal : 0; },
        };
    }
    const healer = hostile("healer", 30, 4000);
    const ra = hostile("ra", 0, 3000);
    const creep = makeCreep([ra, healer]);
    ctx.Creep.prototype.crossShardGarrison.call(creep);
    assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === "rangedAttack"),
        ["rangedAttack", "healer"], "必须优先集火 HEAL 单位");
}

// ── ⑤ 源码钉：Codex 审计注释、配置键、main 调用点 ─────────────────────────
{
    assert.ok(src.includes("CODEX AUDIT"), "必须留下 Codex 审计注释");
    assert.ok(src.includes("Memory.crossShardGarrisons"), "配置键必须写清楚");
    assert.ok(src.includes("crossShardGarrison") && src.includes("registerCrossShardGarrison"),
        "驻守任务与注册函数必须存在");
    assert.ok(main.includes("CrossShardGarrison.exec()"), "main 必须调用驻守调度器");
    assert.ok(main.includes('isCpuFeatureEnabled("crossShard")'), "驻守必须服从跨 shard 开关");
}

console.log("cross-shard garrison checks passed");