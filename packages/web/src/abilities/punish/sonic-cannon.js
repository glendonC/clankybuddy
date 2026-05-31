// Sonic cannon, ordnance. An aimed acoustic cone — no projectile. Every part
// inside the cone takes a pressure-wave shove (applyImpulseScaled) and is left
// CONCUSSED, so it's a ranged setup for a heavy follow-up. Manual aim by default
// (fires at the centroid); the firearms aimbot unlock makes it lock the nearest
// part and draw the reticle (it's in AIMED_FIREARMS).

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { applyStatus } from '../../effects/registry.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, applyImpulseScaled } from '../_shared.js';

export const defaultStats = {
  coneRad:   0.5,    // cone half-angle (radians)
  range:     520,
  force:     0.055,  // force-per-mass push along the aim
  mood:      14,
  concussMs: 1500,
  stunMs:    400,
};

export default {
  id: 'sonic_cannon',
  defaultStats,
  apply(ctx) {
    const s = getStats('sonic_cannon');
    const { ragdoll, status, x, y, screenShake } = ctx;
    const { angle: ang0, target, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    const speaker = target || ragdoll.head;
    const dir = { x: Math.cos(ang0), y: Math.sin(ang0) };
    const gate = Math.cos(s.coneRad);
    const hitParts = [];
    for (const p of ragdoll.parts) {
      const dxp = p.position.x - x, dyp = p.position.y - y;
      const dist = Math.hypot(dxp, dyp);
      if (dist > s.range) continue;
      const dirDot = (dxp * dir.x + dyp * dir.y) / (dist || 1);
      if (dirDot < gate) continue;
      const falloff = Math.max(0.15, 1 - dist / s.range);
      const { fx, fy } = applyImpulseScaled(p, dir.x, dir.y, s.force * falloff, 0.01);
      applyStatus(status, p, 'concussed', { duration: s.concussMs, source: 'sonic_cannon' });
      hitParts.push({ part: p, impulse: Math.hypot(fx, fy) });
    }
    const moodDelta = -s.mood;
    if (hitParts.length) {
      const per = moodDelta / hitParts.length;
      for (const h of hitParts) {
        ctx.reactTo?.({ source: 'sonic_cannon', part: h.part, moodDelta: per, impulse: h.impulse, speakMs: h.part === speaker ? 500 : 99999 });
      }
    } else {
      ctx.reactTo?.({ source: 'sonic_cannon', part: speaker, moodDelta, speakMs: 500 });
    }
    stun(ragdoll, s.stunMs);
    sfx.sonicCannon();
    screenShake(8, 220);
    P.burst(x, y, 10, { type: 'smoke', color: '#9fbfd6', size: 8, life: 300, speedRange: 0.6 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    const R = 220, half = 0.5;   // preview reach (actual range is longer); shows direction + spread
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(159,191,214,0.14)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -half, half); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(159,191,214,0.5)'; ctx.lineWidth = 1.5;
    for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(0, 0, (R * i) / 3.5, -half, half); ctx.stroke(); }
    // emitter horn at the muzzle
    ctx.fillStyle = '#2b3138'; ctx.fillRect(-6, -7, 16, 14);
    ctx.fillStyle = '#3a4049'; ctx.beginPath(); ctx.moveTo(10, -9); ctx.lineTo(20, -13); ctx.lineTo(20, 13); ctx.lineTo(10, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
  },
};
