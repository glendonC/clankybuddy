// Saw blade, Ordnance group. Phase 7 visceral redirect addition. Click
// throws a spinning disc that ricochets off walls (default Matter
// restitution physics) until it either hits a buddy part or self-expires.
//
// First ragdoll-part contact: pure impact damage + knockback, then removed.
// No DoT, bleed lives on chainsaw / bear-trap / meathook; sawblade's
// identity is the bounce-and-bite.
// Wall contacts: bounce naturally (high restitution on the body), no
// collision handler dispatch, the body just keeps spinning.
//
// Lifetime is tuned so a typical mid-stage cast gets 2-4 wall ricochets
// before timing out. The "3 ricochets" promise in the blurb is enforced
// by lifeMs alone, no counter needed.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { nearestPart } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:   12,
  speed:    18,
  spin:     0.6,         // angular velocity for the disc
  lifeMs:   1400,
  shake:    4,
};

export default {
  id: 'sawblade',
  defaultStats,
  apply(ctx) {
    const s = getStats('sawblade');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const target = nearestPart(ragdoll, x, y);
    if (!target) return;
    const angle = Math.atan2(target.position.y - y, target.position.x - x);
    const muzzleX = x + Math.cos(angle) * 18;
    const muzzleY = y + Math.sin(angle) * 18;
    const vx = Math.cos(angle) * s.speed, vy = Math.sin(angle) * s.speed;

    const blade = Bodies.circle(muzzleX, muzzleY, 11, {
      frictionAir: 0.001, friction: 0.0, density: 0.003, restitution: 0.95,
      label: 'sawblade', render: { visible: false },
    });
    blade.partType = 'sawblade';
    blade._verb = ctx._verb || 'sawblade';
    blade.bornAt = performance.now();
    blade.lifeMs = s.lifeMs;
    blade.bladeDamage = s.damage;
    Body.setVelocity(blade, { x: vx, y: vy });
    Body.setAngularVelocity(blade, s.spin);
    Composite.add(world, blade);
    ctx.transientBodies.push(blade);

    sfx.gun?.();
    screenShake(s.shake, 100);
    P.burst(muzzleX, muzzleY, 6, { type: 'spark', color: '#cdd', size: 3, life: 220, speedRange: 0.6 });
  },
  drawCursor(rctx, { x, y, target, angle }) {
    drawAimLine(rctx, x, y, target);
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    // Spinning disc, outer toothy ring, inner hub.
    const t = performance.now() * 0.02;
    rctx.strokeStyle = '#cdd';
    rctx.lineWidth = 1.6;
    rctx.beginPath();
    rctx.arc(0, 0, 10, 0, Math.PI * 2);
    rctx.stroke();
    rctx.fillStyle = '#888';
    for (let i = 0; i < 8; i++) {
      const a = t + (i / 8) * Math.PI * 2;
      const tx = Math.cos(a) * 10, ty = Math.sin(a) * 10;
      rctx.fillRect(tx - 1.5, ty - 1.5, 3, 3);
    }
    rctx.fillStyle = '#1c1c20';
    rctx.beginPath(); rctx.arc(0, 0, 3, 0, Math.PI * 2); rctx.fill();
    rctx.restore();
  },
};
