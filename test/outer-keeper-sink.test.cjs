/**
 * 外矿 keeper 的「容器满就停手」闸（0.78.242）。
 *
 * 背景：`harvestEnergyKeeper`（主房）在 0.78.234 加过 harvestSinkFree 闸，
 * 但 `harvestEnergyOuterKeeper` 一直是无条件 harvest。实测 W26N59 (29,5)：
 * 容器 2000/2000 期间源 (29,4) 仍以 10.3/tick 下降、同格地面堆 2,728→2,840
 * 上涨 —— 产量全掉在地上衰减。
 *
 * 这些用例是**行为负对照**：把闸拆掉（改回无条件 harvest）第一组立刻失败。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceCode = fs.readFileSync(path.join(__dirname, "..", "modules/station_sources.js"), "utf8");
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function makeFixture({ containerEnergy = 0, containerCap = 2000, freeCapacity = 0,
    sourceEnergy = 3000, ttl = 90, containerHits = 1000, hasContainer = true } = {}) {
    const objects = Object.create(null);
    const actions = [];
    const ctx = {
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_FULL: -8,
        MOVE: "move", WORK: "work", CARRY: "carry",
        LOOK_CREEPS: "creeps", LOOK_POWER_CREEPS: "powerCreeps", LOOK_ENERGY: "energy",
        LOOK_TOMBSTONES: "tombstones", RESOURCE_ENERGY: "energy",
        STRUCTURE_CONTAINER: "container",
        FIND_MY_CREEPS: 102, FIND_HOSTILE_CREEPS: 101,
        console: { log() {} },
        isSaveCpu: false, MIN_CPU: false,
        Memory: { rooms: {} },
        Game: {
            time: 1000, cpu: { bucket: 10000 }, shard: { name: "shard3" }, creeps: {},
            getObjectById(id) { return objects[id] || null; },
            map: { getRoomLinearDistance: () => 1 },
        },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => undefined },
        UtilsTask: {
            task: (t, taskName) => ({ id: t && t.id, taskName }),
            taskData: taskName => ({ taskName }),
        },
    };
    ctx.global = ctx;
    vm.runInNewContext(sourceCode, ctx, { filename: "station_sources.js" });

    const pos = (x, y) => ({
        x, y, roomName: "W1N1",
        isEqualTo(other) { other = other.pos || other; return this.x === other.x && this.y === other.y; },
        isNearTo(other) { other = other.pos || other; return Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)) <= 1; },
        findInRange() { return []; },
        lookFor() { return []; },
    });

    const container = {
        id: "container", pos: pos(10, 10), hits: containerHits, hitsMax: 1000,
        store: {
            energy: containerEnergy,
            getUsedCapacity(res) { return res === "energy" ? this.energy : 0; },
            getFreeCapacity(res) { return res === "energy" ? Math.max(0, containerCap - this.energy) : 0; },
        },
    };
    const source = {
        id: "src", pos: pos(9, 10), energy: sourceEnergy, energyCapacity: 3000,
        ticksToRegeneration: 300,
    };
    objects.src = source;
    if (hasContainer) objects.container = container;
    ctx.Memory.rooms.W1N1 = { stationSources: { src: hasContainer ? { container: "container" } : {} } };

    const room = { name: "W1N1", constructionSite: [] };
    const creep = {
        room, pos: pos(10, 10), ticksToLive: ttl, memory: {}, spawning: false,
        store: {
            energy: 50 - freeCapacity,
            getFreeCapacity: () => freeCapacity,
        },
        headTask: () => ({ id: "src", roomName: "W1N1" }),
        moveTo(target, opts) { actions.push(["moveTo", target.id, opts && opts.range]); },
        harvest(target) { actions.push(["harvest", target.id]); },
        build(target) { actions.push(["build", target.id]); },
        repair(target) { actions.push(["repair", target.id]); },
        transfer(target, res) { actions.push(["transfer", target.id, res]); },
        withdraw(target, res) { actions.push(["withdraw", target.id, res]); },
        pickup(target) { actions.push(["pickup", target.id]); },
        addTask() { return this; },
        addTaskAndExec() { return this; },
        getPartCnt(type) { return type === "work" ? 8 : 1; },
    };
    return {
        ctx, creep, container, source, actions,
        harvests: () => actions.filter(a => a[0] === "harvest").length,
        run() { ctx.Creep.prototype.harvestEnergyOuterKeeper.call(creep); },
    };
}

// ① 负对照：容器顶满 + 自己也是满的 ⇒ 一 tick 都不能挖（否则产量掉地衰减）。
{
    const f = makeFixture({ containerEnergy: 2000, containerCap: 2000, freeCapacity: 0 });
    f.run();
    assert.equal(f.harvests(), 0,
        "full container + full keeper must stop harvesting (spill would decay on the ground)");
}

// ② 容器有余量、自己满仓 ⇒ 照常挖（溢出被脚下容器接住）。
{
    const f = makeFixture({ containerEnergy: 1500, containerCap: 2000, freeCapacity: 0 });
    f.run();
    assert.equal(f.harvests(), 1, "container headroom keeps the harvest running");
}

// ③ 容器满、自己身上有余量 ⇒ 照常挖（自己就是 sink）。
{
    const f = makeFixture({ containerEnergy: 2000, containerCap: 2000, freeCapacity: 50 });
    f.run();
    assert.equal(f.harvests(), 1, "the keeper's own free capacity is a valid sink");
}

// ④ 没有容器（还没建）时不能把 keeper 锁死：身上有余量就挖。
{
    const f = makeFixture({ hasContainer: false, freeCapacity: 50 });
    f.run();
    assert.equal(f.harvests(), 1, "container-less keeper still harvests while it has room");
}

// ⑤ 源太瘦（低于再生速率）时本来就不挖，与闸无关：确认闸没有把判断顺序搞反。
{
    const f = makeFixture({ containerEnergy: 1500, containerCap: 2000, freeCapacity: 0, sourceEnergy: 100 });
    f.run();
    assert.equal(f.harvests(), 0, "thin source is skipped by the regen-ratio guard, not the sink gate");
}

// ⑥ 满容器下维修/捡拾等旁路动作不受影响（闸只掐 harvest）。
{
    const f = makeFixture({ containerEnergy: 2000, containerCap: 2000, freeCapacity: 0, containerHits: 500, ttl: 90 });
    f.run();
    assert.ok(f.actions.some(a => a[0] === "repair" && a[1] === "container"),
        "container maintenance still runs while the sink gate blocks harvesting");
    assert.equal(f.harvests(), 0, "gate stays closed for the whole tick");
}

console.log("outer keeper sink gate checks passed");
