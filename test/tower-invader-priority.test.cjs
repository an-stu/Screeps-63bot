const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const towerSrc = fs.readFileSync(path.join(root, "modules", "station_tower.js"), "utf8");
const low = fs.readFileSync(path.join(root, "modules", "strategy_lowLevel.js"), "utf8");
const high = fs.readFileSync(path.join(root, "modules", "strategy_highLevel.js"), "utf8");

// ① 威胁检测只认 Invader 玩家（不是任意 hostile）
const m = /invaderThreat\(room\) \{[\s\S]*?\n    \},/.exec(towerSrc);
assert.ok(m, "StationTower.invaderThreat 必须存在");
const ctx = {FIND_HOSTILE_CREEPS: 101};
vm.runInNewContext("this.fn = " + m[0].trim().replace(/,$/, "")
    .replace(/^invaderThreat\(room\) \{/, "function (room) {"), ctx);
assert.equal(ctx.fn({getHostileCreeps: () => [{owner: {username: "Invader"}}]}), true);
assert.equal(ctx.fn({getHostileCreeps: () => [{owner: {username: "Source Keeper"}}]}), false);
assert.equal(ctx.fn({getHostileCreeps: () => [{owner: {username: "player"}}]}), false);
assert.equal(ctx.fn({getHostileCreeps: () => []}), false);
assert.equal(ctx.fn({find: () => [{owner: {username: "Invader"}}]}), true);

// ② 低级房：空手 carrier、已载货 carrier、已载货 worker 都在 hive 前检查塔任务
{
    const emptyIdx = low.indexOf('room.creeps("carrier").filter(e => e.storeEmpty()');
    const towerIdx = low.indexOf("invaderThreat && fillTowerTasks.length", emptyIdx);
    const hiveIdx = low.indexOf("StationHive.HiveNeedToFill", emptyIdx);
    assert.ok(emptyIdx > 0 && towerIdx > emptyIdx && hiveIdx > towerIdx,
        "低级房空手 carrier 必须先接塔任务，再考虑 hive");
}
{
    const loadedIdx = low.indexOf('room.creeps("carrier").filter(e => !e.storeEmpty()');
    const towerIdx = low.indexOf("invaderThreat && fillTowerTasks.length", loadedIdx);
    const hiveIdx = low.indexOf("StationHive.HiveNeedToFill", loadedIdx);
    assert.ok(loadedIdx > 0 && towerIdx > loadedIdx && hiveIdx > towerIdx,
        "低级房已载货 carrier 在 Invader 下必须先补塔");
}
{
    const workerIdx = low.indexOf('workers.filter(e => !e.storeEmpty()');
    const towerIdx = low.indexOf("invaderThreat && fillTowerTasks.length", workerIdx);
    const hiveIdx = low.indexOf("StationHive.HiveNeedToFill", workerIdx);
    assert.ok(workerIdx > 0 && towerIdx > workerIdx && hiveIdx > towerIdx,
        "低级房已载货 worker 在 Invader 下也必须先补塔");
}

// ③ 高级房：hive 缺口分支里，已载/空手 carrier 和已载 worker 都先服务塔
assert.ok(/if \(invaderThreat && fillTowerTasks\.length\) creep\.addTask\(fillTowerTasks\.shift\(\)\);[\s\S]{0,100}else creep\.addTask\(StationHive\.generatorFillHiveTask/.test(high),
    "高级房已载 carrier 在 Invader 下必须先补塔、再填 hive");
assert.ok(/while \(invaderThreat && fillTowerTasks\.length && freeCarries\.length\)/.test(high),
    "高级房空手 carrier 在 Invader 下必须优先领塔任务");
const highWorker = /} else \{\s*\/\/ Invader 在场时[\s\S]{0,220}?invaderThreat && towerFillTasks\.length[\s\S]{0,180}?StationHive\.HiveNeedToFill/.exec(high);
assert.ok(highWorker, "高级房已载 worker 在 Invader 下必须先补塔");

console.log("tower invader priority: OK");