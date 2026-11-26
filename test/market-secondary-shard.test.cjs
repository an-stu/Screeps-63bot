const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../modules/strategy_market.js"), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function mkRoom(name, {storage = {}, terminal = {}, active = true, cooldown = 0, carrier} = {}) {
    return {name, my:true, storage:{store:storage}, terminal:{my:true, cooldown,
        isActive:() => active, store:{getFreeCapacity:() => 300000, ...terminal}},
        creeps:() => carrier ? [carrier] : []};
}

function makeMarket({rooms = [], orders = {}, asks = [], bids = [], credits = 1000000, history = 200} = {}) {
    const deals = [];
    const ctx = vm.createContext({
        Game:{time:81, _pauseCommodityBuysTick:81, shard:{name:"shard2"}, market:{
            orders, credits, calcTransactionCost:(n,_from,to) => Math.ceil(n * (to === "W1N1" ? 0.05 : 0.8)),
            deal:(id,n,room) => { deals.push([id,n,room]); return 0; },
        }},
        Memory:{}, StrategyMarketPrice:{getHistory:() => [{volume:1000,avgPrice:history}],getResTypeHistory:k=>k==="energy"?100:history},
        StationCarry:{roomMassStoreCnt:(room,k)=>(room.storage?.store[k]||0)+(room.terminal?.store[k]||0)},
        ManagerRooms:{getNormalRoom:() => rooms}, UtilsTask:{task:(_obj,type,_a,data)=>({type,...data})},
        Logger:{info() {}}, ORDER_BUY:"buy", ORDER_SELL:"sell", RESOURCE_ENERGY:"energy", OK:0,
        getOrders:(_res,side)=>side==="sell"?asks:bids,
    });
    vm.runInContext(`${section("function isTerminalMarketOrder", "let getSeriesMap")}
        const pro = {getAllOrdersCacheList: getOrders,
            ${section("    tryLocalMineralDeal(", "    autoBuyMineral(")}
            ${section("    autoSellLocalMineral(", "    autoSellMineral(")}
        };`, ctx);
    const call = (method, ...args) => { ctx.args = args; return vm.runInContext(`pro.${method}(...args)`,ctx); };
    return {deals, call};
}

test("ordinary stock buys on the funded terminal even when a young room pauses commodities", () => {
    const own = mkRoom("E41S29", {storage:{energy:85000}, terminal:{energy:5500}});
    const low = mkRoom("E51S29", {terminal:{energy:22000}});
    const inactive = mkRoom("E44S29", {storage:{energy:100000}, terminal:{energy:9500}, active:false});
    const missing = {name:"E58S26", my:true};
    const {call, deals} = makeMarket({rooms:[missing, low, inactive, own],
        orders:{self:{id:"self",roomName:"E55S31", resourceType:"H", remainingAmount:1000}},
        asks:[{id:"self",roomName:"W1N1", price:1, amount:1000},
            {id:"distant",roomName:"W0N0", price:165, amount:1000},
            {id:"near",roomName:"W1N1", price:199, amount:4000}]});
    call("autoBuyLocalMineral","H");
    assert.deepEqual(deals, [["near",1000,"E41S29"]], "all-in price, not listed price, wins");
    call("autoBuyLocalMineral","H");
    assert.equal(deals.length, 1, "only one deal per terminal per tick");
});

test("never overspends credits, uses the terminal reserve or buys above the all-in cap", () => {
    for (const [input, expected] of [
        [{terminalEnergy:2160, price:160, credits:1000000}, 200],
        [{terminalEnergy:8500, price:160, credits:32000}, 200],
        [{terminalEnergy:8500, price:180, credits:1000000}, 0],
        [{terminalEnergy:2000, price:160, credits:1000000}, 0],
    ]) {
        const room = mkRoom("E41S29",{storage:{energy:85000}, terminal:{energy:input.terminalEnergy}});
        const d = makeMarket({rooms:[room], credits:input.credits,
            asks:[{id:"ask",roomName:"W0N0",price:input.price,amount:1000}]});
        d.call("autoBuyLocalMineral","H");
        assert.equal(d.deals[0]?.[1]||0, expected);
    }
});

test("surplus sales use net bids, never cross the reserve, and leave manual orders alone", () => {
    const room = mkRoom("E41S29", {storage:{Z:19800}, terminal:{energy:8100,Z:700}});
    const bids = [{id:"bad",roomName:"W0N0",price:250,amount:1000},
        {id:"good",roomName:"W1N1",price:215,amount:2000}];
    const sell = makeMarket({bids});
    assert.equal(sell.call("autoSellLocalMineral",room), true);
    assert.deepEqual(sell.deals, [["good",500,"E41S29"]]);
    const manual = makeMarket({bids,orders:{own:{id:"own",roomName:room.name,resourceType:"Z",remainingAmount:1000}}});
    assert.equal(manual.call("autoSellLocalMineral",mkRoom(room.name,{storage:{Z:50000},terminal:{Z:3000,energy:5000}})), false);
    assert.deepEqual(manual.deals,[]);
    const thin = makeMarket({bids});
    assert.equal(thin.call("autoSellLocalMineral",mkRoom(room.name,{storage:{Z:4000},terminal:{Z:2000,energy:5000}})), false);
});
