import * as P from '../particles.js';
import { applyMoodDelta } from '../mood.js';
import { hasStatus, removeStatus, applyStatus } from './registry.js';
import { showCombo } from '../ui/overlays.js';
import { panicRunLeg } from './_locomotion.js';
import { react } from '../reactions/index.js';
import { partRadius } from '../abilities/_shared.js';

const SPREAD_AFTER_MS = 1500;
const SPREAD_INTERVAL_MS = 900;

// Module-level throttle so STEAM BURST doesn't fire 6 times when an explosion
// ignites every part of a frozen ragdoll. One overlay per ~600ms is enough.
let _lastSteamAt = 0;

export default {
  id: 'on_fire',
  // Persistent, fire stays on the buddy until an opposing input (freeze,
  // shatter, character switch) removes it. IB-style: no self-extinguish.
  defaultDuration: 'persistent',
  layer: 'over',

  onApply(part, rec, reg) {
    // Fire melts ice → STEAM BURST. White cloud + tiny "MELT" overlay.
    if (hasStatus(reg, part, 'frozen')) {
      removeStatus(reg, part, 'frozen');
      P.burst(part.position.x, part.position.y, 14, {
        type: 'smoke', color: '#cdeef5', size: 6, life: 900, speedRange: 0.5, gravity: -0.0008,
      });
      P.burst(part.position.x, part.position.y, 6, {
        type: 'spark', color: '#fff', size: 2, life: 300, speedRange: 0.6,
      });
      const now = performance.now();
      if (now - _lastSteamAt > 600) {
        _lastSteamAt = now;
        showCombo?.('STEAM BURST', '#cdeef5');
      }
    }
  },

  onTick(part, rec, ctx, dtMs, now) {
    // DOT: ~ -2 mood / 250ms => -8/sec
    applyMoodDelta(ctx.mood, -0.008 * dtMs * rec.intensity);
    // Panic-run: legs zigzag while burning. Bails when stunned/tipped.
    panicRunLeg(ctx.ragdoll, part);
    if (!rec._spoken) {
      rec._spoken = true;
      react({ event: 'on_fire', mood: ctx.mood, part: ctx.ragdoll.head });
    }
    // Spread: after sustained burn, ignite the closest non-burning, non-frozen
    // neighbor every SPREAD_INTERVAL_MS. Spread fires inherit persistent
    // semantics, they only stop when extinguished, same as the source fire.
    const burnedFor = now - rec.startedAt;
    if (burnedFor > SPREAD_AFTER_MS) {
      if (!rec._lastSpreadAt || now - rec._lastSpreadAt > SPREAD_INTERVAL_MS) {
        rec._lastSpreadAt = now;
        const others = ctx.ragdoll.parts.filter(p =>
          p !== part &&
          !hasStatus(ctx.status, p, 'on_fire') &&
          !hasStatus(ctx.status, p, 'frozen'));
        if (others.length) {
          others.sort((a, b) =>
            Math.hypot(a.position.x - part.position.x, a.position.y - part.position.y) -
            Math.hypot(b.position.x - part.position.x, b.position.y - part.position.y));
          applyStatus(ctx.status, others[0], 'on_fire', { source: 'spread' });
        }
      }
    }
    if (Math.random() < 0.5) {
      P.spawn({
        x: part.position.x + (Math.random() - 0.5) * 18,
        y: part.position.y - 6 + (Math.random() - 0.5) * 18,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -0.25 - Math.random() * 0.2,
        type: 'fire',
        color: ['#ff6b1a', '#ffae3c', '#ffd266'][Math.floor(Math.random() * 3)],
        size: 5 + Math.random() * 5,
        life: 350 + Math.random() * 200,
        gravity: -0.0008,
        drag: 0.985,
      });
    }
    if (Math.random() < 0.08) {
      P.spawn({
        x: part.position.x, y: part.position.y - 16,
        vx: (Math.random() - 0.5) * 0.05, vy: -0.15,
        type: 'smoke', color: '#555', size: 8, life: 700,
        gravity: -0.0003, drag: 0.99,
      });
    }
  },

  render(rctx, ragdoll, records, now) {
    rctx.save();
    rctx.globalCompositeOperation = 'lighter';
    for (const { part } of records) {
      const r = partRadius(part) * 1.6;
      const flick = 0.7 + Math.sin(now * 0.018 + part.id * 0.7) * 0.3;
      const g = rctx.createRadialGradient(
        part.position.x, part.position.y - r * 0.3, 2,
        part.position.x, part.position.y, r,
      );
      g.addColorStop(0,   `rgba(255, 240, 180, ${0.55 * flick})`);
      g.addColorStop(0.5, `rgba(255, 130, 40, ${0.4 * flick})`);
      g.addColorStop(1,   'rgba(255, 80, 0, 0)');
      rctx.fillStyle = g;
      rctx.beginPath(); rctx.arc(part.position.x, part.position.y, r, 0, Math.PI * 2); rctx.fill();
      // scorch persistence after fire ends, read by render.js drawBall
      part._scorchedUntil = now + 2000;
    }
    rctx.restore();
  },
};
