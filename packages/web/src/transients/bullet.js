import Matter from 'matter-js';
import * as P from '../particles.js';
// mood via ctx.reactTo (source taken from self._verb set by the spawning ability).
import { stun } from '../physics/stand.js';
import { isBrittle, hasStatus, applyStatus } from '../effects/registry.js';
import { shatter, explode } from '../abilities/_shared.js';
import { getFamilyStats } from '../abilities/_stats.js';

const { Body } = Matter;

export default {
  partType: 'bullet',
  removeOnContact: true,
  onContact(self, target, ctx) {
    const dirx = self.velocity.x, diry = self.velocity.y;
    const len = Math.hypot(dirx, diry) || 1;
    const dmg = self.bulletDamage ?? 8;
    // Brittle (frozen) parts shatter, chance scaled by bullet damage.
    // Heavy slug (10) ≈ 100%, machinegun (1.5) ≈ 15%, shotgun pellet (0.4) ≈ 4%.
    if (isBrittle(ctx.status, target) && Math.random() < dmg * 0.1) {
      shatter(ctx, target);
    }
    // knockback scales with damage: heavy slug shoves hard, machinegun barely pushes
    const forceScale = 0.04 + dmg * 0.014;
    const fx = (dirx / len) * forceScale * target.mass;
    const fy = (diry / len) * forceScale * target.mass;
    Body.applyForce(target, target.position, { x: fx, y: fy });
    const moodDelta = -dmg;
    // Source pulled from self._verb (set by the spawning ability, gun /
    // machinegun / shotgun) so the right persona pool drives the speech.
    ctx.reactTo?.({ source: self._verb || 'bullet', part: target, moodDelta, impulse: Math.hypot(fx, fy), speakMs: 600 });
    if (self.bulletStun) stun(ctx.ragdoll, self.bulletStun);
    P.burst(self.position.x, self.position.y, Math.min(20, 8 + dmg), { type: 'spark', color: '#f25c5c', size: 3, life: 380, speedRange: 0.9 });
    P.burst(self.position.x, self.position.y, 4, { type: 'smoke', color: '#666', size: 6, life: 400, speedRange: 0.3, gravity: -0.0002 });
    ctx.screenShake(Math.min(8, 2 + dmg * 0.3), 100);

    // Firearms ammo mods (cross-tool shared flags from the firearms family
    // bag). Owned once, they apply to EVERY firearm's rounds — that's the
    // payoff of the `shared` node kind.
    const ammo = getFamilyStats('firearms');
    if (ammo.hollowPoint) {
      applyStatus(ctx.status, target, 'bleed', { source: self._verb || 'bullet' });
    }
    if (ammo.incendiary && !hasStatus(ctx.status, target, 'frozen')) {
      applyStatus(ctx.status, target, 'on_fire', { source: self._verb || 'bullet' });
    }
    if (ammo.he) {
      // Small high-explosive pop on impact. Silent + low-shake so rapid fire
      // doesn't turn into a screen-quake; the AOE is the point.
      explode(ctx, self.position.x, self.position.y, {
        radius: 60, baseVel: 6, upBias: 2, moodDelta: -3,
        stunMs: 0, shake: 2, igniteMs: 0, sound: null, limpMs: 0,
      });
    }
  },
};
