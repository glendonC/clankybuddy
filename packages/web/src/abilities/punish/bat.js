// Baseball bat, Kinetic group (Batch 3B). Wide swept-segment knockback.
//
// Mechanic: a single click swings the bat in a wide arc aimed at the nearest
// part. We compute a swing heading from the cursor → nearest part, gather every
// part within a fat segment along that heading, then sweepImpact them with a
// fresh Set-backed dedupe marker (one swing = one hit per part). Knockback is
// perpendicular to the swing line (a real bat sends things flying sideways, not
// straight away from your hand). melee.flurry lands a SYNCHRONOUS second swing
// the same frame at reduced magnitude + a small perpendicular offset, with its
// own fresh marker so it can re-hit the same parts.
//
// kind: 'click', edged: false. No bleed-on-edge branch consumed (bat is blunt);
// the bleedOnEdge family flag is intentionally ignored here. Honors flurry only.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { flinch } from '../../effects/_locomotion.js';
import { isBrittle, damageMul, consumeConcussed } from '../../effects/registry.js';
import { getStats, getFamilyStats } from '../_stats.js';
import { nearestPart, gatherInSegment, sweepImpact, shatter } from '../_shared.js';

const OFFSET = 8; // hilt → barrel-base (matches drawCursor handle length)

export const defaultStats = {
  bladeLen:     86,    // barrel reach beyond OFFSET
  hitRadius:    30,    // fat perpendicular swath, blunt bat catches a wide arc
  force:        0.11,  // force-per-mass, heavier than punch, lighter than hammer
  mood:         12,    // per-part damage on connect (subtracted)
  upBias:       0.05,  // mass-scaled upward kick, sends parts arcing
  stunMs:       520,
  shake:        9,
  flurryOffset: 16,    // perpendicular shift for the flurry follow-up swing
};

export default {
  id: 'bat',
  defaultStats,
  apply(ctx) {
    const s = getStats('bat');
    const fam = getFamilyStats('melee');
    const { ragdoll, status, x, y, screenShake, hitStop } = ctx;

    const nearest = nearestPart(ragdoll, x, y);
    if (!nearest) {
      // Whiff, quiet swing-through smoke puff. No fake crack on a miss.
      P.burst(x, y, 5, { type: 'smoke', color: '#888', size: 7, life: 300, speedRange: 0.3, gravity: -0.0002 });
      return;
    }

    // Swing heading: cursor → nearest part. Segment runs OFFSET..OFFSET+bladeLen
    // along that heading; knockback is perpendicular to the heading (the swing
    // arc), which is what gives a bat its lateral launch.
    const angle = Math.atan2(nearest.position.y - y, nearest.position.x - x);
    const ax = x + Math.cos(angle) * OFFSET;
    const ay = y + Math.sin(angle) * OFFSET;
    const bx = x + Math.cos(angle) * (OFFSET + s.bladeLen);
    const by = y + Math.sin(angle) * (OFFSET + s.bladeLen);

    const parts = gatherInSegment(ragdoll, ax, ay, bx, by, s.hitRadius);
    if (!parts.length) {
      // Segment came up empty even though a part was nearest, treat as a whiff.
      P.burst(x, y, 5, { type: 'smoke', color: '#888', size: 7, life: 300, speedRange: 0.3, gravity: -0.0002 });
      return;
    }

    // Brittle parts shatter from the impact before we knock them.
    for (const p of parts) if (isBrittle(status, p)) shatter(ctx, p);

    // Perpendicular to the swing line = the launch direction.
    const perpX = -Math.sin(angle), perpY = Math.cos(angle);

    // Primary swing: fresh one-shot marker so each part is hit at most once.
    const seen = new Set();
    const marker = { seen: (id) => seen.has(id), mark: (id) => seen.add(id) };
    const struck = sweepImpact(ctx, parts, perpX, perpY, s.force, marker, { upBias: s.upBias });

    let connected = false;
    for (const part of struck) {
      // Damage-gate: 0 = ALIGNED block / FINISHING (skip), >1 = concussed/split.
      const mul = damageMul(status, part);
      if (mul === 0) {
        P.burst(part.position.x, part.position.y, 4, { type: 'spark', color: '#7ec8ff', size: 3, life: 200 });
        continue;
      }
      if (mul > 1) consumeConcussed(status, part);
      connected = true;
      // Speak only off the nearest (primary) part to avoid double-talk on a
      // multi-part swing; others stay silent.
      const speakMs = part.id === nearest.id ? 450 : 99999;
      ctx.reactTo?.({ source: 'bat', part, moodDelta: -(s.mood * mul), impulse: s.force, speakMs });
      // Wooden impact: pale chips + a puff of dust.
      P.burst(part.position.x, part.position.y, 12, { type: 'spark', color: '#e9d8a6', size: 3, life: 360, speedRange: 0.9 });
    }

    // Flurry, SYNCHRONOUS second swing this same frame (no setTimeout). Shifted
    // perpendicular by flurryOffset, reduced magnitude, fresh marker so it can
    // re-hit the same parts. applyImpulseScaled integrates inside the fixed step.
    if (fam.flurry) {
      const offX = -perpY * s.flurryOffset, offY = perpX * s.flurryOffset;
      const parts2 = gatherInSegment(ragdoll, ax + offX, ay + offY, bx + offX, by + offY, s.hitRadius);
      if (parts2.length) {
        for (const p of parts2) if (isBrittle(status, p)) shatter(ctx, p);
        const seen2 = new Set();
        const marker2 = { seen: (id) => seen2.has(id), mark: (id) => seen2.add(id) };
        const struck2 = sweepImpact(ctx, parts2, perpX, perpY, s.force * 0.5, marker2, { upBias: s.upBias * 0.6 });
        for (const part of struck2) {
          const mul = damageMul(status, part);
          if (mul === 0) continue;
          if (mul > 1) consumeConcussed(status, part);
          connected = true;
          ctx.reactTo?.({ source: 'bat', part, moodDelta: -(s.mood * 0.5 * mul), impulse: s.force * 0.5, speakMs: 99999 });
          P.burst(part.position.x, part.position.y, 6, { type: 'spark', color: '#e9d8a6', size: 2, life: 280, speedRange: 0.8 });
        }
      }
    }

    if (!connected) return; // every struck part was ALIGNED/FINISHING, no crack.

    // Solid crack + body recoil only on a real connect.
    stun(ragdoll, s.stunMs);
    flinch(ragdoll, x, y, 0.85);
    sfx.bat?.();
    screenShake(s.shake, 220);
    // Heavier swings (multi-part / flurry) read as a meatier connect.
    if (struck.length > 1 || fam.flurry) hitStop?.heavy();
    else hitStop?.light();
  },
  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    // Mid-swing pose: shove the bat forward + cock it a touch.
    if (isDown) { rctx.translate(5, 0); rctx.rotate(-0.18); }

    const barrelLen = OFFSET + 86;
    // Wood gradient barrel, tapers from knob to a rounded fat end.
    rctx.lineCap = 'round';
    rctx.strokeStyle = '#b9894e';
    rctx.lineWidth = 4;
    rctx.beginPath();
    rctx.moveTo(-10, 0);            // knob end behind the grip
    rctx.lineTo(OFFSET, 0);
    rctx.stroke();
    // Fat barrel, widening toward the tip.
    rctx.fillStyle = '#c79a5b';
    rctx.beginPath();
    rctx.moveTo(OFFSET, -3);
    rctx.lineTo(barrelLen - 8, -7);
    rctx.quadraticCurveTo(barrelLen, -7, barrelLen, 0);
    rctx.quadraticCurveTo(barrelLen, 7, barrelLen - 8, 7);
    rctx.lineTo(OFFSET, 3);
    rctx.closePath();
    rctx.fill();
    // Grain highlight.
    rctx.strokeStyle = 'rgba(255,240,200,0.45)';
    rctx.lineWidth = 1;
    rctx.beginPath();
    rctx.moveTo(OFFSET, -1.5);
    rctx.lineTo(barrelLen - 10, -3.5);
    rctx.stroke();
    // Knob.
    rctx.fillStyle = '#8a6232';
    rctx.beginPath(); rctx.arc(-10, 0, 4, 0, Math.PI * 2); rctx.fill();
    // Taped grip.
    rctx.strokeStyle = '#2a2a2e';
    rctx.lineWidth = 5;
    rctx.beginPath();
    rctx.moveTo(-6, 0);
    rctx.lineTo(OFFSET - 1, 0);
    rctx.stroke();

    rctx.restore();
  },
};
