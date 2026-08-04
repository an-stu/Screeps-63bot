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

## 五、第二轮优化（2026-08-03 追加）

### 已实施（9 项，全部通过测试）

| # | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| 1 | `manager_missions.js:49` | `setMemoryWithPath` 用 `eval()` 执行跨 shard 可控字符串——任意代码执行风险 + 慢 | 改为安全路径写入（支持 `a.b.c` 与 `["x"]` 两种格式，拦截 `__proto__`/`constructor`/`prototype` 原型污染） |
| 2 | `manager_missions.js:90` | `setFlagMemory` 把整个对象赋给每个键（应为单键值） | 改为 `flag.memory[t] = data.flagMemory[t]` |
| 3 | `strategy_atkL2.js:63` | flag/healer 消失时 `isCrossRoomNearTo(undefined)` 每 tick 抛 TypeError | 加 `(!healer \|\| (...))` 短路 |
| 4 | `manager_planner.js:1085` / `manager_autoPlanner.js:156` | `sort(e=>Math.sqrt(...))` 传距离函数而非比较器，"按距 storage 排序"从未生效 | 改为 `(a,b)=>dist(a)-dist(b)` |
| 5 | `station_sources.js` 注册函数 ×3 | `creeps`/`carryCreeps`/`defenseCreeps` 列表只 push 不清理，死 creep id 随任务重生成无限累积 | 注册时过滤已死亡 id（长度变化才写回） |
| 6 | `strategy_pillage.js:34` | `coverRampart()`（每次 lookFor）在 `structureType==TERMINAL` 判断之前执行，无关建筑白付成本 | 类型判断提前短路 |
| 7 | `strategy_deposits.js:84` | deposit 贴脸失败时每 tick `walkableAroundCnt(true)` ≈ 16-24 次 lookFor | 按 (creep,deposit,tick) 缓存，每 tick 只算一次 |
| 8 | `strategy_tradeCrossShard.js:18,24` | 穿门期间每 tick 全房 find(FIND_STRUCTURES) 找 portal | portal 坐标全局缓存（portal 不移动），未找到才重扫 |
| 9 | `war_cache.js:212-306` | `getMoveAbleCostMatrix` 每次调用全量重建（2500 格地形 + 全房建筑 forEach），战斗多队多旗每 tick 多次 | 静态层（地形+建筑+hasSpawn）按房间缓存 20 tick，每次 clone 后叠加动态层（creep/伤害圈），塔伤走已有每 tick 缓存 |

### 评估后跳过（附理由）

- `helper_cpuUsed.js` recordLongTerm 每 tick 写 Memory：Memory 每 tick 本来就序列化一次（bot 常写），多一个字段无额外成本——不必要。
- `strategy_marketPrice.js` HTML 生成：每 5000 tick 一次，摊薄成本可忽略——不必要。
- `war_teamCore.js` canHoldHeal 跨 tick 缓存：伤害模拟依赖实时位置/血量，缓存会改变战斗决策——跳过。
- `war_teamCore.js` flag._targets 重建：缓存游戏对象跨 tick 会引用过期对象——需重构为 id 列表，风险高——跳过。
- `teamL2.js` 小队无限再生产检查：改动 spawn 行为，需在实战验证——暂缓。

## 六、第三轮：外矿修复与 CPU 优化（2026-08-04）

### 外矿 E52S21 流程（均已部署验证）

| 提交 | 内容 |
| --- | --- |
| `c913cc5` | 外矿全局派发（旗名第二段=供给房间，旗子物理位置=矿区），修复跨房旗子触发 |
| `8123725`+`e473494` | 一次性寻路固定修路路径 + structMap 编码字符串解码 |
| `1a394cf`+`323fdb8` | 路径自研紧凑序列化（Room.serializePath 对跨房路径产生 undefined，弃用） |
| `050e122` | 序列化存储 + 增量路点索引（O(1)）+ 路修完才搬运门槛 |
| `62d9b20` | 修复 TDZ 变量遮蔽（roadTask） |
| `a409857`~`479607f`（Codex） | carrier/keeper 沿缓存路径行走、边界点推进、离线道路自然衰减 |
| `2b9d5a9` | keeper 去程走缓存路径；legacy carrier 出程沿路径交付；repair 仅限路径 road |

### E53S21 经济死锁修复链（均已部署验证）

| 提交 | 问题 | 修复 |
| --- | --- | --- |
| `20bcb7a` | carrier 满载被派去灌 storage，hive 饿死 | hive 需要能量时先填 hive |
| `31f4ea0` | 无 keeper 时 worker 不挖矿（storage≥3000 门槛） | 无 keeper 即让 worker 顶替挖矿 |
| `3182925` | worker 有能量被派去升级/建造而非填 hive | worker 优先填 hive（不依赖 carrier） |
| `c4a29a9`+`086f881` | carrier 身体按容量定（1200）永远生不出 | 按实际能量定身体，最小 300（仅 keeper+carrier 双缺时） |
| `0a7b702` | carrier 取货门槛 1200，container 有货却挂机 | 空手 carrier 300 门槛取货 |
| `f928d55` | **注册死 id 清理条件写回 bug → creeps 永远空 → 无限生 keeper** | 三个 register 函数始终写回 |
| `b2c20d6`+`24e34fd`+`edb4d4f` | 重复 keeper 清理被 spawn 门槛挡住 + spawnTime 污染 | 清理独立前置；spawnTime 净化 |

### 本轮 CPU 优化（`784cb9b`）

线上 avg 20.28ms 超限（bucket 9126 下降）。最大消耗：unitTasks 11.89ms（keeper 3.98 / upgrader 3.01 / carrier 2.55）、rooms 5.44ms。

1. **upgrader**：link/container `findInRange` 每 tick 两次 → 缓存 id，10 tick 重扫（行为等价，扫描减少 ~90%）
2. **keeper**：工地扫描每 tick filter → 9 tick 节流；`dontPullMe` 内存写去抖
3. **结构缓存**（rooms 阶段最大隐藏成本）：`multipleList`/`mass_stores` getter 由逐个 `Game.getObjectById` 改为每房间每 tick 一次 `find(FIND_STRUCTURES)` 映射查找

### 待观察

- CPU 遥测窗口（每 ~97 tick 采样）尚未完全覆盖新代码，avg20 已从 21.6 → 17.8 趋势改善，需持续观察
- PB mission 修复已部署（pending 记录保留 + 校验兜底），等待合格 PB（≥5000 power、剩余≥4200、非 avoid 房间）出现验证

## 七、验证与部署

- `node --check`：全部修改文件通过
- 回归测试：`test/core-profile.test.cjs`、`test/claim-flow.test.cjs` 全部通过
- 全部修改随构建部署到 `default` 分支（shard3 实际运行分支），每步提交可回退
- 外矿 E52S21 全流程上线：scouter → 站注册 → reserver + keeper + carrier，能量回运 E53S21 storage
