// Acid flask, corruption lane (its own root). A glass flask of caustic acid,
// LOBBED like the grenade/molotov (kind:'drag'): drag-back sets the throw arc,
// release on mouseup. On impact (or fuse expiry) the flask shatters into a
// lingering CAUSTIC POOL — a firepool-style static ground sensor that, on
// contact with a ragdoll part, stamps the new 'corroded' status (a +1.4×
// damage-amp coat, see effects/corroded.js) with a per-target throttle so a
// limb dragging through the pool corrodes at most every ~250ms.
//
// The lob impact also lands a small direct splash mood hit on the nearest part.
//
// Grounded real-world item; no AI in-jokes. SFX: glass shatter + acid sizzle.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { nearestPart } from '../_shared.js';
import { spawnAcidPool } from '../../transients/acid-pool.js';
import { getStats } from '../_stats.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  poolMs:    5000,   // caustic-pool lifetime (lingering corrosion field)
  corrodeMs: 8000,   // 'corroded' duration stamped on contact
  splash:    8,      // direct mood hit on the lob impact (positive; subtracted)
  splashRadius: 90,  // nearest-part splash reach at the impact point
};

// Shatter the flask into a caustic pool + glass/acid burst. Shared by the
// impact (onHit) and fuse-expiry (onExpire) paths so both routes detonate
// identically. Reads tunables off the spawning flask body (set at lob time)
// so the closure doesn't re-enter getStats from a transient ctx.
function shatterFlask(b, ctx2) {
  const floorY = ctx2.world?.bounds?.max?.y ?? 800;
  const poolMs    = b._poolMs ?? 5000;
  const corrodeMs = b._corrodeMs ?? 8000;
  spawnAcidPool(ctx2.world, ctx2.transientBodies, floorY, b.position.x, b.position.y, poolMs, corrodeMs);

  // Direct splash: small mood hit + an acid spatter on the nearest part if it's
  // within reach of the shatter point.
  const part = nearestPart(ctx2.ragdoll, b.position.x, b.position.y);
  if (part) {
    const d = Math.hypot(part.position.x - b.position.x, part.position.y - b.position.y);
    const reach = b._splashRadius ?? 90;
    if (d <= reach) {
      const splash = b._splash ?? 8;
      ctx2.reactTo?.({ source: ctx2._verb || 'acid_flask', part, moodDelta: -splash, speakMs: 600 });
    }
  }

  // Glass shatter shards (grey) + caustic green spray.
  P.burst(b.position.x, b.position.y, 10, { type: 'spark', color: '#cdd6d2', size: 3, life: 360, speedRange: 1.2, gravity: 0.0012 });
  P.burst(b.position.x, b.position.y, 16, { type: 'spark', color: '#9bff6b', size: 3, life: 520, speedRange: 1.0, gravity: 0.0006 });
  P.burst(b.position.x, b.position.y, 6,  { type: 'smoke', color: '#7bbf4a', size: 8, life: 700, speedRange: 0.5, gravity: -0.0004 });

  sfx.shatter?.();   // glass breaking
  sfx.flame?.();     // acid sizzle (lowpass noise hiss)
  ctx2.screenShake?.(6, 160);
}

export default {
  id: 'acid_flask',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('acid_flask');
    const { world, x, y, popBubble, ragdoll, transientBodies, dragVec = { x: 0, y: 0 } } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 24) {
      popBubble(ragdoll.head, 'pull harder!');
      return;
    }
    // Same lob ballistics as grenade.js (k=0.04 with clamps + an up-bias so a
    // flat drag still arcs).
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dragVec.x * k));
    const vy = Math.max(-18, Math.min(15, dragVec.y * k - 4));

    const flask = Bodies.circle(x, y, 8, {
      frictionAir: 0.01, friction: 0.5, density: 0.0025, restitution: 0.3,
      label: 'acid_flask', render: { visible: false },
    });
    flask.partType = 'acid_flask_proj';   // integrator wires this partType in transients/index.js
    flask._verb = ctx._verb || 'acid_flask';
    flask.bornAt = performance.now();
    flask.lifeMs = 2100;
    // Stash tunables on the body so the detonation closures don't re-enter
    // getStats from a transient-rebuilt ctx.
    flask._poolMs = s.poolMs;
    flask._corrodeMs = s.corrodeMs;
    flask._splash = s.splash;
    flask._splashRadius = s.splashRadius;
    Body.setVelocity(flask, { x: vx, y: vy });
    Body.setAngularVelocity(flask, (Math.random() - 0.5) * 0.2);
    // Detonate on the first collision (ragdoll OR wall); the transient
    // collision handler fires onHit + removes the body. onExpire covers the
    // case where it never hits anything before lifeMs runs out.
    flask.onHit = (b, _target, ctx2) => shatterFlask(b, ctx2);
    flask.onExpire = (b, ctx2) => shatterFlask(b, ctx2);
    Composite.add(world, flask);
    transientBodies.push(flask);
    sfx.flame?.();   // wet glug as it leaves the hand
  },

  drawCursor(ctx, { x, y, isDown, dragStart, gravityY = 1.4 }) {
    // Hand-held acid flask at the cursor: dark-green glass bottle + bright cork.
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#2f6b2f';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9bff6b';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(-2, -12, 4, 5);   // cork neck
    ctx.restore();

    if (!isDown || !dragStart) return;
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    if (Math.hypot(dx, dy) < 24) return;
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dx * k));
    const vy = Math.max(-18, Math.min(15, dy * k - 4));
    const a = gravityY * 0.001 * (1000 / 16);
    ctx.save();
    ctx.fillStyle = 'rgba(155, 255, 107, 0.5)';
    for (let step = 1; step <= 26; step++) {
      const t = step * 60;
      const px = dragStart.x + vx * t;
      const py = dragStart.y + vy * t + 0.5 * a * t * t * 0.0001 * 60;
      if (step % 2 === 0) {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (py > 4000) break;
    }
    ctx.strokeStyle = 'rgba(155, 255, 107, 0.4)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};
