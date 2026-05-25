// Meat hook, drag-thrown projectile. On contact with a buddy part, yanks
// the part BACK toward the throw origin (the release point captured on the
// hook as `_originX/_originY`) and applies BLEED. Hook removes itself on
// first contact.
//
// Mechanic: unlike a saw blade (ricochet) or a bullet (straight-line damage),
// the meat hook's signature is the yank, it speared the part, now it pulls
// it back along the rope toward the cursor. Velocity is set additively so a
// full chain of hooks really drags a knocked-out body across the stage.

import Matter from 'matter-js';
import * as P from '../particles.js';
import { sfx } from '../audio/sfx.js';
// mood via ctx.reactTo.
import { applyStatus, damageMul, consumeConcussed } from '../effects/registry.js';
import { goLimp } from '../physics/stand.js';

const { Body } = Matter;

export default {
  partType: 'meathook',
  removeOnContact: true,
  onContact(self, target, ctx) {
    // Yank-back: pull the impacted part toward the throw origin (release
    // point). Falls back to reversed travel direction if origin wasn't set.
    let dirx, diry;
    if (typeof self._originX === 'number' && typeof self._originY === 'number') {
      dirx = self._originX - target.position.x;
      diry = self._originY - target.position.y;
    } else {
      dirx = -self.velocity.x;
      diry = -self.velocity.y;
    }
    const len = Math.hypot(dirx, diry) || 1;
    // Yank magnitude: enough to drag a 60kg ragdoll part across the stage.
    const yank = 16;
    Body.setVelocity(target, {
      x: target.velocity.x + (dirx / len) * yank,
      y: target.velocity.y + (diry / len) * yank * 0.7,
    });
    Body.setAngularVelocity(target, target.angularVelocity + (Math.random() - 0.5) * 1.2);
    goLimp(ctx.ragdoll, 600);

    const mul = damageMul(ctx.status, target);
    if (mul > 1) consumeConcussed(ctx.status, target);
    ctx.reactTo?.({ source: 'meathook', part: target, moodDelta: -8 * mul, impulse: yank, speakMs: 600 });
    applyStatus(ctx.status, target, 'bleed', { duration: 5000, source: 'meathook' });

    P.burst(self.position.x, self.position.y, 14, {
      type: 'spark', color: '#a8121a', size: 4, life: 460, speedRange: 1.0, gravity: 0.0012,
    });
    P.burst(self.position.x, self.position.y, 6, {
      type: 'spark', color: '#cdd', size: 2, life: 220, speedRange: 1.2,
    });
    sfx.shatter?.();         // reuse the meaty thunk
    ctx.screenShake?.(8, 180);
  },
};
