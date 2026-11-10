# Screeps MCP

把 Screeps 的官方 HTTP API 包装成 MCP 工具，让 AI 直接读实时状态、执行控制台表达式、查市场，
不用每次临时写探针脚本。

**零依赖**：只用 Node 内置能力（`fetch` / `zlib`）实现 MCP 的 stdio + JSON-RPC，
不需要 `npm install` —— 本机网络间歇 TLS 抖动，装包不可靠，而且省掉 node_modules 这个长期维护面。

## 需要什么

| 项 | 说明 |
|---|---|
| Node | ≥ 18（`fetch` 内置）。本机：`/Users/an/.workbuddy/binaries/node/versions/22.22.2-6/bin/node` |
| Token | Screeps 账号 token（Account → Auth token）。写在 `<repo>/.workbuddy/screeps-token`，或用环境变量 `SCREEPS_TOKEN` |
| 配置 | `~/.workbuddy/mcp.json` 里登记本 server（已写入），然后在连接器管理页对这个 server 点 **Trust** 才会生效 |

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `SCREEPS_TOKEN` | 读 `.workbuddy/screeps-token` | 认证 |
| `SCREEPS_REPO` | 当前目录 | 用于定位 token 与 `modules/` |
| `SCREEPS_SHARD` | `shard3` | 分片 |
| `SCREEPS_BASE` | `https://screeps.com` | 也可指向私服 |
| `SCREEPS_ALLOW_WRITE` | 未设（只读） | `1` 才开放 `memory_set` / `deploy_code` |
| `SCREEPS_TIMEOUT_MS` | `45000` | 单次 HTTP 超时 |
| `SCREEPS_MCP_WAIT_MS` | `2000` | 控制台写入后的首次等待（网络慢可调大） |
| `SCREEPS_MAX_OUTPUT_KB` | `512` | 单次工具结果上限，超出截断并提示 |
| `SCREEPS_MCP_DEBUG` | 未设 | `1` 时把请求/重试诊断打到 stderr（不污染 stdio 协议） |

## 工具

| 工具 | 读/写 | 说明 |
|---|---|---|
| `status` | 读 | 实时：tick、版本、CPU bucket/used、GCL/GPL、爬数与房间数、各房 storage/terminal 能量 |
| `console` | 读 | 执行一条表达式并取回返回值（支持 `return X` / 多语句块 / 单表达式） |
| `memory_get` | 读 | 读 Memory 子树（自动解 `gz:` 压缩值） |
| `room_objects` | 读 | 读房间对象快照（免控制台侦察） |
| `overview` | 读 | 官方统计：各分片房间数、每房 CPU 最新值、账号累计产出 |
| `market_orders` | 读 | 市场挂单查询（可按资源/类型过滤） |
| `memory_set` | 写 | 覆盖写 Memory 某个点分路径（需 `SCREEPS_ALLOW_WRITE=1`） |
| `deploy_code` | 写 | 走仓库正规链路：`build-core-payload.cjs` → 备份线上 → 上传 → 逐模块比对（需 `SCREEPS_ALLOW_WRITE=1`，支持 `dryRun` / `skipBuild`） |

每个工具都带 MCP `annotations`（`readOnlyHint` / `destructiveHint`），客户端可据此做二次确认。

> 注：`deploy_code` 是**整包覆盖**，所以它不直接读 `modules/*.js` —— 那样会绕过
> `build-core-payload.cjs` 的产物（profile 处理等），和 `check-sync` 的口径对不上。
> 它先跑构建、备份线上、上传后逐模块比对；部署前仍建议先问一次 `check-sync`，
> 确认没有别人推的改动会被覆盖。

## 两个必须知道的实现细节

1. **控制台取回走 Memory**：`/api/user/console` 的响应不含返回值，所以表达式会被包成
   `Memory.__mcpProbeN = JSON.stringify(...)`，再读 `/api/user/memory?path=...` 取回。
   主循环会丢弃约一半的 console 写入，因此是「写 → 等 → 读 → 没读到就重写」，键名每轮唯一。
2. **Memory 大值会被压缩**：接口返回 `gz:<base64(gzip(json))>`，需要 gunzip 后再 JSON.parse。
   `decodeMemoryValue()` 负责这部分（console 与 memory_get 都走它）。
3. **合法假值不是"没读到"**：结果统一包成 `{v: <值>}` 再序列化，所以 `null` / `""` / `0` / `false`
   都能正确返回（早期版本把 `null` 当未写入，会一直轮询到超时）。
4. **探针键必须清理**：成功与失败路径都会尽力 `delete Memory.__mcpProbe*`，否则 Memory 会攒孤儿键。

## 测试

`test/mcp-server.test.cjs` 是离线集成测试：本地 mock 顶替 screeps.com，把 stdio 协议真跑一遍，
覆盖 13 个场景（协议版本回显、annotations、null/空串/false 假值、gz 解压、壳对象竞态、
输出截断、只读拦截、超长表达式、未知工具、POST 不重试、探针键清理）。

```bash
node test/mcp-server.test.cjs
```

## 约束与已知边界

- 控制台单条表达式实测上限约 **843 字符**；工具在 **700 字符**就提前报错，避免白等十几秒。
- `console` 就是游戏控制台，**能改状态**（annotations 里标了 `destructiveHint`）。查询请只写只读表达式；
  改状态优先走 `memory_set` / `deploy_code`（有显式开关）。
- 只读模式下所有写工具直接返回错误，不会碰线上。
- **HTTP 请求只对 GET 重试**：POST 可能已把副作用落到线上（改 Memory / 传代码），
  响应前断网时无法判断是否成功，重试等于赌一把，所以直接报错。
- 工具结果超过 `SCREEPS_MAX_OUTPUT_KB` 会截断（整棵 Memory 可能有几 MB），请给更具体的 `path`。
- token 在进程启动时读取一次；换 token 后需要重启连接器。

## 本地自测

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status","arguments":{}}}' \
 | SCREEPS_REPO=/Users/an/Documents/Screeps node mcp/screeps-mcp.mjs
```
