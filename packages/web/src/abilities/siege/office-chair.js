// Office chair, siege drag-throw vehicle. Drag to aim, release to fling a
// high-restitution rolling chair along the drag vector. It ricochets and
// clatters off walls/floor for its lifeMs, sweep-impacting any part the box
// footprint crosses.
//
// Unlike the spawnDrop droppables (brick / bowling / piano, gravity-fed
// pancakes), the chair is a THROW: the release velocity is the verb. It uses
// the IMPULSE lane (sweepImpact) in its registered transient handler rather
// than the squashVel/splash velocity lane, so each clatter reads as a solid
// knock that propagates through the joints. The handler is per-substep
// (onContact) — sweepImpact must never run from an onTick (kinematic-only).
//
// The dedupe marker is a FRESH Set per throw, created here and stashed on the
// body, so each part is struck at most once per throw-pass; a per-part
// time-throttle on the handler lets repeated ricochets across the body re-hit.

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { sfx } from '../../audio/sfx.js';

const { Body, Bodies, Composite } = Matter;

// Footprint of the chair seat/back box used for both the physics body and the
// caller-local AABB-vs-circle hit test in the transient handler.
export const CHAIR_W = 46;
export const CHAIR_H = 52;

export const defaultStats = {
  force: 0.06,   // sweepImpact magnitude (force-per-mass) on each clatter
  mood:  10,     // mood damage per struck part
};

export default {
  id: 'office_chair',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('office_chair');
    const {
      world, x, y, ragdoll, popBubble, transientBodies,
      dragVec = { x: 0, y: 0 },
    } = ctx;
    if (!ragdoll?.parts?.length) return;

    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 16) {
      popBubble?.(ragdoll.head, 'roll it!');
      return;
    }

    // Throw vector points away from the drag (pull back to fling forward,
    // sling style), clamped so a long drag doesn't rocket it offscreen
    // instantly. High restitution + low air friction = it keeps clattering.
    const k = 0.06;
    const vx = -Math.max(-26, Math.min(26, dragVec.x * k));
    const vy = -Math.max(-26, Math.min(26, dragVec.y * k));

    const body = Bodies.rectangle(x, y, CHAIR_W, CHAIR_H, {
      density: 0.01, friction: 0.2, frictionAir: 0.004, restitution: 0.85,
      label: 'office_chair', render: { visible: false },
    });
    body.partType = 'office_chair';
    body._verb    = ctx._verb || 'office_chair';
    body.bornAt   = performance.now();
    body.lifeMs   = 2800;
    // FRESH Set-backed marker per throw (each part struck at most once per
    // pass; the handler's per-part throttle re-arms on ricochet). The marker
    // lives on the body so every onContact this throw shares the same Set.
    const seen = new Set();
    body._sweepMarker = { seen: (id) => seen.has(id), mark: (id) => seen.add(id) };
    // Stash the footprint half-extents for the handler's AABB-vs-circle test.
    body._halfW = CHAIR_W / 2;
    body._halfH = CHAIR_H / 2;
    body._force = s.force;
    body._mood  = s.mood;

    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.6);
    Composite.add(world, body);
    transientBodies.push(body);
    sfx.officeChair?.();
  },
  drawCursor(rctx, { x, y, isDown, dragStart }) {
    rctx.save();
    rctx.translate(x, y);
    // Little office chair: seat + backrest + a hint of casters.
    rctx.fillStyle = '#2b2f36';
    rctx.fillRect(-10, -2, 20, 6);      // seat
    rctx.fillRect(-9, -16, 5, 16);      // backrest post
    rctx.fillStyle = '#3a4049';
    rctx.fillRect(-12, -18, 18, 6);     // backrest pad
    rctx.fillStyle = '#1c1f24';
    rctx.fillRect(-1, 4, 2, 6);         // gas column
    rctx.beginPath(); rctx.arc(-8, 12, 2, 0, Math.PI * 2); rctx.fill();
    rctx.beginPath(); rctx.arc(8, 12, 2, 0, Math.PI * 2); rctx.fill();
    rctx.restore();

    if (!isDown || !dragStart) return;
    rctx.save();
    rctx.strokeStyle = 'rgba(160, 200, 255, 0.5)';
    rctx.setLineDash([4, 4]);
    rctx.beginPath();
    rctx.moveTo(dragStart.x, dragStart.y);
    rctx.lineTo(x, y);
    rctx.stroke();
    rctx.setLineDash([]);
    rctx.restore();
  },
};
