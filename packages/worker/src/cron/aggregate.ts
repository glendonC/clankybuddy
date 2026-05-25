import { getDb } from '../auth.js';
import {
  ACTION_SHARD_IDS,
  AGGREGATION_CURSORS_KV_KEY,
  ESTIMATED_COST_PER_CALL_USD,
  polarityFor,
} from '../constants.js';
import type { RollupResult } from '../dos/action_shard.js';
import { logEvent } from '../observability.js';
import type { Env } from '../types.js';

type ModerationMode = 'full' | 'regex_only' | 'block_all' | 'open';
const MOD_VALID_MODES: ReadonlySet<ModerationMode> = new Set([
  'full', 'regex_only', 'block_all', 'open',
]);
const MOD_OVERRIDE_KEY = 'cfg:moderation_mode';

function coerceMode(raw: string | null | undefined): ModerationMode | null {
  if (!raw) return null;
  return MOD_VALID_MODES.has(raw as ModerationMode)
    ? (raw as ModerationMode)
    : null;
}

// Plan B 2026-05-15: emit one mod_cost_snapshot AE row per cron invocation.
// Gives the moderation dashboard a continuous baseline even at zero tier-2
// traffic. ~1440 rows/day vs AE's 25B/month cap is rounding error. Inside
// withCronLock so the singleton guarantee carries over and we don't
// double-write during deploy overlaps.
async function emitModCostSnapshot(env: Env): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const kvCount = parseInt(
      (await env.AUTH_KV.get(`mcount:${day}`)) ?? '0',
      10,
    );
    let pending = 0;
    try {
      pending = await getDb(env).readPendingGlobalDelta();
    } catch {
      // DO unreachable, KV-only snapshot is still useful; pending stays 0.
    }
    const overrideRaw = await env.AUTH_KV.get(MOD_OVERRIDE_KEY);
    const override = coerceMode(overrideRaw);
    const envFloor = coerceMode(env.MODERATION_MODE);
    const mode: ModerationMode = override ?? envFloor ?? 'full';
    const source = override ? 'kv_override' : envFloor ? 'env_floor' : 'default';

    let top: { user_id: string; calls: number }[] = [];
    try {
      top = await getDb(env).getTopSpenders(day);
    } catch {
      // Top-spenders snapshot is best-effort; missing it shouldn't void
      // the cost row that's the actual point of this event.
    }

    const calls = kvCount + pending;
    const costUsd = calls * ESTIMATED_COST_PER_CALL_USD;
    const budgetUsd = Number(env.MODERATION_DAILY_BUDGET_USD);
    const budget =
      Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;

    // Encode top-3 user_ids + counts into the detail blob so a single AE
    // row carries the snapshot. Format: "u1:n1,u2:n2,u3:n3", terse,
    // grep-friendly, fits in a single AE blob.
    const top3 = top.slice(0, 3).map((r) => `${r.user_id}:${r.calls}`).join(',');

    logEvent(
      env,
      {
        event_type: 'mod_cost_snapshot',
        decision: mode,
        detail: top3 || undefined,
        rep_band: source,
      },
      {
        value: calls,
        cost_usd: costUsd,
        budget_usd: budget,
        pending_delta: pending,
      },
    );
  } catch (err) {
    // Snapshot is observability, never let it fail the aggregation tick.
    console.error(
      JSON.stringify({ evt: 'mod_cost_snapshot_failed', err: String(err) }),
    );
  }
}

type CursorMap = Record<string, number>;

interface ShardRollup {
  shardId: string;
  result: RollupResult | null;
  err: unknown;
}

// LEADERBOARD-COUNTS CHANGE (per workstream A2): unknown verbs and verbs
// classed as 'utility' (freeze, grab) are no longer bucketed into 'hurt'.
// Unknown verbs are dropped with the existing aggregation_unknown_verbs log
// line; utility verbs are dropped with a parallel aggregation_utility_verbs
// line. This means the leaderboard now reflects only verbs the polarity
// map explicitly classes as help or hurt, anything ambiguous shows up in
// observability instead of corrupting counts.
//
// Pull deltas off every ActionShardDO in parallel, group by (model_id,
// help|hurt), merge into per-model LeaderboardDO. Cursor advance is gated
// on a successful rollup; failure leaves the cursor at the previous value
// so the next cron tick re-tries the same range.
//
// MERGE-THEN-MARK ORDER (fix #5): the cron now (1) previews deltas via
// rollupSince(), (2) merges to each affected LeaderboardDO with a
// (shard_id, max_t) dedup tuple, (3) only then calls commitRollup() to
// advance rolled_up_count. A transient merge failure leaves the
// rolled_up_count untouched, the next tick re-reads the same deltas and
// retries. The LeaderboardDO's per-shard cursor absorbs duplicate merges
// arriving with the same (shard_id, max_t) so the final count is correct
// when the retry succeeds.
//
// Singleton invariant: Cloudflare cron triggers fire one ScheduledController
// at a time per Worker deployment. The cron lock around runAggregation
// (see index.ts withCronLock) tightens this against deploy-time overlaps.
export async function runAggregation(
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  // Plan B 2026-05-15: continuous moderation cost baseline. Runs first so
  // a later aggregation failure doesn't lose the row for this tick.
  await emitModCostSnapshot(env);

  const cursorsRaw = await env.AUTH_KV.get(AGGREGATION_CURSORS_KV_KEY);
  const cursors: CursorMap = cursorsRaw ? safeParseCursors(cursorsRaw) : {};

  const rollups = await Promise.all(
    ACTION_SHARD_IDS.map(async (shardId): Promise<ShardRollup> => {
      const cursor = cursors[shardId] ?? 0;
      try {
        const stub = env.ACTION_SHARD.get(
          env.ACTION_SHARD.idFromName(shardId),
        );
        const result = await stub.rollupSince(cursor);
        return { shardId, result, err: null };
      } catch (err) {
        return { shardId, result: null, err };
      }
    }),
  );

  // Group all successful deltas by (shardId, model_id) → { help, hurt }.
  // 'utility' verbs and unknown verbs are dropped (no leaderboard
  // contribution) but counted into separate observability buckets so we
  // can track:
  //   - utility traffic volume (expected; sanity check it's not the bulk)
  //   - unknown verbs (a sign of a client shipping a tool the worker hasn't
  //     learned about, fix the polarity map, not the data).
  type Bucket = { help: number; hurt: number };
  // shardId → modelId → Bucket. Per-shard scoping matters because each
  // (shard, model) merge carries its own (shard_id, max_t) dedup tuple.
  const perShardModel = new Map<string, Map<string, Bucket>>();
  // shardId → max_t observed for this rollup. The merge dedup uses this.
  const shardMaxT = new Map<string, number>();
  let unknownVerbCount = 0;
  const unknownVerbs = new Set<string>();
  let utilityVerbCount = 0;
  const utilityVerbs = new Set<string>();

  const successfulCursors: CursorMap = {};
  for (const r of rollups) {
    if (!r.result) {
      console.error(
        JSON.stringify({
          evt: 'aggregation_shard_failed',
          shard: r.shardId,
          err: String(r.err),
        }),
      );
      continue;
    }
    successfulCursors[r.shardId] = r.result.new_cursor;
    shardMaxT.set(r.shardId, r.result.new_cursor);
    let modelMap = perShardModel.get(r.shardId);
    for (const d of r.result.deltas) {
      const polarity = polarityFor(d.verb);
      if (polarity === 'utility') {
        utilityVerbCount += d.count;
        utilityVerbs.add(d.verb);
        continue;
      }
      if (polarity === undefined) {
        unknownVerbCount += d.count;
        unknownVerbs.add(d.verb);
        continue;
      }
      if (!modelMap) {
        modelMap = new Map<string, Bucket>();
        perShardModel.set(r.shardId, modelMap);
      }
      let b = modelMap.get(d.model_id);
      if (!b) {
        b = { help: 0, hurt: 0 };
        modelMap.set(d.model_id, b);
      }
      b[polarity] += d.count;
    }
  }

  // Fan out merges to each affected (shard, model) LeaderboardDO in
  // parallel. Each merge call carries (shard_id, max_t) so the LB DO can
  // dedupe duplicate retries, see leaderboard.ts:merge().
  //
  // Consistency model (post-fix-#5): rolled_up_count is NOT advanced
  // until commitRollup() runs below, gated on every merge for that
  // shard succeeding. A transient merge failure leaves the deltas
  // pending; next tick retries.
  type MergeOutcome = {
    shardId: string;
    modelId: string;
    ok: boolean;
    help: number;
    hurt: number;
  };
  const mergeJobs: Promise<MergeOutcome>[] = [];
  for (const [shardId, modelMap] of perShardModel) {
    const maxT = shardMaxT.get(shardId) ?? 0;
    for (const [modelId, bucket] of modelMap) {
      mergeJobs.push(
        (async (): Promise<MergeOutcome> => {
          try {
            const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName(modelId));
            await stub.merge({
              model_id: modelId,
              help_delta: bucket.help,
              hurt_delta: bucket.hurt,
              shard_id: shardId,
              max_t: maxT,
            });
            return {
              shardId,
              modelId,
              ok: true,
              help: bucket.help,
              hurt: bucket.hurt,
            };
          } catch (err) {
            console.error(
              JSON.stringify({
                evt: 'leaderboard_merge_failed',
                shard_id: shardId,
                model_id: modelId,
                help_delta_pending: bucket.help,
                hurt_delta_pending: bucket.hurt,
                err: String(err),
              }),
            );
            return {
              shardId,
              modelId,
              ok: false,
              help: bucket.help,
              hurt: bucket.hurt,
            };
          }
        })(),
      );
    }
  }
  const mergeOutcomes = await Promise.all(mergeJobs);

  // ── Daily-merge fan-out (Stage 2 global-benchmark overlay) ─────────
  // Walk every successful rollup's daily_deltas and fan out
  // LeaderboardDO.mergeDaily() calls in parallel. Each call carries the
  // same (shard_id, max_t) tuple as its flat-merge sibling so the LB DO
  // can dedupe; see leaderboard.ts mergeDaily() for the cursor-write
  // trade-off (rides the cursor written by merge() above).
  //
  // Bucket key: (shardId, modelId, day_utc), within one rollup the
  // ActionShardDO already pre-groups by (model_id, day_utc), but
  // re-bucketing here defends against any future change to the
  // emitter and gives us one mergeDaily call per (model, day).
  type DailyBucket = { help: number; hurt: number };
  // shardId → modelId → day_utc → DailyBucket
  const perShardModelDay = new Map<
    string,
    Map<string, Map<string, DailyBucket>>
  >();
  for (const r of rollups) {
    if (!r.result) continue;
    for (const d of r.result.daily_deltas) {
      let modelMap = perShardModelDay.get(r.shardId);
      if (!modelMap) {
        modelMap = new Map();
        perShardModelDay.set(r.shardId, modelMap);
      }
      let dayMap = modelMap.get(d.model_id);
      if (!dayMap) {
        dayMap = new Map();
        modelMap.set(d.model_id, dayMap);
      }
      let bucket = dayMap.get(d.day_utc);
      if (!bucket) {
        bucket = { help: 0, hurt: 0 };
        dayMap.set(d.day_utc, bucket);
      }
      bucket.help += d.help_delta;
      bucket.hurt += d.hurt_delta;
    }
  }

  type DailyMergeOutcome = {
    shardId: string;
    modelId: string;
    dayUtc: string;
    ok: boolean;
  };
  const dailyJobs: Promise<DailyMergeOutcome>[] = [];
  for (const [shardId, modelMap] of perShardModelDay) {
    const maxT = shardMaxT.get(shardId) ?? 0;
    for (const [modelId, dayMap] of modelMap) {
      for (const [dayUtc, bucket] of dayMap) {
        dailyJobs.push(
          (async (): Promise<DailyMergeOutcome> => {
            try {
              const stub = env.LEADERBOARD.get(
                env.LEADERBOARD.idFromName(modelId),
              );
              await stub.mergeDaily({
                model_id: modelId,
                day_utc: dayUtc,
                help_delta: bucket.help,
                hurt_delta: bucket.hurt,
                shard_id: shardId,
                max_t: maxT,
              });
              return { shardId, modelId, dayUtc, ok: true };
            } catch (err) {
              console.error(
                JSON.stringify({
                  evt: 'leaderboard_daily_merge_failed',
                  shard_id: shardId,
                  model_id: modelId,
                  day_utc: dayUtc,
                  help_delta_pending: bucket.help,
                  hurt_delta_pending: bucket.hurt,
                  err: String(err),
                }),
              );
              return { shardId, modelId, dayUtc, ok: false };
            }
          })(),
        );
      }
    }
  }
  const dailyOutcomes = await Promise.all(dailyJobs);

  // Per-shard merge gate: a shard is committable only when every merge
  // for that shard's deltas succeeded. Any failure (flat OR daily) parks
  // the shard for retry on the next tick (rolled_up_count stays put).
  // Preserves the existing "merge succeeds before commit" idempotency.
  const shardFailures = new Set<string>();
  for (const o of mergeOutcomes) {
    if (!o.ok) shardFailures.add(o.shardId);
  }
  for (const o of dailyOutcomes) {
    if (!o.ok) shardFailures.add(o.shardId);
  }

  // Commit rolled_up_count for every shard that previewed cleanly AND
  // had no merge failures. Shards with no deltas are no-ops to commit
  // but cheap to call; we skip them to avoid the round-trip.
  const commitJobs: Promise<unknown>[] = [];
  for (const r of rollups) {
    if (!r.result) continue;
    if (shardFailures.has(r.shardId)) continue;
    if (r.result.deltas.length === 0) continue;
    const cursorBefore = cursors[r.shardId] ?? 0;
    const maxT = r.result.new_cursor;
    const stub = env.ACTION_SHARD.get(env.ACTION_SHARD.idFromName(r.shardId));
    commitJobs.push(
      stub
        .commitRollup(cursorBefore, maxT)
        .catch((err) => {
          console.error(
            JSON.stringify({
              evt: 'commit_rollup_failed',
              shard: r.shardId,
              err: String(err),
            }),
          );
        }),
    );
  }
  await Promise.all(commitJobs);

  // Persist cursor only for shards we successfully committed. Failed-merge
  // shards keep their old cursor so the next preview re-reads the same
  // (or wider, if new ingests arrived) range.
  const next: CursorMap = { ...cursors };
  for (const [shardId, cursor] of Object.entries(successfulCursors)) {
    if (!shardFailures.has(shardId)) {
      next[shardId] = cursor;
    }
  }
  ctx.waitUntil(
    env.AUTH_KV.put(AGGREGATION_CURSORS_KV_KEY, JSON.stringify(next)),
  );

  const failedMerges = mergeOutcomes.filter((o) => !o.ok);
  const failedDailyMerges = dailyOutcomes.filter((o) => !o.ok);
  if (failedMerges.length > 0 || failedDailyMerges.length > 0) {
    console.error(
      JSON.stringify({
        evt: 'aggregation_partial_failure',
        failed_merges: failedMerges.map((o) => ({
          shard_id: o.shardId,
          model_id: o.modelId,
        })),
        failed_daily_merges: failedDailyMerges.map((o) => ({
          shard_id: o.shardId,
          model_id: o.modelId,
          day_utc: o.dayUtc,
        })),
      }),
    );
  }

  if (unknownVerbCount > 0) {
    console.log(
      JSON.stringify({
        evt: 'aggregation_unknown_verbs',
        verbs: [...unknownVerbs],
        total_count: unknownVerbCount,
      }),
    );
  }
  if (utilityVerbCount > 0) {
    console.log(
      JSON.stringify({
        evt: 'aggregation_utility_verbs',
        verbs: [...utilityVerbs],
        total_count: utilityVerbCount,
      }),
    );
  }
}

function safeParseCursors(s: string): CursorMap {
  try {
    const parsed: unknown = JSON.parse(s);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: CursorMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
