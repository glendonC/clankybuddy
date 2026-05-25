import Matter from 'matter-js';
import * as P from '../../particles.js';
import { sfx } from '../../audio/sfx.js';
// mood delta routed through ctx.reactTo.
import { applyStatus, removeStatus } from '../../effects/registry.js';
import { getActiveChar } from '../../ui/character-picker.js';
import { getStats } from '../_stats.js';

const { Body, Bodies, Composite } = Matter;

export const defaultStats = {
  contactDuration:  5000,    // powered duration when card hits buddy
  wirelessDuration: 2500,    // powered duration on miss (card expires)
  lifeMs:           5000,    // how long the card lingers before wireless fallback
  // Three-branch tree (provision.js, 2026-05-24). Defaults reproduce the
  // pre-rework "single card, full boost" behavior. Branches mutate these:
  //   Scale    , spawnCount up, moodGainMul down (more, smaller)
  //   Frontier , spawnCount = 1, moodGainMul up (one big card)
  //   Burnout  , onFireOnCast true + moodGainMul down (smoking buddy)
  spawnCount:        1,
  moodGainMul:       1.0,    // multiplier on the powered status mul (data.mul)
  onFireOnCast:      false,  // Burnout branch: apply on_fire to buddy on cast
  onFireDurationMs:  0,
  onFireIntensity:   1,
};

function spawnCard(s, ctx, x, y, personaMul) {
  const { world } = ctx;
  const effMul = personaMul * (s.moodGainMul ?? 1);
  const card = Bodies.rectangle(x, y - 30, 56, 24, {
    restitution: 0.2, density: 0.002, friction: 0.9, label: 'gpu', render: { visible: false },
  });
  card.partType = 'gpu';
  card._verb = ctx._verb || 'gpu';
  card.bornAt = performance.now();
  card.lifeMs = s.lifeMs;
  card._personaMul = effMul;
  card._contactDuration = s.contactDuration;
  card.onExpire = (b, ctx2) => {
    // wireless install: tiny consolation if it never made contact. Cleans
    // bleed too, the blurb promises a cure, contact path and wireless
    // path must agree (otherwise a missed throw silently fails the promise).
    for (const p of ctx2.ragdoll.parts) {
      applyStatus(ctx2.status, p, 'powered', { duration: s.wirelessDuration, source: 'gpu-wireless', data: { mul: effMul } });
      removeStatus(ctx2.status, p, 'bleed', 'gpu-wireless');
    }
    P.burst(b.position.x, b.position.y, 14, { type: 'star', color: '#5cf2a0', size: 4, life: 700, speedRange: 0.6, gravity: -0.0003 });
  };
  Composite.add(world, card);
  ctx.transientBodies.push(card);
  Body.setVelocity(card, { x: 0, y: 0 });
  return card;
}

// Even horizontal spread for N cards. n=1 → centered; n=3 → −56, 0, +56; etc.
// Spacing tuned so 5 cards still fit comfortably under the buddy without
// stacking. Returns an array of x offsets.
function spreadOffsets(n) {
  if (n <= 1) return [0];
  const spacing = 56;
  const out = [];
  const start = -(n - 1) / 2 * spacing;
  for (let i = 0; i < n; i++) out.push(start + i * spacing);
  return out;
}

export default {
  id: 'gpu',
  defaultStats,
  apply(ctx) {
    const s = getStats('gpu');
    const { ragdoll, x, y } = ctx;
    // Persona affinity (docs §3): Llama is open-weight, running on commodity GPUs is the norm,
    // so a flagship card lands at half-effect (joke: "you already have one").
    const personaMul = getActiveChar() === 'llama' ? 0.5 : 1.0;
    const offsets = spreadOffsets(s.spawnCount ?? 1);
    for (const dx of offsets) spawnCard(s, ctx, x + dx, y, personaMul);
    // Burnout branch, applying gpu sets the buddy on fire (the "over-pet'd
    // = overheated" joke). The smoke + mood floor on fire are the
    // self-poisoning ceiling that distinguishes this from Scale/Frontier.
    if (s.onFireOnCast && ragdoll?.parts) {
      for (const p of ragdoll.parts) {
        applyStatus(ctx.status, p, 'on_fire', {
          duration: s.onFireDurationMs,
          source: 'gpu-burnout',
          intensity: s.onFireIntensity ?? 1,
        });
      }
    }
    sfx.gpu();
    P.burst(x, y - 30, 10, { type: 'spark', color: '#5cf2a0', size: 3, life: 500, speedRange: 0.5, gravity: -0.0002 });
    ctx.reactTo?.({ source: 'gpu', part: ragdoll.head, moodDelta: 3 * personaMul * (s.moodGainMul ?? 1), speakMs: 700 });
  },
  drawCursor(ctx, { x, y }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#0a3d2a'; ctx.fillRect(-14, -7, 28, 14);
    ctx.fillStyle = '#5cf2a0'; ctx.fillRect(-13, -6, 26, 12);
    ctx.fillStyle = '#0a3d2a'; ctx.fillRect(-9, -3, 7, 6);
    ctx.fillStyle = '#0a3d2a'; ctx.fillRect( 2, -3, 7, 6);
    ctx.restore();
  },
};
