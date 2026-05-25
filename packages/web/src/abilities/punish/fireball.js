import Matter from 'matter-js';
import * as P from '../../particles.js';
import { drawAimLine } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { nearestPart, explode } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  radius:        160,
  baseVel:       9.6,    // was force:0.12 → 0.12 * 80
  mood:          22,
  igniteMs:      4500,
  firePoolMs:    4500,
};

export default {
  id: 'fireball',
  defaultStats,
  apply(ctx) {
    const s = getStats('fireball');
    const { ragdoll, world, x, y } = ctx;
    const target = nearestPart(ragdoll, x, y);
    if (!target) return;
    const dxf = target.position.x - x, dyf = target.position.y - y;
    const dist = Math.hypot(dxf, dyf) || 1;
    const speed = 9;
    const initVx = (dxf / dist) * speed;
    const initVy = (dyf / dist) * speed - 5;

    const ball = Bodies.circle(x, y - 20, 10, {
      frictionAir: 0.005, friction: 0, density: 0.002, restitution: 0,
      label: 'fireball', render: { visible: false },
    });
    ball.partType = 'fireball';
    ball._verb = ctx._verb || 'fireball';
    ball.bornAt = performance.now();
    ball.lifeMs = 2400;
    Body.setVelocity(ball, { x: initVx, y: initVy });
    ball.onHit = (b, world, ctx2) => {
      explode(ctx2, b.position.x, b.position.y, { radius: s.radius, baseVel: s.baseVel, upBias: 3, moodDelta: -s.mood, stunMs: 800, shake: 12, igniteMs: s.igniteMs, fireDuration: s.firePoolMs, sound: 'fireball', limpMs: 500 });
    };
    ball.onExpire = (b, ctx2) => {
      explode(ctx2, b.position.x, b.position.y, { radius: s.radius * 0.75, baseVel: s.baseVel * 0.67, upBias: 2, moodDelta: -s.mood * 0.64, stunMs: 600, shake: 10, igniteMs: s.igniteMs * 0.83, fireDuration: s.firePoolMs * 0.83, sound: 'fireball', limpMs: 400 });
    };
    Composite.add(world, ball);
    ctx.transientBodies.push(ball);
    // No cast-sfx here, explode() fires sfx.fireball on impact via sound:'fireball'.
    // Doubling them up was Agent A bug #6.
    P.burst(x, y - 20, 8, { type: 'fire', color: '#ff6b1a', size: 8, life: 350, speedRange: 0.5, gravity: -0.0006 });
  },
  drawCursor(ctx, { x, y, target }) {
    if (target) drawAimLine(ctx, x, y, target);
    const t = performance.now() * 0.02;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    const r = 14;
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
    g.addColorStop(0,   '#fff7c2');
    g.addColorStop(0.4, '#ffae3c');
    g.addColorStop(1,   'rgba(255, 80, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(Math.sin(t) * 1.5, Math.cos(t * 1.3) * 1.5, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};
