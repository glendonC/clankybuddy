// Power drill, Kinetic group (spine 'negative', group 'kinetic').
// kind: 'hold', edged: true. A point-melee dwell tool: hold the bit against
// ONE part and the wound deepens. Unlike the chainsaw (a hold+drag sweep that
// bumps BLEED +1 per contact tick across whatever the bar grazes), the drill
// commits to a single part. An epoch+part keyed ramp builds the BLEED
// intensity toward a cap the longer you hold the SAME part; moving the cursor
// to a different part (or a buddy-swap) resets the ramp so you start fresh.
//
// Mechanic notes:
//   - kind:'hold' re-fires apply() on the ~50ms throttle while the mouse is
//     down (input/mouse.js). No projectile, no transient body.
//   - The ramp is module-level let-state keyed to ctx._epoch AND part.id
//     (single-buddy game; this is the documented idiom, cf. revolver.js).
//     Reset to clean shape on whiff / target change / buddy swap.
//   - BLEED is RE-APPLIED each tick with intensity derived from the ramp; the
//     status registry tick drives the DOT, so NO setTimeout is needed.
//   - Looping drill SFX is throttled to ~rampSfxMs so a held drill whirrs
//     instead of machine-gunning the sample every 50ms tick.
//   - Whiff = quiet smoke puff + ramp reset, NO fake hit sound.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { isBrittle, damageMul, consumeConcussed, applyStatus, getStatus } from '../../effects/registry.js';
import { getStats, getFamilyStats } from '../_stats.js';
import { nearestPart, applyImpulseScaled, shatter } from '../_shared.js';

const TIP_OFFSET = 22;  // hilt -> bit tip (matches drawCursor: chuck + bit)

export const defaultStats = {
  range:     64,     // max distance cursor -> part to engage the bit
  force:     0.018,  // per-tick force-per-mass (light: the drill grinds, not flings)
  upBias:    0.004,  // mass-scaled upward kick per tick
  perTickMood: 1.4,  // mood bleed per contact tick (small; the BLEED DOT carries it)
  bleedMs:   6000,   // BLEED duration refreshed each tick
  maxCharge: 5,      // ramp ceiling, also the BLEED intensity cap (bleed maxes at 5)
  chargeStep: 1,     // ramp gain per held tick
  rampSfxMs: 110,    // min ms between drill SFX retriggers (throttle the loop)
  shake:     2,
};

// Module-level ramp accumulator. Single buddy -> module state is the idiom.
// Keyed to (epoch, partId): a buddy respawn bumps the epoch and a cursor move
// to another part changes partId, either resets the charge. Initial shape is
// the "no engagement" state so a fresh hold starts clean.
let _ramp = { epoch: -1, partId: -1, charge: 0 };
let _lastSfx = 0;

function resetRamp() {
  _ramp = { epoch: -1, partId: -1, charge: 0 };
}

export default {
  id: 'power_drill',          // MUST equal the ui/tools-table.js id
  defaultStats,
  apply(ctx) {
    const s = getStats('power_drill');
    const fam = getFamilyStats('melee');
    const { ragdoll, status, x, y, screenShake } = ctx;

    // Aim at the nearest part (same vector drawCursor uses), but only engage
    // if it's within drill reach, the bit is short.
    const part = nearestPart(ragdoll, x, y);
    if (!part) { resetRamp(); return; }
    const dxp = part.position.x - x, dyp = part.position.y - y;
    const dist = Math.hypot(dxp, dyp) || 1;
    if (dist > s.range) {
      // Whiff: out of reach. Quiet smoke puff, reset the ramp, no hit sound.
      resetRamp();
      P.burst(x, y, 3, { type: 'smoke', color: '#666', size: 5, life: 240, speedRange: 0.22, gravity: -0.0002 });
      return;
    }

    // Ramp bookkeeping: reset on buddy-swap (epoch) or target change (partId).
    if (_ramp.epoch !== ctx._epoch || _ramp.partId !== part.id) {
      _ramp = { epoch: ctx._epoch, partId: part.id, charge: 0 };
    }
    _ramp.charge = Math.min(_ramp.charge + s.chargeStep, s.maxCharge);

    // Brittle parts shatter under the bit before anything else.
    if (isBrittle(status, part)) shatter(ctx, part);

    // Damage gate: ALIGNED block / FINISHING voids the hit; concussed boosts it.
    const mul = damageMul(status, part);
    if (mul === 0) {
      P.burst(part.position.x, part.position.y, 4, { type: 'spark', color: '#7ec8ff', size: 3, life: 200 });
      return;
    }
    if (mul > 1) consumeConcussed(status, part);

    // Grind impulse: push the part along the cursor->part axis. Light force,
    // the drill bites and worries rather than launches. routes through
    // applyImpulseScaled -> damageMul + markHit + neighbor propagation.
    const { fx, fy } = applyImpulseScaled(part, dxp / dist, dyp / dist, s.force, s.upBias);

    // BLEED ramps with the dwell. Intensity tracks the held charge (capped at
    // the bleed engine's 5). bleedOnEdge (edged family flag) is irrelevant to
    // engage, the drill is the bleed producer here; but if the family flag is
    // on we floor the intensity at 1 immediately on first contact rather than
    // waiting a tick. Re-applying refreshes duration so the wound persists.
    const ramped = Math.min(_ramp.charge, s.maxCharge, 5);
    const floor = fam.bleedOnEdge ? 1 : 0;
    const existing = getStatus(status, part, 'bleed');
    const intensity = Math.min(Math.max(ramped, floor, existing?.intensity ?? 0), 5);
    if (intensity > 0) {
      applyStatus(status, part, 'bleed', { duration: s.bleedMs, source: 'power_drill', intensity });
    }

    // Per-tick mood scales with the ramp, deeper drilling hurts more. mul folds
    // in concussed/antitrust. Fast-ticking tool -> suppress speech (99999).
    const moodDelta = -(s.perTickMood * (1 + (ramped - 1) * 0.5)) * mul;
    ctx.reactTo?.({ source: 'power_drill', part, moodDelta, impulse: Math.hypot(fx, fy), speakMs: 99999 });

    // Looping drill SFX, throttled so the held whirr doesn't machine-gun.
    const now = performance.now();
    if (now - _lastSfx >= s.rampSfxMs) {
      _lastSfx = now;
      sfx['power_drill']?.();
    }

    // Light continuous rumble, scaled a touch by the ramp.
    ctx.hitStop?.projSmall?.();
    screenShake(s.shake + ramped * 0.3, 70);

    // Swarf + blood fleck spray, denser as the ramp climbs.
    const back = Math.atan2(-dyp, -dxp); // back toward the cursor (chips eject)
    const n = 3 + Math.round(ramped);
    for (let i = 0; i < n; i++) {
      const a2 = back + (Math.random() - 0.5) * 1.1;
      const red = Math.random() < 0.45;
      P.spawn({
        x: part.position.x, y: part.position.y,
        vx: Math.cos(a2) * (0.4 + Math.random() * 0.7),
        vy: Math.sin(a2) * (0.4 + Math.random() * 0.7) - 0.05,
        type: 'spark', color: red ? '#a8121a' : '#cdd2d6',
        size: 2 + Math.random() * 2,
        life: 260 + Math.random() * 180,
        gravity: 0.0012, drag: 0.99,
      });
    }
  },

  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    // Drill points +x: body/grip near origin, chuck, then the bit to the tip.
    // Body (the motor housing) sits behind the origin.
    rctx.fillStyle = '#1f6f3a';            // green drill body
    rctx.beginPath();
    rctx.moveTo(-18, -7);
    rctx.lineTo(2, -7);
    rctx.lineTo(2, 7);
    rctx.lineTo(-18, 7);
    rctx.closePath();
    rctx.fill();
    // Pistol grip dropping down-back.
    rctx.fillStyle = '#17331f';
    rctx.fillRect(-16, 5, 8, 12);
    // Chuck (metal collar).
    rctx.fillStyle = '#888c90';
    rctx.fillRect(2, -4, 8, 8);
    // Bit: a fluted twist drill tapering to the tip. Spin animation while held.
    const tip = TIP_OFFSET + (isDown ? 3 : 0);
    rctx.fillStyle = '#b8bdc2';
    rctx.beginPath();
    rctx.moveTo(10, -2.5);
    rctx.lineTo(tip - 4, -2.5);
    rctx.lineTo(tip, 0);                   // point
    rctx.lineTo(tip - 4, 2.5);
    rctx.lineTo(10, 2.5);
    rctx.closePath();
    rctx.fill();
    // Flute hatching, phase-animated so the bit visibly spins under the cursor.
    const phase = (performance.now() * 0.05) % 6;
    rctx.strokeStyle = '#70757a';
    rctx.lineWidth = 1;
    for (let fx = 11; fx < tip - 4; fx += 6) {
      const px = fx + (phase % 6);
      rctx.beginPath();
      rctx.moveTo(px, -2.5);
      rctx.lineTo(px + 3, 2.5);
      rctx.stroke();
    }
    if (isDown) {
      // A couple of chips flicking off the tip when active.
      rctx.fillStyle = '#a8121a';
      for (let i = 0; i < 3; i++) {
        rctx.fillRect(tip - i * 3, -1 + (Math.random() - 0.5) * 6, 1.5, 1.5);
      }
    }
    rctx.restore();
  },
};
