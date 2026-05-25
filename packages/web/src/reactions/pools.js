// Reaction picker. Walks the priority chain and returns the first non-empty
// pool's random element. Returns null if no pool matches, caller decides
// whether to swallow or substitute.
//
// Priority (most-specific first):
//   1. character + event + moodState   ('on_fire:HURT' on the character file)
//   2. character + event               ('on_fire' on the character file)
//   3. character + moodState           ('mood:HURT' on the character file)
//   4. event + moodState               ('on_fire:HURT' on EVENTS)
//   5. event                           ('on_fire' on EVENTS)
//   6. moodState                       (BASE['HURT'])
//
// Per-character pools moved into src/personas/<id>.js in PR2; pickReaction
// now reads them via getPersona(id).speechPools.

import { BASE } from './base.js';
import { EVENTS } from './events.js';
import { PERSONAS_BY_ID } from '../personas/index.js';

export function pickReaction({ event, moodState, character } = {}) {
  const c = character ? PERSONAS_BY_ID[character]?.speechPools : null;
  const tries = [];
  if (c) {
    if (event && moodState) tries.push(c[`${event}:${moodState}`]);
    if (event)              tries.push(c[event]);
    if (moodState)          tries.push(c[`mood:${moodState}`]);
  }
  if (event && moodState)   tries.push(EVENTS[`${event}:${moodState}`]);
  if (event)                tries.push(EVENTS[event]);
  if (moodState)            tries.push(BASE[moodState]);
  for (const pool of tries) {
    if (pool && pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return null;
}
