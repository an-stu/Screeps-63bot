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
const sandbox = {
    MIN_CPU: false,
    Game: {time: 1, shard: {name: "shard2"}, cpu: {bucket: 9999}},
    calls: 0,
};
vm.runInNewContext(`this.pro = {stationName: "stationLab", getRegBoostMap() { calls++; return {}; },
${method(high, "economyInterval() {")},
${method(lab, "checkBoostLabsNeed(room){")}
};`, sandbox);
const room = {hashCode: () => 0, memory: {stationLab: {boostLabMap:{}}}};
for (const shard of ["shard0","shard1","shard2","shard3"]) {
    sandbox.Game.shard.name = shard;
    sandbox.Game.cpu.bucket = 6000;
    assert.equal(sandbox.pro.economyInterval(), shard === "shard3" ? 7 : 5);
    sandbox.Game.cpu.bucket = 4999;
    assert.equal(sandbox.pro.economyInterval(), shard === "shard3" ? 14 : 5);
    sandbox.MIN_CPU = true;
    assert.equal(sandbox.pro.economyInterval(), 10);
    sandbox.MIN_CPU = false;

    sandbox.calls = 0;
    for (let tick = 1; tick <= 6; tick++) {
        sandbox.Game.time = tick;
        sandbox.pro.checkBoostLabsNeed(room);
    }
    assert.equal(sandbox.calls, shard === "shard3" ? 2 : 6);
}
assert.match(lab, /const buffered = Game\.shard\?\.name === "shard3";\s*if \(buffered && \(Game\.time \+ room\.hashCode\(\)\) % 2/);
assert.match(lab, /Game\.cpu\.bucket < \(Game\.shard\?\.name === "shard3" \? 8000 : 5000\)/);
assert.match(read("main.js"), /Game\.cpu\.bucket >= 6000\s*&& HelperCpuUsed\.shouldRun\(Game\.shard\.name === "shard3" \? 25 : 10/);

console.log("shard-specific optional cadence: OK");
