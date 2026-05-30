// BLEED, applied by chainsaw / saw blade / bear trap. Persistent DoT
// that ticks mood down -1/s and drips red particles below the part. Phase
// 7 visceral redirect, the gore status that pairs with the kit's new
// physical-violence weapons.
//
// Cleared by:
//   - ice / freeze (cauterize-by-cold, see abilities/punish/freeze.js)
// Stack semantics: a second bleed application refreshes intensity but does
// not double-tick (rec.expiresAt resets in registry.applyStatus).
//
// Layer 'over' so the drip reads above the body silhouette like fire's flame.

import * as P from '../particles.js';
import { applyMoodDelta } from '../mood.js';
import { partRadius } from '../abilities/_shared.js';

const TICK_MS   = 250;          // 4 ticks per second; -0.25 mood per tick → -1/s
const PER_TICK  = 0.25;
const DRIP_PROB = 0.6;

export default {
  id: 'bleed',
  defaultDuration: 6000,
  layer: 'over',

  onApply(part, rec) {
    rec._lastTickAt = rec.startedAt;
    // Single splash on application, sells the cut.
    P.burst(part.position.x, part.position.y, 6, {
      type: 'spark', color: '#a8121a', size: 4, life: 380, speedRange: 0.9,
      gravity: 0.0008,
    });
  },

  onTick(part, rec, ctx, dtMs, now) {
    if (now - (rec._lastTickAt ?? 0) < TICK_MS) return;
    rec._lastTickAt = now;
    const intensity = rec.intensity ?? 1;
    applyMoodDelta(ctx.mood, -PER_TICK * intensity);
    if (Math.random() < DRIP_PROB) {
      P.spawn({
        x: part.position.x + (Math.random() - 0.5) * 14,
        y: part.position.y + 4,
        vx: (Math.random() - 0.5) * 0.05,
        vy: 0.05 + Math.random() * 0.1,
        type: 'spark',
        color: '#a8121a',
        size: 3 + Math.random() * 1.5,
        life: 600 + Math.random() * 300,
        gravity: 0.0012,
        drag: 0.99,
      });
    }
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.fillStyle = 'rgba(168, 18, 26, 0.55)';
    for (const { part } of records) {
      const r = partRadius(part) * 0.55;
      const phase = (part.id * 0.21 + now * 0.002) % 1;
      // small streak under the part, faintly pulsing with phase
      rctx.beginPath();
      rctx.ellipse(part.position.x, part.position.y + r * 0.4, r * 0.8, r * 0.35, 0, 0, Math.PI * 2);
      rctx.globalAlpha = 0.4 + 0.2 * Math.sin(phase * Math.PI * 2);
      rctx.fill();
    }
    rctx.restore();
  },
};
