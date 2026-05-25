import { authenticate } from '../auth.js';
import type { UserStateResponse } from '../dos/action_shard.js';
import type { Env } from '../types.js';

// /me/state, read-only snapshot of the user's current play state, used
// by the AI-feedback bridge poller in the TUI (~5s cadence, file-bridge
// semantics: writes to ~/.clankybuddy/state.json so AI assistants can
// read it and adjust tone). Source of truth is the events log inside
// the per-user ActionShardDO; we shard on the first hex char of the
// user_id to match the rest of the event/stats pipeline.
//
// Caching: 3s edge cache via Cache-Control. Matches the 5s poll cadence
// (small leeway for clock skew) so a misbehaving client looping faster
// than 5s still doesn't pound the DO. The route ALSO enforces an
// in-memory per-user 1/3s rate limit; the cache and rate limit are
// belt-and-suspenders, the cache absorbs same-content repeats, the
// rate limit absorbs different-content abuse.
const STATE_CACHE_SECONDS = 3;

// Per-user in-memory rate limiter. Keyed by user_id; each entry is the
// last-allowed epoch ms. A request within 3s of the last allowed call
// for the same user gets 429 + Retry-After: 3. The map is per-isolate
// (Cloudflare Workers can swap isolates between requests), so the
// limit is best-effort, a sufficiently load-balanced burst can punch
// through. Combined with the 3s edge cache, that's acceptable: cache
// catches near-identical reads, rate limit catches "different bearer,
// same user, hammering" without needing KV writes on the hot path.
const STATE_RATE_LIMIT_MS = 3_000;
const lastAllowedByUser = new Map<string, number>();

// Bound the map so a long-running isolate seeing many users doesn't
// retain entries forever. We don't need exact LRU; once the map exceeds
// MAX_USERS we drop the oldest 25% by iteration order (Map preserves
// insertion order). Cheaper than a heap on the hot path.
const RATE_LIMIT_MAX_USERS = 10_000;

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

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const last = lastAllowedByUser.get(userId);
  if (last != null && now - last < STATE_RATE_LIMIT_MS) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((STATE_RATE_LIMIT_MS - (now - last)) / 1_000),
    );
    return { allowed: false, retryAfterSec };
  }
  if (lastAllowedByUser.size > RATE_LIMIT_MAX_USERS) {
    // Drop the oldest 25% by insertion order. Cheap evict; the keys we
    // keep are the most-recently-active users (best heuristic for the
    // working set without per-entry LRU bookkeeping).
    const drop = Math.ceil(RATE_LIMIT_MAX_USERS / 4);
    let i = 0;
    for (const k of lastAllowedByUser.keys()) {
      if (i++ >= drop) break;
      lastAllowedByUser.delete(k);
    }
  }
  lastAllowedByUser.set(userId, now);
  return { allowed: true, retryAfterSec: 0 };
}

export async function handleMeState(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const rl = checkRateLimit(user.id);
  if (!rl.allowed) {
    return jsonResponse(
      { error: 'rate_limited' },
      429,
      { 'Retry-After': String(rl.retryAfterSec) },
    );
  }

  const shardId = shardIdFor(user.id);
  const stub = env.ACTION_SHARD.get(env.ACTION_SHARD.idFromName(shardId));
  const body: UserStateResponse = await stub.readUserState(user.id);

  return jsonResponse(body, 200, {
    // private: bearer-scoped. max-age=3 matches the 5s poll cadence with
    // a small leeway for clock skew; Cloudflare won't share this between
    // users because of the bearer-token differentiation.
    'Cache-Control': `private, max-age=${STATE_CACHE_SECONDS}`,
  });
}
