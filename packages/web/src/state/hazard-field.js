// @ts-check
// Placed-hazard registry — the shared substrate for the four static traps in
// the `hazard` group (landmine / electrified panel / buzzsaw / cryo mine).
//
// A "placed hazard" is a static sensor body that sits in the world waiting to
// be stepped on. Two cross-tool behaviors hang off this registry, both gated by
// `getFamilyStats('hazard')` BEHAVIOR FLAGS (never scalars — see
// docs/abilities-v3.md §1 + the sharedNode scalar-rejection guard):
//
//   hazard.chain  — when one trap triggers, it ARMS/triggers neighbors within a
//                   radius. The triggering trap calls listPlacedInRange() to
//                   find the others and fires each one's _chainTrigger closure.
//   hazard.rearm  — a single-use trap, instead of removing on contact, stays in
//                   the world (multiContact:true + removeOnContact:false) and
//                   re-arms after a delay. Per-part throttle prevents the same
//                   buddy walking-through from re-triggering before the rearm
//                   window. Disarmed traps render dim and no-op in onContact.
//
// EPOCH PRUNE (the headline reason this lives in state/ alongside the lifecycle
// module): spawnRagdoll() bumps the buddy epoch every respawn / character
// switch. A chain that fired AFTER a respawn must never target a dead buddy or
// a stale trap body. We read getEpoch() (the same counter spawnRagdoll bumps)
// and prune the registry lazily whenever the observed epoch changes — every
// register()/list query first reconciles, so the list only ever holds traps
// from the CURRENT epoch. There is no separate subscribe; the epoch read is the
// signal. (transientBodies itself is already wiped by spawnRagdoll, so the
// underlying Matter bodies are gone — this list just drops the dangling refs so
// a chain query can never hand a removed body to a _chainTrigger.)

import { getEpoch } from './ragdoll-lifecycle.js';

// Registry entries: { body, epoch, kind, chainTrigger }.
//   body         — the Matter static sensor (also pushed to transientBodies by
//                  the spawning ability; we hold a weak-ish ref, pruned on epoch
//                  bump and on explicit unregister).
//   epoch        — the buddy epoch at register time; entries from older epochs
//                  are dropped on the next reconcile.
//   kind         — the trap partType ('landmine' | 'electrified_panel' |
//                  'buzzsaw' | 'cryo_mine' ...) so a chain can be kind-filtered
//                  if a tool ever wants "only detonate my own kind."
//   chainTrigger — closure (entry, ctx) the chain caller invokes to set off this
//                  neighbor. The trap supplies it at register time; it normally
//                  wraps the same detonation path onContact uses.
const _placed = [];
let _lastSeenEpoch = -1;

// Lazily drop every entry whose epoch != the current buddy epoch. Cheap: runs
// only when the epoch actually moved since the last reconcile.
function reconcile() {
  const epoch = getEpoch();
  if (epoch === _lastSeenEpoch) return;
  _lastSeenEpoch = epoch;
  for (let i = _placed.length - 1; i >= 0; i--) {
    if (_placed[i].epoch !== epoch) _placed.splice(i, 1);
  }
}

// Register a placed trap. `body` MUST already carry body.partType and have been
// pushed to transientBodies by the spawning ability (this registry does NOT own
// the Matter body's lifetime — transients/index.js cleanup + spawnRagdoll wipe
// still own removal). `chainTrigger(entry, ctx)` is the closure the chain caller
// fires to detonate this trap as a neighbor. Returns the entry (so the caller
// can stash it on the body for unregister-on-removal if desired).
export function registerPlacedHazard(body, { kind, chainTrigger } = {}) {
  reconcile();
  const entry = {
    body,
    epoch: getEpoch(),
    kind: kind ?? body?.partType ?? 'hazard',
    chainTrigger: typeof chainTrigger === 'function' ? chainTrigger : null,
  };
  _placed.push(entry);
  // Back-reference so a trap whose Matter body is removed (transient expiry,
  // detonation) can pull itself out without scanning the list.
  if (body) body._hazardEntry = entry;
  return entry;
}

// Pull a trap out of the registry (called when a one-shot trap detonates and is
// removed, so a later chain query can't re-fire a corpse). Idempotent.
export function unregisterPlacedHazard(body) {
  if (!body) return;
  const i = _placed.indexOf(body._hazardEntry);
  if (i >= 0) _placed.splice(i, 1);
  body._hazardEntry = null;
}

// List placed traps within `radius` of (x, y), excluding the trap that is doing
// the querying (`exclude` body) and any already-triggered entry. This is the
// chain-detonation query: a trap that just fired calls this to find neighbors
// to arm. Reconciles first so a post-respawn chain never sees a stale-epoch
// trap. `opts.kind` optionally filters to a single trap kind.
export function listPlacedInRange(x, y, radius, { exclude = null, kind = null } = {}) {
  reconcile();
  const out = [];
  const r2 = radius * radius;
  for (const e of _placed) {
    if (!e.body || e.body === exclude) continue;
    if (e._chainConsumed) continue;          // already fired by this chain wave
    if (kind && e.kind !== kind) continue;
    const dx = e.body.position.x - x;
    const dy = e.body.position.y - y;
    if (dx * dx + dy * dy <= r2) out.push(e);
  }
  return out;
}

// Detonate every placed trap within `radius` of (x, y) via its chainTrigger.
// The caller (a trap whose hazard.chain flag is set) passes its own body as
// `exclude` and the live ctx. Each neighbor is marked _chainConsumed BEFORE its
// trigger runs so a neighbor that itself chains can't loop back onto this one in
// the same wave (one-hop-per-trap; the wave fans outward, never cycles).
//
// IMPORTANT: this is a synchronous fan-out, NO setTimeout. If a trap ever wants
// a staggered chain it MUST capture ctx._epoch and call ctx._epochValid(saved)
// inside the setTimeout (CLAUDE.md), AND re-query listPlacedInRange at fire time
// rather than closing over a stale list.
export function chainDetonate(x, y, radius, ctx, { exclude = null, kind = null } = {}) {
  const neighbors = listPlacedInRange(x, y, radius, { exclude, kind });
  for (const e of neighbors) {
    e._chainConsumed = true;
    e.chainTrigger?.(e, ctx);
  }
  return neighbors.length;
}

// Test/diagnostic + explicit-reset hook. Not wired to spawnRagdoll (the lazy
// epoch reconcile handles respawns); exposed so a future hard-reset path can
// flush placed traps without bumping the epoch.
export function clearPlacedHazards() {
  _placed.length = 0;
  _lastSeenEpoch = -1;
}

export function placedHazardCount() {
  reconcile();
  return _placed.length;
}
