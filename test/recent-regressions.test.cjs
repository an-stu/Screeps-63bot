const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const missionSource = fs.readFileSync(path.join(root, "modules/manager_missions.js"), "utf8");

function loadMissionHandler(store, costRate = 0.2) {
    const sent = [];
    const terminal = {
        cooldown: 0,
        store,
        send(resourceType, amount, roomName) {
            sent.push({ resourceType, amount, roomName });
            return 0;
        }
    };
    const context = {
        console,
        global: null,
        Game: {
            rooms: { W1N1: { my: true, terminal } },
            market: { calcTransactionCost: amount => Math.ceil(amount * costRate) }
        },
        Memory: {},
        RESOURCE_ENERGY: "energy",
        OK: 0
    };
    context.global = context;
    vm.runInNewContext(missionSource, context, { filename: "manager_missions.js" });
    return { sendRes: context.missionFunc.sendRes, sent };
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 1000, X: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "X", amount: 5000 };
    assert.equal(sendRes(data), true);
    assert.equal(sent[0].amount, 5000, "mineral amount must not be reduced by energy transaction cost");
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 600, X: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "X", amount: 5000 };
    assert.equal(sendRes(data), false);
    assert.equal(sent[0].amount, 3000, "mineral send must be capped by available transaction energy");
    assert.equal(data.amount, 2000);
}

{
    const { sendRes, sent } = loadMissionHandler({ energy: 5000 });
    const data = { fromRoomName: "W1N1", toRoomName: "W2N2", resType: "energy", amount: 5000 };
    assert.equal(sendRes(data), false);
    assert.equal(sent[0].amount, 4166, "energy send must reserve energy for its own transaction cost");
    assert.ok(sent[0].amount + Math.ceil(sent[0].amount * 0.2) <= 5000);
}

console.log("recent regression checks passed");
