// ANTITRUST_SPLIT, applied by the Antitrust Filing mode event for 30s.
// Mechanic: buddy-wide ×2 damage multiplier (registry.js damageMul reads
// via buddyHas). Visual: an offset shadow copy of every part renders at
// 50% opacity, selling the "two of them now" joke without needing a real
// second ragdoll. Phase 7, see modes/events.js.
//
// Stored on head only (buddy-wide). Render iterates ragdoll.parts so the
// shadow copy covers the whole body even though only the head holds the record.

import { partRadius } from '../abilities/_shared.js';

const SHADOW_OFFSET_X = 30;
const SHADOW_ALPHA    = 0.45;

export default {
  id: 'antitrust_split',
  defaultDuration: 30000,
  layer: 'under',

  render(rctx, ragdoll, records, now) {
    if (!records.length || !ragdoll?.parts) return;
    rctx.save();
    rctx.globalAlpha = SHADOW_ALPHA;
    // Subtle pink shimmer for the distillation-clone read.
    rctx.fillStyle   = 'rgba(236, 72, 153, 0.55)';
    rctx.strokeStyle = 'rgba(236, 72, 153, 0.85)';
    rctx.lineWidth = 1.2;
    for (const p of ragdoll.parts) {
      const r = partRadius(p);
      // Slight bob so the shadow looks alive, not pasted.
      const bob = Math.sin((now * 0.003) + p.id) * 1.6;
      rctx.beginPath();
      rctx.arc(p.position.x + SHADOW_OFFSET_X, p.position.y + bob, r, 0, Math.PI * 2);
      rctx.fill();
      rctx.stroke();
    }
    rctx.restore();
  },
};
