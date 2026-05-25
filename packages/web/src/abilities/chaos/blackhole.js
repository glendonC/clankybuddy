import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood via ctx.reactTo.
import { stun, goLimp } from '../../physics/stand.js';
import { applyStatus, hasStatus } from '../../effects/registry.js';
import { showBlackHole } from '../../ui/overlays.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';

const { Body } = Matter;

export const defaultStats = {
  radius:        200,    // pull-strength scale; 200 = baseline. in-blackhole.js
                         // multiplies its inward force by (radius / 200).
  holdMs:        3000,   // duration of pull phase before collapse
  initialMood:   10,     // mood damage on cast (positive; subtracted)
  collapseMood:  30,     // mood damage on collapse beat (positive; subtracted)
};

export default {
  id: 'blackhole',
  defaultStats,
  apply(ctx) {
    const s = getStats('blackhole');
    const { ragdoll, status, x, y, screenShake } = ctx;
    startCooldown('blackhole');
    showBlackHole(x, y, s.holdMs);
    // Status duration is 100ms longer than the setTimeout below so the
    // hasStatus() check inside the timer reliably observes "still active"
    // (timer/tick race would otherwise flake on near-boundary fires).
    for (const p of ragdoll.parts) {
      applyStatus(status, p, 'in_blackhole', {
        duration: s.holdMs + 100,
        data: { center: { x, y }, radius: s.radius },
        onExpire: (rec, natural) => {
          if (!natural) return;
          const dx = p.position.x - x, dy = p.position.y - y;
          const dn = Math.hypot(dx, dy) || 1;
          // Violent radial ejection, additive on whatever the swirl left them with.
          Body.setVelocity(p, {
            x: p.velocity.x + (dx / dn) * 24,
            y: p.velocity.y + (dy / dn) * 24 - 6,
          });
          Body.setAngularVelocity(p, p.angularVelocity + (Math.random() - 0.5) * 0.5);
        },
      });
    }
    ctx.reactTo?.({ source: 'blackhole', part: ragdoll.head, moodDelta: -s.initialMood, speakMs: 600 });
    stun(ragdoll, s.holdMs);
    sfx.blackhole();
    const epoch = ctx._epoch;
    setTimeout(() => {
      if (!ctx._epochValid?.(epoch)) return;        // character swapped
      // If the blackhole was cleared early (e.g. nuke ran clearAllStatus),
      // skip the collapse beat so the audio doesn't fire over a dead well.
      const stillActive = ctx.ragdoll.parts.some(p => hasStatus(ctx.status, p, 'in_blackhole'));
      if (!stillActive) return;
      sfx.blackholeCollapse();
      screenShake(16, 500);
      ctx.reactTo?.({ source: 'blackhole', part: ctx.ragdoll.head, moodDelta: -s.collapseMood, impulse: 24, speakMs: 800 });
      goLimp(ctx.ragdoll, 1200);
      P.burst(x, y, 30, { type: 'spark', color: '#a78bfa', size: 4,  life: 700,  speedRange: 1.5 });
      P.burst(x, y, 16, { type: 'smoke', color: '#3b1d52', size: 22, life: 1000, speedRange: 0.6, gravity: -0.0003 });
    }, s.holdMs);
  },
  drawCursor(ctx, { x, y }) {
    const t = performance.now() * 0.004;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t);
    ctx.globalCompositeOperation = 'lighter';
    const r = 14;
    const g = ctx.createConicGradient(0, 0, 0);
    g.addColorStop(0,   'rgba(167, 139, 250, 0.7)');
    g.addColorStop(0.5, 'rgba(96, 165, 250, 0.4)');
    g.addColorStop(1,   'rgba(167, 139, 250, 0.7)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};
