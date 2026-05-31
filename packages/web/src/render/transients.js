// Transient body renderer. Pass A4 will split this into per-type modules
// (transients/{treat,gift,bullet,rocket,fireball,grenade,anvil,firepool}.js)
// owning both their `onHit`/`onExpire` and their `render`. For now everything
// is co-located here so the renderer split can ship independently.

import * as P from '../particles.js';
import { isFinitePart } from './ragdoll.js';
import { renderBuzzsaw } from '../transients/buzzsaw-wall.js';

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
      // Real anvil: tapered horn, top face, narrow waist, splayed base.
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#26262b';
      // Top face + horn (point to the right).
      ctx.beginPath();
      ctx.moveTo(-46, -24); ctx.lineTo(34, -24); ctx.lineTo(48, -14);
      ctx.lineTo(34, -8);  ctx.lineTo(20, -8);  ctx.lineTo(20, 0);
      ctx.lineTo(-30, 0);  ctx.lineTo(-30, -8); ctx.lineTo(-46, -8);
      ctx.closePath(); ctx.fill();
      // Waist + base.
      ctx.beginPath();
      ctx.moveTo(-22, 0); ctx.lineTo(12, 0); ctx.lineTo(26, 26); ctx.lineTo(-36, 26);
      ctx.closePath(); ctx.fill();
      // Top-edge highlight.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(-46, -24, 80, 3);
      ctx.restore();
    } else if (b.partType === 'brick') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#9c4a32';
      ctx.fillRect(-17, -10, 34, 20);
      ctx.fillStyle = '#7a3826';
      ctx.fillRect(-17, -1, 34, 1.6);
      ctx.fillRect(-1, -10, 1.6, 9); ctx.fillRect(-9, 0.6, 1.6, 9); ctx.fillRect(7, 0.6, 1.6, 9);
      ctx.restore();
    } else if (b.partType === 'bowling_ball') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#16161a';
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a3a42';
      ctx.beginPath(); ctx.arc(-4, -3, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 2, -4, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-1,  2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.arc(-6, -7, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.partType === 'piano') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#241a12';
      ctx.fillRect(-75, -44, 150, 88);
      ctx.fillStyle = '#3a2c1e';
      ctx.fillRect(-75, -44, 150, 7);
      // Ivory keybed near the bottom.
      ctx.fillStyle = '#efe7d2';
      ctx.fillRect(-70, 24, 140, 14);
      ctx.fillStyle = '#1a1a1a';
      for (let kx = -66; kx < 70; kx += 9) ctx.fillRect(kx, 24, 3, 8);
      ctx.restore();
    } else if (b.partType === 'crt') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#cbc4b0'; ctx.fillRect(-48, -42, 96, 84);          // beige case
      ctx.fillStyle = '#11151a'; ctx.fillRect(-40, -34, 80, 60);          // bezel
      ctx.fillStyle = 'rgba(127,233,255,0.30)'; ctx.fillRect(-36, -30, 72, 52); // phosphor screen
      ctx.fillStyle = '#7fffa0'; ctx.fillRect(34, 30, 4, 4);              // power LED
      ctx.restore();
    } else if (b.partType === 'car') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#3a4654'; ctx.fillRect(-100, -22, 200, 44);        // chassis
      ctx.fillStyle = '#4a5867'; ctx.fillRect(-52, -48, 96, 28);          // cabin
      ctx.fillStyle = '#1c2730'; ctx.fillRect(-46, -44, 40, 20); ctx.fillRect(8, -44, 40, 20); // windows
      ctx.fillStyle = '#141418';
      ctx.beginPath(); ctx.arc(-58, 24, 18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 58, 24, 18, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.partType === 'steamroller') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#3b3b40'; ctx.fillRect(-65, -37, 130, 50);         // frame
      ctx.fillStyle = '#52525a'; ctx.fillRect(0, -55, 44, 24);            // cab
      ctx.fillStyle = '#1f1f24';
      ctx.beginPath(); ctx.arc(-40, 18, 30, 0, Math.PI * 2); ctx.fill();  // front drum
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.arc(-48, 8, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#26262b';
      ctx.beginPath(); ctx.arc(46, 24, 18, 0, Math.PI * 2); ctx.fill();   // rear wheel
      ctx.restore();
    } else if (b.partType === 'city_bus') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#e0a92b'; ctx.fillRect(-110, -43, 220, 86);        // body
      ctx.fillStyle = '#9fd3e8';
      for (let wx = -96; wx < 100; wx += 28) ctx.fillRect(wx, -30, 20, 22); // window strip
      ctx.fillStyle = '#3a3a40'; ctx.fillRect(-118, 6, 12, 24);           // front scoop bumper
      ctx.fillStyle = '#1f1f24';
      ctx.beginPath(); ctx.arc(-64, 40, 18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 70, 40, 18, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.partType === 'trebuchet') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#4a4036';
      ctx.beginPath(); ctx.arc(0, 0, b.circleRadius || 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5c5044';
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(3, -11); ctx.lineTo(0, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(-6, -8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (b.partType === 'office_chair') {
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#2b2f36'; ctx.fillRect(-23, -4, 46, 12);           // seat
      ctx.fillStyle = '#3a4049'; ctx.fillRect(-20, -26, 12, 24);          // backrest
      ctx.fillStyle = '#1c1f24'; ctx.fillRect(-2, 8, 4, 10);              // gas column
      ctx.beginPath(); ctx.arc(-12, 22, 3, 0, Math.PI * 2); ctx.fill();   // casters
      ctx.beginPath(); ctx.arc(12, 22, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

    // ── Placed hazards (sensor bodies, render.visible:false — drawn here) ──
    } else if (b.partType === 'buzzsaw') {
      renderBuzzsaw(ctx, b, performance.now());

    } else if (b.partType === 'landmine') {
      // Buried pressure-plate: a small domed charge on the floor. Dim + cool
      // pip when disarmed (rearm spin-down), warm armed pip otherwise.
      const armed = b._armed !== false;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.globalAlpha = armed ? 0.95 : 0.5;
      ctx.fillStyle = '#3a3f3a';
      ctx.beginPath();
      ctx.arc(0, 1, 9, Math.PI, 0);
      ctx.lineTo(9, 4); ctx.lineTo(-9, 4); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1d1f1d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
      ctx.fillStyle = armed ? '#ffcf4d' : '#7a6a3a';
      ctx.beginPath(); ctx.arc(0, -3, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

    } else if (b.partType === 'cryo_mine') {
      // Buried cryo charge: a frosted dome with a pulsing blue prime pip.
      const armed = b._armed !== false;
      const r = b.circleRadius || 16;
      const pulse = armed ? 0.5 + 0.5 * Math.abs(Math.sin(performance.now() * 0.004)) : 0;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.globalAlpha = armed ? 0.9 : 0.45;
      ctx.fillStyle = '#2a3a40';
      ctx.beginPath(); ctx.arc(0, 1, r * 0.6, Math.PI, 0);
      ctx.lineTo(r * 0.6, 4); ctx.lineTo(-r * 0.6, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3d5560';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = armed ? `rgba(155,231,255,${0.5 + pulse * 0.5})` : 'rgba(110,150,165,0.6)';
      ctx.beginPath(); ctx.arc(0, -2, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

    } else if (b.partType === 'electrified_panel') {
      // Live sensor plate: a metal strip on the floor with two terminals and a
      // jittering arc between them.
      const w = b._width || 60;
      const h = b._height || 10;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.fillStyle = '#3a4049';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#cfd8e3';
      ctx.fillRect(-w / 2 + 3, -h / 2 - 3, 4, 4);
      ctx.fillRect(w / 2 - 7, -h / 2 - 3, 4, 4);
      // jittered live-wire arc
      ctx.strokeStyle = '#9be7ff';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() * 0.02));
      ctx.beginPath();
      const x0 = -w / 2 + 5, x1 = w / 2 - 5, ay = -h / 2 - 2;
      ctx.moveTo(x0, ay);
      const segs = 6;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        ctx.lineTo(x0 + (x1 - x0) * t, ay - (Math.random() - 0.5) * 6);
      }
      ctx.stroke();
      ctx.restore();

    // ── cannon-and-mortar batch projectiles (render.visible:false → drawn here) ──
    } else if (b.partType === 'cannonball') {
      // Cannon + hot shot share this. b._heated adds the orange glow (hot shot).
      const r = b.circleRadius || 11;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.2, 0, 0, r);
      g.addColorStop(0, '#5a5e66'); g.addColorStop(0.6, '#2c2f35'); g.addColorStop(1, '#16181c');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0c0d10'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.4, r * 0.28, 0, Math.PI * 2); ctx.fill();
      if (b._heated) {
        ctx.globalCompositeOperation = 'lighter';
        const hg = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.6);
        hg.addColorStop(0, 'rgba(255,170,60,0.55)'); hg.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

    } else if (b.partType === 'chain_shot') {
      // The LEAD draws the tether + BOTH balls (the partner 'chain_shot_partner'
      // has no branch). Guard on partner.position (lead may outlive partner 1 frame).
      const r = b.circleRadius || 8;
      const partner = b._partner;
      if (partner && partner.position) {
        ctx.save();
        ctx.strokeStyle = '#3a3a40'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(b.position.x, b.position.y); ctx.lineTo(partner.position.x, partner.position.y); ctx.stroke();
        ctx.strokeStyle = '#6a6a72'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(b.position.x, b.position.y); ctx.lineTo(partner.position.x, partner.position.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      const positions = (partner && partner.position) ? [b.position, partner.position] : [b.position];
      for (const pos of positions) {
        ctx.save();
        ctx.translate(pos.x, pos.y);
        const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.2, 0, 0, r);
        g.addColorStop(0, '#5a5e66'); g.addColorStop(0.6, '#2c2f35'); g.addColorStop(1, '#16181c');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.4, r * 0.26, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

    } else if (b.partType === 'mortar_shell') {
      // Finned shell, nose-down (b.angle set to PI/2 at spawn). Body points +x local.
      ctx.save();
      ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#3a4038'; ctx.fillRect(-10, -5, 16, 10);
      ctx.fillStyle = '#2b302a';
      ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(14, 0); ctx.lineTo(6, 5); ctx.closePath(); ctx.fill();   // ogive nose (+x)
      ctx.fillStyle = '#1c201b';
      ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(-16, -8); ctx.lineTo(-10, -1); ctx.closePath(); ctx.fill();  // tail fins (-x)
      ctx.beginPath(); ctx.moveTo(-10, 5);  ctx.lineTo(-16, 8);  ctx.lineTo(-10, 1);  ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(-10, -5, 16, 2);
      ctx.restore();
      // descent smoke trail from the tail (mirrors the rocket branch)
      const tx = b.position.x - Math.cos(b.angle) * 12;
      const ty = b.position.y - Math.sin(b.angle) * 12;
      if (Math.random() < 0.6) {
        P.spawn({ x: tx, y: ty, vx: 0, vy: -0.04, type: 'smoke', color: '#999', size: 7, life: 500, gravity: -0.0004, drag: 0.99 });
      }
    }
  }
}
