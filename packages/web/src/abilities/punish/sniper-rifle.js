import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// Sniper rifle — one slow, heavy, high-velocity round that drills clean through
// a LINE of parts. First consumer of the pierce_bullet dispatcher substrate
// (transients/pierce-bullet.js). Pierce is its NATIVE verb: it always spawns a
// pierce_bullet directly, independent of the firearms.pierce family flag.
export const defaultStats = {
  damage: 28,
  speed:  32,
  stunMs: 600,
  lifeMs: 1400,
  shake:  8,
  pierce: 2,            // parts the slug drills through before it burns
  pierceShatter: false, // Anti-materiel upgrade flips this → frozen parts crossed shatter clean off
};

export default {
  id: 'sniper_rifle',
  defaultStats,
  apply(ctx) {
    const s = getStats('sniper_rifle');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle, ok } = aimAngle(ragdoll, x, y);   // family defaults to 'firearms'
    if (!ok) return;
    const muzzleX = x + Math.cos(angle) * 26;
    const muzzleY = y + Math.sin(angle) * 26;
    const vx = Math.cos(angle) * s.speed, vy = Math.sin(angle) * s.speed;

    const slug = Bodies.circle(muzzleX, muzzleY, 4, {
      frictionAir: 0, friction: 0, density: 0.006, restitution: 0.05,
      label: 'pierce_bullet', render: { visible: false },
    });
    slug.partType = 'pierce_bullet';
    slug._verb = ctx._verb || 'sniper_rifle';
    slug.bornAt = performance.now();
    slug.lifeMs = s.lifeMs;
    slug.bulletDamage = s.damage;
    slug.bulletStun = s.stunMs;
    slug._pierceLeft = s.pierce;
    slug._hitSet = new Set();
    slug._pierceShatter = !!s.pierceShatter;   // Anti-materiel: deterministic shatter of frozen parts crossed
    Body.setVelocity(slug, { x: vx, y: vy });
    Composite.add(world, slug);
    ctx.transientBodies.push(slug);

    sfx.sniper();
    screenShake(s.shake, 120);
    P.burst(muzzleX, muzzleY, 9, { type: 'fire',  color: '#ffe7a0', size: 5, life: 180, speedRange: 0.6 });
    P.burst(muzzleX, muzzleY, 4, { type: 'smoke', color: '#888',    size: 6, life: 380, speedRange: 0.3, gravity: -0.0002 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-6, -2, 10, 13);   // stock
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(-6, -3, 36, 5);    // long barrel
    ctx.fillStyle = '#15151a'; ctx.fillRect(30, -2, 4, 2);     // muzzle
    ctx.fillStyle = '#4a4a52'; ctx.fillRect(4, -8, 9, 3);      // scope tube
    ctx.restore();
  },
};
