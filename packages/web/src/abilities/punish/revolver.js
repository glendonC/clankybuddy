// Revolver, ordnance (branches off pistol). Six heavy magnum shots with big
// stun + knockback, then a forced reload before you can fire again. The verb
// is the cylinder discipline: burst of power, then a vulnerable gap.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, markPierce } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:   18,
  speed:    30,
  stunMs:   500,
  lifeMs:   1200,
  shake:    6,
  cylinder: 6,
  reloadMs: 1500,
  pierce:   2,
};

// Single-buddy game → module-local cylinder state is fine.
let _shotsLeft = null;
let _reloadUntil = 0;

export default {
  id: 'revolver',
  defaultStats,
  apply(ctx) {
    const s = getStats('revolver');
    if (_shotsLeft === null) _shotsLeft = s.cylinder;
    const now = performance.now();
    if (now < _reloadUntil) return;            // mid-reload, dead trigger
    const { ragdoll, world, x, y, screenShake, popBubble } = ctx;
    const { angle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    const muzzleX = x + Math.cos(angle) * 26;
    const muzzleY = y + Math.sin(angle) * 26;

    const bullet = Bodies.circle(muzzleX, muzzleY, 4, {
      frictionAir: 0, friction: 0, density: 0.006, restitution: 0.1,
      label: 'bullet', render: { visible: false },
    });
    bullet.partType = 'bullet';
    bullet._verb = ctx._verb || 'revolver';
    bullet.bornAt = now;
    bullet.lifeMs = s.lifeMs;
    bullet.bulletDamage = s.damage;
    bullet.bulletStun = s.stunMs;
    markPierce(bullet, s.pierce);   // AP rounds → pierce_bullet (no-op without the flag)
    Body.setVelocity(bullet, { x: Math.cos(angle) * s.speed, y: Math.sin(angle) * s.speed });
    Composite.add(world, bullet);
    ctx.transientBodies.push(bullet);

    sfx.revolver();
    screenShake(s.shake, 120);
    P.burst(muzzleX, muzzleY, 12, { type: 'fire',  color: '#ffd266', size: 6, life: 180, speedRange: 0.6 });
    P.burst(muzzleX, muzzleY,  5, { type: 'smoke', color: '#888',    size: 7, life: 400, speedRange: 0.3, gravity: -0.0002 });

    _shotsLeft -= 1;
    if (_shotsLeft <= 0) {
      _shotsLeft = s.cylinder;
      _reloadUntil = now + s.reloadMs;
      popBubble?.(ragdoll.head, '*click* …reloading');
    }
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Long barrel + cylinder + grip.
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(-2, -2, 20, 4);
    ctx.fillStyle = '#3a3a44'; ctx.beginPath(); ctx.arc(-1, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(18, -1.5, 3, 3);
    ctx.fillStyle = '#5a4530'; ctx.fillRect(-6, 1, 5, 9);
    ctx.restore();
  },
};
