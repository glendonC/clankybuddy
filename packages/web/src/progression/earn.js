// Earn-rule hooks. Called from the main loop + ability-fire wrapper.
// Keep numbers small here, balance is felt across thousands of clicks.

import { addCurrency, markSeenState } from './state.js';
import { moodState } from '../mood.js';
import { emit as emitTelemetry, getRecentFireVerb } from '../telemetry/events.js';
import { getMasterMul } from './master-mults.js';

// Master-tree Hustle multiplier, applied to all earn paths. Defaults to 1.
function earnMul() { return getMasterMul('earnMul') || 1; }
function scaledEarn(n) { return Math.max(0, Math.round(n * earnMul())); }

// +1 per ability fire. Slow drip; mostly the per-state bonuses do the work.
// Currency earned from fires is intentionally NOT emitted as a telemetry
// event, it's derivable as (tool_fire count × 1) and emitting per-fire
// would double our event volume for no analytical gain.
export function earnFromFire(_toolId) {
  // Hustle scales the per-fire drip too. The base earn is 1, scaledEarn
  // rounds to integer so a 1.5x multiplier alternates 1 / 2 (not floor-1).
  addCurrency(scaledEarn(1));
}

// Mood-state achievement tracking. Call every frame; emits bonuses on state
// transitions (from CONTENT → HAPPY, HAPPY → ECSTATIC, etc.) and a bigger
// one-shot bonus the first time a given character reaches a state.
let _lastStateName = null;
let _lastCharId    = null;

export function tickEarn(mood, charId) {
  const stateName = moodState(mood).name;
  if (charId !== _lastCharId) {
    _lastCharId = charId;
    _lastStateName = stateName;
    return;
  }
  if (stateName === _lastStateName) return;
  const fromState = _lastStateName;
  _lastStateName = stateName;
  const transitionAward = scaledEarn(20);
  addCurrency(transitionAward);
  const firstSeen = markSeenState(charId, stateName);
  const firstSeenAward = firstSeen ? scaledEarn(50) : 0;
  if (firstSeen) addCurrency(firstSeenAward);

  // Telemetry: mood_transition + the currency events that paired with it.
  // markSeenState's return doubles as the first_seen flag on the
  // transition event, which saves the worker a join.
  emitTelemetry({
    type: 'mood_transition',
    character: charId,
    from: fromState,
    to: stateName,
    mood_value: mood.happiness,
    cause_verb: getRecentFireVerb(),
    first_seen: firstSeen,
  });
  emitTelemetry({
    type: 'currency_earned',
    amount: transitionAward,
    reason: 'state_change',
    character: charId,
  });
  if (firstSeen) {
    emitTelemetry({
      type: 'currency_earned',
      amount: firstSeenAward,
      reason: 'state_first',
      character: charId,
    });
  }
}
