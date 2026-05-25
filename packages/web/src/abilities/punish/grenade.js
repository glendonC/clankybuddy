// @ts-check
import Matter from 'matter-js';
import { explode } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

/** @type {import('../../types.js').Ability} */
export default {
  id: 'grenade',
  applyRelease(ctx) {
    const { world, x, y, popBubble, ragdoll, dragVec = { x: 0, y: 0 } } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 24) {
      popBubble(ragdoll.head, 'pull harder!');
      return;
    }
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dragVec.x * k));
    const vy = Math.max(-18, Math.min(15, dragVec.y * k - 4));

    const nade = Bodies.circle(x, y, 8, {
      frictionAir: 0.01, friction: 0.5, density: 0.0025, restitution: 0.4,
      label: 'grenade', render: { visible: false },
    });
    nade.partType = 'grenade';
    nade._verb = ctx._verb || 'grenade';
    nade.bornAt = performance.now();
    nade.fuseAt = nade.bornAt + 2000;
    nade.lifeMs = 2100;
    Body.setVelocity(nade, { x: vx, y: vy });
    Body.setAngularVelocity(nade, (Math.random() - 0.5) * 0.2);
    nade.onExpire = (b, ctx2) => {
      // baseVel 14.4 = legacy force 0.18 × 80 unit conversion.
      explode(ctx2, b.position.x, b.position.y, { radius: 200, baseVel: 14.4, upBias: 4, moodDelta: -25, stunMs: 1200, shake: 16, igniteMs: 4500, sound: 'bomb', limpMs: 700 });
    };
    Composite.add(world, nade);
    ctx.transientBodies.push(nade);
  },
  drawCursor(ctx, { x, y, isDown, dragStart, gravityY = 1.4 }) {
    // hand-held grenade at cursor
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1c1f24';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#666';
    ctx.fillRect(-2, -10, 4, 4);
    ctx.restore();

    if (!isDown || !dragStart) return;
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    if (Math.hypot(dx, dy) < 24) return;
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dx * k));
    const vy = Math.max(-18, Math.min(15, dy * k - 4));
    const a = gravityY * 0.001 * (1000 / 16);
    ctx.save();
    ctx.fillStyle = 'rgba(248, 113, 113, 0.55)';
    for (let step = 1; step <= 26; step++) {
      const t = step * 60;
      const px = dragStart.x + vx * t;
      const py = dragStart.y + vy * t + 0.5 * a * t * t * 0.0001 * 60;
      if (step % 2 === 0) {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (py > 4000) break;
    }
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.4)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};
