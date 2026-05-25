// Cross-package wire constants (CHAT_MAX_HISTORY, CHAT_MAX_MESSAGE_LENGTH,
// GLOBAL_ROOM_ID, etc.) live in @clankybuddy/shared and are re-exported below
// so existing worker imports keep working. Worker-only operational constants
// (TTLs, cron caps, moderation thresholds) stay here.
export {
  CHAT_MAX_HISTORY,
  CHAT_MAX_MESSAGE_LENGTH,
  GLOBAL_ROOM_ID,
} from '../../shared/src/chat.js';

export const CHAT_MAX_PER_MINUTE = 10;
export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
// Matches backend.md spec's CF-KV-minimum baseline (60s) and gives the TUI's
// exponential reconnect (1s, 2s, 4s, 8s) at least one full pass before expiry.
export const TICKET_TTL_MS = 60_000;
export const TOKEN_TTL_SEC = 90 * 24 * 60 * 60;
// Refresh tokens hold for 30d sliding (chinmeister:auth.ts:175-178). Issued
// alongside every access token; consumed only by /auth/refresh which deletes
// and re-issues atomically.
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

// Phase 4F: per-cron-tick caps so a mass-erase or appeal flood doesn't melt
// the DO. Bound work, log overflow, let the next tick drain the rest.
// Sized for ~14,400 jobs/day (10 jobs/tick × 1440 ticks/day), which covers
// 100-user (steady ~2/wk) and 500-user (worst-case burst ~150/72h) loads
// with headroom. Bumping only matters past ~10k DAU.
export const ERASE_JOBS_PER_TICK = 10;
export const APPEALS_PER_TICK = 50;

// Plan C: stale-running reclaim window. Erase jobs stuck in status='running'
// past this threshold are re-claimed on the next tick. Closes the
// compliance hole where a worker crash mid-erase leaves a row in 'running'
// forever, without a reclaim path, the user's data sits un-tombstoned
// until ops manually intervenes. Idempotent retry: revokeTokens,
// scrubByUserId, and tombstoneUser all no-op on a second pass.
export const STALE_RUNNING_MS = 60 * 60 * 1000;
// Run appeals every 10 minutes; erase every 1 minute. The cron fires every
// minute; the appeals branch self-throttles by checking minute-of-hour.
export const APPEALS_INTERVAL_MIN = 10;

// Bloom-filter refresh cadence. Each RoomDO pulls the latest revocation set
// from DatabaseDO at most once per BLOOM_REFRESH_INTERVAL_MS; backend-plan
// commits to ≤60s propagation.
export const BLOOM_REFRESH_INTERVAL_MS = 60_000;

// CSAM evidence retention under GDPR Article 17(3)(b), flagged-CSAM artifacts
// are preserved 90 days regardless of erasure requests, justified for LE
// preservation. Documented in the privacy policy.
export const CSAM_PRESERVE_DAYS = 90;
export const CSAM_PRESERVE_MS = CSAM_PRESERVE_DAYS * 24 * 60 * 60_000;

// Appeal cron review thresholds (backend-plan §7f).
export const APPEAL_OVERTURN_CONFIDENCE = 0.85;
export const APPEAL_HUMAN_REVIEW_BELOW = 0.7;
// 1% of upheld decisions sampled into the human queue regardless.
export const APPEAL_UPHOLD_SAMPLE_RATE = 0.01;

// Per-IP account creation limit (hourly window). Layered ASN/subnet ladder
// is a Phase 3 concern, Phase 1 ports just the per-IP-per-hour cap from KV
// to DatabaseDO so the check-and-consume is one transaction.
export const ACCOUNT_CREATE_PER_IP_PER_HOUR = 5;

// Sweep expired tickets out of DatabaseDO on this cadence. The DELETE-
// RETURNING consume already enforces expiry; the sweep is purely to keep
// the table from accreting dead rows.
export const TICKET_SWEEP_INTERVAL_MS = 5 * 60_000;

// DatabaseDO alarm cadence. The DO's single alarm dispatcher fans out to both
// the ticket sweep (every TICKET_SWEEP_INTERVAL_MS) and the moderation counter
// drain (every MODERATION_COUNTER_FLUSH_MS). The actual setAlarm picks the
// smaller of the two remaining intervals so neither work item starves.
export const MODERATION_COUNTER_FLUSH_MS = 60_000;

// Estimated USD per Tier 2 (Llama Guard) call. Used by the kill switch to
// project cumulative daily cost from the in-memory counter. Conservative
// floor, re-tune once Workers AI billing data is observed.
export const ESTIMATED_COST_PER_CALL_USD = 0.0001;

export { VALID_COLORS } from '../../shared/src/colors.js';
export { TUI_USER_AGENT_PREFIX } from '../../shared/src/agents.js';

import {
  PROD_ORIGINS as SHARED_PROD_ORIGINS,
  DEV_ORIGINS as SHARED_DEV_ORIGINS,
} from '../../shared/src/urls.js';

// Sets are the runtime-friendly form for origin allowlist checks; shared
// keeps them as readonly string[] so non-DOM consumers (cli) can list them
// without pulling in a Set polyfill or spec.
export const PROD_ORIGINS = new Set(SHARED_PROD_ORIGINS);
export const DEV_ORIGINS = new Set(SHARED_DEV_ORIGINS);

// ---- Game-side schema (Phase 3E) ----

// 16 ActionShardDO instances, keyed by the first hex character of the user_id
// (UUIDs are hex; one nibble = 16 buckets). Resplit story is documented in
// dos/action_shard.ts.
export const ACTION_SHARD_COUNT = 16;
export const ACTION_SHARD_IDS: readonly string[] = Array.from(
  { length: ACTION_SHARD_COUNT },
  (_, i) => i.toString(16),
);

// Cap a single /actions/batch call. Both bound the per-call cost and limit
// transactional INSERT count inside the DO.
export const ACTION_BATCH_MAX_ITEMS = 100;
export const ACTION_BATCH_MAX_TOTAL_COUNT = 5000;
export const ACTION_ITEM_MIN_COUNT = 1;
export const ACTION_ITEM_MAX_COUNT = 1000;

// AI models in the roster. Server-side validated; unknown model_ids are
// rejected at /actions/batch and /events/batch with 422. Source of truth
// is the shared PERSONA_IDS tuple in @clankybuddy/shared/personas, this
// re-export keeps existing worker imports (VALID_MODELS, ModelId) working
// unchanged while guaranteeing the wire-format model id list, the web
// client's persona registry, and event-schema model fields cannot drift.
export { PERSONA_IDS as VALID_MODELS } from '../../shared/src/personas.js';
export type { ModelId } from '../../shared/src/personas.js';
import { PERSONA_IDS as VALID_MODELS_INTERNAL } from '../../shared/src/personas.js';
import type { ModelId as ModelIdInternal } from '../../shared/src/personas.js';
// Set form for hot-path consumers (origin/model allowlist checks). Built
// once at module load; consumers that already build a local Set (e.g.
// routes/actions.ts) keep working, this export is additive.
export const VALID_MODEL_SET: ReadonlySet<ModelIdInternal> = new Set(VALID_MODELS_INTERNAL);

// Verb → polarity bucket. Source of truth lives in @clankybuddy/shared/verbs
// so the worker, web, and TUI all agree on which verbs are help / hurt /
// utility. Re-exported here so existing `import { VERB_POLARITY } from '../constants.js'`
// call sites keep working without churn.
//
// Behavior change vs. the old inline map: `freeze` and `grab` are now
// 'utility' (combo setup / cursor primitive, not leaderboard-eligible),
// and unknown verbs return undefined. The aggregation cron reads polarityFor
// directly and drops unknown verbs with a log line rather than silently
// bucketing them into 'hurt'.
export {
  VERB_POLARITY,
  polarityFor,
  isLeaderboardVerb,
  type VerbPolarity,
} from '../../shared/src/verbs.js';

// Aggregation cron: minute granularity is the Cloudflare floor. The plan
// targets a ≤60s leaderboard staleness budget, so one-minute is acceptable.
export const AGGREGATION_CRON = '*/1 * * * *';

// Public leaderboard cache TTL. Plan §"Caching strategy", 30s edge cache.
export const LEADERBOARD_CACHE_SECONDS = 30;
// Per-user stats read cache TTL. Keep response private because it is bearer-
// scoped; callers may reuse it briefly without exposing it cross-user.
export const ME_STATS_CACHE_SECONDS = 30;

// KV key for per-shard rollup cursors. JSON: Record<shardId, ms-timestamp>.
export const AGGREGATION_CURSORS_KV_KEY = 'agg:cursors';

// batch_dedupe rows older than this are evicted by ActionShardDO.sweep().
export const BATCH_DEDUPE_TTL_MS = 24 * 60 * 60_000;
// Cadence at which sweep() runs (piggy-backs on the DO alarm pattern).
export const ACTION_SHARD_SWEEP_INTERVAL_MS = 60 * 60_000;

// Event log hot retention. Events older than this are dropped by the DO
// sweep. R2 archive (TODO) holds the cold copy; aggregator counters are
// already in user_actions and survive the events evictions.
//
// 30d is the lower bound for "user opens the app once a month and we still
// have their session arc"; bump if cron-derived aggregates need a wider
// recompute window.
export const EVENTS_HOT_RETENTION_MS = 30 * 24 * 60 * 60_000;

// Per-/events/batch limits. EVENT_BATCH_MAX_ITEMS bounds DO transaction
// size; EVENT_MAX_BYTES_SERVER bounds per-row JSON. Client constants
// (FLUSH_MAX_BATCH = 50, EVENT_MAX_BYTES = 1024) sit comfortably under
// these so a well-behaved client never trips them.
export const EVENT_BATCH_MAX_ITEMS = 200;
export const EVENT_MAX_BYTES_SERVER = 4096;

// Whitelist of accepted event types. Adding a new type requires:
//   1. Add to this set
//   2. Add to GameEvent union in packages/shared/src/events.ts
//   3. (Optional) Add a server-side aggregator if the type drives a stat
// Order mirrors the discriminated-union order in events.ts for grep-ability.
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'session_start',
  'session_end',
  'tool_fire',
  'hit_landed',
  'mood_transition',
  'status_applied',
  'status_expired',
  'combo_completed',
  'character_switch',
  'tool_equip',
  'currency_earned',
  'currency_spent',
  'unlock_purchased',
  'settings_changed',
]);

// Crockford-base32 ULID, 26 chars. Client emits these; we validate format
// (not entropy) so a typo doesn't permanently consume an event_id slot.
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
