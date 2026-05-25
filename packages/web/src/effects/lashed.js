// LASHED, applied by `whip` (primary + chain echoes). DoT mood drain.
// Per-part status, each lashed mark drains independently so chain hits
// stack. Phase 7 visceral-redirect addition.
//
// Visual: thin red welt arc on the part. Layer 'over' so the welt reads
// above the body silhouette.

import { applyMoodDelta } from '../mood.js';

const TICK_MS = 250;       // throttle the per-frame drain so ticks read

export default {
  id: 'lashed',
  defaultDuration: 4000,
  layer: 'over',

  onApply(part, rec) {
    rec._lastTickAt = rec.startedAt;
  },

  onTick(part, rec, ctx, dtMs, now) {
    if (now - (rec._lastTickAt ?? 0) < TICK_MS) return;
    rec._lastTickAt = now;
    const ratePerSec = rec.data?.ratePerSec ?? 1.5;
    applyMoodDelta(ctx.mood, -ratePerSec * (TICK_MS / 1000));
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.strokeStyle = 'rgba(255, 70, 70, 0.6)';
    rctx.lineWidth = 1.4;
    for (const { part, rec } of records) {
      // Welt arc, small curve following the part's angle.
      const cx = part.position.x;
      const cy = part.position.y;
      const phase = (rec._weltSeed ??= Math.random() * Math.PI * 2);
      rctx.beginPath();
      const a0 = phase;
      const a1 = phase + Math.PI * 0.6;
      const r  = 8;
      rctx.arc(cx, cy, r, a0, a1);
      rctx.stroke();
    }
    rctx.restore();
  },
};
