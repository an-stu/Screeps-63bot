/**
 boost 设计
 1.小于8级，boost的时候，停下reaction
 2.boost的时候按需分配 资源，boost结束后直接继续反应
 3.一种类型占一个格子（如果part超过100个则占用两个lab）
 4.boost的时候，一边生一边填充lab，填充lab优先级最高


 delete Game.rooms.W9N2.memory.stationLab.reacting
 */

global.LAB_REACTIONS = function (){
    let map = {}
    for(let a in REACTIONS){
        for(let b in REACTIONS[a]){
            if(!map[REACTIONS[a][b]]){
                map[REACTIONS[a][b]] = [a,b]
            }
        }
    }
    return map
} ()

// global.LAB_REACTIONS_KEYS = _.keys(LAB_REACTIONS).sort((a,b)=>a.length==b.length? REACTION_TIME[a]-REACTION_TIME[b]: a.length-b.length)
// 自定义排序
global.LAB_REACTIONS_KEYS = ["G","ZK","UL","GH","LH","OH","GH2O","LHO2","LO","KO","KH","ZO","GO","UO","UH","ZH","UHO2","KH2O","ZHO2","UH2O","KHO2","LH2O","GHO2","ZH2O","XUHO2","XZHO2","XLHO2","XUH2O","XKHO2","XKH2O","XLH2O","XGH2O","XGHO2","XZH2O"]
// log(LAB_REACTIONS_KEYS)

// 每个身体部件消耗 30 单位矿物，20 单位能量 WORK -> harvest build dismantle upgradeController
// BOOST_RES =  [
// {"harvest":["UO","UHO2","XUHO2"],
// "build":["LH","LH2O","XLH2O"],
// "dismantle":["ZH","ZH2O","XZH2O"],
// "upgradeController":["GH","GH2O","XGH2O"],
// "attack":["UH","UH2O","XUH2O"],
// "rangedAttack":["KO","KHO2","XKHO2"],
// "heal":["LO","LHO2","XLHO2"],
// "capacity":["KH","KH2O","XKH2O"],
// "fatigue":["ZO","ZHO2","XZHO2"],
// "damage":["GO","GHO2","XGHO2"]}]
global.FIGHT_BOOST_RES_MAP = {[MOVE]:"fatigue",[TOUGH]:"damage",[HEAL]:"heal",[RANGED_ATTACK]:"rangedAttack",[ATTACK]:"attack",[WORK]:"dismantle"}
global.BOOST_RES_HOLD = {
    "G":6000,
    "LH":9000,
    "GH":18000,
    "KH":9000,
    "KO":9000,
    "LO":12000,
    "GH2O":15000,
    "LH2O":15000,
    "LHO2":9000,
    "UH2O":15000,
    "UHO2":15000,
    "KH2O":9000,
    "ZHO2":9000,
    "GHO2":9000,
    "XLHO2":500000,
    'XLH2O':500000,
    "XGHO2":500000,
    'XGH2O':50000,
    "XZHO2":500000,
    "XZH2O":500000,
    "XUH2O":500000,
    "XUHO2":50000,
    "XKHO2":500000,
    'XKH2O':50000
}

global.BOOST_RES = function(){
    let map = {}
    _.values(BOOSTS).forEach(mp=>{
        for(let resType in mp){
            for(let action in mp[resType]){
                map[action] = map[action] || []
                map[action].push(resType)

            }
        }
    })
    for(let action in map){
        map[action] = map[action].sort((a,b)=>a.length-b.length)
    }
    return map
}()
delete BOOST_RES.rangedMassAttack // 重复
delete BOOST_RES.rangedHeal //重复
delete BOOST_RES.repair //重复
// ["harvest","build","dismantle","upgradeController","attack","rangedAttack","heal","capacity","fatigue","damage"]
global.BOOST_RES_KEYS = _.keys(BOOST_RES)
// log(BOOST_RES)

Creep.prototype.registerStationLabCarry=function () {
    this.mainRoom().carryLabs = true;
    this.mainRoom()._Lab_reaction_carrier = this
};

/*
data : {
    "UHO2":300 // UHO2 boost 10个part 需要 200 能量
}
 */
Creep.prototype.registerBoostCreep=function () {
    if(this.checkBoosted)return;
    this.checkBoosted = true;
    this.memory.isBoost = true; // 如果需要boost 这里会标记true来表示这个 creep 有 boost 行为
    this.room._boost_need = this.room._boost_need || [];
    for(let task of this.memory.tasks){
        if(task.taskName == "boostCreepBodyPart"){
            this.room._boost_need.unshift(task.data);
        }
    }
    // let task = this.headTask();
    // if(!task.data) return;
};

Creep.prototype.boostCreepBodyPart = function () {
    let data = this.lastTask().data;
    let resType = _.keys(data).sort((a,b)=> a.localeCompare(b)).head();
    this.say(resType);
    let lab = pro.getBoostLab(this.room,resType);
    if(!lab)return;
    let currentCnt = parseInt(lab.store[resType]/30)*30;
    if(data[resType]/30>lab.store[RESOURCE_ENERGY]/20||currentCnt==0)return;
    let boostCnt = Math.min(currentCnt/30, data[resType]/30)
    let code = lab._used ?ERR_TIRED : lab.boostCreep(this,boostCnt)
    if(code == OK){
        lab._used = true
        if(boostCnt*30==data[resType]) {
            delete data[resType];
            // this.memory.dontPullMe = false;
            if(_.keys(data).length==0)this.popTask().execLastTask();
        }
        else data[resType]-=boostCnt*30;
    }else{
        this.moveTo(lab)
        // this.memory.dontPullMe = false;
    }
}


Creep.prototype.registerCarryBoostRes=function () {
    this.mainRoom().carryLabs = true;
    this.room._boost_res_carry = this.room._boost_res_carry||{}
    for(let resType of this.store.getResTypeList()){
        this.room._boost_res_carry[resType] = this.store[resType]
    }
};


// REACTIONS
// REACTION_TIME
// BOOSTS


Creep.prototype.registerUnboostCreep=function () {

};

Creep.prototype.UnboostCreepBodyPart = function () {
    let needUnboost = this.body.filter(e=>e.boost).length;
    let container = this.lastTaskObj();
    if(needUnboost&&container){
        if(this.pos.isEqualTo(container)){
            let obj =  this.room.memory[pro.stationName]
            let labs = (obj["centerLabs"].concat(obj["otherLabs"])).map(id=>Game.getObjectById(id));
            for(let lab of labs){
                if(lab.pos.isNearTo(this)&&lab.cooldown==0){
                    lab.unboostCreep(this);
                    return;
                }
            }
            // let lab = container.pos.findInRange(FIND_STRUCTURES,1,{filter:e=>e.my&&e.structureType==STRUCTURE_LAB&& (e.cooldown==0) }).head()
            // // if(lab)this.say(lab.cooldown)
            // if(lab)lab.unboostCreep(this);
        }else{
            this.moveTo(container)
        }
    }else{
        this.popTask().execLastTask();
    }
}



let pro={
    stationName:"stationLab",
    /**
     * 看看这个房间的资源是否够 boost
     * @param room
     * @param boostResMap { "GH2O":3, "KH":3 }
     */
    boostAble(room,boostResMap){
        if(room&&room.storage&&room.storage.store[RESOURCE_ENERGY]<10000)return false;
        if(room.controller.progress>room.controller.progressTotal)return false;
        let obj =  room.memory[pro.stationName] || (room.memory[pro.stationName] = {})
        if(!obj["centerLabs"]||!obj["centerLabs"].length)return false;
        let fillingRes = {}
        if(obj["stat"]=='fill'){ // 填充的时候要
            let a = LAB_REACTIONS[obj["reacting"]][0]
            let aCnt = (Game.getObjectById(obj["centerLabs"][0]).store[a]||0)
            fillingRes[a] = 3000 - aCnt
            let b = LAB_REACTIONS[obj["reacting"]][1]
            let bCnt = (Game.getObjectById(obj["centerLabs"][1]).store[b]||0)
            fillingRes[b] = 3000 - bCnt
            if(room._Lab_reaction_carrier){
                fillingRes[a] -= room._Lab_reaction_carrier.store[a] || 0
                fillingRes[b] -= room._Lab_reaction_carrier.store[b] || 0
            }
        }
        let registerMap = pro.getRegBoostMap(room) //这里是注册的，注册的时候这部分资源应该减去
        for(let resType in boostResMap){
            let carryCnt = room._boost_res_carry?(room._boost_res_carry[resType]||0):0;
            let storeCnt = room.storage?room.storage.store[resType]||0:0;
            storeCnt += room.terminal&&room.terminal.store[resType]||0;
            room.memory[pro.stationName].boostLabMap = room.memory[pro.stationName].boostLabMap || {}
            let labCnt = (room.memory[pro.stationName].boostLabMap[resType]||[]).map(id=>Game.getObjectById(id)).reduce((all,lab)=>all+(lab.store[resType]||0),0)
            // log(resType,storeCnt,carryCnt,labCnt,boostResMap[resType])
            if((storeCnt+carryCnt+labCnt - (fillingRes[resType]||0)) - (registerMap[resType] ||0)<boostResMap[resType] && boostResMap[resType]>0) return false;
        }
        // return false;
        return true;
    },
    getFightBodyResMap(bodys,level){
        return bodys.reduce((a,e)=>{let t= BOOST_RES[FIGHT_BOOST_RES_MAP[e]][level];a[t]=(a[t]||0)+30;return a},{})
    },
    boostAbleLevel(room,action,partCnt,maxLevel = 2,minLevel = 0){
        for(let i=maxLevel;i>=minLevel;i--){
            if(pro.boostAble(room,{[BOOST_RES[action][i]]:partCnt*30})){
                return i;
            }
        }
        return -1;
    },
    generatorBoostLevelTask(room,action, partCnt, level){
        let data = {[BOOST_RES[action][level]]:partCnt*30}
        return pro.generatorBoostResTask(data,room);
    },
    generatorBoostFightBodyTask(bodys,level,room){
        return pro.generatorBoostResTask(pro.getFightBodyResMap(bodys,level),room);
    },
    generatorBoostResTask(data,room){
        if(room){
            if(!room._boost_need)room._boost_need = []
            room._boost_need.unshift(data)
        }
        return [UtilsTask.taskData("boostCreepBodyPart","registerBoostCreep",{data:data})];
    },
    getRegBoostMap(room){ // 从 register 中拿到的，进行计算
        let boostMap = {}
        if(room._boost_need)
            for(let boosNeed of room._boost_need){
                for(let resType in boosNeed){
                    boostMap[resType] = (boostMap[resType]||0) + (boosNeed[resType]||0)
                }
            }
        return boostMap;
    },
    getBoostLab(room,resType){
        let obj =  room.memory[pro.stationName] || (room.memory[pro.stationName] = {})
        let boostLabMap = (obj.boostLabMap = obj.boostLabMap||{} ); // 使用中的lab
        let labs = (boostLabMap[resType]||[]).map(id=>Game.getObjectById(id)).sort((a,b)=>b.getLabReactionCnt()-a.getLabReactionCnt())
        return labs.head();
    },
    getNoBoostLab(room){
        let obj =  room.memory[pro.stationName] || (room.memory[pro.stationName] = {})
        let boostLabMap = (obj.boostLabMap = obj.boostLabMap||{} ); // 使用中的lab
        let labs = (obj["otherLabs"].concat(obj["centerLabs"])).map(id=>Game.getObjectById(id));
        let allUsed_= _.values(boostLabMap).flat()
        let out = labs.filter(e=>!allUsed_.contains(e.id)).head()
        if(!obj["centerLabs"]||!out) return undefined;
        if((obj["centerLabs"].contains(out.id))){ //如果动到了 中心lab 就停止反应
            obj["stat"]='clear'
        }
        return out;
    },
    checkBoostLabsNeed(room){ //计算lab还需要填充哪些东西
        if((Game.time+room.hashCode())%3!=0)return;// 和tick同步，没创建的时候不计算，省点cpu
        let obj =  room.memory[pro.stationName]
        let boostLabMap = obj.boostLabMap; // 使用中的lab
        let regBoostMap = pro.getRegBoostMap(room) ;//需要的数量

        for(let resType in boostLabMap) {
            if(!regBoostMap[resType])delete boostLabMap[resType];
        }

        let boostRequires = {} // boost 还没填好的

        for(let resType in regBoostMap){
            if(!boostLabMap[resType])boostLabMap[resType] = []
            let currentLabs = boostLabMap[resType].map(id=>Game.getObjectById(id)).filter(e=>e)
            let regCnt = regBoostMap[resType]
            let carryCnt = room._boost_res_carry?(room._boost_res_carry[resType]||0):0;
            let currentSum = currentLabs.reduce((all,a)=>all+(a.store[resType]||0),0) + carryCnt;
            if(currentSum<regCnt){
                boostRequires[resType] = regCnt - currentSum
                while(true){
                    let allCap = currentLabs.length*3000
                    if(allCap>= regCnt)break;
                    let freeLab = pro.getNoBoostLab(room);
                    if(freeLab&&currentLabs.length==0){// 只填一个 后期再改
                        currentLabs.push(freeLab)
                        boostLabMap[resType] = currentLabs.map(e=>e.id)
                    }
                    else break;
                }
            }
        }
        room._boost_requires = boostRequires;
        return boostRequires
    },
    generatorUnboostTask(room){
        let container = StationLab.getUnboostContainer(room);
        if(!container)return [];
        return [UtilsTask.task(container,"UnboostCreepBodyPart","registerUnboostCreep")];
    },
    getUnboostContainer (room){
        if(room.memory[pro.stationName]&&room.memory[pro.stationName].unboostContainer)
            return Game.getObjectById(room.memory[pro.stationName].unboostContainer)
    },
    /**
     * 两个centerlab必须靠近
     * @param room
     * @param centerLabs
     * @return {string|any|undefined}
     */
    checkUnboostContainer (room,centerLabs){
        let labs = centerLabs.map(id=>Game.getObjectById(id))
        if(labs.length!=2 || !labs[0].pos.isNearTo(labs[1]))return undefined;
        for(let container of room.container){
            let cnt = 0
            for(let lab of labs){
                if (lab.pos.isNearTo(container)) cnt +=1
            }
            if(cnt == 2) return container
        }
        let x = labs[0].pos.x;
        let y = labs[0].pos.y;
        for(let i=-1;i<=1;i++){
            for(let j=-1;j<=1;j++) {
                if(i||j){
                    let pos = new RoomPosition(x+i,y+j,room.name)
                    if(pos.isNearTo(labs[1])&&pos.walkable()){
                        if(pos.lookFor(LOOK_CONSTRUCTION_SITES).length==0)pos.createConstructionSite(STRUCTURE_CONTAINER)
                        return undefined;
                    }
                }
            }
        }
        return undefined;
    },
    checkLabs (room) {
        if(!room.my)return;
        let obj =  room.memory[pro.stationName] || (room.memory[pro.stationName] = {})
        obj["centerLabs"]=obj["centerLabs"]||[]
        obj["otherLabs"]=obj["otherLabs"]||[]
        let labCnt = (obj["centerLabs"].concat(obj["otherLabs"])).filter(id=>Game.getObjectById(id)).length
        let historyCnt = obj["centerLabs"].length+obj["otherLabs"].length
        let notCheckActive = room.level>=8||CONTROLLER_STRUCTURES[STRUCTURE_LAB]>=room.lab.length
        let labs = room.lab.filter(e=>notCheckActive||e.isActive()).sort((a,b)=>a.id<b.id) //  先按id排序
        if(labs.length>=3&&labCnt!=labs.length||historyCnt!=labCnt){
            obj.task = []
            let centerLabs = [undefined,undefined,[]];//[labA,labB,Cnt]

            for(let i=0;i<labs.length;i++){
                let labA = labs[i]
                for(let j=i+1;j<labs.length;j++){
                    let labB = labs[j]
                    let otherLabs = []
                    // if(labA.pos.inRangeTo(labB,5))
                    if(labA.pos.isNearTo(labB))
                        labs.forEach(labC=>{
                            if(labC!=labA&&labC!=labB&&labA.pos.inRangeTo(labC,2)&&labB.pos.inRangeTo(labC,2)){
                                otherLabs.push(labC)
                            }
                        })
                    if(otherLabs.length>centerLabs[2].length){
                        centerLabs = [labA,labB,otherLabs]
                    }
                }
            }
            if(centerLabs[0]){
                obj.centerLabs = [centerLabs[0].id,centerLabs[1].id]
                obj.otherLabs = centerLabs[2].map(e=>e.id)
            }else{
                obj.centerLabs = []
                obj.otherLabs = []
            }
            // room.memory[pro.stationName] = obj
        }
        if(labCnt>=3){
            if(!Game.getObjectById(obj["unboostContainer"])){
                obj["unboostContainer"]=undefined
                let container = pro.checkUnboostContainer(room,obj.centerLabs);
                if(container)obj["unboostContainer"] = container.id
            }
        }
        return obj["centerLabs"].length==2&&obj["otherLabs"].length
    },
    generatorOperatorBoostTask (room){
        let boostLabMap = room.memory[pro.stationName].boostLabMap; // 使用中的lab
        // if(room.name =="W5N3")log(room.carryLabs)
        let tasks = [];
        if(!room._boost_requires||!boostLabMap||room.carryLabs)return tasks;
        for(let resType in room._boost_requires){
            for(let v of boostLabMap[resType]){
                let lab = Game.getObjectById(v)
                let currentResType = lab.store.getLabReactionResType()
                if(currentResType&&currentResType!=resType) { // 清理垃圾
                    tasks.unshift(UtilsTask.task(room.storage, "fillRes", undefined,{resType: resType,fromStorage:false}))
                    tasks.push(UtilsTask.task(lab, "carryRes", "registerCarryBoostRes", {resType: currentResType}))
                }
            }
        }
        if(tasks.length)return tasks;
        for(let resType in room._boost_requires){
            for(let v of boostLabMap[resType]){
                let lab = Game.getObjectById(v)
                let fillAbleCnt = 3000 - lab.store.getUsedCapacity(resType)
                if(fillAbleCnt){
                    let carryCnt = Math.min(fillAbleCnt,room._boost_requires[resType])
                    room._boost_requires[resType]-=carryCnt;
                    if(room._boost_requires[resType] == 0 )delete room._boost_requires[resType]
                    tasks.unshift(UtilsTask.task(lab, "fillRes", "registerCarryBoostRes", {resType: resType,resCount:carryCnt,fromStorage:false}))
                    let from = (room.storage.store[resType]||0)>=(room.terminal&&room.terminal.store[resType]||0)?room.storage:room.terminal
                    tasks.push(UtilsTask.task(from, "carryRes", "registerCarryBoostRes", {resType: resType,resCount:carryCnt}))
                }
            }
        }
        return tasks;
    },
    needReaction (room){
        let obj =  room.memory[pro.stationName];
        if(obj["reacting"]) return obj["reacting"];
        // 如果上次检查过了就不检查了
        if(Game.time-(obj.lastCheckNeedReactionTick||0)<=30)return obj["reacting"];
        obj.lastCheckNeedReactionTick = Game.time;

        let storage = room.storage;
        let terminal = room.terminal;
        let getTotal = function (resType){
            let cnt = 0;
            if(storage) cnt += storage.store.getUsedCapacity(resType);
            if(terminal) cnt += terminal.store.getUsedCapacity(resType);
            return cnt;
        }
        for(let res of LAB_REACTIONS_KEYS){
            let a = LAB_REACTIONS[res][0]
            let b = LAB_REACTIONS[res][1]
            if(getTotal(res)<3000 &&getTotal(a)>=3000 &&getTotal(b)>=3000){
                obj["reacting"] = res;
                break;
            }
        }
        // if(obj["reacting"])return obj["reacting"];
        let min = 1e20;
        let currentLevel = 9;
        if(obj["reacting"])currentLevel = obj["reacting"].length // 先t2在t3
        // log(obj["reacting"],currentLevel)
        for(let k in BOOST_RES_HOLD){
            let total = getTotal(k);
            let a = LAB_REACTIONS[k][0]
            let b = LAB_REACTIONS[k][1]
            if((total<BOOST_RES_HOLD[k]&&total<min && currentLevel>=k.length )&&getTotal(a)>=3000 &&getTotal(b)>=3000){
                currentLevel = k.length
                min = total
                obj["reacting"] = k
                // log(k)
            }
        }
        // obj["stat"] = "clear"
        return obj["reacting"];
    },
    generatorFillEnergyTask (room){
        if(!_.keys(room._boost_need).length)return [];
        let obj =  room.memory[pro.stationName];
        let boostingLab = new Set(_.values(obj.boostLabMap).flat())
        // if(!obj||!obj.centerLabs||!obj.centerLabs.length)return[];
        room.used = room.used||{}
        return room.lab.filter(e => e && boostingLab.has(e.id) && e.store.getFreeCapacity(RESOURCE_ENERGY) > 1000 && !room.used[e.id] )
            .map(lab => UtilsTask.task(lab, "fillRes", "registerUsed", {
                resType: RESOURCE_ENERGY, resCount: lab.store.getFreeCapacity(RESOURCE_ENERGY)
            }));
    },
    generatorFillReactionTask (room){
        if(room.carryLabs)return [];
        let obj =  room.memory[pro.stationName];
        if(!obj||!obj.centerLabs||!obj.centerLabs.length)return[];
        if(!obj["reacting"])return [];
        if(!obj["reacting"]||obj["stat"] != "fill")return [];
        // if(obj.centerLabs.length){
        let a = LAB_REACTIONS[obj["reacting"]][0]
        let b = LAB_REACTIONS[obj["reacting"]][1]
        let centerLab = obj.centerLabs.map(id => Game.getObjectById(id))
        let task = []
        if(centerLab[0].store.getFreeCapacity(a)){
            task = [UtilsTask.task(centerLab[0], "fillRes", "registerStationLabCarry",
                {resType: a, resCount: centerLab[0].store.getFreeCapacity(a)})]
        }
        else if(centerLab[1].store.getFreeCapacity(b)){
            task = [UtilsTask.task(centerLab[1], "fillRes", "registerStationLabCarry",
                {resType: b, resCount: centerLab[1].store.getFreeCapacity(b)})]
        }
        return task;
    },
    generatorClearLabRes (room){
        if(room.carryLabs)return [];
        let obj =  room.memory[pro.stationName];
        if(!obj||!obj.centerLabs||!obj.centerLabs.length)return[];
        let fillTask = [UtilsTask.task(room.storage,"fillAllTask",undefined)]

        let container = pro.getUnboostContainer(room)
        if(container&&!room.used[container.id]&&container.store.getResTypeList().length){ // 如果 container 里面有东西先清理掉
            return fillTask.concat([UtilsTask.task(container,"carryAllTask","registerUsed")])
        }


        let boostingLab = new Set(_.values(obj.boostLabMap).flat())
        if(obj["stat"] != "clear"){
            if(obj["stat"]=="reacting"){
                fillTask = fillTask.concat(obj.otherLabs.map(id => Game.getObjectById(id)).filter(e => e && !boostingLab.has(e.id) && e.store.getLabReactionResType() != undefined && e.store.getLabReactionResType()!=obj["reacting"]).map(lab=>{
                    return UtilsTask.task(lab, "carryRes", "registerStationLabCarry",
                        {resType: lab.store.getLabReactionResType()})
                }));
                if(fillTask.length>1)return fillTask;
                else return [];
            }
            else return [];
        }//!obj["reacting"]||
        let labs = obj.centerLabs.concat(obj.otherLabs).map(id => Game.getObjectById(id)).filter(e => e && e.store.getLabReactionCnt())
        if(labs.length==0)obj["stat"] = undefined
        fillTask = fillTask.concat(labs.filter(e=> !boostingLab.has(e.id) ).map(lab=>{
            return UtilsTask.task(lab, "carryRes", "registerStationLabCarry",
                {resType: lab.store.getLabReactionResType()})
        }))
        if(fillTask.length>1)return fillTask
        else return []
    },
    exec (room){

        // if ((Game.time+room.hashCode()) % 30 != 0)return;
        if(!room.storage)return;
        room.memory[pro.stationName] = room.memory[pro.stationName]||{}
        if(!this.checkLabs(room))return;
        let obj =  room.memory[pro.stationName];
        let boostLabMap = (obj.boostLabMap = obj.boostLabMap||{} ); // 使用中的lab
        // obj.lastCheckNeedReactionTick = Game.time;
        let resType = pro.needReaction(room)
        // room._boost_need = []
        // room._boost_need.push({"GH":1000,"KH":800,"G":1100,"K":1100,"L":1100,"X":1100,"O":1100,"H":1100,"Z":1100});
        // room._boost_need.push({"GH":2000,"KH":1001});
        pro.checkBoostLabsNeed(room)
        // obj["stat"] = "clear"
        // delete obj["reacting"]
        // return;

        // HelperVisual.showText(Game.getObjectById(obj["centerLabs"][1]),JSON.stringify(obj.boostLabMap))
        // HelperVisual.showText(Game.getObjectById(obj["centerLabs"][0]),JSON.stringify(room._boost_need))

        // HelperVisual.showText(Game.getObjectById(obj["centerLabs"][0]),(obj["stat"] + " "+ obj["reacting"]))
        if(resType){
            let otherLabs = obj.otherLabs.map(id => Game.getObjectById(id))
            let centerLabs = obj.centerLabs.map(id => Game.getObjectById(id))
            if(obj["stat"]=='clear'||obj["stat"]==undefined){
                if(otherLabs.concat(centerLabs).filter(e => e && e.store.getLabReactionCnt()).length == 0) {
                    obj["stat"] = 'fill'
                }else{
                    obj["stat"] = 'clear'
                }
            }else if(obj["stat"]=='fill'){
                let a = LAB_REACTIONS[obj["reacting"]][0]
                let b = LAB_REACTIONS[obj["reacting"]][1]
                // HelperVisual.showText(Game.getObjectById(obj["centerLabs"][0]),(obj["stat"] + " "+ obj["reacting"]+" "+a+" "+b))
                if(centerLabs[0].store[a]==3000&&centerLabs[1].store[b]==3000){
                    obj["stat"] = 'reacting' //如果准备好了就开始反应
                }
                if((centerLabs[0].store.getLabReactionResType()!=a&&centerLabs[0].store.getLabReactionCnt()!=0)||
                    (centerLabs[1].store.getLabReactionResType()!=b&&centerLabs[1].store.getLabReactionCnt()!=0)){
                    obj["stat"] = 'clear' // 如果混进其他东西
                    delete obj["reacting"];
                }
                else if(!room.carryLabs&&((centerLabs[0].store.getLabReactionCnt()+(room.storage.store[a]||0)+(room.terminal&&room.terminal.store[a]||0)<3000)||
                    (centerLabs[1].store.getLabReactionCnt()+(room.storage.store[b]||0)+(room.terminal&&room.terminal.store[b]||0)<3000))){
                    obj["stat"] = 'clear'
                    delete obj["reacting"];
                }
                // HelperVisual.showText(Game.getObjectById(obj["centerLabs"][0]),(centerLabs[0].store.getLabReactionCnt()+room.storage.store[a]<3000))
                // HelperVisual.showText(Game.getObjectById(obj["centerLabs"][1]),(centerLabs[1].store.getLabReactionCnt()+room.storage.store[b]<3000))
            }if (obj["stat"] == 'reacting' && (!obj["reacting"]||
                (centerLabs[0].store.getLabReactionResType()||LAB_REACTIONS[obj["reacting"]][0])!=LAB_REACTIONS[obj["reacting"]][0]||
                (centerLabs[1].store.getLabReactionResType()||LAB_REACTIONS[obj["reacting"]][1])!=LAB_REACTIONS[obj["reacting"]][1])){
                obj["stat"] = 'clear'
            }else if(obj["stat"] == 'reacting'&& (Game.time+room.hashCode())%(REACTION_TIME[obj["reacting"]]) == 0){
                if(isSaveCpu&&Game.cpu.bucket<20||MIN_CPU)return;
                let boosting = new Set(_.values(boostLabMap).flat())
                for(let lab of otherLabs){
                    if(boosting.has(lab.id))continue;
                    let code = lab.runReaction(centerLabs[0],centerLabs[1])
                    if(code==ERR_TIRED){
                        // delete obj["reacting"];
                        // break;
                    }else if(code == ERR_NOT_ENOUGH_RESOURCES || code == ERR_FULL){
                        obj["stat"] = 'clear'
                        delete obj["reacting"];
                        break;
                    }
                }
            }
        }
        // else{
        //     obj["stat"]='clear'
        // }
        // obj["stat"]='clear'
        // delete obj["reacting"];
    },

};

// Game.creeps["820508"].addTask(StationLab.generatorBoostTask("build",16,0)).addTask(StationLab.generatorBoostTask("capacity",17,0))
// Game.creeps["818719"].addTask(StationLab.generatorBoostTask("capacity",50-17,0))
// StationHive.trySpawn(Game.rooms.W8N3,"global",ManagerCreeps.calcBodyPart({ [MOVE]: 5, [HEAL]: 5 }),"heal",StationLab.generatorBoostTask("heal",5,0).concat(StationLab.generatorBoostTask("fatigue",5,0)))
// StationHive.trySpawn(Game.rooms.W8N3,"W8N3",ManagerCreeps.calcBodyPart({ [MOVE]: 17, [CARRY]: 33 }),"carrier",StationLab.generatorBoostTask("capacity",33,0))
//

global.StationLab=pro;
