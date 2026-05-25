import { authenticate } from '../auth.js';
import {
  EVENTS_HOT_RETENTION_MS,
  ME_STATS_CACHE_SECONDS,
} from '../constants.js';
import type {
  MeStatsResponse,
  StatsGranularity,
} from '../../../shared/src/events.js';
import type { Env } from '../types.js';

// KV+SWR cache TTLs. Fresh (≤30s) → return as-is. Stale (≤120s) → return
// stale immediately and kick off a background refetch via ctx.waitUntil.
// Past STALE → synchronous DO read. The 30/120 split mirrors the
// Cache-Control: max-age=30 header, the browser ring stays in lock-step
// with the worker ring.
const CACHE_FRESH_MS = 30_000;
const CACHE_STALE_MS = 120_000;

interface CacheEntry {
  body: MeStatsResponse;
  // Epoch ms when this entry was written.
  written_at: number;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function shardIdFor(userId: string): string {
  const slice = userId.startsWith('u_') ? userId.slice(2) : userId;
  const ch = slice.charAt(0).toLowerCase();
  return /^[0-9a-f]$/.test(ch) ? ch : '0';
}

function parseGranularity(value: string | null): StatsGranularity | null {
  if (value == null) return 'day';
  if (value === 'hour' || value === 'day' || value === 'all') return value;
  return null;
}

function parseIsoParam(value: string | null): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

// Round a millis timestamp DOWN to the granularity boundary. Used to align
// `until` so two calls within the same hour/day land on the same cache key.
// `since` is also rounded so a sliding-window dashboard request collapses
// onto a stable key. `all` collapses every timestamp to a single bucket so
// the cache key is independent of the (ignored) since/until.
function roundToGranularity(ts: number, granularity: StatsGranularity): number {
  if (granularity === 'all') return 0;
  const size = granularity === 'hour' ? 60 * 60_000 : 24 * 60 * 60_000;
  return Math.floor(ts / size) * size;
}

function cacheKey(
  userId: string,
  since: number,
  until: number,
  granularity: StatsGranularity,
): string {
  return `me_stats:${userId}:${since}:${until}:${granularity}`;
}

async function readDoStats(
  env: Env,
  userId: string,
  since: number,
  until: number,
  granularity: StatsGranularity,
): Promise<MeStatsResponse> {
  const shardId = shardIdFor(userId);
  const stub = env.ACTION_SHARD.get(env.ACTION_SHARD.idFromName(shardId));
  return stub.readUserStats({
    user_id: userId,
    since,
    until,
    granularity,
  });
}

async function refreshCache(
  env: Env,
  key: string,
  userId: string,
  since: number,
  until: number,
  granularity: StatsGranularity,
): Promise<MeStatsResponse> {
  const body = await readDoStats(env, userId, since, until, granularity);
  const entry: CacheEntry = { body, written_at: Date.now() };
  // expirationTtl bounds the worst-case storage; the freshness check on
  // read is the actual SWR gate. We use STALE+a small buffer so KV doesn't
  // evict an entry the SWR refetch is about to overwrite.
  await env.AUTH_KV.put(key, JSON.stringify(entry), {
    expirationTtl: Math.ceil((CACHE_STALE_MS + 30_000) / 1_000),
  });
  return body;
}

export async function handleMeStats(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const granularity = parseGranularity(url.searchParams.get('granularity'));
  if (!granularity) {
    return jsonResponse({ error: 'invalid_granularity' }, 400);
  }

  // For granularity='all', since/until are ignored, the cumulative counter
  // tables don't time-bound. We fill placeholders so the cache-key path
  // below stays uniform.
  const sinceRaw = url.searchParams.get('since');
  const untilRaw = url.searchParams.get('until');

  let since: number;
  let until: number;
  if (granularity === 'all') {
    since = 0;
    until = Date.now();
  } else {
    const parsedSince = parseIsoParam(sinceRaw);
    if (parsedSince == null) {
      return jsonResponse({ error: 'invalid_since' }, 400);
    }
    const parsedUntil = untilRaw == null ? Date.now() : parseIsoParam(untilRaw);
    if (parsedUntil == null) {
      return jsonResponse({ error: 'invalid_until' }, 400);
    }
    if (parsedSince > parsedUntil) {
      return jsonResponse({ error: 'since_in_future' }, 400);
    }
    since = parsedSince;
    until = parsedUntil;
  }

  // Hot-window clamp only applies to event-scan granularities. The all-time
  // path reads cumulative counters that aren't bounded by event retention.
  const hotSince = granularity === 'all'
    ? since
    : Math.max(since, Date.now() - EVENTS_HOT_RETENTION_MS);
  const effectiveSince = Math.min(hotSince, until);

  // Round both endpoints to the granularity boundary so rapid repeat reads
  // (every-few-seconds dashboard polls) collide on a single cache key
  // instead of spraying the DO with reads. Trade off: the response window
  // shown to the client is a multiple-of-granularity-aligned slice, which
  // is consistent with how the timeseries buckets are pre-rolled anyway.
  const cachedSince = roundToGranularity(effectiveSince, granularity);
  const cachedUntil = roundToGranularity(until, granularity);
  const key = cacheKey(user.id, cachedSince, cachedUntil, granularity);

  const cachedRaw = await env.AUTH_KV.get(key);
  let body: MeStatsResponse | null = null;
  let cacheStatus: 'fresh' | 'stale' | 'miss' = 'miss';
  if (cachedRaw) {
    try {
      const entry = JSON.parse(cachedRaw) as CacheEntry;
      const age = Date.now() - entry.written_at;
      if (age <= CACHE_FRESH_MS) {
        body = entry.body;
        cacheStatus = 'fresh';
      } else if (age <= CACHE_STALE_MS) {
        body = entry.body;
        cacheStatus = 'stale';
        // Background refresh, the user gets the stale body now, the next
        // request gets a fresh one. ctx.waitUntil keeps the request alive
        // long enough for the put to complete after the response ships.
        if (ctx) {
          ctx.waitUntil(
            refreshCache(env, key, user.id, cachedSince, cachedUntil, granularity)
              .catch(() => { /* swallow, telemetry is below */ }),
          );
        }
      }
    } catch {
      // Corrupt cache row, fall through to a fresh DO read.
    }
  }

  if (!body) {
    body = await refreshCache(
      env,
      key,
      user.id,
      cachedSince,
      cachedUntil,
      granularity,
    );
  }

  return jsonResponse(body, 200, {
    'Cache-Control': `private, max-age=${ME_STATS_CACHE_SECONDS}`,
    'X-Clanky-Stats-Retention': `hot=${Math.floor(EVENTS_HOT_RETENTION_MS / 86_400_000)}d`,
    'X-Clanky-Stats-Cache': cacheStatus,
    ...(granularity !== 'all' && hotSince !== since
      ? { 'X-Clanky-Stats-Window-Clamped': 'true' }
      : {}),
  });
}
