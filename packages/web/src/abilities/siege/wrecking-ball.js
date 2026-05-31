// Wrecking ball (siege). A chained steel ball on a WORLD-POINT anchor that
// swings DOWN through the buddy for two or three demolition passes. The first
// consumer of the constraint registry (S3).
//
// Exactly ONE body (the ball) + ONE Matter.Constraint (pointA is a fixed world
// point, NO bodyA → no anchor body to leak). The constraint is registered with
// ownerBody:ball; the ball's onExpire releases it, which composes for free with
// cleanupTransients (lifeMs), nuke's transient-wipe, and char-switch — all fire
// onExpire before removing the body. The per-frame valve + spawnRagdoll's
// teardown are backstops. releaseConstraint is idempotent, so the overlapping
// paths can't double-remove.
//
// NaN-critical knobs (CLAUDE.md landmines), all here at the consumer:
//   - length = the ACTUAL spawn distance to the anchor, always > 0 (never 0).
//   - stiffness 0.8 < the 0.85 RAGDOLL_CONSTRAINT ceiling; damping low so it
//     actually swings instead of being critically damped.
//   - the dynamic ball clears the HUD collision bit (GRAB_DRAG_MASK) so a
//     chained heavy ball can't pull into infinite-mass HUD geometry → NaN.
//
// CONTRACT: sweepImpact lives in the HANDLER (transients/wrecking-ball.js),
// which runs onContact PER PHYSICS SUB-STEP. The ball is self-driven (gravity +
// constraint) and has NO onTick — never add one that sweepImpacts.

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { canvas, world } from '../../state/world.js';
import { GRAB_DRAG_MASK } from '../../physics/constants.js';
import { registerConstraint, releaseConstraintsForBody } from '../../state/constraint-registry.js';
import { sfx } from '../../audio/sfx.js';

const { Body, Bodies, Constraint, Composite } = Matter;

export const defaultStats = {
  chainLen:   260,   // anchor-to-ball rest length; the arc nadirs on the chest
  ballRadius: 22,
  density:    0.02,  // heavy iron (matches the chain_shot ball)
  swingSpeed: 14,    // px/step initial velocity toward the buddy
  force:      0.16,  // sweepImpact magnitude (force-per-mass), per pass
  mood:       22,    // per struck part, per pass (sweep lane does NOT divide mood)
  lifeMs:     2500,  // ~3 pendulum passes before cleanup
  throttleMs: 250,   // per-part re-hit window (re-arms between passes)
};

export default {
  id: 'wrecking_ball',
  defaultStats,
  apply(ctx) {
    const s = getStats('wrecking_ball');
    const { ragdoll, x } = ctx;
    if (!ragdoll?.parts?.length) return;
    const now = performance.now();
    const L = s.chainLen;

    // Buddy centroid + chest (the meatiest multi-part target band).
    let cx = 0; for (const p of ragdoll.parts) cx += p.position.x; cx /= ragdoll.parts.length;
    const chestY = ragdoll.chest?.position?.y ?? (ragdoll.head?.position?.y ?? 0) + 88;

    // Rig the ball on the side AWAY from the cursor so it swings ACROSS through
    // the buddy. Anchor sits L above the chest → the arc's bottom lands on the
    // torso. Clamp anchor + spawn into the playfield so an edge-click can't
    // spawn the ball offscreen / inside a wall.
    const M = 40;
    const clampX = (v) => Math.min(canvas.width - M, Math.max(M, v));
    const side = (x > cx) ? -1 : 1;
    const anchorX = clampX(cx + side * L * 0.7);
    const anchorY = Math.max(M, chestY - L);
    const ballX = clampX(anchorX + side * L * 0.7);
    const ballY = anchorY + L * 0.71;
    // Rest length = the ACTUAL spawn distance (so zero initial constraint
    // tension) and ALWAYS > 0 (CLAUDE.md: never length 0).
    const length = Math.max(1, Math.hypot(ballX - anchorX, ballY - anchorY));

    const ball = Bodies.circle(ballX, ballY, s.ballRadius, {
      density: s.density, frictionAir: 0.01, friction: 0.4, restitution: 0.2,
      label: 'wrecking_ball', render: { visible: false },
      collisionFilter: { mask: GRAB_DRAG_MASK },   // HUD bit cleared — no snag/NaN
    });
    ball.partType   = 'wrecking_ball';
    ball._verb      = ctx._verb || 'wrecking_ball';
    ball.bornAt     = now;
    ball.lifeMs     = s.lifeMs;
    ball._epoch     = ctx._epoch;
    ball._anchor    = { x: anchorX, y: anchorY };   // for the render chain-draw
    ball._force     = s.force;
    ball._mood      = s.mood;
    ball._throttleMs = s.throttleMs;
    // Released when the ball is wiped (lifeMs / nuke / char-switch all fire
    // onExpire before Composite.remove). Idempotent — a later valve pass no-ops.
    ball.onExpire   = (self) => releaseConstraintsForBody(self);

    Composite.add(world, ball);
    ctx.transientBodies.push(ball);

    const chain = Constraint.create({
      pointA: { x: anchorX, y: anchorY },   // NO bodyA → fixed world anchor
      bodyB: ball, pointB: { x: 0, y: 0 },
      length, stiffness: 0.8, damping: 0.1,
      render: { visible: false },
    });
    // Registry OWNS the Composite.add of the constraint + tracks it for release.
    registerConstraint(chain, { ownerBody: ball, maxAgeMs: s.lifeMs + 300 });

    // Launch along the arc toward the buddy. Set AFTER add + register so the
    // soft constraint doesn't pre-tension before the initial impulse lands.
    Body.setVelocity(ball, { x: -side * s.swingSpeed, y: 0 });

    sfx.wreckingBallSwoosh?.();
    ctx.screenShake?.(6, 220);
  },
  drawCursor(rctx, { x, y }) {
    // Iron sphere on a stub of chain.
    rctx.save();
    rctx.translate(x, y);
    rctx.strokeStyle = '#3a3a40'; rctx.lineWidth = 3;
    rctx.beginPath(); rctx.moveTo(0, -15); rctx.lineTo(0, -5); rctx.stroke();
    const g = rctx.createRadialGradient(-4, -4, 2, 0, 0, 12);
    g.addColorStop(0, '#6a6e76'); g.addColorStop(0.6, '#2c2f35'); g.addColorStop(1, '#141418');
    rctx.fillStyle = g;
    rctx.beginPath(); rctx.arc(0, 0, 12, 0, Math.PI * 2); rctx.fill();
    rctx.fillStyle = 'rgba(255,255,255,0.18)';
    rctx.beginPath(); rctx.arc(-4, -4, 3, 0, Math.PI * 2); rctx.fill();
    rctx.restore();
  },
};
