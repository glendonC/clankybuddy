// Assault rifle, ordnance (branches off machine gun). Higher per-round damage
// and a tighter base than the SMG, but the cone CLIMBS with sustained fire
// (recoil) and resets after you let off the trigger. The verb is recoil
// control: short, disciplined bursts stay accurate; held mag-dumps walk wide.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  damage:     3,
  speed:      32,
  spread:     0.02,   // tight first shot
  recoilStep: 0.018,  // climb per sustained shot
  recoilMax:  0.20,
  resetMs:    220,
  lifeMs:     900,
  shake:      3,
};

let _recoil = 0;
let _lastShotAt = 0;

export default {
  id: 'assault_rifle',
  defaultStats,
  apply(ctx) {
    const s = getStats('assault_rifle');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle: baseAngle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;

    const now = performance.now();
    if (now - _lastShotAt > s.resetMs) _recoil = 0;          // trigger released
    else _recoil = Math.min(_recoil + s.recoilStep, s.recoilMax);
    _lastShotAt = now;

    const ang = baseAngle + (Math.random() - 0.5) * (s.spread + _recoil) - _recoil * 0.4; // climb pulls up
    const muzzleX = x + Math.cos(ang) * 28;
    const muzzleY = y + Math.sin(ang) * 28;

    const bullet = Bodies.circle(muzzleX, muzzleY, 3, {
      frictionAir: 0, friction: 0, density: 0.0032, restitution: 0.05,
      label: 'bullet', render: { visible: false },
    });
    bullet.partType = 'bullet';
    bullet._verb = ctx._verb || 'assault_rifle';
    bullet.bornAt = now;
    bullet.lifeMs = s.lifeMs;
    bullet.bulletDamage = s.damage;
    bullet.bulletStun = 0;
    Body.setVelocity(bullet, { x: Math.cos(ang) * s.speed, y: Math.sin(ang) * s.speed });
    Composite.add(world, bullet);
    ctx.transientBodies.push(bullet);

    sfx.machinegun();
    if (Math.random() < 0.4) screenShake(s.shake, 80);
    if (Math.random() < 0.85) {
      P.spawn({ x: muzzleX, y: muzzleY, vx: 0, vy: 0,
        type: 'fire', color: '#ffd266', size: 4 + Math.random() * 2, life: 80, gravity: 0, drag: 1 });
    }
  },
  drawCursor(ctx, { x, y, target, angle, isDown }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Rifle: long receiver, barrel, angled mag, stock.
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-8, -3, 34, 6);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(26, -1.5, 10, 3);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(2, 3, 6, 12);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-12, -2, 5, 4);
    if (isDown && Math.random() < 0.7) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
      ctx.beginPath(); ctx.arc(36, 0, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },
};
