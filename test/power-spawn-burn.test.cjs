const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/station_carry.js"), "utf8");

/**
 * 烧 power 的窗口 = **OPERATE_POWER 生效期间**（用户 2026-10-21）：
 * 「每 tick 调用，确保一个 OPERATE_POWER 完整烧完，然后休息攒到下一个」。
 * 有 op power 时一次 processPower = 1+level 个 power（实测 4 级 = 5 个）。
 */
function load(settings, room) {
    const ctx = {
        console,
        Game: { time: 100000, cpu: { bucket: 10000 }, shard: { name: "shard3" } },
        Memory: { marketSettings: settings || {}, rooms: {} },
        Creep: function () {},
        Room: function () {},
        Resource: function () {},
        Structure: function () {},
        UtilsTask: {}, StationHive: {}, StationSources: {}, StationMineral: {},
        StationLab: {}, ManagerFlags: {}, ManagerRooms: {},
        RESOURCE_ENERGY: "energy", RESOURCE_POWER: "power", RESOURCE_UTRIUM: "U",
        PWR_OPERATE_POWER: 16,
        OK: 0, ERR_NOT_ENOUGH_RESOURCES: -6, ERR_FULL: -8, ERR_NOT_IN_RANGE: -9,
        STRUCTURE_LINK: "link", STRUCTURE_CONTAINER: "container",
        FIND_MY_STRUCTURES: 111, FIND_STRUCTURES: 101, FIND_DROPPED_RESOURCES: 106,
        FIND_TOMBSTONES: 110, FIND_MY_CREEPS: 102, FIND_HOSTILE_CREEPS: 103,
    };
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "station_carry.js" });
    ctx.__burn = 0;
    room.powerSpawn.processPower = () => { ctx.__burn++; return ctx.OK; };
    ctx.StationCarry.roomMassStoreCnt = (r, res) =>
        res == "energy" ? room.__energy : (res == "power" ? room.__power : 0);
    return ctx;
}

const OP_EFFECT = [{ power: 16, effect: 16, level: 4, ticksRemaining: 500 }];

function makeRoom(power, energy, effects) {
    return {
        name: "W32N56",
        __power: power,
        __energy: energy,
        powerSpawn: {
            store: { power: 100, energy: 500 },
            effects: effects === undefined ? OP_EFFECT : effects,
        },
    };
}

{
    const room = makeRoom(10000, 500000);
    room.name = "E53S21";
    const ctx = load({}, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "非试点房不烧");
}

{
    const room = makeRoom(5000, 500000, []);
    const ms = { powerBurning: true };
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "没有 op power 效果就不烧（等下一个 OPERATE_POWER）");
    assert.equal(ms.powerBurning, false, "窗口关闭");
}

{
    const room = makeRoom(5000, 300000);   // 预算 (300k-60k)/500 = 480 ≥ 250 ⇒ 满速
    const ms = {};
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 1, "效果生效期间每 tick 调用一次 processPower");
    assert.equal(ms.powerBurning, true);
}

{
    const room = makeRoom(5000, 50000);
    const ms = { powerBurning: true };
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "能量低于下限停烧");
    assert.equal(ms.powerBurning, false);
}

{
    const room = makeRoom(100, 120000);
    const ms = { powerBurning: true };
    const ctx = load(ms, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "到低水位停烧");
}

{
    const room = makeRoom(5000, 120000, [{ power: 2, effect: 2, level: 3, ticksRemaining: 500 }]);
    const ctx = load({}, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 0, "只认 PWR_OPERATE_POWER（id 16）");
}

{
    const room = makeRoom(5000, 300000);
    room.name = "E53S21";
    const ctx = load({ powerSpawnRoom: "E53S21" }, room);
    ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 1, "powerSpawnRoom 指向哪就烧哪");
}

{
    const roomsSrc = fs.readFileSync(path.join(root, "modules/manager_rooms.js"), "utf8");
    const codeOnly = roomsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/StationCarry\.tryProcessPower\(room\)/.test(codeOnly),
        "ManagerRooms.exec 每 tick 要推进一次 power 烧制");
}

// ⑨ 配速：能量不够烧满整个窗口时，把 5/tick 摊薄，而不是烧到下限就停、让效果作废
{
    // floor 60k，剩 500 tick，可用 40k ⇒ 80 能量/tick 的预算；一次要 250 ⇒ 约 4 tick 烧一次
    const room = makeRoom(5000, 100000);
    const ms = {};
    const ctx = load(ms, room);
    for (let i = 0; i < 4; i++) ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 1, "预算不足时把燃烧摊薄到整个效果期（4 tick 烧一次）");
    assert.ok(ms.powerBurnCredit >= 0 && ms.powerBurnCredit < 250, "credit 记账在 0~250 之间");
}

// ⑩ 能量充裕时仍然是每 tick 烧（配速不拖慢满速）
{
    const room = makeRoom(5000, 500000);
    const ms = {};
    const ctx = load(ms, room);
    for (let i = 0; i < 3; i++) ctx.StationCarry.tryProcessPower(room);
    assert.equal(ctx.__burn, 3, "预算充足 ⇒ 每 tick 都烧");
}

console.log("power spawn burn checks passed");
