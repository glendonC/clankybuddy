// Breaching charge (ordnance). Stick a shaped charge to a limb (click on a
// part), then click EMPTY space to blow every placed charge at once. A single
// kind:'click' tool bifurcates stick-vs-detonate by whether the click landed on
// a part within stickRange (the locked taste decision: plant, plant, plant,
// then click away to blow).
//
// The stuck charge is a render-only SENSOR (collisionFilter.mask:0, isSensor) —
// no collider, no joint. It follows its limb via the generic per-body onTick
// hook (KINEMATIC setPosition only; cleanupTransients runs it epoch-gated).
// Detonation runs SYNCHRONOUSLY in apply() against the real, current-epoch ctx —
// onTick must NEVER explode (force/explode belong on a contact or a physics Mode,
// not the frame-phase kinematic lane).
//
// R1 (the highest-risk surface): `placedCharges` is a module-level array that
// spawnRagdoll is BLIND to (it wipes transientBodies + cancels scheduler/
// constraints, but not ad-hoc arrays). A charge stuck on buddy A would survive a
// switch to buddy B as a dangling array reference and could explode at the dead
// buddy's coordinates. The required discipline: stamp charge._epoch at stick,
// FILTER stale-epoch / part-gone charges at detonate (drop, never explode),
// PRUNE the same on every stick, plus a lifeMs fallback so orphans self-reap.

import Matter from 'matter-js';
import { explode, partInRange } from '../_shared.js';
import { getStats } from '../_stats.js';
import { sfx } from '../../audio/sfx.js';

const { Bodies, Body, Composite } = Matter;

// Live placed charges (across the current buddy). Pruned aggressively — see R1.
const placedCharges = [];

export const defaultStats = {
  radius:     180,
  baseVel:    13,
  mood:       28,
  stunMs:     1000,
  shake:      16,
  chained:    false,   // detonation cord: adds a linking "cord" blast (≥2 charges)
  stickRange: 34,      // click within this of a part to STICK (else DETONATE)
  lifeMs:     9000,    // self-reap fallback for an undetonated charge
};

// A charge is LIVE iff it belongs to the current buddy (epoch) and its limb is
// still present. Stale charges are dropped WITHOUT exploding (never blow at a
// dead buddy).
function isLive(ctx, c) {
  return ctx._epochValid(c._epoch) && !!ctx.ragdoll?.parts?.includes(c._partRef);
}

// Remove a charge's body from the world + transient list (idempotent: Composite
// .remove and indexOf are both no-ops if it was already reaped).
function dropBody(ctx, c) {
  Composite.remove(ctx.world, c);
  const i = ctx.transientBodies.indexOf(c);
  if (i >= 0) ctx.transientBodies.splice(i, 1);
}

// Opportunistic prune of stale (cross-buddy) / part-gone charges. Runs on every
// stick + detonate so the array can't accumulate dangling references.
function pruneStale(ctx) {
  for (let i = placedCharges.length - 1; i >= 0; i--) {
    const c = placedCharges[i];
    if (!isLive(ctx, c)) {
      dropBody(ctx, c);
      placedCharges.splice(i, 1);
    }
  }
}

function detonateAll(ctx, s) {
  if (!placedCharges.length) return;
  // Partition: live charges blow, stale ones are dropped silently.
  const live = [];
  for (const c of placedCharges) {
    if (isLive(ctx, c)) live.push(c);
    else dropBody(ctx, c);
  }
  placedCharges.length = 0;
  if (!live.length) return;

  for (const c of live) {
    explode(ctx, c.position.x, c.position.y, {
      radius: s.radius, baseVel: s.baseVel, upBias: 4, moodDelta: -s.mood,
      stunMs: s.stunMs, shake: s.shake, sound: 'bomb', limpMs: 600,
    });
    dropBody(ctx, c);
  }
  // Detonation cord: the string itself rips. With ≥2 charges, a linking blast
  // detonates at their centroid (a real extra hit that rewards multi-charge
  // play — reads s.chained, not a scalar double-dip).
  if (s.chained && live.length >= 2) {
    let cx = 0, cy = 0;
    for (const c of live) { cx += c.position.x; cy += c.position.y; }
    cx /= live.length; cy /= live.length;
    explode(ctx, cx, cy, {
      radius: s.radius, baseVel: s.baseVel, upBias: 4, moodDelta: -s.mood,
      stunMs: s.stunMs, shake: s.shake, sound: 'bomb', limpMs: 600,
    });
  }
  sfx.breachDetonate?.();
}

export default {
  id: 'breaching_charge',
  defaultStats,
  apply(ctx) {
    const s = getStats('breaching_charge');
    const { ragdoll, x, y } = ctx;
    pruneStale(ctx);

    const part = partInRange(ragdoll, x, y, s.stickRange);
    // STICK only if we hit an as-yet-uncharged part; clicking an already-charged
    // part (or empty space) is the DETONATE input.
    if (part && !placedCharges.some(c => c._partRef === part)) {
      const charge = Bodies.circle(part.position.x, part.position.y, 6, {
        isSensor: true, collisionFilter: { mask: 0 }, render: { visible: false },
      });
      charge.partType = 'breaching_charge';
      charge._verb = ctx._verb || 'breaching_charge';
      charge._partRef = part;
      // Stick where the player clicked on the limb (small offset off part center).
      charge._offset = { x: x - part.position.x, y: y - part.position.y };
      charge._epoch = ctx._epoch;
      charge.bornAt = performance.now();
      charge.lifeMs = s.lifeMs;
      charge.onTick = (self, tctx) => {
        // KINEMATIC ONLY: glue the marker to its limb. No force, no explode.
        if (!tctx.ragdoll?.parts?.includes(self._partRef)) return;
        Body.setPosition(self, {
          x: self._partRef.position.x + self._offset.x,
          y: self._partRef.position.y + self._offset.y,
        });
      };
      placedCharges.push(charge);
      Composite.add(ctx.world, charge);
      ctx.transientBodies.push(charge);
      sfx.breachStick?.();
    } else {
      detonateAll(ctx, s);
    }
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Charge brick.
    ctx.fillStyle = '#3a2f25';
    ctx.fillRect(-7, -4, 14, 9);
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(-7, -4, 14, 9);
    // Blasting cap + a blinking detonator pip.
    ctx.fillStyle = '#777';
    ctx.fillRect(-1.5, -9, 3, 5);
    const blink = Math.floor(performance.now() / 350) % 2 === 0;
    ctx.fillStyle = blink ? '#ff5b5b' : '#7a2222';
    ctx.beginPath(); ctx.arc(0, -10, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Count pip: how many charges are armed (the "ready to blow" read).
    if (placedCharges.length > 0) {
      ctx.save();
      ctx.fillStyle = '#ff5b5b';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`×${placedCharges.length}`, x + 10, y - 6);
      ctx.restore();
    }
  },
};
