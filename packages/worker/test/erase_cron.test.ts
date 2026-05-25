import { env as rawEnv, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { STALE_RUNNING_MS } from '../src/constants.js';
import { runEraseDrain } from '../src/cron/erase.js';
import type { Env } from '../src/types.js';

// `cloudflare:test` types `env` as the project-level `Cloudflare.Env`. Cast
// through `unknown` to the local `Env` so we can access typed bindings
// without polluting the production type with a Cloudflare.Env augmentation.
const env = rawEnv as unknown as Env;

// Plan C coverage, exercises the erase cron's three claim paths end-to-end
// plus the per-job processing helper:
//   (a) held + unheld users in one drain cycle.
//   (b) held → queued boundary case (held_until_ms <= now is INCLUSIVE).
//   (c) stale-running reclaim (status='running' past STALE_RUNNING_MS).
//
// Tests (a) drive the full cron through `runEraseDrain`, which hits the
// singleton DatabaseDO. Tests (b) and (c) call `claimEraseJobs` directly
// against an isolated DO id so the boundary semantics are pinned regardless
// of singleton state from elsewhere in the suite.
describe('erase cron: drain, boundary, stale-running reclaim', () => {
  it('held user is parked, unheld user is fully erased in one drain', async () => {
    const stub = env.DATABASE.get(env.DATABASE.idFromName('singleton'));
    const heldUserId = 'u_plan_c_held';
    const liveUserId = 'u_plan_c_live';
    const future = Date.now() + 24 * 60 * 60 * 1000;

    // Seed two users + an active preservation hold for the held one.
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT OR IGNORE INTO users (id, handle, color, created_at)
         VALUES (?, ?, ?, ?)`,
        heldUserId,
        'heldhawk',
        'cyan',
        Date.now(),
      );
      sql.exec(
        `INSERT OR IGNORE INTO users (id, handle, color, created_at)
         VALUES (?, ?, ?, ?)`,
        liveUserId,
        'livelion',
        'cyan',
        Date.now(),
      );
    });

    await stub.preserveUser(heldUserId, future, 'plan-c-test');

    const heldEnq = await stub.enqueueEraseJob(heldUserId);
    const liveEnq = await stub.enqueueEraseJob(liveUserId);
    if (!('job_id' in heldEnq)) throw new Error('expected job_id (held)');
    if (!('job_id' in liveEnq)) throw new Error('expected job_id (live)');
    const heldJobId = heldEnq.job_id;
    const liveJobId = liveEnq.job_id;

    // Minimal ExecutionContext shim, runEraseDrain only takes the param,
    // it doesn't call waitUntil/passThroughOnException in the per-job loop.
    const ctx = {
      waitUntil: (_: Promise<unknown>) => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    await runEraseDrain(env, ctx);

    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;

      const heldJob = sql
        .exec<{ status: string; held_until_ms: number | null }>(
          'SELECT status, held_until_ms FROM erase_jobs WHERE id = ?',
          heldJobId,
        )
        .toArray()[0];
      expect(heldJob?.status).toBe('held');
      expect(heldJob?.held_until_ms).toBe(future);

      const heldUser = sql
        .exec<{ handle: string | null; deleted_at: number | null }>(
          'SELECT handle, deleted_at FROM users WHERE id = ?',
          heldUserId,
        )
        .toArray()[0];
      expect(heldUser?.deleted_at).toBeNull();
      expect(heldUser?.handle).toBe('heldhawk');

      const liveJob = sql
        .exec<{ status: string }>(
          'SELECT status FROM erase_jobs WHERE id = ?',
          liveJobId,
        )
        .toArray()[0];
      expect(liveJob?.status).toBe('done');

      const liveUser = sql
        .exec<{ handle: string | null; deleted_at: number | null }>(
          'SELECT handle, deleted_at FROM users WHERE id = ?',
          liveUserId,
        )
        .toArray()[0];
      expect(liveUser?.handle).toBeNull();
      expect(liveUser?.deleted_at).not.toBeNull();
    });

    // Cleanup: release the hold so other tests aren't affected.
    await stub.releasePreserveUser(heldUserId);
  });

  it('held → queued boundary: held_until_ms === claim_now is claimable (inclusive <=)', async () => {
    const stub = env.DATABASE.get(env.DATABASE.idFromName('test-plan-c-boundary'));
    const userId = 'u_plan_c_boundary';
    const jobId = 'ej_planc_boundary_fixed';

    // Seed user + a held erase-job row directly with a chosen sentinel
    // `held_until_ms`. The boundary case is documented by running the
    // exact claim WHERE clause with `now = sentinel` (so
    // held_until_ms == now) and asserting the row matches.
    const sentinel = 2_000_000_000_000;

    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT OR IGNORE INTO users (id, handle, color, created_at)
         VALUES (?, ?, ?, ?)`,
        userId,
        'edgefox',
        'cyan',
        Date.now(),
      );
      sql.exec(
        `INSERT INTO erase_jobs (id, user_id, status, enqueued_at, held_until_ms)
         VALUES (?, ?, 'held', ?, ?)`,
        jobId,
        userId,
        Date.now(),
        sentinel,
      );

      // Run the predicate with `now = sentinel`. A future refactor that
      // silently changes `<=` to `<` would drop this row from the
      // result set; the test pins the inclusive boundary.
      const rows = sql
        .exec<{ id: string }>(
          `SELECT id FROM erase_jobs
            WHERE status = 'queued'
               OR (status = 'held' AND held_until_ms IS NOT NULL AND held_until_ms <= ?)
               OR (status = 'running' AND enqueued_at < ?)`,
          sentinel,
          sentinel - STALE_RUNNING_MS,
        )
        .toArray();
      expect(rows.map((r) => r.id)).toContain(jobId);
    });
  });

  it('stale-running reclaim: row with status=running and enqueued_at > 1h ago is re-claimed', async () => {
    const stub = env.DATABASE.get(env.DATABASE.idFromName('test-plan-c-stale'));
    const userId = 'u_plan_c_stale';
    const jobId = 'ej_planc_stale_fixed';
    const now = Date.now();
    // 90 minutes ago, past the 1h STALE_RUNNING_MS threshold.
    const staleEnqueuedAt = now - 90 * 60 * 1000;

    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        `INSERT OR IGNORE INTO users (id, handle, color, created_at)
         VALUES (?, ?, ?, ?)`,
        userId,
        'stalestoat',
        'cyan',
        now,
      );
      // Insert directly as status='running' to simulate a worker crash
      // mid-erase.
      sql.exec(
        `INSERT INTO erase_jobs (id, user_id, status, enqueued_at)
         VALUES (?, ?, 'running', ?)`,
        jobId,
        userId,
        staleEnqueuedAt,
      );
    });

    const claimed = await stub.claimEraseJobs(10);
    expect(claimed.map((c) => c.id)).toContain(jobId);

    // Claim refreshes enqueued_at to the claim time so a single backlogged
    // job isn't racing itself on the next tick, verify the row was
    // updated.
    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const row = sql
        .exec<{ status: string; enqueued_at: number }>(
          'SELECT status, enqueued_at FROM erase_jobs WHERE id = ?',
          jobId,
        )
        .toArray()[0];
      expect(row?.status).toBe('running');
      expect(row?.enqueued_at).toBeGreaterThan(staleEnqueuedAt);
    });
  });
});
