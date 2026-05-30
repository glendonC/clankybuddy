// Panic-move lifecycle ticker. Per-character signature moves moved into
// src/personas/<id>.js in PR2, this file now owns just the cross-buddy
// scaffolding: the singleton _active record + its per-frame epoch/expiry
// check, the firePanicMove dispatcher (which delegates to the active
// persona), and a setPanicActive() setter the persona files call when
// their move starts.
//
// All moves share infrastructure:
//   - Brief invuln window via mood.invulnUntil (mood.js absorbs negative
//     deltas during this window).
//   - Per-character spawn behavior (overlays, bubbles, optional aura).
//
// Persona files own the actual move bodies; see src/personas/claude.js etc.

import { popBubble } from '../ui/speech-bubbles.js';
import { showCombo } from '../ui/overlays.js';
import { getActivePersona } from '../personas/index.js';
import { clearPanicActive, getPanicActive } from './panic-state.js';
import { hasStatus } from '../effects/registry.js';

// Called from main loop. Most moves are "fire and forget" with their own
// setTimeout cleanup; this ticker only owns shared expiry/epoch cleanup.
export function tickPanicMoves(ctx) {
  const active = getPanicActive();
  if (!active) return;
  if (!ctx._epochValid(active.epoch)) {
    if (active.cleanup) active.cleanup();
    clearPanicActive();
    return;
  }
  if (performance.now() > active.expiresAt) {
    if (active.cleanup) active.cleanup();
    clearPanicActive();
  }
}

export function firePanicMove(ctx) {
  const { ragdoll, mood, status } = ctx;
  if (!ragdoll) return;
  // Panic-suppression gate. A buddy mid coup de grâce cannot summon a
  // comeback move; mood damage continues to land but the persona's
  // defensive flourish is muted.
  if (status && hasStatus(status, ragdoll.head, 'finishing')) return;
  // Default invuln budget, handlers can override.
  mood.invulnUntil = performance.now() + 2200;
  const persona = getActivePersona();
  const move = persona?.panicMove;
  if (move && typeof move.apply === 'function') {
    move.apply(ctx);
  } else {
    // Belt-and-suspenders fallback in case a persona is missing the move.
    showCombo('PANIC!', '#fbbf24', 700);
    popBubble(ragdoll.head, '!');
  }
}
