import Matter from 'matter-js';
import * as P from '../particles.js';
import { COUNTER_GRAVITY_NEUTRALIZER } from '../physics/constants.js';

const { Body } = Matter;

export default {
  id: 'in_blackhole',
  defaultDuration: 3000,
  layer: 'under',

  onTick(part, rec, ctx, dtMs, now) {
    const c = rec.data?.center;
    if (!c) return;
    const dx = c.x - part.position.x;
    const dy = c.y - part.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Pull was 0.0009 * mass, invisible against the 0.92 counter-gravity in
    // stand.js. Cube-rooted from 5x to keep it physical without snapping.
    // `radius` scales the inward force; baseline 200 → multiplier 1.
    const radiusScale = (rec.data?.radius ?? 200) / 200;
    const F = (0.005 * part.mass * radiusScale) / (1 + dist * 0.003);
    Body.applyForce(part, part.position, { x: (dx / dist) * F, y: (dy / dist) * F });
    // Counter-gravity neutralizer: while pulled, cancel the upward bias
    // that stand.js applies. COUNTER_GRAVITY_NEUTRALIZER tracks the
    // standing pose's lift automatically, if gravity or the stand factor
    // changes, this stays in sync.
    Body.applyForce(part, part.position, { x: 0, y: COUNTER_GRAVITY_NEUTRALIZER * part.mass });
    // Spiral trail particles inward, denser than before so the suck reads.
    if (Math.random() < 0.55) {
      const tangX = -dy / dist, tangY = dx / dist;  // perpendicular to pull
      P.spawn({
        x: part.position.x, y: part.position.y,
        vx: (dx / dist) * 0.06 + tangX * 0.18,
        vy: (dy / dist) * 0.06 + tangY * 0.18,
        type: 'spark', color: '#a78bfa', size: 2, life: 380,
        gravity: 0, drag: 0.99,
      });
    }
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.strokeStyle = 'rgba(167, 139, 250, 0.35)';
    rctx.lineWidth = 1;
    for (const { part, rec } of records) {
      const c = rec.data?.center;
      if (!c) continue;
      rctx.beginPath();
      rctx.moveTo(part.position.x, part.position.y);
      rctx.lineTo(c.x, c.y);
      rctx.stroke();
    }
    rctx.restore();
  },
};
