const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "modules/strategy_resourceBalance.js"), "utf8");

/**
 * ops 分配特例：terminal 满格（>= 3000）即可发。
 *
 * ops 产出自 power creep（全账号 12 只 ≈ 1/tick 量级），通用规则的 3× 门槛
 * （terminal+storage > 9000 且 terminal >= 3000）实测永不触发——丰房囤在
 * terminal cap（W34N52 双满 6000 卡死、E53S21 8722）、饥房 37~198（低于 PC
 * 施法成本 100 与 needOpPowerSpawn 的 600 门槛）。特例让满格丰房把存量匀给
 * 缺 room 的房间，发送端清空后由 PC 慢慢产，自然收敛。
 */

assert.ok(/sendAble\[RESOURCE_OPS\] === undefined\s*&& room\.terminal\.store\[RESOURCE_OPS\] >= RES_BALANCE_ROOM\[RESOURCE_OPS\]/.test(raw),
    "ops 特例必须存在：terminal 满格即视为可发（3× 门槛对 ops 永不触发）");
assert.ok(raw.includes("sendAble[RESOURCE_OPS] = room.terminal.store[RESOURCE_OPS];"),
    "ops 可发量 = terminal 存量");

// 发送路径必须仍过运费预算（freight-budget.test 也钉了 5 个 send 点）
assert.ok(/amount = pro\.freightBudget\(room, targetRoom\.name, resType, amount\)/.test(raw),
    "ops 发送同样要走运费预算");

// 接收侧需求注册必须覆盖 ops（processRoom 遍历 RES_BALANCE_ROOM 的键）
assert.ok(/obj\[RESOURCE_OPS\] = 3000/.test(raw), "RES_BALANCE_ROOM 必须含 ops 目标 3000");

console.log("ops balance special-case checks passed");
