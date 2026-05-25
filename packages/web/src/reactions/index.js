// Reaction entry point. `react()` resolves the active character + mood state,
// runs the picker, and (if part is given) emits a speech bubble. Returns the
// chosen line so callers can do their own routing.
//
// Effects' onTick callers pass `event: 'on_fire' | ...` and an optional
// `mood` so the picker can scope by mood-state. mood is the {happiness,...}
// object from mood.js, not the state name.

import { pickReaction } from './pools.js';
import { moodState as moodStateOf } from '../mood.js';
import { popBubble } from '../ui/speech-bubbles.js';
import { getActiveChar } from '../ui/character-picker.js';

export function react({ event, mood, part, character, minIntervalMs = 0 } = {}) {
  // Optional throttle, uses mood as the storage slot like maybeSpeak does.
  if (minIntervalMs > 0 && mood) {
    const now = performance.now();
    if (now - (mood.lastBubbleAt || 0) < minIntervalMs) return null;
    mood.lastBubbleAt = now;
  }
  const moodState = mood ? moodStateOf(mood).name : undefined;
  const character_ = character ?? getActiveChar();
  const text = pickReaction({ event, moodState, character: character_ });
  if (text && part) popBubble(part, text);
  return text;
}

export { pickReaction };
