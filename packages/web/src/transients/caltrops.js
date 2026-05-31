// Caltrops, a placed floor strip of scattered spikes. Static sensor that
// stays on the ground and BLEEDs anything that lands on / walks through it.
//
// Mechanic note: this is the persistent-hazard cousin of bear-trap.js. Where
// bear-trap is a single-fire snap (removeOnContact: true), caltrops is a
// lingering strip — it does NOT remove on contact and opts out of _spent
// gating (multiContact: true) so it can re-bleed every time a part rolls
// across it. To avoid a single pass-through tallying once per ragdoll part in
// the same physics step, each part.id is debounced ~500ms (the same coalescing
// trick mode-collapse-zone.js uses for its pass counter), but unlike that zone
// the debounce is PER-PART (a Map) so two limbs landing on the strip both
// bleed, while one limb dragging across it bleeds at most every 500ms.
//
// BLEED stacks intensity (cap 5) on repeat contact, the strip is a slow grind:
// stand the buddy on it and the cuts add up.

import * as P from '../particles.js';
import { applyStatus, getStatus } from '../effects/registry.js';

const CONTACT_DEBOUNCE_MS = 500;
const BLEED_MS = 6000;

export default {
  partType: 'caltrops',
  removeOnContact: false,   // lingering strip, persists for its lifeMs
  multiContact:    true,    // opt out of _spent; the per-part debounce coalesces
  onContact(self, target, ctx) {
    const now = performance.now();
    // Per-part debounce. self._lastByPart maps body.id -> last-bled timestamp.
    self._lastByPart ??= new Map();
    const last = self._lastByPart.get(target.id) ?? 0;
    if (now - last < CONTACT_DEBOUNCE_MS) return false;
    self._lastByPart.set(target.id, now);

    // Stack BLEED intensity (cap 5), like chainsaw — repeat contact grinds.
    const existing = getStatus(ctx.status, target, 'bleed');
    const intensity = Math.min((existing?.intensity ?? 0) + 1, 5);
    applyStatus(ctx.status, target, 'bleed', {
      duration: self._bleedMs ?? BLEED_MS,
      source: 'caltrops',
      intensity,
    });

    // Tiny metallic-prick spark at the contact point. No screen shake — this
    // is a slow grind, not an impact.
    P.burst(target.position.x, target.position.y, 5, {
      type: 'spark', color: '#a8121a', size: 3, life: 320, speedRange: 0.7, gravity: 0.0010,
    });
    P.burst(target.position.x, target.position.y, 3, {
      type: 'spark', color: '#cdd', size: 2, life: 220, speedRange: 1.0,
    });
    return false;             // never force-expire; lifeMs owns the timeout
  },
};
