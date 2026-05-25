// Bear trap, drag-placed static sensor. Sits on the ground at the
// drop position. On first contact with a buddy part:
//   - stuns the ragdoll (locks all parts) for 3s,
//   - applies BLEED to the contact part (long duration so the pain stays
//     after the trap releases),
//   - applies CONCUSSED to the contact part, bear trap is a "stun-and-mark"
//     setup tool: while pinned, the part takes 1.5× from the next hit. That's
//     bear trap's identity vs. chainsaw (stacking) and meathook (yank).
//   - removes the trap.
//
// Visual: open jaw at idle, slams shut on snap (rendered by ability
// drawCursor and a brief particle burst here on contact). Phase 7 visceral
// redirect addition.

import * as P from '../particles.js';
import { applyStatus } from '../effects/registry.js';
import { stun } from '../physics/stand.js';

export default {
  partType: 'bear_trap',
  removeOnContact: true,
  onContact(self, target, ctx) {
    stun(ctx.ragdoll, 3000);
    applyStatus(ctx.status, target, 'bleed', { duration: 8000, source: 'bear_trap' });
    applyStatus(ctx.status, target, 'concussed', { duration: 5000, source: 'bear_trap' });
    P.burst(self.position.x, self.position.y, 16, {
      type: 'spark', color: '#a8121a', size: 4, life: 480, speedRange: 1.0, gravity: 0.0014,
    });
    P.burst(self.position.x, self.position.y, 8, {
      type: 'spark', color: '#cdd', size: 3, life: 300, speedRange: 1.4,
    });
    ctx.screenShake?.(10, 220);
  },
};
