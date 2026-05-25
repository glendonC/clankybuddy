import { LEADERBOARD_CACHE_SECONDS, VALID_MODELS } from '../constants.js';
import type { AggregateRow } from '../dos/leaderboard.js';
import type { Env } from '../types.js';

interface LeaderboardResponse {
  models: AggregateRow[];
}

export async function handleLeaderboard(
  _request: Request,
  env: Env,
): Promise<Response> {
  // Fan out to one LeaderboardDO per model in parallel. Each DO is a small
  // single-row read; total wall time ≈ max(individual DO latencies) plus a
  // small JSON serialize.
  const lookups = VALID_MODELS.map(async (model_id) => {
    const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName(model_id));
    const row = await stub.get();
    // get() may return an empty model_id when the DO has never seen a merge;
    // stamp the canonical id from the namespace key so the response is
    // uniform.
    return {
      model_id,
      help_count: row.help_count,
      hurt_count: row.hurt_count,
      last_updated: row.last_updated,
    };
  });

  const models = await Promise.all(lookups);
  const body: LeaderboardResponse = { models };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Edge cache at the colo. Both Cache-Control (browser + intermediate
      // caches) and CDN-Cache-Control (Cloudflare-specific override) are
      // set so a cookie-less GET can ride the colo cache for 30s.
      'Cache-Control': `public, max-age=${LEADERBOARD_CACHE_SECONDS}, s-maxage=${LEADERBOARD_CACHE_SECONDS}`,
      'CDN-Cache-Control': `max-age=${LEADERBOARD_CACHE_SECONDS}`,
    },
  });
}
