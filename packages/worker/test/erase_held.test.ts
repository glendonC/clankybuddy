import { env as rawEnv, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types.js';

// `cloudflare:test` types `env` as the project-level `Cloudflare.Env`, which
// the worker doesn't declare globally. Cast through `unknown` to the local
// `Env` so we can access typed bindings without polluting the production
// type with a Cloudflare.Env augmentation.
const env = rawEnv as unknown as Env;

// Phase B Cluster E fix #4, preservation-hold requeue. Verifies:
//   1. Migration 005 applies cleanly (held_until_ms column exists, partial
//      index present).
//   2. finishEraseJob('held', { held_until_ms }) parks the row.
//   3. claimEraseJobs picks up status='held' rows whose held_until_ms has
//      passed and re-enters them into the drain pipeline as 'running'.
describe('erase_jobs: held status + requeue (fix #4)', () => {
  it('migration 005 added held_until_ms column and partial index', async () => {
    const id = env.DATABASE.idFromName('test-migration-005');
    const stub = env.DATABASE.get(id);
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;

      // PRAGMA table_info(erase_jobs), held_until_ms column should exist.
      const cols = sql
        .exec<{ name: string; type: string }>(
          "SELECT name, type FROM pragma_table_info('erase_jobs')",
        )
        .toArray();
      const colNames = new Set(cols.map((c) => c.name));
      expect(colNames.has('held_until_ms')).toBe(true);

      // Partial index on (held_until_ms) WHERE status = 'held', confirm by
      // name in sqlite_master.
      const idx = sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master
            WHERE type = 'index' AND name = 'idx_erase_jobs_held'`,
        )
        .toArray();
      expect(idx).toHaveLength(1);

      // Migration 005 + 006 are both in _migrations.
      const applied = sql
        .exec<{ name: string }>('SELECT name FROM _migrations')
        .toArray()
        .map((r) => r.name);
      expect(applied).toContain('005_erase_jobs_held');
      expect(applied).toContain('006_tokens_revoked_at_index');
    });
  });

  it('finishEraseJob("held") parks the row and claimEraseJobs requeues on expiry', async () => {
    const id = env.DATABASE.idFromName('test-held-requeue');
    const stub = env.DATABASE.get(id);

    // Seed a user row so enqueueEraseJob doesn't see "gone".
    const userId = 'u_test_held_requeue';
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT OR IGNORE INTO users (id, handle, color, created_at)
         VALUES (?, ?, ?, ?)`,
        userId,
        'heldfox',
        'cyan',
        Date.now(),
      );
    });

    const enq = await stub.enqueueEraseJob(userId);
    expect('job_id' in enq).toBe(true);
    if (!('job_id' in enq)) throw new Error('expected job_id');
    const jobId = enq.job_id;

    // Park the job as 'held' with held_until_ms=now-1000 (already expired,
    // claimEraseJobs should re-pick on the next sweep).
    const past = Date.now() - 1000;
    await stub.finishEraseJob(jobId, 'held', { held_until_ms: past });

    // Confirm row state via SQL: status='held', held_until_ms set.
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const row = sql
        .exec<{ status: string; held_until_ms: number | null }>(
          'SELECT status, held_until_ms FROM erase_jobs WHERE id = ?',
          jobId,
        )
        .toArray()[0];
      expect(row?.status).toBe('held');
      expect(row?.held_until_ms).toBe(past);
    });

    // Claim, should pick up the held-and-expired row as 'running'.
    const claimed = await stub.claimEraseJobs(10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(jobId);
    expect(claimed[0]?.user_id).toBe(userId);

    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const row = sql
        .exec<{ status: string; held_until_ms: number | null }>(
          'SELECT status, held_until_ms FROM erase_jobs WHERE id = ?',
          jobId,
        )
        .toArray()[0];
      expect(row?.status).toBe('running');
      expect(row?.held_until_ms).toBeNull();
    });
  });

  it('claimEraseJobs leaves still-held rows alone if held_until_ms is in the future', async () => {
    const id = env.DATABASE.idFromName('test-held-future');
    const stub = env.DATABASE.get(id);
    const userId = 'u_test_held_future';

    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT OR IGNORE INTO users (id, handle, color, created_at)
         VALUES (?, ?, ?, ?)`,
        userId,
        'futurefox',
        'cyan',
        Date.now(),
      );
    });

    const enq = await stub.enqueueEraseJob(userId);
    if (!('job_id' in enq)) throw new Error('expected job_id');
    const jobId = enq.job_id;

    // Park with held_until_ms in the future.
    const future = Date.now() + 60 * 60 * 1000;
    await stub.finishEraseJob(jobId, 'held', { held_until_ms: future });

    const claimed = await stub.claimEraseJobs(10);
    expect(claimed).toHaveLength(0);

    // Row remains in 'held' state.
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const row = sql
        .exec<{ status: string }>(
          'SELECT status FROM erase_jobs WHERE id = ?',
          jobId,
        )
        .toArray()[0];
      expect(row?.status).toBe('held');
    });
  });
});
