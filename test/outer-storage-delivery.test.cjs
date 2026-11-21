const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../modules/prototype_creep.js"), "utf8");
const begin = src.indexOf("Creep.prototype.fillRes = function () {");
const end = src.indexOf("Creep.prototype.buildConst = function () {", begin);
assert.ok(begin >= 0 && end > begin);
function Creep() {}
const ctx = {Creep, STRUCTURE_LINK: "link", RESOURCE_ENERGY: "energy", OK: 0};
vm.runInNewContext(src.slice(begin, end), ctx);

const home = {name: "E51S29", my: true};
const makeTarget = (id, structureType, x, y) => ({
    id, structureType, pos: {x, y, roomName: home.name},
    store: {energy: 0, getFreeCapacity: () => 1000},
});
home.storage = makeTarget("home-storage", "storage", 12, 17);
const link = makeTarget("old-edge-link", "link", 46, 23);

function run(role, target, inRange = true) {
    const calls = [];
    const c = new Creep();
    const t = {id: link.id, roomName: home.name, x: link.pos.x, y: link.pos.y, resType: "energy"};
    Object.assign(c, {
        room: home, memory: {role},
        store: {energy: 600, getFreeCapacity: () => 0},
        lastTask: () => t, lastTaskObj: () => target, mainRoom: () => home,
        storeEmpty: () => false, pos: {isNearTo: () => inRange},
        moveTo(task) { calls.push(["move", task.id]); },
        transfer(obj, res, amount) { calls.push(["transfer", obj.id, res, amount]); return 0; },
        popTask() { return this; }, execLastTask() { return this; },
    });
    c.fillRes();
    return {calls, task: t};
}
let result = run("outerHarvestEnergyCarrier", link);
assert.deepEqual(result.calls, [["transfer", home.storage.id, "energy", 600]]);
assert.deepEqual([result.task.x, result.task.y], [12,17]);
result = run("outerHarvestEnergyCarrier", undefined, false);
assert.deepEqual(result.calls, [["move", home.storage.id]], "a destroyed legacy edge Link cannot strand a loaded hauler");
result = run("carrier", link);
assert.deepEqual(result.calls, [["transfer", link.id, "energy", 600]], "local link delivery is unchanged");
delete home.storage;
result = run("outerHarvestEnergyCarrier", link);
assert.deepEqual(result.calls, [], "temporarily missing Storage must not enable a Link fallback");
