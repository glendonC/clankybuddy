// Transient body renderer. Pass A4 will split this into per-type modules
// (transients/{treat,gift,bullet,gpu,rocket,fireball,grenade,anvil,firepool}.js)
// owning both their `onHit`/`onExpire` and their `render`. For now everything
// is co-located here so the renderer split can ship independently.

import * as P from '../particles.js';
import { isFinitePart } from './ragdoll.js';

export function renderTransients(ctx, bodies) {
  for (const b of bodies) {
    if (!isFinitePart(b)) continue;
    if (b.partType === 'treat') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#c98a4b';
      ctx.beginPath(); ctx.arc(0, 0, b.circleRadius || 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5b3825';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 3, Math.sin(a) * 3, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (b.partType === 'gift') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#f25c8a';
      ctx.fillRect(-10, -10, 20, 20);
      ctx.fillStyle = '#f2c45c';
      ctx.fillRect(-10, -2, 20, 4); ctx.fillRect(-2, -10, 4, 20);
      ctx.restore();
    } else if (b.partType === 'bullet') {
      // Tracer streak, bright additive line trailing the bullet so it reads
      // against the dark BG. Bullet itself is a tiny hot core.
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      const ang = Math.atan2(b.velocity.y, b.velocity.x);
      ctx.rotate(ang);
      ctx.globalCompositeOperation = 'lighter';
      // outer streak
      ctx.fillStyle = 'rgba(255, 200, 100, 0.5)';
      ctx.fillRect(-14, -1.6, 16, 3.2);
      // mid streak
      ctx.fillStyle = 'rgba(255, 240, 180, 0.85)';
      ctx.fillRect(-10, -1, 12, 2);
      // hot core
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.partType === 'gpu') {
      // green PCB rectangle with two darker chip squares + gold pins
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#0a3d2a';
      ctx.fillRect(-28, -12, 56, 24);
      ctx.fillStyle = '#5cf2a0';
      ctx.fillRect(-26, -10, 52, 20);
      ctx.fillStyle = '#0a3d2a';
      ctx.fillRect(-20, -6, 14, 12);
      ctx.fillRect(  6, -6, 14, 12);
      ctx.fillStyle = '#f2c45c';
      for (let i = -22; i <= 22; i += 4) ctx.fillRect(i, 10, 2, 2);
      ctx.restore();
    } else if (b.partType === 'rocket') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#cfd6e3';
      ctx.fillRect(-9, -3, 14, 6);
      ctx.fillStyle = '#f25c5c';
      ctx.beginPath();
      ctx.moveTo(5, -3); ctx.lineTo(11, 0); ctx.lineTo(5, 3); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#777';
      ctx.fillRect(-9, -5, 4, 2);
      ctx.fillRect(-9,  3, 4, 2);
      ctx.restore();
      // continuous smoke trail emitted from the tail
      const tx = b.position.x - Math.cos(b.angle) * 9;
      const ty = b.position.y - Math.sin(b.angle) * 9;
      if (Math.random() < 0.7) {
        P.spawn({ x: tx, y: ty, vx: -b.velocity.x * 0.05, vy: -b.velocity.y * 0.05,
          type: 'smoke', color: '#888', size: 8, life: 500, gravity: -0.0004, drag: 0.99 });
      }
      if (Math.random() < 0.5) {
        P.spawn({ x: tx, y: ty, vx: 0, vy: 0,
          type: 'fire', color: '#ffae3c', size: 5, life: 200, gravity: -0.001, drag: 0.99 });
      }
    } else if (b.partType === 'fireball') {
      const t = (performance.now() - (b.bornAt || 0)) * 0.02;
      // Continuous trail, fire + spark + smoke at the orb's wake.
      // Direction = opposite of velocity, offset behind the orb.
      const sp = Math.hypot(b.velocity.x, b.velocity.y) || 1;
      const tx = b.position.x - (b.velocity.x / sp) * 6;
      const ty = b.position.y - (b.velocity.y / sp) * 6;
      P.spawn({ x: tx + (Math.random() - 0.5) * 4, y: ty + (Math.random() - 0.5) * 4,
        vx: -b.velocity.x * 0.04 + (Math.random() - 0.5) * 0.1,
        vy: -b.velocity.y * 0.04 + (Math.random() - 0.5) * 0.1,
        type: 'fire', color: ['#fff7c2', '#ffae3c', '#ff6b1a'][Math.floor(Math.random() * 3)],
        size: 6 + Math.random() * 4, life: 300, gravity: -0.0006, drag: 0.96 });
      if (Math.random() < 0.4) {
        P.spawn({ x: tx, y: ty, vx: 0, vy: 0,
          type: 'spark', color: '#ffd266', size: 2, life: 200, gravity: 0, drag: 1 });
      }
      if (Math.random() < 0.5) {
        P.spawn({ x: tx, y: ty, vx: -b.velocity.x * 0.02, vy: -b.velocity.y * 0.02 - 0.05,
          type: 'smoke', color: '#444', size: 6, life: 600, gravity: -0.0004, drag: 0.98 });
      }
      // The orb itself, wobbling additive glow.
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.globalCompositeOperation = 'lighter';
      const r = 14;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
      g.addColorStop(0,   '#fff7c2');
      g.addColorStop(0.4, '#ffae3c');
      g.addColorStop(1,   'rgba(255, 80, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(Math.sin(t) * 1.2, Math.cos(t * 1.3) * 1.2, r, 0, Math.PI * 2); ctx.fill();
      // hot core
      ctx.fillStyle = 'rgba(255, 247, 194, 0.9)';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.partType === 'grenade') {
      const now = performance.now();
      const fuseLeft = (b.fuseAt ?? now) - now;
      const blink = fuseLeft < 600 ? (Math.floor(now / 80) % 2 === 0) : false;
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#1c1f24';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#666';
      ctx.fillRect(-2, -10, 4, 4);
      if (blink) {
        ctx.fillStyle = '#ff5b5b';
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (b.partType === 'anvil') {
      // Server-rack visual (Phase 2 rename, partType key stays `anvil`).
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      // Chassis
      ctx.fillStyle = '#1a1a1d';
      ctx.fillRect(-48, -32, 96, 64);
      // Top trim band
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(-48, -32, 96, 4);
      // 1U slot dividers, horizontal lines across the face
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-44, -22 + i * 14, 88, 1);
      }
      // Status LEDs (green link + amber activity)
      ctx.fillStyle = '#5cf08a';
      ctx.fillRect(38, -18, 3, 3);
      ctx.fillStyle = '#f0c95c';
      ctx.fillRect(38, -10, 3, 3);
      // Subtle highlight along the very top edge
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(-46, -30, 90, 2);
      ctx.restore();
    }
  }
}
