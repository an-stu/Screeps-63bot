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

// 行尾归一：线上模块常常是 CRLF（历史部署来自 CRLF 工作区），而本地快照/编辑器把它们
// 存成了 LF。两者对 JS 引擎完全等价，但逐字节比对会把它报成「线上被改过」——
// 2026-10-31 就这样误报了 5 个模块（station_observer / strategy_highLevel /
// strategy_claim / 闲聊 v1.0 / 闲聊语料自定义，归一后逐字相同）。
// 现在：行尾差异单独列出、不算漂移；真正的正文差异照旧报错。
const eolNorm = v => (typeof v === "string" ? v.replace(/\r\n/g, "\n") : v);

function diffModules(local, live) {
    const names = new Set([...Object.keys(local), ...Object.keys(live)]);
    const onlyLocal = [], onlyLive = [], content = [], eol = [];
    for (const n of names) {
        const a = local[n], b = live[n];
        if (a === undefined) { onlyLive.push(n); continue; }
        if (b === undefined) { onlyLocal.push(n); continue; }
        const ra = typeof a === "string" ? a : JSON.stringify(a);
        const rb = typeof b === "string" ? b : JSON.stringify(b);
        if (ra === rb) continue;
        if (eolNorm(ra) === eolNorm(rb)) eol.push(n);
        else content.push(n);
    }
    return { onlyLocal, onlyLive, content, eol };
}

async function main() {
    const TOKEN = process.env.SCREEPS_TOKEN || "";
    const BRANCH = process.env.SCREEPS_BRANCH || "default";
    const HOST = process.env.SCREEPS_HOST || "https://screeps.com";

    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

    let problems = 0;
    const bad = msg => { problems++; console.log("  ✗ " + msg); };
    const ok = msg => console.log("  ✓ " + msg);
    const finish = () => {
        console.log(problems ? `\n结果：有 ${problems} 项漂移 —— 处理完再部署 ✗`
                             : "\n结果：三方一致，可以部署 ✓");
        process.exit(problems ? 1 : 0);
    };

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
    let local = null;
    try {
        execFileSync("node", [path.join(root, "scripts", "build-core-payload.cjs")], { cwd: root, stdio: "ignore" });
        const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
        local = payload.modules || {};
        console.log(`    ${Object.keys(local).length} 个模块`);
    } catch (e) {
        bad("构建失败：" + e.message.split("\n")[0]);
    }

    // ---------- 3. 线上代码 ----------
    console.log("[3/3] 线上游戏代码");
    if (!TOKEN) {
        bad("缺 SCREEPS_TOKEN，无法读取线上代码");
    } else if (local) {
        try {
            const res = await fetch(`${HOST}/api/user/code?branch=${encodeURIComponent(BRANCH)}`, {
                headers: { "X-Token": TOKEN },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const live = data.modules || {};
            const { onlyLocal, onlyLive, content, eol } = diffModules(local, live);
            const list = xs => xs.slice(0, 6).join(", ") + (xs.length > 6 ? " …" : "");
            if (onlyLocal.length) bad(`线上缺 ${onlyLocal.length} 个模块：${list(onlyLocal)}`);
            if (onlyLive.length) bad(`本地缺 ${onlyLive.length} 个模块：${list(onlyLive)}`);
            if (content.length) {
                bad(`线上与本地产物有 ${content.length} 个模块正文不同：${list(content)}`);
                console.log("    （若差异来自你自己刚做的改动，部署即会覆盖；否则先查清是谁改的线上）");
            }
            if (eol.length) {
                console.log(`    · ${eol.length} 个模块仅行尾不同（线上 CRLF / 本地 LF，语义相同）：${list(eol)}`);
            }
            if (!content.length && !onlyLocal.length && !onlyLive.length) {
                ok(`线上代码与本地一致（${Object.keys(live).length} 个模块）`);
            }
        } catch (e) {
            bad("读取线上代码失败：" + String(e.message || e).split("\n")[0]);
        }
    }
    finish();
}

if (require.main === module) main();

module.exports = { diffModules, eolNorm };
