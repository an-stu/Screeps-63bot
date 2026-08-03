const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deploy/core-modules.json"), "utf8"));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, ".screeps-code.json"), "utf8"));

function readModule(name) {
    if (name === "algo_wasm_PriorityQueue") return snapshot.modules[name];
    return fs.readFileSync(path.join(root, "modules", `${name}.js`), "utf8");
}

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const sources = manifest
    .filter(name => typeof snapshot.modules[name] === "string")
    .map(name => [name, stripComments(readModule(name))]);
const handlers = new Map([["suicide", "Screeps API"]]);
const generated = new Map();

for (const [moduleName, source] of sources) {
    for (const match of source.matchAll(/(?:Creep|PowerCreep)\.prototype\.([A-Za-z_$][\w$]*)\s*=\s*function/g)) {
        handlers.set(match[1], moduleName);
    }
    const taskPatterns = [
        /UtilsTask\.task\([^,\n]+,\s*["']([^"']+)["']/g,
        /UtilsTask\.taskData\(\s*["']([^"']+)["']/g,
        /UtilsTask\.taskFlag\([^,\n]+,\s*["']([^"']+)["']/g,
    ];
    for (const pattern of taskPatterns) {
        for (const match of source.matchAll(pattern)) {
            if (!generated.has(match[1])) generated.set(match[1], new Set());
            generated.get(match[1]).add(moduleName);
        }
    }
}

const missing = [...generated]
    .filter(([taskName]) => !handlers.has(taskName))
    .map(([taskName, modules]) => `${taskName} <- ${[...modules].join(", ")}`);

if (missing.length) {
    console.error(`Missing core task handlers:\n${missing.join("\n")}`);
    process.exitCode = 1;
} else {
    console.log(`core task audit passed: ${generated.size} generated tasks, ${handlers.size} handlers`);
}
