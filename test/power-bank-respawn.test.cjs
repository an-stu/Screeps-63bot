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

function load({ time = 1000, alive = [] } = {}) {
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

// ⑤ 非 L1/L2 的 4 波硬上限保持原样（不看死活）
{
    const S = load({ alive: [] });
    assert.equal(S.pbWaveBlocked(flag({ index: 5, boostModel: 0 })), true, "index>3 仍然停派");
    assert.equal(S.pbWaveBlocked(flag({ index: 3, boostModel: 1 })), false, "index<=3 照常派");
}

// ⑤b 被打（beingAttack）⇒ 波次上限全解除（用户 2026-11-07：PB 小队被玩家 Apple
//    打了要「直接一直派更高一级的小队」，防止被打）——4 波硬上限、L1/L2 单波
//    闩锁在被打态全部失效；同时检测代码必须真的在 exec 里跑（不再整段注释）。
{
    const S = load({ alive: ["a0"] });
    assert.equal(S.pbWaveBlocked(flag({ index: 5, boostModel: 0, beingAttack: true })), false,
        "被打时 4 波硬上限解除：一波接一波地派");
    assert.equal(S.pbWaveBlocked(flag({ index: 2, boostModel: 3, L2Boosted: true, attacker: { 0: "a0" }, beingAttack: true })), false,
        "被打时 L2 单波闩锁解除：打的人还在也继续补波");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(/h\.owner\.username != "Invader"/.test(codeOnly),
        "被打检测必须在 exec 里生效（只认玩家袭击者，Invader 不触发升级）");
    assert.ok(/mem\.beingAttack\) return false;/.test(codeOnly),
        "pbWaveBlocked 必须有 beingAttack 直通分支");
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
    assert.ok(/if \(pro\.pbWaveBlocked\(flag\)\)/.test(codeOnly), "exec 必须用 pbWaveBlocked 判波次");
    assert.ok(/pro\.pbLiveCarrierCnt\(flag\)/.test(codeOnly), "exec 必须用活的 carrier 数判补员");
    assert.ok(!/boostModel == BOOST_L1 && flag\.memory\.L1Boosted\)/.test(codeOnly),
        "旧的永久闩锁表达式必须已经删掉");
    assert.ok(!/flag\.memory\.carrierCnt < carrierCnt/.test(codeOnly),
        "旧的累计计数比较必须已经删掉");
}

console.log("power-bank respawn checks passed");
