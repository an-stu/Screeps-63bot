/**
 * 三方比对不能把「行尾差异」当漂移（2026-10-31 误报 5 个模块）。
 *
 * 现场：`check-sync.cjs` 报线上与本地产物有 5 个模块不同（station_observer /
 * strategy_highLevel / strategy_claim / 闲聊 v1.0 / 闲聊语料自定义），但逐个
 * 归一后逐字相同 —— 线上那 5 个是 CRLF，本地快照存成了 LF。对 JS 引擎等价，
 * 却让「部署前必须绿」的闸门永久变红，等于把闸门废掉。
 *
 * 这里验四件事：
 *   ① 纯行尾差异 → 归入 eol，不算漂移
 *   ② 正文差异（哪怕只差一个字符/行尾之外的空格变化）→ 必须落在 content
 *   ③ 单边缺失（线上缺 / 本地缺）→ 分别落在 onlyLocal / onlyLive
 *   ④ 完全相同 → 四个桶都为空（正对照：别把「什么都报」当修复）
 */
const assert = require("node:assert/strict");
const path = require("node:path");

const { diffModules, eolNorm } = require(path.join(__dirname, "..", "scripts", "check-sync.cjs"));

// ① 纯行尾差异
{
    const local = { a: "line1\nline2\n" };
    const live = { a: "line1\r\nline2\r\n" };
    const d = diffModules(local, live);
    assert.deepEqual(d.eol, ["a"], "CRLF↔LF 应只落进 eol 桶");
    assert.deepEqual(d.content, [], "行尾差异不得算正文漂移");
    assert.deepEqual(d.onlyLocal, []);
    assert.deepEqual(d.onlyLive, []);
}

// ② 正文差异
{
    const local = { b: "const x = 1;\n" };
    const live = { b: "const x = 2;\n" };
    const d = diffModules(local, live);
    assert.deepEqual(d.content, ["b"], "只改一个数字也要被抓到");
    assert.deepEqual(d.eol, []);
}
// ②b 行尾差异 + 正文差异同时存在时必须报正文（不能被 eol 吞掉）
{
    const local = { c: "aa\nbb\n" };
    const live = { c: "aa\r\ncc\r\n" };
    const d = diffModules(local, live);
    assert.deepEqual(d.content, ["c"]);
    assert.deepEqual(d.eol, []);
}

// ③ 单边缺失
{
    const local = { gone: "x", same: "y" };
    const live = { mine: "z", same: "y" };
    const d = diffModules(local, live);
    assert.deepEqual(d.onlyLocal, ["gone"]);
    assert.deepEqual(d.onlyLive, ["mine"]);
    assert.deepEqual(d.content, []);
}

// ④ 完全相同（正对照）
{
    const local = { a: "1\n", b: "2\r\n" };
    const live = { a: "1\n", b: "2\r\n" };
    const d = diffModules(local, live);
    assert.deepEqual([d.content, d.eol, d.onlyLocal, d.onlyLive], [[], [], [], []],
        "完全相同的模块不能出现在任何桶里");
}

// ⑤ 非字符串（二进制模块在 payload 里是 {binary:...}）：按 JSON 比较，行尾归一不适用
{
    const local = { w: { binary: "AAA" } };
    const live = { w: { binary: "AAA" } };
    assert.deepEqual(diffModules(local, live).content, []);
    const live2 = { w: { binary: "BBB" } };
    assert.deepEqual(diffModules(local, live2).content, ["w"]);
}

assert.equal(eolNorm("a\r\nb"), "a\nb");

console.log("check-sync normalize checks passed");
