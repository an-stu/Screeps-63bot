const assert = require("node:assert/strict");
const http = require("node:http");
const zlib = require("node:zlib");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * Screeps MCP 的离线集成测试。
 *
 * 用本地 mock 顶替 screeps.com，把真实的 stdio 协议走一遍：不依赖网络、不碰线上，
 * 专测那些「静默错」——null/空串被当成未写入、gz 压缩没解、壳对象当结果、
 * POST 被错误重试、超长表达式白等 12 秒。
 */

const SERVER = path.join(__dirname, "..", "mcp", "screeps-mcp.mjs");
const TEST_TOKEN = "test-token-123";

const gz = obj => "gz:" + zlib.gzipSync(Buffer.from(JSON.stringify(obj))).toString("base64");

// console 表达式里出现 CASE:<name> 就走对应返回值（模拟引擎执行结果）
const CASES = {
    str: JSON.stringify({ v: "hi" }),
    num: JSON.stringify({ v: 42 }),
    null: JSON.stringify({ v: null }),
    empty: JSON.stringify({ v: "" }),
    false: JSON.stringify({ v: false }),
    obj: JSON.stringify({ v: { a: 1 } }),
    gz: gz({ v: { deep: true } }),
    race: JSON.stringify({ v: 7 }),
};

function startMock() {
    const store = new Map();      // probeKey -> string
    const seen = new Map();       // path -> 读取次数
    const raceKeys = new Set();   // 需要模拟「壳对象竞态」的键
    const stats = { consolePosts: 0, memoryGets: 0, destroyedPosts: 0 };

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        let body = "";
        req.on("data", c => (body += c));
        req.on("end", () => {
            // 故意在某个 token 上直接断连，用来验证 POST 不重试
            if (body.includes("CASE:drop")) {
                // 断的是**响应 socket**：只 destroy 请求流的话 fetch 会一直等响应直到超时，
                // 那样测的就不是「POST 不重试」而是「HTTP 超时」了。
                stats.destroyedPosts++;
                res.socket.destroy();
                return;
            }
            if (url.pathname === "/api/user/console" && req.method === "POST") {
                stats.consolePosts++;
                const expr = (JSON.parse(body || "{}").expression) || "";
                const m = /CASE:(\w+)/.exec(expr);
                const del = /delete Memory\.(\S+?);/.exec(expr);
                if (del) {
                    store.delete(del[1]);
                } else if (m) {
                    const key = /Memory\.(\S+?) =/.exec(expr);
                    if (key) {
                        store.set(key[1], CASES[m[1]] ?? "null");
                        if (m[1] === "race") raceKeys.add(key[1]);
                    }
                }
                res.writeHead(200, { "content-type": "application/json" });
                return res.end(JSON.stringify({ ok: 1 }));
            }
            if (url.pathname === "/api/user/memory" && req.method === "GET") {
                stats.memoryGets++;
                const p = url.searchParams.get("path");
                const n = seen.get(p) || 0;
                seen.set(p, n + 1);
                // 壳对象竞态：CASE:race 写进去的键，第一次读只回 {ok:1}（没有 data）
                if (raceKeys.has(p) && n === 0) {
                    res.writeHead(200, { "content-type": "application/json" });
                    return res.end(JSON.stringify({ ok: 1 }));
                }
                if (p === "big") {
                    res.writeHead(200, { "content-type": "application/json" });
                    return res.end(JSON.stringify({ ok: 1, data: gz({ blob: "x".repeat(20000) }) }));
                }
                if (p === "plain") {
                    res.writeHead(200, { "content-type": "application/json" });
                    return res.end(JSON.stringify({ ok: 1, data: '{"k":1}' }));
                }
                const v = store.get(p);
                res.writeHead(200, { "content-type": "application/json" });
                return res.end(JSON.stringify(v === undefined ? { ok: 1 } : { ok: 1, data: v }));
            }
            if (url.pathname === "/api/user/memory" && req.method === "POST") {
                res.writeHead(200, { "content-type": "application/json" });
                return res.end(JSON.stringify({ ok: 1 }));
            }
            if (url.pathname === "/api/game/room-objects") {
                res.writeHead(200, { "content-type": "application/json" });
                return res.end(JSON.stringify({ ok: 1, objects: { creep1: { x: 1 } } }));
            }
            if (url.pathname === "/api/user/overview") {
                res.writeHead(200, { "content-type": "application/json" });
                return res.end(JSON.stringify({
                    ok: 1,
                    totals: { energyHarvested: 1 },
                    shards: { shard3: { rooms: ["A", "B"], stats: { A: [{ value: 5, endTime: 1 }, { value: 9, endTime: 2 }], B: [{ value: 1, endTime: 1 }] } } },
                }));
            }
            if (url.pathname === "/api/game/market/orders") {
                res.writeHead(200, { "content-type": "application/json" });
                return res.end(JSON.stringify([
                    { id: "o1", type: "sell", resourceType: "energy", price: 3, remainingAmount: 10, roomName: "A" },
                    { id: "o2", type: "sell", resourceType: "energy", price: 1, remainingAmount: 20, roomName: "B" },
                    { id: "o3", type: "buy", resourceType: "energy", price: 0.5, remainingAmount: 30, roomName: "C" },
                ]));
            }
            if (url.pathname === "/api/user/code") {
                res.writeHead(200, { "content-type": "application/json" });
                return res.end(JSON.stringify({ ok: 1, modules: { main: "code" } }));
            }
            res.writeHead(404).end("{}");
        });
    });

    return new Promise(resolve => {
        server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, stats, store }));
    });
}

function startMcp(port, env = {}) {
    const child = spawn(process.execPath, [SERVER], {
        env: {
            ...process.env,
            SCREEPS_BASE: `http://127.0.0.1:${port}`,
            SCREEPS_TOKEN: TEST_TOKEN,
            SCREEPS_MCP_WAIT_MS: "120",
            SCREEPS_ALLOW_WRITE: "0",
            SCREEPS_MAX_OUTPUT_KB: "8",
            ...env,
        },
        stdio: ["pipe", "pipe", "pipe"],
    });
    const waiters = new Map();
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            const w = waiters.get(msg.id);
            if (w) { waiters.delete(msg.id); w(msg); }
        }
    });
    let seq = 0;
    const rpc = (method, params) => new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 15000);
        waiters.set(id, msg => { clearTimeout(timer); resolve(msg); });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    const call = async (name, args = {}) => {
        const res = await rpc("tools/call", { name, arguments: args });
        // 协议级错误（JSON-RPC error，如未知工具）与工具级错误（result.isError）都要当失败处理
        if (res.error) return { text: res.error.message || JSON.stringify(res.error), isError: true, raw: res };
        const text = res.result && res.result.content ? res.result.content[0].text : JSON.stringify(res);
        return { text, isError: !!(res.result && res.result.isError), raw: res };
    };
    return { child, rpc, call, close: () => child.kill() };
}

(async () => {
    const { server, port, stats, store } = await startMock();
    const mcp = startMcp(port);
    try {
        // ① 初始化：回显客户端请求的协议版本
        const init = await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
        assert.equal(init.result.protocolVersion, "2025-06-18", "应回显客户端支持的协议版本");
        assert.equal(init.result.serverInfo.name, "screeps-mcp");
        assert.ok(init.result.capabilities.tools, "必须声明 tools 能力");

        // ② 工具清单：8 个，且都带 annotations（幂等性提示）
        const list = await mcp.rpc("tools/list", {});
        const names = list.result.tools.map(t => t.name).sort();
        assert.deepEqual(names, ["console", "deploy_code", "market_orders", "memory_get", "memory_set", "overview", "room_objects", "status"]);
        assert.ok(list.result.tools.every(t => t.annotations && typeof t.annotations.readOnlyHint === "boolean"), "每个工具都要有 annotations");

        // ③ console 常规返回
        assert.equal(JSON.parse((await mcp.call("console", { expression: "return 1 /*CASE:str*/" })).text), "hi");
        assert.equal(JSON.parse((await mcp.call("console", { expression: "return 1 /*CASE:num*/" })).text), 42);

        // ④ **合法假值不能被当成未写入**（这里曾一直轮询到超时）
        assert.equal(JSON.parse((await mcp.call("console", { expression: "return 1 /*CASE:null*/" })).text), null, "null 是合法结果");
        assert.equal(JSON.parse((await mcp.call("console", { expression: "return 1 /*CASE:empty*/" })).text), "", "空串是合法结果");
        assert.equal(JSON.parse((await mcp.call("console", { expression: "return 1 /*CASE:false*/" })).text), false, "false 是合法结果");

        // ⑤ gz 压缩结果必须解开
        assert.deepEqual(JSON.parse((await mcp.call("console", { expression: "return 1 /*CASE:gz*/" })).text), { deep: true });

        // ⑥ 壳对象竞态：第一次读只有 {ok:1}，必须继续轮询而不是返回它
        assert.equal(JSON.parse((await mcp.call("console", { expression: "return 1 /*CASE:race*/" })).text), 7);

        // ⑦ memory_get：普通 JSON 与 gz 都要解
        assert.deepEqual(JSON.parse((await mcp.call("memory_get", { path: "plain" })).text), { k: 1 });
        const big = await mcp.call("memory_get", { path: "big" });
        assert.ok(big.text.includes("已截断"), "超过输出上限必须截断并提示（实际：" + big.text.slice(0, 60) + "）");

        // ⑧ 只读模式下写工具被拒
        const blocked = await mcp.call("memory_set", { path: "a.b", value: "1" });
        assert.ok(blocked.isError && blocked.text.includes("SCREEPS_ALLOW_WRITE"), "只读模式必须拒绝写工具");
        const deployBlocked = await mcp.call("deploy_code", { dryRun: true });
        assert.ok(deployBlocked.isError && deployBlocked.text.includes("SCREEPS_ALLOW_WRITE"), "只读模式必须拒绝部署");

        // ⑨ 超长表达式直接拒绝（不要白等 12 秒）
        const long = await mcp.call("console", { expression: "return [" + "1,".repeat(400) + "1]" });
        assert.ok(long.isError && long.text.includes("安全上限"), "超长表达式应立刻报错");

        // ⑩ 未知工具
        const unknown = await mcp.call("nope", {});
        assert.ok(unknown.isError, "未知工具必须返回错误");

        // ⑪ POST 不重试：模拟连接被断，应当一次就失败（stats.destroyedPosts 恰为 1）
        const dropped = await mcp.call("console", { expression: "return 1 /*CASE:drop*/" });
        assert.ok(dropped.isError, "连接断掉时应报错而不是静默成功");
        assert.equal(stats.destroyedPosts, 1, "非幂等 POST 不允许重试（实际尝试次数：" + stats.destroyedPosts + "）");

        // ⑫ 其余只读工具
        assert.deepEqual(JSON.parse((await mcp.call("room_objects", { room: "W26N58" })).text), { creep1: { x: 1 } });
        const ov = JSON.parse((await mcp.call("overview", {})).text);
        assert.equal(ov.shards.shard3.rooms, 2);
        assert.deepEqual(ov.shards.shard3.topCpu[0], { room: "A", cpu: 9 }, "每房 CPU 取序列最后一个值");
        const mk = JSON.parse((await mcp.call("market_orders", { resourceType: "energy", type: "sell", limit: 1 })).text);
        assert.equal(mk.length, 1);
        assert.equal(mk[0].price, 1, "按价格升序后取第一条");

        // ⑬ 探针键必须清理干净：Memory 里的 __mcpProbe* 一个都不许留（失败路径也一样）
        const leftovers = [...store.keys()].filter(k => k.startsWith("__mcpProbe"));
        assert.deepEqual(leftovers, [], "探针键必须全部清理，实际残留：" + leftovers.join(","));

        console.log("mcp server checks passed");
    } finally {
        mcp.close();
        server.close();
    }
})().catch(err => {
    console.error("FAILED:", err && err.message || err);
    process.exit(1);
});
