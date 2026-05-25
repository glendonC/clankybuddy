import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood delta routed through ctx.reactTo; bubble text is scripted below.
import { showCombo } from '../../ui/overlays.js';
import { getStats } from '../_stats.js';
import { getActiveChar } from '../../ui/character-picker.js';
import { applyStatus, removeStatus, hasStatus } from '../../effects/registry.js';

// "Glaze", combo praise. Each click within 700ms escalates the bonus.
// Phase 5: defaultStats added so the affection-tree branches (Earnest /
// 4o Mode) can stat-tune the base mood + cap. Phase 7: chain count
// crossing `sycophancyTriggerAt` applies SYCOPHANCY-FED to the buddy
// (the over-praised model becomes brittle, docs §2.1). `Earnest` opts
// out via `suppressSycophancy`; `4o Mode` lowers the trigger.
export const defaultStats = {
  base:                 6,     // mood per cast (Earnest A1 raises this to 10)
  perStep:              1.5,   // mood added per chained cast
  comboCap:             12,    // max chain count (4o Mode B1 raises this)
  windowMs:             700,   // max gap between casts to chain
  sycophancyTriggerAt:  3,     // chain count that applies sycophancy_fed (4o Mode lowers)
  sycophancyDurationMs: 6000,  // how long the over-praised brittle window lasts
  suppressSycophancy:   false, // Earnest sets this true, defensive build
};

export default {
  id: 'compliment',
  defaultStats,
  apply(ctx) {
    const s = getStats('compliment');
    const { ragdoll, mood, status, popBubble } = ctx;
    const now = performance.now();
    if (!mood.glazeCombo) mood.glazeCombo = { count: 0, lastAt: 0, fedThisChain: false };
    const c = mood.glazeCombo;
    if (now - c.lastAt < s.windowMs) {
      c.count = Math.min(c.count + 1, s.comboCap);
    } else {
      c.count = 1;
      c.fedThisChain = false;     // chain reset, eligible to fire SYCOPHANCY-FED again
    }
    c.lastAt = now;

    const bonus = s.base + Math.min(c.count - 1, s.comboCap - 1) * s.perStep;
    // Persona affinity (docs §3): glaze is 5× more effective on Claude, the Constitution joke.
    const personaMul = getActiveChar() === 'claude' ? 5.0 : 1.0;
    // Speech is hand-picked below (scripted glaze phrases / over-praised
    // sentinel), so suppress reactTo's pool lookup via speakMs=∞, still
    // get mood + telemetry.
    ctx.reactTo?.({ source: 'compliment', part: ragdoll.head, moodDelta: bonus * personaMul, speakMs: 99999 });
    sfx.compliment();
    const head = ragdoll.head.position;
    P.burst(head.x, head.y - 20, 8 + c.count, { type: 'heart', color: '#ff7eb6', size: 6 + c.count * 0.4, life: 900, speedRange: 0.35 + c.count * 0.04, gravity: -0.0004 });
    if (c.count >= 4) {
      P.burst(head.x, head.y - 24, 6, { type: 'star', color: '#f2c45c', size: 4, life: 800, speedRange: 0.6, gravity: -0.0003 });
    }
    if (c.count >= 6) {
      showCombo?.(`GLAZE x${c.count}`, '#ff7eb6');
    }
    // SYCOPHANCY-FED producer, chain count crosses threshold once per chain.
    // Earnest's suppressSycophancy=true opts out; 4o Mode's lower trigger fires sooner.
    let sycophancyJustFired = false;
    if (!s.suppressSycophancy && !c.fedThisChain && c.count >= s.sycophancyTriggerAt) {
      applyStatus(status, ragdoll.head, 'sycophancy_fed', {
        duration: s.sycophancyDurationMs,
        source: 'glaze',
      });
      c.fedThisChain = true;
      sycophancyJustFired = true;
      // Phase 7, sycophancy cancels gaslight (one-way). Glazing over a
      // self-loathing buddy snaps them out of it. Inverse direction
      // doesn't apply, gaslight refuses to overwrite a fresh sycophancy.
      if (hasStatus(status, ragdoll.head, 'self_loathing')) {
        removeStatus(status, ragdoll.head, 'self_loathing', 'glazed-over');
      }
    }
    // On the trigger frame: louder pink-heart burst + a "(over-praised)"
    // bubble so the player notices the chain just crossed into a debuff
    // window. Without this signal, sycophancy_fed silently flips the
    // buddy into "next hit ×1.5", the kit's onboarding trap.
    if (sycophancyJustFired) {
      P.burst(head.x, head.y - 20, 16, { type: 'heart', color: '#ff4d8d', size: 9, life: 1100, speedRange: 0.7, gravity: -0.0005 });
      popBubble(ragdoll.head, '(over-praised)');
    } else {
      const phrases = ['so smart!', 'good model!', 'best AI!', 'you slay', 'you ate', 'top of the leaderboard', 'no notes', 'literally perfect', 'icon behavior'];
      popBubble(ragdoll.head, phrases[Math.floor(Math.random() * phrases.length)]);
    }
  },
  drawCursor(ctx, { x, y }) {
    const t = performance.now() * 0.005;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t);
    ctx.fillStyle = '#ff7eb6';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = (i % 2 === 0) ? 10 : 4;
      const a = (i / 8) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },
};
