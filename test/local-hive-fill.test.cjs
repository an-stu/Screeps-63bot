const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const room = { name: "W1N1", hiveEnergySendingUsed: { reserved: true } };
let storeReads = 0;
const target = (id, x, y, free = 50) => ({
    id, pos: { x, y, roomName: room.name },
    store: { getFreeCapacity: () => { storeReads++; return free; } },
});
room.spawn = [target("reserved", 11, 10), target("spawn", 12, 10)];
room.extension = [target("full", 10, 11, 0), target("extension", 12, 12), target("far", 15, 10)];
const Creep = function () {};
const ctx = {
    Creep, Game: { rooms: { W1N1: room } }, RESOURCE_ENERGY: "energy",
    UtilsTask: { task: (obj, taskName) => ({ id: obj.id, taskName }) },
};
ctx.global = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../modules/station_hive.js"), "utf8"), ctx);

function fill(roomName = room.name) {
    const creep = new Creep();
    const actions = [];
    Object.assign(creep, {
        memory: { roomName: room.name }, store: { energy: 100 },
        pos: { x: 10, y: 10, roomName, findClosestByRange: () => assert.fail("no second target scan") },
        addTask: task => actions.push(task.id),
        execLastTask: () => actions.push("execute"),
        popTask: () => actions.push("pop"),
    });
    creep.fillHive();
    return actions;
}

assert.deepEqual(fill(), ["spawn", "execute"], "nearest free target, with spawn winning a same-range tie");
assert.deepEqual(fill(), ["extension", "execute"], "another carrier must skip the target already reserved this tick");
assert.deepEqual(fill(), ["far", "execute"]);
assert.deepEqual(fill(), ["pop"], "exhausted targets must release the carrier");
assert.deepEqual(fill("W2N1"), ["pop"], "targets in a different room are out of range");
assert.equal(storeReads, 5, "all carriers must share one per-room free-capacity scan");
console.log("local hive fill checks passed");
