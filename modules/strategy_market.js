/*

StrategyMarket.showAllRes()
 */

// 以下这两个需要两两对应
let RES_BUY_AMOUNT_ROOM = {};// storage 数量少于多少挂单买入
let RES_BUY_MAX_PRICE_ROOM = {};// 价格少于多少挂单买入
let RES_BUY_MIN_HOLD_ROOM = {};// 全局库存少于多少买入
let BLUE = [RESOURCE_DEVICE,RESOURCE_CIRCUIT,RESOURCE_MICROCHIP,RESOURCE_TRANSISTOR,RESOURCE_SWITCH,RESOURCE_WIRE];
let YELLOW = [RESOURCE_MACHINE,RESOURCE_HYDRAULICS,RESOURCE_FRAME,RESOURCE_FIXTURES,RESOURCE_TUBE,RESOURCE_ALLOY];
let PINK = [RESOURCE_ESSENCE,RESOURCE_EMANATION,RESOURCE_SPIRIT,RESOURCE_EXTRACT,RESOURCE_CONCENTRATE,RESOURCE_CONDENSATE];
let GREEN = [RESOURCE_ORGANISM,RESOURCE_ORGANOID,RESOURCE_MUSCLE,RESOURCE_TISSUE,RESOURCE_PHLEGM,RESOURCE_CELL];
(function () {

    for (let e of [RESOURCE_BIOMASS, RESOURCE_SILICON, RESOURCE_METAL, RESOURCE_MIST, RESOURCE_WIRE, RESOURCE_ALLOY, RESOURCE_CONDENSATE, RESOURCE_CELL]) {
        RES_BUY_MAX_PRICE_ROOM[e] = 0.01
        RES_BUY_MIN_HOLD_ROOM[e] = 300000 // 0.3m
        RES_BUY_AMOUNT_ROOM[e] = 100000;
    }
    // if(Game.shard.name == "shard3"){
    //
    //     RES_BUY_MAX_PRICE_ROOM[RESOURCE_SILICON] = 0.01
    //     RES_BUY_MIN_HOLD_ROOM[RESOURCE_SILICON] = 300000 // 0.3m
    //     RES_BUY_AMOUNT_ROOM[RESOURCE_SILICON] = 100000;
    //
    //     RES_BUY_MAX_PRICE_ROOM[RESOURCE_METAL] = 0.01
    //     RES_BUY_MIN_HOLD_ROOM[RESOURCE_METAL] = 300000 // 0.3m
    //     RES_BUY_AMOUNT_ROOM[RESOURCE_METAL] = 100000;
    //
    //     RES_BUY_MAX_PRICE_ROOM[RESOURCE_MIST] = 0.01
    //     RES_BUY_MIN_HOLD_ROOM[RESOURCE_MIST] = 300000 // 0.3m
    //     RES_BUY_AMOUNT_ROOM[RESOURCE_MIST] = 100000;
    //
    // }


    // 化合物
    (["O", "L", "H", "X", "K", "Z", "U"]).forEach(e => {
        RES_BUY_AMOUNT_ROOM[e] = 12000
        RES_BUY_MAX_PRICE_ROOM[e] = 3
        RES_BUY_MIN_HOLD_ROOM[e] = 100000 // 0.1m
    })
    RES_BUY_MAX_PRICE_ROOM["X"] = 6

    // 电池
    // RES_BUY_MAX_PRICE_ROOM[RESOURCE_BATTERY] = 5
    // RES_BUY_AMOUNT_ROOM[RESOURCE_BATTERY] = 12000
    // RES_BUY_MIN_HOLD_ROOM[RESOURCE_BATTERY] = 100000 // 0.1m

    // OPs
    RES_BUY_MAX_PRICE_ROOM[RESOURCE_OPS] = 1
    RES_BUY_AMOUNT_ROOM[RESOURCE_OPS] = 12000
    RES_BUY_MIN_HOLD_ROOM[RESOURCE_OPS] = 100000 // 0.1m

})();

let getSeriesMap = function() {
    return {
        "blue": BLUE,
        "yellow": YELLOW, 
        "pink": PINK,
        "green": GREEN
    };
};

// let ON_SALE = (function () { //设置卖的东西的最大值 强制设置这个，否则按历史算
//     if (Game.shard.name == "shard3") return StrategyMarketPrice._depoMinSellPrice;
//     // if (Game.shard.name == "shard3") return {
//     //     [RESOURCE_WIRE]: 23000,
//     //     [RESOURCE_SWITCH]: 250000,
//     //     [RESOURCE_TRANSISTOR]: 1800000,
//     //     [RESOURCE_MICROCHIP]: 6906164,
//     //     [RESOURCE_CIRCUIT]: 9502871,
//     //     [RESOURCE_DEVICE]: 12006503,
//     //     [RESOURCE_CELL]: 46000,
//     //     [RESOURCE_PHLEGM]:660000,
//     //     [RESOURCE_TISSUE]:3800000,
//     //     [RESOURCE_MUSCLE]:20600000,
//     //     [RESOURCE_ORGANOID]: 27000000,
//     //     [RESOURCE_ORGANISM]: 29000000,
//     //     [RESOURCE_MACHINE]: 7400000,
//     //     [RESOURCE_ESSENCE]: 22000000
//     // };
//     // if(Game.shard.name == "Screeps.Cc")return{
//     //     [RESOURCE_CIRCUIT]:19000,
//     //     [RESOURCE_HYDRAULICS]:19000,
//     //     [RESOURCE_EMANATION]:19000,
//     //     [RESOURCE_ORGANOID]:19000,
//     // };

//     return {}
// })();
let ON_SALE = {};

let allRoomRes = { updateTime: 0 }
let MARKET_SELL_PRICE_TTL = 1000;
let MARKET_ORDER_TTL = 100;
let MARKET_MAX_COMMODITY_DEAL = 10000;
let MARKET_MIN_COMMODITY_DEAL = 100;
let sellPriceCache = {updateTime:-1e9,prices:{},bestCommodities:{}};
let orderCache = {};


// global.MAX_PIXEL_PRICE = 5836
global.MIN_PIXEL_HAS_CR = 50000000
global.MAX_PIXEL_AMOUNT = 100


let pro = {
    addStore: (store, b) => { for (let v in b) if (b[v] > 0) store[v] = (store[v] || 0) + b[v]; return store },
    getStorageTerminalRes(room) {
        let store = {};
        if (room.storage) pro.addStore(store, room.storage.store)
        if (room.terminal) pro.addStore(store, room.terminal.store)
        // if(room.factory)pro.addStore(store,room.factory.store)
        return store
    },
    getMyAllRoomRes() {
        let rooms = ManagerRooms.getNormalRoom().filter(e => e.storage || e.terminal);
        let all = rooms.reduce((all, room) => pro.addStore(all, pro.getStorageTerminalRes(room)), {});
        return all;
    },
    getOnSellPrice() {
        if (Game.time - sellPriceCache.updateTime < MARKET_SELL_PRICE_TTL) return sellPriceCache.prices;
    
    // 获取最佳商品
    let bestCommodities = pro.getBestCommoditiesToSell();
    let out = {};
    
    // 添加最佳商品
    for (let resType in bestCommodities) {
        out[resType] = bestCommodities[resType].price;
    }
    
    // 合并强制售卖的商品（ON_SALE）
    for (let k in ON_SALE) {
        out[k] = ON_SALE[k];
    }
    
    // 缓存结果
    sellPriceCache = {
        prices: out,
        bestCommodities: bestCommodities,
        updateTime: Game.time
    };
    
    return out;
    },
    getAllOrdersCacheList(resourceType, type) {
        let key = type+":"+resourceType;
        let cached = orderCache[key];
        if(cached && Game.time-cached.time < MARKET_ORDER_TTL)return cached.orders;
        let orders = Game.market.getAllOrders({ type: type, resourceType: resourceType }) || [];
        orderCache[key] = {time:Game.time,orders:orders};
        return orders;
    },
    autoBuy() {
        // 调用频率由 main.js 的 shouldRun(100, 19) 控制（Game.time%100==81）。
        // 早期这里的 `(Game.time)%100==0` 检查与调用偏移互斥，导致
        // autoBuyMineral 从未执行、lab 原料永不买入——故不再内部限频。
        _.values(Game.market.orders).filter(e => !e.remainingAmount).forEach(e => Game.market.cancelOrder(e.id));
        if (Game.shard.name.startsWith("shard")) {
            // pro.autoBuyEnergy();
            if (Game.market.credits > 2000000 && Memory.stats.buyEnergy) {
                pro.autoBuyEnergy();
            }
            // pro.autoBuyPower();
            // 自动买depo
            // if (Game.shard.name.startsWith("shard2")) {
            //     let depoBuyPriceMap = StrategyMarketPrice.getAutoBuyDepoPrice();
            //     for (let resType in depoBuyPriceMap) {
            //         RES_BUY_MAX_PRICE_ROOM[resType] = depoBuyPriceMap[resType]
            //         pro.autoBuyDepo(resType, depoBuyPriceMap[resType])
            //     }
            // }
        }
        ["U", "L", "K", "Z", "X", "O", "H"].forEach(e => pro.autoBuyMineral(e));
        // 利润套利：买入利润率超阈值商品的展开基础原料，供工厂合成后售卖
        pro.autoBuyHighProfitComponents();
        // if((Game.time)%3==0)pro.autoBuyPixel();
    },
    /**
     * 利润驱动买入：从商品利润分析中挑出利润率 ≥ threshold 的商品
     * （默认 1000%，Memory.marketSettings.highProfitMargin 可调），
     * 把其展开后的基础原料（depo 基础品/bar/原矿）买到有 OPF 工厂的
     * 房间，工厂 highLevel/noLevel 会逐级合成，成品由 getOnSellPrice
     * 自动挂卖单。注意按利润率而非等级挑选——同等级商品利润差异巨大
     * （如 level5 的 organism +1694% vs essence +431%）。
     */
    autoBuyHighProfitComponents() {
        if (!global.StrategyMarketPrice || !global.StrategyFactoryPowerCreep) return;
        let threshold = Number(Memory.marketSettings && Memory.marketSettings.highProfitMargin || 1000);
        let analysis = StrategyMarketPrice.calculateAllCommoditiesProfit();
        if (!analysis || !analysis.commodities) return;
        // 按利润率降序，只保留达标商品
        let candidates = Object.keys(analysis.commodities)
            .map(k => [k, analysis.commodities[k]])
            .filter(([k, d]) => d.profitMargin >= threshold && d.marketPrice > 0)
            .sort((a, b) => b[1].profitMargin - a[1].profitMargin);
        if (!candidates.length) return;
        // 工厂房间：有 OPF 旗子且 power creep 在位能运营工厂的房间
        let factoryRooms = ManagerFlags.getFlagsByPrefix("OPF")
            .map(f => Game.rooms[f.pos.roomName])
            .filter(r => r && r.my && r.storage && r.terminal
                && StrategyFactoryPowerCreep.getPowerFactoryLevel(r));
        Memory.diagBuy = {
            t: Game.time,
            candidates: candidates.slice(0, 3).map(([k, d]) => k + ":" + Math.round(d.profitMargin)),
            factoryRooms: factoryRooms.map(r => r.name),
            credits: Game.market.credits,
        };
        if (!factoryRooms.length) return;
        // 每个商品最多挑前 2 个利润最高的处理，控制买入品种数量
        candidates.slice(0, 2).forEach(([resType, data]) => {
            let needLevel = data.level;
            let components = data.components || {};
            factoryRooms.forEach(room => {
                let level = StrategyFactoryPowerCreep.getPowerFactoryLevel(room) || 0;
                if (needLevel > level) return; // 该房间工厂等级不足以合成
                // 原料缺口：备 10 批（按单批 amount 折算），已有存量扣减
                for (let comp in components) {
                    let need = components[comp] * 10;
                    let have = StationCarry.roomMassStoreCnt(room, comp);
                    let gap = Math.max(0, need - have);
                    if (gap < 1000) continue;
                    let price = StrategyMarketPrice.getResTypeHistory(comp);
                    if (!price || price <= 0) price = 0.01;
                    // 已有该房间该原料买单则跳过（防止重复挂单）
                    let hasBuyOrder = _.values(Game.market.orders).some(e => e.remainingAmount > 0
                        && e.resourceType == comp && e.type == ORDER_BUY && e.roomName == room.name);
                    if (hasBuyOrder) continue;
                    let isBuy = pro.buySome(room, comp, price * 1.2, Math.min(gap, 30000));
                    if (!isBuy && Game.market.credits > 100000) {
                        Game.market.createOrder({
                            type: ORDER_BUY,
                            resourceType: comp,
                            price: price,
                            totalAmount: Math.min(gap, 30000),
                            roomName: room.name,
                        });
                        console.log(`[buyHighProfit] ${room.name} ${comp} ${Math.min(gap, 30000)} @ ${price} for ${resType}`);
                    }
                }
            });
        });
    },
    autoBuyDepo(resType, maxPrice, maxCnt = 10000) {
        let room = _.shuffle(ManagerRooms.getNormalRoom().filter(e => e.storage && e.terminal)).head();//随机一个房间
        if (!Game.market.dealed) Game.market.dealed = {}
        let sellList = pro.getAllOrdersCacheList(resType, ORDER_SELL)
        let minPrice = 1e300;
        let minOrder = undefined;
        let energyPrice = StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)
        for (let order of sellList) {
            if (Game.market.dealed[order.id]) continue;
            let energyNeed = Game.market.calcTransactionCost(order.amount, room.name, order.roomName);
            let totalPrice = energyNeed * energyPrice + order.amount * order.price;
            let price = totalPrice / order.amount;
            if (price < minPrice) {
                minOrder = order;
                minPrice = price;
            }
        }
        // log(minPrice,room.name)
        if (minOrder && minPrice <= maxPrice) {
            let buyAmount = Math.min(minOrder.amount, maxCnt)
            let code = Game.market.deal(minOrder.id, buyAmount, room.name);
            if (code == OK) {
                console.log("buy depo: ", resType, buyAmount, minPrice, minOrder.id, code, room.name);
                Game.market.dealed[minOrder.id] = true;
                return true
            }
        }

        // 这里是自动下单的
        let buyCnt = 1500;
        let order = _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == resType && e.type == ORDER_BUY && e.remainingAmount <= buyCnt).maxBy(e => e.price)
        let otherOrder = StrategyMarket.getAllOrdersCacheList(resType, ORDER_BUY).maxBy(e => e.price)
        let buyPrice = Math.max(otherOrder ? otherOrder.price : 0, maxPrice * 0.6)
        if (order) {
            if (buyPrice < maxPrice)
                Game.market.changeOrderPrice(order.id, buyPrice + 0.001)
        } else if (buyPrice < maxPrice) {
            Game.market.createOrder({
                type: ORDER_BUY,
                resourceType: resType,
                price: buyPrice,
                totalAmount: buyCnt,
                roomName: room.name,
            })
        }

    },
    autoBuyEnergy() {
        // if(Game.shard.name=="shard3"){
        // (function(){
        let myRoomSet = ManagerRooms.getNormalRoom().map(e => e.name).toSet()
        let myRooms = _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == "energy")
            .map(e => e.roomName).filter(e => myRoomSet.has(e)).toSet();
        if (!Memory.market) Memory.market = {}; // 记录价格
        let changed = {} // 记录哪些是改过价格的

        let avg = StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)
        let maxOrderPrice = StrategyMarket.getAllOrdersCacheList(RESOURCE_ENERGY, ORDER_BUY).maxBy(e => e.price)
        maxOrderPrice = maxOrderPrice && maxOrderPrice.price || avg
        _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == "energy" && e.type == ORDER_BUY).forEach(e => {
            if (myRoomSet.has(e.roomName)) {
                let energyCnt = StationCarry.roomMassStoreCnt(Game.rooms[e.roomName], RESOURCE_ENERGY)
                if ((energyCnt < 210000 && Game.rooms[e.roomName].level == 8) || (energyCnt < 250000 && Game.rooms[e.roomName].level < 8)) {
                    let newPrice = Math.min(e.price * (energyCnt > 170000 ? 1.005 : (energyCnt > 120000 ? 1.01 : 1.025)), avg * 5);
                    // newPrice = Math.min(newPrice, 20);
                    Game.market.changeOrderPrice(e.id, newPrice)
                    Memory.market[e.roomName] = newPrice;
                }
                changed[e.roomName] = true
            }
        })
        for (let roomName in Memory.market) {
            if (!Game.rooms[roomName]) delete Memory.market[roomName]
        }
        ManagerRooms.getNormalRoom().filter(e => !myRooms.has(e.name) && e.terminal).map(room => {
            let energyCnt = StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY)
            let powerCnt = StationCarry.roomMassStoreCnt(room, RESOURCE_POWER)
            if ((energyCnt < 220000 && powerCnt >= 6000) || (energyCnt < 210000 && room.level == 8) || (energyCnt < 250000 && room.level < 8)) {
                let price = Math.min(Memory.market[room.name] || avg, maxOrderPrice * 1.1);//限定最大值，从价格开始
                Game.market.createOrder({
                    type: ORDER_BUY,
                    resourceType: RESOURCE_ENERGY,
                    price: price * (energyCnt > 150000 ? 0.90 : 0.94),
                    totalAmount: 240000 - energyCnt,
                    roomName: room.name,
                })
            }
        });
        // })();
        // }
    },
    /**
     * @param room
     * @param resType
     * @param maxPrice
     * @param maxCnt
     * @return {boolean} true 代表下单成功
     */
    buySome(room, resType, maxPrice, maxCnt = 10000) {
        if (!Game.market.dealed) Game.market.dealed = {}
        let sellList = pro.getAllOrdersCacheList(resType, ORDER_SELL)
        let minPrice = 1e300;
        let minOrder = undefined;
        let energyPrice = StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)
        for (let order of sellList) {
            if (Game.market.dealed[order.id]) continue;
            let energyNeed = Game.market.calcTransactionCost(order.amount, room.name, order.roomName);
            let totalPrice = energyNeed * energyPrice + order.amount * order.price;
            let price = totalPrice / order.amount;
            if (price < minPrice) {
                minOrder = order;
                minPrice = price;
            }
        }
        // log(minPrice,room.name)
        if (minOrder && minPrice <= maxPrice) {
            let buyAmount = Math.min(minOrder.amount, maxCnt)
            let code = Game.market.deal(minOrder.id, buyAmount, room.name);
            if (code == OK) {
                console.log("buy some: ", resType, buyAmount, minPrice, minOrder.id, code, room.name);
                Game.market.dealed[minOrder.id] = true;
                return true
            }
        }
    },
    autoBuyPower() {
        let myRoomSet = ManagerRooms.getNormalRoom().map(e => e.name).toSet()
        let myRooms = _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == RESOURCE_POWER)
            .map(e => e.roomName).filter(e => myRoomSet.has(e)).toSet();
        let maxPrice = StrategyMarket.getAllOrdersCacheList(RESOURCE_POWER, ORDER_BUY)
            .filter(e => !myRoomSet.has(e))
            .map(e => e.price).maxBy(e => e) || 0
        maxPrice += StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)
        if (maxPrice > 2200) maxPrice = 2200;
        _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == RESOURCE_POWER && e.type == ORDER_BUY).forEach(e => {
            Game.market.changeOrderPrice(e.id, maxPrice)
        });

        ManagerRooms.getNormalRoom().filter(e => !myRooms.has(e.name) && e.terminal).map(room => {
            let energyCnt = StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY)
            let powerCnt = StationCarry.roomMassStoreCnt(room, RESOURCE_POWER)
            if (energyCnt > 250000 && powerCnt <= 1000) {
                let isBuy = pro.buySome(room, RESOURCE_POWER, maxPrice * 1.05, 3000)
                if (!isBuy) Game.market.createOrder({
                    type: ORDER_BUY,
                    resourceType: RESOURCE_POWER,
                    price: maxPrice,
                    totalAmount: 3000,
                    roomName: room.name,
                })
            }
        });
    },
    /**
     *
     * @param resType
     * @param buyCnt 买的个数 默认 6000
     */
    autoBuySome(resType, buyCnt = 6000) {
        let myRoomSet = ManagerRooms.getNormalRoom().map(e => e.name).toSet()
        let myRooms = _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == resType && e.remainingAmount <= buyCnt)
            .map(e => e.roomName).filter(e => myRoomSet.has(e)).toSet();
        let maxPrice = StrategyMarket.getAllOrdersCacheList(resType, ORDER_BUY)
            .filter(e => !myRoomSet.has(e))
            .map(e => e.price).maxBy(e => e) || 0
        maxPrice += StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY) * 0.1
        _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == resType && e.remainingAmount <= buyCnt).forEach(e => {
            Game.market.changeOrderPrice(e.id, maxPrice)
        });

        ManagerRooms.getNormalRoom().filter(e => !myRooms.has(e.name) && e.terminal).map(room => {
            let resCnt = StationCarry.roomMassStoreCnt(room, resType)
            if (resCnt <= 3000) {
                let isBuy = pro.buySome(room, resType, maxPrice * 1.05, buyCnt)
                if (!isBuy) Game.market.createOrder({
                    type: ORDER_BUY,
                    resourceType: resType,
                    price: maxPrice,
                    totalAmount: buyCnt,
                    roomName: room.name,
                })
            }
        });
    },
    autoBuyMineral(resType) {
        // Game.* 每 tick 重置，缓存必须放在 global 并按 tick 校验
        if (!global._resCnt) global._resCnt = { tick: -1 };
        if (global._resCnt.tick != Game.time || global._resCnt[resType] == null) {
            global._resCnt[resType] = ManagerRooms.getNormalRoom().map(e => StationCarry.roomMassStoreCnt(e, resType)).sum();
            global._resCnt.tick = Game.time;
        }
        // 普通需求：每房 6000 + 1 万缓冲。lab 反应原料额外加需求：
        // 若存在 lab 房间且该矿物是合成原料（BOOST_RES_HOLD 折算），
        // 买入线提高到 lab 需要量，保证反应能持续进行
        let labRooms = ManagerRooms.getNormalRoom().filter(e => e.memory.stationLab
            && e.memory.stationLab.centerLabs && e.memory.stationLab.centerLabs.length >= 2);
        let labNeed = 0;
        if (labRooms.length) {
            let hold = global.BOOST_RES_HOLD || {};
            for (let prod in hold) {
                let comps = (global.LAB_REACTIONS && global.LAB_REACTIONS[prod]) || [];
                if (comps[0] == resType || comps[1] == resType) labNeed += hold[prod] / 2;
            }
            labNeed = Math.min(labNeed, 300000);
        }
        let need = ManagerRooms.getNormalRoom().length * 6000 + 10000 + labNeed;
        if (global._resCnt[resType] >= need) return;//如果资源有剩下就不买,从别的房间拿

        let buyCnt = Math.min(need - global._resCnt[resType], 30000)
        let myRoomSet = ManagerRooms.getNormalRoom().map(e => e.name).toSet()
        let myRooms = _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == resType && e.remainingAmount <= buyCnt)
            .map(e => e.roomName).filter(e => myRoomSet.has(e)).toSet();
        let maxPrice = StrategyMarket.getAllOrdersCacheList(resType, ORDER_BUY)
            .filter(e => !myRoomSet.has(e))
            .map(e => e.price).maxBy(e => e) || 0
        maxPrice += StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY) * 0.1
        // lab 缺原料时酌情加价到历史价水平，否则挂单永远等不到卖单
        if (labNeed > 0 && global._resCnt[resType] < labRooms.length * 6000) {
            let ref = StrategyMarketPrice.getResTypeHistory(resType)
            maxPrice = Math.max(maxPrice, ref * 0.95)
        }
        _.values(Game.market.orders).filter(e => e.remainingAmount && e.resourceType == resType && e.remainingAmount <= buyCnt).forEach(e => {
            Game.market.changeOrderPrice(e.id, maxPrice)
        });

        ManagerRooms.getNormalRoom().filter(e => !myRooms.has(e.name) && e.terminal).map(room => {
            let resCnt = StationCarry.roomMassStoreCnt(room, resType)
            if (resCnt <= 6000) {
                let isBuy = pro.buySome(room, resType, maxPrice * 1.05, buyCnt)
                if (!isBuy) Game.market.createOrder({
                    type: ORDER_BUY,
                    resourceType: resType,
                    price: maxPrice,
                    totalAmount: buyCnt,
                    roomName: room.name,
                })
            }
        });

        let bar = { "U": "utrium_bar", "L": "lemergium_bar", "K": "keanium_bar", "Z": "zynthium_bar", "X": "purifier", "O": "oxidant", "H": "reductant" }
        let barResType = bar[resType]
        let barPrice = maxPrice * 5 + StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)
        let barMaxPrice = StrategyMarket.getAllOrdersCacheList(barResType, ORDER_BUY).filter(e => !myRoomSet.has(e)).map(e => e.price).maxBy(e => e) || 0;
        if (barMaxPrice < barPrice) StrategyMarket.autoBuySome(barResType, 3000)
    },
    autoBuyPixel() {
        if (Game.market.credits < MIN_PIXEL_HAS_CR) return;// 如果没什么钱的时候不卖
        let myMax = _.values(Game.market.orders)
            .filter(e => e.remainingAmount <= 100 && e.remainingAmount > 0 && e.resourceType == PIXEL)
            .maxBy(e => e.price);
        let marketMax = Game.market.getAllOrders({ type: ORDER_BUY, resourceType: PIXEL })
            .filter(e => e.id != (myMax ? myMax.id : null) && e.amount).maxBy(e => e.price);
        let maxPrice = Game.market.credits / 100000
        if (marketMax && marketMax.price > maxPrice) return;// 如果价格太高不买
        if (myMax && !marketMax) return;// 如果只剩下自己的订单不做操作
        let gap = Math.min(Math.max(0, (marketMax.price || 0) - (pro.lastPixelPrice || marketMax.price)) * 1.414, 100)
        if (!myMax || myMax.price <= (marketMax.price || 0) + gap + 0.01) {// 如果自己是最高价不改价格
            let price = (marketMax ? marketMax.price : 0) + gap + Math.random() * gap + 0.001
            if (myMax) {
                Game.market.changeOrderPrice(myMax.id, price);
            } else {
                Game.market.createOrder({
                    type: ORDER_BUY,
                    resourceType: PIXEL,
                    price: price, totalAmount: 13,
                })
            }
        }
        pro.lastPixelPrice = (marketMax.price || 0)
    },
    // add by an_w
    /**
     * @param roomName
     * @param price
     * @param resType
     * @param amount
     */
    sell(roomName, price, resType, amount) {
        let room = Game.rooms[roomName];
        if (!room || !room.terminal || !room.terminal.my) return;
        if (!resType) {
            resType = Object.keys(room.terminal.store).filter(e => e != RESOURCE_ENERGY).maxBy(e => room.storage.store[e]);
        }
        if (!amount) {
            amount = room.storage.store[resType] > 50000 ? 50000 : room.terminal.store[resType] / 2;
        }
        if (!price) {
            price = StrategyMarketPrice.getResTypeHistory(resType) * 1.1;
        }
        let code = Game.market.createOrder({
            type: ORDER_SELL,
            resourceType: resType,
            price: price,
            totalAmount: amount,
            roomName: roomName,
        })
        return code;
    },
    autoSell(resType, room) {
    // 获取该房间该资源类型的所有售卖订单
    let orders = _.values(Game.market.orders).filter(e => 
        e.remainingAmount > 0 && 
        e.resourceType == resType && 
        e.type == ORDER_SELL &&
        e.roomName == room.name
    );
    
    // 如果订单数量超过1个，取消所有订单
    if (orders.length > 1) {
        orders.forEach(e => {
            Game.market.cancelOrder(e.id);
            console.log(`[cancel] ${room.name} ${resType} order ${e.id}`);
        });
        // 取消后重新获取订单（数量应该为0）
        orders = [];
    }
    
    // 计算价格
    // 获取房间中该资源的存量
    let resCnt = StationCarry.roomMassStoreCnt(room, resType);
    let maxPrice;
    if (resType == RESOURCE_ENERGY) {
        // 能量卖价：超量越多折扣越大（最高 25%），但设硬底价防止与别人互相破价
        let buyOrders = pro.getAllOrdersCacheList(RESOURCE_ENERGY, ORDER_BUY);
        // 他人卖单（排除自己的订单），用于"贴单不砸盘"
        let sellOrders = pro.getAllOrdersCacheList(RESOURCE_ENERGY, ORDER_SELL)
            .filter(e => !Game.market.orders[e.id]);
        let historyAvg = StrategyMarketPrice.getResTypeHistory(resType) || 0;

        // 参考价：市场最高买价优先，无买价时用历史均价。
        // 但买价可能被异常高单污染（如 680 的能量买单），必须以历史均价为
        // 锚：参考价不超过历史均价的 3 倍，避免跟着离谱买单挂出天价卖单
        let reference = buyOrders.length > 0 ? _.max(buyOrders, 'price').price : historyAvg;
        if (historyAvg > 0 && reference > historyAvg * 3) reference = historyAvg * 3;
        if (reference <= 0) reference = historyAvg;
        // 他人最低卖价（若有），用于"贴单不砸盘"
        let lowestSell = sellOrders.length > 0 ? sellOrders.minBy(e => e.price).price : undefined;
        let excess = Math.max(0, resCnt - 400000);
        let discount = Math.min(0.25, excess / 2000000 * 0.25);
        maxPrice = Math.max(reference * (1 - discount), 0.001);

        // 不主动破价：计算价低于他人最低卖单时贴单价，不做砸盘者。
        // 但他人卖单同样可能异常（如被高价买单带偏到 680），贴单也
        // 封顶在历史均价×3，绝不让我们的卖单跟着市场噪音飞到天价
        if (lowestSell !== undefined && maxPrice < lowestSell) {
            let cap = historyAvg > 0 ? historyAvg * 3 : lowestSell;
            maxPrice = Math.min(lowestSell, cap);
        }
        // 硬底价：不低于历史均价的 85%（且不低于 2），防止双方互踩导致价格无限下跌
        maxPrice = Math.max(maxPrice, historyAvg * 0.85, 2);
    } else {
        // 其他资源使用历史价格
        maxPrice = StrategyMarketPrice.getResTypeHistory(resType) || 0.1;
    }
    
    // 检查是否需要创建/修改订单
    if (resCnt >= 600000) {
        // 资源充足，需要确保有一个售卖订单
        
        if (orders.length === 1) {
            // 只有一个订单，修改价格
            let order = orders[0];
            Game.market.changeOrderPrice(order.id, maxPrice);
            console.log(`[update] ${room.name} ${resType} order ${order.id} price to ${maxPrice}`);
        } else if (orders.length === 0) {
            // 没有订单，创建新订单
            let sellAmount = resCnt - 400000;
            if (sellAmount > 0) {
                let result = Game.market.createOrder({
                    type: ORDER_SELL,
                    resourceType: resType,
                    price: maxPrice,
                    totalAmount: sellAmount,
                    roomName: room.name,
                });
                
                if (result === OK) {
                    console.log(`[sell] ${room.name} ${resType} ${sellAmount} with price ${maxPrice}`);
                } else {
                    console.log(`[error] Failed to create order in ${room.name} for ${resType}, error: ${result}`);
                }
            }
        }
        // 如果orders.length > 1的情况已经在前面处理了
    } else {
        // 资源不足，如果有订单则取消
        if (orders.length > 0) {
            orders.forEach(e => {
                Game.market.cancelOrder(e.id);
                console.log(`[cancel] ${room.name} ${resType} order ${e.id} due to insufficient resources`);
            });
        }
    }
    
    // 返回当前价格，供其他函数使用
    return maxPrice;
},
    autoSellMineral(room) {
        if (!room.storage || !room.terminal || !room.terminal.my) return;
        // 矿物挂单/补货也是 CPU 大头（7 种矿物 × 市场订单查询）。
        // 按房间错开每 100 tick 检查一次：矿物产量低、卖单成交慢，
        // 每 100 tick 更新一次价格与数量足够
        if ((Game.time + room.hashCode()) % 80 != 0) return;
        // 基础矿物：能采就采，超出保留量的部分搬到 terminal 挂卖单，而不是
        // 暂停采集（station_minetral 已放开 20 万存量上限）
        let sellable = ["U", "L", "K", "Z", "X", "O", "H"];
        // 每房间保留量：自用/合成缓冲，避免自买自卖（买入线约 6000/房间）
        let keep = 30000;
        for (let resType of sellable) {
            let storeCnt = room.storage.store[resType] || 0;
            let termCnt = room.terminal.store[resType] || 0;
            let total = storeCnt + termCnt;
            if (total <= keep) continue;
            // 全局存量不足买入线时保留，避免卖出后又触发 autoBuyMineral 自买自卖
            if (!global._resCnt) global._resCnt = { tick: -1 };
            if (global._resCnt.tick != Game.time) {
                global._resCnt.tick = Game.time;
                for (let r of sellable) global._resCnt[r] = ManagerRooms.getNormalRoom().map(e => StationCarry.roomMassStoreCnt(e, r)).sum();
            }
            if ((global._resCnt[resType] || 0) < ManagerRooms.getNormalRoom().length * 6000 + 10000) continue;
            let sellAmount = total - keep;
            // 清理已完全成交的残留订单（remainingAmount=0），防止占位/重复挂单
            let myOrders = _.values(Game.market.orders).filter(e =>
                e.resourceType == resType && e.type == ORDER_SELL && e.roomName == room.name);
            myOrders.filter(e => !e.remainingAmount).forEach(e => {
                Game.market.cancelOrder(e.id);
                console.log(`[cancel] ${room.name} ${resType} spent order ${e.id}`);
            });
            let orders = myOrders.filter(e => e.remainingAmount > 0);
            if (orders.length > 1) {
                // 只保留一张卖单，取消多余的
                orders.slice(1).forEach(e => {
                    Game.market.cancelOrder(e.id);
                    console.log(`[cancel] ${room.name} ${resType} extra order ${e.id}`);
                });
                orders = [orders[0]];
            }
            // 持续补货 terminal：卖单成交从 terminal 扣货，storage 有矿就搬过去。
            // terminal 空间被 balanceTerminalResource 的各资源 3000 占满时，
            // 先把一种其他矿物搬回 storage，腾位置给待卖矿物
            if (storeCnt > 0) {
                let carrier = room.creeps("carrier").filter(e => e.isFree() && e.storeEmpty() && e.ticksToLive > 90).head();
                if (carrier) {
                    if (room.terminal.store.getFreeCapacity(resType) < 1000) {
                        // 找一个非 energy 非本资源的 terminal 存量搬回 storage 腾位
                        let victim = _.keys(room.terminal.store).find(r => r != RESOURCE_ENERGY && r != resType
                            && (room.terminal.store[r] || 0) > 0);
                        if (victim && room.storage.store.getFreeCapacity(victim) > 0) {
                            let amount = Math.min(room.terminal.store[victim], room.storage.store.getFreeCapacity(victim), 3000);
                            carrier.addTask([
                                UtilsTask.task(room.storage, "fillRes", undefined, { resType: victim, resCount: amount }),
                                UtilsTask.task(room.terminal, "carryRes", undefined, { resType: victim, resCount: amount }),
                            ]);
                        }
                    } else {
                        let amount = Math.min(storeCnt, room.terminal.store.getFreeCapacity(resType), 20000);
                        carrier.addTask([
                            UtilsTask.task(room.terminal, "fillRes", undefined, { resType: resType, resCount: amount }),
                            UtilsTask.task(room.storage, "carryRes", undefined, { resType: resType, resCount: amount }),
                        ]);
                    }
                }
            }
            // 一次挂足量卖单：挂单量 = 全部可卖量（像能量卖单一样，不管
            // terminal 现存量；terminal 由上面的搬运任务持续补货）
            if (orders.length == 0 && sellAmount >= 1000) {
                let price = pro.getMineralSellPrice(resType);
                let code = Game.market.createOrder({
                    type: ORDER_SELL,
                    resourceType: resType,
                    price: price,
                    totalAmount: sellAmount,
                    roomName: room.name,
                });
                if (code == OK) console.log(`[sellMineral] ${room.name} ${resType} ${sellAmount} @ ${price}`);
            }
        }
    },
    getMineralSellPrice(resType) {
        let history = StrategyMarketPrice.getResTypeHistory(resType);
        let buyOrders = pro.getAllOrdersCacheList(resType, ORDER_BUY);
        let maxBuy = buyOrders.length ? buyOrders.maxBy(e => e.price).price : 0;
        // 价格合适：不低于历史均价（不贱卖），不高于市场买价太多（能成交）
        return Math.max(history * 0.95, maxBuy * 1.05, 0.01);
    },
    // 交易成本单位缓存：只依赖 from/to 房间名与距离，跨 tick 不变，
    // 放 global 避免每次 exec 重建、每房间每 20 tick 重复 calcTransactionCost
    // （该调用是市场模块 CPU 大头之一）
    getTxCostUnit(fromRoom, toRoom) {
        let map = (global._marketTxCost = global._marketTxCost || {});
        let key = fromRoom + ">" + toRoom;
        if (map[key] !== undefined) return map[key];
        return map[key] = Game.market.calcTransactionCost(100, fromRoom, toRoom) / 100;
    },
    exec(room) {
        if (isSaveCpu && (
            (Game.cpu.bucket < 5000 && (Game.time) % 29 != 0) ||
            (Game.cpu.bucket < 8000 && (Game.time) % 10 != 0) ||
            (Game.cpu.bucket < 9000 && (Game.time) % 5 != 0) ||
            (Game.cpu.bucket < 9500 && (Game.time) % 3 != 0)
        )) return;//+room.hashCode() 同一 tick 计算，省点 计算需要的 资源
        // let time = Game.cpu.getUsed();

        if (!room.my || !room.terminal || !room.terminal.my) return;
        if (Game.time - 300 > allRoomRes.updateTime) {
            allRoomRes.res = pro.getMyAllRoomRes();
            allRoomRes.updateTime = Game.time;
        }
        if (!Game.market._dealedOrder) Game.market._dealedOrder = {} // 如果已经交易过了
        let dealed = Game.market._dealedOrder

    // 卖东西 - 只卖最佳商品
    // deal 扫描是 CPU 大头（遍历市场买单 + 交易成本计算）。价格缓存
    // 1000 tick 刷新一次，deal 检查也按房间错开节流到约 100 tick 一次，
    // 不每 20 tick 重复全量扫描——buy 单价格变化慢，低频足够吃到高价。
    // 注意：此节流只包住商品 deal 段，后面的能量/矿物挂单与买入不受影响
    let doCommodityDeal = (Game.time + room.hashCode()) % 80 == 0;
    let sellPrice = pro.getOnSellPrice();
    let bestCommodities = sellPriceCache.bestCommodities || {};
    let energyPrice = StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY);
    // 交易成本只与距离、数量线性相关，同一目标房间按单位成本缓存一次
    let txCost = function (amount, toRoom) {
        return pro.getTxCostUnit(room.name, toRoom) * amount;
    };
    
    // 按利润率排序，优先卖出利润率高的商品
    let sortedCommodities = Object.keys(sellPrice)
        .filter(resType => bestCommodities[resType] || ON_SALE[resType]) // 只考虑最佳商品和强制售卖
        .map(resType => {
            return {
                resType: resType,
                price: sellPrice[resType],
                profitMargin: bestCommodities[resType] ? bestCommodities[resType].profitMargin : 0,
                series: bestCommodities[resType] ? bestCommodities[resType].series : '强制'
            };
        })
        .sort((a, b) => b.profitMargin - a.profitMargin); // 按利润率降序排序
    
    // 尝试卖出每个商品（按房间错开每 100 tick 一次，省 CPU）
    for (let item of sortedCommodities) {
        if (!doCommodityDeal) break;
        let resType = item.resType;
        let available = room.terminal.store[resType] || 0;
        if (available < MARKET_MIN_COMMODITY_DEAL) continue;
        
        let maxPrice = sellPrice[resType];
        // 高频 deal 不必要：exec 每 ~20 tick 才轮到本房间一次，这就是"适当
        // 时间"。成交门槛 = 历史均价 × (1+溢价)，溢价默认 10%
        // （Memory.marketSettings.dealPremium 可调）——买价没高过平常价
        // 一部分就不 deal，避免贱卖；与成本底线取大
        let historyAvg = StrategyMarketPrice.getResTypeHistory(resType);
        let dealPremium = Number(Memory.marketSettings && Memory.marketSettings.dealPremium || 0.1);
        if (historyAvg > 0) maxPrice = Math.max(maxPrice, historyAvg * (1 + dealPremium));
        let buyList = pro.getAllOrdersCacheList(resType, ORDER_BUY);
        let maxOrder = undefined;
        let bestPrice = 0;
        
        // 寻找最佳购买订单
        for (let order of buyList) {
            if (!order.amount || !order.roomName || Game.market.orders[order.id]) continue;
            let amount = Math.min(order.amount, available, MARKET_MAX_COMMODITY_DEAL);
            if (amount < MARKET_MIN_COMMODITY_DEAL) continue;
            let energyNeed = txCost(amount, order.roomName);
            let totalPrice = -energyNeed * energyPrice + amount * order.price;
            let price = totalPrice / amount;

            if (price >= bestPrice && price >= maxPrice) {
                maxOrder = order;
                bestPrice = price;
            }
        }
        
        // 如果找到合适的订单且价格可接受
        if (maxOrder && bestPrice >= maxPrice) {
            let sellAmount = Math.min(
                maxOrder.amount,
                room.terminal.store[resType],
                MARKET_MAX_COMMODITY_DEAL
            );
            let transactionEnergy = txCost(sellAmount, maxOrder.roomName);
            let terminalEnergy = room.terminal.store[RESOURCE_ENERGY] || 0;
            if (transactionEnergy > terminalEnergy && transactionEnergy > 0) {
                sellAmount = Math.floor(sellAmount * terminalEnergy / transactionEnergy * 0.95);
            }
            if (sellAmount < MARKET_MIN_COMMODITY_DEAL) continue;
            transactionEnergy = txCost(sellAmount, maxOrder.roomName);
            bestPrice = (maxOrder.price * sellAmount - transactionEnergy * energyPrice) / sellAmount;
            if (bestPrice < maxPrice) continue;
            
            let code = Game.market.deal(maxOrder.id, sellAmount, room.name);
            if (code == OK) {
                console.log(`[售卖] ${room.name} ${resType} ${sellAmount} 价格${bestPrice.toFixed(3)} ` +
                          `利润率${item.profitMargin.toFixed(1)}% ${item.series}系列`);
                maxOrder.amount -= sellAmount;
                return; // 交易后停止本轮交易
            }
        }
    }
    
        // sell energy or battery
        const SELL_RES_TYPES=[RESOURCE_ENERGY, RESOURCE_BATTERY];
        if (Game.time % 290 == 0) SELL_RES_TYPES.forEach(e => {pro.autoSell(e, room)})
        // 基础矿物：能采就采，超出保留量自动挂卖单（矿物采集已不再因存量暂停）
        pro.autoSellMineral(room);

        // 买入低频化：遍历 RES_BUY_AMOUNT_ROOM 每个资源都要查市场卖单，
        // 是 CPU 大头。买入只需每 100 tick 一次（与矿物挂单同频）——
        // 库存缺口变化慢，100 tick 内买到就够，不必每 20 tick 全量扫描
        if (StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY) < 80000) return;
        if ((Game.time + room.hashCode()) % 80 != 0) return;
        // 买东西
        if (Game.market.credits > 100000)
            for (let resType in RES_BUY_AMOUNT_ROOM) {
                if (StationCarry.roomMassStoreCnt(room, resType) < RES_BUY_AMOUNT_ROOM[resType] && (allRoomRes.res[resType] || 0) < RES_BUY_MIN_HOLD_ROOM[resType]) {
                    let sellList = pro.getAllOrdersCacheList(resType, ORDER_SELL)
                    let minPrice = 1e30;
                    let minOrder = undefined;
                    for (let order of sellList) {
                        if (dealed[order.id]) continue;
                        let energyNeed = txCost(order.amount, order.roomName);
                        let totalPrice = energyNeed * energyPrice + order.amount * order.price;
                        let price = totalPrice / order.amount;
                        if (price < minPrice) {
                            minOrder = order;
                            minPrice = price;
                        }
                    }
                    // log(minPrice,room.name)
                    if (minOrder && minPrice < RES_BUY_MAX_PRICE_ROOM[resType]) {
                        let buyAmount = Math.min(minOrder.amount, 10000)
                        let code = Game.market.deal(minOrder.id, buyAmount, room.name);
                        if (code == OK) {
                            console.log("buy res: ", resType, buyAmount, minPrice, minOrder.id, code, room.name);
                            dealed[minOrder.id] = true;
                        }
                        return;// 交易后直接停止本轮交易
                    }
                }
            }

        // log("MarketDealer:" + (Game.cpu.getUsed() - time));

    }
};

pro.getBestCommoditiesToSell = function(showDetail = false) {
    // 首先获取所有商品的利润分析
    let allCommodities = StrategyMarketPrice.calculateAllCommoditiesProfit(false,false).commodities;
    
    let seriesMap = getSeriesMap();
    let bestCommodities = {};
    
    let minimumMargin = Number(Memory.marketSettings&&Memory.marketSettings.commodityMinMargin||15);
    // 按系列选出利润率最高的两种高级商品
    for (let seriesName in seriesMap) {
        let series = seriesMap[seriesName];
        let seriesItems = [];
        
        // 收集该系列所有商品的利润信息
        series.forEach(resType => {
            if (allCommodities[resType]) {
                let data = allCommodities[resType];
                seriesItems.push({
                    resType: resType,
                    profit: data.profit,
                    profitMargin: data.profitMargin,
                    level: data.level,
                    minimumSellPrice: data.minimumSellPrice,
                    suggestedPrice: data.suggestedPrice,
                    marketPrice: data.marketPrice
                });
            }
        });
        
        // 按利润率降序排序
        seriesItems.sort((a, b) => b.profitMargin - a.profitMargin);
        
        // 取前两种（如果有利润的话）
        let topTwo = seriesItems.filter(item => item.level > 0 && item.profit > 0 && item.profitMargin >= minimumMargin).slice(0, 2);
        
        // 添加到最佳商品列表
        topTwo.forEach(item => {
            bestCommodities[item.resType] = {
                price: item.minimumSellPrice,
                profitMargin: item.profitMargin,
                marketPrice: item.marketPrice,
                level: item.level,
                series: seriesName
            };
            
            if (showDetail) {
                console.log(`[最佳] ${seriesName}系列: ${item.resType} - 利润 ${item.profit.toFixed(3)} (${item.profitMargin.toFixed(1)}%)`);
            }
        });
    }
    
    return bestCommodities;
};


// 添加一个显示最佳商品的函数
pro.showBestCommodities = function() {
    let bestCommodities = pro.getBestCommoditiesToSell(true);
    let sellPrice = pro.getOnSellPrice();
    
    console.log("=".repeat(80));
    console.log("最佳售卖商品列表 (每个系列利润率最高的两种)");
    console.log("=".repeat(80));
    
    let seriesMap = getSeriesMap();
    for (let seriesName in seriesMap) {
        console.log(`\n${seriesName}系列:`);
        
        let seriesItems = Object.keys(bestCommodities)
            .filter(resType => bestCommodities[resType].series === seriesName)
            .map(resType => ({
                resType: resType,
                price: sellPrice[resType],
                profitMargin: bestCommodities[resType].profitMargin
            }))
            .sort((a, b) => b.profitMargin - a.profitMargin);
        
        if (seriesItems.length === 0) {
            console.log("  暂无有利润的商品");
        } else {
            seriesItems.forEach((item, index) => {
                console.log(`  ${index + 1}. ${item.resType.padEnd(15)} - 售价 ${item.price.toFixed(3)} ` +
                          `利润率 ${item.profitMargin.toFixed(1)}%`);
            });
        }
    }
    
    // 显示强制售卖的商品
    let forcedItems = Object.keys(ON_SALE);
    if (forcedItems.length > 0) {
        console.log("\n强制售卖商品:");
        forcedItems.forEach(resType => {
            console.log(`  ${resType.padEnd(15)} - 固定售价 ${ON_SALE[resType]}`);
        });
    }
    
    console.log("=".repeat(80));
};

global.StrategyMarket = pro;
