// Car, siege wide-body line (off piano). A 200×96 chassis dropped from height:
// the squash + wide splash flattens whatever it lands on, then the onImpact
// seam fires explode() for the ruptured-fuel-tank fireball + lingering pool.
// Verb = metal crunch on landing, then a whump as the tank goes up.
//
// No new chaining code: the existing onImpact(b, world, ctx2, part) seam runs
// AFTER the built-in squash/splash/react, so we just hand explode() the impact
// point. explode() already pairs bigImpact (radial fling + concuss consume)
// with the fire particle palette and _spawnFirePool via { igniteMs, fireDuration }.

import { getStats } from '../_stats.js';
import { explode, spawnDrop } from '../_shared.js';
import * as P from '../../particles.js';

export const defaultStats = {
  density:      0.02,
  mood:         34,
  igniteMs:     1400,   // >0 → ignite parts caught in the fuel fire
  fireDuration: 2600,   // lingering fire pool under the wreck
};

export default {
  id: 'car',
  defaultStats,
  apply(ctx) {
    const s = getStats('car');
    spawnDrop(ctx, {
      partType: 'car', verb: 'car',
      shape: 'rect', w: 200, h: 96,
      density: s.density, restitution: 0.04, friction: 0.9,
      dropHeight: 760, initVel: 4, lifeMs: 3400,
      mood: s.mood, squashVel: 20, splashRadius: 150, splashForce: 8,
      // WIDE-BODY CRUSH: widen the EXISTING splash loop instead of adding a
      // multi-squash pass — reactTo stays single-fire on the nearest part.
      splashMul: 1.6, squashMul: 1.2,
      shake: 26, shakeMs: 680, hitStopTier: 'explosion',
      // SFX: metal crunch on landing (impactSfx), then the whump comes from
      // explode()'s sound:'bomb' below.
      sfxName: 'thud', impactSfx: 'carCrunch',
      particles: (_c, bx, by) => {
        P.burst(bx, by, 22, { type: 'smoke', color: '#2a2a2e', size: 18, life: 850, speedRange: 0.6, gravity: -0.0004 });
        P.burst(bx, by, 14, { type: 'spark', color: '#cfd6dc', size: 4, life: 420, speedRange: 1.3, gravity: 0.0006 });
        // Shattered windshield glass.
        P.burst(bx, by,  8, { type: 'spark', color: '#bfe3e8', size: 3, life: 320, speedRange: 1.6 });
      },
      // FUEL FIRE: the gas tank ruptures on impact. Existing explode signature
      // — { igniteMs, fireDuration } — at the wreck's resting position.
      onImpact: (b, _world, ctx2) => {
        explode(ctx2, b.position.x, b.position.y, {
          radius:       170,
          baseVel:      11,
          upBias:       4,
          moodDelta:    -Math.round(s.mood * 0.5),
          stunMs:       1200,
          igniteMs:     s.igniteMs,
          fireDuration: s.fireDuration,
          shake:        22,
          sound:        'bomb',
        });
      },
    });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Side-on sedan silhouette: body slab + cabin notch + two wheels.
    ctx.fillStyle = '#3a4654';
    ctx.fillRect(-20, -6, 40, 12);
    ctx.fillStyle = '#4a5867';
    ctx.fillRect(-11, -13, 20, 8);
    // Windows.
    ctx.fillStyle = '#1c2730';
    ctx.fillRect(-9, -12, 8, 6);
    ctx.fillRect(1, -12, 8, 6);
    // Wheels.
    ctx.fillStyle = '#141418';
    ctx.beginPath(); ctx.arc(-12, 7, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( 12, 7, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 18, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
