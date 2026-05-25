import * as P from '../particles.js';
import { applyStatus, removeStatus } from '../effects/registry.js';

export default {
  partType: 'gpu',
  removeOnContact: true,
  onContact(self, target, ctx) {
    if (self._spent) return;
    self._spent = true;
    // _personaMul captured at cast time (gpu.js apply), Llama gets 0.5× sustained.
    // _contactDuration is set on the card by gpu.js so the Overclock upgrade
    // (5000 → 7500ms) flows through to the powered window when the card lands.
    const mul = self._personaMul ?? 1.0;
    const duration = self._contactDuration ?? 5000;
    for (const p of ctx.ragdoll.parts) {
      applyStatus(ctx.status, p, 'powered', { duration, source: 'gpu', data: { mul } });
      // GPU heal cleans bleed off every part, green-mana cure for the gore DoT.
      removeStatus(ctx.status, p, 'bleed', 'gpu-heal');
    }
    P.burst(self.position.x, self.position.y, 18, { type: 'star',  color: '#5cf2a0', size: 4, life: 900, speedRange: 0.6, gravity: -0.0003 });
    P.burst(self.position.x, self.position.y, 10, { type: 'spark', color: '#fff',    size: 3, life: 400, speedRange: 0.7 });
  },
};
