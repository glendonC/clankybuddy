// S-B3a — Gravity well (placed inward sink) force Mode.
//
// Registers on the bus with phase:'physics' so its force loop integrates in the
// 60Hz inner physics step (CLAUDE.md fixed-timestep rule; a 'frame'-phase force
// would apply once per render and read as jelly). Unlike the magnet (which pulls
// toward the live cursor), the well pulls toward a FIXED point — a placed sensor
// body the gravity-well ability drops into ctx.transientBodies. The Mode owns no
// well list; it reads the live well bodies each tick (filter by partType), so
// their lifeMs auto-expiry + epoch-wipe come free from transients/index.js's
// cleanupTransients + spawnRagdoll. The ability flips this Mode on
// (setEnabled('force.gravity_well', true)); the Mode self-disables here once no
// live well bodies remain.
//
// CONVENTION — the well is a SINK, not a lift. Its counter-gravity term is +y
// DOWN (effects/in-blackhole.js:28's convention), gated on isStanding, so it
// CANCELS the stand pose's upward lift and the inward pull actually reads. This
// is the opposite sign from the magnet (whose -y lift is correct ONLY because
// its verb is to suspend the buddy). A -y here would stack a second uncancelled
// upward force on top of stand.js's lift → the "two upward forces rocket the
// buddy into the ceiling" trap. Do not flip it.
//
// Every NaN guard below is copied VERBATIM from modes/force-magnet.js (the
// shipped, regression-tested force loop). We borrow only the 1/(1+dist*k)
// falloff SHAPE from in-blackhole.js — NOT its `|| 1` divisor or its missing
// clamp, both of which are unsafe for a clamped placed field. Do not loosen
// these without re-reading CLAUDE.md "Physics tuning landmines".

import Matter from 'matter-js';
import { register, setEnabled } from './bus.js';
import { engine } from '../state/world.js';
import { isStanding } from '../physics/stand.js';
import { getStats } from '../abilities/_stats.js';
import {
  COUNTER_GRAVITY_NEUTRALIZER, COLLISION_CATEGORY,
} from '../physics/constants.js';

const { Body } = Matter;

export const FORCE_GRAVITY_WELL_ID = 'force.gravity_well';

// --- Tuned constants (NaN guards live here, not at the call site) ---

// Reach in px; parts farther than this from the well center are untouched.
const DEFAULT_RANGE = 280;
// Force-per-mass coefficient at zero distance (before softening). Same order of
// magnitude as the magnet's pull / in-blackhole's 0.005 so the well reads as a
// physical inward drag, not a teleport.
const DEFAULT_PULL = 0.006;
// Distance-softening like effects/in-blackhole.js: F *= 1/(1 + dist*k).
const SOFTEN_K = 0.004;
// HARD CEILING on |force-per-mass|. With single-well placement (the ability
// removes any prior well before dropping a new one) at most one well pulls any
// part, so this per-well clamp is the whole firewall: a force this size can
// never blow up the 0.85-stiffness joint solver in one step.
const MAX_PULL = 0.012;
// Below this distance the part is effectively AT the well center: apply ZERO
// force. The real NaN guard, NOT a `|| 1` divisor (which would divide a ~0
// dx/dy by 1 and yield a near-zero direction the clamp then scales up).
const EPS = 1e-3;

// Live well bodies in the world (placed sensor markers, partType:'gravity_well').
// The Mode reads these each tick rather than owning a list, so lifecycle (lifeMs
// expiry) + epoch-wipe + render are all owned by the transient machinery.
export function activeWellBodies(transientBodies) {
  const out = [];
  if (!transientBodies) return out;
  for (const b of transientBodies) {
    if (b && b.partType === 'gravity_well' && !b._spent) out.push(b);
  }
  return out;
}

// True when the part is in active contact with a static HUD body (hotbar / chat
// cluster). Pulling such a part toward the well would drive a default-mask
// ragdoll ball INTO infinite-mass static geometry — the classic trap. We skip
// the pull for those parts this step. COPIED VERBATIM from force-magnet.js (NOT
// imported: per the red-team, do not refactor the shipped magnet to share this).
function pressedIntoHud(part) {
  const pairsList = engine.pairs?.list || [];
  for (const pair of pairsList) {
    if (!pair.isActive) continue;
    const a = pair.bodyA, b = pair.bodyB;
    let other = null;
    if (a === part) other = b;
    else if (b === part) other = a;
    else continue;
    if (other.isStatic &&
        (other.collisionFilter?.category & COLLISION_CATEGORY.HUD)) {
      return true;
    }
  }
  return false;
}

function tick(ctx) {
  const ragdoll = ctx?.ragdoll;
  if (!ragdoll || !ragdoll.parts) return;

  const wells = activeWellBodies(ctx.transientBodies);
  if (!wells.length) {
    // No live wells: self-disable. The bus queues this mid-tick toggle and
    // applies it after the pass (modes/bus.js), so it's safe to call here.
    setEnabled(FORCE_GRAVITY_WELL_ID, false);
    return;
  }

  const s = getStats('gravity_well') || {};
  const range   = Number.isFinite(s.range)   ? s.range   : DEFAULT_RANGE;
  const pull    = Number.isFinite(s.pull)    ? s.pull    : DEFAULT_PULL;
  const soften  = Number.isFinite(s.soften)  ? s.soften  : SOFTEN_K;
  const maxPull = Number.isFinite(s.maxPull) ? s.maxPull : MAX_PULL;

  // Whether the stand pose currently owns the body's weight. The lift-CANCEL
  // below only fires while it does, so it never adds gratuitous downforce on an
  // airborne buddy (there's no stand lift to cancel then).
  const lifting = isStanding(ragdoll);

  for (const well of wells) {
    const wx = well.position.x, wy = well.position.y;
    for (const part of ragdoll.parts) {
      // INWARD: from the part TOWARD the well center (sink, never eject).
      const dx = wx - part.position.x;
      const dy = wy - part.position.y;
      const dist = Math.hypot(dx, dy);

      // Out of reach: untouched.
      if (dist > range) continue;
      // At-center singularity: ZERO force (NaN guard — see EPS note above).
      if (dist < EPS) continue;
      // Never drag a part into static HUD geometry this step.
      if (pressedIntoHud(part)) continue;

      // Softened magnitude, then hard-clamped to the ceiling.
      let mag = pull / (1 + dist * soften);
      if (mag > maxPull) mag = maxPull;
      if (!Number.isFinite(mag) || mag <= 0) continue;

      const nx = dx / dist, ny = dy / dist;
      const F = mag * part.mass;
      Body.applyForce(part, part.position, { x: nx * F, y: ny * F });

      // Counter-gravity lift-CANCEL, +y DOWN (in-blackhole.js:28 convention).
      // COUNTER_GRAVITY_NEUTRALIZER is pre-multiplied (GRAVITY_SCALE * GRAVITY_Y
      // * stand factor) so it tracks the standing pose's lift exactly. Gated on
      // isStanding so it only cancels a lift that's actually there — never adds
      // a second upward force, never a sink-when-falling artifact.
      //
      // NOTE: the well body is a static SENSOR. isGrounded() now skips sensor
      // pairs (stand.js), so a part overlapping the small well marker no longer
      // reads as "grounded" — isStanding is true only on a genuine solid floor.
      // (Even before that fix this cancel was benign: +y DOWN only ever added
      // harmless extra sink, never lift.)
      if (lifting) {
        Body.applyForce(part, part.position, {
          x: 0, y: COUNTER_GRAVITY_NEUTRALIZER * part.mass,
        });
      }
    }
  }
}

register({
  id: FORCE_GRAVITY_WELL_ID,
  phase: 'physics',
  defaultEnabled: false,
  tick,
});
