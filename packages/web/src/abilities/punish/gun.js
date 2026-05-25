import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { nearestPart } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:    10,
  speed:     22,
  stunMs:    350,
  lifeMs:    1200,
  shake:     3,
};

export default {
  id: 'gun',
  defaultStats,
  apply(ctx) {
    const s = getStats('gun');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const target = nearestPart(ragdoll, x, y);
    if (!target) return;
    const angle = Math.atan2(target.position.y - y, target.position.x - x);
    const muzzleX = x + Math.cos(angle) * 24;
    const muzzleY = y + Math.sin(angle) * 24;
    const vx = Math.cos(angle) * s.speed, vy = Math.sin(angle) * s.speed;

    const bullet = Bodies.circle(muzzleX, muzzleY, 4, {
      frictionAir: 0, friction: 0, density: 0.004, restitution: 0.1,
      label: 'bullet', render: { visible: false },
    });
    bullet.partType = 'bullet';
    bullet._verb = ctx._verb || 'gun';
    bullet.bornAt = performance.now();
    bullet.lifeMs = s.lifeMs;
    bullet.bulletDamage = s.damage;
    bullet.bulletStun = s.stunMs;
    Body.setVelocity(bullet, { x: vx, y: vy });
    Composite.add(world, bullet);
    ctx.transientBodies.push(bullet);

    sfx.gun();
    screenShake(s.shake, 100);
    P.burst(muzzleX, muzzleY, 10, { type: 'fire',  color: '#ffd266', size: 5, life: 160, speedRange: 0.5 });
    P.burst(muzzleX, muzzleY,  4, { type: 'smoke', color: '#888',    size: 6, life: 350, speedRange: 0.3, gravity: -0.0002 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    drawAimLine(ctx, x, y, target);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-2, -2, 6, 14);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(-2, -6, 22, 6);
    ctx.fillStyle = '#000';    ctx.fillRect(20, -3, 2, 2);
    ctx.fillStyle = '#444';    ctx.fillRect(-3, -7, 2, 3);
    ctx.restore();
  },
};
