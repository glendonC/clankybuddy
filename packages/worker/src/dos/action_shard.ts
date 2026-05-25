import { DurableObject } from 'cloudflare:workers';
import {
  ACTION_SHARD_SWEEP_INTERVAL_MS,
  BATCH_DEDUPE_TTL_MS,
  EVENTS_HOT_RETENTION_MS,
  VALID_MODELS,
} from '../constants.js';
import type {
  GameEvent,
  MeStatsResponse,
  ModelId,
  MoodState,
  PartType,
  StatsGranularity,
  VerbId,
} from '../../../shared/src/events.js';
import type { Env } from '../types.js';

// 16-shard write-side store for per-(user_id, model_id, verb) action counters.
// LeaderboardDO is read-only aggregate; cron rollup walks every shard via
// rollupSince() and merges into LeaderboardDO. See backend-plan.md §Game-side.
//
// RESPLIT HOOK: when any shard exceeds ~70% of DO write/storage budget,
// re-shard 16 → 32 → 64 → 128 (NOT a single jump to 256, Challenger §3.2).
// Resplit code intentionally not implemented in Phase 3.

interface Migration {
  name: string;
  up: (sql: SqlStorage) => void;
}

const MIGRATIONS: Migration[] = [
  {
    name: '001_phase3_baseline',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS user_actions (
          user_id          TEXT NOT NULL,
          model_id         TEXT NOT NULL,
          verb             TEXT NOT NULL,
          count            INTEGER NOT NULL DEFAULT 0,
          rolled_up_count  INTEGER NOT NULL DEFAULT 0,
          updated_at       INTEGER NOT NULL,
          PRIMARY KEY (user_id, model_id, verb)
        );
        CREATE INDEX IF NOT EXISTS idx_user_actions_updated
          ON user_actions(updated_at);

        CREATE TABLE IF NOT EXISTS shard_cursor (
          shard_id       TEXT PRIMARY KEY,
          last_rolled_up INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS batch_dedupe (
          batch_id   TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_batch_dedupe_applied
          ON batch_dedupe(applied_at);
      `);
    },
  },
  {
    // Event-sourced ingest. The `events` table is the source of truth for
    // every game-side stat; user_actions becomes a derived counter cache
    // that the cron rebuilds from events going forward. New aggregates =
    // new cron + new table; the events log is immutable.
    //
    // Indexes:
    //   PK(event_id)               idempotency on retries (ULID, sortable)
    //   (server_ts)                cron scans "events since cursor"
    //   (user_id, server_ts)       /me/stats reads user's recent events
    //   (type, server_ts)          type-specific aggregators (e.g. hit_landed only)
    //
    // Payload is JSON blob: type-specific fields minus the envelope columns.
    // SQLite's json_extract handles ad-hoc reads from the cron without a
    // schema migration per event-type field.
    name: '002_events_baseline',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          event_id        TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          type            TEXT NOT NULL,
          payload         TEXT NOT NULL,
          client_ts       INTEGER NOT NULL,
          server_ts       INTEGER NOT NULL,
          schema_version  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_server_ts
          ON events(server_ts);
        CREATE INDEX IF NOT EXISTS idx_events_user_server_ts
          ON events(user_id, server_ts);
        CREATE INDEX IF NOT EXISTS idx_events_type_server_ts
          ON events(type, server_ts);
      `);
    },
  },
  {
    // Counter tables that ingestEvents() now derives on each newly-inserted
    // event. user_actions (from migration 001) is the legacy verb counter
    //, we keep filling it via deriveCountersFromEvent so the existing
    // rollupSince()/leaderboard cron pipeline keeps working without change.
    // The two new tables widen the per-user heatmap surface:
    //   user_part_hits         hit counts per (user, model, body part)
    //   user_model_verb_fires  fire counts per (user, model, verb)
    // Read by /me/stats's hit_heatmap and per-model favorite_verb computation
    // once the SQL paths there are wired to read from these counters; until
    // then the existing event-scan code path in readUserStats remains.
    name: '003_user_action_part_heatmap',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS user_part_hits (
          user_id    TEXT NOT NULL,
          model_id   TEXT NOT NULL,
          part       TEXT NOT NULL,
          count      INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, model_id, part)
        );
        CREATE TABLE IF NOT EXISTS user_model_verb_fires (
          user_id    TEXT NOT NULL,
          model_id   TEXT NOT NULL,
          verb       TEXT NOT NULL,
          fires      INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, model_id, verb)
        );
      `);
    },
  },
];

type ShardAlarmSchedule = {
  nextSweepAt: number;
};
const ALARM_SCHEDULE_KEY = 'alarm:schedule:v1';

export interface IngestItem {
  model_id: string;
  verb: string;
  count: number;
  t: number;
}

export interface IngestInput {
  user_id: string;
  batch_id: string;
  items: IngestItem[];
}

export interface RollupDelta {
  model_id: string;
  verb: string;
  count: number;
}

// Per-day help/hurt deltas emitted alongside the flat verb deltas. Drives
// the LeaderboardDO.mergeDaily() fan-out for /leaderboard/series.
// help/hurt here is derived from raw event mood_delta sign, NOT from the
// verb-polarity table. Two distinct signals: the flat path classifies by
// verb (utility verbs are dropped), the daily path classifies by mood
// delta. They will agree in the common case; they diverge on edge cases
// (e.g. a freeze hit that lands a small positive mood_delta).
export interface RollupDailyDelta {
  model_id: string;
  day_utc: string;       // YYYY-MM-DD UTC
  help_delta: number;
  hurt_delta: number;
}

export interface RollupResult {
  new_cursor: number;
  deltas: RollupDelta[];
  daily_deltas: RollupDailyDelta[];
}

// Input to ingestEvents(). Route-side validation has already enforced
// envelope shape, type whitelist, ULID format, model_id roster, payload
// size. The DO just persists with INSERT OR IGNORE for idempotency.
export interface IngestEventsInput {
  user_id: string;             // authoritative; route overwrites client value
  events: GameEvent[];
}

export interface IngestEventsResult {
  accepted: number;            // newly inserted rows
  duplicates: number;          // event_ids already present (retry-safe)
}

export interface ReadUserStatsInput {
  user_id: string;
  since: number;
  until: number;
  granularity: StatsGranularity;
}

type EventRow = Record<string, SqlStorageValue> & {
  session_id: string;
  type: string;
  payload: string;
  server_ts: number;
};

const MOOD_STATES: readonly MoodState[] = [
  'ECSTATIC',
  'HAPPY',
  'CONTENT',
  'WORRIED',
  'HURT',
  'BROKEN',
];

const PART_TYPES: readonly PartType[] = ['head', 'torso', 'arm', 'leg'];

type TimeGranularity = Exclude<StatsGranularity, 'all'>;

const BUCKET_MS: Record<TimeGranularity, number> = {
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
};

function emptyModelStats(): MeStatsResponse['per_model'][ModelId] {
  return {
    fires: 0,
    hits: 0,
    help_mood: 0,
    hurt_mood: 0,
    favorite_verb: null,
    state_firsts: [],
  };
}

function emptyVerbStats(): MeStatsResponse['per_verb'][VerbId] {
  const perModel = Object.fromEntries(
    VALID_MODELS.map((model) => [model, 0]),
  ) as Record<ModelId, number>;
  return {
    fires: 0,
    hits: 0,
    mood_delta_sum: 0,
    per_model: perModel,
  };
}

function bucketStart(ts: number, granularity: TimeGranularity): number {
  const size = BUCKET_MS[granularity];
  return Math.floor(ts / size) * size;
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && (VALID_MODELS as readonly string[]).includes(value);
}

function isMoodState(value: unknown): value is MoodState {
  return typeof value === 'string' && (MOOD_STATES as readonly string[]).includes(value);
}

function isPartType(value: unknown): value is PartType {
  return typeof value === 'string' && (PART_TYPES as readonly string[]).includes(value);
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export class ActionShardDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;

    state.blockConcurrencyWhile(async () => {
      this.runMigrations();
      await this.scheduleAlarm();
    });
  }

  private runMigrations(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _migrations (
        name        TEXT PRIMARY KEY,
        applied_at  INTEGER NOT NULL
      );
    `);

    const applied = new Set(
      this.sql
        .exec<{ name: string }>('SELECT name FROM _migrations')
        .toArray()
        .map((r) => r.name),
    );

    for (const m of MIGRATIONS) {
      if (applied.has(m.name)) continue;
      this.ctx.storage.transactionSync(() => {
        m.up(this.sql);
        this.sql.exec(
          'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
          m.name,
          Date.now(),
        );
      });
    }

    this.sql.exec(
      `INSERT INTO _meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(MIGRATIONS.length),
    );
  }

  private async loadSchedule(): Promise<ShardAlarmSchedule> {
    const existing =
      await this.ctx.storage.get<ShardAlarmSchedule>(ALARM_SCHEDULE_KEY);
    if (existing) return existing;
    return { nextSweepAt: Date.now() + ACTION_SHARD_SWEEP_INTERVAL_MS };
  }

  private async scheduleAlarm(): Promise<void> {
    const schedule = await this.loadSchedule();
    await this.ctx.storage.put(ALARM_SCHEDULE_KEY, schedule);
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null || existing > schedule.nextSweepAt) {
      await this.ctx.storage.setAlarm(schedule.nextSweepAt);
    }
  }

  // Single alarm dispatcher, only sweep() is on this DO today; the pattern
  // mirrors DatabaseDO so adding more periodic work later is mechanical.
  async alarm(): Promise<void> {
    const now = Date.now();
    const schedule = await this.loadSchedule();

    if (now >= schedule.nextSweepAt) {
      await this.sweep();
      schedule.nextSweepAt = now + ACTION_SHARD_SWEEP_INTERVAL_MS;
    }

    await this.ctx.storage.put(ALARM_SCHEDULE_KEY, schedule);
    await this.ctx.storage.setAlarm(schedule.nextSweepAt);
  }

  // Idempotent ingest: the (batch_id) PK in batch_dedupe collapses retries to
  // a single counter mutation. INSERT OR IGNORE returns rowcount 0 on dupe.
  async ingest(
    input: IngestInput,
  ): Promise<{ status: 'applied' | 'duplicate' }> {
    const { user_id, batch_id, items } = input;
    const now = Date.now();

    return this.ctx.storage.transactionSync(() => {
      const dedupe = this.sql
        .exec<{ inserted: number }>(
          `INSERT OR IGNORE INTO batch_dedupe (batch_id, user_id, applied_at)
             VALUES (?, ?, ?)
           RETURNING 1 AS inserted`,
          batch_id,
          user_id,
          now,
        )
        .toArray();
      if (dedupe.length === 0) {
        return { status: 'duplicate' as const };
      }

      for (const item of items) {
        this.sql.exec(
          `INSERT INTO user_actions (user_id, model_id, verb, count, updated_at)
             VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, model_id, verb)
             DO UPDATE SET count = count + excluded.count,
                           updated_at = excluded.updated_at`,
          user_id,
          item.model_id,
          item.verb,
          item.count,
          now,
        );
      }

      return { status: 'applied' as const };
    });
  }

  // Returns true *deltas* (count - rolled_up_count) for rows whose
  // updated_at exceeds the caller's cursor, and the new high-water
  // updated_at as the new_cursor. LeaderboardDO accumulates these deltas
  // (Challenger §3.3, read-only aggregate, never on hot write path).
  //
  // Per-user rows are not exposed; aggregation is by (model_id, verb).
  // Per-user data never leaves the shard (Challenger §3.4).
  //
  // Per fix #5: this method NO LONGER marks rolled_up_count. The caller
  // (aggregation cron) is now expected to merge into LeaderboardDO first
  // and only call commitRollup() after every per-model merge has acked.
  // A transient LeaderboardDO failure no longer permanently deletes
  // deltas, the next tick re-previews the same range (rolled_up_count
  // still old) and retries the merge.
  async rollupSince(cursor: number): Promise<RollupResult> {
    const rows = this.sql
      .exec<{
        model_id: string;
        verb: string;
        delta: number;
        max_t: number;
      }>(
        `SELECT model_id,
                verb,
                SUM(count - rolled_up_count) AS delta,
                MAX(updated_at)              AS max_t
           FROM user_actions
          WHERE updated_at > ?
            AND count > rolled_up_count
          GROUP BY model_id, verb`,
        cursor,
      )
      .toArray();

    // Daily deltas, second query against the events log. We can NOT
    // derive these from user_actions because (a) user_actions has no
    // timestamp resolution finer than updated_at-of-row (which is the
    // last UPSERT time, not the underlying hit time) and (b) the daily
    // path needs help/hurt classified by raw mood_delta sign, which the
    // verb-polarity layer doesn't preserve.
    //
    // Both queries share the same `cursor`: the cron advances cursor
    // off MAX(max_t) across both result sets, so the next preview
    // re-scans from the same watermark for both. Events whose
    // server_ts falls in the same window as the user_actions
    // updated_at watermark are picked up in lockstep.
    const dailyRows = this.sql
      .exec<{
        model_id: string;
        day_utc: string;
        help_count: number;
        hurt_count: number;
        max_t: number;
      }>(
        `SELECT
            json_extract(payload, '$.character') AS model_id,
            DATE(server_ts / 1000, 'unixepoch')  AS day_utc,
            SUM(CASE WHEN CAST(json_extract(payload, '$.mood_delta') AS REAL) > 0 THEN 1 ELSE 0 END) AS help_count,
            SUM(CASE WHEN CAST(json_extract(payload, '$.mood_delta') AS REAL) < 0 THEN 1 ELSE 0 END) AS hurt_count,
            MAX(server_ts) AS max_t
           FROM events
          WHERE type = 'hit_landed'
            AND server_ts > ?
          GROUP BY model_id, day_utc`,
        cursor,
      )
      .toArray();

    let newCursor = cursor;
    const deltas: RollupDelta[] = [];
    for (const r of rows) {
      if (r.max_t > newCursor) newCursor = r.max_t;
      if (r.delta > 0) {
        deltas.push({ model_id: r.model_id, verb: r.verb, count: r.delta });
      }
    }

    const daily_deltas: RollupDailyDelta[] = [];
    for (const r of dailyRows) {
      if (r.max_t > newCursor) newCursor = r.max_t;
      // Skip rows where the payload was missing or malformed,
      // json_extract returns NULL which we coerce to empty string here.
      if (!r.model_id || !r.day_utc) continue;
      if (r.help_count === 0 && r.hurt_count === 0) continue;
      daily_deltas.push({
        model_id: r.model_id,
        day_utc: r.day_utc,
        help_delta: r.help_count,
        hurt_delta: r.hurt_count,
      });
    }

    return { new_cursor: newCursor, deltas, daily_deltas };
  }

  // Commits a successful rollup by setting rolled_up_count := count for
  // every row in (cursor, max_t]. Called by the aggregation cron AFTER
  // every per-model LeaderboardDO merge for the previewed batch has acked.
  // On merge failure the cron skips this call; the next tick re-previews
  // the same range and the LeaderboardDO's (shard_id, max_t) dedup
  // absorbs the duplicate.
  //
  // Bounded by max_t (not just `> cursor`) so concurrent ingests that
  // arrive AFTER preview don't get prematurely marked, they'll show up
  // in the next preview as fresh deltas.
  async commitRollup(cursor: number, max_t: number): Promise<{ rows: number }> {
    return this.ctx.storage.transactionSync(() => {
      // .exec returns a SqlStorageCursor with rowsWritten on the cursor
      // result; we don't strictly need the count, but it's cheap to
      // surface for observability.
      const result = this.sql.exec(
        `UPDATE user_actions
            SET rolled_up_count = count
          WHERE updated_at > ?
            AND updated_at <= ?
            AND count > rolled_up_count`,
        cursor,
        max_t,
      );
      return { rows: result.rowsWritten };
    });
  }

  // Drops batch_dedupe rows older than 24h, and events rows older than the
  // hot-retention window. Idempotent; safe to call anytime.
  //
  // Event hot retention is intentionally short (30d default). Long-tail
  // archival belongs in R2; once that's wired, this sweep continues to
  // bound DO storage while R2 holds forever-storage.
  async sweep(): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      'DELETE FROM batch_dedupe WHERE applied_at < ?',
      now - BATCH_DEDUPE_TTL_MS,
    );
    this.sql.exec(
      'DELETE FROM events WHERE server_ts < ?',
      now - EVENTS_HOT_RETENTION_MS,
    );
  }

  // Idempotent event ingest. Per-event INSERT OR IGNORE means client
  // retries are safe (same event_id = no-op). Returns counts so the route
  // can reply with `accepted` per the EventBatchResponse schema; clients
  // don't need to know which rows were duplicates (retries are transparent).
  //
  // We deliberately use input.user_id (from the authenticated bearer) and
  // ignore whatever user_id the client put on each event. Defense in depth:
  // even if the route forgets to overwrite, the DO won't write a forged id.
  //
  // Derived counters: only newly-inserted events (INSERT OR IGNORE rowcount
  // > 0) feed the per-user counter tables, duplicates from a client retry
  // can't double-count because they never reach the derive step. The
  // counter writes are coalesced by derive-key inside this transaction so
  // a 50-event flush of `tool_fire(claude, punch)` becomes ONE UPSERT, not
  // 50 round-trips against the same row. At peak rates this halves DO
  // writes, which is the cost-control measure flagged in the plan.
  async ingestEvents(
    input: IngestEventsInput,
  ): Promise<IngestEventsResult> {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      let accepted = 0;
      let duplicates = 0;
      // Per-batch coalesce buckets. Keys are pipe-joined to avoid collisions
      // with model/verb/part values containing colons.
      const verbCounts = new Map<string, { user_id: string; model_id: string; verb: string; count: number }>();
      const partCounts = new Map<string, { user_id: string; model_id: string; part: string; count: number }>();
      const fireCounts = new Map<string, { user_id: string; model_id: string; verb: string; count: number }>();

      for (const ev of input.events) {
        // Strip envelope fields out of the payload, they live in columns.
        const {
          event_id,
          user_id: _ignoredClientUserId,
          session_id,
          client_ts,
          schema_version,
          type,
          ...payload
        } = ev;
        const result = this.sql
          .exec<{ inserted: number }>(
            `INSERT OR IGNORE INTO events (
               event_id, user_id, session_id, type, payload,
               client_ts, server_ts, schema_version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING 1 AS inserted`,
            event_id,
            input.user_id,
            session_id,
            type,
            JSON.stringify(payload),
            client_ts,
            now,
            schema_version,
          )
          .toArray();
        if (result.length === 0) {
          duplicates++;
          continue;
        }
        accepted++;

        // Inline coalesce. Pulls character/verb/part out of the typed
        // payload, guard with typeof checks because validateEvent in the
        // route only enforces the envelope; payload fields are best-effort
        // typed here. Bad payloads contribute nothing to counters but are
        // still stored as event rows (the events log is the source of
        // truth; counter rebuild can recover from there).
        if (type === 'hit_landed') {
          const character = (payload as Record<string, unknown>).character;
          const verb = (payload as Record<string, unknown>).verb;
          const part = (payload as Record<string, unknown>).part;
          if (
            typeof character === 'string' &&
            typeof verb === 'string'
          ) {
            const verbKey = `${input.user_id}|${character}|${verb}`;
            const verbAgg = verbCounts.get(verbKey);
            if (verbAgg) verbAgg.count++;
            else verbCounts.set(verbKey, {
              user_id: input.user_id,
              model_id: character,
              verb,
              count: 1,
            });
            if (typeof part === 'string') {
              const partKey = `${input.user_id}|${character}|${part}`;
              const partAgg = partCounts.get(partKey);
              if (partAgg) partAgg.count++;
              else partCounts.set(partKey, {
                user_id: input.user_id,
                model_id: character,
                part,
                count: 1,
              });
            }
          }
        } else if (type === 'tool_fire') {
          const character = (payload as Record<string, unknown>).character;
          const verb = (payload as Record<string, unknown>).verb;
          if (typeof character === 'string' && typeof verb === 'string') {
            const fireKey = `${input.user_id}|${character}|${verb}`;
            const fireAgg = fireCounts.get(fireKey);
            if (fireAgg) fireAgg.count++;
            else fireCounts.set(fireKey, {
              user_id: input.user_id,
              model_id: character,
              verb,
              count: 1,
            });
          }
        }
      }

      // One UPSERT per (user, model, verb / part) regardless of how many
      // events in the batch hit it. user_actions stays the legacy hit-
      // counter table (drives rollupSince → leaderboard); user_part_hits
      // and user_model_verb_fires are the new derived counters added in
      // migration 003.
      for (const v of verbCounts.values()) {
        this.sql.exec(
          `INSERT INTO user_actions (user_id, model_id, verb, count, updated_at)
             VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, model_id, verb)
             DO UPDATE SET count = count + excluded.count,
                           updated_at = excluded.updated_at`,
          v.user_id,
          v.model_id,
          v.verb,
          v.count,
          now,
        );
      }
      for (const p of partCounts.values()) {
        this.sql.exec(
          `INSERT INTO user_part_hits (user_id, model_id, part, count, updated_at)
             VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, model_id, part)
             DO UPDATE SET count = count + excluded.count,
                           updated_at = excluded.updated_at`,
          p.user_id,
          p.model_id,
          p.part,
          p.count,
          now,
        );
      }
      for (const f of fireCounts.values()) {
        this.sql.exec(
          `INSERT INTO user_model_verb_fires (user_id, model_id, verb, fires, updated_at)
             VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, model_id, verb)
             DO UPDATE SET fires = fires + excluded.fires,
                           updated_at = excluded.updated_at`,
          f.user_id,
          f.model_id,
          f.verb,
          f.count,
          now,
        );
      }
      return { accepted, duplicates };
    });
  }

  async readUserStats(input: ReadUserStatsInput): Promise<MeStatsResponse> {
    if (input.granularity === 'all') {
      return this.readUserAllTimeStats(input.user_id);
    }
    const granularity = input.granularity;
    const rows = this.sql
      .exec<EventRow>(
        `SELECT session_id, type, payload, server_ts
           FROM events
          WHERE user_id = ?
            AND server_ts >= ?
            AND server_ts <= ?
          ORDER BY server_ts ASC`,
        input.user_id,
        input.since,
        input.until,
      )
      .toArray();

    const perModel = Object.fromEntries(
      VALID_MODELS.map((model) => [model, emptyModelStats()]),
    ) as MeStatsResponse['per_model'];
    const perVerb: MeStatsResponse['per_verb'] = {};
    const modelVerbFires = new Map<ModelId, Map<VerbId, number>>();
    const sessionHurt = new Map<string, number>();
    const sessionHelp = new Map<string, number>();
    const heatmapCounts = new Map<
      string,
      NonNullable<MeStatsResponse['hit_heatmap']>[number]
    >();
    const timeseries = new Map<number, MeStatsResponse['timeseries'][number]>();
    const comboLog: NonNullable<MeStatsResponse['combo_log']> = [];
    const sessionIds = new Set<string>();

    // New aggregations (Phase A, dashboard redesign data layer).
    // Sparse, only populated buckets are stored; client expands.
    const perVerbBuckets = new Map<
      string,
      NonNullable<MeStatsResponse['per_verb_timeseries']>[number]
    >();
    const perModelBuckets = new Map<
      string,
      NonNullable<MeStatsResponse['per_model_timeseries']>[number]
    >();
    // 7×24 = 168 cells; key = dow*24 + hour.
    const todMap = new Map<
      number,
      NonNullable<MeStatsResponse['time_of_day_heatmap']>[number]
    >();
    // YYYY-MM-DD in UTC → daily totals.
    const dailyMap = new Map<
      string,
      NonNullable<MeStatsResponse['daily_calendar']>[number]
    >();
    // session_id → accumulating summary row.
    type SessionAcc = NonNullable<MeStatsResponse['session_summaries']>[number]
      & { _seenStart: boolean };
    const sessionAccs = new Map<string, SessionAcc>();
    const ensureSession = (sid: string): SessionAcc => {
      let s = sessionAccs.get(sid);
      if (!s) {
        s = {
          session_id: sid,
          started_at: 0,
          ended_at: null,
          duration_ms: 0,
          character: null,
          fires: 0,
          hits: 0,
          help_mood: 0,
          hurt_mood: 0,
          peak_mood: 0,
          trough_mood: 0,
          end_state: null,
          longest_combo: 0,
          _seenStart: false,
        };
        sessionAccs.set(sid, s);
      }
      return s;
    };
    const utcDateStr = (ts: number): string => {
      const d = new Date(ts);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const ensureDay = (ts: number) => {
      const date = utcDateStr(ts);
      let d = dailyMap.get(date);
      if (!d) {
        d = { date, fires: 0, hits: 0, sessions: 0, play_ms: 0 };
        dailyMap.set(date, d);
      }
      return d;
    };
    const ensureTod = (ts: number) => {
      const d = new Date(ts);
      const dow = d.getUTCDay();
      const hour = d.getUTCHours();
      const k = dow * 24 + hour;
      let cell = todMap.get(k);
      if (!cell) {
        cell = { dow, hour, fires: 0, hits: 0 };
        todMap.set(k, cell);
      }
      return cell;
    };
    const ensurePerVerbBucket = (bucket_start: number, verb: VerbId) => {
      const key = `${bucket_start}|${verb}`;
      let b = perVerbBuckets.get(key);
      if (!b) {
        b = { bucket_start, verb, fires: 0, hits: 0, mood_delta: 0 };
        perVerbBuckets.set(key, b);
      }
      return b;
    };
    const ensurePerModelBucket = (bucket_start: number, model: ModelId) => {
      const key = `${bucket_start}|${model}`;
      let b = perModelBuckets.get(key);
      if (!b) {
        b = { bucket_start, model, fires: 0, hits: 0, help_mood: 0, hurt_mood: 0 };
        perModelBuckets.set(key, b);
      }
      return b;
    };

    const getBucket = (ts: number): MeStatsResponse['timeseries'][number] => {
      const start = bucketStart(ts, granularity);
      let bucket = timeseries.get(start);
      if (!bucket) {
        bucket = {
          bucket_start: start,
          fires: 0,
          hits: 0,
          help_mood: 0,
          hurt_mood: 0,
        };
        timeseries.set(start, bucket);
      }
      return bucket;
    };

    let fires = 0;
    let hits = 0;
    let sessions = 0;
    let helpMood = 0;
    let hurtMood = 0;
    let playMs = 0;
    let longestCombo = 0;
    let longestSessionMs = 0;

    for (const row of rows) {
      const payload = parsePayload(row.payload);
      sessionIds.add(row.session_id);

      if (row.type === 'session_start') {
        sessions++;
        const acc = ensureSession(row.session_id);
        acc.started_at = row.server_ts;
        acc._seenStart = true;
        if (isModelId(payload.character)) acc.character = payload.character;
        const day = ensureDay(row.server_ts);
        day.sessions++;
        continue;
      }

      if (row.type === 'session_end') {
        const duration = numberValue(payload.duration_ms);
        playMs += duration;
        if (duration > longestSessionMs) longestSessionMs = duration;
        const acc = ensureSession(row.session_id);
        acc.ended_at = row.server_ts;
        acc.duration_ms = duration;
        if (isMoodState(payload.final_state)) acc.end_state = payload.final_state;
        // Accumulate session play_ms onto the day the session ENDED. Coarse
        // but readable on the calendar; the alternative (apportioning across
        // span days) is overkill for a streak heatmap.
        ensureDay(row.server_ts).play_ms += duration;
        continue;
      }

      if (row.type === 'tool_fire') {
        const character = payload.character;
        const verb = payload.verb;
        if (!isModelId(character) || typeof verb !== 'string') continue;
        const verbId = verb as VerbId;
        fires++;
        perModel[character].fires++;
        const verbStats = perVerb[verbId] ??= emptyVerbStats();
        verbStats.fires++;
        const bucket = getBucket(row.server_ts);
        bucket.fires++;
        let counts = modelVerbFires.get(character);
        if (!counts) {
          counts = new Map<VerbId, number>();
          modelVerbFires.set(character, counts);
        }
        counts.set(verbId, (counts.get(verbId) ?? 0) + 1);
        // New: per-verb / per-model time buckets, day calendar, hour heatmap,
        // session counters.
        ensurePerVerbBucket(bucket.bucket_start, verbId).fires++;
        ensurePerModelBucket(bucket.bucket_start, character).fires++;
        ensureDay(row.server_ts).fires++;
        ensureTod(row.server_ts).fires++;
        ensureSession(row.session_id).fires++;
        continue;
      }

      if (row.type === 'hit_landed') {
        const character = payload.character;
        const verb = payload.verb;
        const part = payload.part;
        if (!isModelId(character) || typeof verb !== 'string') continue;
        const verbId = verb as VerbId;
        const moodDelta = numberValue(payload.mood_delta);
        hits++;
        perModel[character].hits++;
        const verbStats = perVerb[verbId] ??= emptyVerbStats();
        verbStats.hits++;
        verbStats.mood_delta_sum += moodDelta;
        verbStats.per_model[character]++;
        const bucket = getBucket(row.server_ts);
        bucket.hits++;
        const verbBucket = ensurePerVerbBucket(bucket.bucket_start, verbId);
        verbBucket.hits++;
        verbBucket.mood_delta += moodDelta;
        const modelBucket = ensurePerModelBucket(bucket.bucket_start, character);
        modelBucket.hits++;
        const sessionAcc = ensureSession(row.session_id);
        sessionAcc.hits++;
        if (moodDelta > 0) {
          helpMood += moodDelta;
          perModel[character].help_mood += moodDelta;
          bucket.help_mood += moodDelta;
          modelBucket.help_mood += moodDelta;
          sessionHelp.set(row.session_id, (sessionHelp.get(row.session_id) ?? 0) + moodDelta);
          sessionAcc.help_mood += moodDelta;
        } else if (moodDelta < 0) {
          const hurt = Math.abs(moodDelta);
          hurtMood += hurt;
          perModel[character].hurt_mood += hurt;
          bucket.hurt_mood += hurt;
          modelBucket.hurt_mood += hurt;
          sessionHurt.set(row.session_id, (sessionHurt.get(row.session_id) ?? 0) + hurt);
          sessionAcc.hurt_mood += hurt;
        }
        if (isPartType(part)) {
          const key = `${character}:${part}`;
          const existing = heatmapCounts.get(key);
          if (existing) existing.count++;
          else heatmapCounts.set(key, { character, part, count: 1 });
        }
        ensureDay(row.server_ts).hits++;
        ensureTod(row.server_ts).hits++;
        continue;
      }

      if (row.type === 'mood_transition') {
        const character = payload.character;
        const to = payload.to;
        const moodValue = numberValue(payload.mood_value);
        if (payload.first_seen === true && isModelId(character) && isMoodState(to)) {
          const firsts = perModel[character].state_firsts;
          if (!firsts.includes(to)) firsts.push(to);
        }
        const sessAcc = ensureSession(row.session_id);
        if (moodValue > sessAcc.peak_mood) sessAcc.peak_mood = moodValue;
        if (moodValue < sessAcc.trough_mood) sessAcc.trough_mood = moodValue;
        continue;
      }

      if (row.type === 'combo_completed') {
        const character = payload.character;
        const verbs = payload.verbs;
        const durationMs = numberValue(payload.duration_ms);
        const totalMoodDelta = numberValue(payload.total_mood_delta);
        if (!isModelId(character) || !Array.isArray(verbs)) continue;
        longestCombo = Math.max(longestCombo, verbs.length);
        const sessAcc = ensureSession(row.session_id);
        if (verbs.length > sessAcc.longest_combo) sessAcc.longest_combo = verbs.length;
        comboLog.push({
          ts: row.server_ts,
          character,
          verbs: verbs.filter((verb): verb is VerbId => typeof verb === 'string'),
          duration_ms: durationMs,
          total_mood_delta: totalMoodDelta,
        });
        continue;
      }
    }

    for (const [model, counts] of modelVerbFires) {
      let favorite: VerbId | null = null;
      let favoriteCount = 0;
      for (const [verb, count] of counts) {
        if (count > favoriteCount) {
          favorite = verb;
          favoriteCount = count;
        }
      }
      perModel[model].favorite_verb = favorite;
    }

    const startBucket = bucketStart(input.since, granularity);
    const endBucket = bucketStart(input.until, granularity);
    for (
      let ts = startBucket;
      ts <= endBucket;
      ts += BUCKET_MS[granularity]
    ) {
      if (!timeseries.has(ts)) {
        timeseries.set(ts, {
          bucket_start: ts,
          fires: 0,
          hits: 0,
          help_mood: 0,
          hurt_mood: 0,
        });
      }
    }

    // Drop the internal _seenStart marker before returning. Sessions whose
    // session_start fell outside the window but whose events are inside are
    // kept (started_at = first event's server_ts as a best-effort floor).
    const sessionSummaries: NonNullable<MeStatsResponse['session_summaries']> = [];
    for (const acc of sessionAccs.values()) {
      const { _seenStart: _, ...row } = acc;
      if (row.started_at === 0) {
        // Best-effort floor: the bucket start of the first hit/fire we saw.
        // Avoids returning epoch-0 to clients.
        row.started_at = input.since;
      }
      // Compute duration if we never saw session_end (still active or
      // session_end fell outside window).
      if (row.duration_ms === 0 && row.ended_at == null && row.started_at > 0) {
        row.duration_ms = Math.max(0, input.until - row.started_at);
      }
      sessionSummaries.push(row);
    }
    sessionSummaries.sort((a, b) => b.started_at - a.started_at);

    return {
      user_id: input.user_id,
      window: {
        since: new Date(input.since).toISOString(),
        until: new Date(input.until).toISOString(),
        granularity: input.granularity,
      },
      totals: {
        sessions: sessions || sessionIds.size,
        fires,
        hits,
        help_mood: helpMood,
        hurt_mood: hurtMood,
        play_ms: playMs,
      },
      per_model: perModel,
      per_verb: perVerb,
      timeseries: Array.from(timeseries.values())
        .sort((a, b) => a.bucket_start - b.bucket_start),
      records: {
        longest_combo: longestCombo,
        biggest_session_hurt: Math.max(0, ...sessionHurt.values()),
        biggest_session_help: Math.max(0, ...sessionHelp.values()),
        longest_session_ms: longestSessionMs,
      },
      hit_heatmap: Array.from(heatmapCounts.values()),
      combo_log: comboLog.slice(-25),
      per_verb_timeseries: Array.from(perVerbBuckets.values())
        .sort((a, b) => a.bucket_start - b.bucket_start),
      per_model_timeseries: Array.from(perModelBuckets.values())
        .sort((a, b) => a.bucket_start - b.bucket_start),
      time_of_day_heatmap: Array.from(todMap.values()),
      daily_calendar: Array.from(dailyMap.values())
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
      session_summaries: sessionSummaries,
    };
  }

  // All-time stats, reads cumulative counter tables that are NEVER swept
  // by sweep(). Lifetime totals (fires, hits, per-model, per-verb, body-part
  // heatmap) survive the 30-day events-log retention cliff.
  //
  // Trade-off: the cumulative tables don't carry the fields events do, so
  // some response slots are filled with zeros and the consumer is expected
  // to render a degraded "all-time" layout that hides them:
  //   • timeseries, empty (no daily resolution past the events window)
  //   • records, zeros (combos / longest session require event scan)
  //   • sessions / play_ms / mood deltas / per_verb.hits / state_firsts,
  //     zeros (events-only signals; not maintained in counter tables)
  //
  // Window endpoints are surfaced as 0..now since "all-time" has no real
  // since boundary; clients should treat granularity='all' as authoritative
  // and ignore the literal timestamps.
  private async readUserAllTimeStats(userId: string): Promise<MeStatsResponse> {
    const fireRows = this.sql
      .exec<{ model_id: string; verb: string; fires: number }>(
        `SELECT model_id, verb, fires
           FROM user_model_verb_fires
          WHERE user_id = ?`,
        userId,
      )
      .toArray();

    const hitRows = this.sql
      .exec<{ model_id: string; part: string; count: number }>(
        `SELECT model_id, part, count
           FROM user_part_hits
          WHERE user_id = ?`,
        userId,
      )
      .toArray();

    const perModel = Object.fromEntries(
      VALID_MODELS.map((model) => [model, emptyModelStats()]),
    ) as MeStatsResponse['per_model'];
    const perVerb: MeStatsResponse['per_verb'] = {};
    const modelVerbFires = new Map<ModelId, Map<VerbId, number>>();
    const heatmap: NonNullable<MeStatsResponse['hit_heatmap']> = [];

    let totalFires = 0;
    let totalHits = 0;

    for (const row of fireRows) {
      if (!isModelId(row.model_id)) continue;
      const verbId = row.verb as VerbId;
      const fires = numberValue(row.fires);
      if (fires <= 0) continue;
      totalFires += fires;
      perModel[row.model_id].fires += fires;
      const verbStats = perVerb[verbId] ??= emptyVerbStats();
      verbStats.fires += fires;
      let counts = modelVerbFires.get(row.model_id);
      if (!counts) {
        counts = new Map<VerbId, number>();
        modelVerbFires.set(row.model_id, counts);
      }
      counts.set(verbId, (counts.get(verbId) ?? 0) + fires);
    }

    for (const row of hitRows) {
      if (!isModelId(row.model_id) || !isPartType(row.part)) continue;
      const count = numberValue(row.count);
      if (count <= 0) continue;
      totalHits += count;
      perModel[row.model_id].hits += count;
      heatmap.push({ character: row.model_id, part: row.part, count });
    }

    for (const [model, counts] of modelVerbFires) {
      let favorite: VerbId | null = null;
      let favoriteCount = 0;
      for (const [verb, count] of counts) {
        if (count > favoriteCount) {
          favorite = verb;
          favoriteCount = count;
        }
      }
      perModel[model].favorite_verb = favorite;
    }

    const now = Date.now();
    return {
      user_id: userId,
      window: {
        since: new Date(0).toISOString(),
        until: new Date(now).toISOString(),
        granularity: 'all',
      },
      totals: {
        sessions: 0,
        fires: totalFires,
        hits: totalHits,
        help_mood: 0,
        hurt_mood: 0,
        play_ms: 0,
      },
      per_model: perModel,
      per_verb: perVerb,
      timeseries: [],
      records: {
        longest_combo: 0,
        biggest_session_hurt: 0,
        biggest_session_help: 0,
        longest_session_ms: 0,
      },
      hit_heatmap: heatmap,
      combo_log: [],
    };
  }

  // Bridge endpoint: a single read that returns the user's current
  // play state. Drives the AI-feedback bridge poll (`GET /me/state`,
  // ~every 5s from the TUI) so an AI assistant reading
  // `~/.clankybuddy/state.json` can adjust its tone to match the user's
  // mood. Read-only; never mutates events / counters.
  //
  // Latest-session resolution: pull the most recent session_start by
  // server_ts; if a session_end with the same session_id exists, the
  // session is over and `session.id` is null. Otherwise the session is
  // active and aggregates only against that session_id.
  //
  // 60s window for `recent.*` is anchored to `now` (Date.now() at call
  // time), the bridge spec wants a sliding-window engagement signal,
  // not a session-bound one. A user who steps away for >60s gets
  // help_count_60s = hurt_count_60s = 0 even mid-session.
  async readUserState(userId: string): Promise<UserStateResponse> {
    const now = Date.now();

    // Most recent session_start for this user. If none, no active session.
    const latestSession = this.sql
      .exec<EventRow>(
        `SELECT session_id, type, payload, server_ts
           FROM events
          WHERE user_id = ?
            AND type = 'session_start'
          ORDER BY server_ts DESC
          LIMIT 1`,
        userId,
      )
      .toArray();

    let sessionId: string | null = null;
    let sessionStartedAt: number | null = null;
    let sessionCharacter: ModelId | null = null;

    if (latestSession.length > 0) {
      const row = latestSession[0];
      if (row) {
        const payload = parsePayload(row.payload);
        // Has a session_end fired for this session? If so, treat as
        // closed, don't surface stale "still playing" state to the AI
        // bridge after the user navigates away.
        const ended = this.sql
          .exec<{ c: number }>(
            `SELECT COUNT(*) AS c
               FROM events
              WHERE user_id = ?
                AND session_id = ?
                AND type = 'session_end'`,
            userId,
            row.session_id,
          )
          .toArray();
        const endedCount = ended[0]?.c ?? 0;
        if (endedCount === 0) {
          sessionId = row.session_id;
          sessionStartedAt = row.server_ts;
          if (isModelId(payload.character)) {
            sessionCharacter = payload.character;
          }
        }
      }
    }

    // mood: latest mood_transition since session_start (when active),
    // else latest mood_transition globally for the user. Bridge consumers
    // care most about "what's the buddy feeling right now"; if the user
    // is between sessions we still want to surface the last known mood.
    const moodScopeSince = sessionStartedAt ?? 0;
    const latestMood = this.sql
      .exec<EventRow>(
        `SELECT session_id, type, payload, server_ts
           FROM events
          WHERE user_id = ?
            AND type = 'mood_transition'
            AND server_ts >= ?
          ORDER BY server_ts DESC
          LIMIT 1`,
        userId,
        moodScopeSince,
      )
      .toArray();

    let moodState: MoodState | null = null;
    let moodValue: number | null = null;
    let moodTransitionedAt: number | null = null;
    if (latestMood.length > 0) {
      const row = latestMood[0];
      if (row) {
        const payload = parsePayload(row.payload);
        if (isMoodState(payload.to)) moodState = payload.to;
        const v = payload.mood_value;
        if (typeof v === 'number' && Number.isFinite(v)) moodValue = v;
        moodTransitionedAt = row.server_ts;
      }
    }

    // recent.last_verb / last_verb_at: latest tool_fire for the user.
    const latestFire = this.sql
      .exec<EventRow>(
        `SELECT session_id, type, payload, server_ts
           FROM events
          WHERE user_id = ?
            AND type = 'tool_fire'
          ORDER BY server_ts DESC
          LIMIT 1`,
        userId,
      )
      .toArray();
    let lastVerb: string | null = null;
    let lastVerbAt: number | null = null;
    if (latestFire.length > 0) {
      const row = latestFire[0];
      if (row) {
        const payload = parsePayload(row.payload);
        if (typeof payload.verb === 'string') lastVerb = payload.verb;
        lastVerbAt = row.server_ts;
      }
    }

    // recent help/hurt counts: hit_landed events in trailing 60s,
    // bucketed by sign of mood_delta. Counts only, sums live in
    // /me/stats.
    const sinceWindow = now - 60_000;
    const recentHits = this.sql
      .exec<EventRow>(
        `SELECT session_id, type, payload, server_ts
           FROM events
          WHERE user_id = ?
            AND type = 'hit_landed'
            AND server_ts >= ?`,
        userId,
        sinceWindow,
      )
      .toArray();
    let helpCount60s = 0;
    let hurtCount60s = 0;
    for (const row of recentHits) {
      const payload = parsePayload(row.payload);
      const delta = numberValue(payload.mood_delta);
      if (delta > 0) helpCount60s++;
      else if (delta < 0) hurtCount60s++;
    }

    // totals_session.*: hit/fire counts and computed duration since
    // session_start. Only populated when a session is active.
    let totalsSession: UserStateResponse['totals_session'] = null;
    if (sessionId && sessionStartedAt != null) {
      const sessionRows = this.sql
        .exec<{ type: string; payload: string; server_ts: number }>(
          `SELECT type, payload, server_ts
             FROM events
            WHERE user_id = ?
              AND session_id = ?
              AND server_ts >= ?`,
          userId,
          sessionId,
          sessionStartedAt,
        )
        .toArray();
      let sFires = 0;
      let sHits = 0;
      let sHelp = 0;
      let sHurt = 0;
      for (const row of sessionRows) {
        if (row.type === 'tool_fire') {
          sFires++;
        } else if (row.type === 'hit_landed') {
          sHits++;
          const payload = parsePayload(row.payload);
          const delta = numberValue(payload.mood_delta);
          if (delta > 0) sHelp++;
          else if (delta < 0) sHurt++;
        }
      }
      totalsSession = {
        help_count: sHelp,
        hurt_count: sHurt,
        fires: sFires,
        duration_ms: Math.max(0, now - sessionStartedAt),
      };
    }

    return {
      user_id: userId,
      schema_version: 1,
      updated_at: now,
      session: {
        id: sessionId,
        started_at: sessionStartedAt,
        character: sessionCharacter,
      },
      mood: {
        state: moodState,
        value: moodValue,
        transitioned_at: moodTransitionedAt,
      },
      recent: {
        help_count_60s: helpCount60s,
        hurt_count_60s: hurtCount60s,
        last_verb: lastVerb,
        last_verb_at: lastVerbAt,
      },
      totals_session: totalsSession,
    };
  }
}

// /me/state response. Schema-versioned (`schema_version: 1`) so the
// CLI poller can tolerate a future field addition without crashing.
// The CLI re-emits this shape verbatim into ~/.clankybuddy/state.json
// (with a CLI-side `consent` block layered on after-the-fact).
export interface UserStateResponse {
  user_id: string;
  schema_version: 1;
  updated_at: number;
  session: {
    id: string | null;
    started_at: number | null;
    character: ModelId | null;
  };
  mood: {
    state: MoodState | null;
    value: number | null;
    transitioned_at: number | null;
  };
  recent: {
    help_count_60s: number;
    hurt_count_60s: number;
    last_verb: string | null;
    last_verb_at: number | null;
  };
  totals_session: {
    help_count: number;
    hurt_count: number;
    fires: number;
    duration_ms: number;
  } | null;
}
