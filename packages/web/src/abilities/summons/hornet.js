// Hornet swarm — the FIRST air-flyer + first swarm summon. A buzzing cloud of N
// tiny stingers that swarms the buddy IN THE AIR. Rides the summons substrate
// (modes/summons.js dispatches body._summonTick) with ZERO Mode edits.
//
// THE NEW SUB-SUBSTRATE: a KINEMATIC-2D-SEEK flyer. The dog/snake seek is x-only
// and lets gravity own y (ground-clamp). A hornet must NOT fall — so hornetTick
// SETS BOTH x AND y velocity every physics step, which OVERWRITES the one step
// of gravity drift = the altitude-hold (NO counter-gravity force, NO ground
// clamp). LOAD-BEARING INVARIANT (red-team): the controller must call
// Body.setVelocity EVERY tick while alive; the ONLY permitted early-return is
// the no-ragdoll guard. Any other skip lets gravity accumulate → the flyer falls.
//
// THE VERB (distinct from the dog mauler / snake envenomer / static turret): a
// SWARM — N tiny stingers chipping at once with a FLAT topped-up bleed (NOT the
// snake's escalating stack). The sting (the ONLY force on the ragdoll) is a tiny
// clamped impulse; volume, not per-hit weight, is the threat.
//
// NOT the future quadcopter drone: the hornet is a DUMB single-state buzzing
// cloud — no altitude FSM, no recon→strafe→kamikaze phases, no COUNTER_GRAVITY
// force math. The drone will be the structured flyer; keep them separate verbs.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { getStats } from '../_stats.js';
import { canvas } from '../../state/world.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { applyStatus } from '../../effects/registry.js';
import { setEnabled } from '../../modes/bus.js';
import { SUMMONS_ID } from '../../modes/summons.js';
import { nearestPart, partInRange, applyImpulseScaled, dirTo } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// --- Module-const firewalls (a stat purchase can NEVER raise these) ---
const STING_CEIL       = 0.015;  // Math.min ceiling on the per-mass sting (4× below the dog's BITE_FORCE_CEIL 0.06) — the cumulative-force/NaN firewall
const SWARM_CAP        = 12;     // hard cap on hornets per cast (the §2 N≤12 bound)
const MAX_LIVE_HORNETS = 16;     // hard cap on live hornets (rapid-click carpet guard) — bounds the Mode loop AND cumulative force
const MAX_HORNET_V     = 9;      // clampAbs cap on BOTH set velocity axes (bounded flyer, no rocket)
const JITTER_AMP       = 2.4;    // px/step sine-jitter magnitude
const ORBIT_R          = 46;     // px shell radius; inside it the radial seek flips outward (hover in a cloud, don't knot to a point)
const ARRIVE_R         = 90;     // px arrive-damp radius (scale seek by dist/ARRIVE_R → no overshoot oscillation)
const HORNET_R         = 3.5;

const clampAbs = (v, m) => (v > m ? m : (v < -m ? -m : v));

export const defaultStats = {
  swarmCount:     8,      // hornets per cast (Wasp nest → 12 = SWARM_CAP)
  speed:          5,      // base seek speed (px/step) toward the cloud point
  stingForce:     0.012,  // per-mass sting impulse (< STING_CEIL 0.015) — tiny; volume is the threat
  stingUpBias:    0,      // no lift / no fling
  mood:           2,      // per-sting mood tick (chip damage; the swarm's count does the work)
  stingIntervalMs: 600,   // per-hornet sting throttle (staggered at spawn)
  stingRange:     44,     // px partInRange radius for a sting
  bleedChance:    0.3,    // chance a sting opens a FLAT bleed (Venomous stings → 0.45)
  bleedMs:        4000,   // flat bleed duration (re-stamped, never stacks intensity — the dog model, NOT the snake's)
  lifeMs:         7000,   // a swarm is transient; cleanupTransients despawns at bornAt+lifeMs
  hoverOffset:    30,     // px the cloud aims ABOVE the centroid (hovers/dives, doesn't crawl the floor)
};

// Per-hornet controller, dispatched by modes/summons.js via body._summonTick.
// Reads latched body fields (not getStats). dt unused (fixed-step; jitter is a
// per-step phase advance, sting throttle is wall-clock performance.now).
function hornetTick(self, ctx) {
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // the ONLY permitted early-return (no buddy to hold altitude relative to)
  const now = performance.now();

  // 1) Cloud gather point = centroid, aimed slightly ABOVE the buddy.
  let cx = 0, cy = 0;
  for (const p of ragdoll.parts) { cx += p.position.x; cy += p.position.y; }
  cx /= ragdoll.parts.length; cy /= ragdoll.parts.length;
  cy -= self._hoverOffset;

  // 2) Deterministic, decorrelated jitter (advancing seeded phase — NEVER fresh
  // Math.random per step: white noise averages to the centroid → cloud collapses).
  self._phase += self._phaseStep;
  const jx = Math.cos(self._phase) * JITTER_AMP;
  const jy = Math.sin(self._phase * 1.37) * JITTER_AMP;

  // 3) Seek toward the cloud point with an orbit-standoff (don't pile on a point)
  // + arrive-damp (no overshoot oscillation).
  const { nx, ny, dist } = dirTo(self.position.x, self.position.y, cx, cy);
  let seek = self._speed;
  if (dist < ORBIT_R) seek = -seek * 0.5;             // inside the shell → gently push OUT
  else if (dist < ARRIVE_R) seek *= dist / ARRIVE_R;  // outside → arrive-damp
  const vx = nx * seek + jx;
  const vy = ny * seek + jy;

  // 4) THE altitude-hold: SET both axes (clamped). Overwrites this step's gravity. Bounded.
  Body.setVelocity(self, { x: clampAbs(vx, MAX_HORNET_V), y: clampAbs(vy, MAX_HORNET_V) });
  self._facing = vx < 0 ? -1 : 1;

  // 5) Soft on-screen reclamp (a velocity-owning flyer can chase off-canvas at a margin).
  const m = 12;
  if (self.position.x < m && self.velocity.x < 0) Body.setVelocity(self, { x: Math.abs(self.velocity.x), y: self.velocity.y });
  else if (self.position.x > canvas.width - m && self.velocity.x > 0) Body.setVelocity(self, { x: -Math.abs(self.velocity.x), y: self.velocity.y });
  if (self.position.y < m && self.velocity.y < 0) Body.setVelocity(self, { x: self.velocity.x, y: Math.abs(self.velocity.y) });
  else if (self.position.y > canvas.height - m && self.velocity.y > 0) Body.setVelocity(self, { x: self.velocity.x, y: -Math.abs(self.velocity.y) });

  // 6) STING (the ONLY force on the ragdoll) — throttled per-hornet, clamped.
  const target = partInRange(ragdoll, self.position.x, self.position.y, self._stingRange);
  if (target && now - (self._lastStingAt || 0) >= self._stingIntervalMs) {
    self._lastStingAt = now;
    const { nx: sx, ny: sy } = dirTo(self.position.x, self.position.y, target.position.x, target.position.y);
    const mag = Math.min(self._stingForce, STING_CEIL);     // HARD ceiling — a stat can never raise past STING_CEIL
    applyImpulseScaled(target, sx, sy, mag, self._stingUpBias);
    // FLAT bleed (the dog model — NO intensity field → registry defaults to 1 and
    // refreshes; the swarm KEEPS a flat bleed by volume, never escalates like the snake).
    if (Math.random() < self._bleedChance) {
      applyStatus(ctx.status, target, 'bleed', { duration: self._bleedMs, source: 'hornet_swarm' });
    }
    ctx.reactTo?.({
      source: 'hornet_swarm', part: target, moodDelta: -self._mood, impulse: mag,
      speakMs: target === ragdoll.head ? 600 : 99999,   // head-only speech — N stingers would thrash the bubble throttle
    });
    if (Math.random() < 0.2) sfx.hornetSting?.();        // probabilistic — N stings mustn't be an audio wall
  }
}

export default {
  id: 'hornet_swarm',
  defaultStats,
  apply(ctx) {
    const s = getStats('hornet_swarm');
    const { world, x, y, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // no buddy → no-op (also guarantees a valid group)

    const live = transientBodies.filter(b => b && b.partType === 'hornet' && !b._spent).length;
    const want = Math.max(1, Math.min(s.swarmCount ?? 8, SWARM_CAP));
    const n = Math.min(want, MAX_LIVE_HORNETS - live);
    if (n <= 0) return;                                                // field full → no-op

    const group = ragdoll.parts[0].collisionFilter.group;              // adopt buddy's negative group → pass through buddy AND each other
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const sx = x + (Math.random() - 0.5) * 60;                       // a cloud BURSTS from the cursor (air summon materializes in place)
      const sy = y + (Math.random() - 0.5) * 40;
      const h = Bodies.circle(sx, sy, HORNET_R, {
        density: 0.0008, frictionAir: 0, friction: 0, restitution: 0.1,
        collisionFilter: { group },
        label: 'hornet', render: { visible: false },
      });
      h.partType   = 'hornet';
      h._summonTick = hornetTick;
      h._verb       = ctx._verb || 'hornet_swarm';
      h.bornAt      = now;
      h.lifeMs      = s.lifeMs ?? 7000;
      h._epoch      = ctx._epoch;
      // Latch tuning.
      h._speed = s.speed ?? 5;
      h._stingForce = s.stingForce ?? 0.012;
      h._stingUpBias = s.stingUpBias ?? 0;
      h._mood = s.mood ?? 2;
      h._stingIntervalMs = s.stingIntervalMs ?? 600;
      h._stingRange = s.stingRange ?? 44;
      h._bleedChance = s.bleedChance ?? 0.3;
      h._bleedMs = s.bleedMs ?? 4000;
      h._hoverOffset = s.hoverOffset ?? 30;
      // Per-hornet jitter phase (seeded once; advanced per step). Staggered sting
      // throttle so the swarm doesn't fire one synchronized volley.
      h._phase = Math.random() * Math.PI * 2;
      h._phaseStep = 0.22 + Math.random() * 0.10;
      h._lastStingAt = now - Math.random() * (h._stingIntervalMs);
      h._facing = 1;
      Composite.add(world, h);
      transientBodies.push(h);
    }
    setEnabled(SUMMONS_ID, true);
    sfx.hornetBuzz?.();
    startCooldown('hornet_swarm');
  },
  drawCursor(rctx, { x, y }) {
    // A small cluster of buzzing dots (place tool, no reticle).
    rctx.save();
    rctx.fillStyle = '#caa23a';
    for (const [dx, dy] of [[-7, -3], [2, -6], [6, 2], [-3, 5], [0, 0]]) {
      rctx.beginPath(); rctx.arc(x + dx, y + dy, 2, 0, Math.PI * 2); rctx.fill();
    }
    rctx.strokeStyle = 'rgba(200,200,210,0.5)'; rctx.lineWidth = 0.8;    // wing flickers
    for (const [dx, dy] of [[-7, -3], [2, -6], [6, 2]]) {
      rctx.beginPath(); rctx.moveTo(x + dx - 2, y + dy - 2); rctx.lineTo(x + dx + 2, y + dy - 3); rctx.stroke();
    }
    rctx.restore();
  },
};
