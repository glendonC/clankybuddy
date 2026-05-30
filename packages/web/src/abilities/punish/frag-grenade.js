// @ts-check
// Frag grenade, ordnance. Drag-lob with a 2s fuse like the molotov, but on
// burst it detonates dry (igniteMs:0 — no fire pool) and sprays a radial fan
// of shrapnel (short-lived `bullet` transients) instead. The molotov owns the
// lingering-fire verb; frag owns the shrapnel-cone verb.

import Matter from 'matter-js';
import { explode } from '../_shared.js';
import { getStats } from '../_stats.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  radius:    180,   // blast radius
  baseVel:   13,    // radial fling at blast center
  mood:      22,
  shards:    10,    // shrapnel count
  shardSpeed: 18,
  shardDamage: 3,
};

export default {
  id: 'frag_grenade',
  defaultStats,
  applyRelease(ctx) {
    const s = getStats('frag_grenade');
    const { world, x, y, popBubble, ragdoll, dragVec = { x: 0, y: 0 } } = ctx;
    const dragMag = Math.hypot(dragVec.x, dragVec.y);
    if (dragMag < 24) {
      popBubble(ragdoll.head, 'pull harder!');
      return;
    }
    const k = 0.04;
    const vx = Math.max(-15, Math.min(15, dragVec.x * k));
    const vy = Math.max(-18, Math.min(15, dragVec.y * k - 4));

    const nade = Bodies.circle(x, y, 7, {
      frictionAir: 0.01, friction: 0.5, density: 0.0025, restitution: 0.4,
      label: 'grenade', render: { visible: false },
    });
    nade.partType = 'grenade';
    nade._verb = ctx._verb || 'frag_grenade';
    nade.bornAt = performance.now();
    nade.fuseAt = nade.bornAt + 2000;
    nade.lifeMs = 2100;
    Body.setVelocity(nade, { x: vx, y: vy });
    Body.setAngularVelocity(nade, (Math.random() - 0.5) * 0.2);
    nade.onExpire = (b, ctx2) => {
      // Dry blast (no fire pool) ...
      explode(ctx2, b.position.x, b.position.y, {
        radius: s.radius, baseVel: s.baseVel, upBias: 4, moodDelta: -s.mood,
        stunMs: 1000, shake: 16, igniteMs: 0, sound: 'bomb', limpMs: 600,
      });
      // ... then a radial fan of shrapnel.
      const bx = b.position.x, by = b.position.y;
      for (let i = 0; i < s.shards; i++) {
        const a = (i / s.shards) * Math.PI * 2 + Math.random() * 0.2;
        const shard = Bodies.circle(bx + Math.cos(a) * 10, by + Math.sin(a) * 10, 2.5, {
          frictionAir: 0, friction: 0, density: 0.003, restitution: 0.05,
          label: 'bullet', render: { visible: false },
        });
        shard.partType = 'bullet';
        shard._verb = 'frag_grenade';
        shard.bornAt = performance.now();
        shard.lifeMs = 500;
        shard.bulletDamage = s.shardDamage;
        shard.bulletStun = 0;
        Body.setVelocity(shard, { x: Math.cos(a) * s.shardSpeed, y: Math.sin(a) * s.shardSpeed });
        Composite.add(ctx2.world, shard);
        ctx2.transientBodies.push(shard);
      }
    };
    Composite.add(world, nade);
    ctx.transientBodies.push(nade);
  },
  drawCursor(ctx, { x, y, isDown, dragStart, gravityY = 1.4 }) {
    ctx.save();
    ctx.translate(x, y);
    // Pineapple-grooved frag body.
    ctx.fillStyle = '#2f3b2a';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1c241a';
    ctx.lineWidth = 1;
    for (let gx = -6; gx <= 6; gx += 3) { ctx.beginPath(); ctx.moveTo(gx, -7); ctx.lineTo(gx, 7); ctx.stroke(); }
    for (let gy = -6; gy <= 6; gy += 3) { ctx.beginPath(); ctx.moveTo(-7, gy); ctx.lineTo(7, gy); ctx.stroke(); }
    ctx.fillStyle = '#888';
    ctx.fillRect(-2, -11, 4, 4);
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
    ctx.fillStyle = 'rgba(120, 200, 120, 0.55)';
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
    ctx.strokeStyle = 'rgba(120, 200, 120, 0.4)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};
