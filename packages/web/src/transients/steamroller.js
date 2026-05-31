// Steamroller per-contact handler (PER-SUBSTEP: the force/velocity + status
// lane). The body's onTick maintains the roll kinematically; THIS runs once per
// collision while the drum is crossing a ragdoll part. It flattens the part
// (downward squash velocity + a forward shove in the roll direction) and applies
// 'concussed'. removeOnContact:false + multiContact:true so the roller keeps
// going and can flatten every part it crosses; a per-part throttle stops a
// single part from being re-squashed every substep.

import Matter from 'matter-js';
import * as P from '../particles.js';
import { applyStatus, isBrittle, damageMul, consumeConcussed } from '../effects/registry.js';
import { shatter } from '../abilities/_shared.js';
import { stun, goLimp } from '../physics/stand.js';

const { Body } = Matter;

const THROTTLE_MS = 220;   // min gap before the same part is squashed again

export default {
  partType: 'steamroller',
  removeOnContact: false,    // keeps rolling across the body
  multiContact:    true,     // hit every part it crosses; throttle per-part
  onContact(self, target, ctx) {
    const now = performance.now();
    if (target._lastRoll && now - target._lastRoll < THROTTLE_MS) return;
    target._lastRoll = now;

    if (isBrittle(ctx.status, target)) shatter(ctx, target);

    // Flatten: slam the part down + shove it forward in the roll direction so
    // it reads as being run over, not bounced off.
    Body.setVelocity(target, {
      x: target.velocity.x + self._vx * 0.45,
      y: target.velocity.y + 7,
    });

    const mul = damageMul(ctx.status, target);
    if (mul > 1) consumeConcussed(ctx.status, target);
    applyStatus(ctx.status, target, 'concussed', { duration: 4500, source: self._verb });

    stun(ctx.ragdoll, 400);
    goLimp(ctx.ragdoll, 320);

    ctx.reactTo?.({
      source: self._verb,
      part: target,
      moodDelta: -(self._mood ?? 24) * mul,
      impulse: 7,
      speakMs: target === ctx.ragdoll?.head ? 600 : 99999,
    });

    P.burst(target.position.x, target.position.y, 12, {
      type: 'smoke', color: '#2c2c30', size: 14, life: 600, speedRange: 0.5, gravity: -0.0004,
    });
    P.burst(target.position.x, target.position.y, 6, {
      type: 'spark', color: '#cfd6dc', size: 3, life: 280, speedRange: 1.2,
    });
    ctx.screenShake?.(9, 180);
  },
};
