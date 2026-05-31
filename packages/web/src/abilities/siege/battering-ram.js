// Battering ram, siege-engine swing line. An iron-shod oak log swung along the
// drag heading. kind: 'hold+drag' — the cursor's movement delta (dx, dy) is the
// swing heading. Each cast gathers the parts lying along the ram's line then
// lands ONE authoritative strong directional shove per part via a FRESH
// Set-backed marker (each part hit at most once per cast — NOT a 6-frame
// repeat). Uses the IMPULSE lane (gatherInSegment + sweepImpact from _shared.js,
// the melee substrate); safe in apply() because it's input-triggered per cast,
// never in a kinematic onTick.
//
// Independent siege-engine root per docs/abilities-v3.md §3 — it is NOT a
// droppable like brick; it's the vehicle/siege-engine line's swung-mass entry.

import { gatherInSegment, sweepImpact, nearestPart } from '../_shared.js';
import { shatter } from '../_shared.js';
import { isBrittle, damageMul, consumeConcussed } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { sfx } from '../../audio/sfx.js';

// Perpendicular reach of the iron head off the swing line, and the hilt→head
// length of the log. A battering ram is a long heavy beam, so REACH is generous.
const SWEEP_RADIUS = 38;
const REACH        = 120;

export const defaultStats = {
  // force-per-mass coefficient fed to the impulse lane (applyImpulseScaled
  // multiplies by part.mass internally). A ram hits HARD — the headline verb
  // is the single big directional shove, not chip damage.
  force: 0.22,
  mood:  16,
};

export default {
  id: 'battering_ram',
  defaultStats,
  apply(ctx) {
    const s = getStats('battering_ram');
    const { ragdoll, status, x, y, dx = 0, dy = 0, screenShake } = ctx;
    if (!ragdoll?.parts?.length) return;

    // Swing heading = drag delta (hold+drag feeds dx/dy). If the cursor hasn't
    // moved this tick, fall back to aiming the log at the nearest part so a
    // stationary press still lands a hit instead of no-op'ing.
    let dirx = dx, diry = dy;
    if (Math.hypot(dirx, diry) < 1) {
      const np = nearestPart(ragdoll, x, y);
      if (!np) return;
      dirx = np.position.x - x;
      diry = np.position.y - y;
    }
    const len = Math.hypot(dirx, diry) || 1;
    const nx = dirx / len, ny = diry / len;

    // The ram's line: from the cursor (hilt) out to the iron head.
    const ax = x, ay = y;
    const bx = x + nx * REACH, by = y + ny * REACH;

    const parts = gatherInSegment(ragdoll, ax, ay, bx, by, SWEEP_RADIUS);
    if (!parts.length) return;

    // FRESH Set-backed marker per CAST: every part along the line is shoved at
    // most once this swing. One authoritative strong directional hit per part —
    // not a repeated per-frame pummel.
    const seen = new Set();
    const marker = { seen: (id) => seen.has(id), mark: (id) => seen.add(id) };
    const hit = sweepImpact(ctx, parts, nx, ny, s.force, marker, { upBias: 0.0006 });

    for (const part of hit) {
      // Brittle (frozen) parts shatter under the iron head.
      if (isBrittle(status, part)) shatter(ctx, part);
      // Concussed parts take the 1.5× bonus once, then the stack is consumed.
      const mul = damageMul(status, part);
      if (mul > 1) consumeConcussed(status, part);
      ctx.reactTo?.({
        source: ctx._verb || 'battering_ram',
        part,
        moodDelta: -s.mood * mul,
        impulse: s.force,
        // Headline speech only off the head; limbs stay quiet (sentinel ms).
        speakMs: part === ragdoll.head ? 600 : 99999,
      });
    }

    if (sfx.batteringRam) sfx.batteringRam();
    screenShake?.(11, 220);
  },

  // hold+drag cursor: the cursor system passes an `angle` (faces the heading);
  // draw a long iron-shod oak beam pointing down the swing line.
  drawCursor(ctx, { x, y, angle = 0 }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Oak shaft.
    ctx.fillStyle = '#6b4f2f';
    ctx.fillRect(0, -7, REACH - 22, 14);
    // Iron banding straps along the shaft.
    ctx.fillStyle = '#3a3a40';
    for (let i = 18; i < REACH - 30; i += 22) ctx.fillRect(i, -7, 4, 14);
    // Iron-shod head (capped tip).
    ctx.fillStyle = '#4a4a52';
    ctx.beginPath();
    ctx.arc(REACH - 14, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a6a74';
    ctx.beginPath();
    ctx.arc(REACH - 17, -3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};
// CONTRACT REMINDER: sweepImpact is the IMPULSE lane (applyImpulseScaled →
// markHit → ~0.30× neighbor propagate). Safe here (per-cast, input-triggered);
// MUST NOT be called from a body.onTick (render-frame, kinematic-only).
// gatherInSegment is NaN-guarded for degenerate zero-length segments.
