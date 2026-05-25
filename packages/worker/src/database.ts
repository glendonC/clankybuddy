import { DurableObject } from 'cloudflare:workers';
import {
  ACCOUNT_CREATE_PER_IP_PER_HOUR,
  CSAM_PRESERVE_MS,
  MODERATION_COUNTER_FLUSH_MS,
  REFRESH_TOKEN_TTL_SEC,
  STALE_RUNNING_MS,
  TICKET_SWEEP_INTERVAL_MS,
  TICKET_TTL_MS,
  TOKEN_TTL_SEC,
  VALID_COLORS,
} from './constants.js';
import type { RepEntry } from './moderation/reputation.js';
import type { Env, User } from './types.js';

const ADJECTIVES = [
  'swift', 'quiet', 'bold', 'keen', 'witty', 'clever', 'brave', 'gentle',
  'eager', 'fierce', 'jolly', 'merry', 'quick', 'silly', 'sturdy', 'tame',
  'tiny', 'vast', 'wild', 'zesty', 'snappy', 'rusty', 'frosty', 'sunny',
  'plucky', 'sleepy', 'sneaky', 'mellow', 'noble', 'crafty',
];

const NOUNS = [
  'fox', 'owl', 'elk', 'yak', 'bear', 'cat', 'dog', 'eel',
  'frog', 'hawk', 'lion', 'mole', 'newt', 'pig', 'ram', 'seal',
  'wolf', 'crow', 'duck', 'storm', 'finch', 'lark', 'moth', 'otter',
  'panda', 'quail', 'shark', 'toad', 'viper', 'whale',
];

function pickAdj(): string {
  return ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
}
function pickNoun(): string {
  return NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
}
function generateHandle(): string {
  return pickAdj() + pickNoun();
}
function pickColor(): string {
  return VALID_COLORS[Math.floor(Math.random() * VALID_COLORS.length)]!;
}

function hourBucket(ms: number): string {
  // YYYY-MM-DDTHH, keys hourly buckets for the rolling per-IP limit.
  return new Date(ms).toISOString().slice(0, 13);
}

interface Migration {
  name: string;
  up: (sql: SqlStorage) => void;
}

// Phases 2-4 each get to add new migrations to the tail of this array.
// Never edit a shipped migration in place, append a new one.
const MIGRATIONS: Migration[] = [
  {
    name: '001_phase1_baseline',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id                 TEXT PRIMARY KEY,
          handle             TEXT UNIQUE NOT NULL,
          color              TEXT NOT NULL,
          created_at         INTEGER NOT NULL,
          deleted_at         INTEGER DEFAULT NULL,
          tokens_revoked_at  INTEGER DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_users_handle ON users (handle);

        CREATE TABLE IF NOT EXISTS tickets (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          expires_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_expires ON tickets (expires_at);

        CREATE TABLE IF NOT EXISTS account_limits (
          ip     TEXT NOT NULL,
          date   TEXT NOT NULL,
          count  INTEGER NOT NULL,
          PRIMARY KEY (ip, date)
        );

        CREATE TABLE IF NOT EXISTS user_reputation (
          user_id        TEXT PRIMARY KEY,
          score          REAL NOT NULL DEFAULT 50,
          flagged_count  INTEGER NOT NULL DEFAULT 0,
          passed_count   INTEGER NOT NULL DEFAULT 0,
          shadow_until   INTEGER DEFAULT NULL,
          updated_at     INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS erase_jobs (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL,
          status       TEXT NOT NULL,
          enqueued_at  INTEGER NOT NULL,
          finished_at  INTEGER
        );

        CREATE TABLE IF NOT EXISTS batch_dedupe (
          batch_id    TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          applied_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fingerprint_shadow (
          hash        TEXT PRIMARY KEY,
          reason      TEXT NOT NULL,
          expires_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS appeals (
          id                TEXT PRIMARY KEY,
          user_id           TEXT NOT NULL,
          msg_id            TEXT NOT NULL,
          original          TEXT NOT NULL,
          canonical         TEXT NOT NULL,
          flags             TEXT NOT NULL,
          reason_code       TEXT NOT NULL,
          user_explanation  TEXT,
          status            TEXT NOT NULL,
          created_at        INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // Phase 4F: GDPR-erase + appeal-review additions.
    // - csam_evidence: Article 17(3)(b) carve-out, flagged-CSAM artifacts
    //   preserved 90 days regardless of erasure requests, justified for LE
    //   preservation. Documented in the privacy policy; never user-appealable.
    // - appeal_human_queue: parking lot for low-confidence or sampled appeal
    //   verdicts that need a human in the loop. Phase 5+ will drain this.
    name: '002_phase4f_erase_and_appeals',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS csam_evidence (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL,
          original        TEXT NOT NULL,
          canonical       TEXT NOT NULL,
          flagged_at      INTEGER NOT NULL,
          preserve_until  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_csam_preserve_until
          ON csam_evidence(preserve_until);

        CREATE TABLE IF NOT EXISTS appeal_human_queue (
          appeal_id       TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL,
          reason          TEXT NOT NULL,
          enqueued_at     INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // Phase 4F+: preservation holds. Ops can pin a user's data against the
    // GDPR erase drain for a window (e.g. pending LE preservation request,
    // active investigation, court-ordered hold). The erase cron skips and
    // re-queues anyone with an active hold; the hold expires automatically
    // at `until` so a forgotten case_id doesn't park data forever.
    //
    // case_id is optional free-form for cross-referencing with the ops-side
    // ticketing system. We don't validate it server-side, just persist.
    name: '003_preservation_holds',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS preservation_holds (
          user_id    TEXT NOT NULL PRIMARY KEY,
          until      INTEGER NOT NULL,
          case_id    TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_preservation_holds_until
          ON preservation_holds(until);
      `);
    },
  },
  {
    // Phase B Cluster E fix #4: extend the erase_jobs status enum to
    // include 'held'. Previously a preservation-hold collision marked
    // the job 'failed', leaving held users' jobs buried and never
    // re-running when the hold expired. With held + held_until_ms, the
    // cron sweeper picks up status='held' AND held_until_ms <= now and
    // re-queues by transitioning status='queued'. Matches the GDPR
    // contract: held users get erased automatically on hold expiry.
    //
    // Partial index makes the requeue scan O(currently-held) rather than
    // O(total-erase-jobs), the table grows with every erasure forever
    // (rows aren't deleted; we keep them as audit history).
    name: '005_erase_jobs_held',
    up(sql) {
      sql.exec(`
        ALTER TABLE erase_jobs ADD COLUMN held_until_ms INTEGER;
        CREATE INDEX IF NOT EXISTS idx_erase_jobs_held
          ON erase_jobs(held_until_ms) WHERE status = 'held';
      `);
    },
  },
  {
    // Phase B Cluster E fix #6: filtered index on tokens_revoked_at.
    // listRevokedUserIds is called every BLOOM_REFRESH_INTERVAL_MS per
    // RoomDO; without this index it full-table scans every user with
    // tokens_revoked_at IS NOT NULL, linear in cumulative-ever-revoked,
    // not currently-revoked. The partial index keeps the query plan
    // bounded as the user table grows.
    name: '006_tokens_revoked_at_index',
    up(sql) {
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_tokens_revoked_at
          ON users(tokens_revoked_at) WHERE tokens_revoked_at IS NOT NULL;
      `);
    },
  },
  {
    // Plan C: drop the NOT NULL constraint on users.handle so tombstoneUser
    // can actually NULL the column at erase time. The original 001 schema
    // declared `handle TEXT UNIQUE NOT NULL` while tombstoneUser sets
    // `handle = NULL`, a silently-broken contract that integration coverage
    // surfaced. SQLite doesn't support ALTER COLUMN, so rebuild the table.
    // The UNIQUE index is preserved (NULL values are exempt from UNIQUE per
    // SQLite semantics, so multiple tombstoned rows can coexist).
    name: '007_users_handle_nullable',
    up(sql) {
      sql.exec(`
        CREATE TABLE users_new (
          id                 TEXT PRIMARY KEY,
          handle             TEXT UNIQUE,
          color              TEXT NOT NULL,
          created_at         INTEGER NOT NULL,
          deleted_at         INTEGER DEFAULT NULL,
          tokens_revoked_at  INTEGER DEFAULT NULL
        );
        INSERT INTO users_new (id, handle, color, created_at, deleted_at, tokens_revoked_at)
          SELECT id, handle, color, created_at, deleted_at, tokens_revoked_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_handle ON users (handle);
        CREATE INDEX IF NOT EXISTS idx_users_tokens_revoked_at
          ON users(tokens_revoked_at) WHERE tokens_revoked_at IS NOT NULL;
      `);
    },
  },
];

// Two independent work items share the DO alarm: ticket sweep (every
// TICKET_SWEEP_INTERVAL_MS) and moderation counter drain (every
// MODERATION_COUNTER_FLUSH_MS). Each tracks its own next-due timestamp; the
// alarm dispatcher fires whichever are due and rearms for the soonest next.
type AlarmSchedule = {
  nextSweepAt: number;
  nextCounterFlushAt: number;
};
const ALARM_SCHEDULE_KEY = 'alarm:schedule:v1';

// Plan B 2026-05-15: maintain a per-day top-N spenders snapshot DO-side so
// /admin/stats can read the leaderboard in O(N) without a KV scan. The
// red-team flagged KV.list({prefix:"muser:..."}) as a scaling cliff; this
// keeps the same data in DO storage where the write path already runs.
const TOP_SPENDERS_KEY_PREFIX = 'topspenders:';
const TOP_SPENDERS_N = 10;

export class DatabaseDO extends DurableObject<Env> {
  private sql: SqlStorage;
  // Accumulators flushed to KV by the alarm dispatcher. Lossy by design,
  // a DO eviction loses up to one flush window of counters; that's the
  // tradeoff for not paying KV write per moderation call (Challenger §4.3).
  private globalCounterDelta = 0;
  private userCounterDeltas = new Map<string, number>();
  // In-memory per-day cumulative counts for top-N tracking. Distinct from
  // userCounterDeltas (which is the unflushed-to-KV slice): this map holds
  // ALL counts seen this day so the snapshot survives a flush. Loaded
  // lazily on the first increment after a DO boot; persisted to DO
  // storage on every increment (volume is low at 100 users).
  private topSpendersDay: string | null = null;
  private topSpendersTotals = new Map<string, number>();

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
      this.sql.exec<{ name: string }>('SELECT name FROM _migrations').toArray().map((r) => r.name),
    );

    for (const m of MIGRATIONS) {
      if (applied.has(m.name)) continue;
      this.ctx.storage.transactionSync(() => {
        m.up(this.sql);
        this.sql.exec(
          'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
          m.name, Date.now(),
        );
      });
    }

    this.sql.exec(
      `INSERT INTO _meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(MIGRATIONS.length),
    );
  }

  private async loadSchedule(): Promise<AlarmSchedule> {
    const now = Date.now();
    const existing = await this.ctx.storage.get<AlarmSchedule>(ALARM_SCHEDULE_KEY);
    if (existing) return existing;
    return {
      nextSweepAt: now + TICKET_SWEEP_INTERVAL_MS,
      nextCounterFlushAt: now + MODERATION_COUNTER_FLUSH_MS,
    };
  }

  private async scheduleAlarm(): Promise<void> {
    const schedule = await this.loadSchedule();
    await this.ctx.storage.put(ALARM_SCHEDULE_KEY, schedule);
    const next = Math.min(schedule.nextSweepAt, schedule.nextCounterFlushAt);
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null || existing > next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  // Single alarm entrypoint, fans out to ticketSweep() and drainModerationCounters()
  // depending on which work items are due, then rearms for the soonest next.
  async alarm(): Promise<void> {
    const now = Date.now();
    const schedule = await this.loadSchedule();

    if (now >= schedule.nextSweepAt) {
      this.ticketSweep(now);
      schedule.nextSweepAt = now + TICKET_SWEEP_INTERVAL_MS;
    }
    if (now >= schedule.nextCounterFlushAt) {
      await this.drainModerationCounters();
      schedule.nextCounterFlushAt = now + MODERATION_COUNTER_FLUSH_MS;
    }

    await this.ctx.storage.put(ALARM_SCHEDULE_KEY, schedule);
    const next = Math.min(schedule.nextSweepAt, schedule.nextCounterFlushAt);
    await this.ctx.storage.setAlarm(next);
  }

  private ticketSweep(now: number): void {
    this.sql.exec('DELETE FROM tickets WHERE expires_at <= ?', now);
    // Hourly buckets older than ~3 days are no longer in any rolling window.
    const cutoff = hourBucket(now - 3 * 24 * 60 * 60 * 1000);
    this.sql.exec('DELETE FROM account_limits WHERE date < ?', cutoff);
  }

  private async drainModerationCounters(): Promise<void> {
    const globalDelta = this.globalCounterDelta;
    const userDeltas = this.userCounterDeltas;
    this.globalCounterDelta = 0;
    this.userCounterDeltas = new Map<string, number>();

    if (globalDelta === 0 && userDeltas.size === 0) return;

    const day = new Date().toISOString().slice(0, 10);
    const ttl = 25 * 60 * 60;
    const writes: Promise<void>[] = [];

    if (globalDelta > 0) {
      writes.push((async () => {
        const key = `mcount:${day}`;
        const cur = parseInt((await this.env.AUTH_KV.get(key)) ?? '0', 10);
        await this.env.AUTH_KV.put(key, String(cur + globalDelta), { expirationTtl: ttl });
      })());
    }

    for (const [userId, delta] of userDeltas) {
      if (delta <= 0) continue;
      writes.push((async () => {
        const key = `muser:${userId}:${day}`;
        const cur = parseInt((await this.env.AUTH_KV.get(key)) ?? '0', 10);
        await this.env.AUTH_KV.put(key, String(cur + delta), { expirationTtl: ttl });
      })());
    }

    await Promise.allSettled(writes);
  }

  async incrementModerationCounters(
    globalDelta: number,
    userDeltas: Record<string, number>,
  ): Promise<void> {
    if (globalDelta > 0) this.globalCounterDelta += globalDelta;

    const userEntries = Object.entries(userDeltas).filter(([, d]) => d > 0);
    for (const [userId, delta] of userEntries) {
      this.userCounterDeltas.set(userId, (this.userCounterDeltas.get(userId) ?? 0) + delta);
    }

    // Maintain per-day top-N. Only touches storage when there's actually a
    // user-side delta; the global-only increment path skips the snapshot.
    if (userEntries.length > 0) {
      await this.bumpTopSpenders(userEntries);
    }
  }

  // Load the persisted snapshot for today's UTC day on first use, reset the
  // in-memory map if we've crossed midnight UTC, then add the incoming
  // deltas and write the merged snapshot back. The snapshot is the source
  // /admin/stats reads, keeping it durable across DO eviction matters
  // because we don't reconstruct from `muser:` keys (the whole point of
  // this YELLOW-fix is to avoid KV-list).
  private async bumpTopSpenders(entries: [string, number][]): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    if (this.topSpendersDay !== day) {
      const stored = await this.ctx.storage.get<Record<string, number>>(
        TOP_SPENDERS_KEY_PREFIX + day,
      );
      this.topSpendersTotals = new Map(Object.entries(stored ?? {}));
      this.topSpendersDay = day;
    }
    for (const [userId, delta] of entries) {
      this.topSpendersTotals.set(
        userId,
        (this.topSpendersTotals.get(userId) ?? 0) + delta,
      );
    }
    // Persist the truncated top-N rather than the full distribution so the
    // storage row stays bounded even if 1000s of users hit the path on a
    // weird day. Sort here so reads are O(1) lookup.
    const top = this.computeTopSpenders(TOP_SPENDERS_N);
    const snapshot: Record<string, number> = {};
    for (const row of top) snapshot[row.user_id] = row.calls;
    await this.ctx.storage.put(TOP_SPENDERS_KEY_PREFIX + day, snapshot);
  }

  private computeTopSpenders(
    n: number,
  ): { user_id: string; calls: number }[] {
    const entries = [...this.topSpendersTotals.entries()];
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, n).map(([user_id, calls]) => ({ user_id, calls }));
  }

  // RPC: return the persisted snapshot for `day` (UTC, YYYY-MM-DD). If we
  // have an in-memory map for the same day it's authoritative (covers the
  // window between an increment and the storage put resolving). Otherwise
  // fall back to the durable snapshot.
  async getTopSpenders(
    day: string,
  ): Promise<{ user_id: string; calls: number }[]> {
    if (this.topSpendersDay === day && this.topSpendersTotals.size > 0) {
      return this.computeTopSpenders(TOP_SPENDERS_N);
    }
    const stored = await this.ctx.storage.get<Record<string, number>>(
      TOP_SPENDERS_KEY_PREFIX + day,
    );
    if (!stored) return [];
    const entries = Object.entries(stored).map(([user_id, calls]) => ({
      user_id,
      calls,
    }));
    entries.sort((a, b) => b.calls - a.calls);
    return entries.slice(0, TOP_SPENDERS_N);
  }

  // Returns the in-memory pending global counter delta WITHOUT draining it.
  // The kill switch sums this with the KV-backed counter to evaluate current
  // daily cost, closes the up-to-MODERATION_COUNTER_FLUSH_MS lag where a
  // burst of moderation calls can accrue invisibly to a pure KV read.
  async readPendingGlobalDelta(): Promise<number> {
    return this.globalCounterDelta;
  }

  // Force-drain the moderation counters to KV. Called by the kill switch
  // at threshold-trip time so the post-flip KV view reflects all calls
  // accrued before the flip rather than waiting up to one flush window.
  async flushModerationCounters(): Promise<void> {
    await this.drainModerationCounters();
  }

  // ---- Users ----

  async createUser(): Promise<User | { error: 'handle_exhausted' }> {
    const id = `u_${crypto.randomUUID()}`;
    const color = pickColor();
    let handle: string | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0
        ? generateHandle()
        : generateHandle() + crypto.randomUUID().slice(0, 4);
      const exists = this.sql
        .exec('SELECT 1 FROM users WHERE handle = ?', candidate)
        .toArray()[0];
      if (!exists) {
        handle = candidate;
        break;
      }
    }
    if (!handle) return { error: 'handle_exhausted' };

    const created_at = Date.now();
    this.sql.exec(
      'INSERT INTO users (id, handle, color, created_at) VALUES (?, ?, ?, ?)',
      id, handle, color, created_at,
    );
    return { id, handle, color, created_at };
  }

  async getUser(id: string): Promise<User | null> {
    const row = this.sql
      .exec<User & { deleted_at: number | null }>(
        'SELECT id, handle, color, created_at, deleted_at FROM users WHERE id = ?',
        id,
      )
      .toArray()[0];
    if (!row || row.deleted_at != null) return null;
    return { id: row.id, handle: row.handle, color: row.color, created_at: row.created_at };
  }

  // ---- Tickets ----

  async issueTicket(userId: string): Promise<string> {
    const id = `tk_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const expires_at = Date.now() + TICKET_TTL_MS;
    this.sql.exec(
      'INSERT INTO tickets (id, user_id, expires_at) VALUES (?, ?, ?)',
      id, userId, expires_at,
    );
    return id;
  }

  // Atomic consume: DELETE … RETURNING is one statement, so the row is gone
  // by the time the caller sees the user_id. No TOCTOU window.
  async consumeTicket(ticketId: string): Promise<string | null> {
    const rows = this.sql
      .exec<{ user_id: string }>(
        'DELETE FROM tickets WHERE id = ? AND expires_at > ? RETURNING user_id',
        ticketId, Date.now(),
      )
      .toArray();
    return rows[0]?.user_id ?? null;
  }

  // ---- Reputation ----

  // Returns the row, seeding score=50 + flagged_count=passed_count=0 the first
  // time we see a given user. created_at is sourced from the users table so the
  // RepEntry can carry it back to RoomDO for the "<24h cohort" slow-mode check.
  async getReputation(user_id: string): Promise<RepEntry> {
    const existing = this.sql
      .exec<{
        user_id: string;
        score: number;
        flagged_count: number;
        passed_count: number;
        shadow_until: number | null;
        updated_at: number;
      }>(
        `SELECT user_id, score, flagged_count, passed_count, shadow_until, updated_at
           FROM user_reputation WHERE user_id = ?`,
        user_id,
      )
      .toArray()[0];

    const userRow = this.sql
      .exec<{ created_at: number }>(
        'SELECT created_at FROM users WHERE id = ?',
        user_id,
      )
      .toArray()[0];
    const created_at = userRow?.created_at ?? Date.now();

    if (existing) {
      return {
        user_id: existing.user_id,
        score: existing.score,
        flagged_count: existing.flagged_count,
        passed_count: existing.passed_count,
        shadow_until: existing.shadow_until,
        updated_at: existing.updated_at,
        created_at,
      };
    }

    const now = Date.now();
    this.sql.exec(
      `INSERT INTO user_reputation
         (user_id, score, flagged_count, passed_count, shadow_until, updated_at)
       VALUES (?, 50, 0, 0, NULL, ?)`,
      user_id, now,
    );
    return {
      user_id,
      score: 50,
      flagged_count: 0,
      passed_count: 0,
      shadow_until: null,
      updated_at: now,
      created_at,
    };
  }

  async adjustReputation(
    user_id: string,
    delta: number,
    opts?: { flagged?: boolean; passed?: boolean },
  ): Promise<RepEntry> {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      // Seed if missing so the UPDATE below has a row to operate on.
      this.sql.exec(
        `INSERT OR IGNORE INTO user_reputation
           (user_id, score, flagged_count, passed_count, shadow_until, updated_at)
         VALUES (?, 50, 0, 0, NULL, ?)`,
        user_id, now,
      );
      const flaggedInc = opts?.flagged ? 1 : 0;
      const passedInc = opts?.passed ? 1 : 0;
      this.sql.exec(
        `UPDATE user_reputation
            SET score          = MAX(0, MIN(100, score + ?)),
                flagged_count  = flagged_count + ?,
                passed_count   = passed_count + ?,
                updated_at     = ?
          WHERE user_id = ?`,
        delta, flaggedInc, passedInc, now, user_id,
      );
      const row = this.sql
        .exec<{
          user_id: string;
          score: number;
          flagged_count: number;
          passed_count: number;
          shadow_until: number | null;
          updated_at: number;
        }>(
          `SELECT user_id, score, flagged_count, passed_count, shadow_until, updated_at
             FROM user_reputation WHERE user_id = ?`,
          user_id,
        )
        .toArray()[0]!;
      const userRow = this.sql
        .exec<{ created_at: number }>(
          'SELECT created_at FROM users WHERE id = ?',
          user_id,
        )
        .toArray()[0];
      return {
        user_id: row.user_id,
        score: row.score,
        flagged_count: row.flagged_count,
        passed_count: row.passed_count,
        shadow_until: row.shadow_until,
        updated_at: row.updated_at,
        created_at: userRow?.created_at ?? now,
      };
    });
  }

  async setShadowUntil(user_id: string, until_ms: number): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO user_reputation (user_id, score, flagged_count, passed_count, shadow_until, updated_at)
         VALUES (?, 50, 0, 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET shadow_until = excluded.shadow_until, updated_at = excluded.updated_at`,
      user_id, until_ms, now,
    );
  }

  async clearShadow(user_id: string): Promise<void> {
    this.sql.exec(
      'UPDATE user_reputation SET shadow_until = NULL, updated_at = ? WHERE user_id = ?',
      Date.now(), user_id,
    );
  }

  // ---- Account creation limit ----

  // ---- Token revocation ----

  // Returns the user's tokens_revoked_at timestamp, or null if never revoked.
  // authenticate() compares this against the access-token issued_at metadata
  // to enforce ≤60s revocation propagation alongside the per-RoomDO bloom.
  async getTokensRevokedAt(user_id: string): Promise<number | null> {
    const row = this.sql
      .exec<{ tokens_revoked_at: number | null }>(
        'SELECT tokens_revoked_at FROM users WHERE id = ?',
        user_id,
      )
      .toArray()[0];
    return row?.tokens_revoked_at ?? null;
  }

  async revokeTokens(user_id: string): Promise<void> {
    this.sql.exec(
      'UPDATE users SET tokens_revoked_at = ? WHERE id = ?',
      Date.now(), user_id,
    );
  }

  // List of user_ids that currently have a non-null tokens_revoked_at AND
  // haven't been tombstoned (deleted_at IS NULL, once tombstoned the row
  // can't reauth anyway). Sourced into the per-RoomDO bloom every ~60s.
  async listRevokedUserIds(): Promise<string[]> {
    const rows = this.sql
      .exec<{ id: string }>(
        'SELECT id FROM users WHERE tokens_revoked_at IS NOT NULL AND deleted_at IS NULL',
      )
      .toArray();
    return rows.map((r) => r.id);
  }

  // ---- Refresh-token rotation ----
  //
  // Atomic in DB-and-KV order: read+delete refresh from KV, then issue a new
  // access+refresh pair. The DO method seam matters because the calling
  // Worker is a stateless edge function, running rotation through the
  // singleton DO serializes concurrent /auth/refresh hits for the same
  // refresh_token via blockConcurrencyWhile-equivalent SQL transaction
  // ordering on the same DO request queue. Same DO that hands out tickets,
  // same TOCTOU class.
  async rotateRefreshToken(
    refresh_token: string,
  ): Promise<{ token: string; refresh_token: string; user_id: string } | null> {
    if (!refresh_token.startsWith('rt_')) return null;

    const oldKey = `refresh:${refresh_token}`;
    const userId = await this.env.AUTH_KV.get(oldKey);
    if (!userId) return null;

    // The user might have been tombstoned (deleted_at) or have an active
    // tokens_revoked_at older than this refresh. Either way: refuse to
    // rotate. (A revoked-but-not-tombstoned user can recover by going
    // through /auth/init again.)
    const userRow = this.sql
      .exec<{ deleted_at: number | null; tokens_revoked_at: number | null }>(
        'SELECT deleted_at, tokens_revoked_at FROM users WHERE id = ?',
        userId,
      )
      .toArray()[0];
    if (!userRow || userRow.deleted_at != null) {
      // Best-effort cleanup of the orphaned refresh.
      await this.env.AUTH_KV.delete(oldKey);
      return null;
    }
    if (userRow.tokens_revoked_at != null) {
      await this.env.AUTH_KV.delete(oldKey);
      return null;
    }

    // Delete the old token first so even if the put-and-mint sequence below
    // fails partway, the consumed refresh can't be replayed.
    await this.env.AUTH_KV.delete(oldKey);

    const now = Date.now();
    const newAccess = `tok_${crypto.randomUUID().replace(/-/g, '')}`;
    const newRefresh = `rt_${crypto.randomUUID().replace(/-/g, '')}`;

    await Promise.all([
      this.env.AUTH_KV.put(`token:${newAccess}`, userId, {
        expirationTtl: TOKEN_TTL_SEC,
        metadata: { issued_at: now },
      }),
      this.env.AUTH_KV.put(`refresh:${newRefresh}`, userId, {
        expirationTtl: REFRESH_TOKEN_TTL_SEC,
        metadata: { issued_at: now },
      }),
    ]);

    return { token: newAccess, refresh_token: newRefresh, user_id: userId };
  }

  // ---- Erase jobs ----

  // Idempotent enqueue. If the user is already tombstoned we return 'gone' so
  // the caller can return 410, replaying /me/erase against an already-erased
  // account shouldn't queue more work.
  async enqueueEraseJob(
    user_id: string,
  ): Promise<{ job_id: string; status: 'queued' | 'already_queued' } | { gone: true }> {
    const userRow = this.sql
      .exec<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM users WHERE id = ?',
        user_id,
      )
      .toArray()[0];
    if (!userRow) return { gone: true };
    if (userRow.deleted_at != null) return { gone: true };

    const existing = this.sql
      .exec<{ id: string }>(
        `SELECT id FROM erase_jobs
          WHERE user_id = ? AND status IN ('queued', 'running', 'held')
          LIMIT 1`,
        user_id,
      )
      .toArray()[0];
    if (existing) {
      return { job_id: existing.id, status: 'already_queued' };
    }

    const id = `ej_${crypto.randomUUID().replace(/-/g, '')}`;
    this.sql.exec(
      `INSERT INTO erase_jobs (id, user_id, status, enqueued_at)
       VALUES (?, ?, 'queued', ?)`,
      id, user_id, Date.now(),
    );
    return { job_id: id, status: 'queued' };
  }

  // Atomically claim up to `max` erase jobs by transitioning them to
  // 'running'. Picks up:
  //   - status='queued' rows (normal flow)
  //   - status='held' rows whose held_until_ms has passed (preservation
  //     hold expired, see fix #4 / migration 005). These re-enter the
  //     drain pipeline automatically; ops doesn't have to re-enqueue
  //     anything when a hold lapses.
  //   - status='running' rows older than STALE_RUNNING_MS, Plan C
  //     reclaim. Closes the compliance hole where a worker crash
  //     mid-erase leaves a row stuck in 'running' forever; after the
  //     stale window the next tick re-claims it and retries the
  //     tombstone/scrub work. Idempotent: revokeTokens, scrubByUserId,
  //     and tombstoneUser all no-op on a second pass.
  // The cron drains the returned set; on each success it calls
  // finishEraseJob('done'); on error finishEraseJob('failed'); on
  // preservation collision finishEraseJob('held', { held_until_ms }).
  async claimEraseJobs(max: number): Promise<{ id: string; user_id: string }[]> {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const rows = this.sql
        .exec<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM erase_jobs
            WHERE status = 'queued'
               OR (status = 'held' AND held_until_ms IS NOT NULL AND held_until_ms <= ?)
               OR (status = 'running' AND enqueued_at < ?)
            ORDER BY enqueued_at ASC
            LIMIT ?`,
          now,
          now - STALE_RUNNING_MS,
          max,
        )
        .toArray();
      for (const r of rows) {
        // Refresh enqueued_at to `now` on claim so the stale-running
        // predicate (enqueued_at < now - STALE_RUNNING_MS) measures
        // "time since this claim" rather than "time since original
        // enqueue." Without this, a queued job that sat past the stale
        // window for any reason (deploy gap, cron lock, backlog) would
        // be re-claimable immediately on the very next tick, racing
        // the in-flight processor.
        this.sql.exec(
          `UPDATE erase_jobs
              SET status = 'running',
                  held_until_ms = NULL,
                  enqueued_at = ?
            WHERE id = ?`,
          now,
          r.id,
        );
      }
      return rows.map((r) => ({ id: r.id, user_id: r.user_id }));
    });
  }

  // Per fix #4: 'held' is a first-class terminal-but-revivable status. When
  // the cron hits a preservation-hold collision it marks the job 'held'
  // with held_until_ms set to the hold's expiry. The next claimEraseJobs
  // tick after that ms picks the row up automatically.
  async finishEraseJob(
    id: string,
    status: 'done' | 'failed' | 'held',
    opts?: { held_until_ms?: number },
  ): Promise<void> {
    if (status === 'held') {
      this.sql.exec(
        `UPDATE erase_jobs
            SET status = 'held',
                held_until_ms = ?,
                finished_at = ?
          WHERE id = ?`,
        opts?.held_until_ms ?? null,
        Date.now(),
        id,
      );
      return;
    }
    this.sql.exec(
      `UPDATE erase_jobs
          SET status = ?,
              held_until_ms = NULL,
              finished_at = ?
        WHERE id = ?`,
      status,
      Date.now(),
      id,
    );
  }

  // Tombstone the user row: NULL out PII-equivalent fields and set deleted_at.
  // The handle UNIQUE index doesn't conflict because NULL UNIQUE permits
  // multiple NULLs in SQLite; tombstoned rows persist indefinitely as
  // identity-continuity records.
  async tombstoneUser(user_id: string): Promise<void> {
    this.sql.exec(
      `UPDATE users
          SET handle = NULL,
              color = '',
              deleted_at = ?,
              tokens_revoked_at = COALESCE(tokens_revoked_at, ?)
        WHERE id = ?`,
      Date.now(), Date.now(), user_id,
    );
  }

  // ---- CSAM evidence (Article 17(3)(b) carve-out) ----
  //
  // Why this exists: GDPR Article 17 grants a right to erasure, but Article
  // 17(3)(b) carves out processing necessary for compliance with a legal
  // obligation. 18 USC §2258A obliges ESPs to preserve CSAM-related artifacts
  // for 90 days on report. This table is the preservation lane, even when
  // the user requests /me/erase, rows here remain for CSAM_PRESERVE_DAYS.
  async writeCsamEvidence(
    user_id: string,
    original: string,
    canonical: string,
  ): Promise<void> {
    const now = Date.now();
    const id = `cs_${crypto.randomUUID().replace(/-/g, '')}`;
    this.sql.exec(
      `INSERT INTO csam_evidence
         (id, user_id, original, canonical, flagged_at, preserve_until)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, user_id, original, canonical, now, now + CSAM_PRESERVE_MS,
    );
  }

  // ---- Appeals audit log ----
  //
  // The KV `appeal:<token>` is the in-flight token; this row is the durable
  // audit trail. Created at block time with status='pending'. The appeal
  // cron flips status to 'overturned' / 'upheld' / 'human_review'.
  async insertAppealRow(args: {
    id: string;
    user_id: string;
    msg_id: string;
    original: string;
    canonical: string;
    flags: string;
    reason_code: string;
    user_explanation: string | null;
    status: string;
    created_at: number;
  }): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO appeals
         (id, user_id, msg_id, original, canonical, flags, reason_code,
          user_explanation, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args.id, args.user_id, args.msg_id, args.original, args.canonical,
      args.flags, args.reason_code, args.user_explanation, args.status,
      args.created_at,
    );
  }

  async updateAppealStatus(id: string, status: string): Promise<void> {
    this.sql.exec(
      'UPDATE appeals SET status = ? WHERE id = ?',
      status, id,
    );
  }

  async enqueueAppealHumanReview(
    appeal_id: string,
    user_id: string,
    reason: string,
  ): Promise<void> {
    this.sql.exec(
      `INSERT OR IGNORE INTO appeal_human_queue
         (appeal_id, user_id, reason, enqueued_at)
       VALUES (?, ?, ?, ?)`,
      appeal_id, user_id, reason, Date.now(),
    );
  }

  async checkAndConsumeAccountLimit(
    ip: string,
    maxPerHour = ACCOUNT_CREATE_PER_IP_PER_HOUR,
  ): Promise<{ allowed: boolean; count: number }> {
    const now = Date.now();
    const bucket = hourBucket(now);
    const windowStart = hourBucket(now - 60 * 60 * 1000);

    return this.ctx.storage.transactionSync(() => {
      const totalRows = this.sql
        .exec<{ total: number }>(
          'SELECT COALESCE(SUM(count), 0) AS total FROM account_limits WHERE ip = ? AND date >= ?',
          ip, windowStart,
        )
        .toArray();
      const count = totalRows[0]?.total ?? 0;
      if (count >= maxPerHour) return { allowed: false, count };

      this.sql.exec(
        `INSERT INTO account_limits (ip, date, count) VALUES (?, ?, 1)
         ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`,
        ip, bucket,
      );
      return { allowed: true, count: count + 1 };
    });
  }

  // ---- Preservation holds (admin) ----
  //
  // The erase cron checks isUserPreserved(user_id) before tombstoning each
  // claimed job; a hit skips and re-queues that job. Holds expire at
  // `until`; ops sets a deliberate window (typically 30 days for an LE
  // preservation request, longer if a court order arrives).
  //
  // Idempotent on user_id: a fresh /admin/preserve POST for an already-held
  // user updates the until/case_id rather than failing. This matches ops
  // workflow, an extension on an existing hold is one POST, not "release
  // then re-create."
  async preserveUser(
    user_id: string,
    until: number,
    case_id?: string,
  ): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO preservation_holds (user_id, until, case_id, created_at)
         VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE
         SET until      = excluded.until,
             case_id    = excluded.case_id,
             created_at = excluded.created_at`,
      user_id, until, case_id ?? null, now,
    );
  }

  async releasePreserveUser(user_id: string): Promise<void> {
    this.sql.exec(
      'DELETE FROM preservation_holds WHERE user_id = ?',
      user_id,
    );
  }

  // Returns active holds (until > now). Used by ops dashboards / audits;
  // not on any hot path. Lightweight scan; the index on `until` makes the
  // walk linear in the live-hold count rather than the historical total.
  async listActivePreservations(
    now: number,
  ): Promise<{ user_id: string; until: number; case_id: string | null; created_at: number }[]> {
    return this.sql
      .exec<{
        user_id: string;
        until: number;
        case_id: string | null;
        created_at: number;
      }>(
        `SELECT user_id, until, case_id, created_at
           FROM preservation_holds
          WHERE until > ?
          ORDER BY until ASC`,
        now,
      )
      .toArray();
  }

  // Single-user predicate used by the erase cron. Returning true causes the
  // cron to skip + requeue the job; the next tick re-checks. We intentionally
  // do NOT auto-clean expired rows here, the row stays as audit history
  // until ops releases it or a future sweep evicts old expired entries.
  async isUserPreserved(user_id: string, now: number): Promise<boolean> {
    const row = this.sql
      .exec<{ until: number }>(
        'SELECT until FROM preservation_holds WHERE user_id = ?',
        user_id,
      )
      .toArray()[0];
    return !!row && row.until > now;
  }

  // Returns the active hold's `until` epoch ms, or null if no active hold.
  // Used by the erase cron (fix #4) to stamp held_until_ms on the job so
  // claimEraseJobs picks the row up automatically when the hold lapses.
  async getActivePreservationUntil(
    user_id: string,
    now: number,
  ): Promise<number | null> {
    const row = this.sql
      .exec<{ until: number }>(
        'SELECT until FROM preservation_holds WHERE user_id = ?',
        user_id,
      )
      .toArray()[0];
    if (!row || row.until <= now) return null;
    return row.until;
  }
}
