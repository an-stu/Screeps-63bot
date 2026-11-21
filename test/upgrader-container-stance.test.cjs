/**
 * 只剩一只 upgrader 时，必须尽可能**站在升级容器那一格上**（用户 2026-11-21）。
 *
 * 现场：单人时原来按「同时够到 link 与容器」的评分挑格，挑出来的常常是容器**旁边**
 * —— 于是每趟取能量都要挪一格，`withdraw` 还经常差一格白跑。单人没有站位争抢，
 * 直接站容器上：withdraw 距离 0、link 相邻也能取，取完不用动。
 *
 * 四个约束（都要验）：
 *   ① 单人 + 容器在控制器 3 格内 → 返回容器格，并写进 memory.upgradePosition
 *   ② 两人 → 不抢容器格（走原来的选点，容器格被别人预占时尤其不能抢）
 *   ③ 容器离控制器 > 3 格 → 站上去就升不了级，必须退回原选点
 *   ④ 没有容器（只有 link）→ 退回原选点
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "modules", "station_upgrade.js"), "utf8");

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

class RoomPosition {
    constructor(x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; }
    getRangeTo(o) { return Math.max(Math.abs(this.x - o.x), Math.abs(this.y - o.y)); }
    inRangeTo(o, r) { return this.getRangeTo(o) <= r; }
    lookFor() { return []; }
}

function makeSandbox({ upgraders, reservations = {} }) {
    const controller = { id: "ctrl", pos: new RoomPosition(10, 10, "W1N1") };
    const ctx = {
        RoomPosition, STRUCTURE_CONTAINER: "container", STRUCTURE_ROAD: "road",
        LOOK_STRUCTURES: "structures", console: { log() {} },
        getUpgradeReservations: () => Object.assign({}, reservations),
        isWalkableUpgradePosition: () => true,
        textHash: () => 0,
        pro: {},
    };
    ctx.global = ctx;
    const method = extractMethod(src, "getUpgradePosition(creep, controller, supplyTargets = []) {");
    // 源码里是方法简写 `name(args) {`，转成可赋值的函数表达式
    const fnText = "pro.getUpgradePosition = function " + method.slice(method.indexOf("("));
    vm.runInNewContext(fnText, ctx);
    const room = {
        name: "W1N1",
        creeps: () => upgraders.map(() => ({ spawning: false })),
    };
    const creep = {
        name: "u1",
        memory: {},
        room,
        pos: new RoomPosition(10, 8, "W1N1"),
    };
    return { ctx, pro: ctx.pro, creep, controller, room };
}

const containerAt = (x, y) => ({ structureType: "container", pos: new RoomPosition(x, y, "W1N1") });
const linkAt = (x, y) => ({ structureType: "link", pos: new RoomPosition(x, y, "W1N1") });

// ① 单人 + 容器在控制器范围内 → 站容器
{
    const { pro, creep, controller } = makeSandbox({ upgraders: [1] });
    const container = containerAt(9, 10);            // 距控制器 1 格
    const p = pro.getUpgradePosition(creep, controller, [linkAt(8, 10), container]);
    assert.equal(p, container.pos, "单人必须直接返回容器格");
    // VM 里创建的对象原型不同，deepEqual(strict) 会判不等 —— 摊平成普通对象再比
    assert.deepEqual({ ...creep.memory.upgradePosition }, { x: 9, y: 10, controllerId: "ctrl" },
        "容器格要写进 memory.upgradePosition（下 tick 不用重算）");
}

// ② 两人 → 允许容器格被同伴预占，绝不抢
{
    const { pro, creep, controller } = makeSandbox({
        upgraders: [1, 2], reservations: { "9:10": "other" },
    });
    const container = containerAt(9, 10);
    const p = pro.getUpgradePosition(creep, controller, [linkAt(8, 10), container]);
    assert.ok(p, "必须仍然返回一个可用的升级位");
    assert.ok(!(p.x === 9 && p.y === 10), "容器格已被同伴预占，不能抢");
}

// ③ 容器离控制器 4 格 → 站上去升不了级，退回原选点
{
    const { pro, creep, controller } = makeSandbox({ upgraders: [1] });
    const container = containerAt(14, 10);           // 距控制器 4 格
    const p = pro.getUpgradePosition(creep, controller, [container]);
    assert.ok(p, "仍要返回一个位置");
    assert.ok(!(p.x === 14 && p.y === 10), "超出控制器 3 格时不能站容器（upgradeController 距离 3）");
    assert.ok(p.getRangeTo(controller.pos) <= 3, "返回的位置必须在控制器 3 格内");
}

// ④ 没有容器 → 退回原选点
{
    const { pro, creep, controller } = makeSandbox({ upgraders: [1] });
    const p = pro.getUpgradePosition(creep, controller, [linkAt(8, 10)]);
    assert.ok(p && p.getRangeTo(controller.pos) <= 3, "只有 link 时仍要选出控制器 3 格内的位置");
}

// ⑤ 单人时容器格已被**自己**预占 → 仍然返回它（幂等）
{
    const { pro, creep, controller } = makeSandbox({ upgraders: [1], reservations: { "9:10": "u1" } });
    const container = containerAt(9, 10);
    const p = pro.getUpgradePosition(creep, controller, [container]);
    assert.equal(p, container.pos, "自己预占的容器格要照常返回");
}

console.log("upgrader container stance checks passed");
