// 塔的目标选择：必须打「打得死」的那只敌对爬，而不是无条件喂给奶妈。
//
// 现场（2026-11-25 shard2 E56S29，RCL4、只有 1 座塔）：
//   · Invader A：25×HEAL，自愈 300 血/tick，站在离塔 21~30 格 ⇒ 单塔每 tick 只有
//     150 伤（WarDamageCal.calTowerDamage 对 >20 格一律按 150）⇒ **永远打不死**
//   · Invader B：2×ATTACK + 3×RANGED_ATTACK，0 HEAL，同一片区域
//   原实现「有奶妈就打奶妈」是无条件分支，整房塔每 tick 都在喂那个不死单位
//   （A 的血在 5,000/4,850 之间摆），B 一滴血不掉，把本房 4 只爬打到带伤
//   （2,400→400 / 1,000→400）。
//
// 本测试钉住三件事：
//   1. 单塔打不穿的奶妈 ⇒ 改打旁边那只打得死的攻击手；
//   2. 塔够多、打得穿奶妈 ⇒ 仍然先打奶妈（原意图不许回退）；
//   3. 全场只有打不死的目标 ⇒ 不许「什么都不打」（退回老逻辑照打）。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "modules/station_tower.js"), "utf8");

// 项目在游戏里加载了 lodash，.head()/.minBy() 是它的 Array 扩展。本测试的桩数组
// 建在宿主 realm、模块代码跑在 VM realm，两边的 Array.prototype 都要补上等价物
//（否则 VM 里定义的那份对宿主数组不可见）。
for (const [name, fn] of Object.entries({
    head: function () { return this.length ? this[0] : undefined; },
    minBy: function (f) {
        let best, bestV;
        this.forEach(x => { const v = f(x); if (best === undefined || v < bestV) { best = x; bestV = v; } });
        return best;
    },
})) {
    if (!Array.prototype[name]) {
        Object.defineProperty(Array.prototype, name, { value: fn, enumerable: false, configurable: true, writable: true });
    }
}

const HEAL = "heal";
const ATTACK = "attack";
const RANGED_ATTACK = "ranged_attack";

/**
 * 敌对爬桩。
 * @param {object} o {id, hits, hitsMax, heal, attack, ranged, owner, x, y}
 */
function hostile(o) {
    const counts = { [HEAL]: o.heal || 0, [ATTACK]: o.attack || 0, [RANGED_ATTACK]: o.ranged || 0 };
    const pos = {
        x: o.x || 0,
        y: o.y || 0,
        isNearTo(t) { return Math.max(Math.abs(this.x - t.x), Math.abs(this.y - t.y)) <= 1; },
    };
    return {
        id: o.id,
        hits: o.hits,
        hitsMax: o.hitsMax || 5000,
        body: [],
        owner: o.owner === null ? null : { username: o.owner || "SomePlayer" },
        pos,
        getActiveBodyparts: t => counts[t] || 0,
        // 自愈：12 血/tick × HEAL 部件
        possibleHealDamage: () => (counts[HEAL] || 0) * 12,
        // 威胁：近战 30 + 远程（mass, 距离 3）每部件 4
        possibleDamage: () => (counts[ATTACK] || 0) * 30 + (counts[RANGED_ATTACK] || 0) * 4,
    };
}

/**
 * @param {object} o {towers: 塔数量, towerDamage: 每座塔对目标的单 tick 伤害, hostiles: []}
 * @returns {string[]} 每次 attack 的目标 id（按调用顺序）
 */
function runTower(o) {
    const attacked = [];
    const towers = [];
    for (let i = 0; i < (o.towers || 1); i++) {
        towers.push({
            id: "t" + i,
            _used: false,
            heal: () => {},
            repair: () => {},
            attack: c => { attacked.push(c.id); return 0; },
            getDamageTo: () => o.towerDamage,
        });
    }
    const room = {
        name: "E56S29",
        memory: {},
        tower: towers,
        getHostileCreeps: () => o.hostiles,
        getStructures: () => [],
        hashCode: () => 1,
        find: () => [],
    };
    const ctx = {
        console,
        global: null,
        Game: { time: 100000, getObjectById: () => null, _injuredRoomTick: {} },
        Memory: { rooms: { E56S29: {} } },
        Creep: function () {},
        StructureTower: function () {},
        FIND_MY_CREEPS: "FIND_MY_CREEPS",
        FIND_MY_POWER_CREEPS: "FIND_MY_POWER_CREEPS",
        LOOK_STRUCTURES: "structures",
        LOOK_CONSTRUCTION_SITES: "constructionSite",
        STRUCTURE_WALL: "constructedWall",
        STRUCTURE_RAMPART: "rampart",
        STRUCTURE_ROAD: "road",
        HEAL, ATTACK,
        isCpuFeatureEnabled: () => false,
        StationDefense: { checkSafeMode: () => {} },
        Utils: { decodePosArray: () => [], randomGet: a => a[0] },
        WarDamageCal: { calTowerDamage: () => 600 },
        _: { values: x => Object.values(x || {}), keys: x => Object.keys(x || {}) },
    };
    ctx.global = ctx;
    vm.runInNewContext(`
Array.prototype.head = function () { return this.length ? this[0] : undefined; };
Array.prototype.minBy = function (fn) {
    let best, bestV;
    this.forEach(x => { let v = fn(x); if (best === undefined || v < bestV) { best = x; bestV = v; } });
    return best;
};
`, ctx);
    vm.runInNewContext(source, ctx, { filename: "station_tower.js" });
    ctx.StationTower.update(room);
    ctx.StationTower.exec(room);
    return attacked;
}

// ── 1. 现场复现：单塔 150 伤 vs 25-HEAL 奶妈（自愈 300）⇒ 必须改打攻击手 ──
{
    // 实测站位：奶妈 (42,39)、攻击手 (42,36)，相距 3 格 ⇒ 奶妈够不着，攻击手真的会掉血
    const healer = hostile({ id: "healer", hits: 5000, hitsMax: 5000, heal: 25, owner: "Invader", x: 42, y: 39 });
    const attacker = hostile({ id: "attacker", hits: 5000, hitsMax: 5000, attack: 2, ranged: 3, owner: "Invader", x: 42, y: 36 });
    const attacked = runTower({ towers: 1, towerDamage: 150, hostiles: [healer, attacker] });
    assert.equal(attacked.length, 1, "塔必须开火");
    assert.equal(attacked[0], "attacker",
        "打不穿 25-HEAL 奶妈时不许继续喂它，必须改打旁边打得死的攻击手（旧代码这里打的是 healer）");
}

// ── 2. 塔够多（6×600=3,600 > 300 自愈）⇒ 仍然先打奶妈，原意图不许回退 ──
{
    const healer = hostile({ id: "healer", hits: 5000, hitsMax: 5000, heal: 25, owner: "Invader", x: 42, y: 39 });
    const attacker = hostile({ id: "attacker", hits: 5000, hitsMax: 5000, attack: 2, ranged: 3, owner: "Invader", x: 42, y: 36 });
    const attacked = runTower({ towers: 6, towerDamage: 600, hostiles: [healer, attacker] });
    assert.equal(attacked[0], "healer", "打得穿的奶妈仍是第一目标（奶妈不死，坦克被奶住永远打不掉）");
}

// ── 3. 全场只有打不死的目标 ⇒ 退回老逻辑（不许因为闸门新增而一个目标都不选、更不许抛错） ──
{
    // 带伤（4,850/5,000）才走得到老逻辑的「补刀 head」分支；满血的打不死目标
    // 原本就只落在每 15 tick 一次的随机扫射里 —— 那是既有行为，本改动不碰。
    const healer = hostile({ id: "healer", hits: 4850, hitsMax: 5000, heal: 25 });
    const attacked = runTower({ towers: 1, towerDamage: 150, hostiles: [healer] });
    assert.equal(attacked.length, 1, "没有能打死的目标时也必须开火（旧逻辑保留）");
    assert.equal(attacked[0], "healer", "唯一的敌人就是那只奶妈，只能打它");
}

// ── 4. 无奶妈、两只攻击手 ⇒ 先打威胁大的那只 ──
{
    const small = hostile({ id: "small", hits: 3000, hitsMax: 3000, attack: 1 });
    const big = hostile({ id: "big", hits: 5000, hitsMax: 5000, attack: 4, ranged: 2 });
    const attacked = runTower({ towers: 1, towerDamage: 150, hostiles: [small, big] });
    assert.equal(attacked[0], "big", "没有奶妈时按威胁（对我们造成的伤害）排序，不是按残血比例");
}

// ── 5. 奶妈贴身奶着攻击手（有效自愈 300 > 单塔 150）⇒ NPC 也打不穿，必须停火省电 ──
//
// 实测后果：E56S29 的塔在 100 tick 内从 730 打到 0，15,000 伤害全被奶回去，
// 房间彻底没有防御；停下来存电，等它们走进 ≤5 格（600 伤）才打才是正解。
{
    const healer = hostile({ id: "healer", hits: 5000, hitsMax: 5000, heal: 25, owner: "Invader", x: 10, y: 10 });
    const attacker = hostile({ id: "attacker", hits: 5000, hitsMax: 5000, attack: 2, ranged: 3, owner: "Invader", x: 11, y: 10 });
    const attacked = runTower({ towers: 1, towerDamage: 150, hostiles: [healer, attacker] });
    assert.equal(attacked.length, 0, "NPC 全体打不穿时必须停火，不许把电打空（旧代码这里每 tick 都在打 healer）");
}

// ── 6. 打不穿的是**玩家**部队 ⇒ 保留削血（逼奶妈贴身、压缩机动），不许停火 ──
{
    const healer = hostile({ id: "healer", hits: 4850, hitsMax: 5000, heal: 25, owner: "EnemyPlayer", x: 10, y: 10 });
    const attacker = hostile({ id: "attacker", hits: 5000, hitsMax: 5000, attack: 2, ranged: 3, owner: "EnemyPlayer", x: 11, y: 10 });
    const attacked = runTower({ towers: 1, towerDamage: 150, hostiles: [healer, attacker] });
    assert.equal(attacked.length, 1, "玩家部队打不穿也照打（削血有意义）");
}

console.log("tower target breakable checks passed");
