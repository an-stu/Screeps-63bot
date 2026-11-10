#!/usr/bin/env node
/**
 * Screeps MCP server（零依赖，stdio + JSON-RPC 2.0）
 *
 * 为什么不用 @modelcontextprotocol/sdk：本机网络间歇 TLS 抖动，npm install 不可靠；
 * MCP 的 stdio 协议只是「一行一个 JSON 的消息泵」+ 四个方法，自带实现更稳，
 * 也省掉 node_modules 这个长期维护面。
 *
 * 能力来源（全部复用仓库里已验证的路径）：
 *   /api/user/console        控制台执行（返回值走「写 Memory 再读回」）
 *   /api/user/memory         读/写 Memory 子树
 *   /api/game/room-objects   读房间对象快照
 *   /api/user/overview       账号统计（每房 CPU 趋势）
 *   /api/game/market/orders  市场挂单
 *   /api/user/code           上传代码（**写，需 SCREEPS_ALLOW_WRITE=1**）
 *
 * 环境变量：
 *   SCREEPS_TOKEN / .workbuddy/screeps-token   认证
 *   SCREEPS_REPO      仓库根（找 token、modules/、scripts/）
 *   SCREEPS_SHARD     默认 shard3
 *   SCREEPS_BASE      默认 https://screeps.com（可指向私服）
 *   SCREEPS_ALLOW_WRITE=1                     开启写工具（memory_set / deploy_code）
 *   SCREEPS_TIMEOUT_MS                        单次 HTTP 超时，默认 45000
 *   SCREEPS_MCP_DEBUG=1                       把诊断信息打到 stderr（stdio 协议不受影响）
 *   SCREEPS_MAX_OUTPUT_KB                     单次工具结果上限，默认 512
 */

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const BASE = process.env.SCREEPS_BASE || "https://screeps.com";
const SHARD = process.env.SCREEPS_SHARD || "shard3";
const REPO = process.env.SCREEPS_REPO || process.cwd();
const ALLOW_WRITE = process.env.SCREEPS_ALLOW_WRITE === "1";
const TIMEOUT_MS = Number(process.env.SCREEPS_TIMEOUT_MS || 45000);
const MAX_OUTPUT_KB = Number(process.env.SCREEPS_MAX_OUTPUT_KB || 512);
const DEBUG = process.env.SCREEPS_MCP_DEBUG === "1";
// 控制台取回的初始等待（毫秒）。默认 2000；测试/慢网络可通过环境变量调
const CONSOLE_WAIT_MS = Number(process.env.SCREEPS_MCP_WAIT_MS || 2000);
const SERVER_VERSION = "1.1.0";
// 控制台单条表达式实测上限 ≈ 843 字符（超出直接超时），留出包装余量
const MAX_EXPR_CHARS = 700;

function debug(...args) {
    if (DEBUG) process.stderr.write("[screeps-mcp] " + args.map(String).join(" ") + "\n");
}

function readToken() {
    if (process.env.SCREEPS_TOKEN) return process.env.SCREEPS_TOKEN.trim();
    for (const p of [path.join(REPO, ".workbuddy/screeps-token"), path.join(process.cwd(), ".workbuddy/screeps-token")]) {
        try {
            const t = fs.readFileSync(p, "utf8").trim();
            if (t) return t;
        } catch { /* 继续找下一个 */ }
    }
    return null;
}

const TOKEN = readToken();

/**
 * 带重试的请求。
 *
 * **只有幂等请求（GET）才重试**：POST 可能已经把副作用落到线上（改 Memory / 传代码），
 * 网络在响应前断掉时无法判断是否成功，重试等于赌一把 —— 这里直接抛错让人决定。
 */
async function api(pathname, { method = "GET", body, query } = {}) {
    if (!TOKEN) throw new Error("缺少 token：设置 SCREEPS_TOKEN，或把 token 写进 .workbuddy/screeps-token");
    let url = BASE + pathname;
    if (query) {
        const qs = new URLSearchParams(query).toString();
        if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }
    const idempotent = method === "GET";
    const maxAttempts = idempotent ? 3 : 1;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await fetch(url, {
                method,
                headers: {
                    "X-Token": TOKEN,
                    "Content-Type": "application/json; charset=utf-8",
                    "User-Agent": `screeps-mcp/${SERVER_VERSION}`,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
            debug(method, pathname, "→", res.status, text.length + "B");
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        } catch (err) {
            lastErr = err;
            const msg = String(err && err.message || err);
            const retryable = idempotent && /fetch failed|ECONNRESET|EPIPE|SSL|timeout|aborted|socket/i.test(msg);
            if (!retryable || attempt === maxAttempts) break;
            debug("retry", attempt, pathname, msg.slice(0, 80));
            await new Promise(r => setTimeout(r, 600 * attempt));
        }
    }
    throw lastErr;
}

/**
 * 解码 Memory 值：Screeps 对大段子树返回 `gz:<base64(gzip(json))>`，小值直接给 JSON 文本。
 * 不处理这个前缀，控制台取回永远是那串 base64。
 */
function decodeMemoryValue(raw) {
    let v = raw;
    for (let depth = 0; depth < 5 && typeof v === "string"; depth++) {
        if (v.startsWith("gz:")) {
            try {
                v = zlib.gunzipSync(Buffer.from(v.slice(3), "base64")).toString("utf8");
                continue;
            } catch { return raw; }
        }
        const t = v.trim();
        const looksJson = t.startsWith("{") || t.startsWith("[") || t === "true" || t === "false" || t === "null"
            || /^-?\d+(\.\d+)?$/.test(t) || (t.startsWith('"') && t.endsWith('"'));
        if (!looksJson) return v;
        try { v = JSON.parse(t); } catch { return v; }
    }
    return v;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let probeSeq = 0;

/**
 * 控制台取回值。
 *
 * 三个必须处理的现实约束：
 *  1) `/api/user/console` 的响应**不含返回值** ⇒ 把结果写进 Memory 再读回；
 *  2) 主循环会**丢弃约一半**的 console 写入 ⇒ 必须「写 → 等 → 读 → 没读到就重写」，
 *     键名每轮唯一（同毫秒并发调用也不会撞，见 probeSeq）；
 *  3) 读取端在写入落地前返回的是 `{ok:1}` 壳对象（没有 data）⇒ 只认 `data` 存在。
 *
 * 结果统一包成 `{v: <值>}` 再序列化：这样 `null` / `""` / `0` / `false` 这些
 * **合法返回值**不会和「还没写入」混淆（早期版本把 null 当未命中，会一直轮询到超时）。
 */
async function consoleEval(expression, { shard = SHARD, attempts = 6, wait = CONSOLE_WAIT_MS, tries = 4 } = {}) {
    const expr = String(expression).trim();
    if (!expr) throw new Error("expression 不能为空");
    if (expr.length > MAX_EXPR_CHARS) {
        throw new Error(`表达式 ${expr.length} 字符，超过安全上限 ${MAX_EXPR_CHARS}（控制台实测上限约 843，超出会直接超时）`);
    }
    // 三种写法都支持：return X / 多语句块（含 return）/ 单个表达式
    const body = /^return\b/.test(expr)
        ? expr
        : (/\breturn\b/.test(expr) ? `return (function(){ ${expr} })();` : `return (${expr});`);
    // 引擎里执行 → 包成 {v} → JSON 序列化；异常也带回字符串
    const inner = `(function(){ try { return JSON.stringify({ v: (function(){ ${body} })() }); }` +
        ` catch (e) { return "ERR:" + (e && e.stack ? e.stack : String(e)); } })()`;

    const keys = [];
    try {
        for (let attempt = 0; attempt < attempts; attempt++) {
            const key = `__mcpProbe${process.pid % 1000}_${Date.now() % 100000}_${probeSeq++}`;
            keys.push(key);
            await api("/api/user/console", {
                method: "POST",
                body: { expression: `Memory.${key} = ${inner};`, shard },
            });
            await sleep(wait);
            for (let t = 0; t < tries; t++) {
                const got = await api("/api/user/memory", { query: { path: key, shard } });
                if (!got || got.data === undefined || got.data === null) {
                    await sleep(700);
                    continue;
                }
                const raw = decodeMemoryValue(got.data);
                if (typeof raw === "string" && raw.startsWith("ERR:")) {
                    throw new Error("控制台异常: " + raw.slice(0, 400));
                }
                // {v: ...} 是正常结果；老格式（裸值）也兼容
                if (raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "v")) return raw.v;
                return raw;
            }
        }
        throw new Error(
            `控制台 ${attempts} 次写入都没取回结果。常见原因：表达式超时、语法错误，或超过 ${MAX_EXPR_CHARS} 字符。`
        );
    } finally {
        // 失败路径也要清理：否则 Memory 里会攒下一堆 __mcpProbe* 孤儿键
        for (const key of keys) {
            api("/api/user/console", {
                method: "POST",
                body: { expression: `delete Memory.${key};`, shard },
            }).catch(() => {});
        }
    }
}

function requireWrite(tool) {
    if (!ALLOW_WRITE) {
        throw new Error(`${tool} 是写操作：需要用 SCREEPS_ALLOW_WRITE=1 启动本 MCP 才能用（防止误改线上）`);
    }
}

/** 输出体积保护：整棵 Memory 能有几 MB，直接把 stdio 堵死没有意义。 */
function capOutput(value) {
    const text = JSON.stringify(value === undefined ? null : value, null, 1);
    const limit = MAX_OUTPUT_KB * 1024;
    if (text.length <= limit) return { text };
    return {
        text: text.slice(0, limit) +
            `\n…（已截断：原始 ${(text.length / 1024).toFixed(0)}KB，超过 SCREEPS_MAX_OUTPUT_KB=${MAX_OUTPUT_KB}。` +
            "请用更具体的 path 或分页参数缩小结果）",
    };
}

// ─────────────────────────── 工具定义 ───────────────────────────

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

const TOOLS = [
    {
        name: "console",
        description:
            "在 Screeps 控制台执行一条表达式并取回返回值（结果走 Memory 临时键，用完即删）。" +
            `表达式上限约 ${MAX_EXPR_CHARS} 字符。注意：这就是游戏控制台，能改状态 —— 只做查询时请在表达式里只读。`,
        inputSchema: {
            type: "object",
            properties: {
                expression: { type: "string", description: "表达式，如 Object.keys(Game.rooms).length；支持 return X / 多语句块" },
                shard: { type: "string", description: "分片，默认取 SCREEPS_SHARD（shard3）" },
            },
            required: ["expression"],
        },
        annotations: { ...READ_ONLY, readOnlyHint: false, destructiveHint: true },
        run: (a) => consoleEval(a.expression, a.shard ? { shard: a.shard } : {}),
    },
    {
        name: "memory_get",
        description: "读取 Memory（点分路径，如 rooms.W26N58.stationUpgrade）。大值自动解 gz 压缩；超过输出上限会截断并提示。",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "点分路径；留空读整棵 Memory（很大，建议带路径）" },
            },
        },
        annotations: READ_ONLY,
        run: async (a) => {
            const q = { shard: SHARD };
            if (a.path) q.path = a.path;
            const r = await api("/api/user/memory", { query: q });
            if (!r || r.data === undefined) return null;
            return decodeMemoryValue(r.data);
        },
    },
    {
        name: "memory_set",
        description: "【写】覆盖写入 Memory 的某个点分路径（value 按 JSON 解析）。需 SCREEPS_ALLOW_WRITE=1。",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "点分路径，不能为空（不允许整棵 Memory 覆盖）" },
                value: { type: "string", description: "JSON 值，如 1 / \"x\" / {\"a\":1}" },
            },
            required: ["path", "value"],
        },
        annotations: WRITE,
        run: async (a) => {
            requireWrite("memory_set");
            if (!a.path) throw new Error("path 不能为空（不允许整棵 Memory 覆盖）");
            let parsed;
            try { parsed = JSON.parse(a.value); } catch { parsed = a.value; }
            // 官方接口要求 value 是 **JSON 字符串**，不能是嵌套对象
            const r = await api("/api/user/memory", {
                method: "POST",
                body: { path: a.path, value: JSON.stringify(parsed), shard: SHARD },
            });
            return { ok: !!(r && r.ok), response: r };
        },
    },
    {
        name: "room_objects",
        description: "读取房间对象快照（creep/结构/源等），免控制台侦察，CPU 开销低于 console。",
        inputSchema: {
            type: "object",
            properties: { room: { type: "string", description: "房间名，如 W26N58" } },
            required: ["room"],
        },
        annotations: READ_ONLY,
        run: async (a) => {
            const r = await api("/api/game/room-objects", { query: { room: a.room, shard: SHARD } });
            return r && r.objects !== undefined ? r.objects : r;
        },
    },
    {
        name: "overview",
        description: "账号统计总览（官方 /api/user/overview）：各分片房间数、每房 CPU 最新值（降序 top10）、账号累计产出。",
        inputSchema: { type: "object", properties: {} },
        annotations: READ_ONLY,
        run: async () => {
            const r = await api("/api/user/overview", { query: { interval: 8 } });
            const out = { totals: r && r.totals, shards: {} };
            for (const [name, v] of Object.entries((r && r.shards) || {})) {
                const rooms = v.rooms || [];
                if (!rooms.length) continue;
                const cpu = {};
                for (const [room, series] of Object.entries(v.stats || {})) {
                    const last = Array.isArray(series) && series.length ? series[series.length - 1] : null;
                    if (last) cpu[room] = last.value;
                }
                out.shards[name] = {
                    rooms: rooms.length,
                    topCpu: Object.entries(cpu).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([room, c]) => ({ room, cpu: c })),
                };
            }
            return out;
        },
    },
    {
        name: "status",
        description: "实时状态（走控制台）：tick、版本、CPU bucket/used、GCL/GPL、爬数与房间数、各房 storage/terminal 能量。",
        inputSchema: { type: "object", properties: {} },
        annotations: READ_ONLY,
        run: () => consoleEval(
            'var r={t:Game.time,v:RUNTIME_PROFILE.version,b:Game.cpu.bucket,u:Math.round(Game.cpu.getUsed()*10)/10,' +
            'gcl:Game.gcl.level,gclP:Math.round(Game.gcl.progress),gpl:Game.gpl.level,gplP:Math.round(Game.gpl.progress),' +
            'c:Object.keys(Game.creeps).length,rooms:Object.keys(Game.rooms).length,e:{}};' +
            'for(var n in Game.rooms){var x=Game.rooms[n];if(!x.my||!x.storage)continue;' +
            'r.e[n]=Math.round(x.storage.store.energy||0)+"/"+(x.terminal?Math.round(x.terminal.store.energy||0):0);}' +
            'return r;'
        ),
    },
    {
        name: "market_orders",
        description: "查询市场挂单（可按资源/类型过滤，按价格升序）。",
        inputSchema: {
            type: "object",
            properties: {
                resourceType: { type: "string", description: "资源常量，如 energy / ops / power" },
                type: { type: "string", description: "sell 或 buy" },
                limit: { type: "number", description: "最多返回条数，默认 20" },
            },
        },
        annotations: READ_ONLY,
        run: async (a) => {
            const q = {};
            if (a.resourceType) q.resourceType = a.resourceType;
            const r = await api("/api/game/market/orders", { query: q });
            let list = Array.isArray(r) ? r : (r && r.list) || [];
            if (a.type) list = list.filter(o => o.type === a.type);
            list = list.slice().sort((x, y) => (x.price || 0) - (y.price || 0));
            return list.slice(0, a.limit || 20).map(o => ({
                id: o.id, type: o.type, resourceType: o.resourceType,
                price: o.price, amount: o.remainingAmount !== undefined ? o.remainingAmount : o.amount,
                roomName: o.roomName,
            }));
        },
    },
    {
        name: "deploy_code",
        description:
            "【写】按仓库正规链路部署：先跑 scripts/build-core-payload.cjs 生成 deploy/core-payload.json，" +
            "备份线上代码，上传，再逐模块 sha256 比对。需 SCREEPS_ALLOW_WRITE=1。",
        inputSchema: {
            type: "object",
            properties: {
                branch: { type: "string", description: "目标分支，默认 payload 里的 branch" },
                dryRun: { type: "boolean", description: "只构建 + 报告模块数与差异，不上传" },
                skipBuild: { type: "boolean", description: "跳过构建，直接上传已有的 deploy/core-payload.json（仅调试用）" },
            },
        },
        annotations: WRITE,
        run: async (a) => {
            requireWrite("deploy_code");
            const buildScript = path.join(REPO, "scripts", "build-core-payload.cjs");
            const payloadFile = path.join(REPO, "deploy", "core-payload.json");
            if (!a.skipBuild) {
                // **不能直接读 modules/*.js**：仓库的可部署产物是构建脚本的输出（含 profile 处理），
                // 直传源码会绕过测试链路、和 check-sync 的口径对不上。
                if (!fs.existsSync(buildScript)) throw new Error("找不到 scripts/build-core-payload.cjs");
                execFileSync(process.execPath, [buildScript], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
            }
            if (!fs.existsSync(payloadFile)) throw new Error("找不到 deploy/core-payload.json");
            const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
            const modules = payload.modules || payload;
            const branch = a.branch || payload.branch || "default";
            const names = Object.keys(modules);
            if (a.dryRun) return { dryRun: true, branch, modules: names.length };

            // 1) 备份线上，便于回滚
            const live = await api("/api/user/code");
            const backupFile = path.join(REPO, ".workbuddy", "tmp", `live-backup-${Date.now()}.json`);
            try {
                fs.mkdirSync(path.dirname(backupFile), { recursive: true });
                fs.writeFileSync(backupFile, JSON.stringify(live));
            } catch (err) { debug("backup failed", err && err.message); }

            // 2) 上传
            const up = await api("/api/user/code", { method: "POST", body: { branch, modules } });
            if (!up || !up.ok) return { ok: false, error: "上传失败", response: up };

            // 3) 逐模块校验（只信 ok:1 不够，部分上传也返回 ok）
            const again = await api("/api/user/code");
            const liveMods = (again && again.modules) || {};
            const norm = v => (v && typeof v === "object" ? (v.binary || v.code || "") : (typeof v === "string" ? v : ""));
            const hash = s => zlib.gzipSync(Buffer.from(String(s))).toString("base64").slice(0, 22);
            const all = Array.from(new Set([...Object.keys(liveMods), ...names]));
            const mismatch = all.filter(n => hash(norm(liveMods[n])) !== hash(norm(modules[n])));
            return {
                ok: mismatch.length === 0,
                branch,
                modules: names.length,
                mismatches: mismatch.length,
                mismatchSample: mismatch.slice(0, 10),
                backup: path.relative(REPO, backupFile),
            };
        },
    },
];

// ─────────────────────────── JSON-RPC over stdio ───────────────────────────

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
    send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
    send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;

    if (method === "initialize") {
        const asked = params && params.protocolVersion;
        // 客户端请求的版本我们支持就照它回（协议要求），否则回自己最新的
        const version = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
        return reply(id, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "screeps-mcp", version: SERVER_VERSION },
            instructions: "Screeps 只读优先。console 是游戏控制台（能改状态）；写工具需 SCREEPS_ALLOW_WRITE=1。",
        });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") return; // 通知不回包
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
        return reply(id, {
            tools: TOOLS.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
                annotations: t.annotations,
            })),
        });
    }
    if (method === "tools/call") {
        const name = params && params.name;
        const tool = TOOLS.find(t => t.name === name);
        if (!tool) return replyError(id, -32602, "未知工具: " + name);
        try {
            const value = await tool.run((params && params.arguments) || {});
            const { text } = capOutput(value);
            return reply(id, { content: [{ type: "text", text }] });
        } catch (err) {
            return reply(id, { content: [{ type: "text", text: String(err && err.message || err) }], isError: true });
        }
    }
    if (isRequest) replyError(id, -32601, "未实现的方法: " + method);
}

let buffer = "";
let pending = 0;
let stdinClosed = false;

function maybeExit() {
    if (stdinClosed && pending === 0) process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { debug("bad json line"); continue; }
        pending++;
        handle(msg)
            .catch(err => {
                if (msg && msg.id !== undefined) replyError(msg.id, -32603, String(err && err.message || err));
            })
            .finally(() => { pending--; maybeExit(); });
    }
});
// stdin 关闭时不能立刻退出：还在飞的请求（控制台取回要等 1~12 秒）必须写完再走。
process.stdin.on("end", () => { stdinClosed = true; maybeExit(); });
