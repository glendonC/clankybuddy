// Minigun, ordnance (evolves the LMG). Hose of lead at the highest fire rate
// in the game — but the barrel LOCKS to wherever it was pointed when you
// opened up: you can't re-aim mid-spray, you have to release and re-acquire.
// The verb is the trade: maximum sustained output for zero tracking.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:   2.2,
  speed:    34,
  spread:   0.10,
  resetMs:  200,    // gap that re-acquires the barrel lock
  lifeMs:   850,
};

let _lockedAngle = null;
let _lastShotAt = 0;

export default {
  id: 'minigun',
  defaultStats,
  apply(ctx) {
    const s = getStats('minigun');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const now = performance.now();
    // New trigger pull (gap since last shot) → re-acquire and lock the barrel;
    // otherwise reuse the locked angle — the spray can't track the buddy.
    if (_lockedAngle === null || now - _lastShotAt > s.resetMs) {
      const { angle, ok } = aimAngle(ragdoll, x, y);
      if (!ok) return;
      _lockedAngle = angle;
    }
    _lastShotAt = now;

    const ang = _lockedAngle + (Math.random() - 0.5) * s.spread;
    const muzzleX = x + Math.cos(ang) * 32;
    const muzzleY = y + Math.sin(ang) * 32;

    const bullet = Bodies.circle(muzzleX, muzzleY, 3, {
      frictionAir: 0, friction: 0, density: 0.003, restitution: 0.05,
      label: 'bullet', render: { visible: false },
    });
    bullet.partType = 'bullet';
    bullet._verb = ctx._verb || 'minigun';
    bullet.bornAt = now;
    bullet.lifeMs = s.lifeMs;
    bullet.bulletDamage = s.damage;
    bullet.bulletStun = 0;
    Body.setVelocity(bullet, { x: Math.cos(ang) * s.speed, y: Math.sin(ang) * s.speed });
    Composite.add(world, bullet);
    ctx.transientBodies.push(bullet);

    sfx.machinegun();
    if (Math.random() < 0.3) screenShake(3, 70);
    if (Math.random() < 0.95) {
      P.spawn({ x: muzzleX, y: muzzleY, vx: 0, vy: 0,
        type: 'fire', color: '#ffe08a', size: 5 + Math.random() * 3, life: 80, gravity: 0, drag: 1 });
    }
  },
  drawCursor(ctx, { x, y, target, angle }) {
    // While locked-and-firing, draw along the LOCKED angle so the player sees
    // the barrel isn't tracking; otherwise the resolved aim angle.
    const drawAng = _lockedAngle ?? angle;
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(drawAng);
    // Rotary barrel cluster + housing.
    ctx.fillStyle = '#16161a'; ctx.fillRect(-12, -5, 18, 10);
    ctx.fillStyle = '#0a0a0c';
    for (let i = -3; i <= 3; i += 2) ctx.fillRect(6, i - 0.8, 26, 1.6);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(-12, -6, 4, 12);
    ctx.restore();
  },
};
