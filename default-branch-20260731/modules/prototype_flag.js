/**
 * 命名规则：
 * 前缀+房间+任务
 * 如果没房间使用 global 代替
 */




Flag.prototype.getRoomName = function (index = 1) {
    let strLs = this.name.split("_");
    return strLs.length>=2?strLs[index]:undefined
}


Flag.prototype.getRoom = function (index = 1) {
    return Game.rooms[this.getRoomName(index)]
}

Flag.prototype.getPrefix = function () {
    let strLs = this.name.split("_");
    return strLs.length>=1?strLs[0]:strLs
}

Flag.prototype.getCrossShardParams = function () {
    let strLs = this.name.split("_");
    let cs = strLs.find(e=>e.startsWith("crossShard"))
    if(cs)return cs.split("&").slice(1)
    return [];
}

Flag.prototype.getNameSplit = function () {
    let strLs = this.name.split("_");
    return strLs
}

Flag.prototype.setPositionNextTick = function (pos) {
    this.memory.nextPos = pos
}

/**
 * 是否包含字符串（参数）
 * @param ops 参数
 * @return {boolean}
 */
Flag.prototype.hasOps = function (ops) {
    return this.name.indexOf(ops)!=-1
}

Flag.prototype.toShard = function () {
    return this.name.indexOf("crossShard")>=0?
        this.name.split("_").find(e=>e.indexOf("crossShard")>=0).split("&")[1]
        :undefined
}


