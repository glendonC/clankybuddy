// Hunting knife, Kinetic group. Batch 3B grounded melee. A short, quick
// stab: point melee (partInRange, short reach), a small mass-scaled impulse,
// and BLEED on connect. It is an EDGED tool, so it bleeds on a clean hit;
// the shared melee `bleedOnEdge` family flag deepens that to a guaranteed
// stack even when it would otherwise be a glance. The melee `flurry` family
// flag lands a synchronous follow-up jab in the SAME apply() call (no
// setTimeout, no epoch concern, force integrates this frame).
//
// kind: click. Fires once on mousedown. Whiffs puff smoke and stay quiet,
// a miss must never sound like a connect.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { flinch } from '../../effects/_locomotion.js';
import { isBrittle, damageMul, consumeConcussed, applyStatus, getStatus } from '../../effects/registry.js';
import { getStats, getFamilyStats } from '../_stats.js';
import { partInRange, applyImpulseScaled, shatter } from '../_shared.js';

export const defaultStats = {
  range:    54,     // short reach, this is a knife, not a sword
  force:    0.045,  // small, multiplied by part.mass internally
  mood:     7,      // damage on connect (positive; subtracted)
  upBias:   0.015,  // mass-scaled upward kick
  stunMs:   240,
  shake:    5,
  bleedMs:  6000,
  flurryMag: 0.55,  // follow-up jab force fraction (flurry flag)
};

export default {
  id: 'hunting_knife',          // MUST equal the ui/tools-table.js id
  defaultStats,
  apply(ctx) {
    const s = getStats('hunting_knife');
    const fam = getFamilyStats('melee');
    const { ragdoll, status, x, y, screenShake } = ctx;

    const part = partInRange(ragdoll, x, y, s.range);
    if (!part) {
      // Whiff, quiet smoke puff. No fake hit-sound.
      P.burst(x, y, 4, { type: 'smoke', color: '#666', size: 5, life: 240, speedRange: 0.22, gravity: -0.0002 });
      return;
    }

    if (isBrittle(status, part)) shatter(ctx, part);

    const mul = damageMul(status, part);
    if (mul === 0) {
      // ALIGNED block / FINISHING void, hit doesn't land.
      P.burst(part.position.x, part.position.y, 4, { type: 'spark', color: '#7ec8ff', size: 3, life: 200 });
      return;
    }
    if (mul > 1) consumeConcussed(status, part);

    const dxp = part.position.x - x, dyp = part.position.y - y;
    const len = Math.hypot(dxp, dyp) || 1;
    const nx = dxp / len, ny = dyp / len;
    const { fx, fy } = applyImpulseScaled(part, nx, ny, s.force, s.upBias);

    // Edged: bleed on connect. The shared bleedOnEdge flag deepens it
    // (stack the intensity); a plain edged hit still leaves intensity 1.
    {
      const existing = getStatus(status, part, 'bleed');
      const base = existing?.intensity ?? 0;
      const intensity = Math.min(fam.bleedOnEdge ? base + 1 : Math.max(base, 1), 5);
      applyStatus(status, part, 'bleed', { duration: s.bleedMs, source: 'hunting_knife', intensity });
    }

    ctx.reactTo?.({ source: 'hunting_knife', part, moodDelta: -(s.mood * mul), impulse: Math.hypot(fx, fy), speakMs: 450 });

    // Flurry: synchronous follow-up jab, same frame, reduced force. A fresh
    // hit on the same part this tick, integrates inside the fixed-step loop
    // (no setTimeout, which would be the classic post-character-switch
    // misfire). Re-aims at the (still-current) target.
    if (fam.flurry) {
      const part2 = partInRange(ragdoll, x, y, s.range);
      if (part2) {
        if (isBrittle(status, part2)) shatter(ctx, part2);
        const mul2 = damageMul(status, part2);
        if (mul2 !== 0) {
          if (mul2 > 1) consumeConcussed(status, part2);
          const dx2 = part2.position.x - x, dy2 = part2.position.y - y;
          const len2 = Math.hypot(dx2, dy2) || 1;
          const r = applyImpulseScaled(part2, dx2 / len2, dy2 / len2, s.force * s.flurryMag, s.upBias);
          ctx.reactTo?.({ source: 'hunting_knife', part: part2, moodDelta: -(s.mood * 0.5 * mul2), impulse: Math.hypot(r.fx, r.fy), speakMs: 99999 });
          P.burst(part2.position.x, part2.position.y, 6, { type: 'spark', color: '#a8121a', size: 2, life: 240, speedRange: 0.7 });
        }
      }
    }

    stun(ragdoll, s.stunMs);
    flinch(ragdoll, x, y, 0.6);
    sfx['hunting_knife']?.();
    ctx.hitStop?.light();
    screenShake(s.shake, 160);
    // Quick stab spray, tight and red.
    P.burst(part.position.x, part.position.y, 10, { type: 'spark', color: '#c41822', size: 3, life: 320, speedRange: 0.8 });
  },

  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    // Mid-stab: shove the blade forward along +x.
    if (isDown) rctx.translate(7, 0);
    // Handle near origin (extends -x), blade extends +x.
    rctx.fillStyle = '#3a2a1c';
    rctx.fillRect(-14, -3, 13, 6);
    // Bolster.
    rctx.fillStyle = '#777';
    rctx.fillRect(-2, -4, 3, 8);
    // Blade, short clip-point shape.
    rctx.fillStyle = '#d7dde2';
    rctx.beginPath();
    rctx.moveTo(1, -3.5);
    rctx.lineTo(20, -1.5);
    rctx.lineTo(24, 0);     // tip
    rctx.lineTo(1, 3.5);
    rctx.closePath();
    rctx.fill();
    // Edge highlight.
    rctx.strokeStyle = 'rgba(255,255,255,0.6)';
    rctx.lineWidth = 0.8;
    rctx.beginPath();
    rctx.moveTo(1, 2.6);
    rctx.lineTo(23, 0.3);
    rctx.stroke();
    rctx.restore();
  },
};
