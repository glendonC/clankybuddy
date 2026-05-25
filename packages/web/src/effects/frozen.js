import * as P from '../particles.js';
import { applyMoodDelta } from '../mood.js';
import { hasStatus, removeStatus } from './registry.js';
import { shiver } from './_locomotion.js';
import { react } from '../reactions/index.js';

export default {
  id: 'frozen',
  // Persistent, buddy stays frozen until an opposing input (fire, lightning
  // combust, hammer shatter, character switch) removes it. IB-style.
  defaultDuration: 'persistent',
  layer: 'over',

  onApply(part, rec, reg) {
    // Freeze extinguishes fire outright, opposing inputs cure each other.
    // The puff-of-steam visual stays so the cure reads as a moment.
    if (hasStatus(reg, part, 'on_fire')) {
      removeStatus(reg, part, 'on_fire');
      P.burst(part.position.x, part.position.y, 10, {
        type: 'smoke', color: '#cdd', size: 4, life: 800, speedRange: 0.4, gravity: -0.0002,
      });
    }
    // render-compat (read by main.js stale-cleanup; with persistent
    // semantics expiresAt is Infinity, so the cleanup latch never fires,
    // onRemove clears these fields when the freeze is cured.)
    part.frozenUntil = rec.expiresAt;
    part.brittle = true;
  },

  onRemove(part, rec, reg) {
    part.brittle = false;
    part.frozenUntil = 0;
  },

  onTick(part, rec, ctx, dtMs, now) {
    // modest drain; the freeze is its own punishment via lockout
    applyMoodDelta(ctx.mood, -0.001 * dtMs);
    if (!rec._spoken) {
      rec._spoken = true;
      react({ event: 'frozen', mood: ctx.mood, part: ctx.ragdoll.head });
    }
    // High-freq shiver, torso/head tremble, arms wisp. Probabilistic so the
    // buddy doesn't visibly hum like an electric toothbrush.
    if (Math.random() < 0.55) shiver(part);
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalAlpha = 0.35;
    rctx.fillStyle = '#9be7ff';
    for (const { part } of records) {
      rctx.beginPath();
      if (part.circleRadius) {
        rctx.arc(part.position.x, part.position.y, part.circleRadius * 1.25, 0, Math.PI * 2);
      } else {
        const v = part.vertices;
        rctx.moveTo(v[0].x, v[0].y);
        for (let i = 1; i < v.length; i++) rctx.lineTo(v[i].x, v[i].y);
        rctx.closePath();
      }
      rctx.fill();
    }
    rctx.restore();
  },
};
