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
 *   SCREEPS_ALLOW_WRITE=1                     开启 console / memory_set / deploy_code
 *   SCREEPS_TIMEOUT_MS                        HTTP 请求总预算，默认 15000
 *   SCREEPS_MCP_DEBUG=1                       把诊断信息打到 stderr（stdio 协议不受影响）
 *   SCREEPS_MAX_OUTPUT_KB                     单次工具结果上限，默认 512
 */

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Script } from "node:vm";
import { setTimeout as sleep } from "node:timers/promises";
import { diffModules } from "../scripts/check-sync.cjs";

const BASE = process.env.SCREEPS_BASE || "https://screeps.com";
const SHARD = process.env.SCREEPS_SHARD || "shard3";
const REPO = path.resolve(process.env.SCREEPS_REPO || fileURLToPath(new URL("..", import.meta.url)));
const ALLOW_WRITE = process.env.SCREEPS_ALLOW_WRITE === "1";
const TIMEOUT_MS = positiveEnv("SCREEPS_TIMEOUT_MS", 15000, 120000);
const MAX_OUTPUT_KB = positiveEnv("SCREEPS_MAX_OUTPUT_KB", 512, 4096);
const DEBUG = process.env.SCREEPS_MCP_DEBUG === "1";
// 控制台取回的初始等待（毫秒）。默认 2000；测试/慢网络可通过环境变量调
const CONSOLE_WAIT_MS = positiveEnv("SCREEPS_MCP_WAIT_MS", 2000, 10000);
const SERVER_VERSION = "1.2.0";
// 控制台单条表达式实测上限 ≈ 843 字符（超出直接超时），留出包装余量
const MAX_EXPR_CHARS = 700;
const MAX_API_BYTES = 16 * 1024 * 1024;

function positiveEnv(name, fallback, maximum) {
    const value = Number(process.env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
        throw new Error(`${name} 必须是 1 到 ${maximum} 之间的整数`);
    }
    return value;
}

function debug(...args) {
    if (DEBUG) process.stderr.write("[screeps-mcp] " + args.map(String).join(" ") + "\n");
}

function readToken() {
    if (process.env.SCREEPS_TOKEN) return process.env.SCREEPS_TOKEN.trim();
    try { return fs.readFileSync(path.join(REPO, ".workbuddy/screeps-token"), "utf8").trim(); }
    catch { return null; }
}

const TOKEN = readToken();

/**
 * 带重试的请求。
 *
 * **只有幂等请求（GET）才重试**：POST 可能已经把副作用落到线上（改 Memory / 传代码），
 * 网络在响应前断掉时无法判断是否成功，重试等于赌一把 —— 这里直接抛错让人决定。
 */
async function api(pathname, { method = "GET", body, query, signal, deadline = Date.now() + TIMEOUT_MS } = {}) {
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
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        signal?.throwIfAborted();
        try {
            const timeout = AbortSignal.timeout(Math.min(remaining, TIMEOUT_MS));
            const res = await fetch(url, {
                method,
                headers: {
                    "X-Token": TOKEN,
                    "Content-Type": "application/json; charset=utf-8",
                    "User-Agent": `screeps-mcp/${SERVER_VERSION}`,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect: "error",
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            });
            if (!res.ok) {
                await res.body?.cancel();
                throw new Error(`Screeps ${pathname} 返回 HTTP ${res.status}`);
            }
            const chunks = [];
            let bytes = 0;
            for await (const chunk of res.body || []) {
                bytes += chunk.length;
                if (bytes > MAX_API_BYTES) throw new Error(`Screeps ${pathname} 响应过大`);
                chunks.push(chunk);
            }
            const text = Buffer.concat(chunks, bytes).toString("utf8");
            debug(method, pathname, "→", res.status, text.length + "B");
            let data;
            try { data = JSON.parse(text); }
            catch { throw new Error(`Screeps ${pathname} 返回了非 JSON 响应`); }
            if (!data || typeof data !== "object" || (!Array.isArray(data) && (!data.ok || data.error))) {
                throw new Error(`Screeps ${pathname} 拒绝请求`);
            }
            return data;
        } catch (err) {
            lastErr = err;
            const msg = String(err && err.message || err);
            const retryable = idempotent && !signal?.aborted && /fetch failed|ECONNRESET|EPIPE|SSL|timeout|aborted|socket/i.test(msg);
            if (!retryable || attempt === maxAttempts) break;
            debug("retry", attempt, pathname, msg.slice(0, 80));
            if (Date.now() + 600 * attempt >= deadline) break;
            await sleep(600 * attempt, undefined, { signal });
        }
    }
    throw lastErr || new Error(`Screeps ${pathname} 请求超时`);
}

/**
 * 解码 Memory 值：Screeps 对大段子树返回 `gz:<base64(gzip(json))>`，小值直接给 JSON 文本。
 * 不处理这个前缀，控制台取回永远是那串 base64。
 */
function decodeMemoryValue(raw) {
    if (typeof raw !== "string") return raw;
    if (raw.startsWith("gz:")) {
        try {
            const json = zlib.gunzipSync(Buffer.from(raw.slice(3), "base64"), { maxOutputLength: MAX_API_BYTES });
            return JSON.parse(json.toString("utf8"));
        } catch {
            throw new Error("Screeps Memory 压缩响应无效或超过解压上限");
        }
    }
    try { return JSON.parse(raw); } catch { return raw; }
}

// 控制台只提交一次。没读到探针时，无法判断命令未执行还是结果未落盘。
async function consoleEval(expression, shard = SHARD, signal) {
    requireWrite("console");
    const expr = expression.trim();
    if (!expr) throw new Error("expression 不能为空");
    if (expr.length > MAX_EXPR_CHARS) {
        throw new Error(`表达式 ${expr.length} 字符，超过安全上限 ${MAX_EXPR_CHARS}（控制台实测上限约 843，超出会直接超时）`);
    }
    let body = `return (${expr}\n);`;
    try { new Script(`(function(){${body}})`); }
    catch { body = `${expr}\n`; }
    const key = `__mcpProbe${randomBytes(8).toString("hex")}`;
    const command = `Memory.${key}=(()=>{try{return JSON.stringify({v:(()=>{${body}})()??null})}catch(e){return JSON.stringify({err:String(e)})}})();`;
    if (Buffer.byteLength(command) > 843) throw new Error("包装后的控制台命令超过安全上限，请缩短表达式");
    try { new Script(command); }
    catch { throw new Error("控制台表达式语法无效"); }

    const deadline = Date.now() + Math.max(15000, CONSOLE_WAIT_MS + 5000);
    try {
        await api("/api/user/console", { method: "POST", body: { expression: command, shard }, deadline, signal });
        await sleep(Math.min(CONSOLE_WAIT_MS, Math.max(0, deadline - Date.now())), undefined, { signal });
        for (let poll = 0; poll < 8 && Date.now() < deadline; poll++) {
            const got = await api("/api/user/memory", { query: { path: key, shard }, deadline, signal });
            let result = decodeMemoryValue(got.data);
            // 官方 HTTP API 有一层 JSON 编码，探针内容本身也是 JSON 文本。
            if (typeof result === "string") {
                try { result = JSON.parse(result); } catch { result = null; }
            }
            if (isRecord(result)) {
                if (typeof result.err === "string") throw new Error("控制台异常: " + result.err.slice(0, 400));
                if (Object.hasOwn(result, "v")) return result.v;
            }
            if (poll < 7) await sleep(Math.min(900, Math.max(0, deadline - Date.now())), undefined, { signal });
        }
        throw new Error("未读到控制台结果，命令可能已执行。请先核对游戏状态再决定是否重试。");
    } finally {
        await api("/api/user/console", {
            method: "POST", body: { expression: `delete Memory.${key};`, shard }, deadline: Date.now() + 5000,
        }).catch(err => debug("probe cleanup failed", err.message));
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
    const bytes = Buffer.from(text);
    if (bytes.length <= limit) return { text };
    return {
        text: bytes.subarray(0, limit - 256).toString("utf8") +
            `\n…（已截断：原始 ${(bytes.length / 1024).toFixed(0)}KiB，请缩小查询范围）`,
    };
}

// ─────────────────────────── 工具定义 ───────────────────────────

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const build = promisify(execFile);
let deploying = false;

async function readMemory(key, shard, signal) {
    const response = await api("/api/user/memory", { query: key ? { path: key, shard } : { shard }, signal });
    return decodeMemoryValue(response.data) ?? null;
}

function validateModules(modules) {
    if (!isRecord(modules) || typeof modules.main !== "string" || !modules.main.trim()
        || Object.values(modules).some(value => typeof value !== "string"
            && !(isRecord(value) && typeof value.binary === "string" && value.binary))) {
        throw new Error("代码模块格式无效或缺少 main");
    }
    return modules;
}

async function readBranch(branch, signal) {
    const live = await api("/api/user/code", { query: { branch }, signal });
    if (live.branch !== branch) throw new Error("Screeps 响应未确认目标分支");
    validateModules(live.modules);
    return live;
}

function codeHash(modules) {
    const entries = Object.keys(modules).sort().map(name => [name, modules[name]]);
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function deployCode(args, signal) {
    if (!args.dryRun) {
        requireWrite("deploy_code");
        if (![args.expectedLiveHash, args.expectedPayloadHash].every(hash => /^[a-f0-9]{64}$/.test(hash || ""))) {
            throw new Error("请先用 dryRun 获取 liveHash 和 payloadHash，再传入 expectedLiveHash 和 expectedPayloadHash");
        }
    }
    if (deploying) throw new Error("已有部署或预览正在运行");
    deploying = true;
    try {
        if (!args.skipBuild) {
            // 构建只需要源码，不向构建子进程转发环境中的 Screeps 凭据。
            const { SCREEPS_TOKEN, ...env } = process.env;
            await build(process.execPath, [path.join(REPO, "scripts/build-core-payload.cjs")],
                { cwd: REPO, env, timeout: 30000, signal });
        }
        const payload = JSON.parse(fs.readFileSync(path.join(REPO, "deploy/core-payload.json"), "utf8"));
        const modules = validateModules(payload.modules);
        const branch = args.branch || payload.branch || "default";
        if (typeof branch !== "string" || !branch.trim()) throw new Error("目标分支名不能为空");
        const payloadHash = codeHash(modules);
        if (!args.dryRun && args.expectedPayloadHash !== payloadHash) throw new Error("本地构建产物已变化，请重新预览");
        const live = await readBranch(branch, signal);
        const liveHash = codeHash(live.modules);
        const changes = diffModules(modules, live.modules);
        if (args.dryRun) return { dryRun: true, branch, modules: Object.keys(modules).length, liveHash, payloadHash, changes };
        if (args.expectedLiveHash !== liveHash) throw new Error("目标分支已变化，请重新预览后再部署");
        if (!changes.onlyLocal.length && !changes.onlyLive.length && !changes.content.length) {
            return { ok: true, unchanged: true, branch };
        }

        signal?.throwIfAborted();
        const backupDir = path.join(REPO, ".workbuddy", "tmp");
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const backupFile = path.join(backupDir, `live-backup-${Date.now()}-${randomBytes(4).toString("hex")}.json`);
        fs.writeFileSync(backupFile, JSON.stringify({ branch, modules: live.modules }), { flag: "wx", mode: 0o600 });
        const backup = path.relative(REPO, backupFile);

        try {
            await api("/api/user/code", { method: "POST", body: { branch, modules } });
            const verified = diffModules(modules, (await readBranch(branch)).modules);
            const mismatches = [...verified.onlyLocal, ...verified.onlyLive, ...verified.content];
            if (mismatches.length) throw new Error(`回读差异 ${mismatches.length} 个模块：${mismatches.slice(0, 10).join(", ")}`);
            return { ok: true, branch, modules: Object.keys(modules).length, backup };
        } catch (err) {
            throw new Error(`部署未验证，请先核对 ${branch} 再决定是否重试。备份 ${backup}。${err.message}`);
        }
    } finally {
        deploying = false;
    }
}

const TOOLS = [
    {
        name: "console",
        description:
            "在 Screeps 控制台执行一条表达式并取回返回值（结果走 Memory 临时键，用完即删）。" +
            `表达式上限约 ${MAX_EXPR_CHARS} 字符。可改变游戏状态，需 SCREEPS_ALLOW_WRITE=1，每次调用只提交一次。`,
        inputSchema: {
            type: "object",
            properties: {
                expression: { type: "string", description: "表达式，如 Object.keys(Game.rooms).length；支持 return X / 多语句块" },
                shard: { type: "string", description: "分片，默认取 SCREEPS_SHARD（shard3）" },
            },
            required: ["expression"],
        },
        annotations: WRITE,
        run: (a, signal) => consoleEval(a.expression, a.shard, signal),
    },
    {
        name: "memory_get",
        description: "读取 Memory（点分路径，如 rooms.W26N58.stationUpgrade）。大值自动解 gz 压缩；超过输出上限会截断并提示。",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "点分路径；留空读整棵 Memory（很大，建议带路径）" },
                shard: { type: "string", description: "分片，默认取 SCREEPS_SHARD" },
            },
        },
        annotations: READ_ONLY,
        run: (a, signal) => readMemory(a.path, a.shard ?? SHARD, signal),
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
        run: async (a, signal) => {
            requireWrite("memory_set");
            if (a.path.split(".").some(part => !part || part !== part.trim() || /[\[\]]/.test(part)
                || ["__proto__", "constructor", "prototype"].includes(part))) {
                throw new Error("path 含空白或受保护的路径段");
            }
            let parsed;
            try { parsed = JSON.parse(a.value); } catch { throw new Error("value 必须是有效 JSON，字符串需加双引号"); }
            // 官方接口要求 value 是 **JSON 字符串**，不能是嵌套对象
            const r = await api("/api/user/memory", {
                method: "POST",
                body: { path: a.path, value: JSON.stringify(parsed), shard: SHARD },
                signal,
            });
            return { ok: !!(r && r.ok), response: r };
        },
    },
    {
        name: "room_objects",
        description: "读取房间对象快照（creep/结构/源等），免控制台侦察，CPU 开销低于 console。",
        inputSchema: {
            type: "object",
            properties: { room: { type: "string", description: "房间名，如 W26N58" }, shard: { type: "string" } },
            required: ["room"],
        },
        annotations: READ_ONLY,
        run: async (a, signal) => {
            const r = await api("/api/game/room-objects", { query: { room: a.room, shard: a.shard ?? SHARD }, signal });
            if (!r.objects || typeof r.objects !== "object") throw new Error("房间快照缺少 objects");
            return r.objects;
        },
    },
    {
        name: "overview",
        description: "账号统计总览（官方 /api/user/overview）：各分片房间数、每房 CPU 最新值（降序 top10）、账号累计产出。",
        inputSchema: { type: "object", properties: {} },
        annotations: READ_ONLY,
        run: async (_, signal) => {
            const r = await api("/api/user/overview", { query: { interval: 8 }, signal });
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
        description: "读取指定分片最近一次 Memory 遥测：采样 tick、运行版本、CPU、bucket、GCL/GPL、爬数和房间 RCL。",
        inputSchema: { type: "object", properties: { shard: { type: "string" } } },
        annotations: READ_ONLY,
        run: async ({ shard = SHARD }, signal) => {
            const [health, stats] = await Promise.all([readMemory("codeHealth", shard, signal), readMemory("stats", shard, signal)]);
            if (!health && !stats) throw new Error(`${shard} 没有 codeHealth 或 stats 遥测`);
            return {
                shard, tick: health?.time ?? null, version: health?.version ?? null,
                bucket: health?.bucket ?? stats?.bucket ?? null,
                cpu: health?.cpu ?? stats?.cpu ?? null, averageCpu: health?.averageCpu ?? null,
                gcl: stats?.gclLevel ?? null, gpl: stats?.gplLevel ?? null,
                creeps: health?.creeps ?? null, powerCreeps: health?.powerCreeps ?? null,
                rooms: stats?.RCL ?? null,
            };
        },
    },
    {
        name: "market_orders",
        description: "按资源查询市场挂单。卖单优先低价，指定买单时优先高价。",
        inputSchema: {
            type: "object",
            properties: {
                resourceType: { type: "string", minLength: 1, description: "资源常量，如 energy / ops / power" },
                type: { type: "string", enum: ["sell", "buy"] },
                limit: { type: "integer", minimum: 1, maximum: 200, description: "最多返回条数，默认 20" },
                shard: { type: "string" },
            },
            required: ["resourceType"],
        },
        annotations: READ_ONLY,
        run: async (a, signal) => {
            const q = { shard: a.shard ?? SHARD, resourceType: a.resourceType };
            const r = await api("/api/game/market/orders", { query: q, signal });
            let list = Array.isArray(r) ? r : r.list;
            if (!Array.isArray(list)) throw new Error("市场响应缺少挂单列表");
            if (a.type) list = list.filter(o => o.type === a.type);
            const direction = a.type === "buy" ? -1 : 1;
            list.sort((x, y) => direction * (x.price - y.price));
            return list.slice(0, a.limit ?? 20).map(o => ({
                id: o.id ?? o._id, type: o.type, resourceType: o.resourceType ?? a.resourceType,
                price: o.price, amount: o.remainingAmount !== undefined ? o.remainingAmount : o.amount,
                roomName: o.roomName,
            }));
        },
    },
    {
        name: "deploy_code",
        description:
            "预览目标分支的模块差异，或备份、上传并逐模块回读。上传需 SCREEPS_ALLOW_WRITE=1 和预览返回的两份哈希。",
        inputSchema: {
            type: "object",
            properties: {
                branch: { type: "string", description: "目标分支，默认 payload 里的 branch" },
                dryRun: { type: "boolean", description: "构建并读取目标分支差异，返回 liveHash" },
                skipBuild: { type: "boolean", description: "使用已有的 deploy/core-payload.json" },
                expectedLiveHash: { type: "string", description: "部署时必填。目标分支最近一次预览返回的 liveHash" },
                expectedPayloadHash: { type: "string", description: "部署时必填。本地产物最近一次预览返回的 payloadHash" },
            },
        },
        annotations: WRITE,
        run: deployCode,
    },
];

// ─────────────────────────── JSON-RPC over stdio ───────────────────────────

const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const activeRequests = new Map();

function validateArguments(args, schema) {
    if (!isRecord(args)) throw new Error("arguments 必须是 JSON 对象");
    for (const name of schema.required || []) {
        if (!Object.hasOwn(args, name)) throw new Error(`缺少参数 ${name}`);
    }
    for (const [name, value] of Object.entries(args)) {
        const rule = Object.hasOwn(schema.properties, name) && schema.properties[name];
        if (!rule) throw new Error(`未知参数 ${name}`);
        const validType = rule.type === "integer" ? Number.isInteger(value) : typeof value === rule.type;
        if (!validType || (rule.enum && !rule.enum.includes(value)) || value < rule.minimum || value > rule.maximum
            || (rule.minLength && value.trim().length < rule.minLength)) {
            throw new Error(`参数 ${name} 无效`);
        }
    }
}

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
    if (!isRecord(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string"
        || (Object.hasOwn(msg, "id") && !["string", "number"].includes(typeof msg.id))) {
        return replyError(null, -32600, "无效的 JSON-RPC 请求");
    }
    const { id, method, params } = msg;
    if (id === undefined) {
        if (method === "notifications/cancelled") activeRequests.get(params?.requestId)?.abort();
        return;
    }
    if (params !== undefined && !isRecord(params)) return replyError(id, -32602, "params 必须是 JSON 对象");

    if (method === "initialize") {
        const asked = params && params.protocolVersion;
        // 客户端请求的版本我们支持就照它回（协议要求），否则回自己最新的
        const version = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
        return reply(id, {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "screeps-mcp", version: SERVER_VERSION },
            instructions: "优先使用 status 和 memory_get。console、memory_set 和实际部署需 SCREEPS_ALLOW_WRITE=1。",
        });
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
        return reply(id, {
            tools: TOOLS.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: { ...t.inputSchema, additionalProperties: false },
                annotations: t.annotations,
            })),
        });
    }
    if (method === "tools/call") {
        const name = params && params.name;
        const tool = TOOLS.find(t => t.name === name);
        if (!tool) return replyError(id, -32602, "未知工具");
        const args = params.arguments === undefined ? {} : params.arguments;
        try { validateArguments(args, tool.inputSchema); }
        catch (err) { return replyError(id, -32602, err.message); }
        if (activeRequests.has(id)) return replyError(id, -32600, "请求 ID 正在使用");
        const controller = new AbortController();
        activeRequests.set(id, controller);
        try {
            const value = await tool.run(args, controller.signal);
            if (controller.signal.aborted) return;
            const { text } = capOutput(value);
            return reply(id, { content: [{ type: "text", text }] });
        } catch (err) {
            if (!controller.signal.aborted) {
                return reply(id, { content: [{ type: "text", text: String(err.message || err).slice(0, 1000) }], isError: true });
            }
        } finally {
            activeRequests.delete(id);
        }
        return;
    }
    replyError(id, -32601, "未实现的方法: " + method);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); }
        catch { replyError(null, -32700, "JSON 解析失败"); continue; }
        handle(msg).catch(() => replyError(msg?.id ?? null, -32603, "MCP 服务内部错误"));
    }
});
