import { authenticate, getDb } from '../auth.js';
import type { Env } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /me/erase. Bearer-auth + custom X-Clanky-Erase: confirm header for
// CSRF defense (Challenger §1.5, the custom header is unforgeable from a
// simple <form> submit, which is the only realistic CSRF surface for an
// anonymous bearer-in-cookie deployment). Async by design, returns 202 with
// a job_id, the cron drains the queue. Synchronous erase would be a DoS
// primitive (Challenger §4.5).
export async function handleMeErase(request: Request, env: Env): Promise<Response> {
  const confirm = request.headers.get('X-Clanky-Erase');
  if (confirm !== 'confirm') {
    return jsonResponse({ error: 'missing_confirmation_header' }, 400);
  }

  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const result = await getDb(env).enqueueEraseJob(user.id);
  if ('gone' in result) {
    return jsonResponse({ error: 'already_erased' }, 410);
  }

  // Revoke immediately so the user's outstanding tokens stop authenticating
  // before the cron tick lands. The cron's tombstoneUser is the durable
  // erasure; revokeTokens is the immediate-effect part.
  await getDb(env).revokeTokens(user.id);

  return jsonResponse(
    { job_id: result.job_id, status: 'queued' },
    202,
  );
}
