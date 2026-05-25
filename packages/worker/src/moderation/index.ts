import { getDb } from '../auth.js';
import type { Env } from '../types.js';
import { normalize, type Normalized } from './normalize.js';
import { tier1Check } from './tier1.js';
import { tier2Check, type Tier2Result } from './tier2.js';
import { ADJUSTMENTS, bandOf, type RepBand, type RepEntry } from './reputation.js';

// Llama Guard category that maps to CSAM (S4 in the taxonomy used by
// `parseLlamaGuardOutput` → 'tier2_csam'). CSAM blocks are NOT user-appealable
// (Phase 4F scope) AND trigger the Article 17(3)(b) preservation lane,
// `csam_evidence` row written even if the user later requests /me/erase.
const CSAM_BLOCK_REASON = 'tier2_csam';

function isCsamBlock(t2: Tier2Result): boolean {
  if (t2.reason === CSAM_BLOCK_REASON) return true;
  return Array.isArray(t2.categories) && t2.categories.includes('S4');
}

export interface ModerationDecision {
  allowed: boolean;
  shadow: boolean;
  blockReason?: string;
  appealToken?: string;
  normalized: Normalized;
  band: RepBand;
  // Rep delta the orchestrator wants applied. RoomDO writes through to
  // DatabaseDO and updates the local cache.
  repDelta: number;
  // Whether RoomDO should bump flagged_count or passed_count.
  flagged: boolean;
  passed: boolean;
  // For audit-sample / 1% trusted lane: what tier2 said even when we ignored it.
  auditTier2?: Tier2Result;
  // Echo of msg_id assigned at orchestrator layer so the appeal token row
  // and the 'blocked' event reference the same id.
  msg_id: string;
}

const APPEAL_TTL_SECONDS = 24 * 60 * 60;
const TRUSTED_AUDIT_SAMPLE_RATE = 0.01;
const TRUSTED_RACE_BUDGET_MS = 250;

export interface AppealRecord {
  user_id: string;
  msg_id: string;
  original: string;
  canonical: string;
  flags: Normalized['flags'];
  blockReason: string;
  created_at: number;
}

function hasAnyNormalizationFlag(n: Normalized): boolean {
  return (
    n.flags.hadInvisibles ||
    n.flags.hadHomoglyph ||
    n.flags.hadCombining ||
    n.flags.hadLeet ||
    n.flags.repetitionRatio > 0.3
  );
}

async function issueAppealToken(
  env: Env,
  ctx: ExecutionContext,
  record: AppealRecord,
): Promise<string> {
  const token = `ap_${crypto.randomUUID().replace(/-/g, '')}`;
  // Phase 4 reads `appeal:<token>` to populate the appeals review queue.
  ctx.waitUntil(
    env.AUTH_KV.put(`appeal:${token}`, JSON.stringify(record), {
      expirationTtl: APPEAL_TTL_SECONDS,
    }),
  );
  return token;
}

async function tier2WithBudget(
  canonical: string,
  user_id: string,
  env: Env,
  ctx: ExecutionContext,
  budgetMs: number,
): Promise<Tier2Result | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), budgetMs);
  });
  try {
    const result = await Promise.race([tier2Check(canonical, user_id, env, ctx), timeoutPromise]);
    return result;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

export async function checkContent(
  text: string,
  user_id: string,
  rep: RepEntry,
  env: Env,
  ctx: ExecutionContext,
): Promise<ModerationDecision> {
  const msg_id = crypto.randomUUID();
  const normalized = normalize(text);
  const band = bandOf(rep.score, rep.shadow_until);

  if (band === 'shadow') {
    return {
      allowed: false,
      shadow: true,
      normalized,
      band,
      repDelta: 0,
      flagged: false,
      passed: false,
      msg_id,
    };
  }

  // Banned should be caught by the auth layer (token revoked) before reaching
  // this code. Treat as a hard drop if we ever do see one.
  if (band === 'banned') {
    return {
      allowed: false,
      shadow: false,
      blockReason: 'banned',
      normalized,
      band,
      repDelta: 0,
      flagged: false,
      passed: false,
      msg_id,
    };
  }

  const t1 = tier1Check(normalized.canonical);
  if (t1.hit) {
    const appealToken = await issueAppealToken(env, ctx, {
      user_id,
      msg_id,
      original: normalized.original,
      canonical: normalized.canonical,
      flags: normalized.flags,
      blockReason: 'tier1',
      created_at: Date.now(),
    });
    return {
      allowed: false,
      shadow: false,
      blockReason: 'tier1',
      appealToken,
      normalized,
      band,
      repDelta: ADJUSTMENTS.tier1Hit,
      flagged: true,
      passed: false,
      msg_id,
    };
  }

  const flagged = hasAnyNormalizationFlag(normalized);

  if (band === 'trusted' && !flagged) {
    // Race lane: broadcast immediately. Sample 1% to Tier 2 audit. The verdict
    // is logged but never blocks; this gives us a passive false-negative
    // signal without penalizing trusted users for our infra.
    let auditTier2: Tier2Result | undefined;
    if (Math.random() < TRUSTED_AUDIT_SAMPLE_RATE) {
      try {
        auditTier2 = await tier2Check(normalized.canonical, user_id, env, ctx);
      } catch {
        // Audit-only, failures don't change the decision.
      }
    }
    return {
      allowed: true,
      shadow: false,
      normalized,
      band,
      repDelta: ADJUSTMENTS.cleanBroadcast,
      flagged: false,
      passed: true,
      auditTier2,
      msg_id,
    };
  }

  // Trusted-with-flags is a special race lane: gate Tier 2 with a 250ms budget
  // and fail-OPEN on timeout/error. Trust + signal of bypass attempt → check
  // but don't punish for our latency.
  if (band === 'trusted' && flagged) {
    const raced = await tier2WithBudget(normalized.canonical, user_id, env, ctx, TRUSTED_RACE_BUDGET_MS);
    if ('timedOut' in raced) {
      return {
        allowed: true,
        shadow: false,
        normalized,
        band,
        // Trusted-but-flagged: fail-open keeps the message but we don't reward
        // it, neither bonus nor penalty until Tier 2 has actually weighed in.
        repDelta: 0,
        flagged: false,
        passed: true,
        msg_id,
      };
    }
    // Tier 2 returned. Honor the verdict for trusted users with flags.
    if (raced.blocked && raced.reason !== 'tier2_unavailable') {
      // CSAM carve-out: no appeal token, write evidence row instead.
      const csam = isCsamBlock(raced);
      if (csam) {
        ctx.waitUntil(
          getDb(env).writeCsamEvidence(user_id, normalized.original, normalized.canonical),
        );
      }
      const appealToken = csam
        ? undefined
        : await issueAppealToken(env, ctx, {
            user_id,
            msg_id,
            original: normalized.original,
            canonical: normalized.canonical,
            flags: normalized.flags,
            blockReason: raced.reason ?? 'tier2_unsafe',
            created_at: Date.now(),
          });
      return {
        allowed: false,
        shadow: false,
        blockReason: raced.reason,
        appealToken,
        normalized,
        band,
        repDelta: ADJUSTMENTS.tier2Hit,
        flagged: true,
        passed: false,
        msg_id,
      };
    }
    if (raced.blocked && raced.reason === 'tier2_unavailable') {
      // Trusted lane fails OPEN, orchestrator override of tier2's default.
      return {
        allowed: true,
        shadow: false,
        normalized,
        band,
        repDelta: 0,
        flagged: false,
        passed: true,
        msg_id,
      };
    }
    return {
      allowed: true,
      shadow: false,
      normalized,
      band,
      repDelta: ADJUSTMENTS.flagOnlyNoHit,
      flagged: false,
      passed: true,
      msg_id,
    };
  }

  // default | suspect | gated → Tier 2 gates broadcast, no time budget,
  // fail-CLOSED on outage.
  const t2 = await tier2Check(normalized.canonical, user_id, env, ctx);
  if (t2.blocked) {
    const isInfraFailure = t2.reason === 'tier2_unavailable';
    const csam = !isInfraFailure && isCsamBlock(t2);
    if (csam) {
      // Article 17(3)(b) carve-out: preserve the artifact for 90 days even
      // if the user later requests /me/erase. CSAM is never appealable,
      // appeals are for FP correction, not for arguing intent on
      // categorically-prohibited content.
      ctx.waitUntil(
        getDb(env).writeCsamEvidence(user_id, normalized.original, normalized.canonical),
      );
    }
    // Infra failures aren't appealable, they're not a moderation decision
    // the user can argue, just a temporary block until Tier 2 recovers.
    // CSAM blocks: see CSAM_BLOCK_REASON comment above.
    const appealToken = isInfraFailure || csam
      ? undefined
      : await issueAppealToken(env, ctx, {
          user_id,
          msg_id,
          original: normalized.original,
          canonical: normalized.canonical,
          flags: normalized.flags,
          blockReason: t2.reason ?? 'tier2_unsafe',
          created_at: Date.now(),
        });
    return {
      allowed: false,
      shadow: false,
      blockReason: t2.reason,
      appealToken,
      normalized,
      band,
      repDelta: isInfraFailure ? 0 : ADJUSTMENTS.tier2Hit,
      flagged: !isInfraFailure,
      passed: false,
      msg_id,
    };
  }

  // Tier 2 passed. Reward only if there were no normalization flags; otherwise
  // penalize lightly for "they tried but missed".
  return {
    allowed: true,
    shadow: false,
    normalized,
    band,
    repDelta: flagged ? ADJUSTMENTS.flagOnlyNoHit : ADJUSTMENTS.cleanBroadcast,
    flagged,
    passed: !flagged,
    msg_id,
  };
}

export type { RepBand, RepEntry } from './reputation.js';
export type { Normalized } from './normalize.js';
