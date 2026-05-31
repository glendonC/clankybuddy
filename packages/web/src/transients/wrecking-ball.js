// Wrecking ball, per-pass demolition handler.
//
// Pattern-2 registered handler (fires only on ragdoll-part contact). The ball
// swings back and forth on its chain for its lifeMs, so removeOnContact:false +
// multiContact:true (opt out of _spent gating). Each pass routes through the
// IMPULSE lane (sweepImpact) — the solid-knock pipeline melee uses — legal here
// because onContact runs PER PHYSICS SUB-STEP (sweepImpact must NEVER run from
// an onTick).
//
// DEDUPE = a per-part TIME throttle (self._lastByPart, ~250ms), re-armable —
// NOT a once-per-flight Set. A pendulum half-period through the buddy is well
// over the window, so every swing-through re-hits; within one pass the window
// suppresses per-sub-step double-tallies. The sweepImpact marker is a FRESH Set
// created PER CALL (we only ever pass [target], so it's a trivial no-op) — a
// persistent Set stashed on the ball would permanently mark a part after pass 1
// and kill passes 2-3, the exact trap the planning pass flagged.
//
// NO HIT GATE: the ball is a CIRCLE, so a Matter-reported contact with a ragdoll
// part IS a real overlap (unlike office-chair's rotated box, which needs an AABB
// approximation). processCollision already confirmed ragdoll-part membership.

import * as P from '../particles.js';
import { sfx } from '../audio/sfx.js';
import { sweepImpact, shatter } from '../abilities/_shared.js';
import { isBrittle, damageMul, consumeConcussed } from '../effects/registry.js';
import { goLimp } from '../physics/stand.js';

export default {
  partType: 'wrecking_ball',
  removeOnContact: false,   // keeps swinging for its lifeMs
  multiContact:    true,    // opt out of _spent; per-part TIME throttle instead
  onContact(self, target, ctx) {
    if (!ctx.ragdoll) return false;

    // Per-part TIME throttle: re-arms between passes so each swing-through lands
    // a fresh hit; within one pass it suppresses per-sub-step double counts.
    const now = performance.now();
    self._lastByPart ??= new Map();
    const win = self._throttleMs ?? 250;
    if (now - (self._lastByPart.get(target.id) ?? 0) < win) return false;
    self._lastByPart.set(target.id, now);

    // Direction = ball travel; magnitude scaled by current speed so the fast
    // bottom-of-arc pass hits harder than the slow top-of-swing graze.
    const sp = Math.hypot(self.velocity.x, self.velocity.y) || 1;
    const nx = self.velocity.x / sp;
    const ny = self.velocity.y / sp;
    const mag = (self._force ?? 0.16) * Math.min(1.5, sp / 12);

    // FRESH per-call Set marker (we only pass [target]); the time throttle above
    // is the real dedupe, so each pass re-hits.
    const seen = new Set();
    const marker = { seen: (id) => seen.has(id), mark: (id) => seen.add(id) };
    const hit = sweepImpact(ctx, [target], nx, ny, mag, marker, { upBias: 0.0004 });
    if (!hit.length) return false;

    for (const part of hit) {
      if (isBrittle(ctx.status, part)) shatter(ctx, part);
      const mul = damageMul(ctx.status, part);
      if (mul > 1) consumeConcussed(ctx.status, part);
      ctx.reactTo?.({
        source: self._verb || 'wrecking_ball', part,
        moodDelta: -(self._mood ?? 22) * mul,
        impulse: mag,
        speakMs: part === ctx.ragdoll?.head ? 600 : 99999,
      });
    }
    goLimp(ctx.ragdoll, 300);

    // Heavy iron impact: a dense debris/dust puff + a couple of bright sparks.
    P.burst(self.position.x, self.position.y, 10, { type: 'smoke', color: '#3a3a3f', size: 9, life: 420, speedRange: 0.9, gravity: -0.0003 });
    P.burst(self.position.x, self.position.y, 6,  { type: 'spark', color: '#cdd3da', size: 3, life: 300, speedRange: 1.2, gravity: 0.0012 });
    sfx.wreckingBallThud?.();
    ctx.screenShake?.(10, 220);
    return false;   // never force-expire; lifeMs owns the timeout
  },
};
