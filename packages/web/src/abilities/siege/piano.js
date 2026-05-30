// Upright piano, siege branch (off brick). A wide, heavy body that lands
// across multiple parts at once — the wide footprint + big splash radius is
// the verb (catches limbs the narrow brick misses), plus a dissonant crash.

import { getStats } from '../_stats.js';
import { spawnDrop } from '../_shared.js';
import * as P from '../../particles.js';

export const defaultStats = {
  density: 0.016,
  mood:    26,
};

export default {
  id: 'piano',
  defaultStats,
  apply(ctx) {
    const s = getStats('piano');
    spawnDrop(ctx, {
      partType: 'piano', verb: 'piano',
      shape: 'rect', w: 150, h: 88,
      density: s.density, restitution: 0.05, friction: 0.9,
      dropHeight: 720, initVel: 4, lifeMs: 3200,
      mood: s.mood, squashVel: 18, splashRadius: 160, splashForce: 7,
      shake: 22, shakeMs: 600, hitStopTier: 'explosion',
      sfxName: 'piano',
      particles: (_c, bx, by) => {
        P.burst(bx, by, 18, { type: 'smoke', color: '#2a2118', size: 18, life: 800, speedRange: 0.6, gravity: -0.0004 });
        // Splintered wood + ivory key shards.
        P.burst(bx, by, 12, { type: 'spark', color: '#d9c7a3', size: 4, life: 500, speedRange: 1.3, gravity: 0.0006 });
        P.burst(bx, by,  6, { type: 'spark', color: '#fff', size: 3, life: 260, speedRange: 1.6 });
      },
    });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Upright piano silhouette: dark cabinet + ivory keybed.
    ctx.fillStyle = '#241a12';
    ctx.fillRect(-15, -12, 30, 20);
    ctx.fillStyle = '#3a2c1e';
    ctx.fillRect(-15, -12, 30, 3);
    // Keys.
    ctx.fillStyle = '#efe7d2';
    ctx.fillRect(-13, 3, 26, 4);
    ctx.fillStyle = '#1a1a1a';
    for (let kx = -11; kx < 13; kx += 3.5) ctx.fillRect(kx, 3, 1.2, 2.4);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 18, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
