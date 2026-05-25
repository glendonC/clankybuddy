// @ts-check
// Static sensor that ignites parts on contact (throttled per-part). Spawn
// factory is exported so explode() in abilities/_shared.js can drop pools.

import Matter from 'matter-js';
import { applyStatus } from '../effects/registry.js';

const { Bodies, Composite } = Matter;

// Spawn a fire pool at (x, y) with the given lifetime. Pinned to floor; sensor.
export function spawnFirePool(world, transientBodies, canvasHeight, x, y, durationMs) {
  const pool = Bodies.rectangle(x, Math.min(canvasHeight - 50, y + 8), 90, 12, {
    isStatic: true, isSensor: true,
    label: 'firepool', render: { visible: false },
  });
  pool.partType = 'firepool';
  pool.bornAt = performance.now();
  pool.lifeMs = durationMs;
  Composite.add(world, pool);
  transientBodies.push(pool);
  return pool;
}

/** @type {import('../types.js').TransientHandler} */
export default {
  partType: 'firepool',
  removeOnContact: false,    // sensor stays alive for its duration
  multiContact:    true,     // opt out of _spent gating, per-target throttle handles repeats
  onContact(self, target, ctx) {
    const now = performance.now();
    if (!target._lastIgnite || now - target._lastIgnite > 250) {
      target._lastIgnite = now;
      applyStatus(ctx.status, target, 'on_fire', { source: 'firepool' });
    }
  },
};
