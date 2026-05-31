// Buzzsaw wall — hazard group. Places a wall-mounted spinning blade at the
// cursor. The blade is a static sensor (it does not fall, does not sweep): it
// sits where you drop it and BITES any ragdoll part driven into the disc. The
// hit is contact-driven (Pattern-2 onContact in transients/buzzsaw-wall.js), an
// impulse-lane bite that stacks BLEED — the full mechanic + the rotating-blade
// render live in that transient module. This ability only spawns the sensor and
// wires it into the placed-hazard registry so hazard.chain can find it.
//
// The shared `hazard` family flags (hazard.chain / hazard.rearm, flipped by a
// sharedNode in progression/groups/manipulation.js, never per-tool scalars)
// modify every placed trap including this one; see state/hazard-field.js.
//
// kind:'click' — places at the click point. (Integration: the TOOLS row sets
// kind; click vs drag is purely how input/mouse.js dispatches apply vs
// applyRelease. We expose apply() so a 'click' row works out of the box.)

import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { registerPlacedHazard } from '../../state/hazard-field.js';
import { spawnBuzzsawWall, detonate } from '../../transients/buzzsaw-wall.js';

export default {
  id: 'buzzsaw_wall',
  // chain/rearm are FAMILY flags (getFamilyStats('hazard')), not per-tool stats.
  // Per-tool knobs: self-expiry lifetime + the BLEED duration each bite stamps.
  defaultStats: { lifeMs: 12000, bleedMs: 6000 },
  apply(ctx) {
    const { world, x, y, transientBodies } = ctx;
    const s = getStats('buzzsaw_wall');   // read INSIDE apply — live ES binding, no cycle

    const saw = spawnBuzzsawWall(world, transientBodies, x, y, s.lifeMs);
    saw._verb = ctx._verb || 'buzzsaw_wall';
    saw._bleedMs = s.bleedMs;

    // Register for chain queries AFTER partType is set and the body is pushed to
    // transientBodies (registry holds a ref only; transients/index.js + the
    // spawnRagdoll wipe own the Matter body lifetime). chainTrigger replays the
    // SAME bite a direct contact would, against the nearest part. The buzzsaw is
    // a persistent grinder (not single-use), so we never unregister/force-expire
    // here — lifeMs + multiContact own its lifetime.
    registerPlacedHazard(saw, {
      kind: 'buzzsaw',
      chainTrigger: (entry, ctx2) => detonate(entry?.body, ctx2),
    });

    sfx.buzzsaw?.();           // shrill saw whine on placement (spin-up)
    startCooldown('buzzsaw_wall');
  },
  drawCursor(rctx, { x, y }) {
    // Mounted spinning-blade glyph: disc + radial teeth + hub, spinning so the
    // preview matches the placed look.
    const r = 16;
    const ang = (performance.now() * 0.006) % (Math.PI * 2);
    rctx.save();
    rctx.translate(x, y);
    rctx.fillStyle = 'rgba(42,45,51,0.85)';   // mount plate
    rctx.beginPath(); rctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); rctx.fill();
    rctx.rotate(ang);
    rctx.fillStyle = '#b8c0c8';
    rctx.beginPath(); rctx.arc(0, 0, r, 0, Math.PI * 2); rctx.fill();
    rctx.fillStyle = '#dfe6ec';
    const teeth = 14;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      rctx.beginPath();
      rctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      rctx.lineTo(Math.cos(a + 0.16) * (r + 3), Math.sin(a + 0.16) * (r + 3));
      rctx.lineTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
      rctx.closePath(); rctx.fill();
    }
    rctx.fillStyle = '#3a3f47';
    rctx.beginPath(); rctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); rctx.fill();
    rctx.restore();
  },
};
