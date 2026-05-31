// Taser — corruption line. kind:'click'. Fires TWO short-life conductive
// darts toward the aim; on contact each dart applies `electrified` to the
// nearest ragdoll part, gives a small directional shove, and a "reel" pull
// back toward the firing point (the wires drag the target in). The buddy
// convulses for the electrified duration. The connecting WIRES are
// RENDER-ONLY (drawn in drawCursor cursor->target) — no physics body, so no
// epoch guard is needed for the wire. The darts themselves are self-contained
// transients whose ad-hoc onHit closure (transients/index.js pattern 1)
// applies the electrified status; they fire-and-remove on contact or expire
// by lifeMs, so no shared-table partType handler edit is required.
import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { applyStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';
import { nearestPart, applyImpulseScaled } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  speed:     20,    // dart launch speed (px/step)
  spread:    0.14,  // half-angle between the two darts (rad)
  lifeMs:    500,   // dart flight lifetime before fizzle
  dartForce: 0.06,  // force-per-mass shove along the dart's travel
  reelForce: 0.05,  // force-per-mass pull back toward the firing point
  shockMs:   1400,  // electrified duration applied on contact (default 500)
};

// Build one conductive dart as a self-contained transient. anchorX/anchorY is
// the firing point; on contact the dart electrifies + shoves + reels the
// nearest part toward that anchor. Tunables are stashed on the body so the
// onHit closure never re-enters getStats from a transient ctx.
function spawnDart(ctx, x, y, angle, s, verb) {
  const vx = Math.cos(angle) * s.speed;
  const vy = Math.sin(angle) * s.speed;
  const dart = Bodies.circle(x, y, 3, {
    frictionAir: 0, friction: 0, density: 0.003, restitution: 0.1,
    label: 'taser_dart', render: { visible: false },
  });
  dart.partType = 'taser_dart';
  dart._verb = verb;
  dart.bornAt = performance.now();
  dart.lifeMs = s.lifeMs;
  dart._anchorX = x;
  dart._anchorY = y;
  dart._dartForce = s.dartForce;
  dart._reelForce = s.reelForce;
  dart._shockMs = s.shockMs;
  dart.onHit = (self, _world, ctx2) => {
    const target = nearestPart(ctx2.ragdoll, self.position.x, self.position.y);
    if (!target) return;
    // Shove along the dart's travel direction.
    const len = Math.hypot(self.velocity.x, self.velocity.y) || 1;
    const dnx = self.velocity.x / len, dny = self.velocity.y / len;
    const { fx, fy } = applyImpulseScaled(target, dnx, dny, self._dartForce);
    // Reel pull back toward the firing point (the wires drag the buddy in).
    const ax = self._anchorX - target.position.x;
    const ay = self._anchorY - target.position.y;
    const ad = Math.hypot(ax, ay) || 1;
    applyImpulseScaled(target, ax / ad, ay / ad, self._reelForce);
    // Convulsion: electrified (extended past its 500ms default via duration).
    applyStatus(ctx2.status, target, 'electrified', { duration: self._shockMs, source: self._verb || 'taser' });
    ctx2.reactTo?.({
      source: self._verb || 'taser', part: target,
      moodDelta: -4, impulse: Math.hypot(fx, fy),
      speakMs: target === ctx2.ragdoll.head ? 600 : 99999,
    });
    P.burst(self.position.x, self.position.y, 8, { type: 'spark', color: '#9be7ff', size: 3, life: 260, speedRange: 0.9 });
    ctx2.screenShake?.(2, 90);
  };
  Body.setVelocity(dart, { x: vx, y: vy });
  Composite.add(ctx.world, dart);
  ctx.transientBodies.push(dart);
}

export default {
  id: 'taser',
  defaultStats,
  apply(ctx) {
    const s = getStats('taser');
    const { ragdoll, world, x, y, screenShake } = ctx;
    if (!world) return;
    // Aim from cursor toward the nearest part (click tool: no sweep delta).
    const nearest = nearestPart(ragdoll, x, y);
    const angle = nearest
      ? Math.atan2(nearest.position.y - y, nearest.position.x - x)
      : 0;
    const verb = ctx._verb || 'taser';
    // TWO darts at a small angular spread off the aim.
    spawnDart(ctx, x, y, angle - s.spread, s, verb);
    spawnDart(ctx, x, y, angle + s.spread, s, verb);
    // dart pop + crackling arc.
    sfx.gun?.();
    sfx.zap?.();
    screenShake?.(2, 80);
    P.burst(x, y, 6, { type: 'spark', color: '#cfe8ff', size: 3, life: 200, speedRange: 0.8 });
  },
  drawCursor(ctx, { x, y, target, angle, isDown }) {
    // Emitter device at the cursor.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.fillStyle = '#f4d000'; ctx.fillRect(-2, -2, 6, 13);   // grip
    ctx.fillStyle = '#1c1c20'; ctx.fillRect(-2, -6, 16, 8);   // body
    ctx.fillStyle = '#cfd8e3'; ctx.fillRect(12, -4, 4, 3);    // prong
    ctx.fillStyle = '#cfd8e3'; ctx.fillRect(12,  1, 4, 3);    // prong
    ctx.restore();
    if (!isDown || !target) return;
    // RENDER-ONLY wires: cursor prongs -> target, jittered, additive. The
    // electrified convulsion itself is rendered by effects/electrified.render
    // off the live status record; this draws the connecting darts/gun wire.
    const tx = target.position.x, ty = target.position.y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(155, 231, 255, 0.85)';
    for (let w = -1; w <= 1; w += 2) {
      const ox = Math.cos((angle || 0) + Math.PI / 2) * 3 * w;
      const oy = Math.sin((angle || 0) + Math.PI / 2) * 3 * w;
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      const segs = 5;
      for (let s = 1; s < segs; s++) {
        const t = s / segs;
        const mx = x + (tx - x) * t + (Math.random() - 0.5) * 9;
        const my = y + (ty - y) * t + (Math.random() - 0.5) * 9;
        ctx.lineTo(mx, my);
      }
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    // Hot contact spark at the target.
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(tx, ty, 2 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};
