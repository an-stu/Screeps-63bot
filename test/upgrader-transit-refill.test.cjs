const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../modules/station_upgrade.js"), "utf8");
const key = pos => `${pos.x}:${pos.y}`;
const name = "E41S29";

class RoomPosition {
    constructor(x, y, roomName = name) { Object.assign(this, {x, y, roomName}); }
    getRangeTo(target) {
        const pos = target.pos || target;
        return Math.max(Math.abs(this.x - pos.x), Math.abs(this.y - pos.y));
    }
    isNearTo(target) { return this.getRangeTo(target) <= 1; }
    inRangeTo(target, range) { return this.getRangeTo(target) <= range; }
    isEqualTo(target) { const pos = target.pos || target; return key(pos) === key(this) && pos.roomName === this.roomName; }
    walkable() { return true; }
    lookFor() { return []; }
}

function setup({containerEnergy = 607, linkEnergy = 0, noContainer = false, transit = true, berth = false} = {}) {
    const controller = {id:"ctrl", pos:new RoomPosition(40,10)};
    const store = (id, structureType, energy, x, y) => ({
        id, structureType, pos:new RoomPosition(x,y), hits:2000, hitsMax:2000,
        store:{energy, getFreeCapacity(){return 2000 - this.energy;}},
    });
    const container = noContainer ? null : store("container", "container", containerEnergy,39,11);
    const link = store("link", "link", linkEnergy,38,11);
    const objects = {ctrl:controller, link, container};
    const units = [];
    const station = {container:container?.id, link:link.id, creeps:[]};
    if (transit) station.transitTiles = "packed";
    if (berth) station.deliveryPosition = {container:container.id,x:38,y:12,approach:{x:37,y:12}};
    const room = {
        name, my:true, controller, memory:{stationUpgrade:station},
        find:()=>units, creeps:()=>transit || berth ? [...units,{}] : units,
    };
    const ctx = {
        RoomPosition, Creep:function(){}, OK:0, ERR_NOT_IN_RANGE:-9, ERR_NO_PATH:-2, ERR_TIRED:-11,
        RESOURCE_ENERGY:"energy", WORK:"work", CARRY:"carry", STRUCTURE_CONTAINER:"container", STRUCTURE_LINK:"link",
        STRUCTURE_ROAD:"road", STRUCTURE_CONTROLLER:"controller", STRUCTURE_RAMPART:"rampart",
        FIND_MY_CREEPS:"my-creeps", LOOK_STRUCTURES:"structures", LOOK_POWER_CREEPS:"power", LOOK_CONSTRUCTION_SITES:"sites",
        OBSTACLE_OBJECT_TYPES:["link"], TERRAIN_MASK_WALL:1,
        Game:{time:101, getObjectById:id=>objects[id]||null, map:{getRoomTerrain:()=>({get:()=>0})}},
        Utils:{decodePosArray:()=>Array.from([34,35,36,37,38,39,40],x=>({x,y:12}))},
    };
    ctx.global = ctx;
    vm.runInNewContext(source,ctx);
    function makeCreep({pos=new RoomPosition(37,13), stand=pos, energy=0, max=100, rejectMove, rejectWithdraw} = {}) {
        const actions = [];
        const tasks = [{taskName:"upgradeKeeper",id:"ctrl"}];
        tasks.last = () => tasks.at(-1);
        const creep = Object.assign(new ctx.Creep(), {
            name:"u" + units.length, pos, room, ticksToLive:100, body:[],
            memory:{role:"upgrader",dontPullMe:true,tasks,upgradePosition:{x:stand.x,y:stand.y,controllerId:"ctrl"}},
            store:{energy,getFreeCapacity(){return max - this.energy;},getUsedCapacity(){return this.energy;}},
            getPartCnt:part=>part === "work" ? 10 : 2,
            mainRoom:()=>room, lastTaskObj:()=>controller,
            concatStationUpgrade(){},
            withdraw(target,_resource,amount) {
                actions.push(["withdraw",target.id,amount]);
                if (!this.pos.isNearTo(target)) return -9;
                return rejectWithdraw === target.id ? -6 : 0;
            },
            moveTo(target,opts) {
                actions.push(["move",target.id || key(target),opts?.range]);
                return rejectMove === (target.id || key(target)) ? -2 : 0;
            },
            upgradeController(){actions.push(["upgrade"]);this.memory.dontPullMe=true;return 0;},
            repair(){actions.push(["repair"]);this.memory.dontPullMe=true;return 0;},
            transfer(target,_resource,amount){actions.push(["transfer",target.id,amount]);return 0;},
        });
        units.push(creep);
        return {creep,actions};
    }
    return {room, container, link, makeCreep, api:ctx.StationUpgrade};
}

// E41S29: turn a range-2 empty stand into an actual refill trip, then
// withdraw and move out in the same tick while the engine still shows 0 energy.
{
    const {makeCreep} = setup();
    const {creep,actions} = makeCreep();
    creep.upgradeKeeper();
    assert.deepEqual(actions.splice(0), [["move","container",1]]);
    assert.equal(creep.memory.dontPullMe,false);

    creep.pos = new RoomPosition(38,12);
    creep.upgradeKeeper();
    assert.deepEqual(actions.splice(0), [["withdraw","container",100],["move","37:13",0]]);
    assert.equal(creep.store.energy,0,"the new Store balance does not arrive until the next tick");
    assert.equal(creep.memory.dontPullMe,false);

    creep.pos = new RoomPosition(37,13);
    creep.store.energy = 100;
    creep.upgradeKeeper();
    assert.deepEqual(actions,[["upgrade"]]);
    assert.equal(creep.memory.dontPullMe,true);
    assert.deepEqual(creep.memory.upgradePosition,{x:37,y:13,controllerId:"ctrl"});
}

// Two adjacent users can consume a partial remainder, but cannot reserve
// nonexistent energy. Link-only operation must also clear the lane.
{
    const {makeCreep,link} = setup({noContainer:true,linkEnergy:120});
    const first = makeCreep({pos:new RoomPosition(38,12),stand:new RoomPosition(37,13)});
    const second = makeCreep({pos:new RoomPosition(39,12),stand:new RoomPosition(39,13)});
    const third = makeCreep({pos:new RoomPosition(37,12),stand:new RoomPosition(40,13)});
    for (const {creep} of [first,second,third]) creep.upgradeKeeper();
    assert.deepEqual(first.actions,[["withdraw","link",100],["move","37:13",0]]);
    assert.deepEqual(second.actions,[["withdraw","link",20],["move","39:13",0]]);
    assert.deepEqual(third.actions,[["move","40:13",0]]);
    assert.equal(link._upgrade_used,120);
}

// No valid route to the closest supply: fall back to a different live one.
{
    const {makeCreep} = setup({linkEnergy:500});
    const {creep,actions} = makeCreep({pos:new RoomPosition(35,13),stand:new RoomPosition(37,13),rejectMove:"link"});
    creep.upgradeKeeper();
    assert.deepEqual(actions,[["move","link",1],["move","container",1]]);
    assert.equal(creep.memory.dontPullMe,false);
}

// A failed adjacent link withdrawal must not consume its reservation or
// stop the creep using the adjacent container and leaving the berth.
{
    const {makeCreep,link} = setup({transit:false,berth:true,linkEnergy:300});
    const {creep,actions} = makeCreep({pos:new RoomPosition(38,12),stand:new RoomPosition(37,13),rejectWithdraw:"link"});
    creep.upgradeKeeper();
    assert.deepEqual(actions,[["withdraw","link",100],["withdraw","container",100],["move","37:13",0]]);
    assert.equal(link._upgrade_used,undefined);
    assert.equal(creep.memory.dontPullMe,false);
}

// A dry buffer is not a destination. If the old stand cannot be reached,
// look for an adjacent turnout rather than remaining pinned in the lane.
{
    const {makeCreep} = setup({containerEnergy:0});
    const {creep,actions} = makeCreep({pos:new RoomPosition(38,12),stand:new RoomPosition(37,13),rejectMove:"37:13"});
    creep.upgradeKeeper();
    assert.deepEqual(actions[0],["move","37:13",0]);
    assert.equal(actions.length,2);
    assert.equal(actions[1][0],"move");
    assert.ok(!actions[1][1].endsWith(":12"));
    assert.equal(creep.memory.dontPullMe,false);
}

// An unconfigured room still uses the legacy work loop.
{
    const {makeCreep,api} = setup({transit:false});
    api.upgradeWithTraffic = () => assert.fail("no traffic rule should run here");
    const {creep,actions} = makeCreep({energy:100});
    creep.upgradeKeeper();
    assert.deepEqual(actions,[["upgrade"],["move","39:11",0]]);
}

console.log("upgrader transit refill: OK");
