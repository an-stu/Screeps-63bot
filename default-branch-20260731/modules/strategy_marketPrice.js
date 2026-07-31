/**
 *  价格计算模块：
 *  这里只提供这个方法：
 *  StrategyMarketPrice.getSellPrice()
 *  返回一个map key是资源 value是售价 单位cr
 *
 *  StrategyMarketPrice.updateSellPrice(true)
 */

let COMPRESSION_SET = new Set([RESOURCE_UTRIUM_BAR,RESOURCE_LEMERGIUM_BAR,RESOURCE_KEANIUM_BAR,RESOURCE_ZYNTHIUM_BAR,RESOURCE_GHODIUM_MELT,RESOURCE_OXIDANT,RESOURCE_REDUCTANT,RESOURCE_PURIFIER,RESOURCE_BATTERY]);
let BASE_RESTYPE = new Set([RESOURCE_ENERGY,"U","L","K","Z","X","O","H","ops"])
let BLUE = [RESOURCE_DEVICE,RESOURCE_CIRCUIT,RESOURCE_MICROCHIP,RESOURCE_TRANSISTOR,RESOURCE_SWITCH,RESOURCE_WIRE];
let YELLOW = [RESOURCE_MACHINE,RESOURCE_HYDRAULICS,RESOURCE_FRAME,RESOURCE_FIXTURES,RESOURCE_TUBE,RESOURCE_ALLOY];
let PINK = [RESOURCE_ESSENCE,RESOURCE_EMANATION,RESOURCE_SPIRIT,RESOURCE_EXTRACT,RESOURCE_CONCENTRATE,RESOURCE_CONDENSATE];
let GREEN = [RESOURCE_ORGANISM,RESOURCE_ORGANOID,RESOURCE_MUSCLE,RESOURCE_TISSUE,RESOURCE_PHLEGM,RESOURCE_CELL];
let BASE_DEPOSITS = [RESOURCE_SILICON,RESOURCE_BIOMASS,RESOURCE_METAL,RESOURCE_MIST]; // 0 级
let L1_DEPOSITS = [RESOURCE_WIRE,RESOURCE_ALLOY,RESOURCE_CONDENSATE,RESOURCE_CELL]; // 1 级
let DEPO_MAP = (function (){
    let mp = {};
    BLUE.forEach(e=>mp[e] = RESOURCE_SILICON);
    YELLOW.forEach(e=>mp[e] = RESOURCE_METAL);
    PINK.forEach(e=>mp[e] = RESOURCE_MIST);
    GREEN.forEach(e=>mp[e] = RESOURCE_BIOMASS);
    return mp;
})();

let PRICE_TOLERANCE = 0.1 // 贱卖的价格 比例
let TARGET_STORE_CNT = 100000 // 目标不讲价的卖的价格 的存储数量 超过这个值开始贱卖 目标 0.1m
let DEPO_SET = new Set(BLUE.concat(YELLOW).concat(PINK).concat(GREEN))
// 挖一个的成本大概在3.8 - 5 左右 取决于boost没有 s2 和 s3， 能量价格也不一样，挖到多少不挖也不一样，见仁见智吧
// 挖到100 大概成本是3.8-7左右
let DEFAULT_DEPO_MUL =  3// 默认成本价格 ，这个不会从市场算了，市场买的价格虚高
let DEFAULT_PRICE = // 默认资源价格//如果不能从市场算的话//所有资源都会从这边算//如果低于这个价格按这个价格算
    (function () {
        if(Game.shard.name=="shard3")
            return  {"energy":0.5, "U":1.5, "L":0.5, "K":0.7, "Z":0.3, "X":4, "O":0.5, "H":1.1,"ops":1,}
        if(Game.shard.name=="Screeps.Cc")
            return  {"energy":1, "U":0.3, "L":0.3, "K":0.3, "Z":0.3, "X":0.95, "O":0.1, "H":0.1,"ops":1,}
        else
            return {"energy":1.5, "U":1.8, "L":1, "K":1, "Z":1, "X":8, "O":1.8, "H":1,}
})();

let MAX_DELAY = 86400/16 ; // 更新商品价格的延迟  大概6小时跟新一次
let HISTORY_CACHE_TTL = 1000;
let historyCache = {};



let pro = {
    _lastTick : -1e9, //上次更新时间
    // _baseResPrice:{},// 基础资源价格
    _depoResPrice:{},// 商品交易价格
    _depoResPriceStddev:{},// 商品交易方差
    // _avgBaseDepoProfit:{},// 平均每个基础商品的交易利润
    _depoMinSellPrice:{},

    // 计算合成需要的资源，计算利润
    _depoNeedPerCommodity : {},// 商品合成需要多少 单位基础商品
    _depoCostPerCommodity : {},// 商品合成需要多少cr 单位在每个基础商品上需要花多少额外资源的价格

    _depoSellPrice :{},// final sell price
    _depoMaxProfit :{},// 基础depo的最大利润，可以拿来倒买倒卖

    getSellPrice (){
        pro.updatePrice();
        // log( pro._depoSellPrice)
        return pro._depoSellPrice;
    },

    getAutoBuyDepoPrice(){
        pro.updatePrice();
        let priceMap = {};
        [RESOURCE_BIOMASS,RESOURCE_SILICON,RESOURCE_METAL,RESOURCE_MIST].forEach(e=>{
            priceMap[e] = pro._depoMaxProfit[e]/2
        });
        [RESOURCE_WIRE,RESOURCE_ALLOY,RESOURCE_CONDENSATE,RESOURCE_CELL].forEach(e=>{
            priceMap[e] = pro._depoMaxProfit[DEPO_MAP[e]]*2.5
        });
        return priceMap;
    },

    updatePrice (){
        if(pro._lastTick>=Game.time)return;
        // let time = Game.cpu.getUsed();
        pro.updateDepoPrice();
        pro.updateDepoHistroyPrice();
        pro.updateSellPrice()
        pro._lastTick=Game.time+MAX_DELAY;
        // log(Game.cpu.getUsed() - time) // 更新一次 大概消耗 2cpu
    },

    updateSellPrice (show=false) {
        let profitMap = {} // 利润
        pro._depoSellPrice = {};
        if(show)console.log("基础价格:","商品","均价","最低售价","利润","售价比")

        let myRooms = _.values(Game.rooms).filter(e=>e.my)

        let depoRatioMap = L1_DEPOSITS.map(e=>[DEPO_MAP[e],myRooms.map(room=>StationCarry.roomMassStoreCnt(room,e)).sum()/TARGET_STORE_CNT]).toMap()

        let energyPrice = pro.getResTypeHistory(RESOURCE_ENERGY)
        let defaultDepoPrice = DEFAULT_DEPO_MUL*energyPrice
        for(let k in DEPO_MAP){
            let storeRatio = Math.min(Math.sqrt(depoRatioMap[DEPO_MAP[k]]),1.414)-1; //sqrt(x)
            let minSellPrice = pro._depoResPrice[k]*(1-PRICE_TOLERANCE*storeRatio); // 最少需要的价格
            let profit = minSellPrice/pro._depoNeedPerCommodity[k] - pro._depoCostPerCommodity[k];
            if(show)console.log(k,pro._depoResPrice[k],minSellPrice,profit,1-PRICE_TOLERANCE*storeRatio)
            profitMap[k] = profit;
            pro._depoMinSellPrice[k] = minSellPrice;
            if(profit>defaultDepoPrice*1.5)pro._depoSellPrice[k] = minSellPrice;// 必须有的赚才卖
        }


        if(show)console.log("修正价格:","商品","售价","均价差距比","利润");
        [BLUE,YELLOW,PINK,GREEN].forEach(series=>{ // 按利润线均匀出售
            let maxProfit = 0;
            series.forEach(e=>{if(maxProfit < profitMap[e])maxProfit = profitMap[e]})
            pro._depoMaxProfit[DEPO_MAP[series[0]]]=maxProfit
            series.forEach(e=>{if(maxProfit > profitMap[e]){
                // let oldPrice = pro._depoSellPrice[e];
                pro._depoSellPrice[e] = (maxProfit+pro._depoCostPerCommodity[e])*pro._depoNeedPerCommodity[e] // 修正后的价格
                if(show)console.log(e,pro._depoSellPrice[e],pro._depoSellPrice[e]/(pro._depoResPrice[e]||1),maxProfit);
            }else {
                if(show)console.log(e,pro._depoSellPrice[e],pro._depoSellPrice[e]/(pro._depoResPrice[e]||1),maxProfit);
            }})
            // series.forEach(e=> delete pro._depoSellPrice[e])
        })

    },

    getHistory(resType) {
        let key = resType || "*";
        let cached = historyCache[key];
        if(cached && Game.time-cached.time < HISTORY_CACHE_TTL)return cached.data;
        let data = Game.market.getHistory(resType)||[];
        historyCache[key] = {time:Game.time,data:data};
        return data;//historys //
    },

    updateDepoHistroyPrice (){
        let historyOrders =  pro.getHistory();

        let amount = {}
        let priceSum = {}
        let stddevDays = {}
        let stddev = {}
        historyOrders.forEach(e=>{
            if(!DEPO_SET.has(e.resourceType))return;
            if(e.stddevPrice>e.avgPrice*0.4) return;
            priceSum[e.resourceType] = ( priceSum[e.resourceType] || 0 ) + e.avgPrice*e.volume;
            amount[e.resourceType] = ( amount[e.resourceType] || 0 ) + e.volume;
            stddevDays[e.resourceType] = (stddevDays[e.resourceType]||0)+1;
            stddev[e.resourceType] = (stddev[e.resourceType]||0)+e.stddevPrice;
        });

        let depoResPrice = {};
        let depoResPriceStddev = {};
        let sumBaseDepoProfit = {};
        let cntBaseDepoProfit = {};
        for(let resType in priceSum) {
            let BaseDepo = DEPO_MAP[resType];

            depoResPrice[resType] = priceSum[resType]/amount[resType] ;
            depoResPriceStddev[resType] = stddev[resType]/stddevDays[resType];
            sumBaseDepoProfit[BaseDepo] = (sumBaseDepoProfit[BaseDepo]||0) + priceSum[resType] - pro._depoCostPerCommodity[resType]* pro._depoNeedPerCommodity[resType]*amount[resType];
            cntBaseDepoProfit[BaseDepo] = (cntBaseDepoProfit[BaseDepo]||0) + amount[resType] * pro._depoNeedPerCommodity[resType];
        }
        // let avgBaseDepoProfit = {}
        // for(let resType in sumBaseDepoProfit) {
        //     avgBaseDepoProfit[resType] = sumBaseDepoProfit[resType]/cntBaseDepoProfit[resType]
        // }
        pro._depoResPrice = depoResPrice;
        pro._depoResPriceStddev = depoResPriceStddev;
        // pro._avgBaseDepoProfit = avgBaseDepoProfit;
        // log(depoResPrice);
        // log(depoResPriceStddev);
        // log(avgBaseDepoPrice);

    },
    getBaseResTypeHistory  (){ // 基础资源的价格
        let historyOrders =  pro.getHistory();
        let history = {}
        historyOrders.forEach(e=>{
            if(!BASE_RESTYPE.has(e.resourceType))return;
            if(e.stddevPrice>e.avgPrice&&e.stddevPrice>=1&&e.resourceType!==RESOURCE_ENERGY)return; // 排除有些人挂单换cr
            // if(e.date==date)return;// 排除当天交易
            if(!history[e.resourceType])
                history[e.resourceType] = [];
            history[e.resourceType].push(e)
        })
        let out = {}
        for(let resType of BASE_RESTYPE){
            let hisArr = history[resType];
            if(hisArr){
                let avg = _.sum(hisArr.map(e=>e.avgPrice))/hisArr.length
                if(avg>DEFAULT_PRICE[resType])out[resType] = avg;
                else out[resType] = DEFAULT_PRICE[resType];
            }else {
                out[resType] = DEFAULT_PRICE[resType]
            }
        }

        // Object.entries(priceSum).sort((a,b)=>a[1]-b[1]).map(e=>[e[0],e[1],e[1]/amount[e[0]],amount[e[0]]]).forEach(e=>console.log(e));
        return out
    },
    getResTypeHistory  (resType){ // 资源平均价格价格
        let list = pro.getHistory(resType);
        let history = list.length&&list.filter(e=>!(e.stddevPrice>e.avgPrice&&e.stddevPrice>=1)||resType=='energy')// 排除有些人挂单换cr
        if(!history)return 0
        return _.sum(history.map(e => e.avgPrice)) / history.length ||10// 平均值
    },
    updateDepoPrice (){ // 计算合成的成本
        let price = pro.getBaseResTypeHistory();
        let energyPrice = pro.getResTypeHistory(RESOURCE_ENERGY)
        let defaultDepoPrice = DEFAULT_DEPO_MUL*energyPrice
        let getPrice = function (resType){
            // let data = price.list.filter(e=>e._id==resType).head();
            let data = price[resType];
            if(resType == "G") return getPrice("L")+getPrice("U")+getPrice("O")+getPrice("K") // g默认用原矿
            if(BASE_DEPOSITS.contains(resType))return defaultDepoPrice;
            return data
        };
        let getAllPrice = function (resMap){
            return _.sum(_.keys(resMap).map(e=>getPrice(e)*resMap[e]))
        }
        let getResCnt = function (resType,cnt,resMap){
            let amount = COMMODITIES[resType].amount
            for(let base in COMMODITIES[resType].components){
                let t = COMMODITIES[resType].components[base]*cnt/amount
                if(COMMODITIES[base]&&!COMPRESSION_SET.has(resType)){
                    getResCnt(base,t,resMap)
                }else{
                    resMap[base]=(resMap[base]||0)+t
                    // log(base,t)
                }
            }
            if(COMMODITIES[resType].level){
                let base = "ops"
                let batch = Math.ceil(1000/COMMODITIES[resType].cooldown)// 每1000 tick 能反应几次
                let amount = COMMODITIES[resType].amount
                resMap[base]=(resMap[base]||0)+(100/batch)/amount
            }
            return resMap
        };
        pro._depoNeedPerCommodity = {};
        pro._depoCostPerCommodity = {};
        [BLUE,YELLOW,PINK,GREEN].forEach(e=>{
            e.forEach(sellDepo=>{
                let mp = {}// 单个资源需要多少
                let basePrice = getAllPrice(getResCnt(sellDepo,1,mp)) // 基础价格
                // let sellDepoPrice = getPrice(sellDepo)
                let depo = _.keys(mp).filter(e=>BASE_DEPOSITS.contains(e)).head()
                // let sellPrice = ((basePrice/mp[depo])+100)*mp[depo]
                // (sellDepoPrice - basePrice)/mp[depo]
                // let opsPerDepo = mp["ops"]/mp[depo]
                // sellPrice
                // opsPerDepo

                // console.log(sellDepo,mp[depo],basePrice,basePrice/mp[depo])//,basePrice/sellDepoPrice
                // log(mp)
                pro._depoNeedPerCommodity[sellDepo] = mp[depo];
                pro._depoCostPerCommodity[sellDepo] = basePrice/mp[depo];
            });
            // console.log()
        })

    },
    
}
/**
 * 计算所有商品的价格和利润，并可视化打印
 */
pro.calculateAllCommoditiesProfit = function(showDetail = false, outputToConsole = false) {
    // 更新价格数据
    pro.updatePrice();
    
    // 获取基础资源价格
    let basePrices = pro.getBaseResTypeHistory();
    
    // 获取能量价格
    let energyPrice = pro.getResTypeHistory(RESOURCE_ENERGY);
    
    // 存储所有商品的计算结果
    let allCommodities = {};
    
    // 计算函数：递归计算商品所需基础资源
    let calculateBaseComponents = function(resType, amount = 1, visited = new Set()) {
        if (visited.has(resType)) return {}; // 防止循环依赖
        visited.add(resType);
        
        let components = {};
        
        // 如果是基础资源
        if (BASE_RESTYPE.has(resType) || BASE_DEPOSITS.includes(resType)) {
            components[resType] = amount;
            return components;
        }
        
        // 获取商品定义
        let commodity = COMMODITIES[resType];
        if (!commodity) {
            console.log(`Warning: No definition for ${resType}`);
            return {};
        }
        
        // 如果有组件，递归计算
        if (commodity.components) {
            for (let comp in commodity.components) {
                let compAmount = commodity.components[comp] * amount / (commodity.amount || 1);
                let subComponents = calculateBaseComponents(comp, compAmount, new Set(visited));
                
                // 合并组件
                for (let subComp in subComponents) {
                    components[subComp] = (components[subComp] || 0) + subComponents[subComp];
                }
            }
        }
        
        // 添加ops成本
        if (commodity.cooldown && commodity.level > 0) {
            let batch = Math.ceil(1000 / commodity.cooldown); // 每1000 tick能反应几次
            let opsAmount = (100 / batch) * amount / (commodity.amount || 1);
            components["ops"] = (components["ops"] || 0) + opsAmount;
        }
        
        return components;
    };
    
    // 计算所有商品
    for (let resType in COMMODITIES) {
        let commodity = COMMODITIES[resType];
        
        // 计算基础组件成本
        let baseComponents = calculateBaseComponents(resType, 1);
        
        // 计算总成本
        let totalCost = 0;
        let componentDetails = {};
        
        for (let comp in baseComponents) {
            let compPrice = 0;
            
            if (comp in basePrices) {
                compPrice = basePrices[comp];
            } else if (comp === "G") {
                // G是特殊计算
                compPrice = basePrices["L"] + basePrices["U"] + basePrices["O"] + basePrices["K"];
            } else {
                // 尝试获取历史价格
                compPrice = pro.getResTypeHistory(comp) || 0;
            }
            
            let compCost = baseComponents[comp] * compPrice;
            totalCost += compCost;
            componentDetails[comp] = {
                amount: baseComponents[comp],
                price: compPrice,
                cost: compCost
            };
        }
        
        // 获取市场价格
        let marketPrice = 0;
        if (DEPO_SET.has(resType) && pro._depoResPrice[resType]) {
            marketPrice = pro._depoResPrice[resType];
        } else {
            // 尝试从市场历史获取
            marketPrice = pro.getResTypeHistory(resType) || 0;
        }
        
        // 计算利润
        let profit = marketPrice - totalCost;
        let profitMargin = totalCost > 0 ? (profit / totalCost * 100) : 0;
        
        // 计算建议售价（成本 + 20% 利润）
        let suggestedPrice = marketPrice*1.05
        
        // 存储结果
        allCommodities[resType] = {
            level: commodity.level || 0,
            totalCost: totalCost,
            marketPrice: marketPrice,
            profit: profit,
            profitMargin: profitMargin,
            suggestedPrice: suggestedPrice,
            components: baseComponents,
            componentDetails: componentDetails
        };
    }
    
    // 按等级和利润排序
    let sortedCommodities = Object.entries(allCommodities)
        .sort((a, b) => {
            // 先按等级排序
            if (a[1].level !== b[1].level) {
                return a[1].level - b[1].level;
            }
            // 再按利润排序（降序）
            return b[1].profit - a[1].profit;
        });
    
    // 生成HTML输出
    let htmlOutput = generateCompactCommoditiesHTML(sortedCommodities, energyPrice);
    
    // 输出到控制台
    if (outputToConsole) {
        if (typeof console.logUnsafe == "function") console.logUnsafe(htmlOutput);
        else console.log(htmlOutput.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
    }
    
    // 保持返回值不变
    return {
        commodities: allCommodities,
        html: htmlOutput
    };
};
/**
 * 生成紧凑的商品利润分析表格
 */
function generateCompactCommoditiesHTML(sortedCommodities, energyPrice) {
    let timestamp = Game.time;
    
    // 按利润状态分组
    let profitable = [];
    let neutral = [];
    let unprofitable = [];
    
    sortedCommodities.forEach(([resType, data]) => {
        if (data.profit > 0) {
            profitable.push({resType, data});
        } else if (data.profit === 0) {
            neutral.push({resType, data});
        } else {
            unprofitable.push({resType, data});
        }
    });
    
    // 计算总利润
    let totalProfit = profitable.reduce((sum, item) => sum + item.data.profit, 0);
    
    // 生成紧凑的HTML - 单行表格形式
    let html = '<div style="font-family:Consolas,Monaco,\'Courier New\',monospace;background:#1a1a1a;color:#e0e0e0;padding:2px;border-radius:2px;font-size:11px;line-height:1.1;">';
    
    // 标题行
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:2px;padding-bottom:1px;border-bottom:1px solid #333;">';
    html += '<span style="color:#4FC3F7;font-weight:bold;">📊 商品利润分析</span>';
    html += '<span style="color:#BBB;">能量:' + energyPrice.toFixed(2) + '|总计:' + sortedCommodities.length + '</span>';
    html += '</div>';
    
    // 生成单行表格（包含标题栏）
    html += generateSingleLineTable(profitable, 'profit', '✓', '有利润');
    html += generateSingleLineTable(neutral, 'neutral', '○', '持平');
    html += generateSingleLineTable(unprofitable, 'loss', '✗', '亏损');
    
    // 汇总信息
    html += '<div style="margin-top:3px;padding:2px;background:#252525;border-radius:1px;font-size:10px;display:flex;justify-content:space-between;">';
    html += '<span>盈利:' + profitable.length + '种</span>';
    html += '<span style="color:#4CAF50">总利润:' + totalProfit.toFixed(2) + '</span>';
    html += '<span>持平:' + neutral.length + '种</span>';
    html += '<span style="color:#F44336">亏损:' + unprofitable.length + '种</span>';
    html += '</div>';
    
    html += '</div>';
    
    return html;
}

/**
 * 生成单行表格（每个商品一行）
 */
function generateSingleLineTable(items, status, statusIcon, statusText) {
    if (items.length === 0) return '';
    
    let statusColor = status === 'profit' ? '#4CAF50' : 
                     status === 'neutral' ? '#FFC107' : 
                     '#F44336';
    
    let bgColor = status === 'profit' ? 'rgba(76, 175, 80, 0.05)' : 
                  status === 'neutral' ? 'rgba(255, 193, 7, 0.05)' : 
                  'rgba(244, 67, 54, 0.05)';
    
    let html = '<div style="margin:1px 0 2px 0;">';
    
    // 状态标题
    html += '<div style="color:' + statusColor + ';font-size:10px;margin-bottom:1px;padding-left:2px;">' + statusIcon + ' ' + statusText + ' (' + items.length + '种)</div>';
    
    // 表格标题栏
    html += '<div style="display:flex;align-items:center;background:#333;margin:1px 0;padding:2px 4px;border-radius:1px;font-size:10px;color:#AAA;border-bottom:1px solid #444;">';
    html += '<div style="width:15px;text-align:center;">Lv</div>';
    html += '<div style="width:85px;">商品</div>';
    html += '<div style="width:50px;text-align:right;">成本</div>';
    html += '<div style="width:50px;text-align:right;">市价</div>';
    html += '<div style="width:50px;text-align:right;">利润</div>';
    html += '<div style="width:55px;text-align:right;">利润率</div>';
    html += '<div style="width:50px;text-align:right;">建议价</div>';
    html += '<div style="width:15px;text-align:center;">状态</div>';
    html += '</div>';
    
    // 数据行
    items.forEach((item) => {
        let resColor = RES_COLOR_MAP[item.resType] || '#9E9E9E';
        let profitColor = item.data.profit >= 0 ? '#4CAF50' : '#F44336';
        let marginColor = item.data.profitMargin >= 0 ? '#4CAF50' : '#F44336';
        let priceColor = item.data.marketPrice > item.data.totalCost ? '#4CAF50' : '#F44336';
        
        // 每行一个商品
        html += '<div style="display:flex;align-items:center;background:' + bgColor + ';margin:1px 0;padding:2px 4px;border-radius:1px;border-left:2px solid ' + resColor + ';">';
        
        // 等级
        html += '<div style="width:15px;text-align:center;font-size:9px;color:#888;">' + (item.data.level||0) + '</div>';
        
        // 商品名称
        html += '<div style="width:85px;color:' + resColor + ';font-weight:bold;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + item.resType + '</div>';
        
        // 成本
        html += '<div style="width:50px;text-align:right;font-size:10px;">' + item.data.totalCost.toFixed(1) + '</div>';
        
        // 市价
        html += '<div style="width:50px;text-align:right;font-size:10px;color:' + priceColor + '">' + item.data.marketPrice.toFixed(1) + '</div>';
        
        // 利润
        html += '<div style="width:50px;text-align:right;font-size:10px;color:' + profitColor + '">' + item.data.profit.toFixed(1) + '</div>';
        
        // 利润率
        html += '<div style="width:55px;text-align:right;font-size:10px;color:' + marginColor + '">' + item.data.profitMargin.toFixed(1) + '%</div>';
        
        // 建议售价
        html += '<div style="width:50px;text-align:right;font-size:10px;color:#BBB">' + item.data.suggestedPrice.toFixed(1) + '</div>';
        
        // 状态图标
        html += '<div style="width:15px;text-align:center;color:' + statusColor + ';font-size:10px;">' + statusIcon + '</div>';
        
        html += '</div>';
    });
    
    html += '</div>';
    return html;
}

// 删除悬停脚本生成函数，因为不再需要

// 添加一个更简洁的显示函数
pro.showProfitAnalysis = function() {
    let result = pro.calculateAllCommoditiesProfit(true,true);
    return result;
};

global.StrategyMarketPrice=pro;
