// Shepherd's crook (kinetic). Hook the nearest limb on mousedown and drag it
// around the stage with the cursor while held; release (mouseup / tool-switch)
// to drop it. The latch + steering live in the shared cursor-follow Mode
// (modes/cursor-follow.js); this ability only decides WHAT to latch and draws
// the hook + tether.
//
// kind:'hold' (NOT 'drag'): a drag tool latches on RELEASE with nothing left to
// steer and no clean OFF path. As a hold tool, apply() fires on mousedown (and
// re-fires throttled on mousemove — idempotent via isLatched()), and the TOOLS
// row's forceMode:'cursor.follow' tag wires the generic OFF seam (input/mouse.js
// endPress + ui/hotbar.js setActiveTool both setEnabled('cursor.follow', false)
// → the Mode's teardown() → releaseLatch()). No new release seam needed.
//
// Drags ONE limb under normal gravity — no whole-body suspension, so it needs
// no COUNTER_GRAVITY and no isStanding gate (locked user decision).

import { nearestPart } from '../_shared.js';
import { getStats } from '../_stats.js';
import { sfx } from '../../audio/sfx.js';
import { latchPart, isLatched, getLatchedPart } from '../../modes/cursor-follow.js';

export const defaultStats = {
  reach:    140,   // how near the cursor must start to catch a limb
  maxReach: 360,   // the latch slips once the limb is dragged past this stretch
};

export default {
  id: 'shepherds_crook',
  defaultStats,
  apply(ctx) {
    // Idempotent re-fire: once a limb is on the hook, holding + moving just
    // steers it (the Mode does that) — don't re-latch a different part.
    if (isLatched()) return;
    const s = getStats('shepherds_crook');
    const { ragdoll, x, y } = ctx;
    const part = nearestPart(ragdoll, x, y);
    if (!part) return;
    // Out of pole reach: the hook didn't catch anything.
    if (Math.hypot(part.position.x - x, part.position.y - y) > s.reach) return;
    latchPart(part, { epoch: ctx._epoch, maxReach: s.maxReach });
    sfx.crookLatch?.();
  },
  drawCursor(ctx, { x, y }) {
    // Shepherd's-crook hook: a vertical shaft with a J-curve at the bottom.
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#b9935a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, 8);
    ctx.arc(-5, 8, 5, 0, Math.PI, false);   // the hook curl
    ctx.stroke();
    // Brass tip highlight.
    ctx.strokeStyle = '#e8c98a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -6);
    ctx.stroke();
    ctx.restore();

    // While a limb is hooked, draw a dashed tether from the cursor to the
    // actual latched part (not the current nearest part — the cursor may have
    // pulled it away from anything else).
    const hooked = getLatchedPart();
    if (hooked) {
      ctx.save();
      ctx.strokeStyle = 'rgba(185, 147, 90, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(hooked.position.x, hooked.position.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  },
};
