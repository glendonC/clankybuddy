import * as P from '../../particles.js';
import { spikeFear } from '../../mood.js';
import { showAnvilDrop } from '../../ui/overlays.js';
import { startCooldown } from '../../ui/hotbar.js';
import { spawnImpactDust } from '../../render/stage.js';
import { getStats } from '../_stats.js';
import { spawnDrop } from '../_shared.js';

export const defaultStats = {
  density: 0.02,    // body density, paired with cataclysm.js Heavier-anvil upgrade
  mood:    30,      // mood damage on impact (positive; subtracted)
};

export default {
  id: 'anvil',
  defaultStats,
  apply(ctx) {
    const s = getStats('anvil');
    const { x, y, mood } = ctx;
    startCooldown('anvil');
    showAnvilDrop(x, y);
    // Telegraphed threat, spike fear so the buddy cowers while it falls.
    spikeFear(mood, 70);
    spawnDrop(ctx, {
      partType: 'anvil', verb: 'anvil',
      shape: 'rect', w: 96, h: 56,
      density: s.density, restitution: 0.05, friction: 0.9,
      dropHeight: 700, initVel: 4, lifeMs: 3000,
      mood: s.mood, squashVel: 22, splashRadius: 140, splashForce: 8,
      shake: 28, shakeMs: 700, hitStopTier: 'mega',
      sfxName: 'anvil',
      particles: (_ctx2, bx, by) => {
        // Crater: dense smoke ring + dust kicked up from the floor.
        P.burst(bx, by, 24, { type: 'smoke', color: '#222',    size: 20, life: 900, speedRange: 0.7, gravity: -0.0004 });
        P.burst(bx, by, 14, { type: 'spark', color: '#ffae3c', size: 3,  life: 350, speedRange: 1.0 });
        P.burst(bx, by, 10, { type: 'spark', color: '#fff',    size: 4,  life: 220, speedRange: 1.6 });
        spawnImpactDust(bx, by, 12);
      },
      // Metallic CLANG: shatter SFX has the right high-freq sizzle layered on
      // top of the bomb thud in sfx.anvil. Distinguishes it from an explosion.
      impactSfx: 'shatter',
    });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(-14, -7, 28, 14);
    ctx.fillStyle = '#222';
    ctx.fillRect(-12, -10, 24, 3);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 18, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
