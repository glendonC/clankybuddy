// Flashbang, ordnance. Drag to lob (grenade lob math), 2s fuse. On burst it
// flashes white, gives a low concussive shove, and leaves every part in range
// CONCUSSED — the first RANGED concussed applicator, so the next hit lands x1.5.
// Reuses partType:'grenade' for the existing grenade render + accelerating fuse beep.
//
// ORDER MATTERS: bigImpact runs BEFORE the concuss loop. bigImpact internally
// consumes CONCUSSED for its own x1.5; concussing first would eat the buff it
// just applied. bigImpact-then-concuss leaves the buff intact for the player's
// follow-up — the whole point of the verb.

import Matter from 'matter-js';
import { sfx } from '../../audio/sfx.js';
import { applyStatus } from '../../effects/registry.js';
import { showFlash } from '../../ui/overlays.js';
import { getStats } from '../_stats.js';
import { bigImpact } from '../_shared.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  radius:    220,
  baseVel:   4,       // concussive shove, not lethal
  mood:      10,
  concussMs: 1500,
};

export default {
  id: 'flashbang',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('flashbang');
    const { world, x, y, popBubble, ragdoll, dragVec = { x: 0, y: 0 } } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 24) {
      popBubble(ragdoll.head, 'pull harder!');
      return;
    }
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dragVec.x * k));
    const vy = Math.max(-18, Math.min(15, dragVec.y * k - 4));

    const nade = Bodies.circle(x, y, 8, {
      frictionAir: 0.01, friction: 0.5, density: 0.0025, restitution: 0.4,
      label: 'grenade', render: { visible: false },
    });
    nade.partType = 'grenade';
    nade._verb = ctx._verb || 'flashbang';
    nade.bornAt = performance.now();
    nade.fuseAt = nade.bornAt + 2000;
    nade.lifeMs = 2100;
    Body.setVelocity(nade, { x: vx, y: vy });
    Body.setAngularVelocity(nade, (Math.random() - 0.5) * 0.2);
    nade.onExpire = (b, ctx2) => {
      const bx = b.position.x, by = b.position.y;
      showFlash('#ffffff', 120, 0.9);
      sfx.flashbang();
      // Low concussive shove FIRST (consumes nothing — nothing is concussed yet).
      bigImpact(ctx2, bx, by, {
        radius: s.radius, baseVel: s.baseVel, upBias: 2, moodDelta: -s.mood,
        stunMs: 600, igniteMs: 0, shake: 8, sound: null, limpMs: 300,
      });
      // THEN concuss every part in range — the buff survives for the next hit.
      for (const p of ctx2.ragdoll.parts) {
        const dx = p.position.x - bx, dy = p.position.y - by;
        if (Math.hypot(dx, dy) <= s.radius) {
          applyStatus(ctx2.status, p, 'concussed', { duration: s.concussMs, source: 'flashbang' });
        }
      }
    };
    Composite.add(world, nade);
    ctx.transientBodies.push(nade);
  },
  drawCursor(ctx, { x, y, isDown, dragStart, gravityY = 1.4 }) {
    // Held flashbang canister (white-grey stun-grenade body).
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#cfd3d8';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a9099';
    ctx.fillRect(-7, -2, 14, 2);
    ctx.fillStyle = '#666'; ctx.fillRect(-2, -10, 4, 4);
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
    ctx.fillStyle = 'rgba(220, 230, 240, 0.6)';
    for (let step = 1; step <= 26; step++) {
      const t = step * 60;
      const px = dragStart.x + vx * t;
      const py = dragStart.y + vy * t + 0.5 * a * t * t * 0.0001 * 60;
      if (step % 2 === 0) { ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill(); }
      if (py > 4000) break;
    }
    ctx.strokeStyle = 'rgba(220, 230, 240, 0.4)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(dragStart.x, dragStart.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};
