const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "../modules/strategy_npcConvoy.js"), "utf8");
const route = ["E51S29", "E51S30", "E50S30"];
const group = "0123456789abcdef01234567";
const makeParts = (part,count,boost)=>Array.from({length:count},()=>({type:part,hits:100,boost}));
const bodyBoosts = {tough:X("XGHO2","damage",0.3), move:X("XZHO2","fatigue",4),
    ranged_attack:X("XKHO2","rangedAttack",4), heal:X("XLHO2","heal",4), carry:X("XKH2O","capacity",4), attack:{}};
function X(name,key,value){return {[name]:{[key]:value}};}
function pos(x,y,roomName="E50S30") {
    return {x,y,roomName,lookFor:()=>[],inRangeTo(o,r){const p=o.pos||o;return Math.max(Math.abs(x-p.x),Math.abs(y-p.y))<=r;},
        getDirectionTo:()=>3,isEqualTo(o){return o.x===x&&o.y===y;},findClosestByRange:()=>({x:49,y:25})};
}
function world(options={}) {
    const costs = {tough:10,move:50,ranged_attack:150,heal:250,carry:50};
    const enemy = (i,body,contents={},point=pos(25,25))=>({id:"enemy"+i,name:`creep${group}_${i}`,owner:{username:"Screeps"},pos:point,body,store:contents,ticksToLive:1200,
        getActiveBodyparts:part=>body.filter(p=>p.type===part&&p.hits>0).length});
    const armor=makeParts("tough",5,"XGHO2");
    const cargo=enemy(0,[...armor,...makeParts("carry",1),...makeParts("heal",2)],{XGH2O:5000});
    const escort=enemy(1,[...makeParts("attack",25),...makeParts("heal",2)],{},pos(18,18));
    const radar={id:"ob1",my:true,isActive:()=>true};
    const home={name:route[0],controller:{my:true,level:options.level??8},observer:radar,
        storage:{my:true,store:{energy:100000,getFreeCapacity:()=>100000}},energyAvailable:12900,
        find:()=>Array.from({length:options.spawnCount??2},(_,i)=>({id:"spawn"+i,isActive:()=>true}))};
    const room={name:route[2],hostiles:[cargo,escort],portals:[],loot:[],find(kind,ops){
        if(kind==="hostile")return this.hostiles;if(kind==="structures")return this.portals.filter(ops?.filter??(()=>true));return [];
    },lookForAt:()=>room.loot};
    const objs={enemy0:cargo,enemy1:escort}, spawns=[], requests=[], features={npcConvoy:true,combat:true,observer:true,...options.features};
    const prices={energy:1,XGH2O:options.value??200,XGHO2:1,XZHO2:1,XKHO2:1,XLHO2:1,XKH2O:1};
    if (options.quotes) delete prices.XGH2O;
    const sb={Creep:function(){},MIN_CPU:false,Memory:{npcConvoyPrices:prices},OK:0,ERR_NOT_IN_RANGE:-9,
        SYSTEM_USERNAME:"Screeps", ORDER_BUY:"buy", ATTACK:"attack", RANGED_ATTACK:"ranged_attack", HEAL:"heal", TOUGH:"tough", CARRY:"carry",
        ATTACK_POWER:30,RANGED_ATTACK_POWER:10,HEAL_POWER:12,CARRY_CAPACITY:50,LAB_BOOST_ENERGY:20,LAB_BOOST_MINERAL:30,
        FIND_HOSTILE_CREEPS:"hostile",FIND_HOSTILE_POWER_CREEPS:"power",FIND_HOSTILE_STRUCTURES:"hostileStructures",
        FIND_STRUCTURES:"structures",FIND_MY_SPAWNS:"mySpawns",LOOK_STRUCTURES:"look",STRUCTURE_PORTAL:"portal",STRUCTURE_TOWER:"tower",STRUCTURE_CONTAINER:"container",RESOURCE_ENERGY:"energy",BOOSTS:bodyBoosts,
        Game:{time:100,shard:{name:options.shard??"shard2"},cpu:{bucket:options.bucket??10000},rooms:{[home.name]:home,[room.name]:room},creeps:{},getObjectById:id=>objs[id],
            map:{getRoomLinearDistance:()=>1,findRoute:()=>route.slice(1).map(room=>({room})),findExit:()=>3},market:{getHistory:()=>[],getAllOrders:()=>options.quotes||[]}},
        isCpuFeatureEnabled:name=>features[name]===true,
        Utils:{getBodyEnergyNeed:body=>body.reduce((n,p)=>n+costs[p],0)},UtilsTask:{taskData:(taskName,_reg,attrs)=>({taskName,...attrs})},
        StationObserver:{requestRoom:(...a)=>requests.push(a)},StationLab:{boostAble:()=>options.boosts!==false,generatorBoostResTask:()=>[{taskName:"boost"}]},
        StationHive:{trySpawn(room,home,body,role,tasks){const name=`own${spawns.length}`;spawns.push({room,home,body,role,tasks,name});sb.Game.creeps[name]={};return name;}},
    };
    sb.global=sb;
    vm.runInNewContext(src,sb);
    const strategy=sb.StrategyNpcConvoy;
    function observe(r=home) {strategy.recordObservation(r,room.name,sb.Game.time+1);sb.Game.time++;}
    function unit(kind,r=room){
        const record=spawns.find(s=>s.tasks[0].kind===kind), actions=[];
        const boostFor=Object.fromEntries(Object.entries(bodyBoosts).map(([p,v])=>[p,Object.keys(v)[0]]));
        const c={room:r,body:record.body.map(type=>({type,boost:boostFor[type],hits:100})),ticksToLive:1000,hits:5000,hitsMax:5000,
            pos:pos(22,25,r.name),store:{isEmpty:()=>true},lastTask:()=>record.tasks[0],popTask(){actions.push(["pop"]);return this;},addTask(t){actions.push(["task",t.taskName]);return this;},
            heal:()=>actions.push(["heal"]), moveTo:(t,opts)=>actions.push(["moveTo",t.id||t.x,opts.range]),move:d=>actions.push(["move",d]),
            rangedAttack(t){actions.push(["shoot",t.id]);return 0;},withdraw(t,r){actions.push(["withdraw",t.id,r]);return 0;}};
        return {c,actions,run:()=>sb.Creep.prototype.npcConvoyIntercept.call(c)};
    }
    return {sb,strategy,home,room,cargo,escort,objs,spawns,requests,observe,unit};
}

test("visible room is insufficient without this tick's confirmed owned RCL8 Observer",()=>{
    const a=world();a.strategy.exec();
    assert.equal(a.spawns.length,0);
    assert.deepEqual(a.requests[0],["E50S30","E51S29",true]);
    a.observe({...a.home,controller:{my:false,level:8}});a.strategy.exec();assert.equal(a.spawns.length,0);
    a.observe();a.sb.Game.time++;a.strategy.exec();assert.equal(a.spawns.length,0,"aged observer result");
    a.observe();a.home.observer={...a.home.observer,id:"replacement"};a.strategy.exec();assert.equal(a.spawns.length,0);
    a.observe();a.strategy.exec();assert.equal(a.spawns.length,2);
    assert.ok(a.spawns.every(s=>s.home==="E51S29"&&s.body.length===50&&s.tasks[1].taskName==="boost"));
    assert.equal(a.sb.Memory.npcConvoy.op.target,"enemy0");
});

test("no dispatch off shard, disabled, RCL7, low bucket, one idle spawn, or without profitable verified cargo",()=>{
    for (const options of [{shard:"shard3"},{features:{npcConvoy:false}},{level:7},{bucket:6499},{spawnCount:1},{value:1},{boosts:false}]) {
        const a=world(options);a.observe();a.strategy.exec();assert.equal(a.spawns.length,0,JSON.stringify(options));
    }
    for (const groupType of ["Invader","Player"]) {
        const a=world();a.cargo.owner.username=groupType;a.observe();a.strategy.exec();assert.equal(a.spawns.length,0);
    }
    const a=world();a.room.portals.push({structureType:"portal",pos:pos(27,27)});a.observe();a.strategy.exec();assert.equal(a.spawns.length,0,"cargo already near a portal");
    const stale=world();delete stale.cargo.ticksToLive;stale.observe();stale.strategy.exec();assert.equal(stale.spawns.length,0,"unknown lifetime");
});

test("a tiny top buy order does not price the full cargo at that quote",()=>{
    const shallow=world({quotes:[{price:1000,remainingAmount:1}]});shallow.observe();shallow.strategy.exec();
    assert.equal(shallow.spawns.length,0);
    const deep=world({quotes:[{price:50,remainingAmount:5000}]});deep.observe();deep.strategy.exec();
    assert.equal(deep.spawns.length,2);
});

test("one wave per convoy, even if both dispatched units are lost",()=>{
    const a=world();a.observe();a.strategy.exec();assert.equal(a.spawns.length,2);
    a.sb.Game.creeps={};a.sb.Game.time+=10;
    a.observe();a.strategy.exec();assert.equal(a.spawns.length,2);
});

test("fighter targets only cargo, retains same-shard gate and aborts if a player enters",()=>{
    const a=world();a.observe();a.strategy.exec();const f=a.unit("fighter");
    f.run();assert.deepEqual(f.actions[0],["shoot","enemy0"]);
    const shots=f.actions.length;
    a.escort.owner.username="Player";f.run();
    assert.equal(a.sb.Memory.npcConvoy.op.returning,true);
    assert.ok(f.actions.slice(shots).every(action=>action[0]!=="shoot"));
});

test("incomplete boosts or cargo leaving the room cause retreat instead of a chase",()=>{
    for (const scenario of ["missingBoost","leftRoom"]) {
        const a=world();a.observe();a.strategy.exec();const f=a.unit("fighter");
        if (scenario==="missingBoost") f.c.body[0].boost=undefined;
        else a.cargo.pos=pos(25,25,"E49S30");
        f.run();
        assert.equal(a.sb.Memory.npcConvoy.op.returning,true,scenario);
        assert.ok(f.actions.every(action=>action[0]!=="shoot"),scenario);
    }
});

test("hauler only enters a clear target and takes a new same-tile convoy cache",()=>{
    const a=world();a.observe();a.strategy.exec();const f=a.unit("fighter"), h=a.unit("hauler",{name:route[1],find:()=>[]});
    f.run();assert.equal(a.sb.Memory.npcConvoy.op.lastShot.x,25);
    const stash={id:"loot1",structureType:"container",store:{XGH2O:5000},pos:pos(25,25)};
    a.room.hostiles=[a.escort];a.room.loot=[stash];a.objs.loot1=stash;delete a.objs.enemy0;
    a.sb.Game.time++;f.run();assert.equal(a.sb.Memory.npcConvoy.op.loot,"loot1");
    h.run();assert.equal(h.actions.length,0,"hauler stays out until the escort is gone");
    a.room.hostiles=[];h.run();assert.equal(h.actions[0]?.[0],"moveTo");
    h.c.room=a.room;h.c.pos=pos(24,25);h.run();assert.deepEqual(h.actions[1],["withdraw","loot1","XGH2O"]);
});
