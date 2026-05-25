import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types.js';

// One LeaderboardDO instance per AI model (id keyed via idFromName(model_id)).
// READ-ONLY aggregate from the request path's perspective: every write is
// driven by the aggregation cron after walking ActionShardDO.rollupSince().
// Hot write path never touches LeaderboardDO (Challenger §3.3).

interface Migration {
  name: string;
  up: (sql: SqlStorage) => void;
}

const MIGRATIONS: Migration[] = [
  {
    name: '001_phase3_baseline',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS model_aggregate (
          model_id     TEXT PRIMARY KEY,
          help_count   INTEGER NOT NULL DEFAULT 0,
          hurt_count   INTEGER NOT NULL DEFAULT 0,
          last_updated INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // Phase B Cluster E fix #5: per-shard cursor for idempotent merge.
    // The aggregation cron now flips the order to "merge first, mark
    // rolled_up second" so a transient merge failure no longer permanently
    // deletes deltas from the global leaderboard. To keep merge safe to
    // retry, we record the highest (shard_id, max_t_received) we've ever
    // applied and reject (no-op) any merge whose max_t is already covered.
    name: '002_merge_cursor',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS shard_merge_cursor (
          shard_id        TEXT PRIMARY KEY,
          last_max_t      INTEGER NOT NULL,
          last_merged_at  INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // Stage 2 global-benchmark overlay: per-day help/hurt buckets so
    // /leaderboard/series can return a 30-day time series the web client
    // overlays on its personal trend chart. Keyed by (model_id, day_utc)
    // where day_utc is a YYYY-MM-DD string in UTC. Same DO/instance as
    // model_aggregate (one LeaderboardDO per model_id via idFromName),
    // so model_id is technically redundant, kept on-row for symmetry
    // with the flat aggregate and to keep dump/restore tooling uniform.
    name: '003_daily_buckets',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS model_daily (
          model_id     TEXT NOT NULL,
          day_utc      TEXT NOT NULL,
          help_count   INTEGER NOT NULL DEFAULT 0,
          hurt_count   INTEGER NOT NULL DEFAULT 0,
          last_updated INTEGER NOT NULL,
          PRIMARY KEY (model_id, day_utc)
        );
        CREATE INDEX IF NOT EXISTS idx_model_daily_day_utc
          ON model_daily(day_utc);
      `);
    },
  },
];

export interface MergeInput {
  model_id: string;
  help_delta: number;
  hurt_delta: number;
  // Per fix #5: optional shard cursor for idempotent retry. When the
  // aggregation cron supplies these, the merge is rejected as a duplicate
  // if shard_id's last_max_t already covers max_t, the deltas are
  // assumed to have landed on a prior successful merge whose ack was
  // dropped. Older callers that don't supply these fall back to the
  // legacy unconditional merge (used by tests / manual ops).
  shard_id?: string;
  max_t?: number;
}

export interface AggregateRow {
  model_id: string;
  help_count: number;
  hurt_count: number;
  last_updated: number;
}

export interface DailyRow {
  model_id: string;
  day_utc: string;       // YYYY-MM-DD UTC
  help_count: number;
  hurt_count: number;
  last_updated: number;
}

export interface MergeDailyInput {
  model_id: string;
  day_utc: string;
  help_delta: number;
  hurt_delta: number;
  // Idempotency tuple, same semantics as MergeInput.shard_id/max_t but
  // see the note in mergeDaily() below: this method does NOT write the
  // cursor itself. It rides the cursor advanced by the sibling merge()
  // call from the same rollup batch.
  shard_id?: string;
  max_t?: number;
}

export interface GetSeriesInput {
  since_date: string;    // YYYY-MM-DD inclusive
  until_date: string;    // YYYY-MM-DD inclusive
}

export class LeaderboardDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;

    state.blockConcurrencyWhile(async () => {
      this.runMigrations();
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

  // Aggregation cron only. Idempotent on the shape: zero-deltas are no-ops.
  // When `shard_id` + `max_t` are supplied (fix #5), we ALSO dedupe on the
  // shard cursor so retries after a previously-acknowledged merge cannot
  // double-count. Without those fields the call falls through to the
  // legacy unconditional path.
  async merge(input: MergeInput): Promise<void> {
    if (input.help_delta === 0 && input.hurt_delta === 0) return;
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      if (input.shard_id != null && typeof input.max_t === 'number') {
        const existing = this.sql
          .exec<{ last_max_t: number }>(
            'SELECT last_max_t FROM shard_merge_cursor WHERE shard_id = ?',
            input.shard_id,
          )
          .toArray()[0];
        if (existing && existing.last_max_t >= input.max_t) {
          // Already merged through this watermark, silent no-op so the
          // cron can retry without double-counting.
          return;
        }
        this.sql.exec(
          `INSERT INTO shard_merge_cursor (shard_id, last_max_t, last_merged_at)
             VALUES (?, ?, ?)
           ON CONFLICT(shard_id) DO UPDATE
             SET last_max_t     = excluded.last_max_t,
                 last_merged_at = excluded.last_merged_at`,
          input.shard_id,
          input.max_t,
          now,
        );
      }
      this.sql.exec(
        `INSERT INTO model_aggregate (model_id, help_count, hurt_count, last_updated)
           VALUES (?, ?, ?, ?)
         ON CONFLICT(model_id) DO UPDATE
           SET help_count   = help_count + excluded.help_count,
               hurt_count   = hurt_count + excluded.hurt_count,
               last_updated = excluded.last_updated`,
        input.model_id,
        input.help_delta,
        input.hurt_delta,
        now,
      );
    });
  }

  // Aggregation cron only. Per-day variant of merge() for the daily
  // time-series surface (/leaderboard/series). Idempotency note:
  //
  // The shard_merge_cursor dedup table is keyed per-shard, NOT per-
  // (shard, day). Because a single rollup batch produces BOTH flat
  // deltas (via merge()) AND daily deltas (via mergeDaily()) covering
  // the same (shard, max_t) range, the broader "this shard through
  // max_t has been merged" guarantee from merge() already covers any
  // mergeDaily() retries from the same batch. We therefore deliberately
  // SKIP the cursor write here and let the flat merge() own cursor
  // advancement, both merges from one rollup pass advance the cursor
  // together.
  //
  // Trade-off: if the aggregation cron calls mergeDaily() for a shard
  // in a batch where merge() is NOT called (no flat deltas to apply
  // for that shard), the daily merges still get applied, they're just
  // not deduplicated. In the current cron design that case can't happen
  // (the same `rollupSince` result feeds both), but the constraint is
  // worth flagging if the call sites diverge later.
  async mergeDaily(input: MergeDailyInput): Promise<void> {
    if (input.help_delta === 0 && input.hurt_delta === 0) return;
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      if (input.shard_id != null && typeof input.max_t === 'number') {
        const existing = this.sql
          .exec<{ last_max_t: number }>(
            'SELECT last_max_t FROM shard_merge_cursor WHERE shard_id = ?',
            input.shard_id,
          )
          .toArray()[0];
        if (existing && existing.last_max_t >= input.max_t) {
          // Already covered by a prior merge() (or mergeDaily() that
          // wrote the cursor in some future revision). No-op so retry
          // is safe.
          return;
        }
        // NOTE: intentionally no cursor write here, see method comment.
      }
      this.sql.exec(
        `INSERT INTO model_daily (
           model_id, day_utc, help_count, hurt_count, last_updated
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(model_id, day_utc) DO UPDATE
           SET help_count   = help_count + excluded.help_count,
               hurt_count   = hurt_count + excluded.hurt_count,
               last_updated = excluded.last_updated`,
        input.model_id,
        input.day_utc,
        input.help_delta,
        input.hurt_delta,
        now,
      );
    });
  }

  // Returns daily rows in [since_date, until_date] sorted ascending by
  // day_utc. Days with no activity are absent (sparse); the route
  // pivot is responsible for gap-fill semantics (frontend gap-fills).
  async getSeries(input: GetSeriesInput): Promise<DailyRow[]> {
    const rows = this.sql
      .exec<{
        model_id: string;
        day_utc: string;
        help_count: number;
        hurt_count: number;
        last_updated: number;
      }>(
        `SELECT model_id, day_utc, help_count, hurt_count, last_updated
           FROM model_daily
          WHERE day_utc >= ?
            AND day_utc <= ?
          ORDER BY day_utc ASC`,
        input.since_date,
        input.until_date,
      )
      .toArray();
    return rows.map((r) => ({
      model_id: r.model_id,
      day_utc: r.day_utc,
      help_count: r.help_count,
      hurt_count: r.hurt_count,
      last_updated: r.last_updated,
    }));
  }

  async get(): Promise<AggregateRow> {
    const row = this.sql
      .exec<{
        model_id: string;
        help_count: number;
        hurt_count: number;
        last_updated: number;
      }>(
        `SELECT model_id, help_count, hurt_count, last_updated
           FROM model_aggregate
          LIMIT 1`,
      )
      .toArray()[0];
    if (row) return row;
    // Pre-rollup: this DO has never had a merge applied. Return a zero row
    // so /leaderboard can render uniformly without a null branch. The
    // model_id is unknown to the DO (it's keyed by idFromName at the
    // namespace, not stored), so the caller stamps it before serving.
    return {
      model_id: '',
      help_count: 0,
      hurt_count: 0,
      last_updated: 0,
    };
  }
}
