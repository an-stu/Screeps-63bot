const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function read(file) {
    return fs.readFileSync(path.join(__dirname, "../modules", file), "utf8");
}
function method(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, header);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unterminated " + header);
}

const high = read("strategy_highLevel.js");
const lab = read("station_lab.js");
const market = read("strategy_market.js");
const sandbox = {
    MIN_CPU: false,
    isSaveCpu: true,
    Game: {time: 1, shard: {name: "shard2"}, cpu: {bucket: 9999}},
    calls: 0,
};
vm.runInNewContext(`this.pro = {stationName: "stationLab", getRegBoostMap() { calls++; return {}; },
${method(high, "economyInterval() {")},
${method(lab, "checkBoostLabsNeed(room){")},
${method(market, "shouldRunMarketRoom() {")}
};`, sandbox);
const room = {hashCode: () => 0, memory: {stationLab: {boostLabMap:{}}}};
for (const shard of ["shard0","shard1","shard2","shard3"]) {
    sandbox.Game.shard.name = shard;
    sandbox.Game.cpu.bucket = 6000;
    assert.equal(sandbox.pro.economyInterval(), shard === "shard3" ? 7 : 1);
    sandbox.Game.cpu.bucket = 4999;
    assert.equal(sandbox.pro.economyInterval(), shard === "shard3" ? 14 : 1);
    sandbox.MIN_CPU = true;
    assert.equal(sandbox.pro.economyInterval(), shard === "shard3" ? 10 : 1);
    sandbox.MIN_CPU = false;

    sandbox.calls = 0;
    for (let tick = 1; tick <= 6; tick++) {
        sandbox.Game.time = tick;
        sandbox.pro.checkBoostLabsNeed(room);
    }
    assert.equal(sandbox.calls, shard === "shard3" ? 2 : 6);
    sandbox.Game.time = 10;
    sandbox.Game.cpu.bucket = 4500;
    assert.equal(sandbox.pro.shouldRunMarketRoom(), shard !== "shard3",
        "the regular market batch on other shards must not be skipped by the shard3 savings gate");
    sandbox.Game.time = 870;
    assert.equal(sandbox.pro.shouldRunMarketRoom(), true,"shard3 retains its full eligibility window");
}
assert.match(lab, /const buffered = Game\.shard\?\.name === "shard3";\s*const staggered = buffered && global\.taskDispatchThrottle !== false;/);
assert.match(lab, /Game\.shard\?\.name === "shard3" && Game\.cpu\.bucket < 8000/);
assert.match(read("main.js"), /\(!isSaveCpu \|\| Game\.cpu\.bucket >= 6000\)\s*&& \(!taskDispatchThrottle \|\| HelperCpuUsed\.shouldRun\(25/);
assert.match(read("manager_rooms.js"), /ROOM_REFRESH_INTERVAL = Game\.shard\?\.name === "shard3" \? 61 : 31/);

const pc = {Game:{time:1},calls:0, HelperError:{catchError:fn=>fn()},
    ManagerFlags:{getFlagsByPrefix:()=>[{}]}};
pc.global = pc;
vm.runInNewContext(`this.pro = {execRoom() { calls++; }, ${method(read("strategy_factoryPowerCreep.js"), "exec() {")}};`,pc);
pc.taskDispatchThrottle = false;
pc.pro.exec();
assert.equal(pc.calls,1,"PC ready tasks dispatch outside shard3 on a non-phase tick");
pc.taskDispatchThrottle = true;
pc.pro.exec();
assert.equal(pc.calls,1,"shard3 keeps the CPU-saving dispatch phase when enabled");
pc.Game.time = 3;
pc.pro.exec();
assert.equal(pc.calls,2);

console.log("shard-specific optional cadence: OK");
