// Nail gun, Kinetic group. Batch 3B. SIMPLEST form: a point-hold
// bleed/stack tool. NOT a projectile. On each hold-fire it finds the
// nearest part in range, drives a small impulse into it, stacks BLEED
// (the nail wound deepens with every tick), and pins the part with a
// short stun (electrified convulsion = the visible momentary lock).
//
// Mechanic notes:
//   - kind 'hold' in ui/tools-table.js, so apply() is re-called on the
//     hold throttle (~50ms). The BLEED DOT is driven by the status
//     registry tick, NO setTimeout needed; the per-part stun is short
//     (s.stunMs) and re-applied each fire while the gun dwells.
//   - BLEED stacks intensity (capped at 5×), same idiom as chainsaw:
//     every fire bumps the existing wound up by 1.
//   - Whiffs are a quiet smoke puff with NO hit sound (misses must not
//     sound like connects).
//   - Staccato nailer SFX per fire via sfx.nail_gun (called defensively).
//
// Phase: kinetic. Pairs with freeze, shatters brittle parts first like
// every other melee tool for parity.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood + speech routed through ctx.reactTo.
import {
  isBrittle, damageMul, consumeConcussed, applyStatus, getStatus,
} from '../../effects/registry.js';
import { getStats, getFamilyStats } from '../_stats.js';
import { partInRange, applyImpulseScaled, shatter } from '../_shared.js';

export const defaultStats = {
  range:      66,      // point-hold reach
  force:      0.045,   // force-per-mass (light staple, lighter than punch)
  upBias:     0.01,    // small mass-scaled upward kick
  perTickMood: 2,      // per-fire mood damage (fast tool, low per-hit)
  bleedMs:    7000,    // BLEED refresh duration
  stunMs:     220,     // short per-part pin (electrified convulsion)
  shake:      3,
};

export default {
  id: 'nail_gun',                // MUST equal the ui/tools-table.js id
  defaultStats,
  apply(ctx) {
    const s = getStats('nail_gun');
    const fam = getFamilyStats('melee');
    const { ragdoll, status, x, y, screenShake } = ctx;

    const part = partInRange(ragdoll, x, y, s.range);
    if (!part) {
      // whiff, quiet smoke puff, no fake hit-sound.
      P.burst(x, y, 3, { type: 'smoke', color: '#666', size: 5, life: 240, speedRange: 0.22, gravity: -0.0002 });
      return;
    }

    if (isBrittle(status, part)) shatter(ctx, part);

    const mul = damageMul(status, part);
    if (mul === 0) {
      // ALIGNED block / FINISHING, hit voided. Faint deflect spark.
      P.burst(part.position.x, part.position.y, 4, { type: 'spark', color: '#7ec8ff', size: 3, life: 200 });
      return;
    }
    if (mul > 1) consumeConcussed(status, part);

    // Small impulse straight from cursor into the part.
    const dxp = part.position.x - x, dyp = part.position.y - y;
    const len = Math.hypot(dxp, dyp) || 1;
    const { fx, fy } = applyImpulseScaled(part, dxp / len, dyp / len, s.force, s.upBias);

    // BLEED stack, every fire deepens the wound (cap 5×). Family flurry
    // grants a second simultaneous stack tick; bleedOnEdge is a no-op
    // here (this tool always bleeds), so we just respect flurry by
    // bumping intensity an extra step in the same fire.
    const existing = getStatus(status, part, 'bleed');
    const step = fam.flurry ? 2 : 1;
    const intensity = Math.min((existing?.intensity ?? 0) + step, 5);
    applyStatus(status, part, 'bleed', { duration: s.bleedMs, source: 'nail_gun', intensity });

    // Short per-part pin: a nail through the limb locks it momentarily.
    // electrified = the existing brief-convulsion / stun status.
    applyStatus(status, part, 'electrified', { duration: s.stunMs, source: 'nail_gun' });

    // Fast-ticking, suppress speech chatter (speakMs:99999).
    ctx.reactTo?.({
      source: 'nail_gun', part,
      moodDelta: -s.perTickMood * mul,
      impulse: Math.hypot(fx, fy),
      speakMs: 99999,
    });

    sfx['nail_gun']?.();
    screenShake(s.shake, 80);
    ctx.hitStop?.projSmall?.();

    // Metal staple spark + a fleck of red.
    P.burst(part.position.x, part.position.y, 6, { type: 'spark', color: '#cdd2d8', size: 2.5, life: 220, speedRange: 0.7 });
    P.burst(part.position.x, part.position.y, 2, { type: 'spark', color: '#a8121a', size: 2,   life: 300, speedRange: 0.4, gravity: 0.0014 });
  },

  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    if (isDown) rctx.translate(4, 0);   // tiny recoil hop forward into the part

    // body (pistol-grip nailer), drawn along +x with the muzzle at the tip
    rctx.fillStyle = '#c14a2a';          // orange-red tool body
    rctx.fillRect(-6, -7, 20, 14);       // main housing
    rctx.fillStyle = '#9a3a20';
    rctx.fillRect(-10, 2, 8, 16);        // grip angled down-back
    // magazine rail under the nose
    rctx.fillStyle = '#3a3a3e';
    rctx.fillRect(0, 6, 18, 4);
    // muzzle / nose
    rctx.fillStyle = '#2a2a2e';
    rctx.fillRect(14, -3, 8, 6);
    // nail flash at the tip while firing
    if (isDown) {
      rctx.fillStyle = '#dfe6ec';
      rctx.fillRect(22, -1, 5, 2);
      rctx.fillStyle = 'rgba(255,210,120,0.8)';
      rctx.beginPath();
      rctx.arc(22, 0, 3, 0, Math.PI * 2);
      rctx.fill();
    }
    rctx.restore();
  },
};
