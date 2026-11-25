const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "modules", "main.js"), "utf8");

// shard3 仍省 CPU（每 100 tick 检查）；其他 shard（shard2）满桶即每 tick 尝试。
const m = /let shouldExchangePixel = function \(\) \{[\s\S]*?\n\}/.exec(main);
assert.ok(m, "shouldExchangePixel() 必须可定位");
const ctx = {Game: {time: 0, shard: {name: "shard2"}}};
vm.runInNewContext(m[0] + "; this.fn = shouldExchangePixel;", ctx);
for (const time of [1, 27, 99, 100, 101, 483]) {
    ctx.Game.time = time;
    ctx.Game.shard.name = "shard2";
    assert.equal(ctx.fn(), true, "shard2 必须每 tick 允许检查 pixel 兑换");
}
for (const time of [1, 99, 101, 483]) {
    ctx.Game.time = time;
    ctx.Game.shard.name = "shard3";
    assert.equal(ctx.fn(), false, "shard3 非 100 倍数 tick 不检查");
}
for (const time of [0, 100, 1000]) {
    ctx.Game.time = time;
    ctx.Game.shard.name = "shard3";
    assert.equal(ctx.fn(), true, "shard3 每 100 tick 检查一次");
}

assert.ok(/if \(shouldExchangePixel\(\)[\s\S]{0,140}Game\.cpu\.bucket >= 10000[\s\S]{0,100}Game\.cpu\.generatePixel\(\)/.test(main),
    "满桶检查必须先通过 shouldExchangePixel，再调用 generatePixel");
console.log("pixel exchange cadence: OK");