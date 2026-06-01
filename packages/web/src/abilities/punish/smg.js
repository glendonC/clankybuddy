// Submachine gun, ordnance (branches off machine gun). A mobile bullet-hose:
// lower per-round damage and faster fire than the machine gun, with first-shot
// accuracy that BLOOMS into a wider cone the longer you hold the trigger, then
// snaps back after a brief gap. Reuses the bullet transient model.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, markPierce } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:     1.2,
  speed:      28,
  spread:     0.05,   // tight first-shot cone
  bloomStep:  0.02,   // added per sustained shot
  bloomMax:   0.22,   // cone half-width ceiling
  resetMs:    180,    // gap that resets the bloom
  lifeMs:     800,
  pierce:     2,
};

// Bloom climbs while you hold; resets after a gap. Single-buddy game, so a
// module-local pair is sufficient (no per-part state needed).
let _bloom = 0;
let _lastShotAt = 0;

export default {
  id: 'smg',
  defaultStats,
  apply(ctx) {
    const s = getStats('smg');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle: baseAngle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;

    const now = performance.now();
    if (now - _lastShotAt > s.resetMs) _bloom = 0;
    else _bloom = Math.min(_bloom + s.bloomStep, s.bloomMax);
    _lastShotAt = now;

    const cone = s.spread + _bloom;
    const ang = baseAngle + (Math.random() - 0.5) * cone;
    const muzzleX = x + Math.cos(ang) * 22;
    const muzzleY = y + Math.sin(ang) * 22;
    const vx = Math.cos(ang) * s.speed, vy = Math.sin(ang) * s.speed;

    const bullet = Bodies.circle(muzzleX, muzzleY, 3, {
      frictionAir: 0, friction: 0, density: 0.0028, restitution: 0.05,
      label: 'bullet', render: { visible: false },
    });
    bullet.partType = 'bullet';
    bullet._verb = ctx._verb || 'smg';
    bullet.bornAt = now;
    bullet.lifeMs = s.lifeMs;
    bullet.bulletDamage = s.damage;
    bullet.bulletStun = 0;
    markPierce(bullet, s.pierce);   // AP rounds → pierce_bullet (no-op without the flag)
    Body.setVelocity(bullet, { x: vx, y: vy });
    Composite.add(world, bullet);
    ctx.transientBodies.push(bullet);

    sfx.machinegun();
    if (Math.random() < 0.3) screenShake(2, 70);
    if (Math.random() < 0.85) {
      P.spawn({ x: muzzleX, y: muzzleY, vx: 0, vy: 0,
        type: 'fire', color: '#ffe08a', size: 3 + Math.random() * 2, life: 70, gravity: 0, drag: 1 });
    }
    const ejectAngle = ang + Math.PI / 2;
    P.spawn({
      x: x + Math.cos(ang) * 4, y: y + Math.sin(ang) * 4,
      vx: Math.cos(ejectAngle) * 0.3, vy: Math.sin(ejectAngle) * 0.3 - 0.2,
      type: 'spark', color: '#ffd266', size: 2, life: 360, gravity: 0.0008, drag: 0.99,
    });
  },
  drawCursor(ctx, { x, y, target, angle, isDown }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Compact SMG: short receiver, stubby barrel, vertical mag.
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-6, -3, 22, 6);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(16, -1.5, 8, 3);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(0, 3, 5, 10);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-6, 3, 5, 7);
    if (isDown && Math.random() < 0.7) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 224, 138, 0.9)';
      ctx.beginPath(); ctx.arc(26, 0, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
