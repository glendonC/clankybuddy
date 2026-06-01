// Hailstorm, siege (weather barrage). A staggered AREA volley of ice chunks on
// the shared scheduler (S4). Each 'hail' chunk falls onto the cast-time plane,
// freezes (brittle) the nearest part it lands on, and gives a light squash —
// lighter than meteor (no explosion). frozen is PERSISTENT (no duration arg), so
// a hailstorm sets up a frozen -> shatter follow-up.
//
// Same scheduler contract as meteor-shower (cast-time geometry closure, fresh
// per-step ctx, no live-ragdoll capture, no onExpire). speakMs:99999 on EVERY
// chunk: there's no cross-step head-share state, so 10 chunks would otherwise
// spam 10 speech bubbles.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { spikeFear } from '../../mood.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { nearestPart, shatter } from '../_shared.js';
import { applyStatus, isBrittle } from '../../effects/registry.js';
import { scheduleSequence } from '../../state/scheduler.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  count:        10,
  intervalMs:   130,
  startDelayMs: 300,
  spreadW:      340,
  stoneR:       6,
  squashVel:    8,
  mood:         4,
  dropHeight:   740,
  fallVel:      12,
  lifeMs:       2000,
  // NOTE: no frozenMs — frozen is a persistent status (no numeric duration).
};

// One ice chunk dropping onto the marked plane at columnX.
function spawnHail(ctx, columnX, markY) {
  const s = getStats('hailstorm');
  const { world, transientBodies } = ctx;
  const chunk = Bodies.circle(columnX, markY - s.dropHeight, s.stoneR, {
    frictionAir: 0, friction: 0, density: 0.006, restitution: 0.2,
    label: 'hail', render: { visible: false },
  });
  chunk.partType = 'hail';
  chunk._verb = ctx._verb || 'hailstorm';
  chunk.bornAt = performance.now();
  chunk.lifeMs = s.lifeMs;
  Body.setVelocity(chunk, { x: 0, y: s.fallVel });
  chunk.onHit = (b, _world, ctx2) => {
    ctx2.hitStop?.projSmall();
    const part = nearestPart(ctx2.ragdoll, b.position.x, b.position.y);
    if (part) {
      if (isBrittle(ctx2.status, part)) shatter(ctx2, part);
      applyStatus(ctx2.status, part, 'frozen', { source: b._verb });   // persistent — NO duration arg
      Body.setVelocity(part, { x: part.velocity.x, y: part.velocity.y + s.squashVel });
      ctx2.reactTo?.({ source: b._verb, part, moodDelta: -s.mood, impulse: s.squashVel, speakMs: 99999 });
    }
    P.burst(b.position.x, b.position.y, 8, { type: 'ice', color: '#9be7ff', size: 5, life: 500, speedRange: 1.0 });
    sfx.hail();
    ctx2.screenShake?.(4, 120);
  };
  Composite.add(world, chunk);
  transientBodies.push(chunk);
}

export default {
  id: 'hailstorm',
  defaultStats,
  apply(ctx) {
    const s = getStats('hailstorm');
    const { x, y, ragdoll, mood } = ctx;
    if (!ragdoll?.parts?.length) return;
    startCooldown('hailstorm');
    sfx.freeze();
    spikeFear(mood, 40);

    const markY = y;
    const posX = [];
    for (let i = 0; i < s.count; i++) {
      const spread = s.count > 1 ? ((i / (s.count - 1)) - 0.5) * s.spreadW : 0;
      posX.push(x + spread + (Math.random() - 0.5) * 60);
    }
    scheduleSequence(
      (stepCtx, i) => spawnHail(stepCtx, posX[i], markY),
      { count: s.count, intervalMs: s.intervalMs, startDelayMs: s.startDelayMs },
    );
  },
  drawCursor(rctx, { x, y }) {
    const s = getStats('hailstorm');
    const half = s.spreadW / 2;
    rctx.save();
    rctx.strokeStyle = 'rgba(155,231,255,0.45)'; rctx.lineWidth = 1.5; rctx.setLineDash([5, 4]);
    rctx.beginPath();
    rctx.moveTo(x - half, y + 14); rctx.lineTo(x - half, y + 6);
    rctx.lineTo(x + half, y + 6);  rctx.lineTo(x + half, y + 14);
    rctx.stroke();
    rctx.setLineDash([]);
    rctx.fillStyle = 'rgba(220,245,255,0.85)';
    for (let i = 0; i < 5; i++) {
      const px = x - half + ((i + 0.5) / 5) * s.spreadW;
      const py = y - 36 - (i % 3) * 14;
      rctx.beginPath(); rctx.arc(px, py, 2, 0, Math.PI * 2); rctx.fill();
    }
    rctx.restore();
  },
};
