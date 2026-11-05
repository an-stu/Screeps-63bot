const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/超级移动优化hotfix 0.9.4.js"), "utf8");

/**
 * 「站在自己下一格上」的钉子（2026-11-05 W26N58 实测）
 *
 * 现场：hive 300/2300、38 个 extension 全空、storage 里躺着 88k 能量，
 * 房 6 个小时发不出一只爬。房内 4 只爬（载体 8152、外矿 8614/8544、
 * upgrader 39,7）全部原地不动，`lastPos.time` 都卡在 6：
 *
 *   8152(38,10) 下一格 37,9 ← 被 8614 占着
 *   8614(37,9)  下一格 38,8 ← 被 8544 占着
 *   8544(38,8)  下一格 38,8 ← **就是自己站的格子**
 *   upgrader(39,7) 下一格 38,8 ← 被 8544 占着
 *
 * 8544 是钉子：它对 `posArray[idx] == this.pos` 调
 * `getDirection(this.pos, this.pos)`，而 getDirection 对同一个点返回 undefined
 * ⇒ `originMove(undefined)` 每 tick 一条无效意图，永远不动，把后面一整队堵死。
 *
 * 本测试拷两处行为：
 *  1. `moveOneStep` 走到路径终点后不许再自增 idx（否则 directionArray[len]
 *     是 undefined，下一次就退化成「对自己取方向」）；
 *  2. `betterMoveTo` 的 `idx-1` 兜底分支里，如果自己就站在 posArray[idx-1] 上，
 *     必须作废缓存路去重新寻路，而不是 `originMove(undefined)`。
 * 两个负对照都是**把守卫摘掉**后同一份输入，实测退化回「无效移动」。
 */

function extract(name) {
    // 本仓库这个文件是 CRLF 行尾，正则必须容忍 \r
    const re = new RegExp("\\r?\\nfunction " + name + "\\([\\s\\S]*?\\r?\\n\\}\\r?\\n");
    const m = src.match(re);
    assert.ok(m, name + " 必须存在于模块里");
    return m[0];
}

const body = ["isEqual", "isNear", "inRange", "getDirection", "moveOneStep", "betterMoveTo"]
    .map(extract).join("\n");

// 改掉某段守卫，用来做负对照
function withoutGuard(fnBody, guardRe, repl) {
    const out = fnBody.replace(guardRe, repl === undefined ? "\n" : repl);
    assert.notEqual(out, fnBody, "负对照必须真的改掉了守卫");
    return out;
}

function load(fnBody) {
    const factory = new Function(fnBody + "\nreturn { moveOneStep, betterMoveTo };");
    return factory();
}

const OK = 0;
const ERR_TIRED = -11;
const ERR_NOT_FOUND = -6;
const ERR_INVALID_TARGET = -7;
const ERR_NO_PATH = -2;
const ERR_INVALID_ARGS = -10;
const ERR_BUSY = -4;
const ERR_NOT_OWNER = -1;
const TOP = 1, BOTTOM = 5, LEFT = 7, BOTTOM_LEFT = 6, MOVE = "move";

function resetGlobals() {
    Object.assign(globalThis, {
        OK, ERR_TIRED, ERR_NOT_FOUND, ERR_INVALID_TARGET, ERR_NO_PATH, ERR_INVALID_ARGS,
        ERR_BUSY, ERR_NOT_OWNER, TOP, BOTTOM, LEFT, BOTTOM_LEFT, MOVE,
        Game: { time: 1000, cpu: { getUsed: () => 0 }, rooms: {} },
        Creep: { prototype: {} },
        creepPathCache: {},
        creepMoveCache: {},
        costMatrixCache: {},
        enableCpuStats: false,
        autoClearTick: 0,
        testCacheHits: 0, testCacheMiss: 0, testNormal: 0, testBypass: 0,
        showVisual: () => { },
        clearUnused: () => { },
        deletePath: () => { },
        hasActiveBodypart: () => true,
        isObstacleStructure: () => false,
        findTemporalPath: () => false,
        startRoute: () => OK,
        findShortPathInCache: () => false,
        findPath: () => ({ path: [{ x: 30, y: 30, roomName: "W26N58" }], incomplete: false }),
        formalize: p => ({ x: p.x, y: p.y, roomName: p.roomName }),
        addPathIntoCache: () => { },
        generateDirectionArray: () => { },
        setPathTimer: () => { },
        trySwap: () => ERR_NOT_FOUND,
        originMove: () => OK,
    });
}

function makeCreep(pos, name) {
    return {
        name, my: true, spawning: false, fatigue: 0,
        body: [{ type: MOVE, hits: 100 }],
        memory: {}, room: { name: "W26N58" },
        pos: { x: pos[0], y: pos[1], roomName: "W26N58", isNearTo() { return false; } },
    };
}

function mkPath(points, dirs) {
    return {
        start: points[0], end: points[points.length - 1],
        posArray: points.map(p => ({ x: p[0], y: p[1], roomName: "W26N58" })),
        directionArray: dirs,
        ignoreStructures: false, ignoreRoads: false, ignoreSwamps: false,
    };
}

// ── 1. moveOneStep：走到终点不许再自增 idx ────────────────────────────────
{
    resetGlobals();
    const moves = [];
    globalThis.originMove = d => { moves.push(d); return OK; };
    const { moveOneStep } = load(body);

    const creep = makeCreep([38, 8], "pin");
    const cache = { path: mkPath([[38, 6], [39, 7], [38, 8]], [null, 4, 6]), idx: 2, dst: { x: 12, y: 3, roomName: "W26N58" } };
    globalThis.creepPathCache[creep.name] = cache;

    const code = moveOneStep(creep, undefined, { x: 12, y: 3, roomName: "W26N58" });
    assert.equal(code, OK, "站在终点时必须安静返回 OK");
    assert.deepEqual(moves, [], "站在终点时一条移动意图都不该发（发了就是钉死）");
    assert.equal(cache.idx, 2, "idx 不许越过终点");

    // 负对照：摘掉守卫（换成空行，注意不能把注释和下一句合并）⇒ idx 越过终点、
    // 发出 undefined 方向的无效意图
    const naive = withoutGuard(body, /\r?\n {4}if \(creepCache\.idx >= creepCache\.path\.posArray\.length - 1\) \{\r?\n {8}return OK;\r?\n {4}\}\r?\n/);
    resetGlobals();
    const badMoves = [];
    globalThis.originMove = d => { badMoves.push(d); return OK; };
    const { moveOneStep: naiveStep } = load(naive);
    const creep2 = makeCreep([38, 8], "pin2");
    const cache2 = { path: mkPath([[38, 6], [39, 7], [38, 8]], [null, 4, 6]), idx: 2, dst: { x: 12, y: 3, roomName: "W26N58" } };
    globalThis.creepPathCache[creep2.name] = cache2;
    naiveStep(creep2, undefined, { x: 12, y: 3, roomName: "W26N58" });
    assert.equal(cache2.idx, 3, "负对照：没有守卫时 idx 会越过终点");
    assert.deepEqual(badMoves, [undefined], "负对照：没有守卫时发出的是 undefined 方向");
}

// ── 2. betterMoveTo：站在 posArray[idx-1] 上时必须作废缓存路 ──────────────
{
    resetGlobals();
    const deleted = [];
    const moves = [];
    globalThis.deletePath = p => { deleted.push(p); };
    globalThis.originMove = d => { moves.push(d); return OK; };
    const { betterMoveTo } = load(body);

    const creep = makeCreep([39, 7], "selfroot");
    // 走到中途缓存被别人改写：idx 指向 2 格外的点，而自己正站在 idx-1 上
    const p = mkPath([[38, 6], [39, 7], [30, 30]], [null, 4, 6]);
    globalThis.creepPathCache[creep.name] = { path: p, idx: 2, dst: { x: 12, y: 3, roomName: "W26N58" } };

    betterMoveTo.call(creep, { x: 12, y: 3, roomName: "W26N58" }, {});
    assert.equal(deleted.length, 1, "必须作废这条缓存路（否则每 tick 对自己取方向）");
    assert.deepEqual(moves, [], "不许发出 undefined 方向的移动意图");

    // 负对照：把守卫条件改成恒假（回到「永远走 idx-1 分支」的旧行为）
    // ⇒ originMove(undefined)，缓存也不会被作废
    const naive = withoutGuard(body,
        /if \(isEqual\(this\.pos, posArray\[idx - 1\]\)\) \{/, "if (false) {");
    resetGlobals();
    const badMoves = [];
    const badDeleted = [];
    globalThis.deletePath = x => { badDeleted.push(x); };
    globalThis.originMove = d => { badMoves.push(d); return OK; };
    const { betterMoveTo: naiveMove } = load(naive);
    const creep2 = makeCreep([39, 7], "selfroot2");
    globalThis.creepPathCache[creep2.name] = {
        path: mkPath([[38, 6], [39, 7], [30, 30]], [null, 4, 6]), idx: 2,
        dst: { x: 12, y: 3, roomName: "W26N58" },
    };
    naiveMove.call(creep2, { x: 12, y: 3, roomName: "W26N58" }, {});
    assert.deepEqual(badMoves, [undefined], "负对照：没有守卫时对自己取方向 = undefined");
    assert.equal(badDeleted.length, 0, "负对照：没有守卫时缓存不会被作废");
}

// ── 3. moveTo 包装层：连续 6 tick 没挪窝要作废本爬的缓存路 ─────────────────
{
    const wrapperSrc = src.match(/\r?\n {4}Creep\.prototype\.moveTo = function \(arg0, arg1, arg2\) \{[\s\S]*?\r?\n {4}\};\r?\n/);
    assert.ok(wrapperSrc, "moveTo 包装层必须存在");
    resetGlobals();
    globalThis.innerMoveTo = () => OK;
    const fnSrc = wrapperSrc[0]
        .replace("Creep.prototype.moveTo = ", "")
        .replace("this.$moveTo(arg0, arg1, arg2)", "innerMoveTo()")
        .trim()
        .replace(/;$/, "");
    const wrap = new Function("creepPathCache", "return " + fnSrc + ";").call(null, globalThis.creepPathCache);

    const creep = makeCreep([38, 8], "watchdog");
    const p = mkPath([[38, 6], [39, 7], [38, 8]], [null, 4, 6]);
    creep.memory.lastPos = { x: 38, y: 8, roomName: "W26N58", time: 5 };
    creep.memory.tasks = [];
    const refresh = () => { globalThis.creepPathCache[creep.name] = { path: p, idx: 2, dst: {} }; };

    // 第一个 tick：time 5 → 6，还没到作废点
    refresh();
    wrap.call(creep);
    assert.equal(creep.memory.lastPos.time, 6, "第 1 tick 只把停滞计数推到 6");
    assert.equal(globalThis.creepPathCache[creep.name].path, p, "还没到 6 tick 不该动缓存");

    // 第二个 tick：已经 6 tick 没挪 ⇒ 作废本爬缓存路
    refresh();
    wrap.call(creep);
    assert.equal(globalThis.creepPathCache[creep.name].path, undefined, "卡满 6 tick 必须作废缓存路重寻路");

    // 反向：真的挪了窝 ⇒ 计数归零、缓存不动
    refresh();
    creep.pos.x = 37;
    wrap.call(creep);
    assert.equal(creep.memory.lastPos.time, 0, "走动过就把停滞计数清零");
    assert.equal(globalThis.creepPathCache[creep.name].path, p, "正常移动不许动缓存");
}
