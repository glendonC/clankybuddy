// Constraint registry (S3). The ONLY place Matter.Constraints are added to /
// removed from the world OUTSIDE the ragdoll joints (physics/ragdoll.js) and
// the MouseConstraint (state/world.js). Tracks every registered constraint and
// owns its Composite.add/remove, so nothing can leak a constraint that still
// references a body that's been removed (the classic "constraint anchored to a
// freed body → solver reads stale position → NaN" trap).
//
// Imports `world` directly like the other singletons; abilities call
// registerConstraint / releaseConstraintsForBody directly (peer singleton, NOT
// threaded through abilityCtx — same as effects/registry.js + abilities/_shared.js).
//
// LANDMINES this module enforces / depends on (see CLAUDE.md):
//  - Release ONLY between Engine.update calls. teardownAllConstraints runs in
//    spawnRagdoll, tickConstraintRegistry runs once per render frame, onExpire
//    fires from cleanupTransients / nuke's wipe — all between frames, never
//    inside the FIXED_DT loop or a physics-phase Mode. Removing a constraint
//    mid-solve corrupts solver state.
//  - Every release path DELETES the Map entry BEFORE Composite.remove, so a
//    double release (onExpire AND the valve AND teardown) is an idempotent
//    no-op, never a double-remove or a leaked entry.
//  - Callers (not this module) own: length > 0 (never 0), stiffness < 0.9, and
//    clearing the HUD collision bit on the dynamic body. Documented at the
//    consumer (abilities/siege/wrecking-ball.js).
//
// NOTE: the ragdoll-lifecycle ↔ constraint-registry import cycle (lifecycle
// imports teardownAllConstraints; this file imports getEpoch) is benign: both
// are only ever CALLED inside function bodies, never at module top level, so ES
// live bindings resolve. Do NOT call getEpoch() at top level here.

import Matter from 'matter-js';
import { world } from './world.js';
import { getEpoch } from './ragdoll-lifecycle.js';

const { Composite } = Matter;

// handle (int) -> { constraint, bornAt, maxAgeMs, ownerBody, epoch }
const entries = new Map();
let _seq = 0;

// Idempotent delete-then-remove. Deleting the entry FIRST means a re-entrant or
// later call sees a missing key and no-ops; Composite.remove on an already-
// removed constraint is itself a no-op in Matter, so this can never double-throw.
function _releaseEntry(handle) {
  const e = entries.get(handle);
  if (!e) return;
  entries.delete(handle);
  Composite.remove(world, e.constraint);
}

// Add the constraint to the world AND track it. Returns an opaque integer handle.
// opts.ownerBody (when set) lets the valve drop the constraint if its anchored
// body leaves the world. opts.maxAgeMs is the valve's age ceiling (a backstop —
// the owner's onExpire is the normal release path).
export function registerConstraint(constraint, { maxAgeMs = 4000, ownerBody = null } = {}) {
  Composite.add(world, constraint);
  const handle = ++_seq;
  entries.set(handle, {
    constraint,
    bornAt: performance.now(),
    maxAgeMs,
    ownerBody,
    epoch: getEpoch(),
  });
  return handle;
}

// IDEMPOTENT: safe to call twice / after teardown / on an unknown handle.
export function releaseConstraint(handle) {
  _releaseEntry(handle);
}

// Release every constraint whose ownerBody === body. Collect-then-release so we
// never mutate the Map mid-iteration. Called from a transient's onExpire, which
// composes for free with cleanupTransients AND nuke's wipe loop (both fire
// onExpire before Composite.remove'ing the body).
export function releaseConstraintsForBody(body) {
  const doomed = [];
  for (const [h, e] of entries) if (e.ownerBody === body) doomed.push(h);
  for (const h of doomed) _releaseEntry(h);
}

// Bulk teardown — the FIRST statement of spawnRagdoll, before the ragdoll
// composite is removed, so no tracked constraint can reference a body that's
// about to leave the world (a future Pin constraint anchors a ragdoll PART; the
// wrecking ball anchors only a transient ball, but tearing all down is the safe
// general rule). Runs under the OLD epoch — correct, it clears the outgoing buddy.
export function teardownAllConstraints() {
  for (const e of entries.values()) Composite.remove(world, e.constraint);
  entries.clear();
}

// Per-frame VALVE (called once per frame from main.js, BETWEEN Engine.updates).
// Releases entries past maxAgeMs OR whose epoch is stale OR whose ownerBody has
// left the world. The owner's onExpire is the normal release; this is the
// backstop for any path that removes a body without firing onExpire. Hoists
// allBodies to one call/frame (n is tiny) and early-outs on an empty table.
export function tickConstraintRegistry(now) {
  if (entries.size === 0) return;
  const cur = getEpoch();
  const bodies = Composite.allBodies(world);
  const doomed = [];
  for (const [h, e] of entries) {
    const aged   = now - e.bornAt > e.maxAgeMs;
    const stale  = e.epoch !== cur;
    const orphan = e.ownerBody && !bodies.includes(e.ownerBody);
    if (aged || stale || orphan) doomed.push(h);
  }
  for (const h of doomed) _releaseEntry(h);
}

// Dev/test introspection.
export function constraintCount() { return entries.size; }
