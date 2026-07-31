# Screeps `default` branch snapshot

Downloaded read-only from the official Screeps API on 2026-07-31 (Asia/Shanghai).

- Source branch: `default`
- Modules: 70
- Raw API response: `.screeps-code.json`
- Extracted source files: `modules/`
- Module index: `MODULES.tsv`

## Case-sensitive module names

The source branch contains both `algo_wasm_PriorityQueue` and
`algo_wasm_priorityqueue`. The local filesystem is case-insensitive, so the
former is stored as `modules/algo_wasm_PriorityQueue.case-conflict.js`; its
canonical module name is preserved in `.screeps-code.json` and `MODULES.tsv`.

All extracted files passed `node --check`. This verifies JavaScript syntax
only; it does not emulate the Screeps runtime or its globals.

## Deployment profiles

The full snapshot is retained for incremental refactoring. Do not upload it as
the first deployment on a 20 CPU account. Start with `deploy/core-modules.json`
and use the accompanying `CHANGELOG.md` to restore one optional module group at
a time. The JSON source module `algo_wasm_PriorityQueue` is a WASM binary
module, not JavaScript; preserve its exact raw representation when packaging.
