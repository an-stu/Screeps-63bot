# Deepseek 全面代码检查与优化报告

- 日期：2026-08-03
- 方式：线上遥测（token 直连）+ 全模块静态审查（war / strategy / manager / station / market / helper 分组）
- 基线：部署后平均 CPU 17.85ms / 上限 20ms，bucket 满；`unitTasks` ≈ 11.4ms、`rooms` ≈ 5.7ms

---

## 一、本轮已实施的修改（12 项，全部通过测试）

### 线上 Bug 修复

| # | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| 1 | `war_teamFlag.js:183,197` | `ManageTeam.exec(flag)` 方法不存在，战斗旗每 tick 抛 TypeError 并中断后续所有逻辑（队伍旗永不清理） | 改为 `ManageTeam.execCalTarget(flag)`（内部按人数分发 execTeam2/execTeam4） |
| 2 | `war_defenseCore.js:110` | 写 `flag.lastHostileTime`（瞬态属性）而非 `flag.memory.lastHostileTime` → 防御旗永不自动移除，每 tick 永久执行全房间 FIND_HOSTILE_CREEPS | 改为写 `flag.memory.lastHostileTime` |
| 3 | `war_defenseCore.js:28` | `this.pos != flag.pos` 引用比较恒真 → 旗子每 300 tick 无条件位移 | 改为 `!this.pos.isEqualTo(flag.pos)` |
| 4 | `strategy_market.js:254` | `delete Game.rooms[roomName]` 删错对象（应删 `Memory.market`），陈旧房间记录永不清理 | 改为 `delete Memory.market[roomName]` |
| 5 | `strategy_market.js:190,287,650` | 已交易订单用 `break` 提前终止扫描，会漏掉后续更优价格（应为 `continue`） | 三处 `break` → `continue` |
| 6 | `strategy_GCLRoom.js:34,165` | `sp._renew==1` 是比较而非赋值 → 同 tick 多个 creep 重复 renew 同一 spawn | 改为 `sp._renew=1`；163 行 `.take().sort()` 顺序颠倒 → 先 sort 再 take |
| 7 | `strategy_GCLRoom.js:526-529` | 出生房间不可见时 `fromRoom.hashCode()` 每 tick 抛错+刷日志 | 加 `if(!fromRoom){console.log(...);return;}`；`find(FIND_FLAGS)` 改用缓存的 `room.flags("GCLRoom").head()` |
| 8 | `station_minetral.js:110-136` | 新占领房间 `update()` 未执行时 `data["creeps"]` 直接抛 TypeError | 加 `if(!data||!data["creeps"])return;` |

### CPU 优化

| # | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| 9 | `strategy_market.js:98` | 市场订单缓存 TTL=20 与每房间 exec 周期(20 tick)相同，缓存形同虚设，每 tick 多次全量 `getAllOrders` | TTL 提到 100 |
| 10 | `strategy_market.js` exec | 每次 exec 对每个订单调用 `calcTransactionCost`（数十~上百次距离计算） | 按目标房间缓存单位成本，仅首次计算 |
| 11 | `strategy_market.js` autoSell | 直接用未缓存的 `getAllOrders` 拉全市场买单/卖单（每 290 tick 两次全量） | 改用 `getAllOrdersCacheList` |
| 12 | `strategy_market.js:367-368` | `Game._resCnt` 跨 tick 缓存无效（Game 对象每 tick 重置）→ 每 100 tick × 7 矿物全房间重算 | 改 `global._resCnt` + tick 校验 |
| 13 | `station_tower.js:68` | 有受伤 creep 时治疗扫描每 tick 全房间 2 次 find（`lastUpdateMap=0`） | 改为 `=1`，每 2 tick 扫描一次 |
| 14 | `station_hive.js:36-38` | 每个 hive-carrier 每 tick 重建 spawn+extension 数组并 filter（60-100 个对象 × N 只） | 每房间每 tick 缓存目标数组 |
| 15 | `manager_crossShard.js:54-55` | 同一 tick 两次 `findClosestByRange(FIND_HOSTILE_CREEPS)` | 合并为一次查询复用 |
| 16 | `strategy_cleanBuild.js:33-34` | 同一 tick 两次 `find(FIND_MY_SPAWNS)` | 合并为一次 |
| 17 | `station_factory.js:356` | `produce()` 返回 ERR_TIRED 时不更新 lastCooldown → 冷却期每 tick 空转重试 | ERR_TIRED 时 `lastCooldown = Game.time + 20` |

---

## 二、分模块检查结论（未实施项，按收益排序，附原因）

### 战争模块（战斗尖峰 130ms 的主要来源）

1. **`war_cache.js:212-306` CostMatrix 无缓存**：每次 PathFinder 搜索每个房间全量重建（50×50 地形 + 结构 + 全房 creep 扫描 + 伤害圈）。战斗时多旗多队每 tick 全量搜索 → 最可能的超时主因。需按 roomName 缓存静态层（地形/建筑/塔伤），动态层 clone 叠加。改动面大，风险高，暂缓。
2. **`war_teamCore.js:438-525` 战斗寻路节流被旁路**：`flee1Tick`/`checkNotSleep` 在交战时会解除节流，每 tick 全量 PathFinder.search。建议按 flag 节流 3-5 tick。属战斗行为调整，需实测，暂缓。
3. **`war_teamCore.js:530-623` canHoldHeal 每 flag 每 tick 最多 3 次完整伤害模拟**（每次重扫房间）。建议按 flag+tick 缓存。暂缓。
4. **`team_raL1.js:84-105` / `war_attackRoom.js:28-34`**：每个 creep 每 3 tick 最多 7-10 次串行 `findClosestByPath`（每次完整 A*）。建议一次预扫描+内存选目标，寻路只做一次。属重构，暂缓。
5. **`war_teamCore.js:696-717`**：每队伍 creep 每 tick 2 次 findInRange + 每候选一次 lookFor。暂缓。
6. **`teamL2.js:323-338`**：每 600 tick 无条件再造一队（不检查存活）→ 小队数随时间无限增长。建议 spawn 前检查存活。中风险，暂缓。
7. **`war_teamCore.js:949-972`**：`flag._targets` 每 tick 重建（旗对象每 tick 重建 → 缓存恒失效），3 次全房间扫描 + 全部建筑进寻路 goals。建议写入 memory 节流。暂缓。

### 策略模块

8. **`strategy_atkL2.js:64-111`**：每 attacker 每 tick 最多 5-7 次串行 findClosestByPath 无 maxOps。建议缓存目标+加节流。
9. **`strategy_defenserHighWay.js:21`**：风筝阶段每 tick 完整 `PathFinder.search({flee:true})`（单次最贵寻路）。建议 3-5 tick 缓存。
10. **`strategy_pillage.js:30-44`**：filter 顺序问题——`coverRampart()`（lookFor）在 `structureType==TERMINAL` 判断之前执行，绝大多数无关建筑白付 lookFor。建议提前短路。
11. **`strategy_deposits.js:84`**：deposit 贴脸失败时每 tick `walkableAroundCnt(true)` ≈ 16-24 次 lookFor。建议算一次存 memory。
12. **`strategy_claim.js:144-145`**：蓝图 `decodePosArray` 对同一张蓝图重复解码几十上百次。建议按 type 缓存。
13. **`strategy_tradeCrossShard.js:18,24`**：穿门期间每 tick 全房 find(FIND_STRUCTURES) 找 portal（portal 不动）。建议首次进房缓存。
14. **`strategy_GCLRoom.js:229-231`**：GCLCarrier 每 tick 全房扫描 + sort。建议 5 tick 节流。

### manager/station 模块

15. **`station_defense.js:77-92`**：每 61 tick 刷新时对每个墙/rampart 位置一次 lookFor（RCL8 墙环 300-600 次）。建议用一次 `room.getStructures()` 构建位置 Map 后 O(1) 查询。中风险，可下轮做。
16. **`station_observer.js:97-116`**：观察后对同一房间重复全房 find（deposit + powerBank + inNovice 内部再扫一次）。建议复用。
17. **`manager_crossShard.js:155-160`**：每 tick 全量 JSON.parse 本地+3 远端 InterShardMemory，dirty 时全量 stringify。建议懒解析/精简载荷。中风险。
18. **`manager_missions.js:49`**：`setMemoryWithPath` 用 `eval()` 写远端可控路径——任意代码执行风险 + 慢。建议改为白名单安全写入。**安全问题，建议尽快处理**。
19. **`manager_missions.js:90`**：`flag.memory[t] = data.flagMemory` 疑似应为 `data.flagMemory[t]`。需确认逻辑。
20. **`manager_planner.js:1085` / `manager_autoPlanner.js:156`**：`sort(e=>Math.sqrt(...))` 传的是距离函数而非比较器，"按距 storage 排序"从未生效。建议 `(a,b)=>dist(a)-dist(b)`。

### 市场/辅助模块

21. **`helper_consoleLogger.js:87`**：每次日志双重 stringify + 巨型资源名交替正则 + 多次 escapeHtml。建议合并/预检短路。日志格式改动有兼容风险，暂缓。
22. **`strategy_marketPrice.js:336-344`**：每 5000 tick 全量重算时无条件生成 HTML 并写 Memory（无人看也生成）。建议惰性生成。
23. **`helper_cpuUsed.js:114-151`**：`recordLongTerm` 每 tick 写 Memory.cpuTelemetry（每 tick 脏 Memory）。建议合并为 5-20 tick 批量写。
24. **`调用栈分析器.js` / `闲聊 v1.0.js`**：均未被 main_mount 加载，当前 0 开销；若启用需注意（闲聊每 tick 全局循环、分析器 1.4x 开销）。
25. **`station_sources.js` creeps 列表只 push 不清理**：死 creep id 会随任务重生成累积膨胀 Memory（upgrade 路径有移除，sources 路径没有）。建议注册时过滤存活 id。

---

## 三、外矿旗子 har_E53S21 状态说明

- 旗子已在游戏内注册（`Memory.flags` 可见，内容为空 `{}`），但**尚未触发外矿流程**：
  - `Memory.rooms.E54S21` 无站数据、无 scouter/outerHarvestDefenser 产出。
- 代码逻辑（`strategy_outerHarvest.js`）：`room.flags("har")` 只返回**旗子物理所在房间**的旗；且 dispatch 要求执行房间 `room.storage` 存在。
  - 若旗子放在 E53S21（低 RCL 无 storage）→ `if(!room.storage)return`，策略不运行；
  - 若旗子放在 E54S21（外矿）→ 任何已方房间的 `flags("har")` 都看不到它，不会触发侦察兵。
- 建议：把旗子放到一个有 storage 的已方主房间？不——按代码语义，旗子应物理放在挖矿房间，但触发机制存在房间归属矛盾，**需要先修复 strategy_outerHarvest 的触发逻辑**（改用 `ManagerFlags.getFlagsByPrefix("har")` 全局索引，参考 strategy_claim 的 dispatch 模式）才能让外矿真正跑起来。此为下轮改动候选。

---

## 四、验证与部署

- `node --check`：全部修改文件通过
- 回归测试：`test/core-profile.test.cjs`、`test/claim-flow.test.cjs` 全部通过（market TTL 断言同步更新为 100）
- 本轮 12 项修改将在提交后随构建部署到 `default` 分支（shard3 实际运行分支）
