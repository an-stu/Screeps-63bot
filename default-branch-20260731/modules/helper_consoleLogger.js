/**
 * Central text logger for the Screeps console.
 *
 * Existing console.log calls are routed through a consistent, escaped rich
 * format. Explicit HTML reports continue to call console.logUnsafe directly.
 * Formatting work happens only when a message is actually emitted.
 */

const ORIGINAL_CONSOLE_LOG = console.log.bind(console);
const LOG_LEVELS = {
    info: {label: "INFO", color: "#34d399"},
    warning: {label: "WARNING", color: "#fbbf24"},
    error: {label: "ERROR", color: "#fb7185"},
};
const RESOURCE_COLORS = {
    energy: "#f7d51d", battery: "#f7d51d", power: "#ef4444", ops: "#c084fc",
    H: "#d1d5db", O: "#d1d5db", U: "#4da7e5", L: "#6cf0a9",
    K: "#da6bf5", Z: "#f7d492", X: "#f9a8d4", G: "#ffffff",
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

function emit(level, args) {
    let text = args.map(stringify).join(" ");
    let definition = LOG_LEVELS[level] || LOG_LEVELS.info;
    if (typeof console.logUnsafe != "function") {
        ORIGINAL_CONSOLE_LOG(`[${definition.label}]`, text);
        return;
    }
    let body = colorizeResources(escapeHtml(text)).replace(/\n/g, "<br>");
    console.logUnsafe(`<span style="color:#64748b">[${Game.time}]</span> `
        + `<b style="color:${definition.color}">[${definition.label}]</b> `
        + `<span style="color:#e5e7eb">${body}</span>`);
}

global.Logger = {
    info(...args) { emit("info", args); },
    warning(...args) { emit("warning", args); },
    warn(...args) { emit("warning", args); },
    error(...args) { emit("error", args); },
    rawHtml(html) {
        if (typeof console.logUnsafe == "function") console.logUnsafe(html);
        else ORIGINAL_CONSOLE_LOG(String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
    },
    originalLog: ORIGINAL_CONSOLE_LOG,
};

console.log = (...args) => emit(inferLevel(args.map(stringify).join(" ")), args);
