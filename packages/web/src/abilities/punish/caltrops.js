// Caltrops, a kinetic placed-hazard tool. Drag (or click) to scatter a strip
// of spikes on the stage; it sits as a static sensor and BLEEDs any buddy part
// that lands on or rolls across it. Drop with no drag still places a default-
// width strip centered on the click point; the drag vector just widens the
// scatter (longer drag -> wider strip), capped so it can't span the stage.
//
// The bleed + per-part debounce lives in transients/caltrops.js (modeled on
// transients/bear-trap.js + the mode-collapse-zone debounce). This file only
// spawns the strip body and wires partType / bornAt / lifeMs, then pushes to
// ctx.transientBodies; the collision handler + cleanupTransients take over.
//
// INTEGRATOR: transients/caltrops.js is a NEW transient module and MUST be
// registered in transients/index.js (import + add to the HANDLERS array) or
// onContact will never fire.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';

const { Bodies, Composite } = Matter;

export const defaultStats = {
  width:    64,      // default strip width when dropped with no drag
  maxWidth: 200,     // cap so a long drag can't carpet the whole stage
  height:   6,       // thin floor strip
  lifeMs:   14000,   // self-removes if it's never stepped on
  bleedMs:  6000,    // duration handed to each BLEED application
  spikes:   9,       // cosmetic spike count along the strip (cursor + scatter)
};

export default {
  id: 'caltrops',
  defaultStats,

  // kind: 'drag' — fires on mouseup with ctx.dragVec. Drop-with-no-drag still
  // places a default-width strip (matching bear-trap's behavior).
  applyRelease(ctx) {
    const s = getStats('caltrops');
    const { world, x, y, transientBodies } = ctx;

    // Drag length widens the scatter; clamp to [width, maxWidth].
    const dragLen = Math.hypot(ctx.dragVec?.x ?? 0, ctx.dragVec?.y ?? 0);
    const width = Math.min(s.maxWidth, Math.max(s.width, dragLen));

    const strip = Bodies.rectangle(x, y, width, s.height, {
      isStatic: true, isSensor: true,
      label: 'caltrops', render: { visible: false },
    });
    strip.partType = 'caltrops';
    strip._verb = ctx._verb || 'caltrops';
    strip.bornAt = performance.now();
    strip.lifeMs = s.lifeMs;
    strip._bleedMs = s.bleedMs;     // read by transients/caltrops.js onContact
    strip._width = width;           // stash for any future render of the strip
    Composite.add(world, strip);
    transientBodies.push(strip);

    // Scatter SFX + a spray of metal-glint particles along the strip so the
    // placement reads even though the sensor body itself is invisible.
    sfx.caltrops?.();
    const spikes = Math.max(3, Math.round(s.spikes * (width / s.width)));
    for (let i = 0; i < spikes; i++) {
      const px = x + (i / (spikes - 1) - 0.5) * width;
      P.burst(px, y, 2, {
        type: 'spark', color: '#cdd', size: 2.5, life: 420, speedRange: 0.5, gravity: 0.0012,
      });
    }
    startCooldown('caltrops');
  },

  // Cursor: a little cluster of caltrop spikes. Non-firearm melee gets `angle`
  // (atan2 to nearest part) for free, but a scatter cluster reads better
  // upright, so we ignore it and draw a fixed spiky tetrahedron-ish glyph.
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    rctx.strokeStyle = '#aab';
    rctx.fillStyle = '#cdd';
    rctx.lineWidth = 1.6;
    // Three crossed spikes radiating from a center, the classic caltrop look.
    const angles = [-Math.PI / 2, Math.PI * 0.18, Math.PI * 0.82];
    for (const a of angles) {
      rctx.beginPath();
      rctx.moveTo(0, 0);
      rctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
      rctx.stroke();
      // arrow-tip barb
      rctx.beginPath();
      rctx.arc(Math.cos(a) * 9, Math.sin(a) * 9, 1.4, 0, Math.PI * 2);
      rctx.fill();
    }
    // hub
    rctx.beginPath();
    rctx.arc(0, 0, 2, 0, Math.PI * 2);
    rctx.fill();
    rctx.restore();
  },
};
