// Cross-package verb→polarity map. Single source of truth for "which verbs
// belong on the help vs. hurt vs. utility side of the leaderboard." Mirrors
// the `spine` field in src/ui/tools-table.js TAXONOMY exactly:
//   positive → help
//   negative → hurt
//   utility  → utility
//
// Why this lives in shared:
//   - The worker's aggregation cron (packages/worker/src/cron/aggregate.ts)
//     keys off polarity to bucket counts into help/hurt LeaderboardDOs.
//   - The web client's leaderboard preview UI groups verbs by polarity for
//     copy ("most helpful tool against gpt", etc.).
//   - The TUI's stats panel does the same.
// Three consumers reading the same answer means one map, in shared, owned
// by neither the worker nor either client.
//
// Compatibility with packages/worker/src/constants.ts VERB_POLARITY:
//   The worker constants file used to inline a `Record<string, 'help'|'hurt'>`
//   that defaulted unknowns to 'hurt' and listed `freeze` and `grab` under
//   'help'/'hurt' respectively. The new contract is:
//     - `freeze` becomes 'utility' (it's a setup/combo enabler, not a hit).
//     - `grab` becomes 'utility' (cursor-only manipulation, never a hit).
//     - Unknown verbs return undefined; aggregation drops them with a log
//       line rather than silently mis-bucketing into 'hurt'.
//   This is a leaderboard-counts change, called out at the top of
//   packages/worker/src/cron/aggregate.ts.

export type VerbPolarity = 'help' | 'hurt' | 'utility';

// Source: src/ui/tools-table.js TOOLS array. Keep in lock-step with the game
// side, adding a new tool there means adding a new key here. Aliases are
// included where the worker historically accepted both spellings:
//   sword          ↔ lightsaber  (tools-table id 'sword' aliases punish/lightsaber.js)
//   flame          ↔ flamethrower (tools-table id 'flamethrower' aliases punish/flame.js)
//   bomb is referenced in CLAUDE.md but not yet implemented; included so an
//   accidental client submission classes correctly when it ships.
export const VERB_POLARITY: Readonly<Record<string, VerbPolarity>> = {
  // positive / affection
  pet: 'help',
  compliment: 'help',
  // positive / gifts
  feed: 'help',
  gift: 'help',
  // positive / blessings
  gpu: 'help',

  // negative / melee
  punch: 'hurt',
  hammer: 'hurt',
  sword: 'hurt',
  lightsaber: 'hurt',
  // negative / ranged
  gun: 'hurt',
  machinegun: 'hurt',
  shotgun: 'hurt',
  rocket: 'hurt',
  grenade: 'hurt',
  // negative / elemental
  fireball: 'hurt',
  flame: 'hurt',
  flamethrower: 'hurt',
  lightning: 'hurt',
  bomb: 'hurt',
  // negative / god powers
  anvil: 'hurt',
  blackhole: 'hurt',
  nuke: 'hurt',

  // utility / manipulation. Recorded on /events/batch but never tallied into
  // the help/hurt leaderboard, these are setup/combo enablers (freeze) or
  // cursor primitives (grab).
  grab: 'utility',
  freeze: 'utility',
};

// Returns the polarity for a verb, or undefined if the verb is not in the
// map. Aggregators MUST treat undefined as "drop with a log line" rather
// than picking a default, silently bucketing unknown verbs into 'hurt'
// (the previous behavior) corrupts the leaderboard the moment a client
// types a tool id we haven't shipped yet.
export function polarityFor(verb: string): VerbPolarity | undefined {
  return VERB_POLARITY[verb];
}

// True iff the verb counts toward the help/hurt leaderboard. Utility verbs
// (freeze, grab) and unknown verbs return false. Used by the aggregation
// cron and any future read path that wants to filter to just leaderboard-
// eligible verbs without rebuilding the polarity check.
export function isLeaderboardVerb(verb: string): boolean {
  const p = VERB_POLARITY[verb];
  return p === 'help' || p === 'hurt';
}
