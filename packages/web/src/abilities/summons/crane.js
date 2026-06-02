// Crane claw — a summon CHILD of the quadcopter drone, but a DISTINCT verb:
// HOIST + SLAM. An autonomous claw descends, homes on the nearest limb, latches
// it with a soft constraint, hauls the WHOLE buddy aloft by that one limb (the
// rest dangles), holds it helpless at the apex, then SLAMS it down — a scripted
// heavy impact (a downward velocity throw on every part + a mood hit + a stun).
// No current tool does an autonomous full-body hoist-and-slam (grab is a manual
// horizontal cursor drag, magnet a pull, pin an anchor-DOWN, the drone destroys).
// The planning red-team gated the spec's hollow "lift off-screen / removal" and
// the user chose the hoist+slam payoff that makes it a real verb.
//
// ARCHITECTURE — KINEMATIC + onTick (NOT the force-applying _summonTick lane):
// the claw rides cleanupTransients' generic per-body onTick hook (the steamroller
// "maintained velocity" idiom), NOT modes/summons.js. Two load-bearing reasons:
//   1. The constraint register/RELEASE must happen BETWEEN Engine.updates — the
//      registry forbids removal inside a physics-phase Mode (mid-solve removal
//      corrupts solver state). onTick runs between frames, so it is the legal lane.
//   2. A FORCE-based hover (the drone's servo) lifts a body in proportion to ITS
//      mass; a light claw cannot hoist a heavy buddy that way. A KINEMATIC claw
//      (velocity-set each frame, re-stamped like steamroller/city_bus) drags the
//      load via the soft constraint regardless of mass — the correct crane model.
// So the claw never applies force: it velocity-sets its own motion, and the SLAM
// is a kinematic velocity-set on the ragdoll parts + reactTo/stun (mood + crumple),
// all inside the onTick contract. All sim-proven in packages/web/sim/summons-crane.mjs.
//
// CONSTRAINT (the pin precedent, with a MOBILE anchor): bodyA = the CLAW (so the
// anchor moves with the claw as it hoists — no per-frame re-register), bodyB = the
// limb, pointB = {0,0} (HARD INVARIANT — zero torque on the limb), length =
// max(1, hypot) NEVER 0, stiffness 0.7 (< the ragdoll joints' 0.85 → the claw link
// is the yielding one, never solver divergence). ownerBody = the LIMB so shatter()'s
// releaseConstraintsForBody(part) + the registry valve's orphan-check both reap it.
// The latched limb clears its HUD collision bit (restored on release).

import Matter from 'matter-js';
import { nearestPart, partInRange, dirTo } from '../_shared.js';
import { getStats } from '../_stats.js';
import { stun } from '../../physics/stand.js';
import { canvas } from '../../state/world.js';
import {
  registerConstraint, releaseConstraint, isConstraintLive,
} from '../../state/constraint-registry.js';
import { COLLISION_CATEGORY } from '../../physics/constants.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';

const { Body, Bodies, Composite, Constraint } = Matter;

// --- Module-const firewalls (a stat purchase can NEVER raise these) ---
const MAX_LIVE_CLAWS = 1;     // one hoist at a time (no stacked aerial holds / cumulative slams)
const CLAW_R         = 9;
const GRAB_RANGE     = 64;    // px to the nearest limb that triggers a latch
const MAX_CLAW_V     = 16;    // clampAbs on the claw's homing/hoist velocity (bounded kinematic motion)
const LATCH_STIFFNESS = 0.7;  // < the ragdoll joints' 0.85 → the claw link yields, never diverges
const LATCH_DAMPING  = 0.3;
const SLAM_CEIL      = 28;    // HARD ceiling on the slam velocity (px/step) — a stat can never raise it
const RETRACT_SPEED  = 13;    // px/step the claw exits upward after the slam / on a miss
const DESCEND_TIMEOUT_MS = 4500;  // if homing never reaches a limb, give up + retract (no infinite descend)

const clampAbs = (v, m) => (v > m ? m : (v < -m ? -m : v));

export const defaultStats = {
  grabRange:   64,     // limb-homing latch radius (Long boom → 100)
  descendSpeed: 7,     // px/step 2D homing speed toward the nearest limb
  hoistSpeed:  5,      // px/step upward hoist speed (Hydraulic ram → 8)
  holdMs:      500,    // dangle-at-apex dwell before the slam (Hydraulic ram → 250)
  slamVel:     22,     // downward velocity SET on every part at the slam (Reinforced grip → 28, ceiled at SLAM_CEIL)
  slamMood:    32,     // mood damage of the slam (Reinforced grip → 46)
  slamStunMs:  1200,   // stun so the buddy crumples on landing instead of instantly righting
  lifeMs:      9000,   // total claw life backstop; cleanupTransients despawns at bornAt+lifeMs (Long boom → 13000)
};

// Restore the hoisted limb's HUD collision bit — ONLY if the limb survived
// (shatter keeps it alive; a char-switch frees it and the includes() guard skips
// the freed body). Idempotent via _maskRestored. (the pin precedent)
function restoreMask(self, ragdoll) {
  const limb = self._limbRef;
  if (!self._maskRestored && limb && self._savedMask != null && ragdoll?.parts?.includes(limb)) {
    limb.collisionFilter.mask = self._savedMask;
  }
  self._maskRestored = true;
}

// Reap the claw body exactly once: release the constraint (idempotent S3) + restore
// the mask + drop from the world & transientBodies. Safe to call from onTick/onExpire
// (both between Engine.updates).
function reapClaw(self, ctx) {
  if (self._spent) return;
  self._spent = true;
  if (self._handle != null) releaseConstraint(self._handle);
  restoreMask(self, ctx.ragdoll);
  const i = ctx.transientBodies.indexOf(self);
  if (i >= 0) ctx.transientBodies.splice(i, 1);
  Composite.remove(ctx.world, self);
}

// Per-frame controller (cleanupTransients onTick — BETWEEN Engine.updates, so it
// may register/release constraints + kinematically setVelocity, but NEVER apply
// force). Epoch-gated by cleanupTransients. The FSM: descend → hoist → hold →
// slam → retract.
function craneTick(self, ctx) {
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) { reapClaw(self, ctx); return; }
  const now = performance.now();

  // Out-of-band release reconcile: if we were latched but the constraint is gone
  // (shatter()'s teardown (b), or the registry valve), the limb shattered out of
  // the claw — restore the mask and bail to retract (no slam on a freed limb).
  if (self._latched && !isConstraintLive(self._handle)) {
    restoreMask(self, ragdoll);
    self._latched = false;
    self.phase = 'retract';
  }

  if (self.phase === 'descend') {
    // 2D home on the nearest part (an autonomous claw-machine grab; the buddy
    // can't outrun it, so a latch always converges). KINEMATIC setPosition (the
    // claw is isStatic = an infinite-mass winch; the constraint drags the limb,
    // the limb's weight can NEVER yank the claw down — the grab/MouseConstraint idiom).
    const target = nearestPart(ragdoll, self.position.x, self.position.y);
    if (target) {
      const { nx, ny } = dirTo(self.position.x, self.position.y, target.position.x, target.position.y);
      Body.setPosition(self, { x: self.position.x + clampAbs(nx * self._descendSpeed, MAX_CLAW_V), y: self.position.y + clampAbs(ny * self._descendSpeed, MAX_CLAW_V) });
    }
    // Latch when a limb is within grab range.
    const limb = partInRange(ragdoll, self.position.x, self.position.y, self._grabRange);
    if (limb) {
      const length = Math.max(1, Math.hypot(self.position.x - limb.position.x, self.position.y - limb.position.y));
      const cable = Constraint.create({
        bodyA: self, pointA: { x: 0, y: 0 },      // MOBILE anchor — the claw body; the constraint rides the claw as it hoists
        bodyB: limb, pointB: { x: 0, y: 0 },      // limb CENTER — HARD INVARIANT (zero torque)
        length,                                   // ≈ current gap, ≥ 1, NEVER 0
        stiffness: LATCH_STIFFNESS,               // 0.7 < 0.85 ragdoll joints → the claw link yields
        damping: LATCH_DAMPING,
        render: { visible: false },
      });
      // Registry OWNS Composite.add + tracks it. ownerBody = the LIMB so shatter()'s
      // releaseConstraintsForBody(part) + the valve's orphan-check reap it. maxAge
      // from the live lifeMs (+300 valve margin), sampled before registerConstraint.
      self._handle = registerConstraint(cable, { ownerBody: limb, maxAgeMs: self.lifeMs + 300 });
      // Clear the limb's HUD bit (save the original) so the soft cable can't pinch
      // it into infinite-mass HUD geometry. Restored on release.
      self._limbRef   = limb;
      self._savedMask = limb.collisionFilter.mask;
      limb.collisionFilter.mask = self._savedMask & ~COLLISION_CATEGORY.HUD;
      self._latched = true;
      self.phase = 'hoist';
      sfx.craneGrab?.();
    } else if (now - self.bornAt > DESCEND_TIMEOUT_MS) {
      self.phase = 'retract';                     // never found a limb → give up
    }
    return;
  }

  if (self.phase === 'hoist') {
    // setPosition straight up; the soft cable drags the limb (and the dangling
    // buddy) along. An infinite-mass winch rising at a controlled rate is
    // mass-independent — the buddy's weight can't stall or yank it.
    Body.setPosition(self, { x: self.position.x, y: self.position.y - clampAbs(self._hoistSpeed, MAX_CLAW_V) });
    if (self.position.y <= self._apexY) { self.phase = 'hold'; self._holdStart = now; }
    return;
  }

  if (self.phase === 'hold') {
    // isStatic → holds the apex on its own (no per-frame re-stamp needed).
    if (now - (self._holdStart || now) >= self._holdMs) self.phase = 'slam';
    return;
  }

  if (self.phase === 'slam') {
    // THE SLAM (kinematic, between-frames — NO applyForce): release the cable FIRST
    // so nothing tethers the limb up, restore the mask, then hurl every part down
    // and crumple the buddy with a scripted mood hit + stun.
    if (self._handle != null) releaseConstraint(self._handle);
    restoreMask(self, ragdoll);
    self._latched = false;
    const vy = Math.min(self._slamVel, SLAM_CEIL);
    for (const p of ragdoll.parts) {
      Body.setVelocity(p, { x: p.velocity.x * 0.5, y: vy });      // whole-body downward throw
    }
    ctx.reactTo?.({ source: 'crane_claw', part: ragdoll.head, moodDelta: -self._slamMood, impulse: vy, speakMs: 600 });
    stun(ragdoll, self._slamStunMs);                              // crumple on landing instead of instantly righting
    ctx.screenShake?.(14, 220);
    sfx.craneSlam?.();
    self.phase = 'retract';
    return;
  }

  // retract — exit upward and reap when off the top (or the lifeMs backstop fires).
  Body.setPosition(self, { x: self.position.x, y: self.position.y - RETRACT_SPEED });
  if (self.position.y < -CLAW_R * 4) reapClaw(self, ctx);
}

// Natural lifeMs expiry / nuke wipe backstop (cleanupTransients fires it once,
// _spent-guarded). Releases the constraint + restores the mask (both idempotent).
function expireClaw(self, ctx) {
  if (self._handle != null) releaseConstraint(self._handle);
  restoreMask(self, ctx.ragdoll);
}

export default {
  id: 'crane_claw',
  defaultStats,
  apply(ctx) {
    const s = getStats('crane_claw');
    const { world, x, transientBodies, ragdoll } = ctx;
    if (!ragdoll || !ragdoll.parts || !ragdoll.parts.length) return;   // no buddy → no-op

    // One hoist at a time (cumulative-slam + aerial-hold bound). Live set DERIVED
    // by filtering transientBodies (the pin idiom — a char-switch wipe drops it for free).
    const live = transientBodies.filter(b => b && b.partType === 'crane_claw' && !b._spent).length;
    if (live >= MAX_LIVE_CLAWS) return;

    const now = performance.now();
    const sx = Math.max(CLAW_R, Math.min(canvas.width - CLAW_R, x));
    const sy = 30;                                                     // descends from the top of the stage
    const claw = Bodies.circle(sx, sy, CLAW_R, {
      isStatic: true,                                                  // INFINITE-MASS winch: the cable drags the limb; the buddy's weight can never yank the claw down. Moved kinematically via setPosition.
      isSensor: true, collisionFilter: { mask: 0 },                    // collides with NOTHING (no false-ground, no self-block); the cable is a constraint, not a collision
      label: 'crane_claw', render: { visible: false },
    });
    claw.partType   = 'crane_claw';   // render branch key
    claw.bornAt     = now;
    claw.lifeMs     = s.lifeMs ?? 9000;
    claw._epoch     = ctx._epoch;     // epoch-gates onTick in cleanupTransients
    claw.phase      = 'descend';
    claw.onTick     = craneTick;      // BETWEEN-frames controller (NOT _summonTick — see header)
    claw.onExpire   = expireClaw;     // lifeMs / nuke-wipe release backstop
    // Latch tuning (read in craneTick):
    claw._grabRange = s.grabRange ?? 64;
    claw._descendSpeed = s.descendSpeed ?? 7;
    claw._hoistSpeed = s.hoistSpeed ?? 5;
    claw._holdMs = s.holdMs ?? 500;
    claw._slamVel = Math.min(s.slamVel ?? 22, SLAM_CEIL);
    claw._slamMood = s.slamMood ?? 32;
    claw._slamStunMs = s.slamStunMs ?? 1200;
    claw._apexY = canvas.height * 0.12;   // hoist until the claw nears the top
    claw._handle = null;
    claw._latched = false;
    Composite.add(world, claw);
    transientBodies.push(claw);
    sfx.craneDeploy?.();
    startCooldown('crane_claw');
  },
  drawCursor(rctx, { x, y }) {
    // A grabber claw hanging from a cable (place tool, no reticle).
    rctx.save();
    rctx.translate(x, y);
    rctx.strokeStyle = '#8a8f98'; rctx.lineWidth = 1.5; rctx.lineCap = 'round';
    rctx.beginPath(); rctx.moveTo(0, -14); rctx.lineTo(0, -2); rctx.stroke();          // cable
    rctx.strokeStyle = '#c2c9d6'; rctx.lineWidth = 2.4;
    rctx.beginPath(); rctx.moveTo(-6, -2); rctx.lineTo(-3, 7); rctx.moveTo(6, -2); rctx.lineTo(3, 7); rctx.stroke();   // prongs
    rctx.fillStyle = '#52565e';
    rctx.beginPath(); rctx.arc(0, -2, 3, 0, Math.PI * 2); rctx.fill();                  // hub
    rctx.restore();
  },
};
