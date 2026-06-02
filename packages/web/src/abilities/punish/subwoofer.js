// Subwoofer — ordnance placed zone. Drop a speaker stack that thuds a CONCUSSIVE
// pulse on a steady beat, dazing everything in range. Parents the flashbang root
// (the first ranged concussed applicator); this is its placed-zone cousin.
//
// WHY THE SCHEDULER, NOT A CONTACT SENSOR: Matter's collisionStart fires once on
// entry, so a contact sensor would never re-pulse a buddy standing still in the
// zone. scheduleSequence (S4) walks N beats off loop-driven sim-time; each step
// finds the in-range parts and stamps CONCUSSED. The placed body is a render-only
// marker (no onContact, no hazard-field registration — subwoofer is ordnance,
// not a chainable trap).
//
// SCHEDULER CONTRACT (meteor-shower / creeping-barrage template): the per-step
// closure captures ONLY the cast-time centre (cx,cy). scheduleSequence hands a
// FRESH ctx per fired step (current ragdoll/epoch) and cancels the sequence if
// the buddy is swapped — so a still-pulsing subwoofer never dazes a new buddy.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { applyStatus } from '../../effects/registry.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { scheduleSequence } from '../../state/scheduler.js';

const { Bodies, Composite } = Matter;

export const defaultStats = {
  radius:       180,
  intervalMs:   700,   // a thump every ~0.7s
  startDelayMs: 250,   // brief settle before the first beat
  concussMs:    1500,
  pulses:       8,
};

// One concussive beat: concuss every ragdoll part inside the zone. Reads stats
// fresh; closes over only cast-time scalars (cx,cy), never a live ragdoll.
function pulse(ctx, cx, cy) {
  const s = getStats('subwoofer');
  const ragdoll = ctx?.ragdoll;
  if (!ragdoll?.parts) return;
  const r2 = s.radius * s.radius;
  let hit = false;
  for (const p of ragdoll.parts) {
    const dx = p.position.x - cx, dy = p.position.y - cy;
    if (dx * dx + dy * dy > r2) continue;
    applyStatus(ctx.status, p, 'concussed', { duration: s.concussMs, source: 'subwoofer' });
    hit = true;
  }
  ctx.hitStop?.projSmall?.();           // light tier — repeated beats must not lock the sim
  sfx.subwooferPulse?.();
  P.burst(cx, cy, hit ? 10 : 6, { type: 'spark', color: '#b07cff', size: 2.5, life: 240, speedRange: 1.0, gravity: 0 });
}

export default {
  id: 'subwoofer',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('subwoofer');
    const { world, x, y, transientBodies } = ctx;
    const cx = x, cy = y;

    // lifeMs DERIVED from the pulse schedule (single source of truth) so the
    // render ring + body removal never outlive/undercut the actual beats.
    const lifeMs = s.startDelayMs + s.pulses * s.intervalMs + 250;

    const cab = Bodies.circle(cx, cy, s.radius, {
      isStatic: true, isSensor: true,
      // No onContact (the pulse is scheduler-driven proximity), so collide with
      // NOTHING — a render-only marker. mask:0 means this large zone forms no
      // pairs at all, so it never trips isGrounded() (which now also skips sensor
      // pairs anyway), and a buddy merely in range is never falsely standing.
      collisionFilter: { mask: 0 },
      label: 'subwoofer', render: { visible: false },
    });
    cab.partType = 'subwoofer';
    cab._verb = ctx._verb || 'subwoofer';
    cab.bornAt = performance.now();
    cab.lifeMs = lifeMs;
    cab._epoch = ctx._epoch;
    cab._radius = s.radius;
    cab._intervalMs = s.intervalMs;        // render ring sync
    Composite.add(world, cab);
    transientBodies.push(cab);

    // Periodic concuss pulse on the loop-driven scheduler (epoch-guarded, fresh
    // ctx per step, cancelled on character switch).
    scheduleSequence(
      (stepCtx) => pulse(stepCtx, cx, cy),
      { count: s.pulses, intervalMs: s.intervalMs, startDelayMs: s.startDelayMs },
    );

    sfx.subwooferDrop?.();                  // synchronous cast thud (epoch-independent)
    startCooldown('subwoofer');
  },
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    // Dashed pulse-radius ring.
    rctx.strokeStyle = 'rgba(176,124,255,0.32)';
    rctx.setLineDash([6, 6]); rctx.lineWidth = 1.4;
    rctx.beginPath(); rctx.arc(0, 0, 180, 0, Math.PI * 2); rctx.stroke();
    rctx.setLineDash([]);
    // Speaker cabinet glyph.
    rctx.fillStyle = '#26262b';
    rctx.fillRect(-9, -12, 18, 24);
    rctx.fillStyle = '#3a3a42';
    rctx.beginPath(); rctx.arc(0, -4, 5, 0, Math.PI * 2); rctx.fill();   // tweeter
    rctx.fillStyle = '#1c1c20';
    rctx.beginPath(); rctx.arc(0, 5, 6.5, 0, Math.PI * 2); rctx.fill();  // woofer cone
    rctx.fillStyle = '#b07cff';
    rctx.beginPath(); rctx.arc(0, 5, 2.2, 0, Math.PI * 2); rctx.fill();  // dust cap
    rctx.restore();
  },
};
