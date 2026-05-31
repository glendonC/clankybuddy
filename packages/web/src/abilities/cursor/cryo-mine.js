// Cryo mine — hazard-group placement tool. Drag-place (or click-drop) a buried
// cryo sensor on the stage. It sits as a static sensor until the buddy walks /
// falls into it; on contact the transient handler (transients/cryo-mine.js)
// fires an AOE FREEZE BURST instead of an explosion — same buried-mine setup as
// a landmine, but the payload is control (frozen) not damage. Reads hazard.chain
// (a triggered mine arms neighbor traps in range) and hazard.rearm, both via the
// shared `hazard` family BEHAVIOR FLAGS in the transient handler.
//
// Placement mirrors bear_trap (kind:'drag', applyRelease drops at the release
// point). The body lifetime is owned by transients/index.js cleanup +
// spawnRagdoll's transientBodies wipe; registerPlacedHazard only holds a chain
// query ref (pruned lazily off the buddy epoch).

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { registerPlacedHazard } from '../../state/hazard-field.js';
import { detonate } from '../../transients/cryo-mine.js';
import { getStats } from '../_stats.js';

const { Bodies, Composite } = Matter;

export default {
  id: 'cryo_mine',
  defaultStats: {
    // lifeMs: how long an un-triggered mine sits before it self-removes.
    lifeMs: 14000,
    // radius: physical sensor footprint (the freeze AOE radius is owned by the
    // transient handler so a chained neighbor freezes identically).
    radius: 16,
  },
  applyRelease(ctx) {
    const s = getStats('cryo_mine');
    const { world, x, y, transientBodies } = ctx;

    const mine = Bodies.circle(x, y, s.radius, {
      isStatic: true, isSensor: true,
      label: 'cryo_mine', render: { visible: false },
    });
    mine.partType = 'cryo_mine';
    mine._verb = ctx._verb || 'cryo_mine';
    mine.bornAt = performance.now();
    mine.lifeMs = s.lifeMs;               // self-removes if buddy never steps on it
    mine._epoch = ctx._epoch;             // epoch-gate any future deferred logic
    mine._armed = true;                   // primed on placement
    Composite.add(world, mine);
    transientBodies.push(mine);

    // Register for chain queries. chainTrigger replays the same AOE freeze the
    // handler runs on direct contact, so a hazard.chain wave freezes outward.
    registerPlacedHazard(mine, {
      kind: 'cryo_mine',
      chainTrigger: (entry, ctx2) => detonate(entry.body, ctx2),
    });

    sfx.cryoArm?.();                      // soft pressurized "set" click
    startCooldown('cryo_mine');
  },
  drawCursor(rctx, { x, y, isDown }) {
    rctx.save();
    rctx.translate(x, y);
    const t = performance.now() * 0.004;

    // Buried-canister body: a squat puck with a frosted dome.
    rctx.fillStyle = '#2a3a40';
    rctx.beginPath();
    rctx.ellipse(0, 3, 11, 5, 0, 0, Math.PI * 2);
    rctx.fill();
    rctx.fillStyle = '#3d5560';
    rctx.beginPath();
    rctx.arc(0, 1, 8, Math.PI, 0);
    rctx.fill();

    // Pressure sensor pip on top, pulsing brighter when armed/pressed.
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    rctx.fillStyle = isDown ? '#e8fbff' : `rgba(155,231,255,${0.5 + pulse * 0.5})`;
    rctx.beginPath();
    rctx.arc(0, -3, isDown ? 3 : 2.2, 0, Math.PI * 2);
    rctx.fill();

    // Frost crystals radiating outward (the cryo tell).
    rctx.strokeStyle = `rgba(155,231,255,${0.55 + pulse * 0.35})`;
    rctx.lineWidth = 1.4;
    rctx.lineCap = 'round';
    const reach = isDown ? 13 : 10;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t;
      const ox = Math.cos(a), oy = Math.sin(a) * 0.6;
      rctx.beginPath();
      rctx.moveTo(ox * 4, oy * 4 - 3);
      rctx.lineTo(ox * reach, oy * reach - 3);
      // tiny barbs
      rctx.moveTo(ox * (reach - 3) - oy * 2, oy * (reach - 3) + ox * 2 - 3);
      rctx.lineTo(ox * (reach - 1), oy * (reach - 1) - 3);
      rctx.stroke();
    }
    rctx.restore();
  },
};
