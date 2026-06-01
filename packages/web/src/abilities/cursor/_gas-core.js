// Gas-cloud factory. Four variant tools (base / tear / chlorine / cryo) share
// one placement + drawCursor; only their id, tint, and choke payload differ.
//
// CRITICAL (STATS keying): resetStats() keys STATS by mod.id (_stats.js), so the
// four variants MUST export DISTINCT ids — a single shared-id module under four
// SOURCES keys would silently collapse to ONE STATS slot. Each variant module is
// `export default makeGasCloud('<variant>')` carrying its own id + defaultStats.
//
// Placement mirrors cryo-mine.js exactly (kind:'drag', applyRelease drops a
// static sensor at the release point; lifeMs owns removal; registerPlacedHazard
// holds only a chain-query ref, pruned lazily off the buddy epoch). The dwell /
// choke logic lives in the transient handler (transients/gas-cloud.js); this
// only spawns + tags the sensor body.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { registerPlacedHazard } from '../../state/hazard-field.js';
import { detonate } from '../../transients/gas-cloud.js';
import { getStats } from '../_stats.js';

const { Bodies, Composite } = Matter;

// Per-variant tint as an "r,g,b" string (rgba-ready; shared by the cursor, the
// cloud render branch, and the choking status overlay via rec.data.rgb).
export const GAS_TINT = {
  base:     '155,206,106',   // sickly green
  tear:     '180,214,120',   // pale irritant green
  chlorine: '200,212,74',    // yellow-green
  cryo:     '155,231,255',   // pale blue
};

const VARIANT_ID = {
  base: 'gas_cloud', tear: 'tear_gas', chlorine: 'chlorine', cryo: 'cryo_fog',
};

function defaultStatsFor(variant) {
  // radius = sensor footprint; lifeMs = how long the cloud lingers; chokeMs =
  // per-stamp choking duration; chokeIntensity = starting intensity; dwellPasses
  // (cryo only) = debounced passes before the limb also freezes.
  const base = { radius: 70, lifeMs: 9000, chokeMs: 2200, chokeIntensity: 1, variant };
  if (variant === 'chlorine') return { ...base, chokeMs: 3200 };
  if (variant === 'cryo')     return { ...base, dwellPasses: 2 };
  return base;
}

export function makeGasCloud(variant) {
  const id = VARIANT_ID[variant];
  const rgb = GAS_TINT[variant];
  return {
    id,
    defaultStats: defaultStatsFor(variant),
    applyRelease(ctx) {
      const s = getStats(id);
      const { world, x, y, transientBodies } = ctx;

      // The cloud MUST generate collision pairs so its onContact fires the choke,
      // so (unlike the subwoofer's mask:0 render-only marker) it can't opt out of
      // collisions. KNOWN LIMITATION: isGrounded() (physics/stand.js) doesn't
      // filter sensor pairs, so a cloud dropped MID-AIR briefly reads the
      // overlapping buddy as "grounded" and the stand pose lifts it. Harmless (no
      // NaN; the choking stun drops the pose anyway for base/chlorine/cryo) and
      // matches every existing placed-sensor trap. The clean fix (skip sensor
      // pairs in isGrounded) also moves isStanding(), which the force Modes rely
      // on, so it's deferred to a dedicated pass rather than smuggled in here.
      const cloud = Bodies.circle(x, y, s.radius, {
        isStatic: true, isSensor: true,
        label: 'gas_cloud', render: { visible: false },
      });
      cloud.partType = 'gas_cloud';
      cloud._verb = ctx._verb || id;
      cloud.bornAt = performance.now();
      cloud.lifeMs = s.lifeMs;               // self-removes after it disperses
      cloud._epoch = ctx._epoch;             // epoch-gate any future deferred logic
      cloud._radius = s.radius;
      cloud._variant = s.variant;
      cloud._chokeMs = s.chokeMs;
      cloud._chokeIntensity = s.chokeIntensity ?? 1;
      cloud._dwellPasses = s.dwellPasses ?? 2;
      cloud._rgb = rgb;
      Composite.add(world, cloud);
      transientBodies.push(cloud);

      // Chain-query registration (family consistency: every hazard trap chains).
      // A chained cloud re-stamps choking on overlapping parts via detonate().
      registerPlacedHazard(cloud, {
        kind: 'gas_cloud',
        chainTrigger: (entry, ctx2) => detonate(entry.body, ctx2),
      });

      sfx.gasCloud?.();
      startCooldown(id);
    },
    drawCursor(rctx, { x, y, isDown }) {
      const t = performance.now() * 0.002;
      rctx.save();
      rctx.translate(x, y);

      // Dashed AOE footprint (the radius the cloud will cover).
      rctx.strokeStyle = `rgba(${rgb}, ${isDown ? 0.5 : 0.32})`;
      rctx.setLineDash([5, 5]);
      rctx.lineWidth = 1.4;
      rctx.beginPath(); rctx.arc(0, 0, 70, 0, Math.PI * 2); rctx.stroke();
      rctx.setLineDash([]);

      // Drifting wisps inside the footprint.
      rctx.fillStyle = `rgba(${rgb}, 0.18)`;
      for (let i = 0; i < 4; i++) {
        const a = t + i * 1.7;
        const wx = Math.cos(a) * 22, wy = Math.sin(a * 0.8) * 14;
        rctx.beginPath(); rctx.arc(wx, wy, 12 + Math.sin(a * 2) * 3, 0, Math.PI * 2); rctx.fill();
      }

      // Gas canister glyph at the cursor.
      rctx.fillStyle = '#3a4640';
      rctx.beginPath();
      rctx.moveTo(-4, -8); rctx.lineTo(4, -8); rctx.lineTo(5, 9); rctx.lineTo(-5, 9); rctx.closePath();
      rctx.fill();
      rctx.fillStyle = '#5a6a60';
      rctx.fillRect(-3, -11, 6, 3);                     // valve
      rctx.fillStyle = `rgb(${rgb})`;
      rctx.fillRect(-4, -2, 8, 3);                      // hazard band
      rctx.restore();
    },
  };
}
