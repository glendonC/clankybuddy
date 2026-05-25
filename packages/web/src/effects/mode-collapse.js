// POISON / MODE_COLLAPSE, applied to all six parts when the buddy hits the
// poison zone (`mode_collapse` ability) for the third time. The internal
// effect id stays `mode_collapse` so saved telemetry, node ids, and ability
// imports don't churn; the player-facing label is "poison" / "POISONED".
// Mechanic surface: deepens damageMul ×1.5 (registry.js damageMul check).
// Visual: sickly green haze with slow drip particles below each part.
// Phase 4 of the 2026-05-02 ability redesign + Phase 7 visual rebrand.

import * as P from '../particles.js';
import { partRadius } from '../abilities/_shared.js';

const DRIP_TICK_MS = 320;

export default {
  id: 'mode_collapse',
  defaultDuration: 12000,
  layer: 'under',

  onTick(part, rec, ctx, dtMs, now) {
    if (now - (rec._lastDripAt ?? 0) < DRIP_TICK_MS) return;
    rec._lastDripAt = now;
    if (Math.random() < 0.55) {
      P.spawn({
        x: part.position.x + (Math.random() - 0.5) * 12,
        y: part.position.y + 4,
        vx: (Math.random() - 0.5) * 0.04,
        vy: 0.04 + Math.random() * 0.08,
        type: 'spark',
        color: '#7fcf6b',
        size: 2.5 + Math.random() * 1.5,
        life: 700 + Math.random() * 300,
        gravity: 0.0010,
        drag: 0.99,
      });
    }
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    for (const rec of records) {
      const part = rec.part;
      const r = partRadius(part) + 6;
      const cx = part.position.x;
      const cy = part.position.y;
      // Sickly green pulsing haze, single soft ring with phase wobble.
      const phase = (now * 0.003 + part.id) % (Math.PI * 2);
      const alpha = 0.30 + 0.15 * Math.sin(phase);
      rctx.lineWidth = 2;
      rctx.strokeStyle = `rgba(127, 207, 107, ${alpha.toFixed(3)})`;
      rctx.beginPath();
      rctx.arc(cx, cy, r, 0, Math.PI * 2);
      rctx.stroke();
      // Inner sickly-green fill, very faint, reads as "the part is sick."
      rctx.fillStyle = `rgba(120, 180, 90, ${(alpha * 0.35).toFixed(3)})`;
      rctx.beginPath();
      rctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      rctx.fill();
    }
    rctx.restore();
  },
};
