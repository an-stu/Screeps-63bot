const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── CPU 预算保护：deposit 采掘必须给核心循环让路（用户 2026-11-05）────────────
//
// 实测 2026-11-05：存款采掘扩到 17+7 只（≈2.6 CPU）后 used 顶到 20~23，
// bucket 一度 2,157，MIN_CPU=true 期间 upgrader（优先级 -10）整批冻结、
// 控制器停摆 —— 房间正常运行被 CPU 拖累。
{
    const dep = strip(fs.readFileSync(path.join(root, "modules", "strategy_deposits.js"), "utf8"));
    assert.ok(/if \(\(Game\.cpu \? Game\.cpu\.bucket : 10000\) < 5000\) return;/.test(dep),
        "deposit exec 必须在 bucket < 5000 时停止派新爬/维护");
    assert.ok(/Creep\.prototype\.harvestDeposit = function \(\) \{\s*if \(\(Game\.cpu \? Game\.cpu\.bucket : 10000\) < 3500\) return;/.test(dep),
        "harvestDeposit 必须在 bucket < 3500 时暂停");
    assert.ok(/Creep\.prototype\.carryDeposit = function \(\) \{\s*if \(\(Game\.cpu \? Game\.cpu\.bucket : 10000\) < 3500\) return;/.test(dep),
        "carryDeposit 必须在 bucket < 3500 时暂停");

    // 市场买入目标降档（用户：能量不要买太多）
    const mkt = strip(fs.readFileSync(path.join(root, "modules", "strategy_market.js"), "utf8"));
    assert.ok(/let target = activelyUpgrading \? 120000 :/.test(mkt),
        "RCL<8 升级房的能量买入目标必须降到 120k");
    assert.ok(!/activelyUpgrading \? 300000/.test(mkt), "旧的 300k 目标必须移除");
}

console.log("deposit cpu throttle checks passed");
