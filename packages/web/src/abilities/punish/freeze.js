import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
import { stun } from '../../physics/stand.js';
import { applyStatus, hasStatus, removeStatus } from '../../effects/registry.js';
import { showCombo } from '../../ui/overlays.js';
import { getStats } from '../_stats.js';

const { Body } = Matter;

// Freeze is PURE CONTROL, no direct mood damage. The manipulation group's
// identity per CLAUDE.md is "control without damage." Damage payoffs come
// from the OTHER tool that lands afterwards: hammer-on-frozen = SHATTER,
// lightning-on-frozen = SHOCK SHATTER, fire-on-frozen = EXTINGUISH+steam.
// Freeze sets the trap; the followup is what hurts.
export const defaultStats = {
  // freezeMs / conductedMs used to be how long the buddy stayed frozen;
  // frozen is now persistent (cleared by fire / hammer / character switch).
  // The values drive the stun lockout, when stun ends, the buddy is still
  // frozen but can be moved by mouse drag, hit again, etc.
  freezeMs:     1800,
  conductedMs:  3000,
};

export default {
  id: 'freeze',
  defaultStats,
  apply(ctx) {
    const s = getStats('freeze');
    const { ragdoll, status, popBubble } = ctx;
    let extinguished = false;
    let conducted = false;          // any part electrified at apply time?
    for (const p of ragdoll.parts) {
      if (hasStatus(status, p, 'on_fire'))     extinguished = true;
      if (hasStatus(status, p, 'electrified')) conducted    = true;
    }
    // CONDUCT combo: wet/cold conducts. Lockout window extends, but no
    // direct mood damage from freeze itself, the lightning that comes
    // after hits a frozen+stunned target and the SHOCK SHATTER pays out.
    const dur = conducted ? s.conductedMs : s.freezeMs;
    for (const p of ragdoll.parts) {
      Body.setVelocity(p, { x: p.velocity.x * 0.1, y: p.velocity.y * 0.1 });
      Body.setAngularVelocity(p, 0);
      applyStatus(status, p, 'frozen', { source: 'freeze' });
      // Cauterize-by-cold, ice freezes the wound shut.
      removeStatus(status, p, 'bleed', 'cauterize');
    }
    if (conducted)         { sfx.shatter(); showCombo?.('CONDUCT', '#9be7ff'); }
    else if (extinguished) { sfx.extinguish(); showCombo?.('EXTINGUISH', '#9be7ff'); }
    else                     sfx.freeze();
    stun(ragdoll, dur);
    const c = ragdoll.head.position;
    P.burst(c.x, c.y + 40, 30, { type: 'ice', color: '#9be7ff', size: 5, life: 1400, speedRange: 0.4, gravity: 0.0004 });
    popBubble(ragdoll.head, extinguished ? '*hisss*' : '❄️');
  },
  drawCursor(ctx, { x, y }) {
    const t = performance.now() * 0.003;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t);
    ctx.strokeStyle = '#9be7ff';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i / 6) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -10);
      ctx.moveTo(-2, -7); ctx.lineTo(0, -5); ctx.lineTo(2, -7);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
};
