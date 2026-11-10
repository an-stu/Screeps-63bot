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
| `deploy_code` | 写 | 把本地 `modules/` 打包上传（需 `SCREEPES_ALLOW_WRITE=1`，支持 dryRun） |

> 注：`deploy_code` 是**整包覆盖**，和本仓库的部署铁律一致 —— 上传前务必先
> `scripts/check-sync.cjs` 比对线上，否则会覆盖掉别人推的改动。

## 两个必须知道的实现细节

1. **控制台取回走 Memory**：`/api/user/console` 的响应不含返回值，所以表达式会被包成
   `Memory.__mcpProbeN = JSON.stringify(...)`，再读 `/api/user/memory?path=...` 取回。
   主循环会丢弃约一半的 console 写入，因此是「写 → 等 → 读 → 没读到就重写」，键名每轮唯一。
2. **Memory 大值会被压缩**：接口返回 `gz:<base64(gzip(json))>`，需要 gunzip 后再 JSON.parse。
   `decodeMemoryValue()` 负责这部分（console 与 memory_get 都走它）。

## 约束

- 控制台单条表达式上限约 **843 字符**，超出会被引擎截断/超时；复杂查询请用 `room_objects` 或拆多次。
- `console` 是**只读约定**：工具本身不禁止写操作，但请只用它做读查询；要改游戏状态走 `memory_set` / `deploy_code`（有显式开关）。
- 只读模式下所有写工具会直接返回错误，不会碰线上。

## 本地自测

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status","arguments":{}}}' \
 | SCREEPS_REPO=/Users/an/Documents/Screeps node mcp/screeps-mcp.mjs
```
