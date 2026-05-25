import { getDb } from '../auth.js';
import { logEvent } from '../observability.js';
import type { Env } from '../types.js';

// /admin/preserve, opt-in preservation hold for ops use.
//
// Auth: a single `Authorization: Bearer ${env.ADMIN_TOKEN}` constant-time
// match. We deliberately do NOT mix ADMIN_TOKEN into the user-token KV
// namespace; admin auth is a separate channel from user auth so a leak of
// either doesn't compromise the other.
//
// Fail-closed: if env.ADMIN_TOKEN is unset, every request to /admin/preserve
// returns 503. The module-load assertion in index.ts also throws when
// ENVIRONMENT === 'production' and ADMIN_TOKEN is missing, so ops can't
// accidentally deploy with the route silently inaccessible.

interface PreserveBody {
  user_id?: unknown;
  until_ms?: unknown;
  case_id?: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Admin responses must not be cacheable, they carry case data and
      // are sensitive even to other ops users sharing the same proxy.
      'Cache-Control': 'no-store',
    },
  });
}

// crypto.subtle.timingSafeEqual is not available in workerd; use a manual
// constant-time compare. Both inputs are bounded (token lengths from the
// /admin/preserve caller and env), so the linear scan is fine.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function handleAdminPreserve(
  req: Request,
  env: Env,
): Promise<Response> {
  // Fail-closed: missing admin token = 503, never silent open.
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

  let body: PreserveBody;
  try {
    body = (await req.json()) as PreserveBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const userId = body.user_id;
  const untilMs = body.until_ms;
  const caseId = body.case_id;

  if (typeof userId !== 'string' || userId.length === 0 || userId.length > 64) {
    return jsonResponse({ error: 'invalid_user_id' }, 400);
  }
  if (typeof untilMs !== 'number' || !Number.isFinite(untilMs)) {
    return jsonResponse({ error: 'invalid_until_ms' }, 400);
  }
  if (untilMs <= Date.now()) {
    // Past or now: reject, a "hold until yesterday" has no defensive value
    // and is almost certainly a unit-confusion bug (seconds vs. ms).
    return jsonResponse({ error: 'until_in_past' }, 400);
  }
  if (caseId !== undefined && (typeof caseId !== 'string' || caseId.length > 128)) {
    return jsonResponse({ error: 'invalid_case_id' }, 400);
  }

  await getDb(env).preserveUser(userId, untilMs, caseId);

  // Analytics so the security team has a queryable trail of who placed which
  // hold and when. The user_id slot doubles as the AE index → fast filter.
  logEvent(env, {
    event_type: 'preservation_hold_created',
    user_id: userId,
    detail: caseId,
  });

  return jsonResponse({ ok: true, until: untilMs }, 200);
}
