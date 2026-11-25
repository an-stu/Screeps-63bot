const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "modules", "main.js"), "utf8");

// 用户 2026-11-26：shard3 完全不兑换 pixel；shard0/1/2 每 tick 满桶即兑换。
const m = /let shouldExchangePixel = function \(\) \{[\s\S]*?\n\}/.exec(main);
assert.ok(m, "shouldExchangePixel() 必须可定位");
const ctx = {Game: {time: 0, shard: {name: "shard2"}}};
vm.runInNewContext(m[0] + "; this.fn = shouldExchangePixel;", ctx);
for (const shard of ["shard0", "shard1", "shard2"]) {
    for (const time of [0, 1, 99, 100, 101, 483]) {
        ctx.Game.time = time;
        ctx.Game.shard.name = shard;
        assert.equal(ctx.fn(), true, shard + " 必须允许满桶兑换 pixel");
    }
}
for (const time of [0, 1, 99, 100, 101, 483, 1000]) {
    ctx.Game.time = time;
    ctx.Game.shard.name = "shard3";
    assert.equal(ctx.fn(), false, "shard3 任何 tick 都不得兑换 pixel");
}

assert.ok(/if \(shouldExchangePixel\(\)[\s\S]{0,140}Game\.cpu\.bucket >= 10000[\s\S]{0,100}Game\.cpu\.generatePixel\(\)/.test(main),
    "满桶检查必须先通过 shouldExchangePixel，再调用 generatePixel");
console.log("pixel exchange cadence: non-shard3 only");