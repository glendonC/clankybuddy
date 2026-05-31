// @ts-check
// Landmine — buried static-sensor trap, the CANONICAL home for the `hazard`
// group (Claymore / Bounding-mine forks live here, not in Ordnance).
//
// Drag-placed by abilities/cursor/landmine.js as an invisible static sensor
// pinned to the floor. The first ragdoll part to touch it detonates it:
// explode() with a HIGH upBias so the buddy is launched UP (bounding-mine
// feel) rather than just flung radially. Single contact by default
// (force-expire on detonation); the two hazard-family behavior FLAGS extend it:
//
//   hazard.chain  — on detonation, fan out to neighbor traps in CHAIN_RADIUS
//                   via chainDetonate(); each neighbor replays its own
//                   detonation through the chainTrigger closure registered in
//                   the ability. Synchronous, one-hop-per-trap (no cycles, no
//                   setTimeout — the registry marks _chainConsumed before
//                   firing each trigger).
//   hazard.rearm  — instead of force-expiring, the mine survives contact
//                   (multiContact:true + removeOnContact:false, the firepool /
//                   mode-collapse-zone model) and re-arms after REARM_MS. A
//                   per-part throttle dedupes the buddy's 6-part walk-through
//                   into one trigger.
//
// SFX is "click-then-boom": sfx.landmine() is the arming/trigger click (a dry
// pressure-plate snap), explode()'s sound:'bomb' supplies the boom. Both are
// built from real audio/core.js primitives; the click has no ragdoll-touching
// timer so no _epoch capture is needed (the whole detonation runs synchronously
// in the collision dispatch).

import * as P from '../particles.js';
import { explode } from '../abilities/_shared.js';
import { sfx } from '../audio/sfx.js';
import { getFamilyStats } from '../abilities/_stats.js';
import { chainDetonate, unregisterPlacedHazard } from '../state/hazard-field.js';

const REARM_MS = 2500;
const PART_THROTTLE_MS = 600;   // one walk-through != 6 detonations
const CHAIN_RADIUS = 170;       // neighbor traps within this px arm on detonation

// The blast. Reused by onContact AND by the chainTrigger closure (registered in
// the ability) so a chained landmine fires the exact same payload. HIGH upBias
// is the bounding-mine launch.
export function detonate(self, ctx) {
  const x = self.position.x, y = self.position.y;
  // click-then-boom: dry pressure-plate snap, then explode()'s 'bomb' whump.
  sfx.landmine?.();
  // Pre-blast debris fountain (upward) sells the buried charge kicking dirt up.
  P.burst(x, y, 14, {
    type: 'smoke', color: '#6b5a44', size: 10, life: 600, speedRange: 1.0, gravity: -0.0008,
  });
  explode(ctx, x, y, {
    radius: 170,
    baseVel: 13,
    upBias: 11,          // HIGH — launches the buddy up, not just outward
    moodDelta: -26,
    stunMs: 1300,
    shake: 22,
    limpMs: 750,
    sound: 'bomb',       // the boom half of click-then-boom
  });
}

/** @type {import('../types.js').TransientHandler} */
export default {
  partType: 'landmine',
  // Rearm needs the body to survive contact AND opt out of _spent gating.
  // (When hazard.rearm is OFF we still force-expire by returning true below.)
  removeOnContact: false,
  multiContact:    true,
  onContact(self, target, ctx) {
    const now = performance.now();
    const fam = getFamilyStats('hazard');

    // Re-arm window: a fired mine with hazard.rearm on sits disarmed until
    // REARM_MS elapses, then re-arms. Disarmed + rearm-off = inert no-op
    // (it's force-expired below so it shouldn't linger, but guard anyway).
    if (self._armed === false) {
      if (fam.rearm && now >= (self._rearmAt ?? 0)) self._armed = true;
      else return false;                 // disarmed: no-op (rendered dim)
    }

    // Per-part throttle: dedupe the 6-part walk-through into one detonation.
    self._lastByPart ??= {};
    if (now - (self._lastByPart[target.id] ?? 0) < PART_THROTTLE_MS) return false;
    self._lastByPart[target.id] = now;

    detonate(self, ctx);

    // CHAIN: a triggered mine arms neighbors in range (flag-gated). chainDetonate
    // marks each neighbor _chainConsumed before firing its trigger, so the wave
    // fans outward and never loops back onto this one.
    if (fam.chain) {
      chainDetonate(self.position.x, self.position.y, CHAIN_RADIUS, ctx, { exclude: self });
    }

    // REARM vs single-use (flag-gated).
    if (fam.rearm) {
      self._armed   = false;
      self._rearmAt = now + REARM_MS;
      return false;                      // stay alive, re-arm later
    }
    unregisterPlacedHazard(self);        // drop registry ref so a chain can't refire a corpse
    return true;                         // force-expire this contact (handlerSaysRemove path)
  },
};
