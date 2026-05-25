// Bear trap, manipulation tool. Drag-place a snap trap on the stage.
// The trap sits there as a static sensor until the buddy walks/falls into
// it; on contact it stuns + bleeds. Drop with no drag still places at the
// click point (drag length is just for cursor flavor).
//
// Phase 7 visceral redirect addition. Replaces the `unplug` slot.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';

const { Bodies, Composite } = Matter;

export default {
  id: 'bear_trap',
  applyRelease(ctx) {
    const { world, x, y, transientBodies } = ctx;
    const canvas = world?.bounds ? null : null;
    // Floor-pin: snap the trap to the y-position of the click. We don't
    // need exact floor alignment, sensors don't fall, but clamping to
    // the bottom of the stage avoids floating traps mid-air.
    const trap = Bodies.rectangle(x, y, 38, 8, {
      isStatic: true, isSensor: true,
      label: 'bear_trap', render: { visible: false },
    });
    trap.partType = 'bear_trap';
    trap._verb = ctx._verb || 'bear_trap';
    trap.bornAt = performance.now();
    trap.lifeMs = 12000;       // self-removes if buddy never steps on it
    Composite.add(world, trap);
    transientBodies.push(trap);
    sfx.shatter?.();           // brief metal "click", reusing shatter SFX
    startCooldown('bear_trap');
  },
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    // Open jaws, two arcs facing each other
    rctx.strokeStyle = '#9aa';
    rctx.lineWidth = 2;
    rctx.beginPath();
    rctx.arc(0, -2, 9, Math.PI * 1.2, Math.PI * 1.8);
    rctx.stroke();
    rctx.beginPath();
    rctx.arc(0, 2, 9, Math.PI * 0.2, Math.PI * 0.8);
    rctx.stroke();
    // Plate
    rctx.fillStyle = '#3a3a3e';
    rctx.fillRect(-10, -1, 20, 2);
    // Teeth
    rctx.fillStyle = '#cdd';
    for (let i = -8; i <= 8; i += 4) {
      rctx.fillRect(i, -3, 1.5, 2);
      rctx.fillRect(i, 1,  1.5, 2);
    }
    rctx.restore();
  },
};
