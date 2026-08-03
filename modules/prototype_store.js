



// Store.prototype._getFreeCapacity = Store.prototype.getFreeCapacity
// Store.prototype.getFreeCapacity = function (resType) {
//     let freeCap = this._getFreeCapacity(resType)
//     return freeCap<0?0:freeCap
// }


Store.prototype.isEmpty = function () {
    return  (this.getAllResTypeCount()==0)
}

Store.prototype.isFull = function () {
    return  (this.getFreeCapacity(RESOURCE_ENERGY)<=0)
}

Store.prototype.getLabReactionEmpty = function () {
    return this.getLabReactionCnt()==0
}

Store.prototype.getLabReactionCnt = function () {
    let cnt = 0
    for(let k of Object.keys(this)){
        if(this[k]>0&&k!=RESOURCE_ENERGY){
            cnt += this[k]
        }
    }
    return cnt
}

Store.prototype.getLabReactionResType = function () {
    for(let k of Object.keys(this)){
        if(this[k]>0&&k!=RESOURCE_ENERGY){
            return k
        }
    }
    return undefined
}

Store.prototype.getResTypeList = function () {
    let t = []
    for(let k of Object.keys(this)){
        if(this[k]>0){
            t.push(k)
        }
    }
    return t
}

Store.prototype.getAllResTypeCount = function () {
    let sum = 0
    for(let k of Object.keys(this)){
        if(this[k]>0){
            sum += this[k]
        }
    }
    return sum
}

Store.prototype.getLessResTypes = function () {
    return this.getResTypeList().sort((a,b)=>this[a]-this[b])
}

Store.prototype.getLessResTypesExceptEnergy = function () {
    return this.getResTypeList().filter(e=>e!=RESOURCE_ENERGY)
        .sort((a,b)=>this[a]-this[b])
}

StructureTerminal.prototype.$send = StructureTerminal.prototype.send
StructureTerminal.prototype.send = function (...e) {
    if(this._send)return ERR_TIRED;
    let code = this.$send(...e)
    if(code==OK)this._send = true;
    return code;
}

