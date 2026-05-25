import { getDb } from '../auth.js';
import { ERASE_JOBS_PER_TICK } from '../constants.js';
import { chatRoomNameFor } from '../util/shard.js';
import type { Env } from '../types.js';

// Drain ≤ERASE_JOBS_PER_TICK queued erase jobs. For each: tombstone, revoke,
// scrub authored history from RoomDO. CSAM evidence preservation happens at
// flag time (moderation/index.ts orchestrator), not here · by the time the
// erase job runs, the evidence row is already in csam_evidence and won't be
// touched by the scrub. Idempotent: running twice on the same user is a
// no-op because the second pass sees deleted_at != NULL and short-circuits
// upstream at /me/erase, while the cron skips status='done' rows.
//
// Preservation holds (workstream A9): before each per-user erase we check
// db.isUserPreserved(user_id). A hit re-queues the job (status →
// 'queued') and skips the actual tombstone work. The hold expires at its
// `until` timestamp; the next cron tick after expiry processes the job
// normally.
export async function runEraseDrain(env: Env, _ctx: ExecutionContext): Promise<void> {
  const db = getDb(env);
  const claimed = await db.claimEraseJobs(ERASE_JOBS_PER_TICK);
  if (claimed.length === 0) return;

  const now = Date.now();

  for (const job of claimed) {
    // Route scrub to the user's actual shard · no fan-out across all
    // CHAT_ROOM_SHARD_IDS because the user's history only ever landed
    // on the shard their session resolved to via chatRoomNameFor.
    const roomStub = env.ROOM.get(
      env.ROOM.idFromName(chatRoomNameFor(job.user_id)),
    );
    await processEraseJob(env, db, roomStub, job, now);
  }
}

// Per-job body extracted so it can be unit-tested in isolation. Behavior is
// identical to the inlined version that lived in runEraseDrain · same
// try/catch shape, same log lines, same DO calls. The shared `now` is
// threaded in so a whole tick's worth of preservation checks compare against
// a single timestamp.
export async function processEraseJob(
  env: Env,
  db: ReturnType<typeof getDb>,
  roomStub: DurableObjectStub<import('../room.js').RoomDO>,
  job: { id: string; user_id: string },
  now: number,
): Promise<void> {
  void env;
  try {
    const heldUntil = await db.getActivePreservationUntil(job.user_id, now);
    if (heldUntil != null) {
      // Park the job in status='held' with held_until_ms set to the
      // preservation expiry. claimEraseJobs picks held rows whose
      // held_until_ms has passed, so the next tick after the hold
      // lapses re-enters the drain pipeline automatically.
      await db.finishEraseJob(job.id, 'held', { held_until_ms: heldUntil });
      console.log(
        JSON.stringify({
          evt: 'erase_skipped_preserved',
          job_id: job.id,
          user_id: job.user_id,
          held_until_ms: heldUntil,
        }),
      );
      return;
    }

    // Step 1+2: revoke (idempotent · /me/erase already did it, but a
    // job claimed via failure-recovery wouldn't have).
    await db.revokeTokens(job.user_id);

    // Step 4: scrub authored history from RoomDO. Best-effort: if the
    // RoomDO is hibernated and the call fails, we still tombstone · the
    // user_id won't exist after step 3 so no future writes can be
    // attributed to it, and a future scrub pass can replay the request
    // (RoomDO.scrubByUserId is keyed on user_id and idempotent).
    //
    // Order: scrub MUST run before tombstone for legacy parity (history
    // rows now carry user_id, so the new code path is order-independent
    // · but pre-rollout history rows can only be reached via the live
    // session's handle lookup, which requires the user row to still
    // resolve in DatabaseDO).
    try {
      await roomStub.scrubByUserId(job.user_id);
    } catch (err) {
      console.error(
        JSON.stringify({
          evt: 'erase_scrub_failed',
          user_id: job.user_id,
          err: String(err),
        }),
      );
    }

    // Step 3: tombstone. Final step so a partial failure leaves the
    // user_id resolvable for retry.
    await db.tombstoneUser(job.user_id);

    // Step 6: mark done.
    await db.finishEraseJob(job.id, 'done');
  } catch (err) {
    console.error(
      JSON.stringify({
        evt: 'erase_job_failed',
        job_id: job.id,
        user_id: job.user_id,
        err: String(err),
      }),
    );
    try {
      await db.finishEraseJob(job.id, 'failed');
    } catch {
      // Even the failure-mark failed · the next tick will see this row
      // still in 'running' and we have a leak. Log loudly; manual
      // intervention is the recovery path.
      console.error(
        JSON.stringify({
          evt: 'erase_job_status_update_failed',
          job_id: job.id,
        }),
      );
    }
  }
}
