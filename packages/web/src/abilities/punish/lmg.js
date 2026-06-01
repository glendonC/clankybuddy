// Light machine gun, ordnance (branches off machine gun). Belt-fed
// suppression: a SPIN-UP ramp means the first ~0.4s of sustained fire is weak,
// climbing to full damage + knockback as the barrel gets going, then a wide
// wall of lead. Let off the trigger and it spins back down. The verb is
// commitment — you have to hold to get value, which leaves you locked in.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, markPierce } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:    3,
  speed:     28,
  spread:    0.16,    // wide suppression cone
  spinUpMs:  450,
  resetMs:   250,
  lifeMs:    900,
  pierce:    2,
};

let _spinStart = 0;
let _lastShotAt = 0;

export default {
  id: 'lmg',
  defaultStats,
  apply(ctx) {
    const s = getStats('lmg');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle: baseAngle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;

    const now = performance.now();
    if (now - _lastShotAt > s.resetMs) _spinStart = now;     // fresh trigger pull → spin down
    _lastShotAt = now;
    const spin = Math.min(1, (now - _spinStart) / s.spinUpMs);
    const power = 0.5 + 0.5 * spin;                          // 50% → 100%

    const ang = baseAngle + (Math.random() - 0.5) * s.spread;
    const muzzleX = x + Math.cos(ang) * 30;
    const muzzleY = y + Math.sin(ang) * 30;

    const bullet = Bodies.circle(muzzleX, muzzleY, 3.4, {
      frictionAir: 0, friction: 0, density: 0.0034, restitution: 0.05,
      label: 'bullet', render: { visible: false },
    });
    bullet.partType = 'bullet';
    bullet._verb = ctx._verb || 'lmg';
    bullet.bornAt = now;
    bullet.lifeMs = s.lifeMs;
    bullet.bulletDamage = s.damage * power;
    bullet.bulletStun = 0;
    markPierce(bullet, s.pierce);   // AP rounds → pierce_bullet (no-op without the flag)
    Body.setVelocity(bullet, { x: Math.cos(ang) * s.speed, y: Math.sin(ang) * s.speed });
    Composite.add(world, bullet);
    ctx.transientBodies.push(bullet);

    sfx.machinegun();
    if (Math.random() < 0.5) screenShake(2 + spin * 3, 90);
    if (Math.random() < 0.9) {
      P.spawn({ x: muzzleX, y: muzzleY, vx: 0, vy: 0,
        type: 'fire', color: '#ffd266', size: 4 + spin * 4, life: 90, gravity: 0, drag: 1 });
    }
  },
  drawCursor(ctx, { x, y, target, angle, isDown }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Heavy receiver + thick barrel + box mag + bipod stub.
    ctx.fillStyle = '#16161a'; ctx.fillRect(-10, -4, 40, 8);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(30, -2, 12, 4);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(4, 4, 9, 11);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(16, 4, 2, 9); ctx.fillRect(22, 4, 2, 9);
    if (isDown && Math.random() < 0.8) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
      ctx.beginPath(); ctx.arc(42, 0, 4 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
