// Office chair, per-contact clatter handler for the siege drag-throw chair.
//
// Pattern-2 registered handler (fires only on ragdoll-part contact). The chair
// keeps ricocheting for its lifeMs, so removeOnContact:false + multiContact:true
// (opt out of _spent gating). Each clatter routes through the IMPULSE lane
// (sweepImpact) — the same solid-knock pipeline melee uses — NOT the squash/
// splash velocity lane. This is legal here because onContact runs PER PHYSICS
// SUB-STEP; sweepImpact must never be called from an onTick (kinematic-only).
//
// Dedupe: the body carries a FRESH Set-backed marker per throw (self._sweepMarker,
// created in the ability's applyRelease). sweepImpact consults it so a part is
// struck at most once per throw-pass; a per-part time throttle (self._lastByPart)
// re-arms on a later ricochet so a chair bouncing back into the body re-hits.
//
// HIT GATE: a caller-local AABB-vs-circle test against the chair's box footprint
// (self._halfW/_halfH, axis-aligned approximation centered on the chair) — the
// part's center vs the chair AABB inflated by the part radius. processCollision
// already confirmed a broadphase ragdoll-part contact; this keeps the impulse to
// parts actually overlapping the seat/back box rather than a glancing edge.

import Matter from 'matter-js';
import * as P from '../particles.js';
import { sfx } from '../audio/sfx.js';
import { sweepImpact, shatter } from '../abilities/_shared.js';
import { isBrittle, damageMul, consumeConcussed } from '../effects/registry.js';
import { goLimp } from '../physics/stand.js';

const { Body } = Matter;

const CONTACT_THROTTLE_MS = 220;

// AABB(chair) vs circle(part center, partRadius). Axis-aligned box centered on
// the chair (rotation ignored — the box is a generous footprint, not a hull).
function aabbHitsCircle(self, target) {
  const hw = self._halfW ?? 23;
  const hh = self._halfH ?? 26;
  const r  = target.circleRadius ?? 14;
  const dx = Math.abs(target.position.x - self.position.x);
  const dy = Math.abs(target.position.y - self.position.y);
  if (dx > hw + r || dy > hh + r) return false;
  if (dx <= hw || dy <= hh) return true;
  // Corner region: distance from the part center to the nearest box corner.
  const cx = dx - hw, cy = dy - hh;
  return cx * cx + cy * cy <= r * r;
}

export default {
  partType: 'office_chair',
  removeOnContact: false,   // keeps ricocheting for its lifeMs
  multiContact:    true,    // opt out of _spent; throttle per-part instead
  onContact(self, target, ctx) {
    // Footprint gate: only clatter into parts actually inside the seat/back box.
    if (!aabbHitsCircle(self, target)) return false;

    // Per-part throttle so a single ricochet pass doesn't tally the same limb
    // every sub-step; a later bounce back into the body re-arms after the window.
    const now = performance.now();
    self._lastByPart ??= new Map();
    if (now - (self._lastByPart.get(target.id) ?? 0) < CONTACT_THROTTLE_MS) return false;
    self._lastByPart.set(target.id, now);

    // Direction = chair travel; impulse magnitude scaled by current speed so a
    // fast clatter hits harder than a chair that's nearly stopped rolling.
    const sp = Math.hypot(self.velocity.x, self.velocity.y) || 1;
    const nx = self.velocity.x / sp;
    const ny = self.velocity.y / sp;
    const speedScale = Math.min(1.4, sp / 12);
    const mag = (self._force ?? 0.06) * speedScale;

    // FRESH Set-backed marker per throw (created in applyRelease). sweepImpact
    // dedupes against it; one part struck at most once per throw-pass.
    const marker = self._sweepMarker ?? (() => {
      const fresh = new Set();
      return { seen: (id) => fresh.has(id), mark: (id) => fresh.add(id) };
    })();
    const hit = sweepImpact(ctx, [target], nx, ny, mag, marker, { upBias: 0.0003 });
    if (!hit.length) return false;   // already struck this throw → silent

    for (const part of hit) {
      if (isBrittle(ctx.status, part)) shatter(ctx, part);
      const mul = damageMul(ctx.status, part);
      if (mul > 1) consumeConcussed(ctx.status, part);
      ctx.reactTo?.({
        source: self._verb || 'office_chair', part,
        moodDelta: -(self._mood ?? 10) * mul,
        impulse: mag,
        speakMs: part === ctx.ragdoll?.head ? 600 : 99999,
      });
    }
    goLimp(ctx.ragdoll, 240);

    // Metal-and-plastic clatter + a small caster-debris spark burst.
    P.burst(self.position.x, self.position.y, 8, {
      type: 'spark', color: '#cdd3da', size: 3, life: 320, speedRange: 1.1, gravity: 0.0012,
    });
    P.burst(self.position.x, self.position.y, 4, {
      type: 'spark', color: '#7d8590', size: 2, life: 220, speedRange: 0.8,
    });
    sfx.officeChair?.();
    ctx.screenShake?.(6, 160);
    return false;   // never force-expire; lifeMs owns the timeout
  },
};
