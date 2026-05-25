// Meat hook, manipulation tool. Drag to aim, release to throw a kinetic
// hook that yanks the first part it hits along the throw vector. Acts like
// a violent yo-yo: you fling the body across the stage in whatever
// direction you dragged.
//
// Phase 7 visceral redirect addition. Replaces the `mcp_link` slot.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';

const { Body, Bodies, Composite } = Matter;

export default {
  id: 'meathook',
  applyRelease(ctx) {
    const {
      world, x, y, ragdoll, popBubble, transientBodies, dragVec = { x: 0, y: 0 },
    } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 16) {
      popBubble?.(ragdoll?.head, 'pull harder!');
      return;
    }
    // Throw vector points away from drag direction (you pull back to throw
    // forward, like a sling). Magnitude-clamped so very long drags don't
    // launch the hook offscreen instantly.
    const k = 0.05;
    const vx = -Math.max(-22, Math.min(22, dragVec.x * k));
    const vy = -Math.max(-22, Math.min(22, dragVec.y * k));

    const hook = Bodies.circle(x, y, 8, {
      frictionAir: 0.005, friction: 0, density: 0.004, restitution: 0.05,
      label: 'meathook', render: { visible: false },
    });
    hook.partType = 'meathook';
    hook._verb = ctx._verb || 'meathook';
    hook.bornAt = performance.now();
    hook.lifeMs = 1000;
    // Origin: the throw release point. The transient handler yanks impacted
    // parts BACK toward this anchor, that's the harpoon read the blurb sells
    // ("spears the part then yanks it back at speed"). Without this, the hook
    // would just fling the part further along its travel vector.
    hook._originX = x;
    hook._originY = y;
    Body.setVelocity(hook, { x: vx, y: vy });
    Body.setAngularVelocity(hook, (Math.random() - 0.5) * 0.4);
    Composite.add(world, hook);
    transientBodies.push(hook);
    P.burst(x, y, 6, { type: 'spark', color: '#cdd', size: 2, life: 200, speedRange: 0.6 });
    sfx.gun?.();
    startCooldown('meathook');
  },
  drawCursor(rctx, { x, y, isDown, dragStart }) {
    rctx.save();
    rctx.translate(x, y);
    // Hook shape, small open J
    rctx.strokeStyle = '#9aa';
    rctx.lineWidth = 1.6;
    rctx.beginPath();
    rctx.moveTo(-2, -8);
    rctx.lineTo(-2, 4);
    rctx.arc(0, 4, 2, Math.PI, 0, true);
    rctx.lineTo(2, -8);
    rctx.stroke();
    rctx.fillStyle = '#a8121a';
    rctx.fillRect(-2.5, -8, 5, 1.5);
    rctx.restore();

    if (!isDown || !dragStart) return;
    rctx.save();
    rctx.strokeStyle = 'rgba(248, 113, 113, 0.5)';
    rctx.setLineDash([3, 4]);
    rctx.beginPath();
    rctx.moveTo(dragStart.x, dragStart.y);
    rctx.lineTo(x, y);
    rctx.stroke();
    rctx.setLineDash([]);
    rctx.restore();
  },
};
