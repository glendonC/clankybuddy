// Bowling ball, siege branch (off brick). A dense sphere that lands and rolls,
// scattering parts as it tumbles through. High restitution + a roll kick on
// impact give it the bounce-and-roll the brick doesn't have.

import { getStats } from '../_stats.js';
import { spawnDrop } from '../_shared.js';
import * as P from '../../particles.js';

export const defaultStats = {
  density: 0.02,
  mood:    16,
};

export default {
  id: 'bowling_ball',
  defaultStats,
  apply(ctx) {
    const s = getStats('bowling_ball');
    spawnDrop(ctx, {
      partType: 'bowling_ball', verb: 'bowling_ball',
      shape: 'circle', radius: 16,
      density: s.density, restitution: 0.5, friction: 0.4,
      dropHeight: 620, initVel: 5, lifeMs: 4000,
      mood: s.mood, squashVel: 16, splashRadius: 110, splashForce: 6,
      roll: 0.4, hitStopTier: 'heavy',
      shake: 12, shakeMs: 380,
      sfxName: 'thud',
      particles: (_c, bx, by) => {
        P.burst(bx, by, 10, { type: 'smoke', color: '#3a3a3a', size: 12, life: 600, speedRange: 0.5, gravity: -0.0003 });
        P.burst(bx, by,  6, { type: 'spark', color: '#fff', size: 3, life: 220, speedRange: 1.0 });
      },
    });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#16161a';
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    // Three finger holes.
    ctx.fillStyle = '#3a3a42';
    ctx.beginPath(); ctx.arc(-3, -2, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( 1, -3, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-1,  2, 1.4, 0, Math.PI * 2); ctx.fill();
    // Specular glint.
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(-4, -5, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 16, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
