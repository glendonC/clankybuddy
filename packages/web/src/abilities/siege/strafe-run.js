// Strafe run, siege. Drag to aim a low pass; on release a swept directional
// force band (modes/force-strafe.js) rakes a downrange shove along the drawn
// line, dragging every limb it crosses — works mid-air, at any angle. The
// replacement for the cut bomb-run airstrike (which decomposed into rocket +
// creeping_barrage); this verb is the swept directional FIELD, distinct from the
// radial force-Modes and the floor-level body rollers.
//
// kind:'drag' → exports applyRelease (fires on mouseup), reads the press point
// (x,y) as the axis origin + dragVec as the axis direction/length. The force
// loop, clamps, and no-rocket firewall all live in the Mode; this file only
// captures the axis and latches the pass.

import { spikeFear } from '../../mood.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { startStrafe } from '../../modes/force-strafe.js';

const num = (v, d) => (Number.isFinite(v) ? v : d);
// Too-short drag reject (trebuchet uses 24; a hair more here so a stray click
// can't fire a zero-length pass). Rejected BEFORE any normalize, so no /0.
const MIN_DRAG = 28;

export const defaultStats = {
  shove: 0.010,   // force-per-mass at the band. HARD-clamped to MAX_SHOVE (0.012) in the Mode AND at startStrafe intake.
  mood:  14,      // one-shot morale hit when the band first sweeps a part (siege-class: steamroller 24, meteor 14).
};

export default {
  id: 'strafe_run',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('strafe_run');               // read INSIDE applyRelease (cycle-safe live binding)
    const { x, y, dragVec = { x: 0, y: 0 }, ragdoll, popBubble, mood } = ctx;  // x,y = press ORIGIN; dragVec = release - press
    if (!ragdoll?.parts?.length) return;
    const L = Math.hypot(dragVec.x, dragVec.y);
    if (L < MIN_DRAG) { popBubble?.(ragdoll.head, 'draw a longer pass!'); return; }
    const ux = dragVec.x / L, uy = dragVec.y / L;    // unit axis (safe: L >= MIN_DRAG)
    startStrafe({
      ox: x, oy: y, ux, uy, len: L,
      shove:     num(s.shove, 0.010),                // clamped to MAX_SHOVE inside startStrafe
      moodDelta: num(s.mood, 14),
      epoch:     ctx._epoch,                         // captured for the Mode's epoch self-cancel
    });
    // Cast-time fear jolt (the flood model — spikeFear at cast, NOT in the force
    // loop). The actual mood/happiness hit lands per-pass when the band reaches a
    // part (the Mode's one-shot reactTo). Trebuchet does neither of these — this
    // is the flood/meteor pattern (a cast-time fear spike + a self-managed cd).
    spikeFear(mood, 40);
    sfx.strafeRun?.();
    startCooldown('strafe_run');                     // self-managed cd (mouse.js does NOT auto-start it)
  },
  drawCursor(c, { x, y, isDown, dragStart }) {
    // Idle glyph: a small chevron "plane" so the tool reads as a strafing run
    // before the drag begins.
    if (!isDown || !dragStart) {
      c.save();
      c.strokeStyle = 'rgba(200,210,225,0.7)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - 7, y + 4); c.lineTo(x, y - 5); c.lineTo(x + 7, y + 4);
      c.stroke();
      // two tracer ticks ahead
      c.strokeStyle = 'rgba(255,235,180,0.6)';
      c.beginPath(); c.moveTo(x - 3, y - 8); c.lineTo(x - 3, y - 13);
      c.moveTo(x + 3, y - 8); c.lineTo(x + 3, y - 13); c.stroke();
      c.restore();
      return;
    }
    // Dragging: preview the swept band along the drawn axis.
    const dx = x - dragStart.x, dy = y - dragStart.y;
    const L = Math.hypot(dx, dy);
    c.save();
    if (L < MIN_DRAG) {
      // Too-short: a dimmed stub so the reject is legible (mirrors trebuchet's
      // early return under its drag gate).
      c.strokeStyle = 'rgba(200,120,120,0.6)';
      c.setLineDash([3, 4]);
      c.beginPath(); c.moveTo(dragStart.x, dragStart.y); c.lineTo(x, y); c.stroke();
      c.setLineDash([]);
      c.restore();
      return;
    }
    const ux = dx / L, uy = dy / L;
    const px = -uy, py = ux;            // perpendicular basis
    const HALF_REACH = 70;              // visual band half-width (matches the Mode's HALF_W feel)
    // Axis with an arrowhead at the downrange (release) end.
    c.strokeStyle = 'rgba(210,220,235,0.85)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(dragStart.x, dragStart.y); c.lineTo(x, y); c.stroke();
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - ux * 12 + px * 6, y - uy * 12 + py * 6);
    c.moveTo(x, y);
    c.lineTo(x - ux * 12 - px * 6, y - uy * 12 - py * 6);
    c.stroke();
    // Band-width preview: two faint parallel lines offset ±HALF_REACH along the stroke.
    c.strokeStyle = 'rgba(150,170,200,0.4)';
    c.setLineDash([5, 5]);
    for (const o of [HALF_REACH, -HALF_REACH]) {
      c.beginPath();
      c.moveTo(dragStart.x + px * o, dragStart.y + py * o);
      c.lineTo(x + px * o, y + py * o);
      c.stroke();
    }
    c.setLineDash([]);
    c.restore();
  },
};
