# Changelog

## v0.7.0 — Active raL creep strategy

### Added

- Restore `team_raL1`, covering the active `raL3_E49S31_1` flag and its creep
  task handler. Cross-shard variants remain paused while their manager is off.

### Fixed

- Keep construction-site state local to the raL task and guard the optional
  visual helper.
- Ensure `room.flags()` returns an empty array in rooms with no flags, fixing a
  resource-balancing exception introduced by the room index refactor.
- Record low-frequency CPU phase timings in `Memory.codeHealth.phases` so
  optimization work targets measured runtime costs.
- On profiling ticks, break room CPU down by room name and unit-task CPU down
  by creep role.

## v0.6.0 — Per-tick room indexes

### Optimized

- Build the global flag-prefix map during the existing flag initialization
  pass instead of scanning all flags again on first use.
- Index room flags by their actual position rather than assuming the second
  name segment is always a room name.
- Reuse the per-room flag cache in the room manager instead of repeatedly
  calling `room.find(FIND_FLAGS)`.
- Correct undefined cache initialization for room creep and flag lists.
- Cache room, creep, and Power Creep arrays once per tick for reuse across the
  main lifecycle.
- Remove the redundant full `JSON.stringify(Memory)`/`RawMemory.set` pass every
  127 ticks; the runtime already persists the assigned parsed Memory object.
- Reuse the global Memory cache only across consecutive ticks, falling back to
  the runtime Memory object after a tick gap.
- Execute creep, Power Creep, room, and market batches through one guarded loop
  per group instead of allocating a new try/catch closure for every object.

## v0.5.1 — Tower idle CPU reduction

### Optimized

- Run peaceful tower repairs every three ticks instead of every tick; hostile
  rooms still attack every tick.
- Sort repair targets by damage ratio and never issue an attack with an
  undefined random target.

## v0.5.0 — Factory economy loop

### Added

- Restore `station_factory` for factory carry tasks, energy compression and
  decompression, base commodities, powered commodities, and OPF integration.

### Optimized

- Skip factory dispatch in rooms without a factory.
- Guard stale Power Creep room assignments before reading the room name.

## v0.4.0 — Core lab and boost tasks

### Added

- Restore `station_lab`, which provides the existing `boostCreepBodyPart` task
  handler and the boost/unboost task generators used by room spawning logic.
- Resume lab filling, clearing, reactions, and boost allocation in owned rooms.

### Optimized

- Skip the lab subsystem entirely in rooms with no labs.
- Correct the controller-level active-lab capacity check.
- Add a core task dependency audit and ignore null entries when composing task
  arrays, preventing one unavailable target from corrupting a creep task stack.
- Record a lightweight `Memory.codeHealth` snapshot every 20 ticks with the
  recent average CPU, bucket, unit counts, and missing live task handlers.
- Preserve the most recent caught error and tick in `Memory.codeHealth`.

## v0.3.1 — Power Creep task-target hotfix

### Fixed

- Return the storage object from `needOpStorage` instead of boolean `true`, so
  `UtilsTask.task` receives a valid target.
- Build task room names from `RoomPosition.roomName` and report invalid targets
  explicitly, including the affected task name.

## v0.3.0 — Storage and terminal balancing

### Added

- Restore `strategy_resourceBalance` to keep terminal target stocks balanced,
  redistribute shortages, and evacuate resources from nearly full storages.

### Optimized

- Keep the existing staggered ten-tick schedule for per-room work.
- Use total storage free capacity for fullness decisions rather than a
  resource-specific capacity query.
- Skip factory commodity balancing until the factory module and its tables are
  deliberately restored.

## v0.2.0 — Power Creep survival profile

### Added

- Restore `strategy_factoryPowerCreep` as the only new runtime module. It runs
  every three ticks and keeps renewal, storage capacity, extension filling,
  source regeneration, Power Spawn operation, and mineral regeneration active.

### Fixed

- Spawn a dead Power Creep only after `spawnCooldownTime` has elapsed; the old
  comparison prevented respawning once the cooldown was actually over.
- Refresh `PWR_OPERATE_STORAGE` when its effect is absent or below 100 ticks,
  instead of retrying while a long effect was active.
- Skip factory operation safely while `station_factory` remains disabled.

## v0.1.1 — Shard-name startup hotfix

### Fixed

- Initialize `LOCAL_SHARD_NAME` in `main_mount` so creep initialization and
  high-level worker spawning run without loading the costly cross-shard module.

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

### Deployment status

- Power Bank tasks were explicitly cleared before deploying the bootstrap
  profile. Power Bank automation remains disabled.

### Validation

- `node test/core-profile.test.cjs`
- `node --check` for every JavaScript module in the core manifest (the
  PriorityQueue WASM module is verified as a binary module and intentionally
  excluded from JavaScript parsing).

### Enable optional work deliberately

After its module group has been uploaded and its `require` restored, enable a
feature with `Memory.cpuFeatures.<name> = true`; disable it with `false`.
Current feature switches are `market`, `autoPlanner`, and `visual`.
