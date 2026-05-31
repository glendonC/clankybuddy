// wired — DEFENSIVE TOUGHNESS verb (adrenaline shot). Per user-approved doc
// change 2026-05-31 (supersedes the old "no damage" framing). While wired, the
// buddy takes REDUCED incoming mood-damage: damageMul x0.5, stamped on ALL
// parts by adrenaline so the resistance fires no matter which part is struck,
// and composes MULTIPLICATIVELY with the UP contributors (concussed x1.5 /
// corroded x1.4 / antitrust_split x2). This is the ONLY damageMul contributor
// that multiplies DOWN. The damageMul wiring lives in effects/registry.js
// (integrator-owned); this module is the status' lifetime + render/jitter.
//
// It is a per-cast toughness window (a verb), NOT meta-progression. No mood
// drain — a defensive buff is not a DoT.

import * as P from '../particles.js';
import { jolt, microFlail } from './_locomotion.js';
import { partRadius } from '../abilities/_shared.js';

export default {
  id: 'wired',
  defaultDuration: 3000,
  layer: 'over',

  // Raised jitter/activity so the buddy reads amped (adrenaline). Reuses the
  // _locomotion nudges at low probability — NO mood change (defensive buff).
  onTick(part, rec, ctx, dtMs, now) {
    if (part.partType === 'arm') {
      if (Math.random() < 0.45) microFlail(part);
    } else if (Math.random() < 0.30) {
      jolt(part);
    }
  },

  // Glowing veins / amped red-orange shimmer per part. Additive, pulses from now.
  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalCompositeOperation = 'lighter';
    for (const { part } of records) {
      const r = partRadius(part);
      // Pulse keyed to now + part.id so parts breathe out of phase.
      const pulse = 0.6 + Math.sin(now * 0.012 + part.id * 0.9) * 0.4;
      // Amped aura.
      const g = rctx.createRadialGradient(
        part.position.x, part.position.y, r * 0.2,
        part.position.x, part.position.y, r * 1.25,
      );
      g.addColorStop(0,   `rgba(255, 120, 60, ${0.34 * pulse})`);
      g.addColorStop(0.6, `rgba(255, 70, 40, ${0.22 * pulse})`);
      g.addColorStop(1,   'rgba(255, 40, 20, 0)');
      rctx.fillStyle = g;
      rctx.beginPath();
      rctx.arc(part.position.x, part.position.y, r * 1.25, 0, Math.PI * 2);
      rctx.fill();
      // A few hot "vein" streaks radiating outward.
      rctx.strokeStyle = `rgba(255, 170, 90, ${0.5 * pulse})`;
      rctx.lineWidth = 1.4;
      const streaks = 4;
      for (let i = 0; i < streaks; i++) {
        const a = (i / streaks) * Math.PI * 2 + now * 0.002;
        const r0 = r * 0.35;
        const r1 = r * (0.85 + 0.25 * pulse);
        rctx.beginPath();
        rctx.moveTo(part.position.x + Math.cos(a) * r0, part.position.y + Math.sin(a) * r0);
        // slight kink for an organic vein read
        const mr = (r0 + r1) * 0.5;
        const ma = a + (Math.random() - 0.5) * 0.4;
        rctx.lineTo(part.position.x + Math.cos(ma) * mr, part.position.y + Math.sin(ma) * mr);
        rctx.lineTo(part.position.x + Math.cos(a) * r1, part.position.y + Math.sin(a) * r1);
        rctx.stroke();
      }
    }
    rctx.restore();
  },
};
