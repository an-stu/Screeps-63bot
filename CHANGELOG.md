## v0.78.242 — 外矿 keeper 补上「容器满就停手」闸（主房 0.78.234 那条的遗漏）

- **现场（2026-11-12 巡检，W26N59）**：矿点 (29,5) 容器 `2000/2000` 顶满的三次采样
  （tick 84215307/315/323）期间，源 (29,4) 仍以 **10.3/tick** 下降（584→296/28 tick），
  同格地面堆 2,728→2,840 稳定上涨；空车补员此时在别的矿点，容器要等下一趟才被抽走。
  ⇒ 这一段时间的产量**全部掉在地上按 0.5%/tick 衰减**。
- **根因**：0.78.234 的 `harvestSinkFree` 闸只加在 `harvestEnergyKeeper`（主房），
  `harvestEnergyOuterKeeper` 一直是「源够肥就无条件 harvest」。keeper 站在矿点容器上
  挖矿时产出先落进脚下容器，容器顶满就直接掉地 —— 与 E53S21 那次是同一个形态。
  MEMORY 里「外矿 keeper 不需要 sink 闸」的旧结论来自一次源能量**本来就不动**的采样
  （源低于再生速率线，`(energy+100)/capacity > ticksToRegeneration/300` 恒假，
  根本没走到 harvest），不是「满仓被 ERR_FULL 挡住」。
- **改法**：外矿 keeper 加同一语义的闸 —— 自己身上有余量、或脚下容器有余量，任一成立
  才挖；两处全满就停手（源里的能量留着不会烂，容器被抽空后自动恢复）。
  **不判 link**：外矿房没有 `stationUpgrade` 记忆，link 永不转出，把「link 没满」算成
  sink 等于恒真（W26N59 三个 link 常年 0 能量且从不接收）。顺带给 `source` 补了
  空值守卫（原来 `source.energy` 在矿点对象丢失时会每 tick 抛 TypeError）。
- **未改**：harvest 的节流节奏、`ticksToLive % 7 < 2` 的捡拾/维修旁路、任何 spawn 优先级。
- **回归**：新增 `outer-keeper-sink`（6 组：满容器满仓**必须不挖** / 容器有余量照挖 /
  自己有余量照挖 / 无容器不锁死 / 源太瘦仍不挖 / 满容器下维修照跑）；
  **剥掉闸的变异负对照已验证**（第一组如实失败）；75 个测试 + core task audit
  （77 任务 / 212 handler）全绿。

## v0.78.241 — OP_STORAGE 容量悬崖：付不起就不挂任务 + OP_SPAWN 让出预算 + 阈值同源

- **现场（2026-11-12 巡检「必须处理」）**：W31N55 storage `4,741,167 / 1,000,000`，
  `getFreeCapacity()` = **-3,741,167** —— 效果过期后容量从 5M 掉回基础 1M，仓里 4.7M
  资源（7 种 T3 强化化合物 + 33854 power）不会消失，于是整仓**再也进不了货**。
  该房唯一的 PC `P7` 只有 46~52 ops，而 `usePower(PWR_OPERATE_STORAGE)` 成本是 **100**。
- **根因（两层）**：
  1. `needOpStorage` 只看「用满 95 万 + 效果快没了」，**不看付不付得起**。OpStorage 对
     `ERR_NOT_ENOUGH_RESOURCES` 是弹栈 → 每 3 tick 挂一次、下一 tick 必然失败弹掉，
     PC 整个周期耗在这条注定失败的重试上（实测 tasks 恒空）。
  2. 同一个决策有两个阈值：`strategy_GCLRoom` 写的是「storage **能量** > 90 万 + ops >= 100」，
     `needOpStorage` 写的是「**已用容量** > 95 万」。对 T3 储备房（能量 14 万、化合物 4.7M）
     第一套**恒假** ⇒ 断档后再没人扩容量 = 自锁。
- **改法**：
  - `needOpStorage` 增加 `store[ops] >= POWER_INFO[PWR_OPERATE_STORAGE].ops` 的前置检查；
    拦掉后 PC 继续用 `GENERATE_OPS` 自产（4 级 6 点 / 50 tick），攒够 100 自动重开闸。
  - 新增 `storageOnCapacityCliff()`（`getUsedCapacity() > OPS_STORAGE_CLIFF_CNT=950000`），
    `needOpSpawn` 在悬崖边上要求 `200 + 100`：一次 OP_SPAWN 花掉的 100 ops ≈ 该 PC
    900 tick 的全部收入，换来的只是孵化提速 10~40%，不能挤掉容量悬崖的刷新预算。
  - `strategy_GCLRoom` 的 OP_STORAGE 分支改为复用 `pc.needOpStorage(room.storage)`，
    删掉「能量 > 90 万 / ops >= 100」两处重复判据。
- **未改**：`needOpPowerSpawn`（用户指定的烧 power 链，另有 400 ops + 600 库存双重门槛）、
  任何 spawn / 外矿的优先级顺序。
- **回归**：新增 `op-storage-cliff`（付不起拦停 / 边界 100 / 无悬崖不放宽 / **剥掉判据的
  变异负对照** / 95 万只出现一次 / OP_SPAWN 预留 250-300 边界 / GCL 旧阈值已删），
  74 个测试 + core task audit（77 任务 / 212 handler）全绿。
- 待决策（沿用）：W31N55 缺 ops 的**供给**问题本身没修 —— 该房 terminal ops=0，而
  `RESOURCE_OPS=3000` 的平衡阀要求发送端 terminal 满格且运费够，实测没发过来。
  要不要给 OPF 房做一条「PC 施法预算」专用补 ops 线（powerSpawn.process 或定向 send），
  属于战略选择，先报用户。

## v0.78.240 — RoomVisual 缓存按 tick 失效 + MODULES.tsv 重新生成（两项低风险清理）

- **helper_visual.getRoomVisual 跨 tick 静默不渲染**（CODE_REVIEW 4-2  flagged，9 月审查遗留）：
  `roomMap` 是模块级永久缓存，`new RoomVisual(...)` 只在房间名第一次出现时创建。引擎的
  RoomVisual 只收集**创建当 tick** 的绘制指令，复用上一 tick 的实例画什么都不显示 ⇒
  每个房间第一次之后的塔伤面板 / showText / showLine / showPath 全部静默失效。
  目前线上 `cpuFeatures.visual=false` 所以休眠，一开可视化就会踩到。
  改法：缓存按 tick 失效（`roomMapTick !== Game.time` 时重建）——同 tick 复用省 CPU，
  跨 tick 重建保渲染。showRoomStructures 本来就每次 new，不受影响。
- **MODULES.tsv 过期**（同审查条目）：原索引是 7 月快照，列着磁盘/线上都不存在的
  `调用栈分析器.js`，缺 helper_consoleLogger / helper_consoleDashboard / helper_telemetrySegment
  等新模块。按当前部署 payload（73 模块，与线上 default 分支一致）重新生成，
  口径沿用「模块名 + 部署内容长度」，WASM 二进制模块按 binary 串长度计。
- 回归：新增 `visual-room-cache`（同 tick 复用 / 跨 tick 重建 / 对象与房名归一 /
  showText 端到端 / 永久缓存变异负对照）；72 个既有测试全绿。
- 运行时影响面：visual 开关关闭时零行为变化；开启后可视化恢复渲染。TSV 纯文档。

## v0.78.239 — 外矿运力动态平衡：修路编制按工地派 + 在途车占编制（5 只车对 2 只需求）

- 现场（2026-11-12，用户报「外矿运力过剩」）：W26N58 → W26N59 两个矿点，运输需求按公式
  `ceil(pathTime×2×产出/50)` = 32 + 26 = 58 CARRY ≈ **2 只** 32 CARRY 的车；实际车队 **5 只**
  （160 CARRY，全是 2WORK+32CARRY 修路体型）。容器 272/360 近空、地面无掉落、源 1592/2024 健康
  —— 车在等货，不是货等车。`__outerWhy=noFreeSpawn` 说明补员还在试图加车。
- 根因两条，都在 `trySpawnOuterHarCarrier` 的修路分支：
  1. **编制盲点**：`builderCnt < OUTER_ROAD_BUILDER_CNT(2)` 只数已登记（carryCreeps）且寿命够的
     WORK 车。登记发生在爬抵达矿房执行任务时，而孵化 150 tick + 赶路 ~80 tick 的窗口里新车不可见
     ⇒ 每个 economy pass 都判「不足 2」继续派。2026-10-30 给运输路径修过的「在途扣减」
     （`roomCarriers` 按 headTask 目标矿点折算）这条分支漏了。
  2. **阈值不同源**（MEMORY 第 3 条）：修路编制拿 `outerRoadComplete`（50% 血线）当判据，而沿途
     维修的触发线是 25%（前瞻）/90%（本格）。路线 95% 完工、只剩主房出口 3~4 个高流量格落在
     26~47% 衰减带、**没有任何工地**时，roadComplete 恒假 ⇒ 每矿点永久要 2 只专职修路爬。
     而这些衰减格本来就有在岗 WORK 车沿途修（运输补员的体型选择保证每矿点 ≥1 只 WORK）。
- 改法（阈值、运输需求公式、让位闸、优先级一律未动）：
  1. 新增 `outerRoadSiteCount(data)`：只数缓存路线路点格上的 road 工地（与 nearestOuterRoadSite
     同口径）；任一路线房无视野返回 -1，调用方退回旧判据，盲飞行为不变。
  2. 修路编制 `builderNeed = 有工地 ? OUTER_ROAD_BUILDER_CNT : 0`；`builderCnt` 增加在途/在孵
     WORK 车计数（headTask 目标矿点键，与运输路径在途扣减同源）。
  3. 运输补员的体型选择 `carrierBuildCreep` 同样把在途 WORK 车算作「已有修路覆盖」，
     有 WORK 在途时造普通体型，不再重复造修路体型。
- 收敛路径：不杀在役车（避免浪费已投孵化能量），超编车自然老死、补员只按真实缺口派 ⇒
  车队在 ≤1500 tick 内收敛到运输需求（~2 只，每矿点 ≥1 只 WORK 负责沿途修路）。
  路格烂穿出现工地时编制自动恢复 2 只/矿点，修完即回落 —— 自纠正闭环。
- 回归：新增 `outer-builder-balance`（无工地不派专职修路爬 / 有工地恢复编制 / 在途 WORK 占编制 /
  在途 WORK 使运输补员造普通体型 / 无视野退回旧判据 / 负对照逐条验证）；71 个既有测试全绿。

## v0.78.238 — 无 OPERATE_POWER 效果时复位烧制窗口状态（powerBurning / powerBurnCredit 残值）

- `tryProcessPower` 的 `!fx0` 分支（没有 OPERATE_POWER 效果 ⇒ 按普通速率烧）直接 `return`，从不清理**只在 `fx` 分支里写**的 `Memory.marketSettings.powerBurning` / `powerBurnCredit`。效果一过期，这两个值就永久挂在 Memory 里。
- 现场（2026-11-11 21:00，`check-status` 两档全绿之后的深探）：13 个 powerSpawn **一个效果都没有**，Memory 仍是 `powerBurning=true, powerBurnCredit=8112`。
- 两个后果都正好抵消这套闸的设计意图：
  1. `generatorFillPowerSpawnTask` 的 `wantBurn` 吃 `!!msC.powerBurning` ⇒ 试点房（W32N56）永远走「30k 就灌料」分支，哪怕它此刻不被授权烧（storage < 15 万开闸线）；
  2. 下一个窗口开局 credit 已有 8,112（≈32 发满速）⇒ 「把一次效果摊到整个 duration」的配速在最需要它的时刻失效，一开窗就按满速抽水。
- 改法只清状态：`!fx0` 分支入口先 `ms.powerBurning = false; ms.powerBurnCredit = 0;`，且放在**所有** return 之前（含 `powerSpawnOtherRooms=false` 的房 —— 状态属于窗口、不属于房）。阈值、配速公式、开闸线、试点房分支一律未动。
- 一致性：真实窗口内 `tryProcessPower` 先跑并置 `powerBurning=true`，`wantBurn` 随后才读，所以 10 万~15 万恢复带内的试点房照旧灌料；窗口外残值不再有权开闸。
- 回归：`power-spawn-burn` 新增 3 组（无效果必须复位 / 关闭开关的房也要复位 / 新窗口首 tick 不许沿用旧 credit 满速），`power-spawn-fill-gate` ④ 改为真实效果窗口、新增 ⑥ 残值负对照；去掉这两行复位，三处用例如实失败（已逐条验证）。71 测试 + audit 77/211 全绿。

## v0.78.237 — powerSpawn 灌料闸的 power 下限与烧制侧同源（0.78.229 漏掉的那一半）

- 0.78.229 只统一了**能量**口径（灌料 17 万 / 烧制 15 万 → 同一个 `openC`），power 口径仍留叉子：灌料要「全房 power > 1000」，而 `tryProcessPower` 只要 `> powerSpawnLow`（默认 100）、`StrategyHighLevel.processPowerSpawn`（第二条烧制路径）只要 ps 里有 ≥1 power。
- 后果：storage ≥ 15 万而全房 power 落在 1~1000 的房「被烧、不给补」——ps 的 100 power 库存 100 tick 烧空后 `processPower` 恒 ERR，5,000 能量缓冲一起晾在泵里，直到全房 power 重新 > 1000 才解冻。
- 现场（2026-11-11 19:50）：W32N56 6,079 / W33N55 6,048 / W34N52 6,001 / W33N53 5,953 power，四房都在往下烧，掉进 1000 以下只是时间问题。
- 改法只把 `fillGate` clause1 的 power 下限 `> 1000` 降为 `> 0`（有 power 就灌），能量闸、`powerSpawnLow`、`powerSpawnOpenEnergy`、试点房分支与烧制节奏一律未动。
- 回归：`power-spawn-fill-gate` 新增三组 —— storage 20 万 + power 500 必须有补料任务、power 0 必须空表（行为负对照）、源码断言 clause1 不许再出现 `powerCnt > 1000`；退回旧门槛时用例 ⑥ 如实失败，已逐条验证。

## v0.78.236 — RawMemory 段遥测镜像，Grafana Cloud 直读无需本地进程

- 新增 `helper_telemetrySegment`：每 10 tick 把运行遥测写入 RawMemory 段 90，供 Grafana Cloud 的 Infinity 数据源直接读取 `/api/user/memory-segment`（Memory API 全量 gz 压缩，Infinity 无法解压；段接口返回原始字符串）。
- 段内容：`latest` 快照（tick、CPU/均值、bucket、爬数/power creep、错误数、GCL/GPL 百分比与等级、阶段/角色/分房 CPU、storage+terminal+factory+lab 资源汇总）+ `rows` 环形历史（600 行 × 7 列，约 6000 tick）。
- 成本控制：只在 `Game.time % 10 == 0` 写入，整段约 30-40KB；资源汇总只扫核心库存建筑；写段异常全部吞掉，不影响主循环。首个 tick 先 `setActiveSegments([90])`，避免首周期丢写。
- 新增回归：段激活时机、10 tick 节奏、latest 字段与资源聚合、环形上限裁剪、global 重置后从段恢复、异常不冒泡。
- 面板侧：Grafana Cloud 仪表盘改用 Infinity 直读段数据（本地面板进程仅作参考，可停用）。

## v0.78.235 — CPU 第一批：可证等价减负 + keeper 工地查表

- 任务栈访问器（headTask/lastTask/lastTaskObj/headTaskObj/headTaskFlag）与数组 head/last 改直接下标，空栈/稀疏/含假值元素与 lodash 语义逐例一致；find/sum/contains 覆盖本批未动（动态谓词/thisArg/稀疏审计未完成）。
- PC 策略每 pass 只求值一次 `StationFactory.needPower`（纯读；会改任务栈的停车抢占分支要么提前 return 要么不进 isFree 链，复用安全），停车抢占顺序保留；needOpTower 与 PC 待命敌情改用房级 tick 缓存 `getHostileCreeps`，敌对 PowerCreep 仍单独查询。
- registerStationSources / registerStationSourcesDefenseOutRoom 的三次 headTask() 合为局部变量，空栈抛错语义不变。
- 极致建筑缓存的 resolved map 与 Hub 复用 `room.getStructures()` tick 缓存，不再自行 find(FIND_STRUCTURES)；structure-cache 测试夹具按生产契约补 getStructures。
- 外矿修路爬非边界格不再做全路径边界扫描（core-profile 锁定字面量 `this.pos.isBorder() && borderIndex.dist == 0` 原样保留）。
- keeper 工地查找改每房每 tick「tile→最早列表序号」索引，O(9) 邻格查表替代无邻接工地时每 tick 的全房 `.find(isNearTo)`；多工地/同格/房间边缘均取列表最早者，与 .find 完全同果；keeperCsId 值变才写，9 tick 重扫节奏与 build>修容器>修 link 优先级不变。
- 新增 cpu-batch1-equivalence 与 keeper-site-index 两组回归：旧/新实现同输入差分（含 500 轮随机布局）、扫描计数、逐项负对照（改回旧实现或破坏排序必须 fail，已逐条验证）。70 测试全过，audit 77 生成点/211 处理器。
- 收益为方向性估计，待上线后按同 schema 同 startTick 的 24-48h 遥测增量核验（见 qoder.md v2 验收口径）。

## v0.78.234 — 主房 keeper 满仓无处倒料时停手，不再把矿倒在地上衰减

- 主房 keeper 站在矿点容器上挖矿时，自己满仓后的溢出先进脚下容器，容器也满就直接掉在地上衰减。RCL8 房 0 只 upgrader 时 link 链条是死胡同（升级 link 没人抽 → hub link 永不清空 → 矿点 link 恒 800），容器一旦被顶满，此后每 tick 的产量都是纯损失：E53S21 容器 2000/2000 + link 800/800 时地面 26/tick 稳定上涨。
- 新判据只看当 tick 的溢出有没有地方去：自己身上有余量、矿点 link 没满、或脚下容器还有余量，任一成立就照常挖；三处全满才停手。源里的能量留着不会烂，容器或 link 被抽空后自动恢复。
- 采矿节奏、link 转出、容器取货、建设维修优先级与 bucket 降频一律未动；回归新增四组闸门用例（饱和停手 + 三种单出口仍挖），并带「去掉闸门即失败」的负对照。

## v0.78.233 — 主房搬运与采矿减负，PB 历史强化常驻

- PB 历史遇袭记录永久提高目标房所有波次的强化优先级，优先 L2，化合物不足时按库存降级。是否跳过补波间隔和常规波次限制，仍只看当前可见威胁。
- 主房 carrier 先检查取货对象和负载，再决定是否移动。途中只提交移动，抵达才调用 `withdraw`。源容器派工沿用满载门槛，跳过取不到货的任务，保留 hive、link、Terminal 储备及任务优先级。
- Hive 补能直接在缺能建筑缓存内选择最近未预约目标，保留同距顺序，无需再次创建候选数组。
- 能量 keeper 抵达作业位后才解析 link，并减少工地检查的重复工作。采矿节奏、补 link 和建设维修优先级保持不变。
- 回归覆盖 PB 后续波次强化及安静时的上限、carrier 途中和抵达行为、Hive 目标预约、keeper 采矿与施工。

## v0.78.232 — 外矿运力登记与 PB 遇袭状态分离

- 外矿 carrier 换绑矿点时同步迁移 `carryCreeps` 登记。补员统计会剔除已经换绑的旧登记和同源重复项，避免旧矿点把别处的车算作本点运力。
- PB 历史遇袭只提高首波强化优先级，优先 L2，资源不足时按可用强化降级。只有当前可见、在 PB 附近且仍有攻击部件的玩家 creep 才会解除常规补波限制。威胁消失后恢复正常间隔与波次限制，已排队的队伍仍按原顺序孵化。
- 外矿防守、拆 core 和拆塔复用同一 tick 的敌对对象缓存。PB 在无任务或无需补员时提前返回或跳过孵化检查，避免重复扫描和计算。
- 回归覆盖 carrier 换绑与历史旧登记、PB 首波强化与威胁解除、外矿防守读取同 tick 缓存。

## v0.78.231 — 按矿点让位、矿物应急停采与外矿危路维修

- Power Bank 孵化按本房每个能量矿点的实际登记判断。活着或在孵的 keeper 只覆盖它登记的矿点。缺员时保留 PB 队列并让出 Spawn，覆盖恢复后继续派发。
- 主房矿物 keeper 的孵化和采集共用应急上限。`Memory.mineralSettings[资源].stop` 比较本房 Storage、Terminal 与矿物容器的合计库存。库存低于上限会恢复，`0` 可停采，未配置时仍按市场价格判断。
- 外矿搬运爬能提前维修缓存路线内三格以内、耐久低于 25% 的道路。`StructureRoad` 没有 `my` 属性，路线外的道路不参与判断。
- `Memory.codeHealth.version` 记录实际运行版本，供 MCP `status` 和发布后核验使用。
- 同步 Screeps MCP 1.2.0。默认使用只读遥测，控制台命令只提交一次。部署预览绑定本地产物和线上分支的哈希，正式部署先备份再上传，并回读指定分支。市场挂单和协议错误处理也已修正。

回归覆盖 PB 两个矿点在换班时的队列让位与恢复、矿物库存边界及降库存后的恢复、缓存内外道路维修，以及 MCP 的只读权限、取消请求、部署备份失败和分支回读。

## v0.78.230 — PB 让位闸：出兵房自己的矿点没人挖时不许再抢 spawn

巡检发现 E53S21 的**第 2 个矿点（bc20）已经 ~740 tick 没有 keeper**（`spawnTime=84177216`
之后 `creeps: []`），矿点容器 2,000/2,000 顶满、矿点 link 800/800（bc1e 那一侧）、
keeper 把能量往地上倒（地面 2,502→3,427 在涨），而该房 storage 只有 3~5 万还在掉。

根因不是 keeper 判据，而是 **PB 把 spawn 100% 吃掉造成的自锁**（MEMORY 第 3 条）：
`dispatchPBSpawnQueue` 跑在 `exec` 的 `%3` 闸门**之前**、每 tick 一次 ⇒ 任何一个 spawn
空出来就立刻被 PB 填走；而主房 keeper 补员只在 economy pass（`%7`，bucket<5000 时 `%14`）
里试一次 ⇒ 永远抢不到。实测 26 tick × 10 次采样，E53S21 的 3 个 spawn `idle=0`
**一次都没空过**，全是 PBer；keeper 恒为 1。触发条件是 `Memory.powerBankAttackedRooms`
（永久记账，0.78.222）把 E52S20 整场标成被打 ⇒ `needSpawn` 恒真 ⇒ 波次不设限，
而此刻目标房**已经没有袭击者**（0 hostiles，窝还剩 242,858/2,000,000 血）。

修复：新增 `spawnRoomMiningBroken(room)`，在**两处**让位（`exec` 的 `needSpawn`、
以及每 tick 的 `dispatchPBSpawnQueue` 派发前）。判据读登记表而非 `find(FIND_SOURCES)`
（在每 tick 路径上，不扫全房），**两个条件同时成立**才算破：① 登记矿点里有一个没有
任何活着的采集者（在孵的接班人也算有人）；② 本房在岗+在孵 keeper 数 < 登记矿点数。
keeper 一到岗，下一 pass 自动恢复。**波次上限、T2 强化、被打就补的策略、spawn 优先级
一律没动**，只是多了一条状态闸 —— 不让可选的军事支出把本房的挖矿饿死。

测试 `test/pb-yield-to-unmanned-source.test.cjs`：线上那一幕必须让位；keeper 数已够
（负对照，只判「某矿点 creeps 空」的实现在这里挂）、在孵接班人、死 id、无登记表、
单矿点房不误报、两处调用点与顺序（闸在 `trySpawn` 循环之前）、不许删旗/改上限。
变异验证：判据改成 `return true` 与去掉「无人」条件，两种改法都被测试咬住。

## v0.78.229 — powerSpawn 灌料闸与烧制闸同源（15~17 万死区互锁）

巡检发现两个非试点房的 power spawn 长期空转：W33N53 storage 能量 168,694、
powerSpawn 能量 31↔1,181 反复；W33N55 storage 168,762、powerSpawn 能量 **1**、power 59。
两房的 `roomMassStoreCnt(power)` 都是 5,9xx，都恰好落在闸门内侧一点。

根因是**同一决策的两层阈值不同源**：
`tryProcessPower` 的开闸线是 `powerSpawnOpenEnergy`（缺省 `floor+50000` = 15 万），
而 `generatorFillPowerSpawnTask` 的非试点分支写死 `energyCnt > 170000`。
15~17 万之间的房间于是「被授权烧制、却不给补料」：powerSpawn 的 5,000 能量缓冲
（100 tick × 50/tick）烧完就归零 → `processPower` 需要 ≥50 能量，从此每 tick 白调；
而 storage 又再也翻不过 17 万 ⇒ **两只闸互锁、永久停摆**（MEMORY 第 3 条）。
烧掉的那 5,000 缓冲正是「它确实曾经在烧」的铁证。

修复：灌料线改用与烧制闸同源的 `openC`（`powerSpawnOpenEnergy` 或 `floorC + 50000`）。
**阈值本身一个都没动**（10 万停烧 / 15 万开烧原封不动），试点房 W32N56 的
`energyCnt > 30000` 分支也不动。测试 `test/power-spawn-fill-gate.test.cjs`：
死区 16.8 万必须补料（复现即题）、14.5 万负对照必须空表、旋钮同源双向验证、
试点房不受影响、源码禁止再写死 170000。
## v0.78.228 — keeper 补员不再清掉本 tick 的孵化预算缓存（spawn 白丢一个 pass）

巡检复盘 `trySpawnOuterHarKeeper` 时发现：`trySpawn` 前留着一行
`spawnRoom.currentEnergyAvailable = undefined;`。它是 2026-10-30（06fc3725）
从 carrier 路径照抄的「两个缓存一起清」，而 2026-11-05（9542722）已经证伪了清预算
那半边并删掉了 carrier / 外矿搬运两条路径的同一行 —— **keeper 这条漏了**。

`currentEnergyAvailable` 是本 tick 的孵化预算缓存（首个 `trySpawn` 初始化、每次成功
孵化扣减），而 `room.energyAvailable` 在**同一 tick 内不反映刚花掉的能量**
（9542722 实测：孵完 2,200 的 worker 后读回仍是 2,300）。清掉它 ⇒ `trySpawn` 用旧
满格值重新初始化 ⇒ 同一 economy pass 里排在 keeper 后面的角色（carrier / upgrader 走
`spawnTickBudget = min(energyAvailable, currentEnergyAvailable)`）都按**虚高**预算定体型
⇒ `spawnCreep` 被引擎以 ERR_NOT_ENOUGH_ENERGY 拒绝、`spawnFailure` 置真 ⇒ 该角色白丢
一个 pass。keeper 补员（每只 keeper 每 1,500 tick 一次、全场 ~28 只）正是这条路径，
所以它一直在稳定地给 carrier/upgrader 制造一次性失败。

修复：keeper 补员只解粘滞的 `spawnFailure`，**不清** `currentEnergyAvailable`
（与 `station_upgrade.js` / `strategy_highLevel.js` 同一结论，也回到 MEMORY 第 6 条）。
调用顺序（keeper → carrier → 外矿 → upgrader）与任何优先级都没动。

测试：`test/keeper-spawn-budget-cache.test.cjs`（源码断言 + 行为断言 + 内建负对照：
把那一行加回去时，后续角色读到的预算 2,600 vs 真实余量 400，必须虚高）。

## v0.78.227 — upgrader 数量闸门补「换代提前量」：即将老死的那只不再占用配额

巡检实测（2026-11-09 23:0x，W26N58 RCL7、双 spawn、hive 满 5,600）：两只 upgrader
的 `ticksToLive` 分别是 **152** 和 936，storage 能量 ~85,000 ⇒ 数量闸门
`(85,000 - 35,000) / 30,000 = 1.67` 对**裸计数 2** 判成「够了，不补」。

于是那只 ttl 152 的老死后裸计数才变 1、才放行，而孵一只 50 部件（30 WORK）要
`50 × 3 = 150` tick —— 这 150 tick 里整房只有一只 upgrader 在产（实测控制器速率
从 ~115/tick 掉到 ~55/tick）。外矿 carrier 早就用
`ttl > body.length*3 + pathTime + PRESPAWN` 的口径（0.78.x 换代替换），upgrader 漏了。

修复：新增 `StationUpgrade.upgraderCoverageCount(room)`，
`ttl > body.length*3 + 50` 才算有效在岗（孵化中的算、缺字段的桩保守算），
RCL<8 的数量闸门四处（0 只兜底 / 必产 flag / 盈余配额 / storage 富余必产）
全部改用这个计数。判据只提前「该派的时刻」，**不改调用顺序**
（keeper → carrier → 外矿 → upgrader）；稳态下仍是同一只替换同一只，不增加净能量消耗，
storage 配额为负时照旧不许硬抽（有测试兜底）。

测试：`test/upgrader-replace-coverage.test.cjs`（7 组，含负对照 —— 换回裸计数时
现场必须孵不出来）。

## v0.78.225 — 外矿「卡住计数」自锁：搬运爬在边境弹跳 450 tick 后永久不走缓存路线

巡检实测（2026-11-08 01:5x，W26N59 刚重启）：唯一的外矿搬运爬
`shard3_84131356_1` 在 W26N58(13,0) / W26N59(13,49) 边境**来回弹跳约 450 tick**
（`lastPos.time` 冻结在 84131725，期间容器 0、矿点 0 出货），任务上的
`outerRoadStuck` 一路涨到 **197**。

根因（两处，都是「闸门自锁」，MEMORY 第 3 条）：

1. **计数只比「同一格 + 同一路点」，不要求连续 tick**。车在边境两格之间弹跳时，
   每隔一拍才回到同一格、指向同一路点，计数照样 +1 —— 但它明明在动。
2. **越过 `OUTER_ROAD_STUCK_INVALIDATE`(25) 之后计数器不归零**。之后**每次**调用
   都在函数第一道闸直接 `return ERR_NO_PATH` ⇒ 调用方 `moveOuterCarrierOnRoad`
   每 tick 判「路线不可达」并 `invalidateOuterRoadPath`（共享路线被反复作废/重算），
   车永久退化成原生 `goTo`，再也走不回缓存路线。计数又永远不降 ⇒ 只有重新孵化
   才能恢复。

修复：`moveToOuterRoadPoint` 记录 `outerRoadStuckTick`，**只统计连续 tick**
（`Game.time - 1`），非连续即归零；判过一次 `ERR_NO_PATH` 后立刻把计数清零，
让下一轮从 0 重新数（重算路线是调用方那一 tick 的动作，不需要永久记住）。

验证：新增 `test/outer-road-stuck-latch.test.cjs`（59/59 全绿）——
① 连续 5 tick 卡住计数=4 且继续尝试移动；② 隔拍调用 60 次计数恒为 0、
永不返回 ERR_NO_PATH（现场形态）；③ 连续卡满 INVALIDATE 只判一次，之后必须
能重新开口；④ 负对照：把两处修复退回源码变体，②的序列必须真的锁死
（最后一次仍是 ERR_NO_PATH）。部署后实测该爬已恢复：13,0 → 21,35 → 28,6
每 tick 一格正常行进并装到 940 能量。

## v0.78.226 — 外矿 carrier 动态平衡：空车自动换绑到有货的容器

用户指示（2026-11-08）：「外矿 carrier 爬好像有点不平衡，检查一下，动态平衡」。

**检查确认的不平衡**（W26N59 实测）：carrier 与源**静态绑死**（生成时 taskOutView
写死源 id，每车永久服务一个源），负载不均/重启期会摆出「源1容器 1896 满仓压着
keeper 停采、源2容器 16 空仓养着闲车」的错位——绑到源2的车在空容器边等，绑源1
的车来不及拉。运力总量 4 车 × 1,600 ≈ 80/tick，远超全矿流入 16/tick，问题不在
车少，在**绑错位**。

**修复**（harvestEnergyOuterCarry 空手分支最前）：空手 + 绑定容器 <400 能量 +
同房另一矿点容器 ≥800（≥半整车）⇒ 任务**就地换绑**（id/x/y/stationId 一起改，
roadBuilder 子任务同步，returnPathIndex 作废走新路），换绑后立即按新绑点行动。
阈值 800 防抖：两边都低时不动，两辆空车不会互相倒腾。
测试：outer-carry-dock ⑤（换绑三断言：carry.id/坐标/roadBuilder.stationId 同步
+ returnPathIndex 作废 + 立即行动）+ ⑤b 防抖负对照（另一容器 300 <800 不换绑）；
edge-link 两个 creep mock 补 storeEmpty（新闸门调用的既有方法）。

## v0.78.224 — 外矿边境不再用裸 move(exit) + 弃坑废墟塔不拆

用户两项指示（2026-11-08）：

1. **「inactive 的 tower 等建筑不用拆，没用的」**：W26N59 是玩家 skyfox 弃坑的房
   （controller 无主），他的 spawn/塔/extension 全部失效（塔没有主人的控制器就
   开不了火）。但 `spawnTowerBuster` 用 `FIND_HOSTILE_STRUCTURES` 抓塔——把这种
   废墟塔当成 invader 塔派了只 [A15,H10,M15] 白跑。修复：只有**塔的主人还控制着
   房**（`controller.owner == tower.owner`，能开火）才算真威胁；弃坑废墟直接跳过。
   线上那只已派出的 towerBuster 经控制台撤任务转回收。
2. **「外矿 carrier 在对应 container 能量不足的时候也靠近 container，不要卡在
   边界堵路」**：边境跨房的裸 `move(exit)` 在**对面落点格被占**时返回 OK 但移动被
   引擎静默取消（与单格 move 同一个坑，边境分支漏改）——W26N59 重启实测
   carrier 84131356_1 在出口格 (13,0) 趴了 500+ tick，把 reserver 84131510_2
   （卡死计数满格 + dontPullMe）和整条走廊堵死。修复：`moveToOuterRoadPoint` 与
   `stepFromOuterRoadPoint` 的跨房分支全部改 `moveTo(路点)`——BetterMove 处理
   落点占用（对穿/让位/等待）；空车进矿后由房内既有 hold 逻辑接管，自动停在
   container 附近的路线外待命位。
测试：sticky-spawn-failure ⑥ 重写（inactive 不派 / active+付不起不派 /
active+付得起照常派），core-profile 新增「边境不得裸 move(exit)」源码 pin。

## v0.78.223 — 被打房永久记账：收过攻击的 PB 目标房直接 T2，不再等检测

用户指示（2026-11-07）：「补太慢了来不及，你直接检查收过攻击的房间，然后直接这些
房间都用 T2 强化就行」。

0.78.221 的检测依赖**当下视野**——PB 房只在 observer 扫到时可见，袭击瞬间常常无
视野，等看到再补波已经来不及。改为**记账制**：

- 检测到玩家袭击时，目标房写入 `Memory.powerBankAttackedRooms`（{user, tick}，
  永久，不设过期）；
- 每 pass 对每个 PB 旗检查目标房是否在账上：在 ⇒ `beingAttack` 强制置真 +
  `lastSpawnTime=0` 立即补波 ⇒ 走 0.78.221 的被打分支（L2 > L1 > DAMAGE，波次
  不设限），**从第一波起就是 T2**，不再从 L1 爬坡。
- 存量任务同步生效：`powerBank_E49S31_E46S30_30_23`（被 Apple 打过）部署时经
  控制台把 E46S30 记入账本，下一 pass 即 T2 补波。
测试：power-bank-respawn ⑤c 源码 pin（记账写入、每 pass 查账、beingAttack 强制、
lastSpawnTime 归零）。

## v0.78.222 — 修墙配对把唯一 worker 锁死在无底洞上：有工地时不配对

0.78.220 上线 4 分钟后的巡检实测（W26N58，RCL7）：**6 个工地合计 26.5 万进度，
连续 450+ tick 一丝不动**，而同房唯一那只 50 部件 worker 正在修一面
`rampart 369,921 / 100,000,000` 血。`room.find(FIND_CONSTRUCTION_SITES)`、缓存、
`StationWork.constructionNeedBuild()` 三项都对（6 / 6 / true），瓶颈不在工地侧。

根因：0.78.220 的空手配对把 `repairWall` 压在栈底、取能压在栈顶。`repairWall`
只在**能量归零**或 `hits >= hitsMax` 时弹栈，而本房 rampart 的 `hitsMax` 是 1 亿、
`levelWallHits[7]` 只有 500 万 ⇒ 弹栈后又是空手 ⇒ 又命中配对 ⇒ 又压一层
`repairWall`，**每趟循环都被重新绑回墙**，永远走不到 loaded 分支的
`constructionNeedBuild → generatorBuildTask`。修墙是无限下沉、工地是有限消费，
这正是「先满足有限上限的，再给无限下沉的」被破掉的情形。

修复：空手侧的修墙配对加 `!StationWork.constructionNeedBuild(buildRoom)` 前置 ——
有工地就只取能，装货后由 loaded 分支接走 build（该分支 **本来** 就把工地排在
修墙之前，这里只是让空手侧与它同序）。无工地时配对照旧，0.78.220 要消的
「取完等下个 pass」空窗不受影响。
测试：worker-full-employment ⑪ 新增（工地 + 墙缺口同时成立 ⇒ 只有 carryRes、
无 repairWall；负对照去掉闸门即失败），⑨ 加源码 pin，①⑧⑩ 原钉不破。

## v0.78.221 — PB 被打自动升阶：玩家袭击 ⇒ 一直派更高一级小队（L2 不再受白名单锁）

用户报告（2026-11-07）：任务 `powerBank_E49S31_E46S30_30_23` 的小队被玩家 **Apple**
攻击，但 bot 毫无反应。根因三处：

1. **被打检测整段注释掉**（exec 里 10-10 时代的 `beingAttack` 自动检测被注释，
   只能手动设）⇒ 被打后零反应。恢复并加强：PB 周围 10 格内出现**玩家**（非
   Invader）带 ATTACK/RANGED 的爬 ⇒ 置 `beingAttack`（黏性至任务结束）、记录
   `hostileUser`/`hostileTick`、`lastSpawnTime=0` 立刻补波。
2. **非 L1 波次硬上限 4 波**（index>3 停派）⇒ 被打时解除：`pbWaveBlocked` 加
   `beingAttack` 直通——4 波上限与 L1/L2 单波闩锁在被打态全部失效，一波接一波
   一直派（spawnAble 自然限流，不会挤爆孵化队列）。
3. **L2 强化被硬编码 hostileRoom 白名单锁死**（E46S30 不在名单 ⇒ 永远到不了 L2）
   ⇒ 被打时升阶不再看名单：能上多高上多高（L2 > L1 > DAMAGE > NO_BOOST），
   t2 化合物该用就用。

Lab 出不了 L1/L2 时维持 10-10 原则：有人在外面就保留旗打完/撤退，没人才撤旗。
Memory 清理（同日用户指示）：删除 51 个孤儿键（97→56）——2M tick 前的一次性
diag/_ 探针、claim 战役遗留、旧版本空结构（RoomControlData/TeamData 等）、marketAudit、
__P_ 价格缓存残留；全部经 grep 确认无代码引用。diagBuy/diagSell/marketSales/
cpuTelemetry 等活缓存保留。
测试：power-bank-respawn ⑤b 新增被打直通两例 + 源码 pin（检测必须在 exec 生效、
Invader 不触发、pbWaveBlocked 必须有 beingAttack 分支）。

## v0.78.220 — worker 取能+修墙配对压栈：消掉「取完等 pass」的可见空窗

用户报告（2026-11-07）：「shard3_84124997_1 怎么 worker 又在挂机」。六连拍实测：
repairWall 连续修墙（274→34 线性耗能），唯一样本空闲是**采空弹任务后的单 pass
空窗**——bucket<5000 时经济 pass 间隔 14 tick，worker 每趟修完都要站着等下一个
pass 才拿到取能/修墙任务。判定：非卡死（谓词全绿、缺口 44 面墙全 <300M、任务
连续），但空窗肉眼可见。

修复：空手 worker 的取能分支做**修墙配对**——`needBuildWallWorkerFree`（缺口存在，
0.78.216 语义）命中时把 repair 任务一起压栈：栈 LIFO，先压修墙（栈底）、再压取能
（栈顶）⇒ 取能完成当 tick 经 `execLastTask` 无缝接修墙，省掉每趟最多 14 tick 的
派工等待。与 0.78.212 塔兜底的配对同构。
测试：worker-full-employment ⑩ 新增配对断言（[repairWall, carryRes] 顺序），①⑧
原钉不破（工地消费时不配对）。

## v0.78.219 — 矿物容器里的能量也算脏货：空闲 carrier 转运掉，别挤占采集容量

用户报告（2026-11-07）：「mineral container 有莫名其妙的能量以及其他东西，注意
carrier 空闲时候转移掉，不要卡住」。实测四房矿物容器混着能量：E41S23×2 /
E49S31×92 / W26N58×106 / W33N55×106。

根因：`cleanDirtyContainers` 的脏货分类把**能量无条件豁免**（`r == RESOURCE_ENERGY
→ 永不脏`）——对源容器/升级容器是对的（能量就是它们的正货），但矿物容器成了
永久盲区：能量进去就再也出不来，还**挤占采集容量**（keeper 只在
`freeCapacity(resType) > 80` 时 harvest，脏货直接顶掉矿石空间）。

修复：脏货分类改为**按容器角色**——矿物容器只豁免「自己那种矿物」，能量与其他
杂物（boost 残留 GO/KO、biomass、power）一律算脏；普通容器仍只豁免能量。
空闲 carrier 每 pass 清一个容器（既有机制，无需新派发路径），单次容量 1,650
足以一次清完现有量。
测试：container-cleanup ②c 新增矿物容器能量负例（X 244 + energy 106 ⇒ 只搬
energy），①②b③ 原钉不破。

## v0.78.218 — 采集政策价格源修波动矿失真：H 被默认价 1.1 误判「不值一采」

0.78.217 上线后的政策快照暴露数据源缺陷：能量价 17.86（半价 8.93）下 U/K/Z/O/L/X
全部正确判「采」，唯独 **H 的价格地图值是 1.1 = DEFAULT_PRICE.H 兜底值，不是行情**
（真实行情：挂单 100+、14 天均价 36+、量 7 万+）。根因：`getMarketPriceMap` 把
`stddev > avgPrice` 的波动日整条过滤，H 这类波动矿全窗口被滤空 → 掉默认价 →
四个 H 矿房（E53S21/E59S38/W31N55/W33N53，存量 0.8~5.6 万）误停采。

修复：`getMiningPolicy` 的矿价取 `max(价格地图, 原始 14 天成交量加权均价)`——
原始历史（Game.market.getHistory，不过滤波动）兜底，只有**所有信号**都说便宜
才停采（有矿就采的默认方向不变）。能量价不受影响（地图的波动过滤器本来就豁免
RESOURCE_ENERGY）。
测试：mining-policy ②b 新增波动矿兜底两例（地图 1.1 + 原始 36 ⇒ 采；地图 1.1 +
原始 1.2 ⇒ 停）。

## v0.78.217 — 采集政策改价格闸：矿价 > 能量价一半就采，有矿就采，多余 >2 万挂卖单

用户指示（2026-11-07）：「只采集单价大于能量一半价格的 mineral……有 mineral 可以就
采集」「多余的 mineral 直接挂卖单售卖 >20k」。

- **采集判据动态化**（station_minetral.getMiningPolicy）：`mine = 矿价 > 能量价/2`
  （价格源与市场模块同源：StrategyMarketPrice.getResTypeHistory 14 天均价，缺价默认
  采）。**废除**静态 U/K/Z 永不采黑名单与 20k 存量停采线——按当日 shard3 快照，
  七种基础矿均价（U 10.2 / K 16.3 / Z 18.7 / O 22.1 / H 36.5 / L 135 / X 304）全部
  高于能量均价 16.0 的一半（8.0）⇒ 当前七种全采（此前 U/K/Z 三种完全不采 = 漏采）；
  某矿价跌破线（如 U < 8）自动回到「只买不采」。
- **采集侧不再设存量上限**（stop 默认 Infinity，有矿就采）；Memory.mineralSettings
  [resType].stop 仍可应急设上限。
- **多余矿物 >2 万直接挂卖单**（strategy_market.autoSellMineral）：mineralKeep
  150000 → **20000**，单房存量超 2 万的部分直接出 surplus 挂卖单。全局存量买入线
  （每房 6000+1 万）滞回保留——全局不足买入线时不卖，防 autoBuyMineral 自买自卖；
  矿量累积越线后自然开卖。
- 泄压链完整：矿价 > 线 ⇒ 无限采 → 单房 >2 万挂卖单 → 收入 credits；矿价 ≤ 线 ⇒
  停采只买。
- 测试：新增 `test/mining-policy.test.cjs`（①价格闸七矿全过 ②缺价默认采 ③上限
  默认 Infinity/可覆盖 ④源码 pin「孵化/动作只看 policy.mine、黑名单与 mineStop 必须删除」
  ⑤autoSell keep=20000 + 全局滞回保留）。

## v0.78.216 — 修墙阈值改管「生产」不管「动作」：要么别 spawn，生了就正常工作

用户指示（2026-11-07）：「修墙的阈值你应该控制 worker 的生产而不是动作」。

旧语义（10-13 引入、0.78.213-215 沿用）：`needBuildWall`（出兵）和
`needBuildWallWorkerFree`（把空闲 worker 派去修墙）**都**挂 `repairWallAffordable`
能量闸 —— 于是 worker 出生时修得起、干到一半 storage 跌穿 10 万闸就关，动作被打断
⇒ 原地站桩（E41S23 挂机循环的动作侧根源）。

新语义：
- **生产侧保留闸**：`needBuildWall`（出兵）与 `getRepairWorkerLimit`（编制 → 0）
  仍看 `repairWallAffordable` —— 穷房不许开启修墙战役（E53S21 教训防复发）；
- **动作侧拆闸**：`needBuildWallWorkerFree` 只看「墙是否低于目标」（< levelWallHits），
  已出生的 worker 每次 trip 只取 ~1.5k 能量，缺口本身有界（0.97M 缺口 ≈ 7 个 trip ≈
  1 万能量），storage 中途跌穿 10 万不再打断它 —— 防无底洞的责任收敛到生产侧。

配套闭环：worker 全程工作直至缺口关闭（< 300M 的判据在动作侧）→ 缺口关闭后无活
→ 850 tick 回收 → decay 跌回 299.7M 且 storage ≥10 万时生产闸重开再孵 ——
「要么别生，生了必须全程工作」在修墙这条主线上完整成立。
测试：`repair-wall.test.cjs` ⑥⑦ 随语义更新（穷房动作侧必须放行 + 源码 pin
「动作侧不得挂闸、生产侧必须挂闸」）。

## v0.78.215 — 非试点房烧制开闸线 15 万（滞回）：10~15 万恢复带归修墙独占

0.78.214 上线后的现场复核（E41S23，41 tick 采样）：`processPowerSpawn` 已停，但
storage 99.4~100.1k 闪断带里两条烧制通路合计闪烧 12 发（psE -600 / psP -12）——
**烧制与修墙共用同一条 10 万线**，烧制的连续抽水（50/tick）把 storage 钉在闸门正
下方：worker 刚取完能量，下一个经济 pass 修墙闸就关了，永远凑不齐一个完整修墙
trip（取货+走路+修理需要 ≥10 万维持 2-3 分钟）。

修复：给非试点房的烧制加**滞回开闸线** —— `POWER_SPAWN_ENERGY_OPEN = 150000`
（= 修墙储备 10 万 + 5 万恢复带）：

- `roomEnergyAbundant`（strategy_highLevel）：storage ≥ **15 万**才开闸；
- `tryProcessPower` 非试点分支（station_carry）：同样 ≥15 万；试点房（powerSpawnRoom）
  不受影响，仍走 powerBurning/配速机制（停烧线 10 万 + OPERATE_POWER 效果期摊薄）；
- 旋钮 `Memory.marketSettings.powerSpawnOpenEnergy` 可覆盖（两条路同源）。

效果分区：**<10 万** 修墙/烧制全停（真稀缺，worker 850 tick 回收兜底）；**10~15 万**
修墙/经济独占（worker 有完整修墙窗口，ops 让位）；**≥15 万** ops 恢复生产。
E41S23（99.5k）从此完全静默，storage 以 ~20/tick 回升越闸，worker 复工修墙。
测试：power-spawn.test.cjs 边界更新（10 万不烧/149999 不烧/150000 烧/16 万烧/
powerSpawnOpenEnergy 覆盖），power-spawn-burn 新增非试点开闸线两例。

## v0.78.214 — station_carry 烧制/灌能闸改 storage 单口径（terminal 存货不再背书）

0.78.213 上线后的现场复核：E41S23 storage 97~99k 时 power spawn 仍被灌了 2,850 能量
+93 power（改版前开闸窗口的在途任务余波，一次性），且审查发现 `station_carry.js` 里
还有**同族口径问题**：

- `tryProcessPower` 与 `generatorFillPowerSpawnTask` 的能量口径都是
  `roomMassStoreCnt` = **storage + terminal**。而文档自己写着「terminal 是市场储备，
  不给可选消耗背书」（POWER_SPAWN_ENERGY_FLOOR 的推导）——市场房 terminal 堆 10 万
  货、storage 归零时，质量口径照样开闸烧/送料，**正是 2026-10-08 W33N55 那个 bug
  （storage 0 + terminal 41636 照烧）在这条路上的残留形态**。
- 修墙闸（repairWallAffordable）与 0.78.213 改的 roomEnergyAbundant 都是 storage
  单口径 ⇒ 三处口径从此同源：**可选消耗（烧 ops / 灌 power spawn）只认 storage**。

改动：两处 `roomMassStoreCnt(room, RESOURCE_ENERGY)` → `room.storage.store[ENERGY]`
（power 保持质量口径不动——账号 power 百万级富余，瓶颈从来是能量）。
测试：`power-spawn-burn.test.cjs` 新增 terminal 背书负例（storage 9 万 + terminal 5 万
⇒ 必须停烧，旧口径下 14 万会照烧）；makeRoom 桩随口径更新。

## v0.78.213 — ops 烧制地板 3 万 → 10 万（与修墙储备同源），拔掉 worker 挂机的抽水机

2026-11-07 用户追问「worker 为什么挂机，是不是修 rampart 出问题」。排查结论：**修墙
管线本身没有 bug**（E41S23 37 面 rampart 最低 299.03M < 300M 目标，差 ~0.97M ≈ 1 万
能量修理量，有活），挂机是**能量侧把修墙预算抽穿了**：

- E41S23 **不是**试点房（`powerSpawnRoom` 未设，默认 W32N56；`powerBurning: false`），
  但 `processPowerSpawn`（每房每 tick 那条路，`powerSpawnOtherRooms: true`）在烧：
  本房闸门用的是 10-08 时代定的 `POWER_SPAWN_ENERGY_FLOOR = 30,000`。
- 修墙闸（`repairWallAffordable`）是 10-21 抬到 **10 万**（storage 单口径）。
  于是存在 **3 万~10 万的窗口带**：storage 9.7 万 ⇒ 烧 power 照常（≥3 万 + 账号充裕），
  修墙闸却关着（<10 万）⇒ worker 生出来无活可干。
- 25 tick 实测：power spawn **-48 energy/tick**（1 power+50 能量/tick 满速）、塔 -9.6，
  而全房净收入 ~20/tick —— 烧制独自超过产能，storage 在 10 万闸门附近锯齿震荡，
  worker「过闸孵化 → 几分钟被抽穿 → 挂机 → 回收」循环（三只 worker 全验证）。

修复：`POWER_SPAWN_ENERGY_FLOOR` 30,000 → **100,000**，且 `roomEnergyAbundant` 默认取
`StationDefense.repairWallEnergyFloor`（与修墙储备**同源**，改一处两边跟）；
`Memory.marketSettings.powerSpawnEnergyFloor` 仍可显式覆盖。效果：烧 ops 与修墙
共用同一条 10 万储备线，"烧 power 但 worker 无墙可修"的窗口带归零 —— storage ≥10 万
时两者都开（修墙 trip 只拿 ~1 万，余量归 ops），<10 万时两者都停（此时 worker 闲置
属政策正确，850 tick 回收兜底）。
测试：`power-spawn.test.cjs` 边界随地板更新（③ 99999 不烧 / ③b 旧 3 万区不烧 /
④ 10 万正边界烧），`process-power-switch` 注释同步。

## v0.78.212 — worker「要么别生，生了必须全程工作」：空手出口链补全 + 长时空闲回收

2026-11-07 用户报告：E41S23 `shard3_84111958_1`（满 boost 30W 高级 worker）tasks 恒 []、
0 能量、原地站桩 600+ tick。四条出路全关：hive 满 12,900/12,900、0 工地、RCL8 不能升、
修墙被 storage 98,671 < 100,000 地板闸挡住（差 1,329）。取能侧又被 `workerHasConsumer`
挡住（取了没下家，0.78.205 语义）——于是从出生闲到老死，满 boost 化合物跟着陪跑。

出口链补全（`workerManagerAfterCarrier` 空手分支，优先级从高到低）：

- ① storage 取能（`workerHasConsumer` 有下家，原样不动）
- ② 无 carrier 时挖源（lowEnergyCarry，原样不动）
- ③ **填塔兜底**：塔 <600 有缺口 → `[fillRes, carryRes]` 配对。任务栈 LIFO，先压填塔
  再压取能 ⇒ 先取能、到塔再 fillRes（与 carrierManager 给 carrier 的配对一致）；
  塔任务复用 carrierManager 同 pass 的 `room._fillTowerTasks` 缓存，不算两遍
- ④ **源容器直运兜底**：容器 >1200（显式传参，与 carrier 派车的容量×75% 门槛互补，
  `room.used` 每 tick 去重不撞车）→ 取回后走 loaded 分支的 `fillAllMainRoomStorage`
  自动倒库
- ⑤ **终极兜底：长时空闲回收**：连续 850 tick 无任何出口 → `recycleCreep` 回收
  （动作自带 ttl<700 先 unboost 回收化合物，再返还将部分孵化能量）。迟滞 850 保证
  从出生就闲的爬 ttl=650<700 必命中 unboost；豁免 repair 旗编制（用户明确要人）与
  「无 carrier 独苗」（空房 bootstrap）；拿到活即清 `idleSince` 计时。

效果：worker 要么有活干、要么被回收腾 spawn 位等真需求重孵；运行期条件漂移
（storage 跌穿修墙地板闸等）不再产生「从出生站到老死」的永久闲爬。
测试：`test/worker-full-employment.test.cjs`（①~⑨），`worker-no-consumer` 原钉不破。

## v0.78.211 — 「snapshot reconcile」把两个已修好的补员闸门退回旧版（keeper 550 下限 / PB 波次闩锁）

2026-11-07 01:14 巡检：主脚本两档皆空，但 `node test/*.cjs` 三红。前两条不是测试坏了，
是**线上代码真的退回去了** —— `71d01c3 snapshot: reconcile local HEAD over the parallel remote state`
拿一份「有 0.78.190 新功能、但早于 0.78.202/0.78.203 两个修复」的本地副本整份覆盖，
把 `modules/station_sources.js`（1 个 hunk）和 `modules/strategy_powerBank.js`（3 个 hunk）
一起盖回旧内容，同时还把 `main_mount.js` 的版本号从 0.78.203 退回 0.78.202。

两个被吃掉的修复，后果都是「静默停摆」，脚本看不出来：

- **本房 keeper 预算又被抬回 550**（0.78.203 修的就是这个）：`Math.max(energyAvailable, 550)`
  让 RCL6 单 spawn 房（hive 容量 2,300、长期在 300~500 打转）每 pass 都付不起 ⇒
  `trySpawn` 静默失败 + `spawnFailure` 粘滞 ⇒ 整房零收入。测试实测 550 > 400 直接断言失败。
- **L1/L2 波次闩锁又变永久**、`carrierCnt` 又按「累计派过几只」比：`pbFightersAlive` /
  `pbLiveCarrierCnt` / `pbWaveBlocked` 三个函数整体消失，exec 里退回那行手写条件 ⇒
  攻击手老死后没人补位、6 只 carrier 在窝门口干等到旗子过期（0.78.202 修的）。

处置：`git checkout 71d01c3^ -- modules/station_sources.js modules/strategy_powerBank.js`
定向还原（**只**这两处；`71d01c3` 同时带进来的 `main.js` 源容器监控、`strategy_highLevel.js`
的 transformLink 每 tick 执行是前进改动，保留）。两个测试随即转绿。

判据补充：**「脚本全绿 + 测试有红」= 线上代码被覆盖，先看 git 图再谈深探**。
`71d01c3` 这类快进提交在 git 上没有任何冲突痕迹（等于用旧内容覆盖新内容），
只有 `test/*.cjs` 和 `check-sync` 会响。以后合并远端后，先跑测试再看指标。

## v0.78.210 — T0/T1 商品扫货（市场价低于合成价值就挂买单）

`scanUnderpricedCommodities()`：每 500 tick 从 `COMMODITIES` 动态构建 T0/T1 合成链，
按历史均价算原料成本、按当前买单价算产物收入，利润率 > 50%（`Memory.marketSettings.scanMarginPct`
可覆盖）就对原料挂大额买单。只管挂单不管 deal —— deal 吃卖单要付路费，挂单让卖方送上门。
信用点 < 1,000,000 时不扫。

## v0.78.204 — high-margin ingredient buys track market price (no avg cap)

User: T0 原料价格高也要买，L5 产品 1000%+ 利润足以覆盖。

The ingredient buying logic capped maxBuyPrice at `historyPrice × (1 +
buyPremium)`. When the market ask exceeded this cap, the ingredient was
added to `noCheap` and skipped — even when the downstream L5 product's
realMargin was 1000%+ (device 1167%, organism 1486%). The silicon cost of
~30k credits against a 44M credit revenue is a rounding error, but the
average-price cap blocked the entire production chain.

Fix: when realMargin > 500%, `maxBuyPrice = Infinity` — the system buys at
whatever the market asks, knowing the margin absorbs it. Below 500% margin,
the original avg-price cap still applies.

## v0.78.203 — 本房 keeper 按「本 tick 真剩下多少能量」定体型（550 下限把缺能房锁死 650 tick）

2026-11-06 08:17 巡检：W26N58（RCL6 单 spawn、容量 2,300）报告「hive 只有 300/2300
而 storage 99,115」「keeper 0 < 矿点 2」。深探时间线：

- 两只 keeper 的 `spawnTime` 都是 84095966（记录龄 + ttl 恒 = 1,500）⇒ **84097466 同时老死**；
- 此后 **650 tick 一只 keeper 都补不出来**：全房零收入，storage 99,115 一动不动，
  W26N59 外矿跟着掉到 1 只 keeper（`__outerWhy=keeper<src1<2`）、容器 2,000 满 + 地面 5,098；
- hive 在 228 / 300 / 400 / 550 之间打转（1 只 carrier 要补 40 个 extension，还被 tower 抽）；
- **hive 一冲到 650（tick 84098118）当场就孵出 keeper** —— 卡点就是 550 这条线。

根因：`trySpawnOuterHarKeeper` 的
`energyBudget = Math.min(cap, Math.max(room.energyAvailable, 550))`
把预算**强行抬到 550**（= 2WORK+2MOVE+1CARRY），而 `StationHive.trySpawn` 的判据是
`currentEnergyAvailable < spend ⇒ 静默失败`（`station_hive.js:177`）⇒ **hive 长期 < 550 的房
永远孵不出 keeper**，与那行注释「让缺能房先恢复挖矿」正好相反。同一个病根在 0.78.193
（`f704f98`）刚修过 upgrader 的 600 下限，keeper 这条漏了（MEMORY 第 5 条：阈值不能
写死成大房量级）。

修法（`station_sources.js`）：

1. **本房** keeper 的预算 = 本 tick 真剩余能量（`currentEnergyAvailable`，缺省
   `getEnergyAvailable()`），不再抬 550 ⇒ hive 300 就派 300 体型的 keeper（2 WORK，
   4 能量/tick 的产出也好过 0）；hive 充裕时仍按 `innerMaxPartCnt` 放大到 800。
2. 连 1 组都付不起（`getHarvesterBodyConfig` 返回空体型）或算出来的体型比预算贵一格
   （循环里多带 1 个 CARRY）时**这一轮不试**：`spawnCreep([])` 是 `ERR_INVALID_ARGS`，
   硬试只会在 `trySpawn` 里静默失败并把 `spawnFailure` 置真、拖累同 tick 后面的
   carrier / upgrader。
3. 外矿 keeper 保留 550 下限（要飞外矿、可能要扛 source keeper，小体型是送人头）。

新增 `test/keeper-affordable-body.test.cjs`：现场复刻（hive 400 + 0 只 keeper 必须孵出
且体型 ≤ 400）、hive 300 退化档、hive 满格放大到 800、hive ≤ 250 不硬造空体型；
负对照把预算改回 550 下限后，hive 400 实测孵不出来（证明测的是行为而不是字面）。

## v0.78.202 — Power Bank 补员闸门：L1/L2 闩锁只挡「还有攻击手在打」，carrier 数活的

线上两个 powerBank 旗子同时停摆：`powerBank_E55S39_E57S40_5_29`（窝已打剩
**171,200 / 2,000,000** 血、离 disappearTime 还有 2,521 tick）与
`powerBank_E41S23_E39S20_25_42`（7,518 power、剩 576 tick）。两边的 `attacker` / `healer`
id `Game.getObjectById` 全为 null（老死），6 只 PBCarrier 在 (1,26~31) 干等、ttl 只剩 335~482。

根因两条，都属「闸门自锁」：

1. `exec` 的波次上限 `(boostModel == BOOST_L1 && L1Boosted)` 是**永久闩锁**：L1 波次一旦派出，
   `L1Boosted` 永久为真 ⇒ 那波老死后**再不出兵**。而一波 attacker 只有 1,500 tick 命、
   一个窝要 ~2,000,000 点伤害（一波约打 1.8M）—— 一波打不完是常态，后半程必然停摆。
   改成 `pro.pbWaveBlocked(flag)`：L1/L2 只在 `pbFightersAlive(flag)`（**只看 attacker/healer**）
   为真时挡。**不能**复用 `pbTeamAlive`：它把 carrier 算作「队伍还在」（撤旗用是对的），
   6 只 carrier 全活着 ⇒ 恒真 ⇒ 等于没修。
2. carrier 补员比的是 `flag.memory.carrierCnt`（**累计派过几只**），搬运老死后不回落 ⇒
   到目标数就永久停派，攻击手把窝打开也没人搬。改成 `pro.pbLiveCarrierCnt(flag)`
   （`flag.memory.carrier` 逐个查活）；`carrierCnt` 继续写回，只作观测值。

非 L1/L2 的 `index > 3` 硬上限原样保留；不动 spawn 优先级顺序。
新增 `test/power-bank-respawn.test.cjs`（把旧表达式塞回 `pbWaveBlocked` 实测红：actual true / expected false）。

## v0.78.201 — carrier 换代提前量：拿「不含将死」的编制去对标目标

`strategy_highLevel.carrierManager` 的补员触发条件原来是 `carrierCnt < carrierTarget`，
而 `carrierCnt` **包含**已将死的爬（ttl ≤ 3×body）。于是老车必须真的死掉、编制掉到目标以下，
才轮到孵新车 —— 一辆 50 部件车的孵化是 150 tick，**每次换代必然留 ~150 tick 的运力空档**，
和 0.78.187 修的外矿车队震荡是同一个模式。

改成 `aliveCarrierCnt < carrierTarget`（`aliveCarrierCnt` 早就存在，只被饱和度判断用过）。
老车还剩 3×body tick 时接替车已经开孵 ⇒ 无缝交接。`haulerSaturated` 的 `n=1` 豁免沿用
0.78.187 的写法，编制仍由 `carrierTarget` 封顶，不会变成棘轮。

## v0.78.200 — 撤回 `isEmpty → getFreeCapacity`：那处改动只是表面功夫

`station_carry.transformLink` 里 hub link 的发送条件被改成
`centerLink.store.getFreeCapacity(ENERGY) > minFreeSend`，但真正饿死第二个矿点 link 的
是 0.78.194 修的**发送顺序**（固定键序轮），不是这个比较。改回去（`centerLink.store.isEmpty()`），
避免用一个没验证过的条件掩盖已修好的公平性轮转。

## v0.78.199 — 「snapshot reconcile」把本地 HEAD 覆盖回远端，本文件丢了 11 节

一次 `snapshot: reconcile local HEAD over the parallel remote state` 的提交（69/72 模块
从本地快照恢复）顺带把 `CHANGELOG.md` 整份换成了**过期的本地副本**：净删 284 行，
v0.78.187 / v0.78.188（两条）/ v0.78.189~v0.78.195 / v0.78.198 共 **11 个小节**整段消失。
这是同一个故障的**第二次**发生（02:39 那次是 a3acce0 删的 10 节，已还原过一次）。

本次从 `810ba39` 逐字还原（274 个 `## v` 标题对 263 个），并新增
`test/changelog-integrity.test.cjs`：标题数下限 + 「已发布但极易被旧副本吃掉」的版本哨兵，
以后再被整份覆盖会**当场变红**，而不是靠人肉比对。

## v0.78.198 — 源容器派车门槛：载体容量的 0.75（196/197 是它的两次中间态）

`strategy_highLevel.carrierManager` 给空载体派「去源容器取货」时，原来的门槛是
`container.store[energy] > carrier 满容量`。一只 1,500 容量的车因此只认 1,500 以上的容器，
而容器里常年 900~1,400（keeper 10/tick 在填，车还没来）⇒ 这些容器**永远没人清**，
满了就溢出到地面衰减。

一个周期内改了三次（都是 `source.amount > X` 这一个表达式）：

1. 0.78.196：`> capacity` → `> 200`（现场证据：1,309 能量的容器一次都没被服务过）；
2. 0.78.197：`> 200` → `> capacity * 0.5`（固定 200 对小车身没意义，门槛应随车身缩放）；
3. 0.78.198：`> capacity * 0.5` → `> capacity * 0.75`（对齐 Overmind UpgradeSite 的
   `inThreshold` Larva 阶段取值，少跑空趟）。

现状（tick 84091800 复测）：地面能量 45,061 → 43,393（−41/tick，仍在降），
14 个自有房 hive 全满，`errorCount=0`。门槛仍低于容器上限 2,000，所以不会把容器锁死。

> 注：本条由 2026-11-06 01:1x 的巡检补写 —— 196/197/198 三次提交都只改了版本号没写
> CHANGELOG，且同一次提交（a3acce0）把本文件顶部 v0.78.188~v0.78.195 十个小节整段删掉了，
> 本次一并还原（净 +263 行，与 96f756c 的条目集合逐条核对一致）。

## v0.78.195 — 站在自己下一格上的爬被永久钉死（W26N58 的 hive 一整天回不了血）

巡检「必须处理：W26N58 hive 只有 300/2300 而 storage 有 88,495」。房内 4 只爬
（载体 8152、外矿 8614/8544、upgrader 39,7）全部原地不动几十 tick，`lastPos.time`
都卡在 6 —— 逐只读 `BetterMove.creepPathCache` 才看清是一条链：

```
8152(38,10)   下一格 37,9  ← 被 8614 占着
8614(37,9)    下一格 38,8  ← 被 8544 占着
8544(38,8)    下一格 38,8  ← 就是自己站的格子   ← 钉子
upgrader(39,7) 下一格 38,8 ← 被 8544 占着
```

8544 走到缓存路终点后，`moveOneStep` 无条件 `idx++` 越过终点 ⇒ 下一次
`directionArray[len]` 是 undefined；再下一次落到 `getDirection(this.pos, this.pos)`，
而 getDirection 对同一个点**返回 undefined** ⇒ `originMove(undefined)` 每 tick 一条
无效意图。爬一动不动，后面一整队跟着堵死，hive 六小时没人补，38 个 extension 全空，
房连一只爬都发不出来。

修三处（都在移动优化器里，只让「无效意图」变成「安静/重寻路」）：

1. `moveOneStep`：`idx` 已到最后一个路点就**安静返回 OK**，不再自增；
2. `betterMoveTo` 的 `idx-1` 兜底分支：自己就站在 `posArray[idx-1]` 上时
   `deletePath()` 去重新寻路，不再 `originMove(undefined)`；
3. `moveTo` 包装层：连续 6 tick 调了 moveTo 却一厘米没挪 ⇒ 作废**本爬**的缓存路
   （每 6 tick 最多一次，不动共享 path 对象；原地干活、根本不调 moveTo 的爬不受影响）。

新增 `test/move-pin-guard.test.cjs`：终点不自增 / `idx-1` 自指必须作废缓存 /
6 tick 停滞作废缓存三条，每条都带「把守卫改回去」的负对照（实测退化回
`originMove(undefined)`）。

## v0.78.194 — 矿点 link 的发送按固定键序轮，第二个矿点被永久饿死

巡检「必须处理：地面能量在堆积 68,881（+8.3/tick）」。逐房拆开看是同一副形态：
**所有矿点的 link 都卡在 800/800、hub link 卡 776、容器 2000/2000 满、地面在涨**
（E55S39 13.6k、E55S31 10.7k、E48S41 10.7k、W31N55 7.6k、W32N56 6.1k）。

`StationCarry.transformLink` 里，一个 pass 只允许一个矿点把能量发给 hub link ——
这是物理约束（hub 容量 800 = 一个矿点 link 的存量，发完它就不再 `isEmpty`）。但遍历顺序
是 `_.values(memory.stationSources)` 的**固定键序**，于是排在前面的矿点每轮都先发，
后面的矿点只能等「它刚好不满」的间隙。对一个 10/tick 一直在灌的矿点来说这个间隙几乎不存在。

现场（E55S39，RCL8、6 link、两个矿点）：

```
(14,8)  两个 link 每轮 800 → 400 → 800 地周转        ← 永远排在前面，每轮都发
(39,20) 两个 link 连续 30+ tick 卡 800/800、容器 2000   ← 一次都没轮到
        keeper 站在 (38,20) 抱着 400，只能往地上倒 10/tick
```

修：候选矿点按 `lastLinkSend` 升序（从没发过的视为 0 排最前）**轮转**，真正发出去了才写
`lastLinkSend = Game.time`。仍然是一个 pass 发一个（吞吐上限不变），改的只是「谁拿到这次
机会」。副作用只有一条 tick 数写 Memory，每 pass 一次。

新增 `test/link-send-fairness.test.cjs`：两个矿点都满、hub 每轮被清空 ⇒ 两轮内两个矿点
必须各发到一次；负对照（去掉排序 = 回到固定键序）实测第二个矿点两轮都发不出去。

## v0.78.193 — upgrader 的「退化体型下限」把它自己锁死（600 ⇒ 恒付不起）

0.78.192 修掉 `spawnFailure` 粘滞标记后，W26N58 当天确实出过 upgrader；但下午又开始
0 只、控制器冻在 2,302,949 约 30 分钟。这次不是 spawn 被抢，而是**体型预算的下限**：

```
let bodyBudget = Math.max(600, Math.min(cap, cachedEnergy));
```

下限 600 会把预算**强行抬到 600**，`getBodyLowLevel(600)` 造出 4 WORK 的 **550 能量**
体型；而 `StationHive.trySpawn` 的判据是 `currentEnergyAvailable < spend ⇒ 静默失败`。
RCL6 单 spawn 房里 keeper（950）与 carrier（1,100~1,500）轮流把 hive 抽干，hive 长期停在
**300~500** ⇒ 550 的体型**永远付不起** ⇒ 和这行代码自己的注释「体型必须本 tick 真付得起」
正好相反（MEMORY 第 3/5 条：闸门不许自锁、下限不能写死成大房量级）。

现场（tick 84084819~84084827 逐格采样）：storage 161,167、terminal 151,523、升级容器
1,870、spawn 大段空闲、hive 158/300/464/704 打转；唯一一次冲到 1,354 时 spawn 正在孵
keeper（84084680 起 64 tick），等它空出来 hive 又掉回 400。

修：下限 600 → **300**（`getBodyLowLevel` 的 num=1 档：2 WORK + 1 MOVE + 1 CARRY）。
300 比 keeper 的 950 还便宜 ⇒ 抢不走 keeper 的孵化费（keeper 仍是 spawn 队列第一位），
但能让「0 只 upgrader + spawn 空着 + hive 400」这个真实窗口孵出一只真在升级的爬。
hive 充足时行为不变（体型照样按真实能量放大到 16 WORK）。

新增 `test/upgrader-degraded-body.test.cjs`：按线上 `trySpawn` 语义（付不起就失败）复刻
现场，hive 464 + 0 只 upgrader 必须孵出 ≤464 的体型；负对照把下限改回 600 实测红
（同一现场一只都孵不出来）。`test/upgrader-affordable-body.test.cjs` 的源码断言同步到 300。

## v0.78.192 — `spawnFailure` 粘滞标记吞掉 upgrader（真正的根因）

0.78.191 那道「退化态先救生长」的闸只是止血。继续查 `__ts` 埋点发现真正的原因在更上游：

`StationHive.trySpawn` 第一行是 `if (room.spawnFailure) return null`，而 `spawnFailure`
的含义只是「**本 tick** 已经有过一次孵化尝试失败」，**既不代表 spawn 被占，也不代表
我们付不起**。W26N58 这一 tick 里排在 upgrader 前面尝试孵化的角色依次是
coreBuster / towerBuster / keeper / carrier / 外矿搬运，任何一个付不起都会把它置真。

现场（tick 84082272 / 84082286 的 pass 记录）：

```
worker(2,200)              → Y（hive 2,300 → 100，spawn 被占 99 tick）
towerBuster(4,450)         → N  ← 就这一只把 spawnFailure 置真
outerHarvestEnergyCarrier  → N
upgrader(2,100 / 550)      → N  ← 被上面的标记吞掉，连试都没试
```

而 `towerBuster` 之所以每个 pass 都被尝试，是因为外矿房 **W26N59 里有一座敌方塔**
（12,41 与 13,42，各 3,000 血；同房还有敌方 spawn 5,000 / storage 10,000 / 十余个
extension —— 一座被打残的旧基地）。它的 40 部件体型要 4,450 能量，而 W26N58 容量只有
2,300 ⇒ **永远付不起、永远失败、永远毒化整 tick**。结果就是控制器一整天 0 只
upgrader，源容器 2,000/2,000 + 三个 link 全满，地面能量 8,356 在涨。

两处修：

- `StationUpgrade.trySpawnUpgrader`：`trySpawn` 前 `room.spawnFailure = false`
  （carrier / 外矿搬运两条路径早就在这么做，upgrader 这条漏了）。体型已经按
  `spawnTickBudget` 收缩过，付不起有它自己的判据，不该替别人背锅。
  只解标记，**不动 `currentEnergyAvailable`**。
- `StrategyOuterHarvest.spawnTowerBuster`：出兵房容量付不起这只专队时直接返回，
  不再每个 pass 去试。塔留给有大 spawn 的房拆（W26N58 RCL6 拆不动它，属已知限制）。

新增 `test/sticky-spawn-failure.test.cjs`（负对照：删掉 `room.spawnFailure = false`
后 upgrader 一条都孵不出，实测会红）。

## v0.78.191 — 还在升级的房（RCL<8）一只 upgrader 都没有时，spawn 先救生长

巡检报「地面能量在堆积 39,663（+6.4/tick）」。逐层查下来，W26N58（RCL6、**单 spawn**、
hive 2,300、storage 135k、terminal 141k）的控制器上**一只 upgrader 都没有**：
它是这个房**唯一**的能量出口，出口一断，挖出来的能量就只能在源容器/link 里堆满、
溢出到地面衰减 —— 现场两个源容器 2,000/2,000 满、三个 link 全满（796/800/800）、
地面 8,356 在涨。

`__ts` 埋点（tick 84082272 的经济 pass，单 spawn 房）给出了确切的死法：

```
worker(33 部件 / 2,200)            → Y   hive 2,300 → 100，spawn 被占 99 tick
towerBuster(40 部件 / 4,450)       → N   付不起
outerHarvestEnergyCarrier ×4(1,050) → N  spawn 被占
upgrader(2,100)                    → N  spawn 被占
```

紧接着几个 pass 的 hive 只有 114 / 1,350 / 2,050，upgrader 每次都撞在「spawn 被占」
或「付不起」上 —— 队列里排在它前面的**全是后台/可选岗位**（修墙 worker、外矿搬运），
而它是唯一没人管的。keeper → carrier → 外矿 → upgrader 这个顺序靠调用位置实现，
**不去动它**；改成在**退化态**（0 只 upgrader 且 RCL<8）把可选岗位的补员暂停，
让 spawn 空出来的第一个窗口归 upgrader，孵出即自清：

- `StrategyHighLevel.upgraderStarved(room)`：RCL<8 && `creeps("upgrader", false).length == 0`。
- `workerManager` 的修墙分支加上它（修墙是后台的无限下沉）。
- `trySpawnOuterHarCarrier` 的补员段加上它（`__outerWhy=needUpgrader*`，外面能看见）。
  在役的爬一律不动；keeper / 本房 carrier 两条主房能量循环**不**经过这道闸。

同一根因还修掉了孵化预算被清零的记账错误：`spawnCarrierNow` 与外矿 carrier 补员都在
`trySpawn` 前 `room.currentEnergyAvailable = undefined`。而 `room.energyAvailable`
在**同一 tick 内不反映刚花掉的能量**（实测孵完 2,200 的 worker 后读回仍是 2,300），
清掉缓存就等于让后面所有角色按满格旧值算体型 —— upgrader 因此算出 2,100 的体型去要
一个只剩 100 能量的 spawn。现在只解 `spawnFailure` 这个粘滞标记，预算保留。
外矿 carrier 的 `spawnAvail` 也改用 `spawnTickBudget`（夹住本 tick 真实余额）。

新增 `test/upgrader-first-spawn.test.cjs`（行为式负对照：把闸门关掉，0 只 upgrader 时
仍会孵外矿车，实测会红）。

## v0.78.190 — 外矿补员不再被自己那层 %6 节流挡在经济 pass 之外

`StrategyOuterHarvest.exec` 开头有一层 `(Game.time + room.hashCode()) % 6 != 0 → return`，
而调用方本来就已经节流（`StrategyHighLevel` 每 economyInterval=7、低桶 14 tick 一次；
`StrategyLowLevel` 是 %3）。两个周期互质 ⇒ 真正能走到「补员」那几行的机会只剩约
**1/3 的 pass**。

后果不是「慢一点」，而是**声明的孵化优先级失效**：同一次 pass 里 `exec(room)` 排在
`StationUpgrade.spawnUpgrader` **之前**（keeper → reserver → worker → carrier → 外矿 →
upgrader 的顺序就靠调用位置实现），可外矿只有 1/3 的 pass 会真的去要 spawn，
upgrader 每次都在要 ⇒ 空闲 spawn 基本都被 upgrader 拿走。

现场（tick 84080184，W26N58 RCL6 单 spawn 房）：
- spawn **idle**、hive 2300/2300 满，`__outerWhy` 却停在
  `try:carry9,avail2300,budget1150@84080144` —— 40 tick 里一次都没再试；
- W26N59 两个矿点：容器 2000/2000 满 + 地面 3,800，另一矿点容器 250 + 地面 2,800，
  全部在衰减，只有 2 只车（需求公式还差 9 个 CARRY 部件）。
即「spawn 空着、货堆着、缺口算得出来，就是不孵」。

改法：删掉这层 %6，只留一条「同 tick 别跑两遍」的守卫（room 对象每 tick 重建，
守卫自然失效）。本函数幂等（路线维护自带缓存、补员只是 trySpawn），实测整条
`trySpawnOuterHarCarrier` 0.168 CPU ⇒ 每 pass 一次约 0.01 CPU/tick。
新增 `test/outer-pass-cadence.test.cjs`（行为式负对照：旧实现两个相邻 tick 一次都不补，
实测会红）。

## v0.78.189 — Energy buy orders for RCL<8 upgrading rooms (target 300k, competitive price)

User: RCL<8 房间购买能量升级，挂单。

`autoBuyLowRclEnergy` had two blockers that prevented it from working:
1. Target 100k: W26N58 already had 108k total (terminal 10k + storage 98k)
   → `energyCnt >= target` → skipped. An actively upgrading RCL6 room burns
   20+/tick, so 100k only lasts 5000 ticks. The target is now **300k** for
   RCL<8 rooms with `progress < progressTotal`.
2. Price 27.79 (below market sell-low 33.26): a buy order priced below the
   cheapest sell order sits unfilled forever. The price now tracks
   `max(maxBuy × 1.05, sellLow × 1.02)` - competitive enough to fill quickly.
   Credits (83.8B) far exceed the 5M gate.

Room filter tightened: only RCL<8 rooms with `progress < progressTotal`
(actively upgrading) get the 300k target; RCL8 rooms still use the 50k
threshold for rescue buys.

## v0.78.188 — Power creeps run every tick (no throttle)

User: PC 部分功能应该提前落位，OpSource 尽可能无缝衔接不浪费，没必要 2t 走一步，
正常 1t 一步。

The 3-tick throttle (0.78.148→182) made PC movement 1/3 speed. For
PWR_REGEN_SOURCE (cd 100, wait 50): a 20-tile walk took 60 real ticks at 1/3
speed but only 50 were available → **~10-tick buff gap per handover** (REGEN
coverage <97% on W26N59). Now POWER_CREEP_TICK_INTERVAL = 1: full-speed
movement, seamless handover.

CPU cost: ~0.85/tick for 12 PCs (mostly cooldown checks + cached moveTo).
The seamless 2× source regen (+10/tick/source) far outweighs this.

## v0.78.188 — Buy less energy for W26N58; deposit mining yields CPU to the core loop

User: 能量不要买太多了（容器都满了），减少量确保正常运营，不要让 CPU 影响房间正常运行。

Two changes:

1. `autoBuyLowRclEnergy`: RCL<8 upgrading-room energy target **300k → 120k**. At 300k the room sat at
   ~290k storage+terminal with every container full. W26N58 currently has no open buy order (massStore
   285k ≥ target, auto-cancelled); new modest orders only appear below 120k.

2. **Deposit mining yields CPU to the core loop** (self-balancing throttle):
   - `StrategyDeposits.exec` returns when bucket < 5000 - no new deposit creeps, existing ones age out;
   - `harvestDeposit` / `carryDeposit` pause when bucket < 3500 - a tier above MIN_CPU(2000), so deposit
     mining stalls first and the core loop (upgrade / defense / hatchery) never gets frozen by CPU
     again. Deposits are bonus production; hysteresis-free thresholds resume automatically.

Defensive `Game.cpu` reads (tests run in sandboxes without it).

### Tests

New `test/deposit-cpu-throttle.test.cjs` pins all three gates and the 120k target.

## v0.78.187 — a room that dropped to one carrier could not replace it for 175 ticks

`trySpawnCarrier` keeps a rolling utilisation sample (`carryBusy` = the *number* of busy
carriers per economy pass) and the last replenish gate requires
`avgBusy > 0.85 * carriers on the roster`. At `n = 1` that gate is unreachable by construction:
a lone carrier alternates 0/1 samples (between economy passes it has no task to run), so its
mean settles around 0.69 < 0.85 and the routine path never fires again.

The only remaining exit was "hive deficit + `(Game.time + hashCode) % 25 == 0` aligned with the
room's economy slot". The slot is `% 7`, so the two phases line up once every `lcm(7,25) = 175`
ticks - which is exactly the 150-tick spawn time of a 50-part carrier. Net effect: lose a
carrier, run at half hauling capacity for ~3 minutes.

Live evidence (E53S21, tick 84061017-84061170, RCL8, 3 idle spawns, 4 links, 2 sources):
storage at 0, both source containers at their 2,000 cap, **ground energy 4,878 -> 7,129
(+28/tick, exactly the room's mining income)** while the other 13 rooms had zero on the floor.
The lone carrier's utilisation mean measured 0.692. Replacement only started spawning at
84061170, 153 ticks after the loss.

Fix: `haulerSaturated = carrierCnt <= 1 || avgBusy > alive * 0.85`. A single carrier is a
single point of failure for the whole room economy and utilisation cannot be measured on n=1,
so replenish to `carrierTarget` unconditionally. The target still caps it, and
`creeps(role, false)` counts creeps already spawning, so one loss yields at most one
replacement - no ratchet.

### Tests

New `test/carrier-single-replenish.test.cjs`: one carrier at 0.69 utilisation must spawn;
negative controls at target-2 (same low mean), unaffordable body (energy 1,200 < 2,500),
over-target (3 > 2) must not; hive-full + one carrier still replenishes; source assertion keeps
the raw `avgBusy > 0.85 * roster` expression out of the gate.

## v0.78.187 — Fill the upgrade container as a standing buffer (Overmind Controller-Manager pattern)

User report: W26N58's upgrader energy supply broken, carriers not hauling. Measured:

    4 upgraders (52 work) standing between link(7,6)=582 and cont(8,6)=0, all at e0
    2 carriers idle (one empty, one holding 1200) with no tasks
    controller rate saw-toothing 0 -> 49/tick between link refills

`generatorFillEnergyTask` put the container-fill branch **inside** the "upgrade link is completely
empty" gate, so while the link held energy the container was never filled and carriers had nothing to
do; once the link drained, the refill had to wait for the transformLink chain (center link must be
empty first), leaving 0/tick stalls.

Overmind's Controller Manager pattern (bencbartlett's Overmind: a dedicated upgrader plus a controller
container, transporters keeping it topped) is the fix: the container is a **standing buffer** filled
whenever it drops below 2000 (reservation included), independent of link state; upgraders withdraw from
the link first and fall back to the container. The center-link fill branch is preserved as the link-path
supplement.

### Tests

New `test/upgrade-container-buffer.test.cjs`: the container branch must precede and be independent of
the link gate, its condition must be only "below 2000", the center-link branch and the `room.used`
stacking reservation must survive.

## v0.78.186 — The terminal-50k balance rule drained every room's storage to zero

Census (tick 84060600): all **14 storages at 0 or exactly 776** while terminals held 2k-40k
(total storage+terminal 358k, down from ~940k two days ago). Walls stopped repairing
(`repairWallEnergyFloor=100k`), power burning stopped (`powerSpawnEnergy=100k`), and rooms
had zero buffer - though hives stayed full so nothing deadlocked.

Cause: `balanceTerminalResource` moves energy between storage and terminal until the terminal
holds exactly `RES_BALANCE_ROOM[ENERGY] = 50000` - a target meant for RCL8 market rooms, applied
to every room. A low-RCL room (W26N58, RCL6, income barely above its upgrader) can never sustain
a 50k terminal, so the rule hauled the storage's last energy into the terminal and left it there.
The pre-loop then deletes ENERGY from the balance list (storage empty, nothing to move), so it
never self-corrects.

Two changes in `balanceTerminalResource`:

1. **energy reverse rescue**: if storage < 50k AND storage < terminal, haul terminal → storage
   (amount = min(tE-sE, tE/2, carrier free space)) before the normal gate scan.
2. **no storage→terminal drain**: for energy with `resCount > 0` (terminal below target) and
   storage < 100k, drop ENERGY from the balance list instead of hauling - the terminal→storage
   refill direction still works, and RCL8 market rooms with real surplus are unaffected.

### Tests

New `test/energy-balance-direction.test.cjs`: reverse rescue exists and lands on storage,
storage→terminal blocked below 100k, terminal→storage refill preserved, ops special case intact.

## v0.78.185 — ship the four fixes that never reached the live branch

The live branch was running a build assembled from **older revisions** while
still reporting `version: 0.78.182`. Module-by-module comparison against every
commit in `HEAD`'s history showed each differing live module to be byte-identical
to an ancestor (nothing live-only to preserve), but five modules were behind:

    module                        live ==   missing change
    prototype_creep               23c8e7b   BOOSTS layer order (474620f)
    prototype_powerCreep          89a9698   needGenerateOps / generateOps
    manager_creeps                3051379   GENERATE_OPS level clamp (23c8e7b)
    strategy_highLevel             da232e1   workerHasConsumer gate
    strategy_factoryPowerCreep    89a9698   free GENERATE_OPS before the task stack

Live confirmation of the GENERATE_OPS one: precisely the five **level-5** PCs
(P0/P1/P2/P4/P8) had `PWR_GENERATE_OPS.cooldown == 0` (never cast) while every
level-4 PC had a live cooldown (3–37) — `effect[level]` reads `effect[5]` =
undefined for level 5, so the cast was skipped forever. Cooldowns were checked
again after the deploy and all twelve PCs cycle.

No source change beyond the version string: this release exists so the payload
that goes over the live branch is traceable (same version number must never mean
two different builds).

## v0.78.182 — ops redistribution: terminal-full rooms may ship (the 3× gate never fired)

User: OP 相关出现问题.

Live evidence: ops stocks split the empire in half - rich rooms sitting at the
terminal cap (W34N52 3000+3000 both full, E53S21 8722, W31N55 7870) while
E55S31 held **37**, E49S31 140, W32N56 104, W26N58 **0**. PC ops generation is
healthy (all 12 cooldowns cycling; engine POWER_INFO: effect [1,2,4,6,8] per
50-tick cooldown, ~1 ops/tick empire-wide), but the generic balance gate
(total > 3× target = 9000 AND terminal >= 3000) can never fire for a resource
produced that slowly - the rich rooms hoard at cap forever and the starved
rooms sit below the PC cast cost (100) and the needOpPowerSpawn 600 gate.

ops special case: a room whose **terminal holds a full stack (>= 3000)** is
sendable, shipping its terminal contents to rooms that requested ops (their
requirement is registered by processRoom when total < 6000). Sender terminal
empties, the PCs slowly refill it, and the system converges. The send still
goes through the freight budget.

### Tests

`test/ops-balance.test.cjs` pins the special case, the freight-budget path and
the ops target in RES_BALANCE_ROOM.

## v0.78.181 — BOOST_POWER keyed by compound, not by action name

API-structure bug found during the docs sweep: the engine's `BOOSTS[part][action]`
maps `{compound: multiplier}` (e.g. `BOOSTS.TOUGH.damage = {GO: 0.7, GHO2: 0.5,
XGHO2: 0.3}`). The old construction took `_.values(...).head()` of each action
table - the FIRST compound's multiplier - but keyed the result by **action
name**, while every consumer looks up by `part.boost`, a **compound name**
('XGHO2', ...). Every lookup returned undefined, so all boost-aware damage
math (getHitsNextTick, possibleDamage family, possibleHealHoldRealDamage) was
NaN for boosted creeps. Unboosted targets (invaders, keepers) fall back to
`|| 1`, which is why peacetime never noticed - combat vs boosted units was
blind.

Rebuilt as an inverted compound→multiplier table; pins assert compound lookups
(XUH2O 4, XGHO2 0.3, XKH2O 150), that action names are no longer keys, and
that the old single-line construction is gone.

## v0.78.180 — A stranded upgrader must go back to work after unboosting

Measured 2026-11-02 in W26N58 (RCL6): the controller sat at 586,826 for
~330 ticks while an upgrader (`shard3_84014505_1`) stood at (41,7), next to
lab (41,6), 32 tiles from the controller (9,7), `store` 0 and `memory.tasks`
permanently `[]` until it aged out.

**Root cause.** `station_upgrade.js` sends an upgrader to unboost when
`ticksToLive < pathTime * 1.5` (~124 ticks here): it drops its energy,
unregisters from the station and pops its **only** task to push the unboost
chain. When the unboost chain finishes, `UnboostCreepBodyPart` does
`popTask().execLastTask()` - with an empty stack that is a dead end: nothing
in the codebase ever re-tasks an upgrader whose stack ran dry (the
`generatorUpgradeTask` calls in `StrategyLowLevel` /
`workerManagerAfterCarrier` only feed `room.creeps("worker")`). So the creep
idles out its remaining life. The same hole opens when the unboost container
is missing or was destroyed: `!container` takes the identical `popTask()`
branch even though the creep *cannot* unboost, so it forfeits a perfectly
good upgrade task.

**Fix.** Two layers:

1. `UnboostCreepBodyPart` re-adds `upgradeKeeper` and re-registers to the
   station **in the same tick** when an upgrader ends up with an empty stack
   (and still has ttl). Workers/carriers are untouched - they have their own
   managers.
2. `StationUpgrade.rescueIdleUpgraders(room)` as the cross-path safety net,
   called from `spawnUpgrader` (which both strategy passes hit every tick)
   *before* the spawn decision and before the container/link early return.
   It is idempotent: a creep with a non-empty task stack, a spawning creep,
   or a legacy creep without a real `tasks` array is left alone.

Consistent with the 2026-10-19 rule: the spawn gate decides *how many*
upgraders; a creep that is already alive must always have work to do.

Not changed on purpose: the ~150-tick spawn+travel gap after an upgrader
dies (no pre-spawn lead). Giving the upgrader a replacement lead means
spending ~2,100 hive energy ahead of the next keeper replacement - the
`spawn order must not be reshuffled` red line. Reported, not changed.

### Tests

`test/upgrader-unboost-retask.test.cjs` pins both layers with negative
controls: carrier in the same state gets no task, ttl-0 upgrader gets no
task, non-empty stack is never overwritten, spawning/legacy creeps are
skipped, and the retask call sites must sit between `popTask()` and
`execLastTask()` (and ahead of the container/link early return).

## v0.78.179 — Overmind replacement lead time + correct source regen rate

Two API/Overmind-grounded fixes for the outer-mine fleet oscillation
(0.78.177/178 in between were the parallel session's upgrader-body and
spawn-body releases).

**Replacement lead time** (Overmind Overlord.ts:273): a creep counts toward
coverage only while `ticksToLive > CREEP_SPAWN_TIME × body.length +
spawnDistance + prespawn`. Our filter only subtracted spawn time (body×3) -
the missing pathTime term meant every generational handover dropped
production for one pathTime (94 ticks on src0), which is literally the
metronome of the fleet "mass-death oscillation". Carriers within
`3×body + pathTime + 100` of death no longer count, so replacements depart
before the veteran retires (the same overlap concept the defender rotation
already uses via OUTER_DEFENSE_REPLACE_OVERLAP).

**Source regen rate**: the official mechanic is a continuous refill at
`energyCapacity / 300` per tick (300 = fixed ENERGY_REGEN_TIME; 10/tick
reserved, 5/tick unreserved). The code divided by `ticksToRegeneration` -
the 300→0 **countdown** - producing fake instantaneous rates up to 27/tick
(measured 26.8), overestimating EnergyPerTick and feeding the 8-vs-5 carrier
overshoot. Now uses the constant SOURCE_REGEN_TICKS = 300.

### Tests

outer-carrier-spawn pins the prespawn constant and the full lead-time
formula (spawn + travel + buffer).

## v0.78.176 — Freight budget on every terminal send (Overmind equalize pattern)

User: 只考虑运费预算（from the Overmind comparison list）.

`terminal.send` charges the transfer fee to the **sending** terminal's energy.
All five resourceBalance send sites (factory-resource dispatch, power
concentration, room balancing, full-storage relief, storageEmpty evacuation)
sent fixed amounts without checking it - a far-distance 3000 send could eat
several thousand energy and drain the sender's terminal, breaking its own
market deals and balancing tasks downstream.

New `StrategyResourceBalance.freightBudget(fromRoom, toRoom, resType, amount)`
caps every send to what the sender can actually pay: unit cost is
`calcTransactionCost(100)/100` (linear, cached per room pair), budget is
terminal energy minus a 2000 floor, and for energy sends the unit cost is
`1 + unit` because the fee comes out of the same pile. Sends that budget
below TERMINAL_MIN_SEND are skipped by the callers. Same accounting rule as
Overmind's `sendAmount = min(sendAmount, sender.store - sendCost - 10)`.

### Tests

New `test/freight-budget.test.cjs` drives the real function in a VM (ample /
tight / energy-self / under-floor cases + per-room-pair unit cache) and pins
that all five send sites go through the budget.

## v0.78.175 — Rebalance idle outer carriers to the fullest container

User: 外矿能量有点浪费，爬配置合理吗？

Verdict: the config itself has converged - live fleet CARRY 66 vs computed
demand 56 (reserved regen 10/tick per source, pathTime 82/57), bodies sized by
the 50% hive-cap rule. The visible waste (1994 energy rotting at src1, container
full at 2000) is the collapse-era backlog draining too slowly because carrier
registration is skewed: src0 had 4 carriers for a container at 16 energy while
src1 had 2 for a full one. Empty carriers were always re-tasked to their
*registered* source, so the skew could never self-correct.

The task-less re-assignment in the maintenance block now picks the source with
the fullest container (Overmind demand-driven dispatch) and migrates the
carrier's carryCreeps registration along with it, keeping the per-source quota
and gap accounting truthful. Backlog drain at src1 roughly quadruples
(2.3/tick net -> ~9/tick net with a 3:3 split); no other gates change.

## v0.78.174 — Off-route roads: neither repaired nor destroyed, just left to decay

User: 不 repair 对应 road 就行了，让他自然消失.

The destroy branch added in 0.78.173 was dead code and is reverted: mine/transit
rooms on our routes are neutral by the long-distance routing rule, and roads in
neutral rooms have **no owner** (`my: undefined`) - the `s.my` filter never
matched, and `destroy()` on an unowned structure returns ERR_NOT_OWNER anyway.
The observed orphan at (20,39) is decaying on its own (300 → 200 hits).

The policy that actually holds: road builders only work on exact route tiles
(`onRoadPath` + the critical scan both match route waypoints), so off-route
roads receive no repair and decay naturally; only off-route *sites* are
removed by the exact-match cleanup.

## v0.78.173 — Remove the redundant road sites and orphan roads for good

User: 多余的 site remove 掉.

The live audit found exactly four road sites in W26N59 - (15,44), (15,45), (16,44), (18,41) - and
every one of them is OFF the canonical route, sitting 1-2 tiles beside built road. They survived
because `cleanupOuterRoadSites` built its whitelist with a **±1 tolerance**: that was insurance
for the era when route recomputes drifted a tile, but since 0.78.171 renews a walkable route
instead of re-searching, the tolerance only shields the parallel-era leftovers.

- The cleanup whitelist is now **exact-tile** (Overmind roadLookup style).
- It merges the **sibling mine points' routes** into the whitelist first - cleanup runs per mine
  point, and without the merge, src0's sweep would destroy src1's legitimate road tiles.
- In mine/transit rooms, off-route roads **built by us** are `destroy()`ed immediately instead of
  decaying for days (the 6%-hits orphan at (20,39)). Home rooms stay blueprint-governed.

Pins in `outer-carrier-spawn.test.cjs`: exact whitelist (no ±1 loop inside cleanup), sibling
merge present, destroy branch present.

## v0.78.172 — Overmind road method: critical-first repair and route merging

User: road 也参考 Overmind 寻路和修的方法. Read the actual Overmind source
(bencbartlett/Overmind: RoadLogistics.ts / RoadPlanner.ts / repair.ts) and adopted
the two practices our implementation lacked - the rest was already equivalent
(repair target 0.9 = RoadLogistics.repairThreshold, route-only repairs =
roadShouldBeHere, one canonical cached route + rare recompute = roadLookup,
complete-road gating = roadCoverage).

- **Critical-first repair** (RoadLogistics.criticalThreshold = 0.25): when the
  road-builder stands on a healthy road, it now scans the next 3 route waypoints
  for a road below 25% hits and repairs it at range 3, instead of letting it
  decay to 0 (losing the tile costs a full rebuild trip). Route tiles only.
- **Route merging** (RoadPlanner.encourageRoadMerging): when a mine point's route
  is re-searched (only on real blockage since 0.78.171), the sibling mine
  points' cached routes are discounted to cost 1 in the roomCallback - multi-
  source mines share one corridor trunk instead of growing parallel lines.
  Blocked tiles (255) are applied per-tile after the discount, so merged paths
  never run into structures. Applied to both the blueprint and fallback searches.

Not adopted, deliberately: Overmind's road-planning terrain costs (plain 3 /
swamp 4) shorten paths through swamps, which is optimal for the finished state;
our plain 2 / swamp 5 keeps the construction-phase haul speed high (swamp
travel is 5/tick until the road exists). Our carriers also double as builders
(user-approved 0.78.152+ design) rather than Overmind's dedicated home workers.

## v0.78.171 — One road to storage; high-tier commodities only sell at the recent high

Two user directives (10-31): the outer road must be ONE complete line - no parallel site spam -
and T5-class commodities must sell at the recent daily high, never low.

**One road.** `ensureOuterRoadPath` reused its cached route only inside the 1000-tick TTL; on
expiry it re-searched even when the old road was perfectly walkable. With plain=2 / road=1 the
search can hand an equal-cost tie to a parallel alignment: the old sites are not yet cleaned, the
new route lays its own sites, the two fight and the road never finishes. Now the walkability
re-check (`outerRoadWalkable`, endpoint + every tile unblocked, itself throttled to 50 ticks)
renews `roadPathTick` and returns the same route - a re-search only happens when something
actually blocks the path. `cleanupOuterRoadSites` already removes any road site that drifted
off-route, so parallel leftovers die on the next sweep.

**Recent-high selling.** The daily-high gate was L5-only with tolerance 0.96 (accept orders at
96% of the recent high). Per user: tolerance default **0.96 → 1.0** - a buy order must pay at
least the recent daily high (engine history avg+stddev approximation, net of terminal transfer
cost) - and the gate now covers **commodity level >= 3**, which brings the X boost compounds
(XLHO2/XGHO2/...) under the same rule. Missing history falls back to the old
historyAvg × (1 + dealPremium) floor; L0-L2 (raw/base goods) keep the plain premium gate.
`dailyHighTolerance` in Memory.marketSettings still overrides.

### Tests

`market-l5.test.cjs` pins the L3+ gate and the 1.0 default (and that 0.96 is gone);
`outer-carrier-spawn.test.cjs` pins the renew-on-walkable behavior and that renewal happens after
the walkability check (a newly blocked road still forces a re-search).

## v0.78.170 — The reserver is the outer mine's master switch; spawn it like one

User: 外矿需要 claim 的 reserve，不然能量太少（Overmind 先保留后开采）。

Confirmed live: W26N59's controller has been unreserved for days (`reservation: null`), so both
sources sit at **1500 capacity and regenerate 5/tick instead of 10/tick** - the entire outer
operation (2 keepers + up to 8 carriers) has been running at half its potential throughput. The
reserver machinery existed (`getReverserBodyConfig`, the `reserveOuterHar` task, the spawn gate in
`strategy_outerHarvest.exec`) but was buried inside the flag loop, behind every home spawn demand.
W26N58's single spawn is ~100% busy; the `__outerWhy` diagnostic showed `noFreeSpawn` again and
again - the reserver (1950 energy, one creep per ~1500 ticks) lost every race indefinitely.

`StationSources.trySpawnReservers(spawnRoom)` now runs from `strategy_highLevel.exec` **after home
keepers but before worker/carrier demand**:

- Overmind ordering: reserve first, harvest second. Reservation doubles source capacity - it is the
  enabler, not a consumer.
- The 0.78.155 health gate is preserved: the spawn room's own keepers must be at full count before
  any reserver is spawned.
- Target-side conditions match the old gate (stopRemote, invaderCoreBlocks, unreserved / ticksToEnd
  < 1000 / foreign reservation, no live reserver assigned) and de-duplicate with the in-loop
  fallback naturally.

The carrier sizing needs no change: `EnergyPerTick` is computed from the live source object, so the
fleet requirement self-adjusts upward once the reservation lands (10/tick regen).

### Tests

New `test/reserver-priority.test.cjs` drives the real functions in a VM: unreserved controller with
full home keepers spawns a 3-CLAIM reserver; short-handed keepers (0.78.155 gate) and an existing
live reserver and a healthy own reservation (>= 1000) each do not spawn; a < 1000 remainder renews;
a busy spawn skips. Plus an ordering pin: the strategy_highLevel call sits between
`trySpawnHarKeeper` and `workerManager`. The external-road ordering pin is now scoped inside
`trySpawnOuterHarCarrier` (the reserver has its own legitimate free-spawn check).

## v0.78.167 — Mine links: drop the exclusivity idea from v0.78.166, it starved a second mine

v0.78.166 restored link claiming by deduping on the link id. Ten minutes live showed why that is
wrong: E41S32 has its two sources two tiles apart, with containers at (20,26)/(20,27) and links at
(21,26)/(21,27) - every container is adjacent to every link. The first source claimed both links and
marked them used, so the second source got `link: undefined` again (26/28 claims empire-wide, the two
misses being exactly that room and RCL6 W26N58, which genuinely has no mine link).

A link can only be shared when the two containers sit next to each other, and in that case sharing is
the correct behaviour - both keepers push into whichever link has room, which is what ran in
production until the regression landed. So the rule is just "a link adjacent to this mine's container",
with no ownership notion at all. `test/station-sources-link.test.cjs` now also pins the E41S32 geometry
and fails if exclusivity comes back.

## v0.78.166 — No mine ever got its link, so energy piled up on the ground and decayed

`StationSources.update()` deduped the link list with the **container's** id:

```js
if (container) usedContainer[container.id] = true;               // mark it used
links = room[STRUCTURE_LINK].filter(e =>
    container.pos.isNearTo(e) && !usedContainer[container.id]);  // always false
```

The guard is evaluated one line after the container is marked used, so it is *always* false and
`links` is *always* empty - `stationSources[*].link` / `link2` were written as `undefined` for every
source in every room. The regression came in with the container-dedupe fix in `c6dc5ec`, where the
new `usedContainer[...] = true` line silently killed the link filter that had been passing only
because that map was never written before.

The damage is silently chained:

- `harvestEnergyKeeper` sets `notLinkFull = link && ...`; with no link the keeper neither pushes
  overflow into the link nor pulls from the container (`withdraw(container)` lives in the same
  branch), so a full 2,000 container just spills onto the ground.
- `transformLink` returns early on `if (!link)`, so mine links never forward anything.
- `carrierManager` skips the container-hauling loop when `room.link.length >= 6`, and RCL8 rooms
  do have 6 links - so those rooms had **neither** path running.

Measured live 2026-10-31: all 14 rooms reported `nolink=2/2`; roughly 60k energy was lying on the
ground across the empire and decaying. E55S39 was the worst: both mine containers pinned at
2000/2000 with 8,672 + 5,005 on the ground, still growing ~36 energy/tick.

Fix: dedupe links by the **link's own** id (`usedLink[e.id]`), marking only the first two so a
third link next to the same container stays available to another source. `test/station-sources-link.test.cjs`
runs the real module in a VM and asserts each source claims its own adjacent link (dual-link mines get
both `link` and `link2`); reverting the one line makes it fail with `undefined`, matching production.

## v0.78.165 — Halve the movement-cache wipe storms (bucket drain mitigation)

(Shipped as 0.78.165 because the live branch had silently advanced to 0.78.164 through parallel
deploys that were never committed; this release first snapshots that unpushed station_sources work
verbatim — dry-mine standby, spawnFailure gate removal on the keeper path, the `__outerWhy` refill
diagnostic, and the carrier body budget tightened 75% → 50% — then adds the one change below.)

Fresh telemetry after the outer-mine fleet recovered (8 carriers, both containers drained to 0-16,
keepers 2/2): avg 18.6 CPU/tick on the 20 CPU plan with **23.8% of ticks over the limit**, and the
bucket fell 8046 → 2225 in two days. Average CPU is below the limit, so the drain is spike-driven -
and the documented spike source is `BetterMove.deletePathInRoom()`: it deletes every cached path
crossing the room, so a dozen creeps re-path at once (rooms phase max 155 CPU).

`MOVEMENT_CACHE_REFRESH_INTERVAL` 1201 → 2401: the wipe storm now hits half as often. The tradeoff
class is unchanged (structure changes reach pathing up to 2401 ticks late; failed moves re-evaluate
on the spot), and 2401 still sits inside the movement module's own 3000-tick unused-path expiry, so
hot paths keep getting refreshed and cold paths were already self-expiring.

Outer-mine status verified live before this change, no code fix needed there: the 17k-tick
zero-carrier window in the telemetry overlaps the W26N58 collapse era (v0.78.154's ordering mistake,
reverted in .155, root-caused in .156). The line now runs keeper 2/2, fleet 8, containers drained.

## v0.78.164 — The standoff gate locked itself, so the v0.78.163 deadlock came back

Two hours after v0.78.163 shipped, W26N59 (29,4) was dead again in exactly the same way: container 0/2000,
source frozen at 1,500, two empty carriers parked on (28,6)/(27,7) - the two tiles of the single-file
approach - and the new keeper pinned at (26,8) for the whole 53-tick sampling window. The standoff worked,
then switched itself off.

Cause: the standoff was gated on `carryWait < OUTER_CARRY_FILL_WAIT`. For an **empty** carrier `carryWait`
only ever grows inside that very standoff branch, and the only place it is reset to zero sits inside
`if (this.store[RESOURCE_ENERGY] > 0)` - the "carry the load home" branch, which an empty carrier never
reaches. So the counter ratchets to 150 and stays there forever, the guard turns permanently false,
`holdPos` is deleted, and the carrier walks back onto the dock. The cap was also pointless by
construction: "wait too long, then go home" needs a return trip, and the return trip is exactly what an
empty carrier cannot do. All the cap did was move the parking spot from an off-road tile back onto the
corridor.

Fix: the decision moved into `StationSources.outerCarryShouldHold(creep, container)`, a stock-only
predicate with no time limit - dry dock and empty hands means hold, full stop. It is re-evaluated every
tick from real inventory, so it is not a new permanent state: the tick the container holds any energy the
predicate goes false and the carrier walks in. The wait counter is kept for observability only
(`memory.holdWait`, reset when the hold ends) and no longer doubles as a gate. Stale `carryWait` values
inherited from 0.78.163 (the two carriers in W26N59 sit at exactly 150) are cleared when the empty
carrier next heads in to load, so the first load after a dry spell still fills the hold instead of
departing with a token few hundred energy.

Verification: `test/outer-carry-dock.test.cjs` now pins the predicate behaviourally - an empty carrier on
a dry dock holds even with `carryWait` at 150 and at 9999 (the exact regression), a carrier with cargo or
a dock with energy does not, and the negative control patches the stock guard out and asserts the
predicate flips. The call-site assertions also forbid `carryWait` / `OUTER_CARRY_FILL_WAIT` reappearing in
the guard, because a second gate there is precisely how this came back.

## v0.78.163 — Empty carriers parked on the loading dock and deadlocked the keeper

The (29,4) mine point in W26N59 stayed dead after v0.78.162 fixed its top-up: container 0/2000 and the
source frozen at exactly 1,500 energy. Position sampling showed the real shape of it - two empty carriers
did not **stand** on (28,6)/(27,7), they **swapped tiles with each other every single tick**: whoever was
at range 2 stepped into range 1 and pulled the other one back. Because `lastPos` resets on every swap,
none of the existing "creep is not moving" detectors could see it, and the pair permanently occupied both
tiles of the single-file road. The keeper, queued behind them at (27,8) with a free 4-step path, had been
alive for **561 ticks** and had never once stood on the container - so the container never filled, so the
carriers never had a reason to leave. A closed loop: dry dock -> no mining -> drier dock.

Cause: a carrier that arrives with nothing to load and finds nothing in the container simply `return`s
from `harvestEnergyOuterCarry` - it has no move intent, but the movement layer still pulls it out of its
tile whenever another creep wants that tile. Two such waiters adjacent to one dock trade tiles forever.

Fix: an empty-handed carrier must not queue at the dock when the dock is dry. `harvestEnergyOuterCarry`
now checks this **before** the "walk to the container" branch: if the container has no energy and the
creep carries none, it is moved to a standoff tile 2-4 tiles from the container that is **off the cached
mine road** (`outerCarryHoldTile` / `outerCarryHoldOffRoad`), leaving the dock and the approach corridor
to the keeper. As soon as the container holds any energy the condition goes false and the carrier walks
back in to load. The standoff is capped by `OUTER_CARRY_FILL_WAIT` (it keeps counting `carryWait`), so a
genuinely dead mine point still recycles its carriers through the existing return-trip path instead of
inventing a new permanent state.

The tile is cached in `creep.memory.holdPos` for 60 ticks (picking one needs an area scan) and occupied
tiles are collected with one `lookForAtArea` per kind rather than one `lookFor` per candidate.

## v0.78.162 — Carrier top-up counted the whole room, so one mine point starved

W26N59 has two source-keeping points. The room's five carriers were all registered on (29,4), whose
container read 0/2000 and whose source sat untouched at 1,500 energy - while (27,29) had its container
**full** (2,000) plus 2,381 on the ground and `carryCreeps` **empty**. Nothing was hauling that backlog
and nothing was being sent to.

Cause: two numbers in `trySpawnOuterHarCarrier` were keyed on the **room** while their counterparts were
keyed on the **mine point**. `CarryPartCnt` is the deficit of one station, but the in-flight deduction
loop (`t.roomName == targetName`) subtracted the CARRY of carriers serving the *other* station in the same
room, and `mineCarCnt` (compared against the per-station `mineCarCap`) likewise counted every carrier in
the room. With five carriers on the dry point, the loaded point's deficit went negative forever, so
top-up never fired for it - the "a statistic must be grouped by the object being served" rule.

Both now key on `t.id`, the task's source id (same convention as the keeper succession guard). The
room-level `onThisMine` / `outerCarrierBacklogQuota(spawnRoom, room)` pair is left alone: those two are
consistently room-scoped and are compared against each other.

## v0.78.161 — Outer fleet was over-spawned because in-flight carriers were invisible

After the keeper fix the mine finally had staff: keeper 2, carriers **9**. But the requirement for that
mine is 17 CARRY (~850 capacity, `__outerWhy = noCarryNeed-29`), so nine carriers of 400-600 capacity
meant ~4,000 capacity - 4-5x over - costing **1.93 CPU/tick** and dragging the bucket from 9,300 to
5,200 (used 19.7-21.8 against a 20 budget).

Cause: `CarryPartCnt` subtracts the CARRY of `data.carryCreeps`, and that list is only filled when a
carrier **reaches the mine and registers**. Top-up runs every 6 ticks while hatching takes 60+, so during
that window the formula cannot see the new creep and spawns another one - every pass.

Two guards:

1. every spawn-room carrier whose `headTask.roomName` is this mine (hatching, travelling, or working) is
   now subtracted too, deduplicated against `carryCreeps`;
2. a hard per-mine ceiling `max(2, ceil(NeedCarryPartCnt / 12))` zeroes the deficit, as the last line of
   defence against an over-provisioned pure-consumer fleet.

The nine existing carriers are not recycled (the codebase convention is to let them die naturally); they
age out within one creep lifetime and the ceiling prevents a repeat.

### Tests

Case ⑬: the in-flight deduction must follow the `carryCreeps` subtraction, and the per-mine ceiling must
exist.

## v0.78.160 — Outer keepers were blocked by the same `spawnFailure` poison

A day after the carriers were fixed: W26N59 has **5 outer carriers and 0 keepers**, containers at 0 and
sources at 1,500 - the haulers were driving an empty mine. `trySpawnOuterHarKeeper` opens with

    pro.cleanupDuplicateKeepers(roomName);
    if (spawnRoom.spawnFailure) return null;

and `spawnFailure` only means "some spawn attempt failed in this tick" - the spawn room's own keeper
failing to afford its 1,800 body sets it, and it blocks the outer keeper before it can even try. That is
the 10-08 "gate self-lock" pattern again: the keeper is the outer mine's **only** energy input, so gating
it on a flag that means "the room is busy" turns the mine off permanently.

Same treatment as the carrier path: the `spawnFailure` early return is gone, and the two cached fields are
cleared immediately before `trySpawn` (`spawnFailure = false; currentEnergyAvailable = undefined;`).

### Tests

Case ⑫: no `spawnFailure` early return after `cleanupDuplicateKeepers`, and the reset must immediately
precede the keeper `trySpawn`.

## v0.78.159 — Clear the room's stale `spawnFailure` before the outer carrier attempt

The real blocker, finally: `StationHive.trySpawn` starts with

    if (room.spawnFailure) return null;

and `spawnFailure` only means "some spawn attempt failed in this tick" - a home keeper that could not
afford its 1,800 body, or the spawn being busy, sets it. Our outer carrier is far cheaper (900), but it
never even got to try: the v0.78.157 diagnostic recorded `try:carry11,avail1800,budget1350` while the
carrier count stayed at zero across two days.

`strategy_highLevel.spawnCarrierNow` has always reset those two fields before calling `trySpawn` for
exactly this reason; the outer path never did. It now does:

    spawnRoom.spawnFailure = false;
    spawnRoom.currentEnergyAvailable = undefined;
    StationHive.trySpawn(spawnRoom, spawnRoom.name, carrierBody, ...)

Safe because the hard gate above already requires every own source of the spawn room to have a keeper, so
the room is not starving when this runs.

### Tests

New case ⑪ asserts the reset immediately precedes the outer-carrier `trySpawn`.

## v0.78.158 — Outer carriers sized at half the hive so the spawn window actually opens

The diagnostic from v0.78.157 answered it on the first pass:

    __outerWhy = try:carry11,avail1800,budget1350@83938814

so every gate was open and the attempt really was made - it just needed `hive 1800/1800` **and** a free
spawn in the same tick. That window is rare on a RCL5 spawn room: four keepers are replaced every 1,500
ticks at 1,250 energy each, so the hive spends most of its life refilling from near zero (measured 2/1800,
7/1800, 750/1800 across samples). Result: two days, containers 4000/4000 and 3,161 energy on the ground,
zero carriers.

The body budget is now capped at **50% of the hive** (900 on RCL5) instead of 75% (1,350). A 900-energy
carrier fits as soon as the hive passes 900, which happens ~45 ticks after any keeper hatch - an order of
magnitude more windows. Smaller carriers mean more trips, but "a small carrier hauling" beats "no carrier
at all", and the CARRY-deficit / fleet-cap / quota limits still bound the fleet size.

The `__outerWhy` diagnostic stays (short idempotent string in `Memory.rooms[<mine>]`).

## v0.78.157 — Diagnostic: record which gate stopped the outer-carrier top-up

W26N58 recovered (RCL5, 841k/1.215M, hive 1650/1800, 3 carriers, storage 78k) and the outer mine has
been sitting with **both containers full (4000) and 3,161 energy on the ground for two days with zero
`outerHarvestEnergyCarrier`** - while every gate checked from the outside was green: keepers 4 >= 2 sources,
`outerMineStarvesSpawnRoom` false, quota 2, fleet cap 15, pathTime 94, container recorded, flag present and
route maintenance still running (site build 28 ticks ago).

Rather than keep guessing, `trySpawnOuterHarCarrier` now records the last early-return reason in
`Memory.rooms[<mine>].__outerWhy`, e.g. `noFreeSpawn`, `keeper<src3<2`, `starves+quota1>=2`,
`noCarryNeed-3,need38,path94`, `try:carry22,avail750,budget900`. It is a short idempotent string, no
behaviour change, kept permanently for debugging.

## v0.78.156 — The upgrade-container priority was starving the hive (root cause of the collapse)

The W26N58 collapse was not caused by the outer mine alone. v0.78.144 moved the upgrade-container
assignment to the **top of `carrierManager`**, in front of the hive branch. In a room with one carrier
(which is exactly what a starved room has), that single carrier was sent to fill the controller container:

- `spawn`/`extension` never got filled (hive sat at 300/1800),
- so the room's own keepers could never pay the ~1,250 respawn and died of old age,
- income went to zero and nothing in the room could recover - not even a worker (needs 300 in the hive).

Measured: hive 300/1800 for minutes, the single carrier `isFree() && storeEmpty()` yet with **0 tasks**,
`HiveNeedToFill = true`, and a manual `addTask(generatorFillHiveTask(...))` worked fine - the task simply
never got assigned because the upgrade-container block had already popped the carrier.

Removed that block. The hive branch is back to first place in `carrierManager`; the upgrade container is
only fed later, in `workerManagerAfterCarrier` (the v0.78.143 placement, which runs after hive and tower,
when a carrier is still free).

### Tests

`upgrade-fill-priority` case ⑤ inverted: `carrierManager` must **not** contain the early upgrade-container
call, and the hive branch must still exist.

## v0.78.155 — Revert the carrier priority; a room must be healthy before it feeds the mine

v0.78.154 moved the outer-carrier top-up in front of the room's own hatches so it would see a full hive.
Two and a half hours later W26N58 was dead: **no keepers, no upgrader, one carrier, hive at 300/1800**
while sitting on 58k in storage - the room's own mining had stopped completely.

That is the E53S21 failure mode with a different cast: the 1,250-energy outer carrier (70% of a RCL5
hive) took the energy first every time, so the room's own keepers could never pay for their 1,250-1,700
respawn, died of old age, and the income went to zero. My earlier reasoning ("only the carrier, and the
carrier does not produce energy") missed that the carrier still spends the *keeper's* spawn budget.

Reverted: the outer-carrier call is back behind the room's own spawning, and
`trySpawnOuterHarCarrier` now refuses to run at all when the spawn room does not have a keeper on every
own source:

    if (targetName != spawnRoom.name
        && spawnRoom.creeps("harvestEnergyKeeper", false).length < ownSourceCnt) return null;

A spawn room feeding an outer mine must be healthy first; the outer mine is a surplus consumer, never a
priority consumer.

### Tests

Case ⑩ rewritten: the hard gate must exist, and `strategy_highLevel` must not contain the early
carrier call any more.

## v0.78.154 — Outer carriers now spawn before the room's own hatches

Follow-up to the W26N59 investigation: carriers were replenished only sporadically.

Measured at tick 83899291 with **everything else green**: `CarryPartCnt = 22` (needs 38 CARRY, one car
supplies 14), `outerMineStarvesSpawnRoom = false`, quota 2, spawn **idle**, hive **1800/1800** - and yet
no carrier for 80+ ticks while the containers sat at 2000/2000 and 6,000 energy rotted on the ground.

The reason was ordering, not gates. A hand call showed `room.currentEnergyAvailable = 450` at pass time:
the room's own keeper/worker/carrier/upgrader spawning (lines just above) had already eaten 1,350 of the
1,800 hive, so the 1,250-energy outer carrier could never pay. End-of-tick probes read 1800 because the
home carriers refill the hive during creep execution, after the pass.

The outer **carrier** top-up now runs right after `transformLink`, before the room's own hatches, so it
sees the fresh hive. Only the carrier is moved: keepers/workers/carriers stay behind the home spawns, and
the whole `StrategyOuterHarvest.exec` chain stays where it was - the E53S21 crash came from outer *keepers*
taking the home spawn energy, and that ordering is untouched. The carrier is bounded anyway by
`outerCarrierBacklogQuota` (2), the CARRY deficit and the fleet cap.

### Tests

`test/outer-carrier-spawn.test.cjs` case ⑩: the early call must exist, must precede
`trySpawnHarKeeper(room)`, and the full outer chain must still come after it. Negative control: removing
the early call fails.

## v0.78.153 — Route planning treats road construction sites as finished road

User: containers do not need roads; just plan the path as if the road were already there.

The outer-route cost matrix only discounted **built** roads (cost 1) and left everything else at terrain
cost (plain 2, swamp 5). Consequences:

- a route is computed, `placeOuterRoadSites` lays sites along it, but on the next recompute
  (`OUTER_ROAD_PATH_TTL`) those sites still look like plain ground, so PathFinder drifts onto the grass
  beside them and a *second* line of sites gets laid - the two fight each other and the road never
  finishes;
- the cached travel time therefore always reflects the unbuilt terrain, which is also what fed the carrier
  requirement.

`outerRoadRoomCallback` now sets cost 1 for every `STRUCTURE_ROAD` construction site (skipping tiles that
hold a blocking structure). Only road sites are discounted - container tiles need no road and
`placeOuterRoadSites` already skips any tile that has a structure, so nothing is laid on top of them.

### Tests

`test/outer-carrier-spawn.test.cjs` case ⑨: the callback must iterate construction sites, only discount
`STRUCTURE_ROAD`, and set cost 1. Negative control: removing the discount fails.

## v0.78.152 — Carrier quota divided by the wrong number, and the path cap halved the need

User: keep building the outer road, but do not treat "road unfinished" as a reason to size the fleet down.

Two arithmetic defects kept W26N59 at exactly one carrier (containers 2000/2000, 6,800 energy on the
ground, spawn idle, hive 1800/1800):

**1. `outerCarrierBacklogQuota` divided the backlog by the car's *price*.** `floor(4000 / 2500)` = 1,
where 2,500 is `OUTER_CARRIER_COST` (what a carrier costs to build), not what it can carry. One carrier
moves ~1,000-1,700 per trip, so a 2-source mine (20 energy/tick) can never be cleared by one. New
`OUTER_CARRIER_TRIP = 1700` (matching the existing "一趟运 1700" comments): 4,000 backlog -> 2 carriers,
6,000 -> 3. Empty backlog still yields 0, so the gate cannot be permanently bypassed.

**2. The requirement was capped at `roadTiles * 1.2`.** That factor assumes a finished road (1 tile ~ 1
tick); with the road unbuilt, plain terrain is 2 ticks/tile and swamp 5, so the real round trip is 94
ticks while the cap said 36 - `needCarry` came out 13 and the existing 20-CARRY carrier satisfied it. As
instructed, the cap no longer depends on road state: the requirement uses the measured `pathTime`
directly, with only an absolute sanity clamp of 10..400 ticks (still guards against the historical corrupt
values such as 843).

### Tests

`test/outer-carrier-spawn.test.cjs` cases ⑥/⑦ cover both; `edge-link`'s quota expectations were updated
to the trip-based numbers (6,000 -> 3) and its "fleet at quota" scene now uses three cars.

## v0.78.151 — The carrier requirement was underestimated while the road is unbuilt

v0.78.150 removed the wrong guard, but W26N59 still kept exactly one carrier. The arithmetic was the
problem:

    capPath    = cached road path (about 30 waypoints)
    pathCap    = round(30 * 1.2) = 36        // assumes a road: 1 tile ~ 1 tick
    effPathTime= min(94, 36) = 36
    needCarry  = ceil(36 * 2 * 8.62 / 50) = 13
    CarryPartCnt = 13 - 2 - 20 (the existing carrier) = -9  -> "enough", never spawn

But the road is **not built** (15 sites queued): plain terrain costs 2 ticks per tile and swamp 5, so the
real round trip is ~94 ticks. One 1000-capacity carrier therefore moves ~5.3 energy/tick against 20/tick
of production - containers at 2000/2000, 6,800 energy on the ground.

`pathCap` now uses the 1.2 factor **only when `outerRoadComplete(data)`** is true; otherwise 3x, which is
still an upper bound (it keeps guarding against the historical corrupt values like 843) but no longer
halves the requirement. The road-builder top-up path also stopped using `spawnFailure` as a gate, for the
same reason as the main path.

### Tests

`test/outer-carrier-spawn.test.cjs` cases ⑥/⑦: the requirement cap must branch on `outerRoadComplete`, and
the builder top-up must not be gated on `spawnFailure`. Negative control: reverting the cap to a flat 1.2
fails.

## v0.78.150 — Outer carriers: stop gating top-up on "is a carrier already at the container"

Follow-up to v0.78.149, which got the first carrier hatched in W26N59 but not the second.

State after that fix: **one** `outerHarvestEnergyCarrier` (capacity 1000), containers at 2000/2000 with
6,800 energy on the ground, spawn idle, hive full at 1800/1800. Throughput of one carrier on a 94-tick
route is ~5.3 energy/tick against 20/tick of production, so three or four are needed - and none came.

`trySpawnOuterHarCarrier` had a second guard:

    let isNearToAny = container ? carrierCreeps.filter(e => e.pos.isNearTo(container)).head() : undefined
    if (CarryPartCnt > 0 && !isNearToAny) { spawn }

`CarryPartCnt` already subtracts the CARRY capacity of every existing carrier, so it *is* the remaining
deficit. Gating on "no carrier is adjacent to the container" makes a loading carrier look like enough
capacity, and the pass (every 6 ticks) usually runs while the single carrier is at the container - so the
deficit never caused a spawn. The guard is gone; top-up is driven purely by the capacity deficit.

**Answering the size question**: the carrier built was 32 parts - 2 WORK + 20 CARRY + 10 MOVE, 1,700
energy, capacity 1000 - i.e. the "road builder" variant (`carrierBuildCreep` = false because no carrier
has WORK yet). The pure-carry template tops out at 50 parts / 2,500 energy, and since v0.78.149 the budget
is additionally capped at 75% of the hive (1,350 on a RCL5 spawn room), so later ones will be ~18 CARRY
(900 capacity) unless the hive grows.

### Tests

`test/outer-carrier-spawn.test.cjs` case ⑤ asserts the `isNearToAny` guard is gone and the condition is
just the capacity deficit. Negative control: restoring the guard fails.

## v0.78.149 — Outer carriers were being starved by `spawnFailure` and an oversized body

W26N59 was added as an outer mine yesterday. Twelve hours later: **both containers at 2000/2000**,
**6,700 energy lying on the ground** next to them, two keepers happily mining, and **zero
`outerHarvestEnergyCarrier`** - nothing was hauling.

Diagnosis (all numbers measured live):

- both mine points had `pathTime` 94 / 64, containers assigned, road paths cached, `carryCreeps` **0**;
- `outerMineStarvesSpawnRoom` = false, fleet cap 15, quota 1 - none of those gates blocked it;
- calling `trySpawnOuterHarCarrier` by hand returned `undefined` and set `spawnFailure = true`, i.e. the
  spawn attempt itself failed while the hive was momentarily drained (`energy 109/1800`, spawn busy).

Two causes, both in `trySpawnOuterHarCarrier`:

**1. `if (spawnRoom.spawnFailure) return;`** - that flag means "some spawn attempt failed this tick",
and the room's *own* keeper/carrier/upgrader attempts set it too whenever the single spawn is busy. The
outer pass runs every 6 ticks, so it was blocked almost every time. Replaced with the accurate check
"is there a free, active spawn right now?" (the route refresh still runs before it, as the core-profile
test demands).

**2. Body budget ignored the hive ceiling.** The body is sized from `getEnergyCapacityAvailable()`, so on
RCL5 (1800) it asked for the full 1800. Hatching a 1800-energy carrier takes ~56 ticks and drains the hive
to ~100, during which the room cannot spawn anything else and the outer carrier itself competes with home
creeps. The budget is now additionally capped at **75% of the hive**, which trades a slightly smaller
carrier for actually getting one.

### Tests

New `test/outer-carrier-spawn.test.cjs`: no `spawnFailure` early return, the free-spawn check is present,
the budget is capped at 75% of the hive **and** still scaled by currently available energy. Negative
controls: restoring the `spawnFailure` gate, and dropping the 75% cap, each fail. `core-profile` was
updated in two places (route-refresh ordering, body-budget intent).

## v0.78.148 — RCL8 keeps two carriers, and only adds more when the hive is really drained

User: two carriers per room is fine, as long as room operations do not suffer.

Measured on 2026-10-26: 44 carriers at 6.25 CPU (60% of `unitTasks`), 17 of them **idle and empty**,
while `carrierTarget` for the thirteen RCL8 rooms was 2. So the carriers were not needed - they were
accumulated by the target itself flapping:

    carrierTarget = 2; if (link < 4) +1; if (HiveNeedToFill) +2;

`HiveNeedToFill` only means "not full", and in an active room the hive is almost never full
(spawns and upgraders draw from it constantly), so the target sat at 4 most of the time. Since there is
no recycle path, the extras only leave by dying -「加编 → 老死 → 再加编」, a ratchet.

The hive bump now requires **both** a real deficit (> 30% of capacity) **and** that the existing carriers
are actually busy (`busyCnt >= carrierCnt - 1`, ignoring ones still hatching):

- steady state: 2 per room;
- hive drained (e.g. 3000/12900) with both carriers busy: temporary 4, collapsing back as soon as the
  deficit closes;
- hive merely "not full" or carriers idling: no bump.

Surplus carriers are not recycled - they die naturally, as everywhere else in this codebase, so the count
decays to 2/room within one creep lifetime (~1500 ticks) without touching spawn queues.

### Tests

New `test/carrier-target-tighten.test.cjs` drives the real `trySpawnCarrier` in a VM: steady state at 2
does not spawn, a small hive deficit does not spawn (this is what used to ratchet), a big deficit with
**idle** carriers does not spawn (stale busy history must not fool it), a big deficit with **busy**
carriers still spawns (rooms must not stall), and above the emergency ceiling of 4 nothing spawns.
Negative controls: reverting to the plain `HiveNeedToFill` bump, and dropping the busy check, each fail.

### Same version, deployed on top: power creep cadence + structure-cache getter fix

A second pass over the post-0.78.147 telemetry (avg 18.8 CPU/tick, 20.5% of ticks over the 20 CPU
allowance) found no fat left in the working creeps - 30 carriers and 30 keepers run at 0.13-0.15 CPU
each, and the rooms pass is fully cadenced. Two changes shipped under this version number:

- `POWER_CREEP_TICK_INTERVAL` 2 → 3. `power:OPF` still cost ~1.0 CPU/tick at every-2nd-tick. The
  shortest skill cooldown is 50 ticks (`GENERATE_OPS`), the rest are 300-800+, so firing up to 2 ticks
  late is invisible; the power-burn credit pacing self-corrects over the effect window. Saves ~0.3
  CPU/tick.
- 极致建筑缓存's `room.<resource>` getters (例5/例6) cached `last_fetch_time`/`sum` in a per-type
  prototype closure: reading `roomA.energy` then `roomB.energy` in the same tick returned roomA's sums
  for roomB. No business code uses these getters (everything goes through `roomMassStoreCnt`), but the
  library documents them - the cache is now keyed per room, pinned by
  `test/structure-cache-resources.test.cjs`.

## v0.78.147 — Same path caching for keeper movement

Follow-up to v0.78.146, applied to the largest remaining role: `harvestEnergyKeeper` at 4.4 CPU for 30
creeps (~0.15 each).

Five `moveTo` calls in `station_sources.js` had no `reusePath`, and all five target static map objects:

- walking onto the source container (`range: 0`), the source itself (`range: 1`, two call sites),
- returning to the container, and returning to the storage.

They get `reusePath: 15` (shorter than the 25 used for power creeps: keeper movement is short-range and
happens around congested source tiles, so a stale path should expire sooner).

Left alone: the ranged-attack movement (`moveTo(target, {range: ...})` in the combat helper) and the
border/centre-room helpers - their targets move or change every tick.

## v0.78.146 — Moving creeps finally cache their paths (measured ~1 CPU/tick)

CPU audit at average 18.2/20 with `unitRoles` showing `power:OPF` at 2.56 - the largest single line.
Tracing it: twelve power creeps, eight of them parked on `goToNearPop`, five actually still walking
(distances 6/10/24/25/30 to their target).

`Creep.prototype.goToNearPop` ended with

    else this.moveTo(position, { visualizePathStyle: ... })

with **no `reusePath`**, so every one of them ran a fresh path search every tick. Measured directly in
the console, same five creeps:

    moveTo(position)                   1.105 CPU
    moveTo(position, {reusePath: 30})  0.109 CPU

Ten times cheaper for a target that never moves (storage / terminal / power spawn).

Fixed in the same spirit:

- `goToNearPop` and all ten `PowerCreep` operation handlers (`OpStorage`, `OpSource`, `OpSpawn`,
  `OpTower`, `OpFactory`, `OpPowerSpawn`, `OpLab`, `OpMineral`, ...) get `reusePath: 25` - their targets
  are all static structures;
- the generic resource handlers (`fillRes`, the `carryRes`-style mover) and `build` get
  `reusePath: 20`.

Deliberately **not** changed: `goTo(obj)`, `pickup`, `recycle` and the border-escape helper - their
targets can be moving or one-shot, where a cached path is wasted or wrong.

## v0.78.145 — Linkless rooms keep one spare carrier

v0.78.144 restored the upgrade feed, but only while the room had two carriers. Sampling showed the room
oscillating between one and two: `carrierTarget` is `clamp(ceil((sources + keepers) / 2), 2, 3)` = 2, and
whenever the second carrier died the controller container sat at 0 again (progress frozen at 115,043 for
40+ ticks, `empty & free carriers = 0` in every sample). The moment the replacement hatched, the rate
jumped straight back to 10/tick.

A linkless room (RCL4-5) has one extra standing consumer - the controller container - that link rooms
feed through the upgrade link instead, so it gets `carrierTarget + 1` (capped at 4). Cost: one 800-energy
carrier; benefit: the upgrade feed stops depending on a single creep's lifetime.

### Tests

`test/upgrade-fill-priority.test.cjs` asserts the `+1` for rooms without an upgrade link. Negative
control: removing that line fails.

## v0.78.144 — The upgrade container outranks hive and storage in carrierManager

v0.78.143 moved the upgrade-container assignment in front of the storage-carry gate, but the room stayed
frozen: the container was still 0/2000. Tracing the single remaining carrier showed it walking to
**the storage at (38,9) with 800 energy** - the controller container never entered the pipeline at all.

The pipeline lives in `carrierManager`, which runs earlier: loaded carriers go to the hive, empty ones to
hive + `carryEnergyAuto`, then towers, and only after that does `workerManagerAfterCarrier` hand out
anything else. With a hive that is always "full" and a storage that is 1,000,000 capacity - i.e. never
full - the controller container (2,000 capacity) never wins a carrier.

That is the recorded design error "serve the capped consumer before the bottomless one", so the
assignment now happens at the **top of `carrierManager`**, before the hive branch, and it takes the first
free carrier. Rooms with an upgrade link are unaffected (`generatorFillEnergyTask` returns nothing when
the link exists), so only linkless RCL4-5 rooms change.

Measured before the fix: progress frozen at 115,043 for 20+ ticks, container 0, upgrader 0 energy with
220 ticks to live, single carrier loaded with 800 energy bound for the storage.

### Tests

`test/upgrade-fill-priority.test.cjs` gains the ordering assertion inside `carrierManager` (the fill call
must precede that function's own `if (StationHive.HiveNeedToFill(room))` branch). Negative control:
moving the block after the hive branch fails.

## v0.78.143 — Feeding the upgrade container must not hide behind the storage-carry gate

Same failure shape as v0.78.139 and v0.78.140, now in the *high-level* economy path that W26N58 switched
to once it finished its storage.

Measured: `controller.progress` frozen at 115,043 for 20+ ticks, the upgrade container at 0/2000, the
upgrader standing on it with 0 energy and 220 ticks to live, while two carriers walked around with 800
energy each.

Cause: `workerManagerAfterCarrier` assigns the upgrade-container fill inside
`if (StorageCarryEnergyTasks.length)`. That list comes from `generatorCarryStorageEnergyTask`, and in a
room whose hive is already full (1300/1300) **and which has no link yet** (RCL4-5) it is empty - so the
whole block is skipped and nobody ever feeds the controller container. The low-level path had the same
bug in a different place (v0.78.139: tower first; v0.78.140: spawn spam).

The upgrade fill is now assigned **before** that gate, to the first free carrier. `fillRes` already
handles an empty carrier by sending it to the storage first (`prototype_creep.js:626`), so no extra
plumbing is needed. Rooms that have a link are unaffected: `generatorFillEnergyTask` returns nothing
when an upgrade link exists, so this only adds work in linkless rooms.

The duplicated assignment that used to hand the same task to two carriers inside the block went away with
the move (one carrier per pass is enough: 800 energy lasts an upgrader ~130 ticks at 6 WORK).

### Tests

`test/upgrade-fill-priority.test.cjs` gained a case on `strategy_highLevel`: the
`generatorFillEnergyTask` call must appear before `if (StorageCarryEnergyTasks.length)`, and that gate
must still exist. Negative control: moving the block back inside the gate fails the assertion.

## v0.78.142 — The power switch now covers every burn call site

Health check 19 hours later, and one thing did not add up: `Memory.marketSettings.powerSpawnOtherRooms`
has been `false` since 2026-10-21, yet `Game.gpl.progress` was rising **13 per tick** and the fourteen
storages lost 770k energy in 2.6 hours.

There are **two** places that call `processPower()`:

- `station_carry.tryProcessPower` - the pilot room, with the OPERATE_POWER pacing (this one honoured the
  switch);
- `strategy_highLevel.processPowerSpawn` - pre-existing, runs for **every room every tick**, and it only
  checked the account-level energy flag plus the room's own 30k floor. It never looked at the switch.

So the switch was effectively cosmetic: thirteen RCL8 rooms kept burning 1 power/tick each (50 energy
each), while the room I thought I had limited kept burning on its own path. This is the same class of
mistake already recorded twice - "a decision with several call sites must be checked at every one".

`processPowerSpawn` now:

- returns for the **pilot room** (that one belongs to `tryProcessPower`, otherwise a single power spawn
  burns twice a tick);
- returns when `powerSpawnOtherRooms === false`;
- keeps both original gates (account-level abundance, and the room's own storage floor).

### Tests

New `test/process-power-switch.test.cjs` loads the real module in a VM: switch off means a non-pilot
room does not burn, switch on still burns exactly once, the pilot room never burns here, and both
original gates (account level, 30k room floor) still block. Negative controls: removing the switch check
and removing the pilot-room skip each fail on their own assertion.

## v0.78.141 — Bound the upgrader count as well

Follow-up to v0.78.140, observed live within a minute of deploying it.

With the carrier spam stopped, the room finally had 800 energy free, so an upgrader could be spawned -
and then another, and another. The low-level branch used "free carriers carrying energy, minus one" as
the upgrader target. That reads as 1-2 in a healthy room, but with 19 surplus carriers it is always
true, so the room would have kept spawning 800-energy upgraders it cannot feed.

`strategy_lowLevel` now caps upgraders at **3** (`upgCnt < 3`), counted with `spawned=false` so a creep
still hatching is included (otherwise the condition fires again the next pass). Three of them are
6 WORK each = 18 energy/tick, which matches the room's ~20 energy/tick income; a fourth would only take
spawn slots and CPU.

Measured right after v0.78.140: upgrade rate went **6/tick -> 12/tick** as the second upgrader came
online (progress 114,221 -> 114,737 in 53 ticks), and the upgrade container stayed at ~1,900/2,000,
i.e. supply now keeps up with two upgraders.

### Tests

`test/lowlevel-carrier-cap.test.cjs` gained the upgrader assertions (count with `spawned=false`, the
`upgCnt < 3` bound). Negative control: dropping the `< 3` bound fails on its own assertion.

## v0.78.140 — Cap carriers in low-level rooms (they were spawned without a limit)

Health check on the claimed W26N58, 22 hours after v0.78.139:

    RCL3, progress 12,336 -> 113,507 / 135,000   (+5.97/tick, 6 WORK worth)
    ticksToDowngrade back to 20,000 (the max)    - downgrade risk gone
    bucket 10,000 (full), errorCount 0, used 13.8/20

But the room had **20 carriers**, 16 of them idle, 19 holding 500 energy each - roughly 9,500
energy parked on creeps that had nothing to do, while the upgrade container sat at 1,946/2,000 and the
single upgrader could only burn 6 energy/tick.

Cause: the low-level branch spawned a carrier whenever `carrier count < 1 || carryTasks.length`, and
`carryTasks` is non-empty as long as the source containers hold anything. That is a spawn every 3 ticks,
forever. Worse, each carrier costs 400 energy and occupies the spawn, so the 800-energy upgrader could
never get a slot - the room was paying for carriers it could not use instead of upgrading.

The carrier count is now bounded exactly like the high-level branch already did:

    carrierTarget = clamp(ceil((sources + keepers) / 2), 2, 3)
    +1 when the hive needs filling, still capped at 3
    spawn only when carrierCnt < 1, or (carryTasks and carrierCnt < carrierTarget)

For W26N58 that is 3 carriers for a 20 energy/tick income (3 x 500 per ~60 tick round trip = 25/tick),
which frees the spawn and the energy for a second upgrader (`getBodyLowLevel()` gives 6 WORK per 800
energy, so two of them double the upgrade rate). Surplus carriers are not recycled - they die naturally,
as the codebase already does elsewhere.

### Tests

New `test/lowlevel-carrier-cap.test.cjs` (comment-stripped source): the bounded target formula, the spawn
condition requiring `carrierCnt < carrierTarget`, no RCL8-style target of 7 in the low-level branch, the
"no carrier at all" self-rescue path, and that `strategy_highLevel` keeps the same 2-3 formula.
Negative controls: reverting to the unbounded condition, and raising the target to 7, each fail.

## v0.78.139 — The upgrade container must be fed before the tower

Found while checking the newly claimed W26N58 (RCL3, no storage): `controller.progress` was frozen at
**12,336 for dozens of ticks** while `ticksToDowngrade` fell by 1 per tick, the upgrade container sat at
**0/2000**, and the upgrader stood on it with **0 energy**. Meanwhile 1-4 carriers were idle on the same
tiles holding 500 energy each, and the tower's free capacity kept growing (it repairs the old walls and
drains itself continuously).

Cause: in `strategy_lowLevel` (the branch used by rooms with no storage / RCL < 4), the tower fill loop
runs **before** the upgrade-container assignment, and it hands a task to *every* free loaded carrier.
Because the tower in a young room is a bottomless sink, `fillTowerTasks` is never empty, so the
upgrade-container block at the end (`head()` of the *still free* carriers) never found anyone. Energy
existed; nobody carried it the last 20 tiles.

Changes:

- the upgrade-container assignment now runs **first**, taking a single carrier (the container holds only
  2,000, so this cannot crowd out the tower);
- when the hive and the tower are both satisfied and the room has no storage, the remaining loaded
  carriers now **deliver to the upgrade container** instead of idling with a full load.

### Tests

New `test/upgrade-fill-priority.test.cjs` asserts, on the comment-stripped source, that the upgrade fill
call appears **before** `fillTowerTasks`, that the no-storage fallback exists, and that no empty `else`
branch swallows the task. Negative controls: moving the block after the tower loop, and deleting the
fallback, each fail on their own assertion.

## v0.78.138 — Power burning keeps a 100k energy floor per room

User: raise the floor, without disturbing anything else.

The default `powerSpawnEnergy` goes 60k -> **100k** (both the burn decision and the fill gate). That is
the only change: rooms stop burning while they are still holding a healthy reserve, and the twelve
rooms that just started normal-rate burning stop sooner.

Overridable as always with `Memory.marketSettings.powerSpawnEnergy`.

## v0.78.137 — Rooms without an OPERATE_POWER creep burn at the normal rate

User: the other rooms, if they have no operator creep with OPERATE_POWER, should just burn normally.

`tryProcessPower` no longer starts by demanding the target room. It now branches on the effect:

- `PWR_OPERATE_POWER` present -> the paced window described in v0.78.136 (1+level per call, spread
  over the remaining effect duration so none of it is wasted);
- **absent** -> a plain `processPower()` per tick (1 power + 50 energy) whenever that room has power
  above `powerSpawnLow` (100) and energy above `powerSpawnEnergy` (60k). A room that never got an
  operator creep therefore keeps converting its own surplus instead of sitting idle.

`Memory.marketSettings.powerSpawnOtherRooms = false` switches the second branch off if the energy cost
turns out to be unwelcome.

Note this has a real energy price: each such room burns 50 energy/tick while above its floor, so a
dozen rooms can pull down to their floors. The floors are per room, so nothing starves; the conversion
is simply energy -> GPL.

### Tests

`test/power-spawn-burn.test.cjs` now expects a burn (not a skip) for a foreign room with no effect, a
skip when `powerSpawnOtherRooms` is false, a normal-rate burn once the effect expires, and a
normal-rate burn when the only effect present is a different power.

## v0.78.136 — Pace the burn so a whole OPERATE_POWER window is used up

User: don't waste the rest of the current operation - raise the energy threshold later, and try to burn
a full cycle.

Burning flat out at 5 power/tick empties the room down to the energy floor in a few hundred ticks and
leaves the remaining ~400 ticks of the effect unused - the ops were paid for nothing.

`tryProcessPower` now keeps a per-tick credit:

    budgetPerTick = max(0, roomEnergy - floor) / ticksLeftOfEffect
    credit += budgetPerTick;  burn only when credit >= (1+level)*50

When the room can afford full speed the credit is always positive and it burns every tick exactly as
before; when it cannot, the burn is spread over the remaining window instead of stopping early. The
effect is therefore consumed along its whole duration.

The threshold for *applying* a new OPERATE_POWER stays at one full window
(`50 * (1+level) * 1000`, i.e. 250k for level 4, overridable with `powerBatchEnergy`) - that is the
"raise the threshold" part: it was a flat 90k before.

### Tests

`test/power-spawn-burn.test.cjs`: with a tight budget (100k energy, 500 ticks left) four ticks produce
exactly one burn and the credit stays under one burn's cost; with a rich budget three ticks produce
three burns (pacing must not slow the full-speed case).

## v0.78.135 — Only open OPERATE_POWER when the whole window is affordable

Follow-up to v0.78.134: the burn now runs 5 power per tick, so one operation consumes
`(1+level) x duration x 50` energy - 5 x 1000 x 50 = **250,000** for level 4. Applying the effect with
less than that in storage means it expires half-burned and the ops are wasted.

`needOpPowerSpawn` now requires `room.storage.energy >= 50 * (1 + level) * 1000` (override with
`Memory.marketSettings.powerBatchEnergy`), instead of the flat 90,000 that only guaranteed a few
hundred ticks.

Measured right after v0.78.134 deployed: GPL progress +30 over 6 ticks and +45 over 9 ticks - a steady
**5 power/tick** - while the spawn's own energy went 3,050 -> 3,145 -> 4,145, i.e. the haulers keep the
nozzle fed.

## v0.78.134 — Process power every tick, inside one OPERATE_POWER window

User: call it every tick, but keep the energy topped up - burn one OPERATE_POWER through completely,
then rest until the next one.

Measured first with the effect active: one `processPower()` burns **5 power** (1 + level 4) and 250
energy, but it was only invoked by the factory loop every ~8 ticks, so a batch crawled at ~0.6
power/tick.

- The call now sits in `ManagerRooms.exec(room)`, which runs for every room **every tick**
  (`tryProcessPower` returns immediately for non-target rooms).
- The burn window is the **`PWR_OPERATE_POWER` effect itself**: `tryProcessPower` looks for
  `spawn.effects.find(e => e.power == PWR_OPERATE_POWER)` and does nothing when it is absent, so the
  spawn rests between operations instead of trickling.
- The energy floor still applies (`powerSpawnEnergy`, 60k, and the room's power must stay above
  `powerSpawnLow`), which is what stops the burn from draining the room if a refill falls behind.

The fill gate still stocks the spawn while `wantBurn` is true, and since the spawn holds 5,000 energy
that is only ~20 ticks of burning at the new rate - the next measurement will show whether the energy
logistics keep up or whether the spawn needs a dedicated feeder.

## v0.78.133 — OPERATE_POWER was blocked by an account-wide energy check

User: with the operator's OPERATE_POWER one tick burns three or four units instead of one, which is
exactly what saves the ticks (and CPU) spent burning.

The skill was wired all along - `needOpPowerSpawn()` returns the spawn and `OpPowerSpawn` calls
`usePower(PWR_OPERATE_POWER, spawn)` - but the very first line was

    if (!StationHive.isEnergyAbundant()) return false;

and the account-wide flag is false, while W32N56 was otherwise completely ready: storage power 6,000,
storage energy 181,512, room ops 8,820, the creep holds 820 ops, `OPERATE_POWER` level **4**, cooldown
0, and the spawn had no effect. So it never fired once.

The account-wide check is gone; the room-level preconditions right below it (storage power >= 3,000,
storage energy >= 90,000, creep ops >= 400, room ops >= 600) are the ones that actually protect the
energy, and they already bound the operation to a room that can afford it. This is the same lesson we
already recorded for factories: an account-wide "plenty of energy" flag cannot stand in for "this room
can afford it".

With level 4 the spawn should process several units per tick, so a 500-power batch finishes in ~100
ticks instead of ~500 - the same total energy (50 per power), just fewer tick calls.

## v0.78.132 — Power processing was locked out by the spawn's own 100-unit capacity

User: use the power spawn to save CPU, concentrate the power, burn more per run.

Measured first: `Game.gpl.progress` had not moved (**+0 over 14 ticks**) and `powerBurning` was
false. Two defects in v0.78.127:

**1. The threshold read the wrong store.** `tryProcessPower` compared `powerSpawn.store.power` with
`powerSpawnHigh = 500`, but `POWER_SPAWN_POWER_CAPACITY` is **100** - the spawn can never hold 500,
so the gate could never open. The judgement now uses the **room** stock
(`roomMassStoreCnt(room, RESOURCE_POWER)`), which is the thing we deliberately concentrated
(W32N56 holds 5,945).

**2. The fill gate refused to feed it.** `generatorFillPowerSpawnTask` only moved power in when the
room had 170k energy/1000 power or 100k/6000 - W32N56 sits at 5,945 power, just under, so the spawn
stayed at 65 power and nothing could burn. The gate now follows the burn policy: in the configured
`powerSpawnRoom`, once the room is at/above the high-water mark (or already burning) and has energy
above the floor, the spawn gets stocked.

Model that matches the API: **the power spawn is a nozzle, not a tank** - 100 power / 5,000 energy,
one `processPower()` per tick consuming 1 power + 50 energy (`POWER_SPAWN_ENERGY_RATIO`). So "burn a
batch" means keep it fed continuously while the batch is open, which is what the hysteresis now does;
the CPU cost is a single API call per tick.

### Tests

`test/power-spawn-burn.test.cjs` now stubs room-level power/energy and adds a case proving the gate
opens from room stock even when the spawn itself is empty. The fill-gate source assertion follows the
new `wantBurn` expression.

## v0.78.131 — The claim cleaner is gone entirely

User: if we are going to claim the room anyway, drop the cleaner - delete that logic.

Since `structure.destroy()` deletes other players' structures inside our own room in a single call
(v0.78.130), the whole cleaner path was dead weight: a spawn, a body, a cross-room walk, and up to 600
ticks of a claim-clock life. Removed:

- `Creep.prototype.clearClaimRoom` (the dismantle loop, its cached `claimCleanupTarget`, and the
  "become a worker when finished" hand-off)
- `StrategyClaim.spawnCleaner` and its remaining call site in the pre-claim branch
- `isPlannedClaimStructure`, which nothing reads any more (`isClaimCleanupTarget` only looks at
  ownership now)

What remains is a single rule: `destroyForeignStructures(room)` walks an owned room and calls
`destroy()` on other players' structures, honouring the storage/terminal keep rules.

### Tests

`claim-flow`, `core-profile` and `claim-cleanup` were updated: the cleaner-body, cached-target and
`clearClaimRoom` assertions are replaced by assertions that the machinery is **gone**
(`!strategyClaim.includes("claimCleaner")`, no `claimCleanupTarget`, zero `spawnCleaner` matches) and
that `destroyForeignStructures` iterates the room calling `struct.destroy()`.

## v0.78.130 — Destroy foreign structures directly instead of sending a cleaner

User: `structure.destroy()` can delete other players' buildings inside your own room - use that
instead of a cleaner.

Verified live: calling `destroy()` on Rutt's extension at (26,34) in W26N58 returned **OK (0)** and the
structure vanished the same tick. So the whole cleaner path was unnecessary for owned rooms: it cost a
spawn, a body, a walk across the room and up to 600 ticks of life for something one API call does.

`StrategyClaim.destroyForeignStructures(room)` walks the room and calls `destroy()` on everything
`isClaimCleanupTarget` accepts (i.e. other players' structures, with the storage/terminal keep rules),
and `exec()` calls it in the "room is ours" branch. The operation log now records how many structures
were destroyed that tick.

The cleaner is only spawned while the room is **not yet ours** (destroy is not permitted there); that
single remaining call site is asserted by the tests.

### Tests

`test/claim-cleanup.test.cjs` gains a behavioural case: a room with a foreign tower/extension/spawn,
a foreign storage at RCL3, a neutral container, a neutral wall and our own extension - exactly the
three foreign ones are destroyed. Source assertions require `destroyForeignStructures(targetRoom)` in
the owned branch and exactly one remaining `spawnCleaner` call site. Negative control (destroy not
actually called) fails.

## v0.78.129 — Claim cleanup touches only other players' structures, never neutral ones

User: do not dismantle neutral buildings such as walls - and pointed at why it matters: claim creeps
only live 600 ticks, so a cleaner chewing on a neutral wall wastes its entire life.

`isClaimCleanupTarget` now returns true **only for structures with a foreign owner**. Ownerless walls,
roads and containers are never targets; the planner routes around them and they can be removed by
hand if a specific tile is needed. (The old rule also removed "ownerless structures the blueprint does
not use", which is exactly how the cleaner ended up dismantling `constructedWall@19,2`.)

The cached `claimCleanupTarget` is also re-validated every tick, so a target that stops matching the
predicate (rule change, ownership change) is dropped instead of being chewed forever.

Storage rule unchanged: a foreign storage is kept while it holds goods or while our controller is
below RCL4, and destroyed once we can build our own.

### Note on the earlier 574 ttl

Not a bug: creeps with CLAIM parts have **600 ticks** of life (`CREEP_CLAIM_LIFE_TIME`), which is why
the claimer looked "pre-aged". Long-distance claims must be planned around 600 ticks, not 1500.

### Tests

`test/claim-cleanup.test.cjs` and `test/claim-flow.test.cjs` now assert that ownerless containers,
roads and walls are **not** targets, alongside the previous foreign-structure and storage cases.

## v0.78.128 — Claim cleanup actually runs (and keeps the foreign storage for now)

User: the claimed room still had another player's spawn/extensions - those were dismantled by hand.
Check whether the automation runs at all.

It did not, for two independent reasons:

**1. The pipeline declared COMPLETE as soon as our own spawn existed.** `exec()` removed the
`claim_*` flag on `room.my && mySpawns.length`, before the cleanup branch ever ran, so a room with
leftover hostile structures lost its cleanup permanently (W26N58 still holds `tower` 3000 hits, two
extensions 1000 each and a storage - the flag was already gone).

COMPLETE now also requires `cleanupTargets === 0`.

**2. The cleaner could never be spawned in a young room.** The body was hard-coded to 5 WORK + 5
CARRY + 5 MOVE = **1000 energy**, but a freshly claimed RCL3 room only has 650 capacity, so
`trySpawn` always failed. The body now scales to the spawning room's capacity (one W+C+M set per 200
energy, capped at 5), and when the target room already has its own spawn the cleaner is spawned
**there** instead of walking 8 rooms from W31N55.

**3. Storage rule (as instructed).** `isClaimCleanupTarget` now keeps a foreign `storage` while it
holds goods **or** while our controller is below RCL4 (we cannot build our own yet); a foreign
terminal is kept while it holds goods. Everything else of another owner - spawn, extension, tower -
is still dismantled, because it occupies tiles and blocks `createConstructionSite`.

### Tests

New `test/claim-cleanup.test.cjs`: spawn/extension/tower are targets, storage is kept at RCL3 and
when non-empty but dismantled when empty at RCL4, terminal kept while stocked, our own structures and
the controller never targeted, ownerless structures only when the blueprint does not use them, plus
source assertions that COMPLETE waits for cleanup, that the cleaner spawns locally and that the body
scales. Negative controls: dropping the storage guard, forcing `canBuildOwn = false`, and dropping
`!cleanupTargets` each fail. `core-profile` was updated for the new capacity-scaled body.

## v0.78.127 — Batch power processing (accumulate, then burn down, then accumulate)

User: some rooms have a power spawn worth running, but it burns power and must not run on a thin
energy budget - accumulate first, burn most of a batch in one go, then accumulate again; try it in
W32N56 and move surrounding energy/power there.

Nothing called `processPower()` anywhere in the code, which is why 1.29M power sat in the terminals
and the twelve power spawns held 1-100 each. The real constraint is energy: **1 power costs 50
energy**, so the whole stock would need 64M energy - far more than we hold. Hence a batch cycle, not
a trickle.

`StationCarry.tryProcessPower(room)` (called from `generatorFillPowerSpawnTask`, which every room
reaches each round):

    open  when  power >= powerSpawnHigh(500)  AND  room energy >= powerSpawnEnergy(60k)
    burn  while power >  powerSpawnLow(100)   AND  room energy >= floor/2
    then  close and re-accumulate

Hysteresis is kept in `Memory.marketSettings.powerBurning`, so it cannot flicker on and off at the
low mark. Knobs: `powerSpawnRoom` (default W32N56, set "" to disable), `powerSpawnHigh`,
`powerSpawnLow`, `powerSpawnEnergy` - all live, no redeploy.

The fill gate in `generatorFillPowerSpawnTask` also recognises the burning state and relaxes from
"170k energy / 1000 power" to "30k energy / 50 power", otherwise the spawn empties after a few
processPower calls and the burn stalls.

Measured today: W32N56 holds 5,945 power and ~144k energy, so the first batch (500) needs 25k energy
and runs 500 ticks; the 12 OPF rooms together hold ~1.29M power, i.e. power will never be the limit -
energy throughput is.

On the CPU question: `power:OPF` (1.96) is the operator-factory production logic, not the power
spawn. `processPower` is a single API call per tick (~0.001 CPU), so enabling it does not save CPU;
the factory chain is already gated on `bucket >= 8000`, which is what actually protects the bucket.

### Tests

`test/power-spawn-burn.test.cjs` (real module in a VM): non-target room does nothing, below the high
mark does nothing, enough power but thin energy does nothing, a full batch burns and records the
state, the low mark stops it, energy under half the floor stops it, no flicker at 400 power, and the
knobs work. Negative controls: dropping the hysteresis, dropping the energy floor, and ignoring the
low mark each fail.

## v0.78.126 — Only compress bars with a 40% margin, scanned every 500 ticks

User: ignore anything below 40%; scan profitability periodically.

`StrategyMarket.scanCompressMargin()` (called from `autoBuy`, which runs every 100 ticks, internally
rate-limited to 500) prices each bar pair on the **cheapest sell orders**:

    cost   = 5 * rawAsk + 2 * energyAsk        // one bar is 5 raw + 2 energy
    margin = (barAsk - cost) / barAsk * 100

and writes `Memory.marketSettings.compressBars` (per-bar margin), `compressBarsDetail`
(ask/cost for inspection) and `compressMinMargin` (the 40 threshold - a single source of truth, the
factory does not carry its own copy).

`station_factory.noLevel()` now refuses to compress when the margin is below that threshold **or
when the market has not been scanned yet** - unknown means don't burn energy on a guessed price.

At the prices seen today this leaves only three bars above 40%: utrium_bar (57%), oxidant (46%),
keanium_bar (44%). zynthium_bar lands at 35%, purifier 14%, lemergium_bar 9%, reductant 9%, so those
four stay raw and are bought if genuinely needed.

### Tests

`test/factory-compress.test.cjs` gains the margin cases (39.9% -> no compression, exactly 40% ->
allowed, no scan -> no compression) and a source-level check that the scanner writes both Memory
keys, prices with 5 raw + 2 energy, and is rate limited to 500 ticks. Negative controls: dropping
the factory gate and lowering the threshold to 30 each fail.

## v0.78.125 — Keep more raw minerals, count the energy, and stop decompressing

User: keep more raw mineral, avoid decompression (it burns energy and energy is not cheap), and
recompute the compression cost with energy included.

**Compression cost, energy included.** One bar is 5 raw + **2 energy** (500 raw + 200 energy -> 100
bars), not the one energy the market guard used. At the cheapest energy sell order (20.83, so 41.7
per bar):

| bar | 5 raw | + 2 energy | total | market ask | saved |
|---|---|---|---|---|---|
| utrium_bar | 78.6 | 41.7 | 120.3 | 278.4 | 158 (57%) |
| keanium_bar | 74.8 | 41.7 | 116.4 | 209.4 | 93 (44%) |
| zynthium_bar | 73.8 | 41.7 | 115.5 | 176.6 | 61 (35%) |
| oxidant | 105.5 | 41.7 | 147.2 | 272.5 | 125 (46%) |
| lemergium_bar | 740.0 | 41.7 | 781.7 | 858.1 | 76 (9%) |
| reductant | 720.0 | 41.7 | 761.7 | 835.2 | 73 (9%) |
| purifier | 1292.7 | 41.7 | 1334.4 | 1544.1 | 210 (14%) |

Still positive everywhere, but lemergium / reductant / purifier are thin (9-14%). At the expensive
energy price (34.79) those three drop to 5-12% while utrium/keanium/zynthium/oxidant stay at 19-47%.

**Changes**

- `BASE_COMPRESSION_RESERVE` 1000 -> **2000**: 3,000 raw per room now yields only 200 bars, and the
  bulk stays raw for the labs.
- The market guard (`barPrice = maxPrice * 5 + ...`) now counts **2 energy** per bar instead of one,
  so "make it yourself" is no longer under-priced and we do not buy bars we could make cheaply.
- Decompression is effectively off: the gate moved from `bar > 9000 && energy > 120k` to
  `bar > 30000 && raw < reserve && energy > 300k`. Missing material for a higher-tier recipe is
  still handled by `checkNoLevelRes` recursively compressing, which is the cheap direction.

### Tests

`test/factory-compress.test.cjs`: 3,000 raw makes 200 bars, raw at the 2,000 reserve makes nothing,
9,000 raw caps at 600, 1,500 bars stops it, the 100k room-energy guard holds, oxidant maps the same
way, 20,000 bars + 400k energy no longer decompresses (the old gate would), 35,000 bars + 400k energy
still does, and `strategy_market` must price a bar at 5 raw + 2 energy. Negative controls (reserve
1000, old decompress gate, one energy unit) each fail on their own assertion.

## v0.78.124 — Mineral compression could never trigger; it now keeps a lab reserve

Survey on request: the market has plenty of buy orders for the element bars (utrium_bar 290.5,
keanium_bar 227.7, zynthium_bar 187.8, oxidant 259.5, reductant 701, purifier 1518) while all
thirteen factories sat at **cooldown 0** and the terminals held **39,000 of every raw mineral**.

`station_factory.noLevel()` already had a compression branch, but it required

    roomMassStoreCnt(room, rawMineral) >= 6000

and our minerals are deliberately spread **evenly at 3,000 per room**. So the branch never ran once.
The rule is now "compress whatever is above a reserve":

    reserve = 1,000 per room per mineral        (BASE_COMPRESSION_RESERVE)
    makeable = floor((raw - reserve) / (components/amount))     // per bar, not per batch
    bars     = min(600, floor(makeable / amount) * amount)

With the real numbers (3,000 raw, 1,000 kept) each room makes **400 bars from 2,000 raw + 800
energy**. The reserve exists because labs need the raw minerals for boost compounds and the reverse
branch only decompresses above 9,000 bars - converting everything would have locked the labs out.

Worth doing (market prices vs 5 raw per bar): utrium_bar 290.5 vs 78.6, keanium_bar 227.7 vs 74.8,
zynthium_bar 187.8 vs 73.8, oxidant 259.5 vs 105.5, reductant 701 vs 720 (flat), purifier 1518 vs
1292.7. Compressing instead of buying saves 79-445 per bar; selling the bars instead of the raw
minerals is 1.2x-3x the credits.

Note the factory is still gated on `bucket >= 8000` and on room energy >= 100,000, so nothing runs
until the bucket recovers - which is exactly why the outer mine was paused in the same pass.

### Tests

New `test/factory-compress.test.cjs` loads the real module in a VM: 3,000 raw makes 400 bars, raw at
the reserve makes nothing, 9,000 raw caps at 600, 1,500 existing bars stops it, the 100k room energy
guard still holds, and oxidant maps through the same path. Three negative controls (reserve 0, the
old >=6000 gate, dropping the "enough bars" stop) each fail on their own assertion.

## v0.78.123 — A defender's post must not depend on lair countdowns

Follow-up to v0.78.122, caught by watching the live output rather than by reading the code.

The first cut ordered a group's lairs by "keeper alive first, then smallest spawn countdown" and handed
out slots by that order. The countdowns advance at different rates, so the order flips over time -
within 60 ticks of deploying, 0485 and 1115 **swapped posts** and started walking 30+ tiles past each
other. Two creeps crossing the room is exactly the oscillation the previous release set out to remove.

The ordering is now **by lair id**, which never changes, and the slot is fixed by the creep's position
among its sorted group-mates. Coverage is deterministic and cannot drift:

- group has at least as many creeps as lairs -> `stable[slot % stable.length]`, one lair each;
- fewer creeps than lairs -> hold the lair with a live keeper, else rotate by dwell (the dwell timer
  only advances after arrival, see v0.78.122).

The "keeper alive" preference therefore only applies where it is needed: when a group is too thin to
cover its lairs at once. With one creep per lair the keeper's lair is already covered by its own
creep, and that creep is 3 tiles from the keeper - well inside attack range.

### Tests

Case ① now asserts the two creeps get **different** lairs and that repeating the call returns the
same lair, and case ⑥ asserts the assignment does not change when the two countdowns are reversed.
Three negative controls: no keeper priority, advancing the rotation before arrival, and sorting by
`ticksToSpawn` - each fails on its own assertion.

## v0.78.122 — A defender now covers its own lair, and the lair with a live keeper comes first

Two defects, both visible in W34N55 and both in the "no enemies nearby, hold a lair" branch.

**1. Both creeps of a group picked the same lair.** The rule was "if any lair has a spawn countdown,
hold the one that spawns soonest". Two consequences:

- with two defenders in a group, both took that lair and the group's **other lair was never visited**;
- a lair with a **live keeper** has `ticksToSpawn === undefined` (a lair does not schedule the next
  keeper while its own is alive), so it **always sorted last** - the one lair that needed attention
  was the one nobody went to.

Measured: a full-health keeper (5000/5000) sat at (4,16), three tiles from lair 7,17, for a whole
day. Group 0's two defenders held 41,14 - about 30 tiles away - and never moved. Group 1's two
oscillated around (22,32)/(23,31).

`Strategy`/`StationSources.outerDefensePatrolTarget(creep, posts)` now decides this and is unit
testable:

- ordering: **a lair with a live Source Keeper first**, then by spawn countdown (smallest first);
- if the group has at least as many creeps as lairs, each creep takes its own slot by its position
  in the **sorted member names** - one creep per lair, deterministic, no swapping;
- otherwise hold the lair with a live keeper (leaving it alone lets the keeper eat our miners),
  and if none, rotate by dwell as before.

**2. The rotation advanced before arrival.** The old code bumped the index whenever the creep was
not yet in range 1 of the current post, so the target flipped between the two lairs **every tick**:
the creeps swapped tiles indefinitely (fatigue 32 every sample, net displacement zero over 200+
ticks). The index now only advances after the creep has arrived **and** dwelled out.

### Tests

`test/outer-defense.test.cjs` gains five cases against the real module in a VM: two creeps of one
group get **different** lairs and the name-first one gets the keeper's lair; a lone creep prefers
the keeper's lair even though the other has a smaller countdown; without keepers the spawn countdown
still wins; arrival/dwell/switch; and a travelling creep's target is **stable across ticks**.
Three negative controls (drop keeper priority, advance before arrival, drop slot splitting) each
fail on their own assertion.

## v0.78.121 — Defence rebalancing was gated behind "never assigned", so one group went unmanned

Why nobody attacked the last Source Keeper in W34N55: all four defenders carried the **same**
`defenseLairIds` (one 49-character group key = one group's two lair ids), so the group lookup
`keys.indexOf(creep.memory.defenseLairIds)` resolved everyone to the same group. The only thing that
could have spread them out was the load-balancing line, and it was guarded by

    if (creep.memory.defenseLairIds === undefined && cnt[g] > least) ...

i.e. it only ran for creeps that had never been assigned. Since the spawn-time assignment writes
`defenseLairIds` for every defender, that condition was **never** true - the imbalance could never be
corrected. Result: the east/middle group had everyone, the west group (lairs 7,17 and 7,38) had
nobody, and a full-health keeper sat at (4,16) untouched.

The rebalance is now unconditional. Stability does not come from the removed guard but from the
"exclude yourself" count: once one creep moves, both counts are equal and nothing flips back
(the 10-04 oscillation was two creeps pushing each other, not balancing itself).

### Tests

`test/outer-defense.test.cjs` asserts the unconditional rebalance line is present and that the
old "never assigned" guard is gone.

## v0.78.120 — Outer defence quota is one defender per two lairs

User: the outer mine sent three defenders; the lairs are four, and the requirement is two - one
creep handles two lairs.

The old formula counted **Source Keeper creeps** one-to-one: `max(base, min(4, keepers))`. A source
keeper room has **4 lairs but 3 sources**, so at mission start there were 3 keepers and the quota
came out as 3. Now it is `max(base, min(4, ceil(lairs / 2)))` - 4 lairs gives 2, which is the
original "one defender watches two lairs" design. The keeper-based fallback stays for the case where
the room is not visible (no lair list).

Consequence to be aware of: the existing third defender has no over-quota retirement (only keepers
have that), so it will finish its life unless removed manually.

### Tests

`test/outer-defense.test.cjs` asserts the quota uses `ceil(lairs / 2)` over keeper lairs; negative
control drops that branch and fails.

## v0.78.119 — Deposit boost switched off (kept behind a Memory switch)

User: turn the deposit boost off.

Instead of deleting the machinery, it now sits behind a switch that defaults to **off**:

    Memory.marketSettings.depositBoost === true   // required for any boost

`needBoost = boostEnabled && remainLife > ...` - a missing or non-true value means no boost, so the
feature is off out of the box and can be re-enabled by setting that one value (no redeploy).

### Tests

`test/deposit-threshold.test.cjs` asserts the switch exists and that `needBoost` starts with
`boostEnabled &&` (i.e. default off). The assertions run against the comment-stripped source, since
the explanatory comment itself mentions the switch name. Negative control (dropping the switch)
fails on "needBoost 必须先过开关".

## v0.78.118 — Deposit boost was structurally unreachable; judge it by remaining life

User: "the boost still does not open."

It never could. The boost is decided in the harvester-spawn branch only:

    if (harTtlCreepCnt < walkableAroundCnt && ...) {
        let needBoost = lastCooldown > boostCoolDown() && !alreadyBoosted;
        trySpawnHarDeposits(room, memory, needBoost);   // boost = a lab task at spawn time
        return;
    }

But the team is filled at the **start** of the mission, when `lastCooldown` is about 0, and by the
time it passes the threshold `harTtlCreepCnt` already equals `walkableAroundCnt`, so no further
spawn happens - and the harvesters live 1500 ticks, longer than a deposit mission, so no death
replaces them either. The branch is therefore never entered. (The 10-10 fix addressed a different
layer: the threshold was 90, above the reachable range.)

Now the judgement is the deposit's **remaining life**:

    remainLife = flag.memory.disappearTime - Game.time
    needBoost  = remainLife > pathTime * 2 + 600 && !alreadyBoosted

which is known at spawn time, so the first team is spawned already boosted and never has to walk
home to a lab. `boostCoolDown()` is kept as a knob (`Memory.marketSettings.depositBoostCooldown`)
but no longer decides the boost.

### Tests

`test/deposit-threshold.test.cjs`: the old "must call boostCoolDown()" contract is replaced by
"must judge by remainLife" plus "must not use the old `lastCooldown > boostCoolDown()`"; negative
control reverts the judgement and fails on the new assertion.

## v0.78.117 — shard3 deposit harvest cap 40 -> 70

User: "shard3 to 70."

`MAX_COOL_DOWM_DEFAULT` for shard3 is now 70 (other shards untouched: 120 / 120 / 120, unknown 50).
Recall `lastCooldown` is the **amount already harvested** (0 = fresh, monotonically growing), not a
time cooldown - so 40 meant stopping at roughly two thirds, 70 goes substantially deeper.

Set in two places so they cannot drift:

- live: `Memory.marketSettings.depositMaxCooldown = 70` (takes effect immediately, no reload)
- code default: so a Memory reset does not silently fall back to 40

The boost point follows automatically (`maxCoolDown()/2`), now **35** rather than 20.

### Tests

`test/deposit-threshold.test.cjs` updated: shard3 default 70, the live-read case 70, the invalid-knob
fallback 70, and the derived boost point 35.

## v0.78.116 — An Invader Core that is about to mature pauses the outer mine

User: after turning W34N55 back on, add a rule - if an Invader Core exists **and is close to
maturing**, stop the outer mining; reopen it after it has been gone for long enough.

Detection follows the pattern `StationObserver.observeLastRoom` already uses for `lastHostileSeen`:
observation only grants **one tick** of vision while the outer-harvest strategy decides every six
ticks, so the two beats essentially never line up - the observer therefore records the core itself
the moment it has the room in view:

    Memory.rooms[room].invaderCore = { lastSeen: Game.time, deployAt: Game.time + core.ticksToDeploy }

`StrategyOuterHarvest.invaderCoreBlocks(roomName)` reads only that memory (never the current
visibility - the creeps leave once we stop dispatching) and answers:

- core **exists and is about to mature** (`deployAt - now <= INVADER_CORE_MATURE_WARN`, 5000 ticks,
  enough for an in-service keeper to retire naturally) -> pause the mine
- core **absent for long enough** (`now - lastSeen > INVADER_CORE_GONE_CLEAR`, 3000 ticks, generous
  against the observer's ~100-tick round) -> resume

It sits next to the existing `stopRemote` guard in the dispatch loop.

### Tests

`test/invader-core-gate.test.cjs` (real module in a VM): no memory, near-maturity (stop), far from
maturity (keep mining), gone-for-long (resume), just inside the gone threshold, both maturity
boundaries, plus call-site assertions for the gate and for the observer's write. Two negative
controls (dropping the recovery branch, ignoring maturity) each fail on their own assertion.

## v0.78.115 — An upgrader that exists always works; the spawn gate decides the count

User: "shard3_83743327_1 is an upgrader sitting there not working. If it is alive it must work. Low
energy / close to downgrade means don't SPAWN upgraders - not pause the work. Don't waste."

That creep was in W33N53 with `ticksToDowngrade` right at 120k, a stock of 150k, its `upgradeKeeper`
task queued and 70 energy in its store. `main.js`'s `shouldRunCreep` was freezing it:

    if (room.controller.ticksToDowngrade > 120000) return false;   // plus stock <30k stop, <60k half speed
    // plus a bucket-based interval

But `station_upgrade.js:398~429` already owns the spawn decision completely: below RCL8 it spawns on
no-upgrader / progress / stock conditions, and at RCL8 it only tops up when
`ticksToDowngrade < 80000`. So the main-loop throttle was **duplicate and pure waste** - the energy
already spent on spawning the creep and its 1500 ticks of life were parked for nothing.

`shouldRunCreep` now returns true: upgraders run like every other role, and whether an upgrader
should exist is decided solely by the spawn gate. The bucket<=40 MIN_CPU emergency path still goes
through `ROLE_PRIORITY` - that is CPU survival, unrelated to this.

### Tests

`test/core-profile.test.cjs` no longer asserts the old throttle; it now asserts the opposite (no
`ticksToDowngrade > 120000` pause, no `stock < 30000` pause), that the spawn gate still holds the
`ticksToDowngrade < 80000` RCL8 top-up, and that a room with no upgrader still spawns one.

## v0.78.113 — Only deal cheap component asks; no 20k resting metal order

### Changed

- `autoBuyHighProfitComponents` no longer places resting buy orders. It only deals against asks
  whose price is at most `history × (1 + highProfitBuyPremium)` (default **0.02**); otherwise it
  logs `noCheap` and waits. Single-order size is capped by `highProfitOrderMax` (default **10000**).
- This removes the source of the 21,000-unit metal bid at 239.6: that order was below the asks
  (254–255), never filled (remaining 21,000), and was already canceled by v0.78.112 when machine
  real margin was 829% < 1000%. The actual metal buys that cost 40.95M/14h came from `buySome`
  paying the 254–255 asks under the old 1.2× tolerance; that tolerance is now 1.02×.

### Notes

- `Memory.diagBuy.noCheap` records `[component, cheapestAsk, maxBuyPrice]` when the market is too
  expensive. No changes to `autoBuyMineral` (lab/O/U/Z needs) or to the L5 daily-high sell logic.

## v0.78.112 — Cancel low-profit component buy orders

### Fixed

- When a high-profit candidate fails the real-margin gate, its component buy orders were left in
  place and could still fill (the machine chain was real 795% < 1000%, but the metal buy order
  remained). `autoBuyHighProfitComponents` now cancels our buy orders for those components in the
  OPF factory rooms, except components still needed by a passing high-profit product
  (`keepComponents`). Cancellations are logged in `Memory.diagBuy.canceled`.
- Example: `metal` is canceled for machine (795%), while `zynthium_bar` / `energy` stay because
  organism (real 1119%) still needs them.

## v0.78.111 — L5 sells against the recent daily high; buys must clear a real-profit gate

### Changed

- **L5 sell reference** (`strategy_market.js`): L5 now uses `StrategyMarketPrice.getRecentDailyHigh()`
  instead of `historyAvg * (1 + dealPremium)`. The helper uses the latest day's
  `avgPrice + stddevPrice` (the API has no true daily high) and a configurable tolerance
  `Memory.marketSettings.dailyHighTolerance` (default `0.96`, i.e. within 4% of the daily high).
  L0–L4 keep the old `historyAvg * (1 + dealPremium)` gate.
- **Real-profit buying** (`autoBuyHighProfitComponents`): before buying machine/organism components,
  compute `realMargin` from the **current sell-order prices** of the expanded components and the
  **current best buy order** of the product. Only buy when `realMargin >= highProfitMargin`
  (default 1000%); skip on `low-margin`, `no-buy-order`, or `no-cost`. Historical margin is only
  used for ranking.
- **Logs**: `Memory.diagBuy` now records historical vs real margin, actions, and skip reasons;
  `Memory.diagSell` records the L5 daily high / tolerance / max price; `Memory.marketSales` keeps
  the last 50 successful deals. `tools/monitor.py` prints these and the CPU phase/telemetry from
  the current `cpuModuleTelemetry` / `cpuTelemetry` keys.

### Notes

- Deliberately unchanged: `highProfitMargin` value, `MAX_COMMODITY_KEEP`, the outer-road
  PathFinder fallback, and commodity sell-order creation.
- Tests: 18/18 passed (new `test/market-l5.test.cjs`).

## v0.78.110 — L5 commodities can trade, 5 small bugs, factory parking yields to OP

### Fixed

- `strategy_market.js`: the minimum commodity deal was a flat 100 units. Every L5 buy order is
  only 1–18 units (organism 10, machine 3/5/10, device 10, essence 2/5/5), so **all L5 deals were
  skipped** — E55S31 terminal held 1002 organism, 137 machine, 283 device and 18 essence with
  zero `market.sell` in the money history. L5 now uses a 1-unit floor; L0–L4 keep 100.
- `strategy_factoryPowerCreep.js`: when a factory is in `produce + !powered`, a PC parked on
  `goToNearPop` starves `needPower`. The parking task is popped and `OpFactory` is queued
  immediately (E53S21 hydraulics had been stuck for 16k ticks).
- `strategy_GCLRoom.js:454`: `!room.level>=6` → `room.level < 6`.
- `strategy_highLevel.js`: `onlyEnergy` was an implicit global → `let`.
- `strategy_minSizeRoom.js`: the terminal rampart check used the spawn's `rampart` variable.
- `station_upgrade.js`: `moveTo(obj, opts, {range:3})` passed `{range:3}` as a third argument,
  which the engine ignores.
- `station_carry.js`: `if (resCount < 0) break` could never fire → `<= 0`.

### Notes

- Deliberately did **not** touch `highProfitMargin`, `MAX_COMMODITY_KEEP[5]`, the outer-road
  PathFinder fallback, or other behavior-sensitive optimizations.
- Tests: 17/17 passed.

## v0.78.109 — Keeper succession margin 6 -> 16

User: "all energy keeper handovers get another 10 ticks, nothing else changes."

`KEEPER_SUCCESSION_MARGIN` 6 -> 16, so the dispatch fires `pathTime + body*3 + 16` ticks before the
incumbent dies and the successor arrives with 16 ticks of slack instead of 6. One constant, no other
behaviour touched. The test reads the margin out of the source, so its formula assertions follow
automatically, and the policy assertion (`> 0 && <= 30`) still holds.

## v0.78.108 — The chatter was not running at all: my edit had deleted its entry point

User: "singing was never deployed? one line per tick."

They were right, and the cause was mine. When v0.78.106 rewrote the playback into a per-creep song
cursor, the scripted edit computed its cut point one line short and **removed the entire
`global.TalkAll = function () { ... }` block**, leaving only `randomSay`. Consequences:

- the file was still **syntactically valid**, so `node --check` and the build passed;
- `main.js` calls `global.TalkAll && ... `, so the guard was simply false **every tick** and the
  chatter silently never ran - no exception, nothing in `errorCount`, no log line.

My verification missed it because I checked `randomSay` and `global.TalkCustom` (200 songs loaded)
but not that the **export** still existed. A coverage hole, not bad luck.

### Fixed

- `global.TalkAll` restored, with the chance handling and the periodic `creepMap` cleanup.
- Cadence is now **one page per tick** (was every other tick) per the same request.
- Two diagnostic counters on `global` (readable from the console, deliberately not named `_` so
  lodash is untouched): `__chatAll` (how many times TalkAll ran) and `__chatSays` (how many lines
  actually went out). These separate "the driver is not running" from "the driver runs but says
  nothing" - the distinction that cost time here.

### Tests

`test/chat-recite.test.cjs` gains case ⑦: `TalkAll` must be a function, calling it must make a
creep speak, and both counters must advance. Its negative control **reproduces the accident**
(delete the block) and fails on "global.TalkAll 必须存在（main.js 靠它驱动）".

Live after deploy: `__chatAll` = 14 after 14 ticks, `__chatSays` = 1064 with 75 creeps - about 76
lines a tick, i.e. every creep speaking every tick. `errorCount` 0.

## v0.78.107 — Containers that are not mineral containers hold energy only

User report: some containers hold more than one kind of thing - clean them up and move the excess to
the storage; the ones next to sources should hold energy only.

Survey (13 rooms) found **10 mixed containers**. Three sources of contamination:

- **boost compound residue** - GO/KO/ZH/UH/OH in the source containers of E41S32, E55S31, E55S39,
  W33N55 (and OH in E41S32)
- **biomass** - 593 and 528 left in E41S32 / E48S41, residue from the deposit harvesting
- **power** - 100 sitting in an E49S31 container from a power bank run

The other five mixed containers are the **mineral containers** (H/O), which are supposed to hold
their mineral while waiting for the hauler - so they are exempt.

`StrategyHighLevel.cleanDirtyContainers(room, freeCarries)` is called from the carrier dispatch
right after `freeCarries` is refreshed. For each container it takes one free carrier, queues a
`carryRes` for **each non-energy resource** (never energy) and then `fillAllMainRoomStorage()`, and
returns immediately - one container per tick per room, so this tidy-up work cannot drain hauling
capacity. A container with nothing dirty returns the carrier to the pool. Full storage, or no free
carrier, means no action.

### Tests

New `test/container-cleanup.test.cjs` (loads the real module in a VM): only non-energy resources
get a `carryRes`, the target is that container, the follow-up is `fillAllMainRoomStorage`; the
mineral container is exempt; a clean container queues nothing and the carrier comes back; no free
carrier and a full storage are both no-ops; plus a call-site assertion. Two negative controls -
dropping the mineral exemption, and dropping the non-energy filter - each fail on their assertion.

## v0.78.106 — A creep recites one song in order, and only then changes song

User: no random line-hopping - a creep should sing one song straight through and pick the next one
only after it is completely finished.

The old logic picked a random array entry every time a creep started a line, so a creep jumped
between songs line by line. Two things had to change:

- **The corpus lost its song boundaries.** `scripts/build-chat-corpus.cjs` flattened everything into
  one array, so "which song am I in and is it finished" was not representable. It now emits **one
  sub-array per song**, in lyric order (still time-axis/metadata/credit-free, now deduplicated
  within a song rather than globally, since two songs may share a line). 200 songs, 6933 lines.
- **The playback is now a per-creep cursor** `{s, i, p}` (song, line, page): advance the page, when
  the line is done move to the next line, and only when the last line of a song is done switch
  songs, then wrap around. `SONGS()` accepts either the nested corpus or a flat array (treated as
  a single song).

Starting song is a hash of the creep's name - reproducible, not random, and different names spread
across songs so the field is not all on one track. `Memory.chatChance` now means *which* creeps
sing; once a creep starts, the probability no longer gates it and it recites to the end.

### Tests

New `test/chat-recite.test.cjs` (loads the real module in a VM, feeds a two-song corpus with a
17-character line): drives `randomSay` tick by tick and asserts the **complete expected page
sequence** - line order, 10-character paging, song switch only after the last line, wraparound -
plus reproducible starting song, spread across creeps, `chance=0` behaviour, and the flat-array
corpus. Negative control (switch song after every line) fails on "逐句完全符合：行内 10 字分页、
整首唱完才换歌".

## v0.78.105 — Import the locally provided lyric pack as the chatter corpus

The user supplied an offline pack at `/Users/an/Documents/hot200-lyrics` (their own fetch, 219 LRC
files covering the NetEase hot-200 plus 19 translations) and asked for it to be imported and
cleaned. That is the path offered in v0.78.104 - material supplied by the user, wiring and cleaning
on this side - so it is a mechanical transform of their own data, not sourcing.

`scripts/build-chat-corpus.cjs` reads the pack and writes `modules/闲聊语料自定义.js`
(`global.TalkCustom = [...]`), which `闲聊 v1.0`'s `TALK()` picks up automatically.

Cleaning, as requested:

- strip the `[mm:ss.xxx]` time axis - **including the repeated-timestamp form**
  (`[00:12.3][00:15.6]lyric`, used for reused choruses), which the first pass missed and which left
  11 entries with a stray stamp in the live check
- drop `[ti:]/[ar:]/[al:]/[by:]/[rank:]/[offset:]` metadata
- drop credit lines (`作词 : …`, `作曲 : …`, `编曲 : …`, `制作人 : …`, more)
- drop instrumental markers and lines shorter than 3 characters, cap at 120 with a break at a
  punctuation mark, and de-duplicate globally (choruses repeat a lot)

Result: 200 songs -> **6820 unique lines**, 246 KB, `uploadedModules` 72. Live: 6820 entries, zero
entries still carrying a timestamp or a credit prefix, `errorCount` 0.

## v0.78.104 — Every creep sings, and the corpus is pluggable

Follow-up to v0.78.103, per "as much as possible every creep should sing, and split anything longer
than ten characters into several phrases".

- `TalkAll` used to call `randomSay(0.15)`, so a creep spoke roughly once every seven ticks and most
  creeps were silent at any moment. It now defaults to **1** - every creep gets its turn each
  invocation, keeps reciting the line it is in the middle of, and starts a new one when it finishes.
  Rate is tunable at runtime with `Memory.chatChance` (0..1).
- Paging is now explicit: `substr(p*10, 10)` for both the first phrase and the continuations. It used
  to be `substr(p*10)`, which returned the whole remainder and relied on the engine truncating the
  bubble to ten characters.
- The corpus is pluggable: if `global.TalkCustom` is a non-empty array it wins over the built-in
  `global.Talk`, resolved on every call so it can be swapped at runtime. That is the hook for
  supplying your own corpus without touching this module.

### Not done, deliberately

A corpus of popular song lyrics was requested, including fetching it from public lyrics APIs. Lyrics
are protected works - under 《著作权法》第二十三条 the term is the author's life plus fifty years,
which covers essentially all current pop songs - and bundling a hundred of them into the repository
is reproduction, not personal use. What I can do instead: any corpus the user supplies goes in
through `global.TalkCustom`, or a public-domain corpus (Tang/Song poems and older) can be installed.

## v0.78.103 — Turn the chatter back on (creep say-bubbles)

The bot had a `闲聊 v1.0` module that was never in the build: it existed only in the read-only
`.screeps-code.json` snapshot from 2026-07-31 and in a stale `MODULES.tsv`, while `modules/` and
`deploy/core-modules.json` did not carry it (noted in CODE_REVIEW.md at the time). Restored:

- `modules/闲聊 v1.0.js` - the module verbatim from the snapshot. `global.Talk` is 8124 lines of
  group-chat log (compiled by 6g3y, up to 2020-10), `Creep.prototype.randomSay` makes a creep say
  a line **ten characters at a time** (the `say` limit), and `global.TalkAll()` drives it.
- `require('闲聊 v1.0')` in main_mount, `"闲聊 v1.0"` added to the deploy list (71 modules now),
  and `TalkAll()` called from `main.js`'s optional phase.

Cost control: `MIN_CPU` and `bucket < 5000` skip it, and it runs every other tick - which halves
the page advance rate, so a bubble update is a little slower. The switch is
`Memory.cpuFeatures.chat` (the `chat` key is not in `CPU_OPT_IN_FEATURES`, so it defaults **on**;
set it to `false` to silence the creeps).

The corpus is one enormous line at the top of the module (`global.Talk = [ ... ]`). Swapping it is
that line and nothing else - see the note in the module about the options.

## v0.78.102 — Keeper succession margin back to 6 ticks

User decision: with spawn and hive assumed healthy, 6 ticks of margin is enough - it does not need
the 150 added in v0.78.101.

That is right, and the reason is worth recording: the batch of keepers that were genuinely failing
to hand over was **not** a margin problem. The two real defects were

1. the trigger read `data["spawnTime"]`, which `registerStationSources` overwrites to the birth
   tick during spawning, so the lead collapsed to zero (v0.78.99 moved the trigger onto the
   creep's own `ticksToLive`), and
2. the "prioritise haulers" guard counted only grown carriers, so a keeper handover was blocked
   for the whole ~150 ticks of a carrier replacement (v0.78.100).

With those fixed the margin only has to absorb the jitter between spawning completing and the
creep taking its first step, so `KEEPER_SUCCESSION_MARGIN` goes back to **6** - the same order as
the `- 6` in the original code. It stays overridable via
`Memory.marketSettings.keeperSuccessionMargin` if reality disagrees.

### Tests

The `MARGIN` policy assertion moves from `>= 100` to `> 0 && <= 30` (small positive, not large,
so two keepers do not end up sharing a source for long), with the reasoning in a comment.

## v0.78.101 — Give the keeper successor real slack, not 10 ticks

User: "harvestEnergyKeeper 明显没有接力上，没有提前孵化". The live audit right after v0.78.100
showed the succession *is* firing - every keeper past the line had `successorSpawned` set and a
successor spawning toward its source - but the lead left no slack at all:

    W34N52: lead = pathTime(7) + body*3(141) + 10 = 158, successor needs 141 + 7 = 148
            -> arrives ~10 ticks before the incumbent dies

Ten ticks of margin means the spawn must start on the exact tick with a free spawn and a charged
hive. One carrier or worker taking a spawn slot and the mine goes dark until the next attempt.

`KEEPER_SUCCESSION_MARGIN` goes from 10 to **150**, and is now overridable at runtime via
`Memory.marketSettings.keeperSuccessionMargin` (no re-upload needed, like the other knobs). The
cost is two keepers on one source for ~10% of a keeper's life, and a source's regeneration rate is
the cap anyway, so the overlap does not produce extra energy - it just buys tolerance for 100-150
ticks of spawn-queue jitter.

### Tests

The suite reads the margin out of the source so it cannot drift from the constant, and a policy
assertion requires `MARGIN >= 100` so a later edit cannot quietly go back to a just-in-time lead.

## v0.78.100 — Carriers that are still spawning count as carriers

`trySpawnOuterHarKeeper` opens with a function-level early return meant to give haulers priority:

    if (roomName == spawnRoom.name
        && spawnRoom.creeps("harvestEnergyKeeper").filter(e => e.ticksToLive > 300).length
        && spawnRoom.creeps("carrier").filter(e => e.ticksToLive > 300).length == 0) return;

It only counted **grown** carriers (`ttl > 300`), so during the ~150 ticks a carrier is being
replaced the room reads as "no haulers at all" and keeper succession is blocked with it. Live:
W34N52 had `carrier=[孵, 孵]`, a keeper at ttl 71 and no grown carrier, so the dispatch returned
and the room had to wait for the new carriers to mature before replacing the keeper that was
about to die. Found while re-auditing the home keeper succession after v0.78.99.

A carrier already in the spawning queue is a carrier. The gate now also requires that there are no
spawning carriers - the same "one in flight is enough" rule the keeper's own guard uses.

### Tests

`test/keeper-succession.test.cjs`, two new cases: with the room's only carriers still spawning the
keeper dispatch must proceed, and with no carriers at all (not even spawning) it must still defer
to haulers. The case needed a grown keeper on the room's *other* source, because that is what the
guard actually keys on. Negative control removing the exemption fails on "搬运爬都在孵化时，
keeper 续派不能也被挡".

## v0.78.99 — The keeper successor was never dispatched early: the trigger read a clobbered field

User asked to audit the *home* rooms' keeper succession with outer mining stopped. It showed a
clean signature: for every home source, `age + ttl == 1500` exactly. That is not a coincidence,
it means `spawnTime` holds the keeper's **birth tick**, so the trigger
`Game.time - data["spawnTime"] > 1500` only becomes true **at the moment of death** - the advance
is exactly zero and every handover costs the full spawn time plus travel.

`spawnTime` is written during spawning, every tick, by `registerStationSources`
(station_sources.js:262):

    if (this.spawning) { source["spawnTime"] = Game.time }

so it ends up holding the last tick of spawning, i.e. the birth. The intended correction is
`concatStationSources`, which on arrival records `arrival - (travel + body*3 + margin)`, but the
field cannot be relied on: whatever the ordering, a freshly spawned keeper reads back as birth.

The trigger now uses an **immutable fact** - the incumbent's own `ticksToLive` - rather than a
field other code rewrites:

    let inc = mine.filter(e => !e.spawning).head();
    let lead = (data.pathTime || 0) + (inc ? inc.body.length * 3 : 150) + KEEPER_SUCCESSION_MARGIN;
    if ((inc && inc.ticksToLive <= lead) || mine.length == 0) { ...spawn... }

This is the same rule as the v0.78.97 lesson, applied where it actually bites.

### Tests

`test/keeper-succession.test.cjs` now feeds a **realistic** `spawnTime` (age = 1500 - ttl, exactly
what the live game shows) so the negative control is meaningful: restoring the old trigger then
fails on "到点就要提前派（提前量必须生效）" - i.e. the old code provably does not dispatch on
time. Ten cases total.

## v0.78.98 — The outer keeper dispatch no longer locks itself out

User report: `shard3_83651808_1`, an outer keeper, was nearly out of TTL with no successor
dispatched.

`trySpawnOuterHarKeeper` opened with a function-level early return:

    if (roomName != spawnRoom.name && pro.outerMineStarvesSpawnRoom(spawnRoom, false)) return null;

That is the "home room comes first" gate - and for an outer mine it has no exemption. A keeper
**is** the mine's only energy input, so blocking it when the home room is poor zeroes the mine's
income and the home room never recovers. Live: W33N55's disposable energy fell to 4-8k (the
keeper threshold is 20k), so every outer keeper dispatch was refused while it lasted; when the
incumbent died nothing replaced it. The gate has since opened again (W33N55 is back to 119k) and
a sweep of all 26 keepers currently finds none past its trigger without a successor - but the
lock-out is real and intermittent.

The same gate already had exactly this exemption on the carrier side
(`onThisMine >= outerCarrierBacklogQuota(...)`). The keeper gate now matches: it moved into the
per-source loop and only defers when that source **already has an on-station keeper**. An empty
mine - new, or with the incumbent just dead - is never deferred.

### Tests

`test/keeper-succession.test.cjs` extended: an outer mine whose home room is starved and which has
no keeper must still dispatch; the same mine with a keeper on station must defer. Negative control
removing the exemption fails on "主房穷、但矿点一只 keeper 都没有 ⇒ 必须派（否则闸门自锁）".

## v0.78.97 — The keeper advance is measured off the creep itself

Two defects from the previous change, surfaced by a live report about W32N56 and confirmed by the
user's own formulation: **the advance is the spawn-to-source walk, plus the body's spawn time,
plus a few ticks of margin.**

### 1. The travel time was never measured honestly

It came from `Game.time - data["spawnTime"]`, but `spawnTime` is itself back-dated, so that only
holds for the first generation. From the second on it measures "ticks since the last record"
rather than the walk (live: W32N56's own-room keepers read 50 and 15 where they should read 1-5),
and the `-=` idiom then pushed every generation further ahead until the sanitiser clamped it to
"now" and fired an immediate replacement (E41S32 was already clamped).

The travel is now read off the creep itself, exactly as the user suggested: `ticksToLive` only
starts counting once spawning completes - it is `undefined` while spawning - and keepers walk
straight to their source, so `1500 - ticksToLive` **is** the spawn-to-source walk. The record is
an **assignment** from the arrival tick rather than a decrement, so generations cannot drift.
`pathTime`, which `trySpawnOuterHarCarrier` reads as its capacity input, keeps its capped value
so the congestion feedback loop described in that comment stays broken.

### 2. The guard let successors snowball

It only checked the flag on the incumbent. Once the incumbent dies, its memory - and the flag -
vanish, while the spawning successor carries no flag yet, so the trigger's
`data.creeps.length == 0` clause fired immediately and dispatched another keeper.
Live: E41S32 had 4 keepers for 2 sources with 3 of them spawning at once, W33N55 had 5,
E49S31 4.

The guard now also returns when any keeper serving that source is **currently spawning** - one
successor in flight is enough, and the flag covers the on-station case.

### Tests

`test/keeper-succession.test.cjs`: the advance is asserted to be exactly
`travel + body*3 + margin`; a second generation is asserted to recompute from its own arrival
rather than accumulate; a spawning successor must block dispatch. Negative controls restore the
decrement and the old single-condition guard.

## v0.78.96 — The keeper handover guard blocks only real duplicates

User report: the room's sources sat at full energy in W33N53, and the question was whether the
replacement keeper is dispatched early enough and whether the spawn was saturated.

The advance IS computed. On arrival a keeper back-dates its own spawn moment:

    data["spawnTime"] -= pathTime + this.body.length * 3 - 6;

so the dispatch trigger `Game.time - data["spawnTime"] > 1500` fires exactly
`pathTime + body*3 - 6` ticks before the predecessor dies - designed for a seamless handover.
Live numbers check out (W33N53's sources report spawnTime ages of 58/51, i.e. its body's spawn
time).

**But the guard defeated it.** The dispatch counted keepers with

    spawnRoom.creeps("harvestEnergyKeeper", false)

and `Room.prototype.creeps(role, spawned = true)` returns **everything, including spawning
creeps**, when the second argument is false (prototype_room.js:7). So while the predecessor was
alive the count was 1, the guard returned, and the advance-time branch was never reached: the
replacement could only start once the predecessor was gone, making the real gap the full spawn
time (66-99 ticks) plus travel instead of the designed ~6.

Spawn saturation was **not** the cause: 12 of 13 rooms had 0/3 spawns busy, and the account-wide
spawn occupancy works out around 16%.

### Changed

The guard now blocks only real duplicates, using an explicit marker on the incumbent's memory
(user's suggestion): after `StationHive.trySpawn` **returns success**, `successorSpawned` is set
on the keepers serving that source. While any keeper of that source carries the flag - spawning
or on station - no further keeper is dispatched. The predecessor's memory disappears with it, so
the successor starts clean and the next cycle triggers normally. A failed spawn sets nothing, so
the dispatch keeps retrying until a spawn slot and the energy are available.

That is safe against double-crewing: `cleanupDuplicateKeepers` only culls within `data.creeps`,
and a spawning successor is not registered there yet, so the incumbent is not killed early; if
both do end up registered, the lower-TTL one is culled, which is the wanted direction.

### Tests

New `test/keeper-succession.test.cjs` (loads the real module): incumbent far from expiry -> no
spawn; **at the deadline with the incumbent at 60 TTL -> spawn, and the flag is set** (the case
the old guard blocked); flag present -> no spawn; spawn failure -> no flag, so it retries;
empty mine -> immediate spawn; plus source assertions that the old guard is gone and that the
flag is only set after a successful `trySpawn`. Negative control restoring the old guard fails on
"到点就要提前派（提前量必须生效）".

## v0.78.95 — The rampart energy gate has to cover both entrances

Follow-up to v0.78.94, same instruction. Gating `getRepairWorkerLimit` alone was not enough: it
only covers the *spawn* path (`workerManager`'s wall branch). The other entrance is
`workerManagerAfterCarrier`, which hands an **already idle worker** the repair task via
`needBuildWallWorkerFree(room)` - so a room that happened to have a worker from construction work
would still be sent to grind ramparts it cannot afford.

`needBuildWall` (the spawn gate) and `needBuildWallWorkerFree` (the task-assignment gate) now both
short-circuit on `repairWallAffordable(room)`. Those two predicates are the only entrances to
rampart repair, so the energy rule sits on the rule itself rather than on one of its callers;
`getRepairWorkerLimit`'s 0 stays as the second layer.

Side effect worth knowing: in a room below RCL8 that is too poor to repair, the task chain now
falls through to the upgrade branch (`!needBuildWallWorkerFree && room.level < 8`) instead of
repair - RCL progress rather than rampart grinding, which is the intent.

### Tests

`test/repair-wall.test.cjs` extended: for a poor room both predicates must be false (and the
limit 0), while a room with 500k storage still reports both true. Negative control removing only
the `needBuildWallWorkerFree` gate fails on "穷房：也不该把空闲 worker 派去修墙".

## v0.78.94 — Rampart repair has to be affordable for *that* room

User instruction (2026-10-13): a room's repair worker should check whether **that room** has
enough energy - it should not just keep grinding.

`getRepairWorkerLimit` only ever lowered the count, never refused:

    if (!wall || !target || energy < 1000000) return 1;

Since no room holds anything like 1,000,000 energy (they run 42k-99k), the limit was **always 1**,
so every room kept one repair worker regardless of what it could afford. Repairing is a pure
sink: 1 energy buys 100 hits, an RCL8 rampart caps at 300M hits, so **one wall costs about 3M
energy** - tens of times a room's entire storage. Live, E53S21 was the room paying for it: all 38
of its ramparts sat at 29M hits (the other twelve rooms are already at the 300M cap), and topping
it up would take ~100M energy.

### Changed

- `StationDefense.repairWallAffordable(room)`: storage holds at least `repairWallEnergyFloor`
  (**100000**, overridable via `Memory.marketSettings.repairWallEnergyFloor`). Storage only, not
  `storage + terminal` - the terminal is the market reserve and does not vouch for optional
  spending, the same rule as `POWER_SPAWN_ENERGY_FLOOR`. A room without a storage yet is never
  affordable: it should build its economy first.
- `getRepairWorkerLimit` returns **0** when unaffordable, which makes `workerCount < workerLimit`
  permanently false and cuts that spawn path off at a single point. Construction is unaffected -
  it goes through the `room.constructionSite.length` branch.

### Tests

New `test/repair-wall.test.cjs`: the floor boundary (200k yes, 50k and 99999 no), no storage, no
room, the Memory override, and `getRepairWorkerLimit` returning 0 at 46k while still returning 1
at 200k and 2 for a storage >= 1M with a wall far below target. Negative control (removing the
gate) fails on "storage 4.6 万（实测 E53S21）→ 一只都不派".

## v0.78.93 — A dead raL1 team's flag is cleaned up again

User decision (2026-10-13): raL1 teams are one-shot — when the team dies the mission is over and
it is not rebuilt, so the flag should be removed. Option (a) of the two offered.

The cleanup already existed in the file, commented out under `execSpawn` (lines 352-364):

    // if(!Game.creeps[flag.memory.creepName]){
    //     if(flag.name.indexOf("_keeper")>=0){ ...clear the name so it respawns... }
    //     else{ flag.remove(); }

With it disabled, nothing ever clears `flag.memory.creepName`, so the rebuild condition on the
first line of `execSpawn` (`!flag.memory.creepName`) is permanently false: **a dead team neither
respawns nor gets cleaned up.** `raL1_E59S38_1` was still holding the name of a creep that had
been dead for ~340k ticks.

### Added

`TeamRaL1.expireDeadTeamFlag(flag)`, called at the top of `execSpawn` and returning true when the
flag has been handled. Deliberately conservative:

- `_keeper` flags are the standing variant (they clear the name and respawn) - untouched.
- Flags with a `taskId` belong to the cross-shard flow - untouched.
- **Debounced against the spawn race**: in the tick or two right after `trySpawn`, `Game.creeps`
  may not list the creep yet, and removing the flag then would kill a team that is spawning
  normally. It takes 3 consecutive misses (exec runs every 3 ticks, so ~9 ticks) and at least 10
  ticks since `spawnTime` before anything is removed.
- No `creepName` at all means no team has been dispatched yet - left to the spawn logic below.

### Tests

New `test/team-ral1.test.cjs` (loads the real module): removal after 3 misses; a live creep never
removes and resets the miss counter; a fresh `spawnTime` is never removed; `_keeper` and `taskId`
flags are never removed; no `creepName` is not removed; plus a call-site assertion. Negative
control: deleting the call site fails on "execSpawn 开头必须挂这道清理".

## v0.78.92 — "Unreachable" counted travel, so every source was written off

User asked why the PCs in E53S21 and elsewhere were not using PWR_REGEN_SOURCE. The answer was
worse than a per-room issue: **all 26 sources in the account had no effect at all.**

    P10 (E53S21)  lv4 cd0  774 ops  busy (1 task)  needOpSource -> 8,4
    P3  (E55S39)  lv4 cd0  706 ops  free, 0 tasks  needOpSource -> false
    P2  (E49S31)  lv5 cd0 1260 ops  free, 0 tasks  needOpSource -> false

`needOpSource` returning false while every source is bare means only one thing: they are all
marked unreachable, and they were - **all 12 creeps had both of their sources marked**, with
3-189 ticks left on each.

### Root cause (my own regression from v0.78.88)

The stuck counter I added then incremented on **every tick the creep was out of range**, and
gave up after 3. But a creep walks from the power spawn to the source - tens of tiles - and is
out of range the whole way while moving perfectly well. So it walked three tiles, decided the
source was unreachable, marked it for 200 ticks and popped the task. Both sources, every room,
forever: mark -> TTL lapses -> try -> 3 ticks -> mark again.

The counter now keys on **whether the position actually changed** (same shape as the existing
`outerStuck` / `outerRoadStuck` handles): travelling resets it, and only three consecutive
ticks in the identical tile count as stuck. The semantics are "3 ticks in the same place", so
the first sighting counts as 1.

Also split out a second case: in range with the cooldown at 0 but `usePower` still failing
(insufficient ops, bad target). That pops the task - it must not stay queued forever - but it
does **not** mark the source unreachable, because that failure says nothing about reachability.

### Tests

`test/power-source.test.cjs`: a creep that moves 30 ticks while out of range must never pop and
must never be marked; one that sits still for 3 ticks must pop and be marked; an in-range
`usePower` failure must pop without marking. Negative control: restoring the unconditional
counter fails on "一路在移动就绝不弹栈（这是原来 26/26 全灭的根因）".

## v0.78.91 — The lair-group cache was being invalidated by its own two callers

CPU review of the outer-mining code (user request: cut CPU without changing behaviour). The
target was already identified by profile: `outerHarvestDefenser` costs **3.47 CPU/tick for 3
creeps (1.16 each, 37% of all creep CPU)**, while keepers and haulers are healthy (0.074 and
0.094 per creep).

`outerDefenseLairGroups` caches its pairing table in `room.memory` under
`defenseLairGroupsKey`, which is built as `lairs.map(e => e.id).join(",")` - **the key depends on
the order the caller passes the lairs in.** And the two callers disagreed:

    outerDefense          -> pro.defenseHostileStructures(room).filter(...)   // engine order
    outerDefensePosts     -> the same, then .sort(by x, then y)              // sorted order

So each caller evicted the other's cache on every tick, and every miss re-runs the **whole
pathfinding batch** inside `outerDefenseLairGroups` - `PathFinder.search` for every pair of
lairs (4 lairs = 6 cross-room searches). With three defenders calling in twice a tick that is
tens of cross-room searches per tick, which is the right order of magnitude for the 1.16
CPU/creep.

### Fixed

- `defenseLairs(room)` (new): the keeper-lair list, **sorted by coordinates**, cached on the
  room object (which the engine rebuilds every tick, so it cannot go stale). All three callers
  now use it - `outerDefense`, `outerDefensePosts`, `outerDefenseAssignmentForSpawn` - so the
  cache key is stable and the pathfinding batch runs once per room per tick at most.
- `outerDefenseAssignmentForSpawn` was building its own list with a raw
  `harRoom.find(FIND_HOSTILE_STRUCTURES)`, bypassing both the cached accessor and the whitelist
  path; it now shares the same cached list.
- Filtering and sorting the lairs per defender per tick is gone with it (4-element sort, small,
  but it was per defender per tick).

### Not measured

The outer mining is paused right now (`stopRemote` on W34N55), so the engagement path cannot be
exercised to confirm the delta. The mechanism is covered by test instead: the new case asserts
that the same list hits the cache while a reordered list misses it, and that no other call site
builds its own list.

### Tests

`test/outer-defense.test.cjs`: `defenseLairs` sorts and caches, the group table is computed once
for a repeated call and recomputed for a reordered one, plus source assertions that only
`defenseLairs` builds the list and that `outerDefensePosts` uses it. Two pre-existing harness
gaps had to be fixed on the way: the defence test reused one room stub across two simulated
ticks (the engine rebuilds the room object every tick, which these caches rely on **and** which
is what exposed the stale read), and it had no `PathFinder` stub - `outerDefenseLairGroups` had
never actually been reached in that test before, because the stale cache short-circuited it.
Negative control: making `outerDefense` build its own list again fails on "只允许 defenseLairs
内部自建列表".

## v0.78.90 — A mission that has been committed to gets finished

User instruction (2026-10-10): **do not pause an unfinished power bank / deposit mission** - a
paused mission never completes. Reported symptom: `shard3_83543262_1` stranded in E53S20, the
first highway room on the way from E53S21 to the deposit at E57S20.

That creep had already expired by the time it was investigated (it was ~1400 of its 1500 ticks
old), so the two mechanisms that can strand a committed team were found by reading instead.

### Deposit

- **The post-attack sleep could freeze a running mission.** `harvestDeposit` sets
  `flag.memory.beAttackTime` as soon as one harvester has lost 1000 hits, and the maintenance
  loop then did `return` unconditionally for `ATTACKED_SLEEP` (1200 ticks) - no reinforcement, no
  over-cap cleanup, and the mission would run out of creeps and never finish. It is now gated on
  `harvesters.length == 0 && carriers.length == 0`: the sleep may stop a mission **nobody has
  been sent to**, but never one that is already being worked.
- **A hauler whose task flag disappeared idled in place.** `carryDeposit` only checked
  `Game.flags[task.flagName]` in the branch for *already in the target room*; the travelling
  branch just called `goTo(task)` and kept heading for a room whose mission had ended - arriving
  only to stand there until it died. The check now happens before the room comparison, so a
  hauler turns around wherever it is and goes home (`sendDepositCreepHome`: pop the task, recycle,
  unload into the main room). The old in-room `return;` became the same call.
- Removed a duplicate `Creep.prototype.harvestDeposit` definition. The file had two; the second
  silently overrode the first, so the first was dead code that would have to be maintained for no
  reason.

### Power bank

- `if (beingAttack && boostLevel != L1/L2) return flag.remove();` deleted the mission flag
  outright, which takes away the task reference the dispatched team is holding - the same
  stranding shape. It now removes only when `pbTeamAlive(flag)` is false (attacker / healer /
  carrier arrays all dead); with anyone still out there the flag stays so their own task logic
  can finish or retreat, and this path just stops reinforcing.
- Left alone: the two `flag.remove()` calls for "the power bank no longer exists / has expired"
  (lines 513/517). Those are the target disappearing, not a pause on an unfinished mission.

### Tests

New `test/deposit-mission.test.cjs`, loading both real modules. Deposit: transit with a live flag
-> `goTo`; transit and in-room with a dead flag -> pop + recycle + unload, and explicitly **no
`goTo`**; the sleep gate must carry the "nobody committed" condition; `harvestDeposit` defined
exactly once. Power bank: `pbTeamAlive` for live/dead teams, object-shaped `healer` and
array-shaped `carrier`, undefined flag; plus a call-site assertion. Negative controls: the old
deposit code fails on "任务没了要先弹掉任务", and reverting the power bank call site fails on
"「被打又出不了 T2」必须先在 pbTeamAlive 为空时才撤任务".

## v0.78.89 — A room with nothing to spend does not get a worker

User instruction (2026-10-11): rooms with no energy should not produce workers - they cannot be
used anyway. Every worker job (build / repair rampart / upgrade / deliver) spends energy per
tick, so in a room with nothing to spend the worker either idles or competes with the spawn and
the keepers for the dregs.

`workerManager` previously only checked the *hive*: `HiveNeedToFill(room) && energyAvailable <
2500`. That says nothing about the room's own pool - a room whose storage is dry but whose hive
happens to hold 2500 still got a repair worker, and `StationDefense.needBuildWall(room) &&
EnergyOk` alone is enough to keep spawning one.

### Changed

- `StrategyHighLevel.workerHasEnergyToSpend(room)`, checked at the top of `workerManager`. True
  if either (a) **the room still has a live keeper** - there is income, so what the worker spends
  comes back, and it is demonstrably not "unusable"; or (b) storage holds at least
  `WORKER_ENERGY_FLOOR` (10000), overridable with `Memory.marketSettings.workerEnergyFloor`.
  Storage only, not `storage + terminal`: the terminal is the market reserve and does not vouch
  for optional spending (same rule as `POWER_SPAWN_ENERGY_FLOOR`).
- **The dead-room self-rescue path is deliberately untouched.** `workerManagerAfterCarrier`'s
  bootstrap spawns a worker that goes *straight to mining* - its product is energy itself - so
  putting a stock threshold in front of it would lock a dead room out permanently.

### Note

This is protection, not an immediate behaviour change: all 13 rooms currently hold 7270+ in
storage and 2+ keepers, so every room passes. It bites when a room loses its keepers *and* its
storage.

### Tests

`test/power-spawn.test.cjs` +1 case: stock above/below the floor, keeper-only rooms (allowed),
`9999` (blocked), no storage (blocked), a missing room (false), the Memory override, and a
**call-site** assertion - helper tests alone cannot catch "helper exists but nobody calls it".
Negative control: deleting the call-site guard fails on "workerManager 开头必须挂这道闸".

## v0.78.88 — A wedged OpSource task was blocking the whole power creep

User asked why the OP-source ability (PWR_REGEN_SOURCE) is not used when so many rooms have it,
and pointed out that **both** sources need it or the energy income drops.

It *is* used: 12 power creeps all carry `PWR_REGEN_SOURCE` at lv4-5 with cooldown 0, and 19 of
the 26 sources carry the effect. But **7 sources are bare**, and the reason is not the ability:

    P5  (E59S38)  pc=41,31  target=38,35  d=4  effect none
    P9  (E41S23)  pc=31,46  target=27,45  d=4  effect none

`PWR_REGEN_SOURCE` has **range 3**. Both creeps sit at distance 4 and do not move (P5 was at
41,31 at tick 83544466 and still there 13 ticks later). And `OpSource` only pops its task when
`usePower` returns OK:

    if (code == OK) { ...; this.popTask().addTask(goToNearPop).execLastTask(); }

so the failing `usePower` left the task queued **forever**. `isFree()` stayed false, which means
`StrategyFactoryPowerCreep.execRoom`'s `if (pc.isFree())` block never ran again - the creep could
not do *anything* else (OpExt, OpSpawn, OpStorage, ...) and that source never got its effect.
All four probed creeps were stuck on exactly one task: `OpSource`.

### Fixed

- `OpSource` counts consecutive failures (out of range, or `usePower` != OK) and, after
  `OP_SOURCE_STUCK_ATTEMPTS` (3), **pops the task** and marks that source unreachable for
  `OP_SOURCE_UNREACHABLE_TTL` (200 ticks). The counter and the mark are cleared on success.
- `needOpSource` **skips sources marked unreachable**, so the creep goes and does the *other*
  source instead of hammering the one it cannot reach - which is the behaviour the user asked
  for. The mark expires, so it retries later rather than giving up for good.

### Also found (not changed)

**W34N52 has no power creep and no `OPF` flag at all** (12 flags for 13 rooms), so neither of its
sources can ever get the effect. Spawning a 13th power creep is a bigger decision (power creep
count is capped by GCL), so it is reported rather than done.

### Tests

New `test/power-source.test.cjs` (loads the real module in a VM; the top level copies
`Creep.prototype` onto `PowerCreep.prototype`, so `_` and `Creep` must exist before it loads, and
the array `head` extension is needed too). Covers: both sources covered -> no action; one bare ->
that one; **one marked unreachable -> the other one**; both unreachable -> nothing; TTL expiry ->
retry; cooldown -> nothing; and for `OpSource`, that 3 consecutive failures pop the task and set
the unreachable mark (both for out-of-range and for a failing `usePower`), plus the success path
clearing both. Negative control: the old implementation fails on
"a 暂时够不到 → 换 b，而不是死磕 a".

## v0.78.87 — A stopped mineral chain must not keep a container site around

User instruction (2026-10-10): if the mineral chain is off, do not build a container next to
the mineral.

Live, the mismatch was visible: W34N55's mineral (H, 42,16) had a container construction site
parked beside it at **0/5000 progress**, while **zero** `harMineralOuterKeeper` and **zero**
`harMineralOuterCarrier` existed anywhere in the account. Nothing was going to build it, and
it occupies that room's construction-site quota indefinitely.

### Changed

- `trySpawnOuterMineralKeeper` now checks `StationSources.outerMineralOff(roomName)` before
  creating the site, and **removes any lingering container site next to the mineral** (and
  clears `data.containerSite`) when the chain is off.
- `outerMineralOff` keys on the *same* predicate `strategy_outerHarvest` uses to decide whether
  to dispatch mineral creeps - `Memory.stopOuterMineral` or
  `StrategyOuterHarvest.shouldHarvestRemoteMineral(room)` - so "no creeps dispatched, site still
  built" cannot happen. With no `StrategyOuterHarvest` available it returns false rather than
  guessing the chain is off.

### Tests

`test/outer-mineral.test.cjs` +1 case: `outerMineralOff` for all four states (running, global
pause, filtered out, strategy object missing), and that the cleanup removes only container
sites **next to the mineral** while leaving a road site alone. Plus a source assertion on the
**call site**, because testing the helpers alone cannot catch "helper exists but nobody calls
it" - the first version of the negative control (deleting the call-site guard) passed until
that assertion was added.

## v0.78.86 — The hive refill was locking the outer mines out of their own income

Checked the outer mines today and found W34N55 stalled: **three containers full at 2000 each,
one defender in the room, zero miners, zero haulers.**

### Root cause: a transient hive gap decided the keeper gate

`trySpawnOuterHarKeeper` bails out on `outerMineStarvesSpawnRoom(spawnRoom, false)` (threshold
20000 for keepers), which computed

    disposable = storage + max(0, terminal - reserve) - (capacity - available)

That last term is the spawn/extension **gap right now**. With a hive capacity of 12900 and three
spawns working, the gap is routinely several thousand - 60%+ of the keeper threshold - so the
gate flips with the spawning rhythm. And the outer keeper is the **home room's income**, so
closing it is self-defeating:

    W33N55: storage 17166  terminal 24212  hive 7580/12900
    disposableEnergy = 21378, deficit = 5320 -> disposable = 16058 < 20000 -> "starved"
    -> no keeper is ever dispatched -> 3 full containers, no income -> still "starved"

The gap also double-counts: the hive is refilled by the room's **own** carriers, and that gate
never blocks them. The term is gone; `disposable = disposableEnergy`.

Verified live before and after on the same numbers: 16058 -> 21378, i.e. the gate opens. The
frame still cuts in for a genuinely poor room (storage 1000 -> starved), asserted.

### Boost threshold is now derived from the mining limit (user instruction)

`BOOST_COOL_DOWN = 90` could never fire: boosting needs `lastCooldown > 90` while the mining
gate closes at `maxCoolDown() + offset` (80, now 60), so **deposit harvesters were never
boosted** and the compounds the code prepares were never spent. It is now
`boostCoolDown() = floor(maxCoolDown() / 2)` (20 on shard3), so the two move together and the
condition can never fall out of reach again. Overridable with
`Memory.marketSettings.depositBoostCooldown`.

### Tests

- `test/edge-link.test.cjs`: the hive gap must not mark a room poor (the live numbers), and a
  genuinely poor room must still be marked poor. Negative control re-adding the deficit fails
  on "hive 缺口不能把主房判穷（否则外矿矿工永远派不出去）".
- `test/deposit-threshold.test.cjs`: `boostCoolDown()` = 20, strictly below `maxCoolDown()`,
  tracks it when the limit changes, honours its own override, **and** asserts on the call site
  (`lastCooldown > boostCoolDown()`, no hardcoded 90). The first version of that assertion only
  checked the constant, so hardcoding the call site back to 90 slipped through; the comment
  stripper also had to learn block comments, since the docs quote the removed expression.

## v0.78.85 — The deposit limit has to govern reinforcement too, or nothing changes

v0.78.84 lowered the deposit bar to 40 but **nothing moved**: the seven live missions kept the
same 13 `harDeposits` / 6 `carrierDeposits` and the ones sitting at `lastCooldown` 45 / 56 / 57
kept being reinforced.

The reason is that there were two bars on the same decision:

    createOrUpdateDepositMission:  lastCooldown > maxCoolDown()        -> do not commit
    reinforcement gate:            lastCooldown < maxCoolDown() + offset

`offset = walkableAroundCnt * 10 - 10` (up to +20) was meant to let a deposit with more
walkable tiles keep going longer. But it sits on the *continue* side, so raising the bar to 40
still left reinforcement running to 60 - the new number was silently overridden by the second
copy, exactly the pattern v0.78.83 fixed for the power bank bar.

### Fixed

- Both gates now use `maxCoolDown()`. `walkableAroundCnt` still decides **how many harvesters
  stand on the deposit at once** - it no longer decides **how long we keep mining it**.
- Dead `offset` local removed.

### Tests

`test/deposit-threshold.test.cjs` +2 assertions: the reinforcement gate must not add anything
to `maxCoolDown()`, and the `offset` local must not come back. Negative control: re-introducing
the `+ offset` fails on "续派闸不能再用 offset 放宽上限".

Also carries a small v0.78.84 addendum: the earlier entry described the offset as retained, which
was true of that deploy and is corrected here.

## v0.78.84 — Mine deposits less, and stop committing teams to spent ones

User instruction (2026-10-09): keep deposit harvesting, but there are seven missions running -
are there really that many? Mine less of each deposit and be more efficient about it.

Live, all seven were `biomass`, holding 19 creeps between them:

    mission            type      lastCooldown  remaining life  har  carrier  walkable
    E41S32/E44S30      biomass        61            48309       0      0        3
    E53S21/E57S20      biomass        56            49042       2      1        3
    E41S23/E40S19      biomass        57            48633       3      1        3
    E41S23/E40S23      biomass        35            48618       1      1        1
    E53S21/E50S21      biomass        45            49052       1      1        3
    E49S31/E50S28      biomass        37            49135       3      1        3
    E41S32/E40S29      biomass        16            49145       3      1        3

`lastCooldown` is the **amount already extracted** (0 = fresh, larger = closer to spent), and it
only ever grows while the remaining resource shrinks. The tail of a deposit is the worst part
of it: a mission still costs 1-3 `harDeposits` plus a `carrierDeposits` and a full one-way
`pathTime` of walking, for a shrinking return. Those creeps are better spent on a fresh
deposit.

### Changed

- `MAX_COOL_DOWM` on shard3: **60 -> 40** (roughly two thirds extracted, then stop).
  The other shards keep 120/120/120/50. Note the spawn gate still adds `offset`
  (`walkableAroundCnt * 10 - 10`, up to +20), so a deposit that already has a team is
  reinforced up to 60 - the 40 only governs committing a *new* team.
- The constant is no longer frozen at module load. `maxCoolDown()` reads
  `Memory.marketSettings.depositMaxCooldown` on every call, so retuning no longer needs a
  code upload. `MAX_COOL_DOWM_DEFAULT` keeps the per-shard defaults.
- Cleaned the name: the old `MAX_COOL_DOWM` is gone so there is exactly one place that
  answers "how far do we mine this", rather than a second copy that a future edit could miss.

### Found, not changed

`BOOST_COOL_DOWN = 90` is unreachable. Boosting needs `lastCooldown > 90`, but the spawning
gate above it closes at `maxCoolDown() + offset` <= 80 (and <= 60 now), so the branch that
sets `needBoost` can never see a qualifying value - deposit harvesters are never boosted, and
the boost compounds the code prepares are never spent. Left as-is because tuning boost is a
separate decision; flagged here.

### Tests

New `test/deposit-threshold.test.cjs` slices the constant block out of the module (same trick
as `market-phase.test.cjs`, since the module's top level needs live game objects) and asserts:
shard3 = 40, the other shards unchanged, the Memory override wins, and that the override is
read **live** (mutating Memory flips the answer without reloading). Two negative controls:
restoring 60 fails, and freezing it back into a load-time constant fails.

## v0.78.83 — Stop buying power, and raise the power bank bar to 6000

Two user instructions (2026-10-08).

### `autoBuyPower` no longer buys anything

It was already unreachable - its only call site in `autoBuy()` was commented out, and live
there is exactly one buy order (40k energy in W33N55, no power). But the **body** still built
orders, so re-enabling one line would have started buying 3000 power per room again (price
capped at 2200) and repricing existing ones.

It is now the opposite: cancel any power buy order we own, and the call is wired back in so
it runs every 100 ticks. `Game.market.orders` only ever contains our own orders, so this
cannot touch anybody else's. It only cancels **buys** - a power sell order is left alone.

### Power bank collection threshold: 5000 -> 6000

`strategy_powerBank.js` had two thresholds stacked on the same decision:

    if (isSaveCpu && powerBankData.power < Math.min(10000 - bucket, 5000)) skip
    if (powerBankData.power < MIN_POWER) skip          // MIN_POWER = 5000

The first one is a no-op and always has been: `Math.min(10000 - bucket, 5000)` can never
exceed 5000, so the `MIN_POWER` check right below it was the binding one. Worse, it is a
second copy of the same number - raising `MIN_POWER` to 6000 would have left it there
silently pulling the bar back to 5000 whenever the bucket dropped. Both the dead expression
and the redundant branch are gone; `MIN_POWER = 6000` is now the single source of truth.

### Tests

New `test/power-market.test.cjs`. It loads the real `strategy_market.js` in a VM and asserts
that two power buys are cancelled, no order is created, no price is touched, and that energy
/ ops buys and power **sells** survive. Plus a source-level guard tying `MIN_POWER` to 6000
and asserting the dead bucket-adaptive expression is gone (the assertion strips `//` comments
first - the explanatory comment quotes the removed expression verbatim, which is exactly how
the first version of this test failed).

Negative control is behavioural, not a stub artifact: restoring the old `autoBuyPower` makes
it fail on "自家 power 买单要全部撤掉" (the stub deliberately *records* `changeOrderPrice`
instead of throwing, so the old code runs to completion).

## v0.78.82 — A room that cannot afford energy does not get to burn it on ops

`StrategyHighLevel.processPowerSpawn` converts 50 energy + 1 power into 1 ops per tick. Its
only gate was the **account-level** `StationHive.isEnergyAbundant()`, so a room whose storage
had run dry kept burning as long as the account as a whole looked comfortable. Live today:

    ecoBalance: abundant=true  avg=91699  min=41636

    room      storage   terminal   powerSpawn [energy, power]
    W33N55          0      41636    [15, 41]      <- storage empty, still counted as rich
    E41S32       3077      57202    [4016, 40]
    E41S23      11901      57740    [4987, 89]
    W32N56      29325      59688    [4970, 34]
    ...

`isEnergyAbundant` turns on at `avg >= 120000 && min >= 40000` and off at `avg < 80000 ||
min < 20000`, so its hysteresis band (20k-40k) is exactly where a room is already poor.

### Fixed

- `StrategyHighLevel.roomEnergyAbundant(room)` (new): the **room-level** counterpart, and
  `processPowerSpawn` now requires both gates. Threshold `POWER_SPAWN_ENERGY_FLOOR = 30000`,
  overridable with `Memory.marketSettings.powerSpawnEnergyFloor`.
- It deliberately reads **storage only, not `storage + terminal`**. The terminal holds the
  market reserve, and letting it vouch for optional energy spending is what produced the
  W33N55 row above - a room with an empty storage and 41k parked in its terminal. The same
  reasoning that made `OUTER_TERMINAL_RESERVE` a reserve in the first place.
- The account-level gate is untouched and still runs first: a rich room in a poor account
  still stops (asserted).

### Tests

New `test/power-spawn.test.cjs` (8 assertions) runs the real module in a VM: storage 0 /
3077 / 29999 must not burn, exactly 30000 and 120000 must, a room without storage must not,
the account gate must still veto, and the Memory override must be honoured. Negative control:
restoring the account-only version fails on "storage 0 的房绝不能再烧 50 energy/tick".

## v0.78.81 — Cut the far outer room, and make stopRemote survive losing vision

The account is CPU-budget-saturated (see v0.78.80): recent 100-tick buckets average ~20.6
against a limit of 20, so the bucket sits on the `bucket > 40` floor and the bot runs at
roughly 90% duty. The work has to come down; the outer mines are the cheapest thing to give
up, and among them W35N55 is twice the haul of W34N55:

    room     source   pathTime   route len
    W34N55   2d12        78          76
    W34N55   2d15        43          45
    W34N55   2d16        68          68
    W35N55   2af3       106          88
    W35N55   2af4       125         125
    W35N55   2af5       108         104

W35N55 is two rooms from the home room W33N55 and its hauls cross W34N55, so it costs ~2x
the in-flight time for the same throughput.

### Changed (live state, no code)

- **Deleted the `har_W33N55_W35N55` flag.** `StrategyOuterHarvest.exec` only ever iterates
  `har*` flags, so with the flag gone W35N55 stops being dispatched entirely — no keepers, no
  haulers, no defenders. Creeps already in the room are deliberately left alone (the same
  rule the congestion pause documents), so they finish their trips and die out instead of
  being stranded mid-route. Reversible: recreate the flag (its memory was `{spawnRoom:
  "W33N55"}`, position W35N55 (25,25), colour 1; a backup is kept at
  `.workbuddy/tmp/flag-backup-har_W33N55_W35N55.json`).
- The energy parked there is not lost: container contents and never-decaying ground piles
  stay put, so reopening the mine later still finds them.

### Fixed

- **The `stopRemote` pause silently stopped working without vision.** It was
  `Game.rooms[targetRoomName] && Game.rooms[targetRoomName].flags("stopRemote").length` -
  which requires us to currently *see* the room. That is exactly backwards for a permanent
  opt-out: the moment the creeps leave and vision drops, the guard disappears and the mine
  quietly comes back (keepers do not need vision, see the "普通外矿不依赖当前视野" note in the
  same function). It now scans `Game.flags` by name prefix + room name via
  `StrategyOuterHarvest.hasStopRemoteFlag`, matching the engine's `Room.flags(name)` prefix
  semantics without needing vision. Nothing uses `stopRemote` today, so live behaviour is
  unchanged - this only makes the existing switch actually work if it is used.

### Tests

`test/outer-defense.test.cjs` +1 case, including the regression that matters: it asserts
`hasStopRemoteFlag` is true **while `Game.rooms` is undefined**, i.e. with no vision at all.

## v0.78.80 — The hauling backlog is per mine, not per account

v0.78.79 broke the outer-hauler deadlock and the chain came back (0 -> 8 haulers, 32 keepers,
W33N55 storage 4242 -> 8448). But the exemption it added compared a **global** quota against a
**global** fleet, and haulers do not spread themselves across mines:

    W34N55   5 haulers   3070 in containers
    W35N55   2 haulers   6000 in containers + 7105 on the ground (never decays)

`outerCarrierBacklogQuota` returned `floor(3070 / 2500) = 1` for the whole spawn room, so with
7 haulers alive both target rooms were told "you have enough". W35N55 kept its ~13k.

### Fixed

- `outerMineEnergyWaiting(spawnRoom, roomFilter)` and
  `outerCarrierBacklogQuota(spawnRoom, roomFilter)` now take the target mine, and the per-tick
  cache is keyed by it. A hauler only ever runs one mine's route, so the quota has to be read
  per mine.
- The gate counts the haulers **on that mine** (`headTask().roomName == targetName`), not the
  whole fleet. `roomCarriers` is already fetched for the fleet cap, so this is a filter over
  ~8 creeps, not a second scan.

The global cap (`outerCarrierFleetCap` / `Memory.marketSettings.outerCarrierMax`) is unchanged
and still runs first-class; this only corrects which number the starvation exemption compares
against.

### Tests

`test/edge-link.test.cjs` +1 case with two outer rooms of different depth (3070 vs 6000),
asserting that the same global fleet that satisfies W34N55 must still let W35N55 recruit.

### Note on the CPU budget

The revived outer chain costs roughly 1.8 CPU/tick, which this account does not have: recent
100-tick buckets average ~20.6 against a limit of 20, so the bucket has settled against the
`bucket > 40` floor in `main.js` and the bot is running at roughly half duty. That is a
budget problem, not a bug in this change - it is what reviving six outer mines costs. Tracked
separately.

## v0.78.79 — The outer hauler gate could not be satisfied by its own output

Live: **zero** `outerHarvestEnergyCarrier` in the whole account, both outer rooms of W33N55
dead, and ~18k energy parked outside while the home room looked poor.

    W33N55 (home)   storage 4242   terminal 48350
    W34N55          3 containers 2000/2000 (full) + 5714 on the ground   no creeps at all
    W35N55          3 containers 2000/2000 (full)                        no creeps at all

`trySpawnOuterHarCarrier` gated recruitment on `outerMineStarvesSpawnRoom(spawnRoom, true)`,
which gates on the **home room's** energy - and the home room's energy is exactly what the
outer haulers produce. That is a feedback lock:

    no haulers -> the freight never comes home -> the home looks starved
               -> the gate stays true -> no haulers are ever spawned

### Fixed

- **The market reserve was larger than the gate it feeds.** `OUTER_TERMINAL_RESERVE` is
  50000 and the carrier threshold is 30000, so a terminal contributed **nothing** until it
  passed 50000, and a room needed 80000 in the terminal to clear the bar at all. W33N55 had
  48350 sitting in its terminal and was scored as "4242 disposable". The reserve is now
  clamped to the threshold (`Math.min(reserve, threshold)`), which is what the 2026-10-04
  comment intended when it started counting the terminal in the first place.
- **`outerMineEnergyWaiting(spawnRoom)`** (new): how much freight is stacked in the outer
  rooms of this home (the `stationSources[*].container` stores, plus ground spills when the
  containers alone are not conclusive). Same "home-room route" predicate as
  `outerRouteUnion` / `outerCarrierFleetCap` so the three cannot drift apart. Cached per tick.
- **`outerCarrierBacklogQuota(spawnRoom)`** (new): `backlog / OUTER_CARRIER_COST` - how many
  haulers the *freight itself* justifies (one costs 2500 and hauls 1700, so anything above
  2500 pays for itself in one trip). The carrier gate is now
  `starved && fleet >= quota`, so the deadlock breaks while the gate keeps working: the
  quota falls to 0 the moment the freight is cleared, so this cannot permanently disable it.

`outerMineEnergyWaiting` reads the containers by the ids recorded in station memory, so it is
0 without vision - deliberately conservative, it just falls back to the old gate.

### Fixed (cont.)

- **Sub-500 spills next to the hauler were uncollectable.** `outerCarryNearbyDrop` used the
  same `amount > 500` filter as the travelling detour scan, so the small piles that spill
  onto the container tile while a keeper stands on it were never collected by anyone - the
  container is full and nothing else can reach them. Live: 145 on (32,31) and 191 next to
  (9,34). The 500 bar only ever made sense for *detouring* (that is
  `OUTER_CARRY_DROP_PICK`, on the 8-tile scan); at range 1 the pile is underfoot and picking
  it up costs nothing, so that path is now unconditional. The existing test asserted the old
  behaviour while its own comment said the opposite - the fixture also ignored
  `findInRange`'s `range` argument, which is why "next to me" and "8 tiles away" were
  indistinguishable in the suite. Both are fixed, and the two cases are now asserted
  separately.

### Investigated, no change needed

- **Towers cannot heal outer creeps** and that is not a bug: heal is the tower's *first*
  branch (`station_tower.js:102`, ahead of attack and repair), but a tower cannot reach
  another room and the outer rooms are keeper rooms where we own nothing. Field healing is
  the defenders' job (they carry 11 HEAL and heal allies every tick,
  `station_sources.js` `outerDefense`); keepers and haulers carry no HEAL and disengage.
- **W34N55 (34,29) does have a road** (2100/5000) and is waypoint #1 of two routes - it was
  on the miss-list only during the v0.78.58 maintenance-stall window. The real symptom is
  that it decayed below the 50% repair bar with nobody walking the route.
- **The duplicate T3 defenders were already fixed** in `6cd06b0` (`outerDefenseQuota` returns
  1 for an invader kite squad instead of the baseline 2). No boosted creeps beyond T2 exist
  online now.

## v0.78.78 — The flee search was the 13.7 CPU/tick hotspot (never compute PathFinder every tick)

Round-16 telemetry still showed the bucket pinned near zero with `roles last` naming the
defenders again - this time **13.72 CPU/tick**. The hotspot is a single line:

    let flee = PathFinder.search(this.pos, { pos: em.pos, range: 5 }, { flee: true, maxRooms: 1 }).path[0];

Every defender below 90% health ran a **flee search every tick**, and the identical pattern
existed for the keepers' evacuation (`harvestEnergyOuterKeeper`:

    PathFinder.search(this.pos, { pos: hunter.pos, range: OUTER_KEEPER_FLEE_RANGE + 4 }, ...)

With 5 defenders and a dozen-plus keepers that is a worst case of twenty-plus path searches per
tick - far more than a 20 CPU budget can pay for, even with `maxRooms: 1`.

Both sites now cache the computed step in `creep.memory.fleeStep` and only recompute it every
4 ticks (or when the creep has reached the cached step / the cached entry is gone). That is
sound because these bodies are 50 parts with 17-20 MOVE - about 2 fatigue per tile, so they can
only advance one tile every two ticks - and the enemy (a keeper) moves at roughly 0.35 tiles per
tick. The keeper evacuation also now uses the shared ally scan instead of its own
`room.find(FIND_MY_CREEPS)`.

### Tests
core-profile +1 assertion that both flee sites cache; full suite green.

## v0.78.77 — Freeze the optional resource ops under MIN_CPU too (emergency CPU relief)

Live: the bucket was pinned at **47** (cached window 834567) with windows running 18.4-23.9 CPU
and 23-68 of every 100 ticks over the limit. `MIN_CPU` was on, yet the tick was still over
budget - because the roles it freezes are only `worker`/`upgrader` plus the optional strategy
modules, while the **power bank** (`PBer` 50, `PBCarrier` 10) and the **deposit mining**
(`harDeposits` 9, `carrierDeposits` 9) carry *positive* priorities and therefore keep running
at full tilt in the emergency. Measured together they are ~3-4 CPU/tick of work that produces
resources but no energy - a net loss precisely when the carrier/keeper energy loop is being
truncated mid-tick.

- `PBer` / `PBCarrier` / `harDeposits` / `carrierDeposits` are now priority `-1`, so
  `ROLE_PRIORITY_ALLOWED` freezes them whenever the bucket is under the MIN_CPU line. They
  resume by themselves as soon as the bucket recovers - no manual step.
- the power creeps (`power:OPF`, ~1-2 CPU/tick on their own) are gated on `!MIN_CPU` at all
  three execution sites as well.

Defence was deliberately left alone: `defenser`, the combat teams and the outer defenders
(`outerHarvestDefenser` is not in the table and therefore always allowed) keep running even in
the emergency.

### Tests
Full suite green (the change is a priority table plus three call-site guards).

## v0.78.76 — Smooth the economy passes: schedule them by room ordinal, not by random hash

The remaining bucket problem is not the average but the **variance**. Live windows read
`avg 18.5` with **37-52 of every 100 ticks over the limit** - a bimodal shape (troughs around
15, spikes around 24) that drains the bucket even though the mean is under 20. The bucket sat at
1999, flipping `MIN_CPU` on and off.

The biggest per-tick variable cost is the room economy pass (`StrategyHighLevel.exec`: spawn
planning plus task dispatch, roughly 1-3 CPU per room). It was scheduled with

    if ((Game.time + room.hashCode()) % economyInterval != 0) return;

and thirteen random hashes into a 7- or 10-tick interval cluster - some ticks run three or four
passes at once, others none. The pass is now scheduled by the room's **ordinal** in the owned
room list (`pro.economySlot`), so a tick runs at most `rooms / interval` (~2) passes and the
load spreads evenly. Special rooms and offline fixtures fall back to the old hashCode rule.

### Tests
core-profile +2 structural assertions; full suite green.

## v0.78.75 — Outer carrier bodies were sized against the hive's full capacity, so spawns idled

The oscillation behind the round-2/3/7 findings finally has a concrete mechanism. The outer
carrier spawner asked for the body like this:

    pro.getOuterHarCarrierBodyConfig(spawnRoom.getEnergyCapacityAvailable(), maxPart)

`getEnergyCapacityAvailable()` is the hive's **full** capacity (12,900), so every request was
for the maximum 50-part / ~2,500-energy body - while the hive, being drained by continuous
spawning, actually sits around 2,000-5,000. A body the hive cannot pay for is simply not
spawned, the spawn sits idle, and the fleet collapses from 15 to 1-2 and cannot climb back for
thousands of ticks. `trySpawnOuterHarKeeper` has scaled its body to the energy actually
available for a long time (`energyBudget`); the carrier path never did.

The carrier (and road-builder) body budget is now
`min(hiveCapacity, max(energyAvailable, 550))`, so a half-filled hive spawns a proportionally
smaller hauler instead of nothing. The floor keeps the body from degenerating (and v0.78.73
still refuses zero-CARRY bodies).

### Tests
core-profile +1 structural assertion; the full suite is green (the offline fixture uses the
`energyAvailable` property, so the code prefers the getter and falls back to the property).

## v0.78.74 — The defender engagement was the CPU sink (10.7 CPU/tick)

Round-5 telemetry, with no deploy in the window to confuse it, was unambiguous:

    834478 a15.3 o4   834479 a16.7 o15   <- clean steady state
    834480 a21.7 o52  834481 a27.2 o99  834482 a27.3 o50
    roles last: outerHarvestDefenser 10.72    bucket 1093 -> 291, lastError empty

So the steady state really is 15-17 CPU, and what pushes it over 20 is the **defender
engagement** - the same 9.17 figure seen earlier. While engaged, every defender ran up to six
raw `room.find()` scans per tick (allies, lairs, hostiles x3, allies again) and called
`moveTo(enemy, {range})` every tick against a **moving** target, which defeats BetterMove's path
cache (its key contains the target's coordinates) and forces a full path search per tick.

### Fixed

- one shared `FIND_MY_CREEPS` scan per room per tick (`defenseAllies`, cached on the per-tick
  room object) instead of two or three per creep;
- hostile scans go through the room's cached accessors (`getHostileCreeps` /
  `getHostileStructures`), with a `find` fallback so offline fixtures keep working;
- approach movement re-paths only every other tick (`defenseStep`). A 50-part / 17-20 MOVE body
  accrues about 2 fatigue per tile - it can only advance one tile every two ticks anyway - so
  this costs nothing in speed while halving the path searches. Flee and reaper moves use the
  same helper.

Functionality is untouched: combat decisions, healing priority and target selection still run
every tick; only redundant work was removed.

### Tests

core-profile +3 structural assertions; outer-defense.test.cjs (the pre-existing handler suite)
stays green.

## v0.78.73 — Degenerate zero-CARRY "carriers" filled the quota and deadlocked the hive

Live (W33N55, t=83446140): three creeps with role `carrier`, a completely empty task stack,
0 energy, and **no CARRY part at all**. The hive was at 406-1156 of 12,900 while the storage
held 45k, so the 2600-energy defender body and the 2500-energy outer hauler body could never be
paid for - `trySpawnOuterDefenser` called by hand produced nothing, the outer fleet sat at 2,
and `outerDefendersFull` kept the whole outer production blocked.

Why those bodies exist: when the hive is drained, `ManagerCreeps.calcBodyPart` scales the
requested ratio down to whatever energy is left, which can drop the CARRY parts entirely. The
resulting creep still carries role `carrier`, so `trySpawnCarrier` counted it:

    let carrierList = room.creeps("carrier", false);
    let carrierCnt = carrierList.length;

The room therefore believed it had enough haulers (target 2/room) and never spawned a real one,
the hive never refilled, and every expensive body stayed unaffordable - a self-closing loop
around the whole outer chain.

### Fixed
- the headcount now ignores creeps with no CARRY part, so a degenerate body cannot masquerade
  as a hauler and block replenishment;
- `spawnCarrierNow` refuses to spawn a carrier body without a CARRY part (better to skip a tick
  than to plant another quota ghost).

### Tests
core-profile +2 structural assertions for both guards.

## v0.78.72 — The task chain could recurse until the call stack blew (carryRes <-> fillHive)

Live, right after v0.78.71: `RangeError: Maximum call stack size exceeded`, 37 hits,
`averageCpu` 32.96 and the bucket fell from 3280 to **73**.

    at trySwap (超级移动优化:583)
    at Creep.moveTo (超级移动优化:1653)
    at Creep.carryRes (prototype_creep:461)
    at Creep.execLastTask (prototype_creep:248)
    at Creep.fillHive (station_hive:36)
    at Creep.execLastTask (prototype_creep:248)
    at Creep.carryRes (prototype_creep:465)
    ... repeating

`carryRes` and `fillHive` bounce tasks off each other: `fillHive` (empty store, storage has
energy) adds a storage `carryRes` and immediately executes it; `carryRes` then sees
`storeFull()` - which for a creep with **zero CARRY capacity** is trivially true
(`getFreeCapacity() <= 0`) - pops itself and executes the chain again, forever. It surfaced now
only because the storage finally had energy to hand out (the v0.78.68 gate fix); the recursion
itself was latent.

Two fixes, one general and one specific:

- `execLastTask` bounds a single tick's task-chain expansion (`TASK_EXEC_MAX_DEPTH = 10`) and
  logs when it trips. Normal chains are 2-3 deep, so this is slack; it protects every handler
  pair from the same class of mutual recursion. The counter lives on the creep object, so it
  resets every tick by construction.
- `fillHive` no longer hands a carry task to a zero-capacity creep (`getCapacity(ENERGY) == 0`
  -> pop), an assignment that could only ever bounce.

### Tests

- recent-regressions +1 behavioural: a self-recursing task handler must not overflow the stack
  (verified: without the guard it dies with `Maximum call stack size exceeded`), while a normal
  two-deep pop-and-continue chain still runs both handlers.
- core-profile +1 structural assertion for the `fillHive` capacity guard.

## v0.78.71 — Defender march fallback: centre target, no range, never goTo

v0.78.70 shipped the road-path march, but its no-route fallback called `goTo(task)` - the very
source-tile march that `outer-defense.test.cjs` forbids, because it is what wedged defenders on
the W33N55(0,18) border tile until their ttl ran out. That assertion caught it (the suite failed
on the deploy), which is exactly what it is for.

The fallback is now a centre-target `moveTo` **without a `range`**: cross-room distances are
measured with the in-room tile delta, so any positive range declares most of the spawn room
"already arrived" (the bug being fixed), while `range: 0` can only misfire on the single centre
tile.

### Tests
- `outer-defense.test.cjs` (pre-existing) and `edge-link.test.cjs` +1 both green: the march uses
  the road path with direction -1, and the no-route fallback moves toward the room centre without
  a range and never calls `goTo`.

## v0.78.70 — The defender march never left the spawn room (cross-room moveTo range is a trap)

The W33N55 outer chain stayed dead after the crash and gate fixes, and the reason turned out to
be the defence gate itself: `outerDefendersFull` blocks the **entire** outer production
(keepers, carriers, minerals) while any threatened room's defender quota is unmet — and the
defenders could never get there:

    this.moveTo(new RoomPosition(25, 25, task.roomName), { range: 20 });

The engine measures the distance to a **cross-room** target using the **in-room tile delta
only**: live, `W33N55(8,37).getRangeTo(new RoomPosition(25,25,'W34N55'))` returns **17**. So
`range: 20` declared most of the spawn room "already arrived" and the defenders never moved —
three of them sat in W33N55 for 287 / 1319 / 1469 ticks with a 0% travel record. No defender
arrives -> the quota stays unmet -> no keeper/carrier dispatch -> no vision of the outer rooms
-> exactly the same state next tick. A self-closing loop that also explains the exploding
ground piles (36k across the six mines).

They now march along the **outer road path**, exactly like the haulers do
(`moveOuterCarrierOnRoad(creep, task, data, -1)`), with a centre-target march as the fallback when no
route is cached (see v0.78.71 for why that fallback may not use `goTo`). The direction is taken from live data rather than guessed: for all six
stations the path's **last** point is the home end (`W33N55 21,33`) while index 0 sits beside
the mine container, so travelling to the mine is index-decreasing = direction **-1** — the same
direction `harvestEnergyOuterCarry` uses when it is outside the mine room.

### Tests

edge-link +1: the march must call the road-path helper with direction -1 and must not fall back
to a cross-room `moveTo`; without cached route data it falls back to `goTo`.

## v0.78.69 — No vision is not evidence that the road is gone (and the blind turn-around threw every tick)

Follow-up to the W33N55 outage. Once the outer chain died, the hub lost vision of its outer
mines — which exposed two blind-vision bugs in the road-builder path:

1. `outerRoadComplete` treated `Game.rooms[p.roomName] === undefined` as `roadComplete = false`.
   With no vision every route therefore looked unfinished, so the bot kept spawning WORK-type
   road builders and kept them in the `keepBuilding` turn-around loop — burning exactly the
   spawn capacity the fleet needed to recover.
2. `getOuterMineTarget` falls back to a `RoomPosition` when the source container is not visible,
   and `UtilsTask.task()` requires `.pos` — which a `RoomPosition` does not have:

       TypeError: UtilsTask.task: invalid target for harvestEnergyOuterCarryRoadBuilder
           at Creep.harvestEnergyOuterCarryRoadBuilder (station_sources:1242)

   the live error on `shard3_83436569_2` (errorCount 6), thrown every tick so that builder was
   frozen.

### Fixed

- `outerRoadComplete` keeps the previous verdict while blind (`undefined` -> complete): only
  *seeing* a missing or decayed road is evidence. The 10-tick cache still bounds the cost.
- the turn-around builds its task through `taskOutView(containerId, roomName, x, y, ...)` when
  the target is a bare position, so the creep keeps walking the cached road and re-resolves the
  real object as soon as it has vision again.
- `if (!target || this.pos.isNearTo(target) ...)` — `lastTaskObj()` returns `undefined` when the
  destination room is not visible, and `isNearTo(undefined)` throws.

### Tests

- edge-link +4: no vision with no prior verdict counts as complete, the previous verdict is kept
  both ways, and a visible missing road is still incomplete. Verified to fail against the
  un-fixed module.
- core-profile +2 structural assertions covering the two crash guards.

## v0.78.68 — The energy gate must count the terminal, or it locks itself out

Immediately after v0.78.67 removed the crash, the outer chain stayed dead for a second, purely
structural reason: W33N55's **storage was 0 while its terminal held 98k** (energy other rooms
had sent as a rescue), and

    outerMineStarvesSpawnRoom:  disposable = storageEnergy - deficit  <  30000

so the gate that is supposed to protect the spawn room's last energy instead blocked every
outer carrier forever: no haulers -> no outer income -> the storage never comes back. Nothing
was moving the terminal energy down, either, because carriers only withdraw from the terminal
in the `HiveNeedToFill(room)` branch of `carrierManager` - and W33N55's hive was full
(12900/12900), so the 98k just sat there.

`disposableEnergy` is now `storage + max(0, terminal - OUTER_TERMINAL_RESERVE)`, where the
50k reserve is the same market reserve `carryEnergyAuto` already honours. The gate still
protects a genuinely poor room (storage 0 + terminal 49k still counts as starving), but a room
whose energy merely happens to be parked in the terminal can feed the outer chain again.

Live: the room was also given a manual nudge (one free carrier tasked with
`fillAllMainRoomStorage` + `carryEnergyAuto {allowStorage:true}`) so the storage starts
climbing while the fix is deployed.

### Tests

edge-link +6: storage 0 with a 98k terminal is not starving; storage 0 with a 49k terminal is;
10k storage + 20k spendable terminal just clears the 30k bar; no terminal falls back to
storage-only; the keeper threshold (20k) counts the terminal too; a room that is not ours is
starving.

## v0.78.67 — The congestion breaker crashed on its first trip and silently killed a spawn room's whole outer strategy

Live symptom (2026-10-04, W33N55): `outerHarvestEnergyCarrier: 0` (it had been 8), three spawns
idle, W33N55's storage drained to **0**, and `Memory.codeHealth.lastError` =
`TypeError: Cannot set properties of undefined (setting 'W34N55')` at
`strategy_outerHarvest.exec`.

Root cause, one line:

    if (Memory.outerPaused && Memory.outerPaused[targetRoomName] > Game.time) continue;
    if (stuckCnt >= OUTER_CONGESTION_PAUSE_CNT) {
        Memory.outerPaused[targetRoomName] = Game.time + OUTER_CONGESTION_PAUSE_TICKS;   // <- crash

The read was guarded, the write was not - and `Memory.outerPaused` is only ever created by that
very write, so the breaker could never fire even once. `HelperError.catchError` swallowed the
exception (no failed tick), but `exec` had already aborted: from then on that spawn room's outer
strategy threw every 6 ticks, so keepers, carriers and defenders were never dispatched again.

What triggered it: four defenders jammed in the spawn room (each burning ~2.3 CPU re-pathing
around the others, i.e. 9.17 CPU/tick for the role). The breach then killed the haulers, so no
outer energy arrived, so the storage emptied, and `outerMineStarvesSpawnRoom` (storage - deficit
< 30000) locked the outer chain out - a loop that closes itself and stays closed.

Fixed by creating the map before writing. Live recovery: `Memory.outerPaused` initialised, the
four jammed creeps executed, and at the same moment the bucket crossed 2000 so `MIN_CPU` lifted
(workers/upgraders resume, and the W33N55 edge link had already been built by them).

### Tests

- edge-link +1 behavioural case reproducing the production error: with `Memory.outerPaused`
  deleted and four stuck creeps, `exec` must not throw, must execute the jammed creeps and must
  really write the pause. Verified against the un-fixed module - it fails with the exact live
  message `Cannot set properties of undefined (setting 'W34N55')`.
- core-profile +1 structural assertion that the write is preceded by the map's creation.

## v0.78.66 — The home-mining throttle leaked through a transient condition (and queued 3000 ticks of spawns)

v0.78.64's throttle used `HiveNeedToFill(room)` as one of its conditions. That condition is
**transient** - it goes true whenever the spawn/extensions are short - so a single flip let
all 20 throttled stations hand a keeper to the spawn **at the same time** (each body is ~150
ticks of spawn time, i.e. a **3000-tick spawn queue**). The live check caught it: keepers went
9 -> 27 while the outer carrier fleet starved down to 9 against a demand of 12-13, because the
spawns were busy building keepers nobody needed.

Neither transient condition is a reason to mine:

- the hive's shortfall is filled by carriers **from the storage**, and the emergency
  `HiveNeedToFill` branches in `trySpawnCarrier` still spawn those carriers;
- construction sites likewise draw from the storage, which by definition holds 200k+.

The throttle is now one hard condition (storage above the threshold) plus:

- **hysteresis** (`room.memory.miningPaused`): once paused, mining resumes only below 75% of
  the threshold, so a room sitting near the line cannot flap - and every flap used to cost a
  fresh 1350-energy keeper;
- **a safety valve**: a room with no carriers at all is never paused (its hive can only be
  rescued by its own mining).

### Tests

edge-link section 15 rewritten: a construction site no longer un-pauses the room, a
carrierless room is never paused, the pause sticks through a dip to 160k and releases at
140k, and the spawn-suppression + resume wiring still holds.

## v0.78.65 — Power creeps run every other tick, and the movement cache is not force-cleared every 301 ticks

Follow-up to v0.78.64 ("reduce the load, get the average under 20"). The bot's own CPU
telemetry (`Memory.cpuTelemetry` / `cpuModuleTelemetry`, readable for free over the REST API)
showed exactly where the remaining CPU goes and why the bucket stays empty:

    recent 100-tick windows   average 18.1-18.9 CPU - already under 20 -
                              but 20-55 of every 100 ticks are OVER the limit
    phases                    unitTasks 11.08 (max 34.72), rooms 5.77 (max 155.68 =
                              the post-deploy bootstrap refresh), init 0.69, registration 0.37

The bucket gains +1 per tick and loses the overage of every over-limit tick, so an 18.6
average with ~20 ticks at ~25 CPU is exactly break-even. Two concrete spike sources:

- **`power:OPF` = 1.04 CPU/tick for 12 power creeps.** `StrategyFactoryPowerCreep.exec()`
  already throttles itself to every 3rd tick, but the creeps' own task handlers ran *every*
  tick - including straight through the `bucket <= 40` emergency path, which deliberately
  skips normal creeps. Their tasks spend nearly all their time waiting on skill cooldowns
  (`PWR_OPERATE_FACTORY` is 800 ticks), so they now execute and register every other tick
  (`POWER_CREEP_TICK_INTERVAL = 2` + `shouldRunPowerCreeps()`), saving ~0.5 CPU/tick. A
  structural test asserts that **every** power creep execution site goes through the guard.
- **`MOVEMENT_CACHE_REFRESH_INTERVAL` 301 -> 1201.** `BetterMove.deletePathInRoom()` deletes
  the room's cost matrix *and every cached path crossing that room*, i.e. every creep in the
  room re-paths on the next tick (10-30 CPU at once), and with 14 rooms one room fired it
  every ~21 ticks. The movement module already expires unused paths after 3000 ticks and
  cleans its cost matrices on a timer, so 301 was 10x more aggressive than the underlying
  policy. 1201 cuts the spike frequency 4x; a move into a newly-blocked tile still fails and
  re-evaluates on the spot.

### Tests

`test/core-profile.test.cjs` +3: the power creep interval constant and guard function exist,
no unguarded `runEach(objects.powerCreeps...)` site remains, and the movement cache interval
is 1201.

## v0.78.64 — Home mining pauses while the energy is already piling up (CPU relief)

User 10-04: reduce the load, get the average CPU back under 20. Before this change:
`averageCpu` 20.7-24.1, bucket 47-207, and on a profiled tick the **creep phase alone**
(`unitTasks`) measured **26 CPU** against a 20 CPU limit, so ticks were being truncated.
`MIN_CPU` was therefore on (workers/upgraders frozen), which is why the W33N55 edge-link
site had sat at 0/5000 for 20k ticks and construction/upgrading were dead.

Where the CPU actually went (runtime instrumentation earlier this session): keeper
0.137 CPU/call x31, outer carriers ~0.28 x17, home carriers ~0.1 x36, defenders 0.17 x3.
Two whole fleets were doing nothing:

    home carriers  36 spawns, **23 of them with no task at all**, every room `hive0`
    home keepers   26 (2/room), while the empire held 8.8M energy in storage
                   (288k-1501k per room) and every room was `hive0`

### Changed

- **`HOME_MINING_PAUSE_ENERGY` (200000) + `StationSources.homeMiningPaused(room)`**: a *home*
  room's own sources stop being refilled while (a) storage holds more than the threshold,
  (b) the hive does not need filling, and (c) the room has no construction site. Existing
  keepers retire naturally (each one is 0.137 CPU/tick); mining resumes automatically on the
  next pass once the storage drops, the hive is short, or a site appears. Outer keepers are
  never touched - they are the income. `Memory.marketSettings.homeMiningPauseEnergy = 0`
  disables the throttle, any positive value retunes the threshold.
- **RCL8 `carrierTarget` 4-5 -> 2** (+1 when the room has fewer than 4 links, +2 while the
  hive needs filling, so the emergency top-up branches still work). The fleet declines by
  attrition; nothing is recycled or killed.
- `Memory.marketSettings.outerCarrierMax = 13` set live (measured aggregate demand 408
  CARRY parts = 12-13 haulers): the outer fleet declines 17 -> 13 by attrition.

### Expected relief

-24 home keepers (~3.3 CPU) -10 home carriers (~1.2) -4 outer carriers (~1.1) = **~5.6 CPU**,
so the average should land around 15-17 even after `MIN_CPU` lifts and workers/upgraders
resume - which is what unblocks the edge link.

### Tests

`test/edge-link.test.cjs` +8: the throttle triggers only with storage above the threshold, a
full hive and no sites; it stays off below the threshold, with a site, or when the hive needs
filling; the Memory knob disables it and can retune the threshold; no storage means no pause;
and end-to-end `trySpawnOuterHarKeeper` spawns nothing for a home room while throttled, then
resumes on the next pass once the storage drops.

## v0.78.63 — A stored post is stable, but an *empty* lair group still gets covered

v0.78.62 made the post sticky and was deployed; the live room immediately showed the hole in
it. W34N55 had two defenders left, both recorded on group 0, and group 1's defender had just
died - under the old "move to the emptiest" rule one of them would have walked over at once,
but with posts now sticky **group 1 (two lairs) stayed uncovered**.

The two goals are not in conflict, they just need different thresholds:

- **stable**: nobody chases the "least loaded" group any more, so a 2/1 split never trades
  places (that was the churn v0.78.62 removed);
- **covered**: a defender may leave its post only when (a) its own group still has someone
  else in it (`cnt[g] > 0`, so leaving cannot empty it) **and** (b) some other group has
  **zero** defenders. Then it fills that empty group and the new post is written back.

Deliberately narrow: it fills *empty* groups, never "less crowded" ones.

### Tests

`test/edge-link.test.cjs` +3 cases: a 2/1 split with both groups manned leaves everyone where
they are; with both defenders recorded on group 0 and group 1 empty, exactly one moves (and
its `defenseLairIds` is rewritten), while the second stays because its group would otherwise
be empty.

## v0.78.62 — A defender is now born with its post written down, and the successor inherits it

User 10-04: "接替的爬没有储存目标信息，分工不够明确" - the replacement creep stores no target,
so the division of labour is not clear. That was literal: `trySpawnOuterDefenser` gave every
defender the memory `{role, roomName, tasks}` and nothing about **which lairs it owns**.

### What was actually wrong (all three)

1. **The successor did not take over the post.** `outerDefensePosts` derived
   `creep.memory.defenseGroup` at runtime with "count defenders per group, move to the
   emptiest". A replacement cut loose from the creep it replaced could join the *other*
   group - so when the old defender died, the group it had been covering could be empty
   while the successor stood on the wrong lairs.
2. **Posts could swap.** Because the rule re-evaluated every tick, a defender whose group
   became the more crowded one simply moved over. Two defenders can trade posts that way.
3. **The record of who guards what was wrong.** Every defender's task pointed at the room's
   **first** station (`_.values(...).find(e => e && e.id)`), so in a room with three
   defenders over two groups, `registerStationSourcesDefenseOutRoom` filed all of them under
   the same station in `stationSources[*].defenseCreeps`.

### Fixed

- **`defenseGroupKey(lairs)`** - the post is identified by its **lair ids** (sorted, joined
  with `|`), not by the group index: when lairs are destroyed/rebuilt the grouping is
  recomputed and indices change meaning, ids do not.
- **`outerDefenseAssignmentForSpawn(harRoom, front, replacingFront)`** - decides the post
  *before* the creep exists: a replacement **inherits** the post of the creep it replaces
  (by key, falling back to the group index for pre-deploy creeps), a top-up takes the
  least-populated group. Empty when there is no vision or no lairs, in which case runtime
  assignment fills it in as before.
- **`defenseGroupStation(room, groupLairs)`** + `generatorOuterHarDefenseTask(data, ops)` -
  the task now carries `defenseGroup` / `defenseLairIds`, and its target station is the one
  **nearest that group of lairs** rather than the room's first station. So the task is the
  creep's actual orders: "guard these two lairs, and you belong to this mine's record".
- The assignment is written to `creep.memory` on the spawn tick (a just-spawned creep is
  already in `Game.creeps`), and `outerDefensePosts` now **trusts the stored post**: a creep
  whose `defenseLairIds` still exists keeps that group and never chases the emptiest one.
  Only creeps with no stored post at all (pre-deploy memory) get a single balancing pass,
  and a post whose lairs are gone falls back to the group index and rewrites the key.

Result: when the old defender expires, its successor is already standing on the same pair
of lairs, the other group stays covered, and posts stop trading places.

### Tests

`test/edge-link.test.cjs` +9 cases: the post key is order-independent; the station is the
one nearest the group; a replacement inherits the post by key (and by group index for old
memory); a top-up takes the emptiest group; no vision / no lairs leaves it empty; an
assigned creep does **not** move to an emptier group; an unassigned creep is balanced once
and has the post written down; a stale key falls back and is rewritten; and end-to-end
`trySpawnOuterDefenser` fills the task target with the group's own station (`sEast`, while
`data` was `sWest`), carries the post in the task, and writes it into the new creep's memory
while still setting `hasSendSpawn` on the old one.

## v0.78.61 — The hauler cap is a runaway guard at 3 per mine, not the demand itself

v0.78.60 sized the cap as `mines * 2` (= 12 for W33N55) from an estimate. Live numbers say
the estimate was low, so the cap was truncating the fleet and leaving one station at 44%.

Measured demand, per station (`effPathTime * 2 * energyPerTick / 50`, replicated in the
console), all six stations at once:

    W34N55  3,17  path  85  len  76  ept 20.0  need 68 CARRY   have 66  (2 haulers)
    W34N55 32,32  path  52  len  45  ept 20.0  need 42 CARRY   have 64  (2)
    W34N55 10,33  path  74  len  68  ept 20.0  need 60 CARRY   have 66  (2)
    W35N55 41,10  path 106  len  88  ept 20.0  need 85 CARRY   have 98  (3)
    W35N55  4,15  path 149  len 125  ept 13.5  need 81 CARRY   have 64  (2)
    W35N55 37,41  path 124  len 104  ept 14.3  need 72 CARRY   have 32  (1)  <- short

Total 408 CARRY parts = ~12-13 haulers of real need, but the formula rounds *up* to a whole
carrier whenever any residual remains, so its steady state is 16 (each station keeps one
extra for a residual of a few parts). A cap of 12 was therefore below the formula and the
fleet sat exactly on it with (37,41) starved - and (37,41) is the station whose pile kept
growing.

### Fixed

- Default cap is now `max(4, mines * 3)` = 18 for six mines. It no longer binds the
  formula's ~16, it only stops the congestion feedback (whose demand side is already
  clamped by the path-length x1.2 factor). `Memory.marketSettings.outerCarrierMax` still
  overrides.

### Measured cost (runtime instrumentation, 47-tick window, 13-14 haulers)

    keeper (harvestEnergyKeeper x32)      3.28 CPU/tick   24.0 calls/tick
    roadBuilder (outer, WORK)             1.97 CPU/tick    7.6 calls/tick
    outerCarry (outer, plain)             1.69 CPU/tick    5.9 calls/tick
    defense                               0.50 CPU/tick    3.0 calls/tick
    outerRoadComplete                     0.05 CPU/tick    7.6 calls/tick
    nearestOuterRoadSite                  0.15 CPU/tick    4.8 calls/tick
    outerCarryNearbyDrop (v0.78.58)       0.01 CPU/tick    1.5 calls/tick

So the whole outer hauler chain is ~3.9 CPU/tick, of which the v0.78.58 drop pickup is
noise (0.013) - the fleet size is what costs. Settled `Memory.codeHealth.averageCpu` with
12 haulers was 17.9, so the formula's ~16 should land near 19. If the bucket ever drains,
`Memory.marketSettings.outerCarrierMax` is the one-line throttle.

### Tests

The fleet-cap cases now expect 18 for six mines (floor 4 unchanged, the Memory knob still
overrides, and the functional backfill case is unaffected).

## v0.78.60 — The outer hauler cap is sized from the number of mines, not a fixed 8

While verifying v0.78.58 the W35N55 piles kept growing even though the pickup fix was live.
The reason was upstream of the pickup code: **two of its three stations had no hauler at
all**.

    W34N55 3,17  pathTime  85  live 3   dead 0
    W34N55 32,32 pathTime  45  live 2   dead 0
    W34N55 10,33 pathTime  78  live 1   dead 0
    W35N55 41,10 pathTime 104  live 1   dead 0     <- replacement still spawning
    W35N55 4,15  pathTime 149  live 0   dead 1     <- container full, ground 6261
    W35N55 37,41 pathTime 124  live 0   dead 1     <- container full, ground 4758

`trySpawnOuterHarCarrier` returned early when `roomCarriers.length >= carrierMax`, with the
default `carrierMax` a hard-coded 8 (the comment sizes it as "3 mines x 2"). The count is
**per spawn room**, and W33N55 is the home of six mines (three in W34N55, three in
W35N55) - the demand formula asks for ~9.5 carriers (2.34/1.63/1.96 for W35N55 alone,
because its round trips are 250-300 ticks). At a fleet of 7-8 the two W35N55 stations that
lost their haulers could never be backfilled: first-come-first-served, and the first six
never die at the same time. That is why those two containers stayed full and their ground
piles reached 6000+.

### Fixed

- **`outerCarrierFleetCap(spawnRoom)`**: `Memory.marketSettings.outerCarrierMax` still wins
  when set; otherwise the cap is `max(4, mines * 2)`, where a "mine" is a station whose
  cached route lists this room (same prefilter as `outerRouteUnion`, counted once per tick
  on the room object). Six mines -> 12. The demand formula remains the real bound; this is
  only the safety net that stops the congestion feedback loop the old constant existed for.
- The spawn gate now uses it, so a station with zero live haulers can be refilled while the
  fleet is still under the sized cap.

### Tests

`test/edge-link.test.cjs` +5 cases: no routes -> floor of 4; six mines -> 12; a route whose
home is another room does not count; the Memory knob still overrides the formula; and a
functional case where the fleet is at 8 (the old cap, so the old code returned early) with a
station whose `carryCreeps` are all dead must spawn a replacement.

## v0.78.59 — The T3 invader-squad defender is recycled once the squad is dead

The squad body (`{TOUGH:2, RANGED_ATTACK:22, HEAL:6, MOVE:20}`) costs 7010 energy plus
~900 units of T3 compounds, and it is only ever spawned because >= 2 Invader creeps were
seen. Once they are dead the creep has nothing left to do: it patrolled the lairs until it
expired at 1500 ticks, taking the compounds with it (the pair from v0.78.58's report,
`shard3_83402855_1` / `shard3_83402885_2`, both died of old age). User 10-04: bring it home
and either unboost it or recycle it next to the spawn.

### Fixed

- **`squadDefenderShouldRecycle(creep, task)`** is consulted as the first line of
  `Creep.prototype.outerDefense`. It fires when the creep has boosted parts, is **inside its
  target room**, and has seen no `Invader` creep for `OUTER_DEFENSE_RECYCLE_QUIET` (150)
  ticks. `creep.memory.invaderLastSeen` is refreshed on every sighting and seeded on
  arrival, so a room cleared by the *other* defender also starts the clock, and a room with
  a spawning invaderCore never triggers (the counter keeps being refreshed). While the
  creep is still marching there is no verdict at all - no mid-route U-turns.
- The trigger swaps the task stack to `recycleCreep` (the existing handler walks back to
  the main room, and, if `ticksToLive < 700`, unboosts at a lab first). No new movement or
  recycle code.

### Why recycle beats unboost here

The engine refunds on a **lifetime-scaled** basis (`_die(creep, 1.0)`,
`dropRate = ticksToLive / 1500`, `src/processor/intents/creeps/_die.js`): each boosted part
returns `LAB_BOOST_MINERAL (30) * ttl/1500` compounds **plus** the body part energy. A
defender that just won a fight has ttl ~1300-1400, i.e. 26-28 compounds per part, and
recycling also returns the 7010-energy body.

`StructureLab.unboostCreep` returns a flat `LAB_UNBOOST_MINERAL = 15` per part (verified
in game) and drops it on the ground for a hauler to collect, and it puts that lab on
cooldown for `sum(parts * REACTION_TIME * 15/5)` ticks - ~4000-6000 ticks for 30 parts of
T3 (REACTION_TIME 60-150). So for a young creep, recycling recovers about twice the
compounds, recovers the body, and leaves the labs alone. The unboost path still exists for
old creeps (ttl < 700, where 15 > 30 * ttl/1500), which is exactly what
`Creep.prototype.recycleCreep` already does.

### Tests

`test/edge-link.test.cjs` +8 cases: an unboosted defender never recycles, invaders present
block it and refresh the timer, the 150-tick quiet window is respected, arrival with no
record starts the clock, a long-quiet T3 defender returns true, marching (not in the target
room) is never judged, and the `outerDefense` wiring replaces the stack with `recycleCreep`
and executes it immediately - while the stack is left alone when the condition is not met.

## v0.78.58 — Outer haulers collect the container-tile pile, fill up, and the road never goes bare

Four live reports from W33N55 / W34N55 / W35N55, plus the T3 spend on an invader squad.

### 1. The energy that falls on the container tile was invisible

`harvestEnergyOuterKeeper` parks a keeper **on** the container and harvests the source next
to it. The engine's `harvest` puts the yield into the creep's store and drops the excess
(`engine/src/processor/intents/creeps/harvest.js`) - and when the creep is standing on a
container that container takes it first, so the overflow only hits the ground once the
container is **full**. Live, right now:

```
W35N55 (36,40)  container 2000/2000  ground 6261
W35N55 ( 5,16)  container 1130/2000  ground 4758
W35N55 (42,11)  container 2000/2000  ground  719
W34N55 (42,15)  ground 1605   (mineral container still a site)
```

The carrier could not see any of it: the pickup branch used `this.pos.lookFor(LOOK_ENERGY)`,
i.e. **its own tile only**, and the keeper permanently occupies the container tile, so the
carrier is always one tile away. The drop pile grew while the lane's throughput was already
short.

- `outerCarryNearbyDrop(creep)` looks in **range 1** (the engine's `pickup` accepts
  `|dx| <= 1 && |dy| <= 1` - verified in `engine/.../creeps/pickup.js`), picks the biggest
  stack, and runs every tick while the carrier has free capacity. Same order as Overmind's
  hauler (`src/overlords/situational/hauler.ts`: "Pick up drops first", then withdraw).
- The route sweep now also runs every tick (was `ticksToLive % 4`) and its threshold went
  from 50 to 500 (`OUTER_CARRY_DROP_PICK`): a big pile is worth a detour, a small one is
  not. Sub-500 piles next to the container are still taken unconditionally.

### 2. "1700 capacity, only 1300 delivered"

Departure only required **half** a load, and a single `withdraw` can only take what the
container holds at that instant - so "the container had 1300" became "this trip carries
1300". The fixed cost of a trip (150+ ticks of travel plus the home-room unload) is
identical either way; the missing 400 is pure loss, and the mine's 13.3-20 energy/tick
keeps arriving while the carrier waits, so waiting is always the better trade.

- The carrier now stays until its store is **full**. Two bounded escapes keep it from ever
  wedging: with the mine still producing (container has energy, or a keeper is alive) the
  wait caps at `OUTER_CARRY_FILL_WAIT` (150 - more than the ~85-128 ticks needed to fill
  1700 from empty); with the mine genuinely dry (no keeper, empty container) it caps at the
  existing `OUTER_CARRY_DRY_WAIT` (60).

### 3. Towers did not heal creeps that came home injured from the outer mines

v0.78.38 gated the injured-creep scan on "this room has seen a hostile within 400 ticks".
That premise is wrong: **every outer fight happens in the outer room**, so the home room's
`lastHostileTimeMap` is never armed and a keeper / defender / hauler limping home was never
healed (the commit's "a creep that limps home after remote combat still gets healed" claim
did not hold).

- `ManagerCreeps.init` already walks every `Game.creeps` each tick; it now also records
  `Game._injuredRoomTick[roomName] = Game.time` when one of our creeps is below full hits
  and we can see its room. One `hits` comparison, and the signal is independent of where
  the damage came from.
- `StationTower.exec` scans when that mark is set for its room, in addition to the existing
  400-tick hostile window. A peaceful room with nobody hurt still does **zero** room-wide
  finds, so the CPU win from v0.78.38 is preserved.

### 4. Two identical T3-boosted defenders for one invader squad

Live: W35N55 ran `shard3_83402855_1` and `shard3_83402885_2` - the same 50-part
`{TOUGH:2, RANGED_ATTACK:22, HEAL:6, MOVE:20}` squad body, 30 boosted parts each
(~900 units of T3 compounds per creep). `getOuterHarDefenseBodyConfig` swaps to that T3
body for an invader **kiting squad** (>= 2 Invader creeps), where one creep already does
880 dps + 288 heal behind XGHO2; the second was only a second copy of the same compound
bill. It was spawned because `outerDefenseQuota` returned the baseline 2.

- `outerDefenseQuota(room)` now returns **1** when >= 2 Invader creeps are visible. It is
  the quota (not the spawn call) that has to carry the rule: the same number feeds
  `StrategyOuterHarvest.outerDefendersFull`, so capping only at the spawn site would leave
  the production gate waiting for a second defender that is never sent.

### 5. Why a route tile can show up with no road at all

Reported as "W34N55 (34,29) has no road". At check time it *does* - a road at 4800/5000
hits, the newest tile on the corridor (its neighbours on the same trunk sit at 2100-2600).
Two independent defects could leave it (or any route tile) bare, and both are fixed.

**5a. Outer-road maintenance was sitting behind the carrier spawn gate.** The route
recompute, `placeOuterRoadSites`, `cleanupOuterRoadSites` and `ensureOuterEdgeLink` all
live inside `trySpawnOuterHarCarrier`'s per-station loop - *after* two early returns
(`outerMineStarvesSpawnRoom` and `roomCarriers.length >= outerCarrierMax`). So the moment
the carrier count reached its cap of 8, **every** piece of outer-road maintenance stopped:

    live: 10 carriers in W33N55           -> maintenance block never reached
    route W34N55 src(32,32) recomputed at 83403755 -> (34,29) becomes a waypoint
    ... but placeOuterRoadSites never ran again, so no site was ever placed there

That is exactly the "no road on a route tile" window - the route had moved onto the tile
and nothing was filling it in. The same stall explains the pile-up of decayed roads (min
hits 1000-2600 across five of six routes) and the half-finished edge-link site: at
tick 83404325 the stale site at W33N55 (2,22) was removed and (5,22) selected (its junk
road destroyed), but the room's carrier count crossed 8 in the same stretch, so the
follow-up `createConstructionSite(5,22)` never ran.

- The maintenance loop now runs **unconditionally** (vision aside), before the starve and
  cap gates; only the *spawn* work is gated. Maintenance is idempotent and cheap (each
  station is throttled to one pass per 100 ticks), so this costs almost nothing and can
  never be blocked by "we have enough haulers".

**5b. `outerRoadComplete` only asked whether a road exists.** After the initial build
nothing repaired the surface: it decayed 1 hit/tick until the tile reached zero, and only
then did the completeness check fail, spawn WORK carriers and place a site. Rebuilding a
tile from zero costs 5000 progress where repairing it back from 50% costs ~250 energy
(`REPAIR_COST = 0.1`).

- `outerRoadComplete` now treats a road below `OUTER_ROAD_KEEP_HITS` (50%, i.e. 2500 hits,
  ~2500 ticks of headroom) as incomplete, so the existing keep-building loop tops it up
  long before it can disappear.

**5c. An orphaned edge-link site was pinned to a route tile.** Live, W33N55 had a link
site at (2,22) while the recorded position was already (5,22) - the `site.remove()` and the
re-selection were split across two ticks by the cap stall above, leaving the old site
behind. `placeOuterRoadSites` skips any tile that already carries a site, so the road at
(2,22) could never be built, `outerRoadComplete` stayed false forever and builders would
have been topped up forever to work on a tile that can never be filled.

- `pruneStaleEdgeLinkSites(room, keepPos)` removes link construction sites that are
  neither in the room's blueprint (`structMap.link`) nor at the recorded edge-link
  position. A non-blueprint link site can only have been created by
  `ensureOuterEdgeLink`, so this cannot touch the planner's work; it no-ops entirely when
  no position is recorded (better to miss one than to delete a good site).

### Tests

`test/edge-link.test.cjs` +8 carrier cases (pile on the container tile is picked at range 1;
a 120 stack is not chased; 1300/1700 with a live mine must not leave; full leaves at once;
dry mine leaves only after the bounded wait; keeper-alive-but-empty keeps waiting a little
longer), a road-health case (5000 and 2500 pass, 2499 fails, no road fails), a
maintenance-decoupling case (with 9 carriers and a starving spawn room, `ensureOuterRoadPath`
/ `placeOuterRoadSites` / `cleanupOuterRoadSites` / `ensureOuterEdgeLink` must all still run
while nothing is spawned) and a prune case (orphan removed, recorded site kept, blueprint
site untouched).
`test/recent-regressions.test.cjs` +3 tower cases: injured with the new room mark heals,
the 400-tick hostile window still heals, and a quiet room with nobody hurt does not scan.
`test/edge-link.test.cjs` also asserts the invader-squad quota is 1 (2 and 5 Invader creeps)
while 1 Invader and keeper rooms keep the old numbers, and that a squad room with one
defender already in service spawns nothing further.

## v0.78.57 — The edge link is re-checked when the outer routes are recomputed

Live symptom: the W33N55 edge link site sat at 0/5000 on **(4,22)** - a tile that, by the
time anybody looked, was **on** an outer route. A link is not walkable, so that site was
going to be a plug in the middle of the outer lane.

### Root cause

The placement was correct when it was chosen (v0.78.53): (4,22) was a junk road, covered all
six routes and was not on any of them. But the route cache is rebuilt **at most every 1000
ticks** (`OUTER_ROAD_PATH_TTL`, `ensureOuterRoadPath`), and a recomputed route may run
anywhere - nothing was re-checking the recorded position afterwards. `sc.edgeLinkPos` was
trusted forever.

The routes did change. Live, after the recompute:

    route W34N55 src(3,17)   (0,18) (1,19) (2,20) (3,21) (4,22) (5,23) ...   <- runs through (4,22)
    route W34N55 src(32,32)  (0,25) (1,24) (2,23) (3,23) (4,23) ...          <- east along y=23
    route W34N55 src(10,33)  (0,24) (1,23) (2,23) (3,23) ...
    route W35N55 src(41,10)  (0,19) (1,20) (2,21) (3,22) ...
    route W35N55 src(4,15)   (0,18) (1,19) (2,20) (3,21) ...
    route W35N55 src(37,41)  (0,18) (1,19) (2,20) (3,21) ...

and the live candidate table is now led by the tile the user asked for:

    (2,22) cover=6 entry=1 ROAD(junk)     <- best: every route passes within range 1, closest to the gate
    (5,22) cover=6 entry=4 ROAD(junk)
    (6,22) cover=6 entry=5 free

So the fix is not "write 2:22 into Memory" - the selection code was right, the *record* had
gone stale, and the same thing would happen again ~1000 ticks later.

### Fixed

- **`outerRouteUnion(spawnRoom)`** (extracted from the selection loop): the union of the
  home-room leg of every route this room is the home of, plus the earliest index per tile.
  Cheaper than before - a raw-string room-list prefilter skips the ~30 stations of the rest
  of the empire before any coordinate is decoded.
- **`edgeLinkPosStale(spawnRoom, sc, x, y)`**: a recorded-but-not-yet-built position is
  re-validated, and only under two conditions - the link is not built yet, and at least one
  relevant route has `roadPathTick` newer than `edgeLinkPosTick`. Without those the verdict
  is `false` and nothing is decoded, so "select once" is preserved (that rule exists so the
  wrapper does not drift to a neighbouring tile once the junk road is gone).
- When it *is* stale: the old site is removed (it was holding a link slot), the record is
  cleared, and the next selection runs on the current routes. The site moves on its own.
- The link-slot check now runs **after** the recorded-position block. A stale site counted
  towards the cap, so on a room at the link limit the check would return early and the site
  could never be cleared.
- `used >= cap` / route decoding are unchanged; the stamp `edgeLinkPosTick` is written at
  selection time.

### Tests

`test/edge-link.test.cjs` +3 cases (plus a tick-stamp assertion on the existing placement
test). The negative control is the interesting pair: the same
fixture with `edgeLinkPosTick = 99990` and `roadPathTick = 99999` must reselect, while
`edgeLinkPosTick = 99999` (route not recomputed since) must keep the site. A third case
checks a route whose room list does not contain the home room is skipped by the prefilter.

## v0.78.56 — Outer carriers pick up again (a partial load used to wedge them)

Live: three carriers parked next to the W34N55 container with 10-20 energy in a 1600-1700
store, and one of them (shard3_83402075_3) shuttling back and forth indefinitely.

### Fixed

- **The pickup branch required an *empty* store.** `if (this.storeEmpty())` meant a carrier
  that already held a little energy - normal, road tombstones get looted - could never top
  up from the container, while the departure rule below required a half load. It sat at the
  container until it died. The gate is now `store.getFreeCapacity(energy) > 0`.
- **Without a keeper the carrier left with whatever it had.** The old comment said "when the
  keeper is away the container rarely fills, so take it and go", which with a dry container
  became a 10-energy shuttle between the mine and storage (the wandering carrier above).
  Both cases now wait for a half load, with one escape hatch: if the container is dry and
  the wait has lasted OUTER_CARRY_DRY_WAIT (60) ticks, the carrier leaves with what it has.

Note the wait counter is only cleared on departure: inside the same tick the engine has not
yet written a withdrawal into `this.store`, so "did I make progress" cannot be observed
there - resetting on "store is non-empty" (the first version of this fix) meant the dry-out
counter never reached its limit and the wedge came straight back.

## v0.78.55 — Outer defence strength is now a Memory knob

`StationSources.outerDefenseQuota()` honours `Memory.marketSettings.outerDefenseBase`
(default 2, clamped 1-4) before the keeper-count scaling. Setting it to 1 runs a single
defender for the whole room, which the measured Patrol budget says is feasible:

    single defender, closed loop over four lairs   168 tick / 300   (44% slack)

That figure already includes the live terrain, the 93 existing road tiles, the
post-fight slowdown (a 1424-damage fight deletes 14 of 17 MOVE parts outright, dropping
the creep to 0.18 tiles/tick until it heals on the march) and healing-while-walking.

What a single defender costs, none of which show up in that tick budget:
1. every source is keeper-occupied for roughly twice as long, and our miners stop
   working while a keeper camps next to them - this is throughput, not safety;
2. it is a single point of failure: the replacement needs 150+ ticks, and keepers farm
   the miners meanwhile;
3. when an invader squad walks in, one defender leaving to fight it leaves all four
   lairs unattended (with two, one can fight while the other holds).

The knob takes effect on the next spawn decision; existing defenders simply retire at
the end of their life, so it can be A/B tested without another deploy.

## v0.78.54 — Defence groups own their own lairs; the patrol budget is measured, not guessed

### Added

- **Group discipline** (user direction): a keeper belonging to another group's lair may
  only be engaged by that group's defender, unless the challenger is at least 20 tiles
  closer (and when the owning group has nobody alive, anyone may take it). Without this
  both defenders drift to whichever half of the room is louder - observed live: an
  invader squad pulled group 0 to (15,5) while its own lair (41,14) was counting down.
- `StationSources.hostileDefenseGroup()` maps a hostile to the group whose lair it is
  standing next to, reusing the cached path-distance pairing.

### Measured (W34N55, live terrain + the 93 existing road tiles, per-tick simulation)

The walk cost uses the engine's fatigue rules: weight 33 (A22+H11, constant - it counts
body length, not surviving parts), recovery 2 x surviving MOVE, so a tile costs
33xterrain/(2xMOVE) ticks: 1.0 on road, 1.94 on plain, 9.7 in swamp.

    single defender, full loop over all four lairs       168 tick / 300  (44% slack)
    two defenders (current quota), 2 lairs each         ~90-125 tick / 300 (60%+ slack)
    lair-to-lair legs at full health: 25 / 32 / 48 / 98 tick

Damage matters: `_recalc-body` hands out hits from the tail backwards, so a fight that
costs 1424 hit points **destroys the first 14 parts outright** - with MOVE leading that
is 14 of 17 MOVE gone, and the creep drops to 0.18 tiles/tick until healed. Healing runs
while walking (heal and move are independent intents), so it recovers about 11 ticks into
each march. That recovery is included in the 168 tick figure; earlier hand estimates that
added a separate "heal timer" (and used lair-to-lair legs only) were pessimistic.

Road option, if a wider margin is ever wanted: paving the 12 plain tiles of the
(41,14)<->(36,29) leg (the path already runs through (43,20)/(42,21)/(41,22)) makes that
leg 16 instead of 25 ticks; paving the 13 plain tiles of the west leg saves ~12. ~25 tiles
total. Note that nobody repairs roads that are neither blueprint nor on an outer route
(they decay), so any such road must be attached to a maintenance path first.

## v0.78.53 — Melee duels are decided by arithmetic, and the retreat actually retreats

Three defects in the melee defender, all found by reading the engine and confirmed by
the tick-by-tick simulator:

### Fixed

- **The "retreat to range 4 and heal" never ran.** The guard was
  `if (!this.pos.inRangeTo(em, 4))`, which is *true even when adjacent* (range 1 <= 4),
  so a hurt defender simply kept standing next to the keeper taking 400/tick against
  132/tick of self-healing (net -268/tick). It is now `getRangeTo(em.pos) < 4`.
  Overmind's own reaper has the same structure but works because it compares
  `range <= 3` against the *intended* approach range.
- **"Hug always" is not always right.** Engines facts that decide the duel:
  keepers never chase (`creeps/keepers/pretick.js` walks to its remembered source), while
  invaders do (`invaders/findAttack.js` paths to the closest enemy), and a keeper deals
  400/tick adjacent (10 ATTACK + 10 RANGED_ATTACK) but only 100/40/10 at ranges 2/3/4.
  The defender now computes the exchange from its own parts - output = 30 x ATTACK,
  sustain = 12 x HEAL, incoming = sum over hostiles within 5 of (30 x their ATTACK +
  10 x their RANGED_ATTACK) - and only hugs when `incoming < output + sustain` (792 for
  the standard body). Two keepers adjacent are 800 > 792, so it steps out instead of
  losing the race; one wounded keeper that is two ticks from dying is finished anyway
  (finisher exception, so two parked defenders cannot stalemate a room).
- The 5-tile radius for counting incoming damage (not 3) is deliberate: with 3 the creep
  steps out, sees nobody in range, steps back in, and oscillates.

### Body order (v0.78.52 follow-up)

Melee and ranged squad bodies both lead with the cheapest part so the win condition
survives: melee `[MOVE, ATTACK, HEAL]` (matches Overmind's `zerglings.sourceKeeper`,
whose `ordered: true` grouping produces `[MOVE x20, ATTACK x20, HEAL x5, MOVE x5]`),
ranged squad `[TOUGH, RANGED_ATTACK, HEAL, MOVE]` because boosted TOUGH reduction is
consumed front-to-back and a kiter cannot lose MOVE before its own damage.

Simulator: `.workbuddy/tmp/edge/keeper_fight_sim.py` (engine rules: 100 HP/part,
front-to-back destruction, 30/ATTACK, 12/HEAL, keeper ranged `[10,10,4,1]`, no boosts).
Numbers: `[A22,H11,M17]` loses a straight brawl (17 ticks, keeper survives on 1850);
`[M17,A22,H11]` wins it in 8 ticks with 3444 left.

## v0.78.52 — Melee defenders stop using their damage as the damage sponge

The body order of the melee outer defender was `[ATTACK x22, HEAL x11, MOVE x17]`.
Damage destroys body parts front to back (`engine/creeps/_recalc-body.js`), so the first
2200 points of incoming damage deleted the entire damage output while the keeper's own
attack parts sit behind 3000 HP of TOUGH + MOVE and keep firing at full rate.

Tick-by-tick simulation with the engine's rules (100 HP/part, 30/ATTACK, keeper ranged
damage `[10,10,4,1]` per distance, 12/HEAL, no boosts on either side):

    [A22,H11,M17]  straight brawl      LOSE  t=17, defender dead, keeper at 1850
    [M17,A22,H11]  straight brawl      WIN   t=8,  keeper dead, defender at 3444
    [A22,H11,M17]  retreat-and-heal    WIN   t=38, but takes ~4x as long

### Changed

- Melee defender body order is now MOVE -> ATTACK -> HEAL (part counts unchanged: the
  user's {A22,H11,M17}). MOVE is the cheapest part (50 energy) and is only needed to
  march and close in - after a successful attack the creep also steps toward its target -
  while ATTACK and HEAL are the win condition. In an 8-tick fight the MOVE parts are only
  damaged, not destroyed (a part with hits > 0 still functions), so nothing is lost.
- Same reorder for the small melee body, the nest-only body, and the enemy-scaled body.
- The ranged squad body keeps `[TOUGH, RANGED_ATTACK, HEAL, MOVE]`: boosted TOUGH damage
  reduction is consumed front-to-back so TOUGH must lead, and a kiter cannot afford to
  lose MOVE before its own damage.

Regression test locks the order (and the negative control - restoring the old order - fails
it). Simulation script: `.workbuddy/tmp/edge/keeper_fight_sim.py`.

## v0.78.51 — Edge link sits on a redundant west-side road, not on clean land

The first placement picked the westernmost *free* tile adjacent to the route every outer
source shares (W33N55 (6,22)). That premise was wrong: the west entrance carries a lot of
**redundant road** left over from earlier route generations, and the route intersection
only starts at x=6, so the search threw away the better tiles closer to the border.

Live candidate table (coverage = how many of the 6 outer routes pass within range 1):

    (4,22) cover=6 entry=3 ROAD(junk)     <- chosen
    (7,22) cover=6 entry=6 free
    (6,22) cover=6 entry=6 free           <- previous pick
    (1,21) cover=4 entry=2 ROAD(junk)
    (2,22) cover=4 entry=3 ROAD(junk)

### Changed

- Candidate tiles now come from the **union** of all route tiles (not the intersection),
  ranked by how many routes pass within range 1, then by how close to the mine entrance
  the tile sits, then by preferring a redundant road over clean terrain.
- A redundant road tile (a road that is neither a route waypoint nor blueprint road) is
  recycled: the road is destroyed to make room and the link site goes up on the next tick
  (`destroy` and `createConstructionSite` in the same tick have no guaranteed intent
  order). Live: W33N55 (4,22) road removed, `link:4,22` site created the following tick.
- The recorded position is now trusted once chosen: when it is empty, the site is created
  there instead of re-running the selection (a recycled road disappears from the ranking,
  so re-selecting would drift to a neighbouring tile).
- The stale (6,22) site was cancelled by hand (it was 62% built but strictly worse and
  would have consumed a link slot: RCL8 allows 6, of which 4 are already in use).

`test/core-profile.test.cjs` used to reject any `road.destroy()` in station_sources to
keep off-route roads decaying naturally; the assertion now allows exactly one — inside the
edge-link placement — and still fails on any bulk road maintenance.

## v0.78.50 — Outer defence reaches the numbers the room actually needs (Overmind audit)

Audited every outer-mining mechanic against Overmind's source (`SourceReaperOverlord`,
`MiningOverlord`, `CombatZerg`, `CombatTargeting`, `Movement`, `CreepSetup`) and kept the
findings that survive the engine's own maths (`screeps/engine`: movement.js, _recalc-body.js,
creeps/tick.js, keepers/pretick.js).

### Fixed

- **Defender counting never saw the defenders that mattered.** `trySpawnOuterDefenser`
  counted `spawnRoom.creeps("outerHarvestDefenser")`, i.e. only the creeps physically
  still at home: a defender standing on post in the outpost was invisible, so the room
  was judged short-staffed every 6 ticks and kept requesting replacements (live: two
  replacements 144 ticks apart, ~5300 energy each) and the TTL lead never applied to the
  defender that actually needed replacing. Counting now goes through
  `StationSources.outerDefenseAssignments()`: a per-tick global scan by
  `headTask().roomName`, so in-service and in-transit both count.

### Changed

- **Defence quota reacts to the room, not just the lair count.** Baseline stays
  `OUTER_DEFENSE_TARGET_CNT` (2, one defender per two lairs for patrol coverage), but a
  room holding more than two source keepers now asks for one defender per keeper (cap 4 =
  lairs). Fight maths: `{A22,H11,M17}` beats a keeper 1v1 (8 ticks, ~2800/5000 HP left)
  but loses 1v2 (800 incoming per tick at range 1). Live W34N55 (4 lairs) had piled up
  three keepers and killed two defenders plus four miners in one wave. The same helper
  feeds the defenders-first gate, so production waits until the quota is actually staffed.
- **Melee defenders keep contact** (`attackAndChase` from Overmind): after a successful
  adjacent attack the creep also steps toward the target, so a target that retreats the
  same tick cannot buy a free round.
- **Target choice prefers what is already bleeding** (Overmind's
  `hitsMax - hits + healPotential` score) but only inside the engagement spread — an
  unbounded chase after a wounded keeper is a regression we have paid for before.

### Verified / kept from Overmind after checking the engine

- Melee defender body order: MOVE last, boosted TOUGH first. Damage destroys parts from
  the front (`_recalc-body.js`) and boosted damage reduction is consumed front-to-back
  (`_applyDamage`), so MOVE-front (what Overmind's `ordered:true` grouping produces for
  `zerglings.sourceKeeper`) trades away the ability to disengage. Overmind's own `armored`
  pattern puts MOVE last, i.e. it is not a consistent guide.
- Fatigue is order-independent: `(non-MOVE, non-CARRY parts + loaded CARRY) x terrain`
  (road 1 / plain 2 / swamp 10), recovery `2 x MOVE` per tick. A hauler body is
  road-full-speed at 2:1 (`2*MOVE >= CARRY`) and plain-full-speed at 1:1.
- Source keepers do not chase: they walk to their remembered source every tick and shoot
  the lowest-hits creep in range, with per-part ranged damage `[10,10,4,1]` at range 1-4.
  That is why "stand at range 4 and self-heal" works and why the sustain-heavy melee body
  is kept over Overmind's faster `{A20,H5,M25}`.
- Not adopted: the `TransportRequestGroup` request pool (a logistics rewrite, no
  measurable win at this scale), `rangedMassAttack` (only reaches range 1), and
  invasion-specific pathing costs (the shared movement optimiser owns our pathing).

## v0.78.49 — Edge link: outer haulers turn around at the home border

The outer roads of both mined rooms (W34N55, W35N55 -> W33N55) converge into one shared
corridor inside the home room, so every hauler walked the whole corridor to storage and
back. A link next to that corridor lets it drop its load at the border.

### Added

- `StationSources.ensureOuterEdgeLink()` picks the free tile adjacent to the route segment
  every outer source shares, closest to the mine entrance; never on a route tile (links
  are not walkable — that would plug the single-lane road), never on an existing
  structure or site, inside the RCL8 link budget. Live pick: W33N55 (6,22). The site is
  built by the home room's ordinary build chain.
- `StationSources.outerCarryDropOff()`: the return trip targets the edge link when it
  exists, storage otherwise (same route, no detour).
- `StationCarry.transformLink` drains the edge link first (it is the chain's only 800-wide
  buffer) into the storage-side hub link, falling back to the upgrade link. Kill switch:
  `Memory.marketSettings.edgeLink === false`.

### Changed

- A link holds 800 while a hauler carries 1250+, so the delivery transfer now dumps what
  fits and then waits (bounded: only zero-progress ticks count, cap 12) for the link to
  forward it; the stack's `fillRes(storage)` layer takes whatever is left. It cannot wedge.
- The `ensureOuterEdgeLink` call is wrapped in `HelperError.catchError` so a bug in this
  optional feature cannot abort the whole outer pass.

## v0.78.48 — Restore the outer production chain

`0d55a80` declared a defenders-first spawn gate but never defined `allDefendersFull`, so
`StrategyOuterHarvest.exec` threw a ReferenceError on its `else` branch every 6 ticks.
`HelperError.catchError` swallowed it, which silently killed everything after that line:
no keepers, no haulers and no mineral chain were dispatched for any outer room (live: 0
outer carriers, 0 keepers in W34N55/W35N55) while defenders — spawned before the throw —
looked healthy.

### Fixed

- `outerDefendersFull()` implements the gate the commit intended (see v0.78.50 for the
  counting and quota details that landed with it).
- `getOuterHarCarrierBuildBodyConfig` emitted `[WORK,WORK] + 25x[CARRY,CARRY,MOVE]` = 77
  parts, past the 50-part limit, so road-building haulers could never spawn
  (`ERR_INVALID_ARGS`) and the roads had no maintainer.
- `getOuterHarCarrierBodyConfig` was still 1:1 `[CARRY,MOVE]x25` (1250 capacity) although
  the same commit advertised 2:1/1700. Both bodies are now `[CARRY,CARRY,MOVE]` groups —
  hauler 34 CARRY + 16 MOVE (1700), builder 2 WORK + 32 CARRY + 16 MOVE (50 parts) — and
  still shrink with the room's available energy.

## v0.78.47 — Ranged defenders must actually walk into range; adopt live 0.78.40

Two independent stalls, both caught on 10-02 after adopting the parallel
session's ranged-defender body:

### Fixed

- **The ranged defender never closed distance.** The engagement code called
  only `this.attack(em)` and moved on `ERR_NOT_IN_RANGE` — but the new kiting
  body has no ATTACK parts, so `attack` returns ERR_NO_BODYPART (-12) forever
  and the move never fires. Both defenders stood at the cross-room door pair
  (0,17)/(49,17) with a locked target, full HP, until ttl ran out (one died
  in place; replacements inherited the same parking spot). The attack method
  now follows the body: ranged bodies use `rangedAttack` at range 3 and close
  to it when out of range; melee bodies attack at range 1. Any non-OK result
  (including the cross-border -7) drives movement. Verified live within
  minutes: the (9,34) keeper died and the squad moved onto the last one.
- **Out-of-room travel targets the room centre** (same fix as the core
  buster): `goTo(task)` aimed at the source tile, which is exactly where the
  hostile keeper stands, so the cross-room cache collided with the in-room
  engage move.

### Adopted from the parallel session (live build 0.78.40)

Ranged core buster plan for lv2+ cores (2 TOUGH + 3 HEAL + 20 RA + 25 MOVE,
needsT3 gate), ranged kiting defender body, road-border tiles excluded from
`outerRoadComplete` (six routes were permanently "missing" 2-4 impossible
tiles), 50-part outer carriers, `Memory.stopOuterMineral` kill switch, and
observer-side `lastHostileSeen` refresh. Local + git synced to it (rebased
over its 6 commits, tests updated to the new plan shapes).

## v0.78.46 — Outer defenders: no T3 compounds, and a lead that waits for the spawn queue

### Changed

- **Outer mining defenders never consume compounds.** When a transient hostile
  crowd (an invader squad visiting while a keeper is up) pushed the computed
  body past 50 parts, the config escalated to T3 (XLHO2/XUH2O/XGHO2): ~1500
  units of compounds, 1.5M+ credits, for a threat the unboosted 50-part body
  already beats (keeper tombstones outnumber ours; the 3-invader squad died to
  two unboosted defenders). The config now scales the body to 50 parts instead;
  an extra 50-part defender costs 7010 energy — three orders of magnitude
  cheaper. Player-scale threats remain the business of the defenseHighWay
  boost system.
- **The replacement lead now includes the measured spawn-queue wait.** The old
  lead (spawn 150 + travel + 10 + overlap 60) assumed a spawn is free the tick
  the request fires; with three busy spawns the replacement queued for
  hundreds of uncounted ticks and the old defender died first. The request
  now stamps its time, a successful replacement writes the measured wait back
  into `spawnRoom.memory.defSpawnQueueWait` (max observed, capped 600, floor
  150), and the lead adds it. Overlap raised 60 → 100. W34N55: lead 310 → 500,
  replacements request at ttl 500 and are on station before the old one dies.

## v0.78.45 — The mineral container clog actually delivers this time

The outer mineral container kept filling with energy (1840 of 2000) until the
mined H tail (160) could not get out either. The earlier "clear crowded
containers" fix withdrew energy into the carrier — but the trip-home condition
counted only `store[H]`, so the energy rode the creep's back forever: withdraw
→ ERR_FULL → stand there. Cleared energy never left the room.

### Fixed

- **Anything on board counts as cargo.** `harvestMineralOuterCarry` now goes
  home whenever `store.getUsedCapacity() > 0` and unloads every carried
  resource at storage (H, the looted energy, anything else). Withdrawn energy
  actually reaches home now.
- **Clog is cleared proactively, not only at 100%.** When the container is
  over half full of energy (loot from dead keepers/invaders; while mining is
  active it competes with H for the same 2000 slots), the carrier hauls a load
  home instead of waiting for the next H batch. H keeps priority: full batch,
  or tail-clearing once the mineral runs dry.
- **The keeper stops looting into a full container** (`getFreeCapacity()`
  guard) — grabbing energy it cannot place is what wedged its 200-capacity
  store in the first place.

### Verified live

W34N55 (43,15): H tail 160 → 0 and one full 1150-energy haul reached home
within a minute of deployment; the chain then idled by design with the mineral
deposit exhausted (keeper/carrier respawn gates require `mineralAmount > 0`).

## v0.78.44 — Invader cores are invulnerable until deployed; bust them on schedule

The new [A15,M15] buster reached the core, stood adjacent, and dealt zero
damage for 20+ minutes. Instrumented, the engine's answer was definitive:
`attack` returns **ERR_INVALID_TARGET (-7) every tick** against an invader core
with `ticksToDeploy > 0`, same room, range 1, ATTACK parts alive. The old
two-crawler squad's hours of pounding only ever chipped the 100k rampart — the
core itself was untouchable the whole time. It becomes attackable (and starts
spawning invaders at lv2, every 6 ticks) when `ticksToDeploy` reaches 0.

### Changed

- **The buster squad deploys on the deploy countdown, not before.**
  `spawnCoreBuster` gates on `ticksToDeploy > CORE_BUSTER_DEPLOY_LEAD (600)`,
  which covers spawn (90 ticks) + cross-room travel (~300) + margin: the creep
  arrives right as the core becomes vulnerable. Once the core has taken any
  damage the gate no longer blocks replacements. Until then the parked buster
  is recycled instead of idling to ttl death (its 1950 energy comes home).
- **Cross-room oscillation at the border was fixed for real.** The buster
  ping-ponged W33N55(0,24)↔W34N55(49,24) every ~15 ticks for 40 minutes:
  its travel (`goTo`) and attack (`moveTo(core, {range:1})`) phases shared one
  movement-cache target, the cross-room path got reused after the border
  crossing with its index desynced, the creep stalled, and passers-by swapped
  it back and forth like an obstacle. Travel now targets the task room's
  centre (`range: 20`) — a different cache target — and the attack phase
  repaths from scratch inside the room. Locked by test.
- `attack` returns **-7, not -9, across a room border**; the handler now moves
  on any non-OK attack result.

### Test

- `test/outer-defense.test.cjs` grows real Screeps error constants (inline
  with the engine: NOT_IN_RANGE=-9, NO_BODYPART=-12, INVALID_TARGET=-7), a
  travel/attack cache-separation case, and invulnerable-core cases: -7 with
  `ticksToDeploy > 0` releases the buster; after deploy it keeps fighting.

## v0.78.43 — Outer defense: engagement rules, and a core buster that can actually finish

W34N55 kept bleeding miners around the edges of the system: defenders stood next
to invader squads without engaging, marched off to grind on the 100k-hit
invaderCore they can never kill, and the two-part [ATTACK,ATTACK,MOVE] core
buster squad crawled at 0.2 tiles/tick with no hope of out-damaging anything.

### Changed

- **Defenders never leave their posts to chew on the invaderCore any more.**
  With no live hostiles around, the old target selection fell back to the core —
  100k hits of invincible target — and both defenders walked 40+ tiles to stand
  under it for the night (one measured at the east edge `(49,18)`, its lair
  uncovered) while keepers slaughtered the miners. Core duty now belongs to the
  coreBuster squad alone; a defender's `targetId` can only ever be a live creep,
  and stale structure ids in old memory are dropped on the next tick.
- **Engagement follows threats, not just lair proximity.** Hostiles within
  `OUTER_DEFENSE_HELP_RADIUS` (8) of any of our creeps — invader squads camp
  right on the haul routes — now count as threats, and of the defenders in the
  room only the **closest one to the target** breaks off to fight; the others
  hold their lair groups. Guard-radius threats work the same way, which also
  removes the old "both defenders converge on one keeper" behavior.
- **The core buster is one big creep, not two crawlers** (user spec:
  ATTACK = MOVE = 15). 450 DPS kills the 100k-hit core in ~222 ticks of contact
  and ~400 ticks door to door, well inside one creep's lifetime — the old pair
  summed to 120 DPS and 0.2 tiles/tick on plains. A level-2+ core adds 5 HEAL
  (invaders spawn from lv2, `INVADER_CORE_CREEP_SPAWN_TIME`), and the handler
  now self-heals alongside attacking (independent intents, same tick). The
  rampart-over-core barrier rule is unchanged and regression-locked.
- **Rooms we lost vision of remember recent hostiles.** An invader squad in
  W35N55 killed every creep we had there; with no vision, `roomNeedsDefense`
  fell back to the flag name (no `invader` in it), so no defender was ever sent
  while keeper/carrier spawns kept marching into the grinder. Seeing hostiles
  now stamps `lastHostileSeen` in room memory; for `OUTER_HOSTILE_MEMORY_TICKS`
  (3000) after losing vision the room still counts as threatened — defenders
  spawn, and miner/mineral/carrier dispatch pauses until one arrives and
  restores vision. No room-specific logic anywhere.

### Test

- New `test/outer-defense.test.cjs` (VM, real module sources): coreBuster plan
  shape, rampart-before-core and self-heal, recycle on dead core; defenders
  drop structure targets, re-acquire live ones per tick, and the
  closest-defender-engages / others-hold rule; `lastHostileSeen` stamp and
  expiry. 5/5 test files green, task audit clean, live sha256 MATCH.

## v0.78.42 — Remote minerals: one container, a crew that can build it, and a way home

Remote mineral harvesting was dead end to end: **zero `harvestMineralOuterKeeper`
existed account-wide**, and W34N55's 35000 H had never been touched. Four
separate defects, each independently sufficient to stop it.

### Fixed

- **A container site was dropped on every non-wall tile around the mineral.**
  `trySpawnOuterMineralKeeper` looped over all 9 neighbours and called
  `createConstructionSite` on each one that was not a wall, with no `break`.
  W34N55 measured: 5 of the 9 tiles are wall, the centre is the mineral itself,
  so it landed **three** sites — `(42,15)`, `(43,15)`, `(43,16)` — 15000 of build
  work that nothing could finish, two of them permanently burning construction
  site quota. `ensureOuterMineralContainerSite` now picks **one** tile (skip the
  mineral tile, skip walls, prefer the tile with the most open neighbours) and
  additionally collapses any legacy duplicates on sight.
- **The "worker" sent to build it never left the home room.** When a site
  already existed the code spawned a `worker` **with an empty task list**, in the
  spawn room. A worker with no tasks just builds whatever is next to it at home;
  it never walks to the remote room. Every mineral container therefore sat at
  `0/5000` forever, and since the harvester's own spawn condition was
  `container` existing, the harvester was never spawned either. Replaced with a
  dedicated `outerMineralContainerBuilder` role.
- **`harvestMineralOuterKeeper` read the wrong Memory path and would have thrown
  every tick.** It did
  `Memory.rooms[room][StationSources.stationName][mineralId]` — but a mineral
  record lives under `StationMineral.stationName` as one flat object per room,
  not keyed by id. That lookup returns `undefined`, so the next line
  `station["container"]` is a guaranteed `TypeError`. Latent only because no
  mineral keeper ever spawned; it would have detonated the moment this chain
  started working. Now reads `stationMineral` and null-checks it.
- **`generatorOuterMineTask` filed the mineral under `stationSources`.** Its
  `regFun` was `registerStationSources`, which writes
  `stationSources[mineralId]`. `trySpawnOuterHarKeeper` iterates
  `stationSources` looking for anything with an `id`, so it would have treated
  the mineral as a mining spot and dispatched an energy keeper to harvest it.
  `regFun` is now empty; remote mineral replenishment is decided by role + task
  room instead.

### Added

- **`outerMineralContainerBuilder`** — `{WORK:16, CARRY:17, MOVE:17}`, 50 parts.
  The container is 5000 progress at 1 energy per progress, and a creep carries
  at most 850, so a single trip cannot finish it. The task
  (`buildOuterMineralContainer`) is a self-repeating loop rather than a fixed
  stack: when it runs dry it pushes one `carryRes` against the home storage,
  which pops itself on withdrawal and hands control back. Verified in game —
  it spawned, withdrew a full 850 energy, and set off for W34N55. Six trips
  finish the container; it then recycles itself instead of idling.
- **`harvestMineralOuterCarry`** — the transport link that did not exist at all.
  Nothing in the codebase carried a remote mineral home: the harvester is a
  static `{MOVE:15, WORK:30, CARRY:4}` that only fills the container, and
  `trySpawnOuterHarCarrier` walks `stationSources` and never sees
  `stationMineral`. Without this the container just fills up and the whole
  chain is pointless. A `{CARRY:25, MOVE:25}` shuttle moves 1250 per ~160 tick
  round trip (≈7.8 H/tick), about 6× faster than letting the harvester do it
  itself (200 per trip). It only spawns once a harvester is already on site, so
  it never idles in an empty room.

### Notes

- Verified after deploy: the three mineral sites collapsed to one at `(43,15)`,
  `containerSite` recorded in `Memory.rooms.W34N55.stationMineral`, the builder
  spawned with the intended body and left carrying 850 energy.
- Source `(32,32)`'s container completed during this window. That matters beyond
  minerals: `trySpawnOuterHarCarrier` is gated on `data["container"]`, and road
  sites are only laid by the road-builder carrier, so a new remote room has no
  roads at all until its first container finishes.

## v0.78.41 — Remote defence: patrol the lairs, scope the mineral record, size the keepers

### Fixed

- **Outer defenders camped on a single lair and missed the others.**
  `outerDefense` used to stand at the lair with the smallest `ticksToSpawn` and wait
  there. When a keeper came out of any of the other three lairs the defender was not
  present and the miners took hits. It now patrols the lairs in a fixed order (sorted
  by position so the route does not jitter), dwelling at each for
  `OUTER_DEFENSE_PATROL_DWELL` (90 ticks, `Memory.marketSettings.outerDefensePatrolDwell`)
  while healing itself, so all four spawn points are covered within one lap. Also:
  picking an injured ally to heal uses `findClosestByRange` instead of `findClosestByPath`
  (no pathfinding needed to choose a nearby ally), and self-healing is unconditional, so
  the defender tops up while dwelling rather than only while out of melee range.
- **`StationMineral` records now only cover rooms we actually mine.**
  The previous change kept a mineral record whenever an extractor existed, which meant an
  enemy room's extractor (seen through the observer) left a `stationMineral` entry we can
  never mine but still pay to serialise. A non-owned room now only keeps the record when
  it carries a `har` flag. Owned rooms are unchanged: extractor present → record written,
  no extractor → cleared, so `trySpawnHarKeeper` still never dispatches a mineral keeper
  for a room that cannot mine.
- **Outer keepers were too small to drain a Source Keeper source.**
  A source in a Source Keeper room holds 4000 energy and resets every 300 ticks, i.e. a
  reset rate of ~13.33 energy/tick. `outerMaxPartCnt` was 3, producing
  `{MOVE:3, WORK:6, CARRY:1}` — 6 WORK parts = 12 energy/tick, **below the reset rate**, so
  the source never drained and the keeper permanently chased regeneration. Three sources
  together only produced ~36 energy/tick while costing three keepers plus their defenders.
  Raised to 5 → `{MOVE:5, WORK:10, CARRY:2}` = 20 energy/tick, comfortably above the reset
  rate: a source drains in ~200 ticks, leaving ~100 ticks of slack. Overridable via
  `Memory.marketSettings.outerMaxPartCnt`.

### Notes

- The three outer keepers alive at deploy time keep the old body until they expire, then
  respawn at the new size. Home-room keepers are untouched (`innerMaxPartCnt`), and
  `getMineralHarvesterBodyConfig` is unchanged.

## v0.78.40 — Remote mining: harvest only high-priced minerals (H / X / L)

### Added

- **`shouldHarvestRemoteMineral` gate for remote mineral mining.** Mineral prices
  differ by more than an order of magnitude, and cheap ones (K≈15, Z≈12, U≈9) are
  not worth the spawn quota, carrier trips, and — in the sector's centre nine rooms —
  the extra defenders needed to work under Source Keepers. Only minerals at or
  above `Memory.marketSettings.minRemoteMineralPrice` (default 120) are mined,
  which selects X≈266 / H≈205 / L≈160 and skips O≈38 / K≈15 / Z≈12 / U≈8.6.
- The price is taken from the **live market floor** (lowest sell order, via the
  existing 100-tick order cache), not from `StrategyMarketPrice.getResTypeHistory`.
  That cache was badly wrong for H: it recorded 1.1 while H actually trades around
  205, which would have made the bot skip one of the most valuable minerals. The
  history value is only a fallback when a mineral has no sell orders at all.
- `StationSources.trySpawnOuterMineralKeeper` is now actually called
  (`strategy_outerHarvest` had it commented out), behind the gate above.

### Notes

- W34N55 (4 keeper lairs, Source Keepers resident, H mineral) is being brought up
  first via `har_W33N55_invader_W34N55`. The centre room W35N55 (no lairs, K
  mineral — too cheap to mine) is deferred until W34N55 is stable.

## v0.78.39 — Fix remote-mining defenders healing and stop selling low-tier commodities

### Fixed

- **Remote defenders stopped healing themselves while in melee range.**
  `outerDefense` had `heal(this)` inside the `attack(...) == ERR_NOT_IN_RANGE`
  branch. `Creep.attack()` only returns OK at range 1, so the moment the defender
  closed into melee it stopped entering that branch and **stopped healing at
  all** — while eating a Source Keeper's melee + ranged output (about 400/tick
  for the tough17/attack10/ranged_attack10/move13 keepers in the sector's centre
  nine rooms). Combined with the undersized fixed body below, defenders died on
  arrival and were replaced forever. `heal(this)` is now unconditional, and
  `rangedAttack` is only called within range 3.
- **Defender bodies no longer ignore the actual garrison.**
  `getOuterHarDefenseBodyConfig` returns body + boost requirement sized from the
  room's live hostile creeps (damage at range 2, their heal, and the toughest
  unit that heal can sustain). Falls back to the previous fixed bodies when
  there is no vision or no live hostiles, so the unobserved path is unchanged.
  When the unboosted body would not fit in 50 parts it asks for boost (heal
  first, then attack) — matching the approach already used by
  `getDefenseHighWayData`.
- **Defender rotation could spawn an extra creep every 6 ticks.**
  The guard read `if (defenser && ttl>170 && !hasSendSpawn && length>1) return;`
  — once `hasSendSpawn` was set, `!hasSendSpawn` was permanently false, so the
  condition never held and a defender was queued on every pass. Rewritten with
  an explicit reason: spawn when none exists, when the oldest is within
  `OUTER_DEFENSE_REPLACE_TTL` (250 ticks, enough for spawn + boost hauling +
  march) **and** no replacement has been requested yet, or when the standing
  count is below `OUTER_DEFENSE_TARGET_CNT` (2 for keeper/invader rooms). Plain
  remote rooms still only spawn on a confirmed hostile / lair / core.
- **Low-tier commodities are no longer sold.**
  Two separate problems, both fixed:
  - `autoSellDeposit` sold silicon / metal / biomass / mist — the level 0 base
    deposits that every higher commodity is synthesised from. Its reserve was
    only 3000, so any surplus was listed for sale; Biomass from the E41S23
    deposit room (E40S22) was sold this way. The reserve is now 100000
    (`Memory.marketSettings.baseDepositKeep`, -1 disables selling entirely):
    normal production is consumed by the factory, and it only acts as a
    blow-off valve when output hugely exceeds what the factory can take.
  - `getBestCommoditiesToSell` accepted `item.level > 0`, so level 1 and 2
    goods (for example tissue, level 2) entered the sell price table and were
    sold by the instant-deal sell path even though they are worth more when
    synthesised further up. Now gated at level >= 3
    (`Memory.marketSettings.minSellCommodityLevel`).

### Notes

- Verified in game that no Biomass sell order remains (the earlier one had already
  been filled and cleared by the zero-remaining cleanup), and the remaining orders
  are the intended high-tier / energy ones.

## v0.78.38 — Stop the tower injured-creep scan in rooms with no hostile contact

### Fixed

- **`StationTower.exec` was the largest per-room cost after the economy pass**
  (0.706 CPU/tick measured with runtime instrumentation) in a colony where every
  owned room is peaceful. On each scan tick (every 10 ticks per room) it ran two
  filtered full-room finds:
  `room.find(FIND_MY_CREEPS, {filter: hits < hitsMax})` concat the same for
  power creeps. Structures and towers cannot attack across a room boundary, so a
  creep inside an owned room can only be damaged if a hostile was in that room at
  the time - in a room that has been quiet those two finds, each building an
  options object and a closure for the engine to call back into, cannot return
  anything.
  They now run only while the room has seen a hostile within
  `PEACEFUL_HEAL_WINDOW` (400 ticks), which re-arms on any contact, so a creep
  that limps home after remote combat still gets healed and a room with hostiles
  present always scans.
  Measured with the same instrumentation before and after: 0.408 -> 0.242 mCPU
  per call (-41%), i.e. 0.706 -> 0.394 CPU/tick. Towers kept repairing
  throughout (6 towers per room with live repair targets, repair queues intact).
  Verified live that the guard is exercised rather than just always-true: at
  check time `lastHostileTimeMap` held W32N56 and E48S41, both ~90 ticks after
  real contacts, while the other eleven rooms skipped the scan.

- **Duplicate buy orders now converge at the end of the pass as well.**
  De-duplication only ran at the start of `autoBuy`, but `autoBuyLowRclEnergy` -
  the first of the creation paths - cancels an order whose remaining amount
  overshoots the current shortfall and immediately replaces it, so the replacement
  was only cleaned up at the start of the *next* pass. In between,
  `Game.market.orders` showed two energy buy orders for the same room (observed on
  E55S31, two orders with identical `createdTimestamp`). The logic is now
  `pro.convergeBuyOrders()`, run before and after the creation paths. Verified
  across 110 ticks spanning an autoBuy pass: duplicates stayed at 0.

### Investigated and deliberately not changed

- **The resource-balance terminal transfers have no in-flight accounting, but it
  is not worth fixing here.** `balanceWithOtherRoom` records nothing about goods
  already in transit, and the destination's `processRoom` recomputes its demand
  from live stock every 10 ticks, so in principle the same shortfall can be
  filled repeatedly while the first shipment is still travelling. Measured over
  225 ticks with `StructureTerminal.prototype.send` instrumented: 10 sends
  total, every gap between sends to the same destination (20/48/82 ticks) far
  exceeding the transit time (2-26 ticks), and no repeated fill of the same
  gap. The rooms are close enough that transit is shorter than the refresh
  cadence, transaction cost is essentially linear in amount, and the extra
  `ceil` rounding across 10 small sends came to roughly 5 energy per 225 ticks.
  Adding Memory-backed in-flight tracking would cost more than it saves.

### Notes

- Full per-function CPU breakdown from the same instrumentation run, for the
  next round of work: `rooms` 6.079 (of which `hl` 2.130 with a 5.78 single-call
  peak, `tower` 0.706, `resBal` 0.498, `lab` 0.477, `factory` 0.431, `obsOver`
  0.196, and about 1.64 of `ManagerRooms.exec`'s own overhead - largely the
  every-61-tick `refreshRoom`). The instrumentation itself inflates every call by
  roughly 0.005 CPU, so treat these as relative weights, not absolutes.

## v0.78.37 — Cut market fee waste, decouple lab/factory from account-wide energy

### Fixed

- **Duplicate market buy orders.** `autoBuyMineral` and `autoBuySome` tested
  "does this room already have an order" with `remainingAmount <= buyCnt`, but
  `buyCnt` is recomputed every pass. When the previous round ordered more than
  this round's gap, `remainingAmount > buyCnt` and the room was counted as having
  no order at all, so another one was created - each duplicate paying the 5%
  creation fee again, freezing more credits and competing with itself on price.
  The test is now the sum of that room's BUY remaining, independent of `buyCnt`.
- **Both of those filters omitted `e.type == ORDER_BUY`.** Our own SELL order for
  the resource (whenever its remaining amount happened to be `<= buyCnt`) removed
  that room from the buy list, so it could never restock.
- **`changeOrderPrice` was called unconditionally and without a type filter.**
  The missing type filter meant our own sell orders were repriced to the buy
  price - quietly marked down for sale. Screeps also charges 5% of
  `(newPrice - oldPrice) x remainingAmount` on any price *increase*, so
  re-issuing an unchanged price is pure loss. Both call sites now filter by
  `ORDER_BUY` and skip unless the price moved by at least 0.001 (the minimum
  increment); `autoBuyPower` got the same idempotency guard.
- **`pauseCommodityBuys` was immediately undone.** It cancels every non-energy
  buy order when energy is tight, but `autoBuyMineral` ran later in the same
  `autoBuy` pass and created them again - a cancel/create cycle every 100 ticks,
  where the cancelled order's 5% is not refunded. The creation path now yields
  while the pause marker is set for the current tick.
- **Labs and factories stopped account-wide on a single starving room.**
  `isEnergyAbundant()` takes the minimum storage+terminal energy across every
  owned room, so one low room forced every lab with a reaction in progress to
  `stat='clear'` and had its centre reagents hauled back to storage, and stopped
  both factory levels from starting batches. Recovering then hauled the same
  reagents straight back in: for an RCL7 ten-lab room that is up to 3000 units in
  each of 10 labs, roughly 30k units moved twice (~20 carrier trips each way),
  plus whatever reaction batch was in flight being voided.
  Labs and the two factory levels now gate on their own room's energy, which is
  what actually constrains them (`station_lab` already tested
  `roomEnergy < 100000`, `station_factory` already tested
  `roomMassStoreCnt(energy) < 100000` - the account signal was stacked on top).
  `isEnergyAbundant()` stays account-wide for genuinely account-level decisions:
  commodity purchasing, factory OP power, powerSpawn processing and the OPF power
  creep - and the paired `exec()` rollback in `station_factory` keeps using the
  same condition, so a factory can never land in the "no OP, no rollback" state.

- **`Memory.cpuTelemetry.buckets` could never shrink back to its cap.** The trim
  was `push(); if (length > cap) shift()`, which only ever holds the array at
  whatever length it already had - push makes it N+1 and shift brings it back to
  N. Once it was over the cap (which happens whenever the cap is lowered, as it
  was when `longTermMaxBuckets` went from 100 to 50) it stayed there. It was
  sitting at 100 buckets against a cap of 50, about 4.7KB of payload that the
  whole Memory tree re-serialises every tick. `splice()` now trims in one go.
- **Duplicate buy orders are converged, not just prevented.** Every creation path
  had some de-duplication, but none could clean up orders that already existed:
  E55S31 was carrying two byte-identical energy buy orders with the same
  `createdTimestamp`. Both freeze credits, both paid the 5% creation fee, and
  they undercut each other. `autoBuy` now keeps only the largest remaining buy
  per (room, resource) and cancels the rest. Verified live: 9 orders -> 7, no
  duplicates.
- **The per-room lab energy gate now has hysteresis.** A single 100000 threshold
  means a room parked on the line flaps - it starts a reaction, has reagents
  hauled in, drops below the line, is forced to clear and has them hauled back
  out. E55S31 was sitting at 100580, right on the boundary. A room already
  reacting stops at 100000; an idle room needs 130000 to start.

### Changed

- Movement and action wrappers no longer allocate per call: `betterMoveTo`
  computes the visual gate into a local instead of cloning the options object,
  `Creep.prototype.moveTo` uses plain parameters instead of a rest array plus
  spread, `lastPos` is mutated in place, and the build/repair/upgradeController/
  dismantle/harvest/attack wrappers only write `dontPullMe` when the value
  actually flips (keepers and upgraders were writing it ~45-60 times per tick).
  `hasActiveBodypart` is cached per creep per tick instead of rescanning a 30-50
  part body on every `moveTo`. `registerStationSourcesCarryOutRoom` and
  `registerStationSourcesDefenseOutRoom` only rewrite their arrays on change.

### Notes

- **Measurement honesty:** the 100-tick `cpuTelemetry` buckets have a noise band
  of roughly +/-1 CPU, so the movement-layer work above is *not* resolvably
  faster in the bucket data - an early 83-sample reading suggested ~0.75 CPU but
  it did not survive at 245 samples (17.067 vs 17.023 for the previous stage).
  The allocation and Memory-write reductions are provable by inspection; the CPU
  claim is not. The market phase fix genuinely added work (13 rooms now run the
  per-room passes that previously only ran for one), so the net CPU is expected
  to sit at or slightly above where it started. `Memory.marketSettings
  .slowPassTicks` (default 80) is the knob if that needs to be traded back.

## v0.78.36 — Make the market passes reachable, replenish combat squads, raise the mineral keep

### Fixed

- **Per-room market gates were mathematically unreachable.** `autoSellMineral`,
  `autoSellDeposit`, the per-room buy block and commodity deals all gate on
  `(Game.time + room.hashCode()) % 80`. `StrategyMarket.exec` is only called when
  `shouldRun(10)` fires, i.e. `Game.time % 10 == 0`, so the congruence needs
  `hash % 10 == 0` to have any solution. Of the 13 owned rooms only E55S39
  (hash -99040) satisfied it. Instrumented in game: 4/4 calls landed on
  `Game.time % 10 == 0` ticks and only that room ever evaluated to 0.
  `autoBuy()`'s own comment records the same class of mistake.
  Replaced with `marketSlowPass()`, built on `Math.floor(Game.time / 40)` which
  increments once per room per 40 ticks and therefore visits every value; rooms
  are spread by hash into `period` phases. Period is tunable via
  `Memory.marketSettings.slowPassTicks` (default 80). `autoSell` moved from a
  `Game.time % 290` gate that only landed on exec's first batch to a 280 tick
  phase.
  Confirmed live: within minutes, rooms that could never sell before
  (E41S23, E41S32, E55S31, E49S31, E59S38, W34N52) started creating sell orders.
  E41S23 is the clean proof: hash -140668, zero hits across 80000 valid exec
  ticks under the old gate, and its X stock of 35955 minus the 30000 keep
  produced exactly the 5955 unit order that appeared.
- **Minerals were sold far too eagerly.** The mineral keep is now 150000 per
  room instead of 30000, so only genuine surplus leaves a room. Orders that fall
  back below the keep are now cancelled - previously the function returned early
  and the stale order kept selling the room down past its retention target.
  Override with `Memory.marketSettings.mineralKeep`.
- **`strategy_atkL2` never spawned anything.** `execSpawn` gated its spawn block
  on `spawnRoom.length <= 8`, but `StationHive.getClosestSpawnRoom` returns a
  Room object, so the comparison was `undefined <= 8 === false` forever.
  Verified in game.
- **Half-dead squads never replenished.** `atkL2`, `defenseAH` and the defense
  flags cleared nothing when a member died: `!flag.memory.attacker` tested a
  stored id rather than a live creep, so the missing half was never rebuilt and
  the flag was never released. A single dead defender was enough to hold
  `room.flags("defenseAH").length < 2` and block every future team. Dead ids are
  now dropped so the member is respawned, with a short cooldown window against
  duplicate spawns before `register*` runs, plus a 300 tick no-hostile cleanup so
  replenished flags do not live forever.
- **`war_defenseCore.exec` aborted its whole pass.** `flag.room` is undefined
  without vision and `room.hashCode()` threw; the exception escaped the `forEach`,
  so every other defense flag went unprocessed that tick and the bad flag was
  never cleaned up.
- **`clearPathCache` ran exactly once per global lifetime.** It latched on
  `Game.__clearPathCache`, which nothing ever reset, so `teamPathCache` grew
  unbounded with one-shot flag names. Now latched per tick.
- **`team_raL1` round-trip patrol index was unbounded**; past `roundRoom.length`
  it built `new RoomPosition(25, 25, undefined)` and threw, stopping the patrol.
- **`delete Game.creeps[name]` did nothing and raised every tick.**
  `pro.init()` had already snapshotted `Game._coreObjects` before
  `ManagerCreeps.init()` ran, so the creep still executed, and with
  `memory.tasks` undefined both `execRegFun`'s `for...of` and `execLastTask`'s
  `.length` threw a TypeError each tick. The memory is now backfilled so the
  creep idles safely until the shard manager fills it in.
- **MIN_CPU silently froze unlisted roles.** The filter used
  `ROLE_PRIORITY[role] > 0`, which is `undefined > 0 === false`, so `reserver`,
  `harvestMineralKeeper`, `outerHarvestEnergyCarrier`, `minRoomWorker` and
  `pillager` were frozen with no log even though the table only marks
  worker/upgrader as pausable. Unlisted roles now run by default via
  `ROLE_PRIORITY_ALLOWED`; the `bucket <= 40` branch keeps its strict whitelist.
- **`HelperError.throwAllError` skipped the whole loop tail.** It threw when
  `pro_err.print === 0` while its call site sits before `HelperCpuUsed.exec`,
  `recordLongTerm`, `updateCodeHealth` and `Memory.stats`, so every throwing tick
  lost telemetry and stats. It also had an unreachable `if(!tmp.length)` branch.
  It now only records and rate-limits logging, so no call site had to move.
- **`station_minetral.update` used `&&` where `||` was meant**, so owned rooms
  without an extractor kept a `stationMineral` entry that `trySpawnHarKeeper`
  would then staff. Also guards a missing `Memory.rooms` entry.
- **`strategy_deposits`** carrier removal was a no-op by construction
  (`if (!contains(id)) without(id)`); the intent was to remove self.
- **Power Creeps carried on after discarding their task.** `OpSource`,
  `OpPowerSpawn`, `OpFactory` and `OpMineral` called `popTask().execLastTask()`
  without returning and then went on to `moveTo`/`usePower` an already-discarded
  (or undefined) target. `needOpMineral` dereferenced
  `room.memory[stationMineral]` without a guard.
- **`RoomPosition.hashCode` ignored `roomCoordinate.y`** and used
  `roomCoordinate.x` twice, so rooms in the same column collided. The value is
  used as a Set key in `war_teamCore` and `strategy_GCLRoom`.
- **`manager_rooms`** wrote `room.Memory` (capital M) - a typo that was never
  read anywhere and did not achieve its stated purpose.

### Changed

- `Memory.codeHealth.moduleCpu` and `cpuLongTerm` were full copies of
  `HelperCpuUsed.profileSummary()` / `longTermSummary()`, duplicating what
  `Memory.cpuModuleTelemetry` and `Memory.cpuTelemetry` already store. Both are
  gone; the dashboard computes them on demand. Measured Memory payload dropped
  from 147215 to 139918 bytes (-5.0%), and both legacy keys are deleted on the
  next code-health write.

### Notes

- Deployed and monitored: `errorCount` stayed at 0, `missingTaskHandlers` empty,
  bucket returned to 10000 and the CPU average settled at 16.84 - below the 17.64
  measured before the change.
- Adds `test/market-phase.test.cjs`, whose negative control proves the old
  formula can never fire for any hash that is not a multiple of 10, while the new
  phase is reachable for every room and lands on an exact period.

## v0.78.35 — Stop energy transaction-cost churn between healthy rooms

### Fixed

- `StrategyResourceBalance` used to create an emergency energy-send buffer
  whenever a room had terminal >=20k and total >=60k, then send to any room
  below the 100k requirement. With every room sitting around 40–60k, this
  caused repeated room-to-room `terminal.send(energy, ...)` calls, each of
  which burns transaction energy.
- Low-energy mode now only allows energy sending to genuinely starving
  rooms (<20k storage+terminal) and only from rooms with a >40k reserve.
  Healthy rooms are no longer shuffled around just to satisfy the 100k
  requirement, so transaction energy is preserved.

### Notes

- Normal energy balancing resumes once `StationHive.isEnergyAbundant()`
  is true.

## v0.78.34 — Stop duplicate keeper/deposit spawns and stuck factories

### Fixed

- **Energy keepers:** `trySpawnOuterHarKeeper` now counts existing keepers
  by `headTask().id` before spawning. Spawning creeps are not yet in the
  source `data.creeps` array, so the old code could queue two or three
  keepers for the same source during the spawn window. E53S21 and W33N53
  were each carrying 4 keepers for 2 sources.
- **Deposit harvesters:** `StrategyDeposits` now includes unregistered
  spawning `harDeposits` in its active count and recycles registered
  over-cap harvesters back down to `walkableAroundCnt`. E49S31's deposit
  had 6 harvesters against a cap of 3.
- **Factory deadlock:** when energy is not abundant, `StationFactory.exec`
  now clears `FILL` and unpowered `PRODUCE` states back to `clear`.
  Previously a high-level `produce` batch waiting for `PWR_OPERATE_FACTORY`
  could stay stuck forever while the energy-surplus gate kept OP disabled
  (E41S32 `phlegm` was stuck with `lastCooldown` 24k ticks in the past).
- **Power spawn energy:** `processPowerSpawn` is paused while the energy
  surplus flag is off, so power is not turned into ops at 50 energy/tick
  while the economy is trying to build its energy reserve.

### Notes

- These changes reduce wasted spawn energy from duplicate creeps and stop
  the last non-essential energy sink (power processing) until energy is
  abundant again.

## v0.78.33 — Cheaper PB detection for spawn power

### Changed

- `PowerCreep.hasPBInRoom` now checks only the persistent `powerBank`
  flags instead of also scanning every owned creep in the room on each
  spawn-power evaluation. This keeps the PB-spawn power logic but removes
  a repeated `FIND_MY_CREEPS` scan from up to four PCs.

## v0.78.32 — Spend PC ops only on PB, combat and essential energy

### Changed

- `PWR_OPERATE_SPAWN` is no longer maintained for ordinary hive
  replenishment. It is only used by a PC whose room has an active
  `powerBank` mission (or live `PBer` / `PBCarrier` / `PBHeal` creeps)
  and only while the PC carries at least 200 ops. This keeps the ops
  reserve for high-value missions.
- `PWR_OPERATE_TOWER` is now combat-only: it requires hostile creeps
  (or hostile power creeps) in the room. Peace-time tower repair no
  longer spends ops.
- `PWR_OPERATE_POWER` additionally requires the global energy-surplus
  flag and a 400-ops buffer, so power processing does not compete with
  cheaper/safer uses.
- Essential energy powers are unchanged and still take priority:
  `PWR_REGEN_SOURCE`, `PWR_OPERATE_EXTENSION` and the existing
  storage-capacity condition. `PWR_OPERATE_FACTORY` remains gated by the
  energy-surplus and factory-need checks added in v0.78.30.

### Notes

- Already-active spawn/tower effects expire naturally; they will not be
  re-applied outside PB / combat conditions.
- `PWR_GENERATE_OPS` still runs whenever the ops store has room, so the
  ops pool keeps accumulating for these targeted uses.

## v0.78.31 — Low-purchase mode cancels commodity buy orders

### Changed

- When `StationHive.isEnergyAbundant()` is false, `StrategyMarket.autoBuy`
  now calls `pauseCommodityBuys`, which cancels every non-energy buy order.
  Basic mineral/O supply will be recreated by the normal `autoBuyMineral`
  rotation once energy is abundant again; labs and factories are already
  paused.
- `autoBuyMineral` no longer buys bar / intermediate products
  (`utrium_bar`, `reductant`, `oxidant`, `purifier`, etc.) while energy is
  not abundant. This removes the main source of the observed commodity-chain
  buy orders.

### Notes

- The first `autoBuy` pass in low-energy mode cancels the current
  commodity/lab/factory buy book; later passes maintain only energy and the
  base mineral reserve.

## v0.78.30 — Energy-surplus gate for labs, factory and commodity buys

### Added

- `StationHive.isEnergyAbundant()`: a per-tick global energy-surplus
  indicator with hysteresis. It averages owned-room `storage + terminal`
  energy and tracks the lowest room:
  - enable when average >= 120k **and** every room >= 40k;
  - disable when average < 80k **or** any room < 20k.
  State is kept in `Memory.ecoBalance` and cached in
  `Game._ecoAbundance` for the tick.

### Changed

- `StationLab.needReaction` no longer starts or maintains lab reactions
  unless the global surplus flag is on **and** the room itself holds at
  least 100k energy. Existing `reacting` state is cleared when the room
  drops below the gate, so reactions pause instead of consuming inputs.
- `StationFactory.needPower`, `noLevel` and `highLevel` are gated by the
  same flag plus a 100k per-room energy floor. `energyCheck` battery
  decompression remains available so low-energy rooms can still turn
  batteries back into energy.
- `autoBuyHighProfitComponents` stops buying commodity-chain inputs while
  energy is not abundant.
- `autoBuyMineral` no longer inflates its purchase line by lab-reaction
  demand while energy is not abundant; base per-room reserves are still
  maintained.

### Notes

- Labs, factories and high-profit commodity buying will turn back on
  automatically once the energy surplus recovers, producing a natural
  on/off cycle instead of continuously spending credits and energy.

## v0.78.29 — Ops buffer for tower power and mineral sell cache fix

### Changed

- `PWR_OPERATE_TOWER` now requires at least 300 carried ops instead of
  100, leaving headroom for factory power on the same PC. P0 (1,642 ops)
  and P4 (490 ops) can maintain it; P2 (260 ops) stays on factory duty.
- `autoSellMineral` no longer skips a mineral when `autoBuyMineral` has
  already written `global._resCnt.tick` for the same tick but only filled
  the one or two resources it happened to be rotating through. Missing
  resource counts are computed on demand, so U/K/Z stockpiles can actually
  be listed for sale.

## v0.78.28 — Mineral mining caps and idle PC power usage

### Changed

- **Mineral mining is no longer “mine until the mineral depletes”.**
  `StationMineral` now pauses a room's mineral keeper when the room's
  storage + terminal + source container holds 20,000 of that mineral. The
  cap sits below `autoSellMineral`'s 30,000 sale trigger, so the room never
  mines just to sell the result.
- **U / K / Z are buy-only.** Their market price (≈9–20 credits) is far
  below the spawn-energy cost of a large mineral keeper, so the bot now
  relies on `autoBuyMineral` for them instead of mining. L / X / O / H
  remain mined up to the 20k cap.
- **Power Creep operator tasks gained the missing useful powers:**
  - `PWR_OPERATE_SPAWN` is used only by PCs with at least 600 carried ops,
    on a room with an active spawning spawn (or a hive deficit), saving
    100 ops per 1,000 ticks on a level-4 PC while shortening spawn time.
  - `PWR_OPERATE_TOWER` is maintained on one tower with ≥500 energy by the
    two PCs that have it, costing 10 ops per 100 ticks and improving tower
    repair/attack efficiency.
  Existing `PWR_GENERATE_OPS`, `PWR_REGEN_SOURCE`, `PWR_OPERATE_STORAGE`,
  `PWR_OPERATE_EXTENSION`, `PWR_OPERATE_FACTORY` and `PWR_OPERATE_POWER`
  behavior is unchanged.

### Notes

- `Memory.mineralSettings[resType].stop` can override the per-mineral
  mining cap; `mineStop` defaults to 20,000.
- PCs without `PWR_OPERATE_SPAWN` / `PWR_OPERATE_TOWER`, or with a low ops
  buffer, are untouched so factory/ops reserves are not diverted.

## v0.78.27 — Stop buying 800k energy after E53S21 reached RCL8

### Changed

- E53S21 reached RCL8, so the dedicated 800k energy buffer is no longer
  needed. `autoBuyLowRclEnergy` now uses the 800k target only while E53S21
  is still below RCL8; afterwards it returns to the normal 100k target.
- Rooms with an existing energy buy order are now always included in the
  management pass, even after their stored energy rises above 50k. This
  lets the code cancel or shrink legacy oversized orders instead of leaving
  them on the market to drain credits.
- Duplicate per-room energy buy orders are cancelled; an order significantly
  larger than the remaining target gap is cancelled and recreated at the
  correct size.

## v0.78.26 — Restore E53S21's dedicated 800k energy buffer

### Changed

- The credit-drain hotfix reduced every room's energy target to 100k. That is
  right for the other rooms, but E53S21 is the only RCL7 room racing to RCL8
  and the user explicitly asked for an 800k buffer. `autoBuyLowRclEnergy` now
  uses an 800k target for E53S21 and 100k for everyone else. Existing
  E53S21 orders are extended to keep ~800k covered, and any order is still
  cancelled once its room reaches its own target.

## v0.78.25 — Cancel energy buy orders once a room reaches its target

### Changed

- `autoBuyLowRclEnergy` now cancels a room's remaining energy buy order
  when stored energy reaches 100,000. Previously the order stayed on the
  market after the room recovered, so a later price spike or market dump
  could fill it and spend credits on energy the room no longer needed.

## v0.78.24 — Let RCL8 upgraders use terminal reserves

### Fixed

- `Creep.prototype.upgradeKeeper` still had a legacy storage gate that
  stopped calling `upgradeController` whenever storage energy was below
  10,000. With most rooms holding their reserve in the terminal while storage
  sat at 0–8k, this left active upgraders standing at the controller with
  70 energy and `ticksToDowngrade` still falling. The gate is removed;
  `shouldRunCreep` already stops RCL8 upgrades when total storage+terminal
  energy is below 30k (or runs them at half speed below 60k).

## v0.78.23 — Power Bank carriers yield to a missing RCL8 upgrader

### Fixed

- E41S23's active Power Bank mission queued three `PBCarrier` spawns while
  its controller had fallen to 51k ticks and had no upgrader at all. The
  spawns were all occupied, so the room could not restore its downgrade
  timer. `trySpawnPBCarrier` now declines to spawn while an RCL8 controller
  is below 80k ticks and has no upgrader (including one currently spawning);
  the Power Bank mission retries on later ticks, while `StationUpgrade` can
  use the free spawn that tick.

## v0.78.22 — Right-size RCL8 carrier fleets dynamically

### Changed

- RCL8 carrier target was a fixed 7 per room. `carryBusy` history showed
  E41S23 averaging 1.9 busy carriers while spawning 3 more, and E59S38/W34N52
  similarly keeping 5–7 around. Those idle carriers held spawn time and
  energy that the recovering upgraders needed. The target is now dynamic:
  4 carriers for 6-link rooms, 5 carriers for rooms with 4–5 links.

## v0.78.21 — RCL8 upgrader spawn no longer blocked by low CPU bucket

### Fixed

- `StationUpgrade.spawnUpgrader` required `Game.cpu.bucket > 9000` before
  spawning an RCL8 upgrader. With average CPU around 17.8/20 the bucket sat
  near 7.8k, so every RCL8 room lost its upgrader and their downgrade timers
  decayed to 51k–78k while three idle spawns and 12.9k energy sat unused.
  Spawning is now decoupled from the bucket; the actual upgrade intents remain
  throttled by `shouldRunCreep` (bucket interval plus 30k/60k energy floors).
  RCL8 rooms will again spawn one upgrader once `ticksToDowngrade < 80k` and
  let it idle once the timer is back above 120k.

### Analysis

- `CONTROLLER_DOWNGRADE_RESTORE` is 100 ticks per successful upgrade action,
  so restoring 70k ticks only costs ~700 upgrade actions (~10.5k energy).
  Long-term RCL8 upkeep is therefore tiny; the previous continuous-upgrade
  drain was not the root cause of the recent energy shortage.

# Changelog

## v0.78.20 — Throttle low-RCL energy buys and auto-sell deposit surplus

### Fixed

- Low-RCL energy buying was draining credits extremely fast: the target was
  300,000 energy and the order followed the top market buy price (75+/unit).
  Money history showed ~250M credits spent in ~1,600 ticks, almost entirely
  energy buys. The target is now 100,000 stored energy and the price is
  capped at `max(history, min(topBuy*1.05, history*1.5))`, so E53S21 and
  starved RCL8 rooms buy enough to upgrade without draining credits.
- Added `autoSellDeposit`: silicon / metal / biomass / mist above a 3,000
  per-room reserve are automatically listed for sale, so deposit harvesting
  produces credits instead of only being consumed by the factory chain.

### Analysis

- Recent money history (deduplicated, tick 83106375–83108032) showed
  `market.buy` −248.9M and `market.fee` −10.4M with **zero sale income**;
  energy buys alone were −244M. That is why credits dropped visibly.
- Deposits were not auto-selling raw output; they fed factory synthesis, and
  only qualifying high-tier commodities are auto-sold.

## ## v0.78.19 — Keep low-RCL energy buy orders competitive

### Changed

- `autoBuyLowRclEnergy` now maintains the price of an existing energy buy
  order for RCL < 8 rooms (and energy-starved RCL8 rooms). Previously it only
  created an order once and skipped rooms that already had one, so an order
  placed at 51 would sit unfilled after the market's top buy price rose.
  Existing orders are now raised to `max(history, topBuy) * 1.05` when they
  fall more than 0.5% below the competitive price.

### Analysis

- Low-RCL rooms still target 300,000 stored energy and do not depend on the
  `Memory.stats.buyEnergy` switch, so buying continues until the room reaches
  RCL8.

## ## v0.78.18 — More downgrade margin and stronger upgrader energy guard

### Changed

- RCL8 upgrader spawn threshold raised from `ticksToDowngrade < 30,000`
  to `< 80,000`, so a room starts refilling the downgrade timer much earlier.
- RCL8 upgraders now idle until `ticksToDowngrade < 120,000` (was < 50,000);
  the 80k/120k hysteresis keeps a 40k safety margin without continuous
  upgrading.
- Energy floor for running RCL8 upgraders raised from 10k/30k to
  **30k/60k** combined storage+terminal: stop below 30k, half speed below
  60k. This is the main protection against the recurring energy shortage.

### Analysis

- A two-source RCL8 room produces at most 20 energy/tick. A full-time
  RCL8 upgrader consumes ~15 energy/tick, and creep replacement (spawn
  upkeep) adds another ~11–19 energy/tick. That is why rooms repeatedly ran
  out of energy when upgraders ran continuously.
- The new 80k/120k schedule plus 30k/60k energy floor lets the upgrader run
  only when the room can actually afford it, and stops it while the hive and
  economy rebuild buffers.

## ## v0.78.17 — Skip construction planning while in min-CPU mode

### Analysis

- `StrategyHighLevel.exec` calls `ManagerAutoPlanner.tryAutoBuildHighLevel`
  directly on every economy pass, bypassing the `isCpuFeatureEnabled`
  and MIN_CPU gates that main.js applies to the full planner. During
  min-CPU mode (deposit expeditions, bucket crises) workers do not run
  (ROLE_PRIORITY -5), so the planned extension/road sites sat unbuilt
  while the prune pass, extension scan and road-gap check still burned
  CPU every pass.

### Changed

- `tryAutoBuildHighLevel` returns early in MIN_CPU mode, keeping only a
  low-gate (bucket > 300) emergency extension site creation for rooms
  whose extension coverage falls below 60% - that gate prevents a
  bootstrap room from stalling because spawn cannot grow its body size.
  Routine extension/road planning and the out-of-tier site prune stay
  suspended until min-CPU mode lifts.

## v0.78.16 — Cheaper health diagnostics and stale RCL stat pruning

### Changed

- The `missingTaskHandlers` diagnostic scan in `updateCodeHealth` now runs
  every 100 ticks instead of every 20 (it walks every creep × every task);
  between scans the last result is carried forward. It exists to catch
  missing modules after a deploy, where a 100-tick detection window is
  plenty.
- `Memory.stats.RCL` entries are pruned when the room is no longer owned.
  The writer only ever added keys, so lost rooms (E43S31, W23N55) stayed
  in Memory forever.

## v0.78.15 — Share one structure scan per refresh pass between tower and defense

### Changed

- `StationTower.update` and `StationDefense.update` both run inside the same
  every-61-tick room refresh and each issued its own full-room
  `FIND_STRUCTURES` scan (~200 structures on an RCL8 room). Both now read
  `room.getStructures()`, the per-tick cache in `prototype_room`, so the
  refresh pass performs at most one scan and later readers reuse it. Filter
  semantics are unchanged (the cache returns the same unfiltered set).
- No behavior change: repair target selection, safe-mode checks and wall
  maintenance run exactly as before, one full scan cheaper per refresh.

## v0.78.14 — Spread market auto-buy scans across ticks

### Analysis

- `MARKET_ORDER_TTL` (100) exactly matches the auto-buy cadence
  (`shouldRun(100, 19)`), so on every auto-buy tick all cached order lists
  expired simultaneously and the tick performed fresh `getAllOrders` scans
  for all 7 base minerals plus the high-profit component analysis — 10-20
  CPU stacked onto an already ~18 CPU tick. This was the main contributor
  to the `optional` phase lifetime max of 24.2 and to the over-limit tail.

### Changed

- `StrategyMarket.autoBuy` now rotates base minerals two per invocation
  (full coverage every 400 ticks; per-resource decision latency is
  immaterial for orders that fill over hours) and runs the high-profit
  component arbitrage every other invocation (200 ticks). Energy buys keep
  their every-100-tick schedule. The every-100-tick spike becomes a small
  distributed cost, directly shrinking the over-limit tail that drains the
  bucket.

## v0.78.13 — Shrink Memory payload: observer bookkeeping out of Memory.rooms

### Analysis

- Live measurement showed `RawMemory` at ~141 KB with `Memory.rooms` at
  ~78 KB (136 entries). Owned-room data is legitimate working state (~41 KB),
  but ~30 KB was observer scheduling bookkeeping (`stationObserver` entries:
  lastUpdateTime / closedMyRoom / priorityVisibleTick / lastPowerBank) spread
  across 123 non-owned highway rooms, plus a per-observer-room `roomNames`
  neighbor cache that was written and only read within the same update call.
  The whole Memory tree is re-serialized every tick, so this was pure
  per-tick overhead.

### Changed

- Observer scheduling bookkeeping now lives in a flat compact map,
  `Memory.observerWatch = {roomName: {u,c,cl,p,pb}}`, written and read through
  `StationObserver.watchRoom`. A one-time migration ports existing
  `Memory.rooms[*].stationObserver` fields and deletes the old keys; stale
  entries (not observed for 3 scheduling windows) are pruned.
- `StrategyObserver.update` no longer persists `roomNames` (the neighbor list
  is a local variable now) and no longer creates `Memory.rooms` entries just
  to stamp `lastUpdateTime`.
- Consumers updated: `strategy_claim` reads `priorityVisibleTick` from the
  watch map; `strategy_powerBank.recordMissionDecision` stores `lastPowerBank`
  there too (it had no other readers).
- `HelperCpuUsed.longTermMaxBuckets` 100 → 50: 5000 ticks of trend buckets is
  enough to judge income/spend, saves ~5 KB of Memory.

## v0.78.12 — Trim fixed per-tick overhead in init and room passes

### Changed

- Cross-shard inbox scans `InterShardMemory` every 5 ticks instead of every
  tick. Each scan reads the local segment plus three remote segments and
  JSON-parses all four, which was the main driver of the init-phase average
  (0.73 CPU) and its 22-CPU spikes. Cross-shard missions run on multi-tick
  timescales, so the added inbound latency (≤5 ticks) is invisible. Outbound
  requests are unaffected: `addCrossShardRequest` still flushes through
  `ManagerCrossShard.afterWork` every tick.
- `ManagerRooms.init` prunes expired room memory every 10 ticks instead of
  every tick. The observer coverage keeps ~138 rooms in `Memory.rooms`, so
  this loop was pure fixed overhead; the 20,000-tick TTL window makes a
  10-tick pruning delay irrelevant.
- `StrategyResourceBalance` reuses the per-tick flag list cached by
  `ManagerFlags.init` instead of running two `FIND_FLAGS` room scans per
  economy pass. The cached list is populated from `Game.flags` for visible
  rooms at the start of the same tick, so the result is identical.

## v0.78.11 — Energy-priority upgrader throttle and market buy filtering

### Changed

- RCL8 controllers are no longer upgraded continuously. Spawning an RCL8
  upgrader requires `ticksToDowngrade < 30,000` and at least 2,500 energy;
  the upgrader only runs while `ticksToDowngrade < 50,000`, so once the timer
  is refilled it idles and the room keeps its energy. RCL8 upgrading used to
  be the largest continuous sink (~15 energy/tick, about 75% of a two-source
  room's production).
- Downgrade emergencies bypass the bucket safety: when `ticksToDowngrade`
  drops below 5,000, an RCL8 upgrader spawns even if the CPU bucket is under
  9,000 (E53S21 fell to ttd 4,909 while the bucket was ~7,000 and the normal
  gate blocked the rescue spawn).
- RCL8 upgraders still respect room energy stock: they stop below 10,000
  combined storage+terminal energy and run at half rate below 30,000.
- Deposits stay enabled (`Memory.cpuFeatures.deposits = true`); deposit
  harvest missions are required. What is filtered is *market buying*: for
  high-profit component ingredients, if there are no sell orders or the
  cheapest sell price is clearly above the acceptable price, no buy order is
  created, so unfillable orders no longer accumulate.

### Analysis

- T3 lab reactions consume about 5 energy per reaction (well under 1/tick)
  and factory batches only 64–1,200 energy each, so compound synthesis is not
  the main energy drain.
- Main drains: RCL8 upgrader energy/tick and repeated creep body replacement
  (spawn upkeep). Rooms therefore cannot fully self-sustain while running a
  full-time RCL8 upgrader on a 2-source budget.
- PC energy production (`PWR_REGEN_SOURCE`, power 13) is active: E53S21's P10
  keeps a level-4 effect on one source (`ticksRemaining` refreshed).
  However, it only boosts regeneration on one source at a time and still
  requires keepers to harvest the extra energy and carriers to move it; if
  keepers/carriers die or upgrade/spawn drain exceeds the boosted output, the
  room still stalls. PC regen is a multiplier, not a replacement for the
  harvest/carry chain.

## v0.78.10 — Faster road rebuild after road decay

### Fixed

- Planned road construction was only re-evaluated every 600 ticks. Rooms whose
  roads decayed to nothing (W33N53, W34N52, E53S21) could sit with missing
  roads for a long time. `tryAutoBuildHighLevel` now checks planned-vs-actual
  road count on every economy pass and immediately re-queues road sites (up to
  the existing per-room construction-site budget).
- `boostCreepBodyPart` no longer waits forever when lab boost resources are
  missing. Boost tasks now carry a `boostExpire` deadline (200 ticks for new
  tasks, 50 ticks retrofit for legacy tasks), after which the creep drops the
  boost task and resumes normal work. W33N53/W34N52 workers were permanently
  stuck on boosting instead of building their missing roads.
- Dead-room bootstrap now counts only *usable* stored energy (terminal + the
  storage portion above 2,000 + containers/links). A room with only a few
  hundred storage energy and no keeper/worker spawns a mining worker instead
  of a carrier that has nothing it can withdraw.
- `autoBuyLowRclEnergy` now also covers RCL8 rooms whose stored energy is
  below 50,000 (e.g. E53S21), so a room whose manual buy order was consumed
  gets a fresh competitive energy order automatically.
- Cross-room resource balancing now sorts targets so rooms with less than
  20,000 stored energy are served first, instead of the nearest room always
  being chosen; starved rooms like E53S21 no longer lose the race to nearer
  ordinary deficits.

## v0.78.9 — Unblock bootstrap carriers after failed expensive spawns

### Fixed

- A failed keeper spawn (expensive body) used to set `room.spawnFailure` for
  the rest of the tick, and since keepers now run first, the 150-energy
  bootstrap carrier could never spawn in a dead room. Carrier bootstrap/
  emergency/recovery spawns now reset `spawnFailure` and re-evaluate current
  energy, so rooms like W33N53 and W34N52 can restart from terminal energy.
- Dead-room bootstrap now runs every economy pass instead of waiting for the
  `%10` (bootstrap) and `%7` (economy) schedules to align, which could delay
  it for dozens of ticks.
- Dead-room fallback: if there is stored energy to haul (storage/terminal/
  container/link) it spawns a 150-energy carrier; if there is no stored energy
  it spawns a 200–300 energy worker with a harvest task instead, so source
  energy can restart the room directly.
- Resource balance no longer assigns `balanceTerminalResource` to the room's
  only free carrier while `HiveNeedToFill` is true; that task was stealing the
  bootstrap carrier in W33N53/W34N52 and keeping spawn/extensions empty.

## v0.78.8 — Continuous energy buying for RCL < 8 rooms

### Added

- `StrategyMarket.autoBuyLowRclEnergy()` keeps a competitive energy buy order
  on every owned room below RCL 8 while credits exceed 5,000,000. It targets
  300,000 stored energy per room and does not depend on `Memory.stats.buyEnergy`.

## v0.78.7 — Bootstrap harvester when hive energy is low

### Fixed

- Keeper spawning always used the room's full energy capacity to size the
  body, so a room like E53S21 with ~1,500 available energy could never afford
  the 3,650-energy full-size keeper, `spawnFailure` stayed set, and the second
  source had no harvester. Keeper body budget now shrinks to the room's
  current available energy (minimum 550), so low-energy rooms can bootstrap
  mining and recover instead of stalling.
- Keeper spawning now runs before worker/carrier spawns in the room economy
  pass; previously carriers consumed the empty hive's last spawn energy and
  the keeper (energy producer) could never spawn.
- `carrierManager` only reserves a tower-filling carrier when at least two
  free carriers exist; with a single free carrier the hive always wins, so a
  dead room cannot get stuck filling towers while spawn/extensions are empty.
- `carryEnergyAuto` can now drain terminal energy down to 0 when it is running
  as a hive-fill task (`allowStorage`), instead of always keeping a 50,000
  market reserve that empty hives cannot afford.
- Added a 150-energy `CARRY*2 + MOVE` bootstrap carrier when a room has no
  carriers, a hive deficit, and only 150–750 available energy, breaking the
  "no creep to move terminal energy, no energy to spawn a creep" deadlock.
- While a hive is in deficit with less than 2,500 available energy, normal
  worker, upgrader, and avgBusy-driven carrier spawns are paused; only keepers
  and the bootstrap/emergency carrier paths may spawn.
- RCL8 rooms now keep at least one upgrader whenever 2,000+ energy is
  available (previously they waited for 150,000 storage energy or
  `ticksToDowngrade < 5000`, which let controllers slide toward downgrade).
  Low-level rooms also spawn an upgrader when they have none and can afford
  the body, instead of waiting for large storage reserves.
- `spawnUpgrader` no longer aborts when the controller container is missing;
  it only aborts when both container and link are gone, so a room with a
  working upgrade link keeps its controller leveled (E53S21).

## v0.78.6 — Tower maintenance during hive deficit and emergency energy sharing

### Changed

- `carrierManager` now reserves one free carrier for tower filling even while
  the hive is in deficit, so towers no longer sit at 0 energy and ramparts
  decay while every carrier chases spawn/extension energy.
- `StrategyResourceBalance` can now send emergency energy from a room with
  terminal energy ≥ 20,000 and storage+terminal energy > 60,000 even when the
  old 150,000-total threshold is not met; this lets nearby rooms feed a room
  whose storage has collapsed (E53S21).

## v0.78.5 — Carrier count control and hive energy guard

### Changed

- Carrier spawn target is now dynamic for low-level rooms (RCL < 8, e.g.
  E53S21): base target is `ceil((sources + harvestEnergyKeepers) / 2)` with a
  minimum of 2 and maximum of 3; while `HiveNeedToFill` is true the target
  gets +1 (capped at 3). High-level rooms keep the original 7-carrier ceiling.
- Emergency/recovery/starved carrier spawns all respect the room target, so
  an empty hive no longer overshoots into too many carriers.
- Excess carriers are not force-recycled; the target only controls spawning,
  so over-target rooms naturally decay back to the target over the carrier
  lifespan.

### Fixed

- Hive energy dispatch remains the highest carrier priority, and the dynamic
  target always rises while `HiveNeedToFill` is true, so spawn/extension
  energy is protected during recovery.

## v0.78.4 — Hive energy recovery priority

### Fixed

- `HiveNeedToFill` compared `room.energyAvailable + room.hiveEnergySending`
  where the reservation counter starts `undefined`, so an empty hive with no
  in-flight `fillHive` task evaluated `NaN < capacity` as false and never
  requested energy. This was the root cause of the E53S21 starvation.
- `generatorFillHiveTask` now initializes the same per-tick reservation
  counter before adding to it.

### Changed

- `carrierManager` now treats hive (spawn/extension) energy as the highest
  carrier priority: when the hive has a deficit, free carriers are assigned
  `fillHive + carryEnergyAuto` first, and low-priority link/tower/lab dispatch
  is skipped until the deficit is covered by reservations. Free-carrier lists
  are recomputed after each dispatch group, fixing duplicate assignment to a
  carrier already given lab work.
- Starved hives with at most two carriers now bypass the `avgBusy` spawn
  threshold: below 2,500 room energy they spawn a small emergency carrier
  (`CARRY*10 + MOVE*5`, 750 energy) every 50 ticks, and at or above 2,500
  they spawn the normal full-size carrier every 25 ticks until the hive has
  enough carriers again.

## v0.78.3 — Tactical scan throttling and Memory churn reduction

### Performance

- Tower rooms no longer scan `FIND_HOSTILE_CREEPS` every tick: the tactical
  pass keeps its ~10-tick cadence, and the safe-mode check runs on a 3-tick
  staggered schedule. Hostile presence still forces a scan every tick.
- Rooms without towers skip the tower station pass entirely, and observed
  (non-owned) rooms skip lab/factory/tower passes.
- High-level economy planning runs every 7 ticks instead of 5 for normal rooms
  (MIN_CPU keeps 10); task dispatch and spawning tolerate the extra delay.
- `Room#my` / `Room#level` are cached per tick, and unknown room-property
  lookups no longer issue a useless `Game.getObjectById` through the structure
  cache prototype proxy.
- BetterMove's stuck-position tracker only writes `lastPos` / `dontPullMe` when
  the value actually changes, reducing per-tick Memory serialization churn.
- Keeper registration and duplicate-keeper cleanup write Memory only when the
  alive-creep list changed, and cleanup runs once per room economy pass instead
  of twice.
- Per-phase CPU samples are persisted on every profile tick instead of only
  when the 97-tick sampler and 20-tick health snapshot align (once per 1,940
  ticks), keeping `Memory.codeHealth.phases` actionable for online tuning.

### Changed

- Towers prioritize HEAL-armed hostiles so tanks under continuous healing can
  still be brought down; the healer is located once per room scan.

## v0.78.2 — Crash guards, memory leak, and config fixes

### Fixed

- `carryRes` passed `Math.min(undefined)` (NaN) to `withdraw` when a task had
  no `resCount`, leaving carriers stuck re-attempting the same task every tick.
- `trySpawnCarrier` read `room.storage[RESOURCE_ENERGY]` (missing `.store`), so
  the storage-has-energy spawn branch never fired.
- `harvestMineralOuterKeeper` dereferenced `mineral`/`container` out of scope
  after `goTo`, throwing `ReferenceError` on the tombstone-pickup branch.
- `unregisterStationUpgrade` reassigned a local instead of `source.creeps`,
  leaking dead upgrader ids into Memory.
- `upgrade()` popped its task on empty energy then kept executing against the
  wrong target; now returns immediately.
- Planner: `createRoads` flood-fill operator precedence, `computeRoom` null
  guard when `computeManor` fails, and a leaked module-global `objects` array.
- Combat (dormant by default): `flag._creeps` null guards, `maxBy` over an empty
  list, and `!range>N` operator-precedence dead branches.
- Market/resource: OPS auto-buy configured amount/min-hold for BATTERY instead
  of OPS, `" GH2O"` leading-space key, and a dead terminal-refill condition.


## v0.78.1 — Preserve manual upgrade flags

### Changed

- Stop hard-coding automatic creation of `upgrade_E53S21_3`. Existing upgrade
  flags remain untouched and continue to control upgrader counts normally.

## v0.78.0 — Carrier dispatch and terminal correctness

### Fixed

- Calculate Terminal transaction energy independently from the resource being
  sent, including the shared inventory constraint when sending energy itself.
- Cache each automatic carrier's selected source in its task so it no longer
  rescans and changes destination every tick; only the current tick's task
  registry is used for collision avoidance, removing stale `_carryClaim`
  Memory writes.
- Match carrier dispatch thresholds to actual creep capacity, count no source
  as no work, and size hive assignments from real carrier capacities.
- Stop manually mutating Screeps `Store` proxies in the newly added automatic
  carrier/worker branches, defer their follow-up task until the intent is
  visible next tick, and guard missing `carryRes` targets before reading them.
- Complete `OPERATE_STORAGE` tasks after success or a terminal error instead of
  leaving the Power Creep on a stale task.

## v0.77.0 — CPU, market, lab, and pillage overhaul

### Performance (CPU 25-27 → ~20, at limit; bucket stabilized)

- Market exec batch cadence 5 → 10 ticks per room; commodity deal scans,
  mineral auto-sell, and buy scans throttled to ~80 ticks per room with
  per-room staggering. `calcTransactionCost` unit cost cached permanently
  on `global` (previously recomputed per candidate order every exec).
- `StationLab.checkLabs` cached for 30 ticks (was per-tick `room.lab.filter`
  plus ~12 `getObjectById`); reaction state machine runs every 2 ticks.
- Main-room `harvestEnergyKeeper` moves straight to the container with
  `moveTo` instead of pushing `goToPop` task stacks every tick.
- Online telemetry (`Memory.codeHealth.phases.roomDetails`) identified
  E55S39 (3.64ms) and W33N55 (2.84ms) as the two hot rooms; both were
  StationLab.exec costs.

### Fixed

- Border crossing: recompute range after re-anchoring so a carrier that
  lands on the opposite exit waypoint advances instead of bouncing between
  the two rooms every tick.
- Pillage flags in foreign rooms now dispatch from the nearest owned room
  (`flag.memory.spawnRoom` claim, mirroring the har_ mechanism); the old
  code only scanned flags physically inside owned rooms.
- Pillage target selection ranks resources by the fixed `RES_PRIORITY_LIST`
  value order rather than market price (XGHO2 had no market history, so its
  fallback price lost to energy and kept hauling energy first).
- `autoBuy` removed its internal `(Game.time)%100==0` gate that never
  aligned with main.js's `shouldRun(100,19)` offset — mineral buying for lab
  feedstocks (X/H) had never executed, starving every lab reaction.
- `autoSellMineral` lists the full sellable amount on one order (buyers
  deal 3k at a time) instead of 3k-sized orders; spent (`remainingAmount=0`)
  and duplicate orders are cancelled; carriers keep refilling the terminal.
- Commodity deals require a premium over the historical average price
  (`Memory.marketSettings.dealPremium`, default 10%) instead of the
  cost-based minimum, avoiding dumping high-value goods like organism.

### Added

- Minerals are mined without the 200k stock cap; excess is auto-sold.
- `autoBuyMineral` accounts for lab reaction feedstocks (BOOST_RES_HOLD,
  capped 300k) and raises bids toward market history when labs starve.
- `autoBuyHighProfitComponents` buys expanded base feedstocks for
  commodities with `profitMargin >= 1000%` (default; configurable) into
  OPF factory rooms. Profit ranking is by margin, not level: level-5
  organism (+1694%)/machine (+1109%) lead, but level-5 essence (+431%)
  and level-4 hydraulics (+61%) trail level-3 frame (+232%).
- Outer-harvest carriers loot tombstone/drop energy within 8 tiles on
  their route (not just their own tile), so a new carrier can take over
  the haul left by a predecessor that died on the path.
- Outer-harvest keepers repair the container beneath them (below 95% hits,
  every 3 ticks) before transferring mined energy.

### Notes

- Factory level = the power creep's PWR_OPERATE_FACTORY (P19) skill level,
  unrelated to the PC name (P0-P9). Online: E55S31 (P4) is level 5 — the
  only room able to produce level-5 goods.

## v0.76.0 — Border waypoint index synchronization

### Fixed

- Persist the next cached-path index while advancing from a border point. The
  prior border fix moved the creep one tile but retained the old index, causing
  the following tick to return it to the border in a two-tile loop.

## v0.75.0 — Cached route border progression

### Fixed

- Force a carrier standing on an exact cached border waypoint to advance to
  the next cached point. This fixes road-builder tasks repeatedly targeting
  their own exit tile instead of entering the adjacent route tile.

## v0.74.0 — Exact cached-road movement

### Fixed

- External carriers now use `Creep.move` between adjacent cached road points,
  preventing `moveTo` from choosing parallel shortcuts. Displaced creeps first
  return to their nearest cached point; a short path search is a recovery-only
  fallback after repeated failed direct steps.

## v0.73.0 — Non-destructive external-road maintenance

### Fixed

- Remove the unused destructive external-road cleanup routine. Roads outside
  the cached route are neither repaired nor rebuilt and now decay naturally;
  only off-route construction sites are removed to preserve the global site
  quota.

## v0.72.0 — Persistent blueprint visual

### Fixed

- Render a `showBlueprint` flag every tick while it exists, instead of only on
  the auto-planner's 25-tick cadence. No visual or CPU work is performed
  without that explicit flag.

## v0.71.0 — External carrier delivery and road-build priority

### Fixed

- Keep ordinary `outerHarvestEnergyCarrier` units delivering energy to Storage
  while the dedicated WORK carrier repairs the external route.
- Use the cached external-road waypoints in both directions; ordinary movement
  is now a fallback only when that cached route is missing or blocked.
- Repair the nearest route-bound road construction site to completion before
  moving on; legacy non-WORK carriers caught in a repair task now resume
  delivery immediately.
- Once the last route site is complete, the WORK carrier delivers its remaining
  energy rather than making another empty repair shuttle.

## v0.70.0 — On-demand external road visual

### Added

- `Memory.visualOuterRoad` enables a temporary, persistent RoomVisual of one
  cached external route: cyan route, green source marker, amber destination,
  and ten-step labels. It auto-expires at `until`.

## v0.69.0 — Reachable external-road fallback

### Fixed

- If the blueprint-aware external route has no solution, retry once with
  Screeps' native obstacle matrix and cache that complete route. The fallback
  is used only for an otherwise unreachable storage endpoint.

## v0.68.0 — Sufficient external-route search budget

### Fixed

- Raise the one-time cached external-route search budget to 8,000 operations.
  The default 2,000 operations was returning an incomplete route at the home
  room entrance; no incomplete result is cached.

## v0.67.0 — Spawn-independent route refresh

### Fixed

- Refresh and validate an existing external-road path before checking Spawn
  availability. Local spawn pressure can no longer leave a broken cached road
  path untouched indefinitely.

## v0.66.0 — Complete external-road routes

### Fixed

- Reject cached PathFinder results that do not actually reach storage and
  invalidate the old incomplete route immediately.
- Treat unbuilt blueprint structures as very expensive rather than impassable
  while calculating external roads, so a route can enter the home room and
  reach storage without laying arbitrary roads.

## v0.65.0 — Full-load carrier pickups

### Fixed

- Source-container and external-mining carriers now withdraw only when the
  container holds strictly more energy than that creep's full carry capacity.
  Insufficient loads are left in place instead of triggering a partial trip.

## v0.64.0 — Fully reinforce fresh ramparts

### Fixed

- Keep a builder on its newly completed rampart until its carried energy is
  exhausted (or the rampart is full), rather than releasing it after one
  repair intent.

## v0.63.0 — Strict RCL blueprint tiers

### Fixed

- Restrict Extension construction to the first blueprint slots unlocked by
  the current RCL. Missing slots remain diagnostics, never a reason to place
  an Extension in a future-RCL position.
- Remove Extension construction sites outside the current RCL tier, including
  sites created by the prior fallback implementation.

## v0.62.0 — Immediate extension placement diagnostics

### Fixed

- Retry a missing Extension on every staggered high-level economy pass rather
  than waiting for its background construction time slot after an RCL upgrade.
- Record the latest extension site creation failure code, coordinate, and
  global construction-site count in compact `Memory.rooms[room].autoBuild`.
  A full account-wide site limit is now visible instead of failing silently.

## v0.61.0 — Deterministic construction and remote roads

### Fixed

- A remembered external source now launches its keeper and carrier directly
  without waiting for a new scout to restore vision. Scouts remain first-use
  discovery only.
- Restrict external road build/repair to the cached source-to-storage route
  and periodically remove off-route road construction sites in remote rooms.
- Retry extension placement every 150 ticks, count queued extension sites,
  and search all blueprint candidates so blocked early positions cannot leave
  a room permanently two extensions short.
- When a rampart construction site completes, keep that builder on a targeted
  repair task on the next tick, immediately lifting it above the 1-hit decay
  floor before ordinary maintenance resumes.

## v0.60.0 — Recoverable remote harvesting

### Fixed

- Treat a remote room without current vision as requiring its scoped scout,
  even when historical room Memory exists. This prevents a dead keeper from
  leaving an external source permanently idle after vision expires.
- Dispatch external harvesting before ordinary local staffing so a one-Spawn
  supply room can actually launch its scout, keeper, and road-capable carrier.
- Make legacy external road-builder tasks default to the source-to-storage
  direction. Their previous missing direction turned the cached route index
  into `NaN` and stranded road construction.
- Use source-station data for external defence tasks and safely handle a
  newly queued defender, preventing a null-memory error during hostile scans.

## v0.59.0 — Reliable mission Flag handoff

### Fixed

- Dispatch active PB queues before ordinary room staffing. A freshly idle
  Spawn now creates the waiting healer before optional workers can consume it.
- Give all newly-created Flag Memory a ten-tick visibility grace period.
  Deposit and dynamic combat Flags are now protected from the same delayed
  `createFlag` handoff race as Power Banks.
- Restore the normal conservative PB first-observation lifetime threshold to
  4,200 ticks after resolving the creation bug.

## v0.58.0 — Correct Power Bank Flag creation result

### Fixed

- Treat a visible newly-created PB Flag as success even when this shard's
  `createFlag` call returns `undefined`. The prior string-only check removed
  its mission Memory and explains the E50S42 discovery failure.

## v0.57.0 — Wider Power Bank launch window

### Changed

- Lower the first-observation PB lifetime threshold from 4,200 to 3,400
  ticks. This still reserves a 300-tick travel budget while accepting viable
  nearby 2M-hit banks such as E50S42.

## v0.56.0 — Durable Power Bank Flag handoff

### Fixed

- Keep a newly created Power Bank mission in a ten-tick pending handoff until
  its Flag is visible. This closes the delayed-Flag race where generic orphan
  cleanup could erase a valid PB mission immediately after discovery.

## v0.55.0 — Compact persistent diagnostics

### Optimized

- Retain long-term room CPU telemetry only for owned rooms. One-tick Observer
  vision no longer accumulates remote-room timing records in Memory.
- Prune legacy remote CPU timing records periodically and expire stale error
  stacks/counters after 5,000 ticks, while preserving current diagnostics.
- Record one compact PB mission decision per observed target, including its
  remaining lifetime and selected spawn room, so rejected targets are
  diagnosable without retaining scan histories.

## v0.54.0 — Sparse near-cap rampart maintenance

### Optimized

- Near the RCL8 300M rampart target, maintain only one repair Worker and let
  it expire once the threshold is reached. Two Workers are allowed only when
  the weakest defense falls below 60% of its target.
- Construction staffing now grows with site count: one for small batches, two
  after five sites, and three only after ten sites.

## v0.53.0 — Bounded rampart repair staffing

### Optimized

- Cap background construction and rampart-repair Workers at three per room.
  Repair staffing now scales only from one to three at meaningful energy
  thresholds, preventing large storage reserves from monopolizing Spawns and
  creep CPU.

## v0.52.0 — PB target task snapshots

### Fixed

- Build explicit, immutable attacker/healer task data from the PB flag instead
  of enumerating its transient Memory proxy. New PB pairs always retain their
  flag name, target ID, and destination room after boosting.

## v0.51.0 — PB mission validation

### Fixed

- Reject stale Power Bank flags lacking a target ID, amount, or expiry before
  they enter the spawn queue. This prevents an obsolete Observer record from
  creating a lone attacker with no valid Power Bank target.

## v0.50.0 — Persistent PB pair queue

### Fixed

- Store the pending attacker/healer pair directly on its Power Bank mission
  flag. This preserves the second half of a pair until a Spawn becomes free.

## v0.49.0 — Synchronized PB attacker/healer dispatch

### Fixed

- Dispatch PB queues every tick. Two idle Spawns launch attacker and healer in
  the same tick; a single Spawn launches the second half on the next tick.

## v0.48.0 — Persistent PB direct-queue state

### Fixed

- Store PB direct spawn queues and per-mission cooldowns in ordinary Memory,
  not `Game` globals, so the throttle remains effective across runtime resets.

## v0.47.0 — Flag-free Power Bank team spawning

### Fixed

- Power Bank attack/heal pairs no longer create `spawnTeam` flags. They use a
  PB-local runtime queue and direct spawn dispatch, removing the Flag Memory
  reset path responsible for repeated invalid-team logs.

## v0.46.0 — PB queue cache independent of Flag Memory

### Fixed

- Moved short-lived PB spawn queues to a tick-persistent `Game` cache and
  added a per-PB respawn cooldown. This stops repeated empty `spawnTeam`
  creation even when the game resets the flag's Memory object.

## v0.45.0 — Durable Power Bank team queues

### Fixed

- Store Power Bank spawn queues in a dedicated Memory map and let the generic
  spawn-team worker read it when Screeps exposes an empty flag Memory object.
  This prevents the PB queue from being mistaken for an invalid manual flag.

## v0.44.0 — Reliable Power Bank spawn-team handoff

### Fixed

- Fixed repeated `Removing invalid spawnTeam flag` logs from Power Bank rooms.
  New PB queues are retained briefly outside `Memory.flags` and attached when
  their newly created flag is visible, preventing orphan cleanup from erasing
  `spawnList` during the creation boundary.

## v0.43.0 — Remove Deposit-triggered RaL combat

### Fixed

- Removed the legacy Deposit hostile-response code that created `raL3`/`raL4`
  combat flags, including the obsolete `raL3_E49S31_1` experiment.
- Orphaned RaL creeps now retire safely when their control flag is removed.
- Power Bank attack and hauling logic remains enabled and independent.

## v0.42.0 — Stable room CPU display and combat queue back-pressure

### Optimized

- Dashboard room CPU now shows the persisted sampled average rather than a
  single profiling tick that can exaggerate transient pathing spikes.
- A persistent `r4` combat flag now waits for its existing spawn queue before
  requesting another squad, preventing queue accumulation when spawning stalls.

### Maintenance

- Removed obsolete claim diagnostic snapshots from live Memory; active claim
  operation state, room state, creeps, market data, and CPU telemetry remain.

## v0.41.0 — Bounded combat spawn queues

### Fixed

- Added a creation timestamp and a bounded 2,000-tick lifetime to every combat
  spawn-team request, preventing blocked queues from becoming permanent CPU work.
- Made RaL combat spawning honour `Memory.cpuFeatures.combat`, so the emergency
  combat pause stops both team execution and new combat spawn requests.

## v0.40.0 — Safe spawn-team validation

### Fixed

- Validate the `spawnList` contract before combat spawn-team logic reads it.
  Invalid legacy or manually created `spawnTeam` flags are logged once and
  removed instead of throwing every tick and draining the CPU bucket.

## v0.39.0 — Staggered optional CPU scheduling

### Optimized

- Move market auto-buy, automatic planning, and room visuals onto separate tick
  offsets so their periodic peaks no longer coincide every 100 ticks.
- Sample detailed module CPU every 97 ticks. The prime interval rotates across
  normal task schedules and produces representative long-term averages instead
  of repeatedly measuring the same worst-case tick.
- Keep market room batches and auto-buy independently scheduled so moving the
  low-frequency order scan cannot accidentally disable it.

## v0.38.0 — Full production gates and persistent CPU profiling

### Added

- Persist low-frequency CPU profiles for loop phases, creep roles, and owned
  rooms in `Memory.codeHealth.moduleCpu`, including average, maximum, latest
  sample, and sample count.
- Include cross-shard `afterWork` serialization in the measured phase costs.

### Optimized

- Write `InterShardMemory` only when requests or acknowledgements actually
  changed instead of serializing and publishing identical data every tick.

### Fixed

- Reject unknown cross-shard mission handlers without throwing and guard
  optional callbacks.
- Safely initialize local cross-shard data when a request is queued before the
  manager has run in the current tick.

## v0.37.0 — Unique signs and highway harvesting

### Added

- Restore Power Bank discovery, mission creation, attack/heal teams, and power
  carriers behind `Memory.cpuFeatures.powerBank`.
- Allow PB-only spawn teams to run independently when the general combat
  feature is disabled.

### Changed

- Replace controller signs with sixteen author-free poetic lines and persist a
  unique assignment for every currently owned room. More than sixteen rooms
  receive a room-name suffix so uniqueness remains guaranteed.
- Keep Deposit and Power Bank room strategies dormant unless matching mission
  flags exist; Observer scans use the same online feature gates.

### Fixed

- Guard missing PB targets, flags, attackers, healers, and carrier-heal targets.
- Avoid stale PB mission Memory when flag creation fails and only advance team
  counters after a spawn-team flag was created successfully.
- Dispatch remote Deposit and PB flags through the spawn room encoded in their
  names instead of the remote room containing the flag; index this mapping once
  per tick to avoid repeated scans.

## v0.36.0 — Full planner, fixed upgrader positions, poetic signs

### Changed

- Allow the complete automatic-planning pipeline whenever the feature is
  enabled and the CPU bucket is at least 6000. The manual planner dispatcher
  remains staggered at 25 ticks; low-level blueprint checks run every 150 ticks
  and high-level construction checks every 600 ticks.
- Record planner CPU cost in `Memory.codeHealth.autoPlanner` (`last`, `average`,
  `max`, `samples`, and `lastTick`).
- Give every controller upgrader a persistent, independently reserved walkable
  position within range three. Keeper positions prefer access to the controller
  link or container.
- Add sixteen short Chinese and English poetry signatures. Each owned room
  deterministically selects one and is re-signed once by a nearby upgrader or
  worker before normal work resumes.

## v0.20.0 — GCL room restoration

### Added

- Restore `strategy_GCLRoom` as the explicit opt-in
  `Memory.cpuFeatures.GCLRoom` feature.

### Optimized

- Require both the feature switch and a room-local `GCLRoom` flag before the
  specialized room strategy can replace normal room execution.

## v0.19.0 — Opt-in Deposit restoration

### Added

- Restore `strategy_deposits` as the explicit opt-in
  `Memory.cpuFeatures.deposits` feature; observer scans and room execution share
  the same gate.

### Fixed

- Prevent an undeclared combat-flag global and guard removed Deposit flags and
  absent transfer targets.
- Avoid creating stale `Memory.flags` entries before a suitable spawn room and
  acceptable cooldown are known.

## v0.18.0 — Cross-shard strategies

### Added

- Restore trade and claim cross-shard strategies behind separate explicit
  opt-ins, both additionally requiring the cross-shard manager switch.

### Optimized

- Reduce inventory publication from every 163 ticks to every 1,000 ticks and
  price only resources actually present in owned-room storage.

### Fixed

- Remove accidental `String` fields from cross-shard spawn missions, stop work
  after completed flags are removed, and defer claim blueprints below 9500
  bucket.

## v0.17.0 — Cross-shard foundation

### Added

- Restore `manager_missions` and `manager_crossShard` as the opt-in
  `Memory.cpuFeatures.crossShard` foundation.

### Fixed

- Stop shadowing the official `InterShardMemory` object and remove the old
  unconditional early returns that made the manager inert.
- Parse empty/corrupt remote payloads safely, batch request serialization in
  `afterWork`, and ignore unknown local mission handlers without throwing.
- Fix the leaked global variable in `sendRes`.

## v0.16.0 — Dormant flag utilities

### Added

- Restore `strategy_cleanBuild`, `strategy_blockRoom`, and `strategy_pillage`
  behind independent feature switches and active flag gates.

### Fixed

- Guard removed block-room flags, absent pillage storage, empty last-position
  state, and missing clean-build worker counts.
- Remove per-tick block-room registration logging and avoid sorting cached flag
  objects unnecessarily.

## v0.15.0 — Flag-gated claim restoration

### Added

- Restore `strategy_claim` behind `Memory.cpuFeatures.claim` and an active
  `claim` flag prefix.

### Fixed

- Guard empty scouter tasks, select claimers by their target flag, and stop
  processing immediately after a completed claim flag is removed.
- Defer the expensive first room blueprint until the CPU bucket exceeds 9500.

## v0.14.0 — Planner foundation

### Added

- Restore `helper_visual`, `manager_planner`, and `manager_autoPlanner` as
  opt-in dependencies for later claim and combat modules.

### Optimized

- Gate automatic planning calls in low/high-level room strategies and raL
  visuals behind their feature switches, leaving both at zero runtime work
  until explicitly enabled.
- Skip tower-damage visualization safely until `war_cache` is restored.

## v0.13.0 — Opt-in market restoration

### Added

- Restore `strategy_marketPrice` and `strategy_market` as an explicit opt-in
  feature (`Memory.cpuFeatures.market = true`).

### Optimized

- Remove the full market-price calculation from script initialization.
- Cache market history for 1,000 ticks, commodity sell prices for 1,000 ticks,
  and order lists for 20 ticks.
- Spread the twelve-room market pass across four five-tick batches.

### Fixed

- Consume the `commodities` field returned by profit analysis instead of
  treating the wrapper object as the commodity map.
- Suppress the large profit-analysis HTML unless explicitly requested.

## v0.12.0 — Flag-gated scouter restoration

### Added

- Restore `strategy_scouter` behind `Memory.cpuFeatures.scouter`.
- Add `ManagerFlags.hasPrefix()` so dormant flag-driven modules can avoid
  entering their strategy functions on ordinary ticks.

### Fixed

- Safely handle a `moveto` flag being removed while its scouter is alive.

## v0.11.0 — Remote harvesting restoration

### Added

- Restore `strategy_outerHarvest` behind
  `Memory.cpuFeatures.outerHarvest`; existing `stopRemote` flags still take
  precedence.

### Optimized

- Return immediately in rooms with no `har` flags and process the cached flag
  list only once per scheduling pass.
- Guard scouter, reserver and defender task inspection against empty tasks.

## v0.10.0 — Observer restoration

### Added

- Restore `station_observer` behind `Memory.cpuFeatures.observer` and keep it
  enabled by default outside emergency low-CPU mode.
- Add a shared optional-feature gate so later modules can be disabled without
  another code upload.

### Fixed

- Allow observer scans to run before Deposit and Power Bank strategies are
  restored. Missing strategies are skipped, so PB missions remain paused.
- Initialize remote-room observer memory defensively.

## v0.9.0 — Adaptive 20 CPU scheduling

### Optimized

- Spread high-level room economy and spawn planning over five ticks instead of
  three; tower defense, labs, factories and Power Creeps remain independent.
- When the CPU bucket drops below 9800, stagger only safe RCL8 upgrader ticks.
  Controllers below 20,000 downgrade ticks bypass the throttle immediately.
- Reduce detailed per-room/per-role profiling from every 20 ticks to every 100
  ticks while retaining lightweight health reporting every 20 ticks.

## v0.8.0 — Movement instrumentation control

### Optimized

- Disable BetterMove's per-call CPU analyzer by default. It previously called
  `Game.cpu.getUsed()` before and after every `moveTo`, plus during cache lookup.
- Keep the analyzer available for short diagnostic sessions with
  `BetterMove.setCpuStats(true)` without charging normal gameplay for profiling.

## v0.7.0 — Active raL creep strategy

### Added

- Restore `team_raL1`, covering the active `raL3_E49S31_1` flag and its creep
  task handler. Cross-shard variants remain paused while their manager is off.

### Fixed

- Keep construction-site state local to the raL task and guard the optional
  visual helper.
- Ensure `room.flags()` returns an empty array in rooms with no flags, fixing a
  resource-balancing exception introduced by the room index refactor.
- Record low-frequency CPU phase timings in `Memory.codeHealth.phases` so
  optimization work targets measured runtime costs.
- On profiling ticks, break room CPU down by room name and unit-task CPU down
  by creep role.

## v0.6.0 — Per-tick room indexes

### Optimized

- Build the global flag-prefix map during the existing flag initialization
  pass instead of scanning all flags again on first use.
- Index room flags by their actual position rather than assuming the second
  name segment is always a room name.
- Reuse the per-room flag cache in the room manager instead of repeatedly
  calling `room.find(FIND_FLAGS)`.
- Correct undefined cache initialization for room creep and flag lists.
- Cache room, creep, and Power Creep arrays once per tick for reuse across the
  main lifecycle.
- Remove the redundant full `JSON.stringify(Memory)`/`RawMemory.set` pass every
  127 ticks; the runtime already persists the assigned parsed Memory object.
- Reuse the global Memory cache only across consecutive ticks, falling back to
  the runtime Memory object after a tick gap.
- Execute creep, Power Creep, room, and market batches through one guarded loop
  per group instead of allocating a new try/catch closure for every object.

## v0.5.1 — Tower idle CPU reduction

### Optimized

- Run peaceful tower repairs every three ticks instead of every tick; hostile
  rooms still attack every tick.
- Sort repair targets by damage ratio and never issue an attack with an
  undefined random target.

## v0.5.0 — Factory economy loop

### Added

- Restore `station_factory` for factory carry tasks, energy compression and
  decompression, base commodities, powered commodities, and OPF integration.

### Optimized

- Skip factory dispatch in rooms without a factory.
- Guard stale Power Creep room assignments before reading the room name.

## v0.4.0 — Core lab and boost tasks

### Added

- Restore `station_lab`, which provides the existing `boostCreepBodyPart` task
  handler and the boost/unboost task generators used by room spawning logic.
- Resume lab filling, clearing, reactions, and boost allocation in owned rooms.

### Optimized

- Skip the lab subsystem entirely in rooms with no labs.
- Correct the controller-level active-lab capacity check.
- Add a core task dependency audit and ignore null entries when composing task
  arrays, preventing one unavailable target from corrupting a creep task stack.
- Record a lightweight `Memory.codeHealth` snapshot every 20 ticks with the
  recent average CPU, bucket, unit counts, and missing live task handlers.
- Preserve the most recent caught error and tick in `Memory.codeHealth`.

## v0.3.1 — Power Creep task-target hotfix

### Fixed

- Return the storage object from `needOpStorage` instead of boolean `true`, so
  `UtilsTask.task` receives a valid target.
- Build task room names from `RoomPosition.roomName` and report invalid targets
  explicitly, including the affected task name.

## v0.3.0 — Storage and terminal balancing

### Added

- Restore `strategy_resourceBalance` to keep terminal target stocks balanced,
  redistribute shortages, and evacuate resources from nearly full storages.

### Optimized

- Keep the existing staggered ten-tick schedule for per-room work.
- Use total storage free capacity for fullness decisions rather than a
  resource-specific capacity query.
- Skip factory commodity balancing until the factory module and its tables are
  deliberately restored.

## v0.2.0 — Power Creep survival profile

### Added

- Restore `strategy_factoryPowerCreep` as the only new runtime module. It runs
  every three ticks and keeps renewal, storage capacity, extension filling,
  source regeneration, Power Spawn operation, and mineral regeneration active.

### Fixed

- Spawn a dead Power Creep only after `spawnCooldownTime` has elapsed; the old
  comparison prevented respawning once the cooldown was actually over.
- Refresh `PWR_OPERATE_STORAGE` when its effect is absent or below 100 ticks,
  instead of retrying while a long effect was active.
- Skip factory operation safely while `station_factory` remains disabled.

## v0.1.1 — Shard-name startup hotfix

### Fixed

- Initialize `LOCAL_SHARD_NAME` in `main_mount` so creep initialization and
  high-level worker spawning run without loading the costly cross-shard module.

## v0.1.0 — CPU bootstrap profile

### Changed

- Reworked `helper_cpuUsed` into a five-tick, 600-sample ring buffer. It no
  longer appends two values every tick or slices 20,000-element arrays.
- Enter `MIN_CPU` automatically below a bucket of 2,000, while retaining the
  existing `Memory.mincpu` manual override.
- Throttled market work to once every five ticks. Auto-planning and visuals
  are disabled by default and can be enabled with `Memory.cpuFeatures`.
- Made the entry point and room manager skip unloaded optional modules rather
  than throwing errors on every tick.

### Bootstrap deployment profile

- `deploy/core-modules.json` defines the first upload payload: 32 survival
  modules (entry point, mining, hauling, spawning, upgrading, and tower
  defense) plus their required helpers.
- Removed 568,248 source characters from this first payload. Market, combat,
  cross-shard coordination, remote operations, deposits, power banks,
  observers, planners, factory production, lab production, visuals, and
  team-control modules remain local and are not loaded.
- High-level worker logic now falls back to unboosted workers when Lab support
  is intentionally absent, and skips Factory/autoplanner work when unavailable.
- Existing creep tasks whose implementation belongs to an omitted optional
  module are paused without throwing every tick. They remain in Memory so the
  matching module can be restored before the operation is resumed.

### Deployment status

- Power Bank tasks were explicitly cleared before deploying the bootstrap
  profile. Power Bank automation remains disabled.

### Validation

- `node test/core-profile.test.cjs`
- `node --check` for every JavaScript module in the core manifest (the
  PriorityQueue WASM module is verified as a binary module and intentionally
  excluded from JavaScript parsing).

### Enable optional work deliberately

After its module group has been uploaded and its `require` restored, enable a
feature with `Memory.cpuFeatures.<name> = true`; disable it with `false`.
Current feature switches are `market`, `autoPlanner`, and `visual`.
## v0.21.0 — Advanced combat package

### Added

- Restored the damage, cache, team core/control/flag, attack-room, defense,
  Power Creep operator, L2 attack, and highway-defense modules as one
  dependency-complete package.
- Added the explicit `Memory.cpuFeatures.combat` opt-in. Every combat
  dispatcher also requires a matching active flag, keeping idle CPU cost low.

### Fixed

- Guarded missing Power Creeps, unregistered defense teams, and absent highway
  targets instead of throwing during combat ticks.
- Corrected highway defender range checks and task creation to use the actual
  flag rather than an undefined variable.
- Applied the visual feature gate inside drawing helpers so combat code cannot
  accidentally spend CPU on visuals while visuals are disabled.
## v0.22.0 — Room and movement hot paths

### Added

- Added an on-demand colored console dashboard. Run `dash()` for the owned-room
  overview or `dash("ROOM")` for resource, role, and current-task details. It
  is never called by the tick loop and therefore has no ongoing CPU cost.

### Changed

- Reused the tower hostile scan for advanced defense detection instead of
  scanning every owned room again on every tick.
- Selected one damaged friendly target per room for tower healing rather than
  repeating two closest-target searches for every tower.
- Replaced carrier hive-target `findClosestByPath` calls with range selection
  over the cached spawn/extension arrays; BetterMove still handles routing.
- Suppressed legacy `visualizePathStyle` options inside BetterMove whenever
  the global visual feature is disabled.
- Increased staggered full room/station discovery from 31 to 61 ticks to
  reduce periodic room-management spikes while retaining prompt recognition
  of completed structures.
## v0.23.0 — Tactical query and target caching

### Added

- Expanded `dash("ROOM")` with a per-creep task table showing role, TTL,
  current task, target, and carried capacity for stalled-task diagnosis.

### Changed

- Added per-tick hostile creep/structure caches on visible Room objects and
  shared them across safe-mode, tower, advanced-defense, and team calculations.
- Preserved immediate safe-mode checks while removing duplicate hostile scans
  from downstream tower and combat logic.
- Reused hostile and tower lists across every member of a combat team during
  incoming-damage evaluation.
- Reworked highway-defense target selection to use one room scan and cheap
  range selection, and removed a duplicate PathFinder call used only for logs.
- Added a three-tick attack-room target cache so active attackers do not repeat
  up to seven `findClosestByPath` searches every tick.
## v0.23.1 — Room cache-key hotfix

### Fixed

- Renamed tactical Room cache fields with a project-specific prefix so they
  cannot collide with Screeps engine internals.
## v0.23.2 — Room Proxy compatibility hotfix

### Fixed

- Validate tactical cache values as arrays because the legacy structure-cache
  Proxy returns `null`, rather than `undefined`, for unknown Room fields.
## v0.24.0 — Compact interactive console dashboard

### Changed

- Reduced the default `dash()` overview from twelve columns to eight; hover a
  room name to see terminal, Power, OPS, role, and task summaries.
- Moved per-creep task rows and complete resource lists in `dash("ROOM")` into
  collapsed sections that can be expanded independently.
- Added task tooltips with the full target, position, and registration handler,
  while truncating long IDs in the visible table.
## v0.25.0 — Combat spatial and target reuse

### Fixed

- Switched the console dashboard to `console.logUnsafe`, the explicit rich
  output API required after Screeps began escaping HTML in `console.log`.
  Dynamic room, creep, task, and resource values remain HTML-escaped.
- Limited resource enumeration to own Store keys so prototype helper methods
  no longer appear as `NaN` resource rows.

### Changed

- Added a per-tick all-structure Room query cache and reused it in tower-damage,
  rampart-area, permit-area, and combat CostMatrix generation.
- Limited `WarCache.getRoomStructures` to one visible-room scan per tick even
  when several teams or path searches request the same room.
- Added three-tick selected-target caches to raL1 and atkL2 combat creeps while
  preserving explicit console target overrides and all existing priorities.
## v0.26.0 — Persistent CPU telemetry and smooth surplus use

### Added

- Added persistent per-tick CPU totals plus 100-tick buckets for exact
  since-version, approximately 1000-tick, and approximately 10000-tick
  averages. Statistics include peaks, over-limit ticks, and bucket delta.
- Exposed the uploaded/restored/excluded module profile to the on-demand
  console dashboard.
- Replaced unreliable hover-only dashboard details with native click-to-expand
  room, task, resource, and module sections.

### Changed

- Added a two-tick upgrader interval between bucket 9800 and 9950, smoothing
  the previous jump from one-third speed directly to full speed.

## v0.27.0 — Room manager and runtime cleanup

### Changed

- Reorganized room-management scheduling with descriptive constants and
  method names, while retaining compatibility aliases for older console code.
- Standardized the transient spawn-failure property and cross-shard strategy
  global; legacy public names remain as aliases during staged deployment.
- Added an explicit `dash.help` hint for correct console invocation.

### Optimized

- Removed the unused account-specific tick dispatcher, obsolete manual Power
  Creep routine, and historical debug blocks from the production runtime.
- Execute wake tasks without allocating a Lodash key/value array and calculate
  each room's scheduling hash only once per tick.

### Fixed

- Clear the first refreshed room's movement cache after a script reload as
  originally intended, rather than losing the bootstrap flag too early.
- Corrected `spawnFailue` and `setChangeFindClostestByPath` spellings while
  preserving the latter as a compatibility alias.
- Route resource reports, CPU charts, and commodity-profit HTML through
  `console.logUnsafe`, with readable text fallbacks on older servers.
- Correct empty Store SVG percentages and size each resource background bar
  to its requested width.

## v0.28.0 — Unit-management allocation cleanup

### Added

- Add a central escaped rich-text logger that standardizes all ordinary
  `console.log` output as green `INFO`, yellow `WARNING`, or red `ERROR` lines.
- Highlight Screeps resource names with their mineral/commodity colors while
  leaving explicit dashboards and charts on their raw rich-output path.

### Optimized

- Reuse one filtered alive-PowerCreep list across initialization, room-power
  checks, and OPS generation instead of rebuilding it for each pass.
- Merge live-Creep validation and room grouping into one traversal and replace
  the temporary Lodash group-key array with a direct object iteration.
- Cache main-room, station, body-part, and free-capacity values inside the two
  highest-cost upgrader/harvester task handlers.

### Fixed

- Replace an accidental bitwise `&` in upgrader movement throttling with the
  intended short-circuit boolean condition.
- Remove the duplicate `Creep.prototype.headTask` definition.

## v0.29.0 — Safe claim operations

### Added

- Allow a claim flag to pin its spawning room through
  `flag.memory.spawnRoom`, keeping long-range expansion on an audited route.
- Persist manually excluded BetterMove rooms in
  `Memory.betterMoveAvoidRooms` so route safety survives script reloads.

### Fixed

- Extend clean-build workers to dismantle inactive hostile spawns and other
  damageable hostile structures that block construction in a newly claimed
  room.
- Keep cleanup flags until the target controller is owned and hostile
  structures are actually gone.

## v0.30.0 — Integrated claim cleanup

### Changed

- Replace the separate long-lived clean-build flag for expansion with one
  bounded 5 WORK / 5 CARRY / 5 MOVE claim cleaner spawned by the claim
  strategy only when hostile structures are visible.
- After dismantling the old structure and gaining controller ownership, the
  cleaner automatically becomes a normal bootstrap worker in the new room.

## v0.31.0 — Automatic claim bootstrap

### Added

- Keep the claim operation active after controller ownership and immediately
  create the spawn, extension, and source-container construction sites allowed
  by the current RCL from the saved room blueprint.
- Complete the expansion as one workflow: scout, plan, claim, dismantle old
  structures, create bootstrap sites, and reuse the cleaner as a local worker.

### Optimized

- Cache the current hostile structure ID and use a range lookup only when the
  target changes, avoiding a full `findClosestByPath` search on every cleanup
  tick.

### Fixed

- Allow RCL1 workers to build the first spawn construction site instead of
  always upgrading the controller until RCL2.

## v0.32.0 — Observer-assisted claiming

### Added

- Let claim operations automatically select an owned Observer within its
  10-room range and request priority vision for the target room.
- Refresh target-room stations and generate the blueprint directly from the
  Observer visibility tick, avoiding a manual console observation step.

### Optimized

- Keep claim observations in a separate priority queue so ordinary highway
  scans cannot overwrite them, while issuing at most one Observer intent per
  room and tick.
- Run the claim strategy on its normal three-tick cadence, with an additional
  pass only on the exact priority-vision tick.
- Spawn the short-lived claimer before the reusable cleanup worker when both
  are missing from a long-range expansion.

## v0.33.0 — Claim safety audit and persistent diagnostics

### Added

- Persist a bounded state history and latest room snapshot under
  `Memory.claimOperations[roomName]`; inspect it with `claimLog("E53S21")`.
- Record observation, scouting, planning, claiming, cleanup, first-spawn
  construction, completion, and blocking states without unbounded Memory use.

### Fixed

- Count only `FIND_MY_SPAWNS` when selecting a spawn room or completing an
  expansion, so an old hostile spawn can never satisfy the operation.
- Dismantle every non-blueprint structure that blocks the new layout, while
  retaining ownerless roads, containers, and walls already used by the saved
  blueprint.
- Create only the first spawn site while the room is spawnless; secondary
  extension and container sites are added after that spawn exists, ensuring
  bootstrap workers cannot choose lower-priority construction first.
- Spawn the reusable cleaner/bootstrap worker even in an already-empty target
  room, guaranteeing that the first spawn has a local builder after claiming.

## v0.34.0 — Low-RCL blueprint construction recovery

### Fixed

- Treat construction from an already saved room blueprint as essential
  low-level room maintenance rather than an optional auto-planning feature.
- RCL1–3 rooms now continue creating their allowed spawn, extension,
  container, tower, storage, and road sites on the staggered 150-tick cadence
  even when expensive planner computation and visuals remain disabled.

## v0.35.0 — Interactive reports and commodity economics

### Added

- Add local pointer/click tooltips to `dash()` and `dash("ROOM")`, matching the
  interaction model that already works in `HelperRoomResource.showAllRes()`.
- Add a cached deposit-commodity economics engine that recursively expands
  every level of the factory reaction path into base deposits, minerals,
  energy, and per-level factory OPS costs.
- Persist a compact ranked result in `Memory.marketCommodityAnalysis` and
  expose exact per-resource details through
  `StrategyMarketPrice.getCommodityAnalysis(resourceType)`.

### Changed

- Replace the room-resource ECharts/CDN hover dependency with a self-contained
  console tooltip, avoiding CSP, network, and external `eval` failures.
- Select up to two profitable level-1+ commodities per deposit series for
  automatic sales, using a configurable minimum margin (default 15%).
- Evaluate current buy orders after transaction-energy cost and use bounded
  100–10,000 unit deals; never deal with our own order or below reaction cost.
- Cache full reaction-chain analysis for 5,000 ticks and derive all market
  prices from one weighted history snapshot instead of one history request per
  commodity.

### CPU safety

- Auto-planning may be enabled, but runs only with bucket at least 6,000 and a
  recent 1,000-tick average below 95% of the account CPU limit. Without an
  `autoBlueprint`, `saveBlueprint`, or `showBlueprint` flag its scheduled pass
  is effectively a no-op.
