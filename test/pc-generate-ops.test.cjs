const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── PC 必须使用自带的 PWR_GENERATE_OPS 自产 ops ──────────────────────────────
//
// 2026-11-03 现场事故：4 只 PC ops=0（所在房 ops < 200，needGetOps 永不成立），
// 工厂全部 prod0、PC 空转 —— 而 PWR_GENERATE_OPS 是 0 级就自带、无消耗、只吃冷却
// 的能力，整个代码库却从未调用。这里锁住三件事：
//   ① prototype 上有 needGenerateOps（校验等级/冷却/上限）
//   ② execRoom 在本房孵化判定之前就先白嫖
//   ③ usePower 的目标就是 PWR_GENERATE_OPS
{
    const pcCode = strip(fs.readFileSync(path.join(root, "modules", "prototype_powerCreep.js"), "utf8"));
    assert.ok(/PowerCreep\.prototype\.needGenerateOps = function \(\) \{[\s\S]*?this\.powers\[PWR_GENERATE_OPS\][\s\S]*?pw\.cooldown > 0[\s\S]*?OPS_MAX_CARRY_CNT/.test(pcCode),
        "needGenerateOps 必须校验 PWR_GENERATE_OPS 的冷却与携带上限");
    assert.ok(/PowerCreep\.prototype\.generateOps = function \(\) \{\s*return this\.usePower\(PWR_GENERATE_OPS\);/.test(pcCode),
        "generateOps 必须调用 usePower(PWR_GENERATE_OPS)");

    const highCode = strip(fs.readFileSync(path.join(root, "modules", "strategy_factoryPowerCreep.js"), "utf8"));
    const genIdx = highCode.indexOf("if (pc.needGenerateOps()) pc.generateOps();");
    const spawnIdx = highCode.indexOf("let mainRoom = pc.mainRoom();");
    assert.ok(genIdx > 0, "execRoom 必须接入 generateOps");
    assert.ok(genIdx < spawnIdx, "白嫖 ops 要发生在主房逻辑之前（越早越好，且不依赖房间）");
}

console.log("pc generate ops checks passed");
