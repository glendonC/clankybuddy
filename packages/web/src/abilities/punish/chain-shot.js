// Chain shot, ordnance. Two iron balls launched as a linked pair, offset
// perpendicular to the aim ray with a render-only tether between them. As the
// pair plows through the buddy, anything caught in the segment between the two
// balls gets clotheslined (sweepImpact, IMPULSE lane — see transients/chain-shot.js).
//
// The LEAD ball carries the Pattern-2 sweep handler + a reference to the PARTNER;
// the partner is a plain physics body with NO handler, so there's no double-fire.
// No Matter.Constraint — the pair flies PARALLEL (it doesn't orbit). That's the
// honest no-constraint version; the spinning-bar variant waits on the constraint
// registry batch.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { drawAimLine, drawCrosshair } from '../../render/shared-cursor.js';
import { getStats } from '../_stats.js';
import { aimAngle } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  speed:        12,
  gap:          28,    // perpendicular spacing between the two balls
  ballRadius:   8,
  gatherRadius: 30,    // sweep reach around the lead→partner segment
  force:        0.07,  // sweepImpact magnitude (force-per-mass)
  mood:         16,    // per struck part (the sweep lane does not divide mood)
};

function makeBall(px, py, r, label) {
  return Bodies.circle(px, py, r, {
    frictionAir: 0, friction: 0, density: 0.02, restitution: 0.1,
    label, render: { visible: false },
  });
}

export default {
  id: 'chain_shot',
  defaultStats,
  apply(ctx) {
    const s = getStats('chain_shot');
    const { ragdoll, world, x, y, screenShake } = ctx;
    const { angle, ok } = aimAngle(ragdoll, x, y);
    if (!ok) return;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const perpx = -sin, perpy = cos;
    const half = s.gap / 2;
    const baseX = x + cos * 30, baseY = y + sin * 30;
    const vel = { x: cos * s.speed, y: sin * s.speed };
    const now = performance.now();

    // Partner: plain physics body — no handler (so it can't double-fire) and no
    // render branch (the lead's branch draws it).
    const partner = makeBall(baseX - perpx * half, baseY - perpy * half, s.ballRadius, 'chain_shot_partner');
    partner.partType = 'chain_shot_partner';
    partner._verb = ctx._verb || 'chain_shot';
    partner.bornAt = now;
    partner.lifeMs = 2000;
    Body.setVelocity(partner, vel);
    Composite.add(world, partner);
    ctx.transientBodies.push(partner);

    // Lead: carries the sweep-handler payload + the partner reference.
    const lead = makeBall(baseX + perpx * half, baseY + perpy * half, s.ballRadius, 'chain_shot');
    lead.partType = 'chain_shot';
    lead._verb = ctx._verb || 'chain_shot';
    lead.bornAt = now;
    lead.lifeMs = 2000;
    lead._partner = partner;
    lead._gatherRadius = s.gatherRadius;
    lead._force = s.force;
    lead._mood = s.mood;
    // Fresh Set-backed marker per cast: each part clotheslined at most once as
    // the pair passes through (the office-chair dedupe contract).
    const seen = new Set();
    lead._sweepMarker = { seen: (id) => seen.has(id), mark: (id) => seen.add(id) };
    Body.setVelocity(lead, vel);
    Composite.add(world, lead);
    ctx.transientBodies.push(lead);

    sfx.chainShot();
    screenShake(6, 200);
  },
  drawCursor(ctx, { x, y, target, angle }) {
    if (target) drawAimLine(ctx, x, y, target); else drawCrosshair(ctx, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Twin-bore cannon: two stubby barrels stacked across the aim.
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(-13, -10, 30, 8); ctx.fillRect(-13, 2, 30, 8);
    ctx.fillStyle = '#15171b'; ctx.fillRect(15, -11, 5, 9); ctx.fillRect(15, 2, 5, 9);
    ctx.restore();
  },
};
