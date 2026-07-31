
global.LOCAL_SHARD_NAME = Game.shard.name
global.ALL_SHARD_NAME = ["shard0","shard1","shard2","shard3"]
// global.ALL_SHARD_NAME = ['shard3']
global.CORSS_SHARD_TIME_OUT = 5000 // 任务超过5000tick 自动删除，防止内存泄漏 如果没有时间默认删除 比如说我去S1，S1没有cpu，而且爬被吃了,可能我1天都不去,S1没有运行，所以内存泄漏了

/**
 path: [
 { shard: 'shard3', roomName: 'W20N10', x: 40, y: 16 },
 { shard: 'shard2', roomName: 'W20N10', x: 39, y: 33 },
 { shard: 'shard1', roomName: 'W20N10', x: 41, y: 9 },
 { shard: 'shard0', roomName: 'W29N10', x: 1, y: 19 },
 ]
 */

let REQUEST  = "req" // shard A
// let RESPONSE  = "res" // shard B
let CLOSE = "c" // shard A
/*
任务设计：

{ toShard:toShard, id:taskId, data:只有req有 ,type : 4类 ,createTime:Game.time}


TimeOut : 设置 任务超时，如果超时自动删除任务，防止内存泄漏

数据请求的5 阶段 类似 tcp 4级挥手

阶段1 - 发送请求（shard A） A shard 创建一个 任务 stat : req (REQUEST) data :{}
阶段2 - 响应请求（shard B） 发布响应（shard B）   stat : res (RESPONSE) 回复的shard和自己一样自己所以不需要  stat
阶段3 - 关闭请求（shard A） 覆盖id，B还存在阶段2的话stat : c (CLOSE)
阶段4 - 删除响应（shard B） 删除阶段 2的内容       没数据了
阶段5 - 删除请求（shard A） （本质是重复阶段3）     没数据了
 */

// let missionFunc = global.missionFunc


Creep.prototype.testStart = function(){
    Memory.test = Memory.test||{}
    Memory.test.start = Memory.test.start||0
    Memory.test.start+=1
    this.popTask().execLastTask();
}
Creep.prototype.testEnd = function(){
    Memory.test = Memory.test||{}
    Memory.test.end = Memory.test.end||0
    Memory.test.end+=1
    this.popTask().execLastTask();
}
Creep.prototype.moveCrossShardByPath = function(){

    this.autoHeal()
    this.rangedAttack(this.pos.findClosestByRange(FIND_HOSTILE_CREEPS))
    this.attack(this.pos.findClosestByRange(FIND_HOSTILE_CREEPS))

    let path = this.lastTask().path
    let task = this.lastTask()
    task.index = task.index||0;
    for(let i=0;i<path.length;i++){
        let e = path[i]
        if(e.roomName == this.pos.roomName&& e.shard == Game.shard.name){
            task.index = i ;
        }
    }

    // if(!this.memory["index"+task.index])Memory.test["index"+task.index]=(Memory.test["index"+task.index]||0)+1
    // this.memory["index"+task.index]=1

    let current = path[task.index];
    if(task.index==path.length) return this.popTask().execLastTask();
    let pos = new RoomPosition(current.x,current.y,current.roomName)
    if(pos.isNearTo(this)){
        let portal = pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType==STRUCTURE_PORTAL).head()
        if(portal) task.index += 1
        if(portal&&portal.destination&&portal.destination.shard){ //传送门是跨shard的情况下
            this.submitCrossShardCreepMemory(portal.destination.shard,this.memory)
        }
    }
    this.goTo(pos) //先交换内存再走路,防止cpu用完了
}

Creep.prototype.submitCrossShardCreepMemory = function (toShard) {
    let mission = {
        func:"setCreepMemory",
        data:{
            name:this.name,
            memory:this.memory
        }
    }
    ManagerCrossShard.addCrossShardRequest(toShard,mission)
}

let pro={
    getTaskId (){
        Game._cross_shard_req_cnt = ( Game._cross_shard_req_cnt || 0 ) + 1;
        return Game.time +"_"+ Game._cross_shard_req_cnt;
    },
    addCrossShardRequest  (toShard ,data,id=undefined) { // 添加任务
        let task = {from:LOCAL_SHARD_NAME, data:data ,createTime:Game.time, stat: REQUEST};
        if(!id)id = toShard +":"+ pro.getTaskId()
        else id = toShard +":"+id
        if(!toShard||toShard == LOCAL_SHARD_NAME){
            // console.log("toShard equal to " + LOCAL_SHARD_NAME)
            ManagerMissions.addMission(data,id)
            return id;
        }
        if(pro.localShardData){ //及时保存，防止丢内存
            pro.localShardData[id] = task
        }
        else pro.addDataList.push([id,task])
        return id;
    },
    applyRequest(id,req){
        // log(LOCAL_SHARD_NAME,id,req.data.func,req.data.data)
        if(pro.localShardData[id]){
            pro.localShardData[id].createTime = Game.time;
            return;
        }
        if(global.missionFunc[req.data.func](req.data.data)){//来自 mission ，相当于交叉依赖了
            pro.localShardData[id] = {from:req.from,createTime:Game.time}//, stat: RESPONSE}
        }
    },
    closeRequest(taskId,from){ //  转换成关闭状态
        let task = pro.localShardData[taskId] = ( pro.localShardData[taskId] || {createTime:Game.time, stat: CLOSE} );
        if(task.data&&task.data.callBack){
            missionCallBack[task.data.callBack](task.data)
        }
        delete task.data;
        task.stat = CLOSE;
        task.from = from;
        if(!task.createTime)task.createTime = Game.time;
    },
    addDataList : [],
    localShardData : {},
    shardData : {},
    init(){
        if(!isCpuFeatureEnabled("crossShard")||typeof InterShardMemory=="undefined")return;
        let parse = value=>{try{return JSON.parse(value||"{}")||{}}catch(e){return {}}};
        // 获取所有 shard 的 InterShardMemory
        ALL_SHARD_NAME.forEach(name => {
            if(name == LOCAL_SHARD_NAME)pro.shardData[name] = parse(InterShardMemory.getLocal());
            else pro.shardData[name] = parse(InterShardMemory.getRemote(name));
        });

        if(!pro.shardData[LOCAL_SHARD_NAME]) { // 报错 暂时不执行，防止奇怪的东西混进来
            console.log("cross shard error: No local shard, check your codes");
            return;
        }
        pro.localShardData = pro.shardData[LOCAL_SHARD_NAME];
        // if(LOCAL_SHARD_NAME!="shard2")ManagerCrossShard.addCrossShardRequest("shard2",123)

        // 获取其他shard的信息,
        ALL_SHARD_NAME.forEach(name => {
            pro.shardData[name] = pro.shardData[name]||{};
            if(name != LOCAL_SHARD_NAME){
                _.keys(pro.shardData[name]).forEach(taskId=>{
                    if(taskId.startsWith(LOCAL_SHARD_NAME)&&pro.shardData[name][taskId].stat==REQUEST){ // 需要获取的任务
                        pro.applyRequest(taskId,pro.shardData[name][taskId])
                    }else if(taskId.startsWith(name)){ //需要 变成关闭状态的 任务
                        pro.closeRequest(taskId,name)
                    }
                })
            }
        })

        _.keys(pro.localShardData).forEach(id=>{ //删除任务
            if(id.startsWith(LOCAL_SHARD_NAME)){
                if (!pro.shardData[pro.localShardData[id].from]||!pro.shardData[pro.localShardData[id].from][id] //如果任务已经不存在了
                    ||  pro.shardData[pro.localShardData[id].from][id].stat == CLOSE ) {//或者是close状态
                    delete pro.localShardData[id]
                }
            }else if(!id.startsWith("shard") || Game.time-pro.localShardData[id].createTime>CORSS_SHARD_TIME_OUT){ // 任务超时
                delete pro.localShardData[id]
            }else if(pro.localShardData[id].stat==CLOSE && !pro.shardData[pro.localShardData[id].from][id]){ //自己是close 对面没数据的时候
                delete pro.localShardData[id]
            }
        })

    },

    afterWork (){
        if(!isCpuFeatureEnabled("crossShard")||typeof InterShardMemory=="undefined")return;
        // log(LOCAL_SHARD_NAME,pro.localShardData)
        while (pro.addDataList.length){ // 在初始化之前或者 tick提交的则 下一tick保存
            let t = pro.addDataList.pop();
            pro.localShardData[t[0]] = t[1]
        }
        if(pro.localShardData)InterShardMemory.setLocal(JSON.stringify(pro.localShardData))
        pro.localShardData = undefined
    },

};


global.ManagerCrossShard = pro;
