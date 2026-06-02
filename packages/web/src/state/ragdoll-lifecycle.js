// Ragdoll lifecycle + the active Buddy struct (the named owner of ragdoll,
// mood, status, epoch, and id). The Buddy is a singleton mutated in place
// across spawns, never replaced, so captured _epoch values stay comparable.
//
// `mood` and `status` live ON the buddy (per-buddy state); when Swarm mode
// lands each buddy gets its own. `transientBodies` stays world-owned,
// projectiles and fire pools live in the world and can damage any buddy.

import Matter from 'matter-js';
import { CHARACTERS } from '../physics/characters.js';
import { createRagdoll } from '../physics/ragdoll.js';
import { setRestAngles } from '../physics/stand.js';
import { createMood } from '../mood.js';
import { createStatusRegistry, clearAll as clearAllStatus } from '../effects/registry.js';
import { canvas, world } from './world.js';
import { teardownAllConstraints } from './constraint-registry.js';
import { cancelAllScheduled } from './scheduler.js';
import { clearFlood } from '../modes/force-flood.js';
import { clearStrafe } from '../modes/force-strafe.js';
import { clearRival } from './rival.js';
import { FLOOR_INSET, RAGDOLL_RIG_HEIGHT } from '../physics/constants.js';

const { Composite } = Matter;

// World-owned (NOT on Buddy): projectiles / fire pools live in the world and
// can interact with any buddy. Cleared on character respawn so leftover
// grenades don't clobber the fresh ragdoll.
export const transientBodies = [];

/** @typedef {{ id: string, ragdoll: any, mood: any, status: any, epoch: number }} Buddy */

export function createBuddy({ id, ragdoll, mood, status, epoch }) {
  return { id, ragdoll, mood, status, epoch };
}

const _buddy = createBuddy({
  id: 'main',
  ragdoll: null,
  mood: createMood(),
  status: createStatusRegistry(),
  epoch: 0,
});

// Buddy registry, keyed by buddyId (the tag createRagdoll stamps on every
// part, physics/ragdoll.js). 'main' is the player buddy and is the ONLY entry
// today; the damageable Rival (Phase 6 / Rival Phase B) registers a 'rival'
// entry so a hit can resolve to the buddy that OWNS the struck part via
// getBuddyForPart. The player struct is mutated in place across spawns (never
// replaced), so the Map holds a stable reference and captured _epoch values
// stay comparable.
const _buddies = new Map();
_buddies.set('main', _buddy);

export function getCurrentBuddy() { return _buddies.get('main'); }

export function getRagdoll() { return _buddies.get('main').ragdoll; }
// Epoch is a GLOBAL world-generation counter (bumped only by spawnRagdoll on a
// character switch), NOT a per-buddy value: every world-owned consumer
// (constraint-registry / scheduler / hazard-field / summons / events / ctx
// _epoch) shares it and a char-switch wipes them all. It lives on 'main'.
export function getEpoch() { return _buddies.get('main').epoch; }
export function epochValid(e) { return e === _buddies.get('main').epoch; }

// Resolve the buddy that owns a ragdoll part (by its part.buddyId tag). Returns
// null for a transient body / wall (no buddyId) or an unregistered id. Phase-6
// collision routing keys off this so a hit lands on the RIGHT buddy's
// ragdoll/mood/status. Today only 'main' is registered, so a non-'main' part
// resolves to null until the Rival registers (Batch 2).
export function getBuddy(id) { return _buddies.get(id) || null; }
export function getBuddyForPart(part) {
  return part && part.buddyId ? (_buddies.get(part.buddyId) || null) : null;
}
export function forEachBuddy(fn) { for (const b of _buddies.values()) fn(b); }
export function getPrimaryBuddy() { return _buddies.get('main'); }

// Registration seam for non-player buddies (the damageable Rival, Batch 2).
// registerBuddy is idempotent (Map.set overwrites); unregisterBuddy refuses to
// drop 'main' so the player can never be deregistered.
export function registerBuddy(buddy) { if (buddy?.id) _buddies.set(buddy.id, buddy); }
export function unregisterBuddy(id) { if (id && id !== 'main') _buddies.delete(id); }

// Mutates _buddy in place; never replaces it (would break the _epoch guard).
export function spawnRagdoll(charId) {
  // Teardown FIRST, before the old ragdoll composite + transients are removed:
  // any tracked Matter.Constraint (e.g. a mid-swing wrecking ball) must be gone
  // before the bodies it references leave the world, or the solver reads a freed
  // body next step → NaN. Runs under the OLD epoch (epoch++ is below) — correct,
  // it clears the outgoing buddy's constraints.
  teardownAllConstraints();
  // Drop any in-flight scheduled sequences (e.g. a mid-walk creeping barrage)
  // before the buddy swaps. Defense — the per-frame epoch check already blocks
  // firing on the new buddy; this reclaims the task entries immediately so the
  // new buddy starts with an empty scheduler, mirroring teardownAllConstraints.
  cancelAllScheduled();
  // Drain any in-flight flood so the new buddy doesn't spawn into a stale tide.
  // The flood Mode's per-tick epoch check already blocks it from acting on the
  // new buddy; this reclaims the level state + disables the Mode immediately.
  clearFlood();
  // Same defense for an in-flight strafe sweep (the Mode's per-tick epoch check
  // is the primary guard; this disables it immediately on the swap).
  clearStrafe();
  // Tear down a live Rival brawler (Phase A): its composite is NOT _buddy.ragdoll
  // and NOT in transientBodies, so the wipes below miss it — remove it here, beside
  // clearFlood/clearStrafe, before the old composite + transients are dropped.
  clearRival();
  if (_buddy.ragdoll) Composite.remove(world, _buddy.ragdoll.composite);
  clearAllStatus(_buddy.status);
  _buddy.epoch++;
  // Wipe transients on character change so old grenades / fire pools don't
  // hang around to clobber the fresh ragdoll.
  for (let i = transientBodies.length - 1; i >= 0; i--) {
    Composite.remove(world, transientBodies[i]);
    transientBodies.splice(i, 1);
  }
  const ch = CHARACTERS.find(c => c.id === charId) || CHARACTERS[0];
  // Spawn with feet just above the floor. RAGDOLL_RIG_HEIGHT is the head-to-
  // foot extent of the six-ball rig; FLOOR_INSET is shared with render/stage.js
  // floor band and state/world.js floor wall, so spawn y matches the visible
  // ground plane regardless of which value moves.
  const spawnY = Math.max(60, canvas.height - FLOOR_INSET - RAGDOLL_RIG_HEIGHT);
  _buddy.ragdoll = createRagdoll(canvas.width / 2, spawnY, ch, _buddy.id);
  setRestAngles(_buddy.ragdoll);
  Composite.add(world, _buddy.ragdoll.composite);
}

// Reset mood on character change so each character gets a fresh slate.
export function resetMood() {
  const m = _buddy.mood;
  m.happiness = 0;
  m.pets = 0;
  m.hits = 0;
  m.recentPos = 0;
  m.recentNeg = 0;
  m.fear = 0;
  m.joy = 0;
}
