import { getDb } from '../auth.js';
import { ESTIMATED_COST_PER_CALL_USD } from '../constants.js';
import type { Env } from '../types.js';

// /admin/stats, moderation cost + kill-switch snapshot.
//
// Auth mirrors /admin/preserve: `Authorization: Bearer ${env.ADMIN_TOKEN}`,
// fail-closed 503 if unset, constant-time compare. Same module load
// assertion in index.ts protects production from a silent route outage.
//
// Plan B 2026-05-15: replaces the never-shipped KV-list approach the
// red-team flagged. Top-N spenders now come from DatabaseDO.getTopSpenders,
// which is maintained DO-side on every increment.

type ModerationMode = 'full' | 'regex_only' | 'block_all' | 'open';
const VALID_MODES: ReadonlySet<ModerationMode> = new Set([
  'full', 'regex_only', 'block_all', 'open',
]);
const MODE_OVERRIDE_KEY = 'cfg:moderation_mode';

function coerceMode(raw: string | null | undefined): ModerationMode | null {
  if (!raw) return null;
  return VALID_MODES.has(raw as ModerationMode) ? (raw as ModerationMode) : null;
}

function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

interface KillSwitchSnapshot {
  flipped: boolean;
  flipped_at: number | null;
  expires_at: number | null;
}

// Reads the KV override and, if present, surfaces its metadata. KV's
// metadata roundtrips per-put, bumpDailyAndMaybeFlip doesn't currently
// stamp it, so we infer flipped_at from when the override was last
// written by leaning on the KV expiration_ttl-derived expires_at and
// noting "flipped_at unknown" via null when absent. The dashboard can
// still show "flipped now, expires at next UTC midnight".
async function readKillSwitchSnapshot(env: Env): Promise<KillSwitchSnapshot> {
  const lookup = await env.AUTH_KV.getWithMetadata<{ flipped_at?: number }>(
    MODE_OVERRIDE_KEY,
  );
  if (!lookup.value || lookup.value !== 'regex_only') {
    return { flipped: false, flipped_at: null, expires_at: null };
  }
  // We don't currently know flipped_at without metadata; bumpDailyAndMaybeFlip
  // doesn't write it, so historical flips lack the stamp. Expires_at is
  // computed from the next UTC midnight (matches secondsUntilUtcMidnight in
  // kill_switch.ts).
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  return {
    flipped: true,
    flipped_at: lookup.metadata?.flipped_at ?? null,
    expires_at: tomorrow.getTime(),
  };
}

export async function handleAdminStats(
  req: Request,
  env: Env,
): Promise<Response> {
  if (!env.ADMIN_TOKEN) {
    return jsonResponse({ error: 'admin_disabled' }, 503);
  }
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const token = auth.slice(7);
  if (!timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const day = utcDay();
  const db = getDb(env);

  // Resolve effective mode + provenance. The route reports BOTH the
  // override path and the env floor so ops can tell whether the kill
  // switch is what's regex-only-ing vs. a deploy-time config.
  const overrideRaw = await env.AUTH_KV.get(MODE_OVERRIDE_KEY);
  const override = coerceMode(overrideRaw);
  const envFloor = coerceMode(env.MODERATION_MODE);
  const mode: ModerationMode = override ?? envFloor ?? 'full';
  const modeSource: 'kv_override' | 'env_floor' | 'default' = override
    ? 'kv_override'
    : envFloor
      ? 'env_floor'
      : 'default';

  // Sum the KV-backed daily counter + the live DO accumulator so the
  // dashboard sees the same number the kill switch evaluates against.
  const kvCount = parseInt(
    (await env.AUTH_KV.get(`mcount:${day}`)) ?? '0',
    10,
  );
  let pending = 0;
  try {
    pending = await db.readPendingGlobalDelta();
  } catch {
    // DO unavailable; KV-only view is still useful, just understates.
  }
  const callsToday = kvCount + pending;
  const costUsd = callsToday * ESTIMATED_COST_PER_CALL_USD;
  const budgetUsd = Number(env.MODERATION_DAILY_BUDGET_USD);
  const budget = Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;
  // 0.7 matches KILL_SWITCH_THRESHOLD_FRACTION in kill_switch.ts. Inlined
  // here rather than re-exported to avoid the import cycle (kill_switch
  // imports from observability which imports from types, admin_stats
  // sitting above all of that keeps the dep arrow one-way).
  const thresholdUsd = budget * 0.7;
  const headroomPct = budget > 0
    ? Math.max(0, Math.min(100, (1 - costUsd / budget) * 100))
    : 0;

  const topUsers = await db.getTopSpenders(day);
  const killSwitch = await readKillSwitchSnapshot(env);

  return jsonResponse({
    day,
    mode,
    mode_source: modeSource,
    cost: {
      calls_today: callsToday,
      pending_delta: pending,
      cost_usd: costUsd,
      budget_usd: budget,
      threshold_usd: thresholdUsd,
      headroom_pct: headroomPct,
    },
    top_users: topUsers,
    kill_switch: killSwitch,
  });
}
