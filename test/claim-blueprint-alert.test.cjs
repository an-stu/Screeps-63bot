const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const warnings = [];
const ctx = {
    Game:{time:100, cpu:{bucket:5900}, shard:{name:"shard2"}},
    Memory:{rooms:{}},
    STRUCTURE_SPAWN:"spawn",
    RoomPosition: function(x,y,roomName) { Object.assign(this,{x,y,roomName}); },
    Logger:{warning(...args) { warnings.push(args); }},
    _: {keys:Object.keys},
    Utils:{encodePosArray: a => a.map(z => z.x + ":" + z.y).join(",")},
};
ctx.global = ctx;
const vmContext = vm.createContext(ctx);
for (const name of ["manager_autoPlanner","strategy_claim"]) {
    const src = fs.readFileSync(path.join(__dirname, "../modules", name + ".js"), "utf8");
    vm.runInContext(`(function(){\n${src}\n})()`, vmContext);
}
const room = {
    name:"W1N1", my:false, memory:{}, controller:{pos:new ctx.RoomPosition(10,10,"W1N1")},
    mineral:{pos:new ctx.RoomPosition(20,23,"W1N1")}, source:[{pos:new ctx.RoomPosition(30,22,"W1N1")}],
};
let called = 0, layout;
ctx.ManagerPlanner = {computeManor() { called++; if (layout instanceof Error) throw layout; return layout; }};
const ensure = () => ctx.StrategyClaim.ensureClaimBlueprint(room);
assert.equal(ensure().state,"WAITING_FOR_PLANNER_CPU");
assert.equal(called,0);
assert.equal(warnings.length,0);
ctx.Game.cpu.bucket = 7500;
assert.equal(ensure().reason,"no_valid_layout");
assert.equal(warnings.length,0,"do not warn that a still-unowned room has been claimed");
room.my = true;
ctx.Game.time = 101;
assert.equal(ensure().state,"PLANNER_FAILED");
assert.equal(ensure().retryAt,350);
assert.equal(called,1);
assert.equal(warnings.length,1,"already failed before ownership; alert once ownership is confirmed");
layout = {structMap:{spawn:[]}};
ctx.Game.time = 350;
assert.equal(ensure().reason,"missing_spawn_slot");
assert.equal(room.memory.structMap,undefined,"do not save a blueprint without a spawn position");
assert.equal(warnings.length,2,"one warning for the new cause");
ctx.Game.time = 600;
layout = new Error("planner blew up");
assert.equal(ensure().error,"planner blew up");
assert.equal(warnings.length,3);
ctx.Game.time = 850;
layout = {structMap:{spawn:[[18,20]]}};
assert.equal(ensure().ready,true);
assert.equal(room.memory.claimBlueprintFailure,undefined,"successful plan clears the warning latch and retry");
assert.equal(room.memory.structMap.spawn,"18:20");
assert.equal(warnings.length,3);
console.log("claim blueprint warning: OK");
