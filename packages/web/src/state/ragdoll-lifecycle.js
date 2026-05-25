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

export function getCurrentBuddy() { return _buddy; }

export function getRagdoll() { return _buddy.ragdoll; }
export function getEpoch() { return _buddy.epoch; }
export function epochValid(e) { return e === _buddy.epoch; }

// Mutates _buddy in place; never replaces it (would break the _epoch guard).
export function spawnRagdoll(charId) {
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
  m.glazeCombo = { count: 0, lastAt: 0 };
  m.recentPos = 0;
  m.recentNeg = 0;
  m.fear = 0;
  m.joy = 0;
}
