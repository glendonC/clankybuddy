import { authenticate, getDb } from '../auth.js';
import type { Env } from '../types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RefreshBody {
  refresh_token?: unknown;
}

export async function handleAuthRefresh(request: Request, env: Env): Promise<Response> {
  let body: RefreshBody;
  try {
    body = (await request.json()) as RefreshBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const refresh = body?.refresh_token;
  if (typeof refresh !== 'string' || !refresh.startsWith('rt_')) {
    return jsonResponse({ error: 'invalid_refresh_token' }, 400);
  }

  const result = await getDb(env).rotateRefreshToken(refresh);
  if (!result) return jsonResponse({ error: 'invalid_or_expired' }, 401);

  return jsonResponse({
    token: result.token,
    refresh_token: result.refresh_token,
    user_id: result.user_id,
  });
}

export async function handleMeRevoke(request: Request, env: Env): Promise<Response> {
  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  await getDb(env).revokeTokens(user.id);
  return new Response(null, { status: 204 });
}
