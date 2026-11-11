/**
 * Keeper hot path regression checks: do not repeatedly probe an empty room for
 * construction sites or look up links / occupancy while still en route, while
 * preserving harvest, overflow, withdrawal, and maintenance priorities.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceCode = fs.readFileSync(path.join(__dirname, "..", "modules/station_sources.js"), "utf8");
if (!Array.prototype.head) {
    Object.defineProperty(Array.prototype, "head", {
        value: function () { return this.length ? this[0] : undefined; },
        enumerable: false, configurable: true, writable: true,
    });
}

function makeContext() {
    const objects = Object.create(null);
    const ctx = {
        OK: 0, ERR_NOT_IN_RANGE: -9, ERR_NO_PATH: -2, ERR_NO_BODYPART: -12,
        MOVE: "move", WORK: "work", CARRY: "carry", ATTACK: "attack", HEAL: "heal",
        TOUGH: "tough", RANGED_ATTACK: "ranged_attack", CLAIM: "claim",
        LOOK_CREEPS: "creeps", LOOK_POWER_CREEPS: "powerCreeps", LOOK_ENERGY: "energy",
        LOOK_TOMBSTONES: "tombstones", RESOURCE_ENERGY: "energy", RESOURCE_OPS: "ops",
        RESOURCE_POWER: "power", STRUCTURE_KEEPER_LAIR: "keeperLair",
        STRUCTURE_INVADER_CORE: "invaderCore", STRUCTURE_RAMPART: "rampart",
        STRUCTURE_CONTAINER: "container", STRUCTURE_EXTENSION: "extension",
        STRUCTURE_SPAWN: "spawn", STRUCTURE_TOWER: "tower", STRUCTURE_STORAGE: "storage",
        STRUCTURE_TERMINAL: "terminal", STRUCTURE_LINK: "link", STRUCTURE_LAB: "lab",
        STRUCTURE_FACTORY: "factory", STRUCTURE_EXTRACTOR: "extractor",
        STRUCTURE_POWER_BANK: "powerBank", STRUCTURE_POWER_SPAWN: "powerSpawn",
        FIND_HOSTILE_CREEPS: 101, FIND_MY_CREEPS: 102, FIND_HOSTILE_STRUCTURES: 103,
        FIND_SOURCES: 104, FIND_MY_STRUCTURES: 105, FIND_SOURCES_ACTIVE: 106,
        FIND_DROPPED_RESOURCES: 107, FIND_TOMBSTONES: 108, FIND_DEPOSITS: 109,
        FIND_STRUCTURES: 110, FIND_CONSTRUCTION_SITES: 111, FIND_MINERALS: 112,
        PWR_REGEN_SOURCE: 13,
        console: { log() {} }, isSaveCpu: false, MIN_CPU: false,
        Memory: { rooms: {} },
        Game: {
            time: 1000, cpu: { bucket: 10000 }, shard: { name: "shard3" }, creeps: {},
            getObjectById(id) { return objects[id] || null; },
            map: { getRoomLinearDistance: () => 1 },
        },
        Creep: function () {},
        RoomPosition: function (x, y, roomName) { this.x = x; this.y = y; this.roomName = roomName; },
        StationMineral: { stationName: "stationMineral" },
        StationHive: { trySpawn: () => undefined },
        UtilsTask: {
            task: (t, taskName) => ({ id: t && t.id, taskName }),
            taskData: taskName => ({ taskName }),
            taskOutView: (id, roomName, x, y, taskName) => ({ id, roomName, x, y, taskName }),
        },
        PathFinder: { search: () => ({ path: [] }) },
        _: { values: o => Object.keys(o || {}).map(k => o[k]), keys: o => Object.keys(o || {}) },
    };
    ctx.global = ctx;
    vm.runInNewContext(sourceCode, ctx, { filename: "station_sources.js" });
    return { ctx, objects };
}

function makePos(x, y, roomName = "W1N1", lookFor = () => []) {
    return {
        x, y, roomName,
        isEqualTo(other) { other = other.pos || other; return this.x === other.x && this.y === other.y && this.roomName === other.roomName; },
        isNearTo(other) {
            other = other.pos || other;
            return this.roomName === other.roomName
                && Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)) <= 1;
        },
        lookFor(type) { return lookFor(type); },
    };
}

function makeFixture({
    x = 10, y = 10, ttl = 90, freeCapacity = 0, energy = 100,
    bucket = 10000, containerEnergy = 0, containerHits = 1000, linkEnergy = 800,
    linkHits = 1000, link2Energy, containerOccupied = false, sites = [], sourceX = 11, sourceY = 10,
    containerCap = 2000,
} = {}) {
    const { ctx, objects } = makeContext();
    ctx.Game.cpu.bucket = bucket;
    let constructionSiteReads = 0;
    let containerLookCalls = 0;
    const room = {
        name: "W1N1",
        get constructionSite() { constructionSiteReads++; return sites; },
    };
    const creepActions = [];
    const lookFor = () => {
        containerLookCalls++;
        return containerOccupied ? [{}] : [];
    };
    const containerPos = makePos(10, 10, "W1N1", lookFor);
    const source = {
        id: "src", pos: makePos(sourceX, sourceY), energy: 3000, energyCapacity: 3000,
        ticksToRegeneration: 300,
    };
    const container = {
        id: "container", pos: containerPos, hits: containerHits, hitsMax: 1000,
        store: {
            energy: containerEnergy,
            getUsedCapacity(res) { return res === "energy" ? this.energy : 0; },
            getFreeCapacity(res) { return res === "energy" ? Math.max(0, containerCap - this.energy) : 0; },
        },
    };
    const link = {
        id: "link", hits: linkHits, hitsMax: 1000,
        store: { energy: linkEnergy, getUsedCapacity(res) { return res === "energy" ? this.energy : 0; } },
    };
    const link2 = {
        id: "link2", hits: 1000, hitsMax: 1000,
        store: { energy: link2Energy === undefined ? 0 : link2Energy, getUsedCapacity(res) { return res === "energy" ? this.energy : 0; } },
    };
    const site = sites[0];
    objects.src = source;
    objects.container = container;
    objects.link = link;
    objects.link2 = link2;
    if (site) objects[site.id] = site;
    let lookupCalls = [];
    const originalGet = ctx.Game.getObjectById;
    ctx.Game.getObjectById = id => { lookupCalls.push(id); return originalGet(id); };
    ctx.Memory.rooms.W1N1 = {
        stationSources: {
            src: { container: "container", link: "link", link2: link2Energy === undefined ? undefined : "link2" },
        },
    };

    const creep = {
        room, pos: makePos(x, y), ticksToLive: ttl, memory: {},
        store: {
            energy: 100 - freeCapacity,
            getFreeCapacity: () => freeCapacity,
        },
        headTask: () => ({ id: "src", roomName: "W1N1" }),
        moveTo(target, opts) { creepActions.push(["moveTo", target.id, opts.range]); },
        harvest(target) { creepActions.push(["harvest", target.id]); },
        build(target) { creepActions.push(["build", target.id]); },
        repair(target) { creepActions.push(["repair", target.id]); },
        transfer(target, resource) { creepActions.push(["transfer", target.id, resource]); },
        withdraw(target, resource) { creepActions.push(["withdraw", target.id, resource]); },
        pickup(target) { creepActions.push(["pickup", target.id]); },
        getPartCnt(type) { return type === "work" ? 2 : 1; },
    };
    // A creep on the container is the normal keeper working position.
    if (x === 10 && y === 10) container.pos.x = 10;
    return {
        ctx, creep, room, source, container, link, link2, site,
        creepActions, get constructionSiteReads() { return constructionSiteReads; },
        get containerLookCalls() { return containerLookCalls; }, get lookupCalls() { return lookupCalls; },
        setSites(next) { sites = next; if (next[0]) objects[next[0].id] = next[0]; },
        run() { ctx.Creep.prototype.harvestEnergyKeeper.call(creep); },
    };
}

// En route: keep issuing the movement intent and defer link lookups until the
// keeper reaches its work position. Occupancy checks remain immediate because
// they decide whether to target the container or fall back to the source.
{
    const f = makeFixture({ x: 2, y: 2, linkEnergy: 700, link2Energy: 100 });
    f.run();
    assert.deepEqual(f.creepActions, [["moveTo", "container", 0]], "keeper continues toward its container");
    assert.equal(f.containerLookCalls, 2, "container occupancy is still checked to preserve fallback behavior");
    assert.ok(!f.lookupCalls.includes("link") && !f.lookupCalls.includes("link2"),
        "link and link2 lookups are deferred until the keeper reaches its work position");

    f.creep.pos = makePos(9, 10);
    f.run();
    assert.equal(f.containerLookCalls, 4, "occupancy remains checked as the keeper arrives");
    assert.ok(f.creepActions.some(a => a[0] === "moveTo"), "movement intent remains active on the last step");
}

// An occupied container two tiles away must not delay harvesting when the
// keeper is already adjacent to the source; this was the old fallback's key edge.
{
    const f = makeFixture({ x: 8, y: 10, containerOccupied: true, sourceX: 9, sourceY: 10 });
    f.run();
    assert.equal(f.containerLookCalls, 1, "occupied container is detected immediately");
    assert.ok(f.creepActions.some(a => a[0] === "harvest" && a[1] === "src"),
        "source-adjacent keeper keeps harvesting instead of moving toward the occupied container");
    assert.ok(!f.creepActions.some(a => a[0] === "moveTo"),
        "occupied-container source fallback is preserved");
}

// Empty room scans are shared within a tick, but a construction site appearing
// on the next tick is immediately found and built (no Memory negative cache).
{
    const f = makeFixture();
    const secondKeeper = { ...f.creep, memory: {}, ticksToLive: 99, pos: makePos(10, 10) };
    f.run();
    f.ctx.Creep.prototype.harvestEnergyKeeper.call(secondKeeper);
    assert.equal(f.constructionSiteReads, 1, "two keepers share one empty room lookup in a tick");

    f.ctx.Game.time++;
    const newSite = { id: "site-new", pos: makePos(11, 10) };
    f.setSites([newSite]);
    f.run();
    assert.equal(f.constructionSiteReads, 2, "negative cache expires at the next tick");
    assert.ok(f.creepActions.some(a => a[0] === "build" && a[1] === "site-new"),
        "newly observed site is not hidden by the prior empty result");
}

// Harvest cadence is unchanged: normal bucket harvests each eligible tick,
// while the low-bucket guard harvests on even TTL ticks only.
{
    const normal = makeFixture({ ttl: 91 });
    normal.run();
    assert.equal(normal.creepActions.filter(a => a[0] === "harvest").length, 1,
        "normal bucket keeps per-tick harvesting cadence");

    const lowEven = makeFixture({ ttl: 90, bucket: 4000 });
    lowEven.run();
    assert.equal(lowEven.creepActions.filter(a => a[0] === "harvest").length, 1,
        "low bucket still harvests on even TTL ticks");

    const lowOdd = makeFixture({ ttl: 91, bucket: 4000 });
    lowOdd.run();
    assert.equal(lowOdd.creepActions.filter(a => a[0] === "harvest").length, 0,
        "low bucket skips odd TTL ticks");
}

// A full keeper still transfers to an available link and withdraws backlog
// from the container above one CARRY part's threshold.
{
    const f = makeFixture({ ttl: 90, freeCapacity: 0, containerEnergy: 100, linkEnergy: 700 });
    f.run();
    assert.ok(f.creepActions.some(a => a[0] === "transfer" && a[1] === "link"),
        "energy is handed to a non-full link when near full");
    assert.ok(f.creepActions.some(a => a[0] === "withdraw" && a[1] === "container"),
        "keeper withdraws container backlog above its carry threshold");

    const twinLink = makeFixture({ ttl: 90, freeCapacity: 0, containerEnergy: 100, linkEnergy: 800, link2Energy: 100 });
    twinLink.run();
    assert.ok(twinLink.creepActions.some(a => a[0] === "transfer" && a[1] === "link2"),
        "full primary link still redirects transfer to the less-full secondary link");
}

// Maintenance priority remains build > container repair > link repair.
{
    const site = { id: "site-build", pos: makePos(11, 10) };
    const buildFirst = makeFixture({ sites: [site], containerHits: 500, linkHits: 500 });
    buildFirst.run();
    assert.ok(buildFirst.creepActions.some(a => a[0] === "build" && a[1] === "site-build"),
        "nearby construction site keeps highest maintenance priority");
    assert.ok(!buildFirst.creepActions.some(a => a[0] === "repair"),
        "building suppresses lower-priority repairs");

    const containerFirst = makeFixture({ containerHits: 500, linkHits: 500 });
    containerFirst.run();
    assert.ok(containerFirst.creepActions.some(a => a[0] === "repair" && a[1] === "container"),
        "damaged container is repaired before link");
    assert.ok(!containerFirst.creepActions.some(a => a[0] === "repair" && a[1] === "link"),
        "container repair suppresses lower-priority link repair");

    const linkFallback = makeFixture({ containerHits: 1000, linkHits: 500 });
    linkFallback.run();
    assert.ok(linkFallback.creepActions.some(a => a[0] === "repair" && a[1] === "link"),
        "link repair remains fallback when container is healthy");
}

// A saturated mine must not keep harvesting: a keeper standing on its container
// spills what it cannot hold into that container, and once the container is full
// the spill lands on the ground and decays (E53S21 measured a steady 26/tick).
// The gate is deliberately narrow: any single free sink keeps the harvest going.
{
    const saturated = makeFixture({
        ttl: 90, freeCapacity: 0, containerEnergy: 2000, containerCap: 2000, linkEnergy: 800,
    });
    saturated.run();
    assert.ok(!saturated.creepActions.some(a => a[0] === "harvest"),
        "full keeper stops harvesting when its store, the container and the source link are all full");
    assert.ok(!saturated.creepActions.some(a => a[0] === "transfer"),
        "no transfer is attempted into a full source link");

    const containerRoom = makeFixture({
        ttl: 90, freeCapacity: 0, containerEnergy: 1500, containerCap: 2000, linkEnergy: 800,
    });
    containerRoom.run();
    assert.ok(containerRoom.creepActions.some(a => a[0] === "harvest"),
        "container headroom absorbs the spill, so harvesting continues");

    const linkRoom = makeFixture({
        ttl: 90, freeCapacity: 0, containerEnergy: 2000, containerCap: 2000, linkEnergy: 700,
    });
    linkRoom.run();
    assert.ok(linkRoom.creepActions.some(a => a[0] === "harvest"),
        "a non-full source link keeps harvesting alive even with a full container");

    const storeRoom = makeFixture({
        ttl: 90, freeCapacity: 50, containerEnergy: 2000, containerCap: 2000, linkEnergy: 800,
    });
    storeRoom.run();
    assert.ok(storeRoom.creepActions.some(a => a[0] === "harvest"),
        "the keeper's own free capacity is a valid sink: the gate must not fire early");
}

console.log("keeper cpu checks passed");
