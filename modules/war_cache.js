/**
 * 缓存全局的 CostMatrix
 * 塔伤
 * 建筑
 */

const cacheStructs = {} // 存储的是上一tick全部的建筑，object不会更新
const cacheStructsTime = {}
const cacheTowerRoomArray = {} // tower的 id 和 pos 会缓存到memory
const cacheAbandonArray = {}
const rampartAreaArray = {}
const emptyCostMatrix = new PathFinder.CostMatrix; // 不能修改他
const emptyRoomArray = new RoomArray().init(); // 不能修改他
const tmpRoomArray = new RoomArray(); // 一次性缓存

let pro={
    createTowerDamageMap(posList){
        // let t = Game.cpu.getUsed();
        let arr = new RoomArray().init();
        let work = posList.filter(e=>e.work);
        arr.forEach((x,y)=>{
            arr.set(x,y,_.sum(work.map(e=> e.effect*WarDamageCal.calTowerDamage(Math.max(Math.abs(e.x-x),Math.abs(e.y-y))))))
        })
        // console.log(Game.cpu.getUsed()-t)
        return arr;
    },
    getTowerDamageRoomArray(roomName){
        if(cacheTowerRoomArray[roomName]&&cacheTowerRoomArray[roomName+'_time']==Game.time){
            return cacheTowerRoomArray[roomName]
        }
        else if(Game.rooms[roomName]){ // 如果房间看得见就刷新缓存
            cacheTowerRoomArray[roomName+'_time']=Game.time
            let towers = Game.rooms[roomName].getStructures().filter(e=>e.structureType==STRUCTURE_TOWER)
            if(towers.length==0)return emptyRoomArray;
            let processed = towers.map(e=>{
                let effect = 1;
                if(e.effects){
                    effect *= 1+0.1*((e.effects.find(e=>e.power==PWR_OPERATE_TOWER)&&e.effects.find(e=>e.power==PWR_OPERATE_TOWER).level)||0)
                    effect *= 1-0.1*((e.effects.find(e=>e.power==PWR_DISRUPT_TOWER)&&e.effects.find(e=>e.power==PWR_DISRUPT_TOWER).level)||0)
                }
                return {
                    id:e.id,x:e.pos.x,y:e.pos.y,
                    work:e.store.energy >= 10,
                    effect:effect
                }
            })
            Memory.rooms[roomName] = Memory.rooms[roomName]||{}
            if(!Memory.rooms[roomName].tower)Memory.rooms[roomName].tower = towers.map(e=>e.id)
            if(Memory.rooms[roomName].tower&&Memory.rooms[roomName].tower.list){
                let ids = processed.map(e=>e.id+e.work+e.effects)
                let oldIds = Memory.rooms[roomName].tower.list.map(e=>e.id+e.work+e.effects)
                if (ids.length!=oldIds.length||!ids.contains(...oldIds)) { // 如果id改了,或者数量不对
                    cacheTowerRoomArray[roomName] = pro.createTowerDamageMap(processed)
                }
            }
            Memory.rooms[roomName].tower={};
            Memory.rooms[roomName].tower.list = processed
            if(!cacheTowerRoomArray[roomName])cacheTowerRoomArray[roomName] = pro.createTowerDamageMap(processed)
            return cacheTowerRoomArray[roomName]
        }
        else {
            Memory.rooms[roomName] = Memory.rooms[roomName]||{}
            if(Memory.rooms[roomName].tower&&Memory.rooms[roomName].tower.list){ // 如果房间看不见就从内存拿
                if(!cacheTowerRoomArray[roomName])cacheTowerRoomArray[roomName] = pro.createTowerDamageMap(Memory.rooms[roomName].tower.list)
                return cacheTowerRoomArray[roomName]
            }else // 什么信息都没有默认返回空的
                return emptyRoomArray;
        }
    },
    showPermitArea(roomName,isFourTeam){
        pro.getPermitArea(roomName,!!isFourTeam).forEach((x, y, val)=>{
            if(val>0)HelperVisual.showText(roomName,val,{x:x,y:y-0.25},'cyan',0.5)
        })
    },
    /**
     * 距离出口多远（计算wall和rampart hits>30000）
     * @param roomName
     */
    getPermitArea(roomName, isFourTeam){
        if(cacheAbandonArray[roomName+isFourTeam]&&
            ((cacheAbandonArray[roomName+isFourTeam+'_time']+17>Game.time&&Game.rooms[roomName]&&Game.rooms[roomName].find(FIND_RUINS).length)
                || cacheAbandonArray[roomName+isFourTeam+'_time']+173>Game.time)
        ){
            return cacheAbandonArray[roomName+isFourTeam]
        }
        else if(Game.rooms[roomName]){ // 如果房间看得见就刷新缓存
            cacheAbandonArray[roomName+isFourTeam+'_time']=Game.time
            let arr = new RoomArray().init();
            let visited = new RoomArray()
            let queMin = new PriorityQueue(true)

            arr.initRoomTerrainWalkAble(roomName)

            let structures = Game.rooms[roomName].getStructures();
            let ramparts = structures.filter(e=>e.structureType==STRUCTURE_RAMPART)
            let walls = structures.filter(e=>e.structureType==STRUCTURE_WALL)

            ramparts.filter(e=>e.hits>30000).forEach(e=>arr.set(e.pos.x,e.pos.y,STRUCTURE_RAMPART))
            walls.filter(e=>e.hits>30000).forEach(e=>arr.set(e.pos.x,e.pos.y,STRUCTURE_WALL))

            visited.init()
            queMin.clear()
            let cal = function (a,b,c,d){
                if ([a,b,c,d].every(e => e == 1 || e == 2))
                    return Math.max(a,b,c,d)
                else return Math.min(a,b,c,d)
            }
            if(isFourTeam){ // 如果是四人小队就改一下
                for (let x = 0; x < 49; x++) {
                    for (let y = 0; y < 49; y++) {
                        // if (x == 0 || y == 0 || y == 48 || x == 48) arr.set(x, y, 1);
                        let c = cal(arr.get(x, y), arr.get(x + 1, y), arr.get(x, y + 1), arr.get(x + 1, y + 1));
                        arr.set(x, y, c);
                        // HelperVisual.showText(roomName,c,{x:x,y:y-0.25},'cyan',0.5)
                    }
                }
            }
            arr.forBorder((x,y,val)=>{if(val){queMin.push(NewNode(1,x,y));visited.set(x,y,1)}})

            queMin.whileNoEmpty(nd=>{
                arr.forNear((x,y,val)=>{
                    if(val>0&&!visited.exec(x,y,1)){
                        queMin.push(NewNode(nd.k+(val===2?30:1),x,y))
                    }
                },nd.x,nd.y)
                // HelperVisual.showText(roomName,nd.k,{x:nd.x,y:nd.y-0.25},'cyan',0.5)
                arr.set(nd.x,nd.y,nd.k)
            })
            visited.forEach((x,y,val)=>{if(!val)arr.set(x,y,-1)})

            cacheAbandonArray[roomName+isFourTeam] = arr
            return cacheAbandonArray[roomName+isFourTeam]
        }
        else return cacheAbandonArray[roomName+isFourTeam]||emptyRoomArray;
    },
    showRampartArea(roomName){
        pro.getRampartArea(roomName).forEach((x,y,val)=>{
            if(val>=0)HelperVisual.showText(roomName,val,{x:x,y:y-0.25},'cyan',0.5)
        })
    },
    /**
     * 距离rampart多远
     * @param roomName
     */
    getRampartArea(roomName){
        if(rampartAreaArray[roomName]&&
            ((rampartAreaArray[roomName+'_time']+17>Game.time&&Game.rooms[roomName]&&Game.rooms[roomName].find(FIND_RUINS).length)
                || rampartAreaArray[roomName+'_time']+173>Game.time)
        ){
            return rampartAreaArray[roomName]
        }
        else if(Game.rooms[roomName]){ // 如果房间看得见就刷新缓存
            rampartAreaArray[roomName+'_time']=Game.time
            let arr = new RoomArray().init();
            let visited = new RoomArray()
            let queMin = new PriorityQueue(true)

            arr.initRoomTerrainWalkAble(roomName)

            let structures = Game.rooms[roomName].getStructures();
            let ramparts = structures.filter(e=>e.structureType==STRUCTURE_RAMPART)
            let walls = structures.filter(e=>e.structureType==STRUCTURE_WALL)

            ramparts.filter(e=>e.hits>30000).forEach(e=>arr.set(e.pos.x,e.pos.y,1))
            walls.filter(e=>e.hits>30000).forEach(e=>arr.set(e.pos.x,e.pos.y,0))

            visited.init()
            queMin.clear()
            ramparts.filter(e=>e.hits>30000).forEach(e=>{queMin.push(NewNode(0,e.pos.x,e.pos.y));visited.set(e.pos.x,e.pos.y,1)})

            queMin.whileNoEmpty(nd=>{
                arr.forNear((x,y,val)=>{
                    if(val>0&&!visited.exec(x,y,1)){
                        queMin.push(NewNode(nd.k+1,x,y))
                    }
                },nd.x,nd.y)
                // HelperVisual.showText(roomName,nd.k,{x:nd.x,y:nd.y-0.25},'cyan',0.5)
                arr.set(nd.x,nd.y,nd.k)
            })
            visited.forEach((x,y,val)=>{if(!val)arr.set(x,y,-1)})

            rampartAreaArray[roomName] = arr
            return rampartAreaArray[roomName]
        }
        else return rampartAreaArray[roomName]||emptyRoomArray;
    },
    /**
     * 获得全部建筑（会缓存
     * @param roomName
     */
    getRoomStructures(roomName){
        let room = Game.rooms[roomName];
        if(room && cacheStructsTime[roomName] != Game.time){
            cacheStructsTime[roomName] = Game.time;
            cacheStructs[roomName] = room.getStructures().map(e=>{return {pos:e.pos,my:e.my,owner:e.owner,structureType:e.structureType}})
        }
        return cacheStructs[roomName] || []
    },

    /**
     *
     * @param myCreeps [自己的爬]
     * @param roomName 房间名字
     * @param damageLimit 最大可承受伤害
     * @param avoidObjects [] 敌对creep多少距离内不能靠近
     * @param damageRangePlus 敌对creep多少距离内不能靠近
     * @param avoidHostile 敌对creep不可通过
     * @param isFourTeam 是不是四人小队
     * @param forceSpawn 是否专注spawn
     * @param swampCost 是否专注spawn
     */
    getMoveAbleCostMatrix(roomName,myCreeps,damageLimit = 0,avoidObjects=undefined,damageRangePlus=0,avoidHostile=false,isFourTeam = false,forceSpawn = true,swampCost=5){
        let room = Game.rooms[roomName];
        // 静态层缓存：地形+建筑（结构变化不频繁，20 tick 内复用，clone 后叠加动态层）
        let staticKey = roomName + ":" + swampCost + ":" + (forceSpawn?1:0);
        let staticCache = global._warMatrixCache = global._warMatrixCache || {};
        let stat = staticCache[staticKey];
        if(!stat || Game.time - stat.tick > 20){
            let base = new PathFinder.CostMatrix
            let terrain = new Room.Terrain(roomName)
            for (let y = 0; y < 50; y++) {
                for (let x = 0; x < 50; x++) {
                    const t = terrain.get(x, y);
                    base.set(x, y, t == TERRAIN_MASK_WALL?255:(t==TERRAIN_MASK_SWAMP?swampCost:1)); // 不可移动
                }
            }
            let myName = myCreeps[0].owner.username;
            let structs = pro.getRoomStructures(roomName).filter(e=>e&&e.structureType!=STRUCTURE_ROAD)
            let hasSpawn = false;
            if(forceSpawn&&room&&room.controller&&room.controller.owner&&!room.my&&structs.find(e=>e.structureType==STRUCTURE_SPAWN))hasSpawn = true;// 如果不是我的房间启动阀清理spawn模式
            structs.forEach(e=>{
                if (e.structureType == 'container' || (e.structureType == 'rampart' && e.owner.username== myName)) {
                } else {// 不能穿过无法行走的建筑
                    if(hasSpawn&&e.hits>100000)base.set(e.pos.x, e.pos.y, Math.ceil(e.hits/2000000)+100);
                    else if(hasSpawn&&e.hits)base.set(e.pos.x, e.pos.y, 10);
                    else base.set(e.pos.x, e.pos.y, 255);
                }
            })
            staticCache[staticKey] = { tick: Game.time, cm: base };
            stat = staticCache[staticKey];
        }
        let cm = stat.cm.clone();

        let towerDamage = (damageLimit>0&&(!room||!room.my))?
            pro.getTowerDamageRoomArray(roomName):undefined
        if(towerDamage){
            for (let y = 0; y < 50; y++) {
                for (let x = 0; x < 50; x++) {
                    if(towerDamage.get(x,y)>damageLimit)cm.set(x,y,255); // 算伤,如果超过伤害默认几乎不可移动
                }
            }
        }

        let inited = false
        let myCreepsIdSet = (myCreeps||[]).map(e=>e.id).toSet()
        if(room)room.find(FIND_CREEPS).concat(room.find(FIND_POWER_CREEPS)).forEach( (e) =>{ // 躲避房间中的 不为小队成员的友方creep
            if (!myCreepsIdSet.has(e.id)&&((!e.my&&avoidHostile)||(e.my&&(!e.body||e.body.find(e=>e.type!=MOVE||e.type!=CARRY)))))
                cm.set(e.pos.x, e.pos.y, 255);
            if(!e.my){
                let atk = e.possibleAttackDamage()
                let ra = e.possibleRangeDamage()
                if(atk+ra>0&&!inited){
                    tmpRoomArray.init()
                    inited = true
                }
                if(atk>0)tmpRoomArray.forNear((x,y,val)=>{
                    tmpRoomArray.set(x,y,val+atk)
                },e.pos.x,e.pos.y,1+damageRangePlus)
                if(ra>0)tmpRoomArray.forNear((x,y,val)=>{
                    tmpRoomArray.set(x,y,val+ra)
                },e.pos.x,e.pos.y,4+damageRangePlus)
                if(ra>0)tmpRoomArray.forNear((x,y,val)=>{
                    tmpRoomArray.set(x,y,val+1.8*ra)
                },e.pos.x,e.pos.y,1+damageRangePlus)
            }
        });
        if(inited)tmpRoomArray.forEach((x,y,val)=>{
            let damage = (towerDamage?towerDamage.get(x,y):0)+val
            // if(damage>damageLimit)HelperVisual.getRoomVisual(roomName).text(damage, x, y+0.45, { color: 'red', font: 0.3, opacity: 0.5 });
            if(damage>damageLimit&&cm.get(x, y)<254)cm.set(x, y, 254);// 算伤,如果超过伤害默认几乎不可移动
        })

        if(avoidObjects){
            avoidObjects.forEach(e=>{
                if(e.pos.roomName==roomName)
                    tmpRoomArray.forNear((x,y,val)=>{
                        // HelperVisual.getRoomVisual(roomName).text("▓", x, y+0.35, { color: 'red', font: 1, opacity: 0.5 });
                        if(cm.get(x, y)<254)cm.set(x, y, 254)
                    },e.pos.x,e.pos.y,e.range)
            })
        }



        // for (let x = 0; x < 50; x++) {
        //     for (let y = 0; y < 50; y++) {
        //         // if (cm.get(x, y) > 200) room.visual.text("⊙", x, y, { color: 'red', font: 0.3, opacity: 0.5 });
        //         HelperVisual.getRoomVisual(roomName).text(cm.get(x, y), x, y+0.2, { color: 'red', font: 0.5, opacity: 0.5 });
        //     }
        // }

        if(isFourTeam){ // 如果是四人小队就改一下
            for (let x = 0; x < 49; x++) {
                for (let y = 0; y < 49; y++) {
                    if (x == 0 || y == 0 || y == 48 || x == 48) cm.set(x, y, 50);
                    let c = Math.max(cm.get(x, y), cm.get(x + 1, y), cm.get(x, y + 1), cm.get(x + 1, y + 1));//算出cost
                    cm.set(x, y, c);
                }
            }
        }


        return cm;

    },

};
// WarCache.getMoveAbleCostMatrix
global.WarCache = pro;
