# Changelog

## v0.20.0 — GCL room restoration

### Added

- Restore `strategy_GCLRoom` as the explicit opt-in
  `Memory.cpuFeatures.GCLRoom` feature.

### Optimized

- Require both the feature switch and a room-local `GCLRoom` flag before the
  specialized room strategy can replace normal room execution.

## v0.19.0 — Opt-in Deposit restoration

### Added

- Restore `strategy_deposits` as the explicit opt-in
  `Memory.cpuFeatures.deposits` feature; observer scans and room execution share
  the same gate.

### Fixed

- Prevent an undeclared combat-flag global and guard removed Deposit flags and
  absent transfer targets.
- Avoid creating stale `Memory.flags` entries before a suitable spawn room and
  acceptable cooldown are known.

## v0.18.0 — Cross-shard strategies

### Added

- Restore trade and claim cross-shard strategies behind separate explicit
  opt-ins, both additionally requiring the cross-shard manager switch.

### Optimized

- Reduce inventory publication from every 163 ticks to every 1,000 ticks and
  price only resources actually present in owned-room storage.

### Fixed

- Remove accidental `String` fields from cross-shard spawn missions, stop work
  after completed flags are removed, and defer claim blueprints below 9500
  bucket.

## v0.17.0 — Cross-shard foundation

### Added

- Restore `manager_missions` and `manager_crossShard` as the opt-in
  `Memory.cpuFeatures.crossShard` foundation.

### Fixed

- Stop shadowing the official `InterShardMemory` object and remove the old
  unconditional early returns that made the manager inert.
- Parse empty/corrupt remote payloads safely, batch request serialization in
  `afterWork`, and ignore unknown local mission handlers without throwing.
- Fix the leaked global variable in `sendRes`.

## v0.16.0 — Dormant flag utilities

### Added

- Restore `strategy_cleanBuild`, `strategy_blockRoom`, and `strategy_pillage`
  behind independent feature switches and active flag gates.

### Fixed

- Guard removed block-room flags, absent pillage storage, empty last-position
  state, and missing clean-build worker counts.
- Remove per-tick block-room registration logging and avoid sorting cached flag
  objects unnecessarily.

## v0.15.0 — Flag-gated claim restoration

### Added

- Restore `strategy_claim` behind `Memory.cpuFeatures.claim` and an active
  `claim` flag prefix.

### Fixed

- Guard empty scouter tasks, select claimers by their target flag, and stop
  processing immediately after a completed claim flag is removed.
- Defer the expensive first room blueprint until the CPU bucket exceeds 9500.

## v0.14.0 — Planner foundation

### Added

- Restore `helper_visual`, `manager_planner`, and `manager_autoPlanner` as
  opt-in dependencies for later claim and combat modules.

### Optimized

- Gate automatic planning calls in low/high-level room strategies and raL
  visuals behind their feature switches, leaving both at zero runtime work
  until explicitly enabled.
- Skip tower-damage visualization safely until `war_cache` is restored.

## v0.13.0 — Opt-in market restoration

### Added

- Restore `strategy_marketPrice` and `strategy_market` as an explicit opt-in
  feature (`Memory.cpuFeatures.market = true`).

### Optimized

- Remove the full market-price calculation from script initialization.
- Cache market history for 1,000 ticks, commodity sell prices for 1,000 ticks,
  and order lists for 20 ticks.
- Spread the twelve-room market pass across four five-tick batches.

### Fixed

- Consume the `commodities` field returned by profit analysis instead of
  treating the wrapper object as the commodity map.
- Suppress the large profit-analysis HTML unless explicitly requested.

## v0.12.0 — Flag-gated scouter restoration

### Added

- Restore `strategy_scouter` behind `Memory.cpuFeatures.scouter`.
- Add `ManagerFlags.hasPrefix()` so dormant flag-driven modules can avoid
  entering their strategy functions on ordinary ticks.

### Fixed

- Safely handle a `moveto` flag being removed while its scouter is alive.

## v0.11.0 — Remote harvesting restoration

### Added

- Restore `strategy_outerHarvest` behind
  `Memory.cpuFeatures.outerHarvest`; existing `stopRemote` flags still take
  precedence.

### Optimized

- Return immediately in rooms with no `har` flags and process the cached flag
  list only once per scheduling pass.
- Guard scouter, reserver and defender task inspection against empty tasks.

## v0.10.0 — Observer restoration

### Added

- Restore `station_observer` behind `Memory.cpuFeatures.observer` and keep it
  enabled by default outside emergency low-CPU mode.
- Add a shared optional-feature gate so later modules can be disabled without
  another code upload.

### Fixed

- Allow observer scans to run before Deposit and Power Bank strategies are
  restored. Missing strategies are skipped, so PB missions remain paused.
- Initialize remote-room observer memory defensively.

## v0.9.0 — Adaptive 20 CPU scheduling

### Optimized

- Spread high-level room economy and spawn planning over five ticks instead of
  three; tower defense, labs, factories and Power Creeps remain independent.
- When the CPU bucket drops below 9800, stagger only safe RCL8 upgrader ticks.
  Controllers below 20,000 downgrade ticks bypass the throttle immediately.
- Reduce detailed per-room/per-role profiling from every 20 ticks to every 100
  ticks while retaining lightweight health reporting every 20 ticks.

## v0.8.0 — Movement instrumentation control

### Optimized

- Disable BetterMove's per-call CPU analyzer by default. It previously called
  `Game.cpu.getUsed()` before and after every `moveTo`, plus during cache lookup.
- Keep the analyzer available for short diagnostic sessions with
  `BetterMove.setCpuStats(true)` without charging normal gameplay for profiling.

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
## v0.21.0 — Advanced combat package

### Added

- Restored the damage, cache, team core/control/flag, attack-room, defense,
  Power Creep operator, L2 attack, and highway-defense modules as one
  dependency-complete package.
- Added the explicit `Memory.cpuFeatures.combat` opt-in. Every combat
  dispatcher also requires a matching active flag, keeping idle CPU cost low.

### Fixed

- Guarded missing Power Creeps, unregistered defense teams, and absent highway
  targets instead of throwing during combat ticks.
- Corrected highway defender range checks and task creation to use the actual
  flag rather than an undefined variable.
- Applied the visual feature gate inside drawing helpers so combat code cannot
  accidentally spend CPU on visuals while visuals are disabled.
## v0.22.0 — Room and movement hot paths

### Added

- Added an on-demand colored console dashboard. Run `dash()` for the owned-room
  overview or `dash("ROOM")` for resource, role, and current-task details. It
  is never called by the tick loop and therefore has no ongoing CPU cost.

### Changed

- Reused the tower hostile scan for advanced defense detection instead of
  scanning every owned room again on every tick.
- Selected one damaged friendly target per room for tower healing rather than
  repeating two closest-target searches for every tower.
- Replaced carrier hive-target `findClosestByPath` calls with range selection
  over the cached spawn/extension arrays; BetterMove still handles routing.
- Suppressed legacy `visualizePathStyle` options inside BetterMove whenever
  the global visual feature is disabled.
- Increased staggered full room/station discovery from 31 to 61 ticks to
  reduce periodic room-management spikes while retaining prompt recognition
  of completed structures.
## v0.23.0 — Tactical query and target caching

### Added

- Expanded `dash("ROOM")` with a per-creep task table showing role, TTL,
  current task, target, and carried capacity for stalled-task diagnosis.

### Changed

- Added per-tick hostile creep/structure caches on visible Room objects and
  shared them across safe-mode, tower, advanced-defense, and team calculations.
- Preserved immediate safe-mode checks while removing duplicate hostile scans
  from downstream tower and combat logic.
- Reused hostile and tower lists across every member of a combat team during
  incoming-damage evaluation.
- Reworked highway-defense target selection to use one room scan and cheap
  range selection, and removed a duplicate PathFinder call used only for logs.
- Added a three-tick attack-room target cache so active attackers do not repeat
  up to seven `findClosestByPath` searches every tick.
## v0.23.1 — Room cache-key hotfix

### Fixed

- Renamed tactical Room cache fields with a project-specific prefix so they
  cannot collide with Screeps engine internals.
## v0.23.2 — Room Proxy compatibility hotfix

### Fixed

- Validate tactical cache values as arrays because the legacy structure-cache
  Proxy returns `null`, rather than `undefined`, for unknown Room fields.
