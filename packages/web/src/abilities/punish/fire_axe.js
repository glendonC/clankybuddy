// Fire axe, Kinetic group (Batch 3B). A single-swing CLEAVE that ignites.
// One mousedown = one wide chop: gather every part along a short blade
// segment aimed at the nearest part, sweep-impact them once (dedup marker),
// and leave each struck part ON_FIRE. Honors the melee family flags:
//   - bleedOnEdge: the edge also opens a BLEED wound (this is an edged tool).
//   - flurry:      a synchronous second chop the same frame (no setTimeout).
// Heavy hit-stop on connect; chop + ignite-whoosh SFX.
//
// kind: 'click' (fires once on mousedown). No setTimeout, no epoch concern,
// the ON_FIRE DOT is driven by the status registry tick.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { flinch } from '../../effects/_locomotion.js';
import {
  isBrittle, damageMul, consumeConcussed, applyStatus, getStatus,
} from '../../effects/registry.js';
import { getStats, getFamilyStats } from '../_stats.js';
import { nearestPart, gatherInSegment, sweepImpact, shatter } from '../_shared.js';

const OFFSET = 10;   // haft -> blade-base (matches drawCursor)

export const defaultStats = {
  bladeLen:    78,    // length of the cleave segment past the offset
  hitRadius:   30,    // perpendicular reach of the axe head
  force:       0.11,  // force-per-part-mass (between hammer 0.18 and punch 0.05)
  mood:        12,    // base damage per struck part (subtracted)
  upBias:      0.03,  // mass-scaled upward kick
  igniteMs:    0,     // unused, on_fire is persistent; kept for tuning headroom
  bleedMs:     6000,  // bleedOnEdge wound duration
  flurryOffset:14,    // perpendicular offset for the flurry follow-up chop
  stunMs:      520,
  shake:       11,
};

export default {
  id: 'fire_axe',
  defaultStats,
  apply(ctx) {
    const s = getStats('fire_axe');
    const fam = getFamilyStats('melee');
    const { ragdoll, status, x, y, screenShake } = ctx;

    const nearest = nearestPart(ragdoll, x, y);
    if (!nearest) {
      // Whiff, quiet smoke puff. No fake hit-sound.
      P.burst(x, y, 5, { type: 'smoke', color: '#555', size: 7, life: 300, speedRange: 0.25, gravity: -0.0002 });
      return;
    }
    const angle = Math.atan2(nearest.position.y - y, nearest.position.x - x);
    const ax = x + Math.cos(angle) * OFFSET;
    const ay = y + Math.sin(angle) * OFFSET;
    const bx = x + Math.cos(angle) * (OFFSET + s.bladeLen);
    const by = y + Math.sin(angle) * (OFFSET + s.bladeLen);

    const parts = gatherInSegment(ragdoll, ax, ay, bx, by, s.hitRadius);
    if (!parts.length) {
      P.burst(x, y, 5, { type: 'smoke', color: '#555', size: 7, life: 300, speedRange: 0.25, gravity: -0.0002 });
      return;
    }
    // Shatter any brittle (frozen) part before the impulse lands.
    for (const p of parts) if (isBrittle(status, p)) shatter(ctx, p);

    // One-swing dedupe marker, hits each part at most once this chop.
    const seen = new Set();
    const marker = { seen: (id) => seen.has(id), mark: (id) => seen.add(id) };
    const perpX = -Math.sin(angle), perpY = Math.cos(angle);
    const struck = sweepImpact(ctx, parts, perpX, perpY, s.force, marker, { upBias: s.upBias });

    let anyDamaged = false;
    for (const part of struck) {
      const mul = damageMul(status, part);
      if (mul === 0) continue;          // ALIGNED block / FINISHING, hit voided
      if (mul > 1) consumeConcussed(status, part);
      anyDamaged = true;

      ctx.reactTo?.({
        source: 'fire_axe', part,
        moodDelta: -(s.mood * mul), impulse: s.force, speakMs: 450,
      });

      // Ignite, persistent ON_FIRE (omit duration). Melts frozen via onApply.
      applyStatus(status, part, 'on_fire', { intensity: 1, source: 'fire_axe' });

      // Edged: open a BLEED wound when the family flag is on, even on a clean hit.
      if (fam.bleedOnEdge) {
        const existing = getStatus(status, part, 'bleed');
        const intensity = Math.min((existing?.intensity ?? 0) + 1, 5);
        applyStatus(status, part, 'bleed', { duration: s.bleedMs, source: 'fire_axe', intensity });
      }

      // Cleave spark + ember spray.
      P.burst(part.position.x, part.position.y, 14, { type: 'spark', color: '#ff7a1a', size: 3, life: 360, speedRange: 0.9 });
      P.burst(part.position.x, part.position.y, 6,  { type: 'spark', color: '#ffd27a', size: 2, life: 260, speedRange: 0.6 });
    }

    // Flurry: a synchronous second chop the same frame, reduced magnitude and
    // a small perpendicular offset, FRESH marker so it can re-hit. No timer,
    // applyImpulseScaled integrates inside this fixed-step.
    if (fam.flurry) {
      const offX = -perpY * s.flurryOffset, offY = perpX * s.flurryOffset;
      const parts2 = gatherInSegment(ragdoll, ax + offX, ay + offY, bx + offX, by + offY, s.hitRadius);
      if (parts2.length) {
        const seen2 = new Set();
        const marker2 = { seen: (id) => seen2.has(id), mark: (id) => seen2.add(id) };
        const struck2 = sweepImpact(ctx, parts2, perpX, perpY, s.force * 0.5, marker2, { upBias: s.upBias * 0.6 });
        for (const part of struck2) {
          const mul = damageMul(status, part);
          if (mul === 0) continue;
          if (mul > 1) consumeConcussed(status, part);
          ctx.reactTo?.({ source: 'fire_axe', part, moodDelta: -(s.mood * 0.5 * mul), impulse: s.force * 0.5, speakMs: 99999 });
          applyStatus(status, part, 'on_fire', { intensity: 1, source: 'fire_axe' });
          if (fam.bleedOnEdge) {
            const existing = getStatus(status, part, 'bleed');
            const intensity = Math.min((existing?.intensity ?? 0) + 1, 5);
            applyStatus(status, part, 'bleed', { duration: s.bleedMs, source: 'fire_axe', intensity });
          }
          P.burst(part.position.x, part.position.y, 8, { type: 'spark', color: '#ff9a3a', size: 2, life: 280, speedRange: 0.8 });
        }
      }
    }

    if (!anyDamaged) return;   // everything blocked/voided, treat as no-connect

    stun(ragdoll, s.stunMs);
    flinch(ragdoll, x, y, 0.9);
    sfx.fire_axe?.();
    ctx.hitStop?.heavy();
    screenShake(s.shake, 240);
    // Ignite-whoosh smoke at the swing arc.
    P.burst(nearest.position.x, nearest.position.y, 8, { type: 'smoke', color: '#3a2a20', size: 12, life: 600, speedRange: 0.3, gravity: -0.0004 });
  },

  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    if (isDown) rctx.rotate(0.22);   // mid-swing follow-through
    // Haft (wooden handle along -x to +x near origin).
    rctx.fillStyle = '#6b4a2c';
    rctx.fillRect(-16, -2.5, OFFSET + 16, 5);
    rctx.fillStyle = '#8a6238';
    rctx.fillRect(-16, -2.5, OFFSET + 16, 1.5);
    // Axe head: steel bit at the blade-base, flaring out to a curved edge.
    const headX = OFFSET;
    rctx.fillStyle = '#9aa3ac';
    rctx.beginPath();
    rctx.moveTo(headX, -7);
    rctx.lineTo(headX + 26, -16);
    rctx.lineTo(headX + 34, 0);
    rctx.lineTo(headX + 26, 16);
    rctx.lineTo(headX, 7);
    rctx.closePath();
    rctx.fill();
    // Edge highlight.
    rctx.fillStyle = '#e3e9ee';
    rctx.beginPath();
    rctx.moveTo(headX + 24, -14);
    rctx.lineTo(headX + 34, 0);
    rctx.lineTo(headX + 24, 14);
    rctx.lineTo(headX + 28, 0);
    rctx.closePath();
    rctx.fill();
    // Flame licks along the bit (this is the FIRE axe).
    const t = (performance.now() * 0.012) % 1;
    rctx.fillStyle = '#ff7a1a';
    for (let i = 0; i < 4; i++) {
      const fx = headX + 6 + i * 7;
      const fy = -10 + i * 6 + Math.sin(t * Math.PI * 2 + i) * 2;
      rctx.beginPath();
      rctx.moveTo(fx, fy);
      rctx.lineTo(fx + 3, fy - 7);
      rctx.lineTo(fx + 6, fy);
      rctx.closePath();
      rctx.fill();
    }
    rctx.fillStyle = '#ffd27a';
    for (let i = 0; i < 3; i++) {
      const fx = headX + 9 + i * 7;
      const fy = -8 + i * 6 + Math.cos(t * Math.PI * 2 + i) * 1.5;
      rctx.beginPath();
      rctx.moveTo(fx, fy);
      rctx.lineTo(fx + 2, fy - 4);
      rctx.lineTo(fx + 4, fy);
      rctx.closePath();
      rctx.fill();
    }
    rctx.restore();
  },
};
