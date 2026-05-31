// Trebuchet, siege branch. A heavy ranged siege engine: drag to aim, release to
// lob a boulder in a high arc (same drag→velocity + gravity-arc model as the
// grenade lob). The boulder is a Pattern-1 onHit body — on first contact
// (landing on a part or the floor) it detonates a heavy-radius bigImpact, the
// "ground-shaking thud". onExpire is the air-burst fallback if it never lands.
//
// Grounded real-world item: a medieval counterweight siege engine flinging a
// rock. Launch = counterweight creak; impact = ground-shaking thud.
//
// kind: 'drag' (aimed lob) → exports applyRelease, reads dragVec.

import Matter from 'matter-js';
import { getStats } from '../_stats.js';
import { bigImpact } from '../_shared.js';
import { sfx } from '../../audio/sfx.js';
import * as P from '../../particles.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  // Lob tuning (mirrors the grenade k/clamps so the preview matches flight).
  k:        0.05,    // drag-pixels → launch velocity scalar
  // Heavy-radius siege impact.
  radius:   240,
  baseVel:  16,      // additive radial fling at impact center
  mood:     30,
};

export default {
  id: 'trebuchet',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('trebuchet');
    const { world, x, y, popBubble, ragdoll, screenShake, dragVec = { x: 0, y: 0 } } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 24) {
      popBubble(ragdoll.head, 'wind it back!');
      return;
    }
    const k = s.k;
    // High-arc lob: same clamps as the grenade, with a stronger upward bias so
    // the boulder sails before it falls (the trebuchet "lob").
    const vx = Math.max(-16, Math.min(16, dragVec.x * k));
    const vy = Math.max(-20, Math.min(14, dragVec.y * k - 6));

    const boulder = Bodies.circle(x, y, 20, {
      frictionAir: 0.005, friction: 0.7, density: 0.02, restitution: 0.1,
      label: 'trebuchet', render: { visible: false },
    });
    boulder.partType = 'trebuchet';
    boulder._verb = ctx._verb || 'trebuchet';
    boulder.bornAt = performance.now();
    boulder.lifeMs = 4000;
    boulder._epoch = ctx._epoch;
    Body.setVelocity(boulder, { x: vx, y: vy });
    Body.setAngularVelocity(boulder, (Math.random() - 0.5) * 0.15);

    // Pattern 1: onHit fires on the FIRST collision (part or wall = landing).
    // processCollision removes the body and guards via _spent.
    boulder.onHit = (b, _world, ctx2) => {
      ctx2.hitStop?.explosion();
      bigImpact(ctx2, b.position.x, b.position.y, {
        radius: s.radius, baseVel: s.baseVel, upBias: 5,
        moodDelta: -s.mood, stunMs: 1300, shake: 22, limpMs: 850,
        sound: 'trebuchetThud',
      });
      P.burst(b.position.x, b.position.y, 18, { type: 'smoke', color: '#5a4a38', size: 16, life: 800, speedRange: 0.6, gravity: -0.0003 });
      P.burst(b.position.x, b.position.y, 12, { type: 'spark', color: '#c8b890', size: 4, life: 360, speedRange: 1.2, gravity: 0.0006 });
    };
    // Air-burst fallback if it never collides (cleared off the edge of the arc).
    boulder.onExpire = (b, ctx2) => {
      bigImpact(ctx2, b.position.x, b.position.y, {
        radius: s.radius * 0.85, baseVel: s.baseVel * 0.8, upBias: 4,
        moodDelta: -s.mood * 0.7, stunMs: 1000, shake: 16, limpMs: 650,
        sound: 'trebuchetThud',
      });
    };

    Composite.add(world, boulder);
    ctx.transientBodies.push(boulder);
    // Counterweight creak on launch.
    if (sfx.trebuchetCreak) sfx.trebuchetCreak();
    screenShake?.(4, 160);
    // A little dust kicked up at the throwing arm.
    P.burst(x, y, 6, { type: 'smoke', color: '#6b5a44', size: 9, life: 420, speedRange: 0.4, gravity: -0.0002 });
  },
  drawCursor(ctx, { x, y, isDown, dragStart, gravityY = 1.4 }) {
    // Boulder resting at the cursor (the loaded sling).
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#4a4036';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    // Rocky facets.
    ctx.fillStyle = '#5c5044';
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(2, -7); ctx.lineTo(0, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(-4, -5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (!isDown || !dragStart) return;
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    if (Math.hypot(dx, dy) < 24) return;
    const k = 0.05;
    const vx = Math.max(-16, Math.min(16, dx * k));
    const vy = Math.max(-20, Math.min(14, dy * k - 6));
    // Same gravity-arc integration the grenade preview uses so the dotted line
    // matches the boulder's real flight.
    const a = gravityY * 0.001 * (1000 / 16);
    ctx.save();
    ctx.fillStyle = 'rgba(200, 170, 120, 0.6)';
    for (let step = 1; step <= 30; step++) {
      const t = step * 60;
      const px = dragStart.x + vx * t;
      const py = dragStart.y + vy * t + 0.5 * a * t * t * 0.0001 * 60;
      if (step % 2 === 0) {
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (py > 4000) break;
    }
    ctx.strokeStyle = 'rgba(200, 170, 120, 0.42)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};
