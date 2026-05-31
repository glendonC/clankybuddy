// packages/web/src/abilities/punish/liquid-nitrogen.js
// Liquid nitrogen sprayer — corruption/cryogenics line. kind:'hold' (FIRE_INTERVAL ~30ms).
//
// The COLD mirror of the flamethrower (flame.js). Hold a cone of cryo mist that
// PAINTS persistent `frozen` (=> part.brittle) onto whatever the stream touches
// and shoves it gently back. Mirrors flame.js exactly, swapping on_fire for
// frozen: flame keeps intensity flat at 1 and relies on the persistent on_fire
// DoT; here we re-paint persistent `frozen` every tick a part is in the cone.
// frozen is idempotent (re-applying preserves startedAt, resets expiresAt) so
// spraying steadily keeps brittle alive without stacking blowup — the brittle
// flag IS the payoff, no numeric intensity stacking exists in applyStatus.
//
// Cone = nearestPart + range gate (flame's model), NOT a true angular wedge.
// The per-tick `Math.random() < freezeChance` roll IS the throttle/ramp, NOT a
// setTimeout. No setTimeout touches the ragdoll, so no _epoch guard needed.
import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { applyStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { nearestPart, applyImpulse } from '../_shared.js';

const { Vector } = Matter;

export const defaultStats = {
  range:        170,
  freezeChance: 0.6,    // per-tick roll to (re)paint frozen — the throttle/ramp
  moodPerTick:  0.4,    // subtracted (positive number)
  pushForce:    0.0022, // force-per-mass shove away from the nozzle
};

export default {
  id: 'liquid_nitrogen',
  defaultStats,
  apply(ctx) {
    const s = getStats('liquid_nitrogen');
    const { ragdoll, status, x, y, dx, dy } = ctx;
    const part = nearestPart(ragdoll, x, y);
    let hitPart = null;
    let impulse = 0;
    if (part) {
      const dist = Math.hypot(part.position.x - x, part.position.y - y);
      if (dist < s.range) {
        const n = Vector.normalise(Vector.sub(part.position, { x, y }));
        // Slight upward bias (lighter than flame's -0.0006) so the cone nudges
        // rather than launches; the freeze lock is the point, not the knockback.
        const fx = n.x * s.pushForce;
        const fy = n.y * s.pushForce - 0.0004;
        applyImpulse(part, fx, fy);
        hitPart = part;
        impulse = Math.hypot(fx, fy);
        // Re-paint frozen each roll: persistent + idempotent (startedAt
        // preserved, expiresAt reset). This keeps part.brittle alive for as
        // long as the cone stays on it.
        if (Math.random() < s.freezeChance) {
          applyStatus(status, part, 'frozen', { source: 'liquid_nitrogen' });
        }
      }
    }
    const moodDelta = -s.moodPerTick;
    if (hitPart) {
      ctx.reactTo?.({ source: 'liquid_nitrogen', part: hitPart, moodDelta, impulse, speakMs: 99999 });
    } else {
      // Spraying into the void still chips mood (matches flame behavior).
      ctx.reactTo?.({ moodDelta, speakMs: 99999 });
    }
    // Pressurized hiss, throttled so overlapping ticks blend into a steady jet.
    if (Math.random() < 0.4) sfx.freeze?.();
    // Aim: cursor sweep dir, else cursor → buddy, else flat (flame's rule).
    let a;
    const moveMag = Math.hypot(dx || 0, dy || 0);
    if (moveMag > 1.5) {
      a = Math.atan2(dy, dx);
    } else if (part) {
      a = Math.atan2(part.position.y - y, part.position.x - x);
    } else {
      a = 0;
    }
    // Cryo mist / vapor: cool palette, faint downward drift (cold air falls, the
    // mirror of flame's negative gravity).
    for (let i = 0; i < 5; i++) {
      const spread = (Math.random() - 0.5) * 0.6;
      const ang = a + spread;
      const speed = 0.25 + Math.random() * 0.4;
      P.spawn({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        type: 'ice',
        color: ['#cdeef5', '#9be7ff', '#e8fbff'][i % 3],
        size: 5 + Math.random() * 5,
        life: 350 + Math.random() * 200,
        gravity: 0.0004,
        drag: 0.985,
      });
    }
    // Occasional zero-delta reactTo lets a held stream talk without spamming.
    if (Math.random() < 0.04) {
      ctx.reactTo?.({ source: 'liquid_nitrogen', part: ragdoll.head, moodDelta: 0, speakMs: 600 });
    }
  },
  drawCursor(ctx, { x, y, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3a4650'; ctx.fillRect(-22, -8, 12, 16); // pressurized tank
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-10, -2, 14, 4);  // hose
    ctx.fillStyle = '#cfd8e3'; ctx.fillRect(4, -4, 10, 8);    // nozzle body
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(14, -3, 4, 6);    // tip
    ctx.globalCompositeOperation = 'lighter';
    const flick = isDown ? (1 + Math.random() * 0.4) : 0.6;
    const r = 5 * flick;
    const g = ctx.createRadialGradient(20, 0, 1, 20, 0, r * 2);
    g.addColorStop(0,   '#e8fbff');
    g.addColorStop(0.5, '#9be7ff');
    g.addColorStop(1,   'rgba(155, 231, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(20, 0, r * 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};
