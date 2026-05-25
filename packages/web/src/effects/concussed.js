// CONCUSSED status effect, applied by impact-tier weapons (currently hammer)
// to grant the *next* mood-damage hit a 1.5× multiplier, then self-consume.
// Visual: 3-5 yellow stars orbiting the part. Animation phase derived from
// (now * 0.005 + part.id) so stars move smoothly without per-frame state.

import { showCombo } from '../ui/overlays.js';
import { stagger } from './_locomotion.js';
import { react } from '../reactions/index.js';
import { partRadius } from '../abilities/_shared.js';

// Throttle for the combo overlay so concussing all 6 parts in one frame
// (e.g. a future AOE concussor) doesn't pile up six overlays.
let _lastConcussedAt = 0;

export default {
  id: 'concussed',
  defaultDuration: 1500,
  layer: 'over',

  onApply(part, rec, reg) {
    const now = performance.now();
    if (now - _lastConcussedAt > 600) {
      _lastConcussedAt = now;
      showCombo?.('CONCUSSED!', '#ffe27a');
    }
  },

  onTick(part, rec, ctx, dtMs, now) {
    if (!rec._spoken) {
      rec._spoken = true;
      react({ event: 'concussed', mood: ctx.mood, part: ctx.ragdoll.head });
    }
    // Wobble torso + head, drunk/dazed read. Throttled so we don't churn
    // velocity every step (would dampen real motion).
    if (Math.random() < 0.18) stagger(part);
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalCompositeOperation = 'lighter';
    for (const { part } of records) {
      const r = partRadius(part) + 12;
      const phase = now * 0.005 + part.id;
      // 4 stars equally spaced, rotating around the part center
      for (let i = 0; i < 4; i++) {
        const a = phase + (i / 4) * Math.PI * 2;
        const sx = part.position.x + Math.cos(a) * r;
        const sy = part.position.y + Math.sin(a) * r * 0.6 - 6;  // squashed orbit reads as overhead
        const size = 3 + Math.sin(phase * 2 + i) * 0.6;
        rctx.fillStyle = `rgba(255, 226, 122, ${0.55 + Math.sin(phase * 1.3 + i) * 0.25})`;
        // 5-point star
        rctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const r2 = (k % 2 === 0) ? size : size * 0.45;
          const aa = (k / 10) * Math.PI * 2 - Math.PI / 2;
          const px = sx + Math.cos(aa) * r2;
          const py = sy + Math.sin(aa) * r2;
          if (k === 0) rctx.moveTo(px, py); else rctx.lineTo(px, py);
        }
        rctx.closePath();
        rctx.fill();
      }
    }
    rctx.restore();
  },
};
