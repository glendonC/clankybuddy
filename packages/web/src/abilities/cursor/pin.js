// Pin — hazard-group placement tool (kind:'drag', like every sibling placed
// hazard: landmine / cryo_mine / gas_cloud / gravity_well). Drive a stake through
// the nearest in-reach limb and nail it to a FIXED world point — the buddy can
// only thrash AROUND the anchor until the stake's hold expires (lifeMs) or the limb
// shatters out of it.
//
// FIRST tool to bind a ragdoll PART with an S3 Matter.Constraint (the wrecking ball
// anchored only a transient ball, nothing to leak). The constraint is the ONLY new
// physics object pin adds.
//
// ARCHITECTURE (the load-bearing, NaN-relevant choices):
//  - The constraint owner is the LIMB (registerConstraint ownerBody:limb), NOT the
//    marker body. shatter() calls releaseConstraintsForBody(part), which matches only
//    the ownerBody — so the limb MUST own the constraint or the shatter teardown (b)
//    is a silent no-op. The marker is a render + lifecycle host ONLY.
//  - A render-only marker body (isStatic, isSensor, collisionFilter mask:0) is pushed
//    to transientBodies. mask:0 => it generates ZERO collision pairs, so it is
//    invisible to the solver AND to isGrounded (stand.js iterates engine.pairs) —
//    pin can NEVER false-ground the buddy (no sensor-filter fix needed). It rides the
//    transient lifecycle for free: epoch-wipe (spawnRagdoll), lifeMs expiry,
//    cleanupTransients onTick/onExpire, and render via the 'pin' branch.
//  - The live pin set is DERIVED by filtering transientBodies (activePins below),
//    NOT a module-level array — so a char-switch (which wipes transientBodies) drops
//    every pin for free, no dangling-reference prune (the breaching-charge R1 trap is
//    designed out, not guarded).
//
// CONSTRAINT (NaN landmines, all here at the consumer):
//  - pointA = the limb's CURRENT center (pin-in-place), length = max(1, dist) = 1 =>
//    zero initial tension. NEVER length 0 (Matter would yank the points together at
//    frame 1 and blow up).
//  - pointB = {0,0} is a HARD INVARIANT: Constraint.solve torque = cross(pointB,force),
//    so {0,0} => zero torque on the limb regardless of its angle. Pin owns POSITION;
//    stand.js's angular-velocity blend owns ANGLE. A non-zero pointB would inject
//    torque that fights the pose — do NOT move it off center.
//  - stiffness 0.5 (0.86 with Deeper drive) is SOFTER than the ragdoll joints (0.85)
//    and the wrecking ball (0.8): pin is the softest link, so any conflict resolves by
//    the pin yielding, never solver divergence. Always < 0.9.
//  - the pinned limb clears the HUD collision bit (mask &= ~HUD) so the soft mouse
//    spring (grab) + the pin can't pull it into infinite-mass HUD geometry. RESTORED
//    on release if the limb survived (restoreMask).
//  - the constraint is WORLD-scoped (registry → Composite.add(world)), NOT in
//    ragdoll.composite, so goLimp (which walks ragdoll.composite) never softens it.

import Matter from 'matter-js';
import { partInRange } from '../_shared.js';
import { getStats } from '../_stats.js';
import { applyStatus } from '../../effects/registry.js';
import {
  registerConstraint, releaseConstraint, isConstraintLive,
} from '../../state/constraint-registry.js';
import { COLLISION_CATEGORY } from '../../physics/constants.js';
import { startCooldown } from '../../ui/hotbar.js';
import { sfx } from '../../audio/sfx.js';

const { Bodies, Composite, Constraint } = Matter;

// The live pin set, DERIVED from the world-owned transientBodies (gravity_well's
// activeWellBodies idiom). spawnRagdoll wipes transientBodies, so a char-switch
// empties this for free — there is no module-level array to dangle.
function activePins(transientBodies) {
  return transientBodies.filter(b => b.partType === 'pin' && !b._spent);
}

// Restore the pinned limb's HUD collision bit — ONLY if the limb survived (a shatter
// keeps it alive and the mask MUST come back; a char-switch frees it and the
// includes() guard skips the freed body). Idempotent via _maskRestored.
function restoreMask(marker, ragdoll) {
  const limb = marker._limbRef;
  if (!marker._maskRestored && limb && marker._savedMask != null &&
      ragdoll?.parts?.includes(limb)) {
    limb.collisionFilter.mask = marker._savedMask;
  }
  marker._maskRestored = true;
}

// Reap the marker body: drop it from the world + transientBodies exactly once.
function reapMarker(marker, world, transientBodies) {
  if (marker._spent) return;
  marker._spent = true;
  const i = transientBodies.indexOf(marker);
  if (i >= 0) transientBodies.splice(i, 1);
  Composite.remove(world, marker);
}

// Fully reap a live pin (re-pin / cap replacement — in-band, limb alive): restore
// the mask FIRST (non-physics, harmless if it no-ops), release the constraint
// (idempotent S3), then drop the marker.
function releasePin(marker, ragdoll, world, transientBodies) {
  restoreMask(marker, ragdoll);
  releaseConstraint(marker._handle);
  reapMarker(marker, world, transientBodies);
}

// Per-frame reconcile (KINEMATIC: reads constraint-liveness via an O(1) Map probe,
// writes a non-physics mask field + self-reaps — inside the onTick contract). Detects
// an OUT-OF-BAND release: shatter() (teardown b) or the valve backstop dropped the
// constraint while this marker still lives. cleanupTransients runs it epoch-gated,
// between Engine.updates.
function reconcilePin(self, ctx) {
  if (isConstraintLive(self._handle)) return;   // still held — nothing to reconcile
  restoreMask(self, ctx.ragdoll);
  reapMarker(self, ctx.world, ctx.transientBodies);
}

// Natural lifeMs expiry (cleanupTransients fires this once, _spent-guarded, then
// removes the marker body itself). Release the constraint by its handle + restore
// the mask on the still-alive limb.
function expirePin(self, ctx) {
  restoreMask(self, ctx.ragdoll);
  releaseConstraint(self._handle);
}

export default {
  id: 'pin',
  defaultStats: {
    reach:     40,      // limb-selection radius around the press point (partInRange)
    lifeMs:    6000,    // hold duration → marker.lifeMs + maxAgeMs (Deeper drive → 10000)
    stiffness: 0.5,     // constraint stiffness; ALWAYS < 0.9 (Deeper drive → 0.86)
    damping:   0.25,    // settles the limb at the anchor instead of pogoing
    maxPins:   1,       // simultaneous pins (Driven stakes → 3)
    barbed:    false,   // Barbed stake → bleed on stake
    bleedMs:   6000,    // matches bleed's defaultDuration so the status is never 0-length
  },

  applyRelease(ctx) {
    const s = getStats('pin');
    const { world, x, y, transientBodies, ragdoll } = ctx;
    if (!ragdoll?.parts?.length) return;

    // Select the limb to stake: nearest part within reach of the press point. No
    // cooldown is burned on a miss (you only pay when a stake actually lands).
    const limb = partInRange(ragdoll, x, y, s.reach);
    if (!limb) return;

    // Re-pin the SAME limb → re-stake: FULL-release the prior pin FIRST so its mask
    // is restored to the true default BEFORE we re-capture savedMask below (otherwise
    // savedMask would capture the already-cleared mask → a permanent HUD-bit leak).
    for (const m of activePins(transientBodies)) {
      if (m._limbRef === limb) releasePin(m, ragdoll, world, transientBodies);
    }
    // Enforce the cap: drop the oldest live pin until there's room for this one. The
    // `live.length &&` floor keeps a (never-shipped) maxPins<=0 from reading live[0]
    // off an empty array — every other guard in this file is defensive too.
    let live = activePins(transientBodies);
    while (live.length && live.length >= s.maxPins) {
      releasePin(live[0], ragdoll, world, transientBodies);
      live = activePins(transientBodies);
    }

    // Clear the HUD bit on the limb (save the original — now clean, post re-pin
    // restore). The soft grab spring + the pin then can't pinch the limb into
    // infinite-mass HUD geometry.
    const savedMask = limb.collisionFilter.mask;
    limb.collisionFilter.mask = savedMask & ~COLLISION_CATEGORY.HUD;

    // Anchor at the limb's current center (pin-in-place): rest length = the actual
    // spawn distance (≈0), clamped to ≥1 → zero initial tension, NEVER 0.
    const anchor = { x: limb.position.x, y: limb.position.y };
    const length = Math.max(1, Math.hypot(anchor.x - limb.position.x, anchor.y - limb.position.y));

    const stake = Constraint.create({
      pointA: anchor,                       // FIXED world point, NO bodyA
      bodyB: limb, pointB: { x: 0, y: 0 },  // limb CENTER — HARD INVARIANT (zero torque)
      length,
      stiffness: s.stiffness,               // < 0.9
      damping: s.damping,
      render: { visible: false },
    });
    // Registry OWNS the Composite.add of the constraint + tracks it. ownerBody:limb so
    // shatter()'s releaseConstraintsForBody(part) finds it (teardown b) and the valve's
    // orphan-check covers a limb that leaves the world. maxAge from the LIVE lifeMs, so
    // Deeper drive (lifeMs→10000) rides along. `now` is sampled BEFORE registerConstraint
    // (which samples the constraint's own bornAt internally), so marker.bornAt <= the
    // constraint's bornAt → pin's onExpire (now+lifeMs) beats the valve
    // (constraint.bornAt+lifeMs+300) by a FULL ≥300ms, never a sub-ms-shaved margin.
    const now = performance.now();
    const handle = registerConstraint(stake, { ownerBody: limb, maxAgeMs: s.lifeMs + 300 });

    // Render-only marker at the stake. isStatic + mask:0 → zero solver/pair
    // contribution (can't false-ground). Rides the transient lifecycle.
    const marker = Bodies.circle(anchor.x, anchor.y, 6, {
      isStatic: true, isSensor: true,
      collisionFilter: { mask: 0 },
      label: 'pin', render: { visible: false },
    });
    marker.partType   = 'pin';
    marker._verb      = ctx._verb || 'pin';
    marker.bornAt     = now;
    marker.lifeMs     = s.lifeMs;
    marker._epoch     = ctx._epoch;        // epoch-gates onTick in cleanupTransients
    marker._handle    = handle;
    marker._limbRef   = limb;              // for the tether render + mask restore
    marker._savedMask = savedMask;
    marker._anchor    = anchor;            // for the tether render
    marker.onTick     = reconcilePin;      // out-of-band release reconcile
    marker.onExpire   = expirePin;         // natural lifeMs release

    Composite.add(world, marker);
    transientBodies.push(marker);

    // Barbed stake: a ragged spike tears the limb → a lingering BLEED.
    if (s.barbed) {
      applyStatus(ctx.status, limb, 'bleed', { duration: s.bleedMs, source: 'pin' });
    }

    sfx.pinStake?.();
    startCooldown('pin');
  },

  // A driven stake: a nail head + barbed shaft at the cursor.
  drawCursor(c, { x, y, isDown }) {
    c.save();
    c.translate(x, y);
    c.lineCap = 'round';
    // Shaft driven into the ground (down).
    c.strokeStyle = isDown ? '#d8dde6' : '#9aa3b2';
    c.lineWidth = isDown ? 3 : 2.4;
    c.beginPath(); c.moveTo(0, -10); c.lineTo(0, 8); c.stroke();
    // Barbs.
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(0, 0);  c.lineTo(-4, 4);
    c.moveTo(0, -3); c.lineTo(4, 1);
    c.stroke();
    // Nail head.
    c.fillStyle = isDown ? '#eef2f8' : '#c2c9d6';
    c.beginPath(); c.ellipse(0, -11, 5, 2.4, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  },
};
