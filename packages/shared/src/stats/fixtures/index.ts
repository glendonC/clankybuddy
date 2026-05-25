// Demo / fixture-data entry point. Consumed by:
//   - the CLI demo mode (`--demo=<scenario>`) via packages/cli/src/demo/
//   - the web stats-dashboard placeholder data (future migration target)
//   - any test or storybook-style harness that wants reproducible stats
//
// Anything stable enough to be the source of truth for "what should
// realistic ClankyBuddy data look like" lives here. The CLI demo module
// becomes a thin wrapper that exposes the singleton + the mock API
// adapters; the data itself comes from this surface.

export { makeRng, type Rng } from './rng.js';
export {
  SCENARIOS,
  isScenarioName,
  scenarioNames,
  type ScenarioName,
  type ScenarioSpec,
} from './scenarios.js';
export { buildMeStats, type FixtureWindow } from './me-stats.js';
export { buildLeaderboard } from './leaderboard.js';
export {
  buildChatScript,
  buildSeedHistory,
  type ScriptedEvent,
} from './chat-script.js';
