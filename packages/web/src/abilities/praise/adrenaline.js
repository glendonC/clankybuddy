// Adrenaline shot — provision (positive), Recovery line (parents first_aid).
// kind: 'click'. Grounded pain-resistance: stamps the DEFENSIVE 'wired' status
// (damageMul x0.5 + raised jitter/activity overlay, ~3s) on ALL ragdoll parts,
// buddy-wide, so the resistance fires no matter which part takes the hit
// (mirrors lightning.js stamping electrified on every part). NO direct damage
// — wired is a toughness window that keeps the buddy from breaking so beatdowns
// run longer. Per user-approved doc change 2026-05-31 (supersedes old "no
// damage" framing): wired multiplies incoming mood-damage DOWN.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { applyStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';

export const defaultStats = {
  wiredMs:   3000,  // toughness window
  moodNudge: 4,     // tiny bump so the shot reads as a positive cast
};

export default {
  id: 'adrenaline',
  defaultStats,
  apply(ctx) {
    const s = getStats('adrenaline');
    const { ragdoll, x, y, screenShake } = ctx;
    const epoch = ctx._epoch;

    // Buddy-wide DEFENSIVE toughness: every part carries wired, so per-part
    // hasStatus(reg, part, 'wired') in damageMul fires on any struck part.
    for (const p of ragdoll.parts) {
      applyStatus(ctx.status, p, 'wired', { duration: s.wiredMs, source: 'adrenaline' });
    }

    // Tiny positive nudge so it still reads as a cast (NOT a heal — no big mood).
    ctx.reactTo?.({ source: 'adrenaline', part: ragdoll.head, moodDelta: s.moodNudge, speakMs: 800 });

    // Injector hiss + heartbeat thump (reuse existing voices: hiss-ish noise + low thumps).
    sfx.flame?.();                                   // sharp hiss of the injector
    sfx.heal?.();                                    // bright "kick" rising tone
    setTimeout(() => {                               // delayed crackle = adrenaline surge
      if (!ctx._epochValid?.(epoch)) return;
      sfx.zap?.();
    }, 90);

    // Amped red-orange burst at the injection point.
    P.burst(x, y, 14, { type: 'spark', color: '#ff8a3c', size: 4, life: 420, speedRange: 1.0, gravity: -0.0003 });
    P.burst(x, y, 8,  { type: 'spark', color: '#ffd266', size: 3, life: 300, speedRange: 1.4 });
    screenShake?.(5, 120);
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Syringe barrel.
    ctx.fillStyle = '#eef2f0';
    ctx.fillRect(-3, -10, 6, 16);
    // Amber adrenaline fill.
    ctx.fillStyle = '#ff8a3c';
    ctx.fillRect(-3, -2, 6, 8);
    // Plunger.
    ctx.fillStyle = '#cdd6d2';
    ctx.fillRect(-5, -13, 10, 3);
    ctx.fillRect(-1, -16, 2, 4);
    // Needle.
    ctx.strokeStyle = '#9aa3a0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, 12);
    ctx.stroke();
    ctx.restore();
  },
};
