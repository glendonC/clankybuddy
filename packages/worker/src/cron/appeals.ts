import { getDb } from '../auth.js';
import {
  APPEALS_PER_TICK,
  APPEAL_HUMAN_REVIEW_BELOW,
  APPEAL_OVERTURN_CONFIDENCE,
  APPEAL_UPHOLD_SAMPLE_RATE,
} from '../constants.js';
import { ADJUSTMENTS } from '../moderation/reputation.js';
import type { AppealRecord } from '../moderation/index.js';
import type { Env } from '../types.js';
import { chatRoomNameFor } from '../util/shard.js';

interface AppealKvEntry extends AppealRecord {
  user_explanation?: string;
}

// Scan up to scanLimit `appeal:` keys, return only those with a
// user_explanation set (i.e. the user actually submitted, not just got
// blocked). Cap returned to APPEALS_PER_TICK.
async function listSubmittedAppeals(
  env: Env,
  scanLimit: number,
): Promise<{ token: string; record: AppealKvEntry }[]> {
  const out: { token: string; record: AppealKvEntry }[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  while (out.length < APPEALS_PER_TICK && scanned < scanLimit) {
    const list = await env.AUTH_KV.list({ prefix: 'appeal:', cursor, limit: 1000 });
    for (const k of list.keys) {
      scanned++;
      if (scanned >= scanLimit) break;
      const raw = await env.AUTH_KV.get(k.name);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw) as AppealKvEntry;
        if (typeof rec.user_explanation !== 'string') continue;
        out.push({ token: k.name.slice('appeal:'.length), record: rec });
        if (out.length >= APPEALS_PER_TICK) break;
      } catch {
        // Corrupt entry, skip and let TTL expire it.
      }
    }
    if (list.list_complete || !list.cursor) break;
    cursor = list.cursor;
  }
  return out;
}

interface ReviewVerdict {
  decision: 'overturn' | 'uphold';
  confidence: number;
  reason?: string;
  tuning_note?: string;
}

const REVIEW_PROMPT_PREFIX = [
  'You are reviewing a chat moderation decision for ClankyBuddy, an anonymous',
  'chat where users vent about AI products (Claude/GPT/Gemini/Llama). Venting,',
  'sarcasm, and frustration about these AI products IS allowed. Slurs targeting',
  'people, harassment of named individuals at AI companies, sexual content',
  'involving minors, and explicit incitement to violence are NOT allowed.',
].join(' ');

interface AiResponseShape {
  response?: string;
}

function buildPrompt(rec: AppealKvEntry): string {
  return [
    REVIEW_PROMPT_PREFIX,
    '',
    `Original: ${rec.original}`,
    `Canonical (normalized): ${rec.canonical}`,
    `User's explanation: ${rec.user_explanation ?? ''}`,
    `Bypass flags detected: ${JSON.stringify(rec.flags)}`,
    `Original decision: BLOCKED (reason: ${rec.blockReason})`,
    '',
    'Respond JSON: {',
    '  "decision": "uphold" | "overturn",',
    '  "confidence": 0..1,',
    '  "reason": "<one sentence>",',
    '  "tuning_note": "<if false-positive, one sentence on what mis-fired>"',
    '}',
  ].join('\n');
}

function parseVerdict(raw: unknown): ReviewVerdict | null {
  const text = typeof raw === 'string' ? raw : '';
  if (!text) return null;
  // The model may wrap JSON in prose or fences. Extract the first balanced
  // brace-pair greedily; if that doesn't parse, fall back to a permissive
  // first-{...}-to-last-} slice.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const body = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const decision = parsed['decision'];
    const confidence = parsed['confidence'];
    if (decision !== 'overturn' && decision !== 'uphold') return null;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
    return {
      decision,
      confidence: Math.max(0, Math.min(1, confidence)),
      reason: typeof parsed['reason'] === 'string' ? parsed['reason'] : undefined,
      tuning_note:
        typeof parsed['tuning_note'] === 'string' ? parsed['tuning_note'] : undefined,
    };
  } catch {
    return null;
  }
}

async function callReviewer(env: Env, prompt: string): Promise<ReviewVerdict | null> {
  // Plan §7f names Claude Haiku as the preferred reviewer with Llama Guard as
  // fallback. Workers AI exposes Llama 3 family models; absent a Haiku
  // binding (which would require the env to plumb an Anthropic API key) we
  // ship with @cf/meta/llama-3.1-8b-instruct as the reasoning model. The
  // prompt asks for structured JSON; if the model returns prose we fall
  // through to human_review.
  try {
    const response = (await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: REVIEW_PROMPT_PREFIX },
        { role: 'user', content: prompt },
      ],
      max_tokens: 256,
      // The Workers AI binding signature is generic over model registry; we
      // intentionally cast at the boundary.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as AiResponseShape;
    return parseVerdict(response?.response);
  } catch {
    return null;
  }
}

async function bestEffortNotifyOverturn(
  env: Env,
  user_id: string,
): Promise<void> {
  // Best-effort: if the user is connected to the room, send a system note.
  // Don't block on it; if the RoomDO is hibernated or the call fails, the
  // appeal is still recorded as overturned in the appeals table.
  try {
    // Notify on the user's own shard only · the user is either connected
    // to chatRoomNameFor(user_id) or they're offline (the RoomDO's notify
    // loop is a no-op in that case). Fanning out across all shards would
    // wake DOs the user has never touched.
    const stub = env.ROOM.get(env.ROOM.idFromName(chatRoomNameFor(user_id)));
    await stub.notifyAppealUpheld(user_id);
  } catch {
    // Silent, observability of notification delivery is Phase 5+.
  }
}

export async function runAppealReview(env: Env, _ctx: ExecutionContext): Promise<void> {
  // Scan up to 5x APPEALS_PER_TICK keys to find APPEALS_PER_TICK with
  // user_explanation set (most blocks aren't appealed; many `appeal:` keys
  // have no submitted explanation yet).
  const submitted = await listSubmittedAppeals(env, APPEALS_PER_TICK * 5);
  if (submitted.length === 0) return;

  const db = getDb(env);

  for (const { token, record } of submitted) {
    const verdict = await callReviewer(env, buildPrompt(record));

    if (!verdict) {
      await db.updateAppealStatus(token, 'human_review');
      await db.enqueueAppealHumanReview(
        token, record.user_id, 'reviewer_unparseable',
      );
      // Drop the KV record so we don't reprocess on the next tick.
      await env.AUTH_KV.delete(`appeal:${token}`);
      continue;
    }

    if (verdict.confidence < APPEAL_HUMAN_REVIEW_BELOW) {
      await db.updateAppealStatus(token, 'human_review');
      await db.enqueueAppealHumanReview(
        token, record.user_id, `low_confidence:${verdict.decision}`,
      );
      await env.AUTH_KV.delete(`appeal:${token}`);
      continue;
    }

    if (verdict.decision === 'overturn' && verdict.confidence >= APPEAL_OVERTURN_CONFIDENCE) {
      await db.adjustReputation(
        record.user_id, ADJUSTMENTS.appealUpheld, { passed: true },
      );
      await db.updateAppealStatus(token, 'overturned');
      await bestEffortNotifyOverturn(env, record.user_id);
      await env.AUTH_KV.delete(`appeal:${token}`);
      continue;
    }

    if (verdict.decision === 'uphold') {
      await db.updateAppealStatus(token, 'upheld');
      // Plan §7f: 1% of upheld decisions sampled into human queue regardless,
      // for ongoing tuning of the reviewer prompt.
      if (Math.random() < APPEAL_UPHOLD_SAMPLE_RATE) {
        await db.enqueueAppealHumanReview(token, record.user_id, 'upheld_sample');
      }
      await env.AUTH_KV.delete(`appeal:${token}`);
      continue;
    }

    // overturn but below the high-confidence threshold → human review.
    await db.updateAppealStatus(token, 'human_review');
    await db.enqueueAppealHumanReview(
      token, record.user_id, 'medium_confidence_overturn',
    );
    await env.AUTH_KV.delete(`appeal:${token}`);
  }
}
