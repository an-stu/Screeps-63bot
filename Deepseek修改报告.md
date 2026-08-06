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

---

## 七、2026-08-06 会话：外矿恢复 / 掠夺 / 市场 / lab / 工厂 / CPU 优化

### 7.1 外矿 carrier 边界横跳修复（已部署 `f3a8d3a`）

- 位置：`modules/station_sources.js`（`moveOuterCarrierOnRoad`）
- 问题：carrier 跨房后恰好落在对面出口路点上，`range>1` 重新定位分支**没有重算 range**，`index += direction` 被跳过，导致永远指向出口格，每 tick 在 E53S21:0,37 ↔ E52S21:49,37 之间来回传送横跳。
- 修复：重新定位最近路点后重算 range，落在路点上立即推进 index。
- 验证：线上诊断确认 carrier 恢复沿缓存路径正常往返（E52S21:7,33 → E53S21:5,42）。

### 7.2 pillage 支持跨房掠夺（已部署 `0ed5bbd`）

- 位置：`modules/strategy_pillage.js`、`modules/manager_rooms.js`
- 问题：原 `StrategyPillage.exec` 只处理**本房间内**的 pillage 旗子，且 `ManagerRooms.exec` 对非 my 房间直接 return——旗子插在废弃房（E42S32）永远不会触发派发。
- 修复：exec 全局扫描 pillage 旗子，`flag.memory.spawnRoom` 认领最近的有 storage 的己方房间（仿外矿 har_ 机制）；pillager 全局查重。
- 插旗方法：在目标房间创建 `pillage_<派发房间>_<序号>` 旗子（如 `pillage_E41S32_1`），系统自动从 E41S32 派 pillager 跨房搬运 storage/terminal/废墟/掉落，搬空自动删旗。

### 7.3 pillage 按固定价值序挑资源（已部署 `2aa5258`）

- 问题：先按市场价排序，XGHO2 无可靠市场历史导致 fallback 价过低（0.041 < energy 0.5），仍先搬 energy。
- 修复：改为纯 `RES_PRIORITY_LIST` 固定价值序（XGHO2/organism 等化合物权重远高于 energy），每趟装单价最高的资源。线上确认 pillager 先搬 organism → XGHO2 → 最后 energy。

### 7.4 矿物能采就采 + 自动售卖（已部署 `f5b6707` / `9b3e4a4` / `c23dc6f`）

- `station_minetral.js`：删除 `room[mineral] < 200000` 停采上限，容器+extractor 在就持续采集。
- `strategy_market.js` 新增 `autoSellMineral`：存量超 3 万/房间保留量时自动挂卖单；**挂单量为全部可卖量**（不再 3k 一单），买家自然 3k/3k deal；`remainingAmount=0` 与重复订单自动取消；terminal 由 carrier 持续补货（空间不足先腾其他矿物回 storage）。

### 7.5 lab 停摆根因修复（已部署 `b93de16`）

- **根因**：`autoBuy()` 内部 `if ((Game.time) % 100 == 0)` 与 main.js 调用偏移 `shouldRun(100, 19)` 永远互斥——矿物买入逻辑**从未执行**。X/H 基础矿物全线耗尽（13 房仅 W33N53 有 H、W33N55 有 X），`needReaction` 凑不齐配方 → lab 停转。
- 修复：移除 autoBuy 内部时间门（频率已由 main.js 控制），并让 `autoBuyMineral` 计入 lab 原料需求（BOOST_RES_HOLD 折算，封顶 30 万），lab 缺原料时加价到历史均价×0.95 挂买单。

### 7.6 买入高利润商品原料（已部署 `b93de16`）

- `autoBuyHighProfitComponents`：从商品利润分析中挑 `profitMargin >= 1000%`（默认，`Memory.marketSettings.highProfitMargin` 可调）的商品，把展开后的基础原料买到 OPF 工厂房间，工厂逐级合成。
- **结论（非最高级利润最高）**：level 5 的 organism +1694% / machine +1109% 最高，但同为 level 5 的 essence 仅 +431%，level 4 的 hydraulics 仅 +61% 低于 level 3 的 frame +232%——**必须按利润率挑选，不能按等级**。
- 工厂等级=power creep 的 PWR_OPERATE_FACTORY（P19）技能等级，与 PC 名字 P0-P9 无关。线上实测：E55S31=P4 房 level 5、E48S41=P0 房 level 4、E55S39=P3 房 level 3、W33N55=P8 房 level 3…… 唯一能产 level 5 的是 E55S31。

### 7.7 商品 deal 溢价门槛（已部署 `d985f79`）

- 问题：商品 deal 成交门槛是成本×1.15，organism 这类高价值商品可能被贱卖。
- 修复：exec（每房间约 20 tick 一次，即"适当时间"）比较市场最高买价与历史均价，只有买价高于 `历史均价×(1+dealPremium)`（默认 10%）才成交；不高频轮询。

### 7.8 CPU 优化（已部署 `e8a1733`）

- **市场**：exec 批次频率 5→10 tick/房间；商品 deal 扫描、矿物挂单、买入扫描按房间错开节流到约 80 tick；`calcTransactionCost` 单位成本永久缓存于 global（原每 exec 重建、每候选订单调用）。
- **lab**：`checkLabs` 30 tick 缓存（原每 tick filter + 12 次 getObjectById）；合成状态机由每 tick 改为每 2 tick（12 次 getObjectById 减半）。
- **keeper**：主房间 `harvestEnergyKeeper` 改用 `moveTo` 直走容器，去掉每 tick addTask/goToPop 任务栈压弹。
- 线上效果：CPU 从 25-27 降到 **19.9-20.6**（进入 limit 20 内），bucket 止跌回稳（2001→2004）。
- 定位工具：`Memory.codeHealth.phases.roomDetails` 揪出 E55S39(3.64)/W33N55(2.84) 两个 lab 热点房间；临时 `_roomDiag` 计时确认 StationLab.exec 是元凶。

### 7.9 外矿其它修复（已部署 `9b3e4a4`）

- carrier 路径 8 格内捡 tombstone/掉落能量（原只捡脚下），新 carrier 接续死在路上的旧 carrier 的搬运；
- 外矿 keeper 修理脚下 container（血量 <95% 每 3 tick repair），防容器被 source keeper 打爆后搬运中断。

### 7.10 已部署提交清单（本会话）

```
f3a8d3a fix: recompute range after re-anchoring so a landed creep advances
0ed5bbd fix: pillage flags in foreign rooms dispatch from the nearest owned room
2aa5258 fix: pillage picks resources by fixed value order, not market price
f5b6707 feat: keep mining minerals regardless of stock, sell excess via market orders
9b3e4a4 feat: lab mineral buying, outer carrier looting, keeper container repair
c23dc6f fix: mineral sell orders list the full sellable amount
b93de16 fix: autoBuy no longer double-gates on tick parity; high-profit buying
d985f79 fix: commodity deals require a premium over the usual market price
e8a1733 perf: throttle market passes, lab checks, keeper moveTo
```

### 7.11 已知待办

- lab 原料买入已恢复，但需观察 X/H 是否真正成交到位、lab 是否恢复反应；
- E55S31 单条 level 5 产线是 organism 瓶颈，多 PC 升级 P19 可扩产；
- `autoBuyHighProfitComponents` 每 100 tick 的市场查询可再节流（当前收益已达标暂缓）。

### 7.12 主房能量循环崩溃修复（已部署 `9b720f9`，E53S21 事件）

- **现象**：E53S21 storage 停在 7 万、spawn 74、extension 395、tower 0，全房只剩 3 只爬（无 upgrader），controller 升级停滞，能量循环死锁。
- **根因链（4 个连环问题）**：
  1. **外矿爬抢占 spawn**：`StrategyOuterHarvest` 在 worker/carrier/upgrader 之前执行，外矿 keeper/carrier 先消耗 spawn 能量，能量不足触发 `spawnFailure` 连锁挡住主房所有补员；
  2. **carrier body 过大**：`getCarrierBodyConfig` 只要有 keeper 存在就按满容量配大 body（约 600 能量），低能量 spawn 永远生不出；
  3. **主房 keeper 卡位**：keeper 卡在 (10,5)——与容器相邻但与 source range 2，`goToNearPop` 任务栈每 tick 压栈却永不走动（容器格被占时 `isEqualTo` 死等）；
  4. **carrier 补员条件苛刻**：`avgBusy > 0.85×存活数` 不满足时永不补，`carrierCnt.filter` 还抛 TypeError。
- **修复**：
  - `outerMineStarvesSpawnRoom`：只挡外矿（`roomName != spawnRoom.name`）keeper/carrier 生爬，主房可支配能量 <15 万时缓生；**主房 keeper 是能量源头绝不挡**；
  - `getCarrierBodyConfig`：hive 缺电 >30% 时按实际能量生小 carrier（最小 300 能量）；
  - keeper `moveTo(source, {range:1})` 直走 source 相邻格，容器判断改 `isNearTo(range:1)`（容器格被占也能工作）；
  - `trySpawnCarrier` 紧急补员：carrier≤2 时每 100 tick 补一只，缺电阈值降到 30%，并修复 `carrierCnt.filter` TypeError。
- **验证**：E53S21 恢复——keeper 2→3、carrier 补到 2、upgrader/reserver 复生、spawn 满 300、tower 恢复供电、source 正常挖矿、CPU 18-20（limit 内）、`lastErrorTick` 不再更新（无新报错）。
