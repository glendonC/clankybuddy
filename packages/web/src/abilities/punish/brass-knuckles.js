// Brass knuckles, kinetic (branches off punch). A punch that leaves the struck
// part CONCUSSED — so a follow-up hit (from anything) lands at ×1.5. The combo
// self-chains: this hit consumes any existing concussed for its own multiplier,
// then re-applies a fresh one for the next blow.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { isBrittle, damageMul, consumeConcussed, applyStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { partInRange, applyImpulse, shatter } from '../_shared.js';
import { flinch } from '../../effects/_locomotion.js';

import Matter from 'matter-js';
const { Vector } = Matter;

export const defaultStats = {
  range:    64,
  force:    0.055,   // multiplied by part.mass
  mood:     9,
  stunMs:   320,
  shake:    7,
  concussMs: 1500,
};

export default {
  id: 'brass_knuckles',
  defaultStats,
  apply(ctx) {
    const s = getStats('brass_knuckles');
    const { ragdoll, status, x, y, screenShake } = ctx;
    const part = partInRange(ragdoll, x, y, s.range);
    if (!part) {
      P.burst(x, y, 4, { type: 'smoke', color: '#666', size: 6, life: 280, speedRange: 0.25, gravity: -0.0002 });
      return;
    }
    if (isBrittle(status, part)) shatter(ctx, part);
    const dir = Vector.sub(part.position, { x, y });
    const norm = Vector.normalise(dir);
    const F = s.force * part.mass;
    const fx = norm.x * F;
    const fy = norm.y * F - 0.02 * part.mass;
    applyImpulse(part, fx, fy);
    // Consume an existing concussed for THIS hit's multiplier...
    const mul = damageMul(status, part);
    if (mul > 1) consumeConcussed(status, part);
    ctx.reactTo?.({ source: 'punch', part, moodDelta: -(s.mood * mul), impulse: Math.hypot(fx, fy), speakMs: 500 });
    // ...then re-apply a fresh concussed so the NEXT hit chains.
    applyStatus(status, part, 'concussed', { duration: s.concussMs });
    stun(ragdoll, s.stunMs);
    flinch(ragdoll, x, y, 0.7);
    sfx.punch();
    screenShake(s.shake, 200);
    P.burst(part.position.x, part.position.y, 14, { type: 'spark', color: '#ffd266', size: 3, life: 350, speedRange: 0.8 });
  },
  drawCursor(ctx, { x, y, angle, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (isDown) ctx.translate(6, 0);
    // Fist.
    ctx.fillStyle = '#f5d4b8';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Brass bar across the knuckles.
    ctx.fillStyle = '#d9a441';
    ctx.fillRect(4, -7, 4, 14);
    ctx.fillStyle = '#b5832c';
    for (let i = -5; i <= 5; i += 3.5) {
      ctx.beginPath(); ctx.arc(6, i, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
