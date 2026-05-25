// Chainsaw, Kinetic group. Phase 7 visceral redirect addition. Hold+drag
// like the lightsaber but shorter range, heavier per-tick mood damage, and
// applies BLEED on every contact tick. Visual: revving teeth + blood spray.
//
// Mechanic notes:
//   - The ability runs at the same 50ms throttle as the lightsaber (set in
//     input/mouse.js for hold+drag tools).
//   - applyStatus refreshes BLEED on every tick, duration starts over each
//     time the chainsaw touches the part, so dragging the saw across keeps
//     it bleeding indefinitely until you stop.
//   - Damage is non-trivial per tick (-3 mood) but only on direct contact.
//     The teeth are stubby, keep close.
//
// Phase: kinetic. Pairs with ice (freeze), lightsaber already shatters
// frozen parts, chainsaw does the same for parity.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood via ctx.reactTo.
import { isBrittle, damageMul, consumeConcussed, applyStatus, getStatus } from '../../effects/registry.js';
import { applyImpulse, shatter } from '../_shared.js';
import { getStats } from '../_stats.js';

const BAR_OFFSET = 6;
const BAR_LEN    = 74;       // shorter than the lightsaber's 100/110
const HIT_RADIUS = 26;

export const defaultStats = {
  bladeLen:   BAR_LEN,
  hitRadius:  HIT_RADIUS,
  perTickMood: 3,
  bleedMs:    6000,
  force:      0.05,
};

function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

export default {
  id: 'chainsaw',
  defaultStats,
  apply(ctx) {
    const s = getStats('chainsaw');
    const { ragdoll, status, x, y, screenShake } = ctx;
    let nearest = null, nearestD = Infinity;
    for (const p of ragdoll.parts) {
      const d = Math.hypot(p.position.x - x, p.position.y - y);
      if (d < nearestD) { nearestD = d; nearest = p; }
    }
    if (!nearest) return;
    const angle = Math.atan2(nearest.position.y - y, nearest.position.x - x);
    const ax = x + Math.cos(angle) * BAR_OFFSET;
    const ay = y + Math.sin(angle) * BAR_OFFSET;
    const bx = x + Math.cos(angle) * (BAR_OFFSET + s.bladeLen);
    const by = y + Math.sin(angle) * (BAR_OFFSET + s.bladeLen);

    let anyHit = false;
    for (const part of ragdoll.parts) {
      const seg = segmentDistance(part.position.x, part.position.y, ax, ay, bx, by);
      if (seg.dist > s.hitRadius) continue;
      anyHit = true;
      if (isBrittle(status, part)) shatter(ctx, part);
      const F = s.force * part.mass;
      const perpX = -Math.sin(angle), perpY = Math.cos(angle);
      const sideSign = ((part.position.x - ax) * perpX + (part.position.y - ay) * perpY) >= 0 ? 1 : -1;
      const fx = perpX * F * sideSign + Math.cos(angle) * F * 0.3;
      const fy = perpY * F * sideSign + Math.sin(angle) * F * 0.3 - F * 0.1;
      applyImpulse(part, fx, fy);
      const mul = damageMul(status, part);
      if (mul > 1) consumeConcussed(status, part);
      const moodDelta = -s.perTickMood * mul;
      // Suppress speech, chainsaw is fast-ticking; verbal would chatter.
      ctx.reactTo?.({ source: 'chainsaw', part, moodDelta, impulse: Math.hypot(fx, fy), speakMs: 99999 });
      // BLEED, chainsaw stacks intensity (capped at 5x). Each tick of
      // contact bumps the existing bleed's intensity up by 1, so a sustained
      // drag keeps deepening the wound. bleed.js's onTick reads `intensity`
      // and scales -mood/s by it. Resets to 1 on a fresh apply.
      const existing = getStatus(status, part, 'bleed');
      const intensity = Math.min((existing?.intensity ?? 0) + 1, 5);
      applyStatus(status, part, 'bleed', { duration: s.bleedMs, source: 'chainsaw', intensity });
      // Blood spray fan, short bursts away from the bar.
      for (let i = 0; i < 6; i++) {
        const spray = angle + Math.PI / 2 * sideSign + (Math.random() - 0.5) * 0.7;
        P.spawn({
          x: part.position.x, y: part.position.y,
          vx: Math.cos(spray) * (0.5 + Math.random() * 0.6),
          vy: Math.sin(spray) * (0.5 + Math.random() * 0.6) - 0.05,
          type: 'spark', color: '#a8121a',
          size: 3 + Math.random() * 2,
          life: 360 + Math.random() * 200,
          gravity: 0.0014, drag: 0.99,
        });
      }
    }
    if (!anyHit) return;
    sfx.sword?.();           // reuses sword sfx until a chainsaw voice ships
    screenShake(2, 80);
  },
  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    // grip
    rctx.fillStyle = '#2a2a2e';
    rctx.fillRect(-12, -4, 18, 8);
    rctx.fillStyle = '#ff7a1a';
    rctx.fillRect(-10, -3, 14, 6);
    // bar
    rctx.fillStyle = '#3a3a3e';
    rctx.fillRect(BAR_OFFSET, -3, BAR_LEN, 6);
    // teeth, phase animates while held
    const phase = (performance.now() * 0.04) % 8;
    rctx.fillStyle = '#cdd';
    for (let i = 0; i < BAR_LEN; i += 8) {
      const tx = BAR_OFFSET + ((i + phase) % BAR_LEN);
      rctx.fillRect(tx, -5, 3, 2);
      rctx.fillRect(tx, 3, 3, 2);
    }
    if (isDown) {
      // a few flecks at the tip when active
      rctx.fillStyle = '#a8121a';
      for (let i = 0; i < 3; i++) {
        rctx.fillRect(BAR_OFFSET + BAR_LEN - i * 4, -1 + (Math.random() - 0.5) * 6, 1.5, 1.5);
      }
    }
    rctx.restore();
  },
};
