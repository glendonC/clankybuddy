// Electrified panel — a placed-hazard tool. Drag (or click) to drop a STATIC
// sensor plate on the stage; any buddy part touching it gets ELECTRIFIED on a
// ~400ms per-part throttle, persisting for the plate's lifeMs. The electric
// cousin of caltrops: a lingering field, not a one-shot. Drag length widens the
// plate (longer drag -> wider plate), capped so it can't span the stage.
//
// The zap + per-part throttle + chain fan-out lives in
// transients/electrified-panel.js (SENSOR-TRAP template). This file only spawns
// the plate body, wires partType / bornAt / lifeMs / _width / _electrifiedMs,
// pushes to ctx.transientBodies, and registers it with the placed-hazard
// registry so hazard.chain can find it. getStats('electrified_panel') is read
// INSIDE applyRelease (live ES binding via _stats.js), never at module top.
//
// INTEGRATOR:
//   - transients/electrified-panel.js is a NEW transient module and MUST be
//     registered in transients/index.js (import + add to the HANDLERS array) or
//     onContact will never fire.
//   - ui/tools-table.js needs an `electrified_panel` row (id/label/key/
//     kind:'drag'/spine:'negative'/group:'hazard'/cost) — the TOOLS table is
//     the source of truth.
//   - abilities/index.js: add `electrified_panel` to the ABILITIES map.
//   - abilities/_stats.js: add `electrified_panel` to SOURCES so
//     getStats('electrified_panel') returns these defaultStats.
//   - progression/groups/<hazard group>.js: a toolNode to unlock it.

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { registerPlacedHazard } from '../../state/hazard-field.js';
import { detonate } from '../../transients/electrified-panel.js';

const { Bodies, Composite } = Matter;

export const defaultStats = {
  width:        90,      // default plate width when dropped with no drag
  maxWidth:     220,     // cap so a long drag can't carpet the whole stage
  height:       12,      // thin floor plate
  lifeMs:       14000,   // self-removes if it's never stepped on
  electrifiedMs: 600,    // ELECTRIFIED duration handed to each zap
};

export default {
  id: 'electrified_panel',
  defaultStats,

  // kind: 'drag' — fires on mouseup with ctx.dragVec. Drop-with-no-drag still
  // places a default-width plate (matching caltrops / bear-trap behavior).
  applyRelease(ctx) {
    const s = getStats('electrified_panel');
    const { world, x, y, transientBodies } = ctx;

    // Drag length widens the plate; clamp to [width, maxWidth].
    const dragLen = Math.hypot(ctx.dragVec?.x ?? 0, ctx.dragVec?.y ?? 0);
    const width = Math.min(s.maxWidth, Math.max(s.width, dragLen));

    const plate = Bodies.rectangle(x, y, width, s.height, {
      isStatic: true, isSensor: true,
      label: 'electrified_panel', render: { visible: false },
    });
    plate.partType = 'electrified_panel';
    plate._verb = ctx._verb || 'electrified_panel';
    plate.bornAt = performance.now();
    plate._epoch = ctx._epoch;            // epoch-gate any future deferred logic
    plate.lifeMs = s.lifeMs;
    plate._width = width;                 // read by detonate() footprint + render
    plate._height = s.height;
    plate._electrifiedMs = s.electrifiedMs; // read by transient onContact
    Composite.add(world, plate);
    transientBodies.push(plate);

    // Register for chain queries. chainTrigger replays the SAME zap payload the
    // transient onContact uses (chained plate zaps the buddy identically). The
    // chain caller passes the live ctx2; detonate re-queries overlapping parts.
    registerPlacedHazard(plate, {
      kind: 'electrified_panel',
      chainTrigger: (entry, ctx2) => detonate(entry.body, ctx2),
    });

    // Live-wire SFX + a sputter of blue-white sparks along the plate so the
    // placement reads even though the sensor body itself is invisible.
    sfx.zap?.();
    const sparks = Math.max(4, Math.round(width / 16));
    for (let i = 0; i < sparks; i++) {
      const px = x + (i / (sparks - 1) - 0.5) * width;
      P.burst(px, y, 2, {
        type: 'spark', color: '#9be7ff', size: 2.5, life: 360, speedRange: 0.6, gravity: 0,
      });
    }
    startCooldown('electrified_panel');
  },

  // Cursor: a hazard plate with arcing terminals — a flat bar with two pole
  // posts and a jittered lightning glyph between them.
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    // Plate bar.
    rctx.strokeStyle = '#7aa7c7';
    rctx.fillStyle = 'rgba(120, 170, 210, 0.25)';
    rctx.lineWidth = 1.6;
    rctx.beginPath();
    rctx.rect(-14, 4, 28, 5);
    rctx.fill();
    rctx.stroke();
    // Two pole terminals.
    rctx.fillStyle = '#cfd8e3';
    rctx.fillRect(-12, 0, 3, 4);
    rctx.fillRect(9, 0, 3, 4);
    // Arc between the terminals — jittered polyline, live-wire blue.
    rctx.strokeStyle = '#9be7ff';
    rctx.lineWidth = 1.4;
    rctx.beginPath();
    rctx.moveTo(-10, 1);
    const segs = 4;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      rctx.lineTo(-10 + t * 20, 1 + (Math.random() - 0.5) * 6);
    }
    rctx.lineTo(10, 1);
    rctx.stroke();
    rctx.restore();
  },
};
