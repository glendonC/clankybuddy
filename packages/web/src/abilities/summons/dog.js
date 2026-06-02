// Attack dog — the first SUMMON (the Phase-5 summons substrate's first consumer).
// Place-and-forget: a hostile dog charges in from the screen edge, ground-seeks
// the buddy, lunges, and bites — each chomp applies a clamped impulse + a lasting
// BLEED, throttled per-dog. It runs autonomously via the summons Mode
// (modes/summons.js), which dispatches this file's dogTick controller every
// physics step for each live dog body. snake / rat reuse this seek controller in
// a later batch.
//
// PHYSICS DISCIPLINE: the bite (the ONLY force on the buddy) is a clamped
// applyImpulseScaled, hard-ceilinged by BITE_FORCE_CEIL (a module const a stat
// can never raise) and gated by a per-dog ~700ms throttle. Seek + lunge are
// bounded Body.setVelocity on the DOG ONLY (clampAbs caps); gravity owns the
// dog's y (its own ground-clamp — NO stand driver, the dog is not the buddy).
// The dog ADOPTS the ragdoll's negative collision group so it passes THROUGH the
// buddy (the bite is the interaction, never a physical bulldoze) while still
// colliding with the floor/walls. All of this is sim-proven in
// packages/web/sim/summons-dog.mjs.

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { canvas } from '../../state/world.js';
import { FLOOR_INSET } from '../../physics/constants.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { applyStatus } from '../../effects/registry.js';
import { setEnabled } from '../../modes/bus.js';
import { SUMMONS_ID } from '../../modes/summons.js';
import { nearestPart, partInRange, applyImpulseScaled, dirTo } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// --- Module-const firewalls (a stat purchase can NEVER raise these) ---
const BITE_FORCE_CEIL = 0.06;   // Math.min ceiling on the per-mass bite (just above punch 0.05, well below hammer 0.18) — the NaN firewall
const LUNGE_VX        = 7;      // lunge horizontal velocity SET
const LUNGE_HOP       = 5;      // lunge upward hop (px/step)
const MAX_LUNGE_VX    = 12;     // clampAbs cap on lunge x
const MAX_LUNGE_VY    = 14;     // clampAbs cap on lunge y (inside the bigImpact-proven 14-28 band)
const MAX_PACK        = 4;      // hard cap on dogs spawned per cast (cumulative-force bound)
const MAX_LIVE_DOGS   = 6;      // hard cap on live dogs on the field (rapid-click carpet guard)
const SPAWN_SPREAD    = 36;     // px x-jitter between pack members so they don't stack
const DOG_W = 46, DOG_H = 26;   // low, long footprint → rests flat on the floor, no toppling

function clampAbs(v, m) { return v > m ? m : (v < -m ? -m : v); }

export const defaultStats = {
  speed:          4,      // px/step horizontal seek velocity (kinematic x SET; a dog trots/pesters)
  biteForce:      0.045,  // per-mass bite coeff (punch band; applyImpulseScaled ×part.mass internally)
  biteUpBias:     0.0008, // mass-scaled upward jerk on a bite (< COUNTER_GRAVITY_NEUTRALIZER 0.001288 → can't levitate a limb)
  mood:           7,      // mood damage per bite (below a hammer's 16; lighter + repeated)
  biteIntervalMs: 700,    // per-dog bite throttle — bites ~1.4/s, NEVER every step
  biteRange:      56,     // px partInRange radius for a bite
  lungeRange:     180,    // px to nearest part that triggers a lunge burst (outside biteRange)
  lungeMs:        900,    // per-dog lunge throttle
  bleedMs:        5000,   // BLEED duration stamped per bite (bear_trap uses 8000; dog shorter, stacks via repeats)
  lifeMs:         9000,   // finite kennel-dog life; cleanupTransients despawns at bornAt+lifeMs
  pack:           1,      // dogs spawned per cast ('Pack of three' leaf → 3, capped at MAX_PACK)
};

// Per-dog controller. Dispatched by modes/summons.js each physics step via
// body._summonTick. Reads LATCHED body fields (set at spawn), not getStats —
// a mid-life purchase can't reshape a live dog (flood's latch discipline).
function dogTick(self, ctx, dt) {
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;
  const now = performance.now();

  // SEEK target = ragdoll centroid x (horizontal); nearest part = lunge/bite aim.
  let cx = 0;
  for (const p of ragdoll.parts) cx += p.position.x;
  cx /= ragdoll.parts.length;
  const nearest = nearestPart(ragdoll, self.position.x, self.position.y);
  const nd = nearest ? dirTo(self.position.x, self.position.y, nearest.position.x, nearest.position.y).dist : Infinity;

  // SEEK (kinematic x-only). GROUND-CLAMP = set ONLY x, LEAVE y to gravity (the
  // dog rests on the floor under GRAVITY_Y; no counter-gravity, no stand driver).
  const dx = cx - self.position.x;
  const dir = Math.abs(dx) > 1 ? Math.sign(dx) : 0;
  let vx = dir * self._speed;
  if (nd <= self._biteRange) vx = self.velocity.x * 0.6;   // in bite range → brake (don't shove past / no x-jitter atop the buddy)
  Body.setVelocity(self, { x: vx, y: self.velocity.y });   // y untouched → gravity owns it
  if (dir) self._facing = dir;                             // cache for render

  // LUNGE (a bounded one-frame velocity SET on SELF, throttled) — within
  // lungeRange but outside biteRange. This is the only y-write, and it is bounded.
  if (nearest && nd > self._biteRange && nd <= self._lungeRange && now - (self._lastLungeAt || 0) > self._lungeMs) {
    self._lastLungeAt = now;
    const { nx, ny } = dirTo(self.position.x, self.position.y, nearest.position.x, nearest.position.y);
    Body.setVelocity(self, {
      x: clampAbs(nx * LUNGE_VX, MAX_LUNGE_VX),
      y: clampAbs(ny * LUNGE_VX - LUNGE_HOP, MAX_LUNGE_VY),
    });
  }

  // BITE (THE ONLY FORCE — clamped + throttled per-dog) — within biteRange of a part.
  const target = partInRange(ragdoll, self.position.x, self.position.y, self._biteRange);
  if (target && now - (self._lastBiteAt || 0) >= self._biteIntervalMs) {
    self._lastBiteAt = now;
    const { nx, ny } = dirTo(self.position.x, self.position.y, target.position.x, target.position.y);
    const mag = Math.min(self._biteForce, BITE_FORCE_CEIL);   // HARD CEILING — the NaN firewall
    applyImpulseScaled(target, nx, ny, mag, self._biteUpBias);
    applyStatus(ctx.status, target, 'bleed', { duration: self._bleedMs, source: 'attack_dog' });
    ctx.reactTo?.({
      source: 'attack_dog', part: target, moodDelta: -self._mood, impulse: mag,
      speakMs: target === ragdoll.head ? 500 : 99999,
    });
    ctx.screenShake?.(5, 120);
    sfx.dogBite?.();
  }
}

export default {
  id: 'attack_dog',
  defaultStats,
  apply(ctx) {
    const s = getStats('attack_dog');
    const { world, x, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // no buddy → no-op (also guarantees a valid group below)

    // Live-dog cap: a click never pushes the field past MAX_LIVE_DOGS (bounds
    // the per-step Mode loop + cumulative bite force). Full field → no-op click.
    const liveDogs = transientBodies.filter(b => b && b.partType === 'attack_dog' && !b._spent).length;
    const want = Math.max(1, Math.min(s.pack ?? 1, MAX_PACK));
    const pack = Math.min(want, MAX_LIVE_DOGS - liveDogs);
    if (pack <= 0) return;

    const group = ragdoll.parts[0].collisionFilter.group;   // ADOPT the buddy's negative group → pass THROUGH the ragdoll, collide floor/walls
    const groundY = canvas.height - FLOOR_INSET - DOG_H / 2 - 2;
    const fromLeft = x > canvas.width / 2;                   // enter from the FAR edge so they charge across, not on top
    const edgeX = fromLeft ? -40 : canvas.width + 40;
    const now = performance.now();

    for (let i = 0; i < pack; i++) {
      const sx = edgeX + (fromLeft ? 1 : -1) * i * SPAWN_SPREAD;
      const dog = Bodies.rectangle(sx, groundY, DOG_W, DOG_H, {
        density: 0.006, friction: 0.7, frictionAir: 0.02, restitution: 0,
        collisionFilter: { group },
        label: 'attack_dog', render: { visible: false },
      });
      dog.partType    = 'attack_dog';        // render branch key
      dog._summonTick  = dogTick;            // THE TAG — the summons Mode dispatches via this fn pointer (family-agnostic)
      dog._verb        = ctx._verb || 'attack_dog';
      dog.bornAt       = now;
      dog.lifeMs       = s.lifeMs ?? 9000;   // cleanupTransients despawns at bornAt+lifeMs
      dog._epoch       = ctx._epoch;         // epoch-gate (steamroller / gravity-well precedent)
      // Latch tuning so the controller reads body fields, not getStats, per step:
      dog._speed = s.speed ?? 4;
      dog._biteForce = s.biteForce ?? 0.045;
      dog._biteUpBias = s.biteUpBias ?? 0.0008;
      dog._mood = s.mood ?? 7;
      dog._biteIntervalMs = s.biteIntervalMs ?? 700;
      dog._biteRange = s.biteRange ?? 56;
      dog._lungeRange = s.lungeRange ?? 180;
      dog._lungeMs = s.lungeMs ?? 900;
      dog._bleedMs = s.bleedMs ?? 5000;
      dog._lastBiteAt = 0;
      dog._lastLungeAt = 0;
      dog._facing = fromLeft ? 1 : -1;
      Composite.add(world, dog);
      transientBodies.push(dog);
    }
    setEnabled(SUMMONS_ID, true);    // wake the Mode; it self-disables when no summons remain
    sfx.dogBark?.();
    startCooldown('attack_dog');
  },
  drawCursor(rctx, { x, y }) {
    // A small dog silhouette at the cursor (place tool, no reticle).
    rctx.save();
    rctx.translate(x, y);
    rctx.fillStyle = '#5a4632';
    rctx.fillRect(-11, -2, 20, 8);                 // body
    rctx.fillRect(7, -7, 8, 7);                    // head
    rctx.fillRect(13, -5, 4, 3);                   // snout
    rctx.fillStyle = '#433526';                    // legs/ear darker
    rctx.fillRect(-9, 6, 3, 5); rctx.fillRect(-3, 6, 3, 5);
    rctx.fillRect(3, 6, 3, 5);  rctx.fillRect(8, 6, 3, 5);
    rctx.beginPath(); rctx.moveTo(7, -7); rctx.lineTo(9, -11); rctx.lineTo(11, -7); rctx.closePath(); rctx.fill();  // ear
    rctx.fillRect(-15, -1, 5, 2);                  // tail
    rctx.restore();
  },
};
