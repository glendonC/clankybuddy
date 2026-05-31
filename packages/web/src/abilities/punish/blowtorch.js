// Blowtorch, kinetic group. Phase / Batch 3B addition. A HOLD point-tool
// (kind: 'hold', ~50ms throttle) that you dwell on a single part: each tick
// re-applies ON_FIRE and RAMPS its intensity the longer the flame stays on
// the SAME part. No projectile, no sweep, this is a stationary cutting torch
// you hold against a limb.
//
// Mechanic notes:
//   - Ramp state is module-level (single-buddy game, the revolver.js idiom)
//     and keyed to BOTH ctx._epoch and the target part.id, so a buddy-swap or
//     moving the torch onto a different part resets the charge to clean. When
//     there is no part in range the accumulator collapses so the next dwell
//     starts from zero.
//   - on_fire is PERSISTENT (omit duration); the status registry tick drives
//     the DOT and fire-spread, so this ability needs NO setTimeout. We just
//     keep re-applying with a higher intensity from the charge counter.
//   - Brittle (frozen) parts shatter the instant the torch touches them, the
//     standard idiom. Fire would also melt frozen via on_fire's onApply, but
//     a frozen part is brittle FIRST, so the shatter wins (kchhhing) before we
//     bother igniting.
//   - SFX is a continuous torch hiss; we throttle the call to a fixed cadence
//     instead of every 50ms tick so it doesn't machine-gun the audio bus.
//   - Whiff (no part in range): quiet smoke puff, NO fake hit sound, and the
//     ramp resets so releasing-into-air and re-aiming starts clean.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood + speech via ctx.reactTo.
import { isBrittle, damageMul, consumeConcussed, applyStatus, getStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { nearestPart, applyImpulse, shatter } from '../_shared.js';

const TIP_OFFSET = 18;   // hilt -> flame tip (match drawCursor)

export const defaultStats = {
  range:        90,    // max dwell distance from cursor to a part center
  maxCharge:    18,    // ticks of dwell before intensity caps
  maxIntensity: 5,     // on_fire intensity ceiling (bleed.js-style 1..5 scale)
  moodPerTick:  0.8,   // chip damage each tick the torch is on a part
  pushForce:    0.0018, // tiny shove so the part recoils off the flame
  sfxIntervalMs: 120,  // throttle the looping torch hiss
};

// Module-level dwell accumulator (revolver.js idiom). Keyed to epoch + part so
// it resets on buddy-swap or when the torch moves to a different limb.
let _ramp = { epoch: -1, partId: -1, charge: 0 };
let _lastSfxAt = 0;

function resetRamp() {
  _ramp = { epoch: -1, partId: -1, charge: 0 };
}

export default {
  id: 'blowtorch',
  defaultStats,
  apply(ctx) {
    const s = getStats('blowtorch');
    const { ragdoll, status, x, y, screenShake } = ctx;

    const part = nearestPart(ragdoll, x, y);
    if (!part || Math.hypot(part.position.x - x, part.position.y - y) > s.range) {
      // Whiff, quiet smoke puff. No fake hit sound; reset the dwell so the
      // next time we catch a limb the ramp starts cold.
      resetRamp();
      P.burst(x, y, 3, { type: 'smoke', color: '#777', size: 5, life: 260, speedRange: 0.2, gravity: -0.0003 });
      return;
    }

    // Re-key the accumulator if the buddy respawned or the torch slid onto a
    // different part; otherwise advance the dwell charge toward the cap.
    if (_ramp.epoch !== ctx._epoch || _ramp.partId !== part.id) {
      _ramp = { epoch: ctx._epoch, partId: part.id, charge: 0 };
    }
    _ramp.charge = Math.min(_ramp.charge + 1, s.maxCharge);

    // Frozen parts shatter before we bother igniting.
    if (isBrittle(status, part)) shatter(ctx, part);

    // Damage gate: ALIGNED block / FINISHING voids the hit; concussed boosts.
    const mul = damageMul(status, part);
    if (mul === 0) {
      P.burst(part.position.x, part.position.y, 4, { type: 'spark', color: '#7ec8ff', size: 3, life: 200 });
      return;
    }
    if (mul > 1) consumeConcussed(status, part);

    // Tiny radial shove off the flame tip so the limb visibly recoils.
    const dxp = part.position.x - x, dyp = part.position.y - y;
    const len = Math.hypot(dxp, dyp) || 1;
    const fx = (dxp / len) * s.pushForce;
    const fy = (dyp / len) * s.pushForce - 0.0006;
    applyImpulse(part, fx, fy);

    // Ramp on_fire intensity from the dwell charge. PERSISTENT (omit duration);
    // the registry tick drives the DOT and spread. We refresh every tick so the
    // intensity climbs the longer we hold the torch on this exact limb, and the
    // existing intensity is honored if fire spread already lit it hotter.
    const ramped = 1 + Math.round((_ramp.charge / s.maxCharge) * (s.maxIntensity - 1));
    const existing = getStatus(status, part, 'on_fire');
    const intensity = Math.min(Math.max(ramped, existing?.intensity ?? 0), s.maxIntensity);
    applyStatus(status, part, 'on_fire', { intensity, source: 'blowtorch' });

    // Fast-ticking tool, suppress speech so it doesn't chatter.
    ctx.reactTo?.({ source: 'blowtorch', part, moodDelta: -s.moodPerTick * mul, impulse: Math.hypot(fx, fy), speakMs: 99999 });

    // Looping torch hiss, throttled so 50ms ticks don't machine-gun the bus.
    const now = performance.now();
    if (now - _lastSfxAt >= s.sfxIntervalMs) {
      _lastSfxAt = now;
      sfx['blowtorch']?.();
    }

    screenShake(1, 60);

    // Blue-white cutting jet + sparks at the contact point. Hotter (whiter,
    // longer) as the charge ramps.
    const heat = _ramp.charge / s.maxCharge;
    const aim = Math.atan2(dyp, dxp);
    for (let i = 0; i < 4; i++) {
      const spread = (Math.random() - 0.5) * 0.5;
      const a = aim + spread;
      const speed = 0.4 + Math.random() * 0.5;
      P.spawn({
        x: part.position.x, y: part.position.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 0.05,
        type: 'spark',
        color: heat > 0.6 ? '#fff7c2' : ['#9fd0ff', '#ffae3c', '#ffd266'][i % 3],
        size: 2 + Math.random() * 2,
        life: 220 + Math.random() * 160,
        gravity: -0.0005, drag: 0.98,
      });
    }
  },
  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    // Torch body / handle along -x, nozzle pointing +x toward the part.
    rctx.fillStyle = '#2a2a31';
    rctx.fillRect(-16, -5, 18, 10);
    rctx.fillStyle = '#c2c7cc';            // brass collar
    rctx.fillRect(2, -3, 8, 6);
    rctx.fillStyle = '#1c1c20';            // nozzle
    rctx.fillRect(10, -2, 6, 4);
    // Flame jet, +x. Brighter/longer while firing.
    rctx.globalCompositeOperation = 'lighter';
    const reach = isDown ? TIP_OFFSET + 6 + Math.random() * 4 : TIP_OFFSET - 4;
    const g = rctx.createLinearGradient(16, 0, 16 + reach, 0);
    g.addColorStop(0,   '#9fd0ff');        // blue base
    g.addColorStop(0.5, '#fff7c2');        // white-hot core
    g.addColorStop(1,   'rgba(255, 140, 0, 0)');
    rctx.fillStyle = g;
    rctx.beginPath();
    rctx.moveTo(16, -3.5);
    rctx.lineTo(16 + reach, 0);
    rctx.lineTo(16, 3.5);
    rctx.closePath();
    rctx.fill();
    rctx.restore();
  },
};
