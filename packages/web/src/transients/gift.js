import * as P from '../particles.js';
import { sfx } from '../audio/sfx.js';

// Box "opens" on impact: ribbon shreds (gold) + paper bits (pink) + confetti
// stars burst out, plus a celebratory ding (gpu sfx has the right ascending
// arpeggio to read as "ding!" without a dedicated entry).
const RIBBON_COLORS  = ['#f2c45c', '#ffd266', '#fff7c2'];
const PAPER_COLORS   = ['#f25c8a', '#ff7eb6', '#ffb4d2'];
const CONFETTI_COLOR = ['#5cf2a0', '#9be7ff', '#a78bfa', '#f2c45c'];

export default {
  partType: 'gift',
  removeOnContact: true,
  onContact(self, target, ctx) {
    ctx.reactTo?.({ source: 'gift', part: target, moodDelta: 12, impulse: Math.hypot(self.velocity.x, self.velocity.y), speakMs: 700 });
    const x = self.position.x, y = self.position.y;
    // hearts (kept from original)
    P.burst(x, y, 8, { type: 'star', color: '#f2c45c', size: 5, life: 900, speedRange: 0.6, gravity: -0.0003 });
    // ribbon shreds, gold particles falling
    for (let i = 0; i < 6; i++) {
      P.spawn({ x: x + (Math.random() - 0.5) * 12, y, vx: (Math.random() - 0.5) * 1.2, vy: -1 - Math.random() * 1.2,
        type: 'star', color: RIBBON_COLORS[i % RIBBON_COLORS.length],
        size: 4, life: 1100, gravity: 0.0008, drag: 0.99 });
    }
    // paper bits
    for (let i = 0; i < 8; i++) {
      P.spawn({ x: x + (Math.random() - 0.5) * 12, y, vx: (Math.random() - 0.5) * 1.6, vy: -0.8 - Math.random() * 1.4,
        type: 'spark', color: PAPER_COLORS[i % PAPER_COLORS.length],
        size: 3, life: 900, gravity: 0.001, drag: 0.99 });
    }
    // confetti starburst
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.2;
      P.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4,
        type: 'star', color: CONFETTI_COLOR[i % CONFETTI_COLOR.length],
        size: 4, life: 1200, gravity: 0.0006, drag: 0.99 });
    }
    sfx.gpu();        // ascending three-note ding doubles as "presents!"
    ctx.screenShake?.(3, 200);
  },
};
