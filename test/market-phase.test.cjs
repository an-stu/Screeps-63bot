const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "modules/strategy_market.js"), "utf8");

// 只取出 marketSlowPass / marketSlowPassTicks 两个纯函数，避免为此加载整个模块。
const start = source.indexOf("function marketSlowPassTicks()");
const end = source.indexOf("let getSeriesMap");
assert.ok(start > 0 && end > start, "marketSlowPass helpers must exist in strategy_market.js");
const helperBlock = source.slice(start, end);

const context = {
    Game: { time: 0 },
    Memory: { marketSettings: {} },
    Math,
};
context.global = context;
vm.runInNewContext(helperBlock, context, { filename: "marketSlowPass.js" });
const marketSlowPass = context.marketSlowPass;

// 线上实测的 hash（来自 Game.rooms[..].hashCode()）。
const ROOM_HASH = {
    E55S39: -99040,   // 唯一 hash % 10 === 0 的房间（旧实现里唯一能命中门控的）
    W32N56: -66541,
    W33N53: -162550,
    E55S31: -173448,
    E48S41: -60105,
    E49S31: -173961,
};

/**
 * 复现 main.js 的实际调用条件：
 *   shouldRun(10)              -> Game.time % 10 === 0
 *   batch=(Game.time/10)%4     -> 只有下标满足的下标组才会被调用
 */
function passesIn(hash, index, fn, spanTicks = 4000) {
    const room = {hashCode: () => hash};
    const hits = [];
    for (let t = 0; t < spanTicks; t += 10) {
        if ((Math.floor(t / 10) % 4) !== (index % 4)) continue;
        context.Game.time = t;
        if (fn(room)) hits.push(t);
    }
    return hits;
}

// --- 旧实现（负对照）：(Game.time + hash) % 80 === 0 -------------------------
// 这是被替换掉的写法，保留在此仅用于证明它确实不可达。
const legacy = room => (context.Game.time + room.hashCode()) % 80 === 0;

for (const [name, hash] of Object.entries(ROOM_HASH)) {
    if (hash % 10 === 0) continue;
    for (let index = 0; index < 4; index++) {
        assert.equal(passesIn(hash, index, legacy).length, 0,
            `negative control: legacy gate must be unreachable for ${name} (hash ${hash})`);
    }
}
// 唯一 hash % 10 === 0 的房间在旧实现里是可命中的（这正是线上只剩它在卖矿的原因）
assert.ok(passesIn(ROOM_HASH.E55S39, 0, legacy).length > 0,
    "negative control: legacy gate is reachable only for hash % 10 === 0 rooms");

// --- 新实现：每个房间都必须可达，并且周期精确 --------------------------------
for (const [name, hash] of Object.entries(ROOM_HASH)) {
    for (let index = 0; index < 4; index++) {
        const hits = passesIn(hash, index, marketSlowPass);
        assert.ok(hits.length > 0, `${name} must be reachable with new phase logic`);
        // 周期 = period * 40 tick（默认 slowPassTicks=80 -> period=2 -> 80 tick）
        for (let i = 1; i < hits.length; i++) {
            assert.equal(hits[i] - hits[i - 1], 80,
                `${name} slow pass must run every 80 ticks, got ${hits[i] - hits[i - 1]}`);
        }
    }
}

// --- 可配置周期 --------------------------------------------------------------
for (const [ticks, expected] of [[80, 80], [160, 160], [280, 280], [320, 320]]) {
    context.Memory.marketSettings.slowPassTicks = ticks;
    const hits = passesIn(ROOM_HASH.W32N56, 0, marketSlowPass);
    assert.ok(hits.length > 0, `period ${ticks} must stay reachable`);
    for (let i = 1; i < hits.length; i++) {
        assert.equal(hits[i] - hits[i - 1], expected,
            `period ${ticks} must yield exactly ${expected} tick spacing`);
    }
}

console.log("market phase checks passed");
