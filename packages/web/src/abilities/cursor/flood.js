// Flood — hazard-group one-shot (kind:'click'). Flood the whole arena: the water
// level rises, holds, then drains. Submerged parts get buoyancy (clamped so it
// can at most ~neutralize weight — never a rocket) + drag, and any fire is doused.
//
// Screen-wide and position-independent: a flood is an EVENT you trigger, not a
// point you place, so it's kind:'click' (fires on mousedown) rather than the
// drag-place pattern the point hazards use. The physics + the rise/hold/drain
// FSM + the render all live in the phase:'physics' Mode (modes/force-flood.js);
// this ability just resolves the arena geometry from the live canvas and kicks
// the tide off.
//
// FORKS (flag statNodes on this root): Whirlpool (s.whirlpool → a swirl toward
// arena center) and Acid flood (s.acid → stamps the existing `corroded` status
// and suppresses the fire douse). Both are read here at cast and latched into the
// Mode, so a mid-flood purchase can't reshape an in-progress tide.

import { canvas } from '../../state/world.js';
import { FLOOR_INSET } from '../../physics/constants.js';
import { spikeFear } from '../../mood.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { startFlood } from '../../modes/force-flood.js';

const num = (v, d) => (Number.isFinite(v) ? v : d);

export default {
  id: 'flood',
  // Tuning latched into the force Mode at cast.
  defaultStats: {
    capFrac:  0.42,    // crest height as a fraction of canvas height above the floor
    holdMs:   2400,    // dwell at the crest before draining
    buoyancy: 0.0011,  // per-mass upward at depth 0 (clamped ≤ ~weight in the Mode)
    depthK:   0.004,   // buoyancy growth with submersion depth (then clamped)
    dragMul:  0.92,    // velocity retained per step while submerged
    riseRate: 4,       // px the surface climbs per physics step
    swirlMag: 0.004,   // whirlpool horizontal force-per-mass toward center (clamped)
  },

  apply(ctx) {
    const s = getStats('flood');
    const floorY = canvas.height - FLOOR_INSET;
    const capY = floorY - canvas.height * num(s.capFrac, 0.42);
    startFlood({
      floorY, capY,
      centerX:  canvas.width / 2,
      buoyancy: num(s.buoyancy, 0.0011),
      depthK:   num(s.depthK, 0.004),
      dragMul:  num(s.dragMul, 0.92),
      riseRate: num(s.riseRate, 4),
      swirlMag: num(s.swirlMag, 0.004),
      holdMs:   num(s.holdMs, 2400),
      whirlpool: !!s.whirlpool,
      acid:      !!s.acid,
      epoch:     ctx._epoch,
    });
    sfx.flood?.();
    spikeFear(ctx.mood, 50);
    startCooldown('flood');
  },

  // Rising-wave glyph at the cursor.
  drawCursor(c, { x, y, isDown }) {
    c.save();
    c.translate(x, y);
    const t = performance.now() * 0.004;
    c.strokeStyle = isDown ? 'rgba(120,190,235,0.95)' : 'rgba(90,160,210,0.7)';
    c.lineWidth = 2;
    c.lineCap = 'round';
    for (let row = 0; row < 2; row++) {
      const yy = 6 - row * 7;
      c.beginPath();
      for (let i = -10; i <= 10; i += 2) {
        const wy = yy + Math.sin(i * 0.5 + t + row) * 2.2;
        if (i === -10) c.moveTo(i, wy); else c.lineTo(i, wy);
      }
      c.stroke();
    }
    // A couple of rising droplets.
    c.fillStyle = isDown ? 'rgba(120,190,235,0.9)' : 'rgba(90,160,210,0.6)';
    for (let i = 0; i < 2; i++) {
      const dy = -((t * 14 + i * 9) % 16);
      c.beginPath();
      c.arc(-5 + i * 10, dy, 1.6, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  },
};
