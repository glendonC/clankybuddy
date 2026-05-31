// Hot shot, ordnance. A furnace-heated cannonball: the same heavy-ball
// projectile as the cannon, but the round detonates with fire — bigImpact with
// igniteMs>0 sets every part in the blast alight, and a lingering ember pool
// burns where it lands. Reuses the 'cannonball' partType (with a _heated flag the
// shared render branch reads for the orange glow), so there's no second branch.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, bigImpact } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  speed:      13,
  radius:     120,
  baseVel:    15,
  mood:       38,
  ballRadius: 11,
  igniteMs:   2000,
  firePoolMs: 4000,
};

function fireImpact(bx, by, scale = 1) {
  P.burst(bx, by, Math.round(16 * scale), { type: 'fire',  color: '#ff6b1a', size: 12, life: 600, speedRange: 1.3, gravity: -0.0006 });
  P.burst(bx, by, Math.round(10 * scale), { type: 'spark', color: '#ffd266', size: 3,  life: 300, speedRange: 1.2 });
  P.burst(bx, by, Math.round(8 * scale),  { type: 'smoke', color: '#444',    size: 14, life: 800, speedRange: 0.6, gravity: -0.0005 });
}

export default {
  id: 'hot_shot',
  defaultStats,
  apply(ctx) {
    const s = getStats('hot_shot');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    const muzzleX = x + Math.cos(angle) * 34;
    const muzzleY = y + Math.sin(angle) * 34;

    const proj = Bodies.circle(muzzleX, muzzleY, s.ballRadius, {
      frictionAir: 0, friction: 0, density: 0.02, restitution: 0.1,
      label: 'cannonball', render: { visible: false },
    });
    proj.partType = 'cannonball';
    proj._heated = true;            // shared render branch draws the orange glow
    proj._verb = ctx._verb || 'hot_shot';
    proj.bornAt = performance.now();
    proj.lifeMs = 2400;
    Body.setVelocity(proj, { x: Math.cos(angle) * s.speed, y: Math.sin(angle) * s.speed });
    Body.setAngle(proj, angle);
    proj.onHit = (b, _world, ctx2) => {
      ctx2.hitStop?.projBig();
      bigImpact(ctx2, b.position.x, b.position.y, {
        radius: s.radius, baseVel: s.baseVel, upBias: 4, moodDelta: -s.mood,
        stunMs: 1200, shake: 18, igniteMs: s.igniteMs, sound: 'hotShotHit', limpMs: 800,
      });
      ctx2._spawnFirePool?.(b.position.x, b.position.y, s.firePoolMs);
      fireImpact(b.position.x, b.position.y);
    };
    proj.onExpire = (b, ctx2) => {
      bigImpact(ctx2, b.position.x, b.position.y, {
        radius: s.radius * 0.85, baseVel: s.baseVel * 0.8, upBias: 3, moodDelta: -s.mood * 0.6,
        stunMs: 900, shake: 14, igniteMs: s.igniteMs * 0.75, sound: 'hotShotHit', limpMs: 600,
      });
      ctx2._spawnFirePool?.(b.position.x, b.position.y, s.firePoolMs * 0.6);
      fireImpact(b.position.x, b.position.y, 0.7);
    };
    Composite.add(world, proj);
    ctx.transientBodies.push(proj);

    sfx.hotShot();
    screenShake(7, 220);
    P.burst(muzzleX, muzzleY, 12, { type: 'fire',  color: '#ffae3c', size: 8,  life: 280, speedRange: 1.0 });
    P.burst(muzzleX, muzzleY, 6,  { type: 'smoke', color: '#666',    size: 12, life: 600, speedRange: 0.4, gravity: -0.0003 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(-14, -7, 34, 14);
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(19, 0, 4, 0, Math.PI * 2); ctx.fill();  // glowing-hot muzzle
    ctx.fillStyle = '#3a3f47'; ctx.fillRect(-6, 5, 8, 7);
    ctx.restore();
  },
};
