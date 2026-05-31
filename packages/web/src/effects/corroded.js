// CORRODED, acid-flask caustic status (corruption lane). OVERLAY-ONLY: a
// sickly-green eaten-away coat that visually eats inward over the duration.
//
// The "shrink" is a pure RENDER-TIME multiplier derived from elapsed/duration
// every frame — it NEVER calls Body.scale or touches part.circleRadius. Mutating
// a jointed part's geometry leaves the constraint rest length stale and drifts
// the simulation (see CLAUDE.md physics landmines); so the body always renders
// at its true size underneath and only the drawn corrosion coat eats inward.
// Because the coat is derived from elapsed/duration there is no per-tick state
// writer and nothing drifts.
//
// Gameplay weight lives in registry.js damageMul (+1.4× per corroded part);
// this module owns only the look + the optional splash burst on apply.

import * as P from '../particles.js';
import { partRadius } from '../abilities/_shared.js';

// How far the corrosion coat eats inward over the full duration (0.30 => the
// drawn radius shrinks from 1.00× to 0.70× across the window).
const MAX_SHRINK = 0.30;

export default {
  id: 'corroded',
  defaultDuration: 8000,
  layer: 'over',

  // Tiny acid-splash burst when the coat first lands. No onTick writer (the
  // shrink is render-derived) and no DoT — corroded is a damage AMP, not a DoT.
  onApply(part, rec, reg) {
    P.burst(part.position.x, part.position.y, 8, {
      type: 'spark', color: '#9bff6b', size: 3, life: 420, speedRange: 0.7, gravity: 0.0008,
    });
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    for (const { part, rec } of records) {
      const dur = Number.isFinite(rec.expiresAt) ? (rec.expiresAt - rec.startedAt) : 8000;
      const elapsed = now - rec.startedAt;
      const t = Math.min(1, Math.max(0, elapsed / (dur || 8000)));
      const shrink = 1 - MAX_SHRINK * t;        // 1.00 → 0.70 over the duration
      const base = partRadius(part);
      const r = base * shrink;                  // the drawn (eaten-inward) edge
      const cx = part.position.x, cy = part.position.y;

      // 1. Outer corroded ring at the body's TRUE edge, draws the gap between
      // the real silhouette and the eaten-inward coat as a darkened, pitted band
      // so the coat reads as "eaten away" rather than just a smaller circle.
      rctx.globalCompositeOperation = 'source-over';
      rctx.globalAlpha = 0.45 + 0.15 * Math.sin(now * 0.006 + part.id);
      rctx.lineWidth = Math.max(2, (base - r));
      rctx.strokeStyle = '#3a5c1e';
      rctx.beginPath();
      rctx.arc(cx, cy, (base + r) / 2, 0, Math.PI * 2);
      rctx.stroke();

      // 2. Sickly-green sheen coat sitting on the body, brightest at the eaten
      // edge. Additive so it reads as a wet caustic film over the part color.
      rctx.globalCompositeOperation = 'lighter';
      rctx.globalAlpha = 1;
      const g = rctx.createRadialGradient(cx, cy - r * 0.2, 1, cx, cy, base);
      g.addColorStop(0,    'rgba(120, 200, 70, 0.12)');
      g.addColorStop(0.7,  'rgba(155, 255, 107, 0.20)');
      g.addColorStop(1,    'rgba(90, 200, 40, 0.0)');
      rctx.fillStyle = g;
      rctx.beginPath();
      rctx.arc(cx, cy, base, 0, Math.PI * 2);
      rctx.fill();

      // 3. Pitting: a few dark eaten-out pocks scattered around the eaten edge.
      rctx.globalCompositeOperation = 'source-over';
      rctx.fillStyle = 'rgba(40, 70, 20, 0.6)';
      const pits = 5;
      for (let i = 0; i < pits; i++) {
        const a = (i / pits) * Math.PI * 2 + part.id * 0.6;
        const pr = r * (0.6 + 0.35 * ((i * 7 + part.id) % 5) / 5);
        const px = cx + Math.cos(a) * pr;
        const py = cy + Math.sin(a) * pr;
        rctx.beginPath();
        rctx.arc(px, py, 1.6 + (i % 2), 0, Math.PI * 2);
        rctx.fill();
      }

      // 4. Dripping acid: an occasional bright-green bead sliding off the bottom.
      rctx.globalCompositeOperation = 'lighter';
      const drip = (Math.sin(now * 0.004 + part.id * 1.7) + 1) * 0.5; // 0..1
      rctx.globalAlpha = 0.35 + 0.3 * drip;
      rctx.fillStyle = '#9bff6b';
      rctx.beginPath();
      rctx.ellipse(cx, cy + r * 0.7 + drip * 6, 1.8, 3 + drip * 3, 0, 0, Math.PI * 2);
      rctx.fill();
    }
    rctx.globalAlpha = 1;
    rctx.restore();
  },
};
