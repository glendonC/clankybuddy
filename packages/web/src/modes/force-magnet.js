// S5 — Magnet (tractor beam) force Mode.
//
// Registers on the bus with phase:'physics' so its force loop integrates in
// the 60Hz inner physics step (CLAUDE.md fixed-timestep rule; a 'frame'-phase
// force would apply once per render and read as jelly). The magnet ability's
// apply(ctx) flips this Mode on (setEnabled('force.magnet', true)); the
// generic forceMode seam in input/mouse.js (mouseup) + ui/hotbar.js
// (setActiveTool) flips it off again.
//
// This is the highest NaN-risk substrate in the redesign. Every guard below
// is a scar from the "soft force + stiff ragdoll joints into static HUD" trap
// and the "forgot GRAVITY_SCALE → rocketed into the ceiling" trap. Do not
// loosen them without re-reading CLAUDE.md "Physics tuning landmines".

import Matter from 'matter-js';
import { register } from './bus.js';
import { mouseConstraint, engine } from '../state/world.js';
import { isStanding } from '../physics/stand.js';
import { getStats } from '../abilities/_stats.js';
import {
  COUNTER_GRAVITY_NEUTRALIZER, COLLISION_CATEGORY,
} from '../physics/constants.js';

const { Body } = Matter;

export const FORCE_MAGNET_ID = 'force.magnet';

// --- Tuned constants (NaN guards live here, not at the call site) ---

// Reach in px; parts farther than this from the cursor are untouched.
const DEFAULT_RANGE = 240;
// Force-per-mass coefficient at zero distance (before softening). Kept in the
// same order of magnitude as in-blackhole's 0.005 inward pull so the tractor
// reads as "physical drag toward the cursor", not a teleport.
const DEFAULT_PULL = 0.006;
// Distance-softening like effects/in-blackhole.js: F *= 1/(1 + dist*k). Higher
// k = the pull falls off faster with distance.
const SOFTEN_K = 0.004;
// HARD CEILING on |force-per-mass|. Even with softening this clamp is the last
// line of defense against a NaN-spiral: a force this size can never blow up the
// 0.85-stiffness joint solver in one step. Tuned just above the un-softened
// near-cursor value so close pulls feel strong but bounded.
const MAX_PULL = 0.012;
// Below this distance the part is effectively AT the cursor: apply ZERO force.
// This is the real NaN guard, NOT a `|| 1` divisor. A `|| 1` still divides a
// ~0 dx/dy by 1 and yields a near-zero direction that the clamp would then
// scale up unpredictably; zeroing the force outright is the only safe move
// when the normalization denominator collapses.
const EPS = 1e-3;

// True when the part is currently in active contact with a static HUD body
// (hotbar / chat cluster). Pulling such a part toward the cursor would drive
// a default-mask ragdoll ball INTO infinite-mass static geometry — the classic
// trap. We skip the pull for those parts this step; they're released the
// instant they break contact. (The grab tool dodges this by clearing the HUD
// mask on its MouseConstraint; a force loop can't toggle a per-body mask
// safely mid-step, so we gate on contact instead.)
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

  // Live cursor in world/canvas coordinates. Matter updates
  // mouseConstraint.mouse.position on every mousemove/touchmove; a
  // physics-phase Mode has no event args, so this singleton is the canonical
  // live-pointer read (the ctx carries no per-frame cursor).
  const cur = mouseConstraint?.mouse?.position;
  if (!cur || !Number.isFinite(cur.x) || !Number.isFinite(cur.y)) return;

  const s = getStats('magnet') || {};
  const range  = Number.isFinite(s.range)  ? s.range  : DEFAULT_RANGE;
  const pull   = Number.isFinite(s.pull)   ? s.pull   : DEFAULT_PULL;
  const soften = Number.isFinite(s.soften) ? s.soften : SOFTEN_K;
  const maxPull = Number.isFinite(s.maxPull) ? s.maxPull : MAX_PULL;

  // Whole-body lift (suspend the buddy) is COUNTER_GRAVITY-grade and is ONLY
  // legitimate while the stand pose owns the body's weight. Once parts leave
  // the floor, applyStandPose has already bailed (not grounded), so injecting
  // lift here would be a SECOND uncancelled upward force → ceiling rocket.
  const lifting = isStanding(ragdoll);

  for (const part of ragdoll.parts) {
    const dx = cur.x - part.position.x;
    const dy = cur.y - part.position.y;
    const dist = Math.hypot(dx, dy);

    // Out of reach: untouched.
    if (dist > range) continue;
    // At-cursor singularity: ZERO force (NaN guard — see EPS note above).
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

    // Counter-gravity lift, applied EXACTLY as effects/in-blackhole.js does:
    // COUNTER_GRAVITY_NEUTRALIZER is pre-multiplied (GRAVITY_SCALE * GRAVITY_Y
    // * stand factor) so it cancels the standing pose's lift without
    // re-deriving the constant. Gated on isStanding so it never stacks.
    if (lifting) {
      Body.applyForce(part, part.position, {
        x: 0, y: -COUNTER_GRAVITY_NEUTRALIZER * part.mass,
      });
    }
  }
}

register({
  id: FORCE_MAGNET_ID,
  phase: 'physics',
  defaultEnabled: false,
  tick,
});
