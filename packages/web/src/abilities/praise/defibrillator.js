// Defibrillator — provision (positive), Recovery line (parents first_aid).
// kind: 'click'. The crash-cart paddles: if the buddy is BROKEN (or KO'd),
// it RECOVERS them — clears KO/stun and bumps mood up out of the BROKEN band,
// mirroring lightning.js's KO-revive — with a brief 'electrified' micro-jolt
// (the paddles' shock), spark particles, a zap, and 'wired' stamped on as the
// recovery kicker (a short toughness window so the revived buddy doesn't
// immediately drop again). If NOT broken, a smaller jolt + small mood nudge so
// it still reads as a cast. NO direct damage — this is a recovery tool.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { applyStatus } from '../../effects/registry.js';
import { moodState } from '../../mood.js';
import { getStats } from '../_stats.js';

export const defaultStats = {
  moodRecover: 35,   // +mood on recovery (mirrors lightning revive's +35)
  moodNudge:   6,    // small bump when not broken/KO'd
  joltMs:      250,  // electrified micro-jolt duration
  wiredMs:     2500, // recovery toughness kicker
  shake:       8,
};

export default {
  id: 'defibrillator',
  defaultStats,
  apply(ctx) {
    const s = getStats('defibrillator');
    const { ragdoll, mood, status, popBubble, screenShake } = ctx;
    const part = ragdoll.head;
    const now = performance.now();
    const ko = ragdoll.koUntil && now < ragdoll.koUntil;
    const broken = moodState(mood).name === 'BROKEN';

    // Charge whine then the zap (capacitor charge → discharge).
    sfx.zap?.();

    if (ko || broken) {
      // RECOVER: clear KO/stun (exactly like lightning.js revive) and bump
      // happiness up out of BROKEN. moodState is derived purely from
      // mood.happiness, so a positive moodDelta IS the bump out of BROKEN.
      ragdoll.koUntil = 0;     // clear KO gate (closed eyes / 😵 / no idle speech)
      ragdoll.stunUntil = 0;   // clear stun flop so stand pose resumes
      mood._lastReviveAt = now;
      // Brief micro-jolt on every part — the paddles' shock running through.
      for (const p of ragdoll.parts) {
        applyStatus(status, p, 'electrified', { duration: s.joltMs, source: 'defibrillator' });
      }
      // Recovery kicker: a short toughness window so the buddy doesn't drop
      // straight back into BROKEN. Stamped on all parts (same shape adrenaline uses).
      for (const p of ragdoll.parts) {
        applyStatus(status, p, 'wired', { duration: s.wiredMs, source: 'defibrillator' });
      }
      ctx.reactTo?.({ source: 'defibrillator', part, moodDelta: s.moodRecover, speakMs: 99999 });
      P.burst(part.position.x, part.position.y, 24, { type: 'star',  color: '#5cf2a0', size: 5, life: 800, speedRange: 1.4 });
      P.burst(part.position.x, part.position.y, 16, { type: 'spark', color: '#9be7ff', size: 3, life: 320, speedRange: 1.6 });
      popBubble?.(ragdoll.head, '*gasp*');
      screenShake?.(s.shake, 200);
    } else {
      // Not down — smaller jolt + tiny mood nudge so it still reads as a cast.
      for (const p of ragdoll.parts) {
        applyStatus(status, p, 'electrified', { duration: Math.round(s.joltMs * 0.6), source: 'defibrillator' });
      }
      ctx.reactTo?.({ source: 'defibrillator', part, moodDelta: s.moodNudge, speakMs: 800 });
      P.burst(part.position.x, part.position.y, 10, { type: 'spark', color: '#9be7ff', size: 3, life: 240, speedRange: 1.2 });
      screenShake?.(s.shake * 0.6, 140);
    }
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Two crash-cart paddles with dark contact pads.
    ctx.fillStyle = '#e8b23a';
    ctx.fillRect(-10, -7, 8, 14);
    ctx.fillRect(2, -7, 8, 14);
    ctx.fillStyle = '#222';
    ctx.fillRect(-10, -2, 8, 4);
    ctx.fillRect(2, -2, 8, 4);
    // Spark arcing between the paddles.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#9be7ff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-2, -3);
    ctx.lineTo(1, 1);
    ctx.lineTo(-1, 3);
    ctx.lineTo(2, 5);
    ctx.stroke();
    ctx.restore();
  },
};
