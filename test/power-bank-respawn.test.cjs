/**
 * Power Bank 补员闸门：L1/L2 波次闩锁必须绑在「还有攻击手在打」上，不能永久置真；
 * carrier 补员必须数活着的，不能数累计派过几只。
 *
 * 2026-11-06 线上实测（E55S39 → E57S40 5,29）：
 *   - 窝 2,000,000 血打剩 171,200（8.6%），离 disappearTime 还有 2,521 tick；
 *   - flag.memory: index=1、boostModel=2(BOOST_L1)、L1Boosted=true，
 *     但 attacker / healer 的 id 全都 Game.getObjectById → null（老死）；
 *   - 6 只 PBCarrier 在 (1,26~31) 干等，ttl 只剩 335~482，carrierCnt=6=目标数。
 *   原逻辑：`L1Boosted && ...` 无条件 needSpawn=false ⇒ 后半程再不出兵；
 *   而 pbTeamAlive 把 carrier 算「队伍还在」，直接拿它当闸门也救不了（6 只 carrier 全活着）。
 *   一波 attacker 命 1,500 tick，一个窝要 2,000,000 伤害 —— 一波打不完是常态。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "modules/strategy_powerBank.js"), "utf8");

function load({ time = 1000, alive = [], overrides = {} } = {}) {
    const live = new Set(alive);
    const ctx = {
        console: { log() {} },
        Creep: function () {},
        Game: {
            time,
            flags: {},
            rooms: {},
            getObjectById: id => (live.has(id) ? { id } : null),
        },
        Memory: { creeps: {} },
        FIND_HOSTILE_CREEPS: "hostile",
        FIND_RUINS: "ruins",
        FIND_DROPPED_RESOURCES: "drop",
        RESOURCE_POWER: "power",
        RESOURCE_ENERGY: "energy",
        ATTACK: "attack",
        HEAL: "heal",
        RANGED_ATTACK: "ranged_attack",
        TOUGH: "tough",
        MOVE: "move",
        CARRY: "carry",
        WORK: "work",
        global: null,
    };
    Object.assign(ctx, overrides);
    ctx.global = ctx;
    vm.runInNewContext(src, ctx, { filename: "strategy_powerBank.js" });
    return ctx.StrategyPowerBank;
}

function flag(memory) {
    return { name: "powerBank_E55S39_E57S40_5_29", memory };
}

// ① 攻击手 + 奶都老死、只有 carrier 活着 → 「队伍」假活，但**不能**再挡补员
{
    const S = load({ alive: ["c1", "c2"] });
    const f = flag({
        index: 1, boostModel: 2, L1Boosted: true,
        attacker: { 0: "a0" }, healer: { 0: "h0" }, carrier: ["c1", "c2"],
    });
    assert.equal(S.pbFightersAlive(f), false, "attacker/healer 都死了 → 没有战士在打");
    assert.equal(S.pbWaveBlocked(f), false,
        "L1Boosted 不能永久闩锁：战士全死时必须允许补一波（这正是线上停摆的那一步）");
    assert.equal(S.pbTeamAlive(f), true, "对照组：pbTeamAlive 因为 carrier 还活着而返回 true（所以它不能当闸门）");
}

// ② 有攻击手在打 → 不许重复派（避免同屏堆两波、白烧 boost）
{
    const S = load({ alive: ["a1"] });
    const f = flag({ index: 1, boostModel: 2, L1Boosted: true, attacker: { 0: "a1" } });
    assert.equal(S.pbFightersAlive(f), true);
    assert.equal(S.pbWaveBlocked(f), true, "波次还在打就不该再生");
}

// ③ 只有 healer 活着也算在打（先补 attacker 之前不能算空）
{
    const S = load({ alive: ["h1"] });
    const f = flag({ index: 1, boostModel: 2, L1Boosted: true, attacker: { 0: "a9" }, healer: { 0: "h1" } });
    assert.equal(S.pbWaveBlocked(f), true, "healer 还活着 → 视为这一波未结束");
}

// ④ L2 走同一套语义
{
    const S = load({ alive: ["c1"] });
    const f = flag({ index: 1, boostModel: 3, L2Boosted: true, attacker: { 0: "a0" }, carrier: ["c1"] });
    assert.equal(S.pbWaveBlocked(f), false, "L2 闩锁也不能永久置真");
}

// ⑤ L1 之外的四波上限保持原样（不看死活）
{
    const S = load({ alive: [] });
    assert.equal(S.pbWaveBlocked(flag({ index: 5, boostModel: 0 })), true, "index>3 仍然停派");
    assert.equal(S.pbWaveBlocked(flag({ index: 5, boostModel: 3, beingAttack: true })), true,
        "旧版遗留的 beingAttack 不允许解除 L2 上限");
    assert.equal(S.pbWaveBlocked(flag({ index: 3, boostModel: 1 })), false, "index<=3 照常派");
}

// ⑤b 当前确有威胁，才允许绕过普通波次约束。
{
    const S = load({ alive: ["a0"] });
    assert.equal(S.pbWaveBlocked(flag({ index: 5, boostModel: 0 }), true), false,
        "被打时 4 波硬上限解除：一波接一波地派");
    assert.equal(S.pbWaveBlocked(flag({ index: 2, boostModel: 3, L2Boosted: true, attacker: { 0: "a0" } }), true), false,
        "被打时 L2 单波闩锁解除：打的人还在也继续补波");
}

function mission({ history = true, l2Available = true, l1Available = true, memory = {} } = {}) {
    const target = "E57S40";
    const f = flag({ id: "bank", roomName: target, power: 7000, disappearTime: 12000, ...memory });
    f.pos = { roomName: target };
    f.remove = () => { f.removed = true; };
    const spawns = [];
    const Memory = { creeps: {}, powerBankAttackedRooms: history ? { [target]: { user: "OldRaider", tick: 10 } } : {} };
    const live = new Set();
    const Game = { time: 3000, rooms: {}, getObjectById: id => id === "bank" ? { hits: 2000000 } : live.has(id) ? { id } : null };
    const S = load({ overrides: {
        Game, Memory, isSaveCpu: true,
        BOOST_RES: { damage: ["d0", "d1", "d2"], attack: ["a0", "a1"], heal: ["h0", "h1"], rangedAttack: ["r0"] },
        ManagerFlags: { getFlagsByPrefixAndRoom: () => [f] },
        StationHive: { spawnAble: () => true },
        StationLab: { boostAble: (_, res) => res.d2 ? l2Available : l1Available, boostAbleLevel: () => 1 },
    } });
    S.cleanFlag = () => {};
    S.spawnPBTeam = (_, _flag, boost) => { spawns.push(boost); return true; };
    let queueActive = false;
    S.dispatchPBSpawnQueue = () => queueActive;
    const exec = (time, hostiles, queue = false) => {
        Game.time = time;
        queueActive = queue;
        if (hostiles === undefined) delete Game.rooms[target];
        else Game.rooms[target] = { getHostileCreeps: () => hostiles, find: () => hostiles };
        S.exec({ name: "E55S39", hashCode: () => 0 });
    };
    return { f, spawns, Memory, target, live, exec };
}

// 历史只决定首波强化。后续无威胁时，仍遵守存活和补员时间限制。
{
    const m = mission({ memory: { beingAttack: true } });
    m.exec(3000, []);
    assert.deepEqual(m.spawns, [3], "quiet historical room starts at L2");
    assert.equal(m.f.memory.beingAttack, undefined);
    m.exec(3003, []);
    m.f.memory.attacker = { 0: "fighter" };
    m.live.add("fighter");
    m.exec(4500, []);
    assert.deepEqual(m.spawns, [3], "neither cooldown nor live fighters may be bypassed by history");
    m.live.delete("fighter");
    m.exec(4503, []);
    assert.deepEqual(m.spawns, [3, 2], "a normal replacement uses the normal boost selection");
}

{
    const m = mission({ l2Available: false });
    m.exec(3000);
    assert.deepEqual(m.spawns, [2], "unseen historical room can fall back without L2");
    assert.equal(m.f.removed, undefined);
}

{
    const m = mission({ l2Available: false, l1Available: false });
    m.exec(3000, []);
    assert.deepEqual(m.spawns, [1], "quiet historical room still starts without enough minerals for L1 or L2");
    assert.equal(m.f.removed, undefined);
}

// 当前威胁允许补波，已排队的搭档先孵化。视野丢失或对手离开即恢复常规限制。
{
    const m = mission({ history: false, memory: { index: 5, lastSpawnTime: 2999 } });
    const raider = { owner: { username: "Player" }, pos: { inRangeTo: () => true }, body: [{ type: "attack", hits: 100 }] };
    m.exec(3000, [raider], true);
    assert.deepEqual(m.spawns, [], "must not start another wave while a queue is dispatching");
    m.exec(3003, [raider]);
    assert.deepEqual(m.spawns, [3], "current threat overrides cooldown and wave cap");
    assert.equal(m.Memory.powerBankAttackedRooms[m.target].user, "Player");
    assert.equal(m.f.memory.hostileTick, 3003);
    m.exec(3006, []);
    m.exec(3009);
    m.exec(3012, [{ ...raider, owner: { username: "Invader" } }]);
    m.exec(3015, [{ ...raider, body: [{ type: "attack", hits: 0 }] }]);
    assert.deepEqual(m.spawns, [3], "past sighting, NPC or destroyed attack parts cannot bypass the cap");
}

// ⑥ carrier 必须数活的，不数派过的
{
    const S = load({ alive: ["c1", "c2"] });
    const f = flag({ carrier: ["c0", "c1", "c2", "c3", "c4", "c5"] });
    assert.equal(S.pbLiveCarrierCnt(f), 2, "6 个 id 里只有 2 只活着");
    assert.equal(S.pbLiveCarrierCnt(flag({})), 0, "没有 carrier 记录时是 0，不是 NaN");
}

// ⑦ 调用点：闸门与 carrier 计数必须真的被 exec 用上（只测 helper 抓不到「helper 在、没人调」）
{
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/pro\.pbWaveBlocked\(flag, underAttack\)/.test(codeOnly), "exec 必须用当前威胁判波次");
    assert.ok(/pro\.pbLiveCarrierCnt\(flag\)/.test(codeOnly), "exec 必须用活的 carrier 数判补员");
    assert.ok(!/boostModel == BOOST_L1 && flag\.memory\.L1Boosted\)/.test(codeOnly),
        "旧的永久闩锁表达式必须已经删掉");
    assert.ok(!/flag\.memory\.carrierCnt < carrierCnt/.test(codeOnly),
        "旧的累计计数比较必须已经删掉");
}

console.log("power-bank respawn checks passed");
