/**
 * 完全以旗帜为管理的战斗系统（适合微操）
 */


/**
 * creep._usingAttack 是否使用过近战击了
 * creep._usingHeal 是否使用过治疗击了
 * creep._usingRangeAttack 是否使用过范围攻击击了
 */


global.warMap = {
    roomCost: {},//缓存地形
    roomStructures: {},//缓存建筑
    roomCreeps: {},//敌对爬
    roomTowers:{},//塔伤
    roomDamegeMap:{}//伤害图
}


const POS_MARK = ['↖', '↗', '↘', '↙'];
const POS_MARK_INDEX = {['↖']:0, ['↗']:1, ['↘']:2, ['↙']:3};
const POS_MARK_MAP = {['↖']:[0, 0], ['↗']:[1, 0], ['↙']:[0, 1], ['↘']:[1, 1]};
const MASK_POS_MAP = [['↖','↗'],['↙', '↘']];
const SPAWN_TEAM_TTL = 2000;


Creep.prototype.doNothing=function () {
};


Creep.prototype.registerFlag1t=function () {
    if(this.spawning)return;
    let flag = this.headTaskFlag();
    if(flag){
        if(!flag._creeps) flag._creeps = []
        // if(!flag._creeps.contains(this)){
        flag._creeps.push(this) // 这里理论上每tick调用一次，不需要检测是否自己在里面
        // }

        if(!flag.memory.creeps)flag.memory.creeps= []
        if(!flag.memory.creeps.contains(this.id))
            flag.memory.creeps.push(this.id)
    }
};

/**
 * 生产管理 粒度：小队
 * 旗子：spawnTeam_{roomName}_{index}
 * 生产时必须有3个以上的爬才会生产
 */
global.SpawnTeam = {
    getQueueMemory(flag) {
        if (!flag) return undefined;
        if (flag.memory && Array.isArray(flag.memory.spawnList)) return flag.memory;
        if (Game._powerBankSpawnQueues && Game._powerBankSpawnQueues[flag.name]) return Game._powerBankSpawnQueues[flag.name];
        return Memory.powerBankSpawnQueues && Memory.powerBankSpawnQueues[flag.name];
    },
    removeQueue(flag) {
        if (Game._powerBankSpawnQueues) delete Game._powerBankSpawnQueues[flag.name];
        if (Memory.powerBankSpawnQueues) delete Memory.powerBankSpawnQueues[flag.name];
        flag.remove();
    },
    hasSpawnList(flag) {
        let memory = this.getQueueMemory(flag);
        return !!(memory && Array.isArray(memory.spawnList));
    },
    exec (flag){
        if(!flag)return console.log("flag can not exit");
        let memory = this.getQueueMemory(flag);
        if (!memory || !Array.isArray(memory.spawnList)) {
            Logger.warning("Removing invalid spawnTeam flag", flag.name);
            this.removeQueue(flag);
            return;
        }
        if (!memory.spawnList.length) {
            this.removeQueue(flag);
            return;
        }
        // Spawn queues are short-lived: once a request is blocked by an
        // unavailable spawn, keeping it forever turns one combat flag into a
        // permanent per-tick CPU cost. Old queues had no timestamp, so they
        // are deliberately treated as legacy state and discarded on reload.
        if (!Number.isFinite(memory.createdAt)
            || Game.time - memory.createdAt > SPAWN_TEAM_TTL) {
            Logger.warning("Removing expired spawnTeam flag", flag.name);
            this.removeQueue(flag);
            return;
        }
        let room = Game.rooms[flag.pos.roomName];
        if(!room||!room.my){
            flag.remove();
            return console.log("room "+flag.pos.roomName+" is not yours");
        }

        let list = memory.spawnList;
        if(room.creeps("carrier",false).filter(e=>(e.ticksToLive||1500)>150).length<list.length+1)
            if(room.creeps("carrier").filter(e=>(e.ticksToLive||1500)>150).length>=1)StationHive.trySpawn(room,room.name,StationCarry.getCarrierBodyConfig(room),"carrier",[])
        if(room.creeps("carrier",false).filter(e=>(e.ticksToLive||1500)>150).length<list.length+1)
            return;

        let head = list.head();
        if(head){
            let result = StationHive.trySpawn(flag.room,flag.room.my?flag.room.name:"global",head.body,"team",head.tasks)
            if(result)list.shift();
        }

    }

}


global.ManageTeam = {
    checkSquare(flag){
        let creeps = flag._creeps;
        if(!creeps||creeps.filter(e=>!e.spawning).length<4)return false;
        return action.team4checkSquarePos(flag)
    },
    execCalDamage  ( flag ){
        if(flag._creeps)flag._creeps = flag._creeps.filter(e=>e.lastTask().regFun=="registerFlag1t")
        if(!flag._creeps||!flag._creeps.length)return false;

        action.autoHealTeamActive(flag); // 得到是否逃跑
        action.avoidHostile(flag);
        action.autoAttackTeam(flag);

        // log(Game.cpu.getUsed() - t)
    },

    execCalTarget  ( flag ){
        action.targetFilter(flag);
        let creeps = flag._creeps;
        if(creeps)creeps.forEach(e=>WarCache.getRoomStructures(e.room.name))//刷新全部建筑缓存
        if(creeps.length==1)ManageTeam.execTeam2(flag);
        else if(creeps.length==2)ManageTeam.execTeam2(flag);
        else if(creeps.length>2)ManageTeam.execTeam4(flag);

        // log(Game.cpu.getUsed() - t)
    },
    execTeam2(flag){

        // HelperVisual.showText(flag._creeps,flag._needFlee)

        if(flag.memory.mode=="line"){
            if(flag._creeps.length==2)action.team4together(flag)
            else flag._creeps[0].moveTo(flag)
        }
        else if(!action.checkTeam2(flag)){
            action.team2together(flag)
        }else {
            action.targetFocus(flag)
            action.team2moveToTarget(flag)
        }

    },
    execTeam4(flag){

        if(action.debugShow)flag._creeps.filter(e=>e.body).map(e=>HelperVisual.showText(e,e.possibleHealDamage(),undefined,"green",0.3))

        // let currRoom = flag._creeps.head().room;
        // if(currRoom.my&&!currRoom.find(FIND_HOSTILE_CREEPS).length&&(flag.pos.roomName!=currRoom.name)){
        //     action.team4together(flag)
        // }
        // else
        if(flag.memory.mode=="line"){
            action.team4together(flag)
        }
        else if(!action.team4checkSquarePos(flag)){
            if(!action.team4reSquarePos(flag))
                action.team4together(flag)
        }else {
            action.targetFocus(flag)
            action.team4moveToTarget(flag)
        }
    }
}



let teamPathCache={}

let action = {
    debugShow:true,
    // neutralStructures: new Set(['road','keeperLair','container','controller','extractor']), //,'terminal','storage'
    /** 根据爬的伤害先排个序 */
    sortTeamByDamage: creeps => creeps.map(e=>[e,e.possibleDamage()])
        .sort((a,b)=>a[1]==b[1]?a[0].id.localeCompare(b[0].id):a[1]<b[1])
        .map(a=>a[0]),
    // checkCreeps  (flag) {
    //     if(!flag._creeps) return;
    //
    //     // log(flag._creeps.map(e=>e.id))
    // },
    /** 标记 爬的位置 */
    checkTeam4Pos  (flag){
        let originPos = action.getOriginPos(flag)
        flag._directCreeps= {}
        flag._creeps.forEach(e=>{
            let pos = e.pos.crossRoomSubPos(originPos)
            // HelperVisual.showText(e,pos.x+" "+pos.y)// 如果出现 2 和 -1的情况说明在边界并且下一tick不会重合
            flag._directCreeps[MASK_POS_MAP[pos.x][pos.y]] = e
        })
    },
    /**
     * 附近有敌人时不休眠
     * @param flag
     */
    checkNotSleep(flag){
        if (flag._creeps.find(e => e.pos.findInRange(FIND_HOSTILE_CREEPS, 5).length > 0))
            flag.memory.lastCalPath=0
    },
    switchTeam4Pos  (flag){
        let originPos = action.getOriginPos(flag)
        let targetPos = flag._targetPos;
        if (flag._creeps.map(e => e.pos.roomName).toSet().size>1) return false;// 如果不都是一个房间的
        // if(flag._creeps.find(e=>e.pos.isBorder()))return false;
        if(!targetPos||Game.time%2==0)return false;

        if(action.debugShow&&targetPos.roomName==originPos.roomName){
            HelperVisual.showLine(
                {x:originPos.x+0.5,y:originPos.y+0.5,roomName:originPos.roomName},
                {x:targetPos.x,y:targetPos.y,roomName:targetPos.roomName},
                "yellow")
        }

        let diff = targetPos.crossRoomSubPos(originPos)
        diff.x-=0.5;diff.y-=0.5;

        if(Math.min(Math.abs(diff.x),Math.abs(diff.y))>5)return false;

            let directA = MASK_POS_MAP[diff.x>0?1:0][diff.y>0?1:0];// 第一个输出位置
        let directB//第二个输出位置
        let directC//第三个输出位置 B的反方向
        let directD = POS_MARK[(POS_MARK_INDEX[directA]+2)%4] //第4个输出位置， A的反方向

        // let t = []
        let rotate45 = {x:-diff.x+diff.y,y:diff.x+diff.y} // 先旋转45度
        if(rotate45.x==0||rotate45.y==0){// 正好在对线上
            directB = POS_MARK[(POS_MARK_INDEX[directA]+3)%4]; //直接找邻座的
        }else{
            directB = MASK_POS_MAP[rotate45.y>0?1:0][rotate45.x>0?1:0]; // 旋转后就算第二个输出的位置
            if(directA==directB)directB=POS_MARK[(POS_MARK_INDEX[directA]+3)%4] // 如果位置和第一个一样就换个方向
        }
        directC = POS_MARK[(POS_MARK_INDEX[directB]+2)%4]

        // if (action.debugShow) {
        //     [directA,directB,directC,directD].forEach(directA=>
        //         HelperVisual.showText(originPos.roomName,directA, {x:originPos.x+POS_MARK_MAP[directA][0],y:originPos.y+POS_MARK_MAP[directA][1]})
        //     )
        // }

        // 现在已经获取了位置了
        // 开始交换位置

        let damageMap = flag._creeps.map(e=>[e.id,e.possibleDamage()]).toMap()
        let switchPos = function (dir,others){
            let currentCreep = flag._directCreeps[dir]; // 这里可以为空
            let currentDamage = flag._directCreeps[dir]?damageMap[flag._directCreeps[dir].id]:0;
            let damage = 0;
            let damageCreep = 0;
            let direct = undefined
            others.map(e=>[e,flag._directCreeps[e]]).forEach(e=>{if(e[1]){ // 找比他伤害更高的爬
                let d = damageMap[e[1].id];
                if(damage<d){
                    damage = d;
                    damageCreep = e[1];
                    direct = e[0]
                }}
            })
            if(direct&&currentDamage<damage){ // 交换位置
                flag._directCreeps[direct]=currentCreep;
                flag._directCreeps[dir]=damageCreep;
            }
        }
        switchPos(directA,[directB,directC,directD]);
        switchPos(directB,[directC,directD]);
        switchPos(directC,[directD]);
        flag._creeps.forEach(e=>e.memory.dontPullMe=false)
        let switched = false;// 标记是否交换过
        for(let k in flag._directCreeps){
            let creep = flag._directCreeps[k];
            if (creep) {
                let vec = POS_MARK_MAP[k]
                if(!vec)continue;
                if(originPos.x+vec[0]<0||originPos.x+vec[0]>49||originPos.y+vec[1]<0||originPos.y+vec[1]>49)continue
                let pos = new RoomPosition(originPos.x+vec[0],originPos.y+vec[1],creep.pos.roomName);
                if(pos.x!=creep.pos.x||pos.y!=creep.pos.y){
                    creep.moveTo(pos)
                    switched =true
                }
            }
        }
        flag._creeps.forEach(e=>e.memory.dontPullMe=true)
        return switched
    },
    /**  获取左上角的位置,3个爬的时候,new 一个新的RoomPosition */
    getOriginPos (flag) {
        if(flag._creeps.length<3)return flag._creeps.head().pos
        if(flag._originPos)return flag._originPos;

        if(flag._creeps.length<3)throw new Error("creeps should more than 2")
        let creeps = flag._creeps;
        let pos =  (() => {
            let top = undefined;// 如果是上面的改成左上角的
            for (let i = 0; i < creeps.length; i++) {
                for (let j = 0; j < creeps.length; j++) {
                    if (i == j) continue
                    let vector = creeps[j].pos.crossRoomSubPos(creeps[i])
                    if (vector.x >= 1 && vector.y >= 1)
                        return creeps[i].pos //如果是左上角的直接返回
                    if (vector.x >= 1 && vector.y == 0) {
                        top = creeps[i].pos// 记录右上角的
                    }
                }
            }
            if(flag._creeps.length==3&&top){ // 如果只有3个特判一下
                let cnt = 0;
                creeps.forEach(e=>{
                    let vec = e.pos.crossRoomSubPos(top)
                    if(vec.x>=1&&vec.y==0)cnt+=1
                    if(vec.y>=1&&vec.x==0)cnt+=1
                })
                if(cnt==2)return top;
            }
            if (top) return top.getDirectPos(LEFT)// 右上角的左边
        })()
        flag._originPos = pos;
        // if(pos)HelperVisual.showText({pos:pos},"X")
        return pos
    },
    /**
     * 添加{pos,range}
     * @param flag
     * @param objs []
     */
    addAvoidObj(flag,objs) {
        if(!flag._avoidObj)flag._avoidObj = objs
        else flag._avoidObj = flag._avoidObj.concat(objs)
    },
    avoidInRange(flag,range){
        let creeps = flag._creeps
        let rooms = creeps.map(e=>e.room)
        if(flag.room)rooms.push(flag.room)
        rooms=_.uniq(rooms)
        let hostiles = rooms.map(e=>e.find(FIND_HOSTILE_CREEPS)).flat().filter(e=>{
            if(!e.getActiveBodyparts(RANGED_ATTACK)&&!e.getActiveBodyparts(ATTACK))return;
            return !creeps.find(c=>c.pos.crossRoomGetRangeTo(e)>range+5)
        })
        return hostiles.map(e=>{return {pos:e.pos,range:range+(e.getActiveBodyparts(RANGED_ATTACK)?3:1)}})
    },
    /** 获得小队内全部近距离治疗的sum */
    // getTeamHeal:flag=>flag._creeps.filter(e=>e.body).map(e=>e.pos.isBorder()?e.possibleHealDamage()/2:e.possibleHealDamage()).sum(),
    getSmallMove(flag) {
        let startPos = action.getOriginPos(flag); // 第一个爬作为起始位置
        let checkTeamMoveAble = (direction)=>{
            let pos = startPos.getDirectPos(direction)
            let nextTeamPos = _.values(POS_MARK_MAP).map(e=>new RoomPosition(pos.x+e[0],pos.y+e[1],pos.roomName))
            let nextCheckPos = nextTeamPos.filter(e=>!flag._creeps.find(c=>c.pos.isEqualTo(e)))
            return nextCheckPos.every(e=>e.walkable(true))
        }
        if (flag._attackingTarget) {
            let targetPos = flag._attackingTarget.pos
            let diffX =targetPos.x-startPos.x
            let diffY =targetPos.y-startPos.y
            if(diffX==-1&&diffY==-1){ // 左上角
                if(checkTeamMoveAble(LEFT))return LEFT
                if(checkTeamMoveAble(TOP))return TOP
            }else if(diffX==2&&diffY==-1){// 右上角
                if(checkTeamMoveAble(TOP))return TOP
                if(checkTeamMoveAble(RIGHT))return RIGHT
            }else if(diffX==2&&diffY==2){// 右下角
                if(checkTeamMoveAble(RIGHT))return RIGHT
                if(checkTeamMoveAble(BOTTOM))return BOTTOM
            }else if(diffX==-1&&diffY==2){// 左下角
                if(checkTeamMoveAble(BOTTOM))return BOTTOM
                if(checkTeamMoveAble(LEFT))return LEFT
            }
        }
        return undefined
        // if (!(startPos.x > 0 && startPos.y > 0 && startPos.x < 48 && startPos.y < 48)) return undefined; // 边界不移动
    },
    /**
     *
     * @param flag
     * @param nextPos
     * @return {Boolean|OK} OK 能走 , true 代表被creep挡住了，false代表被建筑挡住了
     * ！！！ false == 0 切记用 ===
     */
    getNextMoveOtherCreepInTheWay(flag, nextPos){
        if(!nextPos)return true;
        let creeps = flag._creeps;
        // if (creeps.map(e => e.pos.roomName).toSet().size>1) return 1;// 如果不都是一个房间的
        let direct = [RIGHT,BOTTOM_RIGHT,BOTTOM];
        let poss = creeps.length>=3?direct.map(d=>nextPos.getDirectPos(d)):[];
        poss.push(nextPos);
        if(!poss.every(e=>creeps.find(c=>e.isEqualTo(c))||e.walkable(true))){ // 如果无法通行
            return !poss.find(e => Game.rooms[e.roomName] && e.lookFor(LOOK_STRUCTURES).find(e => e.hits));

        }
        return OK;
    },
    /**
     * 如果没有危险的时候 进行休眠操作
     * @param flag
     */
    stayAndSleepFindPath(flag){
        if(flag._creeps.head().ticksToLive%7==0)return action.getSmallMove(flag)
        // if(flag._needFlee||flag._needAvoid)flag.memory.lastCalPath = 0;
        // else {
        //     delete teamPathCache[flag.name]
        // }
    },
    checkCachePathOK(flag){
        let startPos = action.getOriginPos(flag);
        return  teamPathCache[flag.name]&&teamPathCache[flag.name].length&&startPos.isCrossRoomNearTo(teamPathCache[flag.name][0])
    },
    directionByCachePath(flag){
        let startPos = action.getOriginPos(flag);
        if(!(teamPathCache[flag.name]&&teamPathCache[flag.name].length&&startPos.isCrossRoomNearTo(teamPathCache[flag.name][0])))return undefined;
        let nextPos = teamPathCache[flag.name][0];
        let direct = startPos.getDirectionTo(nextPos)
        teamPathCache[flag.name].shift();
        if(!direct){// 如果是边界，会两边的边界都会有pos，简直妈的智障
            nextPos = teamPathCache[flag.name][0];
            direct = startPos.getDirectionTo(nextPos);
            teamPathCache[flag.name].shift();
        }

        let result = action.getNextMoveOtherCreepInTheWay(flag,nextPos);
        if(result===OK)return direct;
        if(result===false){
            // action.stayAndSleepFindPath();
            return undefined;
        }
    },
    /** 获得小队的路径 */
    getTeamPathDirection (flag, goals,pathMode){

        if(flag._creeps.filter(e=>e.fatigue).length)return undefined;// 有人疲劳不走
        //goal 可以是一个object 也可以是一个数组很多个object {pos,range}
        let creeps = flag._creeps;
        let lastPathMode = flag.memory.pathMode;
        flag.memory.pathMode = pathMode;
        let startPos = action.getOriginPos(flag);


        let flee1Tick = pathMode==lastPathMode && (creeps.every(e=>e.hitsMax==e.hits) || !creeps.find(e=>e.pos.isBorder()));
        if((flee1Tick&&!pathMode)&&action.checkCachePathOK(flag))
            return action.directionByCachePath(flag)

        // 如果不是我的房间启动阀清理spawn模式
        let forceSpawn = (flag.room&&!flag.room.my&&creeps.find(e=>Game.map.getRoomLinearDistance(e.room.name,flag.room.name)<=1)&&goals.find(e=>e.structureType==STRUCTURE_SPAWN))
        let checkAttackingStructs = ()=>creeps.every(e=>!e.pos.isBorder())&&goals.find(e=>creeps.find(c=>e.pos.isNearTo(c))) // 如果靠近建筑就不寻路了
        if((flee1Tick&&!pathMode)&&(flag.memory.lastCalPath+10 > Game.time || (forceSpawn&&creeps.head().ticksToLive%30&&checkAttackingStructs()))){
            if(flag._creeps.head().ticksToLive%7==0)return action.getSmallMove(flag)
            return undefined;
        }
        let newGoals = [];

        let needFlee = pathMode=="flee"?1:0
        // todo 改距离
        goals.forEach(e=>e._range=(!needFlee||!e.body)?1:(e.getActiveBodyparts(RANGED_ATTACK)?5:(e.getActiveBodyparts(ATTACK)?3:1)))

        let visited = {}
        let rangePlus = pathMode=="avoid"?2:(pathMode=="flee"?7:0);
        if(creeps.length==2&&rangePlus)rangePlus+=1//两人小队要多一个格
        goals = goals.sort((a,b)=>(b._range||0)-(a._range||0))
        if(creeps.length<3){
            for (const item of goals) { // 1-2人模式
                if (item.pos.x == 0 || item.pos.y == 0 || item.pos.x == 49 || item.pos.y == 49) continue;//在边缘的不算移动目标 防止卡房门了
                let p = new RoomPosition(item.pos.x, item.pos.y, item.pos.roomName)
                if(!visited[p.hashCode()]){
                    visited[p.hashCode()]=true
                    newGoals.push({ pos: p, range: rangePlus+(item._range || 1) });
                }
            }
        }else {
            for (const item of goals) { // 4人模式
                if (item.pos.x == 0 || item.pos.y == 0 || item.pos.x == 49 || item.pos.y == 49) continue;//在边缘的不算移动目标 防止卡房门了
                for (const itemA of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
                    let p = new RoomPosition(item.pos.x + itemA[0], item.pos.y + itemA[1], item.pos.roomName)
                    if(!visited[p.hashCode()]){
                        visited[p.hashCode()]=true
                        newGoals.push({ pos: p, range: rangePlus+(item._range || 1) });
                    }
                }
            }
        }

        let avoidHostile =  (flag.memory.forceStructs) && (pathMode!="flee"&&pathMode!="avoid") //creeps.find(creep=>creep.getActiveBodyparts(WORK)) ||
        let ret = PathFinder.search(
            startPos, newGoals, {
                roomCallback (roomName) {
                    return WarCache.getMoveAbleCostMatrix(
                        roomName,
                        flag._creeps,
                        flag._canHeal ,
                        flag._avoidObj,
                        rangePlus,
                        avoidHostile,
                        creeps.length>=3,
                        forceSpawn,
                        pathMode?50:5
                    );
                },
                flee: pathMode=="flee",
                maxRooms:creeps.head().pos.roomName==flag.pos.roomName?2:16,
                maxOps:6000
            }
        );

        if(action.debugShow){
            // HelperVisual.showText(creeps.last(),action.getNextMoveOtherCreepInTheWay(flag,ret.path.head()),"blue")
            if(ret.path.length)HelperVisual.showPath(ret.path,"red")
        }
        if(ret.path.length==0||action.getNextMoveOtherCreepInTheWay(flag,ret.path.head())!==OK){
            action.stayAndSleepFindPath(flag)
            flag.memory.lastCalPath = Game.time;
            return undefined;
        }
        teamPathCache[flag.name] = ret.path
        flag.memory.targetPos = ret.path.last();
        return startPos.getDirectionTo(ret.path.shift())
    },
    /**
     * 能不能奶回来，相当于如果奶不回来
     * 计算带上 TOUGH 的，如果下一tick 能不能 hold 得住
     */
    canHoldHeal(flag,tick){
        const creeps = flag._creeps;
        let hostileCreepsByRoom = {};
        let hostileTowersByRoom = {};
        let getHostiles = room => hostileCreepsByRoom[room.name]
            || (hostileCreepsByRoom[room.name] = room.getHostileCreeps());
        let getTowers = room => hostileTowersByRoom[room.name]
            || (hostileTowersByRoom[room.name] = room.getHostileStructures().filter(e=>e.structureType==STRUCTURE_TOWER));

        // 获取全部需要注意的creep
        creeps.forEach(creep=>{
            let roomHostiles = getHostiles(creep.room);
            creep._ra_touch = roomHostiles// 远程攻击
                .filter(e=>e.pos.inRangeTo(creep,3+tick) && e.getPartCnt(RANGED_ATTACK)>0
                    && e.touchAbleNTickInRange(creep,tick,3,1));
            creep._atk_ra_touch = roomHostiles// 近战 或者 贴脸mass
                .filter(e=>e.pos.inRangeTo(creep,1+tick) && (e.getPartCnt(ATTACK)>0 || e.getPartCnt(RANGED_ATTACK)>0)
                    && e.touchAbleNTickInRange(creep,tick,1,1));
            let possibleMaxDmg = 0 // 被集火伤害
            creep._ra_touch.forEach(e=>{ // ra集火
                if(e._ra_dmg==undefined)e._ra_dmg = e.possibleRangeDamage(1,false,true)
                possibleMaxDmg+=e._ra_dmg
            })
            creep._atk_ra_touch.forEach(e=>{ // 近战集火
                // 满血互锤 双倍伤害
                if(e._atk_dmg==undefined)e._atk_dmg = e.possibleAttackDamage(1,true) * ((creep.getPartCnt(ATTACK)&&creep.hits==creep.hitsMax)?1:2)
                possibleMaxDmg+=e._atk_dmg
            })

            let towerDmg = 0
            let towers = getTowers(creep.room)
            if(towers.find(e=>e.store[RESOURCE_ENERGY]>=10)){
                towerDmg = towers.map(e=>e.getDamageTo(creep)).sum()
            }

            creep._fixed_dmg = 0// 受到的固定伤害//初始化//只有被mass才有固定伤害
            creep._tower_dmg = towerDmg  // 被火集的伤害
            creep._fired_dmg = possibleMaxDmg  // 被火集的伤害

        })

        let uniqueAllDamage = 0 // 被火集的伤害
        // mass 伤害计算
        _.uniq(creeps.map(creep=>creep._atk_ra_touch).flat()).filter(e=>e.getPartCnt(RANGED_ATTACK)>0).forEach(e=>{
            if(e._ra_dmg==undefined)e._ra_dmg = e.possibleRangeDamage(1,false,true)
            if(e._atk_dmg==undefined)e._atk_dmg = e.possibleRangeDamage(1,false,true)
            uniqueAllDamage+=e._atk_dmg;//被atk 火集
            creeps.forEach(o=>o._fixed_dmg+=o.pos.getRangeTo(e)<=1?1:0.4)// 如果近距离按 mass 处理，被 mass 的固定伤害
        })
        _.uniq(creeps.map(creep=>creep._ra_touch).flat()).forEach(e=>{//被ra 火集
            if(e._ra_dmg==undefined)e._ra_dmg = e.possibleRangeDamage(1,false,true)
            uniqueAllDamage+=e._ra_dmg;
        })

        // 计算第一次被打最大值
        creeps.forEach(creep=>{
            let maxDamage = creep._fixed_dmg+creep._tower_dmg+creep._fired_dmg // 最大受到的火集伤害
            creep._need_heal_dmg = creep.hitsMax-creep.hits+creep.possibleDamageHeedRealHeal(maxDamage,true) // 下一tick需要奶的,假设被火集了,真的扣了多少血量
            creep._showDamage = creep._need_heal_dmg;
            creep._showDamageTick = tick;
        })
        // 尝试奶回来
        creeps.forEach(healer=>{healer._heal_be_attack = healer.possibleHealDamage(1,false,healer.hits)});
        creeps.forEach(healer=>{
            let needHeal = creeps.filter(e=>e.pos.isNearTo(healer)).maxBy(e=>e._need_heal_dmg)//当前tick需要算 跨房间能不能奶
            if(needHeal._need_heal_dmg>0){
                healer.heal(needHeal)
                needHeal._need_heal_dmg-=healer._heal_be_attack // 打残后奶回来的
                if(needHeal._need_heal_dmg<0)needHeal._need_heal_dmg=0
            }
        })

        // 第二 tick 被打的时候
        creeps.forEach(creep=>{
            let maxDamage = creep._fixed_dmg+creep._tower_dmg+creep._fired_dmg // 最大受到的火集伤害
            creep._need_heal_dmg_2t = creep._need_heal_dmg+creep.hitsMax-creep.hits+creep.possibleDamageHeedRealHeal(maxDamage,creep.hits+creep._need_heal_dmg) // 下2 tick需要奶的,假设被火集了
        })

        // 第二 tick 的奶量
        creeps.forEach(healer=>{healer._heal_be_attack_2t = healer.possibleHealDamage(1,false,healer.hits-healer._need_heal_dmg)});
        let firedHealer = creeps.maxBy(healer=>healer._heal_be_attack_2t-healer._heal_be_attack)//被火集减少最多伤害的那个
        firedHealer._heal_be_attack = firedHealer._heal_be_attack_2t
        creeps.forEach(healer=>{
            let needHeal = creeps.maxBy(e=>e._need_heal_dmg_2t)
            if(needHeal._need_heal_dmg_2t>0){
                needHeal._need_heal_dmg_2t-=healer._heal_be_attack // 打残后奶回来的
                if(needHeal._need_heal_dmg_2t<0)needHeal._need_heal_dmg_2t=0
            }
        })

        let allHealDmg = creeps.map(creep => creep._heal_be_attack).sum();
        return creeps.map(creep => creep._need_heal_dmg_2t).sum()/2+creeps.map(creep => creep._fixed_dmg).sum()> allHealDmg // 现在受到的伤害能不能奶回来
            || creeps.find(creep => creep.possibleHealHoldRealDamage(allHealDmg,creep.hitsMax-creep.hits-(creep._need_heal_dmg_2t + creep._fixed_dmg)) < creep._fixed_dmg+creep._tower_dmg+creep._fired_dmg ) // 之后被打能不能奶回来
    },
    /**
     * 自动锁定打人
     * @param flag
     * @param creep 自己
     * @param list roomObject 没有过滤自己 建筑或者爬
     */
    autoAttack(flag,creep, list) {
        let posHashSet = _.values(flag._targets_select).map(e=>e.pos.hashCode()).toSet()
        let tmpList = list.filter(e=>(posHashSet.has(e.pos.hashCode())||e.name)//过滤掉select的
            &&(e.structureType==STRUCTURE_RAMPART||!e.pos.coverRampart())&&e.hits) // 过滤掉不能打的建筑
        list = tmpList.length?tmpList:list.filter(e=>(e.structureType==STRUCTURE_RAMPART||!e.pos.coverRampart())&&e.hits) // 过滤掉不能打的建筑
        if (creep.getActiveBodyparts(RANGED_ATTACK)) {
            const target = list.filter(e=>e.pos.getRangeTo(creep)<=3).sort((a, b) => a.hits - b.hits).head();
            if(target&&!creep._usingRangeAttack){
                creep._usingRangeAttack = true;
                flag._attackingTarget = target

                if(!list.find(e=>!e.structureType)&&
                    list.filter(e=>e.owner)
                        .map(e=>creep.pos.getRangeTo(e)).map(r=>r<=1?10:(r==2?4:(r==3?1:0)))
                        .sum()>10){ // 如果值找到建筑，并且输出比ra高 就决定只用 mass
                    creep.rangedMassAttack();// 近战 mass
                }
                else if(!target.owner||creep.pos.getRangeTo(target)>1) // wall不能mass
                    creep.rangedAttack(target); // 远程集火
                else
                    creep.rangedMassAttack();// 近战 mass
            }
        }
        if (creep._usingHeal) return ;//如果它执行过奶了 那么他就无法攻击
        if (creep.getActiveBodyparts(ATTACK)) {
            list.filter(e=>e.pos.getRangeTo(creep)<=1).sort((a, b) => a.hits - b.hits).find(target=>{
                let attackBack = (target.body&&target.possibleAttackDamage(1,true))||0
                if(!creep._usingAttack&&creep.possibleDamageHeedRealHeal(attackBack*2,true)<creep.hits){// 打得过才锤人嗷
                    // log("attack")
                    flag._attackingTarget = target
                    creep.attack(target);
                    return creep._usingAttack = true;
                }
            });
        }
        if (creep.getActiveBodyparts(WORK)) {
            const target = list.filter(e=>e.structureType&&e.pos.getRangeTo(creep)<=1).sort((a, b) => a.hits - b.hits).head();
            if(target) {
                creep._usingAttack = true;
                flag._attackingTarget = target
                creep.dismantle(target);// WORK的优先级比ATTACK高
            }
            if(!flag._attackingTarget){
                flag._attackingTarget = list.filter(e => e.pos.getRangeTo(creep) <= 1).sort((a, b) => a.hits - b.hits).head()
            }
        }
        if(flag._attackingTarget&&flag._creeps.head().room.my){
            flag._creeps.head().room.tower.filter(e=>!e._used).forEach(e=>{
                e.attack(flag._attackingTarget)
                e._used = true;
            })
        }
    },
    antiAttackAble(flag){
        if(flag._creeps.length!=4)return false;
        if(flag._creeps.find(e=>e.pos.isBorder()))return false;
        let attacker = flag._creeps.filter(e=>e.getActiveBodyparts(ATTACK));
        if(attacker.length!=2)return false;
        if(flag._creeps.find(e=>e.hits!=e.hitsMax))return false;
        let hostile_all = attacker[0].pos.findInRange(FIND_HOSTILE_CREEPS,4).filter(e=>e.getActiveBodyparts(ATTACK)||e.getActiveBodyparts(RANGED_ATTACK))
        let hostile_attacker = hostile_all.filter(e=>e.getActiveBodyparts(ATTACK)&&attacker.every(a=>e.pos.inRangeTo(a,3)))
        if(hostile_attacker.length!=1)return false;
        if(hostile_attacker[0].pos.findInRange(FIND_HOSTILE_STRUCTURES,2,{filter:e=>e.structureType==STRUCTURE_RAMPART}).length)return false;
        return true;
    },
    /** 自动打人 */
    attackCreepsTeam (flag) {
        const creeps = flag._creeps;
        if(!creeps)return false;
        creeps.forEach(e=>{
            let targetCreepList = [];//可以打的
            // let ramCreepsList = [];//站ram里边的
            e.pos.findInRange(FIND_HOSTILE_CREEPS,3).concat(e.pos.findInRange(FIND_HOSTILE_POWER_CREEPS,3)).filter(c=>{
                    let checkRam = c.pos.lookFor(LOOK_STRUCTURES).find(e=>e.structureType==STRUCTURE_RAMPART);
                    if(!checkRam) targetCreepList.push(c);
                }
            )
            action.autoAttack(flag,e,targetCreepList)
        })
    },
    /** 自动打建筑 HOSTILE*/
    attackStructureTeam (flag) {
        const creeps = action.sortTeamByDamage(flag._creeps).reverse();
        if(!creeps)return false;
        creeps.forEach(e=>{
            if(!e.room.my)action.autoAttack(flag,e,e.pos.findInRange(FIND_STRUCTURES, 3).filter(e=>e.hits))
        })
    },
    checkRanged(flag){
        return !flag._creeps.find(e=>e.getPartCnt(WORK)+e.getPartCnt(ATTACK))
    },
    clearPathCache(){
        if(Game.__clearPathCache) return;
        Game.__clearPathCache = true
        for(let flagName in teamPathCache){
            if(!Game.flags[flagName]){
                delete teamPathCache[flagName]
            }
        }
    },
    // /**
    //  * 排队等待
    //  * @param flag
    //  * @return {boolean}
    //  */
    // teamLinedPos (flag){
    //     let creeps = flag._creeps;
    //     creeps[0].moveTo(flag)
    //     for(let i = 1;i<creeps.length;i++){
    //         creeps[i].moveTo(creeps[i-1])
    //     }
    //     return true;
    // },
    /**
     * 排队等待
     * @param flag
     * @return {boolean}
     */
    team4together (flag){
        let creeps = flag._creeps;
        creeps.forEach(e=>e.memory.dontPullMe = false);
        let allNear = true;
        // for(let i=0;i<creeps.length;i++)HelperVisual.showText(creeps[i],i)
        for(let i=1;i<creeps.length;i++){
            if(!creeps[i].pos.isCrossRoomNearTo(creeps[i-1]))
                allNear = false
        }
        // creeps[i-1].moveOuterBorder(i>1?creeps[i-2]:undefined,true);
        if(flag._creeps.find(e=>e.fatigue))return true;// 有人疲劳不走


        if(allNear){
            if(!flag.pos.isCrossRoomNearTo(creeps.head())){
                creeps.head().moveTo(flag);
                for(let i=1;i<creeps.length;i++){
                    creeps[i].moveTo(creeps[i-1]);
                }
                return true;
            }
        }else if(!creeps.head().pos.crossRoomGetRangeTo(creeps[1])>2){
            creeps.head().moveTo(creeps[1]);
            for(let i=1;i<creeps.length;i++){creeps[i].moveTo(creeps[i-1])}
        }else {
            if(creeps.head().ticksToLive%3==0)creeps.head().moveTo(flag);
            else if(creeps.head().ticksToLive%3==1)creeps.head().moveTo(creeps[1]);
            let range = creeps.head().pos.crossRoomGetRangeTo(creeps[1])
            for(let i=1;i<creeps.length;i++){if(creeps[i].pos.crossRoomGetRangeTo(creeps[i-1])>=range)creeps[i].moveTo(creeps[i-1])}
        }
        if(action.team4checkSquarePos(flag)) return true;
        return !action.team4reSquarePos(flag)
    },
    team2together (flag){
        let creeps = flag._creeps;
        if(creeps.last().pos.isBorder()){// 在边界的时候
            if(!creeps.head().pos.inRangeTo(creeps.last(),1))creeps.last().moveTo(creeps.head());//距离一格的时候，先移动最后面的
            if(!creeps.head().pos.inRangeTo(creeps.last(),2))creeps.head().moveTo(creeps.last());//否则一起移动
        }else {
            if(!creeps.head().pos.inRangeTo(creeps.last(),1))creeps.head().moveTo(creeps.last());//两个靠近
            if(!creeps.head().pos.inRangeTo(creeps.last(),2))creeps.last().moveTo(creeps.head());//输出优先后退
        }
        flag.memory.lastCalPath=0
        return true;
    },
    // /**
    //  * 被打的才跑
    //  * @param flag
    //  * @return {(*[]|boolean)[]|boolean}
    //  */
    // autoHealTeamPassive (flag){
    //     let allHeal = flag._creeps.filter(e=>e.body).map(e=>e.possibleHealDamage()).sum()
    //     flag._canHeal=flag._creeps.map(e=>e.possibleHealHoldRealDamage(allHeal)-(e.hitsMax-e.hits)).minBy(e=>e)
    //     flag._needFlee = action.healTeam(flag)
    //     return flag._needFlee;
    // },
    /**
     *
     * @param flag
     * @return {(*[]|boolean)[]|boolean}
     */
    autoHealTeamActive (flag){
        let allHeal = flag._creeps.filter(e=>e.body).map(e=>e.possibleHealDamage()).sum()
        flag._canHeal=flag._creeps.map(e=>e.possibleHealHoldRealDamage(allHeal)-(e.hitsMax-e.hits)).minBy(e=>e)

        let originPos=action.getOriginPos(flag)
        if(originPos)HelperVisual.showText(originPos.roomName,Math.ceil(flag._canHeal),{x:originPos.x+0.5,y:originPos.y+0.15},"cyan",0.3)

        if(action.antiAttackAble(flag)||flag.memory.mode=='rash')action.canHoldHeal(flag,0)
        else if(flag.memory.mode=='flee'){
            action.canHoldHeal(flag,0);
            flag._needFlee = 'flee';
        }
        else {
            flag._needAvoid = action.canHoldHeal(flag,2) // 下 2 tick的行动可能受到伤害
            if(flag._needAvoid)flag._needFlee = action.canHoldHeal(flag,1) // 下 1 tick的行动可能受到伤害
            if(flag._needFlee)action.canHoldHeal(flag,0) // 当前需要治疗的情况
        }

        // if(flag._needAvoid)
        // if(flag._needAvoid)flag._needFlee = true;
        flag._creeps.forEach(creep=>{
            let color = creep._showDamageTick==1?"red":"#b39800"
            if(creep._showDamageTick!==undefined)HelperVisual.showText(creep.pos.roomName,Math.ceil(creep._showDamage),{x:creep.pos.x,y:creep.pos.y-0.45},color,0.3)
        })

        if(flag._needFlee)HelperVisual.showText(flag._creeps.head().room.name,"flee",{x:flag._creeps.head().pos.x,y:flag._creeps.head().pos.y-0.25},"blue",0.3)
        else if(flag._needAvoid)HelperVisual.showText(flag._creeps.head().room.name,"avoid",{x:flag._creeps.head().pos.x,y:flag._creeps.head().pos.y-0.25},"blue",0.3)
        return flag._needFlee;
    },
    autoAttackTeam (flag){
        action.attackCreepsTeam(flag);""
        action.attackStructureTeam(flag);
    },
    avoidHostile (flag){
        if(flag._needAvoid||flag._needFlee)flag.memory.avoidLastTick=Game.time
        if(flag.memory.avoidLastTick+7>Game.time){
            let objects = action.avoidInRange(flag,1);
            action.addAvoidObj(flag,objects)
        }
    },
    team4checkSquarePos (flag){
        let creeps = flag._creeps;
        if(creeps.filter(e=>e.pos.isBorder()).map(e=>e.pos.roomName).toSet().size>1)return false;
        for(let i = 0;i<creeps.length;i++){
            for(let j = i+1;j<creeps.length;j++) {
                if (!creeps[i].pos.isCrossRoomNearTo(creeps[j])) {
                    creeps.forEach(e=>e.memory.dontPullMe = false);
                    return false
                }
            }
        }
        creeps.forEach(e=>e.memory.dontPullMe = true);
        return true;
    },
    checkTeam2 (flag){
        let isNear = flag._creeps.head().pos.isCrossRoomNearTo(flag._creeps.last());
        if(isNear&&flag._creeps.length==2){
            if (!flag._creeps.head().pos.isBorder()) {
                flag._creeps.last().moveOuterBorder(flag._creeps.head())
            }
        }
        return isNear
    },
    /**
     * 重新整队
     * @param flag
     * @return {boolean}
     */
    team4reSquarePos (flag){
        let creeps = flag._creeps.take(4);
        creeps = _.shuffle(creeps);
        if (creeps.map(e => e.pos.roomName).toSet().size>1) return false;// 如果不都是一个房间的

        for(let i = 0;i<creeps.length;i++){
            for(let j = i+1;j<creeps.length;j++) {
                if (!creeps[i].pos.getRangeTo(creeps[j])>3) { // 如果走不到
                    return false
                }
            }
        }
        function checkAble(x,y){return (x>=0&&y>=0&&x<=49&&y<=49)}
        let posVisited = {}
        let offset = [[1,1],[0,1],[1,0],[0,0]];
        for(let checkBorder = 0;checkBorder<=1;checkBorder++){
            for(let t = 0;t<creeps.length;t++){
                offset = _.shuffle(offset);
                let pos = creeps[t].pos
                for(let k of offset){
                    let i=k[0]
                    let j=k[1]
                    // for(let i=-1;i<0;i++){
                    // for(let j=-1;j<0;j++) {
                    let hash = (pos.x+i)*50+pos.y+j;
                    if(posVisited[hash])continue;
                    posVisited[hash] = true
                    if(offset.every(o=>checkAble(pos.x+i-o[0],pos.y+j-o[1]))){
                        let poss = offset.map(o=>new RoomPosition(pos.x+i-o[0],pos.y+j-o[1],creeps[0].pos.roomName))
                        if(!poss.every(e=>(!e.isBorder()||checkBorder)&&creeps.find(c=>e.isEqualTo(c))||e.walkable(true)))continue;
                        let isAllNear = creeps.every(c=>poss.find(p=>p.isNearTo(c)))
                        // log(flag.name,poss,creeps.map(e=>e.pos))
                        if(isAllNear){
                            poss.forEach(e=>HelperVisual.showText({pos:e},e.walkable(true),"","red",0.4))
                            bipartiteGraphMatching(creeps,poss,(a,b)=>a.pos.isNearTo(b)).forEach(e=>{
                                if(action.debugShow)HelperVisual.showLine(e[0],e[1]);
                                e[0].moveTo(e[1])
                            })
                            return true
                        }
                    }
                }
            }
        }
        // creeps.forEach(e=>e.memory.dontPullMe = true);
        return false;
    },
    moveByDirection (flag){
        if(flag._creeps.find(e=>e.fatigue))return false;// 有人疲劳不走
        if(!flag._direction&&flag._creeps.length==2){
            if(flag._creeps[1].pos.isBorder()&&flag._creeps[0].pos.isNearTo(flag._creeps[1]))
                flag._creeps[1].moveOuterBorder(flag._creeps[0])
        }// 没有path不走
        if(!flag._direction)return false;
        if(flag._creeps.length>=3&&flag._creeps.find(e=>e.pos.isBorder()&&e.pos.getDirectPos(flag._direction).roomName!=e.pos.roomName)) return false;// 下一步是跨房间的不走

        if(flag._creeps.length>=3)flag._creeps.forEach(e=>e.move(flag._direction))
        else{
            let a = flag._creeps.head();
            // log(a.move(flag._direction))
            a.move(flag._direction)
            if(flag._creeps.length>1){
                let b = flag._creeps.last();
                b.move(b.pos.getDirectionTo(a))
            }
        }
        return true
    },
    /**
     * 过滤有用目标
     * @param flag
     */
    targetFilter(flag) {
        if(flag._targets_select)flag._targets = flag._targets_select // 如果旗帜已经带进来了
        if(flag._needFlee)flag.memory.lastFleeTime = Game.time;
        let forceSpawn = flag.memory.lastFleeTime+50<Game.time

        if(flag._support_hostile&&flag._support_hostile.length && flag.memory.mode == 'attack') flag._targets =flag._support_hostile

        if(!flag._targets){
            let room = Game.rooms[flag.pos.roomName]
            let out = []
            let forceStructs = flag._creeps.find(e=>e.getActiveBodyparts(WORK)) // 工兵不打人

            if(room){
                if(!room.my)out.push(...room.find(FIND_STRUCTURES).filter(e=>e.hits&&(forceSpawn?e.structureType==STRUCTURE_SPAWN:true)))
                if(!forceStructs&&!flag.memory.forceStructs){//&&!out.length
                    out.push(...room.find(FIND_HOSTILE_POWER_CREEPS))
                    out.push(...room.find(FIND_HOSTILE_CREEPS))
                }
                // out.forEach(e=>!e.body?1:(HelperVisual.showText(e,e._range)))
            }
            if(out.length==0)out.push(flag)
            flag._targets = out
        }
    },
    targetFocus(flag) {
        let originPos = action.getOriginPos(flag)
        let targetPos = undefined;
        if(flag._targets){
            let target = flag._attackingTarget?flag._attackingTarget:originPos.findClosestByRange(flag._targets||[])
            if(flag.memory.findTarget)flag.memory.findTarget--;
            if(target&&originPos.getRangeTo(target.pos.x+0.5,target.pos.y+0.5)<7){
                flag.memory.targetPos = target.pos;
                if(!target.structureType&&target.name!=flag.name
                    &&teamPathCache[flag.name]&&teamPathCache[flag.name].length>5){
                    teamPathCache[flag.name]=teamPathCache[flag.name].take(5)
                    flag.memory.lastCalPath = 0; // 寻路休眠取消
                }
                flag.memory.findTarget = 3;
            }
            else if(flag.memory.findTarget&&flag.memory.lastCalPath&&flag._creeps.map(e => e.pos.roomName).toSet().size==1){ // 如果没找到目标马上找下一个目标
                flag.memory.lastCalPath = 0; // 寻路休眠取消
                flag.memory.findTarget = 0;
                delete teamPathCache[flag.name]; // 删除寻路缓存
            }
        }
        if (flag.memory.targetPos) {
            let t = flag.memory.targetPos;
            targetPos = new RoomPosition(t.x,t.y,t.roomName)
        }
        flag._targetPos = targetPos
    },
    team4moveToTarget(flag){
        action.checkTeam4Pos(flag);
        let switched = flag._needFlee?false:action.switchTeam4Pos(flag);// 是否交换位置了
        if(!switched){
            action.clearPathCache();
            action.checkNotSleep(flag);
            let pathMode = flag._needFlee?"flee":(flag._needAvoid?"avoid":undefined)
            if(pathMode=="avoid"){
                flag._direction = action.getTeamPathDirection(flag,flag._targets,pathMode)
                if(!flag._direction&&!action.checkRanged(flag)&&(flag.memory.lastCheckAvoid||0)+7 < Game.time){
                    flag.memory.lastCheckAvoid = Game.time
                    flag._direction = action.getTeamPathDirection(flag,flag._targets,"flee")
                }
            }
            else flag._direction = action.getTeamPathDirection(flag,flag._targets,pathMode)
            if(flag._direction)action.moveByDirection(flag)
            else if(flag._needFlee||flag._needAvoid)action.switchTeam4Pos(flag);
        }
    },
    team2moveToTarget(flag){
        flag._creeps = action.sortTeamByDamage(flag._creeps)
        if(flag._needFlee)flag._creeps = flag._creeps.reverse()
        action.clearPathCache();
        action.checkNotSleep(flag);
        let pathMode = flag._needFlee?"flee":(flag._needAvoid?"avoid":undefined)
        if(pathMode=="avoid"){
            flag._direction = action.getTeamPathDirection(flag,flag._targets,pathMode)
            if(!flag._direction&&!action.checkRanged(flag))flag._direction = action.getTeamPathDirection(flag,flag._targets,"flee")
        }
        else flag._direction = action.getTeamPathDirection(flag,flag._targets,pathMode)
        if(flag._direction)action.moveByDirection(flag)
    }
}

global.ManageTeam = ManageTeam
global.WarTeamCore = {
    action:action,
    ManageTeam:ManageTeam,
    SpawnTeam:SpawnTeam
}

