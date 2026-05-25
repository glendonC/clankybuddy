// SELF-LOATHING, applied by `gaslight`. Hijacks the buddy's speech bubble
// system. Every `intervalMs` (default 1500), pulls a random line from
// `rec.data.pool` and pops it as a bubble while draining mood.
// Phase 7 of the 2026-05-02 ability redesign, see docs/abilities.md
// kit-redirect notes. Anchor of the visceral injection lane.
//
// Layered 'over' so the dark cloud reads above the body.
// Stored on head only (buddy-wide debuff, see registry.js comment).
// Tier 'permanent' (capstone): durationMs='persistent', cleared on the
// next kinetic/ordnance/cataclysm hit via _shared.js bigImpact hook.

import { applyMoodDelta } from '../mood.js';
import { popBubble } from '../ui/speech-bubbles.js';

export default {
  id: 'self_loathing',
  defaultDuration: 12000,
  layer: 'over',

  onApply(part, rec) {
    rec.data ??= {};
    rec.data.lastTickAt = rec.data.lastTickAt ?? rec.startedAt;
    // Fire one bubble immediately so the cast lands visibly.
    const pool = rec.data.pool;
    if (Array.isArray(pool) && pool.length) {
      const line = pool[(Math.random() * pool.length) | 0];
      popBubble(part, line);
    }
  },

  onTick(part, rec, ctx, dtMs, now) {
    const interval = rec.data?.intervalMs ?? 1500;
    if (now - (rec.data?.lastTickAt ?? 0) < interval) return;
    rec.data.lastTickAt = now;
    const pool = rec.data?.pool;
    if (Array.isArray(pool) && pool.length) {
      const line = pool[(Math.random() * pool.length) | 0];
      popBubble(part, line);
    }
    const drain = (rec.data?.moodPerTick ?? -3) * (rec.data?.moodTickMul ?? 1);
    applyMoodDelta(ctx.mood, drain);
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalCompositeOperation = 'multiply';
    for (const { part } of records) {
      const cx = part.position.x;
      const cy = part.position.y - 22;
      // Dark thought-cloud above head.
      const grad = rctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
      grad.addColorStop(0,   'rgba(40, 30, 60, 0.55)');
      grad.addColorStop(0.6, 'rgba(40, 30, 60, 0.25)');
      grad.addColorStop(1,   'rgba(40, 30, 60, 0)');
      rctx.fillStyle = grad;
      rctx.beginPath();
      rctx.arc(cx, cy, 22, 0, Math.PI * 2);
      rctx.fill();
      // Three small downward chevrons inside the cloud.
      rctx.globalCompositeOperation = 'source-over';
      rctx.strokeStyle = 'rgba(140, 120, 180, 0.6)';
      rctx.lineWidth = 1.2;
      const phase = now * 0.002;
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 7;
        const oy = Math.sin(phase + i) * 2;
        rctx.beginPath();
        rctx.moveTo(cx + ox - 3, cy + oy - 3);
        rctx.lineTo(cx + ox,     cy + oy + 1);
        rctx.lineTo(cx + ox + 3, cy + oy - 3);
        rctx.stroke();
      }
      rctx.globalCompositeOperation = 'multiply';
    }
    rctx.restore();
  },
};
