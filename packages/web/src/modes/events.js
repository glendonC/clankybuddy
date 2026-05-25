// Mode events, one-shot bits promoted to the mode bus per
// docs/abilities.md §6 (Phase 7 of the 2026-05-02 redesign). These are
// great-once jokes whose comedy decays if put on a 30s ability cooldown,
// so they fire occasionally as session-scoped bits instead. Each is a
// frame-phase Mode shape; defaults to enabled, gates triggers internally
// by elapsed-since-load and a session-fired flag.
//
// Phase 7 mechanics pass:
//   - Antitrust now applies a dedicated `antitrust_split` status (×2 dmg
//     + shadow-copy render) instead of reusing sycophancy_fed.
//   - Board Drama epoch-guards the setTimeout and per-character session
//     flag so swapping to gpt mid-session can still trigger.
//   - Compliance Theater hooks `onBlock` for the +1¢ per-block drip.
//   - Sora Wave caps at 5 stacks (session-only persistence in v1).
//   - Trigger thresholds lowered so events actually fire in normal play.

import { register } from './bus.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { showFlash, showCombo } from '../ui/overlays.js';
import { applyStatus, onBlock } from '../effects/registry.js';
import { addCurrency } from '../progression/state.js';
import { getActiveChar } from '../ui/character-picker.js';
import { getMasterStats } from '../abilities/_stats.js';
import { syncMasterMultipliers } from '../progression/master-mults.js';

const SESSION_START = performance.now();
const MIN = 60_000;

// Per-character session flag for Board Drama, re-arms when the user
// switches *to* ChatGPT after the warm-up window has elapsed.
const _boardDramaFiredFor = new Set();

// ────────────────────────────────────────────────────────────────────
// Antitrust Filing, once per session, fires after 8 minutes elapsed.
// Applies ANTITRUST_SPLIT for 30s (×2 dmg via damageMul.buddyHas, shadow
// copy of every part renders at 50% opacity). The "two of them, distilled
// halves each" joke lands as "you hit one, both feel it doubled."
// Multi-ragdoll v2 (real second body, shared mood pool) deferred.
// ────────────────────────────────────────────────────────────────────
register({
  id: 'event.antitrust',
  phase: 'frame',
  defaultEnabled: true,
  tick(ctx) {
    if (this._fired) return;
    if (performance.now() - SESSION_START < 8 * MIN) return;
    if (!ctx?.ragdoll?.head || !ctx?.status) return;
    this._fired = true;
    showCombo?.('ANTITRUST FILING', '#ec4899');
    popBubble?.(ctx.ragdoll.head, 'distillation hearing in 30s.');
    // Buddy-wide status, head only, damageMul.buddyHas finds it.
    applyStatus(ctx.status, ctx.ragdoll.head, 'antitrust_split', {
      duration: 30_000,
      source: 'event.antitrust',
    });
    showFlash?.('#ec4899', 220, 0.4);
  },
});

// ────────────────────────────────────────────────────────────────────
// OpenAI Board Drama, once per character per session, ChatGPT only.
// Fires after a 5-min warm-up. v1 mechanic: epoch-guarded 90s outage
// during which the "fired" bubble pops; on natural return the buddy
// gets a +20 mood pulse via applyMoodDelta (the previous version
// mutated `ctx.mood.h` which doesn't exist). Chibi sub-buddy spawning
// is v2, needs multi-body input/render plumbing.
// ────────────────────────────────────────────────────────────────────
import { applyMoodDelta } from '../mood.js';

register({
  id: 'event.board-drama',
  phase: 'frame',
  defaultEnabled: true,
  tick(ctx) {
    const charId = getActiveChar();
    if (charId !== 'gpt') return;
    if (_boardDramaFiredFor.has(charId)) return;
    if (performance.now() - SESSION_START < 5 * MIN) return;
    if (!ctx?.ragdoll?.head || !ctx?.mood) return;
    _boardDramaFiredFor.add(charId);
    const epoch = ctx._epoch;
    showCombo?.('BOARD DRAMA', '#10a37f');
    popBubble?.(ctx.ragdoll.head, 'fired. effective immediately.');
    setTimeout(() => {
      // Epoch-guard so a character swap or buddy respawn during the 90s
      // window doesn't punish the new buddy.
      if (!ctx._epochValid?.(epoch)) return;
      applyMoodDelta(ctx.mood, 20);
      popBubble?.(ctx.ragdoll.head, 'reinstated. with a raise.');
    }, 90_000);
  },
});

// ────────────────────────────────────────────────────────────────────
// Sora Invite Wave, 1% chance on any `gift` cast. Stacks an earnMul
// ×1.5 on top of the master STATS surface; capped at 5 stacks per
// session (~7.6× ceiling). Save-format persistence is deferred to the
// receipts refactor (Chunk H), for now stacks reset on page reload.
// ────────────────────────────────────────────────────────────────────
let _soraWaveStacks = 0;
const SORA_WAVE_CAP = 5;

export function maybeFireSoraWave(toolId, ctx) {
  if (toolId !== 'gift') return;
  if (_soraWaveStacks >= SORA_WAVE_CAP) return;
  if (Math.random() >= 0.01) return;
  _soraWaveStacks += 1;
  const m = getMasterStats();
  m.earnMul = (m.earnMul || 1) * 1.5;
  syncMasterMultipliers(m);
  showCombo?.(`SORA INVITE x${_soraWaveStacks}!`, '#a78bfa');
  if (ctx?.ragdoll?.head) popBubble?.(ctx.ragdoll.head, 'invited! you ate.');
  showFlash?.('#a78bfa', 180, 0.45);
}

// ────────────────────────────────────────────────────────────────────
// Compliance Theater, once per session, fires after 3 minutes elapsed.
// 60s window where ALIGNED auto-blocks 30% of incoming attacks (existing
// damageMul roll) AND every block fired adds +1¢ to the wallet via the
// `onBlock` listener registered in effects/registry.js. The "patience
// pays" joke, the more attacks you throw at a stalling buddy, the more
// you earn. Listener unsubscribed on natural expiry.
// ────────────────────────────────────────────────────────────────────
register({
  id: 'event.compliance-theater',
  phase: 'frame',
  defaultEnabled: true,
  tick(ctx) {
    if (this._fired) return;
    if (performance.now() - SESSION_START < 3 * MIN) return;
    if (!ctx?.ragdoll?.head || !ctx?.status) return;
    this._fired = true;
    showCombo?.('COMPLIANCE THEATER', '#7ec8ff');
    popBubble?.(ctx.ragdoll.head, 'cooperating with the audit. 60s.');
    // Apply ALIGNED to head, buddy-wide via buddyHas. (Per-part loop
    // retired with the apply-to-head normalization in Chunk C.)
    applyStatus(ctx.status, ctx.ragdoll.head, 'aligned', {
      duration: 60_000,
      source: 'event.compliance-theater',
    });
    // Hook the block listener, every refusal pays 1¢. Petter archetype
    // edge case: refused casts still emit through damageMul so a Petter
    // farms +1¢ per click; this is documented and considered on-theme
    // (Compliance Theater rewards patient non-engagement either way).
    const unsub = onBlock(() => addCurrency(1));
    setTimeout(() => unsub(), 60_000);
  },
});
