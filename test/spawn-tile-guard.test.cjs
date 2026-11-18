// Regression: an idle Spawn may start a creep even when a creep occupies its tile.
// Spawn selection must still skip a Spawn that is actively spawning and use a free one.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "modules", "station_hive.js"), "utf8");

if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function makeWorld(opts = {}) {
    const world = {spawnCalls: []};
    const blockers = opts.blockers || [];
    const spawn = (id, spawning) => ({
        id,
        pos: {
            x: 11, y: 15,
            lookFor(type) {
                if (type === "creeps") return blockers.filter(b => b.isCreep);
                if (type === "powerCreeps") return blockers.filter(b => !b.isCreep);
                return [];
            },
        },
        spawning,
        isActive: () => true,
        // Mirrors the engine contract: an occupied Spawn tile alone does not prevent
        // starting a creep; the engine evaluates placement/egress as part of spawning.
        spawnCreep(body, name, o) {
            world.spawnCalls.push({id, body, name, o});
            return 0;
        },
    });
    const spawns = opts.spawnStates || [null];
    const room = {
        name: "E51S29", my: true, level: 3, spawnFailure: false, spawnedMap: {},
        controller: {owner: {username: "an_w"}},
        spawn: spawns.map((state, i) => spawn(`spawn${i + 1}`, state)),
        getEnergyAvailable: () => 1000,
        currentEnergyAvailable: 1000,
    };
    const sandbox = {
        console: {log() {}},
        Game: {time: 100000, _name_hash: 0},
        Memory: {},
        LOCAL_SHARD_NAME: "shard2",
        LOOK_CREEPS: "creeps",
        LOOK_POWER_CREEPS: "powerCreeps",
        BODYPART_COST: {work: 100, carry: 50, move: 50},
        OK: 0,
        MOVE: "move", WORK: "work", CARRY: "carry",
        Utils: {getBodyEnergyNeed: body => body.length * 50},
    };
    sandbox.global = sandbox;
    // Load only the methods under test: the complete module requires a larger game runtime.
    function extractMethod(signature) {
        const start = source.indexOf(signature);
        assert.ok(start >= 0, `${signature} definition must exist`);
        const open = source.indexOf("{", start);
        let depth = 0, end = -1;
        for (let i = open; i < source.length; i++) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}" && --depth === 0) { end = i; break; }
        }
        assert.ok(end > open, `${signature} body must be closed`);
        return source.slice(start, end + 1);
    }
    const methods = [
        extractMethod("trySpawn(room, targetRoomName, body, role, tasks, ops)"),
        extractMethod("HiveNeedToFill(room)"),
    ];
    vm.runInNewContext("var StationHive = { " + methods.join(", ") + " };", sandbox);
    return {world, room, sandbox};
}

const body = ["work", "carry", "move"];

// An owned creep on the Spawn tile must not be preemptively treated as ERR_BUSY.
{
    const blocker = {my: true, isCreep: true};
    const {world, room, sandbox} = makeWorld({blockers: [blocker]});
    const name = sandbox.StationHive.trySpawn(room, "E51S29", body, "harvestEnergyKeeper", []);
    assert.equal(typeof name, "string", "occupied tile should not prevent a successful spawn attempt");
    assert.equal(world.spawnCalls.length, 1, "spawnCreep should be called for an idle occupied Spawn");
    assert.equal(world.spawnCalls[0].id, "spawn1");
    assert.equal(room.spawnedMap.spawn1, 1, "successful Spawn should be marked used this tick");
    assert.equal(room.spawnFailure, false);
}

// A busy Spawn is skipped; a later idle Spawn remains available for the attempt.
{
    const {world, room, sandbox} = makeWorld({spawnStates: [{name: "busy"}, null]});
    const name = sandbox.StationHive.trySpawn(room, "E51S29", body, "harvestEnergyKeeper", []);
    assert.equal(typeof name, "string");
    assert.equal(world.spawnCalls.length, 1, "only the idle Spawn should be used");
    assert.equal(world.spawnCalls[0].id, "spawn2", "the second free Spawn should be selected");
    assert.equal(room.spawnedMap.spawn1, undefined, "busy Spawn must remain unused");
    assert.equal(room.spawnedMap.spawn2, 1);
}

// A same-tick spawn can consume all 800 energy while the Game snapshot stays stale.
// HiveNeedToFill must use committed energy, then include in-flight hive reservations.
{
    const {room, sandbox} = makeWorld();
    room.energyAvailable = 800;
    room.energyCapacityAvailable = 800;
    room.currentEnergyAvailable = 800;
    const fullCostBody = Array(16).fill("carry");

    sandbox.StationHive.trySpawn(room, "E51S29", fullCostBody, "harvestEnergyKeeper", []);
    assert.equal(room.currentEnergyAvailable, 0, "successful spawn should reserve all 800 energy");
    assert.equal(room.energyAvailable, 800, "Game energy snapshot remains stale in this fixture");

    room.hiveEnergySending = 0;
    assert.equal(sandbox.StationHive.HiveNeedToFill(room), true,
        "committed zero energy should win over the stale Game snapshot");
    room.hiveEnergySending = 800;
    assert.equal(sandbox.StationHive.HiveNeedToFill(room), false,
        "an 800-energy in-flight reservation should suppress redundant filling");
}

console.log("spawn selection handles occupied tiles and busy spawns");
