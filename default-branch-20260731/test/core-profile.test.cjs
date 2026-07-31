const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deploy/core-modules.json"), "utf8"));
const mounted = [...fs.readFileSync(path.join(root, "modules/main_mount.js"), "utf8").matchAll(/require\(["']([^"']+)["']\)/g)]
    .map(match => match[1]);

assert.equal(new Set(manifest).size, manifest.length, "core manifest must not duplicate a module");
for (const moduleName of manifest) {
    assert.ok(moduleName === "algo_wasm_PriorityQueue" || fs.existsSync(path.join(root, "modules", `${moduleName}.js`)), `missing ${moduleName}`);
}
for (const moduleName of mounted) {
    assert.ok(manifest.includes(moduleName), `main_mount loads ${moduleName}, but it is not in the core package`);
}

const context = {
    Game: {
        time: 0,
        cpu: {
            bucket: 9000,
            getUsed() { return context.Game.time / 5; },
        },
    },
    console: { log() {} },
};
context.global = context;
vm.runInNewContext(fs.readFileSync(path.join(root, "modules/helper_cpuUsed.js"), "utf8"), context);

for (let time = 1; time < 5; time += 1) {
    context.Game.time = time;
    context.HelperCpuUsed.exec();
}
assert.equal(context.HelperCpuUsed.size, 0, "sampler should skip non-sample ticks");

for (let time = 5; time <= 5 * 605; time += 5) {
    context.Game.time = time;
    context.Game.cpu.bucket = 10000 - time / 5;
    context.HelperCpuUsed.exec();
}
assert.equal(context.HelperCpuUsed.size, 600, "sampler should cap its retained history");
assert.equal(context.HelperCpuUsed.series(context.HelperCpuUsed.cpu).length, 600);
assert.equal(context.HelperCpuUsed.series(context.HelperCpuUsed.cpu)[0], 6, "ring buffer must return chronological samples");

console.log("core profile checks passed");
