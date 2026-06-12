// On-stage speech bubbles, REMOVED.
//
// The original Interactive Buddy reacts physically, facial expression, flinch,
// ragdoll, and never narrates. The buddy "speaking" in floating bubbles broke
// that fidelity (it read as an AI chatbot, not a toy), so every on-stage bubble
// is gone.
//
// This module stays as the single no-op chokepoint. Every speech source funnels
// through popBubble:
//   - passive mood lines (main.js / maybeSpeak)
//   - persona hit-reactions (reactions/index.js → persona speech pools)
//   - mode events (modes/events.js)
//   - ability onomatopoeia ("*gasp*", "haha", "*hisss*", …)
//   - persona panic monologues + the "pull harder!" drag hints
// Neutralizing it here removes them ALL in one place without touching ability
// logic, mood, telemetry, or the ragdoll's drawn facial expression. The exports
// are kept (as no-ops) so every importer and the configureSpeechBubbles() wiring
// in main.js compile unchanged.

export function configureSpeechBubbles() {}

export function popBubble() {}

// Was the click-to-react variant for the retired hallucinate tool; no current
// callers. Kept as a no-op for import safety, fires onIgnore so any future
// caller's "unclicked" path still resolves rather than hanging.
export function popClickableBubble(_part, _text, { onIgnore } = {}) {
  if (typeof onIgnore === 'function') onIgnore();
}
