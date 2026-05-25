import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood + speech via ctx.reactTo.
import { applyStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { nearestPart, applyImpulse } from '../_shared.js';

const { Vector } = Matter;

export const defaultStats = {
  range:         180,
  igniteChance:  0.35,
  igniteMs:      4000,
  moodPerTick:   0.6,    // subtracted (positive number)
  pushForce:     0.003,
};

// Tool id 'flamethrower'. Continuous stream while held (kind: 'hold', 30ms throttle).
export default {
  id: 'flamethrower',
  defaultStats,
  apply(ctx) {
    const s = getStats('flamethrower');
    const { ragdoll, status, x, y, dx, dy } = ctx;
    const part = nearestPart(ragdoll, x, y);
    let hitPart = null;
    let impulse = 0;
    if (part) {
      const dist = Math.hypot(part.position.x - x, part.position.y - y);
      if (dist < s.range) {
        const dir = Vector.sub(part.position, { x, y });
        const n = Vector.normalise(dir);
        const fx = n.x * s.pushForce;
        const fy = n.y * s.pushForce - 0.0006;
        applyImpulse(part, fx, fy);
        hitPart = part;
        impulse = Math.hypot(fx, fy);
        if (Math.random() < s.igniteChance) {
          applyStatus(status, part, 'on_fire', { intensity: 1, source: 'flame' });
        }
      }
    }
    const moodDelta = -s.moodPerTick;
    if (hitPart) {
      ctx.reactTo?.({ source: 'flamethrower', part: hitPart, moodDelta, impulse, speakMs: 99999 });
    } else {
      // No part in range, still apply the chip damage so spraying-into-the-void
      // costs the buddy mood (matches old behavior).
      ctx.reactTo?.({ moodDelta, speakMs: 99999 });
    }
    if (Math.random() < 0.4) sfx.flame();
    // When the cursor is stationary (dx=dy=0), atan2(0,1) used to point flame
    // straight right regardless of buddy position. Fall back to cursor → buddy.
    let angleToCursor;
    const moveMag = Math.hypot(dx || 0, dy || 0);
    if (moveMag > 1.5) {
      angleToCursor = Math.atan2(dy, dx);
    } else if (part) {
      angleToCursor = Math.atan2(part.position.y - y, part.position.x - x);
    } else {
      angleToCursor = 0;
    }
    for (let i = 0; i < 5; i++) {
      const spread = (Math.random() - 0.5) * 0.6;
      const a = angleToCursor + spread;
      const speed = 0.3 + Math.random() * 0.5;
      P.spawn({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        type: 'fire',
        color: ['#ff6b1a', '#ffae3c', '#ffd266'][i % 3],
        size: 6 + Math.random() * 6,
        life: 350 + Math.random() * 200,
        gravity: -0.0008,
        drag: 0.985,
      });
    }
    if (Math.random() < 0.04) ctx.reactTo?.({ source: 'flamethrower', part: ragdoll.head, moodDelta: 0, speakMs: 600 });
  },
  drawCursor(ctx, { x, y, isDown }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3a4a3a'; ctx.fillRect(-22, -8, 12, 16);
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-10, -2, 14, 4);
    ctx.fillStyle = '#2a2a31'; ctx.fillRect(4, -4, 10, 8);
    ctx.fillStyle = '#0a0a0c'; ctx.fillRect(14, -3, 4, 6);
    ctx.globalCompositeOperation = 'lighter';
    const flick = isDown ? (1 + Math.random() * 0.5) : (0.6 + Math.sin(performance.now() * 0.02) * 0.2);
    const r = 5 * flick;
    const g = ctx.createRadialGradient(20, 0, 1, 20, 0, r * 2);
    g.addColorStop(0,   '#fff7c2');
    g.addColorStop(0.5, '#ffae3c');
    g.addColorStop(1,   'rgba(255, 80, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(20, 0, r * 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};
