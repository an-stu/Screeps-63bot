
global.LOCAL_SHARD_NAME = Game.shard.name
global.ALL_SHARD_NAME = ["shard0","shard1","shard2","shard3"]
// global.ALL_SHARD_NAME = ['shard3']
// 收件箱扫描间隔（tick）。见 init 内注释。
const CROSS_SHARD_SCAN_INTERVAL = 5;
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
/**
 * 跨 shard 路径推进。
 *
 * 0.78.262 修复「claimer 站在对面 shard 虫洞格上不动」：
 * 原实现**每 tick 从 i=0 重扫**，用当前房间名把 task.index 无条件改回
 * 最后一个匹配的 waypoint。到达最后一段（其坐标就是对面回程虫洞格）后，
 * index 在 `len-1 ↔ len` 之间反复横跳，`index==path.length` 永不成立，
 * 任务永不弹出，claim 任务也永远轮不到执行。
 *
 * 现在：index 只向前推进（跨 shard 后落到新 shard 的下一段），并在确认
 * 实际换 shard 后才完成跳转。站在回程虫洞上时不把 memory 反向递回出发
 * shard；旧双向路径的回程虫洞作为终点兼容处理。
 */
Creep.prototype.moveCrossShardByPath = function(){
    let task = this.lastTask()
    if (!task.peaceful) {
        this.autoHeal()
        let hostile = this.pos.findClosestByRange(FIND_HOSTILE_CREEPS)
        this.rangedAttack(hostile)
        this.attack(hostile)
    }
    let path = task.path
    if (!Array.isArray(path) || !path.length) return this.popTask().execLastTask();
    task.index = Number.isFinite(task.index) ? Math.max(0, Math.floor(task.index)) : 0;

    let shard = Game.shard.name
    let getPortal = waypoint => {
        if (Game.rooms && !Game.rooms[waypoint.roomName]) return undefined
        let pos = new RoomPosition(waypoint.x,waypoint.y,waypoint.roomName)
        return pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType==STRUCTURE_PORTAL).head()
    }

    // New tasks carry the expected destination and source portal. Do not treat
    // the incremented index as proof of arrival: movement can fail while the
    // creep remains on the source shard for many ticks.
    let pending = task.pendingTransition
    if (pending) {
        if (shard == pending.toShard) {
            task.crossShardTransitionConfirmed = true
            delete task.pendingTransition
        } else if (shard == pending.fromShard) {
            let departure = pending.departure
            if (departure) {
                let departurePos = new RoomPosition(departure.x,departure.y,departure.roomName)
                if (Game.rooms && !Game.rooms[departure.roomName]) {
                    this.goTo(departurePos)
                    return
                }
                let portal = departurePos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType==STRUCTURE_PORTAL).head()
                let liveDestination = portal && portal.destination && portal.destination.shard
                if (portal && liveDestination == pending.toShard) {
                    // The original request already includes this task state;
                    // keep retrying movement without enqueuing another copy.
                    this.goTo(departurePos)
                    return
                }
            }

            // A vanished/retargeted portal cannot complete this hop. Roll back
            // to its source waypoint and let the normal path handling keep the
            // task alive until the route can be retried.
            let departureIndex = Number.isFinite(pending.index) ? pending.index : task.index - 1
            task.index = Math.max(0, Math.min(Math.floor(departureIndex), path.length - 1))
            delete task.pendingTransition
        } else {
            // The creep is on neither endpoint of the pending hop. In
            // particular, do not navigate to a same-named room on this shard.
            return
        }
    }

    if (task.index >= path.length) {
        let last = path[path.length - 1]
        if (shard != last.shard) {
            // Legacy tasks did not remember the destination. A creep that has
            // left the last source shard has completed its final hop.
            return this.popTask().execLastTask();
        }

        // Legacy task saved after incrementing at the source. Retry its last
        // departure portal; the destination shard is only accepted after an
        // actual shard change. An old two-way path may instead end at the
        // reverse portal on the landing shard, which is a terminal waypoint.
        let lastPortal = getPortal(last)
        let prev = path[path.length - 2]
        let lastPos = new RoomPosition(last.x,last.y,last.roomName)
        let reverseLanding = prev && prev.shard != shard && lastPortal
            && lastPortal.destination && lastPortal.destination.shard == prev.shard
        if (reverseLanding && lastPos.isNearTo(this)) {
            return this.popTask().execLastTask();
        }
        task.index = path.length - 1
    }

    // Legacy in-flight tasks may have had their index incremented before the
    // new pending-transition marker was introduced. If the next waypoint is
    // on another shard but the previous departure is on this one, retry it.
    if (task.index > 0 && task.index < path.length
        && path[task.index].shard != shard && path[task.index - 1].shard == shard) {
        task.index -= 1
    }

    for(let i=task.index;i<path.length;i++){
        let e = path[i]
        if(e.roomName == this.pos.roomName&& e.shard == shard){
            task.index = i ;
        }
    }

    // Never feed a waypoint from another shard to goTo: room names overlap
    // across shards. This can happen with malformed or partially migrated tasks.
    if (task.index >= path.length || path[task.index].shard != shard) return;

    let current = path[task.index];
    let pos = new RoomPosition(current.x,current.y,current.roomName)
    if(pos.isNearTo(this)){
        let portal = pos.lookFor(LOOK_STRUCTURES).filter(e=>e.structureType==STRUCTURE_PORTAL).head()
        if(portal){
            let destShard = portal.destination&&portal.destination.shard
            if (task.expectedDestShard && destShard !== task.expectedDestShard) return;
            let prev = path[task.index-1]
            let reverseLanding = task.index == path.length - 1 && prev
                && prev.shard != shard && destShard == prev.shard
            if (reverseLanding) {
                // Compatibility with older two-way paths that append the
                // landing-side return portal as their final waypoint.
                return this.popTask().execLastTask()
            } else if(destShard && destShard != shard){
                let departureIndex = task.index
                task.pendingTransition = {
                    fromShard: shard,
                    toShard: destShard,
                    departure: {shard: shard, roomName: current.roomName, x: current.x, y: current.y},
                    index: departureIndex,
                }
                task.index = departureIndex + 1
                this.submitCrossShardCreepMemory(destShard,this.memory)
            }
        } else if (task.expectedDestShard) {
            return; // Explicitly bound operations may not walk onto a missing portal.
        } else if (task.index == path.length - 1 && path.length > 1
            && !task.crossShardTransitionConfirmed) {
            // Pre-marker two-way routes sometimes appended the landing-side
            // endpoint without a portal. Preserve that legacy completion only
            // for markerless multi-entry tasks; a source-only missing portal
            // (and any newly confirmed route) must remain queued.
            return this.popTask().execLastTask()
        }
    }
    this.goTo(pos) //先交换内存再走路,防止cpu用完了
}

/**
 * claim 成功后通知出发 shard 摘掉 claimCrossShard 旗子。
 * 否则 StrategyClaimCrossShard 在源 shard 上看不到目标房（跨 shard 无视野），
 * 每 ~300 tick 继续派新 claimer，形成永远填不满的循环。
 */
Creep.prototype.notifyClaimDone = function (flagName, flagShard) {
    let origin = flagShard || (this.name||"").split("_")[0]
    if (!origin || origin == Game.shard.name || !flagName) return
    ManagerCrossShard.addCrossShardRequest(origin, { func: "removeFlag", data: { name: flagName } })
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
            // Logger.log("CrossShard", "toShard equal to " + LOCAL_SHARD_NAME)
            ManagerMissions.addMission(data,id)
            return id;
        }
        if(pro.localShardData){ //及时保存，防止丢内存
            pro.localShardData[id] = task
            pro.dirty = true;
        }
        else pro.addDataList.push([id,task])
        return id;
    },
    applyRequest(id,req){
        // log(LOCAL_SHARD_NAME,id,req.data.func,req.data.data)
        if(pro.localShardData[id]){
            if (Game.time - (pro.localShardData[id].createTime || 0) >= 100) {
                pro.localShardData[id].createTime = Game.time;
                pro.dirty = true;
            }
            return;
        }
        let handler = global.missionFunc && global.missionFunc[req.data && req.data.func];
        if (typeof handler != "function") {
            Logger.warning("CrossShard", "Unknown cross-shard mission", req.data && req.data.func, id);
            return;
        }
        if(handler(req.data.data)){//来自 mission ，相当于交叉依赖了
            pro.localShardData[id] = {from:req.from,createTime:Game.time}//, stat: RESPONSE}
            pro.dirty = true;
        }
    },
    closeRequest(taskId,from){ //  转换成关闭状态
        let existed = !!pro.localShardData[taskId];
        let task = pro.localShardData[taskId] = (pro.localShardData[taskId] || {createTime:Game.time, stat:CLOSE});
        let changed = !existed || task.stat != CLOSE || task.from != from || !!task.data;
        if(task.data&&task.data.callBack){
            let callback = global.missionCallBack && global.missionCallBack[task.data.callBack];
            if (typeof callback == "function") callback(task.data);
        }
        delete task.data;
        task.stat = CLOSE;
        task.from = from;
        if(!task.createTime)task.createTime = Game.time;
        if (changed) pro.dirty = true;
    },
    addDataList : [],
    localShardData : {},
    shardData : {},
    dirty: false,
    init(){
        if(!isCpuFeatureEnabled("crossShard")||typeof InterShardMemory=="undefined")return;
        // InterShardMemory 读取 + 每个远端 shard 一次 JSON.parse 是固定 CPU
        // 开销，而跨 shard 任务以数百上千 tick 计时，入站扫描错峰到每 5 tick
        // 一次没有可感知影响。出站请求不走这条路：addCrossShardRequest 写入
        // addDataList，仍由每 tick 的 afterWork 冲洗保存。
        if (global.taskDispatchThrottle !== false && Game.time % CROSS_SHARD_SCAN_INTERVAL) return;
        pro.dirty = false;
        let parse = value=>{try{return JSON.parse(value||"{}")||{}}catch(e){return {}}};
        // 获取所有 shard 的 InterShardMemory
        ALL_SHARD_NAME.forEach(name => {
            if(name == LOCAL_SHARD_NAME)pro.shardData[name] = parse(InterShardMemory.getLocal());
            else pro.shardData[name] = parse(InterShardMemory.getRemote(name));
        });

        if(!pro.shardData[LOCAL_SHARD_NAME]) { // 报错 暂时不执行，防止奇怪的东西混进来
            Logger.log("CrossShard", "cross shard error: No local shard, check your codes");
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
                    pro.dirty = true;
                }
            }else if(!id.startsWith("shard") || Game.time-pro.localShardData[id].createTime>CORSS_SHARD_TIME_OUT){ // 任务超时
                delete pro.localShardData[id]
                pro.dirty = true;
            }else if(pro.localShardData[id].stat==CLOSE
                && (!pro.shardData[pro.localShardData[id].from] || !pro.shardData[pro.localShardData[id].from][id])){ //自己是close 对面没数据的时候
                delete pro.localShardData[id]
                pro.dirty = true;
            }
        })

    },

    afterWork (){
        if(!isCpuFeatureEnabled("crossShard")||typeof InterShardMemory=="undefined")return;
        // log(LOCAL_SHARD_NAME,pro.localShardData)
        while (pro.addDataList.length){ // 在初始化之前或者 tick提交的则 下一tick保存
            let t = pro.addDataList.pop();
            if (!pro.localShardData) {
                try { pro.localShardData = JSON.parse(InterShardMemory.getLocal() || "{}") || {}; }
                catch (error) { pro.localShardData = {}; }
            }
            pro.localShardData[t[0]] = t[1]
            pro.dirty = true;
        }
        if(pro.localShardData && pro.dirty)InterShardMemory.setLocal(JSON.stringify(pro.localShardData))
        pro.localShardData = undefined
    },

};


global.ManagerCrossShard = pro;
