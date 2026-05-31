// @ts-check
// Caustic acid pool — the lingering ground hazard the acid flask shatters into.
// Static isSensor rectangle pinned near the floor (firepool.js's cousin): it
// stays alive for its lifeMs and, on contact with a ragdoll part, stamps the
// 'corroded' status with a per-target throttle so a limb dragging through the
// pool corrodes at most every ~250ms (rather than once per ragdoll part per
// physics step). Unlike firepool, it applies 'corroded' (a damage-amp coat)
// instead of 'on_fire'.
//
// spawnAcidPool() is exported so acid-flask.js's detonation closure can drop a
// pool without importing Matter itself.

import Matter from 'matter-js';
import * as P from '../particles.js';
import { applyStatus } from '../effects/registry.js';

const { Bodies, Composite } = Matter;

const CORRODE_THROTTLE_MS = 250;   // per-target re-corrode cooldown
const DEFAULT_CORRODE_MS  = 8000;  // matches effects/corroded.js defaultDuration

// Spawn a caustic pool at (x, y) with the given lifetime. Pinned to the floor;
// sensor (no physical collision response). corrodeMs is stashed on the body so
// onContact can read the flask's tuned corroded duration.
export function spawnAcidPool(world, transientBodies, canvasHeight, x, y, durationMs, corrodeMs = DEFAULT_CORRODE_MS) {
  const pool = Bodies.rectangle(x, Math.min(canvasHeight - 50, y + 8), 90, 12, {
    isStatic: true, isSensor: true,
    label: 'acidpool', render: { visible: false },
  });
  pool.partType = 'acidpool';
  pool.bornAt = performance.now();
  pool.lifeMs = durationMs;
  pool._corrodeMs = corrodeMs;
  Composite.add(world, pool);
  transientBodies.push(pool);
  return pool;
}

/** @type {import('../types.js').TransientHandler} */
export default {
  partType: 'acidpool',
  removeOnContact: false,    // lingering field, persists for its lifeMs
  multiContact:    true,     // opt out of _spent gating; per-target throttle handles repeats
  onContact(self, target, ctx) {
    const now = performance.now();
    if (!target._lastCorrode || now - target._lastCorrode > CORRODE_THROTTLE_MS) {
      target._lastCorrode = now;
      applyStatus(ctx.status, target, 'corroded', {
        duration: self._corrodeMs ?? DEFAULT_CORRODE_MS,
        source: 'acid_flask',
      });
      // Tiny caustic fizz at the contact point — sells the pool eating in.
      P.burst(target.position.x, target.position.y, 4, {
        type: 'spark', color: '#9bff6b', size: 2, life: 280, speedRange: 0.6, gravity: -0.0006,
      });
    }
    return false;   // never force-expire; lifeMs owns the timeout
  },
};
