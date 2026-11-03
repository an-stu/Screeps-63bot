const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules/prototype_creep.js"), "utf8");

/**
 * BOOST_POWER 必须按**化合物名**索引。
 *
 * 引擎实测结构（2026-11-03 console dump）：BOOSTS 键是小写部件名
 * （"work"/"attack"/"tough"...），第二层是**化合物**、第三层是动作：
 *   BOOSTS.work = { UO: {harvest: 3}, LH: {build: 1.5, repair: 1.5}, ... }
 *   BOOSTS.tough = { GO: {damage: 0.7}, GHO2: {damage: 0.5}, XGHO2: {damage: 0.3} }
 * 历史教训×2：
 *   · 最初 `_.values(BOOSTS).map(...head()).toMap()` 在真实结构上产出
 *     **动作名**键（harvest/build...）——按化合物查永远 undefined；
 *   · 0.78.181 的修复假设「部件常量键 + 动作在第二层」，在真实结构上同样退化。
 * 现行实现按第二层=化合物反转，console dump 交叉验证过。
 */

// 提取现行构造（与 prototype_creep.js 保持一致）
const start = raw.indexOf("const BOOST_POWER = {};");
const end = raw.indexOf("}));", start);
assert.ok(start > 0 && end > start, "BOOST_POWER 构造必须存在");
const block = raw.slice(start, end + 4);

// 引擎实测结构（片段，2026-11-03 console dump）
const BOOSTS = {
    work: { UO: { harvest: 3 }, UHO2: { harvest: 5 }, XUHO2: { harvest: 7 },
            LH: { build: 1.5, repair: 1.5 }, ZH: { dismantle: 2 }, ZH2O: { dismantle: 3 },
            XZH2O: { dismantle: 4 }, GH: { upgradeController: 1.5 } },
    attack: { UH: { attack: 2 }, UH2O: { attack: 3 }, XUH2O: { attack: 4 } },
    heal: { LO: { heal: 2 }, LO2: { heal: 3 }, XLHO2: { heal: 4 } },
    tough: { GO: { damage: 0.7 }, GHO2: { damage: 0.5 }, XGHO2: { damage: 0.3 } },
    carry: { KH: { capacity: 50 }, KH2O: { capacity: 100 }, XKH2O: { capacity: 150 } },
    move: { ZO: { fatigue: 2 }, ZHO2: { fatigue: 3 }, XZHO2: { fatigue: 4 } },
    ranged_attack: { KH: { rangedAttack: 2 }, KH2O: { rangedAttack: 3 }, XKH2O: { rangedAttack: 4 } },
};
const ctx = { BOOSTS, _: { keys: obj => Object.keys(obj), values: obj => Object.values(obj) },
    Object, console };
ctx.global = ctx;
// 项目给 Array 挂的 .head() 扩展（utils.js）：VM 与宿主 realm 都要有
if (!Array.prototype.head) Object.defineProperty(Array.prototype, "head", {
    value: function () { return this.length ? this[0] : undefined; },
    enumerable: false, configurable: true, writable: true,
});
vm.runInNewContext(block + "\nthis.BOOST_POWER = BOOST_POWER;", ctx, { filename: "boost-power.js" });
const BP = ctx.BOOST_POWER;

// 化合物名查倍率（调用方的真实用法：part.boost = 化合物名）
assert.equal(BP["XUHO2"], 7, "T3 harvest");
assert.equal(BP["LH"], 1.5, "多动作化合物取首值（build/repair 同值）");
assert.equal(BP["XUH2O"], 4, "T3 attack");
assert.equal(BP["XGHO2"], 0.3, "TOUGH decay（getHitsNextTick 的吸收容量 = hits/0.3）");
assert.equal(BP["XLHO2"], 4, "T3 heal");
assert.equal(BP["XZH2O"], 4, "T3 dismantle");
// KH 同时存在于 ranged_attack(×2/3/4) 与 carry(×50/100/150)：单表按「最后写入者」
// 收敛到 ranged 值——BOOST_POWER 的消费者只有伤害/治疗数学（capacity 由引擎
// store.getCapacity 直接反映，不从这张表读），所以这个收敛对唯一用途正确。
assert.equal(BP["XKH2O"], 4, "跨部件化合物按伤害数学取值（capacity 不走此表）");
assert.equal(BP["XZHO2"], 4, "T3 move");

// 动作名不得成为键（真实结构下旧实现正好产出动作名键）
assert.equal(BP["harvest"], undefined, "动作名不得是键（旧实现在真实结构上产出 harvest/build/... 键）");
assert.equal(BP["damage"], undefined, "动作名不得是键");
assert.equal(BP["build"], undefined, "动作名不得是键");

// 全化合物覆盖：任何化合物都不应落在键外（undefined 会让伤害估算变 NaN）
for (const part in BOOSTS) {
    for (const compound in BOOSTS[part]) {
        assert.ok(BP[compound] !== undefined, "compound " + compound + " 必须有倍率");
    }
}

console.log("boost power compound-key checks passed");
