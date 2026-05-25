import * as P from '../particles.js';
import { applyMoodDelta } from '../mood.js';

export default {
  id: 'powered',
  defaultDuration: 5000,
  layer: 'under',

  onTick(part, rec, ctx, dtMs, now) {
    // mood +0.012/ms => +12/sec; net positive against decay (-6/s).
    // data.mul lets persona affinity scale it (Llama × 0.5 from gpu.js).
    const mul = rec.data?.mul ?? 1.0;
    applyMoodDelta(ctx.mood, 0.012 * dtMs * mul);
    if (Math.random() < 0.06) {
      P.spawn({
        x: part.position.x + (Math.random() - 0.5) * 30,
        y: part.position.y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 0.05, vy: -0.1,
        type: 'star', color: '#5cf2a0', size: 3, life: 700,
        gravity: -0.0002, drag: 0.99,
      });
    }
  },

  render(rctx, ragdoll, records, now) {
    // One halo on the chest if any part is powered.
    const c = ragdoll.chest;
    if (!c || !Number.isFinite(c.position.x)) return;
    rctx.save();
    rctx.globalCompositeOperation = 'lighter';
    const pulse = 0.6 + Math.sin(now * 0.005) * 0.25;
    const r = 130;
    const g = rctx.createRadialGradient(c.position.x, c.position.y, 10, c.position.x, c.position.y, r);
    g.addColorStop(0,   `rgba(92, 242, 160, ${0.22 * pulse})`);
    g.addColorStop(0.5, `rgba(92, 242, 160, ${0.08 * pulse})`);
    g.addColorStop(1,   'rgba(92, 242, 160, 0)');
    rctx.fillStyle = g;
    rctx.beginPath(); rctx.arc(c.position.x, c.position.y, r, 0, Math.PI * 2); rctx.fill();
    rctx.restore();
  },
};
