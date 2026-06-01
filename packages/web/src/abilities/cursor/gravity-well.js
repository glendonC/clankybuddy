// Gravity well — hazard-group placement tool (kind:'drag', like every sibling
// placed hazard: landmine / electrified_panel / cryo_mine / gas_cloud). Drop a
// sustained inward SINK that drags every nearby part toward one fixed point —
// pure pull, it never throws (the opposite of the magnet's live-cursor tractor).
//
// The actual physics is a phase:'physics' force Mode (modes/force-gravity-well.js)
// so the pull integrates in the 60Hz inner loop. This ability only PLACES the
// well: a render.visible:false isSensor transient body (the cryo_mine pattern) so
// its lifeMs auto-expiry + epoch-wipe + render all come free from
// transients/index.js's cleanupTransients + spawnRagdoll + render/transients.js.
// Placing a new well removes any prior one (SINGLE WELL — the per-well force
// clamp is the whole NaN firewall, and overlapping wells would sum past it).
//
// COLLAPSE fork (s.collapse, the "Collapse" statNode): when the well's life ends
// it caves in — one inward velocity burst that slams every in-range part to the
// center. Lives in the body's onExpire (the canonical end-of-life hook, fired by
// cleanupTransients; epoch-guarded so it never crushes a swapped-in buddy). NOT
// a bigImpact — bigImpact is an OUTWARD blast, the wrong sign for an inward crush.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { stun, goLimp } from '../../physics/stand.js';
import { getStats } from '../_stats.js';
import { setEnabled } from '../../modes/bus.js';
import { FORCE_GRAVITY_WELL_ID, activeWellBodies } from '../../modes/force-gravity-well.js';

const { Bodies, Composite, Body } = Matter;

// Physical footprint of the placed marker (small — the FORCE reach is s.range,
// not this). Kept tiny so the false-grounding window (isGrounded doesn't filter
// sensor pairs yet) is a few px around dead center, where the +y-down lift-cancel
// is harmless anyway.
const SENSOR_R = 14;
// Inward velocity (px/step) at the well center on collapse, falling off to the
// edge. In bigImpact's proven-safe 14-28 band.
const COLLAPSE_VEL = 18;

// End-of-life implosion. Mirrors bigImpact's inner loop but INWARD (toward the
// well), so the parts converge on the center instead of being flung outward.
function collapse(self, ctx) {
  if (!ctx?._epochValid?.(self._epoch)) return;   // never crush a swapped-in buddy
  const ragdoll = ctx.ragdoll;
  if (!ragdoll || !ragdoll.parts) return;
  const range = Number.isFinite(self._range) ? self._range : 280;
  const wx = self.position.x, wy = self.position.y;
  let any = false;
  for (const p of ragdoll.parts) {
    const dx = wx - p.position.x, dy = wy - p.position.y;   // INWARD: part → center
    const d = Math.hypot(dx, dy);
    if (d > range || d < 1e-3) continue;
    const falloff = 1 - d / range;                  // stronger near the center
    const nx = dx / d, ny = dy / d;
    const v = COLLAPSE_VEL * falloff;
    Body.setVelocity(p, { x: p.velocity.x + nx * v, y: p.velocity.y + ny * v });
    Body.setAngularVelocity(p, p.angularVelocity + (Math.random() - 0.5) * 0.4 * falloff);
    any = true;
  }
  if (!any) return;
  // Loosen the joints + briefly stun so the inward velocity actually converges
  // instead of being immediately fought by the stand pose.
  stun(ragdoll, 700);
  goLimp(ragdoll, 600);
  ctx.screenShake?.(20, 420);
  ctx.hitStop?.explosion?.();
  ctx.reactTo?.({ source: 'gravity_well', part: ragdoll.head, moodDelta: -16 });
  sfx.gravityWellCollapse?.();
}

export default {
  id: 'gravity_well',
  // Tuning the force Mode reads via getStats('gravity_well').
  defaultStats: {
    range:   280,    // inward-pull reach in px
    pull:    0.006,  // force-per-mass at the center (pre-soften)
    soften:  0.004,  // 1/(1 + dist*soften) falloff
    maxPull: 0.012,  // hard ceiling on |force-per-mass| (the NaN firewall)
    lifeMs:  7000,   // how long the well sinks before it expires (+ collapse)
  },

  applyRelease(ctx) {
    const s = getStats('gravity_well');
    const { world, x, y, transientBodies } = ctx;

    // SINGLE WELL: remove any prior live well first (no collapse on a replace).
    for (const prev of activeWellBodies(transientBodies)) {
      prev._spent = true;
      Composite.remove(world, prev);
      const i = transientBodies.indexOf(prev);
      if (i >= 0) transientBodies.splice(i, 1);
    }

    const well = Bodies.circle(x, y, SENSOR_R, {
      isStatic: true, isSensor: true,
      label: 'gravity_well', render: { visible: false },
    });
    well.partType = 'gravity_well';
    well._verb = ctx._verb || 'gravity_well';
    well.bornAt = performance.now();
    well.lifeMs = Number.isFinite(s.lifeMs) ? s.lifeMs : 7000;
    well._epoch = ctx._epoch;                 // epoch-gate the collapse onExpire
    well._range = Number.isFinite(s.range) ? s.range : 280;  // collapse reach
    if (s.collapse) well.onExpire = collapse; // only wired when the fork is owned

    Composite.add(world, well);
    transientBodies.push(well);

    // Flip the force Mode on; it self-disables once no live wells remain.
    setEnabled(FORCE_GRAVITY_WELL_ID, true, ctx);
    sfx.gravityWell?.();
    startCooldown('gravity_well');
  },

  // Concentric inward-pointing chevrons converging on the placement point — a
  // telegraph that this is a pull center, not a blast.
  drawCursor(c, { x, y, isDown }) {
    c.save();
    c.translate(x, y);
    const t = performance.now() * 0.003;
    // Dark dimple core.
    c.fillStyle = isDown ? 'rgba(90,60,140,0.9)' : 'rgba(70,50,110,0.7)';
    c.beginPath();
    c.arc(0, 0, 4, 0, Math.PI * 2);
    c.fill();
    // Inward-pulsing arrow rings.
    const rings = isDown ? 3 : 2;
    c.strokeStyle = isDown ? 'rgba(167,139,250,0.85)' : 'rgba(167,139,250,0.55)';
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    for (let r = 0; r < rings; r++) {
      const rad = 22 - ((t * 8 + r * 7) % 18);   // collapse inward over time
      if (rad < 5) continue;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.5;
        const ax = Math.cos(a), ay = Math.sin(a);
        // a tiny chevron pointing toward the center
        c.beginPath();
        c.moveTo(ax * rad - ay * 3, ay * rad + ax * 3);
        c.lineTo(ax * (rad - 4), ay * (rad - 4));
        c.lineTo(ax * rad + ay * 3, ay * rad - ax * 3);
        c.stroke();
      }
    }
    c.restore();
  },
};
