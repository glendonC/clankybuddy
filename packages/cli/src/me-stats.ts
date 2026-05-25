// `/stats` slash command backend · fetches GET /me/stats and returns the
// raw MeStatsResponse for the modal at stats/view.tsx to render. The worker
// route is the same one the web's stats-dashboard.js consumes (KV+SWR
// cached, granularity-aware); the TUI just picks a different granularity
// default per window.
//
// Window choices:
//   lifetime · granularity='all', lifetime totals (server ignores since/until)
//   day      · granularity='hour', last 24h
//   week     · granularity='day', last 7d

import type {
  LeaderboardResponse,
  MeStatsResponse,
  StatsGranularity,
} from '../../shared/src/events.js';
import { leaderboardToStatsEnvelope } from '../../shared/src/stats/index.js';
import { apiFetch } from './api.js';
import { getValidAccessToken } from './auth.js';
import type { Config } from './config.js';
import { writeConfig } from './config.js';
import { isDemoMode } from './demo/index.js';
import {
  mockFetchLeaderboard,
  mockFetchMeStats,
} from './demo/mock-api.js';

export type StatsWindow = 'lifetime' | 'day' | 'week';

export function parseStatsWindow(arg: string | undefined): StatsWindow | null {
  if (!arg || arg === '' || arg === 'lifetime' || arg === 'all') return 'lifetime';
  if (arg === 'day' || arg === 'today' || arg === '24h') return 'day';
  if (arg === 'week' || arg === '7d') return 'week';
  return null;
}

function windowParams(
  win: StatsWindow,
): { granularity: StatsGranularity; since?: string } {
  if (win === 'lifetime') return { granularity: 'all' };
  if (win === 'day') {
    return {
      granularity: 'hour',
      since: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    };
  }
  return {
    granularity: 'day',
    since: new Date(Date.now() - 7 * 24 * 3_600_000).toISOString(),
  };
}

export async function fetchMeStats(
  config: Config,
  win: StatsWindow,
): Promise<MeStatsResponse> {
  if (isDemoMode()) return mockFetchMeStats(win);
  const access = await getValidAccessToken(config, writeConfig);
  const { granularity, since } = windowParams(win);
  const qs = new URLSearchParams({ granularity });
  if (since) qs.set('since', since);
  return apiFetch<MeStatsResponse>(
    config.api_base,
    `/me/stats?${qs.toString()}`,
    {},
    access,
    {
      onUnauthorized: () =>
        getValidAccessToken(config, writeConfig, { force: true }),
    },
  );
}

// Fetch global leaderboard and reshape to the MeStats envelope so the
// same renderers consume it. Bearer required by the worker (global
// data is still anonymous-user-gated). Demo mode short-circuits to a
// scenario-driven LeaderboardResponse so the global toggle works
// offline without a real account.
export async function fetchLeaderboard(
  config: Config,
  win: StatsWindow,
): Promise<MeStatsResponse> {
  if (isDemoMode()) {
    const lb = await mockFetchLeaderboard(win);
    return leaderboardToStatsEnvelope(lb);
  }
  const access = await getValidAccessToken(config, writeConfig);
  const { granularity, since } = windowParams(win);
  const qs = new URLSearchParams({ granularity });
  if (since) qs.set('since', since);
  const lb = await apiFetch<LeaderboardResponse>(
    config.api_base,
    `/leaderboard?${qs.toString()}`,
    {},
    access,
    {
      onUnauthorized: () =>
        getValidAccessToken(config, writeConfig, { force: true }),
    },
  );
  return leaderboardToStatsEnvelope(lb);
}
