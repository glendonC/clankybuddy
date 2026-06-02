// Snake — a summon CHILD of the Attack dog (reuses the summons substrate +
// the dog's proven seek), but a DISTINCT verb: a CREEPING ENVENOMER, not a
// burst mauler. Where the dog charges, LUNGES, and bites with a knockback
// impulse + a FLAT bleed, the snake crawls in slow and low, NEVER lunges, bites
// with a near-zero impulse (it injects, never flings), and STACKS escalating
// venom — each bite ramps the bleed intensity toward a cap, so the wound drains
// FASTER the longer the snake clings (bleed.onTick scales -mood/s by intensity).
//
// THE THREE STRUCTURAL SUBTRACTIONS from dogTick that make this a verb and not a
// reskin (all load-bearing — remove any one and it collapses to "a slow dog"):
//   1. NO lunge block at all (the seek's x-velocity is the snake's ONLY motion write).
//   2. bite impulse ~0 (biteForce 0.004 vs the dog's 0.045, biteUpBias 0).
//   3. STACKING bleed via the shipped chainsaw idiom (getStatus → Math.min(+1,
//      cap) → applyStatus with the bumped intensity); a naive {intensity:1}
//      only refreshes (registry overwrites) and would silently be a flat dog clone.
// bleedCap stays 5 (the family convention — chainsaw/knife/caltrops all cap 5;
// a divergent higher cap would let another bleed source clamp the snake's stack
// back down). The "fangs" leaf deepens venom via faster/longer bite, not a cap bump.

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { canvas } from '../../state/world.js';
import { FLOOR_INSET } from '../../physics/constants.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { applyStatus, getStatus } from '../../effects/registry.js';
import { setEnabled } from '../../modes/bus.js';
import { SUMMONS_ID } from '../../modes/summons.js';
import { partInRange, applyImpulseScaled, dirTo } from '../_shared.js';

const { Bodies, Body, Composite } = Matter;

// --- Module-const firewalls (mirrors the dog; a stat can never raise these) ---
const BITE_FORCE_CEIL = 0.06;   // kept even though the snake's bite is ~0 — defense in depth (the bite firewall)
const MAX_PACK        = 3;      // hard cap on snakes spawned per cast
const MAX_LIVE_SNAKES = 6;      // hard cap on live snakes (rapid-click guard)
const SPAWN_SPREAD    = 30;
const SNAKE_W = 40, SNAKE_H = 10;   // long + flat → rests on the floor, reads serpentine

export const defaultStats = {
  speed:          2,      // slow crawl (half the dog's 4) — px/step kinematic x
  biteForce:      0.004,  // near-0 envenom nip (dog 0.045) — the snake injects, never flings
  biteUpBias:     0,      // no lift, no fling
  mood:           3,      // small per-bite tick (dog 7) — the escalating DoT does the real damage
  biteIntervalMs: 600,    // bites a touch faster than the dog to grow the stack (must stay << bleedMs)
  biteRange:      48,
  bleedMs:        4000,   // re-stamped each bite so a latched snake holds the stack alive
  bleedCap:       5,      // venom ramp ceiling — the FAMILY convention (do not diverge)
  lifeMs:         11000,  // longer than the dog (9000) — a creeper needs dwell time to ramp
  pack:           1,
};

// Per-snake controller. Dispatched by modes/summons.js via body._summonTick.
// Reuses the dog's SEEK + bite-gate, with the three subtractions above.
function snakeTick(self, ctx /* , dt */) {
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;
  const now = performance.now();

  // SEEK (kinematic x-only; gravity owns y = ground-clamp). Slow crawl. Brake in
  // bite range so it latches on instead of crawling past. (No lunge — subtraction 1.)
  let cx = 0; for (const p of ragdoll.parts) cx += p.position.x; cx /= ragdoll.parts.length;
  const nearest = partInRange(ragdoll, self.position.x, self.position.y, self._biteRange);
  const dx = cx - self.position.x;
  const dir = Math.abs(dx) > 1 ? Math.sign(dx) : 0;
  let vx = dir * self._speed;
  if (nearest) vx = self.velocity.x * 0.6;   // a part is in bite range → brake + latch
  Body.setVelocity(self, { x: vx, y: self.velocity.y });
  if (dir) self._facing = dir;

  // BITE: near-0 impulse (subtraction 2) + ESCALATING venom (subtraction 3),
  // throttled per-snake.
  if (nearest && now - (self._lastBiteAt || 0) >= self._biteIntervalMs) {
    self._lastBiteAt = now;
    const { nx, ny } = dirTo(self.position.x, self.position.y, nearest.position.x, nearest.position.y);
    const mag = Math.min(self._biteForce, BITE_FORCE_CEIL);   // ~0.004, still ceiling-guarded
    applyImpulseScaled(nearest, nx, ny, mag, self._biteUpBias);
    // STACK the bleed (the shipped chainsaw idiom — copied, not assumed: applyStatus
    // OVERWRITES intensity, so the ramp must be computed here).
    const existing = getStatus(ctx.status, nearest, 'bleed');
    const intensity = Math.min((existing?.intensity ?? 0) + 1, self._bleedCap);
    applyStatus(ctx.status, nearest, 'bleed', { duration: self._bleedMs, source: 'snake', intensity });
    ctx.reactTo?.({
      source: 'snake', part: nearest, moodDelta: -self._mood, impulse: mag,
      speakMs: nearest === ragdoll.head ? 500 : 99999,
    });
    sfx.snakeBite?.();
  }
}

export default {
  id: 'snake',
  defaultStats,
  apply(ctx) {
    const s = getStats('snake');
    const { world, x, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;

    const live = transientBodies.filter(b => b && b.partType === 'snake' && !b._spent).length;
    const want = Math.max(1, Math.min(s.pack ?? 1, MAX_PACK));
    const pack = Math.min(want, MAX_LIVE_SNAKES - live);
    if (pack <= 0) return;

    const group = ragdoll.parts[0].collisionFilter.group;   // adopt the buddy's group → pass through (no bulldoze), collide floor
    const groundY = canvas.height - FLOOR_INSET - SNAKE_H / 2 - 2;
    const fromLeft = x > canvas.width / 2;
    const edgeX = fromLeft ? -40 : canvas.width + 40;
    const now = performance.now();

    for (let i = 0; i < pack; i++) {
      const sx = edgeX + (fromLeft ? 1 : -1) * i * SPAWN_SPREAD;
      const snake = Bodies.rectangle(sx, groundY, SNAKE_W, SNAKE_H, {
        density: 0.005, friction: 0.7, frictionAir: 0.03, restitution: 0,
        collisionFilter: { group },
        label: 'snake', render: { visible: false },
      });
      snake.partType   = 'snake';
      snake._summonTick = snakeTick;
      snake._verb       = ctx._verb || 'snake';
      snake.bornAt      = now;
      snake.lifeMs      = s.lifeMs ?? 11000;
      snake._epoch      = ctx._epoch;
      snake._speed = s.speed ?? 2;
      snake._biteForce = s.biteForce ?? 0.004;
      snake._biteUpBias = s.biteUpBias ?? 0;
      snake._mood = s.mood ?? 3;
      snake._biteIntervalMs = s.biteIntervalMs ?? 600;
      snake._biteRange = s.biteRange ?? 48;
      snake._bleedMs = s.bleedMs ?? 4000;
      snake._bleedCap = s.bleedCap ?? 5;
      snake._lastBiteAt = 0;
      snake._facing = fromLeft ? 1 : -1;
      Composite.add(world, snake);
      transientBodies.push(snake);
    }
    setEnabled(SUMMONS_ID, true);
    sfx.snakeHiss?.();
    startCooldown('snake');
  },
  drawCursor(rctx, { x, y }) {
    // Low serpentine S-curve (distinct from the dog silhouette).
    rctx.save();
    rctx.translate(x, y);
    rctx.strokeStyle = '#4c7a3a';
    rctx.lineWidth = 4;
    rctx.lineCap = 'round';
    rctx.beginPath();
    rctx.moveTo(-12, 4);
    rctx.bezierCurveTo(-4, -6, 4, 10, 12, -2);
    rctx.stroke();
    // Head + flick tongue.
    rctx.fillStyle = '#5e8f48';
    rctx.beginPath(); rctx.arc(12, -2, 3, 0, Math.PI * 2); rctx.fill();
    rctx.strokeStyle = '#c0392b'; rctx.lineWidth = 1;
    rctx.beginPath(); rctx.moveTo(15, -2); rctx.lineTo(18, -3); rctx.moveTo(15, -2); rctx.lineTo(18, -1); rctx.stroke();
    rctx.restore();
  },
};
