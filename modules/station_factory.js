/*
工厂分为3个阶段，和lab类似：
搬运请求
合成
清理

合成分为 无等级和有等级两种
无等级合成方案为
先凑齐 3000 数量的资源，3000为一批
然后是 原矿
如果压缩的资源足够的情况下，优先拿库存的

限制了最大存储数量 MAX_COMMODITY_KEEP

 */

let MAX_COMMODITY_KEEP = function (){
    if (Game.shard.name.startsWith("shard")) return { //合成房间最多保留这么多的东西
            5:1000,
            4:200,
            3:200,
            2:200,
            1:500
        }
    else return { //合成房间最多保留这么多的东西
            5:1e6,
            4:50,
            3:125,
            2:500,
            1:2500
        }
}();
// 非卖的商品
let BASE_COMMODITY_SET =new Set([RESOURCE_COMPOSITE,RESOURCE_CRYSTAL,RESOURCE_LIQUID]);

let STAT_CLEAR = "clear"
let STAT_FILL = "fill"
let STAT_PRODUCE = "produce"
let FACTORY_SLEEP_TIME = 20
let BASE_BATCH_SIZE =  30  // 无等级合成的批次
let BAR_BATCH_SIZE =  6  // 压缩商品 合成的批次

let minimum_compression_requires_energy_cnt = 7000000 // 压缩电池的阈值 0.7m
let minimum_decompression_requires_energy_cnt = 130000 // 解压的阈值 0.13m
let maximum_battery_cnt = 100000
// 压缩资源的列表
let COMPRESSION_LIST = [RESOURCE_UTRIUM_BAR,RESOURCE_LEMERGIUM_BAR,RESOURCE_KEANIUM_BAR,RESOURCE_ZYNTHIUM_BAR,RESOURCE_GHODIUM_MELT,RESOURCE_OXIDANT,RESOURCE_REDUCTANT,RESOURCE_PURIFIER,RESOURCE_BATTERY]
// 需要合成的资源的列表
let BASE_COMPRESSION_LIST = [RESOURCE_UTRIUM_BAR,RESOURCE_LEMERGIUM_BAR,RESOURCE_KEANIUM_BAR,RESOURCE_ZYNTHIUM_BAR,RESOURCE_GHODIUM_MELT,RESOURCE_OXIDANT,RESOURCE_REDUCTANT,RESOURCE_PURIFIER]
let BASE_COMPRESSION_MAP = {
    [RESOURCE_UTRIUM_BAR]:"U",
    [RESOURCE_LEMERGIUM_BAR]:"L",
    [RESOURCE_KEANIUM_BAR]:"K",
    [RESOURCE_ZYNTHIUM_BAR]:"Z",
    [RESOURCE_GHODIUM_MELT]:"G",
    [RESOURCE_OXIDANT]:"O",
    [RESOURCE_REDUCTANT]:"H",
    [RESOURCE_PURIFIER]:"X"
}
let COMPRESSION_MAP = COMPRESSION_LIST.reduce((all,res)=>{all[res] = true;return all},{})

global.BASE_DEPOSITS = [RESOURCE_SILICON,RESOURCE_BIOMASS,RESOURCE_METAL,RESOURCE_MIST];
global.LEVEL0_DEPOSITS = [RESOURCE_WIRE,RESOURCE_CELL,RESOURCE_ALLOY,RESOURCE_CONDENSATE];
let BASE_COMMODITIES_MAP = {
    [RESOURCE_SILICON]:RESOURCE_WIRE,
    [RESOURCE_BIOMASS]:RESOURCE_CELL,
    [RESOURCE_METAL]:RESOURCE_ALLOY,
    [RESOURCE_MIST]:RESOURCE_CONDENSATE
};

// 按等级分类 会快一点点
global.HIGH_LEVEL_COMMODITIES = // 这里需要有房间平衡的策略,被别的策略引用了
    _.keys(COMMODITIES).reduce((out,k)=>{
        let level = COMMODITIES[k].level;
        if(level){
            if(!out[level]) out[level] = {};
            out[level][k]=COMMODITIES[k];
        }
        return out
    },{})

// 计算转移需要的东西
global.FACTORY_RES_MAX_NEED = {};
global.BALANCE_POWER_FACTORY_MAP = {};
global.BALANCE_POWER_FACTORY_LIST = {};
(function () {
    for(let level=1;level<=5;level++){
        let arr = []
        let visited = {}
        for(let resType in HIGH_LEVEL_COMMODITIES[level]){
            let batch = Math.ceil(1000/COMMODITIES[resType].cooldown)
            for(let t in COMMODITIES[resType].components){
                let amount = COMMODITIES[resType].components[t]*batch;
                if( (visited[t]||0)< amount){//(COMMODITIES[t].level || LEVEL1_DEPOSITS.contains(t)) ||
                    arr.push([t,amount])
                    visited[t] = amount;
                    FACTORY_RES_MAX_NEED[t] = Math.max((FACTORY_RES_MAX_NEED[t]||0),amount)
                }
            }
        }
        // log(level,arr)
        let barNeedCnt = 1500;
        [RESOURCE_UTRIUM_BAR,RESOURCE_KEANIUM_BAR,RESOURCE_LEMERGIUM_BAR,RESOURCE_ZYNTHIUM_BAR].forEach(e=>{
            let r = arr.find(t=>t[0]==e);
            if(r)r[1]=Math.max(r[1],barNeedCnt);
            else arr.push([e,barNeedCnt]);
            visited[e]=r?r[1]:barNeedCnt
        })
        BALANCE_POWER_FACTORY_LIST[level] = arr;
        BALANCE_POWER_FACTORY_MAP[level] = visited;
    }
})();

(function () { // 跨shard 传送时保留个数
    let res = [
        ["wire","switch","transistor","microchip","circuit","device"],
        ["alloy","tube","fixtures","frame","hydraulics","machine"],
        ["condensate","concentrate","extract","spirit","emanation","essence"],
        ["cell","phlegm","tissue","muscle","organoid","organism"]
    ];
    let resKeeperCnt = {
        5:30,
        4:30,
        3:80,
        2:120,
        1:500,
        0:1000
    }
    let level=6
    let arr = []
    let visited = {}
    for(let resTypes of res){
        for(let i=0;i<resTypes.length;i++){
            arr.push([resTypes[i],resKeeperCnt[i]]);
            visited[resTypes[i]]=resKeeperCnt[i];
        }
    }
    BALANCE_POWER_FACTORY_LIST[level] = arr;
    BALANCE_POWER_FACTORY_MAP[level] = visited;
})();


Creep.prototype.registerFactoryCarry=function () {
    this.mainRoom()._carryFactory = true;
};


let pro={
    stationName:"stationFactory",
    checkPowerCreep (room,pc){
        if(!pc || !pc.ticksToLive )return false;
        let mainRoom = pc.mainRoom();
        if(mainRoom && mainRoom.name == room.name) return !(pc.store[RESOURCE_OPS] < 100);
        return false
    },
    needPower (room){
        if(!room.factory||room.factory.cooldown)return false;
        let sm = room.memory[pro.stationName];
        return sm && sm.produce
            && sm.stat == STAT_PRODUCE && COMMODITIES[sm.produce.produceResType].level
            && !sm.powered;
    },
    checkNoLevelRes(room,res,amount) {
        let array = []
        let produceTimes = Math.ceil(amount/COMMODITIES[res].amount);
        for(let t in COMMODITIES[res].components){
            let existCnt = StationCarry.roomMassStoreCnt(room,t);
            let resNeedAll = COMMODITIES[res].components[t]*produceTimes;
            // log(t,amount,produceTimes,COMMODITIES[res].components[t],resNeedAll,produceTimes*COMMODITIES[res].amount)
            if(existCnt>=resNeedAll) {
                array.push([t, resNeedAll]);
            // } else if(t.indexOf("bar")>=0){
            } else if(COMPRESSION_MAP[t]){
                return pro.checkNoLevelRes(room,t,produceTimes*COMMODITIES[res].amount)
            } else{
                return undefined;
            }
        }
        return {produceResType:res,needs:array}
    },
    energyCheck(room) {
        let energyCnt = StationCarry.roomMassStoreCnt(room,RESOURCE_ENERGY);
        let batteryCnt = StationCarry.roomMassStoreCnt(room,RESOURCE_BATTERY);
        if(energyCnt>minimum_compression_requires_energy_cnt && batteryCnt < maximum_battery_cnt)
            return {produceResType:RESOURCE_BATTERY,needs:[[RESOURCE_ENERGY,6000]]}
        if(energyCnt<minimum_decompression_requires_energy_cnt&&batteryCnt>=300)
            return {produceResType:RESOURCE_ENERGY,needs:[[RESOURCE_BATTERY,300]]}
        return undefined;
    },
    highLevel (room){
        let flag = room.find(FIND_FLAGS,{filter:e=>e.name.indexOf("OPF")>=0}).head();
        if(!flag)return undefined;
        let split = flag.getNameSplit();
        if(split.length<=1){
            console.log("Error: "+flag.name+" is not OPF_{PC.NAME}");
            return undefined;
        }
        let pc = StrategyFactoryPowerCreep.getPowerCreep(room);
        let level = StrategyFactoryPowerCreep.getPowerFactoryLevel(room);
        if(!pro.checkPowerCreep(room,pc))return undefined;

        let keys = _.keys(HIGH_LEVEL_COMMODITIES[level])//按数量少的开始合成
        if(room.terminal)keys = keys.sort((a,b)=>(room.terminal.store[a]||0)-(room.terminal.store[b]||0))

        for(let resType of keys){
            let maxCnt = MAX_COMMODITY_KEEP[level]
            if(BASE_COMMODITY_SET.has(resType))maxCnt = 1000;
            if(StationCarry.roomMassStoreCnt(room,resType)>=maxCnt)continue;
            let array = []
            let com = HIGH_LEVEL_COMMODITIES[level][resType];
            let cooldown = com.cooldown
            let produceTimes = Math.ceil(1000/cooldown);
            let keys = _.keys(com.components)
            keys.sort((a,b)=>(COMMODITIES[b].level||0)-(COMMODITIES[a].level||0))
            let isNext = false
            for(let t of keys){
                let existCnt = StationCarry.roomMassStoreCnt(room,t);
                let resNeedAll = com.components[t]*produceTimes;
                if(existCnt>=resNeedAll) {
                    array.push([t, resNeedAll]);
                } else if(COMPRESSION_MAP[t]){
                    return pro.checkNoLevelRes(room,t,BAR_BATCH_SIZE*COMMODITIES[t].amount)
                } else if(COMMODITIES[t]&&COMMODITIES[t].level){
                    isNext = true
                    // return undefined;
                }else {
                    isNext = true
                }
            }
            if(isNext)continue;
            // log(level,resType,produceTimes,array)
            // if(level==1)
            return {produceResType:resType,needs:array}
        }
        return undefined;

    },
    noLevel (room){
        for(let com of BASE_DEPOSITS){
            if (StationCarry.roomMassStoreCnt(room,com) >= BASE_BATCH_SIZE) {
                let produce = BASE_COMMODITIES_MAP[com];
                let out = pro.checkNoLevelRes(room,produce,BASE_BATCH_SIZE*COMMODITIES[produce].amount)
                if(out)return out;
            }
        }
        for(let resType of BASE_COMPRESSION_LIST){
            if (StationCarry.roomMassStoreCnt(room,resType) < 1500&&StationCarry.roomMassStoreCnt(room,BASE_COMPRESSION_MAP[resType]) >= 6000) {
                let out = pro.checkNoLevelRes(room,resType,600) //3000 原矿对应压缩后的600
                if(out)return out;
            }
            // by an_w
            else if (StationCarry.roomMassStoreCnt(room,resType) > 9000 && StationCarry.roomMassStoreCnt(room,BASE_COMPRESSION_MAP[resType]) < 6000 &&StationCarry.roomMassStoreCnt(room,'energy') > 120000 ) {
                let out =  pro.checkNoLevelRes(room,BASE_COMPRESSION_MAP[resType],15000)
                if (out) return out;
            }
        }

    },
    getProduceType (room){
        let energy = pro.energyCheck(room);
        if(energy)return energy;
        let noLevel = pro.noLevel(room);
        if(noLevel)return noLevel;
        let highLevel = pro.highLevel(room);
        if(highLevel)return highLevel;
    },
    generatorFillTask (room){
        if(room._carryFactory||!room.factory)return[];
        let sm =  room.memory[pro.stationName];
        if(sm.stat==STAT_FILL){
            let tasks = []
            for(let resCntPair of sm.produce.needs){
                let factoryCnt = room.factory.store[resCntPair[0]]||0;
                if(factoryCnt<resCntPair[1]){
                    tasks.push(UtilsTask.task(room.factory,"fillRes","registerFactoryCarry",{resType:resCntPair[0]}));
                    tasks.push(...StationCarry.generatorMassStoreCarry(room,resCntPair[0],resCntPair[1]-factoryCnt));
                }
            }
            return tasks
        }
        if(sm.stat==STAT_CLEAR){
            return [UtilsTask.task(room.storage,"fillAllTask","registerFactoryCarry"),
                UtilsTask.task(room.factory,"carryAllTask","registerFactoryCarry")]
        }
        return [];
    },
    exec (room){
        if (!room.factory) return;
        let sm = room.memory[pro.stationName];
        if(!sm)sm = room.memory[pro.stationName] = {}
        // HelperVisual.showText(room.factory,sm.stat)
        if(!sm.lastCooldown)sm.lastCooldown = Game.time
        if(!sm.stat) sm.stat = STAT_CLEAR
        if (sm.lastCooldown<=Game.time) {
            // log(pro.generatorFillTask(room))
            // HelperVisual.showText(room.factory,sm.stat)
            if(sm.stat == STAT_CLEAR){// 清理阶段
                sm.powered = false
                if(room.factory.store.getAllResTypeCount()==0){
                    // CPU 保护开关：bucket < 8000 时不启动新生产任务
                    if (Game.cpu.bucket < 8000) {
                        sm.lastCooldown = Game.time + FACTORY_SLEEP_TIME;
                        return;
                    }
                    let needProduce = pro.getProduceType(room)
                    if(!needProduce){
                        sm.lastCooldown = Game.time + FACTORY_SLEEP_TIME;
                    }else{
                        sm.produce = needProduce
                        sm.stat = STAT_FILL
                    }
                }
            }else if(sm.stat == STAT_FILL){// 搬运阶段
                sm.powered = false
                if(!sm.produce){
                    sm.stat = STAT_CLEAR
                    return;
                }
                let fullCnt = 0
                for(let resCntPair of sm.produce.needs){
                    let factoryCnt = room.factory.store[resCntPair[0]]||0;
                    if(factoryCnt>=resCntPair[1]){
                        fullCnt += 1;
                    }
                    if(!room._carryFactory&&StationCarry.roomMassStoreCnt(room,resCntPair[0])+factoryCnt<resCntPair[1]){
                        sm.stat = STAT_CLEAR
                        return;
                    }
                }
                if (sm.produce.needs.length == fullCnt) {
                    sm.stat = STAT_PRODUCE
                }
                // log(room.memory[pro.stationName].produce)
            }else if(sm.stat == STAT_PRODUCE) {// 反应阶段
                // CPU 保护开关：bucket < 8000 时暂停生产（已搬入的原料保留，
                // bucket 恢复后继续）
                if (Game.cpu.bucket < 8000) {
                    sm.lastCooldown = Game.time + 20;
                    return;
                }
                let resType = sm.produce.produceResType
                let code = room.factory.produce(resType)
                if(code!=OK&&COMMODITIES[resType].level){ // 如果需要OP
                    let pc = StrategyFactoryPowerCreep.getPowerCreep(room);
                    let level = StrategyFactoryPowerCreep.getPowerFactoryLevel(room);
                    if(!pro.checkPowerCreep(room,pc)||COMMODITIES[resType].level!=level){// check 一下是不是当前的
                        sm.lastCooldown = Game.time ;
                        sm.stat = STAT_CLEAR
                        return;
                    }
                    let effect = room.factory.effects&&room.factory.effects.head()
                    if(!effect&&sm.powered){ // 如果已经power 过了，并且没反应完
                        sm.lastCooldown = Game.time ;
                        sm.stat = STAT_CLEAR
                        return;
                    }
                    if(!sm.powered)return;// 等待反应
                }
                if(code==OK){
                    if(COMMODITIES[resType].level)sm.powered = true;// 如果是高级商品改为 powered
                    sm.lastCooldown = Game.time + COMMODITIES[resType].cooldown
                    let type = _.keys(COMMODITIES[resType].components)[0];
                    if(room.factory.store[type] == COMMODITIES[resType].components[type]){
                        sm.lastCooldown = Game.time ;
                        sm.stat = STAT_CLEAR
                    }
                }else if(code==ERR_TIRED){
                    sm.lastCooldown = Game.time + 20;// 冷却中，过 20 tick 再试，避免每 tick 空转
                }else{
                    sm.stat = STAT_CLEAR
                }

            }
        }


    },


};



global.StationFactory=pro;
