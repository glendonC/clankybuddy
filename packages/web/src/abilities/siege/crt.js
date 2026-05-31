// CRT monitor, siege wide-body branch (off piano). A heavy boxy tube monitor
// dropped from above. The verb is "implosion + zap": the glass tube bursts on
// impact (cyan/white shards) and the struck part is electrified for a beat
// (high-voltage flyback transformer fantasy). Reuses the shared spawnDrop
// factory and its NEW additive knobs (electrifyMs / concussOnImpact) — no
// onTick needed, this is a pure ballistic drop.

import { getStats } from '../_stats.js';
import { spawnDrop } from '../_shared.js';
import * as P from '../../particles.js';

export const defaultStats = {
  density:     0.02,
  mood:        30,
  electrifyMs: 1200,   // electrified status duration on the struck part
};

export default {
  id: 'crt',
  defaultStats,
  apply(ctx) {
    const s = getStats('crt');
    spawnDrop(ctx, {
      partType: 'crt', verb: 'crt',
      shape: 'rect', w: 96, h: 84,
      density: s.density, restitution: 0.04, friction: 0.9,
      dropHeight: 700, initVel: 4, lifeMs: 3000,
      mood: s.mood, squashVel: 18, splashRadius: 110, splashForce: 6,
      // Boxy CRT lands square, no wide-body crush — keep splash near default;
      // the verb is the electrify + glass burst, not a multi-part pancake.
      electrifyMs: s.electrifyMs,
      concussOnImpact: true, concussMs: 3500,
      shake: 22, shakeMs: 560, hitStopTier: 'explosion',
      impactSfx: 'crtSmash',
      // Imploding-tube glass burst: cyan/white shards + faint smoke.
      particles: (_c, bx, by) => {
        P.burst(bx, by, 10, { type: 'smoke', color: '#202028', size: 16, life: 760, speedRange: 0.5, gravity: -0.0004 });
        // Cyan phosphor glass shards (the picture tube).
        P.burst(bx, by, 18, { type: 'spark', color: '#7fe9ff', size: 4, life: 480, speedRange: 1.6, gravity: 0.0007 });
        // White hot glass + electric flash.
        P.burst(bx, by, 12, { type: 'spark', color: '#ffffff', size: 3, life: 300, speedRange: 2.0, gravity: 0.0005 });
      },
    });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    // Beige CRT case with a curved cyan-tinted screen.
    ctx.fillStyle = '#cbc4b0';
    ctx.fillRect(-16, -13, 32, 26);
    ctx.fillStyle = '#11151a';
    ctx.fillRect(-13, -10, 26, 18);
    // Phosphor screen glow.
    ctx.fillStyle = 'rgba(127,233,255,0.35)';
    ctx.fillRect(-12, -9, 24, 16);
    // Power LED.
    ctx.fillStyle = '#7fffa0';
    ctx.fillRect(11, 9, 2, 2);
    ctx.restore();
    // Landing reticle below the cursor.
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y + 18, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
};
