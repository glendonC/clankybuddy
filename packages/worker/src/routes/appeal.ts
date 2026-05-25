import { getDb } from '../auth.js';
import type { AppealRecord } from '../moderation/index.js';
import type { Env } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface AppealBody {
  appeal_token?: unknown;
  user_explanation?: unknown;
}

const MAX_EXPLANATION_LEN = 200;

// Stored appeal record carries the user_explanation back into KV alongside
// the original block context so the cron review pass has everything it needs
// in one read.
interface AppealKvEntry extends AppealRecord {
  user_explanation?: string;
}

// POST /moderation/appeal. Validates the appeal_token (which is the in-flight
// 24h KV record, separate from the durable `appeals` audit row). Stores the
// user's explanation back into the KV record AND inserts/updates the
// audit-trail row in DatabaseDO. The cron picks up the explanation and asks
// Workers AI for a verdict every 10 min.
export async function handleAppealSubmit(request: Request, env: Env): Promise<Response> {
  let body: AppealBody;
  try {
    body = (await request.json()) as AppealBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const token = body?.appeal_token;
  const explanation = body?.user_explanation;
  if (typeof token !== 'string' || !token.startsWith('ap_')) {
    return jsonResponse({ error: 'invalid_appeal_token' }, 400);
  }
  if (typeof explanation !== 'string') {
    return jsonResponse({ error: 'invalid_user_explanation' }, 400);
  }
  const trimmed = explanation.trim().slice(0, MAX_EXPLANATION_LEN);
  if (trimmed.length === 0) {
    return jsonResponse({ error: 'empty_user_explanation' }, 400);
  }

  const key = `appeal:${token}`;
  const existing = await env.AUTH_KV.get(key);
  if (!existing) {
    return jsonResponse({ error: 'appeal_not_found_or_expired' }, 404);
  }

  let record: AppealKvEntry;
  try {
    record = JSON.parse(existing) as AppealKvEntry;
  } catch {
    return jsonResponse({ error: 'corrupt_appeal_record' }, 500);
  }

  record.user_explanation = trimmed;
  // Re-put with a fresh 24h TTL so the cron has the full window from
  // submission to review even if the original block was issued late in the
  // 24h window.
  await env.AUTH_KV.put(key, JSON.stringify(record), {
    expirationTtl: 24 * 60 * 60,
  });

  // Also write the durable audit row. INSERT OR REPLACE means the same
  // appeal_token replays idempotently; the user can hit submit twice and we
  // just overwrite the explanation.
  await getDb(env).insertAppealRow({
    id: token,
    user_id: record.user_id,
    msg_id: record.msg_id,
    original: record.original,
    canonical: record.canonical,
    flags: JSON.stringify(record.flags),
    reason_code: record.blockReason,
    user_explanation: trimmed,
    status: 'pending',
    created_at: record.created_at,
  });

  return jsonResponse({ status: 'queued' }, 202);
}
