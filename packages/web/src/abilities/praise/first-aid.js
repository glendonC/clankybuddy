// First aid kit, provision (positive). Click to patch the buddy up: a mood
// bump plus a full clear of the damage-over-time statuses (BLEED, ON_FIRE)
// across every part. The grounded replacement for the cut gpu heal niche;
// root of the Recovery line (defibrillator / adrenaline follow in later phases).

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { removeStatus, hasStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';

export const defaultStats = {
  mood: 18,
};

export default {
  id: 'first_aid',
  defaultStats,
  apply(ctx) {
    const s = getStats('first_aid');
    const { ragdoll, status, x, y } = ctx;
    let cleared = 0;
    for (const p of ragdoll.parts) {
      if (hasStatus(status, p, 'bleed'))   { removeStatus(status, p, 'bleed', 'first-aid'); cleared++; }
      if (hasStatus(status, p, 'on_fire')) { removeStatus(status, p, 'on_fire', 'first-aid'); cleared++; }
    }
    ctx.reactTo?.({ source: 'first_aid', part: ragdoll.head, moodDelta: s.mood, speakMs: 800 });
    sfx.heal();
    // Green cross of relief sparks at the cursor + a ring of "+"-ish motes.
    P.burst(x, y, 10, { type: 'spark', color: '#5cf2a0', size: 4, life: 600, speedRange: 0.6, gravity: -0.0004 });
    if (cleared) P.burst(x, y, 8, { type: 'smoke', color: '#9be7c0', size: 8, life: 500, speedRange: 0.5, gravity: -0.0006 });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // White kit with a green cross.
    ctx.fillStyle = '#eef2f0';
    ctx.fillRect(-10, -8, 20, 16);
    ctx.fillStyle = '#cdd6d2';
    ctx.fillRect(-10, -8, 20, 2);
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(-2, -5, 4, 10);
    ctx.fillRect(-5, -2, 10, 4);
    ctx.restore();
  },
};
