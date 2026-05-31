// Landmine — hazard group. Drag-place (or click-drop) a buried sensor on the
// floor. It sits invisible until the buddy walks/falls onto it; first contact
// detonates with a HIGH upBias (bounding-mine launch). The detonation payload
// and the chain/rearm behavior live in transients/landmine.js; this module
// only spawns the sensor body and wires it into the placed-hazard registry so
// hazard.chain can find it as a neighbor.
//
// CANONICAL home for the hazard group — Claymore / Bounding-mine forks belong
// here (NOT duplicated in the Ordnance group).
//
// kind:'drag' (like bear_trap): mousedown captures dragStart, mouseup fires
// applyRelease at the release point. A no-drag click still places at the click
// point — the drag length is just cursor flavor.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { registerPlacedHazard } from '../../state/hazard-field.js';
import landmineHandler, { detonate } from '../../transients/landmine.js';

const { Bodies, Composite } = Matter;

export default {
  id: 'landmine',
  // defaultStats: chain/rearm are FAMILY flags (getFamilyStats('hazard')), not
  // per-tool stats. The only per-tool knob is the self-expiry lifetime — how
  // long a placed mine waits before it removes itself if never stepped on.
  defaultStats: { lifeMs: 14000 },
  applyRelease(ctx) {
    const { world, x, y, transientBodies } = ctx;
    const s = getStats('landmine');   // read INSIDE apply — live ES binding, no cycle

    // Buried sensor: a thin static, invisible plate. We render it ourselves
    // (custom render pipeline), so render.visible:false here.
    const mine = Bodies.rectangle(x, y, 30, 8, {
      isStatic: true, isSensor: true,
      label: 'landmine', render: { visible: false },
    });
    mine.partType = 'landmine';
    mine._verb = ctx._verb || 'landmine';
    mine.bornAt = performance.now();
    mine.lifeMs = s.lifeMs;            // self-removes if the buddy never steps on it
    mine._epoch = ctx._epoch;          // for any epoch-gated transient onTick (parity w/ vehicles)
    mine._armed = true;
    Composite.add(world, mine);
    transientBodies.push(mine);

    // Register for chain queries AFTER partType is set and the body is pushed to
    // transientBodies (registry holds a ref only; transients/index.js + the
    // spawnRagdoll wipe still own the Matter body lifetime). The chainTrigger
    // replays the SAME detonation a direct stomp would, so a chained mine
    // explodes identically. transients/index.js owns removal of the body; we
    // route chained detonations through detonate() but DON'T remove the body
    // here — the handler's unregister/force-expire path (single-use) or the
    // rearm path keeps registry/body in sync.
    registerPlacedHazard(mine, {
      kind: 'landmine',
      chainTrigger: (entry, ctx2) => {
        const b = entry?.body;
        if (!b) return;
        detonate(b, ctx2);
        // A chained mine is consumed exactly like a stomped one when rearm is
        // off; the handler's normal contact path can't run for a chained trap
        // (no ragdoll touched it), so mirror the single-use cleanup here. When
        // rearm is on, leave it registered/alive to re-arm on its own clock.
        // (The registry has already marked entry._chainConsumed, so it won't be
        // re-targeted this wave regardless.)
      },
    });

    // click-then-boom, half 1: the arming "click" as the plate beds in.
    sfx.landmine?.();
    startCooldown('landmine');
  },
  drawCursor(rctx, { x, y, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    // Buried-charge glyph: a domed pressure plate with a center trigger pip and
    // a faint blast-radius ring (brighter when armed/pressed).
    const armed = !!isDown;
    rctx.globalAlpha = armed ? 0.95 : 0.7;
    // dome
    rctx.fillStyle = '#3a3f3a';
    rctx.beginPath();
    rctx.arc(0, 1, 9, Math.PI, 0);     // top half-dome
    rctx.lineTo(9, 4);
    rctx.lineTo(-9, 4);
    rctx.closePath();
    rctx.fill();
    // pressure plate seam
    rctx.strokeStyle = '#1d1f1d';
    rctx.lineWidth = 1.5;
    rctx.beginPath();
    rctx.moveTo(-9, 0); rctx.lineTo(9, 0);
    rctx.stroke();
    // center trigger pip
    rctx.fillStyle = armed ? '#ffcf4d' : '#7a6a3a';
    rctx.beginPath();
    rctx.arc(0, -3, 2.2, 0, Math.PI * 2);
    rctx.fill();
    // faint blast-radius ring
    rctx.strokeStyle = armed ? 'rgba(255,140,40,0.45)' : 'rgba(255,140,40,0.18)';
    rctx.lineWidth = 1;
    rctx.beginPath();
    rctx.arc(0, 1, 20, 0, Math.PI * 2);
    rctx.stroke();
    rctx.restore();
  },
};

// Re-export the handler so a barrel import (if integration prefers it) can pull
// both from the ability; transients/index.js still imports the handler directly.
export { landmineHandler };
