// Quadcopter drone — the STRUCTURED flyer summon (the hardest T4). A single
// autonomous aircraft that runs a three-phase mission: RECON (loiter overhead,
// observe) → STRAFE (track the nearest part and fire bullets) → KAMIKAZE (dive
// into the buddy and detonate). Rides the summons substrate (modes/summons.js
// dispatches body._summonTick) with ZERO Mode edits.
//
// THE NEW SUB-SUBSTRATE: a FORCE-based altitude hover (the spec's "reuse
// COUNTER_GRAVITY consts"), distinct from the hornet's velocity-SET 2D altitude
// hold. The hover is a PD servo — gravity-cancel + a proportional altitude seek
// + a vertical-velocity damping term — applied as a clamped Body.applyForce. This
// gives the drone real inertia (it banks, drifts, dives with momentum) where the
// hornet snaps to a velocity each step.
//
// THE LOAD-BEARING RESOLUTION (a planning red-team caught a contradiction in the
// first design — it mixed a hover FORCE with a velocity-SET clamp, which fight
// each other, and the kamikaze setVelocity would be reverted by the servo's vy
// clamp). The fix is PHASE-EXCLUSIVE motion: recon/strafe use the FORCE servo and
// NEVER setVelocity; kamikaze uses a kinematic setVelocity dive and returns BEFORE
// the servo runs. The two models never co-fire.
//
// THE CEILING-ROCKET FIREWALL (force-magnet.js is the scarred precedent). Three
// independent guards make an upward rocket structurally impossible:
//   1. the up-force is CLAMPED to [0, MAX_HOVER_ACCEL] — only ever lifts, never
//      pushes down, and the lift magnitude is hard-capped (a stat can't raise it);
//   2. the PD damping term opposes any vertical velocity (a stable equilibrium);
//   3. the body's own frictionAir gives a guaranteed terminal velocity for ANY
//      bounded force (drag rises with speed until it equals the applied force).
// All sim-proven in packages/web/sim/summons-drone.mjs (no rocket under hover,
// FSM transitions in order, kamikaze explode bounded, char-switch clean).
//
// COLLISION: the drone is an isSensor mask:0 body (the turret's isolation idiom,
// but MOBILE) — it collides with NOTHING, so it can't false-ground the buddy, its
// own strafe bullets can't hit it, and there is no physical-blocking NaN trap. It
// still integrates gravity + forces. The kamikaze therefore detonates on PROXIMITY
// (manual distance check, tracking the live centroid), not on a contact event.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { getStats } from '../_stats.js';
import { canvas } from '../../state/world.js';
import { GRAVITY_Y, GRAVITY_SCALE } from '../../physics/constants.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { setEnabled } from '../../modes/bus.js';
import { SUMMONS_ID } from '../../modes/summons.js';
import { nearestPart, dirTo, explode } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

// --- Module-const firewalls (a stat purchase can NEVER raise these) ---
const MAX_LIVE_DRONES     = 2;       // heavier summon (it explodes) — small live cap bounds cumulative blast
const MAX_HOVER_ACCEL     = 0.0030;  // HARD ceiling on the per-mass UP force (> gravity 0.0014 so it can climb, bounded so it can't rocket)
const ALTITUDE_SEEK_K     = 0.00006; // PD proportional gain (per-mass up per px of altitude error)
const VY_DAMPING_K        = 0.010;   // PD damping gain (per-mass up per px/step of vertical velocity) — the stable-equilibrium term
const THRUST_K            = 0.00002; // horizontal proportional gain (per-mass per px of x error)
const MAX_THRUST_X        = 0.0012;  // clamp on the horizontal pursuit force (gentle — no instant tracking)
const STANDOFF_X          = 60;      // px x-deadband: inside it the drone loiters, doesn't shove onto the buddy
const MAX_DRONE_V         = 16;      // clampAbs on the kamikaze dive setVelocity (and a velocity backstop)
const KAMIKAZE_DIVE_SPEED = 14;      // px/step terminal dive toward the centroid (kinematic; servo bypassed)
const KAMIKAZE_PROXIMITY  = 44;      // px to centroid that triggers detonation (pass-through body → no contact event)
const MIN_FIRE_INTERVAL_MS = 500;    // floor on strafe cadence — no leaf/save-edit can make a bullet hose
const BULLET_DAMAGE_CEIL  = 12;      // strafe round damage ceiling (stat-latched, never exceeds)
const BLAST_VEL_CEIL      = 16;      // kamikaze explode baseVel ceiling (< rocket 17.6)
const MUZZLE_OFFSET       = 12;      // px the bullet spawns ahead of the fuselage (visual; mask:0 already prevents self-hit)
const DRONE_R             = 7;

const clampAbs = (v, m) => (v > m ? m : (v < -m ? -m : v));

export const defaultStats = {
  hoverOffset:    120,    // px the drone holds ABOVE the buddy centroid (it's an aircraft, not a creeper)
  reconMs:        3000,   // RECON phase duration (loiter + observe, no fire)
  strafeMs:       7000,   // STRAFE phase duration (track + fire) — FPV leaf sets 0 to skip straight to the dive
  fireIntervalMs: 700,    // per-shot throttle in strafe (floored at MIN_FIRE_INTERVAL_MS); Gun pod → 450
  bulletDamage:   6,      // strafe round bulletDamage (turret 7, gun 10; mid chip); Gun pod → 9, ceiled at BULLET_DAMAGE_CEIL
  bulletSpeed:    17,     // px/step strafe round speed
  bulletStun:     200,    // light stun per round (sustained fire mustn't perma-lock the stand pose)
  blastRadius:    200,    // kamikaze explode radius
  blastVel:       12,     // kamikaze explode baseVel (px/step, < rocket 17.6); ceiled at BLAST_VEL_CEIL
  blastMood:      38,     // kamikaze mood damage
  igniteMs:       0,      // kamikaze leaves no fire by default (a clean blast)
  lifeMs:         13000,  // recon 3 + strafe 7 + ~3s kamikaze headroom; cleanupTransients despawns at bornAt+lifeMs
};

// Spawn ONE plain strafe bullet toward the nearest part (the turret's interval-
// bullet idiom byte-for-byte; the drone's mask:0 makes muzzle-offset purely visual).
function droneFire(self, ctx, target, now) {
  const { nx, ny } = dirTo(self.position.x, self.position.y, target.position.x, target.position.y);
  const mx = self.position.x + nx * MUZZLE_OFFSET;
  const my = self.position.y + ny * MUZZLE_OFFSET;
  const bullet = Bodies.circle(mx, my, 4, {
    frictionAir: 0, friction: 0, density: 0.004, restitution: 0.1,
    label: 'bullet', render: { visible: false },
  });
  bullet.partType    = 'bullet';                  // → transients/bullet.js dryBulletHit (plain default filter → hits the ragdoll)
  bullet._verb       = self._verb || 'quadcopter_drone';
  bullet.bornAt      = now;
  bullet.lifeMs      = 1200;
  bullet.bulletDamage = self._bulletDamage;
  bullet.bulletStun  = self._bulletStun;
  Body.setVelocity(bullet, { x: nx * self._bulletSpeed, y: ny * self._bulletSpeed });
  Composite.add(ctx.world, bullet);
  ctx.transientBodies.push(bullet);
  sfx.droneShot?.();
  P.burst(mx, my, 4, { type: 'fire', color: '#ffd266', size: 3, life: 120, speedRange: 0.5 });
}

// Per-drone controller, dispatched by modes/summons.js via body._summonTick.
// Reads LATCHED body fields (set at spawn), not getStats. dt unused (the FSM +
// fire throttle are wall-clock via performance.now; no setTimeout).
function droneTick(self, ctx) {
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // the ONLY no-op early-return (no buddy)
  if (self._spent) return;                                           // detonated; awaiting cleanupTransients removal
  const now = performance.now();

  // Centroid (kamikaze + hover target) and nearest part (strafe aim).
  let cx = 0, cy = 0;
  for (const p of ragdoll.parts) { cx += p.position.x; cy += p.position.y; }
  cx /= ragdoll.parts.length; cy /= ragdoll.parts.length;
  const nearest = nearestPart(ragdoll, self.position.x, self.position.y);

  // --- FSM transition (deterministic sim-clock; NO setTimeout) ---
  // Sequential ifs + an elapsed reset (NOT else-if) so a 0-duration phase
  // collapses cleanly in ONE tick: FPV's strafeMs=0 goes recon→strafe→kamikaze
  // here, and the kamikaze branch below returns before any strafe shot fires.
  // Resetting elapsed to 0 after each transition makes this robust regardless of
  // the relative phase durations (no reconMs<strafeMs assumption).
  let elapsed = now - (self._phaseStartAt || now);
  if (self.phase === 'recon' && elapsed >= self._reconMs) {
    self.phase = 'strafe'; self._phaseStartAt = now; elapsed = 0;
  }
  if (self.phase === 'strafe' && elapsed >= self._strafeMs) {
    self.phase = 'kamikaze'; self._phaseStartAt = now; elapsed = 0; sfx.droneDive?.();
  }

  // --- KAMIKAZE: kinematic dive toward the centroid (servo BYPASSED — the
  // phase-exclusive resolution; this branch RETURNS before any hover force) ---
  if (self.phase === 'kamikaze') {
    const { nx, ny } = dirTo(self.position.x, self.position.y, cx, cy);
    Body.setVelocity(self, { x: clampAbs(nx * KAMIKAZE_DIVE_SPEED, MAX_DRONE_V), y: clampAbs(ny * KAMIKAZE_DIVE_SPEED, MAX_DRONE_V) });
    self._facing = nx < 0 ? -1 : 1;
    const d = Math.hypot(self.position.x - cx, self.position.y - cy);
    if (d < KAMIKAZE_PROXIMITY) {
      // DETONATE — the proven explode helper (baseVel px/step, bounded). The
      // mask:0/pass-through body emits no contact event, so proximity (tracking
      // the LIVE centroid each tick → always converges) is the reliable trigger.
      explode(ctx, self.position.x, self.position.y, {
        radius: self._blastRadius, baseVel: Math.min(self._blastVel, BLAST_VEL_CEIL), upBias: 4,
        moodDelta: -self._blastMood, stunMs: 1400, shake: 18,
        igniteMs: self._igniteMs, sound: 'rocketBoom', limpMs: 900,
      });
      self._spent = true;     // the _spent guard skips further ticks
      self.lifeMs = 0;        // force cleanupTransients removal next frame (age > 0)
    }
    return;
  }

  // --- HOVER (recon + strafe): FORCE-based PD altitude servo (reuse COUNTER_GRAVITY) ---
  // Vertical: gravity-cancel + proportional altitude seek + velocity damping, then
  // clamp the UP magnitude to [0, MAX_HOVER_ACCEL] — only ever lifts, capped. With
  // the body's frictionAir this is rocket-proof (bounded force → terminal velocity).
  const hoverY  = cy - self._hoverOffset;
  const aHold   = GRAVITY_Y * GRAVITY_SCALE;                       // per-mass force that exactly cancels gravity
  const errDown = self.position.y - hoverY;                        // > 0 when the drone is BELOW its hover station
  let up = aHold + errDown * ALTITUDE_SEEK_K + self.velocity.y * VY_DAMPING_K;   // desired UP magnitude (positive)
  if (up < 0) up = 0;                                              // never push DOWN (gravity handles descent toward the station)
  if (up > MAX_HOVER_ACCEL) up = MAX_HOVER_ACCEL;                  // the ceiling-rocket firewall
  Body.applyForce(self, self.position, { x: 0, y: -up * self.mass });   // -y = UP (canvas y is down)

  // Horizontal: a clamped pursuit force toward the seek target (recon → centroid,
  // strafe → nearest part), with a standoff deadband so it loiters rather than
  // shoving onto the buddy. frictionAir damps residual drift.
  const targetX = (self.phase === 'strafe' && nearest) ? nearest.position.x : cx;
  const dx = targetX - self.position.x;
  if (Math.abs(dx) > STANDOFF_X) {
    Body.applyForce(self, self.position, { x: clampAbs(dx * THRUST_K, MAX_THRUST_X) * self.mass, y: 0 });
  }
  if (Math.abs(dx) > 1) self._facing = dx < 0 ? -1 : 1;

  // Soft on-screen reclamp (a mask:0 flyer can drift off at the margin). Edge-only,
  // so it never fights the hover servo in the interior (hornet precedent).
  const m = 16;
  if (self.position.x < m && self.velocity.x < 0) Body.setVelocity(self, { x: Math.abs(self.velocity.x), y: self.velocity.y });
  else if (self.position.x > canvas.width - m && self.velocity.x > 0) Body.setVelocity(self, { x: -Math.abs(self.velocity.x), y: self.velocity.y });
  if (self.position.y < m && self.velocity.y < 0) Body.setVelocity(self, { x: self.velocity.x, y: Math.abs(self.velocity.y) });

  // STRAFE fire (throttled; only this phase). nearest is the aim.
  if (self.phase === 'strafe' && nearest && now - (self._lastShotAt || 0) >= self._fireIntervalMs) {
    self._lastShotAt = now;
    droneFire(self, ctx, nearest, now);
  }
}

export default {
  id: 'quadcopter_drone',
  defaultStats,
  apply(ctx) {
    const s = getStats('quadcopter_drone');
    const { world, x, y, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // no buddy → no-op

    const live = transientBodies.filter(b => b && b.partType === 'quadcopter_drone' && !b._spent).length;
    if (live >= MAX_LIVE_DRONES) return;                              // field full → no-op click

    const now = performance.now();
    const sx = Math.max(30, Math.min(canvas.width - 30, x));          // spawn near the cursor x
    const sy = Math.min(y, canvas.height * 0.28);                     // ALWAYS start high (air support arrives from above)
    const drone = Bodies.circle(sx, sy, DRONE_R, {
      density: 0.0008, frictionAir: 0.05, friction: 0, restitution: 0,
      isSensor: true, collisionFilter: { mask: 0 },                   // collides with NOTHING (no false-ground, no self-bullet-hit, no block-NaN)
      label: 'quadcopter_drone', render: { visible: false },
    });
    drone.partType    = 'quadcopter_drone';     // render branch key
    drone._summonTick  = droneTick;             // THE TAG — the summons Mode dispatches via this fn pointer
    drone._verb        = ctx._verb || 'quadcopter_drone';
    drone.bornAt       = now;
    drone.lifeMs       = s.lifeMs ?? 13000;
    drone._epoch       = ctx._epoch;            // epoch-gate (the Mode + cleanupTransients check it)
    drone.phase        = 'recon';               // FSM start
    drone._phaseStartAt = now;
    // Latch tuning (controller reads body fields, not getStats per-step):
    drone._hoverOffset = s.hoverOffset ?? 120;
    drone._reconMs = s.reconMs ?? 3000;
    drone._strafeMs = s.strafeMs ?? 7000;
    drone._fireIntervalMs = Math.max(s.fireIntervalMs ?? 700, MIN_FIRE_INTERVAL_MS);   // floored — no bullet hose
    drone._bulletDamage = Math.min(s.bulletDamage ?? 6, BULLET_DAMAGE_CEIL);
    drone._bulletSpeed = s.bulletSpeed ?? 17;
    drone._bulletStun = s.bulletStun ?? 200;
    drone._blastRadius = s.blastRadius ?? 200;
    drone._blastVel = Math.min(s.blastVel ?? 12, BLAST_VEL_CEIL);
    drone._blastMood = s.blastMood ?? 38;
    drone._igniteMs = s.igniteMs ?? 0;
    drone._lastShotAt = 0;
    drone._facing = sx < canvas.width / 2 ? 1 : -1;
    Composite.add(world, drone);
    transientBodies.push(drone);
    setEnabled(SUMMONS_ID, true);    // wake the Mode; it self-disables when no summons remain
    sfx.droneDeploy?.();
    startCooldown('quadcopter_drone');
  },
  drawCursor(rctx, { x, y }) {
    // A small quad silhouette (place tool, no reticle).
    rctx.save();
    rctx.translate(x, y);
    rctx.strokeStyle = '#3a3f47'; rctx.lineWidth = 2; rctx.lineCap = 'round';
    rctx.beginPath(); rctx.moveTo(-9, -7); rctx.lineTo(9, 7); rctx.moveTo(9, -7); rctx.lineTo(-9, 7); rctx.stroke();
    rctx.strokeStyle = 'rgba(180,190,200,0.5)'; rctx.lineWidth = 1;
    for (const [rx, ry] of [[-9, -7], [9, -7], [9, 7], [-9, 7]]) { rctx.beginPath(); rctx.arc(rx, ry, 4, 0, Math.PI * 2); rctx.stroke(); }
    rctx.fillStyle = '#3a3f47'; rctx.beginPath(); rctx.arc(0, 0, 4.5, 0, Math.PI * 2); rctx.fill();
    rctx.fillStyle = '#39d0ff'; rctx.beginPath(); rctx.arc(0, 0, 1.8, 0, Math.PI * 2); rctx.fill();
    rctx.restore();
  },
};
