// Demo-mode shim for the API layer. Anything that would hit a real
// endpoint should branch through here when isDemoMode() is true.

import type {
  LeaderboardResponse,
  MeStatsResponse,
} from '../../../shared/src/events.js';
import {
  buildLeaderboard,
  buildMeStats,
} from '../../../shared/src/stats/fixtures/index.js';
import type { StatsWindow } from '../me-stats.js';
import { getScenarioSpec } from './index.js';

// Match the real /me/stats latency badly enough that the loading
// state in the modal is visible · designers iterating on the spinner
// should see it for a beat, but not long enough to feel sluggish.
const FAKE_LATENCY_MS = 220;

export function mockFetchMeStats(win: StatsWindow): Promise<MeStatsResponse> {
  const spec = getScenarioSpec();
  return new Promise((resolve) => {
    setTimeout(() => resolve(buildMeStats(spec, win)), FAKE_LATENCY_MS);
  });
}

export function mockFetchLeaderboard(
  win: StatsWindow,
): Promise<LeaderboardResponse> {
  const spec = getScenarioSpec();
  return new Promise((resolve) => {
    setTimeout(() => resolve(buildLeaderboard(spec, win)), FAKE_LATENCY_MS);
  });
}
