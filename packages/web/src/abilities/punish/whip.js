// Whip, Kinetic group. Click ability, ranged chain-hit melee. Hits the
// nearest part within `range`, then propagates to the next-nearest 2 parts
// within `chainRadius` of the primary. Each hit applies LASHED (DoT mood
// drain over 4s) and a small impulse. Phase 7 visceral-redirect addition.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood via ctx.reactTo.
import { getStats } from '../_stats.js';
import { nearestPart, applyImpulse, partInRange } from '../_shared.js';
import { applyStatus, damageMul, consumeConcussed } from '../../effects/registry.js';

export const defaultStats = {
  range:        280,    // detect radius from cursor
  force:        0.10,   // impulse multiplier (read against part.mass)
  mood:         5,      // primary mood damage
  chainMood:    3,      // chain-link mood per echo
  chainRadius:  100,    // how far chain echoes can travel from primary
  chains:       2,      // number of chain echoes (Spread upgrade raises this)
  lashedMs:     4000,   // LASHED duration
  lashedRate:   1.5,    // LASHED -mood per second (Barbed upgrade raises)
};

function chainTargets(ragdoll, primary, radius, max) {
  const others = ragdoll.parts.filter((p) => p !== primary);
  others.sort((a, b) => {
    const da = Math.hypot(a.position.x - primary.position.x, a.position.y - primary.position.y);
    const db = Math.hypot(b.position.x - primary.position.x, b.position.y - primary.position.y);
    return da - db;
  });
  const out = [];
  for (const p of others) {
    const d = Math.hypot(p.position.x - primary.position.x, p.position.y - primary.position.y);
    if (d > radius) break;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

export default {
  id: 'whip',
  defaultStats,
  apply(ctx) {
    const s = getStats('whip');
    const { ragdoll, status, x, y, screenShake } = ctx;
    const primary = partInRange(ragdoll, x, y, s.range) || nearestPart(ragdoll, x, y);
    if (!primary) {
      sfx.whip?.();
      return;
    }
    // Primary hit, full mood, full impulse, full LASHED. Block roll fires
    // ONCE for the full chain (echoes inherit, no re-roll per finding #30).
    const baseMul = damageMul(status, primary);
    if (baseMul > 1) consumeConcussed(status, primary);
    if (baseMul === 0) {
      // ALIGNED ate the cast, VFX stub, no chain.
      sfx.whip?.();
      P.burst(primary.position.x, primary.position.y, 4, { type: 'spark', color: '#fff', size: 3, life: 200 });
      return;
    }
    const dxp = primary.position.x - x, dyp = primary.position.y - y;
    const len = Math.hypot(dxp, dyp) || 1;
    const F = s.force * primary.mass;
    applyImpulse(primary, (dxp / len) * F, (dyp / len) * F * 0.6);
    applyStatus(status, primary, 'lashed', {
      duration: s.lashedMs,
      data: { ratePerSec: s.lashedRate },
      source: 'whip',
    });
    ctx.reactTo?.({ source: 'whip', part: primary, moodDelta: -s.mood * baseMul, impulse: F, speakMs: 500 });

    // Chain echoes, half impulse, chainMood, LASHED. No re-roll on baseMul.
    const echoes = chainTargets(ragdoll, primary, s.chainRadius, s.chains);
    for (const p of echoes) {
      const ex = p.position.x - primary.position.x;
      const ey = p.position.y - primary.position.y;
      const elen = Math.hypot(ex, ey) || 1;
      applyImpulse(p, (ex / elen) * F * 0.5, (ey / elen) * F * 0.5);
      applyStatus(status, p, 'lashed', {
        duration: s.lashedMs,
        data: { ratePerSec: s.lashedRate },
        source: 'whip-chain',
      });
      // Chain echoes silent, primary already spoke. Mood + telemetry only.
      ctx.reactTo?.({ source: 'whip', part: p, moodDelta: -s.chainMood * baseMul, impulse: F * 0.5, speakMs: 99999 });
      // Crack-line VFX between primary and echo.
      P.spawn({ x: (primary.position.x + p.position.x) / 2, y: (primary.position.y + p.position.y) / 2,
        vx: 0, vy: 0, type: 'spark', color: '#ff6b6b', size: 4, life: 220 });
    }
    sfx.whip?.();
    screenShake(4, 120);
    P.burst(primary.position.x, primary.position.y, 12, { type: 'spark', color: '#ff4d4d', size: 3, life: 350, speedRange: 0.6 });
  },
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.strokeStyle = '#ff4d4d';
    rctx.lineWidth = 1.4;
    // Coiled-whip-handle icon
    rctx.beginPath();
    rctx.moveTo(-8, 8);
    rctx.bezierCurveTo(-4, 0, 4, 4, 8, -8);
    rctx.stroke();
    // Tip flick
    rctx.beginPath();
    rctx.moveTo(8, -8);
    rctx.lineTo(11, -11);
    rctx.stroke();
    rctx.restore();
  },
};
