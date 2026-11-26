const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const read = name => fs.readFileSync(path.join(__dirname, "../modules", name + ".js"), "utf8");

test("construction aid from both mission queues waits for local economy and keeps failed requests retryable", () => {
    const trace = [];
    const ctx = vm.createContext({
        Game: {time: 52, shard: {name: "shard2"}, rooms: {E41S29: {my: true}}},
        Memory: {missions: {}}, Creep: function () {},
        HelperError: {catchError: run => run()}, Logger: {log() {}, warning() {}},
    });
    ctx.global = ctx;
    for (const name of ["station_hive", "manager_missions", "manager_crossShard"]) {
        vm.runInContext(`(function(){${read(name)}\n})()`, ctx, {filename: name});
    }
    ctx.StationHive.trySpawn = (_room, _target, _body, role) => { trace.push(role); return true; };
    ctx.missionFunc.spawnCrossShardBuilder = data => { trace.push(data.key); return !data.busy; };
    ctx.missionCallBack.aidDone = () => trace.push("aidDone");
    ctx.Memory.missions = {
        legacyAid: {func: "spawnCreepCressShard", data: {spawnRoom: "E41S29", role: "worker"}, callBack: "aidDone"},
        claim: {func: "spawnCreepCressShard", data: {spawnRoom: "E41S29", role: "claimer"}},
    };
    const inbound = {from: "shard3", data: {func: "spawnCrossShardBuilder", data: {key: "remoteAid", busy: true}}};
    ctx.ManagerCrossShard.applyRequest("shard2:aid", inbound);
    ctx.ManagerMissions.init();
    assert.deepEqual(trace, ["claimer"], "claim is not a construction aid mission");
    assert.equal(ctx.ManagerCrossShard.localShardData["shard2:aid"], undefined);
    assert.ok(ctx.Memory.missions.legacyAid);

    trace.push("localEconomy");
    ctx.StationHive.deferSpawn("mineral", () => trace.push("mineral"));
    ctx.StationHive.deferSpawn("rescue", () => trace.push("rescue"));
    ctx.StationHive.runDeferredSpawns();
    assert.deepEqual(trace, ["claimer", "localEconomy", "rescue", "remoteAid", "worker", "aidDone", "mineral"]);
    assert.equal(ctx.ManagerCrossShard.localShardData["shard2:aid"], undefined, "no false acknowledgement after a busy spawn");
    assert.equal(ctx.Memory.missions.legacyAid, undefined);

    inbound.data.data.busy = false;
    ctx.ManagerCrossShard.applyRequest("shard2:aid", inbound);
    ctx.StationHive.runDeferredSpawns();
    assert.equal(ctx.ManagerCrossShard.localShardData["shard2:aid"].from, "shard3");
    ctx.ManagerCrossShard.applyRequest("shard2:aid", inbound);
    ctx.StationHive.runDeferredSpawns();
    assert.equal(trace.filter(x => x === "remoteAid").length, 2, "successful missions are never spawned twice");
});

test("production drains deferred spawns only after all rooms have dispatched", () => {
    const main = read("main");
    assert.ok(main.indexOf("runDeferredSpawns") > main.indexOf("ManagerRooms.exec(room)"));
    for (const module of ["strategy_highLevel", "strategy_outerHarvest"]) {
        assert.match(read(module), /StationHive\.deferSpawn\("mineral"/);
    }
    assert.match(read("strategy_lowLevel"), /StationHive\.deferSpawn\("aid"/);
});
