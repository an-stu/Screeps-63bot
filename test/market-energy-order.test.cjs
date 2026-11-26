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

function loadTerminalHelpers(ctx) {
    const helpers = source.slice(source.indexOf("function isTerminalMarketOrder"), source.indexOf("let getSeriesMap"));
    const start = source.indexOf("    convergeBuyOrders() {");
    const end = source.indexOf("    commodityBuysPaused() {", start);
    vm.runInContext(`${helpers}\nconst market = ({${source.slice(start, end)}});`, ctx);
}

test("market pause and deduplication both preserve account-bound orders", () => {
    const roomOrder = (id, type, resourceType, remainingAmount) => ({id, type, resourceType, remainingAmount, roomName: "E41S29"});
    const orders = {
        low: roomOrder("low", "buy", "Z", 100),
        high: roomOrder("high", "buy", "Z", 200),
        energy: roomOrder("energy", "buy", "energy", 500),
        sale: roomOrder("sale", "sell", "Z", 100),
        unlock: {id: "unlock", type: "buy", resourceType: "cpuUnlock", remainingAmount: 20},
        otherUnlock: {id: "otherUnlock", type: "buy", resourceType: "cpuUnlock", remainingAmount: 5},
        pixel: {id: "pixel", type: "buy", resourceType: "pixel", remainingAmount: 3, roomName: "undefined"},
    };
    const canceled = [];
    const ctx = vm.createContext({
        Game: {time: 123, market: {orders, cancelOrder(id) { canceled.push(id); delete orders[id]; }}},
        Logger: {log() {}}, _: {values: Object.values}, ORDER_BUY: "buy", RESOURCE_ENERGY: "energy",
    });
    loadTerminalHelpers(ctx);
    vm.runInContext("market.convergeBuyOrders(); market.pauseCommodityBuys();", ctx);
    assert.deepEqual(canceled, ["low", "high"]);
    assert.deepEqual(Object.keys(orders), ["energy", "sale", "unlock", "otherUnlock", "pixel"]);
});

test("commodity scan selects a viable owned terminal on the current shard", () => {
    function room(name, {active = true, free = 50000, my = true, factory = false} = {}) {
        return {name, my, storage: {}, factory: factory ? {my: true} : undefined,
            terminal: {my, isActive: () => active, store: {getFreeCapacity: () => free}}};
    }
    const ctx = vm.createContext({});
    loadTerminalHelpers(ctx);
    const local = room("E41S29");
    const full = room("E51S29", {free: 49999});
    const inactive = room("E41S23", {active: false});
    const foreign = room("E40S30", {my: false});
    const prefer = room("E41S23");
    const factory = room("E56S29", {factory: true});
    const pick = rooms => { ctx.rooms = rooms; return vm.runInContext("selectCommodityMarketRoom(rooms)?.name", ctx); };
    assert.equal(pick([full, inactive, foreign]), undefined);
    assert.equal(pick([full, inactive, foreign, local]), "E41S29");
    assert.equal(pick([local, factory]), "E56S29");
    assert.equal(pick([local, factory, prefer]), "E41S23");
});
