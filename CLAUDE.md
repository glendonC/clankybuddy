# ClankyBuddy

Interactive Buddy clone where you can pet or beat up an AI buddy (Claude / GPT / Gemini / Llama). Browser game, vanilla JS, Matter.js for physics. Aspirational stretch: global leaderboard of help-vs-hurt aggregated per model (backend not built yet, leaderboard UI uses placeholder data).

## Run

```bash
npm run dev          # vite dev server on :5173
npm run build        # static bundle to dist/
```

Dev console:
- `window.__clankyReset()`, wipes save (currency, unlocked tools/nodes, mood-state firsts).
- `window.__clankyResetAll()`, DEV builds only. Wipes save + auth blob (`clankybuddy.auth.v2`, including any leftover v1) + age-gate (`clankybuddy.age_gate.v1`). Reload to re-bootstrap. Auth and age-gate are intentionally NOT cleared by `__clankyReset`, they're independent surfaces (legal artifact / identity).

## Module map

```
src/
  main.js                          orchestrator: collision dispatch, fixed-timestep loop, render dispatch, boot
  particles.js                     simple particle pool + render
  mood.js                          [-100, 100] happiness, state classifier, speech pools

  state/
    world.js                       engine + walls + canvas + mouseConstraint singletons
    time.js                        hitStop + tier helpers (light/heavy/shatter/projSmall/projBig/explosion/mega)
    ragdoll-lifecycle.js           spawnRagdoll, mood/status/transientBodies/epoch, resetMood
    ability-ctx.js                 abilityCtx() factory composing the singletons above

  physics/
    ragdoll.js                     6-ball ragdoll factory (head, body, 2 arms, 2 legs) + 5 constraints
    stand.js                       active-pose driver (counter-gravity + per-part angular blend)
    characters.js                  COMPAT SHIM, re-exports CHARACTERS / LOGO_SVG from the persona
                                   registry. New code should import from src/personas/ directly.

  personas/
    _shape.js                      JSDoc Persona type: id, displayName, provider, body/accent
                                   chrome, drawLogo, logoSvg, speech pools, panic move, AI-feedback pools
    _chrome.js                     shared logo helpers (svg→canvas drawer factory)
    index.js                       PERSONAS_BY_ID + listPersonas() / getPersona() / getActivePersona().
                                   Validates at module load that every PERSONA_IDS entry has a file.
    claude.js gpt.js gemini.js grok.js llama.js deepseek.js
                                   one file per persona, owns chrome + speech pools + panic move.
                                   Replaces the retired src/reactions/characters/ directory.

  modes/
    bus.js                         Mode registry + dispatcher. register({ id, phase, tick, ... }).
                                   tickModes(ctx, dt, phase) runs all enabled modes for a phase;
                                   toggles requested mid-tick are queued and applied after the pass.
                                   Mutex resolution via mutuallyExclusiveWith[].
    register-defaults.js           PR1 adapter Modes for the existing tickers, live (gated by
                                   liveMode setting), panic-moves, gameplay-shape (FSM placeholder),
                                   plumbing (frame phase). Settings ↔ bus bridge for liveMode.
    index.js                       legacy gameMode FSM (will be split into 5 Modes in PR3).

  abilities/
    _shared.js                     explode, shatter, combust, nearestPart, partInRange, applyImpulse
    _stats.js                      mutable per-tool STATS singleton (cloned from each module's defaultStats)
    index.js                       ABILITIES_BY_ID registry + applyAbility / applyDragRelease
    praise/{pet,feed,compliment,gift,gpu}.js
    punish/{punch,hammer,lightsaber,gun,machinegun,shotgun,rocket,fireball,grenade,flame,lightning,freeze}.js
    chaos/{anvil,blackhole,nuke}.js
    cursor/grab.js
    each ability exports default { id, defaultStats?, apply(ctx), applyRelease?(ctx), drawCursor }

  effects/
    registry.js                    createStatusRegistry, applyStatus, removeStatus, hasStatus, getStatus,
                                   tickStatuses, renderStatusOverlays, isBrittle, damageMul,
                                   consumeConcussed, findConcussedInRange
    on-fire.js  frozen.js  electrified.js  powered.js  in-blackhole.js  concussed.js
    each effect exports default { id, defaultDuration, layer: 'under'|'over',
                                  onApply?, onRemove?, onTick?, render? }

  render/
    index.js stage.js ragdoll.js transients.js cursor.js shared-cursor.js
    custom canvas rendering, does NOT use Matter's built-in renderer

  transients/
    index.js                       processCollision + cleanupTransients
    treat.js gift.js gpu.js bullet.js firepool.js
    each exports default { partType, removeOnContact, onContact }

  audio/
    core.js                        ac, master compressor bus, beep, noise, preTransientClick, punchy
    sfx.js                         the live `sfx` export, every voice routed through master compressor

  ui/
    tools-table.js                 TOOLS array + TOOLS_BY_ID + TOOLS_BY_KEY + TAXONOMY (spine→groups)
    toolbar.js                     bindToolbar, setActiveTool, getActiveTool, startCooldown, promptUnlock
    character-picker.js            buildCharacterPicker, setActiveChar, ACCENT, applyCharacterTheme
    leaderboard.js                 buildLeaderboard, setLeaderboard
    mood-meter.js                  updateMoodUI
    speech-bubbles.js              popBubble
    screen-shake.js                addTrauma + screenShake (compat); the original Eiserloh tickShake was retired, current export is a no-op stub
    overlays.js                    showAnvilDrop, showBlackHole, showFlash, showNuke, showCombo
    currency-hud.js                bindCurrencyHud
    slot-picker.js                 unified armory + equip surface. openSlotPicker(bar, slot, anchor)
                                   anchors above a hotbar slot; openPicker({toolId?}) opens centered
                                   for browse/buy. 2-pane layout: left = grouped tile grid (owned +
                                   locked), mastery section at bottom; right = Destiny-style inspect
                                   panel with chips, blurb, progression chain (clickable to buy)
                                   and contextual CTA (equip / move here / unlock, N¢).

  input/
    keyboard.js                    bindKeyboard, TOOLS_BY_KEY shortcut bindings
    mouse.js                       bindMouse, canvas mouse handlers, FIRE_INTERVAL throttles, drag-release

  progression/
    state.js                       currency, unlockedTools, unlockedNodes, seenStates, lifetimeEarned/Spent
                                   plus byCharacter[charId] for per-character progression carve-outs.
                                   localStorage (clankybuddy.save.v5). v1→v2→v3→v4→v5 migration via
                                   ./migrate.js. unlockedTools is RE-DERIVED from group-tree tool
                                   nodes by apply-upgrades. Currency + master-tree state stay GLOBAL;
                                   per-tool tree progress lives under byCharacter.
    migrate.js                     pure migrate(parsed, defaults), v2→v3 wipes legacy unlockedNodes;
                                   v3→v4 wraps flat equippedTools into the FFXIV multi-bar shape;
                                   v4→v5 splits per-character progression into byCharacter while
                                   keeping currency + master tree at the top level.
    earn.js                        +1/fire (earnFromFire), +20/state-transition + 50 first-time (tickEarn)
    apply-upgrades.js              bootstrap(): walks unlockedNodes; group nodes (kind:'tool') add to
                                   unlockedTools, group nodes (kind:'stat') run effect(STATS); master-
                                   tree nodes apply via getNode() against trees/index.js.
    groups/                        Source of truth for per-tool unlocks + stat upgrades.
      _shared.js                   toolNode + statNode helpers; ids prefixed `g.<group>.<...>`
      index.js                     GROUP_TREES + DAG validation (cycle / unknown-parent / cross-group);
                                   FREE_STARTER_NODE_IDS = cost:0 tool nodes seeded into fresh saves.
      affection/gifts/blessings/melee/ranged/elemental/god/manipulation.js
    trees/                         Cross-tool MASTER tree only (per-tool trees were retired with
                                   the group-tree refactor). Five nodes mutating STATS.master:
                                   shake/mood/damage/earn multipliers + combo curator. SLATED FOR
                                   REPLACEMENT per `docs/abilities.md` §5, five mutex prestige
                                   archetypes (Petter / Adversary / Sycophant / Researcher / Whale)
                                   instead of unconditional global multipliers.
      _shared.js / index.js / master.js

  style.css                        all CSS (topbar, leaderboard, toolbar, mood meter, overlays, tree modal)
```

The TUI lives in `packages/cli/`, the Cloudflare worker in `packages/worker/`, and shared TS types (wire format: `PERSONA_IDS` / `ModelId`, chat events, age-gate, color palette) in `packages/shared/`. Worker note: `packages/worker/src/util/shard.ts` exports the shared `shardIdFor(actionId)` helper used by both the action ingest path and the aggregation cron, keeps the sharding scheme in one place.

## Key patterns

### `TOOLS` table is the source of truth (`ui/tools-table.js`)
Every tool, id, label, key, `kind`, mood delta, `spine`, `group`, cost, cooldown, blurb, lives in one array. Toolbar HTML, keyboard shortcuts, cursor style, and tooltip text all derive from it. **Add a new tool here first**, then implement the case in `abilities/<dir>/<id>.js`.

Taxonomy: every tool has a `spine` (`positive` | `negative` | `utility` | `chaos`) and a `group`. The `TAXONOMY` export defines render order; toolbar.js renders one `.tool-spine[data-spine]` per polarity, with `.tool-group[data-group]` blocks inside. The on-disk ability directories (`praise/`, `punish/`, `chaos/`, `cursor/`) are legacy names from before the taxonomy refactor, files stay where they are; the spine/group fields are the new source of truth.

**Current shipping groups:** `affection | provision | kinetic | ordnance | corruption | cataclysm | siege | hazard | manipulation` — the `TAXONOMY` export in `ui/tools-table.js` is the source of truth for the live set. `siege` holds throwables/droppables, siege engines, and weather barrages; `hazard` holds placed traps/zones (both negative spine). The earlier names were `gifts | blessings | melee | ranged | elemental | god`, with `gifts`+`blessings` folded into `provision`, `melee → kinetic`, `ranged → ordnance`, `elemental → corruption`, `god → cataclysm`. The `recognition` and `injection` groups were RETIRED in the grounded real-world-roster redesign (their AI-in-joke tools — citation, DAN, hallucinate, agentic-loop — were cut).

`kind` controls how input is dispatched in `input/mouse.js`:
- `click`, fires once on mousedown
- `hold`, fires on mousedown, then re-fires on mousemove every `FIRE_INTERVAL[tool]` ms (default 50)
- `drag`, captures `dragStart` on mousedown, fires `applyDragRelease` on mouseup with `{ dragVec }` (grenade, grab)
- `hold+drag`, like `hold` but the ability reads movement delta (lightsaber)

### `abilityCtx()` factory (`state/ability-ctx.js`)
All abilities receive a single `ctx` object built by `abilityCtx()`. Centralizing this means `ragdoll`, `mood`, `status`, `world`, `transientBodies`, `screenShake`, `popBubble`, `hitStop`, `_spawnFirePool`, `_epoch`, `_epochValid` are always passed, never invent ad-hoc parameter passing for a new ability. Add a field there, every ability sees it.

### `ragdollEpoch` (`state/ragdoll-lifecycle.js`)
A counter bumped on every `spawnRagdoll`. Delayed effects (nuke siren `setTimeout`, blackhole collapse SFX) capture `ctx._epoch` and call `ctx._epochValid(saved)` before firing. **Always do this** for any `setTimeout` that touches the ragdoll, without it, switching characters mid-animation causes effects to fire on the new buddy.

### Fixed-timestep loop (`main.js`)
Physics runs at exactly 60Hz via an accumulator; rendering is uncapped. **Never pass variable `dt` to `Engine.update`**, it destabilizes constraints and was the original cause of the NaN-spazz-disappear bug. `applyStandPose` and `tickStatuses` run *inside* the inner physics loop so forces integrate this frame. The sub-step cap is `MAX_SUBSTEPS = 4` and the accumulator is clamped to `FIXED_DT * MAX_SUBSTEPS` after each frame, without the clamp, sustained slow frames queued more steps than the cap could consume and time-debt grew monotonically. Hit-stop release is **loop-driven** via `tickHitStop()`: setTimeout was the original mechanism but backgrounded tabs throttle it to ≥1s, killing hit-stop for the session.

### Physics constants (`physics/constants.js`)
Single source of truth for every tuned physics knob: gravity, iteration counts, floor inset, wall thickness, mouse stiffness/damping, ragdoll constraint stiffness/damping, ragdoll friction-air, stand-pose counter-gravity factors and blend table, limp window timings, hit-stop tier table, fixed-DT, sub-step cap, collision categories. **Every value listed in "Physics tuning landmines" lives here.** Consumers in `state/world.js`, `state/time.js`, `state/ragdoll-lifecycle.js`, `physics/ragdoll.js`, `physics/stand.js`, `effects/in-blackhole.js`, `render/stage.js`, and `main.js` import from this module, don't hard-code values at the use-site.

### Status effects layer (`effects/registry.js`)
Effects are stored per `body.id` in a Map. Apply with `applyStatus(reg, part, 'on_fire', { duration, intensity })`; check with `hasStatus`. Side-effects on apply: fire melts frozen, freeze extinguishes fire. **Combos go here**, `isBrittle()` returns true when frozen, abilities check it to grant shatter damage. CONCUSSED multiplies the next impact-tier hit's mood damage by 1.5× (helpers: `damageMul`, `consumeConcussed`, `findConcussedInRange`).

### Stats layer (`abilities/_stats.js` + `progression/apply-upgrades.js`)
Each ability exports `defaultStats`. `_stats.js` clones them into a mutable `STATS` table at module load. `apply-upgrades.bootstrap()` walks `state.unlockedNodes`. For each id it tries the group-tree registry first: kind:`tool` nodes append `toolId` to `unlockedTools`, kind:`stat` nodes run `effect(STATS[toolId])`. Falls back to `progression/trees/` for master-tree node ids (master-tree nodes mutate `STATS.master`). Subscribes to `state.onChange` so subsequent purchases re-mutate live. Abilities call `getStats('<id>')` *inside* `apply(ctx)`, never at module top level, so the import cycle resolves cleanly via ES module live bindings.

### Persona registry (`src/personas/`)
Every persona-flavored thing, chrome (body/accent colors, drawLogo, logoSvg), speech pools, panic move body, AI-feedback pools, lives in `src/personas/<id>.js`. Code that wants persona data imports from `src/personas/index.js` (`getPersona(id)`, `getActivePersona()`, `listPersonas()`). The wire-format roster is `PERSONA_IDS` in `@clankybuddy/shared/personas` (TypeScript: `ModelId` is derived from it via `(typeof PERSONA_IDS)[number]`). The persona registry validates at module load that every `PERSONA_IDS` entry has a matching file, addition without a wired-in file throws on import. `src/physics/characters.js` is now a thin compat shim re-exporting `CHARACTERS` and `LOGO_SVG` from `listPersonas()`; new code should hit the registry directly.

### Mode bus (`src/modes/bus.js`)
Per-frame tickers register on the bus instead of being hardcoded into `main.js`. Shape: `{ id, phase: 'physics' | 'frame', tick(ctx, dt), defaultEnabled?, mutuallyExclusiveWith?, init?, teardown?, onCharChange? }`. `main.js` calls `tickModes(ctx, FIXED_DT, 'physics')` inside the inner physics loop and `tickModes(ctx, 0, 'frame')` once per render frame. Toggles requested during a tick are queued and applied AFTER the pass, prevents mid-iteration registry mutation. **Note**: `tickStatuses` stays a direct call (it's a core system, not a Mode); only optional/toggleable per-frame work goes on the bus. PR1 ships adapter Modes for the existing tickers (`live`, `panic-moves`, `gameplay-shape`, `plumbing`); PR3 will split `gameplay-shape` into 5 mutex-exclusive game modes.

### Group trees (`progression/groups/`)
Each polarity-group from the TAXONOMY has one inline DAG. Each DAG mixes two node kinds:
- `tool`, buying it unlocks a tool (id added to `unlockedTools`); cost: 0 entries are free starters seeded by state.js into fresh saves.
- `stat`, buying it mutates the named tool's `STATS` via `effect(stats, allStats)`.
Node ids are dotted: `g.<group>.<tool>` for tool nodes, `g.<group>.<tool>.<suffix>` for stat nodes. The `g.` prefix isolates them from legacy per-tool tree nodes. Validation at boot in `groups/index.js` rejects duplicate ids, unknown parents, cross-group parents, cycles, and tool nodes referencing unknown `toolId`s.

### Save format (v5)
`clankybuddy.save.v5`: `{ version: 5, currency, lifetimeEarned, lifetimeSpent, equippedBars, visibleBars, byCharacter, /* + master-tree node ids */ }`. The split is deliberate: **currency + master-tree state are GLOBAL** (one wallet, one cross-tool meta-tree); **per-character progression lives under `byCharacter[charId]`** (`unlockedTools`, `unlockedNodes`, `seenStates`). Switching characters swaps the active byCharacter slice without touching currency.

Migration chain: v1 → v2 (filled `unlockedNodes` + `lifetimeSpent`) → v3 (per-tool trees retired, `unlockedNodes` reset to `FREE_STARTER_NODE_IDS`) → v4 (flat `equippedTools[10]` wrapped into FFXIV-style `equippedBars[10][12]` with `visibleBars`) → v5 (per-character progression split into `byCharacter`). All upgrades are pure functions in `progression/migrate.js`. `__clankyReset` wipes everything.

## Physics tuning landmines

These values were each tuned through multiple regression rounds. Don't touch without understanding. All live in `physics/constants.js`; the use-site files import them, never hard-code.

- `GRAVITY_Y = 1.4`, paired with `COUNTER_GRAVITY_STAND_FACTOR = 0.92`. Lowering gravity makes falls floaty; raising counter-gravity makes the buddy refuse to fall.
- `RAGDOLL_CONSTRAINT.stiffness = 0.85, damping = 0.7`, going higher caused MouseConstraint pulls to NaN the simulation. Lower and the body crumples under its own weight.
- `RAGDOLL_FRICTION_AIR = 0.08`, kills jiggle. Lower = balls bob independently and figure looks "uncohesive."
- `MOUSE_STIFFNESS = 0.15`, softer than this and drag feels unresponsive; harder and rapid yanks tear joints.
- **Never set `Constraint.length = 0`**, Matter uses spawn distance as rest length; forcing zero yanks bodies together at frame 1 and blows up the simulation.
- Stand pose uses `Body.setAngularVelocity` blend, NOT torque. Torque-based PD control was 50× too aggressive in Matter's Verlet integrator and spun the figure into NaN. Velocity blend is bounded, can't blow up.
- Counter-gravity uses `GRAVITY_SCALE = 0.001` (Matter's default `engine.gravity.scale`). Forgetting this multiplier applied force ~1000× too strong and rocketed the buddy into the ceiling. `COUNTER_GRAVITY_NEUTRALIZER` is pre-multiplied for `effects/in-blackhole.js` so the blackhole pull cancels the standing lift without re-deriving the constant.
- Stand pose runs when **grounded** via Matter's active contact list (any part touching any static body, the canvas floor wall, a HUD obstacle, etc.) AND chest is not in the top quarter of the world. Earlier heuristics (tilt + vy gate, fixed `canvas.height - 40` band) both had failure modes: tilt prevented flat-on-back recovery; the fixed Y band failed when the buddy rested on a HUD obstacle (hotbar / chat cluster) and the buddy got stuck flopped.
- HUD obstacles use `COLLISION_CATEGORY.HUD`. The grab tool's MouseConstraint mask is `GRAB_DRAG_MASK` (HUD bit cleared) so dragging never pulls a ragdoll ball into infinite-mass HUD geometry, that's the classic "soft mouse spring + stiff ragdoll joints into static = NaN" trap.
- `ENGINE_ITER.position = 8 / velocity = 6 / constraint = 4`, slightly above Matter defaults for cleaner constraint resolution on the articulated buddy. Raising them further is wasted CPU at 1 buddy.

### Hit-stop tiers (`physics/constants.js HIT_STOP`)

Tier shortcuts on `hitStop`: `light` (35ms/0.15), `heavy` (90ms/0), `shatter` (140ms/0.2), `projSmall` (25ms/0.2), `projBig` (110ms/0.05), `explosion` (160ms/0), `mega` (280ms/0). Abilities call `ctx.hitStop?.heavy()` etc. Raw `hitStop(ms, scale)` is still supported for ad-hoc cases (lightning's 50/0.05 doesn't fit a tier).

### Force-units convention

`explode()` / `bigImpact()` take `baseVel` (additive radial velocity in px/step at blast center). The legacy `opts.force` was removed in the 2026-05-11 refactor, passing it now throws to surface mistakes. Direct-impulse abilities (`punch`, `hammer`, `shotgun`, `chainsaw`) read `s.force` as a force-per-mass coefficient and multiply by `part.mass` themselves; `applyImpulseScaled(part, nx, ny, magnitude, upBias)` in `abilities/_shared.js` is the helper that wraps the math when a new caller needs it.

## Adding a new ability

1. Add an entry to `TOOLS` in `ui/tools-table.js` (id, label, key, kind, delta, blurb, spine, group, cost?). If introducing a new group, also extend `TAXONOMY`.
2. Create `abilities/<dir>/<id>.js` exporting `default { id, defaultStats?, apply(ctx), drawCursor }`. (Existing dirs `praise/`, `punish/`, `chaos/`, `cursor/` are legacy file-system names; pick whichever matches.)
3. Register in `abilities/index.js` (ABILITIES map) AND `abilities/_stats.js` (SOURCES map).
4. Add a `toolNode` to the matching `progression/groups/<group>.js` so the tool can be unlocked from the inline tree (and optionally `statNode`s wiring its `defaultStats`).
4. SFX: add an entry to `sfx` in `audio/sfx.js` and call `sfx.<name>()` from the handler.
5. If it spawns transient bodies (projectiles, fire pools, anvil), set `body.partType`, `body.bornAt`, `body.lifeMs`, optional `body.onHit`/`body.onExpire` callbacks, and push to `ctx.transientBodies`. The collision handler in `main.js` and `cleanupTransients()` take over from there.
6. Set `body.onHit` for collision-detonating projectiles; the collision handler fires it and removes the body. Use `_spent` flag to prevent double-trigger.
7. (Optional) Add stat-tune `statNode`s to the matching `progression/groups/<group>.js` for upgrade paths. Per-tool trees are not used, all per-tool upgrades live in the group DAG.

## Anti-patterns to avoid

- Custom mouse-drag attachment code that fights `MouseConstraint`. Just toggle `mouseConstraint.collisionFilter.mask` and let Matter handle it.
- New `setTimeout` callbacks that don't capture and check `ctx._epoch`. They will misfire after a character switch.
- Adding a new parameter to `applyAbility(tool, ctx, ...extra)` instead of putting it on `ctx` via `abilityCtx({...})`.
- Reading stats at ability module top-level, call `getStats('<id>')` *inside* `apply(ctx)` to avoid the cycle trap.
- Using Matter's built-in `Render` module. We draw everything manually in `render/` so we can layer character branding + status overlays + expressions.
- Hardcoding tool ids/labels/keys outside the `TOOLS` table.
- Reading mood thresholds in numeric form. Use `moodState(mood).name` (returns `ECSTATIC | HAPPY | CONTENT | WORRIED | HURT | BROKEN`).
- Defining `ModelId` (or any persona-id literal union) outside `packages/shared/src/personas.ts`. That file's `PERSONA_IDS` + the derived `ModelId = (typeof PERSONA_IDS)[number]` are the single source of truth, both the worker and the web client import from it. Inventing a parallel literal anywhere else risks the wire format and the persona registry drifting.
- Adding a new persona file under `src/personas/` without adding the id to `PERSONA_IDS` in `@clankybuddy/shared/personas` (or vice versa). The registry's load-time validation will throw, but the failure mode is "client refuses to boot", catch it at PR-review time instead.
