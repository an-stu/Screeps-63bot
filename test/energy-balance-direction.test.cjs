const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules/strategy_resourceBalance.js"), "utf8");
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── storage 不得被「terminal 归位 5 万」的内部平衡灌空 ───────────────────────
//
// 2026-11-04 实测：RES_BALANCE_ROOM[ENERGY]=50000 对低 RCL 房同样生效，
// W26N58（RCL6）把 storage 最后一格能量搬进 terminal，14 个房 storage 全部
// 清空（4 个房同值 776）—— 墙体停修、power 烧制停摆、房间零缓冲。

// ① 能量反向急救：storage 见底且比 terminal 少 ⇒ terminal → storage
assert.ok(/let sE = this\.room\.storage \? \(this\.room\.storage\.store\[RESOURCE_ENERGY\] \|\| 0\) : 0;/.test(code),
    "必须读取本房 storage 能量");
assert.ok(/let energyReverse = sE < 50000 && sE < tE;/.test(code),
    "必须判定「storage 见底且比 terminal 少」的反向搬运条件");
assert.ok(/UtilsTask\.task\(this\.room\.storage, "fillRes", undefined,\s*\n\s*\{ resType: RESOURCE_ENERGY, resCount: amount \}\),/.test(code),
    "反向搬运必须落到 storage（fillRes 在 storage）");

// ② storage < 10 万时禁止 storage → terminal 方向
assert.ok(/if \(resType == RESOURCE_ENERGY && resCount > 0 && sE < 100000\) \{\s*\n\s*delete needBalance\[RESOURCE_ENERGY\];\s*\n\s*return;\s*\n\s*\}/.test(code),
    "storage < 10 万时必须放弃「storage → terminal」的能量归位");

// ③ terminal → storage 的回填方向不受影响（resCount < 0 走原逻辑）
assert.ok(/let fromTo = \[this\.room\.storage, this\.room\.terminal\]\s*\n\s*if \(resCount < 0\) \{\s*\n\s*fromTo = \[this\.room\.terminal, this\.room\.storage\]/.test(code),
    "terminal → storage 的回填方向必须保留");

// ④ ops 特例（0.78.185 加的）仍在
assert.ok(/sendAble\[RESOURCE_OPS\] = room\.terminal\.store\[RESOURCE_OPS\];/.test(code),
    "ops 满格即可发的特例必须保留");

console.log("energy balance direction checks passed");
