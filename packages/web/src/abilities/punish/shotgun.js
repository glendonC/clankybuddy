import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood + speech routed through ctx.reactTo.
import { stun } from '../../physics/stand.js';
import { isBrittle, hasStatus, damageMul, consumeConcussed, findConcussedInRange } from '../../effects/registry.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, applyImpulse, shatter } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  pellets:   9,
  coneRad:   0.45,    // total cone width in radians
  range:     600,
  force:     0.06,
  mood:      20,
  stunMs:    500,
};

export default {
  id: 'shotgun',
  defaultStats,
  apply(ctx) {
    const s = getStats('shotgun');
    const { ragdoll, world, status, x, y, screenShake } = ctx;
    const { angle: ang0, target, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    const fromX = x, fromY = y;
    // Whoever "speaks" the hit: the locked target if aimbot is on, else the head.
    const speaker = target || ragdoll.head;

    let combo = false;
    const hitParts = [];
    const pellets = s.pellets;
    for (let i = 0; i < pellets; i++) {
      const a = ang0 + (Math.random() - 0.5) * s.coneRad;
      const speed = 26;
      const vx = Math.cos(a) * speed, vy = Math.sin(a) * speed;
      const pellet = Bodies.circle(fromX, fromY, 2.5, {
        frictionAir: 0, friction: 0, density: 0.003, restitution: 0.05,
        label: 'pellet', render: { visible: false },
      });
      pellet.partType = 'bullet';
      pellet._verb = ctx._verb || 'shotgun';
      pellet.bornAt = performance.now();
      pellet.lifeMs = 500;
      pellet.bulletDamage = 0.4;
      pellet.bulletStun = 0;
      Body.setVelocity(pellet, { x: vx, y: vy });
      Composite.add(world, pellet);
      ctx.transientBodies.push(pellet);
    }
    const muzzleDir = { x: Math.cos(ang0), y: Math.sin(ang0) };
    for (const p of ragdoll.parts) {
      const dxp = p.position.x - fromX, dyp = p.position.y - fromY;
      const dist = Math.hypot(dxp, dyp);
      if (dist > s.range) continue;
      const dirDot = (dxp * muzzleDir.x + dyp * muzzleDir.y) / (dist || 1);
      if (dirDot < 0.78) continue;
      const falloff = Math.max(0.1, 1 - dist / s.range);
      const F = s.force * falloff * p.mass;
      const fx = muzzleDir.x * F;
      const fy = muzzleDir.y * F - 0.01 * falloff;
      applyImpulse(p, fx, fy);
      hitParts.push({ part: p, impulse: Math.hypot(fx, fy) });
      if (isBrittle(status, p)) { shatter(ctx, p); combo = true; }
    }
    // CONCUSSED consume, multi-pellet but flat mood damage. Pick any
    // concussed part within muzzle range, apply ×1.5 to the flat number,
    // and consume that one part's buff. Prefer the targeted part if it has it.
    const concussedPart = (target && hasStatus(status, target, 'concussed') ? target : null)
                       ?? findConcussedInRange(status, ragdoll, fromX, fromY, s.range);
    const mul = concussedPart ? damageMul(status, concussedPart) : 1;
    if (mul > 1) consumeConcussed(status, concussedPart);
    const moodDelta = -s.mood * mul;
    if (hitParts.length) {
      const perPartDelta = moodDelta / hitParts.length;
      for (const hit of hitParts) {
        ctx.reactTo?.({
          source: 'shotgun',
          part: hit.part,
          moodDelta: perPartDelta,
          impulse: hit.impulse,
          // Only the speaker part talks, other pellet hits suppress to avoid
          // throttle-thrash. Same pattern as bigImpact.
          speakMs: hit.part === speaker ? 500 : 99999,
        });
      }
    } else {
      ctx.reactTo?.({ source: 'shotgun', part: speaker, moodDelta, speakMs: 500 });
    }
    stun(ragdoll, s.stunMs);
    sfx.shotgun();
    screenShake(combo ? 14 : 8, 280);
    P.burst(fromX, fromY, 18, { type: 'fire',  color: '#ffd266', size: 7,  life: 250, speedRange: 1.2, gravity: 0.0005 });
    P.burst(fromX, fromY,  8, { type: 'smoke', color: '#777',    size: 14, life: 700, speedRange: 0.4, gravity: -0.0003 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#7a4a28'; ctx.fillRect(-16, -3, 12, 6);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(-4, -3, 14, 6);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(10, -4, 22, 4); ctx.fillRect(10, 0, 22, 4);
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(2, -4, 6, 8);
    ctx.restore();
  },
};
