#!/usr/bin/env node

// Convert the local, folder-based source layout into Screeps' flat
// { moduleName: moduleContents } upload format. This script only writes a
// local payload; it never calls the Screeps API.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = JSON.parse(fs.readFileSync(path.join(root, ".screeps-code.json"), "utf8"));
const selected = JSON.parse(fs.readFileSync(path.join(root, "deploy/core-modules.json"), "utf8"));
const sourceModules = source.modules || source.code;
const modules = {};

for (const name of selected) {
    if (sourceModules[name] === undefined) throw new Error(`Missing source module: ${name}`);
    const localFile = name === "algo_wasm_PriorityQueue"
        ? "algo_wasm_PriorityQueue.case-conflict.js"
        : `${name}.js`;
    const localPath = path.join(root, "modules", localFile);
    if (!fs.existsSync(localPath)) throw new Error(`Missing local module: ${name}`);
    // Preserve Screeps binary modules verbatim from the API snapshot.
    // JavaScript source comes from the refactored local file.
    modules[name] = typeof sourceModules[name] === "string"
        ? fs.readFileSync(localPath, "utf8")
        : sourceModules[name];
}

const payload = { branch: process.env.SCREEPS_BRANCH || source.branch || "default", modules };
const output = path.join(root, "deploy/core-payload.json");
fs.writeFileSync(output, `${JSON.stringify(payload)}\n`);
console.log(`Wrote ${Object.keys(modules).length} modules to ${output}`);
