/**
 * CHANGELOG 的历史小节不许被「过期副本」整份吃掉（2026-11-06 已发生两次）。
 *
 * 现场：并行会话为了把本地 HEAD 推上去，用 `git checkout <旧提交> -- CHANGELOG.md`
 * （或等效的「snapshot reconcile」）把本文件换成本地那份**过期副本**。它自己只改了
 * 几行模块代码，CHANGELOG 却是净删 284 行 —— v0.78.187 / 0.78.188（两条）/
 * 0.78.189~0.78.195 / 0.78.198 共 11 个小节整段消失，而 git 上看不出任何冲突
 * （那是快进合并，等于用旧内容覆盖新内容）。02:39 还原过一次，01:07 又发生一次。
 *
 * 这里验三件事（只为「删除」报警，绝不为「新增」报警 —— 新增小节不该被这个闸门
 * 拦住，否则并行会话每次发版都要先改测试）：
 *   ① 小节总数不许低于历史下限（只增不减）；
 *   ② 被删过两次的那些版本必须有对应小节（其中 v0.78.188 是两条，各算各的）；
 *   ③ 当前 `main_mount.js` 的版本号必须有 CHANGELOG 小节（发版必须留档）。
 *
 * 负对照：把真实文本砍掉一个小节 / 砍成只剩顶部几十行，`audit()` 必须报错；
 * 真实文本必须零错误（否则等于「什么都报」）。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** 历史下限：2026-11-06 还原后是 274 节（+本次新增 3 节 = 277）。只增不减。 */
const MIN_SECTIONS = 274;

/**
 * 被「过期副本」删过两次的版本（第一次 a3acce0 删 10 节，第二次 d6076e1 又删 11 节）。
 * 0.78.188 出现两次：一次是「少买能量」，一次是「PC 每 tick 运行」。
 */
const SENTINELS = [
    ["0.78.187", 1],
    ["0.78.188", 2],
    ["0.78.189", 1],
    ["0.78.190", 1],
    ["0.78.191", 1],
    ["0.78.192", 1],
    ["0.78.193", 1],
    ["0.78.194", 1],
    ["0.78.195", 1],
    ["0.78.198", 1],
];

/** @returns {string[]} 版本号列表（按出现顺序，"## v0.78.198 — x" -> "0.78.198"） */
function sections(text) {
    return text
        .split(/\r?\n/)
        .filter(line => /^## v\d/.test(line))
        .map(line => (line.match(/^## v([\d.]+)/) || [])[1])
        .filter(Boolean);
}

/**
 * @param {string} text        CHANGELOG 全文
 * @param {string} liveVersion main_mount.js 里的版本号
 * @returns {string[]} 人类可读的错误列表（空数组 = 通过）
 */
function audit(text, liveVersion) {
    const errs = [];
    const found = sections(text);

    if (found.length < MIN_SECTIONS) {
        errs.push(`小节数 ${found.length} < 历史下限 ${MIN_SECTIONS}（整份被旧副本覆盖？）`);
    }

    for (const [version, times] of SENTINELS) {
        const n = found.filter(v => v === version).length;
        if (n < times) errs.push(`v${version} 应有 ${times} 个小节，实际 ${n} 个`);
    }

    if (liveVersion && !found.includes(liveVersion)) {
        errs.push(`线上版本 v${liveVersion} 没有 CHANGELOG 小节`);
    }

    return errs;
}

function liveVersionOf() {
    const src = fs.readFileSync(path.join(ROOT, "modules", "main_mount.js"), "utf8");
    const m = src.match(/version:\s*"([\d.]+)"/);
    return m ? m[1] : "";
}

const text = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const version = liveVersionOf();

// ① 正对照：真实文件必须零错误
assert.equal(version.length > 0, true, "main_mount.js 里找不到 version");
assert.deepEqual(audit(text, version), [], "CHANGELOG 缺小节，见上面的错误列表");
assert.equal(sections(text).includes(version), true, `v${version} 应已留档`);

// ② 负对照：砍掉一个哨兵小节必须被抓到
{
    const parts = text.split(/\r?\n(?=## v)/);
    const idx = parts.findIndex(p => p.startsWith("## v0.78.195"));
    assert.notEqual(idx, -1, "负对照前提：v0.78.195 存在");
    const broken = parts.filter((_, i) => i !== idx).join("\n");
    const errs = audit(broken, version);
    assert.equal(errs.some(e => e.includes("0.78.195")), true, "删掉 v0.78.195 必须报错");
    // 下限闸门只抓「整份被旧副本覆盖」，单个小节不该触发 —— 所以负对照要**造**一个
    // 低于下限的文本，而不是指望「真实节数刚好贴着下限」。原来直接借用本文件的真实
    // 节数，发一次版（+1 节）就让这条断言失去余量、当场变红（2026-11-06 撞到）。
    const trimmed = parts.slice(0, MIN_SECTIONS - 1).join("\n");
    assert.equal(sections(trimmed).length < MIN_SECTIONS, true, "负对照前提：截出的文本确实低于下限");
    assert.equal(audit(trimmed, version).some(e => e.includes("历史下限")), true, "小节数下降也必须报错");
}

// ③ 负对照：只剩顶部几十行（模拟旧副本覆盖）必须被抓到，且不能只报一条含糊错误
{
    const truncated = text.split(/\r?\n/).slice(0, 40).join("\n");
    const errs = audit(truncated, version);
    assert.equal(errs.length >= 3, true, "截断成 40 行时应有成片错误，实际：" + JSON.stringify(errs));
}

// ④ 负对照：0.78.188 少掉一条（同版本两节，按次计数）必须被抓到
{
    const parts = text.split(/\r?\n(?=## v)/);
    const idx = parts.findIndex(p => p.startsWith("## v0.78.188"));
    const broken = parts.filter((_, i) => i !== idx).join("\n");
    assert.equal(audit(broken, version).some(e => e.includes("0.78.188")), true,
        "v0.78.188 的两节之一丢失必须报错");
}

// ⑤ 新增小节不该触发任何错误（闸门只抓删除，不拦发版）
assert.deepEqual(audit("## v9.9.9 — new\n\n" + text, "9.9.9").filter(e => e.includes("9.9.9")), []);

console.log("changelog integrity checks passed (" + sections(text).length + " sections, live v" + version + ")");
