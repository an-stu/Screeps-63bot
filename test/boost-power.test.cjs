const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8");

/**
 * BOOST_POWER 必须按**化合物名**索引。
 *
 * 引擎结构 `BOOSTS[部件][动作] = {化合物: 倍率}`（例：BOOSTS.TOUGH.damage =
 * {GO: 0.7, GHO2: 0.5, XGHO2: 0.3}）。原实现 `_.values(e[1]).head()` 取每个
 * 动作表里第一个化合物的倍率、键却是动作名 —— 所有调用方（getHitsNextTick /
 * possibleDamage 系 / possibleHealHoldRealDamage）都用 `part.boost` 化合物名
 * 查询 ⇒ 永远 undefined ⇒ 对强化爬的伤害估算全是 NaN。invader/keeper 无
 * boost 才一直没暴露；战斗对上强化单位就全瞎。
 */

// 构造代码提取：从 const 声明到反转构造的结尾（精确尾锚，别扫到后面去）
const start = raw.indexOf("const BOOST_POWER = {};");
const tailAnchor = "BOOST_POWER[compound] = mult; })));";
const end = raw.indexOf(tailAnchor, start);
assert.ok(start > 0 && end > start, "BOOST_POWER 反转构造必须存在");
const block = raw.slice(start, end + tailAnchor.length) + "\nthis.BOOST_POWER = BOOST_POWER;";

const BOOSTS = {
    ATTACK: { attack: { UH: 2, UH2O: 3, XUH2O: 4 } },
    RANGED_ATTACK: { rangedAttack: { KH: 2, KH2O: 3, XKH2O: 4 } },
    HEAL: { heal: { LO: 2, LO2: 3, XLHO2: 4 }, rangedHeal: { LO: 2 } },
    WORK: { dismantle: { ZH: 2, ZH2O: 3, XZH2O: 4 }, build: { KO: 2, KHO2: 3, XKHO2: 4 } },
    TOUGH: { damage: { GO: 0.7, GHO2: 0.5, XGHO2: 0.3 } },
    MOVE: { fatigue: { ZO: 2, ZHO2: 3, XZHO2: 4 } },
    CARRY: { capacity: { KH: 50, KH2O: 100, XKH2O: 150 } },
};
const ctx = { BOOSTS, _: { values: obj => Object.values(obj) }, Object, console };
ctx.global = ctx;
vm.runInNewContext(block + "\nthis.BOOST_POWER = BOOST_POWER;", ctx, { filename: "boost-power.js" });
const BP = ctx.BOOST_POWER;

// 化合物名查倍率（调用方的真实用法）
assert.equal(BP["UH"], 2, "T1 attack");
assert.equal(BP["XUH2O"], 4, "T3 attack");
assert.equal(BP["XGHO2"], 0.3, "TOUGH decay (getHitsNextTick 的吸收容量 = hits/0.3)");
assert.equal(BP["XLHO2"], 4, "T3 heal");
assert.equal(BP["XKH2O"], 150, "T3 carry capacity");
assert.equal(BP["XZH2O"], 4, "T3 dismantle");

// 动作名不再成为键（旧实现会返回动作表第一个化合物的倍率，造成误导）
assert.equal(BP["attack"], undefined, "动作名不得再是键（旧实现的错误键）");
assert.equal(BP["damage"], undefined, "动作名不得再是键（旧实现的错误键）");

// 源码级：旧的单行 head() 构造必须消失，反转构造必须存在
assert.ok(!/BOOST_POWER = _\.values\(BOOSTS\)\.map\(e => Object\.entries\(e\)\.map\(e => \[e\[0\], _\.values\(e\[1\]\)\.head\(\)\]\)\)\.flat\(\)\.toMap\(\)/.test(raw),
    "旧的动作名键构造必须移除");
assert.ok(raw.includes("BOOST_POWER[compound] = mult;"), "必须存在化合物反转构造");

console.log("boost power compound-key checks passed");
