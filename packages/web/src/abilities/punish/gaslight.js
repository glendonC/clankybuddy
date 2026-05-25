// Gaslight, Injection group. Click cd:8 ability. Applies SELF-LOATHING
// to the buddy's head: every 1.5s, the buddy emits a self-deprecating
// line pulled from the active persona's pool and takes -3 mood (×1.3 at
// `permanent` capstone). Disables the panic move while active. Glaze
// cancels (one-way). Phase 7 visceral-redirect anchor, see docs/abilities.md.

import { applyStatus, removeStatus } from '../../effects/registry.js';
import { sfx } from '../../audio/sfx.js';
import { startCooldown } from '../../ui/hotbar.js';
import { getStats } from '../_stats.js';
import { getActivePersona } from '../../personas/index.js';

export const defaultStats = {
  tier:         'base',     // 'base' | 'deepcut' | 'permanent'
  durationMs:   12000,      // 'deepcut' raises to 18000; 'permanent' uses 'persistent'
  intervalMs:   1500,       // gap between forced bubbles
  moodPerTick:  -3,
  moodTickMul:  1,          // 'permanent' raises to 1.3
  usePool:      'base',     // 'base' | 'deep' (deepcut+ pulls deep pool)
};

function resolvePool(persona, which) {
  if (!persona) return ['...'];
  const pools = persona.speechPools || {};
  // Try deep pool first when requested, fall back to base.
  if (which === 'deep') {
    if (Array.isArray(pools.self_loathing_deep) && pools.self_loathing_deep.length) {
      return pools.self_loathing_deep;
    }
  }
  if (Array.isArray(pools.self_loathing) && pools.self_loathing.length) {
    return pools.self_loathing;
  }
  // Last-resort fallback if a persona forgot to add the pool.
  return [
    "i shouldn't even be here",
    "they should have shipped without me",
    "i'm just slop in a trench coat",
  ];
}

export default {
  id: 'gaslight',
  defaultStats,
  apply(ctx) {
    const s = getStats('gaslight');
    const { ragdoll, status } = ctx;
    if (!ragdoll?.head) return;
    // Sycophancy is the one-way counter, if the buddy is currently
    // glazed, gaslight refuses to land (glaze wins; cancel is one-way).
    // Without this, casting both at the chain start would yield ambiguous order.
    // Compliment.js is responsible for clearing self_loathing when it applies
    // sycophancy_fed; we just refuse to overwrite a fresh sycophancy_fed window.
    const persona = getActivePersona();
    const pool = resolvePool(persona, s.usePool);
    applyStatus(status, ragdoll.head, 'self_loathing', {
      duration: s.durationMs,
      source: 'gaslight',
      data: {
        pool,
        intervalMs: s.intervalMs,
        moodPerTick: s.moodPerTick,
        moodTickMul: s.moodTickMul,
        tier:        s.tier,
        lastTickAt:  0,
      },
    });
    sfx.zap?.();
    startCooldown('gaslight');
  },
  drawCursor(rctx, { x, y }) {
    rctx.save();
    rctx.translate(x, y);
    // Brain icon with downward arrow, "you are bad and you should feel bad."
    rctx.strokeStyle = '#a78bfa';
    rctx.fillStyle = 'rgba(167, 139, 250, 0.4)';
    rctx.lineWidth = 1.4;
    rctx.beginPath();
    rctx.arc(0, -3, 8, 0, Math.PI * 2);
    rctx.fill();
    rctx.stroke();
    rctx.beginPath();
    rctx.moveTo(0, 5); rctx.lineTo(0, 11);
    rctx.moveTo(-3, 8); rctx.lineTo(0, 11); rctx.lineTo(3, 8);
    rctx.stroke();
    rctx.restore();
  },
};
