/**
 * `Memory.stats.RCL` 不能给满级房留僵尸百分比（2026-11-15 实测）。
 *
 * 现场：14 个房全部 RCL8，`Memory.stats.RCL` 里却是 14 条 `99.99x%`。原因是旧写法
 * 把 `level < 8` 塞进 filter —— 房间满级后不再被写，而随后的清理只删「不再是我们的
 * 房」，于是**最后那个 sub-100 的旧值永久冻结**。看板 `renderRooms()` 直接拿它画
 * 进度条并且只在 `p >= 99.99` 时显示「RCL 满」⇒ 满级房永远显示「99.99% 差一点」，
 * 巡检时也读不出「已经满级」这个事实。
 *
 * 这里守两条：
 *   ① 满级房必须被写成 100（而不是跳过）—— RCL8 的 `progressTotal` 是 0，
 *      不经三元保护直接相除会得 NaN，所以还得验那不是裸除法；
 *   ② 负对照：把源码换回「filter 里带 level < 8」的旧写法，检查器必须判红。
 *      （否则等于「什么都放过」，这条测试就没有价值。）
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** 剥掉行注释与块注释：注释里出现 `level < 8` 不算实现。 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * 返回 true 表示「这段源码满足满级房写 100 的约定」。
 * 纯文本判定，便于对旧版本源码做负对照。
 */
function writesFullMarks(src) {
    const code = stripComments(src);
    const line = code.split(/\r?\n/).find(l => l.includes("rclStats[room.name] ="));
    if (!line) return false;
    // 旧写法：满级房在 filter 里被排除，永远不会被写
    if (/e\.level\s*<\s*8/.test(line)) return false;
    // 必须真的写入 100（三元，不是裸除法）
    assert.ok(/level\s*>=\s*8\s*\?\s*100\s*:/.test(line),
        "满级房必须写成 100，不能跳过：RCL8 的 progressTotal 是 0，裸除法会写出 NaN");
    // 非满级房仍然要写真实百分比
    assert.ok(line.includes("progress / room.controller.progressTotal * 100"),
        "非满级房仍要写真实进度百分比");
    return true;
}

const main = fs.readFileSync(path.join(ROOT, "modules/main.js"), "utf8");

// ① 现状：必须过
assert.equal(writesFullMarks(main), true,
    "Memory.stats.RCL 必须给满级房写 100：否则最后那个 sub-100 的旧值会永久冻结在看板里");

// ② 负对照：旧写法（level < 8 放在 filter 里）必须被判红
const oldStyle = `
    let rclStats = Memory.stats.RCL;
    getTickObjects().rooms.filter(e => e.my && e.level < 8).forEach(room => rclStats[room.name] = room.controller.progress / room.controller.progressTotal * 100);
`;
assert.equal(writesFullMarks(oldStyle), false,
    "负对照：旧写法（满级房被 filter 排除）必须被判红，否则这个检查什么都没守");

// ③ 负对照：写成裸除法（NaN）也必须被判红
const nanStyle = `
    let rclStats = Memory.stats.RCL;
    getTickObjects().rooms.filter(e => e.my).forEach(room => rclStats[room.name] = room.controller.progress / room.controller.progressTotal * 100);
`;
assert.throws(() => writesFullMarks(nanStyle), /progressTotal 是 0/,
    "负对照：不带三元保护的裸除法必须被拦下（RCL8 会写出 NaN）");

// ④ 注释里出现旧写法不算实现（剥注释后再判）
const commented = main.replace("room.level >= 8 ? 100 :", "/* 旧值为 level < 8 过滤 */ room.level >= 8 ? 100 :");
assert.equal(writesFullMarks(commented), true,
    "行/块注释里的 level < 8 不该让检查器误判");

console.log("rcl-stats-maxed: OK");
