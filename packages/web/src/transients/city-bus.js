// City bus per-contact handler (PER-SUBSTEP: the force/velocity + status lane).
// The SCOOP verb: on contact the bus carries the struck part off-stage with a
// STRONG sustained horizontal velocity in the roll direction (plus a slight
// upward lift so the part rides the scoop instead of being driven into the
// floor). This shoves the persistent buddy off-screen — it then drifts/falls
// back naturally. We NEVER despawn or respawn the ragdoll.
//
// removeOnContact:false + multiContact:true so the bus keeps moving and keeps
// re-applying the carry shove every frame it overlaps a part (no per-part
// throttle here — sustained carry is the point; we just guard the heavy
// react/stun/SFX with a per-part throttle so they don't spam).

import Matter from 'matter-js';
import * as P from '../particles.js';
import { applyStatus, isBrittle, damageMul, consumeConcussed } from '../effects/registry.js';
import { shatter } from '../abilities/_shared.js';
import { stun, goLimp } from '../physics/stand.js';

const { Body } = Matter;

const REACT_THROTTLE_MS = 260;   // gate the heavy react/stun/SFX, not the shove

export default {
  partType: 'city_bus',
  removeOnContact: false,    // keeps crossing the stage
  multiContact:    true,     // scoop every part it contacts, re-shove each frame
  onContact(self, target, ctx) {
    // SUSTAINED CARRY SHOVE every contact frame: drive the part in the roll
    // direction at well above the bus speed so it's swept off-screen, with a
    // small upward lift so it rides the scoop. setVelocity (kinematic-style
    // direct set) is the off-stage removal verb — NOT a ragdoll delete.
    Body.setVelocity(target, {
      x: self._vx * 1.55,
      y: Math.min(target.velocity.y, 0) - 4,
    });

    const now = performance.now();
    if (target._lastScoop && now - target._lastScoop < REACT_THROTTLE_MS) return;
    target._lastScoop = now;

    if (isBrittle(ctx.status, target)) shatter(ctx, target);

    const mul = damageMul(ctx.status, target);
    if (mul > 1) consumeConcussed(ctx.status, target);
    applyStatus(ctx.status, target, 'concussed', { duration: 3500, source: self._verb });

    stun(ctx.ragdoll, 500);
    goLimp(ctx.ragdoll, 400);

    ctx.reactTo?.({
      source: self._verb,
      part: target,
      moodDelta: -(self._mood ?? 20) * mul,
      impulse: 9,
      speakMs: target === ctx.ragdoll?.head ? 650 : 99999,
    });

    P.burst(target.position.x, target.position.y, 8, {
      type: 'smoke', color: '#3a3a40', size: 12, life: 520, speedRange: 0.5, gravity: -0.0005,
    });
    ctx.screenShake?.(7, 160);
  },
};
