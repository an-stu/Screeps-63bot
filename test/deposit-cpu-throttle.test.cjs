const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── Deposit bucket pauses are shard3 CPU policy, not a cross-shard throttle ──
//
// 实测 2026-11-05：存款采掘扩到 17+7 只（≈2.6 CPU）后 used 顶到 20~23，
// bucket 一度 2,157，MIN_CPU=true 期间 upgrader（优先级 -10）整批冻结、
// 控制器停摆 —— 房间正常运行被 CPU 拖累。
{
    const dep = strip(fs.readFileSync(path.join(root, "modules", "strategy_deposits.js"), "utf8"));
    const guards = [...dep.matchAll(/global\.isSaveCpu !== false && \(Game\.cpu \? Game\.cpu\.bucket : 10000\) < (3500|5000)/g)];
    assert.deepEqual(guards.map(match => Number(match[1])).sort((a, b) => a - b), [3500, 3500, 5000],
        "harvester, carrier and exec must all retain their original bucket thresholds behind isSaveCpu");
    assert.ok(/Creep\.prototype\.harvestDeposit = function \(\) \{\s*if \(global\.isSaveCpu !== false && \(Game\.cpu \? Game\.cpu\.bucket : 10000\) < 3500\) return;/.test(dep),
        "harvestDeposit must apply the 3500 guard only when shard3 CPU policy is enabled");
    assert.ok(/Creep\.prototype\.carryDeposit = function \(\) \{\s*if \(global\.isSaveCpu !== false && \(Game\.cpu \? Game\.cpu\.bucket : 10000\) < 3500\) return;/.test(dep),
        "carryDeposit must apply the 3500 guard only when shard3 CPU policy is enabled");
    assert.ok(/if \(global\.isSaveCpu !== false && \(Game\.cpu \? Game\.cpu\.bucket : 10000\) < 5000\) return;/.test(dep),
        "deposit exec must apply the 5000 guard only when shard3 CPU policy is enabled");

    // Evaluate the exact predicates taken from production source: low bucket
    // pauses each deposit path on shard3 but is ignored when isSaveCpu=false.
    for (const match of guards) {
        const threshold = Number(match[1]);
        const active = expression => vm.runInNewContext(expression, {
            global: {isSaveCpu: true}, Game: {cpu: {bucket: threshold - 1}},
        });
        assert.equal(active(match[0]), true, "low bucket should pause at threshold " + threshold);
        assert.equal(vm.runInNewContext(match[0], {
            global: {isSaveCpu: false}, Game: {cpu: {bucket: 0}},
        }), false, "non-shard3 policy must bypass bucket threshold " + threshold);
        assert.equal(vm.runInNewContext(match[0], {
            global: {isSaveCpu: true}, Game: {cpu: {bucket: threshold}},
        }), false, "bucket threshold is strict (<), for threshold " + threshold);
    }

    // 市场买入目标降档（用户：能量不要买太多）
    const mkt = strip(fs.readFileSync(path.join(root, "modules", "strategy_market.js"), "utf8"));
    assert.ok(/let target = activelyUpgrading \? 120000 :/.test(mkt),
        "RCL<8 升级房的能量买入目标必须降到 120k");
    assert.ok(!/activelyUpgrading \? 300000/.test(mkt), "旧的 300k 目标必须移除");
}

console.log("deposit cpu throttle checks passed");
