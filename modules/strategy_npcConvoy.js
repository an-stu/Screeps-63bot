/** Optional, same-shard NPC cargo interception. Never dispatch on stale intel. */
const TARGET_SHARD = "shard2";
const TARGET_ROOM = "E50S30";
const RECHECK_INTERVAL = 37;
const MIN_BUCKET = 6500;
const MAX_ROUTE_ROOMS = 3;
const LAUNCH_FLOOR = 150 + 200 + 120; // parallel hatch, lab staging, engagement margin
const RETURN_FLOOR = 80;
const MIN_LOOT = 1500;
const CARGO_BOOST = "XKH2O";
const FIGHTER = {tough: [6, "XGHO2"], move: [13, "XZHO2"], ranged_attack: [20, "XKHO2"], heal: [11, "XLHO2"]};
const HAULER = {carry: [25, CARGO_BOOST], move: [25]};
let visibleBy;
let nextObserve = 0;
let priceCache = Object.create(null);
let buyDepth = Object.create(null);

function enabled() {
    return Game.shard.name === TARGET_SHARD && isCpuFeatureEnabled("npcConvoy")
        && isCpuFeatureEnabled("combat") && isCpuFeatureEnabled("observer");
}

function watches(roomName) { return roomName === TARGET_ROOM && enabled(); }

function rcl8(room) { return !!(room && room.controller && room.controller.my && room.controller.level === 8); }
function observerReady(room) { return rcl8(room) && room.observer && room.observer.my && room.observer.isActive(); }

function recordObservation(room, roomName, visibleTick) {
    if (watches(roomName) && observerReady(room) && visibleTick === Game.time + 1)
        visibleBy = {room: room.name, observerId: room.observer.id, tick: visibleTick};
}

function routeFor(room) {
    if (!observerReady(room) || Game.map.getRoomLinearDistance(room.name, TARGET_ROOM) > MAX_ROUTE_ROOMS) return;
    const route = Game.map.findRoute(room.name, TARGET_ROOM, {routeCallback(name) {
        const visible = Game.rooms[name];
        if (visible?.controller?.my) return 1;
        const coords = /^[WE](\d+)[NS](\d+)$/.exec(name);
        return coords && (+coords[1] % 10 === 0 || +coords[2] % 10 === 0) && !visible?.controller?.owner ? 1 : Infinity;
    }});
    if (Array.isArray(route) && route.length > 0 && route.length <= MAX_ROUTE_ROOMS)
        return [room.name, ...route.map(step => step.room)];
}

function range(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function convoyGroup(creep) {
    // The portal event is owned by the system account, not the "Invader" faction.
    if (!creep || creep.my || creep.owner?.username !== SYSTEM_USERNAME) return;
    return /^creep([a-f\d]{24})_\d+$/.exec(creep.name)?.[1];
}
function portalPositions(room) {
    if (!room._npcConvoyPortals) room._npcConvoyPortals = room.find(FIND_STRUCTURES, {filter: s => s.structureType === STRUCTURE_PORTAL});
    return room._npcConvoyPortals;
}
function hostileCreeps(room) { return room.getHostileCreeps ? room.getHostileCreeps() : room.find(FIND_HOSTILE_CREEPS); }
function dangerousRoom(room, group) {
    return !!(room.controller?.owner || room.find(FIND_HOSTILE_POWER_CREEPS).length
        || room.find(FIND_HOSTILE_STRUCTURES, {filter: s => s.structureType === STRUCTURE_TOWER}).length
        || hostileCreeps(room).some(e => convoyGroup(e) !== group));
}
function boostValue(part, action) { return BOOSTS[part.type]?.[part.boost]?.[action] ?? 1; }
function power(creep, type, action, base) {
    return creep.body.reduce((v,p) => v + (p.type === type && p.hits > 0 ? base * boostValue(p, action) : 0), 0);
}
function withinCombatBudget(cargo, escorts) {
    const worstIncoming = escorts.reduce((sum,e) => sum + power(e, ATTACK, "attack", ATTACK_POWER)
        + power(e, RANGED_ATTACK, "rangedAttack", RANGED_ATTACK_POWER), 0);
    const worstHeal = escorts.reduce((sum,e) => sum + power(e, HEAL, "heal", HEAL_POWER), 0);
    const cargoArmor = cargo.body.reduce((min,p) => p.type === TOUGH && p.hits > 0 ? Math.min(min, boostValue(p, "damage")) : min, 1);
    const armor = BOOSTS[TOUGH][FIGHTER.tough[1]].damage;
    return worstIncoming * armor <= FIGHTER.heal[0] * HEAL_POWER * BOOSTS[HEAL][FIGHTER.heal[1]].heal * 0.98
        && FIGHTER.ranged_attack[0] * RANGED_ATTACK_POWER * BOOSTS[RANGED_ATTACK][FIGHTER.ranged_attack[1]].rangedAttack * cargoArmor > worstHeal * 1.25;
}
function materialize(spec) { return Object.entries(spec).flatMap(([part,[count]])=>Array(count).fill(part)); }
function minerals(spec) { return Object.fromEntries(Object.values(spec).filter(([,boost])=>boost).map(([count,boost])=>[boost,count * LAB_BOOST_MINERAL])); }
function fullyBoosted(creep, spec) {
    return Object.entries(spec).every(([type,[count,boost]]) => creep.body.filter(p=>p.type===type && p.hits>0 && (!boost || p.boost===boost)).length >= count);
}

function estimatePrice(resource) {
    const manual = Memory.npcConvoyPrices?.[resource];
    if (Number.isFinite(manual) && manual > 0) return manual;
    const cache = priceCache[resource];
    if (cache && Game.time - cache.tick < 1500) return cache.price;
    const entries = (Game.market.getHistory(resource) || []).slice(-7);
    let n = 0, sum = 0;
    for (const e of entries) if (e.volume > 0 && e.avgPrice > 0) { n += e.volume; sum += e.volume*e.avgPrice; }
    const price = n ? sum/n : 0;
    priceCache[resource] = {tick:Game.time,price};
    return price;
}

function estimateLootValue(resource, amount) {
    const ownUsePrice = Memory.npcConvoyPrices?.[resource];
    if (Number.isFinite(ownUsePrice) && ownUsePrice > 0) return ownUsePrice * amount;
    let quote = buyDepth[resource];
    if (!quote || Game.time - quote.tick >= 300) {
        const orders = (Game.market.getAllOrders({type:ORDER_BUY,resourceType:resource}) || [])
            .filter(o=>o.price>0 && (o.remainingAmount ?? o.amount)>0).sort((a,b)=>b.price-a.price);
        quote = buyDepth[resource] = {tick:Game.time,orders};
    }
    let value = 0;
    for (const order of quote.orders) {
        const quantity = Math.min(amount,order.remainingAmount ?? order.amount);
        value += quantity * order.price;
        amount -= quantity;
        if (amount <= 0) break;
    }
    return value;
}

function worthLaunching(resource, amount, bodies, boost) {
    const value = estimateLootValue(resource,amount), energyPrice = estimatePrice(RESOURCE_ENERGY);
    if (!value || !energyPrice) return false;
    let cost = (bodies.reduce((n,body)=>n+Utils.getBodyEnergyNeed(body),0)
        + Object.values(boost).reduce((n,v)=>n+v,0) / LAB_BOOST_MINERAL * LAB_BOOST_ENERGY) * energyPrice;
    for (const [r, qty] of Object.entries(boost)) {
        const unit = estimatePrice(r);
        if (!unit) return false;
        cost += qty * unit;
    }
    // A moving convoy may leave or the escorts may prevent pickup. Do not budget full recovery.
    return value * 0.65 >= cost * 1.20;
}

function plan(home, room, route, oldAttempt) {
    if (!route || !home.storage || home.storage.store[RESOURCE_ENERGY] < 50000) return;
    const hostiles = hostileCreeps(room), portals = portalPositions(room);
    const capacity = HAULER.carry[0] * CARRY_CAPACITY * BOOSTS[CARRY][CARGO_BOOST].capacity;
    const bodies = [materialize(FIGHTER), materialize(HAULER)], boost = {...minerals(FIGHTER), ...minerals(HAULER)};
    const cost = bodies.reduce((n,b)=>n+Utils.getBodyEnergyNeed(b),0);
    if ((home.currentEnergyAvailable ?? home.energyAvailable) < cost
        || home.find(FIND_MY_SPAWNS).filter(s=>!s.spawning && s.isActive() && !home.spawnedMap?.[s.id]).length < 2) return;
    for (const cargo of hostiles) {
        const group = convoyGroup(cargo);
        if (!group || group === oldAttempt || !cargo.store || !cargo.body.some(b=>b.type===CARRY)
            || !Number.isFinite(cargo.ticksToLive) || cargo.ticksToLive < LAUNCH_FLOOR + (route.length-1)*50
            || Math.min(cargo.pos.x,cargo.pos.y,49-cargo.pos.x,49-cargo.pos.y) < 6
            || portals.some(p=>range(cargo.pos,p.pos)<=5) || dangerousRoom(room,group)
            || !withinCombatBudget(cargo,hostiles)) continue;
        const resource = Object.keys(cargo.store).filter(r=>cargo.store[r]>=MIN_LOOT).sort((a,b)=>cargo.store[b]-cargo.store[a])[0];
        if (resource && worthLaunching(resource,Math.min(cargo.store[resource],capacity),bodies,boost)
            && StationLab.boostAble(home,boost)) return {cargo,group,resource,bodies};
    }
}

function exec() {
    if (!enabled()) return;
    let state = Memory.npcConvoy;
    let op = state?.op;
    if (op) {
        if (Game.time - op.start < 5 || Game.creeps[op.fighter] || Game.creeps[op.hauler]) return;
        delete state.op;
    }
    if (MIN_CPU || (global.isSaveCpu !== false && Game.cpu.bucket < MIN_BUCKET)) return;
    if (visibleBy?.tick === Game.time) {
        const home = Game.rooms[visibleBy.room], room = Game.rooms[TARGET_ROOM];
        const attempt = state?.until > Game.time ? state.attempted : undefined;
        if (room && observerReady(home) && home.observer.id === visibleBy.observerId) {
            const route = routeFor(home), p = plan(home,room,route,attempt);
            if (p) {
                state = Memory.npcConvoy || (Memory.npcConvoy = {});
                state.op = {start:Game.time,route,group:p.group,target:p.cargo.id,resource:p.resource,deadline:Game.time+p.cargo.ticksToLive-20};
                state.attempted=p.group; state.until=Game.time+p.cargo.ticksToLive+50;
                const task = (kind,spec) => [UtilsTask.taskData("npcConvoyIntercept",undefined,{kind,group:p.group,route}), ...StationLab.generatorBoostResTask(minerals(spec),home)];
                state.op.fighter=StationHive.trySpawn(home,home.name,p.bodies[0],"npcConvoy",task("fighter",FIGHTER));
                if (state.op.fighter) state.op.hauler=StationHive.trySpawn(home,home.name,p.bodies[1],"npcConvoy",task("hauler",HAULER));
                if (!state.op.hauler) state.op.returning=true;
                return;
            }
        }
    }
    // Regular observer results also qualify. If the normal rotation misses
    // this room, use one extra priority scan (never on an ineligible shard).
    if (Game.time < nextObserve) return;
    nextObserve=Game.time+RECHECK_INTERVAL;
    const home = Object.values(Game.rooms).filter(observerReady).sort((a,b)=>
        Game.map.getRoomLinearDistance(a.name,TARGET_ROOM)-Game.map.getRoomLinearDistance(b.name,TARGET_ROOM)).find(room=>routeFor(room));
    if (home) StationObserver.requestRoom(TARGET_ROOM,home.name,true);
}

function avoidPortals(room,matrix) {
    for(const p of portalPositions(room)) matrix.set(p.pos.x,p.pos.y,255);
    return matrix;
}
function moveLocal(creep,target,rangeGoal) {
    creep.moveTo(target,{range:rangeGoal,maxRooms:1,maxOps:600,reusePath:3,costCallback:(name,matrix)=>avoidPortals(creep.room,matrix)});
}
function dodge(creep,enemies,waitingForPickup) {
    const threats=enemies.filter(e=>(e.getActiveBodyparts(ATTACK)>0 && creep.pos.inRangeTo(e,2))
        || (waitingForPickup && e.getActiveBodyparts(RANGED_ATTACK)>0 && creep.pos.inRangeTo(e,3)));
    if (!threats.length) return 0;
    const flee=PathFinder.search(creep.pos,threats.map(e=>({pos:e.pos,range:waitingForPickup?4:3})),{flee:true,maxRooms:1,maxOps:400,
        roomCallback:()=>avoidPortals(creep.room,new PathFinder.CostMatrix())});
    if (!flee.path.length) return -1;
    creep.move(creep.pos.getDirectionTo(flee.path[0]));
    return 1;
}
function followRoute(creep, route, direction) {
    const index=route.indexOf(creep.room.name), next=index>=0 && route[index+direction];
    if (!next) return false;
    const exit=Game.map.findExit(creep.room.name,next);
    if (exit < 0) return false;
    const edge=creep.pos.findClosestByRange(exit);
    if (!edge) return false;
    if (creep.pos.isEqualTo(edge)) creep.move(exit);
    else moveLocal(creep,edge,0);
    return true;
}
function returnHome(creep, task) {
    if (Game.shard.name!==TARGET_SHARD) return; // never chase or use a portal to recover
    if (creep.room.name!==task.route[0]) { followRoute(creep,task.route,-1); return; }
    if (!creep.store.isEmpty()) {
        const target=[creep.room.storage,creep.room.terminal].find(s=>s?.my && s.store.getFreeCapacity()>0);
        const resource=Object.keys(creep.store).find(r=>creep.store[r]>0);
        if (target && resource && creep.transfer(target,resource)===ERR_NOT_IN_RANGE) moveLocal(creep,target,1);
        return;
    }
    creep.popTask().addTask(UtilsTask.taskData("recycleCreep"));
}
function inspectLoot(op,room) {
    const shot=op.lastShot;
    if (!shot || Game.time-shot.tick>15) return;
    return room.lookForAt(LOOK_STRUCTURES,shot.x,shot.y).find(s=>s.structureType===STRUCTURE_CONTAINER
        && !shot.previous.includes(s.id) && s.store?.[op.resource]>0);
}

Creep.prototype.npcConvoyIntercept = function () {
    const task=this.lastTask(), op=Memory.npcConvoy?.op;
    if (task.kind==="fighter" && this.hits<this.hitsMax) this.heal(this);
    if (!op || op.group!==task.group || op.returning || !enabled() || !rcl8(Game.rooms[task.route[0]])
        || MIN_CPU || this.ticksToLive <= RETURN_FLOOR+50*(task.route.length-1)) {
        if (op?.group===task.group) op.returning=true;
        return returnHome(this,task);
    }
    const isFighter=task.kind==="fighter";
    if (!fullyBoosted(this,isFighter?FIGHTER:HAULER)) { op.returning=true; return returnHome(this,task); }
    if (Game.time>=op.deadline && !op.loot) { op.returning=true; return returnHome(this,task); }
    const lastSafe=task.route[task.route.length-2];
    if (!isFighter) {
        if (!this.store.isEmpty()) { op.returning=true; return returnHome(this,task); }
        if (!op.loot && !Game.creeps[op.fighter] && Game.time-op.start>=5) { op.returning=true; return returnHome(this,task); }
        if (this.room.name===lastSafe) op.staged=true;
        const targetRoom=Game.rooms[TARGET_ROOM];
        if (!op.loot || !targetRoom || hostileCreeps(targetRoom).length || dangerousRoom(targetRoom,op.group)) {
            if (this.room.name===TARGET_ROOM) { op.returning=true; return returnHome(this,task); }
            if (!op.staged) followRoute(this,task.route,1);
            return;
        }
        if (this.room.name!==TARGET_ROOM) { followRoute(this,task.route,1); return; }
        const stash=Game.getObjectById(op.loot);
        if (!stash || stash.structureType!==STRUCTURE_CONTAINER || !(stash.store?.[op.resource]>0)) { op.returning=true; return; }
        if (this.withdraw(stash,op.resource)===ERR_NOT_IN_RANGE) moveLocal(this,stash,1);
        return;
    }
    if (!op.hauler || !Game.creeps[op.hauler]) { if (Game.time-op.start>=5) op.returning=true; return; }
    if (this.room.name!==TARGET_ROOM) { if (op.staged) followRoute(this,task.route,1); return; }
    const room=this.room;
    if (this.hits<this.hitsMax*0.65 || dangerousRoom(room,op.group)) { op.returning=true; return returnHome(this,task); }
    const cargo=Game.getObjectById(op.target);
    if (!cargo || cargo.pos.roomName!==TARGET_ROOM) {
        if (!op.loot) op.loot=inspectLoot(op,room)?.id;
        if (!op.loot || !Game.getObjectById(op.loot) || Game.time>op.deadline+120) op.returning=true;
        else if (dodge(this,hostileCreeps(room),true)<0) op.returning=true;
        return;
    }
    const enemies=hostileCreeps(room);
    if (convoyGroup(cargo)!==op.group || !withinCombatBudget(cargo,enemies)) { op.returning=true; return returnHome(this,task); }
    if (this.pos.inRangeTo(cargo,3) && this.rangedAttack(cargo)===OK) {
        op.lastShot={tick:Game.time,x:cargo.pos.x,y:cargo.pos.y,previous:cargo.pos.lookFor(LOOK_STRUCTURES).filter(s=>s.structureType===STRUCTURE_CONTAINER).map(s=>s.id)};
    }
    const moved=dodge(this,enemies,false);
    if (moved<0) { op.returning=true; return returnHome(this,task); }
    if (!moved && !this.pos.inRangeTo(cargo,3)) moveLocal(this,cargo,3);
};

global.StrategyNpcConvoy = {enabled,watches,recordObservation,exec};
