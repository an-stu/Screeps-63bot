const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "modules/station_observer.js"), "utf8");

function load() {
    const context = {
        Game: {
            time: 1000,
            shard: { name: "shard2" },
            rooms: {},
            map: { getRoomLinearDistance: () => 1 },
        },
        Memory: { rooms: {}, observerWatch: {} },
        _: { values: Object.values },
        OK: 0,
        global: null,
    };
    context.global = context;
    vm.runInNewContext(source, context, { filename: "station_observer.js" });
    return context;
}

// A normally visible room is skipped, while a forced same-shard request still
// queues against the selected owned observer.
{
    const ctx = load();
    const target = "E50S30";
    const observerRoom = { name: "E49S30", my: true, observer: { id: "observer-1" } };
    ctx.Game.rooms[target] = {};
    ctx.Game.rooms[observerRoom.name] = observerRoom;

    assert.equal(ctx.StationObserver.requestRoom(target, observerRoom.name), observerRoom.name,
        "an already-visible room keeps the existing no-op behavior");
    assert.equal(ctx.StationObserver.PriorityObserveRoomQueue["observer-1"], undefined,
        "ordinary visible-room requests must not enqueue");

    assert.equal(ctx.StationObserver.requestRoom(target, observerRoom.name, true), observerRoom.name,
        "force allows the observer to request an otherwise visible target");
    assert.equal(JSON.stringify(ctx.StationObserver.PriorityObserveRoomQueue["observer-1"]), JSON.stringify([target]),
        "the forced target is queued on the selected observer");
}

// The observation callback records the concrete observer room and next-tick
// vision time only after the engine accepts the observeRoom request.
{
    const ctx = load();
    const target = "E50S30";
    const records = [];
    ctx.StrategyNpcConvoy = {
        watches: roomName => roomName === target,
        recordObservation: (...args) => records.push(args),
    };
    const observerRoom = {
        name: "E49S30",
        memory: {},
        observer: { id: "observer-2", observeRoom: roomName => roomName === target ? 0 : -1 },
    };
    ctx.StationObserver.PriorityObserveRoomQueue["observer-2"] = [target];

    ctx.StationObserver.obOverRooms(observerRoom);

    assert.equal(records.length, 1, "a successful watched request must record provenance once");
    assert.equal(records[0][0], observerRoom, "provenance must use the actual observer room object");
    assert.equal(records[0][1], target, "provenance must retain the observed room name");
    assert.equal(records[0][2], ctx.Game.time + 1, "provenance must use the expected visible tick");
    assert.equal(observerRoom.memory.stationObserver.lastRoomName, target,
        "the legacy observation-result handoff remains intact");
}

console.log("npc convoy observer integration checks passed");
