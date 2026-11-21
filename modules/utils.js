Array.prototype.flat= function(){return _.flatten(this)};
// Array.prototype.reduce= function(func){return _.reduce(this,func)};
Array.prototype.zip= function (another){return _.zip(this,another)};
Array.prototype.contains= function (another){return _.includes(this,another)};
Array.prototype.take= function (n){return _.take(this,n)};
Array.prototype.head= function(){return this[0]};
Array.prototype.last= function(){return this[this.length-1]};
Array.prototype.without= function(...e){return _.without(this,...e)};
Array.prototype.sum= function(...e){return _.sum(this,...e)};
Array.prototype.toSet= function(){return new Set(this)};
Array.prototype.toMap= function(){return this.reduce((map,entry)=>{map[entry[0]] = entry[1];return map},{})};
Array.prototype.find= function(...e){return _.find(this,...e)};
Array.prototype.maxBy= function(func){return this.reduce((ori, another)=>func(ori)>=func(another)?ori:another,this[0])};
Array.prototype.minBy= function(func){return this.reduce((ori, another)=>func(ori)<func(another)?ori:another,this[0])};
Array.prototype.log= function(){Logger.log("Utils", JSON.stringify(this));return this};
Array.prototype.randomGet= function(){return this[Math.floor(this.length*Math.random())]};

clog=function(...e){Logger.log("Utils", ...e)};
log=function(...e){Logger.log("Utils", JSON.stringify(e))};

let base36 = Math.pow(36,10)
randomId = ()=>_.padLeft(Math.ceil(Math.random()*base36).toString(36).toLocaleUpperCase(),10,"0")

let posCodeNumberMap = {};
let posCodeCharMap = {};
// pos 转换 char 用的
(function (){
    let a = 'a'.charCodeAt(0)
    let A = 'A'.charCodeAt(0)
    for(let i=0;i<25;i++){
        let b = String.fromCharCode(a+i)
        let j = 25+i
        let B = String.fromCharCode(A+i)
        posCodeNumberMap[i] = b
        posCodeCharMap[b] = i
        posCodeNumberMap[j] = B
        posCodeCharMap[B] = j
    }
}())


let pro={
    randomGet (array) {
        return array[Math.floor(array.length*Math.random())]
    },
    getBodyEnergyNeed(body){
        let need=0;
        body.forEach(e=>{if(BODYPART_COST[e])need+=BODYPART_COST[e]});
        return need;
    },
    /*
    let str = Utils.encodePosArray(Memory.rooms.W5N8.structMap.constructedWall.map(e=>{return {x:e[0],y:e[1]}}))
    log(str)
    let arrs = Utils.decodePosArray(str)
    log(arrs)
    log(Memory.rooms.W5N8.structMap.constructedWall.map(e=>{return {x:e[0],y:e[1]}}))
    */
    encodePosArray (posArray){
        return posArray.map(e=>posCodeNumberMap[e.x]+posCodeNumberMap[e.y]).reduce((a,b)=>a+b,"")
    },
    decodePosArray (string){
        let out = []
        for(let i=0;i<string.length;i+=2){
            out.push({x:posCodeCharMap[string[i]],y:posCodeCharMap[string[i+1]]})
        }
        return out;
    },
    // Only containers adjacent to energy sources are keeper work tiles,
    // not every container in the blueprint.
    sourceContainerTiles(containers, sources) {
        const tiles = new Set();
        const sourcePositions = (sources || []).filter(Boolean).map(source => source.pos || source);
        for (const item of containers || []) {
            if (!item) continue;
            const pos = item.pos || item;
            const x = Array.isArray(pos) ? pos[0] : pos.x;
            const y = Array.isArray(pos) ? pos[1] : pos.y;
            if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 50 && y >= 0 && y < 50
                && sourcePositions.some(source => Math.max(Math.abs(source.x - x), Math.abs(source.y - y)) === 1)) {
                tiles.add(y * 50 + x);
            }
        }
        return tiles;
    },
    decodeLayoutPositions(value) {
        if (typeof value === "string") return pro.decodePosArray(value);
        return Array.isArray(value) ? value.map(p => Array.isArray(p) ? {x:p[0], y:p[1]} : p) : [];
    },
    /** Fixed container work positions, not every container (e.g. mineral or Lab). */
    containerWorkTiles(containers, sources, controller, upgradeContainer) {
        const origin = controller?.pos || controller;
        const tiles = pro.sourceContainerTiles(containers, origin ? [...(sources || []), origin] : sources);
        const up = upgradeContainer?.pos || upgradeContainer;
        if (up && Number.isInteger(up.x) && up.x >= 0 && up.x < 50
            && Number.isInteger(up.y) && up.y >= 0 && up.y < 50) tiles.add(up.y * 50 + up.x);
        return tiles;
    },
    roomContainerWorkTiles(room, options) {
        const built = options?.containers || room[STRUCTURE_CONTAINER] || [];
        const sites = options?.sites || room.constructionSite || [];
        const planned = options?.planned ?? pro.decodeLayoutPositions(room.memory?.structMap?.[STRUCTURE_CONTAINER]);
        const candidates = built.concat(planned, sites.filter(s => s.structureType === STRUCTURE_CONTAINER && s.my !== false));
        const ownController = room.controller?.my || room.my ? room.controller : undefined;
        const upgradeId = ownController && room.memory?.stationUpgrade?.container;
        const registered = upgradeId && Game.getObjectById(upgradeId);
        const upgrade = registered?.structureType === STRUCTURE_CONTAINER && registered?.pos?.roomName === room.name
            ? registered : undefined;
        return pro.containerWorkTiles(candidates, options?.sources || room.source, ownController, upgrade);
    },
    preferOffSourceContainers(matrix, sourceTiles) {
        for (const tile of sourceTiles) {
            const x = tile % 50, y = Math.floor(tile / 50), cost = matrix.get(x, y);
            // A keeper can still enter its own container, but traffic should
            // pay for a modest detour rather than cross its work position.
            if (cost < 40) matrix.set(x, y, 40);
        }
    },
    hashCode (str){
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            let char = str.charCodeAt(i);
            hash = ((hash << 5) + hash) + char; /* hash * 33 + c */
        }
        return hash
    },
    //线性同余随机数
    rnd ( seed ){
        return ( seed * 9301 + 49297 ) % 233280; //为何使用这三个数?
    },
    randomInt(start,end){
        if(end==undefined){
            end = start
            start = 0
        }
        let range = end-start
        return start + Math.floor(Math.random()*range)
    }
};


global.Utils=pro;
