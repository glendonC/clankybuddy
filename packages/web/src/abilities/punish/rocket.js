import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, explode } from '../_shared.js';
import { getActiveChar } from '../../ui/character-picker.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  speed:    14,
  radius:   260,    // direct-hit blast radius
  baseVel:  17.6,   // additive radial fling at blast center (was force:0.22 → 0.22 * 80)
  mood:     35,
  igniteMs: 2000,
};

export default {
  id: 'rocket',
  defaultStats,
  apply(ctx) {
    const s = getStats('rocket');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    // Persona affinity (docs §3): the launch hits ChatGPT 1.5× harder.
    const personaMul = getActiveChar() === 'gpt' ? 1.5 : 1.0;
    const moodScaled = s.mood * personaMul;
    const muzzleX = x + Math.cos(angle) * 32;
    const muzzleY = y + Math.sin(angle) * 32;

    const proj = Bodies.rectangle(muzzleX, muzzleY, 18, 6, {
      frictionAir: 0, friction: 0, density: 0.005, restitution: 0,
      label: 'rocket', render: { visible: false },
    });
    proj.partType = 'rocket';
    proj._verb = ctx._verb || 'rocket';
    proj.bornAt = performance.now();
    proj.lifeMs = 2200;
    Body.setVelocity(proj, { x: Math.cos(angle) * s.speed, y: Math.sin(angle) * s.speed });
    Body.setAngle(proj, angle);
    proj.onHit = (b, world, ctx2) => {
      ctx2.hitStop?.projBig();
      explode(ctx2, b.position.x, b.position.y, { radius: s.radius, baseVel: s.baseVel, upBias: 5, moodDelta: -moodScaled, stunMs: 1500, shake: 22, igniteMs: s.igniteMs, sound: 'rocketBoom', limpMs: 900 });
    };
    proj.onExpire = (b, ctx2) => {
      // Air-burst on lifetime expiry, slightly weaker than direct hit.
      explode(ctx2, b.position.x, b.position.y, { radius: s.radius * 0.85, baseVel: s.baseVel * 0.82, upBias: 4, moodDelta: -moodScaled * 0.7, stunMs: 1100, shake: 18, igniteMs: s.igniteMs * 0.75, sound: 'rocketBoom', limpMs: 700 });
    };
    Composite.add(world, proj);
    ctx.transientBodies.push(proj);
    sfx.rocket();
    screenShake(5, 200);
    const backX = x - Math.cos(angle) * 22;
    const backY = y - Math.sin(angle) * 22;
    P.burst(backX,  backY,  14, { type: 'fire',  color: '#ffae3c', size: 8,  life: 280, speedRange: 0.8, gravity: 0 });
    P.burst(backX,  backY,   8, { type: 'smoke', color: '#666',    size: 14, life: 700, speedRange: 0.5, gravity: -0.0003 });
    P.burst(muzzleX, muzzleY, 6, { type: 'fire', color: '#fff7c2', size: 5, life: 180, speedRange: 0.4 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#3a4a3a'; ctx.fillRect(-18, -8, 50, 16);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(8, -12, 4, 6);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(-22, -6, 4, 12);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(32, -10, 3, 20);
    ctx.restore();
  },
};
