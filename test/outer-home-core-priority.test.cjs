// 外矿必须让位于本房核心：先有正常体型的 home keeper + carrier，才允许外矿派发。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules", "strategy_outerHarvest.js"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const start = src.indexOf("    homeCoreReady(room) {");
const end = src.indexOf("\n    exec(room) {", start);
assert.ok(start >= 0 && end > start, "homeCoreReady 必须可定位");
const method = src.slice(start, end).trim().replace(/,$/, "");

assert.ok(code.includes("if (!pro.homeCoreReady(room)) return;"),
    "StrategyOuterHarvest.exec 必须先通过 homeCoreReady 闸门");

const COST = {work: 100, carry: 50, move: 50};
const ctx = {
    BODYPART_COST: COST, WORK: "work", CARRY: "carry", MOVE: "move",
    Memory: {rooms: {W1N1: {}}},
    StationSources: {
        getHarvesterBodyConfig: () => new Array(6).fill("work"),
    },
    StationCarry: {
        getCarrierBodyConfig: () => ["carry", "carry", "carry", "carry", "move", "move"],
    },
};
vm.runInNewContext(`this.fn = ${method.replace(/^homeCoreReady\(room\) \{/, "function (room) {")};`, ctx);

function body(work, carry, move) {
    return [
        ...new Array(work).fill({type: "work"}),
        ...new Array(carry).fill({type: "carry"}),
        ...new Array(move).fill({type: "move"}),
    ];
}
function keeper(workCount, taskRoom, currentRoom = "W1N1") {
    return {
        body: body(workCount, 1, 2),
        room: {name: currentRoom},
        headTask: () => ({roomName: taskRoom}),
    };
}
function carrier(carryCount, moveCount) {
    return {body: body(0, carryCount, moveCount), room: {name: "W1N1"}, headTask: () => ({roomName: "W1N1"})};
}
function room(keepers, carriers) {
    return {
        name: "W1N1", my: true, level: 6, energyCapacityAvailable: 1850,
        getEnergyCapacityAvailable: () => 1850,
        creeps(role) {
            if (role == "harvestEnergyKeeper") return keepers;
            if (role == "carrier") return carriers;
            return [];
        },
    };
}

assert.equal(ctx.fn(room([keeper(6, "W1N1")], [carrier(4, 2)])), true,
    "满配 home keeper + 本地 carrier 就绪时放行外矿");
assert.equal(ctx.fn(room([keeper(3, "W1N1")], [carrier(4, 2)])), false,
    "home keeper 体型不足（3W < 满配 6W）时暂停外矿");
assert.equal(ctx.fn(room([keeper(6, "W1N1")], [carrier(2, 1)])), false,
    "本地 carrier 体型不足时暂停外矿");
assert.equal(ctx.fn(room([keeper(6, "W2N2", "W2N2")], [carrier(4, 2)])), false,
    "外矿 keeper（任务目标不在本房）不能算作 home keeper");
assert.equal(ctx.fn(room([], [carrier(4, 2)])), false, "没有 home keeper 时暂停外矿");
assert.equal(ctx.fn(room([keeper(6, "W1N1")], [])), false, "没有本地 carrier 时暂停外矿");

console.log("outer home-core priority: OK");