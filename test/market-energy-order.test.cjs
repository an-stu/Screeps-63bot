const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../modules/strategy_market.js"), "utf8");
const start = source.indexOf("    autoBuyLowRclEnergy() {");
const end = source.indexOf("\n    },", start);
assert.ok(start > 0 && end > start);
const method = `({${source.slice(start, end + 6)}}).autoBuyLowRclEnergy()`;

function setup({history = 0, quotes = {}, active = true} = {}) {
    const orders = {}, writes = [];
    const room = {
        my: true, name: "E41S29", level: 6, energy: 0,
        terminal: {my: true, isActive: () => active},
        controller: {progress: 10, progressTotal: 100},
    };
    const ctx = vm.createContext({
        Game: {market: {
            credits: 1e8, orders,
            createOrder(order) {
                writes.push(["create", order.price, order.totalAmount]);
                orders.self = {...order, id: "self", remainingAmount: order.totalAmount, amount: order.totalAmount};
            },
            changeOrderPrice(id, price) { writes.push(["reprice", price]); orders[id].price = price; },
            extendOrder(id, amount) { writes.push(["extend", amount]); orders[id].remainingAmount += amount; },
            cancelOrder(id) { writes.push(["cancel", id]); delete orders[id]; },
        }},
        ManagerRooms: {getNormalRoom: () => [room]},
        StationCarry: {roomMassStoreCnt: r => r.energy},
        StrategyMarket: {getAllOrdersCacheList: (_, side) => [
            ...(quotes[side] || []), ...Object.values(orders).filter(o => o.type === side),
        ]},
        StrategyMarketPrice: {getResTypeHistory: () => history},
        RESOURCE_ENERGY: "energy", ORDER_BUY: "buy", ORDER_SELL: "sell",
        _: {values: Object.values},
    });
    return {orders, writes, room, run: () => vm.runInContext(method, ctx)};
}

test("market energy order follows real competition without raising its own price", () => {
    const olderBid = {id: "externalBuy", amount: 1000, price: 100};
    const live = setup({history: 70, quotes: {
        buy: [olderBid, {id: "empty", amount: 0, price: 5000}],
        sell: [{id: "externalSell", amount: 1000, price: 75}],
    }});
    live.run();
    assert.deepEqual(live.writes, [["create", 105, 120000]]);
    for (let i = 0; i < 10; i++) live.run();
    assert.equal(live.writes.length, 1, "the live own bid is now the highest quote, not new competition");
    olderBid.price = 120;
    live.run();
    live.run();
    assert.deepEqual(live.writes.at(-1), ["reprice", 126]);
    assert.equal(live.writes.length, 2);
    live.room.energy = 120000;
    live.run();
    assert.deepEqual(live.writes.at(-1), ["cancel", "self"]);
});

test("inactive terminals and empty external books without history do not create energy orders", () => {
    const closed = setup({history: 100, active: false});
    closed.run();
    assert.deepEqual(closed.writes, []);
    const open = setup();
    open.orders.ownAsk = {id: "ownAsk", type: "sell", resourceType: "energy", roomName: "E41S29", price: 5000, amount: 1000};
    open.run();
    assert.deepEqual(open.writes, [], "even a funded and active terminal cannot use its own ask as a quote");
});
