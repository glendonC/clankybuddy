// Brick, siege root. Click-drop a plain mass that pancakes the nearest part.
// The cheapest, spammiest drop, the entry point for the throwables/droppables
// family (bowling ball / piano branch off it). Uses the shared spawnDrop
// factory (see abilities/_shared.js).

import { getStats } from '../_stats.js';
import { spawnDrop } from '../_shared.js';

export const defaultStats = {
  density: 0.012,
  mood:    12,
};

export default {
  id: 'brick',
  defaultStats,
  apply(ctx) {
    const s = getStats('brick');
    spawnDrop(ctx, {
      partType: 'brick', verb: 'brick',
      shape: 'rect', w: 34, h: 20,
      density: s.density, restitution: 0.1, friction: 0.9,
      dropHeight: 600, initVel: 5, lifeMs: 2400,
      mood: s.mood, squashVel: 14, splashRadius: 80, splashForce: 4,
      shake: 10, shakeMs: 320, hitStopTier: 'heavy',
      sfxName: 'thud',
    });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Red clay brick with mortar grooves.
    ctx.fillStyle = '#9c4a32';
    ctx.fillRect(-13, -8, 26, 16);
    ctx.fillStyle = '#7a3826';
    ctx.fillRect(-13, -1, 26, 1.5);
    ctx.fillRect(-1, -8, 1.5, 7);
    ctx.fillRect(-5, 0.5, 1.5, 7);
    ctx.fillRect(6, 0.5, 1.5, 7);
    ctx.restore();
    // Landing reticle below the cursor.
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 16, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
