const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../modules/manager_autoPlanner.js"), "utf8");
const begin = src.indexOf("    tryAutoBuildPinnedLabs(room) {");
const end = src.indexOf("    tryAutoBuildHighLevel (room){", begin);
assert.ok(begin >= 0 && end > begin);
const attempts = [];
const ctx = {
    MIN_CPU: false,
    Game: {time: 17, cpu: {bucket: 6000}},
    STRUCTURE_LAB: "lab",
    pro: {tryCreateStructs(room, plan, type) { attempts.push({room, plan, type}); }},
};
const {tryAutoBuildPinnedLabs} = vm.runInNewContext("(" + "{\n" + src.slice(begin, end) + "})", ctx);
const memory = {structMap: {lab: "pqqqos", road: "aabb"}, autoBuildLabs: true};
const room = {my: true, level: 6, hashCode: () => 0, memory};
tryAutoBuildPinnedLabs({...room, memory: {structMap: memory.structMap}});
tryAutoBuildPinnedLabs({...room, level: 5});
tryAutoBuildPinnedLabs({...room, my: false});
tryAutoBuildPinnedLabs({...room, memory: {...memory, structMap: {lab: ""}}});
ctx.MIN_CPU = true;
tryAutoBuildPinnedLabs(room);
ctx.MIN_CPU = false;
ctx.Game.cpu.bucket = 500;
tryAutoBuildPinnedLabs(room);
ctx.Game.cpu.bucket = 6000;
ctx.Game.time = 18;
tryAutoBuildPinnedLabs(room);
assert.deepEqual(attempts, [], "never queues a room without opt-in, capacity, cadence, and verified positions");
ctx.Game.time = 34;
tryAutoBuildPinnedLabs(room);
assert.deepEqual(attempts, [{room, plan: memory.structMap, type: "lab"}]);
