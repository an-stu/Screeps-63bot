# Changelog

## v0.1.0 — CPU bootstrap profile

### Changed

- Reworked `helper_cpuUsed` into a five-tick, 600-sample ring buffer. It no
  longer appends two values every tick or slices 20,000-element arrays.
- Enter `MIN_CPU` automatically below a bucket of 2,000, while retaining the
  existing `Memory.mincpu` manual override.
- Throttled market work to once every five ticks. Auto-planning and visuals
  are disabled by default and can be enabled with `Memory.cpuFeatures`.
- Made the entry point and room manager skip unloaded optional modules rather
  than throwing errors on every tick.

### Bootstrap deployment profile

- `deploy/core-modules.json` defines the first upload payload: 32 survival
  modules (entry point, mining, hauling, spawning, upgrading, and tower
  defense) plus their required helpers.
- Removed 568,248 source characters from this first payload. Market, combat,
  cross-shard coordination, remote operations, deposits, power banks,
  observers, planners, factory production, lab production, visuals, and
  team-control modules remain local and are not loaded.
- High-level worker logic now falls back to unboosted workers when Lab support
  is intentionally absent, and skips Factory/autoplanner work when unavailable.
- Existing creep tasks whose implementation belongs to an omitted optional
  module are paused without throwing every tick. They remain in Memory so the
  matching module can be restored before the operation is resumed.

### Deployment hold

- The current Memory has one `AttackerPB` and one `HealerPB` task. Both belong
  to the deliberately omitted Power Bank module, so this bootstrap payload
  must not be uploaded until those creeps have finished or the user explicitly
  accepts pausing that operation.

### Validation

- `node test/core-profile.test.cjs`
- `node --check` for every JavaScript module in the core manifest (the
  PriorityQueue WASM module is verified as a binary module and intentionally
  excluded from JavaScript parsing).

### Enable optional work deliberately

After its module group has been uploaded and its `require` restored, enable a
feature with `Memory.cpuFeatures.<name> = true`; disable it with `false`.
Current feature switches are `market`, `autoPlanner`, and `visual`.
