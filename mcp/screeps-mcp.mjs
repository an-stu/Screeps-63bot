#!/usr/bin/env node
/**
 * Screeps MCP server（零依赖，stdio + JSON-RPC 2.0）
 *
 * 为什么不用 @modelcontextprotocol/sdk：本机网络间歇 TLS 抖动，npm install 不可靠；
 * MCP 的 stdio 协议只是「一行一个 JSON 的消息泵」+ 四个方法，200 行足够，
 * 还省掉 node_modules 这个长期维护面。
 *
 * 能力来源（全部复用仓库里已验证的路径）：
 *   /api/user/console        控制台执行（返回值走「写 Memory 再读回」，与
 *                            skills/screeps-console-probe 同一套技巧 —— 控制台
 *                            响应不带返回值，这是最稳的取回方式）
 *   /api/user/memory         读/写 Memory 子树
 *   /api/game/room-objects   读房间对象快照
 *   /api/user/overview       CPU / GCL / 房间数
 *   /api/game/market/orders  市场挂单
 *   /api/user/code           上传代码（**写操作，需 SCREEPS_ALLOW_WRITE=1**）
 *
 * 认证：环境变量 SCREEPS_TOKEN，或 <repo>/.workbuddy/screeps-token
 * 分片：SCREEPS_SHARD，默认 shard3
 * 写权限：SCREEPS_ALLOW_WRITE=1 才开放 memory_set / console_mutate / deploy_code
 */

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import process from "node:process";

const BASE = process.env.SCREEPS_BASE || "https://screeps.com";
const SHARD = process.env.SCREEPS_SHARD || "shard3";
const REPO = process.env.SCREEPS_REPO || process.cwd();
const ALLOW_WRITE = process.env.SCREEPS_ALLOW_WRITE === "1";
const PROBE_KEY = "__mcpProbe";
const TIMEOUT_MS = Number(process.env.SCREEPS_TIMEOUT_MS || 45000);

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

/** 带重试的请求：TLS 抖动是本机常态，网络类错误重试 3 次，业务错误不重试。 */
async function api(pathname, { method = "GET", body, query } = {}) {
    if (!TOKEN) throw new Error("缺少 token：设置 SCREEPS_TOKEN，或把 token 写进 .workbuddy/screeps-token");
    let url = BASE + pathname;
    if (query) {
        const qs = new URLSearchParams(query).toString();
        if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, {
                method,
                headers: {
                    "X-Token": TOKEN,
                    "Content-Type": "application/json; charset=utf-8",
                    "User-Agent": "screeps-mcp/1.0",
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        } catch (err) {
            lastErr = err;
            const msg = String(err && err.message || err);
            const retryable = /fetch failed|ECONNRESET|EPIPE|SSL|timeout|aborted|socket/i.test(msg);
            if (!retryable || attempt === 3) break;
            await new Promise(r => setTimeout(r, 600 * attempt));
        }
    }
    throw lastErr;
}

/**
 * 解码 Memory 值：Screeps 对大段的 memory 子树返回 `gz:<base64(gzip(json))>`，
 * 小值直接给 JSON 文本。不处理这个前缀的话，控制台取回永远是那串 base64。
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

/**
 * 控制台取回值：写 Memory[唯一键] = JSON.stringify(结果)，再读回。
 *
 * 为什么不是一次写完就读：**主循环会丢弃约一半的 console 写入**（
 * skills/screeps-console-probe 的 probe() 里记着这条），所以必须
 * 「写 → 等 → 读 → 没读到就重写」，而不是只重读取。键名每次唯一，
 * 避免读到上一轮的残留值。读完即删。
 */
async function consoleEval(expression, { attempts = 6, wait = 2000, tries = 4 } = {}) {
    const expr = String(expression).trim();
    // 三种写法都支持：return X / 多语句块（含 return）/ 单个表达式
    const body = /^return\b/.test(expr)
        ? expr
        : (/\breturn\b/.test(expr) ? `return (function(){ ${expr} })();` : `return (${expr});`);
    // 引擎里执行 + JSON 序列化，异常也带回字符串（与探针脚本一致）
    const inner = `(function(){ try { return JSON.stringify((function(){ ${body} })()); }` +
        ` catch (e) { return "ERR:" + (e && e.stack ? e.stack : String(e)); } })()`;
    let lastSeen;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const key = `__mcpProbe${Date.now() % 1000000}${attempt}`;
        await api("/api/user/console", {
            method: "POST",
            body: { expression: `Memory.${key} = ${inner};`, shard: SHARD },
        });
        await sleep(wait);
        for (let t = 0; t < tries; t++) {
            const got = await api("/api/user/memory", { query: { path: key, shard: SHARD } });
            let data = got && got.data !== undefined ? got.data : got;
            data = decodeMemoryValue(data);
            if (data !== undefined && data !== null && data !== "") {
                lastSeen = data;
                await api("/api/user/console", {
                    method: "POST",
                    body: { expression: `delete Memory.${key};`, shard: SHARD },
                }).catch(() => {});
                if (typeof data === "string" && data.startsWith("ERR:")) {
                    throw new Error("控制台异常: " + data.slice(0, 400));
                }
                return data;
            }
            await sleep(700);
        }
    }
    throw new Error(
        `控制台 ${attempts} 次写入都没取回结果（最后一次读到：${JSON.stringify(lastSeen)}）。` +
        "常见原因：表达式超时/语法错误，或单条表达式超过约 843 字符"
    );
}

function requireWrite(tool) {
    if (!ALLOW_WRITE) {
        throw new Error(`${tool} 是写操作：需要用 SCREEPS_ALLOW_WRITE=1 启动本 MCP 才能用（防止误改线上）`);
    }
}

// ─────────────────────────── 工具定义 ───────────────────────────

const TOOLS = [
    {
        name: "console",
        description: "在 Screeps 控制台执行一条只读表达式并取回返回值。会写 Memory.__mcpProbe 作临时通道（用完即删）。单条表达式建议 < 800 字符。",
        inputSchema: {
            type: "object",
            properties: {
                expression: { type: "string", description: "要执行的表达式，例如 Object.keys(Game.rooms).length" },
                shard: { type: "string", description: "分片，默认 shard3" },
            },
            required: ["expression"],
        },
        run: async (a) => consoleEval(a.expression),
    },
    {
        name: "memory_get",
        description: "读取 Memory（可指定路径前缀，如 rooms.W26N58 或 rooms.W26N58.stationUpgrade）。",
        inputSchema: {
            type: "object",
            properties: { path: { type: "string", description: "点分路径，留空读整棵 Memory" } },
        },
        run: async (a) => {
            const q = { shard: SHARD };
            if (a.path) q.path = a.path;
            const r = await api("/api/user/memory", { query: q });
            return decodeMemoryValue(r && r.data !== undefined ? r.data : r);
        },
    },
    {
        name: "memory_set",
        description: "【写】覆盖写入 Memory 的某个点分路径（值按 JSON 解析）。需 SCREEPS_ALLOW_WRITE=1。",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "点分路径，不能为空" },
                value: { type: "string", description: "JSON 值，例如 1 / \"x\" / {\"a\":1}" },
            },
            required: ["path", "value"],
        },
        run: async (a) => {
            requireWrite("memory_set");
            if (!a.path) throw new Error("path 不能为空（不允许整棵 Memory 覆盖）");
            let parsed;
            try { parsed = JSON.parse(a.value); } catch { parsed = a.value; }
            const body = { path: a.path, value: JSON.stringify(parsed), shard: SHARD };
            const r = await api("/api/user/memory", { method: "POST", body });
            return { ok: r && r.ok, result: r };
        },
    },
    {
        name: "room_objects",
        description: "读取某个房间的对象快照（creep/结构/源等），用于免控制台侦察。",
        inputSchema: {
            type: "object",
            properties: { room: { type: "string", description: "房间名，如 W26N58" } },
            required: ["room"],
        },
        run: async (a) => {
            const r = await api("/api/game/room-objects", { query: { room: a.room, shard: SHARD } });
            return r && r.objects !== undefined ? r.objects : r;
        },
    },
    {
        name: "overview",
        description: "账号统计总览（官方 /api/user/overview）：各分片房间数、每房 CPU 最新值（降序 top10）、账号累计产出。",
        inputSchema: { type: "object", properties: {} },
        run: async () => {
            const r = await api("/api/user/overview", { query: { interval: 8 } });
            const out = { totals: r.totals, shards: {} };
            for (const [name, v] of Object.entries(r.shards || {})) {
                const rooms = v.rooms || [];
                if (!rooms.length) continue;
                // stats[room] = [{ value, endTime }...]：取最后一个值当「当前 CPU」
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
        description: "实时状态（走控制台，比 overview 更即时）：tick、版本、CPU bucket/used、GCL/GPL、爬数与房间数、各房 storage/terminal 能量。",
        inputSchema: { type: "object", properties: {} },
        run: async () => consoleEval(
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
        description: "查询市场挂单（可按资源/类型过滤，按价格排序）。",
        inputSchema: {
            type: "object",
            properties: {
                resourceType: { type: "string", description: "资源常量，如 energy / ops / power" },
                type: { type: "string", description: "sell 或 buy" },
                limit: { type: "number", description: "最多返回条数，默认 20" },
            },
        },
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
        description: "【写】把本地 modules/ 打包上传到 Screeps（POST /api/user/code）。需 SCREEPS_ALLOW_WRITE=1。",
        inputSchema: {
            type: "object",
            properties: {
                branch: { type: "string", description: "目标分支，默认 default" },
                dryRun: { type: "boolean", description: "只打包不上传" },
            },
        },
        run: async (a) => {
            requireWrite("deploy_code");
            const modDir = path.join(REPO, "modules");
            const modules = {};
            for (const f of fs.readdirSync(modDir)) {
                if (f.endsWith(".js")) modules[f.replace(/\.js$/, "")] = fs.readFileSync(path.join(modDir, f), "utf8");
            }
            const payload = { branch: a.branch || "default", modules };
            if (a.dryRun) return { dryRun: true, modules: Object.keys(modules).length };
            const r = await api("/api/user/code", { method: "POST", body: payload });
            return { ok: r && r.ok !== undefined ? r.ok : r, modules: Object.keys(modules).length };
        },
    },
];

// ─────────────────────────── JSON-RPC over stdio ───────────────────────────

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
    if (method === "initialize") {
        return reply(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "screeps-mcp", version: "1.0.0" },
        });
    }
    if (method === "notifications/initialized") return; // 通知，无回包
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
        return reply(id, {
            tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });
    }
    if (method === "tools/call") {
        const tool = TOOLS.find(t => t.name === (params && params.name));
        if (!tool) return replyError(id, -32602, "未知工具: " + (params && params.name));
        try {
            const value = await tool.run((params && params.arguments) || {});
            return reply(id, {
                content: [{ type: "text", text: JSON.stringify(value === undefined ? null : value, null, 1) }],
            });
        } catch (err) {
            return reply(id, {
                content: [{ type: "text", text: String(err && err.message || err) }],
                isError: true,
            });
        }
    }
    if (id !== undefined) replyError(id, -32601, "未实现的方法: " + method);
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
        try { msg = JSON.parse(line); } catch { continue; }
        pending++;
        handle(msg)
            .catch(err => {
                if (msg && msg.id !== undefined) replyError(msg.id, -32603, String(err && err.message || err));
            })
            .finally(() => { pending--; maybeExit(); });
    }
});
// stdin 关闭时不能立刻退出：还在飞的请求（控制台取回要等 1~6 秒）必须写完再走。
process.stdin.on("end", () => { stdinClosed = true; maybeExit(); });
