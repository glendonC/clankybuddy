// Flash-freeze grenade — corruption/cryogenics line (rooted under the freeze
// node in the manipulation group). A cryo grenade LOBBED like the frag /
// molotov / acid flask (kind:'drag'): drag-back sets the throw arc, release on
// mouseup. On landing it bursts a radial CRYO AOE — NO fire, NO blast: it
// applies persistent `frozen` (=> brittle) to every ragdoll part inside the
// burst radius, gently arrests their motion, and throws a frost-burst.
//
// explode() only does fire/impact and never applies frozen, so the AOE freeze
// is done by hand here in the detonation closure (loop parts, distance-gate,
// applyStatus 'frozen'). No setTimeout touches the ragdoll — the collision
// handler in main.js + cleanupTransients fire onHit/onExpire for us — so no
// _epoch capture / _epochValid guard is needed on the lob path.
//
// Grounded real-world item; no AI in-jokes. SFX: a sharp icy crack/whoomph on
// the burst (reusing the existing cryoMine voice — pressurized gas hiss +
// crystallize chirp + ice crackle).

import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { applyStatus } from '../../effects/registry.js';
import { getStats } from '../_stats.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  radius:    150,   // cryo-burst AOE radius (frozen applied to parts within)
  arrest:    0.55,  // velocity-damp factor on parts caught in the burst (0..1)
  moodPerHit: 5,    // mood hit per frozen part on burst (positive; subtracted)
  lifeMs:    2100,  // transient lifetime ceiling
  fuseMs:    2000,  // airburst fuse (matches grenade) — bursts even mid-air
};

// Detonate the cryo burst: paint persistent `frozen` on every part inside the
// radius, gently arrest its velocity, frost-burst particles, icy crack. Reads
// tunables stashed on the body so the closure never re-enters getStats from a
// transient-rebuilt ctx (acid-flask pattern). Shared by the fuse (onExpire) and
// any future contact path.
function burst(b, ctx2) {
  const bx = b.position.x, by = b.position.y;
  const radius = b._radius ?? 150;
  const arrest = b._arrest ?? 0.55;
  const moodPerHit = b._moodPerHit ?? 5;
  const verb = b._verb || 'flash_freeze';

  let frozenCount = 0;
  let headHit = false;
  for (const p of ctx2.ragdoll.parts) {
    const dx = p.position.x - bx, dy = p.position.y - by;
    if (Math.hypot(dx, dy) > radius) continue;
    // Persistent + idempotent: re-applying preserves startedAt. frozen sets
    // part.brittle = true so the next impact/shatter weapon gets the payoff.
    applyStatus(ctx2.status, p, 'frozen', { source: verb });
    // Flash-freeze ARRESTS motion — scale velocity down hard, kill spin.
    Body.setVelocity(p, { x: p.velocity.x * (1 - arrest), y: p.velocity.y * (1 - arrest) });
    Body.setAngularVelocity(p, p.angularVelocity * (1 - arrest));
    frozenCount++;
    if (p === ctx2.ragdoll.head) headHit = true;
  }

  if (frozenCount) {
    // One mood reaction off the head (or any single part) so a multi-part
    // burst doesn't spam speech — bigImpact discipline.
    const headPart = headHit ? ctx2.ragdoll.head : ctx2.ragdoll.parts[0];
    ctx2.reactTo?.({ source: verb, part: headPart, moodDelta: -moodPerHit, speakMs: 700 });
  }

  // Frost-burst: an expanding ring of ice shards + a cold-vapor puff.
  P.burst(bx, by, 28, { type: 'ice',   color: '#9be7ff', size: 7, life: 650, speedRange: 1.6, gravity: 0.0003 });
  P.burst(bx, by, 14, { type: 'ice',   color: '#e8fbff', size: 4, life: 480, speedRange: 1.2, gravity: 0.0002 });
  P.burst(bx, by, 10, { type: 'smoke', color: '#cdeef5', size: 14, life: 800, speedRange: 0.5, gravity: -0.0005 });

  // Sharp icy crack/whoomph (existing cryo voice), with a freeze chirp fallback.
  if (sfx.cryoMine) sfx.cryoMine();
  else sfx.freeze?.();
  ctx2.screenShake?.(7, 180);
  ctx2.hitStop?.light?.();
}

export default {
  id: 'flash_freeze',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('flash_freeze');
    const { world, x, y, popBubble, ragdoll, transientBodies, dragVec = { x: 0, y: 0 } } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 24) {
      popBubble(ragdoll.head, 'pull harder!');
      return;
    }
    // Same lob ballistics as grenade.js / acid-flask.js (k=0.04 with clamps + an
    // up-bias so a flat drag still arcs).
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dragVec.x * k));
    const vy = Math.max(-18, Math.min(15, dragVec.y * k - 4));

    const nade = Bodies.circle(x, y, 8, {
      frictionAir: 0.01, friction: 0.5, density: 0.0025, restitution: 0.35,
      label: 'flash_freeze', render: { visible: false },
    });
    nade.partType = 'flash_freeze_proj';   // integrator wires this partType in transients/index.js
    nade._verb = ctx._verb || 'flash_freeze';
    nade.bornAt = performance.now();
    nade.fuseAt = nade.bornAt + s.fuseMs;  // airburst fuse — freezes even mid-air
    nade.lifeMs = s.lifeMs;
    // Stash tunables so the detonation closure doesn't re-enter getStats from a
    // transient ctx.
    nade._radius = s.radius;
    nade._arrest = s.arrest;
    nade._moodPerHit = s.moodPerHit;
    Body.setVelocity(nade, { x: vx, y: vy });
    Body.setAngularVelocity(nade, (Math.random() - 0.5) * 0.2);
    // Bursts on fuse expiry. (A contact-burst onHit could be added once the
    // integrator wires the partType; fuse covers the baseline lob.)
    nade.onExpire = (b, ctx2) => burst(b, ctx2);
    Composite.add(world, nade);
    transientBodies.push(nade);
    sfx.cryoArm?.();   // pressurized "thunk" as the pin pulls
  },

  drawCursor(ctx, { x, y, isDown, dragStart, gravityY = 1.4 }) {
    // Hand-held cryo grenade at the cursor: frosted steel canister + icy cap.
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3d5560';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9be7ff';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cdeef5';
    ctx.fillRect(-2, -11, 4, 4);   // safety lever / cap
    ctx.restore();

    if (!isDown || !dragStart) return;
    const dx = x - dragStart.x;
    const dy = y - dragStart.y;
    if (Math.hypot(dx, dy) < 24) return;
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dx * k));
    const vy = Math.max(-18, Math.min(15, dy * k - 4));
    const a = gravityY * 0.001 * (1000 / 16);
    ctx.save();
    ctx.fillStyle = 'rgba(155, 231, 255, 0.55)';   // cyan cryo arc (vs grenade's red)
    for (let step = 1; step <= 26; step++) {
      const t = step * 60;
      const px = dragStart.x + vx * t;
      const py = dragStart.y + vy * t + 0.5 * a * t * t * 0.0001 * 60;
      if (step % 2 === 0) {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (py > 4000) break;
    }
    ctx.strokeStyle = 'rgba(155, 231, 255, 0.4)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};
