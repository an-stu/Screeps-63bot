/**
 * Central text logger for the Screeps console.
 *
 * Every plain log line is rendered as:
 *   [tick] [LEVEL]  [Module]  message
 * with fixed-width level/module tags (nbsp padding) so lines align, colored
 * levels (INFO green / WARNING amber / ERROR red), colored resource tokens,
 * numbers in a fixed cyan (prices in gold when the line is about money), and
 * HTML-escaped dynamic content.
 *
 * Explicit HTML reports keep calling console.logUnsafe directly.
 * Formatting work happens only when a message is actually emitted.
 */

const ORIGINAL_CONSOLE_LOG = console.log.bind(console);
const LOG_LEVELS = {
    info: {label: "INFO", color: "#34d399"},
    warning: {label: "WARNING", color: "#fbbf24"},
    error: {label: "ERROR", color: "#fb7185"},
};
// 「[WARNING]」= 9 字符；模块标签按 12 字符对齐（用 &nbsp; 填充，控制台不会折叠）
const LEVEL_WIDTH = 9;
const MODULE_WIDTH = 12;
const NUMBER_COLOR = "#7dd3fc";
const PRICE_COLOR = "#fbbf24";
const PRICE_HINT = /price|价格|价位|买价|卖价|成交|利润|margin|cost/i;

const RESOURCE_COLORS = {
    energy: "#f7d51d", battery: "#f7d51d", power: "#ef4444", ops: "#c084fc",
    H: "#d1d5db", O: "#d1d5db", U: "#4da7e5", L: "#6cf0a9",
    K: "#da6bf5", Z: "#f7d492", X: "#f9a8d4", G: "#ffffff",
    // 基础商品（T1）
    silicon: "#a3e635", metal: "#94a3b8", biomass: "#22c55e", mist: "#38bdf8",
    // 中间品（T2）
    wire: "#f59e0b", alloy: "#cbd5e1", cell: "#10b981", condensate: "#0ea5e9",
    // 高阶与矿物精炼
    composite: "#8b5cf6", crystal: "#e879f9", liquid: "#06b6d4", ghodium: "#f8fafc",
    utrium_bar: "#60a5fa", lemergium_bar: "#4ade80", keanium_bar: "#e879f9",
    zynthium_bar: "#fcd34d", oxidant: "#fb7185", reductant: "#f472b6", purifier: "#fbbf24",
};

let resourcePattern;

function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function stringify(value) {
    if (value instanceof Error) return value.stack || String(value);
    if (typeof value == "string") return value;
    if (value === undefined) return "undefined";
    try {
        return typeof value == "object" ? JSON.stringify(value) : String(value);
    } catch (error) {
        return String(value);
    }
}

function getResourcePattern() {
    if (resourcePattern) return resourcePattern;
    let resources = typeof RESOURCES_ALL == "undefined" ? Object.keys(RESOURCE_COLORS) : RESOURCES_ALL.slice();
    resources.sort((a, b) => b.length - a.length);
    resourcePattern = new RegExp("(^|[^A-Za-z0-9_])(" + resources.join("|") + ")(?=$|[^A-Za-z0-9_])", "g");
    return resourcePattern;
}

/**
 * 数字统一着色（固定青色；行情/价格语境用金色）。
 * 边界要求两侧不是字母/数字，避免把房间名（E41S29）拆成三段。
 */
function colorizeNumbers(escapedText, priceContext) {
    let color = priceContext ? PRICE_COLOR : NUMBER_COLOR;
    return escapedText.replace(/(^|[^A-Za-z0-9_])(-?\d+(?:\.\d+)?)(?=$|[^A-Za-z0-9_])/g,
        (match, prefix, number) => `${prefix}<span style="color:${color};font-weight:600">${number}</span>`);
}

function colorizeResources(escapedText) {
    return escapedText.replace(getResourcePattern(), (match, prefix, resourceType) => {
        let colorMap = global.RES_COLOR_MAP || RESOURCE_COLORS;
        let color = colorMap[resourceType] || RESOURCE_COLORS[resourceType] || "#22d3ee";
        return `${prefix}<span style="color:${color};font-weight:600">${resourceType}</span>`;
    });
}

function inferLevel(text) {
    let normalized = text.toLowerCase();
    if (/\b(error|exception|failed?|invalid)\b/.test(normalized) || /\u62a5\u9519|\u9519\u8bef|\u5931\u8d25/.test(text)) return "error";
    if (/\b(warn(?:ing)?|cannot|disabled|full)\b/.test(normalized) || /\u8b66\u544a|\u4e0d\u8db3|\u4e0d\u662f\u4f60|\u6ee1\u4e86/.test(text)) return "warning";
    return "info";
}

/** 用 &nbsp; 把标签补到固定可见宽度，控制台里多行日志的正文才能对齐。 */
function padHtml(html, width) {
    let visible = html.replace(/<[^>]*>/g, "").length;
    return html + "&nbsp;".repeat(Math.max(0, width - visible));
}

function emit(level, tag, args) {
    let text = args.map(stringify).join(" ");
    let definition = LOG_LEVELS[level] || LOG_LEVELS.info;
    if (typeof console.logUnsafe != "function") {
        ORIGINAL_CONSOLE_LOG(`[${definition.label}]`, tag, text);
        return;
    }
    let priceContext = PRICE_HINT.test(text) || tag == "Market" || tag == "Price";
    let body = colorizeResources(colorizeNumbers(escapeHtml(text), priceContext)).replace(/\n/g, "<br>");
    let levelTag = padHtml(`[${definition.label}]`, LEVEL_WIDTH);
    let moduleTag = padHtml(`[${tag}]`, MODULE_WIDTH);
    console.logUnsafe(`<span style="color:#64748b">[${Game.time}]</span> `
        + `<b style="color:${definition.color}">${levelTag}</b> `
        + `<span style="color:#93c5fd;font-weight:600">${moduleTag}</span> `
        + `<span style="color:#e5e7eb">${body}</span>`);
}

global.Logger = {
    info(tag, ...args) { emit("info", tag, args); },
    warning(tag, ...args) { emit("warning", tag, args); },
    warn(tag, ...args) { emit("warning", tag, args); },
    error(tag, ...args) { emit("error", tag, args); },
    /** 自动判定级别：用于把历史 console.log 原样接管的场景。 */
    log(tag, ...args) { emit(inferLevel(args.map(stringify).join(" ")), tag, args); },
    rawHtml(html) {
        if (typeof console.logUnsafe == "function") console.logUnsafe(html);
        else ORIGINAL_CONSOLE_LOG(String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
    },
    originalLog: ORIGINAL_CONSOLE_LOG,
};

console.log = (...args) => emit(inferLevel(args.map(stringify).join(" ")), "General", args);
