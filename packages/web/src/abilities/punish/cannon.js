// Cannon, ordnance. An emplaced heavy gun that fires a solid iron ball along
// the manual aim ray (or the locked target once the firearms aimbot is owned).
// PURE KINETIC: the ball detonates via bigImpact (radial fling + CONCUSSED
// consume + shatter, NO explosion fire/smoke/spark palette) — a crushing strike,
// not a bomb. Pattern-1 ad-hoc onHit fires on the first collision (ragdoll OR
// wall), exactly like rocket; onExpire is the airburst safety.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, bigImpact } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  speed:      13,
  radius:     120,   // bigImpact blast radius (tight crush, ~half rocket's)
  baseVel:    16,    // additive radial fling at impact center
  mood:       40,
  ballRadius: 11,
};

// Cold iron-on-flesh impact dust (NOT the explosion palette — that's the whole
// difference between cannon and rocket).
function impactDust(bx, by, scale = 1) {
  P.burst(bx, by, Math.round(12 * scale), { type: 'smoke', color: '#5a5550', size: 12, life: 600, speedRange: 0.7, gravity: -0.0004 });
  P.burst(bx, by, Math.round(8 * scale),  { type: 'spark', color: '#cdd3da', size: 3,  life: 300, speedRange: 1.1 });
}

export default {
  id: 'cannon',
  defaultStats,
  apply(ctx) {
    const s = getStats('cannon');
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
    proj._verb = ctx._verb || 'cannon';
    proj.bornAt = performance.now();
    proj.lifeMs = 2400;
    Body.setVelocity(proj, { x: Math.cos(angle) * s.speed, y: Math.sin(angle) * s.speed });
    Body.setAngle(proj, angle);
    proj.onHit = (b, _world, ctx2) => {
      ctx2.hitStop?.projBig();
      bigImpact(ctx2, b.position.x, b.position.y, {
        radius: s.radius, baseVel: s.baseVel, upBias: 4, moodDelta: -s.mood,
        stunMs: 1200, shake: 18, igniteMs: 0, sound: 'cannonHit', limpMs: 800,
      });
      impactDust(b.position.x, b.position.y);
    };
    proj.onExpire = (b, ctx2) => {
      bigImpact(ctx2, b.position.x, b.position.y, {
        radius: s.radius * 0.85, baseVel: s.baseVel * 0.8, upBias: 3, moodDelta: -s.mood * 0.6,
        stunMs: 900, shake: 14, igniteMs: 0, sound: 'cannonHit', limpMs: 600,
      });
      impactDust(b.position.x, b.position.y, 0.7);
    };
    Composite.add(world, proj);
    ctx.transientBodies.push(proj);

    sfx.cannon();
    screenShake(7, 220);
    P.burst(muzzleX, muzzleY, 8,  { type: 'smoke', color: '#777',    size: 14, life: 700, speedRange: 0.5, gravity: -0.0003 });
    P.burst(muzzleX, muzzleY, 10, { type: 'fire',  color: '#ffd266', size: 6,  life: 200, speedRange: 0.9 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Stubby emplaced cannon: dark tube + thick muzzle ring + trunnion under it.
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(-14, -7, 34, 14);
    ctx.fillStyle = '#15171b'; ctx.fillRect(16, -9, 6, 18);
    ctx.fillStyle = '#000';    ctx.beginPath(); ctx.arc(19, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a3f47'; ctx.fillRect(-6, 5, 8, 7);
    ctx.restore();
  },
};
