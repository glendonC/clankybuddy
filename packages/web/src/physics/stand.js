// Active-ragdoll pose driver.
// Strategy: every step, blend each part's angular velocity toward an angle
// that brings it back to vertical (rest=0). This keeps the *whole figure*
// stiff while standing, no death-spiral when one part tilts. Counter-gravity
// stays full-strength (independent of tilt) so the buddy doesn't crumple
// just because it's leaning. Skipped while stunned (full ragdoll flop).
//
// goLimp() is a *transient* override on top of stun: it temporarily lowers
// constraint stiffness/damping and zeros frictionAir so big impacts read as
// "ragdoll explosion" instead of "stiff body bounces a little." tickLimp()
// restores the originals when the limp window expires.

import Matter from 'matter-js';
import { engine } from '../state/world.js';
import { hitBlendScale, idleAngVelDelta, idleAmpFor, breatheFactor } from './secondary.js';
import {
  GRAVITY_SCALE, COUNTER_GRAVITY_STAND_FACTOR, COUNTER_GRAVITY_DRAG_FACTOR,
  POSE_BLEND, CHEST_VELOCITY_DAMPING, LIMP,
} from './constants.js';
const { Body, Composite, Pairs } = Matter;

const TWO_PI = Math.PI * 2;
function wrapAngle(a) {
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

export function setRestAngles(ragdoll) {
  ragdoll.stunUntil = 0;
  ragdoll.dragging = false;
}

export function stun(ragdoll, ms) {
  const until = performance.now() + ms;
  if (until > (ragdoll.stunUntil || 0)) ragdoll.stunUntil = until;
}

// Transient "ragdoll-on-steroids" mode for big impacts. Repeated calls
// during an active limp only extend the window, they do NOT re-snapshot
// (which would save the already-limp values and prevent restoration).
export function goLimp(ragdoll, ms) {
  const now = performance.now();
  const until = now + ms;
  const alreadyLimp = ragdoll.limpUntil && now < ragdoll.limpUntil;
  if (!alreadyLimp) {
    const constraints = Composite.allConstraints(ragdoll.composite);
    ragdoll._limpSaved = {
      constraints: constraints.map(c => ({ c, stiffness: c.stiffness, damping: c.damping })),
      parts: ragdoll.parts.map(p => ({ p, frictionAir: p.frictionAir })),
    };
    for (const e of ragdoll._limpSaved.constraints) {
      e.c.stiffness = LIMP.stiffness;
      e.c.damping   = LIMP.damping;
    }
    for (const e of ragdoll._limpSaved.parts) {
      e.p.frictionAir = LIMP.airDrag;
    }
  }
  if (until > (ragdoll.limpUntil || 0)) ragdoll.limpUntil = until;
}

export function tickLimp(ragdoll) {
  if (!ragdoll.limpUntil) return;
  if (performance.now() < ragdoll.limpUntil) return;
  if (ragdoll._limpSaved) {
    for (const e of ragdoll._limpSaved.constraints) { e.c.stiffness = e.stiffness; e.c.damping = e.damping; }
    for (const e of ragdoll._limpSaved.parts) { e.p.frictionAir = e.frictionAir; }
  }
  ragdoll.limpUntil = 0;
  ragdoll._limpSaved = null;
}

// Grounded check: any ragdoll part in active contact with a static body
// (canvas floor, HUD obstacle, etc.). Replaces the older "any part within
// 50px of canvas.height - 40" heuristic, which fails when the buddy is
// resting *on* a HUD obstacle (hotbar / chat cluster), the part Y is
// well above the canvas floor band, so the heuristic said "not grounded"
// and the righting force never kicked in, leaving the buddy permanently
// flopped on the hotbar.
function isGrounded(ragdoll) {
  const partSet = new Set(ragdoll.parts);
  const pairsList = engine.pairs?.list || [];
  for (const pair of pairsList) {
    if (!pair.isActive) continue;
    const a = pair.bodyA, b = pair.bodyB;
    const aIsPart = partSet.has(a);
    const bIsPart = partSet.has(b);
    if (aIsPart && b.isStatic) return true;
    if (bIsPart && a.isStatic) return true;
  }
  return false;
}

export function applyStandPose(ragdoll, gravityY = 1) {
  const now = performance.now();
  const stunned = now < (ragdoll.stunUntil || 0);
  if (stunned) return;

  const chest = ragdoll.chest;

  if (ragdoll.dragging) {
    // Kill rotational momentum per frame so the body doesn't pinwheel
    // around the cursor when held.
    for (const part of ragdoll.parts) {
      Body.setAngularVelocity(part, part.angularVelocity * 0.55);
    }
    // Light counter-gravity while dragged so joints don't overstretch
    // under full weight when the user lifts a single ball.
    const dragFactor = GRAVITY_SCALE * gravityY * COUNTER_GRAVITY_DRAG_FACTOR;
    for (const part of ragdoll.parts) {
      Body.applyForce(part, part.position, { x: 0, y: -part.mass * dragFactor });
    }
    return;
  }

  // Grounded via Matter's contact pairs, handles both the canvas floor
  // and HUD obstacles (hotbar / chat cluster). Top-quarter exclusion
  // stays: counter-gravity against the ceiling pins the body instead of
  // letting it fall down.
  const grounded = isGrounded(ragdoll);
  const ceilY = engine.world.bounds?.max?.y ?? 800;
  const nearCeiling = chest.position.y < ceilY * 0.25;
  if (!grounded || nearCeiling) return;

  // Counter-gravity scaled so the buddy can hold its standing pose
  // without crumpling under leg load. Slightly under 1.0 so it still
  // settles onto the floor instead of floating. breatheFactor adds a
  // ±1.8% sine modulation at ~18 bpm so the chest visibly expands/contracts.
  const factor = GRAVITY_SCALE * gravityY * COUNTER_GRAVITY_STAND_FACTOR * breatheFactor(now);
  for (const part of ragdoll.parts) {
    Body.applyForce(part, part.position, { x: 0, y: -part.mass * factor });
  }

  // Per-part orientation correction, drives the whole figure back toward
  // upright after a knockdown. With foot-floor friction as the pivot, the
  // torso/leg righting bias rotates the chain back to standing emergently;
  // arms (blend 0.04) stay loose so they swing naturally.
  // _poseOverride lets behavior/scheduler.js bend the rest pose per partType.
  // hitBlendScale gates the correction so a freshly-impacted part briefly
  // drops out of the pose (recoils naturally) before easing back in.
  // idleAngVelDelta adds a tiny noise nudge so arms/head/legs sway at rest.
  const overrides = ragdoll._poseOverride || null;
  for (const part of ragdoll.parts) {
    const base = POSE_BLEND[part.partType] || POSE_BLEND.arm;
    const cfg = (overrides && overrides[part.partType]) || base;
    const blend = cfg.blend * hitBlendScale(part, now);
    const drift = idleAngVelDelta(part, now, idleAmpFor(part.partType));
    const delta = wrapAngle(part.angle - cfg.rest);
    const targetAngVel = -delta * 4 + drift;
    Body.setAngularVelocity(
      part,
      part.angularVelocity * (1 - blend) + targetAngVel * blend
    );
  }

  Body.setVelocity(chest, { x: chest.velocity.x * CHEST_VELOCITY_DAMPING, y: chest.velocity.y });
}
