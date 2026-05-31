// Cattle prod, Kinetic group. CLICK melee jab (kind 'click'). Short-range
// point poke that ELECTRIFIES the struck part (brief convulsions); if the
// part is already brittle (frozen) the jab shatters it instead of zapping a
// dead limb. Light hit-stop, electric zap SFX.
//
// Mechanic notes:
//   - partInRange short reach (shorter than punch). Whiff = quiet smoke puff,
//     no fake hit sound.
//   - damageMul gate: 0 (ALIGNED block / FINISHING) skips the hit cleanly;
//     >1 (concussed) consumes the buff and scales mood damage.
//   - Brittle parts shatter first (shatter() removes frozen + plays kchhhing).
//   - bleedOnEdge family flag does NOT apply here (the prod is unedged); only
//     the flurry flag could land a synchronous follow-up, but a click jab
//     keeps it a single poke per fire, so we honor neither edged behavior.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { flinch } from '../../effects/_locomotion.js';
import { isBrittle, damageMul, consumeConcussed, applyStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { partInRange, applyImpulseScaled, shatter } from '../_shared.js';

export const defaultStats = {
  range:          62,     // short reach, jab in close
  force:          0.045,  // multiplied by part.mass internally
  mood:           7,      // damage on connect (subtracted)
  upBias:         0.02,   // mass-scaled upward kick
  electrifiedMs:  600,    // convulsion window
  stunMs:         300,
  shake:          5,
};

export default {
  id: 'cattle_prod',
  defaultStats,
  apply(ctx) {
    const s = getStats('cattle_prod');
    const { ragdoll, status, x, y, screenShake, hitStop } = ctx;
    const part = partInRange(ragdoll, x, y, s.range);
    if (!part) {
      // Whiff, quiet smoke puff. No fake zap sound (misses must not sound
      // like connects).
      P.burst(x, y, 4, { type: 'smoke', color: '#666', size: 6, life: 280, speedRange: 0.25, gravity: -0.0002 });
      return;
    }
    // Brittle (frozen) part: the jab shatters it instead of zapping.
    if (isBrittle(status, part)) shatter(ctx, part);
    // Damage gate: ALIGNED block / FINISHING voids the hit.
    const mul = damageMul(status, part);
    if (mul === 0) {
      P.burst(part.position.x, part.position.y, 4, { type: 'spark', color: '#7ec8ff', size: 3, life: 200 });
      return;
    }
    if (mul > 1) consumeConcussed(status, part);
    // Point impulse, cursor -> part, mass-scaled with an upward bias.
    const dxp = part.position.x - x, dyp = part.position.y - y;
    const len = Math.hypot(dxp, dyp) || 1;
    const { fx, fy } = applyImpulseScaled(part, dxp / len, dyp / len, s.force, s.upBias);
    // ELECTRIFIED, brief convulsions.
    applyStatus(status, part, 'electrified', { duration: s.electrifiedMs, source: 'cattle_prod' });
    ctx.reactTo?.({ source: 'cattle_prod', part, moodDelta: -(s.mood * mul), impulse: Math.hypot(fx, fy), speakMs: 500 });
    stun(ragdoll, s.stunMs);
    flinch(ragdoll, x, y, 0.6);
    sfx.cattle_prod?.();
    hitStop?.light();
    screenShake(s.shake, 180);
    // Electric arc burst, blue-white sparks off the contact point.
    P.burst(part.position.x, part.position.y, 14, { type: 'spark', color: '#aee3ff', size: 3, life: 320, speedRange: 0.9 });
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      P.spawn({
        x: part.position.x, y: part.position.y,
        vx: Math.cos(a) * (0.4 + Math.random() * 0.6),
        vy: Math.sin(a) * (0.4 + Math.random() * 0.6),
        type: 'spark', color: '#ffffff', size: 2, life: 220, gravity: 0, drag: 0.98,
      });
    }
  },
  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    if (isDown) rctx.translate(5, 0);
    // Handle (insulated grip).
    rctx.fillStyle = '#222428';
    rctx.fillRect(-16, -4, 18, 8);
    rctx.fillStyle = '#ff7a1a';   // orange grip band
    rctx.fillRect(-14, -3, 5, 6);
    // Shaft.
    rctx.fillStyle = '#9aa3ac';
    rctx.fillRect(2, -2, 28, 4);
    // Twin electrode prongs at the tip.
    rctx.fillStyle = '#cdd6df';
    rctx.fillRect(30, -5, 3, 4);
    rctx.fillRect(30, 1, 3, 4);
    rctx.fillStyle = '#d33';      // red prong caps
    rctx.fillRect(33, -5, 2, 4);
    rctx.fillRect(33, 1, 2, 4);
    if (isDown) {
      // Arc between the prongs while firing.
      rctx.strokeStyle = '#aee3ff';
      rctx.lineWidth = 1.2;
      rctx.beginPath();
      rctx.moveTo(35, -3);
      rctx.lineTo(38 + (Math.random() - 0.5) * 3, 0);
      rctx.lineTo(35, 3);
      rctx.stroke();
    }
    rctx.restore();
  },
};
