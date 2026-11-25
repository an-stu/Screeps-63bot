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

class RoomPosition {
    constructor(x, y, roomName = "W31N51") { Object.assign(this, {x,y,roomName}); }
    getRangeTo(p) { p=p.pos||p; return Math.max(Math.abs(this.x-p.x), Math.abs(this.y-p.y)); }
    inRangeTo(p,r) { return this.getRangeTo(p) <= r; }
    isNearTo(p) { return this.inRangeTo(p,1); }
    isEqualTo(p) { return this.x===p.x && this.y===p.y && this.roomName===p.roomName; }
    lookFor() { return []; }
    walkable() { return true; }
}

function makeUpgradeRuntime(transit, assigned = "W31N51", walkable, objects = {}) {
    const controller = {id:"controller", pos:new RoomPosition(44,29,assigned)};
    const excluded = new Set(transit.map(p => p.x+":"+p.y));
    const room = {
        name:assigned, my:true, memory:{stationUpgrade:{container:"buffer", transitTiles:"packed"}},
        controller, units:[], _upgradePositionReservations:null,
        find(type) { return type === "myCreeps" ? this.units : []; },
        creeps(role, includeSpawning) { return this.units.filter(c => c.memory.role===role); },
        constructionSite:[],
    };
    const ctx = {
        RoomPosition:class extends RoomPosition {
            walkable() { return !walkable || walkable.includes(this.x+":"+this.y); }
            lookFor(kind) { return objects[this.x+":"+this.y]?.[kind] || []; }
        },
        Creep:function(){}, OK:0, RESOURCE_ENERGY:"energy", TASK_EXEC_MAX_DEPTH:10,
        FIND_MY_CREEPS:"myCreeps", STRUCTURE_CONTAINER:"container", STRUCTURE_ROAD:"road",
        STRUCTURE_CONTROLLER:"controller", STRUCTURE_RAMPART:"rampart", LOOK_STRUCTURES:"structures",
        LOOK_CONSTRUCTION_SITES:"sites", LOOK_POWER_CREEPS:"powerCreeps",
        TERRAIN_MASK_WALL:1, OBSTACLE_OBJECT_TYPES:["spawn","extension","tower","constructedWall","link","lab"],
        Game:{time:100, map:{getRoomTerrain:()=>({get:()=>0})}, getObjectById:()=>null},
        Utils:{decodePosArray: value=>value==="packed"?transit:(value||[])},
        textHash:()=>0,
        isWalkableUpgradePosition:pos=>!excluded.has(pos.x+":"+pos.y),
        pro:{stationName:"stationUpgrade"},
        console,
    };
    ctx.global=ctx;
    const helper=extract(upgradeSource,"function isControllerUpgradeTask(creep, controller) {");
    vm.runInNewContext(helper,ctx);
    const methods=[
        extract(upgradeSource, "getTransitTiles(room) {"),
        extract(upgradeSource, "getDeliveryTile(room, cfg, adjacent) {"),
        extract(upgradeSource, "getDeliveryPosition(room, target) {"),
        extract(upgradeSource, "getDeliveryApproach(room, delivery) {"),
        extract(upgradeSource, "getUpgradeReservations(room, controller, delivery, approach) {"),
        extract(upgradeSource, "getUpgradePosition(creep, controller, supplyTargets = []) {"),
        extract(upgradeSource, "clearCarrierTraffic(creep) {"),
    ];
    vm.runInNewContext("this.pro = {stationName:'stationUpgrade'," + methods.join(",\n") + "};", ctx);
    ctx.getUpgradeReservations=(...args)=>ctx.pro.getUpgradeReservations(...args);
    ctx.StationUpgrade=ctx.pro;
    return {ctx,room,controller,api:ctx.pro};
}

function upgrader(name, room, stand) {
    const c={
        name, room, pos:new RoomPosition(45,27,room.name),
        memory:{role:"upgrader",tasks:Object.assign([{taskName:"upgradeKeeper",id:room.controller.id}],{last(){return this[this.length-1];}}),
            upgradePosition:{...stand,controllerId:room.controller.id}},
    };
    room.units.push(c);
    return c;
}

// Protect every actual cached outer
// route tile near the controller and reject a stale stored stand there.
{
    const route = [
        {x:47,y:27}, {x:46,y:27}, {x:45,y:27}, {x:44,y:27},
        {x:43,y:28}, {x:42,y:28},
    ];
    const {room,controller,api} = makeUpgradeRuntime(route);
    const existing=upgrader("old-upgrader",room,{x:45,y:27});
    const reservations=api.getUpgradeReservations(room,controller);
    assert.equal(existing.memory.upgradePosition,undefined,
        "a saved upgrader stance on a cached through-lane must be invalidated");
    assert.equal(reservations["45:27"],true,"cached transit tiles remain blocked to upgrader selection");
    assert.ok(route.every(p=>api.getTransitTiles(room).has(p.x+":"+p.y)));
    assert.equal(api.getTransitTiles(room).has("40:29"),false,"tiles outside actual routes remain eligible");

    const fresh={name:"new-upgrader",room,pos:new RoomPosition(45,27,room.name),memory:{role:"upgrader"}};
    room.units=[existing,fresh];
    const selected=api.getUpgradePosition(fresh,controller,[]);
    assert.ok(selected,"upgrader should find another stand");
    assert.equal(api.getTransitTiles(room).has(selected.x+":"+selected.y),false,
        "a new upgrader must not choose any current cached hauler waypoint");
}

// An idle carrier (including a local carrier still carrying cargo) on a lane
// moves to a free non-lane neighbor and remains pullable. Assigned carriers
// and loaded outer haulers must not be relocated.
{
    const path=[{x:44,y:27},{x:45,y:27},{x:46,y:27}];
    const {room,api,ctx}=makeUpgradeRuntime(path);
    const calls=[];
    const carrier={
        name:"idle-carrier", room, pos:new RoomPosition(45,27,room.name),
        memory:{role:"carrier",tasks:[],dontPullMe:true},
        store:{energy:0}, storeEmpty:()=>true,
        moveTo(target,opts){calls.push({target,opts});return 0;},
    };
    assert.equal(api.clearCarrierTraffic(carrier),true);
    assert.equal(calls.length,1);
    const target=calls[0].target;
    assert.equal(carrier.pos.getRangeTo(target),1,"parking only uses BetterMove's adjacent fast path");
    assert.equal(calls[0].opts.range,0);
    assert.equal(calls[0].opts.ignoreCreeps,false);
    assert.notEqual(target.x+":"+target.y,"45:27");
    assert.equal(api.getTransitTiles(room).has(target.x+":"+target.y),false,
        "idle carrier parking target must be outside all cached lanes");
    assert.equal(carrier.memory.dontPullMe,false,"parked idle carriers should yield to traffic");

    let moves=0;
    room._upgradeTrafficParking=new Set();
    const loaded={...carrier,pos:new RoomPosition(45,27,room.name),store:{energy:50},
        moveTo(){moves++;return 0;}};
    assert.equal(api.clearCarrierTraffic(loaded),true,"an idle local carrier may park even while carrying resources");
    assert.equal(moves,1,"the loaded local carrier should clear the lane");
    const working={...carrier,pos:new RoomPosition(45,27,room.name),memory:{role:"carrier",dontPullMe:true,tasks:[{taskName:"fillRes"}]},
        moveTo(){moves++;}};
    assert.equal(api.clearCarrierTraffic(working),false,"assigned carriers retain their task");
    assert.equal(working.memory.dontPullMe,false,"an active hauler on the lane must not pin it");
    assert.equal(moves,1);
    const loadedRemote={...carrier,pos:new RoomPosition(45,27,room.name),
        memory:{role:"outerHarvestEnergyCarrier",tasks:[]},store:{energy:50},storeEmpty:()=>false,moveTo(){moves++;}};
    assert.equal(api.clearCarrierTraffic(loadedRemote),false,"loaded outer haulers must finish their delivery");
    assert.equal(moves,1);
    const ordinary={...carrier,pos:new RoomPosition(45,27,room.name),room:{...room,my:false},
        moveTo(){moves++;}};
    assert.equal(api.clearCarrierTraffic(ordinary),false,"foreign-room creeps are not displaced");
    assert.equal(moves,1);
}

// The common empty-task execution path invokes the clearing helper only for
// carrier roles; non-carriers never use this parking behavior.
{
    const fn=extract(creepSource,"Creep.prototype.execLastTask = function () {");
    const calls=[];
    const ctx={
        console, TASK_EXEC_MAX_DEPTH:10, Game:{flags:{}}, Creep:function(){},
        StationUpgrade:{trySignController(){return false;},clearCarrierTraffic(c){calls.push(c.name);return true;}},
    };
    ctx.global=ctx;
    vm.runInNewContext(fn,ctx);
    const run=role=>{
        const tasks=[];
        tasks.last=function(){return this[this.length-1];};
        const c={name:role,room:{my:true,controller:null},memory:{tasks,role,dontPullMe:true},_taskExecDepth:0};
        c.execLastTask=ctx.Creep.prototype.execLastTask;
        c.execLastTask();
        return c;
    };
    run("carrier");
    run("outerHarvestEnergyCarrier");
    assert.deepEqual(calls,["carrier","outerHarvestEnergyCarrier"]);
    const before=calls.length;
    run("worker");
    assert.equal(calls.length,before,"non-haulers must not be relocated by the idle-carrier hook");
}

// One-square corridor: a two-step turnout can be found without PathFinder.
// Power creeps count as obstacles and the turnout cannot be claimed twice.
{
    const route=[{x:44,y:27},{x:45,y:27},{x:46,y:27}];
    const {room,api}=makeUpgradeRuntime(route,"W31N51",["44:27","45:27","46:27","43:26","47:28","45:26"],
        {"45:26":{powerCreeps:[{}]},"43:26":{sites:[{}]}});
    const steps=[];
    const carrier={room,pos:new RoomPosition(45,27,room.name),memory:{role:"carrier",tasks:[],dontPullMe:true},
        moveTo(p){steps.push([p.x,p.y]);return 0;}};
    assert.equal(api.clearCarrierTraffic(carrier),true);
    assert.deepEqual(steps,[[46,27]],"use the side with a free turnout, not the blocked adjacent tile");
    assert.ok(room._upgradeTrafficParking.has("47:28"));
    carrier.pos=new RoomPosition(46,27,room.name);
    room._upgradeTrafficParking=new Set(); // Fresh Room cache on the next tick.
    assert.equal(api.clearCarrierTraffic(carrier),true);
    assert.deepEqual(steps,[[46,27],[47,28]]);
    assert.equal(api.clearCarrierTraffic(carrier),false,"another hauler cannot claim the same turnout this tick");
    room._upgradeTrafficParking=new Set();
    carrier.fatigue=2;
    assert.equal(api.clearCarrierTraffic(carrier),false,"do not reserve a step before fatigue clears");
}

// Exercise real fillRes → execLastTask completion and a handler that only
// pops its own task. Both must release same-tick, without overwriting a next task.
for (const scenario of ["delivery", "pop-only", "next-task"]) {
    const {room,api,ctx}=makeUpgradeRuntime([{x:45,y:27}],"W31N51",["45:26"]);
    api.trySignController=()=>false;
    vm.runInNewContext(extract(creepSource,"Creep.prototype.execLastTask = function () {"),ctx);
    vm.runInNewContext(extract(creepSource,"Creep.prototype.fillRes = function () {"),ctx);
    const actions=[];
    const obj={pos:new RoomPosition(46,27,room.name),store:{energy:0,getFreeCapacity:()=>2000}};
    const tasks=[{id:"buffer",roomName:room.name,resType:"energy",taskName:scenario==="pop-only"?"popOnly":"fillRes"}];
    if (scenario==="next-task") tasks.unshift({taskName:"goBackToMine"});
    tasks.last=()=>tasks.at(-1);
    const carrier=Object.assign(new ctx.Creep(),{
        room,pos:new RoomPosition(45,27,room.name),memory:{role:"carrier",tasks,dontPullMe:true},
        store:{energy:100,getFreeCapacity:()=>0}, storeEmpty(){return this.store.energy===0;},
        lastTask(){return tasks.last();},lastTaskObj(){return obj;},popTask(){tasks.pop();return this;},
        transfer(_target,_resource,amount){actions.push(["transfer",amount]);return 0;},
        popOnly(){return this.popTask();},goBackToMine(){actions.push(["next-task-move"]);},
        moveTo(p){actions.push(["park",p.x,p.y]);return 0;},
    });
    carrier.execLastTask();
    if (scenario==="delivery") assert.deepEqual(actions,[["transfer",100],["park",45,26]]);
    if (scenario==="pop-only") assert.deepEqual(actions,[["park",45,26]]);
    if (scenario==="next-task") {
        assert.deepEqual(actions,[["transfer",100],["next-task-move"]]);
        assert.equal(tasks.length,1);
    }
    assert.equal(carrier.memory.dontPullMe,false);
}

console.log("controller traffic clearance: OK");
