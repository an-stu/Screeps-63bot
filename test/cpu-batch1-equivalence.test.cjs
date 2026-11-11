/**
 * CPU 优化第一批「可证等价项」回归（qoder.md v2 第一批，2026-11-11）。
 *
 * 覆盖 6 处改动，全部要求：旧实现/新实现同输入行为一致 + 扫描/调用计数下降。
 * 每个源码锁定都是负对照：把对应改动改回去，本文件必须 fail。
 *
 *   1a utils head/last 原生化 + 任务栈访问器直接下标
 *   4  PC needPower 合一（保留停车抢占顺序）+ 敌情 tick 缓存复用
 *   8a registerStationSources / registerStationSourcesDefenseOutRoom headTask 合一
 *   13 建筑缓存复用 room.getStructures()
 *   14a 非边界跳过边界扫描（保留 core-profile 锁定字面量）
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, "modules", f), "utf8");

// 旧实现参照在 VM 里跑，但 fixture 数组来自宿主 realm：
// 宿主的 Array.prototype 也必须有 head/last（lodash 语义），否则 .last is not a function。
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}
if (!Array.prototype.last) {
    Object.defineProperty(Array.prototype, "last", {
        value: function () { return this.length ? this[this.length - 1] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

const utilsSrc = read("utils.js");
const creepSrc = read("prototype_creep.js");
const sourcesSrc = read("station_sources.js");
const pcStrategySrc = read("strategy_factoryPowerCreep.js");
const pcProtoSrc = read("prototype_powerCreep.js");
const cacheSrc = read("极致建筑缓存 v1.4.3.js");

function extract(src, name, proto) {
    const re = new RegExp(proto + "\\.prototype\\." + name + " = function \\([^)]*\\) \\{[\\s\\S]*?\\n\\};");
    const m = src.match(re);
    assert.ok(m, "必须能提取 " + proto + ".prototype." + name + "（源码结构变了？）");
    return m[0];
}

// ── 1a-1 utils head/last：新实现 vs lodash 语义参照 ─────────────────────────
{
    assert.ok(utilsSrc.includes("Array.prototype.head= function(){return this[0]};"),
        "head 必须是直接下标（负对照：改回 _.head 即 fail）");
    assert.ok(utilsSrc.includes("Array.prototype.last= function(){return this[this.length-1]};"),
        "last 必须是直接下标（负对照：改回 _.last 即 fail）");
    assert.ok(!utilsSrc.includes("_.head(this)") && !utilsSrc.includes("_.last(this)"),
        "head/last 不得再走 lodash");
    // find/sum/contains 覆盖本批明确不动
    assert.ok(utilsSrc.includes("Array.prototype.find= function(...e){return _.find(this,...e)};"),
        "find 覆盖本批不动（动态谓词/thisArg/稀疏审计未完成）");

    const newHead = utilsSrc.match(/Array\.prototype\.head= function\(\)\{[^}]*\};/)[0];
    const newLast = utilsSrc.match(/Array\.prototype\.last= function\(\)\{[^}]*\};/)[0];
    const ctx = {
        _: {
            head: (a) => (a && a.length ? a[0] : undefined),
            last: (a) => (a && a.length ? a[a.length - 1] : undefined),
        },
    };
    vm.runInNewContext(
        "var oldHead = function(){return _.head(this)}; var oldLast = function(){return _.last(this)};" +
        newHead.replace("Array.prototype.head", "var newHead") +
        newLast.replace("Array.prototype.last", "var newLast"), ctx);
    const sparse = new Array(3); sparse[2] = "tail";
    const battery = [[], [7], [1, 2, 3], [undefined], [null, 2], sparse, [undefined, undefined]];
    for (const arr of battery) {
        assert.deepEqual(ctx.newHead.call(arr), ctx.oldHead.call(arr), "head 语义必须与 lodash 一致: " + JSON.stringify(arr));
        assert.deepEqual(ctx.newLast.call(arr), ctx.oldLast.call(arr), "last 语义必须与 lodash 一致: " + JSON.stringify(arr));
    }
}

// ── 1a-2 任务栈访问器：新实现 vs 旧 lodash 实现，同输入逐例对照 ──────────────
{
    const names = ["lastTask", "headTask", "lastTaskObj", "headTaskObj", "headTaskFlag", "sayHeadTask", "sayLastTask"];
    const bodies = {};
    for (const n of names) {
        bodies[n] = extract(creepSrc, n, "Creep");
        assert.ok(!/\.tasks\.(head|last)\(\)/.test(bodies[n]),
            n + " 不得再走数组 head/last 包装（负对照：改回即 fail）");
    }
    assert.ok(bodies.lastTask.includes("tasks[tasks.length - 1]"), "lastTask 必须直接下标");
    assert.ok(bodies.headTask.includes("this.memory.tasks[0]"), "headTask 必须直接下标");

    const t1 = { id: "o1", taskName: "A", flagName: "F1" };
    const t2 = { id: "o2", taskName: "B" };
    const t3 = { id: "missing", taskName: "C", flagName: "F2" };
    const sparse = new Array(2); sparse[1] = t2;
    const battery = [[], [t1], [t1, t2, t3], [null], [undefined, t2], sparse, [t1, null]];

    const oldCode = `
Creep.prototype.lastTask = function () { return this.memory.tasks.last() };
Creep.prototype.headTask = function () { return this.memory.tasks.head() };
Creep.prototype.lastTaskObj = function () { let last = this.memory.tasks.last(); if (last) return Game.getObjectById(last.id) };
Creep.prototype.headTaskObj = function () { let head = this.memory.tasks.head(); if (head) return Game.getObjectById(head.id) };
Creep.prototype.headTaskFlag = function () { let head = this.memory.tasks.head(); if (head) return Game.flags[head.id] || Game.flags[head.flagName]; };
Creep.prototype.sayHeadTask = function () { let head = this.memory.tasks.head(); if (head) HelperVisual.showText(this, head.taskName) };
Creep.prototype.sayLastTask = function () { let head = this.memory.tasks.last(); if (head) HelperVisual.showText(this, head.taskName) };
`;
    function load(code) {
        const objects = { o1: { tag: "obj1" }, o2: { tag: "obj2" } };
        const flags = { F2: { tag: "flag2" } };
        const said = [];
        const ctx = {
            Creep: function () {},
            Game: { getObjectById: (id) => objects[id] || null, flags },
            HelperVisual: { showText: (c, text) => said.push(text) },
        };
        vm.runInNewContext(
            "Array.prototype.head = function(){return this.length ? this[0] : undefined};" +
            "Array.prototype.last = function(){return this.length ? this[this.length-1] : undefined};" + code, ctx);
        return { ctx, said };
    }
    const oldEnv = load(oldCode);
    const newEnv = load(names.map((n) => bodies[n]).join("\n"));
    for (const tasks of battery) {
        for (const n of names) {
            const cOld = new oldEnv.ctx.Creep(); cOld.memory = { tasks };
            const cNew = new newEnv.ctx.Creep(); cNew.memory = { tasks };
            assert.deepEqual(newEnv.ctx.Creep.prototype[n].call(cNew), oldEnv.ctx.Creep.prototype[n].call(cOld),
                n + " 行为必须与旧实现一致: " + JSON.stringify(tasks));
        }
    }
    // flag 回退路径：id 查不到 → 用 flagName
    const c = new newEnv.ctx.Creep(); c.memory = { tasks: [t3] };
    assert.equal(newEnv.ctx.Creep.prototype.headTaskFlag.call(c).tag, "flag2", "headTaskFlag 必须保留 flagName 回退");
}

// ── 8a 两个注册函数 headTask 合一 ────────────────────────────────────────────
{
    for (const fn of ["registerStationSources", "registerStationSourcesDefenseOutRoom"]) {
        const body = extract(sourcesSrc, fn, "Creep");
        assert.ok(body.includes("let head = this.headTask();"), fn + " 必须把 headTask 合为局部变量（负对照：改回即 fail）");
        assert.ok(!body.includes("this.headTask().id") && !body.includes("this.headTask().roomName"),
            fn + " 不得重复调用 headTask");
    }
    // 行为对照：注册/清理死爬/孵化时间戳，新旧一致
    const oldBody = extract(sourcesSrc, "registerStationSources", "Creep")
        .replace("let head = this.headTask();\n    let rm = Memory.rooms[head.roomName];", "let rm = Memory.rooms[this.headTask().roomName];")
        .replace(/rm\[pro\.stationName\]\[head\.id\]/g, "rm[pro.stationName][this.headTask().id]");
    function loadReg(code) {
        const station = { s1: { creeps: ["dead", "live"], spawnTime: 0 } };
        const ctx = {
            Creep: function () {},
            pro: { stationName: "stationSources" },
            Memory: { rooms: { W1N1: { stationSources: station } } },
            Game: { time: 500, getObjectById: (id) => (id == "live" ? {} : null) },
        };
        vm.runInNewContext(code, ctx);
        return { ctx, station };
    }
    const newReg = loadReg(extract(sourcesSrc, "registerStationSources", "Creep"));
    const oldReg = loadReg(oldBody);
    for (const env of [newReg, oldReg]) {
        const c = new env.ctx.Creep();
        c.id = "me"; c.spawning = true;
        c.headTask = () => ({ id: "s1", roomName: "W1N1" });
        env.ctx.Creep.prototype.registerStationSources.call(c);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(newReg.station.s1)), JSON.parse(JSON.stringify(oldReg.station.s1)),
        "注册结果（清死爬+补自己+spawnTime）必须一致");
    assert.deepEqual([...newReg.station.s1.creeps], ["live", "me"]);
    assert.equal(newReg.station.s1.spawnTime, 500);
    // 空栈时 throw 语义保持（headTask() undefined → 读 roomName 抛错）
    const c2 = new newReg.ctx.Creep(); c2.headTask = () => undefined;
    assert.throws(() => newReg.ctx.Creep.prototype.registerStationSources.call(c2),
        (err) => err.name == "TypeError",
        "空栈必须与旧实现一样抛 TypeError，而不是静默跳过");
}

// ── 14a 非边界跳过边界扫描（保留锁定字面量）─────────────────────────────────
{
    assert.ok(sourcesSrc.includes("this.pos.isBorder() && borderIndex.dist == 0"),
        "core-profile 锁定字面量必须原样保留");
    assert.ok(sourcesSrc.includes("let borderIndex = this.pos.isBorder() ? pro.nextRoadPathIndex(roadPath, this.pos) : undefined;"),
        "边界扫描必须前置 isBorder 判断（负对照：改回无条件扫描即 fail）");
    const m = sourcesSrc.match(/let borderIndex = this\.pos\.isBorder\(\)[\s\S]*?if \(borderCode != ERR_NO_PATH\) return;\s*\}/);
    assert.ok(m, "必须能提取边界推进块");
    const ERR_NO_PATH = -2;
    function run(pos, { index = 2, dist = 0, stepCode = 0, pathLen = 5, dir = 1, startIndex = 99 } = {}) {
        const calls = { scan: 0, step: 0 };
        const pro = {
            nextRoadPathIndex: () => { calls.scan++; return { index, dist }; },
            stepFromOuterRoadPoint: () => { calls.step++; return stepCode; },
        };
        const fn = vm.runInNewContext(
            "(function(roadPath, task, roadDir) { " + m[0] + " return 'fell-through'; })",
            { pro, ERR_NO_PATH });
        const task = { pathIndex: startIndex };
        const roadPath = new Array(pathLen).fill({});
        const result = fn.call({ pos }, roadPath, task, dir);
        return { calls, task, result };
    }
    const border = (x) => ({ isBorder: () => true, _x: x });
    const inner = { isBorder: () => false };
    // 非边界：绝不扫描（旧实现这里会白扫一次全路径）
    let r = run(inner, { dist: 0 });
    assert.equal(r.calls.scan, 0, "非边界格不得调用 nextRoadPathIndex（负对照核心）");
    assert.equal(r.result, "fell-through");
    assert.equal(r.task.pathIndex, 99, "非边界不得改 pathIndex");
    // 边界 + dist==0：推进到下一缓存路点并立即迈步
    r = run(border(), { index: 2, dist: 0, dir: 1 });
    assert.equal(r.calls.scan, 1); assert.equal(r.calls.step, 1);
    assert.equal(r.task.pathIndex, 3); assert.equal(r.result, undefined);
    // 反向
    r = run(border(), { index: 2, dist: 0, dir: -1 });
    assert.equal(r.task.pathIndex, 1);
    // 边界末端：nextIndex 越界 → 不改 pathIndex，但仍迈步
    r = run(border(), { index: 4, dist: 0, dir: 1, pathLen: 5 });
    assert.equal(r.task.pathIndex, 99); assert.equal(r.calls.step, 1);
    // 边界但 dist>0：扫描一次、不进分支
    r = run(border(), { dist: 2 });
    assert.equal(r.calls.scan, 1); assert.equal(r.calls.step, 0); assert.equal(r.result, "fell-through");
    // ERR_NO_PATH：不提前 return，继续后续逻辑
    r = run(border(), { stepCode: ERR_NO_PATH });
    assert.equal(r.result, "fell-through");
}

// ── 4 PC needPower 合一 + 敌情缓存（VM 跑真实 execRoom）─────────────────────
{
    assert.equal((pcStrategySrc.match(/StationFactory\.needPower\(mainRoom\)/g) || []).length, 1,
        "needPower 每 pass 只允许求值一次（负对照：改回双调即 fail）");
    assert.ok(pcStrategySrc.includes("let factoryNeedsPower = !!(global.StationFactory && mainRoom.factory"),
        "必须预计算 factoryNeedsPower");
    assert.ok(pcStrategySrc.includes("if (factoryNeedsPower) {") && pcStrategySrc.includes("else if (factoryNeedsPower) pc.addTask"),
        "停车抢占与 isFree 链必须复用同一结果");
    assert.ok(pcStrategySrc.indexOf("if (factoryNeedsPower) {") < pcStrategySrc.indexOf("if (pc.isFree())"),
        "停车抢占顺序必须保持在 isFree 链之前");
    assert.ok(pcStrategySrc.includes("pc.room.getHostileCreeps().length"), "敌情必须走房间 tick 缓存");
    assert.ok(!pcStrategySrc.includes("pc.room.find(FIND_HOSTILE_CREEPS)"), "不得再裸 find 敌对爬");

    const PWR_OPERATE_FACTORY = 18;
    function loadStrategy({ needPowerResult, factoryPresent = true }) {
        const calls = { needPower: 0, hostileCache: 0, hostileFind: 0, pop: 0, added: [] };
        const mainRoom = {
            name: "E53S21",
            factory: factoryPresent ? { id: "fac" } : undefined,
            storage: { id: "sto" }, terminal: null, powerSpawn: { id: "ps" },
        };
        const stack = [];
        const pc = {
            memory: {}, ticksToLive: 100, spawning: false,
            powers: { [PWR_OPERATE_FACTORY]: { level: 1, cooldown: 0 } },
            needGenerateOps: () => false,
            mainRoom: () => mainRoom,
            headTask: () => stack[0],
            popTask() { calls.pop++; stack.shift(); return this; },
            isFree: () => stack.length == 0,
            addTask(t) { calls.added.push(t); stack.push(t); return this; },
            needRenewInRoom: () => false, needGetOps: () => false, needOpExt: () => false,
            needOpStorage: () => false, needOpSource: () => false, needOpSpawn: () => false,
            needOpTower: () => false, needOpPowerSpawn: () => false, needOpMineral: () => false,
            needSaveOps: () => false,
            room: {
                getHostileCreeps: () => { calls.hostileCache++; return pc._hostiles || []; },
                find: (t) => { calls.hostileFind++; return []; },
            },
            _hostiles: [],
        };
        const flag = {
            name: "OPF1", memory: {}, pos: { roomName: "E53S21" },
            room: { my: true, powerSpawn: { id: "ps" } },
            getNameSplit: () => ["OPF", "1"],
        };
        const ctx = {
            console,
            Game: { time: 1001, powerCreeps: { 1: pc } },
            UtilsTask: { task: (obj, taskName) => ({ obj, taskName }) },
            StationFactory: { needPower: () => { calls.needPower++; return needPowerResult; } },
            PWR_OPERATE_FACTORY,
            ManagerFlags: { getFlagsByPrefix: () => [] },
            HelperError: { catchError: (f) => f() },
        };
        ctx.global = ctx;
        vm.runInNewContext(pcStrategySrc, ctx, { filename: "strategy_factoryPowerCreep.js" });
        return { ctx, calls, stack, pc, flag, mainRoom };
    }
    // A. 需要电 + 停在停车任务上 → 抢占：弹停车、派 OpFactory，needPower 只求值一次
    {
        const env = loadStrategy({ needPowerResult: true });
        env.stack.push({ taskName: "goToNearPop" });
        env.ctx.StrategyFactoryPowerCreep.execRoom(env.flag);
        assert.equal(env.calls.needPower, 1, "needPower 只允许一次");
        assert.equal(env.calls.pop, 1, "停车抢占必须保留");
        assert.deepEqual(env.calls.added.map((t) => t.taskName), ["OpFactory"]);
    }
    // B. 需要电 + 空闲 → isFree 链派 OpFactory（旧实现这里 needPower 会求值两次）
    {
        const env = loadStrategy({ needPowerResult: true });
        env.ctx.StrategyFactoryPowerCreep.execRoom(env.flag);
        assert.equal(env.calls.needPower, 1, "合并后 needPower 只求值一次（负对照核心）");
        assert.deepEqual(env.calls.added.map((t) => t.taskName), ["OpFactory"]);
    }
    // C. 不需要电 → 不派 OpFactory；敌情走缓存；needPower 仍只求值一次
    {
        const env = loadStrategy({ needPowerResult: false });
        env.ctx.StrategyFactoryPowerCreep.execRoom(env.flag);
        assert.equal(env.calls.needPower, 1);
        assert.equal(env.calls.added.length, 0);
        assert.equal(env.calls.hostileCache, 1, "敌情必须读 getHostileCreeps");
        assert.equal(env.calls.hostileFind, 0, "不得裸 find");
    }
    // D. 有敌情 → 回停车点待命（行为不变）
    {
        const env = loadStrategy({ needPowerResult: false });
        env.pc._hostiles = [{ id: "h" }];
        env.ctx.StrategyFactoryPowerCreep.execRoom(env.flag);
        assert.deepEqual(env.calls.added.map((t) => t.taskName), ["goToNearPop"]);
        assert.equal(env.calls.added[0].obj.id, "sto");
    }
    // E. 没有 StationFactory / 没有 factory → needPower 绝不求值，不崩
    {
        const env = loadStrategy({ needPowerResult: true, factoryPresent: false });
        env.ctx.StrategyFactoryPowerCreep.execRoom(env.flag);
        assert.equal(env.calls.needPower, 0, "短路顺序必须保留");
        assert.equal(env.calls.added.length, 0);
    }
    // F. 抢占后仍不空闲（栈里还有别的任务）→ 不派活、不 return 进链（顺序语义）
    {
        const env = loadStrategy({ needPowerResult: true });
        env.stack.push({ taskName: "goToNearPop" }, { taskName: "other" });
        env.ctx.StrategyFactoryPowerCreep.execRoom(env.flag);
        assert.equal(env.calls.pop, 1);
        assert.equal(env.calls.added.length, 0, "弹掉停车后仍有任务 → 不得加派");
        assert.deepEqual(env.stack.map((t) => t.taskName), ["other"]);
    }
}

// ── 4b needOpTower 敌情缓存（提取真实函数体跑 VM）───────────────────────────
{
    const body = extract(pcProtoSrc, "needOpTower", "PowerCreep");
    assert.ok(body.includes("room.getHostileCreeps()"), "needOpTower 必须复用敌情 tick 缓存（负对照：改回裸 find 即 fail）");
    assert.ok(body.includes("room.find(FIND_HOSTILE_POWER_CREEPS)"), "敌对 PowerCreep 必须仍单独查询");
    assert.ok(!body.includes("room.find(FIND_HOSTILE_CREEPS)"), "不得裸 find 敌对爬");
    const PWR_OPERATE_TOWER = 3;
    function run({ hostiles, hostilePCs, towerEnergy = 500 }) {
        const calls = { cache: 0, findPC: 0, findOther: 0 };
        const tower = { energy: towerEnergy, effects: [] };
        const room = {
            my: true, tower: [tower],
            getHostileCreeps: () => { calls.cache++; return hostiles; },
            find: (t) => {
                if (t == "hostilePC") { calls.findPC++; return hostilePCs; }
                calls.findOther++; return [];
            },
        };
        const ctx = {
            PowerCreep: function () {},
            PWR_OPERATE_TOWER, RESOURCE_OPS: "ops", FIND_HOSTILE_POWER_CREEPS: "hostilePC",
        };
        vm.runInNewContext(body, ctx);
        const pc = { powers: { [PWR_OPERATE_TOWER]: { cooldown: 0 } }, store: { ops: 500 }, mainRoom: () => room };
        const result = ctx.PowerCreep.prototype.needOpTower.call(pc);
        return { result, calls, tower };
    }
    let r = run({ hostiles: [{ id: "h" }], hostilePCs: [] });
    assert.equal(r.result, r.tower, "有敌对爬 → 返回塔");
    assert.equal(r.calls.cache, 1); assert.equal(r.calls.findPC, 0, "有敌对爬时短路，不查敌对 PC");
    assert.equal(r.calls.findOther, 0);
    r = run({ hostiles: [], hostilePCs: [{ id: "p" }] });
    assert.equal(r.result, r.tower, "只有敌对 PC → 仍返回塔");
    assert.equal(r.calls.findPC, 1);
    r = run({ hostiles: [], hostilePCs: [] });
    assert.equal(r.result, false, "无敌情 → false");
    r = run({ hostiles: [{ id: "h" }], hostilePCs: [], towerEnergy: 5 });
    assert.equal(r.result, false, "塔能量不足 → false（行为不变）");
}

// ── 13 建筑缓存复用 getStructures（VM 加载整模块）───────────────────────────
{
    assert.ok(cacheSrc.includes("room.getStructures().forEach"), "resolved map 必须复用 getStructures（负对照：改回 find 即 fail）");
    assert.ok(cacheSrc.includes("_.groupBy(room.getStructures()"), "Hub 必须复用 getStructures");
    assert.ok(!cacheSrc.includes("room.find(FIND_STRUCTURES)"), "不得再自行 find(FIND_STRUCTURES)");

    const C = {
        STRUCTURE_SPAWN: "spawn", STRUCTURE_EXTENSION: "extension", STRUCTURE_ROAD: "road",
        STRUCTURE_WALL: "constructedWall", STRUCTURE_RAMPART: "rampart", STRUCTURE_KEEPER_LAIR: "keeperLair",
        STRUCTURE_PORTAL: "portal", STRUCTURE_LINK: "link", STRUCTURE_TOWER: "tower", STRUCTURE_LAB: "lab",
        STRUCTURE_CONTAINER: "container", STRUCTURE_POWER_BANK: "powerBank", STRUCTURE_OBSERVER: "observer",
        STRUCTURE_POWER_SPAWN: "powerSpawn", STRUCTURE_EXTRACTOR: "extractor", STRUCTURE_NUKER: "nuker",
        STRUCTURE_FACTORY: "factory", STRUCTURE_INVADER_CORE: "invaderCore",
        LOOK_MINERALS: "mineral", LOOK_SOURCES: "source", LOOK_DEPOSITS: "deposit",
        LOOK_CONSTRUCTION_SITES: "constructionSite",
        FIND_STRUCTURES: 107, FIND_MINERALS: 116, RESOURCES_ALL: ["energy"],
    };
    function loadCache() {
        const objects = {};
        const ctx = Object.assign({
            Room: function () {},
            Game: { time: 10, getObjectById: (id) => objects[id] || null },
            _: {
                groupBy: (arr, f) => {
                    const out = {};
                    for (const item of arr) { const k = f(item); (out[k] = out[k] || []).push(item); }
                    return out;
                },
            },
            console,
        }, C);
        vm.runInNewContext(cacheSrc, ctx, { filename: "极致建筑缓存.js" });
        return { ctx, objects };
    }
    function makeRoom(env, name, structures) {
        const room = Object.create(env.ctx.Room.prototype);
        room.name = name;
        const calls = { getStructures: 0, findStructures: 0 };
        room.getStructures = () => { calls.getStructures++; return structures; };
        room.find = (type) => {
            if (type == C.FIND_STRUCTURES) { calls.findStructures++; throw new Error("不得自行 find(FIND_STRUCTURES)"); }
            return [];
        };
        room.lookForAtArea = () => [];
        for (const s of structures) env.objects[s.id] = s;
        return { room, calls };
    }
    const env = loadCache();
    const cont = { id: "c".repeat(24), structureType: "container", store: { energy: 100 } };
    const road = { id: "r".repeat(24), structureType: "road", store: { energy: 0 } };
    const storage = { id: "s".repeat(24), structureType: "storage", store: { energy: 9000 } };
    const { room, calls } = makeRoom(env, "W1N1", [cont, road, storage]);
    room.storage = storage;

    const containers = room[C.STRUCTURE_CONTAINER];
    assert.deepEqual([...containers], [cont], "container getter 必须解析出对象");
    assert.equal(calls.findStructures, 0, "全程不得自行 find(FIND_STRUCTURES)（负对照核心）");
    assert.ok(calls.getStructures >= 1, "必须经由 getStructures");
    const gsAfterFirst = calls.getStructures;
    const roads = room[C.STRUCTURE_ROAD];
    assert.deepEqual([...roads], [road]);
    assert.equal(calls.getStructures, gsAfterFirst, "同 tick 第二个 getter 必须命中 resolved 缓存");
    const mass = room.mass_stores;
    assert.ok(mass.includes(storage) && mass.includes(cont), "mass_stores 必须含 storage+container");
    assert.equal(room.energy, 9100, "资源合计口径不变");
    // 下一 tick：Room 对象重建 → 重新取数
    env.ctx.Game.time = 11;
    const room2 = makeRoom(env, "W1N1", [cont, road, storage]);
    room2.room.storage = storage;
    assert.deepEqual([...room2.room[C.STRUCTURE_CONTAINER]], [cont]);
    assert.ok(room2.calls.getStructures >= 1, "新 tick 必须重建");
    assert.equal(room2.calls.findStructures, 0);
}

console.log("cpu batch1 equivalence checks passed");