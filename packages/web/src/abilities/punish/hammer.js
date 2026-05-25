import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood ops + speech routed through ctx.reactTo.
import { stun } from '../../physics/stand.js';
import { isBrittle, applyStatus, damageMul, consumeConcussed } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { partInRange, applyImpulse, shatter } from '../_shared.js';
import { flinch } from '../../effects/_locomotion.js';

export const defaultStats = {
  range:           80,
  force:           0.18,    // multiplied by part.mass
  mood:            16,      // base damage (subtracted)
  brittleBonus:    1.4,     // mood multiplier when target is frozen
  stunMs:          900,
  shake:           14,
  concussedMs:     1500,
};

export default {
  id: 'hammer',
  defaultStats,
  apply(ctx) {
    const s = getStats('hammer');
    const { ragdoll, status, x, y, screenShake, hitStop } = ctx;
    const part = partInRange(ragdoll, x, y, s.range);
    if (!part) {
      sfx.hammer();
      P.burst(x, y, 6, { type: 'smoke', color: '#444', size: 10, life: 380, speedRange: 0.25, gravity: -0.0003 });
      screenShake(3, 120);
      return;
    }
    const brittle = isBrittle(status, part);
    if (brittle) shatter(ctx, part);
    // Directional from cursor → part (was always-down, which jammed side-hits
    // straight into the floor regardless of swing angle).
    const F = s.force * part.mass * (brittle ? s.brittleBonus : 1);
    const dxp = part.position.x - x, dyp = part.position.y - y;
    const len = Math.hypot(dxp, dyp) || 1;
    const fx = (dxp / len) * F;
    const fy = (dyp / len) * F - 0.04 * part.mass;
    applyImpulse(part, fx, fy);
    // CONCUSSED consume, eat any pre-existing buff before laying down a fresh one.
    const mul = damageMul(status, part);
    if (mul > 1) consumeConcussed(status, part);
    const moodDelta = -s.mood * (brittle ? s.brittleBonus : 1) * mul;
    ctx.reactTo?.({ source: 'hammer', part, moodDelta, impulse: Math.hypot(fx, fy), speakMs: 400 });
    // Hammer ALWAYS leaves the target concussed, setting up the next big hit.
    applyStatus(status, part, 'concussed', { duration: s.concussedMs, source: 'hammer' });
    stun(ragdoll, s.stunMs);
    flinch(ragdoll, x, y, 1.0);
    sfx.hammer();
    screenShake(s.shake, 380);
    hitStop?.heavy();
    P.burst(part.position.x, part.position.y, 22, { type: 'spark', color: '#f29c5c', size: 4,  life: 500, speedRange: 1.0 });
    P.burst(part.position.x, part.position.y,  8, { type: 'smoke', color: '#888',    size: 14, life: 800, speedRange: 0.2, gravity: -0.0004 });
  },
  drawCursor(ctx, { x, y, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    if (isDown) ctx.rotate(-0.3);
    ctx.fillStyle = '#7a4a28';
    ctx.fillRect(-3, -2, 6, 30);
    ctx.fillStyle = '#888';
    ctx.fillRect(-14, -10, 28, 14);
    ctx.fillStyle = '#aaa';
    ctx.fillRect(-14, -10, 28, 3);
    ctx.fillStyle = '#444';
    ctx.fillRect(-14, 1, 28, 3);
    ctx.restore();
  },
};
