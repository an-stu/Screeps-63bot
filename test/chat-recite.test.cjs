/**
 * 闲聊播放逻辑：一只爬**按顺序**把一首歌念完再换下一首（用户 2026-10-16：
 * 「不要 random，一只爬只唱一首歌接着，完全结束再换歌」「多于十个字就分几句」）。
 *
 * 这里用 VM 加载真模块，喂一份自己构造的小语料，逐 tick 驱动 randomSay，
 * 把 say 出来的文本按顺序记下来做断言 —— 顺序、跨行、跨曲、10 字分页全都能验证。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.resolve(__dirname, "..", "modules", "闲聊 v1.0.js"), "utf8");

// 两首歌，刻意包含：短行、超过 10 字的长行（考分页）、以及"整首唱完才换歌"的边界
const SONG_A = ["短句一", "这是一行超过十个字的歌词用来考分页", "短句二"];
const SONG_B = ["第二首第一行", "第二首第二行"];

function load({ custom = [SONG_A, SONG_B] } = {}) {
    const creepSays = [];
    const ctx = {
        console: { log() {} },
        Game: { time: 1000, creeps: {} },
        Memory: {},
        _: { values: o => Object.keys(o || {}).map(k => o[k]), keys: o => Object.keys(o || {}) },
        Creep: function () {},
    };
    ctx.Creep.prototype = {};
    ctx.global = ctx;
    ctx.Talk = ["内置语料不该被用到"];
    ctx.TalkCustom = custom;
    vm.runInNewContext(src, ctx, { filename: "闲聊 v1.0.js" });
    ctx.__says = creepSays;
    return ctx;
}

function makeCreep(ctx, name) {
    const said = [];
    // 必须用 VM 里的 Creep 构造：randomSay 是挂在那个 realm 的 Creep.prototype 上的
    const creep = new ctx.Creep();
    creep.name = name;
    creep.room = { name: "W1N1" };
    creep.say = t => said.push(t);
    ctx.__says.push({ name, said });
    return creep;
}

{
    // ① 单只爬：按行顺序念，长行分页，整首唱完再换下一首、循环
    const ctx = load();
    const NAME = "shard3_1_1";
    const creep = makeCreep(ctx, NAME);
    for (let t = 0; t < 40; t++) creep.randomSay(1);
    const got = ctx.__says[0].said;

    assert.ok(got.length > 0, "应该唱了东西");
    assert.ok(got.every(s => s.length <= 10), "每句最长 10 字（Screeps say 上限）");

    // 用**同一套散列**算出这只爬的起始曲目，再构造完整期望序列：
    // 行内按 10 字分页 → 一行念完接下一行 → 整首念完换下一首 → 循环
    const songs = [SONG_A, SONG_B];
    let h = 0;
    for (const ch of NAME) h = (h * 31 + ch.charCodeAt(0)) % 100003;
    const startSong = h % songs.length;
    const expected = [];
    for (let round = 0; round < 3; round++) {
        for (let k = 0; k < songs.length; k++) {
            for (const line of songs[(startSong + k) % songs.length]) {
                for (let p = 0; p * 10 < line.length; p++) expected.push(line.substr(p * 10, 10));
            }
        }
    }
    assert.deepEqual(got.slice(0, expected.length), expected,
        "逐句完全符合：行内 10 字分页、整首唱完才换歌");

    // 长行必须被切成 10 字 + 余数两句（期望值用同一段 substr 算，不手数字数）
    const L = "这是一行超过十个字的歌词用来考分页";
    assert.ok(L.length > 10, "这条本来就是长行");
    assert.ok(expected.includes(L.substr(0, 10)) && expected.includes(L.substr(10, 10)),
        `${L.length} 字长行 = ${L.substr(0, 10)} / ${L.substr(10, 10)}`);
}

{
    // ② 起始曲目**不是随机**：同一只爬每次重新加载都从同一首开始
    const first = ctx0 => {
        const c = load();
        const cr = makeCreep(c, "shard3_999_1");
        cr.randomSay(1);
        return c.__says[0].said[0];
    };
    assert.equal(first(), first(), "同一只爬的起始曲目必须可复现");
}

{
    // ③ 不同名字的爬起始曲目会错开（不要求全部不同，但样本里应出现两首都有）
    const ctx = load();
    const starts = {};
    for (let i = 0; i < 12; i++) {
        const c = makeCreep(ctx, "shard3_x_" + i);
        c.randomSay(1);
        const firstText = ctx.__says[i].said[0];
        starts[firstText] = true;
    }
    assert.ok(Object.keys(starts).length >= 2, "不同爬应落在不同歌上（否则全场唱同一首）");
}

{
    // ④ chance=0 时不起唱（但已经开唱的爬不受影响，会继续往下念）
    const ctx = load();
    const creep = makeCreep(ctx, "shard3_5_1");
    creep.randomSay(0);
    assert.equal(ctx.__says[0].said.length, 0, "chance=0 不应该起唱");
    creep.randomSay(1);                     // 开唱
    const before = ctx.__says[0].said.length;
    creep.randomSay(0);                     // 已在唱 ⇒ 概率不再拦
    assert.ok(ctx.__says[0].said.length > before, "开唱后不受概率影响，继续往下念");
}

{
    // ⑤ 语料是**扁平数组**时也能用（整体当一首）
    const ctx = load({ custom: ["一句", "两句"] });
    const creep = makeCreep(ctx, "shard3_7_1");
    creep.randomSay(1); creep.randomSay(1);
    assert.deepEqual(ctx.__says[0].said, ["一句", "两句"], "扁平数组按一首歌顺序念");
}

console.log("chat recite checks passed");
