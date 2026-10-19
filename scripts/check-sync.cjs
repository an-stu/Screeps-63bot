#!/usr/bin/env node
/**
 * 部署前的**三方比对**：本地工作区 / git 远端 / 线上游戏代码。
 *
 * 为什么必须有这一步（2026-10-19 事故）：用户可能同时用另一个会话/手动 push，
 * 我跳过比对直接 `build + deploy`，把远端 3 个 market 修复**覆盖掉了**。
 * 也见过反方向：线上被手动改过，本地再推一次会把线上改动冲掉。
 *
 * 用法：
 *   SCREEPS_TOKEN=xxx node scripts/check-sync.cjs
 *
 * 退出码：
 *   0 = 三方一致（本地干净、与 origin/main 同点、线上代码与本地产物相同）→ 可以放心部署
 *   1 = 有漂移 → 先按提示处理（rebase / 重新部署 / 查明线上改动来源）再做任何部署
 */
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const TOKEN = process.env.SCREEPS_TOKEN || "";
const BRANCH = process.env.SCREEPS_BRANCH || "default";
const HOST = process.env.SCREEPS_HOST || "https://screeps.com";

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sha = v => crypto.createHash("sha256").update(v).digest("hex");

let problems = 0;
const bad = msg => { problems++; console.log("  ✗ " + msg); };
const ok = msg => console.log("  ✓ " + msg);

// ---------- 1. git 远端 ----------
console.log("[1/3] git 远端");
try {
    git("fetch", "origin", "--quiet");
    const behind = Number(git("rev-list", "--count", "HEAD..origin/main"));
    const ahead = Number(git("rev-list", "--count", "origin/main..HEAD"));
    const dirty = git("status", "--porcelain");
    if (behind > 0) bad(`远端领先本地 ${behind} 个提交 —— 先 git pull --rebase，再考虑部署`);
    else ok("与 origin/main 同点或领先");
    if (ahead > 0) console.log(`    （本地领先 ${ahead} 个提交，正常）`);
    if (dirty) bad("工作区有未提交改动 —— 先提交，否则部署内容无法追溯");
    else ok("工作区干净");
} catch (e) {
    bad("git 检查失败：" + e.message.split("\n")[0]);
}

// ---------- 2. 构建产物 ----------
console.log("[2/3] 构建产物");
const payloadPath = path.join(root, "deploy", "core-payload.json");
try {
    execFileSync("node", [path.join(root, "scripts", "build-core-payload.cjs")], { cwd: root, stdio: "ignore" });
    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    const local = payload.modules || {};
    console.log(`    ${Object.keys(local).length} 个模块`);
    global.__local = local;
} catch (e) {
    bad("构建失败：" + e.message.split("\n")[0]);
}

// ---------- 3. 线上代码 ----------
console.log("[3/3] 线上游戏代码");
if (!TOKEN) {
    bad("缺 SCREEPS_TOKEN，无法读取线上代码");
} else if (global.__local) {
    (async () => {
        try {
            const res = await fetch(`${HOST}/api/user/code?branch=${encodeURIComponent(BRANCH)}`, {
                headers: { "X-Token": TOKEN },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const live = data.modules || {};
            const names = new Set([...Object.keys(global.__local), ...Object.keys(live)]);
            const differ = [];
            for (const n of names) {
                const a = global.__local[n], b = live[n];
                const ha = a === undefined ? "missing" : (typeof a === "string" ? sha(a) : sha(JSON.stringify(a)));
                const hb = b === undefined ? "missing" : (typeof b === "string" ? sha(b) : sha(JSON.stringify(b)));
                if (ha !== hb) differ.push(n);
            }
            if (differ.length) {
                bad(`线上与本地产物有 ${differ.length} 个模块不同：${differ.slice(0, 6).join(", ")}${differ.length > 6 ? " …" : ""}`);
                console.log("    （若差异来自你自己刚做的改动，部署即会覆盖；否则先查清是谁改的线上）");
            } else {
                ok(`线上代码与本地一致（${Object.keys(live).length} 个模块）`);
            }
        } catch (e) {
            bad("读取线上代码失败：" + String(e.message || e).split("\n")[0]);
        }
        finish();
    })();
} else {
    finish();
}

function finish() {
    console.log(problems ? `\n结果：有 ${problems} 项漂移 —— 处理完再部署 ✗` : "\n结果：三方一致，可以部署 ✓");
    process.exit(problems ? 1 : 0);
}
