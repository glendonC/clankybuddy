import { LEADERBOARD_CACHE_SECONDS, VALID_MODELS } from '../constants.js';
import type { DailyRow } from '../dos/leaderboard.js';
import type {
  LeaderboardSeriesDay,
  LeaderboardSeriesDayPerModel,
  LeaderboardSeriesResponse,
} from '../../../shared/src/stats/leaderboard.js';
import type { ModelId } from '../../../shared/src/personas.js';
import type { Env } from '../types.js';

// /leaderboard/series, per-day help/hurt counts per model for the
// global-benchmark overlay (Stage 2). Fan out to one LeaderboardDO per
// model in parallel (each returns its DailyRow[] for the window), then
// pivot into a unified per-day per-model time series.
//
// Sparse output: days with no activity are absent from `timeseries`;
// per_model entries are absent for models that had no activity on a
// given day. Frontend handles gap-filling and renders zero-activity days
// as empty cells.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;

function utcDayString(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Strict YYYY-MM-DD validator. Returns null on malformed input so the
// route can fall back to the default. We don't try to repair partial
// dates, a 400 on the client is cheaper than a misleading window.
function parseDayParam(raw: string | null): string | null {
  if (raw == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  // Confirm it's a real calendar date (e.g. reject 2025-02-30).
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return raw;
}

export async function handleLeaderboardSeries(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const todayMs = Date.now();
  const todayStr = utcDayString(todayMs);
  const defaultSince = utcDayString(todayMs - DEFAULT_LOOKBACK_DAYS * DAY_MS);

  const since = parseDayParam(url.searchParams.get('since')) ?? defaultSince;
  const until = parseDayParam(url.searchParams.get('until')) ?? todayStr;

  // Fan out per-model series reads in parallel.
  const perModelRows = await Promise.all(
    VALID_MODELS.map(async (model_id) => {
      const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName(model_id));
      const rows = await stub.getSeries({
        since_date: since,
        until_date: until,
      });
      return { model_id: model_id as ModelId, rows };
    }),
  );

  // Pivot: date → ModelId → { help, hurt }. Map insertion order is
  // preserved on insertion; we sort at the end for determinism.
  const byDate = new Map<string, Partial<Record<ModelId, LeaderboardSeriesDayPerModel>>>();
  for (const { model_id, rows } of perModelRows) {
    for (const row of rows as DailyRow[]) {
      let day = byDate.get(row.day_utc);
      if (!day) {
        day = {};
        byDate.set(row.day_utc, day);
      }
      day[model_id] = {
        help: row.help_count,
        hurt: row.hurt_count,
      };
    }
  }

  const timeseries: LeaderboardSeriesDay[] = Array.from(byDate.entries())
    .map(([date, per_model]) => ({ date, per_model }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const body: LeaderboardSeriesResponse = { timeseries };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Mirror /leaderboard cache shape, both endpoints aggregate
      // cookie-less GETs that can ride the colo cache.
      'Cache-Control': `public, max-age=${LEADERBOARD_CACHE_SECONDS}, s-maxage=${LEADERBOARD_CACHE_SECONDS}`,
      'CDN-Cache-Control': `max-age=${LEADERBOARD_CACHE_SECONDS}`,
    },
  });
}
