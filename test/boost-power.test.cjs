const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8");

/**
 * BOOST_POWER 必须按**化合物名**索引，且遍历层级必须与引擎一致。
 *
 * 2026-11-03 实测引擎（shard3）：`BOOSTS[部件][化合物] = {动作: 倍率}` ——
 *   BOOSTS.work.UO = {harvest:3}、BOOSTS.tough.XGHO2 = {damage:0.3}，
 *   化合物在第二层、动作在第三层。旧注释写成 [部件][动作][化合物]，
 *   da232e1 按（错误理解的）三层遍历建出的表键是**动作名**，测试 fixture 也
 *   用了同样的错误层级 ⇒ 测试全绿、线上全 undefined ⇒ 强化爬伤害/承伤全是 NaN。
 * 同时实测：同一化合物跨动作的倍率完全一致（30 个化合物零冲突），
 * 所以按化合物建平面表（compound → mult）是安全的。
 */

// 构造代码提取：从 const 声明到遍历结尾（新尾锚）
const start = raw.indexOf("const BOOST_POWER = {};");
const tailAnchor = "BOOST_POWER[compound] = _.values(BOOSTS[part][compound]).head() || 1;";
const end = raw.indexOf(tailAnchor, start);
assert.ok(start > 0 && end > start, "BOOST_POWER 构造必须存在（按化合物建表）");
// 头部先补 .head()（游戏里是 lodash mixin；runInNewContext 每次都是全新全局，
// 所以必须和被测代码拼在**同一段**里执行，单独 patch 另一个 context 不生效）
const block = raw.slice(start, end + tailAnchor.length)
    + "\n}));"   // 尾锚只到内层赋值行，外层 forEach 的收尾括号在其后
    + "\nthis.BOOST_POWER = BOOST_POWER;";

// **fixture 必须用引擎真实层级**：part → compound → {action: mult}
const BOOSTS = {
    attack:  { UH: { attack: 2 }, UH2O: { attack: 3 }, XUH2O: { attack: 4 } },
    ranged_attack: { KH: { rangedAttack: 2 }, KH2O: { rangedAttack: 3 }, XKH2O: { rangedAttack: 4 } },
    heal:    { LO: { heal: 2, rangedHeal: 2 }, LO2: { heal: 3 }, XLHO2: { heal: 4, rangedHeal: 4 } },
    work:    { UO: { harvest: 3 }, ZH: { dismantle: 2, build: 2 }, XZH2O: { dismantle: 4 } },
    tough:   { GO: { damage: 0.7 }, GHO2: { damage: 0.5 }, XGHO2: { damage: 0.3 } },
    carry:   { KH: { capacity: 50 }, KH2O: { capacity: 100 }, XKH2O: { capacity: 150 } },
    move:    { ZO: { fatigue: 2 }, ZHO2: { fatigue: 3 }, XZHO2: { fatigue: 4 } },
};
// _.values 桩在宿主 realm 返回宿主数组，VM context 里的 Array.prototype 补丁管不到它，
// 所以 head 直接挂在返回的数组实例上（与游戏里 lodash mixin 的效果一致）。
const withHead = obj => { let a = Object.values(obj); a.head = () => a[0]; return a; };
const ctx = { BOOSTS, _: { values: withHead, keys: obj => Object.keys(obj) }, Object, console };
ctx.global = ctx;
// 游戏里的 lodash 给数组挂了 .head()（_.head 的 mixin）；VM 里补一个等价物
vm.runInNewContext("Array.prototype.head = function(){ return this[0]; };", ctx);
vm.runInNewContext(block + "\nthis.BOOST_POWER = BOOST_POWER;", ctx, { filename: "boost-power.js" });
const BP = ctx.BOOST_POWER;

// 化合物名查倍率（调用方的真实用法：part.boost 是化合物名）
assert.equal(BP["UH"], 2, "T1 attack");
assert.equal(BP["XUH2O"], 4, "T3 attack");
assert.equal(BP["XGHO2"], 0.3, "TOUGH decay（getHitsNextTick 吸收容量 = hits/0.3）");
assert.equal(BP["XLHO2"], 4, "T3 heal（同化合物多动作、倍率一致 ⇒ 平面表安全）");
assert.equal(BP["XKH2O"], 150, "T3 carry capacity");
assert.equal(BP["XZH2O"], 4, "T3 dismantle+build");
assert.equal(BP["LO"], 2, "同化合物多动作：heal 与 rangedHeal 同倍率");

// 动作名不得成为键（旧实现的错误键：harvest/attack/damage…）
["attack", "harvest", "damage", "rangedAttack", "heal", "capacity", "fatigue", "dismantle"]
    .forEach(action => assert.equal(BP[action], undefined, "动作名不得是键: " + action));

// 覆盖度：fixture 里出现过的每个化合物都要进表（跨部件重名的算一个）
const expectedCompounds = new Set();
Object.values(BOOSTS).forEach(pm => Object.keys(pm).forEach(c => expectedCompounds.add(c)));
assert.equal(Object.keys(BP).length, expectedCompounds.size,
    "每个化合物都要进表");

console.log("boost power compound-key checks passed");
