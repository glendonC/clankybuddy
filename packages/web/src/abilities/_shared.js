// Shared primitives every ability composes against.
// Helpers stay framework-light: they take ctx (built by main.js's abilityCtx())
// and operate via the bound singletons (mood, status, ragdoll, etc.).

import Matter from 'matter-js';
import * as P from '../particles.js';
import { sfx } from '../audio/sfx.js';
import { applyMoodDelta } from '../mood.js';
import { stun, goLimp } from '../physics/stand.js';
import {
  applyStatus, removeStatus, hasStatus, isBrittle,
  damageMul, consumeConcussed, findConcussedInRange,
} from '../effects/registry.js';
import { markHit } from '../physics/secondary.js';
import { getCurrentBuddy } from '../state/ragdoll-lifecycle.js';
import { showCombo } from '../ui/overlays.js';
import { getMasterMul } from '../progression/master-mults.js';
import { HIT_STOP } from '../physics/constants.js';

const { Body, Composite, Vector } = Matter;

// --- Vector helpers (consolidated from per-ability hand-rolls) ---

/** Unit direction + distance from (fromX, fromY) to a target point.
 *  Returns { nx, ny, dist }. dist is clamped to ≥1 to avoid /0 in callers. */
export function dirTo(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  const d = Math.hypot(dx, dy) || 1;
  return { nx: dx / d, ny: dy / d, dist: d };
}

// --- Force application ---
//
// Force-units rule for the codebase: callers express direction via a unit
// vector and magnitude via "force per part-mass" (the natural Matter unit
// for applyForce, since per-step acceleration = force / mass). The
// applyImpulseScaled helper multiplies by mass internally so abilities
// don't reinvent the multiplication, every caller agrees on one shape.
//
// Velocity-additive impulses (explode / bigImpact / direct setVelocity)
// stay separate from this helper because they target instantaneous
// motion, not integrated force.
//
// Mass-scaled upward bias is built in: a flat -0.0006 yanks light arms
// over the head harder than the heavier torso (flame's old behavior,
// fixed). Pass `upBias` in the same force-per-mass unit and it scales
// per part mass automatically.

/** Apply a force-per-mass impulse to a part along (nx, ny) with optional
 *  mass-scaled upward bias. Returns the actual (fx, fy) applied so callers
 *  can pass a comparable magnitude to recordHit.                          */
export function applyImpulseScaled(part, nx, ny, magnitude, upBias = 0) {
  const F = magnitude * part.mass;
  const fx = nx * F;
  const fy = ny * F - upBias * part.mass;
  applyImpulse(part, fx, fy);
  return { fx, fy };
}

// Threshold separating "touch" impulses (pet, ~6e-5) from "hit" impulses
// (punch ~8e-2 and up). Below threshold: just nudge the body, don't trigger
// the hit-reaction blend-down or the additive propagation pass, pet should
// read as a touch, not a punch.
const HIT_IMPULSE_MIN = 5e-4;

// Naughty-Dog-style "additive ragdoll": one-hop propagation of the impulse
// to direct constraint neighbors at fractional strength. Solver-only
// transmission through stiff joints reads as a chain of rigid bodies; the
// fractional secondary impulse makes the limbs flail naturally and the
// torso recoil when the head takes a hit.
const PROPAGATE_FACTOR = 0.30;

export function nearestPart(ragdoll, x, y) {
  let best = null, bestD = Infinity;
  for (const p of ragdoll.parts) {
    const dx = p.position.x - x, dy = p.position.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

export function partInRange(ragdoll, x, y, range) {
  const part = nearestPart(ragdoll, x, y);
  if (!part) return null;
  const d = Math.hypot(part.position.x - x, part.position.y - y);
  return d <= range ? part : null;
}

export function applyImpulse(part, fx, fy) {
  // Master-tree damage multiplier. Touch-tier impulses (below HIT_IMPULSE_MIN,
  // e.g. pet) bypass the multiplier so a pet doesn't get scaled into a hit.
  // Mastery currently retired (2026-05-24) so this defaults to 1.
  const dMul = getMasterMul('damageMul') || 1;
  const isHit = Math.hypot(fx, fy) >= HIT_IMPULSE_MIN;
  const sx = isHit ? fx * dMul : fx;
  const sy = isHit ? fy * dMul : fy;
  Body.applyForce(part, part.position, { x: sx, y: sy });
  if (!isHit) return;
  // Hit (not just a touch), register for blend-down and propagate.
  markHit(part);
  const buddy = getCurrentBuddy();
  if (buddy?.ragdoll?.composite) {
    propagateImpulse(buddy.ragdoll, part, sx * PROPAGATE_FACTOR, sy * PROPAGATE_FACTOR);
  }
}

function propagateImpulse(ragdoll, hitPart, fx, fy) {
  const cs = Composite.allConstraints(ragdoll.composite);
  for (const c of cs) {
    let neighbor = null;
    if (c.bodyA === hitPart) neighbor = c.bodyB;
    else if (c.bodyB === hitPart) neighbor = c.bodyA;
    if (!neighbor) continue;
    Body.applyForce(neighbor, neighbor.position, { x: fx, y: fy });
    // Don't markHit on neighbors, only the directly-impacted part should
    // go limp. Neighbors transmit the impulse but stay actively posed so
    // the chain reads as a connected body, not a pile of rags.
  }
}

// Shape-agnostic "size" for status overlay glows. Circles return circleRadius;
// rectangles return half the longer bbox dim. Falls back to 24 to match the
// historical literal that lived in every status renderer.
export function partRadius(part) {
  if (part?.circleRadius) return part.circleRadius;
  const b = part?.bounds;
  if (!b) return 24;
  return Math.max(b.max.x - b.min.x, b.max.y - b.min.y) / 2;
}

// Single source of truth for explosion damage so rocket/grenade/fireball agree.
//
// `baseVel` is the additive radial fling in px/step at the blast center
// (falloff to zero at the radius). 14-18 = grenade/rocket weight, 28+ = nuke
// weight, ~24 = blackhole eject. `upBias` adds an extra upward kick scaled
// by the same falloff. `limpMs` is how long the ragdoll's joints stay
// loosened after the blast, see physics/stand.js's goLimp.
//
// The legacy `opts.force` (force-per-step, ~0.1-0.3 range) was retired in
// the 2026-05-11 physics refactor. Callers pass `baseVel` directly.
export function explode(ctx, x, y, opts = {}) {
  if (opts.force != null) {
    // Loud failure on the deprecated knob, silent conversion was the
    // exact bug ("two unit systems coexist") the refactor closed.
    throw new Error('explode(): opts.force was removed, pass baseVel (px/step) instead');
  }
  const {
    radius = 220,
    baseVel = 14,
    upBias = 4,
    moodDelta = -28,
    stunMs = 1500,
    igniteMs = 0,
    shake = 28,
    fireDuration = 0,
    sound = 'bomb',
    limpMs = 800,
  } = opts;
  bigImpact(ctx, x, y, {
    radius, baseVel, upBias, moodDelta, stunMs, igniteMs, shake, sound, limpMs,
  });
  // Particle visual layer is the "explosion look" (fire + smoke + sparks).
  // Kept here rather than inside bigImpact so non-explosion impacts (anvil
  // squash, blackhole eject) can choose their own particle palette.
  const { ragdoll, status } = ctx;
  let combo = false;
  for (const p of ragdoll.parts) {
    const dx = p.position.x - x, dy = p.position.y - y;
    if (Math.hypot(dx, dy) < radius && isBrittle(status, p)) { shatter(ctx, p); combo = true; }
  }
  P.burst(x, y, Math.min(50, Math.round(radius / 6)),  { type: 'fire',  color: '#ff6b1a', size: 18, life: 700,  speedRange: 1.4, gravity: -0.0006 });
  P.burst(x, y, Math.min(30, Math.round(radius / 10)), { type: 'smoke', color: '#444',    size: 26, life: 1200, speedRange: 0.6, gravity: -0.0006 });
  P.burst(x, y, Math.min(36, Math.round(radius / 7)),  { type: 'spark', color: '#fff',    size: 3,  life: 500,  speedRange: 1.2 });
  if (fireDuration > 0) ctx._spawnFirePool?.(x, y, fireDuration);
  return combo;
}

// Radial fling primitive. Sets velocity additively (impacts compound) instead
// of accumulating per-step force, so a single hit produces an immediate,
// visible launch. Pairs with goLimp() so the body actually flails mid-flight.
// Used by explode() and direct callers (nuke, blackhole eject, anvil).
export function bigImpact(ctx, x, y, opts = {}) {
  const {
    radius = 220,
    baseVel = 14,
    upBias = 4,
    moodDelta = 0,
    stunMs = 0,
    igniteMs = 0,
    shake = 0,
    sound,
    limpMs = 800,
    angularJitter = 0.4,
  } = opts;
  const { ragdoll, mood, status, screenShake } = ctx;
  // CONCUSSED consume, once per blast.
  const concussedPart = findConcussedInRange(status, ragdoll, x, y, radius);
  const mul = concussedPart ? damageMul(status, concussedPart) : 1;
  if (mul > 1) consumeConcussed(status, concussedPart);
  const hitParts = [];
  for (const p of ragdoll.parts) {
    const dx = p.position.x - x, dy = p.position.y - y;
    const d = Math.hypot(dx, dy);
    if (d >= radius) continue;
    const falloff = 1 - d / radius;
    const brittle = isBrittle(status, p);
    const massMul = brittle ? 1.4 : 1;
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const v = baseVel * falloff * massMul;
    Body.setVelocity(p, {
      x: p.velocity.x + nx * v,
      y: p.velocity.y + ny * v - upBias * falloff * massMul,
    });
    Body.setAngularVelocity(p, p.angularVelocity + (Math.random() - 0.5) * angularJitter * falloff);
    // Every part inside the blast goes briefly limp, the orientation pass
    // shouldn't be fighting the explosion's velocity injection.
    markHit(p);
    hitParts.push({ part: p, impulse: v });
    if (igniteMs > 0 && !hasStatus(status, p, 'frozen')) {
      // igniteMs is kept as a flag (>0 = ignite). Fire is persistent, it
      // burns until an opposing input cures it. The numeric value used to
      // be the burn timer; preserved as the on/off switch for callers.
      applyStatus(status, p, 'on_fire', { intensity: 1, source: sound });
    }
  }
  const appliedMoodDelta = moodDelta * mul;
  // Per-part reactTo emits the shock spike + telemetry + stimulus speech for
  // each part hit by the blast. Source defaults to the sfx key (which doubles
  // as the persona pool key for blast lines, 'bomb', 'nuke', etc.) so the
  // buddy says blast-flavored lines instead of generic mood lines.
  if (appliedMoodDelta && hitParts.length) {
    const perPartDelta = appliedMoodDelta / hitParts.length;
    for (const hit of hitParts) {
      ctx.reactTo?.({
        source: sound || 'big_explosion',
        part: hit.part,
        impulse: hit.impulse,
        moodDelta: perPartDelta,
        // Speak only off the head share, otherwise every limb in the blast
        // tries to talk and the throttle drops them anyway. Pass a long
        // speakMs to the head and zero-out the others.
        speakMs: hit.part === ragdoll.head ? 400 : 99999,
      });
    }
  } else if (appliedMoodDelta) {
    // No parts in range but moodDelta supplied, still apply.
    applyMoodDelta(mood, appliedMoodDelta);
  }
  if (stunMs) stun(ragdoll, stunMs);
  if (limpMs) goLimp(ragdoll, limpMs);
  if (sound && sfx[sound]) sfx[sound]();
  if (shake) screenShake(shake, Math.min(800, 200 + radius));
}

// Frozen part hit by impact weapon → bonus damage + ice burst + slow-mo.
export function shatter(ctx, part) {
  const { status, screenShake, popBubble, hitStop } = ctx;
  removeStatus(status, part, 'frozen');
  // Hardcoded "*kchhhhing*" wins over the pool, it's an iconic scripted
  // reaction. reactTo handles mood + shock + telemetry; we suppress speech
  // by passing a huge speakMs and then call popBubble directly with the
  // canonical line.
  ctx.reactTo?.({ source: 'shatter', part, moodDelta: -25, speakMs: 99999 });
  P.burst(part.position.x, part.position.y, 18, { type: 'ice',   color: '#9be7ff', size: 6, life: 700, speedRange: 1.0 });
  P.burst(part.position.x, part.position.y,  8, { type: 'spark', color: '#fff',    size: 3, life: 350, speedRange: 0.8 });
  sfx.shatter();
  screenShake(14, 280);
  hitStop?.(HIT_STOP.shatter.ms, HIT_STOP.shatter.scale);  // brief slow-mo so you SEE the shatter
  showCombo?.('SHATTER!', '#9be7ff');
  popBubble(part, '*kchhhhing*');
}

// Lightning hits a burning part: small explosion, ignites neighbors.
export function combust(ctx, part) {
  const { status, ragdoll, screenShake } = ctx;
  ctx.reactTo?.({ source: 'combust', part, moodDelta: -20, speakMs: 99999 });
  P.burst(part.position.x, part.position.y, 22, { type: 'fire',  color: '#ff6b1a', size: 10, life: 500, speedRange: 1.0, gravity: -0.0004 });
  P.burst(part.position.x, part.position.y, 10, { type: 'spark', color: '#ffd266', size: 3,  life: 300, speedRange: 1.0 });
  sfx.combust();
  screenShake(12, 240);
  // ignite the two nearest neighbors
  const others = ragdoll.parts.filter(p => p !== part);
  others.sort((a, b) =>
    Math.hypot(a.position.x - part.position.x, a.position.y - part.position.y) -
    Math.hypot(b.position.x - part.position.x, b.position.y - part.position.y));
  for (const n of others.slice(0, 2)) {
    if (!hasStatus(status, n, 'frozen')) applyStatus(status, n, 'on_fire', { source: 'combust' });
  }
  showCombo?.('COMBUST!', '#ff6b1a');
}
