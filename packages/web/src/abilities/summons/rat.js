// Rat swarm — a summon CHILD of the Hornet swarm (reuses the summons substrate +
// the dog's ground seek + the hornet's swarm/jitter/per-body-throttle), but a
// DISTINCT verb: TERRORIZE-INTO-FLEEING. The dog mauls, the snake envenoms, the
// hornet chips from the air; the rat's headline output is a STATE CHANGE in the
// buddy, not damage. It is the FIRST hostile to feed mood.fear via spikeFear —
// and mood.fear's only autonomous consumer is behavior/scheduler.js's
// flee-to-corner (FEAR_FLEE_THRESHOLD = 35). A sustained swarm gnawing at the
// feet keeps fear pinned above that threshold, so the buddy BREAKS AND RUNS.
//
// THE STRUCTURAL DISTINCTIONS (red-team-gated; remove any and it collapses to a
// reskin of a sibling):
//   1. GROUND-CLAMPED swarm (dog x-only seek: gravity owns y) — NOT the hornet's
//      2D altitude-hold flyer. A swarm at floor level, not in the air.
//   2. A near-COSMETIC gnaw (gnawForce ~0 vs the dog's 0.045), gated to LOW parts
//      (partType 'leg' — the ragdoll has head/torso/arm, NO 'foot') for the
//      vermin-underfoot read. The impulse is not the threat.
//   3. spikeFear PER GNAW + a blind panic-run — the terror IS the verb. No other
//      summon writes mood.fear; the one-shot fear casters (flood/strafe/anvil)
//      jolt fear ONCE at cast, the rat is the first to SUSTAIN it from a
//      controller, which is what crosses + holds the flee threshold.
//
// LOAD-BEARING PANIC THROTTLE (the planning caught this; do NOT get it wrong):
// the rat must NOT copy choking's `ragdoll._chokePanicAt !== now` IDENTITY idiom.
// That works only because tickStatuses hands the SAME `now` to every part in a
// pass — but the summons Mode has each rat call performance.now() ITSELF, so the
// values differ and an identity check would let EVERY rat fire panicRunLeg → N
// panic pulses per tick → launch. We use a TIME-DELTA global throttle (choking's
// STUMBLE idiom): at most ONE two-leg panicRunLeg pulse per PANIC_EVERY across
// the WHOLE swarm regardless of N. spikeFear itself is force-free + capped at 100,
// so it needs no throttle. All sim-proven in packages/web/sim/summons-rat.mjs.

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { canvas } from '../../state/world.js';
import { FLOOR_INSET } from '../../physics/constants.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { applyStatus } from '../../effects/registry.js';
import { spikeFear } from '../../mood.js';
import { panicRunLeg } from '../../effects/_locomotion.js';
import { setEnabled } from '../../modes/bus.js';
import { SUMMONS_ID } from '../../modes/summons.js';
import { partInRange, applyImpulseScaled, dirTo } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// --- Module-const firewalls (a stat purchase can NEVER raise these) ---
const GNAW_CEIL      = 0.012;  // Math.min ceiling on the per-mass gnaw (below the hornet's STING_CEIL 0.015, far below the dog's 0.06) — the cumulative-force/NaN firewall
const SWARM_CAP      = 12;     // hard cap on rats per cast (mirrors the hornet swarm bound)
const MAX_LIVE_RATS  = 16;     // hard cap on live rats (rapid-click carpet guard) — bounds the Mode loop AND cumulative force
const MAX_RAT_V      = 10;     // clampAbs cap on the seek x velocity (bounded skitter; gravity still owns y)
const JITTER_AMP     = 2.0;    // px/step x-only scurry magnitude (decorrelates the swarm)
const PANIC_EVERY    = 700;    // ms — GLOBAL ragdoll panic-pulse throttle (choking's STUMBLE-gate idiom, NOT its identity-`now` idiom)
const SPAWN_SPREAD   = 24;     // px x-stagger between swarm members streaming in from the edge
const RAT_W = 18, RAT_H = 8;   // small + low → rests flat on the floor, reads as vermin

const clampAbs = (v, m) => (v > m ? m : (v < -m ? -m : v));

export const defaultStats = {
  swarmCount:    8,      // rats per cast (Breeding colony → 12 = SWARM_CAP)
  speed:         5,      // px/step horizontal seek velocity (kinematic x SET; a rat skitters)
  gnawForce:     0.006,  // per-mass gnaw coeff (near-0 — well below the dog's 0.045; the gnaw is cosmetic, the terror is the threat)
  gnawUpBias:    0,      // no lift / no fling — rats don't launch limbs
  mood:          2,      // small per-gnaw mood tick (the swarm's count + the fear-flee do the work)
  gnawIntervalMs: 600,   // per-rat gnaw throttle (staggered at spawn) — gnaws ~1.7/s, NEVER every step
  gnawRange:     40,     // px partInRange radius for a gnaw / panic trigger
  bleedChance:   0.3,    // chance a gnaw opens a FLAT bleed (the dog/hornet model — re-stamped, never the snake's escalating stack)
  bleedMs:       4000,   // flat bleed duration
  fear:          10,     // spikeFear per gnaw — below FEAR_FLEE_THRESHOLD 35 so one bite never flees; the SWARM accumulates past it (fear decays 25/s)
  lifeMs:        9000,   // a swarm is transient; cleanupTransients despawns at bornAt+lifeMs
  pack:          1,      // legacy single-knob (swarmCount is the real count); kept for parity
};

// Per-rat controller, dispatched by modes/summons.js via body._summonTick. Reads
// LATCHED body fields (set at spawn), not getStats — a mid-life purchase can't
// reshape a live rat (the dog/hornet latch discipline). dt unused (fixed-step).
function ratTick(self, ctx /* , dt */) {
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // the ONLY permitted early-return (no buddy → no seek target / no fear sink)
  const now = performance.now();

  // SEEK target = ragdoll centroid x (horizontal). A part within gnawRange = the
  // gnaw aim AND the panic trigger.
  let cx = 0;
  for (const p of ragdoll.parts) cx += p.position.x;
  cx /= ragdoll.parts.length;

  // Deterministic x-only scurry jitter (advancing seeded phase — NEVER fresh
  // Math.random per step: white noise averages out → the swarm marches in lockstep).
  self._phase += self._phaseStep;
  const jitter = Math.cos(self._phase) * JITTER_AMP;

  const target = partInRange(ragdoll, self.position.x, self.position.y, self._gnawRange);
  const onLeg = target && target.partType === 'leg';

  // SEEK (kinematic x-only). GROUND-CLAMP = set ONLY x, LEAVE y to gravity (the
  // rat rests on the floor under GRAVITY_Y; no counter-gravity, no stand driver).
  const dx = cx - self.position.x;
  const dir = Math.abs(dx) > 1 ? Math.sign(dx) : 0;
  let vx = dir * self._speed + jitter;
  if (target) vx = self.velocity.x * 0.6 + jitter * 0.5;   // in range → brake + skitter in place (don't crawl past)
  Body.setVelocity(self, { x: clampAbs(vx, MAX_RAT_V), y: self.velocity.y });   // y untouched → gravity owns it (ground-clamp)
  if (dir) self._facing = dir;

  // GNAW (near-cosmetic, LEG-gated, throttled per-rat) + spikeFear (THE VERB).
  if (onLeg && now - (self._lastGnawAt || 0) >= self._gnawIntervalMs) {
    self._lastGnawAt = now;
    const { nx, ny } = dirTo(self.position.x, self.position.y, target.position.x, target.position.y);
    const mag = Math.min(self._gnawForce, GNAW_CEIL);     // HARD ceiling — a stat can never raise past GNAW_CEIL
    applyImpulseScaled(target, nx, ny, mag, self._gnawUpBias);
    // FLAT bleed (the dog/hornet model — NO intensity field → registry defaults to
    // 1 and refreshes; the swarm keeps a flat bleed by volume, never the snake's stack).
    if (Math.random() < self._bleedChance) {
      applyStatus(ctx.status, target, 'bleed', { duration: self._bleedMs, source: 'rat_swarm' });
    }
    // SPIKE FEAR — force-free + capped at 100, so no throttle. This is the headline:
    // the sustained accumulation crosses + holds FEAR_FLEE_THRESHOLD → scheduler flee.
    spikeFear(ctx.mood, self._fear);
    ctx.reactTo?.({
      source: 'rat_swarm', part: target, moodDelta: -self._mood, impulse: mag,
      speakMs: target === ragdoll.head ? 600 : 99999,   // head-only speech — N rats would thrash the bubble throttle
    });
    if (Math.random() < 0.18) sfx.ratSqueak?.();          // probabilistic — N gnaws mustn't be an audio wall
  }

  // GLOBAL PANIC PULSE — a blind panic-run, drives BOTH legs ONCE per PANIC_EVERY
  // across the WHOLE swarm via a TIME-DELTA latch on the ragdoll (NOT choking's
  // identity-`now`: each rat reads its own performance.now(), so identity would
  // let every rat fire → N pulses → launch). panicRunLeg self-bails when the buddy
  // is stunned / tipped over, so a downed buddy is never driven.
  if (target && now - (ragdoll._ratPanicAt || 0) > PANIC_EVERY) {
    ragdoll._ratPanicAt = now;
    const bm = ragdoll.bodyMap;
    if (bm?.legL) panicRunLeg(ragdoll, bm.legL);
    if (bm?.legR) panicRunLeg(ragdoll, bm.legR);
  }
}

export default {
  id: 'rat_swarm',
  defaultStats,
  apply(ctx) {
    const s = getStats('rat_swarm');
    const { world, x, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // no buddy → no-op (also guarantees a valid group below)

    const live = transientBodies.filter(b => b && b.partType === 'rat' && !b._spent).length;
    const want = Math.max(1, Math.min(s.swarmCount ?? 8, SWARM_CAP));
    const n = Math.min(want, MAX_LIVE_RATS - live);
    if (n <= 0) return;                                                // field full → no-op click

    const group = ragdoll.parts[0].collisionFilter.group;             // adopt the buddy's negative group → pass THROUGH the buddy AND each other, collide floor/walls
    const groundY = canvas.height - FLOOR_INSET - RAT_H / 2 - 2;
    const fromLeft = x > canvas.width / 2;                            // pour in from the FAR edge along the baseboards
    const edgeX = fromLeft ? -40 : canvas.width + 40;
    const now = performance.now();

    for (let i = 0; i < n; i++) {
      const sx = edgeX + (fromLeft ? 1 : -1) * i * SPAWN_SPREAD;
      const rat = Bodies.rectangle(sx, groundY, RAT_W, RAT_H, {
        density: 0.004, friction: 0.7, frictionAir: 0.02, restitution: 0,
        collisionFilter: { group },
        label: 'rat', render: { visible: false },
      });
      rat.partType    = 'rat';                 // render branch key
      rat._summonTick  = ratTick;              // THE TAG — the summons Mode dispatches via this fn pointer (family-agnostic)
      rat._verb        = ctx._verb || 'rat_swarm';
      rat.bornAt       = now;
      rat.lifeMs       = s.lifeMs ?? 9000;     // cleanupTransients despawns at bornAt+lifeMs
      rat._epoch       = ctx._epoch;           // epoch-gate (dog/hornet precedent)
      // Latch tuning so the controller reads body fields, not getStats, per step:
      rat._speed = s.speed ?? 5;
      rat._gnawForce = s.gnawForce ?? 0.006;
      rat._gnawUpBias = s.gnawUpBias ?? 0;
      rat._mood = s.mood ?? 2;
      rat._gnawIntervalMs = s.gnawIntervalMs ?? 600;
      rat._gnawRange = s.gnawRange ?? 40;
      rat._bleedChance = s.bleedChance ?? 0.3;
      rat._bleedMs = s.bleedMs ?? 4000;
      rat._fear = s.fear ?? 10;
      // Per-rat scurry phase (seeded once; advanced per step). Staggered gnaw
      // throttle so the swarm doesn't fire one synchronized volley.
      rat._phase = Math.random() * Math.PI * 2;
      rat._phaseStep = 0.30 + Math.random() * 0.12;
      rat._lastGnawAt = now - Math.random() * (rat._gnawIntervalMs);
      rat._facing = fromLeft ? 1 : -1;
      Composite.add(world, rat);
      transientBodies.push(rat);
    }
    setEnabled(SUMMONS_ID, true);    // wake the Mode; it self-disables when no summons remain
    sfx.ratSkitter?.();
    startCooldown('rat_swarm');
  },
  drawCursor(rctx, { x, y }) {
    // A small cluster of low rat silhouettes (place tool, no reticle).
    rctx.save();
    rctx.translate(x, y);
    rctx.fillStyle = '#6b6258';
    for (const [dx, dy] of [[-8, 3], [3, -2], [-2, 6]]) {
      rctx.beginPath(); rctx.ellipse(dx, dy, 5, 2.6, 0, 0, Math.PI * 2); rctx.fill();   // bodies
      rctx.strokeStyle = '#5a5249'; rctx.lineWidth = 1; rctx.lineCap = 'round';
      rctx.beginPath(); rctx.moveTo(dx - 5, dy); rctx.lineTo(dx - 9, dy + 1); rctx.stroke();   // tails
    }
    rctx.restore();
  },
};
