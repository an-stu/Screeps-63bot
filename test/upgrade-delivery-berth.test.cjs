/**
 * Pinned upgrade delivery berth: reserve one access tile around the controller
 * container without turning it into another upgrader stand.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const upgradeSource = fs.readFileSync(path.join(root, "modules/station_upgrade.js"), "utf8");
const creepSource = fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8");

function extract(source, header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, "missing " + header);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error("unterminated " + header);
}

const roomsByName = {};
class RoomPosition {
    constructor(x, y, roomName) { Object.assign(this, {x, y, roomName}); }
    getRangeTo(target) {
        const p = target.pos || target;
        return Math.max(Math.abs(this.x-p.x), Math.abs(this.y-p.y));
    }
    inRangeTo(target, range) { return this.getRangeTo(target) <= range; }
    isNearTo(target) { return this.getRangeTo(target) <= 1; }
    lookFor(kind) { return roomsByName[this.roomName]?.lookAt(kind, this.x, this.y) || []; }
}

function makeWorld({atBerth = [], terrain = 0} = {}) {
    const controller = {id:"ctrl",pos:new RoomPosition(44,29,"W31N51")};
    const buffer = {id:"buffer-id",structureType:"container",pos:new RoomPosition(45,28,"W31N51"),
        store:{energy:0,getFreeCapacity:()=>2000}};
    const room = {
        _upgradeDeliveryPosition:null,
        _upgradeDeliveryApproach:null,
        name:"W31N51",
        memory:{stationUpgrade:{container:buffer.id,deliveryPosition:{
            x:45,y:27,container:buffer.id,approach:{x:46,y:26},
        }}},
        structuresByTile:{"45:27":atBerth},
        lookAt(kind,x,y) { return kind==="structures" ? this.structuresByTile[x+":"+y]||[] : []; },
        find(kind) { return kind==="myCreeps" ? this.units : []; },
        creeps(_role,includeSpawning) { return this.units.filter(c=>includeSpawning||!c.spawning); },
    };
    roomsByName[room.name]=room;
    buffer.pos.room=room;
    controller.pos.room=room;
    const context={
        Creep:function(){},
        RoomPosition,
        Game:{
            time:1001,
            rooms:{[room.name]:room},
            getObjectById:id=>id===buffer.id?buffer:null,
            map:{getRoomTerrain:()=>({get:(x,y)=>x===45&&y===27?terrain:0})},
        },
        STRUCTURE_CONTAINER:"container",STRUCTURE_ROAD:"road",STRUCTURE_RAMPART:"rampart",
        STRUCTURE_CONTROLLER:"controller",
        STRUCTURE_LINK:"link",RESOURCE_ENERGY:"energy",LOOK_STRUCTURES:"structures",
        FIND_MY_CREEPS:"myCreeps",TERRAIN_MASK_WALL:1,
        OBSTACLE_OBJECT_TYPES:["spawn","extension","tower","constructedWall","link","lab","storage","terminal","factory","nuker","observer"],
        textHash:()=>0,
        isWalkableUpgradePosition:(p,c)=>p.roomName===c.pos.roomName&&p.inRangeTo(c.pos,3)
            &&!(context.Game.map.getRoomTerrain(p.roomName).get(p.x,p.y)&1),
        StationCarry:{isRoomMassStore:()=>false,roomMassStoreCnt:()=>0,generatorMassStoreCarry:()=>[]},
        console:{log(){}},
    };
    context.global=context;
    vm.createContext(context);
    // Production helper is a top-level function; load the actual predicate.
    vm.runInContext(extract(upgradeSource,"function isControllerUpgradeTask(creep, controller) {"),context);
    vm.runInContext(extract(upgradeSource,"function getUpgradeReservations(room, controller, delivery, approach) {"),context);
    vm.runInContext("Array.prototype.last=function(){return this[this.length-1]}",context);
    const methods=[
        extract(upgradeSource,"getDeliveryTile(room, cfg, adjacent) {"),
        extract(upgradeSource,"getDeliveryPosition(room, target) {"),
        extract(upgradeSource,"getDeliveryApproach(room, delivery) {"),
        extract(upgradeSource,"getUpgradePosition(creep, controller, supplyTargets = []) {"),
    ];
    vm.runInContext("this.pro={stationName:'stationUpgrade',"+methods.join(",\n")+"};",context);
    context.StationUpgrade=context.pro;
    return {context,room,buffer,controller,pro:context.pro};
}

function makeUpgrader(name, room, stand) {
    const tasks=[{id:"ctrl",taskName:"upgradeKeeper"}];
    tasks.last=()=>tasks[tasks.length-1];
    const memory={role:"upgrader",tasks};
    if(stand) memory.upgradePosition={...stand,controllerId:"ctrl"};
    return {name,room,spawning:false,memory,pos:new RoomPosition(42,29,room.name)};
}

// Valid config resolves only for the registered controller buffer.
{
    const w=makeWorld();
    const berth=w.pro.getDeliveryPosition(w.room,w.buffer);
    assert.deepEqual([berth.x,berth.y,berth.roomName],[45,27,"W31N51"]);
    const approach=w.pro.getDeliveryApproach(w.room,berth);
    assert.deepEqual([approach.x,approach.y,approach.roomName],[46,26,"W31N51"]);
    assert.equal(w.pro.getDeliveryPosition(w.room,{...w.buffer,id:"unregistered"}),undefined,
        "a different container cannot use the delivery berth");
    w.room.memory.stationUpgrade.deliveryPosition.container="stale-buffer";
    assert.equal(w.pro.getDeliveryPosition(w.room,w.buffer),undefined,
        "a stale container id must not reserve an unrelated tile");
}

// Invalid, out-of-bounds, non-adjacent, wall, obstacle and hostile private-rampart positions fail closed.
for(const [name,cfg,terrain,objects] of [
    ["bounds",{x:0,y:27},0,[]],
    ["not-adjacent",{x:47,y:27},0,[]],
    ["wall",{x:45,y:27},1,[]],
    ["obstacle",{x:45,y:27},0,[{structureType:"link"}]],
    ["hostile-rampart",{x:45,y:27},0,[{structureType:"rampart",my:false,isPublic:false}]],
]){
    const w=makeWorld({terrain,atBerth:objects});
    Object.assign(w.room.memory.stationUpgrade.deliveryPosition,cfg);
    assert.equal(w.pro.getDeliveryPosition(w.room,w.buffer),undefined, name+" berth");
}

// Existing saved stand is invalidated and the next upgrader cannot reserve the
// dedicated logistics tile.
{
    const w=makeWorld();
    const incumbent=makeUpgrader("u1",w.room,{x:45,y:27});
    const approachIncumbent=makeUpgrader("u0",w.room,{x:46,y:26});
    w.room.units=[incumbent,approachIncumbent];
    const berth=w.pro.getDeliveryPosition(w.room,w.buffer);
    const approach=w.pro.getDeliveryApproach(w.room,berth);
    const reservations=w.context.getUpgradeReservations(w.room,w.controller,berth,approach);
    assert.equal(incumbent.memory.upgradePosition,undefined,
        "pre-existing upgrader memory is cleared from the delivery berth");
    assert.equal(approachIncumbent.memory.upgradePosition,undefined,
        "pre-existing upgrader memory is cleared from the carrier ingress tile");
    assert.equal(reservations["45:27"],true,"the berth remains reserved against upgrader selection");
    assert.equal(reservations["46:26"],true,"the approach remains reserved against upgrader selection");

    w.room._upgradePositionReservations=undefined;
    const fresh=makeUpgrader("u2",w.room);
    w.room.units=[incumbent,approachIncumbent,fresh];
    const position=w.pro.getUpgradePosition(fresh,w.controller,[w.buffer]);
    assert.ok(position,"another controller position remains available");
    assert.notDeepEqual([position.x,position.y],[45,27],
        "a newly assigned upgrader must not park at the delivery berth");
    assert.notDeepEqual([position.x,position.y],[46,26],
        "a newly assigned upgrader must not park at the carrier ingress tile");
}

// Carrier from the observed adjacent tile (45,26) goes to exact berth (45,27),
// not to the buffer at (45,28). Unregistered ordinary container delivery keeps
// the established target-move behavior.
function carrierContext(target, config) {
    const w=makeWorld();
    if(config!==undefined) w.room.memory.stationUpgrade.deliveryPosition=config;
    const calls=[];
    const ctx=w.context;
    const fill=extract(creepSource,"Creep.prototype.fillRes = function () {");
    vm.runInContext(fill,ctx);
    const creep=new ctx.Creep();
    const task={id:target.id,roomName:w.room.name,resType:"energy"};
    Object.assign(creep,{
        room:w.room,memory:{role:"carrier"},store:{energy:800,getFreeCapacity:()=>0},
        pos:new RoomPosition(45,26,w.room.name),lastTask:()=>task,lastTaskObj:()=>target,
        storeEmpty:()=>false,
        moveTo:(dest,opts)=>calls.push({dest,opts}),
        transfer:()=>assert.fail("range-2 carrier should move before transfer"),
        popTask(){return this;},execLastTask(){return this;},
    });
    creep.fillRes();
    return {calls,w};
}
{
    const w=makeWorld();
    const {calls}=carrierContext(w.buffer);
    assert.equal(calls.length,1);
    assert.deepEqual([calls[0].dest.x,calls[0].dest.y,calls[0].opts.range],[45,27,0],
        "linked buffer delivery should route to the explicit reserved berth");

    const other={id:"other-container",structureType:"container",pos:new RoomPosition(44,28,"W31N51"),
        store:{energy:0,getFreeCapacity:()=>1000}};
    const ordinary=carrierContext(other);
    assert.equal(ordinary.calls.length,1);
    assert.equal(ordinary.calls[0].dest.id,other.id,
        "ordinary container fill still moves toward the original task target");
}

console.log("upgrade delivery berth: OK");
