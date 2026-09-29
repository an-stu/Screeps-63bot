# Screeps-63bot 项目长期约定

## 行尾（用户明确要求记住）

- **工作区一律 CRLF，git index 一律 LF**，由 `.gitattributes` 保证：
  `*.js / *.cjs / *.json / *.md / *.tsv   text eol=crlf`
- 用户本机的工具默认写 CRLF，我改文件会整份写成 LF。两边都会经 git 归一化成 LF 入库，
  所以**谁改都不会再产生行尾噪声**，改完不需要手工还原字节。
- 历史教训：modules/ 曾有 53/70 个文件是「CRLF 里掺 LF」，任何全文件重写都会产生几千行
  纯空白 diff（最严重 3263 行）。不要用「按行还原 HEAD 字节」的 workaround 了。

## 仓库与部署

- 仓库 `github.com/an-stu/Screeps-63bot`，shard3，账号 `an_w`，CPU 上限 20。
- 部署三步：`node scripts/build-core-payload.cjs` → POST `/api/user/code` → 重新 GET 并
  **按模块名逐个 sha256 比对**（只看 `ok:1` 不够）。脚本在 `.workbuddy/tmp/deploy.py`，
  会自动先备份线上代码。
- 二进制模块（wasm 优先队列）取自 `.screeps-code.json` 快照，不要试图从源码重建。
- 改代码后跑 `node --check` + `test/*.cjs`（4 个）+ `scripts/audit-core-tasks.cjs`
  （确认新 taskName 都有 handler）。

## 游戏内排查的硬约束

- 控制台**只接受单条 `return ...`**，多语句静默丢弃；整串长度上限约 850~1050 字符。
- 结果走 socket，REST 拿不到 → 必须写进 Memory 再读回；主循环会覆盖约一半写入，
  要换 key 重试；`__probe*` 键用完必须清。
- 原型/全局方法的插桩**不能**用 `delete global.__RP` 收尾（闭包引用会抛异常），
  要**重新上传一次代码**让 global 重建。
- Screeps API 会间歇性 TLS 断连（`SSLEOFError`），`screeps_api.req` 已加重试。

## 数值口径

- 塔：射程 ≤5 时 600 伤/发；一体机 raBody1 自愈 12×12×4 = 576/发，XGHO2 让入射伤害 ×0.3，
  所以 3 塔 1800×0.3=540 < 576 → **塔下零伤害**。判断扛不扛得住先算这个不等式。
- 中间九房 source：容量 4000、每 300 tick 重置 → 重置速率 **13.33 能量/tick**。
  keeper 的 WORK 必须超过这个数（现 `outerMaxPartCnt=5` → 10 WORK = 20/tick）。
- 建造：1 能量换 1 进度（BUILD_POWER=5，每 WORK 每 tick 消耗 5 能量、产出 5 进度），
  所以 5000 的容器要运 5000 能量。

## 已知长期未处理

- `war_cache.js:257` 恒真式（意图不明，未动）。
- `strategy_resourceBalance` 跨房终端搬运没有在途记录（量化过：225 tick 里只有 10 次
  send，实际损失约 5 energy，**决定不修**）。
- CPU 稳态 ~20.2（超限时 tick 占 43%），增量在 unitTasks；`harvestEnergyKeeper`
  4.39/tick 是单条最大项，尚未定量归因。
