// Chain shot, per-contact clothesline handler.
//
// Pattern-2 registered handler (fires only on ragdoll-part contact with the
// LEAD ball). multiContact:true + removeOnContact:false so the linked pair keeps
// raking for its lifeMs. When the lead grazes any part, we gather EVERY part
// lying in the SEGMENT between the lead and its partner (gatherInSegment) and
// sweepImpact the whole set — that's the "clothesline anything caught between
// the balls" verb. The lead's collider contact is the trigger; the segment is
// the damage reach, so a limb passing between the balls is caught even if it
// never touches a collider (straddle mitigation).
//
// IMPULSE lane (sweepImpact), exactly like office-chair — legal here because
// onContact runs PER PHYSICS SUB-STEP. sweepImpact must NEVER run from an onTick
// (kinematic-only contract). Dedupe is a fresh Set marker per cast (created in
// the ability): each part is clotheslined at most once for the pair's flight.
// The PARTNER ball ('chain_shot_partner') has NO handler, so it never fires
// this — no double-count.

import * as P from '../particles.js';
import { sfx } from '../audio/sfx.js';
import { gatherInSegment, sweepImpact, shatter } from '../abilities/_shared.js';
import { isBrittle, damageMul, consumeConcussed } from '../effects/registry.js';
import { goLimp } from '../physics/stand.js';

export default {
  partType: 'chain_shot',
  removeOnContact: false,   // keeps raking for its lifeMs
  multiContact:    true,    // opt out of _spent; the Set marker dedupes instead
  onContact(self, target, ctx) {
    const partner = self._partner;
    if (!partner || !partner.position || !ctx.ragdoll) return false;

    // Gather every part lying along the lead->partner segment (the bar between
    // the balls). Membership is the hit gate AND the AOE.
    const inSeg = gatherInSegment(ctx.ragdoll, self.position.x, self.position.y, partner.position.x, partner.position.y, self._gatherRadius ?? 30);
    if (!inSeg.length) return false;

    // Direction = pair travel; magnitude scaled by current speed so a fast pass
    // hits harder than one that's nearly spent.
    const sp = Math.hypot(self.velocity.x, self.velocity.y) || 1;
    const nx = self.velocity.x / sp;
    const ny = self.velocity.y / sp;
    const speedScale = Math.min(1.4, sp / 12);
    const mag = (self._force ?? 0.07) * speedScale;

    // Fresh Set-backed marker per cast (created in the ability). sweepImpact
    // dedupes against it: each part clotheslined at most once this flight.
    const marker = self._sweepMarker ?? (() => {
      const fresh = new Set();
      return { seen: (id) => fresh.has(id), mark: (id) => fresh.add(id) };
    })();
    const hit = sweepImpact(ctx, inSeg, nx, ny, mag, marker, { upBias: 0.0003 });
    if (!hit.length) return false;   // everything in-segment already struck → silent

    for (const part of hit) {
      if (isBrittle(ctx.status, part)) shatter(ctx, part);
      const mul = damageMul(ctx.status, part);
      if (mul > 1) consumeConcussed(ctx.status, part);
      ctx.reactTo?.({
        source: self._verb || 'chain_shot', part,
        moodDelta: -(self._mood ?? 16) * mul,
        impulse: mag,
        speakMs: part === ctx.ragdoll?.head ? 600 : 99999,
      });
    }
    goLimp(ctx.ragdoll, 240);

    // Iron-chain spark scatter where the bar bites.
    P.burst(self.position.x, self.position.y, 8, {
      type: 'spark', color: '#cdd3da', size: 3, life: 320, speedRange: 1.1, gravity: 0.0012,
    });
    sfx.chainShot?.();
    ctx.screenShake?.(6, 160);
    return false;   // never force-expire; lifeMs owns the timeout
  },
};
