# Deepseek 修改报告

- 日期：2026-08-03
- 数据来源：screeps.com 官方服务器（shard3，用户 `an_w`，CPU 上限 20），通过 API token 直连
- 范围：逻辑缺陷修复 + CPU 热点优化

---

## 一、运行现状（来自线上遥测）

在线数据（`Memory.codeHealth` / `Memory.cpuTelemetry` / `Memory.cpuModuleTelemetry`）：

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 长期平均 CPU | 约 17.7 ms | 上限 20 ms |
| 最近 1000 tick 平均 | 约 16.4 ms | bucket 满（10000），有缓冲 |
| 超限比例 | 12901 / 62586 ≈ 20.6% | 峰值最高 132 ms |
| 主要阶段 | unitTasks ≈ 11.4 ms、rooms ≈ 5.8 ms、init ≈ 0.8 ms | 角色逻辑占大头 |
| 高消耗角色 | harvestEnergyKeeper 3.7、upgrader 2.7、carrier 2.7 | 单位任务为主 |
| 线上错误 | `station_lab` `boostLabMap` 崩溃（errorCount=144，E53S21） | 每 tick 重复抛错 |

**结论**：CPU 并非立即告急，但约 20% 的 tick 超限，靠 bucket 缓冲。主要消耗在 creep 任务逻辑（unitTasks）与房间管理（rooms），同时存在一个持续抛错的真实 bug。

---

## 二、已确认并实施的修改（4 项）

### 1. 修复 `station_lab` boostLabMap 崩溃（线上 bug，HIGH）

- 位置：`modules/station_lab.js:399-430`（`generatorOperatorBoostTask`）
- 问题：`room.memory[pro.stationName].boostLabMap` 在未初始化 `stationLab` 内存的房间（如新占领的 E53S21）直接抛 `TypeError`。该函数由 `strategy_highLevel.carrierOperatorBoost` 每 tick 调用，导致持续抛错、白耗 CPU 并污染错误日志。
- 修复：
  - 先取 `stationMemory`，用 `stationMemory && stationMemory.boostLabMap` 防御空值；
  - 两处 `for(let v of boostLabMap[resType])` 加 `(boostLabMap[resType]||[])`，防止 `_boost_requires` 引用了未分配 lab 的资源类型时再次崩溃。
- 验证：`node --check` 通过；`test/core-profile.test.cjs`、`test/claim-flow.test.cjs` 全部通过。

### 2. `harvestEnergyOuterCarry` 修复 + 节流（station_sources.js）

- 位置：`modules/station_sources.js:344-393`
- 问题与修复：
  - 347 行 `rm && rm[pro.stationName][...]`：当该外矿站已从内存移除时，`rm[pro.stationName]` 为 undefined，会二次抛错 → 增加 `rm[pro.stationName]` 判空；
  - 351 行 `sm = ...` 是隐式全局变量（非严格模式下泄漏到 global）→ 改为 `let sm`；
  - 375-382 行：`lookFor(LOOK_TOMBSTONES)` + `lookFor(LOOK_ENERGY)` 每 tick 无条件执行；同类角色（`harvestEnergy` 用 `% 4`、`harvestEnergyKeeper` 用 `% 6`）均已节流 → 统一加 `if (this.ticksToLive % 4 == 0)`，捡拾频率降至 1/4。掉落的能量在沙地上不会消失，行为无影响。
- 验证：`node --check` 通过；逻辑模拟确认。

### 3. `Store` 遍历从 `for...in` 改为 `Object.keys`（prototype_store.js）

- 位置：`modules/prototype_store.js`（`getLabReactionCnt` / `getLabReactionResType` / `getResTypeList` / `getAllResTypeCount`）
- 问题：模块用 `Store.prototype.xxx = function(){}` 挂载方法，是**可枚举**属性。`for...in` 遍历 store 实例时会额外访问 9 个继承的 prototype 方法，虽被 `this[k]>0` 过滤掉，但每次遍历白白多走 9 个属性。这些方法在 `station_lab`、`prototype_creep`、`strategy_deposits` 等热路径中高频调用。
- 修复：改为 `for(let k of Object.keys(this))`，只遍历自身可枚举资源键，输出完全一致。
- 验证：用模拟 Store（自身资源键 + 可枚举 prototype 方法）验证四种方法的返回值与原逻辑一致。

### 4. 合并 `main.js` 的两次过滤（main.js）

- 位置：`modules/main.js:77-78`
- 问题：`activeCreeps` 先按 `ROLE_PRIORITY` 过滤、再 `.filter(shouldRunCreep)`，MIN_CPU 模式下产生两个临时数组。
- 修复：合并为单次 `filter`，条件 `(!MIN_CPU || ROLE_PRIORITY[e.memory.role] > 0) && shouldRunCreep(e)`，语义完全等价。
- 验证：`test/core-profile.test.cjs:119` 断言同步更新为 `main.includes("&& shouldRunCreep(e)")`，测试全部通过。

---

## 三、评估后暂未实施的高收益优化（附理由）

以下项经代码核实确有收益，但**改动有行为风险或收益存疑**，为避免破坏线上运行先记录在案，供后续决策：

1. **结构缓存首次访问的 `getObjectById` 风暴**（`极致建筑缓存 v1.4.3.js`）
   - 每个房间每 tick 首次访问 `room.lab/extension/source/mass_stores` 等会为缓存里的**每个 id** 调 `Game.getObjectById`；同一 tick 内已缓存，无法跨 tick 缓存（游戏对象每 tick 重建）。
   - 收益：可能是 rooms 阶段 5.8 ms 的主要隐藏成本；但安全改造需重构为"每房间每 tick 一次性 find 构建 id→对象 map"，改动面大、易引入遗漏/越权访问，故暂缓。

2. **`execRegFun` 与 `execLastTask` 双重遍历任务队列**
   - `main.js:26-27` 与 `82-85` 对同一批 creep 的 `memory.tasks` 各扫一遍，carrier 任务多时近似翻倍。合并需改动任务系统主流程，属结构性重构，风险较高，暂缓。

3. **PowerCreep 移动未走缓存路径**
   - `超级移动优化hotfix 0.9.4.js` 只包裹了 `Creep.prototype.moveTo`，PowerCreep 仍用原生未缓存 `moveTo`。PC 数量少（10 只），绝对收益有限，暂缓。

4. **upgrader 每 tick 两次 `findInRange(FIND_STRUCTURES)`**
   - `station_upgrade.js:136-137` 每 tick 扫描 link/container。加缓存需处理"link 空能量"的失效更新，错配会饿死升爬，暂缓。

5. **`room.flags(prefix)` 重复 `split("_")` 过滤**
   - `prototype_room.js:34-47` 每个前缀每 tick 对房间 flag 列表做一次 filter+split。现有 flag 数量仅 10 个左右，绝对收益小，暂缓。

6. **`walkableAroundCnt`/`walkable` 的 lookFor 风暴**（`prototype_roomPostiton.js:49-73`）
   - 每次约 24 次 `lookFor`，仅在 deposit/block 等场景调用，未命中主要路径，暂缓。

---

## 四、验证情况

- 语法检查：4 个改动文件 `node --check` 全部通过。
- 回归测试：`node test/core-profile.test.cjs`、`node test/claim-flow.test.cjs` 全部通过。
- Store 逻辑：模拟对象验证四种方法返回与改造前一致。

## 五、能量出售价格逻辑修改（2026-08-03 追加）

- 位置：`modules/strategy_market.js`（`autoSell`）
- 需求：剩余能量越多，卖价越低；但不能过低，防止与他人互相压价导致价格螺旋下跌。
- 实现（仅作用于 `RESOURCE_ENERGY`）：
  1. **参考价**：市场最高买价优先，无买价时用历史均价；
  2. **超量折扣**：`excess = 存量 - 400000`，折扣 `min(0.25, excess/2000000*0.25)`，即超量越多折扣越大（最高 25%）；
  3. **贴单不砸盘**：查询他人卖单（排除自己的订单），计算价低于他人最低卖价时直接贴到对方价格，不主动破价；
  4. **硬底价**：`max(计算价, 历史均价*0.85, 2)` —— 即使双方互踩，价格也不会低于历史均价的 85%，终止竞价螺旋。
- 验证：离线模拟各场景（刚过线/百万存量/打满折扣/无买价/竞价/硬底/无历史）符合预期；`node --check` 与全部测试通过。

## 六、部署说明

本报告所述改动位于 `modules/` 源码；游戏内 `main` 分支运行的是打包后的 `main.js`（webpack bundle，来自 TS 构建产物），**需要重新构建并上传后才能生效**。本次未执行部署。
