import Matter from 'matter-js';
import * as P from '../particles.js';
import { applyMoodDelta } from '../mood.js';
import { microFlail, jolt } from './_locomotion.js';
import { react } from '../reactions/index.js';
import { partRadius } from '../abilities/_shared.js';

const { Body } = Matter;

export default {
  id: 'electrified',
  defaultDuration: 500,
  layer: 'over',

  onTick(part, rec, ctx, dtMs, now) {
    applyMoodDelta(ctx.mood, -0.005 * dtMs);
    if (!rec._spoken) {
      rec._spoken = true;
      react({ event: 'electrified', mood: ctx.mood, part: ctx.ragdoll.head });
    }
    // Vibrate arms, distinct from the angular-only jitter we used to do.
    if (part.partType === 'arm') {
      if (Math.random() < 0.7) microFlail(part);
    } else if (Math.random() < 0.55) {
      // Whole-body convulsion, torso/head/legs shake, not just arms.
      jolt(part);
    }
    if (Math.random() < 0.35) {
      P.spawn({
        x: part.position.x + (Math.random() - 0.5) * 22,
        y: part.position.y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        type: 'spark', color: '#9be7ff', size: 2, life: 140,
        gravity: 0, drag: 0.9,
      });
    }
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalCompositeOperation = 'lighter';
    rctx.lineWidth = 1.6;
    for (const { part } of records) {
      const r = partRadius(part);
      const arcs = 3;
      rctx.strokeStyle = `rgba(155, 231, 255, ${0.7 + Math.random() * 0.3})`;
      for (let i = 0; i < arcs; i++) {
        const a0 = Math.random() * Math.PI * 2;
        const a1 = a0 + Math.PI * (0.3 + Math.random() * 0.5);
        const sx = part.position.x + Math.cos(a0) * r;
        const sy = part.position.y + Math.sin(a0) * r;
        const ex = part.position.x + Math.cos(a1) * r;
        const ey = part.position.y + Math.sin(a1) * r;
        rctx.beginPath();
        rctx.moveTo(sx, sy);
        const segs = 3;
        for (let s = 1; s < segs; s++) {
          const t = s / segs;
          const mx = sx + (ex - sx) * t + (Math.random() - 0.5) * 8;
          const my = sy + (ey - sy) * t + (Math.random() - 0.5) * 8;
          rctx.lineTo(mx, my);
        }
        rctx.lineTo(ex, ey);
        rctx.stroke();
      }
    }
    rctx.restore();
  },
};
