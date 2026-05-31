// Magnet (tractor beam) — kind:'hold' cursor tool.
//
// The ability itself does almost nothing per fire: the actual physics is a
// phase:'physics' force Mode (modes/force-magnet.js) so the pull integrates in
// the 60Hz inner loop. apply() just flips the Mode ON (idempotent). It is
// turned OFF generically by the tool.forceMode seam — input/mouse.js endPress
// (mouseup / mouseleave) and ui/hotbar.js setActiveTool both read
// activeTool.forceMode and setEnabled(tag, false). Nothing here hardcodes the
// teardown, so gravity-well / flood reuse the same seam by declaring their own
// forceMode tag.
//
// defaultStats are read INSIDE the Mode tick via getStats('magnet') (live ES
// binding through _stats.js), never at module top level.

import { setEnabled } from '../../modes/bus.js';
import { FORCE_MAGNET_ID } from '../../modes/force-magnet.js';
import { sfx } from '../../audio/sfx.js';

export default {
  id: 'magnet',

  // Tuning the force Mode reads via getStats('magnet').
  defaultStats: {
    range:   240,    // reach in px
    pull:    0.006,  // force-per-mass at the cursor (pre-soften)
    soften:  0.004,  // 1/(1 + dist*soften) falloff
    maxPull: 0.012,  // hard ceiling on |force-per-mass| (NaN guard)
  },

  // hold: fires on mousedown and re-fires on mousemove. Every fire just
  // (re)asserts the Mode is enabled — setEnabled is idempotent so repeated
  // fires are no-ops once it's on. The mouse-up / tool-switch seam disables it.
  apply(ctx) {
    setEnabled(FORCE_MAGNET_ID, true, ctx);
    sfx.magnet?.();
  },

  // Tractor field: concentric arcs converging on the cursor, brighter when the
  // beam is engaged (mouse down). Purely cosmetic; the Mode owns the physics.
  drawCursor(c, { x, y, isDown }) {
    c.save();
    c.translate(x, y);
    const on = !!isDown;
    // Horseshoe-magnet glyph at the cursor.
    c.lineWidth = 3;
    c.strokeStyle = on ? '#e23b3b' : '#b04444';
    c.beginPath();
    c.arc(0, 2, 7, Math.PI, Math.PI * 2, false);
    c.moveTo(-7, 2); c.lineTo(-7, 9);
    c.moveTo(7, 2);  c.lineTo(7, 9);
    c.stroke();
    // Pole caps.
    c.fillStyle = '#cfd8e3';
    c.fillRect(-9, 9, 4, 3);
    c.fillRect(5, 9, 4, 3);
    // Tractor field arcs radiating outward — denser/brighter when engaged.
    c.lineWidth = 1.5;
    const rings = on ? 4 : 2;
    for (let i = 1; i <= rings; i++) {
      const r = 16 + i * 11;
      c.strokeStyle = `rgba(226, 59, 59, ${on ? 0.34 - i * 0.06 : 0.16 - i * 0.04})`;
      c.beginPath();
      c.arc(0, 4, r, Math.PI * 0.9, Math.PI * 2.1, false);
      c.stroke();
    }
    c.restore();
  },
};
