const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules/station_upgrade.js"), "utf8");
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── 升级容器必须作为常备缓冲，不被「link 有能量」卡住 ────────────────────────
//
// 2026-11-05 实测 W26N58：4 只 upgrader（52 work）站在 link(7,6)=582 与
// cont(8,6)=0 旁边挨饿，2 只 carrier 一空一满载 1200 却没有任务 ——
// 旧逻辑把容器填充塞进「link 完全空」分支，link 非空时容器永不补，
// link 抽空后要等 transformLink 链条慢慢单发 ⇒ 出现 0/tick 空转窗口。
// Overmind 的 Controller Manager：专用 upgrader + 控制器旁容器常备缓冲。

// ① 容器填充必须独立于 link 状态（先于 link 判定）
const fillIdx = code.indexOf("if (container\n");
const linkGateIdx = code.indexOf("if (!upgradeLink || upgradeLink.store.isEmpty())");
assert.ok(fillIdx > 0, "必须存在独立的容器填充分支");
assert.ok(linkGateIdx > fillIdx, "容器填充必须排在 link 判定之前");

// ② 容器填充的条件只剩「低于 2000（含预订量）」
assert.ok(/if \(container\s*&& \(\(room\.used\[container\.id\] \|\| 0\) \+ container\.store\[RESOURCE_ENERGY\]\s*\+ Math\.min\(1000, Math\.max\(\(carryCap \|\| 0\) - 400, 0\)\) < 2000\)\) \{/.test(code),
    "容器填充条件应只剩「低于 2000」");

// ③ center-link 充能分支保留（link 路径仍在）
assert.ok(code.includes("if (!upgradeLink || upgradeLink.store.isEmpty()) {") && code.includes("centerLink"),
    "center-link 充能分支必须保留");

// ④ 存在堆叠量预订（used + 现量 + 预订），防止两只 carrier 同时去填爆
assert.ok(code.includes("room.used[container.id]"), "必须保留堆叠量预订");

console.log("upgrade container buffer checks passed");
