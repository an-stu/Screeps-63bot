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

// Independent, opt-in salvage. This never starts the E50S30 intercept or
// attacks the convoy: the scout confirms actual expiry and identifiable loot.
const SALVAGE_ORIGIN = "shard3";
const SALVAGE_TARGET = "shard2";
const SALVAGE_ROOM = "E40S30";
const SALVAGE_HOME = "E41S32";
const SALVAGE_ROUTE = [SALVAGE_HOME,"E40S32","E40S31",SALVAGE_ROOM];
const SALVAGE_OUT = {shard:SALVAGE_ORIGIN,roomName:SALVAGE_ROOM,x:14,y:8};
const SALVAGE_BACK = {shard:SALVAGE_TARGET,roomName:SALVAGE_ROOM,x:30,y:37};
const SALVAGE_WAIT = [[11,11],[10,12],[12,11]];
const SALVAGE_RETURN_TTL = 220;

function salvageLoot(room, task) {
    return room.find(FIND_TOMBSTONES).filter(t => task.cargo.includes(t.creep?.name)
        && t.store?.[task.resource] > 0);
}

function salvageReady(data) {
    const cfg = Memory.npcConvoySalvage;
    if (Game.shard.name !== SALVAGE_ORIGIN || !cfg || cfg.id !== data?.id
        || data.shard !== SALVAGE_TARGET || !(data.tick >= cfg.deathTick)
        || !Array.isArray(data.available) || !data.available.length
        || data.available.some(name => !cfg.cargo.includes(name))) return false;
    if (!cfg.ready) cfg.ready = {tick:data.tick, seenAt:Game.time, available:data.available};
    return true;
}

function salvageReadyAcknowledged(request) {
    const data = request?.data;
    if (Game.shard.name !== SALVAGE_TARGET || !data?.scout) return;
    const task = Game.creeps[data.scout]?.lastTask();
    if (task?.taskName === "npcConvoySalvage" && task.slot === "scout"
        && task.id === data.id && task.readySent !== undefined) task.readyAcknowledged = true;
}

function validSalvage(cfg) {
    return !!(cfg && typeof cfg.id === "string" && /^[a-f\d]{24}$/.test(cfg.id)
        && Number.isSafeInteger(cfg.deathTick) && Number.isSafeInteger(cfg.launchUntil)
        && typeof cfg.resource === "string" && Array.isArray(cfg.cargo)
        && cfg.cargo.length > 0 && cfg.cargo.length <= SALVAGE_WAIT.length
        && new Set(cfg.cargo).size === cfg.cargo.length
        && cfg.cargo.every(n => typeof n === "string" && n.startsWith("creep"+cfg.id+"_")));
}

function execSalvage() {
    const cfg = Memory.npcConvoySalvage;
    if (Game.shard.name !== SALVAGE_ORIGIN || !validSalvage(cfg) || Game.time > cfg.launchUntil
        || !isCpuFeatureEnabled("crossShard") || MIN_CPU) return;
    const room = Game.rooms[SALVAGE_HOME];
    if (!rcl8(room) || !room.storage) return;
    const units = cfg.units || (cfg.units = {});
    for (const slot of ["scout",...cfg.cargo]) {
        if (units[slot] || !room.spawn.some(s => !s.spawning && !room.spawnedMap?.[s.id] && s.isActive())) continue;
        const scout = slot === "scout";
        const body = scout ? [MOVE] : materialize(HAULER);
        if ((room.currentEnergyAvailable ?? room.energyAvailable) < Utils.getBodyEnergyNeed(body)) continue;
        const boost = scout ? undefined : minerals(HAULER);
        if (boost && (!global.StationLab || !StationLab.boostAble(room,boost))) continue;
        const task = UtilsTask.taskData("npcConvoySalvage",undefined,{
            id:cfg.id, slot, cargo:cfg.cargo, resource:cfg.resource, deathTick:cfg.deathTick,
        });
        const boostTasks = boost ? StationLab.generatorBoostResTask(boost,room) : [];
        room.spawnFailure = false;
        const name = StationHive.trySpawn(room,room.name,body,"npcSalvage",[task,...boostTasks]);
        if (name) units[slot] = name;
    }
}

function salvageCross(creep, from, destination) {
    const portal = portalPositions(creep.room).find(p => p.pos.x === from.x && p.pos.y === from.y
        && p.destination?.shard === destination);
    if (!portal) return;
    creep.addTask(UtilsTask.taskData("moveCrossShardByPath",undefined,{
        path:[from], expectedDestShard:destination, peaceful:true,
    }));
    creep.execLastTask();
}

function salvageUnboost(creep,task) {
    const room = creep.room;
    const labs = (room.lab || []).filter(lab => lab.my && lab.isActive()
        && !lab.cooldown && !lab._used);
    if (!labs.length) return;
    // Prefer the unboost container so the refunded boost goes straight into
    // the container. Use another lab if the dedicated berth is unavailable.
    const berth = global.StationLab?.getUnboostContainer?.(room);
    const atBerth = berth && creep.pos.isEqualTo(berth);
    const canUseBerth = berth && labs.some(lab => lab.pos.isNearTo(berth));
    if (canUseBerth && !atBerth && !room._salvageBerthClaimed
        && !berth.pos.lookFor(LOOK_CREEPS).length) {
        room._salvageBerthClaimed = true;
        return moveLocal(creep,berth,0);
    }
    const target = labs.find(lab => creep.pos.isNearTo(lab));
    if (!target) return moveLocal(creep,creep.pos.findClosestByRange(labs) || labs[0],1);
    if (target.unboostCreep(creep) === OK) {
        target._used = true;
        task.unboostAt = Game.time;
    }
}

function salvageReturn(creep,task) {
    task.returning = true;
    if (Game.shard.name === SALVAGE_TARGET && creep.room.name === SALVAGE_ROOM) {
        return salvageCross(creep,SALVAGE_BACK,SALVAGE_ORIGIN);
    }
    if (Game.shard.name !== SALVAGE_ORIGIN) return;
    if (creep.room.name !== SALVAGE_HOME) return followRoute(creep,SALVAGE_ROUTE,-1);
    // Unload before changing carry capacity, including any refunded boost
    // picked up on the way out. Only the actual loot counts as delivered.
    const resource = creep.store[task.resource] > 0 ? task.resource
        : Object.keys(creep.store).find(key => typeof creep.store[key] === "number" && creep.store[key] > 0);
    const amount = creep.store[resource] || 0;
    if (amount) {
        const target = [creep.room.storage,creep.room.terminal].find(o => o?.my && o.store.getFreeCapacity(resource) > 0);
        if (!target) return;
        const deliver = Math.min(amount,target.store.getFreeCapacity(resource));
        const result = creep.transfer(target,resource,deliver);
        if (result === ERR_NOT_IN_RANGE) moveLocal(creep,target,1);
        else if (result === OK && resource === task.resource) task.delivered = (task.delivered || 0) + deliver;
        return;
    }
    if (creep.body.some(part => part.boost)) return salvageUnboost(creep,task);
    if (task.unboostAt && !task.checkedBoostDrop) {
        // Containers catch the refund automatically. Pick up any overflow
        // (or the refund from a fallback lab on an ordinary tile).
        const drop = creep.pos.lookFor(LOOK_RESOURCES).find(r => r.resourceType === CARGO_BOOST && r.amount > 0);
        task.checkedBoostDrop = true;
        if (drop && creep.pickup(drop) === OK) return;
    }
    const cfg = Memory.npcConvoySalvage;
    if (cfg?.id === task.id && task.slot !== "scout") {
        (cfg.finished || (cfg.finished = {}))[task.slot] = task.delivered || 0;
        if (task.unboostAt) (cfg.unboosted || (cfg.unboosted = {}))[task.slot] = Game.time;
    }
    creep.popTask().addTask(UtilsTask.taskData("recycleCreep"));
}

Creep.prototype.npcConvoySalvage = function () {
    const task = this.lastTask(), scout = task.slot === "scout", shard = Game.shard.name;
    const cfg = shard === SALVAGE_ORIGIN ? Memory.npcConvoySalvage : undefined;
    if (scout && ((cfg?.ready && cfg.id === task.id)
        || (shard === SALVAGE_TARGET && task.readyAcknowledged))) return this.suicide();
    const scoutAwaitingAck = scout && shard === SALVAGE_TARGET && task.readySent !== undefined;
    if (task.returning || (this.ticksToLive <= SALVAGE_RETURN_TTL && !scoutAwaitingAck)) return salvageReturn(this,task);
    if (shard === SALVAGE_ORIGIN) {
        if (cfg?.id !== task.id || !isCpuFeatureEnabled("crossShard")) return salvageReturn(this,task);
        if (!scout && (!fullyBoosted(this,HAULER) || this.store.getCapacity() < 5000)) {
            // The boost task can pop immediately after issuing the intent.
            // Recheck the next snapshot before rejecting the hauler at home.
            if (this.room.name === SALVAGE_HOME) {
                task.boostCheckStarted ??= Game.time;
                if (Game.time <= task.boostCheckStarted + 2) return;
            }
            return salvageReturn(this,task);
        }
        if (this.room.name !== SALVAGE_ROOM) return followRoute(this,SALVAGE_ROUTE,1);
        if (scout || cfg.ready?.available.includes(task.slot)) return salvageCross(this,SALVAGE_OUT,SALVAGE_TARGET);
        if (cfg.ready) return salvageReturn(this,task);
        const slot = SALVAGE_WAIT[task.cargo.indexOf(task.slot)];
        if (!slot) return salvageReturn(this,task);
        const wait = new RoomPosition(slot[0],slot[1],SALVAGE_ROOM);
        if (!this.pos.isEqualTo(wait)) moveLocal(this,wait,0);
        else if (!cfg.staged?.[task.slot]) (cfg.staged || (cfg.staged = {}))[task.slot] = Game.time;
        return;
    }
    if (shard !== SALVAGE_TARGET || this.room.name !== SALVAGE_ROOM) return;
    const hostiles = hostileCreeps(this.room);
    const safe = Game.time >= task.deathTick && !hostiles.length && !dangerousRoom(this.room);
    if (scout) {
        if (safe && !scoutAwaitingAck) {
            const available = salvageLoot(this.room,task).map(t => t.creep.name);
            if (available.length && ManagerCrossShard.addCrossShardRequest(SALVAGE_ORIGIN,{
                func:"npcConvoySalvageReady",callBack:"npcConvoySalvageReadyAcknowledged",
                data:{id:task.id,shard:SALVAGE_TARGET,tick:Game.time,available,scout:this.name},
            },"npcConvoySalvage:"+task.id)) task.readySent = Game.time;
        }
        if (hostiles.length && dodge(this,hostiles,true) !== 0) return;
        if (task.readySent !== undefined) return;
        const wait = new RoomPosition(24,43,SALVAGE_ROOM);
        if (!this.pos.inRangeTo(wait,1)) moveLocal(this,wait,1);
        return;
    }
    if (!safe || (this.store[task.resource] || 0) > 0) return salvageReturn(this,task);
    const stash = salvageLoot(this.room,task).find(t => t.creep.name === task.slot);
    if (!stash) return salvageReturn(this,task);
    if (this.withdraw(stash,task.resource) === ERR_NOT_IN_RANGE) moveLocal(this,stash,1);
};

global.missionFunc = global.missionFunc || {};
global.missionFunc.npcConvoySalvageReady = salvageReady;
global.missionCallBack = global.missionCallBack || {};
global.missionCallBack.npcConvoySalvageReadyAcknowledged = salvageReadyAcknowledged;
global.StrategyNpcConvoy = {enabled,watches,recordObservation,exec,execSalvage};
