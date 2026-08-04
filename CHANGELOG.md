# Changelog

## v0.67.0 — Spawn-independent route refresh

### Fixed

- Refresh and validate an existing external-road path before checking Spawn
  availability. Local spawn pressure can no longer leave a broken cached road
  path untouched indefinitely.

## v0.66.0 — Complete external-road routes

### Fixed

- Reject cached PathFinder results that do not actually reach storage and
  invalidate the old incomplete route immediately.
- Treat unbuilt blueprint structures as very expensive rather than impassable
  while calculating external roads, so a route can enter the home room and
  reach storage without laying arbitrary roads.

## v0.65.0 — Full-load carrier pickups

### Fixed

- Source-container and external-mining carriers now withdraw only when the
  container holds strictly more energy than that creep's full carry capacity.
  Insufficient loads are left in place instead of triggering a partial trip.

## v0.64.0 — Fully reinforce fresh ramparts

### Fixed

- Keep a builder on its newly completed rampart until its carried energy is
  exhausted (or the rampart is full), rather than releasing it after one
  repair intent.

## v0.63.0 — Strict RCL blueprint tiers

### Fixed

- Restrict Extension construction to the first blueprint slots unlocked by
  the current RCL. Missing slots remain diagnostics, never a reason to place
  an Extension in a future-RCL position.
- Remove Extension construction sites outside the current RCL tier, including
  sites created by the prior fallback implementation.

## v0.62.0 — Immediate extension placement diagnostics

### Fixed

- Retry a missing Extension on every staggered high-level economy pass rather
  than waiting for its background construction time slot after an RCL upgrade.
- Record the latest extension site creation failure code, coordinate, and
  global construction-site count in compact `Memory.rooms[room].autoBuild`.
  A full account-wide site limit is now visible instead of failing silently.

## v0.61.0 — Deterministic construction and remote roads

### Fixed

- A remembered external source now launches its keeper and carrier directly
  without waiting for a new scout to restore vision. Scouts remain first-use
  discovery only.
- Restrict external road build/repair to the cached source-to-storage route
  and periodically remove off-route road construction sites in remote rooms.
- Retry extension placement every 150 ticks, count queued extension sites,
  and search all blueprint candidates so blocked early positions cannot leave
  a room permanently two extensions short.
- When a rampart construction site completes, keep that builder on a targeted
  repair task on the next tick, immediately lifting it above the 1-hit decay
  floor before ordinary maintenance resumes.

## v0.60.0 — Recoverable remote harvesting

### Fixed

- Treat a remote room without current vision as requiring its scoped scout,
  even when historical room Memory exists. This prevents a dead keeper from
  leaving an external source permanently idle after vision expires.
- Dispatch external harvesting before ordinary local staffing so a one-Spawn
  supply room can actually launch its scout, keeper, and road-capable carrier.
- Make legacy external road-builder tasks default to the source-to-storage
  direction. Their previous missing direction turned the cached route index
  into `NaN` and stranded road construction.
- Use source-station data for external defence tasks and safely handle a
  newly queued defender, preventing a null-memory error during hostile scans.

## v0.59.0 — Reliable mission Flag handoff

### Fixed

- Dispatch active PB queues before ordinary room staffing. A freshly idle
  Spawn now creates the waiting healer before optional workers can consume it.
- Give all newly-created Flag Memory a ten-tick visibility grace period.
  Deposit and dynamic combat Flags are now protected from the same delayed
  `createFlag` handoff race as Power Banks.
- Restore the normal conservative PB first-observation lifetime threshold to
  4,200 ticks after resolving the creation bug.

## v0.58.0 — Correct Power Bank Flag creation result

### Fixed

- Treat a visible newly-created PB Flag as success even when this shard's
  `createFlag` call returns `undefined`. The prior string-only check removed
  its mission Memory and explains the E50S42 discovery failure.

## v0.57.0 — Wider Power Bank launch window

### Changed

- Lower the first-observation PB lifetime threshold from 4,200 to 3,400
  ticks. This still reserves a 300-tick travel budget while accepting viable
  nearby 2M-hit banks such as E50S42.

## v0.56.0 — Durable Power Bank Flag handoff

### Fixed

- Keep a newly created Power Bank mission in a ten-tick pending handoff until
  its Flag is visible. This closes the delayed-Flag race where generic orphan
  cleanup could erase a valid PB mission immediately after discovery.

## v0.55.0 — Compact persistent diagnostics

### Optimized

- Retain long-term room CPU telemetry only for owned rooms. One-tick Observer
  vision no longer accumulates remote-room timing records in Memory.
- Prune legacy remote CPU timing records periodically and expire stale error
  stacks/counters after 5,000 ticks, while preserving current diagnostics.
- Record one compact PB mission decision per observed target, including its
  remaining lifetime and selected spawn room, so rejected targets are
  diagnosable without retaining scan histories.

## v0.54.0 — Sparse near-cap rampart maintenance

### Optimized

- Near the RCL8 300M rampart target, maintain only one repair Worker and let
  it expire once the threshold is reached. Two Workers are allowed only when
  the weakest defense falls below 60% of its target.
- Construction staffing now grows with site count: one for small batches, two
  after five sites, and three only after ten sites.

## v0.53.0 — Bounded rampart repair staffing

### Optimized

- Cap background construction and rampart-repair Workers at three per room.
  Repair staffing now scales only from one to three at meaningful energy
  thresholds, preventing large storage reserves from monopolizing Spawns and
  creep CPU.

## v0.52.0 — PB target task snapshots

### Fixed

- Build explicit, immutable attacker/healer task data from the PB flag instead
  of enumerating its transient Memory proxy. New PB pairs always retain their
  flag name, target ID, and destination room after boosting.

## v0.51.0 — PB mission validation

### Fixed

- Reject stale Power Bank flags lacking a target ID, amount, or expiry before
  they enter the spawn queue. This prevents an obsolete Observer record from
  creating a lone attacker with no valid Power Bank target.

## v0.50.0 — Persistent PB pair queue

### Fixed

- Store the pending attacker/healer pair directly on its Power Bank mission
  flag. This preserves the second half of a pair until a Spawn becomes free.

## v0.49.0 — Synchronized PB attacker/healer dispatch

### Fixed

- Dispatch PB queues every tick. Two idle Spawns launch attacker and healer in
  the same tick; a single Spawn launches the second half on the next tick.

## v0.48.0 — Persistent PB direct-queue state

### Fixed

- Store PB direct spawn queues and per-mission cooldowns in ordinary Memory,
  not `Game` globals, so the throttle remains effective across runtime resets.

## v0.47.0 — Flag-free Power Bank team spawning

### Fixed

- Power Bank attack/heal pairs no longer create `spawnTeam` flags. They use a
  PB-local runtime queue and direct spawn dispatch, removing the Flag Memory
  reset path responsible for repeated invalid-team logs.

## v0.46.0 — PB queue cache independent of Flag Memory

### Fixed

- Moved short-lived PB spawn queues to a tick-persistent `Game` cache and
  added a per-PB respawn cooldown. This stops repeated empty `spawnTeam`
  creation even when the game resets the flag's Memory object.

## v0.45.0 — Durable Power Bank team queues

### Fixed

- Store Power Bank spawn queues in a dedicated Memory map and let the generic
  spawn-team worker read it when Screeps exposes an empty flag Memory object.
  This prevents the PB queue from being mistaken for an invalid manual flag.

## v0.44.0 — Reliable Power Bank spawn-team handoff

### Fixed

- Fixed repeated `Removing invalid spawnTeam flag` logs from Power Bank rooms.
  New PB queues are retained briefly outside `Memory.flags` and attached when
  their newly created flag is visible, preventing orphan cleanup from erasing
  `spawnList` during the creation boundary.

## v0.43.0 — Remove Deposit-triggered RaL combat

### Fixed

- Removed the legacy Deposit hostile-response code that created `raL3`/`raL4`
  combat flags, including the obsolete `raL3_E49S31_1` experiment.
- Orphaned RaL creeps now retire safely when their control flag is removed.
- Power Bank attack and hauling logic remains enabled and independent.

## v0.42.0 — Stable room CPU display and combat queue back-pressure

### Optimized

- Dashboard room CPU now shows the persisted sampled average rather than a
  single profiling tick that can exaggerate transient pathing spikes.
- A persistent `r4` combat flag now waits for its existing spawn queue before
  requesting another squad, preventing queue accumulation when spawning stalls.

### Maintenance

- Removed obsolete claim diagnostic snapshots from live Memory; active claim
  operation state, room state, creeps, market data, and CPU telemetry remain.

## v0.41.0 — Bounded combat spawn queues

### Fixed

- Added a creation timestamp and a bounded 2,000-tick lifetime to every combat
  spawn-team request, preventing blocked queues from becoming permanent CPU work.
- Made RaL combat spawning honour `Memory.cpuFeatures.combat`, so the emergency
  combat pause stops both team execution and new combat spawn requests.

## v0.40.0 — Safe spawn-team validation

### Fixed

- Validate the `spawnList` contract before combat spawn-team logic reads it.
  Invalid legacy or manually created `spawnTeam` flags are logged once and
  removed instead of throwing every tick and draining the CPU bucket.

## v0.39.0 — Staggered optional CPU scheduling

### Optimized

- Move market auto-buy, automatic planning, and room visuals onto separate tick
  offsets so their periodic peaks no longer coincide every 100 ticks.
- Sample detailed module CPU every 97 ticks. The prime interval rotates across
  normal task schedules and produces representative long-term averages instead
  of repeatedly measuring the same worst-case tick.
- Keep market room batches and auto-buy independently scheduled so moving the
  low-frequency order scan cannot accidentally disable it.

## v0.38.0 — Full production gates and persistent CPU profiling

### Added

- Persist low-frequency CPU profiles for loop phases, creep roles, and owned
  rooms in `Memory.codeHealth.moduleCpu`, including average, maximum, latest
  sample, and sample count.
- Include cross-shard `afterWork` serialization in the measured phase costs.

### Optimized

- Write `InterShardMemory` only when requests or acknowledgements actually
  changed instead of serializing and publishing identical data every tick.

### Fixed

- Reject unknown cross-shard mission handlers without throwing and guard
  optional callbacks.
- Safely initialize local cross-shard data when a request is queued before the
  manager has run in the current tick.

## v0.37.0 — Unique signs and highway harvesting

### Added

- Restore Power Bank discovery, mission creation, attack/heal teams, and power
  carriers behind `Memory.cpuFeatures.powerBank`.
- Allow PB-only spawn teams to run independently when the general combat
  feature is disabled.

### Changed

- Replace controller signs with sixteen author-free poetic lines and persist a
  unique assignment for every currently owned room. More than sixteen rooms
  receive a room-name suffix so uniqueness remains guaranteed.
- Keep Deposit and Power Bank room strategies dormant unless matching mission
  flags exist; Observer scans use the same online feature gates.

### Fixed

- Guard missing PB targets, flags, attackers, healers, and carrier-heal targets.
- Avoid stale PB mission Memory when flag creation fails and only advance team
  counters after a spawn-team flag was created successfully.
- Dispatch remote Deposit and PB flags through the spawn room encoded in their
  names instead of the remote room containing the flag; index this mapping once
  per tick to avoid repeated scans.

## v0.36.0 — Full planner, fixed upgrader positions, poetic signs

### Changed

- Allow the complete automatic-planning pipeline whenever the feature is
  enabled and the CPU bucket is at least 6000. The manual planner dispatcher
  remains staggered at 25 ticks; low-level blueprint checks run every 150 ticks
  and high-level construction checks every 600 ticks.
- Record planner CPU cost in `Memory.codeHealth.autoPlanner` (`last`, `average`,
  `max`, `samples`, and `lastTick`).
- Give every controller upgrader a persistent, independently reserved walkable
  position within range three. Keeper positions prefer access to the controller
  link or container.
- Add sixteen short Chinese and English poetry signatures. Each owned room
  deterministically selects one and is re-signed once by a nearby upgrader or
  worker before normal work resumes.

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
## v0.24.0 — Compact interactive console dashboard

### Changed

- Reduced the default `dash()` overview from twelve columns to eight; hover a
  room name to see terminal, Power, OPS, role, and task summaries.
- Moved per-creep task rows and complete resource lists in `dash("ROOM")` into
  collapsed sections that can be expanded independently.
- Added task tooltips with the full target, position, and registration handler,
  while truncating long IDs in the visible table.
## v0.25.0 — Combat spatial and target reuse

### Fixed

- Switched the console dashboard to `console.logUnsafe`, the explicit rich
  output API required after Screeps began escaping HTML in `console.log`.
  Dynamic room, creep, task, and resource values remain HTML-escaped.
- Limited resource enumeration to own Store keys so prototype helper methods
  no longer appear as `NaN` resource rows.

### Changed

- Added a per-tick all-structure Room query cache and reused it in tower-damage,
  rampart-area, permit-area, and combat CostMatrix generation.
- Limited `WarCache.getRoomStructures` to one visible-room scan per tick even
  when several teams or path searches request the same room.
- Added three-tick selected-target caches to raL1 and atkL2 combat creeps while
  preserving explicit console target overrides and all existing priorities.
## v0.26.0 — Persistent CPU telemetry and smooth surplus use

### Added

- Added persistent per-tick CPU totals plus 100-tick buckets for exact
  since-version, approximately 1000-tick, and approximately 10000-tick
  averages. Statistics include peaks, over-limit ticks, and bucket delta.
- Exposed the uploaded/restored/excluded module profile to the on-demand
  console dashboard.
- Replaced unreliable hover-only dashboard details with native click-to-expand
  room, task, resource, and module sections.

### Changed

- Added a two-tick upgrader interval between bucket 9800 and 9950, smoothing
  the previous jump from one-third speed directly to full speed.

## v0.27.0 — Room manager and runtime cleanup

### Changed

- Reorganized room-management scheduling with descriptive constants and
  method names, while retaining compatibility aliases for older console code.
- Standardized the transient spawn-failure property and cross-shard strategy
  global; legacy public names remain as aliases during staged deployment.
- Added an explicit `dash.help` hint for correct console invocation.

### Optimized

- Removed the unused account-specific tick dispatcher, obsolete manual Power
  Creep routine, and historical debug blocks from the production runtime.
- Execute wake tasks without allocating a Lodash key/value array and calculate
  each room's scheduling hash only once per tick.

### Fixed

- Clear the first refreshed room's movement cache after a script reload as
  originally intended, rather than losing the bootstrap flag too early.
- Corrected `spawnFailue` and `setChangeFindClostestByPath` spellings while
  preserving the latter as a compatibility alias.
- Route resource reports, CPU charts, and commodity-profit HTML through
  `console.logUnsafe`, with readable text fallbacks on older servers.
- Correct empty Store SVG percentages and size each resource background bar
  to its requested width.

## v0.28.0 — Unit-management allocation cleanup

### Added

- Add a central escaped rich-text logger that standardizes all ordinary
  `console.log` output as green `INFO`, yellow `WARNING`, or red `ERROR` lines.
- Highlight Screeps resource names with their mineral/commodity colors while
  leaving explicit dashboards and charts on their raw rich-output path.

### Optimized

- Reuse one filtered alive-PowerCreep list across initialization, room-power
  checks, and OPS generation instead of rebuilding it for each pass.
- Merge live-Creep validation and room grouping into one traversal and replace
  the temporary Lodash group-key array with a direct object iteration.
- Cache main-room, station, body-part, and free-capacity values inside the two
  highest-cost upgrader/harvester task handlers.

### Fixed

- Replace an accidental bitwise `&` in upgrader movement throttling with the
  intended short-circuit boolean condition.
- Remove the duplicate `Creep.prototype.headTask` definition.

## v0.29.0 — Safe claim operations

### Added

- Allow a claim flag to pin its spawning room through
  `flag.memory.spawnRoom`, keeping long-range expansion on an audited route.
- Persist manually excluded BetterMove rooms in
  `Memory.betterMoveAvoidRooms` so route safety survives script reloads.

### Fixed

- Extend clean-build workers to dismantle inactive hostile spawns and other
  damageable hostile structures that block construction in a newly claimed
  room.
- Keep cleanup flags until the target controller is owned and hostile
  structures are actually gone.

## v0.30.0 — Integrated claim cleanup

### Changed

- Replace the separate long-lived clean-build flag for expansion with one
  bounded 5 WORK / 5 CARRY / 5 MOVE claim cleaner spawned by the claim
  strategy only when hostile structures are visible.
- After dismantling the old structure and gaining controller ownership, the
  cleaner automatically becomes a normal bootstrap worker in the new room.

## v0.31.0 — Automatic claim bootstrap

### Added

- Keep the claim operation active after controller ownership and immediately
  create the spawn, extension, and source-container construction sites allowed
  by the current RCL from the saved room blueprint.
- Complete the expansion as one workflow: scout, plan, claim, dismantle old
  structures, create bootstrap sites, and reuse the cleaner as a local worker.

### Optimized

- Cache the current hostile structure ID and use a range lookup only when the
  target changes, avoiding a full `findClosestByPath` search on every cleanup
  tick.

### Fixed

- Allow RCL1 workers to build the first spawn construction site instead of
  always upgrading the controller until RCL2.

## v0.32.0 — Observer-assisted claiming

### Added

- Let claim operations automatically select an owned Observer within its
  10-room range and request priority vision for the target room.
- Refresh target-room stations and generate the blueprint directly from the
  Observer visibility tick, avoiding a manual console observation step.

### Optimized

- Keep claim observations in a separate priority queue so ordinary highway
  scans cannot overwrite them, while issuing at most one Observer intent per
  room and tick.
- Run the claim strategy on its normal three-tick cadence, with an additional
  pass only on the exact priority-vision tick.
- Spawn the short-lived claimer before the reusable cleanup worker when both
  are missing from a long-range expansion.

## v0.33.0 — Claim safety audit and persistent diagnostics

### Added

- Persist a bounded state history and latest room snapshot under
  `Memory.claimOperations[roomName]`; inspect it with `claimLog("E53S21")`.
- Record observation, scouting, planning, claiming, cleanup, first-spawn
  construction, completion, and blocking states without unbounded Memory use.

### Fixed

- Count only `FIND_MY_SPAWNS` when selecting a spawn room or completing an
  expansion, so an old hostile spawn can never satisfy the operation.
- Dismantle every non-blueprint structure that blocks the new layout, while
  retaining ownerless roads, containers, and walls already used by the saved
  blueprint.
- Create only the first spawn site while the room is spawnless; secondary
  extension and container sites are added after that spawn exists, ensuring
  bootstrap workers cannot choose lower-priority construction first.
- Spawn the reusable cleaner/bootstrap worker even in an already-empty target
  room, guaranteeing that the first spawn has a local builder after claiming.

## v0.34.0 — Low-RCL blueprint construction recovery

### Fixed

- Treat construction from an already saved room blueprint as essential
  low-level room maintenance rather than an optional auto-planning feature.
- RCL1–3 rooms now continue creating their allowed spawn, extension,
  container, tower, storage, and road sites on the staggered 150-tick cadence
  even when expensive planner computation and visuals remain disabled.

## v0.35.0 — Interactive reports and commodity economics

### Added

- Add local pointer/click tooltips to `dash()` and `dash("ROOM")`, matching the
  interaction model that already works in `HelperRoomResource.showAllRes()`.
- Add a cached deposit-commodity economics engine that recursively expands
  every level of the factory reaction path into base deposits, minerals,
  energy, and per-level factory OPS costs.
- Persist a compact ranked result in `Memory.marketCommodityAnalysis` and
  expose exact per-resource details through
  `StrategyMarketPrice.getCommodityAnalysis(resourceType)`.

### Changed

- Replace the room-resource ECharts/CDN hover dependency with a self-contained
  console tooltip, avoiding CSP, network, and external `eval` failures.
- Select up to two profitable level-1+ commodities per deposit series for
  automatic sales, using a configurable minimum margin (default 15%).
- Evaluate current buy orders after transaction-energy cost and use bounded
  100–10,000 unit deals; never deal with our own order or below reaction cost.
- Cache full reaction-chain analysis for 5,000 ticks and derive all market
  prices from one weighted history snapshot instead of one history request per
  commodity.

### CPU safety

- Auto-planning may be enabled, but runs only with bucket at least 6,000 and a
  recent 1,000-tick average below 95% of the account CPU limit. Without an
  `autoBlueprint`, `saveBlueprint`, or `showBlueprint` flag its scheduled pass
  is effectively a no-op.
