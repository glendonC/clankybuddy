import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, markPierce } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:   1.5,
  speed:    26,
  spread:   0.12,    // radians of cone half-width
  lifeMs:   900,
  pierce:   2,
};

export default {
  id: 'machinegun',
  defaultStats,
  apply(ctx) {
    const s = getStats('machinegun');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle: baseAngle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    const ang = baseAngle + (Math.random() - 0.5) * s.spread;
    const muzzleX = x + Math.cos(ang) * 26;
    const muzzleY = y + Math.sin(ang) * 26;
    const vx = Math.cos(ang) * s.speed, vy = Math.sin(ang) * s.speed;

    const bullet = Bodies.circle(muzzleX, muzzleY, 3, {
      frictionAir: 0, friction: 0, density: 0.003, restitution: 0.05,
      label: 'bullet', render: { visible: false },
    });
    bullet.partType = 'bullet';
    bullet._verb = ctx._verb || 'machinegun';
    bullet.bornAt = performance.now();
    bullet.lifeMs = s.lifeMs;
    bullet.bulletDamage = s.damage;
    bullet.bulletStun = 0;
    markPierce(bullet, s.pierce);   // AP rounds → pierce_bullet (no-op without the flag)
    Body.setVelocity(bullet, { x: vx, y: vy });
    Composite.add(world, bullet);
    ctx.transientBodies.push(bullet);

    sfx.machinegun();
    if (Math.random() < 0.4) screenShake(2, 80);
    if (Math.random() < 0.85) {
      P.spawn({ x: muzzleX, y: muzzleY, vx: 0, vy: 0,
        type: 'fire', color: '#ffd266', size: 4 + Math.random() * 2, life: 80, gravity: 0, drag: 1 });
    }
    const ejectAngle = ang + Math.PI / 2;
    P.spawn({
      x: x + Math.cos(ang) * 4, y: y + Math.sin(ang) * 4,
      vx: Math.cos(ejectAngle) * 0.3, vy: Math.sin(ejectAngle) * 0.3 - 0.2,
      type: 'spark', color: '#ffd266', size: 2, life: 400, gravity: 0.0008, drag: 0.99,
    });
  },
  drawCursor(ctx, { x, y, target, angle, isDown }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-6, -4, 32, 8);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(20, -2, 12, 4);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(2, 4, 8, 12);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-6, 4, 6, 10);
    if (isDown && Math.random() < 0.7) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
      ctx.beginPath(); ctx.arc(34, 0, 4 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
