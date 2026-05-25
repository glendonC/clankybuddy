// Saw blade, spinning ricocheting projectile from `sawblade` ability.
// Lives ~1.4s, bounces off walls via high restitution, deals impact damage
// on first ragdoll-part contact then expires. The "3 ricochets" promise in
// the blurb is enforced by lifeMs, at typical wall geometry the disc gets
// 2-4 wall hits before it self-expires.
//
// Identity: pure ricochet damage. No DoT, that's chainsaw / bear-trap /
// meathook territory. Sawblade's signature is the bounce-and-bite, not the
// wound that lingers.

import Matter from 'matter-js';
import * as P from '../particles.js';
// mood via ctx.reactTo.
import { isBrittle, damageMul, consumeConcussed } from '../effects/registry.js';
import { shatter } from '../abilities/_shared.js';

const { Body } = Matter;

export default {
  partType: 'sawblade',
  removeOnContact: true,
  onContact(self, target, ctx) {
    if (isBrittle(ctx.status, target)) shatter(ctx, target);
    const dirx = self.velocity.x, diry = self.velocity.y;
    const len = Math.hypot(dirx, diry) || 1;
    const dmg = self.bladeDamage ?? 12;
    const forceScale = 0.06 + dmg * 0.01;
    const fx = (dirx / len) * forceScale * target.mass;
    const fy = (diry / len) * forceScale * target.mass;
    Body.applyForce(target, target.position, { x: fx, y: fy });
    const mul = damageMul(ctx.status, target);
    if (mul > 1) consumeConcussed(ctx.status, target);
    ctx.reactTo?.({ source: 'sawblade', part: target, moodDelta: -dmg * mul, impulse: Math.hypot(fx, fy), speakMs: 600 });
    P.burst(self.position.x, self.position.y, 14, {
      type: 'spark', color: '#a8121a', size: 4, life: 420, speedRange: 1.1, gravity: 0.0014,
    });
    P.burst(self.position.x, self.position.y, 6, {
      type: 'spark', color: '#fff', size: 2, life: 220, speedRange: 1.4,
    });
    ctx.screenShake?.(6, 140);
  },
};
