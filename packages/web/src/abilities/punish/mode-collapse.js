// Mode Collapse, Corruption group. Drag cost 260. Drops an invisible
// 80px sensor zone at the drag-release point; if the buddy passes
// through it three times (via panic-move drift, knockback, or live-mode
// movement), applies MODE_COLLAPSE to all six parts for 12s. The trap
// is patient, it doesn't time out for 30s, so you can plant it and
// come back. Phase 4 of the 2026-05-02 ability redesign.
//
// Two-branch tree (corruption.js, 2026-05-24):
//   A: Synthetic-Loop, applications stack intensity instead of refreshing.
//      Tier-3 Total-Collapse: at 3 stacks the buddy's panic move
//      auto-fires AND fails (consumer flag panicFailAt3Stacks; the panic
//      ticker reads it, PR5 wires the consumer, the flag ships now).
//   B: Adversarial-Examples, single contact triggers (passes = 1).
//      Tier-3 Cold-Inference: extra damage mul on POISONED parts
//      (consumer flag extraDamageMul; PR5 will read it from registry).

import { spawnModeCollapseZone } from '../../transients/mode-collapse-zone.js';
import { sfx } from '../../audio/sfx.js';
import { popBubble } from '../../ui/speech-bubbles.js';
import { getStats } from '../_stats.js';

export const defaultStats = {
  passesRequired:       3,      // Adversarial-Examples branch drops to 1
  stacking:             false,  // Synthetic-Loop: increment intensity instead of refresh
  panicFailAt3Stacks:   false,  // Total-Collapse tier-3 flag, PR5 consumer
  extraDamageMul:       1.0,    // Cold-Inference tier-3, PR5 consumer (registry read)
};

export default {
  id: 'mode_collapse',
  defaultStats,
  // Drag-release: drops the zone where the player let go.
  applyRelease(ctx) {
    const { world, transientBodies, ragdoll } = ctx;
    const s = getStats('mode_collapse');
    // Drag mouseup x/y comes through ctx as standard fields.
    const x = ctx.x ?? ragdoll?.body?.position.x ?? 400;
    const y = ctx.y ?? ragdoll?.body?.position.y ?? 400;
    spawnModeCollapseZone(world, transientBodies, x, y, {
      passesRequired: s.passesRequired,
      stacking:       s.stacking,
    });
    if (ragdoll) popBubble(ragdoll.head, 'data poisoned.');
    sfx.beep?.();
  },
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.strokeStyle = '#a78bfa';
    rctx.lineWidth = 1.4;
    // dotted target, three concentric arc segments
    rctx.setLineDash([3, 3]);
    rctx.beginPath(); rctx.arc(0, 0, 5, 0, Math.PI * 2); rctx.stroke();
    rctx.beginPath(); rctx.arc(0, 0, 9, 0, Math.PI * 2); rctx.stroke();
    rctx.setLineDash([]);
    rctx.beginPath();
    rctx.moveTo(-2, 0); rctx.lineTo(2, 0);
    rctx.moveTo(0, -2); rctx.lineTo(0, 2);
    rctx.stroke();
    rctx.restore();
  },
};
