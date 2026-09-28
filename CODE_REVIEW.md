# Screeps Bot 代码审查报告

> ## 修复状态（2026-09-28 更新）
>
> 本报告已完成取证与修复。全部改动见 `CHANGELOG.md` v0.78.36，已提交并上线，
> 上线后 `errorCount` 全程为 0。
>
> **已修复并部署**
>
> | 条目 | 取证方式 | 结果 |
> |---|---|---|
> | P0-1 市场 `%80` 门控 | 实机插桩 + 穷举扫描 | ✅ 已修，线上确认生效 |
> | P0-2 `spawnRoom.length<=8` | 游戏内实测 `typeof room.length` | ✅ 已修 |
> | P0-3 防御队半死卡死 | 代码路径 + 状态机推演 | ✅ 已修 |
> | P0-4 `clearPathCache` 只跑一次 | 全仓 grep 无复位点 | ✅ 已修 |
> | P0-5 `delete Game.creeps` | 调用顺序 + JS 语义 | ✅ 已修 |
> | P1-3 市场 `.has(e)` | 类型分析 | ✅ 已修（实为 4 处） |
> | P1-6 `throwAllError` 抛异常 | 代码路径 | ✅ 已修 |
> | P1-7 其余确定性 bug | 逐条读码 | ✅ 已修（见下） |
> | Memory 重复副本 | 实测 147215→139918 字节 | ✅ 已修（−5.0%） |
> | 矿物保留量 | 业务要求 | ✅ 30000 → 150000 |
>
> **未修改（有意保留）**
>
> - `war_cache.js:257` 的 `e.type!=MOVE\|\|e.type!=CARRY` 是恒真式（确认是代码异味），
>   但正确的替换应当是 `&&` 还是别的意图无法从上下文确定，改它会真实改变战斗寻路的
>   避让行为，故**保持原样**，留给作者确认。
> - P1-1（lab 反应期间不派搬运任务）、P1-2（`BOOST_RES_HOLD` 产能错配）、
>   P1-4（`isEnergyAbundant` 单房拖垮全账号）、P1-5（storage 近满互发）属于**设计取舍**，
>   会改变生产/物流行为，需要专门验证，未纳入本批。
> - P2 全部 CPU 热点（移动层包装、lodash 覆写原生 `Array.find` 等）未动：
>   其中若干项被 `test/core-profile.test.cjs` 的字符串断言锁定，需要连同测试一起改，
>   风险与收益都要单独评估。
>
> **一处结论修正**：`sell:U@W32N56` 那张历史订单**无法归因到当前代码**。它的数量
> 274549 = 304549 − 30000 确实对应 `autoSellMineral` 的 `keep=30000`，但该房
> hash −66541（%10 = −1）在现版本下永远过不了门控，且 09-21 创建当日的代码
> （commit 07b8730）与今天逐字一致。最可能是控制台手工下单，或创建时该房缓存的
> `hashCode` 与现在不同。**已修复的 E41S23 订单可以完整归因**，见下方 P0-1 的补充。

- **审查对象**：`/Users/an/Documents/Screeps/modules/`（70 个模块）
- **代码基线**：本地 `main` = 线上 `default` 分支，HEAD `65e8206`，`RUNTIME_PROFILE.version = 0.78.35`
- **运行环境**：shard3，CPU 上限 20，13 个自有房 + 7 个仅视野房，87 个 creep
- **实测 CPU 基线**：总均值 17.6；相位 `unitTasks 10.95` / `rooms 5.78` / `init 0.69` / `registration 0.37`
- **审查日期**：2026-09-28

本文只列**建议修改的部分**，按「修完能拿回什么」排序。凡标注 ✅ 的结论我已在本次审查中用代码或线上 Memory 实测复核过。

---

## 0. 结论摘要

| 优先级 | 问题 | 后果 |
|---|---|---|
| **P0-1** | `strategy_market.js` 的 `(Game.time + room.hashCode()) % 80` 门控 | ✅ **87.5% 的房间永久不做任何市场操作**（实测 119/136） |
| **P0-2** | `strategy_atkL2.js:172` `spawnRoom.length <= 8` 恒为 false | ✅ l2 攻击小队**永远不会出兵**，整条策略是死代码 |
| **P0-3** | `war_defenseCore.js` 双人防御队死一半就永久卡死 | ✅ 防御补给失效 + flag 占位阻塞后续队伍 |
| **P0-4** | `war_teamCore.js` 的 `Game.__clearPathCache` 从不复位 | ✅ 路径缓存清理函数全局只跑一次，之后 `teamPathCache` 无限增长 |
| **P0-5** | `manager_creeps.js:78` `delete Game.creeps[name]` | ✅ 删除无效 + 该 creep 每 tick 抛异常、照常耗 CPU |
| **P1-1** | lab 反应期间没有 carrier 任务，clear 还会抽走原料 | 反应走走停停，原料在 storage↔lab 之间往返搬运 |
| **P1-2** | `BOOST_RES_HOLD` 的 X 级持有线 500000 与实际产能错配 | 实验室长期锁死在同一目标，其它化合物排不进去 |
| **P1-3** | 市场三处 `.filter(e => !myRoomSet.has(e))` 把订单当房间名 | ✅ 自抬价，多付信用点 |
| **P1-4** | `isEnergyAbundant()` 单房拖垮全账号 | 任一房缺能 → 全账号 lab 停产、工厂回退、市场暂停 |
| **P1-5** | storage 近满时无需求校验地盲目互发 | 资源在房间之间打转，白烧 terminal 交易能量 |
| **P1-6** | `HelperError.throwAllError()` 会抛异常 | ✅ 中断主循环尾部，丢遥测与 stats |
| **P2** | 一批 CPU 热点（见第 3 节） | 预计可回收 1.5~2.5 CPU/tick |
| **P3** | 死代码与一致性清理（见第 4 节） | 可读性与内存体积 |

---

## 1. P0：功能性静默失效

这一类的共同点是**不报错、不崩溃，但功能完全没跑**。因为主循环用 `HelperError.catchError` 包住了几乎所有策略，异常和逻辑失效都只表现为「什么都没发生」。

### P0-1 市场门控 `% 80` 在数学上对绝大多数房间永不成立 ✅

**位置**：`strategy_market.js:995`、`:782`、`:444`、`:901`

```js
// strategy_market.js:995  （per-room 买入）
if ((Game.time + room.hashCode()) % 80 != 0) return;
// :782  autoSellMineral
// :444  autoSellDeposit
// :901  let doCommodityDeal = (Game.time + room.hashCode()) % 80 == 0;
```

**问题**：`StrategyMarket.exec` 只由 `main.js:102` 的 `HelperCpuUsed.shouldRun(10)` 触发，而 `shouldRun` 的定义是 `(Game.time + offset) % interval === 0`（`helper_cpuUsed.js:99`），所以**它只在 `Game.time % 10 == 0` 的 tick 上运行**。

这些 tick 上 `Game.time % 80 ∈ {0,10,20,…,70}`，要让 `(Game.time + hash) % 80 == 0` 成立，必须 `hash ≡ 0 (mod 10)`。而 `room.hashCode()` 是 `Utils.rnd(Utils.hashCode(name))`（`prototype_room.js:70-75`、`utils.js:68-79`），取值任意，**约 90% 的房间 hash 不是 10 的倍数**。

**实测验证**（用线上 `Memory.rooms[*].hashCode` 对 136 个房间逐一代入）：

```
能命中 %80 门控的房间: 17 / 136
永久失效的房间:        119 / 136  (87.5%)
我方 13 个自建房:      12 个失效，只有 E55S39 能跑
```

**后果**：对那 119 个房间，以下功能**全部不存在**：

- commodity deal（`getBestCommoditiesToSell` 算出的卖单形同虚设）
- per-room 买入 `RES_BUY_AMOUNT_ROOM`（含 OPS）
- `autoSellMineral` → U/L/K/Z/X/O/H **只进不出**
- `autoSellDeposit` → deposit 原料超保留量也不卖

**这很可能就是之前「XGHO2 看起来没在动」的一部分根因**——矿物与化合物的卖出通道对 12/13 个房间是关闭的。

**运行时插桩（实机，不是推断）**：包裹 `StrategyMarket.autoSellMineral` 采集调用样本，90 秒后读回：

```json
{"calls":4,"pass":1,"fail":3,"tmod":{"0":4},
 "samples":[[83284160,"E48S41",-60105,55],
            [83284160,"E55S39",-99040,0],
            ["PASS","E55S39",-99040,83284160],
            [83284170,"E49S31",-173961,49]]}
```

`tmod:{"0":4}` 说明 **4/4 次调用都发生在 `Game.time % 10 == 0` 的 tick**，前提成立；
只有 E55S39 取到 `v == 0`。

**「可是市场里有订单」的解释**：全局买入走的是 `autoBuy()`
（`main.js:110`，`shouldRun(100, 19)`，**没有 `%80` 门控**——作者在 `strategy_market.js:159-167`
特意把它的内部限频删掉了，注释记录的正是同一类错误）。现有
`buy:energy` / `buy:O` / `buy:lemergium_bar` 都是它建的，属正常，与门控无关。

**修复后线上验证**：修复上线后数分钟内，原本永久锁死的房间开始挂卖单
（E41S23、E41S32、E55S31、E49S31、E59S38、W34N52）。其中 E41S23 构成完整证据链：

```
E41S23  hash = -140668，hash % 10 = 2
扫描 80000 个合法 exec tick，旧门控 (Game.time+h)%80==0 命中 0 次   ← 穷举证明不可达
X 存量 35955 − autoSellMineral 的 keep 30000 = 5955
新出现的订单 sell:X@E41S23 数量恰好 = 5955                        ← 完全吻合
```

**建议**：不要用 `Game.time + hash` 去对一个大于调度周期的模数取模。改为与真实执行周期对齐的独立相位：

```js
// exec 每 10 tick 一次，用品房相位错峰，保证每个房间都能轮到
let phase = (Game.time / 10) | 0;
let doCommodityDeal = phase % 8 === 0 && (phase % 4) === (room.hashCode() % 4);
```

或更彻底：把这些重活并入 `autoBuy`（全局、100 tick 一次、已有 `Utils.randomGet`/轮转机制），彻底不用 `Game.time + hash`。

> 注意：同一个文件里 `% 290` 的 `autoSell`（`:986`）虽然也不对齐，但 `290 % 40 == 10`，所有房间最终都会轮到，只是频率被压到约 1/4（每 1160 tick 一次），属于「慢」而不是「死」。

---

### P0-2 `strategy_atkL2` 因类型错误完全生不出兵 ✅

**位置**：`strategy_atkL2.js:167`、`:172`

```js
let spawnRoom = StationHive.getClosestSpawnRoom(flag.pos.roomName, lev);  // :167
if(!spawnRoom){ log("no active able room"); return; }
if(spawnRoom && spawnRoom.length <= 8){      // :172  ← 恒为 false
    ... StationHive.trySpawn(spawnRoom, ...)
}
```

**问题**：`StationHive.getClosestSpawnRoom`（`station_hive.js:108-137`）返回的是 **Room 对象**（`return Game.rooms[...]` / `return room`），不是房间名字符串。Room 上没有 `length` 属性（`极致建筑缓存` 的 Proxy 对非 24 位字符串返回 `undefined`），所以 `undefined <= 8 === false`，整个 spawn 块被跳过。

**后果**：`StrategyAtkl2` 永远不会出兵。`main.js:35` 每 tick 仍在为它运行时判断（`ManagerFlags.hasPrefix("l2")`），但实际是 no-op。`global.atkl2Target`（`:65/:76`）也从未被赋值，`forcedTarget` 是死分支。

**建议**：删掉 `spawnRoom.length <= 8` 这个条件（从语义上看这里本来就不需要该限制）。同时确认 `l2` 策略是否还在用；若不用，整模块可从 `main_mount.js` 摘掉。

---

### P0-3 防御双人队死一半就永久卡死 ✅

**位置**：`war_defenseCore.js:129-151`

```js
ManagerFlags.getFlagsByPrefix("defenseAH").forEach(flag=>{
    if(!flag.memory.attacker){ ...trySpawn 攻击手... }   // :130
    if(!flag.memory.healer){   ...trySpawn 治疗...   }   // :139
    if(flag.memory.attacker && !Game.getObjectById(flag.memory.attacker)
        && flag.memory.healer && !Game.getObjectById(flag.memory.healer)){
        flag.remove()                                    // :148-151
    }
```

**问题**：`flag.memory.attacker` / `healer` 只由 `registerDefenseAttacker/Healer`（`:7-20`）**写入，从不删除**。所以：

1. `!flag.memory.attacker` 判断的是「有没有存过 id」而不是「还活着没有」——**死掉的那一半永远不会补兵**；
2. flag 只在两人**同时**死亡时才删除。只死一个时：不补兵、不删旗；
3. 而 `:115` 的 `room.flags("defenseAH").length < 2` 被这个僵死 flag 占位 → **新的防御队再也生不出来**。

**建议**：改成对实例判断，并补超时兜底：

```js
let atk = flag.memory.attacker && Game.getObjectById(flag.memory.attacker);
let heal = flag.memory.healer && Game.getObjectById(flag.memory.healer);
if (!atk) { delete flag.memory.attacker; ...trySpawn 攻击手... }
if (!heal) { delete flag.memory.healer; ...trySpawn 治疗... }
if (!atk && !heal && Game.time - (flag.memory.lastSpawnTime || 0) > 3000) flag.remove();
```

**同文件另有一处会中断整个防御扫描**（`war_defenseCore.js:102-104`）：

```js
let room = flag.room
if((Game.time+room.hashCode())%3!=0)return;   // room 为 undefined 时抛 TypeError
```

`flag.room` 在房间不可见时是 `undefined`。一旦存在这样的旗子，异常会从 `forEach` 回调抛出、中断整个 `exec`，**其余所有防御旗子本 tick 都不再处理**，而且该旗子永远不被清理（`ManagerFlags.hasAnyPrefix` 恒为 true，每 tick 白发 CPU）。
**建议**：`if(!room) return flag.remove();`

---

### P0-4 `clearPathCache` 全局只执行一次 ✅

**位置**：`war_teamCore.js:724-732`，调用点 `:1007`、`:1025`

```js
clearPathCache(){
    if(Game.__clearPathCache) return;   // :725
    Game.__clearPathCache = true         // :726
    for(let flagName in teamPathCache){
        if(!Game.flags[flagName]) delete teamPathCache[flagName]
    }
},
```

**问题**：全仓库 grep 只有这两行读写 `Game.__clearPathCache`（也确认没有任何地方每 tick 复位它）。于是这个函数在全局生命周期内**只会真正执行一次**，之后永久 early-return。

**后果**：`teamPathCache` 只增不减。`teamPathCache[flag.name]` 会随 `f4team_<time>_<random>` 这类一次性旗名持续写入，长期占用堆内存；已删除 flag 的路径缓存也再不被清理。

**建议**：改成按 tick 门闩：

```js
clearPathCache(){
    if (Game._clearPathCacheTick === Game.time) return;
    Game._clearPathCacheTick = Game.time;
    ...
}
```
（挂在 `Game` 上的属性每 tick 由引擎重建，天然复位——这也是本项目其它 tick 级缓存的做法。）

---

### P0-5 `delete Game.creeps[name]` 既无效又每 tick 抛异常 ✅

**位置**：`manager_creeps.js:76-80`

```js
if (!creepMemory || !creepMemory.tasks) {
    delete Game.creeps[name];   // 想「剔除」这只爬
    continue;
}
```

**问题**（三层）：

1. `main.js:14` 的 `getTickObjects()` 在 `pro.init()` 里就生成了 `Game._coreObjects` 快照，而 `ManagerCreeps.init()` 在 `main.js:18` 才执行。快照里仍有这只 creep，`pro.exec()`（`main.js:26`）照样会执行它 —— **删除没有任何效果**。
2. 该 creep 的 `memory.tasks` 是 undefined：`execRegFun`（`prototype_creep.js:176` `for (let task of this.memory.tasks)`）与 `execLastTask`（`:241` `this.memory.tasks.length`）都会抛 TypeError，被 `runEach` 捕获后塞进 `errList` —— **每 tick 白烧 CPU，还会触发 P1-6 的 `throwAllError`**。
3. 直接 `delete` 引擎提供的 `Game.creeps` 对象是未定义行为。

**触发条件**：跨分片到达但尚未写入 `memory.tasks` 的爬（`crossShard` 默认关闭，所以现在很少见，但配置一开就会暴露）。

**建议**：不要 delete。改为 `creepMemory.tasks = []`（或在执行阶段过滤掉 `!memory.tasks` 的爬），并把 `getTickObjects()` 快照挪到 `ManagerCreeps.init()` 之后。

---

## 2. P1：逻辑错误与资源浪费

### P1-1 lab 反应期间没有 carrier 拉产物，且 clear 会抽走原料 ✅（已复核）

**位置**：`station_lab.js:518-538`（`generatorFillReactionTask`）、`:539-571`（`generatorClearLabRes`）、`strategy_highLevel.js:156-158`

```js
// generatorFillReactionTask
if(!obj["reacting"] || obj["stat"] != "fill") return [];      // :523
// generatorClearLabRes
if(obj["stat"] == "reacting"){
    ...只清「混入错误 resType 的副 lab」...
    if(fillTask.length > 1) return fillTask; else return [];   // :558-559
}
// clear 分支把 center 和 other 一起抽
let labs = obj.centerLabs.concat(obj.otherLabs)...              // :563
```

**问题**：当 `stat == "reacting"` 时：

- `generatorClearLabRes` 正常情况下返回 `[]`（没有错料 lab 要清）；
- `generatorFillReactionTask` 因 `stat != "fill"` 返回 `[]`；
- 而 `strategy_highLevel.js:156-158` 的优先级是「`generatorClearLabRes` 为空才退到 `generatorFillReactionTask`」——

**于是整个反应期间没有任何 carrier 接到 lab 任务**。产物只能等某个副 lab 堆到 3000 触发 `runReaction` 返回 `ERR_FULL`（`station_lab.js:641-644`），才把 `stat` 打回 `clear`，随后**一次性清空所有 lab——包括两个 center lab 里尚未反应的原料**。

**后果**：

1. 走走停停，反应无法连续进行；
2. 原料往返搬运 churn：center 里最多 3000+3000 的原料被搬回 storage，下一轮再搬进来，白烧 carrier 与时间；
3. `needReaction` 在能量不充裕时也会直接 `stat='clear'` + `delete reacting`（`:458-463`），放大这个 churn。

**建议**：

- `reacting` 状态下，为产物 ≥ 某阈值（如 2000）的副 lab 生成 `carryRes` 任务，边生成边拉走；
- clear 阶段不要抽走仍在参与反应、resType 正确的 center lab；
- 把「产物输出」与状态机 `stat` 解耦，产物清理不应驱动 `stat` 翻转。

---

### P1-2 `BOOST_RES_HOLD` 的 X 级持有线与实际产能错配 ✅（已复核）

**位置**：`station_lab.js:57-66`、`:465`、`:493-503`

```js
"XLHO2":500000, 'XLH2O':500000, "XGHO2":500000, "XZHO2":500000,
"XZH2O":500000, "XUH2O":500000, "XKHO2":500000,
...
if(obj["reacting"]) return obj["reacting"];   // :465 一旦选定几乎不再重评
```

**问题**：`getTotal(k)` 是**单房** storage+terminal 之和，所以 500000 也是按房解释的持有线。而 X 级合成实测量级约 **1 单位/tick**（8 个副 lab × 10 产物 / `REACTION_TIME ≈ 80`），从 40 万补到 50 万需要约 **9.9 万 tick**（现实时间数天）。

配合 `:465` 的提前返回，`needReaction` 几乎不再重新选型 → 该 lab 房**长期锁定在某个 X 级目标上，其它 X 级化合物永远排不进去**。

实测印证：E55S31 `reacting: "XGHO2"` 已持续多日，storage XGHO2 稳定停在 400,850 不动；而账号级 XGHO2 已达 **4,108,733**，是持有线的 8 倍，不存在短缺。

**建议**：

- 把 X 级持有线降到与产能匹配的量级（例如 20000~50000），或改为「按小时缺口」而非绝对值；
- 给同一 `reacting` 目标加轮换（连续运行超过 N tick 或产出达 X 就换目标）。

---

### P1-3 市场三处把订单对象当成房间名 ✅

**位置**：`strategy_market.js:502`、`:535`、`:587`

```js
// 上一行刚 map 成 roomName
.map(e => e.roomName).filter(e => myRoomSet.has(e)).toSet();
// 这里 e 却是订单对象，myRoomSet 是房间名 Set
let maxPrice = StrategyMarket.getAllOrdersCacheList(resType, ORDER_BUY)
    .filter(e => !myRoomSet.has(e))          // ← 永远为 true
    .map(e => e.price).maxBy(e => e) || 0
```

**问题**：`Set.has(对象)` 永远是 false，本意「排除自己的订单」失效，`maxPrice` 把自己的买单也算进去。随后 `Game.market.changeOrderPrice` 会把订单拉到「含自己订单在内」的全局最高价——**一旦某房遗留一张高价单，就会把其余房间的单一起抬到该价并锁死**，持续多付信用点。

对照 `:331-332` 的写法（先 `.map(e => e.roomName)` 再 `has`）可确认这是笔误。

**建议**：三处改为 `.filter(e => !myRoomSet.has(e.roomName))`。

---

### P1-4 `isEnergyAbundant()`：单房缺能拖垮全账号

**位置**：`station_hive.js:73-99`；消费方 `station_lab.js:456-464`、`station_factory.js:194/245/304-311`、`strategy_market.js:171/219`

```js
let state = Memory.ecoBalance || (Memory.ecoBalance = { abundant: false });
if (!state.abundant) { if (avg >= 120000 && min >= 40000) state.abundant = true; }
else if (avg < 80000 || min < 20000) { state.abundant = false; }
```

**问题**：`min` 取全账号**任一**己方房间的 storage+terminal 能量。只要 13 房里有一间掉到 2 万以下（例如 E53S21 这种低能量房），`isEnergyAbundant` 就全局关断，导致：

- 所有房间的 lab 反应被强制 `stat='clear'` + `delete reacting`（连正在反应的原料也被抽走）；
- 工厂 FILL/PRODUCE 回退；
- 市场商品买入暂停。

单房波动 → 全账号工艺停摆，耦合过强。而 4 万→2 万的下探带又意味着会反复触发 clear/重新 fill，正好与 P1-1 的 churn 叠加。

**建议**：把「本房是否可合成」与「账号是否充裕」解耦——本房用 `roomEnergy` 单独判断，账号级信号只影响**是否启动新反应**，不强制清空正在反应且本房能量充足的 lab。或把 `min` 换成「饥饿房占比 / 最差 N 房均值」，并拉宽滞回（如 40k 开 / 15k 关）。

---

### P1-5 storage 近满时的盲目互发

**位置**：`strategy_resourceBalance.js:326-356`

```js
let storageFree = room.storage && room.storage.store.getFreeCapacity()
if (storageFree < STORAGE_MIN_CAP_CNT) {          // <10000
    ... 选取 maxResType ...
    if (targetRooms.find(e => sends(e, 10))) return;
    if (targetRooms.find(e => sends(e, 5)))  return;
    if (targetRooms.find(e => sends(e, 2)))  return;
}
```

**问题**：该分支**不检查目标房是否真的需要 `maxResType`**（只有上面的 `roomRequireCnt` 循环才看），是「谁有空就往谁那儿塞」。目标房被塞满后，它下一轮也会进入同一分支挑自己的最大资源往外发——**形成资源在房间之间循环搬运**，每次 `send` 都消耗 transaction energy。也没有「在途」标记或冷却。

现实风险：W33N53（939,230 / 1,000,000）与 W34N52（932,005 / 1,000,000）都已 93% 满，且各房容量并不统一（1M / 5M / 8M 都有），固定 10000 的触发线相对不同容量表现不一致。

**建议**：

- 发送前加目标需求判断（`roomRequireCnt(target, res) > 0` 或目标房该资源低于其持有线）；
- 给 send 加每房/每资源冷却或「在途」记录；
- 触发线改用相对比例（如 `free < capacity * 0.02`），并优先送往真正的下游（工厂/lab 房）。

---

### P1-6 `HelperError.throwAllError()` 会抛异常中断主循环 ✅

**位置**：`helper_error.js:42-62`，调用点 `main.js:292`

```js
if(!tmp.length){ pro_err.print=0; }   // :50 不可达（此分支 tmp.length >= 1）
if(pro_err.print){
    pro_err.print += 1;
    if(pro_err.print > 10) pro_err.print = 0;
    console.log(tmp);
} else {
    pro_err.print += 1;
    throw new Error(tmp);              // :60 抛出，中断 main
}
```

**问题**：

1. `main.js:292` 的调用点在 `HelperCpuUsed.exec()`、`recordLongTerm()`、`updateCodeHealth()` 与 `Memory.stats` 写入（`:293-318`）**之前**。任一被 `catchError` 捕获的异常都会在那一 tick 把整个 loop 抛出去，**导致其后所有收尾逻辑被跳过**（CPU 采样、codeHealth、stats RCL 全部丢失）。
2. 抛出节奏诡异：`print` 从 0 开始，所以第 1 次错误就抛，之后 10 次改为 `console.log`，第 12 次再抛——很难预期。
3. `:50` 的 `if(!tmp.length)` 是不可达代码。

**建议**：`throwAllError` 永不抛；把它降级为「记录 + 限流日志」，并把落盘/上报放在 loop 最后一步。若确实想要「出错就炸」的告警，应改成显式开关（`Memory.debug.throwOnError`）。

---

### P1-7 其余已确认的逻辑错误（逐条可改）

| 位置 | 现状 | 问题 | 建议 |
|---|---|---|---|
| `strategy_deposits.js:111-113` ✅ | `if (!flag.memory.carriers.contains(this.id)) flag.memory.carriers = flag.memory.carriers.without(this.id)` | 条件写反：成立时「不在数组里」，`without` 是无操作；真正在数组里时反而什么都不做。等于空操作 | 去掉 `!`，或直接 `without(this.id)` |
| `war_cache.js:257` ✅ | `e.body.find(e => e.type != MOVE \|\| e.type != CARRY)` | 一个部件不可能同时是 MOVE 和 CARRY，`\|\|` 恒为真 → 退化成「有身体」。原意应是 `&&` | 确认意图后改 `&&` |
| `station_minetral.js:165` ✅ | `if (!room.my && !room.extractor) return delete ...` | `&&` 应为 `\|\|`：非己方房恰好有 extractor 时不触发清理 | 改 `\|\|` |
| `station_factory.js:43` | `let minimum_compression_requires_energy_cnt = 7000000 // 注释写 0.7m` | 常量与注释差 10 倍 | 确认是有意为之还是笔误 |
| `station_factory.js:352-391` | PRODUCE 状态在 `!sm.powered` 时 `return`，而 `generatorFillTask` 只在 `stat==FILL` 工作 | 该状态无外部输入可自愈 → 潜在不退出 | 加 `sm.produceStartTick` 超时回 `clear` |
| `prototype_powerCreep.js:89-106/240-262/351-361` | `if (条件) { this.popTask().execLastTask(); }` 缺 `return` | `popTask` 后继续 `moveTo`/`usePower`，作用到已放弃的目标；白费 power 调用 | 统一补 `return`（`OpExt:288-292` 是正确写法） |
| `prototype_powerCreep.js:338-349` | `let obj = room.memory[StationMineral.stationName]; Game.getObjectById(obj.id)` | 无矿物记忆的房抛 TypeError，吞掉后该 PC 整 tick 后续分支全跳过 | `if(!obj \|\| !obj.id) return false;` |
| `station_lab.js:287` + `:318` + `:425` | `room._boost_requires` 只在 `(Game.time+hash)%3==0` 赋值，其余 tick 为 undefined | boost 药水填充链路只有 1/3 tick 有效，再叠加 `exec` 的 `%2` 门控更少 | 存到 `room.memory.stationLab`，或缺失时即时重算 |
| `station_lab.js:274-285` | `getNoBoostLab` 会返回 center lab，并顺手 `obj["stat"]='clear'` | 任何需要新 lab 的 boost 申请都会**打断正在进行的反应** | 只在 `otherLabs` 中选；用尽就让 `boostAble` 返回 false |
| `strategy_market.js:171` vs `:189-191` | `pauseCommodityBuys()` 撤单后，同 tick 的 `autoBuyMineral` 又不检查能量就把矿物买单挂回去 | `pauseCommodityBuys` 名存实亡 + 每轮 cancel→create 白烧手续费 | 给 `autoBuyMineral` 也加 `isEnergyAbundant()` 判断 |
| `strategy_market.js:585-586/596/600-611` | 用 `remainingAmount <= buyCnt` 判断「已有单」，而 `buyCnt` 每轮变化 | 上轮挂多、这轮缺口变小时，同房同资源被**重复挂新单**，互相干扰计价 | 用 `remainingAmount > 0` 判「已有单」，再按缺口决定 extend/改价 |
| `strategy_claimCrossShard.js:111-129/135-151` | 每 300/1000 tick 无条件派发 claimer/worker | 不检查是否已有在途/存活的任务，失败会持续重发 | 加「已有未超时任务」去重 |
| `strategy_tradeCrossShard.js:158-170` | 跨分片请求用固定 id `"trade_"+shard`，而 `applyRequest` 见到同 id 直接 return | `Memory.trade.*` 长时间不刷新（要等 5000 tick 超时） | 用带时间戳/递增的 id |
| `war_attackRoom.js:51-52` | `if (!flag) return;`（suicide 被注释掉） | `team_1_*` 旗子会被 `WarTeamFlag` 的 `FLAG_TTL=3000` 删除，而跨分片行军可能 >3000 tick → 攻击爬**永久空转占 CPU 且不自杀** | 恢复 `this.suicide()`，或给长行军团队豁免 TTL |
| `team_raL1.js:51-65` | `roundRoom[creep.memory.lastRoomIndex]` 无边界检查 | `roundRoom` 只有 14 项，下标越界后 `new RoomPosition(25,25,undefined)` 抛错、巡游停止 | `lastRoomIndex %= roundRoom.length` |

---

## 3. P2：CPU 热点（按预期收益排序）

`unitTasks` 10.95 里 `harvestEnergyKeeper(3.63) + carrier(3.43) = 7.06`，占 65%。但这两类爬的**业务逻辑本身很轻**，说明开销主要来自「每个爬每 tick 都要付的通用税」。因此高收益项集中在常数开销上。

### 2-1 移动层：每次 `moveTo` 付「两层包装 + rest 数组 + ops 克隆」的固定税

**位置**：`超级移动优化hotfix 0.9.4.js:1616-1633`（moveTo 包装）、`:1130-1147`（`wrapFn`）、`:1218-1220`（ops 克隆）

```js
Creep.prototype.moveTo = function (...e) {          // :1616 rest → 新建数组
    let lastPos = memory.lastPos;
    ...
    memory.lastPos = { x: pos.x, y: pos.y, roomName: pos.roomName, time: 0 };  // :1628 新建对象写 Memory
    return this.$moveTo(...e)                        // :1632 展开 → 再走一层
};
function wrapFn(fn, name) {
    return function () {
        if (obTick < Game.time) { ... }
        if (!enableCpuStats) return fn.apply(this, arguments);   // :1137 apply(arguments) 不利 JIT
    }
}
if (ops.visualizePathStyle && ... && !isCpuFeatureEnabled("visual")) {
    ops = Object.assign({}, ops, {visualizePathStyle: undefined});  // :1219 克隆一个对象
}
```

**代价**：每次 `moveTo` ≈ 4 处分配 + 1 次 Memory 写。87 只爬里持续移动的约 60-80 只，每 tick 常见 1-3 次 `moveTo` → **约 100-200 次调用/tick，即 400-800 次对象分配/tick**。

注意 `:1218` 的写法把「画路的开销」换成了「克隆对象的开销」——**开关并没有真正省下 CPU**。

**建议**：

- `:1219` 改为原地剥离 `ops.visualizePathStyle = undefined`（调用点的 ops 基本都是字面量）；
- 三层包装合并成一层，`wrapFn` 用形参代替 `arguments`/`apply`；
- `lastPos` 本身是卡位检测用的每 tick 信息，挪到 `Game` 上的 tick 级缓存即可，不必写 Memory。

### 2-2 动作包装无条件写 Memory（约 45-60 次脏写/tick）

**位置**：`超级移动优化hotfix 0.9.4.js:1642-1688`

```js
Creep.prototype.harvest = function (...e) {
    this.memory.dontPullMe = true;   // 无条件写，值没变也写
    return this.$harvest(...e)
};
// 同理 build / repair / upgradeController / dismantle / attack
```

没有 `!== true` 守卫。keeper 每 tick `harvest`（`station_sources.js:195`）、upgrader 每 tick `upgradeController`、builder 每 tick `build/repair` → 约 **45-60 次无条件 Memory 写/tick**，在 147KB 的 Memory 上持续把它标记为脏、加重序列化。

对照 `station_sources.js:239-240` 已经做了「变化才写」的守卫，说明是漏改。

**建议**：加 `if (this.memory.dontPullMe !== true) this.memory.dontPullMe = true;`，并去掉 rest 参数。

### 2-3 register 回写：满编 carrier 每 tick 无条件写数组

**位置**：`station_sources.js:352-363`、`:409-419`；`prototype_creep.js:167-188`

```js
let alive = rmHarList.filter(id => Game.getObjectById(id));
if (!alive.contains(this.id)) alive.push(this.id)
source["carryCreeps"] = alive;   // :361 「必须始终写回」
```

`main.js:26` 还会在**角色过滤之前**对全部 87 只爬跑 `execRegFun`（与 MIN_CPU 无关）。

**代价**：约 37 只 carrier × 每 tick 1 次 Memory 数组写 + N 次 `getObjectById`。同文件的 `registerStationSources`（`:16-24`）已做 changed 守卫，可照抄。

**建议**：改为「内容变化才写回」；`execRegFun` 只对活跃爬执行。

### 2-4 `harvestEnergyKeeper` 每 tick 重复查询

**位置**：`station_sources.js:154-242`

```js
let source = Game.getObjectById(task.id);                              // :159
let station = Memory.rooms[task.roomName][pro.stationName][task.id];   // :160 三次下钻
let container = Game.getObjectById(station["container"]);              // :161
let link = Game.getObjectById(station["link"]);                        // :163
let link2 = station["link2"] ? Game.getObjectById(station["link2"]) : undefined;  // :165
let occupied = container.pos.lookFor(LOOK_CREEPS).length > 0           // :169
    || container.pos.lookFor(LOOK_POWER_CREEPS).length > 0;            // :170
```

按 telemetry 3.63 CPU / 约 26-30 只 keeper ≈ **0.12 CPU/只/tick**，对这点逻辑明显偏高，主要就是这些引擎查询与 Memory 访问的常数开销。

**建议**：把 `source/container/link/link2` 用 tick 级实例缓存（`creep._srcCache`）在首次解析后复用；`occupied` 检查并入已有的 `%9`/`%3` 节流。

### 2-5 `carryEnergyAuto`：每只空手 carrier 每 tick 建数组 + sort

**位置**：`prototype_creep.js:518-578`

```js
let candidates = [];                                     // :537 每 tick 新建
_.values(room.memory[StationSources.stationName]).forEach(data => {
    let container = data && Game.getObjectById(data.container);   // :543 每个源一次查询
    candidates.push({object:container, available:..., type:"container"});  // :545 每候选一个对象
});
candidates.sort((a, b) => b.available - a.available);     // :549 每爬每 tick 一次 sort
```

同一房间同时有 5-10 只空手 carrier 时（补员后常见），就是 **5-10 次 sort/tick + 5-10×源数 次 getObjectById/tick**，且各爬结果完全相同。

**建议**：按房间做 tick 级缓存，各 carrier 共享只读的已排序候选数组；用原生 `for` 找最大替代 `sort`。

### 2-6 外矿道路的 O(路径长度) 扫描与字符串键

**位置**：`station_sources.js:991-1003`、`:1124-1142`、`:1053-1108`

- `nextRoadPathIndex` 全路径线性扫描（跨 2-4 房，常 100-300 个路点），最多 2 次/tick/爬；
- `nearestOuterRoadSite` **每次调用重建整张 `routeIndex`**（O(pathLen) + 对象分配）；
- `moveToOuterRoadPoint` 每 tick 拼两个字符串做键并写回 memory-backed task。

按约 13 只外矿 carrier、pathLen≈150 估：**约 2000-8000 次比较/tick** + 26 个字符串/tick + 每 tick 4 个 task 字段 Memory 写。

**建议**：`routeIndex` 按 tick 缓存到 `Game`；`nextRoadPathIndex` 改为「上次 index 附近 ±3 窗口」搜索；键改数值比较。

### 2-7 `Array.prototype.find` 等被 lodash 覆盖（全局系统性税）

**位置**：`utils.js:1-16`

```js
Array.prototype.find  = function(...e){ return _.find(this,...e) };
Array.prototype.sum   = function(...e){ return _.sum(this,...e) };
Array.prototype.head  = function(){ return _.head(this) };
Array.prototype.last  = function(){ return _.last(this) };
Array.prototype.contains = function(a){ return _.includes(this,a) };
Array.prototype.flat  = function(){ return _.flatten(this) };   // 丢掉 depth 参数
```

原生 `Array.prototype.find` 在 V8 里可内联；覆写成 `_.find` 后每次多付 rest 数组 + spread/apply + lodash 的 iteratee 解析。`.find(` 在代码里出现约 200 处，热路径每 tick 几十次。`head/last` 更是被 `Creep.lastTask/headTask`（`prototype_creep.js:195-200`）每 tick 多次调用。

**建议**：不要 shadow 原生方法。`find` 直接用 `_.find` 显式调用；`lastTask/headTask` 改 `arr[arr.length-1]` / `arr[0]`；`flat` 保留 `depth` 参数或改名。

### 2-8 `hasActiveBodypart` 每次 `moveTo` 全量扫身体

**位置**：`超级移动优化hotfix 0.9.4.js:294-308`，被 `:1244` 每 moveTo 调用

```js
function hasActiveBodypart(body, type) {
    for (var i = body.length - 1; i >= 0; i--) {
        if (body[i].hits <= 0) break;   // 没受伤 → 全量扫描整个 body
        if (body[i].type === type) return true;
    }
}
```

健康的 30-50 部件大爬 → 每次 30-50 次迭代；按 100-200 次 moveTo/tick，**约 3000-8000 次迭代/tick**。

**建议**：按 tick 在实例上缓存结果，或只检查身体末端的 MOVE 部件。

### 2-9 `trySignController` 对全部 87 只爬每 tick 调用

**位置**：`prototype_creep.js:238-239`（每只爬的 `execLastTask` 入口）

```js
if (global.StationUpgrade && this.room.my && this.room.controller
    && StationUpgrade.trySignController(this)) return this;
```

虽然每次只做几次属性读 + 一个 `room._controllerSignText` 缓存，但属于纯固定税（已签名的房间每 tick 都要重新判断一遍）。

**建议**：按房缓存判定结果，或让「本 tick 已确认签名正确」的房间直接短路。

### 2-10 `station_observer` 每 tick Memory 写 + 重复整房扫描

**位置**：`station_observer.js:32-34`、`:147-204`、`:138-146`

- `watchRoom` 每 tick 对 `Memory.observerWatch[room]` 赋值（Memory 脏写）；
- `observeLastRoom` 每 tick 做 `FIND_DEPOSITS` + 带 filter 的 `FIND_STRUCTURES`；
- `inNovice`（`:139`）对每个 deposit/powerBank 再各做一次整房 `FIND_STRUCTURES`。

**建议**：只在 `u` 真的变化时写 Memory；`inNovice` 结果按房缓存；结构扫描复用 `room.getStructures()`（`prototype_room.js:63` 已有 tick 缓存）。

### 2-11 其它较小的热点

- `station_upgrade.js:61-76` 的 `getUpgradeReservations` 每房每 tick 一次 `find(FIND_MY_CREEPES)`+`filter`+`sort(localeCompare)`；`getUpgradePosition`（`:306-321`）缓存失效时做 49 格 `lookFor` + `sort`。建议 sort 改数值键、评分改线性扫描取最小。
- `极致建筑缓存 v1.4.3.js:68-74` 的 `getRoomResolvedStructures` 每房每 tick 一次 `find(FIND_STRUCTURES)` + 建 id→对象 map，与 `prototype_room.js:63` 的 tick 缓存功能重叠，可合并。
- `station_sources.js:1309`（`trySpawnOuterHarKeeper`）对每个矿点 `spawnRoom.creeps(...).filter(e => e.headTask()...)`，是 O(矿点 × keeper) 的 `headTask()` 调用；`:1298-1299` 每 tick `for-in` 遍历整个 station Memory 删假值键。建议先取一次 keeper 列表和 id 集合再比较，并节流。
- `main.js:15` 的 `objects.rooms.forEach(room => room.used = {})` 每 tick 新建 20 个对象；`main.js:86` 的 `activeCreeps` filter 与 `ManagerCreeps.init` 的遍历可以合并成一次。
- `prototype_creep.js:792` 的 `autoHeal` 在判定里可能整房 `find(FIND_STRUCTURES)`，建议复用 `room.getStructures()`。

---

## 4. P3：死代码与一致性清理

### 4-1 已确认可删除的死代码

| 位置 | 内容 |
|---|---|
| `teamL2.js:50-99` | 连续 4 个 `global.teamL2Path = {...}`，前 3 个被覆盖；`:332` 的 `console.log` 是调试残留 |
| `war_attackRoom.js` | `global.atkRoom2Path`（`:71-89`）、`getBoostWork/getBoostHeal`（`:93-101`）、`workB4Team`（`:112`）、`execSpawnWorkB4`（`:163`）、`getRangeAttack`（`:102`）、`range1Team`（`:122`）、`execSpawnRA1`（`:193`）——对应调用点均被注释（`:242-246`） |
| `war_teamFlag.js:13-24` | `spawn_pro.getAttack/getRangeAttack/getHeal` 只被注释掉的测试块使用 |
| `war_powerCreepOperator.js:120-123/154-157` | `registerOpsCarrier`、`registerDisableController` 是空函数；`getBoostWork/getBoostAttack/getBoostHeal`（`:93-101`）无调用 |
| `war_teamCore.js` | `global.warMap`（`:13-19`）无读写；`:191-195`、`:733-745`、`:354`、`:796-806` 为注释死块；`:303` 在 `:300` 已 return 后不可达 |
| `strategy_deposits.js:27-40` | `harvestDeposit` 重复定义，被 `:66-93` 覆盖 |
| `strategy_cleaBuild.js:50-58` | 依赖 `this.memory.lastPos`，而该字段从未被写入 → 分支不可达 |
| `strategy_pillage.js:109-111` | 空的 `getBoostPillagerBodyConfig` |
| `strategy_atkL2.js:65/:76`、`team_raL1.js:12` | `global.atkl2Target` / `raL1Target` 只被读取、从未赋值 → `forcedTarget` 恒为死分支 |
| `strategy_tradeCrossShard.js:76-78`、`strategy_claimCrossShard.js:11-65` | 大段被注释的历史 path 数据 |
| `manager_crossShard.js:41-52` | `testStart/testEnd` 调试桩 |
| `strategy_defenserHighWay.js:95-101` | `checkDefense` **全仓库无调用点** → 整个过道防御模块是 no-op，`getDefenseHighWayData`（`:45`）也是死函数。要么补调用，要么删模块 |
| `strategy_powerBank.js:475-476/480/489-495` | `flag.memory.beingAttack` 只读不写（赋值在注释里）→ 「被攻击时强制出兵」分支永不触发 |
| `war_cache.js:48` | `Memory.rooms[roomName].tower = ...` 立刻被下一行覆盖，死赋值。同处 `:53-54` 用 `e.effects` 取指纹，而 `processed` 里的字段是 `effect` → **算子塔效果变化无法触发缓存失效** |

### 4-2 明确的笔误 / 不一致 ✅

| 位置 | 现状 | 问题 | 建议 |
|---|---|---|---|
| `prototype_roomPostiton.js:249` ✅ | `(roomCoordinate.x<<18)+(roomCoordinate.x<<12)+(this.x<<6)+this.y` | `y` 从未参与运算、`x` 用了两次 → **同一列（同 x 不同 y）的房间、相同房内坐标会得到相同哈希**。该哈希被 `war_teamCore.js:474/484/634`、`strategy_GCLRoom.js:383/392` 当 Set/Map 键用 | 改位段不重叠，如 `(coord.x<<20)+(coord.y<<10)+(x<<5)+y` |
| `prototype_roomPostiton.js:235-237` ✅ | `RoomPosition.prototype.createFlag = function(...){ ... }` | 覆盖了原生方法却**没有 `return`**，调用方拿到 `undefined`（原生返回 flag 名或 `ERR_*`） | 补 `return`，或保留原生实现 |
| `manager_rooms.js:33` ✅ | `if (!room.Memory) room.Memory = {};` | 写成 `room.Memory`（大写）。全仓库只此一处、无任何读取，setter 目的（确保 `room.memory` 存在）根本没达到 | 改 `room.memory` 或删除 |
| `极致建筑缓存 v1.4.3.js:116-124` ✅ | `Room.prototype.__proto__ = new Proxy({}, { get(cache,id){ if (typeof id=="string" && id.length==24) return Game.getObjectById(id); return undefined; } })` | 有 `get` trap 却不转发 `has/ownKeys/getPrototypeOf`，**未知属性不再回落到 `Object.prototype`** → `room.hasOwnProperty`/`toString`/`constructor` 全部变成 `undefined` | trap 里先 `Reflect.get(target,id)`，并转发 `has/getPrototypeOf`；或改成显式 `room.getObjectById(id)` |
| `prototype_room.js:52` | 注释称 Proxy「returns null for unknown fields」 | 实际返回 `undefined`（这正是 `getHostileCreeps` 要用 `Array.isArray` 判断的原因） | 修正注释，避免误导 |
| `极致建筑缓存 v1.4.3.js:313-333` ✅ | `let last_fetch_time = 0;` 在 getter 里 `if (last_fetch_time < Game.time) return sum = this.mass_stores.reduce(...)` | `last_fetch_time` **从未被赋值** → 缓存完全不生效（每次访问 `room.energy/power/...` 都重算）。更危险的是：一旦有人补上 `last_fetch_time = Game.time`，这个 module 级闭包会在**所有房间之间共享 `sum`**，造成同 tick 跨房串值 | 改为按房缓存（`this['_resSum_'+type]`），或直接删掉这段未被业务使用的 getter |
| `helper_visual.js:57-64` | `roomMap` 是 module 级缓存，`getRoomVisual` 缓存 `new RoomVisual(...)` 且从不清理 | `RoomVisual` 只在创建的 tick 有效，复用上一 tick 的实例**不会渲染** → 每个房间名第一次之后的可视化全部静默不显示 | 按 tick 失效（缓存挂到 `Game`），或每次 `new RoomVisual` |
| `strategy_tradeCrossShard.js` | `global.StrategytradeCrossShard=` （大小写错） | 正确名 `StrategyTradeCrossShard` 在 `main.js:74` 使用；这个死全局容易被误用 | 删除 |
| `manager_creeps.js:1-15` + `main.js:86` ✅ | `objects.creeps.filter(e => (!MIN_CPU \|\| ROLE_PRIORITY[e.memory.role] > 0) && ...)` | `ROLE_PRIORITY` 未列出的 role → `undefined > 0 === false` → MIN_CPU 下**完全不执行且无日志**。未列出但代码在用的 role 至少包括 `reserver`、`claimer`、`harvestMineralKeeper`、`outerHarvestEnergyCarrier`、`outerHarvestDefenser`、`minRoomWorker`、`pillager` 等，其中外矿 keeper/reserver 属于经济命脉 | 默认放行（`(ROLE_PRIORITY[role] ?? 1) > 0`），只把明确要停的 role 记为负数，并在冻结时 `Logger.warning` 一次 |
| `helper_visual.js` / `getRef` 无关；`MODULES.tsv` | 列出了磁盘上不存在的 `调用栈分析器.js`、`闲聊 v1.0.js`、`algo_wasm_priorityqueue.js`，且缺少 `helper_consoleLogger.js`、`helper_consoleDashboard.js` ✅ | 与实际 `modules/`（70 个文件）不一致，会误导排查 | 删掉或由 `scripts/build-core-payload.cjs` 重新生成 |
| `helper_roomResource.js`（16.5KB） | `global.HelperRoomResource` 除自身注释/控制台片段外无调用 ✅ | 唯一实际贡献是 `global.RES_COLOR_MAP`（被 `helper_consoleLogger.js:49` 使用） | 把 `RES_COLOR_MAP` 抽到 `helper_consoleLogger`，其余按需加载 |

### 4-3 关于快照里的两个大文件（澄清）

`闲聊 v1.0.js`（93KB）与 `调用栈分析器.js`（26KB）**只存在于 `.screeps-code.json` 快照和过期的 `MODULES.tsv`**，磁盘 `modules/` 与 `deploy/core-modules.json` 里都没有 ✅ —— 线上不会加载它们，无需处理。

唯一需要留意的是 `调用栈分析器.js`：它会给约 90 个热函数（含 `Creep.prototype.moveTo`）再包一层。若将来临时挂载调试，会与 `超级移动优化` 的包装叠加成三层并污染性能归因。**别把它加进生产上传包。**

---

## 5. Memory 瘦身清单

当前 `Memory` 序列化体积 **147KB**（每 tick 都要过一遍）。按预估收益排序：

| 目标 | 位置 | 预估 | 安全性 |
|---|---|---|---|
| `Memory.codeHealth.moduleCpu` | `main.js:252` | **~4.6KB** | 安全。它是 `HelperCpuUsed.profileSummary()` 的完整副本，而同样的数据已在 `Memory.cpuModuleTelemetry`（4.5KB）里；dashboard（`helper_consoleDashboard.js:139`）只用 `moduleCpu.rooms` 一列，改为按需调用即可 |
| `Memory.codeHealth.phases` 里的 `roomDetails` | `main.js:210-213`、`:251` | **~1~1.5KB** | 安全。`Game._coreCpuProfile.roomDetails` 覆盖**所有可见房**（含观察房/过道），而 telemetry 只记自有房；落盘前删掉这一项 |
| `Memory.cpuTelemetry` / `cpuModuleTelemetry` 浮点降精度 | `helper_cpuUsed.js:116-153`、`:192-199` | **数 KB**（现 10.4 + 4.5KB） | 安全。`sum += cpu` 累加全精度浮点，序列化后每个数字 15-17 字符；改成乘 1000 取整存储 |
| `Memory.creeps[*].lastPos` | `超级移动优化:1628` | **~3KB** | 安全。78 只爬 × ~40B，且随移动每 tick 重写；挪到 `Game` 的 tick 级缓存 |
| `Memory.codeHealth.lastError` 系列 | `helper_error.js:46-49` | ~0.8KB | 安全。纯诊断，收到 `Memory.debug` 开关下 |
| `Memory.codeHealth.cpuLongTerm` | `main.js:245` | ~0.3KB | 安全。派生自 `cpuTelemetry`，dashboard 按需调 `longTermSummary()` |
| `Memory.rooms[*].hashCode` | `prototype_room.js:71-74` | 每房 ~10B | 安全。可由房名直接派生（但注意 P0-1 修完后就不再依赖它的奇偶性） |
| `Memory` 里控制台手工写入的调试串 | `_roomDiag`、`diagPath`、`_pcLevel`、`_mineProbe`、`_throttle`、`_cred` 等 | 数 KB | 安全。**代码库里没有任何写入点**（全仓 grep 无匹配），是控制台留下的；建议加一次性/周期性 prune |

**不建议整删**：

- `Memory.rooms`（50.8KB）：`structMap` 是建造/维修/蓝图的功能数据；
- `Memory.observerWatch`（22.4KB）：承载 deposit / PowerBank / 观测调度，可调紧 `pruneWatch` 阈值瘦身，但不要整删。

---

## 6. 建议的修复顺序

**第一批（纯功能恢复，收益最大、改动最小）**

1. P0-1 市场 `%80` 门控 —— 影响 12/13 个房间的经济
2. P0-3 防御队死一半卡死（含 `flag.room` 空引用）
3. P0-4 `clearPathCache` 门闩
4. P0-5 `delete Game.creeps` 改 `memory.tasks = []`
5. P1-3 市场三处 `.has(e)` → `.has(e.roomName)`
6. P1-6 `throwAllError` 不再抛

**第二批（lab / 经济链路）**

7. P1-1 lab 反应期间派产物搬运任务
8. P1-2 `BOOST_RES_HOLD` X 级持有线调低 + 目标轮换
9. P1-4 `isEnergyAbundant` 解耦（本房 vs 账号）
10. P1-5 storage 近满发送加需求校验与冷却
11. P2-3 / P2-5 register 回写与 `carryEnergyAuto` 缓存

**第三批（CPU 与内存）**

12. P2-1 / P2-2 移动层与动作包装（一次改动能覆盖所有角色）
13. P2-4 / P2-6 keeper 与道路缓存
14. 第 5 节 Memory 瘦身
15. P3 死代码清理

**验证方法**：本项目已有现成的观测手段，改完直接读：

- CPU 相位/角色/房间：`Memory.cpuModuleTelemetry`（每 97 tick 采样一次）
- 长周期趋势：`Memory.cpuTelemetry` + `Memory.codeHealth.cpuLongTerm`
- 异常：`Memory.codeHealth.lastError` / `errorCount` / `missingTaskHandlers`

改动上线后对比 `phases.unitTasks`、`phases.rooms` 与 `roles.carrier / harvestEnergyKeeper` 的均值即可量化收益。

---

## 附：本次审查的验证状态

- **✅ 标注项**：已在本次审查中通过「读代码 + 线上 Memory / API 实测」直接复核。其中 **P0-1 是用 136 个房间的真实 `hashCode` 逐一代入验证的**（17 命中 / 119 失效），不是推断。
- **未标注项**：来自静态分析，行号与代码片段均可核查，但我未逐条实机验证行为。建议按第 6 节顺序处理，每批改完做一次线上观测对比。
- 本次审查为只读，**未修改任何代码**；`git status` 干净，HEAD 仍为 `65e8206`。
