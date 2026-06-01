// Lightning storm, ordnance. A walking SEQUENCE of sky bolts fired on the
// shared scheduler (S4) — the second non-barrage consumer of state/scheduler.js
// (creeping barrage walks a spatial line of shells; the storm walks a TEMPORAL
// sequence of bolts across the buddy's limbs).
//
// Built on the strikeAt STRIKE CORE extracted from lightning.js. Each scheduled
// step re-resolves a LIVE part from the FRESH ctx (the scheduler hands a fresh
// abilityCtx per fire — NO cast-time part is captured) and calls strikeAt with
// localOnly:true. By construction a storm bolt CANNOT revive, combust/shatter
// the whole body, or trigger the OVERCLOCK heal — that logic lives only in
// lightning.apply(), which the storm never calls.
//
// SCHEDULER CONTRACT (mirrors creeping-barrage): the telegraph fires
// synchronously at cast (epoch-independent); the per-step closure captures
// NOTHING (the storm targets live PARTS, not cast-time geometry) and reads the
// current ragdoll off the fresh stepCtx. The scheduler owns the epoch (cancels
// stale tasks on a character switch before they fire). strikeAt spawns only
// particles (no physics bodies), so no _epoch stamp / transient cleanup needed.

import { sfx } from '../../audio/sfx.js';
import { spikeFear } from '../../mood.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { scheduleSequence } from '../../state/scheduler.js';
import { strikeAt } from './lightning.js';

export const defaultStats = {
  count:        5,    // bolts in the volley (Supercell raises to 8)
  intervalMs:   360,  // gap between bolts; > one bolt's feel-decay so the sim
                      //   never locks/strobes (Rolling thunder tightens to 220)
  startDelayMs: 600,  // telegraph window — rumble + cower before the first bolt
};

export default {
  id: 'lightning_storm',
  defaultStats,
  apply(ctx) {
    const s = getStats('lightning_storm');
    const { ragdoll, mood } = ctx;
    if (!ragdoll?.parts?.length) return;
    startCooldown('lightning_storm');
    // Telegraph: synchronous, epoch-independent (matches creeping-barrage's
    // whistle + cower). A rolling rumble announces the incoming volley.
    sfx.thunder();
    spikeFear(mood, 70);

    // Walk a sequence of bolts on the shared scheduler. Each step re-resolves a
    // live part from the FRESH stepCtx (round-robin over the current parts so
    // the storm rakes across the whole body) and fires the LOCAL strike core.
    scheduleSequence((stepCtx, i) => {
      const parts = stepCtx.ragdoll?.parts;
      if (!parts?.length) return;
      const part = parts[i % parts.length];
      strikeAt(stepCtx, part, { localOnly: true });
    }, { count: s.count, intervalMs: s.intervalMs, startDelayMs: s.startDelayMs });
  },
  drawCursor(rctx, { x, y }) {
    const s = getStats('lightning_storm');
    rctx.save();
    rctx.translate(x, y);
    // A dark storm cloud (wider than the single-bolt lightning cursor's).
    rctx.fillStyle = '#3a4452';
    for (const o of [{ x: -12, y: -2, r: 8 }, { x: -2, y: -6, r: 9 }, { x: 9, y: -3, r: 8 }, { x: 16, y: 0, r: 6 }]) {
      rctx.beginPath(); rctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); rctx.fill();
    }
    // A row of bolt pips falling from the cloud — count hints the volley size.
    rctx.globalCompositeOperation = 'lighter';
    rctx.fillStyle = '#9be7ff';
    const n = Math.min(4, s.count || 1);
    for (let i = 0; i < n; i++) {
      const bx = -10 + i * (20 / Math.max(1, n - 1));
      rctx.save();
      rctx.translate(bx, 6);
      rctx.beginPath();
      rctx.moveTo(-2, 0); rctx.lineTo(2, 0); rctx.lineTo(-1, 6); rctx.lineTo(3, 6); rctx.lineTo(-3, 14); rctx.lineTo(0, 7); rctx.lineTo(-4, 7);
      rctx.closePath();
      rctx.fill();
      rctx.restore();
    }
    rctx.restore();
  },
};
