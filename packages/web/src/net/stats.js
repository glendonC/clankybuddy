import { leaderboardToStatsEnvelope } from '@clankybuddy/shared/stats';
import { ApiError, ensureAuth } from './auth.js';

const STATS_TIMEOUT_MS = 6_000;

export async function fetchMeStats({
  since,
  until,
  granularity = 'day',
} = {}) {
  const auth = await Promise.race([
    ensureAuth(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new ApiError(0, 'auth timeout', null)), STATS_TIMEOUT_MS),
    ),
  ]);
  const url = new URL(`${auth.api_base}/me/stats`);
  // 'all' branch ignores since/until server-side; sending them is harmless
  // but pointless. For 'hour' / 'day', default since to a 30d window so
  // existing callers that omit it still get a sensible default.
  if (granularity !== 'all') {
    const effectiveSince = since
      ?? new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    url.searchParams.set('since', effectiveSince);
    if (until) url.searchParams.set('until', until);
  }
  url.searchParams.set('granularity', granularity);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STATS_TIMEOUT_MS);
  try {
    // v2 schema renamed the bearer field `token` -> `access_token`.
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
    }
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError(0, 'stats request timed out', null);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Normalize the legacy `{ models: [...] }` wire shape some worker versions
// emit into the canonical LeaderboardResponse used by shared. New worker
// versions return LeaderboardResponse-shaped data natively; this branch
// keeps the older shape addressable without two reshape paths downstream.
function normalizeLeaderboard(json) {
  if (json && typeof json === 'object' && json.per_model && typeof json.per_model === 'object') {
    return json;
  }
  const models = Array.isArray(json?.models) ? json.models : [];
  const per_model = {};
  for (const m of models) {
    per_model[m.model_id] = {
      help_count: m.help_count || 0,
      hurt_count: m.hurt_count || 0,
      sessions: 0,
      unique_users: 0,
    };
  }
  return {
    window: { granularity: 'all', since: null, until: null },
    per_model,
    per_verb_meta: {},
    timeseries: [],
  };
}

// Per-day global help/hurt counts per model. Backed by /leaderboard/series.
// Returns the raw `LeaderboardSeriesResponse` shape from shared, sparse:
// days with no activity are absent; `per_model` on each day is partial.
// The Pulse renderer gap-fills and sums per-persona on the client.
export async function fetchLeaderboardSeries({ since, until } = {}) {
  const auth = await Promise.race([
    ensureAuth(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new ApiError(0, 'auth timeout', null)), STATS_TIMEOUT_MS),
    ),
  ]);
  const url = new URL(`${auth.api_base}/leaderboard/series`);
  if (since) url.searchParams.set('since', since);
  if (until) url.searchParams.set('until', until);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STATS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
    }
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError(0, 'series request timed out', null);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Global aggregate, per-model help/hurt counts across all users. Backed by
// /api/leaderboard. Reshaped into the MeStatsResponse envelope by the
// shared helper (packages/shared/src/stats/leaderboard.ts) so the
// dashboard renderers and the TUI consume identical shapes.
export async function fetchGlobalStats() {
  const auth = await Promise.race([
    ensureAuth(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new ApiError(0, 'auth timeout', null)), STATS_TIMEOUT_MS),
    ),
  ]);
  const url = `${auth.api_base}/leaderboard`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STATS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.access_token}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
    }
    const json = await res.json();
    return leaderboardToStatsEnvelope(normalizeLeaderboard(json));
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError(0, 'stats request timed out', null);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
