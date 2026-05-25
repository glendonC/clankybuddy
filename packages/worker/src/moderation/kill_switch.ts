import { getDb } from '../auth.js';
import { logEvent } from '../observability.js';
import type { Env } from '../types.js';

export type ModerationMode = 'full' | 'regex_only' | 'block_all' | 'open';

const MODE_OVERRIDE_KEY = 'cfg:moderation_mode';
const VALID_MODES: ReadonlySet<ModerationMode> = new Set([
  'full', 'regex_only', 'block_all', 'open',
]);

function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(now: number = Date.now()): number {
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  // setAlarm-style TTL must be at least 1s. The KV `expirationTtl` minimum is
  // 60s; clamp here so the override genuinely covers the budget window.
  return Math.max(60, Math.floor((tomorrow.getTime() - now) / 1000));
}

function coerceMode(raw: string | null | undefined): ModerationMode | null {
  if (!raw) return null;
  return VALID_MODES.has(raw as ModerationMode) ? (raw as ModerationMode) : null;
}

export async function effectiveMode(env: Env): Promise<ModerationMode> {
  const override = coerceMode(await env.AUTH_KV.get(MODE_OVERRIDE_KEY));
  if (override) return override;
  const floor = coerceMode(env.MODERATION_MODE);
  return floor ?? 'full';
}

// Tightened from 80% → 70% to absorb the worst-case lag between an
// in-memory accumulator pending flush and the KV-backed counter the kill
// switch reads. The flush cadence (MODERATION_COUNTER_FLUSH_MS) means up
// to one window of overspend can sit invisible to a pure KV read; pulling
// the threshold down + reading the live in-flight accumulator (see
// readPendingGlobalDelta) closes the gap.
const KILL_SWITCH_THRESHOLD_FRACTION = 0.7;

// `mcount:<utc-day>` increment. We sum the live (in-memory, pending-flush)
// DO accumulator + the KV-backed counter on EVERY tier-2 call so the kill
// switch decision uses cumulative cost regardless of where the increment
// landed. At threshold, we flush the DO accumulator immediately and flip
// the override mode atomically (write to KV with TTL until next UTC
// midnight).
export async function bumpDailyAndMaybeFlip(
  env: Env,
  ctx: ExecutionContext,
  estCostUsd: number,
): Promise<void> {
  ctx.waitUntil(
    (async () => {
      const db = getDb(env);
      try {
        await db.incrementModerationCounters(1, {});
      } catch {
        // The DO may be momentarily unavailable; counter loss for a few calls
        // is acceptable per Challenger §4.3 (60s flush window already lossy).
      }

      const budget = Number(env.MODERATION_DAILY_BUDGET_USD);
      if (!Number.isFinite(budget) || budget <= 0) return;

      // Sum live in-memory pending + KV-backed counter to compute current
      // daily cost. The DO RPC returns its own pending delta without
      // mutating it, we still want the periodic flush to do the actual
      // KV write so concurrent tier-2 calls don't all race on the same key.
      let pending = 0;
      try {
        pending = await db.readPendingGlobalDelta();
      } catch {
        // Pending-read failure → treat as 0; KV-only check is the legacy
        // behavior and still degrades safely (later than ideal).
      }
      const kvCount = parseInt(
        (await env.AUTH_KV.get(`mcount:${utcDay()}`)) ?? '0',
        10,
      );
      const v = kvCount + pending;
      const costNow = v * estCostUsd;
      const prior = coerceMode(await env.AUTH_KV.get(MODE_OVERRIDE_KEY));
      const alreadyFlipped = prior === 'regex_only';

      if (costNow > budget * KILL_SWITCH_THRESHOLD_FRACTION && !alreadyFlipped) {
        // At threshold: flush the DO accumulator NOW so the KV counter
        // reflects the live state for any concurrent reader, then flip
        // the override mode atomically.
        try {
          await db.flushModerationCounters();
        } catch {
          // Flush failure is non-fatal for the flip, KV-side cumulative
          // cost may lag by one window but the override is still set.
        }
        await env.AUTH_KV.put(MODE_OVERRIDE_KEY, 'regex_only', {
          expirationTtl: secondsUntilUtcMidnight(),
        });
        // Renamed from `mode_flip` → `kill_switch_flip` for grep-ability
        // across logs / AE / dashboards. Carries cost-now, prior-mode,
        // new-mode (existing), budget, and the pending DO accumulator delta
        // so reviewers can reconstruct the exact state at flip time.
        logEvent(
          env,
          {
            event_type: 'kill_switch_flip',
            decision: 'regex_only',
            detail: prior ?? 'unset',
          },
          {
            value: v,
            cost_usd: costNow,
            budget_usd: budget,
            pending_delta: pending,
          },
        );
        // DUAL-WRITE: AE buffers + has access controls; console.log lands in
        // Logpush + `wrangler tail` immediately. Mirroring the payload here
        // means ops can grep flips without an AE query.
        console.log(
          JSON.stringify({
            evt: 'kill_switch_flip',
            ts: Date.now(),
            prior_mode: prior ?? 'unset',
            new_mode: 'regex_only',
            count: v,
            cost_now_usd: costNow,
            budget_usd: budget,
            pending_delta: pending,
          }),
        );
      }
    })(),
  );
}

export async function userBudgetExceeded(env: Env, userId: string): Promise<boolean> {
  const limit = Number(env.MODERATION_USER_DAILY_CALLS);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const raw = await env.AUTH_KV.get(`muser:${userId}:${utcDay()}`);
  const v = parseInt(raw ?? '0', 10);
  return v >= limit;
}

export async function bumpUserCounter(
  env: Env,
  ctx: ExecutionContext,
  userId: string,
): Promise<void> {
  ctx.waitUntil(
    (async () => {
      try {
        await getDb(env).incrementModerationCounters(0, { [userId]: 1 });
      } catch {
        // See bumpDailyAndMaybeFlip, DO-side accumulation is best-effort.
      }
    })(),
  );
}
