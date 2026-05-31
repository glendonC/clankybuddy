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
// NOTE: 'concussed' and 'electrified' are applied via applyStatus(status, part,
// '<id>', {duration}). They are registered effect ids; spawnDrop's optional
// concussOnImpact / electrifyMs cfg fields route through the same applyStatus.
import { markHit } from '../physics/secondary.js';
import { getCurrentBuddy } from '../state/ragdoll-lifecycle.js';
import { showCombo } from '../ui/overlays.js';
import { getMasterMul } from '../progression/master-mults.js';
import { getFamilyStats } from './_stats.js';
import { HIT_STOP } from '../physics/constants.js';

const { Body, Bodies, Composite, Vector } = Matter;

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

// --- Segment geometry (melee sweep substrate, Batch 3B) ---
//
// Perpendicular distance from point P to segment AB, with the clamped
// projection parameter t. Identical math to the lightsaber/chainsaw
// `segmentDistance` hand-rolls; consolidated here so sweep weapons share
// one implementation. lenSq is OR-1'd so a degenerate (zero-length)
// segment can't divide by zero.
function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const lenSq = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

// Ragdoll parts whose CENTER lies within `radius` of the segment
// (ax,ay)→(bx,by). Used by sweep melee (machete/chainsaw-style line damage)
// to gather every part the blade crosses in one pass. The segment-distance
// math matches lightsaber.js exactly. A degenerate (zero-length) segment is
// NaN-guarded by segmentDistance's `|| 1` denominator, it collapses to a
// radius test around the single point (ax,ay).
export function gatherInSegment(ragdoll, ax, ay, bx, by, radius) {
  const out = [];
  if (!ragdoll?.parts) return out;
  for (const p of ragdoll.parts) {
    const { dist } = segmentDistance(p.position.x, p.position.y, ax, ay, bx, by);
    if (dist <= radius) out.push(p);
  }
  return out;
}

// SWEEP-IMPACT, melee line/arc damage applicator (Batch 3B substrate).
//
// IMPULSE LANE, NOT splash. sweepImpact routes every hit through
// applyImpulseScaled → applyImpulse, so each struck part inherits the full
// hit-impulse pipeline: the master damageMul, the markHit blend-down, and
// the ~0.30× one-hop neighbor PROPAGATE_FACTOR that makes limbs flail. This
// is deliberately DIFFERENT from the spawnDrop / bigImpact "squashVel +
// splashForce" lane, which sets velocity directly and shoves neighbors by a
// separate falloff. A melee sweep is a series of solid hits, not a blast, so
// it must use the impulse lane. Do not reroute it through setVelocity.
//
// `marker` is an OPAQUE dedupe pair { seen(partId) -> bool, mark(partId) }.
// One swing passes a Set-backed marker (each part hit at most once per
// frame); a persistent hazard (a lingering damage volume) passes a
// time-map-backed marker so a part can be re-hit only after a cooldown. The
// caller owns the marker's lifetime and semantics; sweepImpact only asks
// "have you seen this part?" and "mark it."
//
// Returns the array of parts actually struck this call (post-dedupe) so the
// caller can spawn per-part VFX / apply statuses / count hits.
//
// opts: { upBias = 0 } — mass-scaled upward bias forwarded to
// applyImpulseScaled (same force-per-mass unit as everywhere else).
export function sweepImpact(ctx, parts, nx, ny, mag, marker, opts = {}) {
  const { upBias = 0 } = opts;
  const hit = [];
  for (const part of parts) {
    if (marker.seen(part.id)) continue;
    marker.mark(part.id);
    applyImpulseScaled(part, nx, ny, mag, upBias);
    hit.push(part);
  }
  return hit;
}

// Aimed-firearm tool ids. These route their cursor + apply through aimAngle()
// so the auto-aim ("aimbot") is gated behind the firearms shared unlock
// instead of being always-on. Everything else keeps cursor-faces-nearest-part.
export const AIMED_FIREARMS = new Set(['gun', 'machinegun', 'smg', 'shotgun', 'rocket', 'cannon', 'grapeshot', 'chain_shot', 'hot_shot', 'sonic_cannon']);

// Resolve the firing angle for an aimed weapon. With the `aimbot` family flag
// unlocked, it locks onto the NEAREST part (returns that part as `target` so
// the cursor can draw the aim-line + reticle). Without it — the manual
// baseline — it fires along the ray to the ragdoll CENTROID and returns
// `target: null` (the cursor shows a plain crosshair, no lock). `ok` is false
// only when there's no buddy to aim at.
export function aimAngle(ragdoll, x, y, family = 'firearms') {
  const parts = ragdoll?.parts || [];
  if (!parts.length) return { angle: 0, target: null, ok: false };
  const fam = getFamilyStats(family);
  if (fam?.aimbot) {
    const target = nearestPart(ragdoll, x, y);
    return { angle: Math.atan2(target.position.y - y, target.position.x - x), target, ok: true };
  }
  // Manual: aim at the centroid of the ragdoll (not the optimal nearest part).
  let cx = 0, cy = 0;
  for (const p of parts) { cx += p.position.x; cy += p.position.y; }
  cx /= parts.length; cy /= parts.length;
  return { angle: Math.atan2(cy - y, cx - x), target: null, ok: true };
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

// Falling-object drop factory. Generalizes the anvil pattern (spawn a heavy
// body offscreen-above, let gravity accelerate it, squash the nearest part +
// splash neighbors on impact) so brick / bowling ball / piano / car / fridge
// all share one code path. The body falls under real gravity (low initial
// velocity → "wait for it" anticipation); `cfg` tunes mass, footprint, and
// the impact response. Returns the spawned body so callers can attach an
// overlay (anvil's drop reticle) before it lands.
//
// cfg knobs:
//   partType, verb            transient key + telemetry/speech source
//   shape 'rect'|'circle', w/h | radius
//   density, restitution, friction
//   dropHeight, initVel, lifeMs
//   mood                      mood damage on impact (positive; subtracted)
//   squashVel                 downward velocity slammed onto the struck part
//   splashRadius, splashForce neighbor shove
//   roll                      angular velocity kicked onto the struck part (bowling/fridge tumble)
//   igniteMs                  >0 → ignite the struck part
//   shake, shakeMs, hitStopTier ('light'|'heavy'|'explosion'|'mega'|null)
//   sfxName                   played on spawn
//   impactSfx                 played on impact
//   particles(ctx2, bx, by)   optional impact particle override
//   onImpact(b, world, ctx2, part)  optional extra impact hook
//
// ADDITIVE optional knobs (default to current behavior; existing anvil/brick/
// bowling/piano callers behave byte-for-byte identically because every default
// below is a no-op):
//   concussOnImpact (bool, default false)  apply 'concussed' to the struck
//                                          part in the built-in onHit, BEFORE
//                                          the optional onImpact seam runs.
//   concussMs (number, default 5000)       duration for the above (only used
//                                          when concussOnImpact is set).
//   electrifyMs (number, default 0)        symmetric with igniteMs: >0 applies
//                                          'electrified' for that many ms to the
//                                          struck part (unless frozen-guarded
//                                          like igniteMs? no — electrified is
//                                          orthogonal to frozen, so it applies
//                                          unconditionally), BEFORE onImpact.
//   splashMul (number, default 1)          widens the EXISTING splash loop by
//                                          multiplying splashRadius AND
//                                          splashForce. Wide-body crush (car /
//                                          CRT) cranks this instead of adding a
//                                          second multi-squash loop, so reactTo
//                                          stays single-fire on the nearest part
//                                          (one mood reaction, bigImpact
//                                          discipline preserved).
//   squashMul (number, default 1)          multiplies the downward squashVel
//                                          slammed onto the struck part (and the
//                                          squashVel*0.2 component fed into the
//                                          splash), for heavier wide-bodies.
export function spawnDrop(ctx, cfg) {
  const {
    partType, verb,
    shape = 'rect', w = 80, h = 48, radius = 20,
    density = 0.012, restitution = 0.05, friction = 0.9,
    dropHeight = 640, initVel = 4, lifeMs = 2600,
    mood = 16, squashVel = 16, splashRadius = 100, splashForce = 5,
    roll = 0, igniteMs = 0,
    shake = 12, shakeMs = 500, hitStopTier = 'heavy',
    sfxName, impactSfx, particles, onImpact,
    // Additive (defaults = current behavior).
    concussOnImpact = false, concussMs = 5000,
    electrifyMs = 0,
    splashMul = 1, squashMul = 1,
  } = cfg;
  // Resolve the wide-body multipliers once. With the defaults (all 1) these
  // are identical to the raw cfg values, so existing callers are unchanged.
  const effSquashVel    = squashVel * squashMul;
  const effSplashRadius = splashRadius * splashMul;
  const effSplashForce  = splashForce * splashMul;
  const { world, x, y } = ctx;
  const srcVerb = verb || ctx._verb || partType;
  const opts = { density, restitution, friction, label: partType, render: { visible: false } };
  const body = shape === 'circle'
    ? Bodies.circle(x, y - dropHeight, radius, opts)
    : Bodies.rectangle(x, y - dropHeight, w, h, opts);
  body.partType = partType;
  body._verb = srcVerb;
  body.bornAt = performance.now();
  body.lifeMs = lifeMs;
  body.onHit = (b, _world, ctx2) => {
    if (b._didDropHit) return; b._didDropHit = true;
    const part = nearestPart(ctx2.ragdoll, b.position.x, b.position.y);
    if (part) {
      if (isBrittle(ctx2.status, part)) shatter(ctx2, part);
      Body.setVelocity(part, { x: part.velocity.x, y: part.velocity.y + effSquashVel });
      if (roll) Body.setAngularVelocity(part, part.angularVelocity + (Math.random() < 0.5 ? -roll : roll));
      for (const other of ctx2.ragdoll.parts) {
        if (other === part) continue;
        const dx = other.position.x - part.position.x;
        const dy = other.position.y - part.position.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < effSplashRadius) {
          const f = (1 - d / effSplashRadius) * effSplashForce;
          Body.setVelocity(other, {
            x: other.velocity.x + (dx / d) * f,
            y: other.velocity.y + (dy / d) * f * 0.4 + effSquashVel * 0.2,
          });
        }
      }
      if (igniteMs > 0 && !hasStatus(ctx2.status, part, 'frozen')) {
        applyStatus(ctx2.status, part, 'on_fire', { source: srcVerb });
      }
      // Additive status seam: CONCUSSED / ELECTRIFIED apply to the struck part
      // BEFORE the onImpact hook (so a custom onImpact can read/extend them).
      // Both default off (concussOnImpact:false, electrifyMs:0) → no-op for
      // existing callers.
      if (concussOnImpact) {
        applyStatus(ctx2.status, part, 'concussed', { duration: concussMs, source: srcVerb });
      }
      if (electrifyMs > 0) {
        applyStatus(ctx2.status, part, 'electrified', { duration: electrifyMs, source: srcVerb });
      }
      ctx2.reactTo?.({ source: srcVerb, part, moodDelta: -mood, impulse: effSquashVel, speakMs: 700 });
    } else {
      ctx2.reactTo?.({ source: srcVerb, moodDelta: -mood, speakMs: 99999 });
    }
    stun(ctx2.ragdoll, 1000);
    goLimp(ctx2.ragdoll, 600);
    ctx2.screenShake(shake, shakeMs);
    if (hitStopTier && ctx2.hitStop?.[hitStopTier]) ctx2.hitStop[hitStopTier]();
    if (particles) {
      particles(ctx2, b.position.x, b.position.y);
    } else {
      P.burst(b.position.x, b.position.y, 16, { type: 'smoke', color: '#333', size: 16, life: 800, speedRange: 0.6, gravity: -0.0004 });
      P.burst(b.position.x, b.position.y,  8, { type: 'spark', color: '#fff', size: 3,  life: 240, speedRange: 1.2 });
    }
    if (impactSfx && sfx[impactSfx]) sfx[impactSfx]();
    if (onImpact) onImpact(b, _world, ctx2, part);
  };
  Body.setVelocity(body, { x: 0, y: initVel });
  Composite.add(world, body);
  ctx.transientBodies.push(body);
  if (sfxName && sfx[sfxName]) sfx[sfxName]();
  return body;
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
