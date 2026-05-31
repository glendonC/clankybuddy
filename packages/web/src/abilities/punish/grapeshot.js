// Grapeshot, ordnance. A cannon loaded with scattershot: one trigger pull
// throws a tight forward cone of heavy iron shot. Reuses the 'bullet' transient
// (so the firearms ammo mods — hollow-point / incendiary / HE — compose on the
// shot for free) plus shotgun's instant cone-knockback pass. Heavier and
// shorter-ranged than the shotgun: fewer, chunkier pellets.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { isBrittle, hasStatus, damageMul, consumeConcussed, findConcussedInRange } from '../../effects/registry.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle, applyImpulse, shatter } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  pellets:      12,
  coneRad:      0.5,    // total scatter spread (radians)
  range:        520,
  force:        0.05,
  mood:         24,
  pelletDamage: 2.5,
  pelletSpeed:  24,
  stunMs:       400,
};

export default {
  id: 'grapeshot',
  defaultStats,
  apply(ctx) {
    const s = getStats('grapeshot');
    const { ragdoll, world, status, x, y, screenShake } = ctx;
    const { angle: ang0, target, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    const fromX = x + Math.cos(ang0) * 30;
    const fromY = y + Math.sin(ang0) * 30;
    const speaker = target || ragdoll.head;

    for (let i = 0; i < s.pellets; i++) {
      const a = ang0 + (Math.random() - 0.5) * s.coneRad;
      const pellet = Bodies.circle(fromX, fromY, 3, {
        frictionAir: 0, friction: 0, density: 0.003, restitution: 0.05,
        label: 'pellet', render: { visible: false },
      });
      pellet.partType = 'bullet';
      pellet._verb = ctx._verb || 'grapeshot';
      pellet.bornAt = performance.now();
      pellet.lifeMs = 520;
      pellet.bulletDamage = s.pelletDamage;
      pellet.bulletStun = 0;
      Body.setVelocity(pellet, { x: Math.cos(a) * s.pelletSpeed, y: Math.sin(a) * s.pelletSpeed });
      Composite.add(world, pellet);
      ctx.transientBodies.push(pellet);
    }

    // Immediate cone-knockback pass (shotgun model): the wall of shot.
    const muzzleDir = { x: Math.cos(ang0), y: Math.sin(ang0) };
    let combo = false;
    const hitParts = [];
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
    const concussedPart = (target && hasStatus(status, target, 'concussed') ? target : null)
                       ?? findConcussedInRange(status, ragdoll, fromX, fromY, s.range);
    const mul = concussedPart ? damageMul(status, concussedPart) : 1;
    if (mul > 1) consumeConcussed(status, concussedPart);
    const moodDelta = -s.mood * mul;
    if (hitParts.length) {
      const perPartDelta = moodDelta / hitParts.length;
      for (const hit of hitParts) {
        ctx.reactTo?.({
          source: 'grapeshot', part: hit.part, moodDelta: perPartDelta, impulse: hit.impulse,
          speakMs: hit.part === speaker ? 500 : 99999,
        });
      }
    } else {
      ctx.reactTo?.({ source: 'grapeshot', part: speaker, moodDelta, speakMs: 500 });
    }
    stun(ragdoll, s.stunMs);
    sfx.grapeshot();
    screenShake(combo ? 14 : 9, 280);
    P.burst(fromX, fromY, 20, { type: 'fire',  color: '#ffd266', size: 8,  life: 260, speedRange: 1.3, gravity: 0.0005 });
    P.burst(fromX, fromY, 10, { type: 'smoke', color: '#777',    size: 16, life: 720, speedRange: 0.5, gravity: -0.0003 });
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Squat scattergun cannon: short fat barrel with a flared muzzle.
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(-12, -8, 26, 16);
    ctx.fillStyle = '#15171b';
    ctx.beginPath(); ctx.moveTo(12, -9); ctx.lineTo(24, -13); ctx.lineTo(24, 13); ctx.lineTo(12, 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a3f47'; ctx.fillRect(-6, 6, 8, 7);
    ctx.restore();
  },
};
