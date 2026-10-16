#!/usr/bin/env node
/**
 * 把本地歌词包（LRC）转成 Screeps 可用的闲聊语料模块。
 *
 * 输入：`/Users/an/Documents/hot200-lyrics/*.lrc`（用户自行抓取的离线歌词包，
 *       标准 LRC：`[ti:]/[ar:]/[al:]/[by:]` 元数据 + `[mm:ss.xxx]正文`，
 *       另含作词/作曲/编曲等署名行与 `*.trans.lrc` 翻译文件）
 * 输出：`modules/闲聊语料自定义.js`，内容形如
 *       `global.TalkCustom = [ "…", "…" ]`
 *       —— 模块 `modules/闲聊 v1.0.js` 的 `TALK()` 每次调用现取，
 *       非空即优先于内置语料，所以导入后无需改动闲聊逻辑。
 *
 * 这是**纯机械转换**：只去时间轴、去元数据、去署名行、去重、限长，
 * 不改写任何正文内容。语料版权与用途由提供素材的人负责。
 *
 * 用法：node scripts/build-chat-corpus.cjs [歌词目录] [输出文件]
 */
const fs = require("node:fs");
const path = require("node:path");

const LYRICS_DIR = process.argv[2] || "/Users/an/Documents/hot200-lyrics";
const OUT_FILE = process.argv[3] || path.resolve(__dirname, "..", "modules", "闲聊语料自定义.js");

const MAX_LEN = 120;   // 单条上限（超长的会被截到句读处，避免一口气念不完）
const MIN_LEN = 3;     // 太短的（"嗯""啊"）没意思，丢掉
const SKIP_TRANS = true; // 翻译文件（*.trans.lrc）默认不收，避免语料变成双语混杂

// LRC 正文行：[00:31.420]又站在你家的门口
const TIME_LINE = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*(.*)$/;
// 署名/制作信息行（网易云把这些也塞在带时间轴的行里）
const CREDIT = /^\s*(作词|作曲|编曲|制作人|混音|母带|吉他|贝斯|鼓|和声|弦乐|键盘|录音|统筹|监制|出品|发行|策划|视觉|艺术|词|曲|OP|SP|人声|后期|封面)\s*[:：]/;
// 纯乐器/间奏标记
const INSTRUMENT = /^\s*[（(\[【]?\s*(间奏|前奏|尾奏|纯音乐|Instrumental|间奏\.{0,3})\s*[)）\]】]?\s*$/i;

function parseLrc(text) {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
        const m = raw.match(TIME_LINE);
        if (!m) continue;                 // 元数据行 [ti:] [ar:] [al:] [by:] [rank:] [offset:]，直接跳过
        let line = m[1].trim();
        // 同一行可能存在**多个时间轴**（副歌复用写法 `[00:12.3][00:15.6]歌词`），
        // 上面的正则只吃掉第一个，剩下的要继续剥干净，否则正文里会残留 `[00:12.3]`。
        line = line.replace(/^(\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, "").trim();
        if (!line) continue;
        if (CREDIT.test(line)) continue;  // 作词 : 杨明学
        if (INSTRUMENT.test(line)) continue;
        // 去掉行内的多重标注，如 ".. (Live)" 保留原样；只做长度与空白整理
        line = line.replace(/\s+/g, " ").trim();
        if (line.length < MIN_LEN) continue;
        if (line.length > MAX_LEN) {
            // 超长行在句读处截断，保持可读
            const cut = line.slice(0, MAX_LEN);
            const at = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("。"), cut.lastIndexOf(" "));
            line = at > 20 ? cut.slice(0, at) : cut;
        }
        out.push(line);
    }
    return out;
}

function main() {
    if (!fs.existsSync(LYRICS_DIR)) throw new Error(`歌词目录不存在: ${LYRICS_DIR}`);
    const files = fs.readdirSync(LYRICS_DIR).filter(f => f.toLowerCase().endsWith(".lrc"));
    const seen = new Set();
    const lines = [];
    let usedFiles = 0, skippedTrans = 0;

    for (const f of files) {
        if (SKIP_TRANS && /\.trans\.lrc$/i.test(f)) { skippedTrans++; continue; }
        const text = fs.readFileSync(path.join(LYRICS_DIR, f), "utf8");
        const parsed = parseLrc(text);
        if (!parsed.length) continue;
        usedFiles++;
        for (const l of parsed) {
            if (seen.has(l)) continue;    // 副歌会重复很多遍，全局去重
            seen.add(l);
            lines.push(l);
        }
    }

    const header = `// 由 scripts/build-chat-corpus.cjs 生成，请勿手改。\n`
        + `// 素材：${LYRICS_DIR}（${usedFiles} 首；已去时间轴/元数据/署名行并全局去重）\n`
        + `// 本文件只放数据；播放逻辑在 modules/闲聊 v1.0.js，非空即优先于内置语料。\n`;
    const body = "global.TalkCustom = [\n"
        + lines.map(l => "    " + JSON.stringify(l)).join(",\n")
        + "\n];\n";
    fs.writeFileSync(OUT_FILE, header + body);

    const bytes = fs.statSync(OUT_FILE).size;
    console.log(`歌词文件 ${files.length} 个（跳过翻译 ${skippedTrans}），实际使用 ${usedFiles} 首`);
    console.log(`去重后语料 ${lines.length} 条，输出 ${OUT_FILE}（${Math.round(bytes / 1024)} KB）`);
}

main();
