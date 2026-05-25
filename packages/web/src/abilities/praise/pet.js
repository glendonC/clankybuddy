import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { moodState } from '../../mood.js';
import { nearestPart, applyImpulse } from '../_shared.js';

const HIGH_MOOD_STATES = new Set(['ECSTATIC', 'HAPPY']);

export default {
  id: 'pet',
  apply(ctx) {
    const { ragdoll, mood, x, y, dx, dy } = ctx;
    const part = nearestPart(ragdoll, x, y);
    if (!part) return;
    const fx = (dx ?? 0) * 0.00006;
    const fy = (dy ?? -0.5) * 0.00006;
    applyImpulse(part, fx, fy);
    // Throttle the verbal reaction to ~once per 1.2s so the buddy doesn't
    // chatter every mousemove. reactTo handles mood + shock (negligible at
    // +1) + telemetry + pool lookup via the 'pet' key in personas.
    ctx.reactTo?.({ source: 'pet', part, moodDelta: 1.0, impulse: Math.hypot(fx, fy), speakMs: 1200 });
    // Hearts every other-ish call (was 7%), pet should feel responsive.
    if (Math.random() < 0.45) {
      P.spawn({ x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 0.25, vy: -0.3 - Math.random() * 0.3,
        type: 'heart', color: '#ff7eb6', size: 6 + Math.random() * 3, life: 900, gravity: -0.0002 });
    }
    // Sparkle when the buddy's already happy, extra reward at high mood.
    if (HIGH_MOOD_STATES.has(moodState(mood).name) && Math.random() < 0.15) {
      P.spawn({ x, y: y - 4, vx: 0, vy: -0.1,
        type: 'star', color: '#f2c45c', size: 3, life: 600, gravity: -0.0002 });
    }
    if (Math.random() < 0.12) sfx.pet();
  },
  drawCursor(ctx, { x, y, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#f5d4b8';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 4, 9, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(-6 + i * 4, -7 - (isDown ? 2 : 0), 1.6, 6, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(9, 0, 2.5, 5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  },
};
