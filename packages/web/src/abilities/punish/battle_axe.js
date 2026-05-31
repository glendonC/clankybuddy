// Battle axe, kinetic (branches off the machete, tool id 'sword'). A heavy
// two-handed CLEAVE: one big overhead chop that flings everything around the
// impact point. Unlike the point-impulse fist tools, the axe's mass carries
// through — bigImpact gives a wide radial shove (the squash/splash lane) so a
// limb cluster scatters from a single blow. Edged: with the melee family's
// bleedOnEdge flag it opens BLEED on every part it bites, even a clean hit.
// flurry lands a synchronous second chop the same frame at a small offset.
//
// kind: click. Whiffs are a quiet smoke puff with NO chop sound — a miss must
// not sound like a connect.

import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { flinch } from '../../effects/_locomotion.js';
import { isBrittle, damageMul, consumeConcussed, applyStatus, getStatus } from '../../effects/registry.js';
import { getStats, getFamilyStats } from '../_stats.js';
import { partInRange, nearestPart, bigImpact, shatter } from '../_shared.js';

export const defaultStats = {
  range:       96,     // how close the cursor must be to a part to land a chop
  radius:      120,    // cleave blast radius
  baseVel:     16,     // strong radial velocity at the epicenter
  upBias:      3,      // mass-scaled upward kick (limbs pop off the ground)
  mood:        20,     // heavy single-strike damage (handed to bigImpact)
  bleedMs:     7000,   // edged bleed duration when bleedOnEdge is on
  stunMs:      720,
  limpMs:      700,
  shake:       16,
  flurryRadius: 84,    // second chop's reach
  flurryVel:    9,     // second chop's velocity (~0.5x primary)
  flurryOffset: 18,    // spatial offset of the follow-up chop
};

// Open / deepen a bleed on a part, capped at intensity 5. Mirrors the
// chainsaw idiom so a re-chop stacks the wound.
function openBleed(status, part, bleedMs) {
  const existing = getStatus(status, part, 'bleed');
  const intensity = Math.min((existing?.intensity ?? 0) + 1, 5);
  applyStatus(status, part, 'bleed', { duration: bleedMs, source: 'battle_axe', intensity });
}

// Every part whose CENTER is inside `radius` of (cx,cy). Used to enumerate the
// cleave's victims for shatter + edged bleed (bigImpact owns the impulse/mood).
function partsInRadius(ragdoll, cx, cy, radius) {
  const out = [];
  for (const p of ragdoll?.parts ?? []) {
    if (Math.hypot(p.position.x - cx, p.position.y - cy) <= radius) out.push(p);
  }
  return out;
}

export default {
  id: 'battle_axe',
  defaultStats,
  apply(ctx) {
    const s = getStats('battle_axe');
    const fam = getFamilyStats('melee');
    const { ragdoll, status, x, y, screenShake, hitStop } = ctx;

    // Must be near a part to commit the swing — otherwise it's a whiff.
    if (!partInRange(ragdoll, x, y, s.range)) {
      P.burst(x, y, 5, { type: 'smoke', color: '#666', size: 8, life: 320, speedRange: 0.28, gravity: -0.0002 });
      return;
    }

    // Epicenter the cleave on the nearest part so the chop reads as a hit on a
    // limb rather than thin air next to it.
    const target = nearestPart(ragdoll, x, y);
    const cx = target ? target.position.x : x;
    const cy = target ? target.position.y : y;

    // Shatter any brittle (frozen) part the cleave will catch BEFORE the shove,
    // so the shatter burst fires on the same frame as the chop.
    const victims = partsInRadius(ragdoll, cx, cy, s.radius);
    for (const p of victims) if (isBrittle(status, p)) shatter(ctx, p);

    // Damage-gate the swing: if the nearest part is ALIGNED-blocking or the
    // buddy is FINISHING, void the chop (matches the per-hit mul===0 rule).
    if (target && damageMul(status, target) === 0) {
      P.burst(cx, cy, 4, { type: 'spark', color: '#7ec8ff', size: 3, life: 200 });
      return;
    }

    // Heavy radial cleave. bigImpact owns the impulse (splash lane), the mood
    // delta (with its own concussed-consume + reactTo per part) and the chop
    // SFX. moodDelta is negative damage.
    bigImpact(ctx, cx, cy, {
      radius:    s.radius,
      baseVel:   s.baseVel,
      upBias:    s.upBias,
      moodDelta: -s.mood,
      stunMs:    0,           // we drive stun/limp ourselves below
      shake:     0,           // and shake, so the values stay tunable here
      limpMs:    0,
      sound:     'battle_axe',
    });

    // Edged: open BLEED on every part the cleave bit (clean hit included).
    if (fam.bleedOnEdge) {
      for (const p of victims) openBleed(status, p, s.bleedMs);
    }

    // flurry: a synchronous second chop the same frame, offset and at ~half
    // velocity. No setTimeout — the velocity injection integrates this physics
    // step, so there's no epoch/character-swap misfire risk.
    if (fam.flurry) {
      const fcx = cx + s.flurryOffset, fcy = cy - s.flurryOffset;
      const followUp = partsInRadius(ragdoll, fcx, fcy, s.flurryRadius);
      for (const p of followUp) if (isBrittle(status, p)) shatter(ctx, p);
      bigImpact(ctx, fcx, fcy, {
        radius:    s.flurryRadius,
        baseVel:   s.flurryVel,
        upBias:    s.upBias * 0.5,
        moodDelta: -s.mood * 0.5,
        stunMs:    0,
        shake:     0,
        limpMs:    0,
        sound:     'battle_axe',
      });
      if (fam.bleedOnEdge) for (const p of followUp) openBleed(status, p, s.bleedMs);
    }

    stun(ragdoll, s.stunMs);
    flinch(ragdoll, cx, cy, 1.0);
    if (target && damageMul(status, target) > 1) consumeConcussed(status, target);
    hitStop?.heavy();
    screenShake(s.shake, 360);

    // Chop VFX: a fan of sparks (steel bite) + a wet red spray on the bite line.
    P.burst(cx, cy, 20, { type: 'spark', color: '#e8edf2', size: 4, life: 420, speedRange: 1.1 });
    P.burst(cx, cy, 10, { type: 'spark', color: '#a8121a', size: 3, life: 360, speedRange: 0.9 });
    P.burst(cx, cy,  6, { type: 'smoke', color: '#777',    size: 12, life: 600, speedRange: 0.2, gravity: -0.0003 });
  },

  drawCursor(rctx, { x, y, angle, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.rotate(angle ?? 0);
    // Mid-swing: rock the axe forward as the cleave commits.
    if (isDown) { rctx.translate(8, 2); rctx.rotate(0.35); }

    // Haft, extending +x from the grip.
    rctx.fillStyle = '#6b4326';
    rctx.fillRect(-6, -2.5, 46, 5);
    rctx.fillStyle = '#4a2d18';
    rctx.fillRect(-6, -2.5, 46, 1.5);

    // Steel head at the far end of the haft.
    rctx.fillStyle = '#9aa3ab';
    rctx.beginPath();
    rctx.moveTo(34, -4);
    rctx.lineTo(50, -14);   // top horn
    rctx.lineTo(56, -2);    // edge top
    rctx.lineTo(56, 4);     // edge bottom
    rctx.lineTo(50, 14);    // bottom horn
    rctx.lineTo(34, 4);
    rctx.closePath();
    rctx.fill();
    // Bevel highlight along the bit.
    rctx.strokeStyle = '#d7dde2';
    rctx.lineWidth = 1.5;
    rctx.beginPath();
    rctx.moveTo(54, -8);
    rctx.lineTo(54, 8);
    rctx.stroke();
    // Eye / collar where the head meets the haft.
    rctx.fillStyle = '#5b636b';
    rctx.fillRect(34, -5, 4, 10);

    rctx.restore();
  },
};
