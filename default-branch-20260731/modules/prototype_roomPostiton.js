


/**
 * 返回范围内的pos List，不包括自己
 * @param range
 * @returns {[RoomPosition]}
 */
RoomPosition.prototype.nearPos = function (range=1) {
    let arr=[];
    for(let i=-range;i<=range;i++){
        for(let j=-range;j<=range;j++){
            if((i||j)&&this.x+i>=0&&this.y+j>=0&&this.x+i<=49&&this.y+j<=49)arr.push(new RoomPosition(this.x+i,this.y+j,this.roomName))
        }
    }
    return arr
}

/**
 * 如果走到边缘
 * 计算下一tick的真实位置
 * new RoomPosition(0,20,"E3S3").borderNextPos()
 */
RoomPosition.prototype.borderNextPos = function () {
    if (this.isBorder()) return this.getDirectPos(this.getBorderDirect())
    return this
}


RoomPosition.prototype.getBorderDirect = function () {
    let direct = -1
    if(this.y==0)direct=TOP
    else if(this.y==49)direct=BOTTOM
    else if(this.x==0)direct=LEFT
    else if(this.x==49)direct=RIGHT
    return direct
}

RoomPosition.prototype.isBorder = function () {
    return !(this.x>0&&this.y>0&&this.x<49&&this.y<49)
}
/**
 * 看不见时，只能判定terrain
 * (划掉，考虑了)修墙里的隧道不考虑（不会有人真的修墙里面吧？
 * @param withCreep
 * @param rampartOwnerUserName
 * @returns {boolean}
 */
RoomPosition.prototype.walkable = function (withCreep = false,rampartOwnerUserName=null) {
    if(Game.rooms[this.roomName]){
        let structure = this.lookFor(LOOK_STRUCTURES).every(struct => {
            return !(struct.structureType !== STRUCTURE_CONTAINER && struct.structureType !== STRUCTURE_ROAD &&
                (struct.structureType !== STRUCTURE_RAMPART ||
                    (rampartOwnerUserName?rampartOwnerUserName!=(struct.owner.username):!struct.my)|| struct.isPublic))
        }) && !(this.lookFor(LOOK_TERRAIN).find(o => o === 'wall') && this.lookFor(LOOK_STRUCTURES).every(struct=>struct == STRUCTURE_ROAD))
        if (withCreep) {
            let creep = (this.lookFor(LOOK_CREEPS).length === 0)
            return structure && creep
        } else {
            return structure
        }
    }else{
        return new Room.Terrain(this.roomName).get(this.x,this.y)!=1 //1 是 wall
    }
}
RoomPosition.prototype.isTerrainWall = function () {
    return new Room.Terrain(this.roomName).get(this.x,this.y)==1 //1 是 wall
}


RoomPosition.prototype.walkableAroundCnt = function (withCreep = false) {
    return this.nearPos(1).reduce((all,pos)=>all+(pos.walkable(withCreep)?1:0),0)
}

const CHAR_0 = '0'.charCodeAt(0)
const MAP_DIRECT = {E:1,N:-1,W:-1,S:1} //东西南北坐标
const MAP_OFFSET = {E:0,N:-1,W:-1,S:0} //东西南北坐标

let getRoomCoordinate = function (roomName) {
    let tmp={x:0,y:0}
    let sh = 0;
    let pow = 1;
    for(let i=roomName.length-1;i>=0;i--){
        let cc = roomName.charCodeAt(i)-CHAR_0;
        if(cc>=0&&cc<=9){
            if(sh==0){
                tmp.y+=cc*pow
            }else{
                tmp.x+=cc*pow
            }
            pow*=10;
        }else{
            let c = roomName[i];
            if(sh==0){
                tmp.y*=MAP_DIRECT[c]
                tmp.y+=MAP_OFFSET[c]
            }else{
                tmp.x*=MAP_DIRECT[c]
                tmp.x+=MAP_OFFSET[c]
            }
            pow = 1
            sh+=1
        }
    }
    return tmp
}
/**
 * 返回room的坐标
 * @return {{x: number, y: number}}
 */
RoomPosition.prototype.getRoomCoordinate = function () {
    return getRoomCoordinate(this.roomName)
}

/**
 * 跨房间的是否near to
 * @param other
 * @return {boolean}
 */
RoomPosition.prototype.isCrossRoomNearTo = function (other) {
    if(other.pos)other = other.pos
    if(this.roomName==other.roomName)return this.isNearTo(other)
    return this.crossRoomGetRangeTo(other)<=1;
}

/**
 * 跨房间的两点之间的距离
 * @param other
 * @return {number}
 */
RoomPosition.prototype.crossRoomGetRangeTo = function (other) {
    if(other.pos)other = other.pos
    if(this.roomName==other.roomName)return this.getRangeTo(other);
    let det = this.crossRoomSubPos(other)
    return Math.max(Math.abs(det.x),Math.abs(det.y));
}
// let a = this.getRoomCoordinate()
// let b = other.getRoomCoordinate()
// let x = b.x-a.x;
// let y = b.y-a.y;
// let xDist = Math.abs(other.y+y*50 - this.y)//-1
// let yDist = Math.abs(other.x+x*50 - this.x)//-1
// return Math.max(xDist,yDist);
// new RoomPosition(1,35,"W5N8").crossRoomGetRangeTo(new RoomPosition(48,35,"W6N8"))
//[{"x":1,"y":35,"roomName":"W5N8"},{"x":48,"y":35,"roomName":"W6N8"},0]


// /**
//  * 跨房间的两点之间的距离
//  * @param other
//  * @return {number}
//  */
// RoomPosition.prototype.crossRoomGetRangeTo = function (other) {
//     if(other.pos)other = other.pos
//     if(this.roomName==other.roomName)return this.getRangeTo(other);
//     let tmp = this.crossRoomSubPos(other)
//     // log(xDist,yDist)
//     return Math.min(tmp.x,tmp.y);
// }

/**
 * getDirect
 * @param other
 * @return {{x: number, y: number}}
 */
RoomPosition.prototype.crossRoomSubPos = function (other) {
    if(other.pos)other = other.pos;
    // let sub = (this.roomName==other.roomName) ? 0 : 1;
    const sameRoom = this.roomName==other.roomName;
    const change = e=> sameRoom?e:(e==49?50:(e==0?-1:e));// 如果房间不一样默认交换位置
    let a = other.getRoomCoordinate()
    let b = this.getRoomCoordinate()
    let x = b.x-a.x;
    let y = b.y-a.y;
    let tmp = {
        x : change(this.y)+y*50 - change(other.y),
        y : change(this.x)+x*50 - change(other.x)
    }
    return tmp
}

// log(new RoomPosition(17, 48,"W3N6").crossRoomSubPos(new RoomPosition(17,0,"W3N5")))
// log(new RoomPosition(17, 49,"W3N6").crossRoomSubPos(new RoomPosition(17,0,"W3N5")))




const DIRECTION_MAP = {
    [TOP] : [0,-1],
    [TOP_RIGHT] : [1,-1],
    [RIGHT] : [1,0],
    [BOTTOM_RIGHT] : [1,1],
    [BOTTOM] : [0,1],
    [BOTTOM_LEFT] : [-1,1],
    [LEFT] : [-1,0],
    [TOP_LEFT] : [-1,-1]
}


function getRoomNameByXY (x,y) {
    return `${x >= 0 ? "E" : "W"}${x >= 0 ? x : -1 - x}${y >= 0 ? "S" : "N"}${y >= 0 ? y : -1 - y}`;
}

/** 获得 direction 的方向 的 RoomPosition
 *  1000 次 0.8 cpu
 */
RoomPosition.prototype.getDirectPos = function (direction) {
    let x = this.x+DIRECTION_MAP[direction][0];
    let y = this.y+DIRECTION_MAP[direction][1];
    let offsetX = 0;
    let offsetY = 0;
    if(x<0)offsetX-=1
    else if(x>49)offsetX+=1
    if(y<0)offsetY-=1
    else if(y>49)offsetY+=1
    if(offsetX==0&&offsetY==0)return new RoomPosition(x,y,this.roomName)
    else{
        let co = getRoomCoordinate(this.roomName)
        return new RoomPosition(((x+50)%50),((y+50)%50),getRoomNameByXY(co.x+offsetX,co.y+offsetY))
    }
}
//new RoomPosition(49,0,"E1N1").getDirectPos(TOP_RIGHT)

// (function (){
//     let t = Game.cpu.getUsed();
//     for(let i=0;i<1000;i++){
//         new RoomPosition(49,0,"E1N1").getDirectPos(TOP_RIGHT)
//     }
//     return Game.cpu.getUsed() - t;
// })();



RoomPosition.prototype.$createFlag=RoomPosition.prototype.createFlag;
RoomPosition.prototype.createFlag = function (name,color1,color2) {
    ({name:this.roomName,createFlag:Room.prototype.createFlag}).createFlag(this.x,this.y,name,color1?color1:Utils.randomInt(1,11),color2?color2:Utils.randomInt(1,11))
}



RoomPosition.prototype.coverRampart = function () {
    if(!Game.rooms[this.roomName])return undefined;
    return this.lookFor(LOOK_STRUCTURES).find(e=>e.structureType == STRUCTURE_RAMPART)
}


RoomPosition.prototype.hashCode = function () {
    let roomCoordinate = this.getRoomCoordinate();
    return (roomCoordinate.x<<18)+(roomCoordinate.x<<12)+(this.x<<6)+this.y
}


//
//
// function makePathfindingGrid2(roomName, opts) {
//     opts = opts || {};
//     var costs = new PathFinder.CostMatrix();
//     var obstacleTypes = _.clone(OBSTACLE_OBJECT_TYPES);
//     obstacleTypes.push('portal');
//
//     if(opts.ignoreDestructibleStructures)
//         obstacleTypes = _.without(obstacleTypes, 'constructedWall','spawn','extension', 'link','storage','observer','tower','powerBank','powerSpawn','lab','terminal');
//     if(opts.ignoreCreeps || Game.rooms[roomName]&&Game.rooms[roomName].controller && Game.rooms[roomName].controller.safeMode && Game.rooms[roomName].controller.my)
//         obstacleTypes = _.without(obstacleTypes, 'creep', 'powerCreep');
//
//     if(Game.rooms[roomName]) {
//         Game.rooms[roomName].forEach((key) => {
//             var object = register.objectsByRoom[roomName][key];
//
//             if (_.contains(obstacleTypes, object.type) ||
//                 !opts.ignoreCreeps && Game.rooms[roomName].controller && Game.rooms[roomName].controller.safeMode && Game.rooms[roomName].controller.my && (object.type == 'creep' || object.type == 'powerCreep') && object.my ||
//                 !opts.ignoreDestructibleStructures && object.type == 'rampart' && !object.isPublic && !object.my ||
//                 !opts.ignoreDestructibleStructures && object.type == 'constructionSite' && object.my && _.contains(OBSTACLE_OBJECT_TYPES, object.structureType)) {
//                 costs.set(object.x, object.y, 0xFF);
//             }
//             if (object.type == 'swamp' && costs.get(object.x, object.y) == 0)
//                 costs.set(object.x, object.y, opts.ignoreRoads ? 5 : 10);
//             if (!opts.ignoreRoads && object.type == 'road' && costs.get(object.x, object.y) < 0xFF)
//                 costs.set(object.x, object.y, 1);
//         });
//     }
//     return costs;
// }
//
//
// function getPathfindingGrid2(id, opts) {
//     if(!Game._privateStore)Game._privateStore={}
//     if(!Game._privateStore[id]) return new PathFinder.CostMatrix();
//     let gridName = 'grid2';
//     opts = opts || {};
//     if(opts.ignoreCreeps) gridName += '_igC';
//     if(opts.ignoreDestructibleStructures) gridName += '_igD';
//     if(opts.ignoreRoads) gridName += '_igR';
//     if(!Game._privateStore[id].pfGrid[gridName]) Game._privateStore[id].pfGrid[gridName] = makePathfindingGrid2(id, opts);
//     return Game._privateStore[id].pfGrid[gridName];
// }
//
// RoomPosition.prototype.findClosestByPath = (objects, opts) => {
//     let fromPos = this
//
//     opts = opts || {};
//
//     if(_.isNumber(objects)) {
//         objects = register.rooms[fromPos.roomName].find(objects, {filter: opts.filter});
//     }
//     else if(opts.filter) {
//         objects = _.filter(objects, opts.filter);
//     }
//
//     if(!objects.length) {
//         return null;
//     }
//
//     let objectOnSquare = _.find(objects, obj => fromPos.isEqualTo(obj));
//     if(objectOnSquare) {
//         return objectOnSquare;
//     }
//
//     let goals = _.map(objects, i => {
//         if(i.pos) {
//             i = i.pos;
//         }
//         return {range: opts.range||1, pos: i};
//     });
//
//     if(opts.avoid) console.log('`avoid` option cannot be used when `PathFinder.use()` is enabled. Use `costCallback` instead.');
//     if(opts.ignore) console.log('`ignore` option cannot be used when `PathFinder.use()` is enabled. Use `costCallback` instead.');
//     let searchOpts = {
//         roomCallback: function(roomName) {
//             if(Game.rooms[roomName]) {
//                 let costMatrix = getPathfindingGrid2(roomName, opts);
//                 if(typeof opts.costCallback == 'function') {
//                     costMatrix = costMatrix.clone();
//                     let resultMatrix = opts.costCallback(roomName, costMatrix);
//                     if(resultMatrix instanceof PathFinder.CostMatrix) {
//                         costMatrix = resultMatrix;
//                     }
//                 }
//                 return costMatrix;
//             }
//         },
//         maxOps: opts.maxOps,
//         maxRooms: 1
//     };
//     if(!opts.ignoreRoads) {
//         searchOpts.plainCost = 2;
//         searchOpts.swampCost = 10;
//     }
//     let ret = PathFinder.search(fromPos, goals, searchOpts);
//
//     let result = null;
//     let lastPos = fromPos;
//
//     if(ret.path.length) {
//         lastPos = ret.path[ret.path.length-1];
//     }
//
//     objects.forEach(obj => {
//         if(lastPos.isNearTo(obj)) {
//             result = obj;
//         }
//     });
//
//     return result;
// }
