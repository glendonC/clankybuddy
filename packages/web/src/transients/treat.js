import * as P from '../particles.js';

export default {
  partType: 'treat',
  removeOnContact: true,
  onContact(self, target, ctx) {
    ctx.reactTo?.({ source: 'treat', part: target, moodDelta: 6, impulse: Math.hypot(self.velocity.x, self.velocity.y), speakMs: 800 });
    P.burst(self.position.x, self.position.y, 8, {
      type: 'heart', color: '#ff7eb6', size: 6, life: 800, speedRange: 0.4, gravity: -0.0003,
    });
  },
};
