// @ts-check
// Buzzsaw wall — a wall-mounted spinning blade. Placed as a static sensor that
// sits where you drop it and bites any ragdoll part that wanders into the disc.
//
// HOW IT HITS (this is the load-bearing distinction): the blade does NOT sweep
// for victims in an onTick. onTick runs in the render frame and is KINEMATIC-
// ONLY (transients/index.js: "MUST NOT apply force or call sweepImpact"); a
// per-frame force loop would also integrate at the wrong cadence. Instead the
// hit is Pattern-2 contact-driven (processCollision → HANDLERS[partType]
// .onContact), exactly the firepool / caltrops / acid-pool model: the Matter
// sensor reports the overlap, and onContact applies the bite. The blade spins
// for the *look* only; rotation is derived from performance.now() at draw time
// (see renderBuzzsaw below), so there is no physics rotation and no onTick.
//
// THE BITE (impulse lane, NOT a blast): each qualifying contact drives the
// struck part through applyImpulse() — the same hit pipeline melee weapons use
// (master damageMul, markHit blend-down, the ~0.30× one-hop neighbour
// propagation). The blade is edged, so on top of the impulse it stacks BLEED
// (cap 5) like the chainsaw / caltrops grind. CONCUSSED is consumed for the
// 1.5× spike when present. This is deliberately the impulse lane, never the
// explode()/setVelocity splash lane.
//
// PER-PART THROTTLE: a buddy leaning into the blade overlaps with several of
// its 6 parts in one physics step; without a throttle every part would bite in
// the same step. self._lastByPart[target.id] debounces each part independently
// (PART_THROTTLE_MS) so one limb in the blade grinds at a steady cadence while
// a second limb that touches also bites — same per-part-Map coalescing as
// caltrops.js, NOT a single _spent gate.
//
// HAZARD FLAGS (read live inside onContact, never at module top — same
// discipline as aimAngle's getFamilyStats('firearms')):
//   hazard.chain — a triggered blade arms placed neighbours in CHAIN_RADIUS via
//                  chainDetonate; each neighbour replays its own chainTrigger.
//                  The buzzsaw's chainTrigger applies a single throttle-free
//                  bite to the nearest part so a chain reads as a coordinated
//                  rip rather than nothing.
//   hazard.rearm — buzzsaws are normally always-on grinders, but the rearm flag
//                  still routes through the family contract: when set the blade
//                  spins down (disarmed, renders dim) for REARM_MS after a bite
//                  then re-arms; when clear the blade simply keeps grinding for
//                  its lifeMs (it is NOT a single-use one-shot like a mine, so
//                  it does not unregister/force-expire on contact — multiContact
//                  + the per-part throttle own its repeat cadence).
//
// Spawn factory (used by abilities/punish/buzzsaw-wall.js apply/applyRelease):
//   const saw = spawnBuzzsawWall(world, transientBodies, x, y, lifeMs);
//   registerPlacedHazard(saw, { kind: 'buzzsaw',
//     chainTrigger: (entry, ctx2) => detonate(entry.body, ctx2) });

import Matter from 'matter-js';
import * as P from '../particles.js';
import { getFamilyStats } from '../abilities/_stats.js';
import {
  applyStatus, getStatus, isBrittle, damageMul, consumeConcussed,
} from '../effects/registry.js';
import { applyImpulseScaled, shatter, nearestPart } from '../abilities/_shared.js';
import { chainDetonate, unregisterPlacedHazard } from '../state/hazard-field.js';

const { Bodies, Composite } = Matter;

const BLADE_RADIUS      = 26;     // disc radius (matches the sensor footprint)
const PART_THROTTLE_MS  = 220;    // per-part bite cadence; dedupes the 6-part lean-in
const CHAIN_RADIUS      = 160;    // chain reach to placed neighbours
const REARM_MS          = 1800;   // spin-down window when hazard.rearm is on
const BLEED_MS          = 6000;   // matches effects/bleed.js
const SPIN_HZ           = 9;      // visual spin speed (rev/s), render-only

const IMPULSE_MAG       = 0.07;   // force-per-mass bite (solid, between sword 0.04 and a heavy hit)
const MOOD_BITE         = 9;      // base mood damage per bite (pre-mul, subtracted)

// --- The bite. Shared by onContact (throttled) and chainBite (chain wave). ---
// Drives `part` along the radial direction from the blade centre through the
// impulse lane, stacks BLEED, consumes CONCUSSED, shatters if brittle, and
// throws sparks. Returns nothing; callers own throttle/flag bookkeeping.
function bite(self, part, ctx) {
  const sx = self.position.x, sy = self.position.y;
  // Frozen part meeting the blade shatters outright.
  if (isBrittle(ctx.status, part)) shatter(ctx, part);

  // Radial fling away from the blade centre (tangential feel without spinning
  // the sensor). If the part sits dead-centre, kick straight up so the magnitude
  // never collapses to a zero-direction garbage vector.
  let dx = part.position.x - sx, dy = part.position.y - sy;
  let d = Math.hypot(dx, dy);
  let nx, ny;
  if (d < 1e-3) { nx = 0; ny = -1; }
  else { nx = dx / d; ny = dy / d; }

  // CONCUSSED amp (1.5×) on the next impact-tier hit.
  const mul = damageMul(ctx.status, part);
  if (mul > 1) consumeConcussed(ctx.status, part);

  // Impulse lane: applyImpulseScaled → applyImpulse (markHit + propagate + master mul).
  const { fx, fy } = applyImpulseScaled(part, nx, ny, IMPULSE_MAG, 0.012);

  // Edged → stack BLEED (cap 5), the chainsaw/caltrops grind.
  const existing = getStatus(ctx.status, part, 'bleed');
  const intensity = Math.min((existing?.intensity ?? 0) + 1, 5);
  applyStatus(ctx.status, part, 'bleed', {
    duration: self._bleedMs ?? BLEED_MS, source: 'buzzsaw_wall', intensity,
  });

  ctx.reactTo?.({
    source: 'buzzsaw_wall', part, moodDelta: -MOOD_BITE * mul,
    impulse: Math.hypot(fx, fy), speakMs: 500,
  });

  // Sprayed sparks + red flecks at the contact point.
  P.burst(part.position.x, part.position.y, 12, {
    type: 'spark', color: '#ffd266', size: 3, life: 320, speedRange: 1.6, gravity: 0.0008,
  });
  P.burst(part.position.x, part.position.y, 6, {
    type: 'spark', color: '#a8121a', size: 3, life: 380, speedRange: 1.2, gravity: 0.0010,
  });
  ctx.screenShake?.(5, 130);
}

// Chain-wave detonation: when a neighbour blade is armed by chainDetonate it
// rips the nearest part once, throttle-free (the chain wave is one synchronous
// hop). Exported so abilities/punish/buzzsaw-wall.js can build its chainTrigger
// closure against it — exactly the landmine.js detonate() pattern.
export function detonate(self, ctx) {
  if (!self || !ctx?.ragdoll) return;
  const part = nearestPart(ctx.ragdoll, self.position.x, self.position.y);
  if (part) bite(self, part, ctx);
}

// Spawn a wall-mounted buzzsaw at (x, y). Static isSensor disc; circleRadius is
// the bite footprint AND the drawn blade radius.
export function spawnBuzzsawWall(world, transientBodies, x, y, lifeMs = 12000) {
  const saw = Bodies.circle(x, y, BLADE_RADIUS, {
    isStatic: true, isSensor: true,
    label: 'buzzsaw', render: { visible: false },
  });
  saw.partType = 'buzzsaw';
  saw.bornAt = performance.now();
  saw.lifeMs = lifeMs;
  saw._armed = true;
  Composite.add(world, saw);
  transientBodies.push(saw);
  return saw;
}

/** @type {import('../types.js').TransientHandler} */
const handler = {
  partType: 'buzzsaw',
  // Persistent grinder: stays alive for its lifeMs, opts out of _spent so the
  // per-part throttle owns repeat cadence (firepool / caltrops / acid-pool model).
  removeOnContact: false,
  multiContact:    true,
  onContact(self, target, ctx) {
    const now = performance.now();
    const fam = getFamilyStats('hazard');

    // Re-arm window: only meaningful once hazard.rearm has spun the blade down.
    if (self._armed === false) {
      if (fam.rearm && now >= (self._rearmAt ?? 0)) self._armed = true;
      else return false;                 // disarmed: no-op (renders dim)
    }

    // Per-part throttle: dedupe the 6-part lean-in into one bite per part.
    self._lastByPart ??= {};
    if (now - (self._lastByPart[target.id] ?? 0) < PART_THROTTLE_MS) return false;
    self._lastByPart[target.id] = now;

    bite(self, target, ctx);

    // CHAIN: a biting blade arms placed neighbours in range (flag-gated).
    if (fam.chain) {
      chainDetonate(self.position.x, self.position.y, CHAIN_RADIUS, ctx, { exclude: self });
    }

    // REARM: spin down for REARM_MS, then re-arm (flag-gated). When the flag is
    // clear the blade is an always-on grinder — it neither rearms nor expires on
    // contact; lifeMs owns its lifetime, so we just keep returning false.
    if (fam.rearm) {
      self._armed   = false;
      self._rearmAt = now + REARM_MS;
    }
    return false;                        // never force-expire; lifeMs owns the timeout
  },
};

export default handler;

// --- Render: rotating blade. -------------------------------------------------
// The shared renderer (render/transients.js) draws each transient by partType.
// This blade is procedural and time-driven, so it is exported here for the
// integration to dispatch (`else if (b.partType === 'buzzsaw') renderBuzzsaw(ctx, b, now)`).
// Rotation comes purely from `now` — NO physics rotation, NO onTick. A disarmed
// blade (hazard.rearm spin-down) renders dim and stops spinning.
export function renderBuzzsaw(rctx, body, now = performance.now()) {
  const x = body.position.x, y = body.position.y;
  const r = body.circleRadius || BLADE_RADIUS;
  const armed = body._armed !== false;
  // Spin only while armed; freeze the angle when spun down so "dim + still"
  // reads as disarmed.
  const ang = armed ? (now * 0.001 * SPIN_HZ * Math.PI * 2) % (Math.PI * 2) : (body._stoppedAng ?? 0);
  if (armed) body._stoppedAng = ang;

  rctx.save();
  rctx.translate(x, y);
  rctx.globalAlpha = armed ? 1 : 0.4;

  // Mount plate behind the blade (the "wall" mount).
  rctx.fillStyle = '#2a2d33';
  rctx.beginPath(); rctx.arc(0, 0, r * 0.42, 0, Math.PI * 2); rctx.fill();

  rctx.rotate(ang);

  // Steel disc.
  rctx.fillStyle = '#b8c0c8';
  rctx.beginPath(); rctx.arc(0, 0, r, 0, Math.PI * 2); rctx.fill();
  // Darker inner ring for depth.
  rctx.fillStyle = '#8a929b';
  rctx.beginPath(); rctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); rctx.fill();

  // Teeth around the rim — angular sawtooth pattern.
  const teeth = 16;
  rctx.fillStyle = '#dfe6ec';
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tx = Math.cos(a) * r, ty = Math.sin(a) * r;
    const ta = a + 0.16;
    const bx = Math.cos(ta) * (r + 4), by = Math.sin(ta) * (r + 4);
    const ix = Math.cos(a) * (r - 3), iy = Math.sin(a) * (r - 3);
    rctx.beginPath();
    rctx.moveTo(tx, ty); rctx.lineTo(bx, by); rctx.lineTo(ix, iy);
    rctx.closePath(); rctx.fill();
  }

  // Hub bolt.
  rctx.fillStyle = '#3a3f47';
  rctx.beginPath(); rctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); rctx.fill();
  // Spin-blur highlight streak (only while armed).
  if (armed) {
    rctx.strokeStyle = 'rgba(255,255,255,0.25)';
    rctx.lineWidth = 2;
    rctx.beginPath(); rctx.arc(0, 0, r * 0.8, 0, Math.PI * 1.2); rctx.stroke();
  }

  rctx.restore();
}
