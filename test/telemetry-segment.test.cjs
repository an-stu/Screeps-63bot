const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceCode = fs.readFileSync(path.join(__dirname, "..", "modules/helper_telemetrySegment.js"), "utf8");

function makeContext({ time = 100, rooms = {}, health = {}, stats = {}, segments = [], breakRooms = false, breakWrite = false } = {}) {
    const ctx = {
        console: { log() {} },
        Game: {
            time,
            shard: { name: "shard3" },
            get rooms() { if (breakRooms) throw new Error("rooms broken"); return rooms; },
        },
        Memory: { codeHealth: health, stats },
        RawMemory: {
            segments,
            setActiveSegments(ids) { this.lastActive = ids.slice(); this.activationCount = (this.activationCount || 0) + 1; },
        },
        RUNTIME_PROFILE: { version: "0.78.236" },
        module: { exports: {} },
        Error,
    };
    ctx.global = ctx;
    if (breakWrite) {
        // 段赋值时抛错，验证异常不冒泡（模块写的是 RawMemory.segments[90]）
        Object.defineProperty(segments, "90", {
            configurable: true,
            get() { return undefined; },
            set() { throw new Error("write broken"); },
        });
    }
    vm.runInNewContext(sourceCode, ctx, { filename: "helper_telemetrySegment.js" });
    return ctx;
}

const baseHealth = {
    cpu: 17.1234, averageCpu: 16.9876, bucket: 4321, creeps: 77, powerCreeps: 12, errorCount: 2,
    fullSourceContainers: 1, totalSourceContainers: 28,
    phases: { init: 0.45, unitTasks: 12.3, rooms: 5.5, unitRoles: { keeper: 4.8, carrier: 2.3 }, roomDetails: { E53S21: 0.55 } },
};
const baseStats = { gcl: 26.88, gclLevel: 25, gpl: 13.15, gplLevel: 295 };

// 1) 首个 tick 激活段，间隔 tick 写段；latest 字段四舍五入、资源聚合正确
{
    const rooms = {
        E53S21: {
            my: true,
            storage: { store: { energy: 1000, H: 300 } },
            terminal: { store: { energy: 500, H: 100 } },
            factory: { store: { energy: 100 } },
            labs: [{ store: { H: 50 } }, { store: { H: 50, energy: 25 } }],
        },
        W1N1: { my: false, storage: { store: { energy: 999999 } } },
    };
    const segments = [];
    const ctx = makeContext({ time: 100, rooms, health: baseHealth, stats: baseStats, segments });
    ctx.HelperTelemetrySegment.exec();
    assert.deepEqual([...ctx.RawMemory.lastActive], [90], "first exec activates segment 90");
    const data = JSON.parse(segments[90]);
    assert.equal(data.v, 1);
    assert.equal(data.latest.t, 100);
    assert.equal(data.latest.ver, "0.78.236");
    assert.equal(data.latest.cpu, 17.12, "cpu rounded to 2 decimals");
    assert.equal(data.latest.avg, 16.99);
    assert.equal(data.latest.bucket, 4321);
    assert.equal(data.latest.creeps, 77);
    assert.equal(data.latest.err, 2);
    assert.equal(data.latest.gcl, 26.88);
    assert.equal(data.latest.gclL, 25);
    assert.equal(data.latest.gpl, 13.15);
    assert.equal(data.latest.gplL, 295);
    assert.deepEqual([...data.cols], ["t", "cpu", "avg", "bucket", "creeps", "pc", "err"]);
    assert.equal(data.rows.length, 1);
    assert.deepEqual([...data.rows[0]], [100, 17.12, 16.99, 4321, 77, 12, 2]);
    // 资源只统计自有房的 storage/terminal/factory/labs
    const res = Object.fromEntries(data.latest.res.map(e => [e.k, e.v]));
    assert.equal(res.energy, 1000 + 500 + 100 + 25, "energy across storage/terminal/factory/labs");
    assert.equal(res.H, 300 + 100 + 50 + 50, "H across stores");
    assert.ok(!("energy" in res && res.energy > 100000), "non-owned room excluded");
    // 分项按数值降序
    const phase = data.latest.phases.map(e => e.k);
    assert.deepEqual([...phase], ["unitTasks", "rooms", "init"], "phases sorted desc, nested objects skipped");
    assert.deepEqual([...data.latest.roles.map(e => e.k)], ["keeper", "carrier"]);
    assert.deepEqual([...data.latest.rooms.map(e => e.k)], ["E53S21"]);

    // 2) 非间隔 tick 不写
    const before = segments[90];
    ctx.Game.time = 105;
    ctx.HelperTelemetrySegment.exec();
    assert.equal(segments[90], before, "no write off-interval");
    assert.equal(JSON.parse(segments[90]).rows.length, 1);

    // 3) 下一个间隔 tick 追加一行
    ctx.Game.time = 110;
    ctx.HelperTelemetrySegment.exec();
    assert.equal(JSON.parse(segments[90]).rows.length, 2, "second interval appends a row");
}

// 4) 环形上限：超过 MAX_ROWS 后裁剪最旧行
{
    const segments = [];
    const ctx = makeContext({ time: 0, health: baseHealth, stats: baseStats, segments });
    for (let t = 10; t <= 6100; t += 10) {
        ctx.Game.time = t;
        ctx.HelperTelemetrySegment.exec();
    }
    const data = JSON.parse(segments[90]);
    assert.equal(data.rows.length, 600, "ring capped at 600 rows");
    assert.equal(data.rows[0][0], 6100 - 599 * 10, "oldest row trimmed");
    assert.equal(data.rows[599][0], 6100, "newest row last");
}

// 5) global 重置后从段内容恢复历史，而不是从零开始
{
    const segments = [];
    const first = makeContext({ time: 10, health: baseHealth, stats: baseStats, segments });
    first.Game.time = 10;
    first.HelperTelemetrySegment.exec();
    first.Game.time = 20;
    first.HelperTelemetrySegment.exec();
    assert.equal(JSON.parse(segments[90]).rows.length, 2);

    const second = makeContext({ time: 30, health: baseHealth, stats: baseStats, segments });
    second.HelperTelemetrySegment.exec();
    const data = JSON.parse(segments[90]);
    assert.equal(data.rows.length, 3, "rows restored from existing segment after global reset");
    assert.deepEqual([...data.rows.map(r => r[0])], [10, 20, 30]);
}

// 6) 写段或房间扫描抛错不影响主循环
{
    const brokenRoom = makeContext({ time: 10, health: baseHealth, stats: baseStats, breakRooms: true });
    assert.doesNotThrow(() => brokenRoom.HelperTelemetrySegment.exec(), "room scan failure is swallowed");

    const brokenWrite = makeContext({ time: 10, health: baseHealth, stats: baseStats, breakWrite: true });
    assert.doesNotThrow(() => brokenWrite.HelperTelemetrySegment.exec(), "segment write failure is swallowed");
}

console.log("telemetry segment checks passed");
