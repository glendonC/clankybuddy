import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// Railgun — a hypervelocity tungsten slug that pierces a whole line of parts.
// Same pierce_bullet path as the sniper (transients/pierce-bullet.js), tuned
// faster/heavier with a deeper pierce budget. Resolves the docs §4.6 "Railgun
// line" tension toward a TRAVELLING pierce_bullet (not a melee sweepImpact
// line): at this speed the slug crosses the stage in a few frames so it reads
// as an instant line, the _hitSet carves the line, and it composes with the
// firearms ammo flags — none of which a sweepImpact line would do. Always
// pierces (its native verb); does not read the firearms.pierce flag.
export const defaultStats = {
  damage: 40,
  speed:  48,
  stunMs: 700,
  lifeMs: 1200,
  shake:  14,
  pierce: 4,
};

export default {
  id: 'railgun',
  defaultStats,
  apply(ctx) {
    const s = getStats('railgun');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle, ok } = aimAngle(ragdoll, x, y);   // family defaults to 'firearms'
    if (!ok) return;
    const muzzleX = x + Math.cos(angle) * 28;
    const muzzleY = y + Math.sin(angle) * 28;
    const vx = Math.cos(angle) * s.speed, vy = Math.sin(angle) * s.speed;

    const slug = Bodies.circle(muzzleX, muzzleY, 3, {
      frictionAir: 0, friction: 0, density: 0.008, restitution: 0.02,
      label: 'pierce_bullet', render: { visible: false },
    });
    slug.partType = 'pierce_bullet';
    slug._verb = ctx._verb || 'railgun';
    slug.bornAt = performance.now();
    slug.lifeMs = s.lifeMs;
    slug.bulletDamage = s.damage;
    slug.bulletStun = s.stunMs;
    slug._pierceLeft = s.pierce;
    slug._hitSet = new Set();
    Body.setVelocity(slug, { x: vx, y: vy });
    Composite.add(world, slug);
    ctx.transientBodies.push(slug);

    sfx.railgun();
    screenShake(s.shake, 200);
    // Cyan capacitor flash at the rail emitter.
    P.burst(muzzleX, muzzleY, 12, { type: 'spark', color: '#9be7ff', size: 4, life: 220, speedRange: 1.2 });
    P.burst(muzzleX, muzzleY, 5,  { type: 'spark', color: '#fff',    size: 2, life: 160, speedRange: 1.5 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#23232a'; ctx.fillRect(-6, -3, 12, 14);   // emitter housing
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(2, -5, 30, 3);     // upper rail
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(2,  2, 30, 3);     // lower rail
    ctx.fillStyle = '#9be7ff'; ctx.fillRect(2, -1, 28, 2);     // charged slot glow
    ctx.restore();
  },
};
