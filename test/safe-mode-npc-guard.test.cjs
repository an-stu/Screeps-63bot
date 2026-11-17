// Safe mode 与低 RCL 防守的 NPC 免疫回归（用户政策：invader 不拆建筑，
// 不该为 NPC 触发 safe mode / 产防守爬；援建中的低级房不自动开 safe mode）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = n => fs.readFileSync(path.join(root, "modules", n), "utf8");

// ── 提取 checkSafeMode 单独行为测试 ──────────────────────────────────────
const defSrc = read("station_defense.js");
const m = defSrc.match(/checkSafeMode\(room, hostiles\) \{[\s\S]*?\n    \}/);
assert.ok(m, "checkSafeMode 必须存在");

const HEAL = "heal";
const FIND_RUINS = "ruins";
function makeCtx(opts = {}) {
    const ctx = {
        Memory: { crossShardBuilds: opts.bootstrap ? { "E41S29": {} } : {} },
        HEAL, FIND_RUINS,
        STRUCTURE_ROAD: "road", STRUCTURE_CONTAINER: "container", STRUCTURE_RAMPART: "rampart",
        STRUCTURE_EXTRACTOR: "extractor", STRUCTURE_LINK: "link",
        console,
    };
    ctx.global = ctx;
    vm.runInNewContext("var pro = {" + m[0] + "\n};", ctx);
    return ctx;
}
function hostile(owner, boostedHeal) {
    const body = [];
    for (let i = 0; i < boostedHeal; i++) body.push({ type: HEAL, boost: "XLHO2" });
    return { owner: { username: owner }, body };
}
function makeRoom(ctx, opts = {}) {
    let activated = 0;
    const roomRuins = opts.ruins || [];
    const room = {
        name: opts.name || "E41S29",
        getHostileCreeps: () => opts.hostiles || [],
        find: (type, opts) => {
            if (type === FIND_RUINS) {
                const ruins = opts && opts.__ruins || roomRuins;
                const filter = opts && opts.filter;
                return filter ? ruins.filter(filter) : ruins;
            }
            return [];
        },
        controller: {
            owner: { username: "an_w" },
            activateSafeMode: () => { activated++; return 0; },
        },
    };
    return { room, activated: () => activated };
}
const ownRuin = { structure: { structureType: "spawn", owner: { username: "an_w" } } };

// 1. Invader 即便带满强化 HEAL + 有废墟，也不开 safe mode。
{
    const ctx = makeCtx();
    const { room, activated } = makeRoom(ctx, { hostiles: [hostile("Invader", 8)], ruins: [ownRuin] });
    ctx.pro.checkSafeMode(room);
    assert.equal(activated(), 0, "Invader 永不触发 safe mode（不拆建筑）");
}
// 2. Source Keeper 同样免疫。
{
    const ctx = makeCtx();
    const { room, activated } = makeRoom(ctx, { hostiles: [hostile("Source Keeper", 8)], ruins: [ownRuin] });
    ctx.pro.checkSafeMode(room);
    assert.equal(activated(), 0, "Source Keeper 永不触发 safe mode");
}
// 3. 玩家带 >=5 强化 HEAL + 己方建筑废墟 → 开 safe mode（保留正当防卫）。
{
    const ctx = makeCtx();
    const { room, activated } = makeRoom(ctx, { hostiles: [hostile("SomePlayer", 5)], ruins: [ownRuin] });
    ctx.pro.checkSafeMode(room);
    assert.equal(activated(), 1, "玩家强化奶妈拆房仍应开 safe mode");
}
// 4. 玩家强化奶妈但无废墟 → 不开。
{
    const ctx = makeCtx();
    const { room, activated } = makeRoom(ctx, { hostiles: [hostile("SomePlayer", 5)], ruins: [] });
    ctx.pro.checkSafeMode(room);
    assert.equal(activated(), 0, "无建筑废墟不开 safe mode");
}
// 5. 援建中的低级房：即便玩家拆房也不自动开 safe mode（用户政策）。
{
    const ctx = makeCtx({ bootstrap: true });
    const { room, activated } = makeRoom(ctx, { hostiles: [hostile("SomePlayer", 8)], ruins: [ownRuin] });
    ctx.pro.checkSafeMode(room);
    assert.equal(activated(), 0, "援建低级房不自动开 safe mode");
}
// 6. 玩家 <5 强化 HEAL → 不开（危险阈值）。
{
    const ctx = makeCtx();
    const { room, activated } = makeRoom(ctx, { hostiles: [hostile("SomePlayer", 4)], ruins: [ownRuin] });
    ctx.pro.checkSafeMode(room);
    assert.equal(activated(), 0, "不足 5 个强化 HEAL 不算危险");
}

// ── 源码层：低 RCL 允许对 invader 产防守爬（safe mode 仍对 NPC 免疫） ──────
{
    const low = read("strategy_lowLevel.js");
    // 用户政策：低 RCL 防不住时可对 invader 产防守爬——防守触发不得过滤 NPC。
    assert.ok(!/defenseHostiles\.filter\(e => e\.owner/.test(low),
        "lowLevel 防守触发不得过滤 invader（低 RCL 允许对 NPC 防守）");
    assert.ok(/room\.creeps\("lowLevelDefense"\)\.length < 3 && room\.tower\.length == 0/.test(low),
        "低 RCL 防守爬生产逻辑保留");
    // safe mode 的 NPC 免疫在 station_defense（上方行为测试已覆盖）。
    const def = read("station_defense.js");
    assert.ok(/owner == "Invader" \|\| owner == "Source Keeper"/.test(def),
        "checkSafeMode 必须显式跳过 Invader 与 Source Keeper");
}

console.log("safe mode NPC guard: OK");