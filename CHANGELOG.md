## v0.78.45 — The mineral container clog actually delivers this time

The outer mineral container kept filling with energy (1840 of 2000) until the
mined H tail (160) could not get out either. The earlier "clear crowded
containers" fix withdrew energy into the carrier — but the trip-home condition
counted only `store[H]`, so the energy rode the creep's back forever: withdraw
→ ERR_FULL → stand there. Cleared energy never left the room.

### Fixed

- **Anything on board counts as cargo.** `harvestMineralOuterCarry` now goes
  home whenever `store.getUsedCapacity() > 0` and unloads every carried
  resource at storage (H, the looted energy, anything else). Withdrawn energy
  actually reaches home now.
- **Clog is cleared proactively, not only at 100%.** When the container is
  over half full of energy (loot from dead keepers/invaders; while mining is
  active it competes with H for the same 2000 slots), the carrier hauls a load
  home instead of waiting for the next H batch. H keeps priority: full batch,
  or tail-clearing once the mineral runs dry.
- **The keeper stops looting into a full container** (`getFreeCapacity()`
  guard) — grabbing energy it cannot place is what wedged its 200-capacity
  store in the first place.

### Verified live

W34N55 (43,15): H tail 160 → 0 and one full 1150-energy haul reached home
within a minute of deployment; the chain then idled by design with the mineral
deposit exhausted (keeper/carrier respawn gates require `mineralAmount > 0`).

## v0.78.44 — Invader cores are invulnerable until deployed; bust them on schedule

The new [A15,M15] buster reached the core, stood adjacent, and dealt zero
damage for 20+ minutes. Instrumented, the engine's answer was definitive:
`attack` returns **ERR_INVALID_TARGET (-7) every tick** against an invader core
with `ticksToDeploy > 0`, same room, range 1, ATTACK parts alive. The old
two-crawler squad's hours of pounding only ever chipped the 100k rampart — the
core itself was untouchable the whole time. It becomes attackable (and starts
spawning invaders at lv2, every 6 ticks) when `ticksToDeploy` reaches 0.

### Changed

- **The buster squad deploys on the deploy countdown, not before.**
  `spawnCoreBuster` gates on `ticksToDeploy > CORE_BUSTER_DEPLOY_LEAD (600)`,
  which covers spawn (90 ticks) + cross-room travel (~300) + margin: the creep
  arrives right as the core becomes vulnerable. Once the core has taken any
  damage the gate no longer blocks replacements. Until then the parked buster
  is recycled instead of idling to ttl death (its 1950 energy comes home).
- **Cross-room oscillation at the border was fixed for real.** The buster
  ping-ponged W33N55(0,24)↔W34N55(49,24) every ~15 ticks for 40 minutes:
  its travel (`goTo`) and attack (`moveTo(core, {range:1})`) phases shared one
  movement-cache target, the cross-room path got reused after the border
  crossing with its index desynced, the creep stalled, and passers-by swapped
  it back and forth like an obstacle. Travel now targets the task room's
  centre (`range: 20`) — a different cache target — and the attack phase
  repaths from scratch inside the room. Locked by test.
- `attack` returns **-7, not -9, across a room border**; the handler now moves
  on any non-OK attack result.

### Test

- `test/outer-defense.test.cjs` grows real Screeps error constants (inline
  with the engine: NOT_IN_RANGE=-9, NO_BODYPART=-12, INVALID_TARGET=-7), a
  travel/attack cache-separation case, and invulnerable-core cases: -7 with
  `ticksToDeploy > 0` releases the buster; after deploy it keeps fighting.

## v0.78.43 — Outer defense: engagement rules, and a core buster that can actually finish

W34N55 kept bleeding miners around the edges of the system: defenders stood next
to invader squads without engaging, marched off to grind on the 100k-hit
invaderCore they can never kill, and the two-part [ATTACK,ATTACK,MOVE] core
buster squad crawled at 0.2 tiles/tick with no hope of out-damaging anything.

### Changed

- **Defenders never leave their posts to chew on the invaderCore any more.**
  With no live hostiles around, the old target selection fell back to the core —
  100k hits of invincible target — and both defenders walked 40+ tiles to stand
  under it for the night (one measured at the east edge `(49,18)`, its lair
  uncovered) while keepers slaughtered the miners. Core duty now belongs to the
  coreBuster squad alone; a defender's `targetId` can only ever be a live creep,
  and stale structure ids in old memory are dropped on the next tick.
- **Engagement follows threats, not just lair proximity.** Hostiles within
  `OUTER_DEFENSE_HELP_RADIUS` (8) of any of our creeps — invader squads camp
  right on the haul routes — now count as threats, and of the defenders in the
  room only the **closest one to the target** breaks off to fight; the others
  hold their lair groups. Guard-radius threats work the same way, which also
  removes the old "both defenders converge on one keeper" behavior.
- **The core buster is one big creep, not two crawlers** (user spec:
  ATTACK = MOVE = 15). 450 DPS kills the 100k-hit core in ~222 ticks of contact
  and ~400 ticks door to door, well inside one creep's lifetime — the old pair
  summed to 120 DPS and 0.2 tiles/tick on plains. A level-2+ core adds 5 HEAL
  (invaders spawn from lv2, `INVADER_CORE_CREEP_SPAWN_TIME`), and the handler
  now self-heals alongside attacking (independent intents, same tick). The
  rampart-over-core barrier rule is unchanged and regression-locked.
- **Rooms we lost vision of remember recent hostiles.** An invader squad in
  W35N55 killed every creep we had there; with no vision, `roomNeedsDefense`
  fell back to the flag name (no `invader` in it), so no defender was ever sent
  while keeper/carrier spawns kept marching into the grinder. Seeing hostiles
  now stamps `lastHostileSeen` in room memory; for `OUTER_HOSTILE_MEMORY_TICKS`
  (3000) after losing vision the room still counts as threatened — defenders
  spawn, and miner/mineral/carrier dispatch pauses until one arrives and
  restores vision. No room-specific logic anywhere.

### Test

- New `test/outer-defense.test.cjs` (VM, real module sources): coreBuster plan
  shape, rampart-before-core and self-heal, recycle on dead core; defenders
  drop structure targets, re-acquire live ones per tick, and the
  closest-defender-engages / others-hold rule; `lastHostileSeen` stamp and
  expiry. 5/5 test files green, task audit clean, live sha256 MATCH.

## v0.78.42 — Remote minerals: one container, a crew that can build it, and a way home

Remote mineral harvesting was dead end to end: **zero `harvestMineralOuterKeeper`
existed account-wide**, and W34N55's 35000 H had never been touched. Four
separate defects, each independently sufficient to stop it.

### Fixed

- **A container site was dropped on every non-wall tile around the mineral.**
  `trySpawnOuterMineralKeeper` looped over all 9 neighbours and called
  `createConstructionSite` on each one that was not a wall, with no `break`.
  W34N55 measured: 5 of the 9 tiles are wall, the centre is the mineral itself,
  so it landed **three** sites — `(42,15)`, `(43,15)`, `(43,16)` — 15000 of build
  work that nothing could finish, two of them permanently burning construction
  site quota. `ensureOuterMineralContainerSite` now picks **one** tile (skip the
  mineral tile, skip walls, prefer the tile with the most open neighbours) and
  additionally collapses any legacy duplicates on sight.
- **The "worker" sent to build it never left the home room.** When a site
  already existed the code spawned a `worker` **with an empty task list**, in the
  spawn room. A worker with no tasks just builds whatever is next to it at home;
  it never walks to the remote room. Every mineral container therefore sat at
  `0/5000` forever, and since the harvester's own spawn condition was
  `container` existing, the harvester was never spawned either. Replaced with a
  dedicated `outerMineralContainerBuilder` role.
- **`harvestMineralOuterKeeper` read the wrong Memory path and would have thrown
  every tick.** It did
  `Memory.rooms[room][StationSources.stationName][mineralId]` — but a mineral
  record lives under `StationMineral.stationName` as one flat object per room,
  not keyed by id. That lookup returns `undefined`, so the next line
  `station["container"]` is a guaranteed `TypeError`. Latent only because no
  mineral keeper ever spawned; it would have detonated the moment this chain
  started working. Now reads `stationMineral` and null-checks it.
- **`generatorOuterMineTask` filed the mineral under `stationSources`.** Its
  `regFun` was `registerStationSources`, which writes
  `stationSources[mineralId]`. `trySpawnOuterHarKeeper` iterates
  `stationSources` looking for anything with an `id`, so it would have treated
  the mineral as a mining spot and dispatched an energy keeper to harvest it.
  `regFun` is now empty; remote mineral replenishment is decided by role + task
  room instead.

### Added

- **`outerMineralContainerBuilder`** — `{WORK:16, CARRY:17, MOVE:17}`, 50 parts.
  The container is 5000 progress at 1 energy per progress, and a creep carries
  at most 850, so a single trip cannot finish it. The task
  (`buildOuterMineralContainer`) is a self-repeating loop rather than a fixed
  stack: when it runs dry it pushes one `carryRes` against the home storage,
  which pops itself on withdrawal and hands control back. Verified in game —
  it spawned, withdrew a full 850 energy, and set off for W34N55. Six trips
  finish the container; it then recycles itself instead of idling.
- **`harvestMineralOuterCarry`** — the transport link that did not exist at all.
  Nothing in the codebase carried a remote mineral home: the harvester is a
  static `{MOVE:15, WORK:30, CARRY:4}` that only fills the container, and
  `trySpawnOuterHarCarrier` walks `stationSources` and never sees
  `stationMineral`. Without this the container just fills up and the whole
  chain is pointless. A `{CARRY:25, MOVE:25}` shuttle moves 1250 per ~160 tick
  round trip (≈7.8 H/tick), about 6× faster than letting the harvester do it
  itself (200 per trip). It only spawns once a harvester is already on site, so
  it never idles in an empty room.

### Notes

- Verified after deploy: the three mineral sites collapsed to one at `(43,15)`,
  `containerSite` recorded in `Memory.rooms.W34N55.stationMineral`, the builder
  spawned with the intended body and left carrying 850 energy.
- Source `(32,32)`'s container completed during this window. That matters beyond
  minerals: `trySpawnOuterHarCarrier` is gated on `data["container"]`, and road
  sites are only laid by the road-builder carrier, so a new remote room has no
  roads at all until its first container finishes.

## v0.78.41 — Remote defence: patrol the lairs, scope the mineral record, size the keepers

### Fixed

- **Outer defenders camped on a single lair and missed the others.**
  `outerDefense` used to stand at the lair with the smallest `ticksToSpawn` and wait
  there. When a keeper came out of any of the other three lairs the defender was not
  present and the miners took hits. It now patrols the lairs in a fixed order (sorted
  by position so the route does not jitter), dwelling at each for
  `OUTER_DEFENSE_PATROL_DWELL` (90 ticks, `Memory.marketSettings.outerDefensePatrolDwell`)
  while healing itself, so all four spawn points are covered within one lap. Also:
  picking an injured ally to heal uses `findClosestByRange` instead of `findClosestByPath`
  (no pathfinding needed to choose a nearby ally), and self-healing is unconditional, so
  the defender tops up while dwelling rather than only while out of melee range.
- **`StationMineral` records now only cover rooms we actually mine.**
  The previous change kept a mineral record whenever an extractor existed, which meant an
  enemy room's extractor (seen through the observer) left a `stationMineral` entry we can
  never mine but still pay to serialise. A non-owned room now only keeps the record when
  it carries a `har` flag. Owned rooms are unchanged: extractor present → record written,
  no extractor → cleared, so `trySpawnHarKeeper` still never dispatches a mineral keeper
  for a room that cannot mine.
- **Outer keepers were too small to drain a Source Keeper source.**
  A source in a Source Keeper room holds 4000 energy and resets every 300 ticks, i.e. a
  reset rate of ~13.33 energy/tick. `outerMaxPartCnt` was 3, producing
  `{MOVE:3, WORK:6, CARRY:1}` — 6 WORK parts = 12 energy/tick, **below the reset rate**, so
  the source never drained and the keeper permanently chased regeneration. Three sources
  together only produced ~36 energy/tick while costing three keepers plus their defenders.
  Raised to 5 → `{MOVE:5, WORK:10, CARRY:2}` = 20 energy/tick, comfortably above the reset
  rate: a source drains in ~200 ticks, leaving ~100 ticks of slack. Overridable via
  `Memory.marketSettings.outerMaxPartCnt`.

### Notes

- The three outer keepers alive at deploy time keep the old body until they expire, then
  respawn at the new size. Home-room keepers are untouched (`innerMaxPartCnt`), and
  `getMineralHarvesterBodyConfig` is unchanged.

## v0.78.40 — Remote mining: harvest only high-priced minerals (H / X / L)

### Added

- **`shouldHarvestRemoteMineral` gate for remote mineral mining.** Mineral prices
  differ by more than an order of magnitude, and cheap ones (K≈15, Z≈12, U≈9) are
  not worth the spawn quota, carrier trips, and — in the sector's centre nine rooms —
  the extra defenders needed to work under Source Keepers. Only minerals at or
  above `Memory.marketSettings.minRemoteMineralPrice` (default 120) are mined,
  which selects X≈266 / H≈205 / L≈160 and skips O≈38 / K≈15 / Z≈12 / U≈8.6.
- The price is taken from the **live market floor** (lowest sell order, via the
  existing 100-tick order cache), not from `StrategyMarketPrice.getResTypeHistory`.
  That cache was badly wrong for H: it recorded 1.1 while H actually trades around
  205, which would have made the bot skip one of the most valuable minerals. The
  history value is only a fallback when a mineral has no sell orders at all.
- `StationSources.trySpawnOuterMineralKeeper` is now actually called
  (`strategy_outerHarvest` had it commented out), behind the gate above.

### Notes

- W34N55 (4 keeper lairs, Source Keepers resident, H mineral) is being brought up
  first via `har_W33N55_invader_W34N55`. The centre room W35N55 (no lairs, K
  mineral — too cheap to mine) is deferred until W34N55 is stable.

## v0.78.39 — Fix remote-mining defenders healing and stop selling low-tier commodities

### Fixed

- **Remote defenders stopped healing themselves while in melee range.**
  `outerDefense` had `heal(this)` inside the `attack(...) == ERR_NOT_IN_RANGE`
  branch. `Creep.attack()` only returns OK at range 1, so the moment the defender
  closed into melee it stopped entering that branch and **stopped healing at
  all** — while eating a Source Keeper's melee + ranged output (about 400/tick
  for the tough17/attack10/ranged_attack10/move13 keepers in the sector's centre
  nine rooms). Combined with the undersized fixed body below, defenders died on
  arrival and were replaced forever. `heal(this)` is now unconditional, and
  `rangedAttack` is only called within range 3.
- **Defender bodies no longer ignore the actual garrison.**
  `getOuterHarDefenseBodyConfig` returns body + boost requirement sized from the
  room's live hostile creeps (damage at range 2, their heal, and the toughest
  unit that heal can sustain). Falls back to the previous fixed bodies when
  there is no vision or no live hostiles, so the unobserved path is unchanged.
  When the unboosted body would not fit in 50 parts it asks for boost (heal
  first, then attack) — matching the approach already used by
  `getDefenseHighWayData`.
- **Defender rotation could spawn an extra creep every 6 ticks.**
  The guard read `if (defenser && ttl>170 && !hasSendSpawn && length>1) return;`
  — once `hasSendSpawn` was set, `!hasSendSpawn` was permanently false, so the
  condition never held and a defender was queued on every pass. Rewritten with
  an explicit reason: spawn when none exists, when the oldest is within
  `OUTER_DEFENSE_REPLACE_TTL` (250 ticks, enough for spawn + boost hauling +
  march) **and** no replacement has been requested yet, or when the standing
  count is below `OUTER_DEFENSE_TARGET_CNT` (2 for keeper/invader rooms). Plain
  remote rooms still only spawn on a confirmed hostile / lair / core.
- **Low-tier commodities are no longer sold.**
  Two separate problems, both fixed:
  - `autoSellDeposit` sold silicon / metal / biomass / mist — the level 0 base
    deposits that every higher commodity is synthesised from. Its reserve was
    only 3000, so any surplus was listed for sale; Biomass from the E41S23
    deposit room (E40S22) was sold this way. The reserve is now 100000
    (`Memory.marketSettings.baseDepositKeep`, -1 disables selling entirely):
    normal production is consumed by the factory, and it only acts as a
    blow-off valve when output hugely exceeds what the factory can take.
  - `getBestCommoditiesToSell` accepted `item.level > 0`, so level 1 and 2
    goods (for example tissue, level 2) entered the sell price table and were
    sold by the instant-deal sell path even though they are worth more when
    synthesised further up. Now gated at level >= 3
    (`Memory.marketSettings.minSellCommodityLevel`).

### Notes

- Verified in game that no Biomass sell order remains (the earlier one had already
  been filled and cleared by the zero-remaining cleanup), and the remaining orders
  are the intended high-tier / energy ones.

## v0.78.38 — Stop the tower injured-creep scan in rooms with no hostile contact

### Fixed

- **`StationTower.exec` was the largest per-room cost after the economy pass**
  (0.706 CPU/tick measured with runtime instrumentation) in a colony where every
  owned room is peaceful. On each scan tick (every 10 ticks per room) it ran two
  filtered full-room finds:
  `room.find(FIND_MY_CREEPS, {filter: hits < hitsMax})` concat the same for
  power creeps. Structures and towers cannot attack across a room boundary, so a
  creep inside an owned room can only be damaged if a hostile was in that room at
  the time - in a room that has been quiet those two finds, each building an
  options object and a closure for the engine to call back into, cannot return
  anything.
  They now run only while the room has seen a hostile within
  `PEACEFUL_HEAL_WINDOW` (400 ticks), which re-arms on any contact, so a creep
  that limps home after remote combat still gets healed and a room with hostiles
  present always scans.
  Measured with the same instrumentation before and after: 0.408 -> 0.242 mCPU
  per call (-41%), i.e. 0.706 -> 0.394 CPU/tick. Towers kept repairing
  throughout (6 towers per room with live repair targets, repair queues intact).
  Verified live that the guard is exercised rather than just always-true: at
  check time `lastHostileTimeMap` held W32N56 and E48S41, both ~90 ticks after
  real contacts, while the other eleven rooms skipped the scan.

- **Duplicate buy orders now converge at the end of the pass as well.**
  De-duplication only ran at the start of `autoBuy`, but `autoBuyLowRclEnergy` -
  the first of the creation paths - cancels an order whose remaining amount
  overshoots the current shortfall and immediately replaces it, so the replacement
  was only cleaned up at the start of the *next* pass. In between,
  `Game.market.orders` showed two energy buy orders for the same room (observed on
  E55S31, two orders with identical `createdTimestamp`). The logic is now
  `pro.convergeBuyOrders()`, run before and after the creation paths. Verified
  across 110 ticks spanning an autoBuy pass: duplicates stayed at 0.

### Investigated and deliberately not changed

- **The resource-balance terminal transfers have no in-flight accounting, but it
  is not worth fixing here.** `balanceWithOtherRoom` records nothing about goods
  already in transit, and the destination's `processRoom` recomputes its demand
  from live stock every 10 ticks, so in principle the same shortfall can be
  filled repeatedly while the first shipment is still travelling. Measured over
  225 ticks with `StructureTerminal.prototype.send` instrumented: 10 sends
  total, every gap between sends to the same destination (20/48/82 ticks) far
  exceeding the transit time (2-26 ticks), and no repeated fill of the same
  gap. The rooms are close enough that transit is shorter than the refresh
  cadence, transaction cost is essentially linear in amount, and the extra
  `ceil` rounding across 10 small sends came to roughly 5 energy per 225 ticks.
  Adding Memory-backed in-flight tracking would cost more than it saves.

### Notes

- Full per-function CPU breakdown from the same instrumentation run, for the
  next round of work: `rooms` 6.079 (of which `hl` 2.130 with a 5.78 single-call
  peak, `tower` 0.706, `resBal` 0.498, `lab` 0.477, `factory` 0.431, `obsOver`
  0.196, and about 1.64 of `ManagerRooms.exec`'s own overhead - largely the
  every-61-tick `refreshRoom`). The instrumentation itself inflates every call by
  roughly 0.005 CPU, so treat these as relative weights, not absolutes.

## v0.78.37 — Cut market fee waste, decouple lab/factory from account-wide energy

### Fixed

- **Duplicate market buy orders.** `autoBuyMineral` and `autoBuySome` tested
  "does this room already have an order" with `remainingAmount <= buyCnt`, but
  `buyCnt` is recomputed every pass. When the previous round ordered more than
  this round's gap, `remainingAmount > buyCnt` and the room was counted as having
  no order at all, so another one was created - each duplicate paying the 5%
  creation fee again, freezing more credits and competing with itself on price.
  The test is now the sum of that room's BUY remaining, independent of `buyCnt`.
- **Both of those filters omitted `e.type == ORDER_BUY`.** Our own SELL order for
  the resource (whenever its remaining amount happened to be `<= buyCnt`) removed
  that room from the buy list, so it could never restock.
- **`changeOrderPrice` was called unconditionally and without a type filter.**
  The missing type filter meant our own sell orders were repriced to the buy
  price - quietly marked down for sale. Screeps also charges 5% of
  `(newPrice - oldPrice) x remainingAmount` on any price *increase*, so
  re-issuing an unchanged price is pure loss. Both call sites now filter by
  `ORDER_BUY` and skip unless the price moved by at least 0.001 (the minimum
  increment); `autoBuyPower` got the same idempotency guard.
- **`pauseCommodityBuys` was immediately undone.** It cancels every non-energy
  buy order when energy is tight, but `autoBuyMineral` ran later in the same
  `autoBuy` pass and created them again - a cancel/create cycle every 100 ticks,
  where the cancelled order's 5% is not refunded. The creation path now yields
  while the pause marker is set for the current tick.
- **Labs and factories stopped account-wide on a single starving room.**
  `isEnergyAbundant()` takes the minimum storage+terminal energy across every
  owned room, so one low room forced every lab with a reaction in progress to
  `stat='clear'` and had its centre reagents hauled back to storage, and stopped
  both factory levels from starting batches. Recovering then hauled the same
  reagents straight back in: for an RCL7 ten-lab room that is up to 3000 units in
  each of 10 labs, roughly 30k units moved twice (~20 carrier trips each way),
  plus whatever reaction batch was in flight being voided.
  Labs and the two factory levels now gate on their own room's energy, which is
  what actually constrains them (`station_lab` already tested
  `roomEnergy < 100000`, `station_factory` already tested
  `roomMassStoreCnt(energy) < 100000` - the account signal was stacked on top).
  `isEnergyAbundant()` stays account-wide for genuinely account-level decisions:
  commodity purchasing, factory OP power, powerSpawn processing and the OPF power
  creep - and the paired `exec()` rollback in `station_factory` keeps using the
  same condition, so a factory can never land in the "no OP, no rollback" state.

- **`Memory.cpuTelemetry.buckets` could never shrink back to its cap.** The trim
  was `push(); if (length > cap) shift()`, which only ever holds the array at
  whatever length it already had - push makes it N+1 and shift brings it back to
  N. Once it was over the cap (which happens whenever the cap is lowered, as it
  was when `longTermMaxBuckets` went from 100 to 50) it stayed there. It was
  sitting at 100 buckets against a cap of 50, about 4.7KB of payload that the
  whole Memory tree re-serialises every tick. `splice()` now trims in one go.
- **Duplicate buy orders are converged, not just prevented.** Every creation path
  had some de-duplication, but none could clean up orders that already existed:
  E55S31 was carrying two byte-identical energy buy orders with the same
  `createdTimestamp`. Both freeze credits, both paid the 5% creation fee, and
  they undercut each other. `autoBuy` now keeps only the largest remaining buy
  per (room, resource) and cancels the rest. Verified live: 9 orders -> 7, no
  duplicates.
- **The per-room lab energy gate now has hysteresis.** A single 100000 threshold
  means a room parked on the line flaps - it starts a reaction, has reagents
  hauled in, drops below the line, is forced to clear and has them hauled back
  out. E55S31 was sitting at 100580, right on the boundary. A room already
  reacting stops at 100000; an idle room needs 130000 to start.

### Changed

- Movement and action wrappers no longer allocate per call: `betterMoveTo`
  computes the visual gate into a local instead of cloning the options object,
  `Creep.prototype.moveTo` uses plain parameters instead of a rest array plus
  spread, `lastPos` is mutated in place, and the build/repair/upgradeController/
  dismantle/harvest/attack wrappers only write `dontPullMe` when the value
  actually flips (keepers and upgraders were writing it ~45-60 times per tick).
  `hasActiveBodypart` is cached per creep per tick instead of rescanning a 30-50
  part body on every `moveTo`. `registerStationSourcesCarryOutRoom` and
  `registerStationSourcesDefenseOutRoom` only rewrite their arrays on change.

### Notes

- **Measurement honesty:** the 100-tick `cpuTelemetry` buckets have a noise band
  of roughly +/-1 CPU, so the movement-layer work above is *not* resolvably
  faster in the bucket data - an early 83-sample reading suggested ~0.75 CPU but
  it did not survive at 245 samples (17.067 vs 17.023 for the previous stage).
  The allocation and Memory-write reductions are provable by inspection; the CPU
  claim is not. The market phase fix genuinely added work (13 rooms now run the
  per-room passes that previously only ran for one), so the net CPU is expected
  to sit at or slightly above where it started. `Memory.marketSettings
  .slowPassTicks` (default 80) is the knob if that needs to be traded back.

## v0.78.36 — Make the market passes reachable, replenish combat squads, raise the mineral keep

### Fixed

- **Per-room market gates were mathematically unreachable.** `autoSellMineral`,
  `autoSellDeposit`, the per-room buy block and commodity deals all gate on
  `(Game.time + room.hashCode()) % 80`. `StrategyMarket.exec` is only called when
  `shouldRun(10)` fires, i.e. `Game.time % 10 == 0`, so the congruence needs
  `hash % 10 == 0` to have any solution. Of the 13 owned rooms only E55S39
  (hash -99040) satisfied it. Instrumented in game: 4/4 calls landed on
  `Game.time % 10 == 0` ticks and only that room ever evaluated to 0.
  `autoBuy()`'s own comment records the same class of mistake.
  Replaced with `marketSlowPass()`, built on `Math.floor(Game.time / 40)` which
  increments once per room per 40 ticks and therefore visits every value; rooms
  are spread by hash into `period` phases. Period is tunable via
  `Memory.marketSettings.slowPassTicks` (default 80). `autoSell` moved from a
  `Game.time % 290` gate that only landed on exec's first batch to a 280 tick
  phase.
  Confirmed live: within minutes, rooms that could never sell before
  (E41S23, E41S32, E55S31, E49S31, E59S38, W34N52) started creating sell orders.
  E41S23 is the clean proof: hash -140668, zero hits across 80000 valid exec
  ticks under the old gate, and its X stock of 35955 minus the 30000 keep
  produced exactly the 5955 unit order that appeared.
- **Minerals were sold far too eagerly.** The mineral keep is now 150000 per
  room instead of 30000, so only genuine surplus leaves a room. Orders that fall
  back below the keep are now cancelled - previously the function returned early
  and the stale order kept selling the room down past its retention target.
  Override with `Memory.marketSettings.mineralKeep`.
- **`strategy_atkL2` never spawned anything.** `execSpawn` gated its spawn block
  on `spawnRoom.length <= 8`, but `StationHive.getClosestSpawnRoom` returns a
  Room object, so the comparison was `undefined <= 8 === false` forever.
  Verified in game.
- **Half-dead squads never replenished.** `atkL2`, `defenseAH` and the defense
  flags cleared nothing when a member died: `!flag.memory.attacker` tested a
  stored id rather than a live creep, so the missing half was never rebuilt and
  the flag was never released. A single dead defender was enough to hold
  `room.flags("defenseAH").length < 2` and block every future team. Dead ids are
  now dropped so the member is respawned, with a short cooldown window against
  duplicate spawns before `register*` runs, plus a 300 tick no-hostile cleanup so
  replenished flags do not live forever.
- **`war_defenseCore.exec` aborted its whole pass.** `flag.room` is undefined
  without vision and `room.hashCode()` threw; the exception escaped the `forEach`,
  so every other defense flag went unprocessed that tick and the bad flag was
  never cleaned up.
- **`clearPathCache` ran exactly once per global lifetime.** It latched on
  `Game.__clearPathCache`, which nothing ever reset, so `teamPathCache` grew
  unbounded with one-shot flag names. Now latched per tick.
- **`team_raL1` round-trip patrol index was unbounded**; past `roundRoom.length`
  it built `new RoomPosition(25, 25, undefined)` and threw, stopping the patrol.
- **`delete Game.creeps[name]` did nothing and raised every tick.**
  `pro.init()` had already snapshotted `Game._coreObjects` before
  `ManagerCreeps.init()` ran, so the creep still executed, and with
  `memory.tasks` undefined both `execRegFun`'s `for...of` and `execLastTask`'s
  `.length` threw a TypeError each tick. The memory is now backfilled so the
  creep idles safely until the shard manager fills it in.
- **MIN_CPU silently froze unlisted roles.** The filter used
  `ROLE_PRIORITY[role] > 0`, which is `undefined > 0 === false`, so `reserver`,
  `harvestMineralKeeper`, `outerHarvestEnergyCarrier`, `minRoomWorker` and
  `pillager` were frozen with no log even though the table only marks
  worker/upgrader as pausable. Unlisted roles now run by default via
  `ROLE_PRIORITY_ALLOWED`; the `bucket <= 40` branch keeps its strict whitelist.
- **`HelperError.throwAllError` skipped the whole loop tail.** It threw when
  `pro_err.print === 0` while its call site sits before `HelperCpuUsed.exec`,
  `recordLongTerm`, `updateCodeHealth` and `Memory.stats`, so every throwing tick
  lost telemetry and stats. It also had an unreachable `if(!tmp.length)` branch.
  It now only records and rate-limits logging, so no call site had to move.
- **`station_minetral.update` used `&&` where `||` was meant**, so owned rooms
  without an extractor kept a `stationMineral` entry that `trySpawnHarKeeper`
  would then staff. Also guards a missing `Memory.rooms` entry.
- **`strategy_deposits`** carrier removal was a no-op by construction
  (`if (!contains(id)) without(id)`); the intent was to remove self.
- **Power Creeps carried on after discarding their task.** `OpSource`,
  `OpPowerSpawn`, `OpFactory` and `OpMineral` called `popTask().execLastTask()`
  without returning and then went on to `moveTo`/`usePower` an already-discarded
  (or undefined) target. `needOpMineral` dereferenced
  `room.memory[stationMineral]` without a guard.
- **`RoomPosition.hashCode` ignored `roomCoordinate.y`** and used
  `roomCoordinate.x` twice, so rooms in the same column collided. The value is
  used as a Set key in `war_teamCore` and `strategy_GCLRoom`.
- **`manager_rooms`** wrote `room.Memory` (capital M) - a typo that was never
  read anywhere and did not achieve its stated purpose.

### Changed

- `Memory.codeHealth.moduleCpu` and `cpuLongTerm` were full copies of
  `HelperCpuUsed.profileSummary()` / `longTermSummary()`, duplicating what
  `Memory.cpuModuleTelemetry` and `Memory.cpuTelemetry` already store. Both are
  gone; the dashboard computes them on demand. Measured Memory payload dropped
  from 147215 to 139918 bytes (-5.0%), and both legacy keys are deleted on the
  next code-health write.

### Notes

- Deployed and monitored: `errorCount` stayed at 0, `missingTaskHandlers` empty,
  bucket returned to 10000 and the CPU average settled at 16.84 - below the 17.64
  measured before the change.
- Adds `test/market-phase.test.cjs`, whose negative control proves the old
  formula can never fire for any hash that is not a multiple of 10, while the new
  phase is reachable for every room and lands on an exact period.

## v0.78.35 — Stop energy transaction-cost churn between healthy rooms

### Fixed

- `StrategyResourceBalance` used to create an emergency energy-send buffer
  whenever a room had terminal >=20k and total >=60k, then send to any room
  below the 100k requirement. With every room sitting around 40–60k, this
  caused repeated room-to-room `terminal.send(energy, ...)` calls, each of
  which burns transaction energy.
- Low-energy mode now only allows energy sending to genuinely starving
  rooms (<20k storage+terminal) and only from rooms with a >40k reserve.
  Healthy rooms are no longer shuffled around just to satisfy the 100k
  requirement, so transaction energy is preserved.

### Notes

- Normal energy balancing resumes once `StationHive.isEnergyAbundant()`
  is true.

## v0.78.34 — Stop duplicate keeper/deposit spawns and stuck factories

### Fixed

- **Energy keepers:** `trySpawnOuterHarKeeper` now counts existing keepers
  by `headTask().id` before spawning. Spawning creeps are not yet in the
  source `data.creeps` array, so the old code could queue two or three
  keepers for the same source during the spawn window. E53S21 and W33N53
  were each carrying 4 keepers for 2 sources.
- **Deposit harvesters:** `StrategyDeposits` now includes unregistered
  spawning `harDeposits` in its active count and recycles registered
  over-cap harvesters back down to `walkableAroundCnt`. E49S31's deposit
  had 6 harvesters against a cap of 3.
- **Factory deadlock:** when energy is not abundant, `StationFactory.exec`
  now clears `FILL` and unpowered `PRODUCE` states back to `clear`.
  Previously a high-level `produce` batch waiting for `PWR_OPERATE_FACTORY`
  could stay stuck forever while the energy-surplus gate kept OP disabled
  (E41S32 `phlegm` was stuck with `lastCooldown` 24k ticks in the past).
- **Power spawn energy:** `processPowerSpawn` is paused while the energy
  surplus flag is off, so power is not turned into ops at 50 energy/tick
  while the economy is trying to build its energy reserve.

### Notes

- These changes reduce wasted spawn energy from duplicate creeps and stop
  the last non-essential energy sink (power processing) until energy is
  abundant again.

## v0.78.33 — Cheaper PB detection for spawn power

### Changed

- `PowerCreep.hasPBInRoom` now checks only the persistent `powerBank`
  flags instead of also scanning every owned creep in the room on each
  spawn-power evaluation. This keeps the PB-spawn power logic but removes
  a repeated `FIND_MY_CREEPS` scan from up to four PCs.

## v0.78.32 — Spend PC ops only on PB, combat and essential energy

### Changed

- `PWR_OPERATE_SPAWN` is no longer maintained for ordinary hive
  replenishment. It is only used by a PC whose room has an active
  `powerBank` mission (or live `PBer` / `PBCarrier` / `PBHeal` creeps)
  and only while the PC carries at least 200 ops. This keeps the ops
  reserve for high-value missions.
- `PWR_OPERATE_TOWER` is now combat-only: it requires hostile creeps
  (or hostile power creeps) in the room. Peace-time tower repair no
  longer spends ops.
- `PWR_OPERATE_POWER` additionally requires the global energy-surplus
  flag and a 400-ops buffer, so power processing does not compete with
  cheaper/safer uses.
- Essential energy powers are unchanged and still take priority:
  `PWR_REGEN_SOURCE`, `PWR_OPERATE_EXTENSION` and the existing
  storage-capacity condition. `PWR_OPERATE_FACTORY` remains gated by the
  energy-surplus and factory-need checks added in v0.78.30.

### Notes

- Already-active spawn/tower effects expire naturally; they will not be
  re-applied outside PB / combat conditions.
- `PWR_GENERATE_OPS` still runs whenever the ops store has room, so the
  ops pool keeps accumulating for these targeted uses.

## v0.78.31 — Low-purchase mode cancels commodity buy orders

### Changed

- When `StationHive.isEnergyAbundant()` is false, `StrategyMarket.autoBuy`
  now calls `pauseCommodityBuys`, which cancels every non-energy buy order.
  Basic mineral/O supply will be recreated by the normal `autoBuyMineral`
  rotation once energy is abundant again; labs and factories are already
  paused.
- `autoBuyMineral` no longer buys bar / intermediate products
  (`utrium_bar`, `reductant`, `oxidant`, `purifier`, etc.) while energy is
  not abundant. This removes the main source of the observed commodity-chain
  buy orders.

### Notes

- The first `autoBuy` pass in low-energy mode cancels the current
  commodity/lab/factory buy book; later passes maintain only energy and the
  base mineral reserve.

## v0.78.30 — Energy-surplus gate for labs, factory and commodity buys

### Added

- `StationHive.isEnergyAbundant()`: a per-tick global energy-surplus
  indicator with hysteresis. It averages owned-room `storage + terminal`
  energy and tracks the lowest room:
  - enable when average >= 120k **and** every room >= 40k;
  - disable when average < 80k **or** any room < 20k.
  State is kept in `Memory.ecoBalance` and cached in
  `Game._ecoAbundance` for the tick.

### Changed

- `StationLab.needReaction` no longer starts or maintains lab reactions
  unless the global surplus flag is on **and** the room itself holds at
  least 100k energy. Existing `reacting` state is cleared when the room
  drops below the gate, so reactions pause instead of consuming inputs.
- `StationFactory.needPower`, `noLevel` and `highLevel` are gated by the
  same flag plus a 100k per-room energy floor. `energyCheck` battery
  decompression remains available so low-energy rooms can still turn
  batteries back into energy.
- `autoBuyHighProfitComponents` stops buying commodity-chain inputs while
  energy is not abundant.
- `autoBuyMineral` no longer inflates its purchase line by lab-reaction
  demand while energy is not abundant; base per-room reserves are still
  maintained.

### Notes

- Labs, factories and high-profit commodity buying will turn back on
  automatically once the energy surplus recovers, producing a natural
  on/off cycle instead of continuously spending credits and energy.

## v0.78.29 — Ops buffer for tower power and mineral sell cache fix

### Changed

- `PWR_OPERATE_TOWER` now requires at least 300 carried ops instead of
  100, leaving headroom for factory power on the same PC. P0 (1,642 ops)
  and P4 (490 ops) can maintain it; P2 (260 ops) stays on factory duty.
- `autoSellMineral` no longer skips a mineral when `autoBuyMineral` has
  already written `global._resCnt.tick` for the same tick but only filled
  the one or two resources it happened to be rotating through. Missing
  resource counts are computed on demand, so U/K/Z stockpiles can actually
  be listed for sale.

## v0.78.28 — Mineral mining caps and idle PC power usage

### Changed

- **Mineral mining is no longer “mine until the mineral depletes”.**
  `StationMineral` now pauses a room's mineral keeper when the room's
  storage + terminal + source container holds 20,000 of that mineral. The
  cap sits below `autoSellMineral`'s 30,000 sale trigger, so the room never
  mines just to sell the result.
- **U / K / Z are buy-only.** Their market price (≈9–20 credits) is far
  below the spawn-energy cost of a large mineral keeper, so the bot now
  relies on `autoBuyMineral` for them instead of mining. L / X / O / H
  remain mined up to the 20k cap.
- **Power Creep operator tasks gained the missing useful powers:**
  - `PWR_OPERATE_SPAWN` is used only by PCs with at least 600 carried ops,
    on a room with an active spawning spawn (or a hive deficit), saving
    100 ops per 1,000 ticks on a level-4 PC while shortening spawn time.
  - `PWR_OPERATE_TOWER` is maintained on one tower with ≥500 energy by the
    two PCs that have it, costing 10 ops per 100 ticks and improving tower
    repair/attack efficiency.
  Existing `PWR_GENERATE_OPS`, `PWR_REGEN_SOURCE`, `PWR_OPERATE_STORAGE`,
  `PWR_OPERATE_EXTENSION`, `PWR_OPERATE_FACTORY` and `PWR_OPERATE_POWER`
  behavior is unchanged.

### Notes

- `Memory.mineralSettings[resType].stop` can override the per-mineral
  mining cap; `mineStop` defaults to 20,000.
- PCs without `PWR_OPERATE_SPAWN` / `PWR_OPERATE_TOWER`, or with a low ops
  buffer, are untouched so factory/ops reserves are not diverted.

## v0.78.27 — Stop buying 800k energy after E53S21 reached RCL8

### Changed

- E53S21 reached RCL8, so the dedicated 800k energy buffer is no longer
  needed. `autoBuyLowRclEnergy` now uses the 800k target only while E53S21
  is still below RCL8; afterwards it returns to the normal 100k target.
- Rooms with an existing energy buy order are now always included in the
  management pass, even after their stored energy rises above 50k. This
  lets the code cancel or shrink legacy oversized orders instead of leaving
  them on the market to drain credits.
- Duplicate per-room energy buy orders are cancelled; an order significantly
  larger than the remaining target gap is cancelled and recreated at the
  correct size.

## v0.78.26 — Restore E53S21's dedicated 800k energy buffer

### Changed

- The credit-drain hotfix reduced every room's energy target to 100k. That is
  right for the other rooms, but E53S21 is the only RCL7 room racing to RCL8
  and the user explicitly asked for an 800k buffer. `autoBuyLowRclEnergy` now
  uses an 800k target for E53S21 and 100k for everyone else. Existing
  E53S21 orders are extended to keep ~800k covered, and any order is still
  cancelled once its room reaches its own target.

## v0.78.25 — Cancel energy buy orders once a room reaches its target

### Changed

- `autoBuyLowRclEnergy` now cancels a room's remaining energy buy order
  when stored energy reaches 100,000. Previously the order stayed on the
  market after the room recovered, so a later price spike or market dump
  could fill it and spend credits on energy the room no longer needed.

## v0.78.24 — Let RCL8 upgraders use terminal reserves

### Fixed

- `Creep.prototype.upgradeKeeper` still had a legacy storage gate that
  stopped calling `upgradeController` whenever storage energy was below
  10,000. With most rooms holding their reserve in the terminal while storage
  sat at 0–8k, this left active upgraders standing at the controller with
  70 energy and `ticksToDowngrade` still falling. The gate is removed;
  `shouldRunCreep` already stops RCL8 upgrades when total storage+terminal
  energy is below 30k (or runs them at half speed below 60k).

## v0.78.23 — Power Bank carriers yield to a missing RCL8 upgrader

### Fixed

- E41S23's active Power Bank mission queued three `PBCarrier` spawns while
  its controller had fallen to 51k ticks and had no upgrader at all. The
  spawns were all occupied, so the room could not restore its downgrade
  timer. `trySpawnPBCarrier` now declines to spawn while an RCL8 controller
  is below 80k ticks and has no upgrader (including one currently spawning);
  the Power Bank mission retries on later ticks, while `StationUpgrade` can
  use the free spawn that tick.

## v0.78.22 — Right-size RCL8 carrier fleets dynamically

### Changed

- RCL8 carrier target was a fixed 7 per room. `carryBusy` history showed
  E41S23 averaging 1.9 busy carriers while spawning 3 more, and E59S38/W34N52
  similarly keeping 5–7 around. Those idle carriers held spawn time and
  energy that the recovering upgraders needed. The target is now dynamic:
  4 carriers for 6-link rooms, 5 carriers for rooms with 4–5 links.

## v0.78.21 — RCL8 upgrader spawn no longer blocked by low CPU bucket

### Fixed

- `StationUpgrade.spawnUpgrader` required `Game.cpu.bucket > 9000` before
  spawning an RCL8 upgrader. With average CPU around 17.8/20 the bucket sat
  near 7.8k, so every RCL8 room lost its upgrader and their downgrade timers
  decayed to 51k–78k while three idle spawns and 12.9k energy sat unused.
  Spawning is now decoupled from the bucket; the actual upgrade intents remain
  throttled by `shouldRunCreep` (bucket interval plus 30k/60k energy floors).
  RCL8 rooms will again spawn one upgrader once `ticksToDowngrade < 80k` and
  let it idle once the timer is back above 120k.

### Analysis

- `CONTROLLER_DOWNGRADE_RESTORE` is 100 ticks per successful upgrade action,
  so restoring 70k ticks only costs ~700 upgrade actions (~10.5k energy).
  Long-term RCL8 upkeep is therefore tiny; the previous continuous-upgrade
  drain was not the root cause of the recent energy shortage.

# Changelog

## v0.78.20 — Throttle low-RCL energy buys and auto-sell deposit surplus

### Fixed

- Low-RCL energy buying was draining credits extremely fast: the target was
  300,000 energy and the order followed the top market buy price (75+/unit).
  Money history showed ~250M credits spent in ~1,600 ticks, almost entirely
  energy buys. The target is now 100,000 stored energy and the price is
  capped at `max(history, min(topBuy*1.05, history*1.5))`, so E53S21 and
  starved RCL8 rooms buy enough to upgrade without draining credits.
- Added `autoSellDeposit`: silicon / metal / biomass / mist above a 3,000
  per-room reserve are automatically listed for sale, so deposit harvesting
  produces credits instead of only being consumed by the factory chain.

### Analysis

- Recent money history (deduplicated, tick 83106375–83108032) showed
  `market.buy` −248.9M and `market.fee` −10.4M with **zero sale income**;
  energy buys alone were −244M. That is why credits dropped visibly.
- Deposits were not auto-selling raw output; they fed factory synthesis, and
  only qualifying high-tier commodities are auto-sold.

## ## v0.78.19 — Keep low-RCL energy buy orders competitive

### Changed

- `autoBuyLowRclEnergy` now maintains the price of an existing energy buy
  order for RCL < 8 rooms (and energy-starved RCL8 rooms). Previously it only
  created an order once and skipped rooms that already had one, so an order
  placed at 51 would sit unfilled after the market's top buy price rose.
  Existing orders are now raised to `max(history, topBuy) * 1.05` when they
  fall more than 0.5% below the competitive price.

### Analysis

- Low-RCL rooms still target 300,000 stored energy and do not depend on the
  `Memory.stats.buyEnergy` switch, so buying continues until the room reaches
  RCL8.

## ## v0.78.18 — More downgrade margin and stronger upgrader energy guard

### Changed

- RCL8 upgrader spawn threshold raised from `ticksToDowngrade < 30,000`
  to `< 80,000`, so a room starts refilling the downgrade timer much earlier.
- RCL8 upgraders now idle until `ticksToDowngrade < 120,000` (was < 50,000);
  the 80k/120k hysteresis keeps a 40k safety margin without continuous
  upgrading.
- Energy floor for running RCL8 upgraders raised from 10k/30k to
  **30k/60k** combined storage+terminal: stop below 30k, half speed below
  60k. This is the main protection against the recurring energy shortage.

### Analysis

- A two-source RCL8 room produces at most 20 energy/tick. A full-time
  RCL8 upgrader consumes ~15 energy/tick, and creep replacement (spawn
  upkeep) adds another ~11–19 energy/tick. That is why rooms repeatedly ran
  out of energy when upgraders ran continuously.
- The new 80k/120k schedule plus 30k/60k energy floor lets the upgrader run
  only when the room can actually afford it, and stops it while the hive and
  economy rebuild buffers.

## ## v0.78.17 — Skip construction planning while in min-CPU mode

### Analysis

- `StrategyHighLevel.exec` calls `ManagerAutoPlanner.tryAutoBuildHighLevel`
  directly on every economy pass, bypassing the `isCpuFeatureEnabled`
  and MIN_CPU gates that main.js applies to the full planner. During
  min-CPU mode (deposit expeditions, bucket crises) workers do not run
  (ROLE_PRIORITY -5), so the planned extension/road sites sat unbuilt
  while the prune pass, extension scan and road-gap check still burned
  CPU every pass.

### Changed

- `tryAutoBuildHighLevel` returns early in MIN_CPU mode, keeping only a
  low-gate (bucket > 300) emergency extension site creation for rooms
  whose extension coverage falls below 60% - that gate prevents a
  bootstrap room from stalling because spawn cannot grow its body size.
  Routine extension/road planning and the out-of-tier site prune stay
  suspended until min-CPU mode lifts.

## v0.78.16 — Cheaper health diagnostics and stale RCL stat pruning

### Changed

- The `missingTaskHandlers` diagnostic scan in `updateCodeHealth` now runs
  every 100 ticks instead of every 20 (it walks every creep × every task);
  between scans the last result is carried forward. It exists to catch
  missing modules after a deploy, where a 100-tick detection window is
  plenty.
- `Memory.stats.RCL` entries are pruned when the room is no longer owned.
  The writer only ever added keys, so lost rooms (E43S31, W23N55) stayed
  in Memory forever.

## v0.78.15 — Share one structure scan per refresh pass between tower and defense

### Changed

- `StationTower.update` and `StationDefense.update` both run inside the same
  every-61-tick room refresh and each issued its own full-room
  `FIND_STRUCTURES` scan (~200 structures on an RCL8 room). Both now read
  `room.getStructures()`, the per-tick cache in `prototype_room`, so the
  refresh pass performs at most one scan and later readers reuse it. Filter
  semantics are unchanged (the cache returns the same unfiltered set).
- No behavior change: repair target selection, safe-mode checks and wall
  maintenance run exactly as before, one full scan cheaper per refresh.

## v0.78.14 — Spread market auto-buy scans across ticks

### Analysis

- `MARKET_ORDER_TTL` (100) exactly matches the auto-buy cadence
  (`shouldRun(100, 19)`), so on every auto-buy tick all cached order lists
  expired simultaneously and the tick performed fresh `getAllOrders` scans
  for all 7 base minerals plus the high-profit component analysis — 10-20
  CPU stacked onto an already ~18 CPU tick. This was the main contributor
  to the `optional` phase lifetime max of 24.2 and to the over-limit tail.

### Changed

- `StrategyMarket.autoBuy` now rotates base minerals two per invocation
  (full coverage every 400 ticks; per-resource decision latency is
  immaterial for orders that fill over hours) and runs the high-profit
  component arbitrage every other invocation (200 ticks). Energy buys keep
  their every-100-tick schedule. The every-100-tick spike becomes a small
  distributed cost, directly shrinking the over-limit tail that drains the
  bucket.

## v0.78.13 — Shrink Memory payload: observer bookkeeping out of Memory.rooms

### Analysis

- Live measurement showed `RawMemory` at ~141 KB with `Memory.rooms` at
  ~78 KB (136 entries). Owned-room data is legitimate working state (~41 KB),
  but ~30 KB was observer scheduling bookkeeping (`stationObserver` entries:
  lastUpdateTime / closedMyRoom / priorityVisibleTick / lastPowerBank) spread
  across 123 non-owned highway rooms, plus a per-observer-room `roomNames`
  neighbor cache that was written and only read within the same update call.
  The whole Memory tree is re-serialized every tick, so this was pure
  per-tick overhead.

### Changed

- Observer scheduling bookkeeping now lives in a flat compact map,
  `Memory.observerWatch = {roomName: {u,c,cl,p,pb}}`, written and read through
  `StationObserver.watchRoom`. A one-time migration ports existing
  `Memory.rooms[*].stationObserver` fields and deletes the old keys; stale
  entries (not observed for 3 scheduling windows) are pruned.
- `StrategyObserver.update` no longer persists `roomNames` (the neighbor list
  is a local variable now) and no longer creates `Memory.rooms` entries just
  to stamp `lastUpdateTime`.
- Consumers updated: `strategy_claim` reads `priorityVisibleTick` from the
  watch map; `strategy_powerBank.recordMissionDecision` stores `lastPowerBank`
  there too (it had no other readers).
- `HelperCpuUsed.longTermMaxBuckets` 100 → 50: 5000 ticks of trend buckets is
  enough to judge income/spend, saves ~5 KB of Memory.

## v0.78.12 — Trim fixed per-tick overhead in init and room passes

### Changed

- Cross-shard inbox scans `InterShardMemory` every 5 ticks instead of every
  tick. Each scan reads the local segment plus three remote segments and
  JSON-parses all four, which was the main driver of the init-phase average
  (0.73 CPU) and its 22-CPU spikes. Cross-shard missions run on multi-tick
  timescales, so the added inbound latency (≤5 ticks) is invisible. Outbound
  requests are unaffected: `addCrossShardRequest` still flushes through
  `ManagerCrossShard.afterWork` every tick.
- `ManagerRooms.init` prunes expired room memory every 10 ticks instead of
  every tick. The observer coverage keeps ~138 rooms in `Memory.rooms`, so
  this loop was pure fixed overhead; the 20,000-tick TTL window makes a
  10-tick pruning delay irrelevant.
- `StrategyResourceBalance` reuses the per-tick flag list cached by
  `ManagerFlags.init` instead of running two `FIND_FLAGS` room scans per
  economy pass. The cached list is populated from `Game.flags` for visible
  rooms at the start of the same tick, so the result is identical.

## v0.78.11 — Energy-priority upgrader throttle and market buy filtering

### Changed

- RCL8 controllers are no longer upgraded continuously. Spawning an RCL8
  upgrader requires `ticksToDowngrade < 30,000` and at least 2,500 energy;
  the upgrader only runs while `ticksToDowngrade < 50,000`, so once the timer
  is refilled it idles and the room keeps its energy. RCL8 upgrading used to
  be the largest continuous sink (~15 energy/tick, about 75% of a two-source
  room's production).
- Downgrade emergencies bypass the bucket safety: when `ticksToDowngrade`
  drops below 5,000, an RCL8 upgrader spawns even if the CPU bucket is under
  9,000 (E53S21 fell to ttd 4,909 while the bucket was ~7,000 and the normal
  gate blocked the rescue spawn).
- RCL8 upgraders still respect room energy stock: they stop below 10,000
  combined storage+terminal energy and run at half rate below 30,000.
- Deposits stay enabled (`Memory.cpuFeatures.deposits = true`); deposit
  harvest missions are required. What is filtered is *market buying*: for
  high-profit component ingredients, if there are no sell orders or the
  cheapest sell price is clearly above the acceptable price, no buy order is
  created, so unfillable orders no longer accumulate.

### Analysis

- T3 lab reactions consume about 5 energy per reaction (well under 1/tick)
  and factory batches only 64–1,200 energy each, so compound synthesis is not
  the main energy drain.
- Main drains: RCL8 upgrader energy/tick and repeated creep body replacement
  (spawn upkeep). Rooms therefore cannot fully self-sustain while running a
  full-time RCL8 upgrader on a 2-source budget.
- PC energy production (`PWR_REGEN_SOURCE`, power 13) is active: E53S21's P10
  keeps a level-4 effect on one source (`ticksRemaining` refreshed).
  However, it only boosts regeneration on one source at a time and still
  requires keepers to harvest the extra energy and carriers to move it; if
  keepers/carriers die or upgrade/spawn drain exceeds the boosted output, the
  room still stalls. PC regen is a multiplier, not a replacement for the
  harvest/carry chain.

## v0.78.10 — Faster road rebuild after road decay

### Fixed

- Planned road construction was only re-evaluated every 600 ticks. Rooms whose
  roads decayed to nothing (W33N53, W34N52, E53S21) could sit with missing
  roads for a long time. `tryAutoBuildHighLevel` now checks planned-vs-actual
  road count on every economy pass and immediately re-queues road sites (up to
  the existing per-room construction-site budget).
- `boostCreepBodyPart` no longer waits forever when lab boost resources are
  missing. Boost tasks now carry a `boostExpire` deadline (200 ticks for new
  tasks, 50 ticks retrofit for legacy tasks), after which the creep drops the
  boost task and resumes normal work. W33N53/W34N52 workers were permanently
  stuck on boosting instead of building their missing roads.
- Dead-room bootstrap now counts only *usable* stored energy (terminal + the
  storage portion above 2,000 + containers/links). A room with only a few
  hundred storage energy and no keeper/worker spawns a mining worker instead
  of a carrier that has nothing it can withdraw.
- `autoBuyLowRclEnergy` now also covers RCL8 rooms whose stored energy is
  below 50,000 (e.g. E53S21), so a room whose manual buy order was consumed
  gets a fresh competitive energy order automatically.
- Cross-room resource balancing now sorts targets so rooms with less than
  20,000 stored energy are served first, instead of the nearest room always
  being chosen; starved rooms like E53S21 no longer lose the race to nearer
  ordinary deficits.

## v0.78.9 — Unblock bootstrap carriers after failed expensive spawns

### Fixed

- A failed keeper spawn (expensive body) used to set `room.spawnFailure` for
  the rest of the tick, and since keepers now run first, the 150-energy
  bootstrap carrier could never spawn in a dead room. Carrier bootstrap/
  emergency/recovery spawns now reset `spawnFailure` and re-evaluate current
  energy, so rooms like W33N53 and W34N52 can restart from terminal energy.
- Dead-room bootstrap now runs every economy pass instead of waiting for the
  `%10` (bootstrap) and `%7` (economy) schedules to align, which could delay
  it for dozens of ticks.
- Dead-room fallback: if there is stored energy to haul (storage/terminal/
  container/link) it spawns a 150-energy carrier; if there is no stored energy
  it spawns a 200–300 energy worker with a harvest task instead, so source
  energy can restart the room directly.
- Resource balance no longer assigns `balanceTerminalResource` to the room's
  only free carrier while `HiveNeedToFill` is true; that task was stealing the
  bootstrap carrier in W33N53/W34N52 and keeping spawn/extensions empty.

## v0.78.8 — Continuous energy buying for RCL < 8 rooms

### Added

- `StrategyMarket.autoBuyLowRclEnergy()` keeps a competitive energy buy order
  on every owned room below RCL 8 while credits exceed 5,000,000. It targets
  300,000 stored energy per room and does not depend on `Memory.stats.buyEnergy`.

## v0.78.7 — Bootstrap harvester when hive energy is low

### Fixed

- Keeper spawning always used the room's full energy capacity to size the
  body, so a room like E53S21 with ~1,500 available energy could never afford
  the 3,650-energy full-size keeper, `spawnFailure` stayed set, and the second
  source had no harvester. Keeper body budget now shrinks to the room's
  current available energy (minimum 550), so low-energy rooms can bootstrap
  mining and recover instead of stalling.
- Keeper spawning now runs before worker/carrier spawns in the room economy
  pass; previously carriers consumed the empty hive's last spawn energy and
  the keeper (energy producer) could never spawn.
- `carrierManager` only reserves a tower-filling carrier when at least two
  free carriers exist; with a single free carrier the hive always wins, so a
  dead room cannot get stuck filling towers while spawn/extensions are empty.
- `carryEnergyAuto` can now drain terminal energy down to 0 when it is running
  as a hive-fill task (`allowStorage`), instead of always keeping a 50,000
  market reserve that empty hives cannot afford.
- Added a 150-energy `CARRY*2 + MOVE` bootstrap carrier when a room has no
  carriers, a hive deficit, and only 150–750 available energy, breaking the
  "no creep to move terminal energy, no energy to spawn a creep" deadlock.
- While a hive is in deficit with less than 2,500 available energy, normal
  worker, upgrader, and avgBusy-driven carrier spawns are paused; only keepers
  and the bootstrap/emergency carrier paths may spawn.
- RCL8 rooms now keep at least one upgrader whenever 2,000+ energy is
  available (previously they waited for 150,000 storage energy or
  `ticksToDowngrade < 5000`, which let controllers slide toward downgrade).
  Low-level rooms also spawn an upgrader when they have none and can afford
  the body, instead of waiting for large storage reserves.
- `spawnUpgrader` no longer aborts when the controller container is missing;
  it only aborts when both container and link are gone, so a room with a
  working upgrade link keeps its controller leveled (E53S21).

## v0.78.6 — Tower maintenance during hive deficit and emergency energy sharing

### Changed

- `carrierManager` now reserves one free carrier for tower filling even while
  the hive is in deficit, so towers no longer sit at 0 energy and ramparts
  decay while every carrier chases spawn/extension energy.
- `StrategyResourceBalance` can now send emergency energy from a room with
  terminal energy ≥ 20,000 and storage+terminal energy > 60,000 even when the
  old 150,000-total threshold is not met; this lets nearby rooms feed a room
  whose storage has collapsed (E53S21).

## v0.78.5 — Carrier count control and hive energy guard

### Changed

- Carrier spawn target is now dynamic for low-level rooms (RCL < 8, e.g.
  E53S21): base target is `ceil((sources + harvestEnergyKeepers) / 2)` with a
  minimum of 2 and maximum of 3; while `HiveNeedToFill` is true the target
  gets +1 (capped at 3). High-level rooms keep the original 7-carrier ceiling.
- Emergency/recovery/starved carrier spawns all respect the room target, so
  an empty hive no longer overshoots into too many carriers.
- Excess carriers are not force-recycled; the target only controls spawning,
  so over-target rooms naturally decay back to the target over the carrier
  lifespan.

### Fixed

- Hive energy dispatch remains the highest carrier priority, and the dynamic
  target always rises while `HiveNeedToFill` is true, so spawn/extension
  energy is protected during recovery.

## v0.78.4 — Hive energy recovery priority

### Fixed

- `HiveNeedToFill` compared `room.energyAvailable + room.hiveEnergySending`
  where the reservation counter starts `undefined`, so an empty hive with no
  in-flight `fillHive` task evaluated `NaN < capacity` as false and never
  requested energy. This was the root cause of the E53S21 starvation.
- `generatorFillHiveTask` now initializes the same per-tick reservation
  counter before adding to it.

### Changed

- `carrierManager` now treats hive (spawn/extension) energy as the highest
  carrier priority: when the hive has a deficit, free carriers are assigned
  `fillHive + carryEnergyAuto` first, and low-priority link/tower/lab dispatch
  is skipped until the deficit is covered by reservations. Free-carrier lists
  are recomputed after each dispatch group, fixing duplicate assignment to a
  carrier already given lab work.
- Starved hives with at most two carriers now bypass the `avgBusy` spawn
  threshold: below 2,500 room energy they spawn a small emergency carrier
  (`CARRY*10 + MOVE*5`, 750 energy) every 50 ticks, and at or above 2,500
  they spawn the normal full-size carrier every 25 ticks until the hive has
  enough carriers again.

## v0.78.3 — Tactical scan throttling and Memory churn reduction

### Performance

- Tower rooms no longer scan `FIND_HOSTILE_CREEPS` every tick: the tactical
  pass keeps its ~10-tick cadence, and the safe-mode check runs on a 3-tick
  staggered schedule. Hostile presence still forces a scan every tick.
- Rooms without towers skip the tower station pass entirely, and observed
  (non-owned) rooms skip lab/factory/tower passes.
- High-level economy planning runs every 7 ticks instead of 5 for normal rooms
  (MIN_CPU keeps 10); task dispatch and spawning tolerate the extra delay.
- `Room#my` / `Room#level` are cached per tick, and unknown room-property
  lookups no longer issue a useless `Game.getObjectById` through the structure
  cache prototype proxy.
- BetterMove's stuck-position tracker only writes `lastPos` / `dontPullMe` when
  the value actually changes, reducing per-tick Memory serialization churn.
- Keeper registration and duplicate-keeper cleanup write Memory only when the
  alive-creep list changed, and cleanup runs once per room economy pass instead
  of twice.
- Per-phase CPU samples are persisted on every profile tick instead of only
  when the 97-tick sampler and 20-tick health snapshot align (once per 1,940
  ticks), keeping `Memory.codeHealth.phases` actionable for online tuning.

### Changed

- Towers prioritize HEAL-armed hostiles so tanks under continuous healing can
  still be brought down; the healer is located once per room scan.

## v0.78.2 — Crash guards, memory leak, and config fixes

### Fixed

- `carryRes` passed `Math.min(undefined)` (NaN) to `withdraw` when a task had
  no `resCount`, leaving carriers stuck re-attempting the same task every tick.
- `trySpawnCarrier` read `room.storage[RESOURCE_ENERGY]` (missing `.store`), so
  the storage-has-energy spawn branch never fired.
- `harvestMineralOuterKeeper` dereferenced `mineral`/`container` out of scope
  after `goTo`, throwing `ReferenceError` on the tombstone-pickup branch.
- `unregisterStationUpgrade` reassigned a local instead of `source.creeps`,
  leaking dead upgrader ids into Memory.
- `upgrade()` popped its task on empty energy then kept executing against the
  wrong target; now returns immediately.
- Planner: `createRoads` flood-fill operator precedence, `computeRoom` null
  guard when `computeManor` fails, and a leaked module-global `objects` array.
- Combat (dormant by default): `flag._creeps` null guards, `maxBy` over an empty
  list, and `!range>N` operator-precedence dead branches.
- Market/resource: OPS auto-buy configured amount/min-hold for BATTERY instead
  of OPS, `" GH2O"` leading-space key, and a dead terminal-refill condition.


## v0.78.1 — Preserve manual upgrade flags

### Changed

- Stop hard-coding automatic creation of `upgrade_E53S21_3`. Existing upgrade
  flags remain untouched and continue to control upgrader counts normally.

## v0.78.0 — Carrier dispatch and terminal correctness

### Fixed

- Calculate Terminal transaction energy independently from the resource being
  sent, including the shared inventory constraint when sending energy itself.
- Cache each automatic carrier's selected source in its task so it no longer
  rescans and changes destination every tick; only the current tick's task
  registry is used for collision avoidance, removing stale `_carryClaim`
  Memory writes.
- Match carrier dispatch thresholds to actual creep capacity, count no source
  as no work, and size hive assignments from real carrier capacities.
- Stop manually mutating Screeps `Store` proxies in the newly added automatic
  carrier/worker branches, defer their follow-up task until the intent is
  visible next tick, and guard missing `carryRes` targets before reading them.
- Complete `OPERATE_STORAGE` tasks after success or a terminal error instead of
  leaving the Power Creep on a stale task.

## v0.77.0 — CPU, market, lab, and pillage overhaul

### Performance (CPU 25-27 → ~20, at limit; bucket stabilized)

- Market exec batch cadence 5 → 10 ticks per room; commodity deal scans,
  mineral auto-sell, and buy scans throttled to ~80 ticks per room with
  per-room staggering. `calcTransactionCost` unit cost cached permanently
  on `global` (previously recomputed per candidate order every exec).
- `StationLab.checkLabs` cached for 30 ticks (was per-tick `room.lab.filter`
  plus ~12 `getObjectById`); reaction state machine runs every 2 ticks.
- Main-room `harvestEnergyKeeper` moves straight to the container with
  `moveTo` instead of pushing `goToPop` task stacks every tick.
- Online telemetry (`Memory.codeHealth.phases.roomDetails`) identified
  E55S39 (3.64ms) and W33N55 (2.84ms) as the two hot rooms; both were
  StationLab.exec costs.

### Fixed

- Border crossing: recompute range after re-anchoring so a carrier that
  lands on the opposite exit waypoint advances instead of bouncing between
  the two rooms every tick.
- Pillage flags in foreign rooms now dispatch from the nearest owned room
  (`flag.memory.spawnRoom` claim, mirroring the har_ mechanism); the old
  code only scanned flags physically inside owned rooms.
- Pillage target selection ranks resources by the fixed `RES_PRIORITY_LIST`
  value order rather than market price (XGHO2 had no market history, so its
  fallback price lost to energy and kept hauling energy first).
- `autoBuy` removed its internal `(Game.time)%100==0` gate that never
  aligned with main.js's `shouldRun(100,19)` offset — mineral buying for lab
  feedstocks (X/H) had never executed, starving every lab reaction.
- `autoSellMineral` lists the full sellable amount on one order (buyers
  deal 3k at a time) instead of 3k-sized orders; spent (`remainingAmount=0`)
  and duplicate orders are cancelled; carriers keep refilling the terminal.
- Commodity deals require a premium over the historical average price
  (`Memory.marketSettings.dealPremium`, default 10%) instead of the
  cost-based minimum, avoiding dumping high-value goods like organism.

### Added

- Minerals are mined without the 200k stock cap; excess is auto-sold.
- `autoBuyMineral` accounts for lab reaction feedstocks (BOOST_RES_HOLD,
  capped 300k) and raises bids toward market history when labs starve.
- `autoBuyHighProfitComponents` buys expanded base feedstocks for
  commodities with `profitMargin >= 1000%` (default; configurable) into
  OPF factory rooms. Profit ranking is by margin, not level: level-5
  organism (+1694%)/machine (+1109%) lead, but level-5 essence (+431%)
  and level-4 hydraulics (+61%) trail level-3 frame (+232%).
- Outer-harvest carriers loot tombstone/drop energy within 8 tiles on
  their route (not just their own tile), so a new carrier can take over
  the haul left by a predecessor that died on the path.
- Outer-harvest keepers repair the container beneath them (below 95% hits,
  every 3 ticks) before transferring mined energy.

### Notes

- Factory level = the power creep's PWR_OPERATE_FACTORY (P19) skill level,
  unrelated to the PC name (P0-P9). Online: E55S31 (P4) is level 5 — the
  only room able to produce level-5 goods.

## v0.76.0 — Border waypoint index synchronization

### Fixed

- Persist the next cached-path index while advancing from a border point. The
  prior border fix moved the creep one tile but retained the old index, causing
  the following tick to return it to the border in a two-tile loop.

## v0.75.0 — Cached route border progression

### Fixed

- Force a carrier standing on an exact cached border waypoint to advance to
  the next cached point. This fixes road-builder tasks repeatedly targeting
  their own exit tile instead of entering the adjacent route tile.

## v0.74.0 — Exact cached-road movement

### Fixed

- External carriers now use `Creep.move` between adjacent cached road points,
  preventing `moveTo` from choosing parallel shortcuts. Displaced creeps first
  return to their nearest cached point; a short path search is a recovery-only
  fallback after repeated failed direct steps.

## v0.73.0 — Non-destructive external-road maintenance

### Fixed

- Remove the unused destructive external-road cleanup routine. Roads outside
  the cached route are neither repaired nor rebuilt and now decay naturally;
  only off-route construction sites are removed to preserve the global site
  quota.

## v0.72.0 — Persistent blueprint visual

### Fixed

- Render a `showBlueprint` flag every tick while it exists, instead of only on
  the auto-planner's 25-tick cadence. No visual or CPU work is performed
  without that explicit flag.

## v0.71.0 — External carrier delivery and road-build priority

### Fixed

- Keep ordinary `outerHarvestEnergyCarrier` units delivering energy to Storage
  while the dedicated WORK carrier repairs the external route.
- Use the cached external-road waypoints in both directions; ordinary movement
  is now a fallback only when that cached route is missing or blocked.
- Repair the nearest route-bound road construction site to completion before
  moving on; legacy non-WORK carriers caught in a repair task now resume
  delivery immediately.
- Once the last route site is complete, the WORK carrier delivers its remaining
  energy rather than making another empty repair shuttle.

## v0.70.0 — On-demand external road visual

### Added

- `Memory.visualOuterRoad` enables a temporary, persistent RoomVisual of one
  cached external route: cyan route, green source marker, amber destination,
  and ten-step labels. It auto-expires at `until`.

## v0.69.0 — Reachable external-road fallback

### Fixed

- If the blueprint-aware external route has no solution, retry once with
  Screeps' native obstacle matrix and cache that complete route. The fallback
  is used only for an otherwise unreachable storage endpoint.

## v0.68.0 — Sufficient external-route search budget

### Fixed

- Raise the one-time cached external-route search budget to 8,000 operations.
  The default 2,000 operations was returning an incomplete route at the home
  room entrance; no incomplete result is cached.

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
