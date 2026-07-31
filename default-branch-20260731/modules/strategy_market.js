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
    RES_BUY_AMOUNT_ROOM[RESOURCE_BATTERY] = 12000
    RES_BUY_MIN_HOLD_ROOM[RESOURCE_BATTERY] = 100000 // 0.1m

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
let MARKET_ORDER_TTL = 20;
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
        if ((Game.time) % 100 == 0) {
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
            // if(Game.shard.name=="shard2"){
            ["U", "L", "K", "Z", "X", "O", "H"].forEach(e => pro.autoBuyMineral(e));
            // }
        }
        // if((Game.time)%3==0)pro.autoBuyPixel();
    },
    autoBuyDepo(resType, maxPrice, maxCnt = 10000) {
        let room = _.shuffle(ManagerRooms.getNormalRoom().filter(e => e.storage && e.terminal)).head();//随机一个房间
        if (!Game.market.dealed) Game.market.dealed = {}
        let sellList = pro.getAllOrdersCacheList(resType, ORDER_SELL)
        let minPrice = 1e300;
        let minOrder = undefined;
        let energyPrice = StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY)
        for (let order of sellList) {
            if (Game.market.dealed[order.id]) break;
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
            if (!Game.rooms[roomName]) delete Game.rooms[roomName]
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
            if (Game.market.dealed[order.id]) break;
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
        if (Game._resCnt === undefined) Game._resCnt = {};
        if (Game._resCnt[resType] == null) Game._resCnt[resType] = ManagerRooms.getNormalRoom().map(e => StationCarry.roomMassStoreCnt(e, resType)).sum();
        if (Game._resCnt[resType] >= ManagerRooms.getNormalRoom().length * 6000 + 10000) return;//如果资源有剩下就不买,从别的房间拿

        let buyCnt = 6000
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
    let maxPrice;
    if (resType == RESOURCE_ENERGY) {
        // 获取所有购买能量订单，取最大单价-2
        let buyOrders = Game.market.getAllOrders({type: ORDER_BUY, resourceType: RESOURCE_ENERGY});
        
        if (buyOrders.length > 0) {
            // 找出最高出价
            let highestPrice = _.max(buyOrders, 'price').price;
            maxPrice = highestPrice - 5;
            // 确保价格不低于2
            maxPrice = Math.max(maxPrice, 2);
        } else {
            // 如果没有购买订单，使用历史价格
            maxPrice = StrategyMarketPrice.getResTypeHistory(resType) || 0.1;
        }
    } else {
        // 其他资源使用历史价格
        maxPrice = StrategyMarketPrice.getResTypeHistory(resType) || 0.1;
    }
    
    // 获取房间中该资源的存量
    let resCnt = StationCarry.roomMassStoreCnt(room, resType);
    
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
    let sellPrice = pro.getOnSellPrice();
    let bestCommodities = sellPriceCache.bestCommodities || {};
    let energyPrice = StrategyMarketPrice.getResTypeHistory(RESOURCE_ENERGY);
    
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
    
    // 尝试卖出每个商品
    for (let item of sortedCommodities) {
        let resType = item.resType;
        
        // 检查房间是否有该资源
        // if (!room.terminal.store[resType] || room.terminal.store[resType] < 1000) {
        //     continue; // 资源太少，跳过
        // }
        
        let maxPrice = sellPrice[resType];
        let buyList = pro.getAllOrdersCacheList(resType, ORDER_BUY);
        let maxOrder = undefined;
        let bestPrice = 0;
        
        // 寻找最佳购买订单
        for (let order of buyList) {
            if (maxOrder && !maxOrder.amount) continue;
            
            let energyNeed = Game.market.calcTransactionCost(order.amount, room.name, order.roomName);
            let totalPrice = -energyNeed * energyPrice + order.amount * order.price;
            let price = totalPrice / order.amount;
            
            if (price >= bestPrice && price >= maxPrice * 0.98) { // 允许10%的议价空间
                maxOrder = order;
                bestPrice = price;
            }
        }
        
        // 如果找到合适的订单且价格可接受
        if (maxOrder && bestPrice >= maxPrice * 0.98) {
            let sellAmount = Math.min(
                maxOrder.amount,
                room.terminal.store[resType],
                Math.floor(room.terminal.store[resType]) 
            );
            
            // if (sellAmount < 100) continue; // 卖太少不划算
            
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

        if (StationCarry.roomMassStoreCnt(room, RESOURCE_ENERGY) < 80000) return;
        // 买东西
        if (Game.market.credits > 100000)
            for (let resType in RES_BUY_AMOUNT_ROOM) {
                if (StationCarry.roomMassStoreCnt(room, resType) < RES_BUY_AMOUNT_ROOM[resType] && (allRoomRes.res[resType] || 0) < RES_BUY_MIN_HOLD_ROOM[resType]) {
                    let sellList = pro.getAllOrdersCacheList(resType, ORDER_SELL)
                    let minPrice = 1e30;
                    let minOrder = undefined;
                    for (let order of sellList) {
                        if (dealed[order.id]) break;
                        let energyNeed = Game.market.calcTransactionCost(order.amount, room.name, order.roomName);
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
    
    // 按系列选出利润率最高的两种商品
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
                    suggestedPrice: data.suggestedPrice,
                    marketPrice: data.marketPrice
                });
            }
        });
        
        // 按利润率降序排序
        seriesItems.sort((a, b) => b.profitMargin - a.profitMargin);
        
        // 取前两种（如果有利润的话）
        let topTwo = seriesItems.filter(item => item.profit > 0).slice(0, 2);
        
        // 添加到最佳商品列表
        topTwo.forEach(item => {
            // 使用建议售价和市场价中较高的一个，但不能低于成本
            let cost = allCommodities[item.resType].totalCost;
            let price = Math.max(item.suggestedPrice, item.marketPrice, cost * 1.1); // 至少10%利润
            
            bestCommodities[item.resType] = {
                price: price,
                profitMargin: item.profitMargin,
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
