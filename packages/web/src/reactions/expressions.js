// Face-expression decider. Single source of truth for what the head should
// look like THIS frame. Returns an override descriptor { eyes, mouth, jitter }
// or null when the default mood-state face should be drawn.
//
// Priority (highest first):
//   1. Persistent statuses on the head, concussed > on_fire > electrified > frozen.
//      These are the longest-running and visually loudest, so they win.
//   2. Transient shock channel, wince face when mood.shock > SHOCK_FACE_MIN.
//      This is the load-bearing fix for "smile while bleeding": even when
//      happiness is +95, a fresh hit reads on the face. Outranks frozen on
//      purpose? No, frozen is persistent (you can't wince through ice). But
//      it does outrank the mood-state default, which is the only thing it
//      really needs to outrank for the bug to be fixed.
//   3. null → caller draws the mood-state default face.
//
// Mood is optional (callers that don't track it can pass null/undefined).
// Adding a new stimulus channel: extend the descriptor shape and add a branch
// here, then handle the new eye/mouth key in render/ragdoll.js drawExpression.

const SHOCK_FACE_MIN = 22; // ~1 punch worth of damage; pet (intensity ~0) ignored

export function pickExpression(headStatuses, mood) {
  const has = (id) => !!headStatuses && headStatuses.has(id);
  if (has('concussed'))   return { eyes: 'x',      mouth: 'wobble',  jitter: 1.6 };
  if (has('on_fire'))     return { eyes: 'panic',  mouth: 'scream',  jitter: 1.0 };
  if (has('electrified')) return { eyes: 'shock',  mouth: 'shock',   jitter: 0.6 };
  if (has('frozen'))      return { eyes: 'narrow', mouth: 'flat',    jitter: 0.0 };
  if (mood && (mood.shock || 0) > SHOCK_FACE_MIN) {
    // Jitter scales with shock intensity, bigger hits shake the face harder.
    const j = Math.min(1.4, (mood.shock - SHOCK_FACE_MIN) / 40);
    return { eyes: 'wince', mouth: 'grimace', jitter: j };
  }
  return null;
}

export { SHOCK_FACE_MIN };
