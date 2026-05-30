// @ts-check
// Debounced multi-pass zone — DORMANT TEMPLATE.
//
// This is the reusable sensor pattern extracted from the retired `poison`
// (mode-collapse) tool: an invisible static sensor that counts *distinct*
// buddy passes (debounced 500ms so one walk-through doesn't tally once per
// part), then fires a caller-supplied trigger on the Nth pass and signals
// expiry via the return-`true` semantic in transients/index.js.
//
// Nothing spawns it today. It is kept on disk (and intentionally NOT
// registered in transients/index.js) as the substrate for the Phase 3
// placed-zone tools — tar pit, gas cloud, caltrops — per docs/abilities-v3.md.
// Those tools supply their own `onTrigger(self, ctx)` and zone effect; this
// file owns only the pass-counting + debounce mechanic.

import Matter from 'matter-js';
import { sfx } from '../audio/sfx.js';

const { Bodies, Composite } = Matter;

const DEFAULT_PASSES_REQUIRED = 3;
const CONTACT_DEBOUNCE_MS = 500;

// `config`:
//   radius          , sensor radius (default 40)
//   lifeMs          , how long the zone persists before timing out
//   passesRequired  , distinct passes before the trigger fires (default 3)
//   onTrigger(self, ctx), caller's zone effect, fired once on the Nth pass
export function spawnMultiPassZone(world, transientBodies, x, y, config = {}) {
  const zone = Bodies.circle(x, y, config.radius ?? 40, {
    isStatic: true, isSensor: true,
    label: 'multipass_zone', render: { visible: false },
  });
  zone.partType = 'multipass_zone';
  zone.bornAt = performance.now();
  zone.lifeMs = config.lifeMs ?? 30000;
  zone._passes = 0;
  zone._lastContactAt = 0;
  zone._passesRequired = Math.max(1, config.passesRequired ?? DEFAULT_PASSES_REQUIRED);
  zone._onTrigger = typeof config.onTrigger === 'function' ? config.onTrigger : null;
  Composite.add(world, zone);
  transientBodies.push(zone);
  return zone;
}

/** @type {import('../types.js').TransientHandler} */
export default {
  partType: 'multipass_zone',
  removeOnContact: false,         // stays alive across multiple passes
  multiContact:    true,          // opt out of _spent, debounce handles per-pass coalescing
  onContact(self, target, ctx) {
    const now = performance.now();
    // Debounce, a single pass through fires up to 6 part contacts. Treat
    // any contact within 500ms of the last as the same pass.
    if (now - self._lastContactAt < CONTACT_DEBOUNCE_MS) {
      self._lastContactAt = now;
      return false;
    }
    self._lastContactAt = now;
    self._passes += 1;

    if (self._passes < self._passesRequired) {
      sfx.beep?.();               // ping so the player knows a pass counted
      return false;
    }

    // Nth pass: hand off to the caller's zone effect, then signal expiry.
    self._onTrigger?.(self, ctx);
    return true;                  // signal expiry, see transients/index.js
  },
};
