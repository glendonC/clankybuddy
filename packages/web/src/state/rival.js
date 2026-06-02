// Rival singleton (Phase A). The rival brawler is a SECOND ragdoll composite —
// the first time two ragdolls coexist. It is NOT the tracked _buddy: it has no
// mood/status/UI (Phase A is dealer-only + NON-damageable), so it needs no
// per-buddy state refactor (that is Phase 6 / Rival Phase B). This module is a
// peer singleton (like state/constraint-registry.js / state/scheduler.js): it
// owns the rival composite + its Composite.add/remove, so state/ragdoll-lifecycle.js
// can import clearRival() and tear the rival down on a character switch exactly
// the way it already drops clearFlood()/clearStrafe() — no import cycle (this
// module imports only `world` + Matter, never ragdoll-lifecycle).
//
// NON-DAMAGEABILITY is structural + FREE: every damage path (processCollision's
// ctx.ragdoll.parts.includes gate, explode/bigImpact's for-of ctx.ragdoll.parts,
// every ability's nearestPart(ctx.ragdoll,...)) only ever touches the _buddy
// ragdoll. The rival is a separate composite whose parts are never in
// _buddy.parts, so it is immune with ZERO collision-routing changes.

import Matter from 'matter-js';
import { world } from './world.js';

const { Composite } = Matter;

// { ragdoll, mood, epoch, spawnAt } — the live rival, or null.
let _rival = null;

export function setRival(r) { _rival = r; }
export function getRival() { return _rival; }

// Idempotent teardown: remove the rival composite from the world + drop the ref.
// Called on lifeMs expiry (the controller-marker's onExpire) AND on a character
// switch (state/ragdoll-lifecycle.js spawnRagdoll, beside clearFlood/clearStrafe).
export function clearRival() {
  if (_rival && _rival.ragdoll && _rival.ragdoll.composite) {
    Composite.remove(world, _rival.ragdoll.composite);
  }
  _rival = null;
}
