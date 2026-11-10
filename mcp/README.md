# Screeps MCP

把 Screeps 的 HTTP API 包装成 MCP 工具，支持读取游戏遥测、房间和市场。显式开启写权限后，
可以执行控制台命令、写 Memory 和部署代码。

服务通过 stdio 使用 JSON-RPC，仅使用 Node 内置模块，无需安装 npm 包。

## 需要什么

| 项 | 说明 |
|---|---|
| Node | ≥ 18.17，使用内置 `fetch` 和 `AbortSignal.any` |
| Token | Screeps 账号 token（Account → Auth token）。写在 `<repo>/.workbuddy/screeps-token`，或用环境变量 `SCREEPS_TOKEN` |
| 配置 | Codex 用 `codex mcp add` 注册。WorkBuddy 在其 `mcp.json` 登记，再在连接器管理页信任该服务 |

从仓库根目录注册到 Codex，使用 Node 和入口的绝对路径。注册后在新会话中使用。

```bash
codex mcp add screeps --env SCREEPS_ALLOW_WRITE=0 -- "$(command -v node)" "$PWD/mcp/screeps-mcp.mjs"
codex mcp get screeps
```

## 官方参考

- [Screeps 文档与教程](https://docs.screeps.com/index.html)涵盖游戏机制、脚本、CPU 和外部部署。
- [Screeps 游戏 API](https://docs.screeps.com/api/)用于核对 `Game`、`Memory`、对象属性和方法的行为。
- [HTTP 认证与限流](https://docs.screeps.com/auth-tokens.html)适用于此 MCP 发起的外部请求。

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `SCREEPS_TOKEN` | 读 `.workbuddy/screeps-token` | 认证 |
| `SCREEPS_REPO` | 服务入口所在仓库 | 用于定位 token、构建脚本和产物 |
| `SCREEPS_SHARD` | `shard3` | 分片 |
| `SCREEPS_BASE` | `https://screeps.com` | 也可指向私服 |
| `SCREEPS_ALLOW_WRITE` | 未设（只读） | `1` 才允许 `console`、`memory_set` 和实际部署 |
| `SCREEPS_TIMEOUT_MS` | `15000` | 每次 API 调用的超时预算，包含 GET 重试 |
| `SCREEPS_MCP_WAIT_MS` | `2000` | 控制台提交后的首次等待 |
| `SCREEPS_MAX_OUTPUT_KB` | `512` | 工具结果的 UTF-8 字节上限（KiB） |
| `SCREEPS_MCP_DEBUG` | 未设 | `1` 时把请求/重试诊断打到 stderr（不污染 stdio 协议） |

## 工具

| 工具 | 读/写 | 说明 |
|---|---|---|
| `status` | 读 | 最近一次 Memory 遥测，包含采样 tick、运行版本、CPU、bucket、GCL/GPL、爬数和房间 RCL。旧游戏代码的运行版本显示为 `null` |
| `console` | 写 | 执行一条表达式并读回结果，支持 `return X`、多语句块和单表达式 |
| `memory_get` | 读 | 读 Memory 子树（自动解 `gz:` 压缩值） |
| `room_objects` | 读 | 读房间对象快照（免控制台侦察） |
| `overview` | 读 | 官方统计：各分片房间数、每房 CPU 最新值、账号累计产出 |
| `market_orders` | 读 | 指定 `resourceType` 查询挂单，按类型过滤，卖单优先低价、买单优先高价 |
| `memory_set` | 写 | 覆盖写 Memory 某个点分路径（需 `SCREEPS_ALLOW_WRITE=1`） |
| `deploy_code` | 预览 / 写 | `dryRun: true` 返回模块差异、`liveHash` 和 `payloadHash`。实际部署需要写权限，并把两份哈希传给 `expectedLiveHash` 和 `expectedPayloadHash` |

每个工具都带 MCP `annotations`（`readOnlyHint` / `destructiveHint`），客户端可据此做二次确认。

部署使用 `scripts/build-core-payload.cjs` 产物，默认每次重新构建。预览只在本地构建并读取
目标分支。正式部署会核对本地产物和线上分支的预览哈希，保存备份后才上传，随后回读同一分支逐模块校验。
`skipBuild` 使用已有产物。全包覆盖前先确认差异和 CPU bucket。Screeps 的上传接口不支持条件写入，
核对与上传之间仍可能发生其他客户端的写入。

## 控制台与 Memory

1. **控制台取回走 Memory**：`/api/user/console` 的响应不含返回值，所以表达式会被包成
   `Memory.__mcpProbeN = JSON.stringify(...)`，再读 `/api/user/memory?path=...` 取回。
   命令只提交一次，随后轮询独立探针。结果缺失时先核对游戏状态，再决定是否重试。
2. **Memory 大值会被压缩**：接口返回 `gz:<base64(gzip(json))>`，需要 gunzip 后再 JSON.parse。
   `decodeMemoryValue()` 负责这部分（console 与 memory_get 都走它）。
3. **合法假值不是"没读到"**：结果统一包成 `{v: <值>}` 再序列化，所以 `null` / `""` / `0` / `false`
   都能正确返回（早期版本把 `null` 当未写入，会一直轮询到超时）。
4. **探针清理是尽力而为**：成功、失败和取消时都等待清理请求返回。接口只确认命令入队，游戏端仍可能未落盘。

## 测试

`test/mcp-server.test.cjs` 是离线集成测试：本地 mock 顶替 screeps.com，把 stdio 协议真跑一遍，
覆盖协议协商、取消、只读隔离、控制台表达式与探针清理、压缩解码、UTF-8 截断、市场字段和指定分支部署。

```bash
node test/mcp-server.test.cjs
```

## 约束与已知边界

- 控制台单条表达式实测上限约 **843 字符**；工具在 **700 字符**就提前报错，避免白等十几秒。
- `console` 就是游戏控制台，**能改状态**（annotations 里标了 `destructiveHint`）。查询请只写只读表达式；
  改状态优先走 `memory_set` / `deploy_code`（有显式开关）。
- 只读模式仍可调用 `deploy_code` 的预览。`status` 依赖游戏已有的 `Memory.codeHealth` 和 `Memory.stats`。
- **HTTP 请求只对 GET 重试**：POST 可能已把副作用落到线上（改 Memory / 传代码），
  响应前断网时无法判断是否成功，重试等于赌一把，所以直接报错。
- 工具结果超过 `SCREEPS_MAX_OUTPUT_KB` 会截断。HTTP 响应和 Memory 解压各限 16 MiB，可用更具体的 `path` 缩小范围。
- token 在进程启动时读取一次；换 token 后需要重启连接器。

## 本地自测

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status","arguments":{}}}' \
 | SCREEPS_REPO=/Users/an/Documents/Screeps node mcp/screeps-mcp.mjs
```

## 版本记录

`1.2.0` 将控制台纳入写权限，改用只读状态遥测，修复市场挂单字段，增加协议校验和取消，
并要求实际部署核对预览指纹、完成备份和指定分支回读。
