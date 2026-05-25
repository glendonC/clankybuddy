import { authenticate, getDb, issueTokenPair } from './auth.js';
import {
  AGGREGATION_CRON,
  APPEALS_INTERVAL_MIN,
  DEV_ORIGINS,
  PROD_ORIGINS,
  TUI_USER_AGENT_PREFIX,
} from './constants.js';
import { chatRoomNameFor } from './util/shard.js';
import {
  TURNSTILE_HOSTNAME_DEFAULT,
  geofenceDocUrl,
} from '../../shared/src/urls.js';
import { runAggregation } from './cron/aggregate.js';
import { runAppealReview } from './cron/appeals.js';
import { runEraseDrain } from './cron/erase.js';
import { geofenceDecision, isGeofenceBypassed } from './geofence.js';
import {
  gateAccountCreation,
  subnetPrefix,
  verifyTurnstile,
  type InitContext,
} from './init_guard.js';
import { logEvent } from './observability.js';
import { handleActionsBatch } from './routes/actions.js';
import { handleAdminPreserve } from './routes/admin.js';
import { handleAdminStats } from './routes/admin_stats.js';
import { handleAppealSubmit } from './routes/appeal.js';
import { handleAuthRefresh, handleMeRevoke } from './routes/auth.js';
import { handleMeErase } from './routes/erase.js';
import { handleEventsBatch } from './routes/events.js';
import { handleLeaderboard } from './routes/leaderboard.js';
import { handleLeaderboardSeries } from './routes/leaderboard_series.js';
import { handleMeState } from './routes/me_state.js';
import { handleMeStats } from './routes/me_stats.js';
import { handleVerify } from './routes/verify.js';
import type { Env } from './types.js';

export { RoomDO } from './room.js';
export { DatabaseDO } from './database.js';
export { ActionShardDO } from './dos/action_shard.js';
export { LeaderboardDO } from './dos/leaderboard.js';

function isTuiRequest(request: Request): boolean {
  const ua = request.headers.get('User-Agent') ?? '';
  const origin = request.headers.get('Origin');
  // TUI: no Origin (it's not a browser context) and a clankybuddy-cli UA.
  // Anything else without an Origin is treated as a browser-with-stripped-Origin
  // and rejected at the allowlist check.
  return origin === null && ua.startsWith(TUI_USER_AGENT_PREFIX);
}

function getAllowedOrigin(origin: string | null, env: Env): string {
  if (!origin) return '';
  if (PROD_ORIGINS.has(origin)) return origin;
  if (env.ENVIRONMENT !== 'production' && DEV_ORIGINS.has(origin)) return origin;
  return '';
}

function corsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Clanky-Erase',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function withCors(res: Response, headers: Record<string, string>): Response {
  const merged = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) merged.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getClientIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP');
}

// In production, ADMIN_TOKEN must be present. Without it, /admin/preserve
// fail-closes (503), which is the right runtime behavior, but we want
// loud failure at the first request rather than silent /admin/* outage.
// Detection happens once per isolate (the flag short-circuits subsequent
// calls). Throwing here surfaces in Workers logs and trips the deployment-
// validation check that ops runs as a smoke test.
let envAssertionsRun = false;
function assertProductionEnv(env: Env): void {
  if (envAssertionsRun) return;
  envAssertionsRun = true;
  if (env.ENVIRONMENT === 'production' && !env.ADMIN_TOKEN) {
    throw new Error(
      '[index] ADMIN_TOKEN is required in production. Set via `wrangler secret put ADMIN_TOKEN`.',
    );
  }
}

// KV key prefix for the captcha-session relay used by the TUI flow
// (red-team resolution #6). The TUI hits /auth/init with
// `{request_session: true}` when no Turnstile widget is reachable, gets
// back a session_token, opens /verify?session=<token> in the user's
// browser to complete the widget, and polls /auth/init/status to pick up
// the freshly-minted token pair.
const INIT_SESSION_PREFIX = 'init_session:';
// 5min: long enough for a user to switch to a browser, complete Turnstile,
// and switch back; short enough that a forgotten flow doesn't leave a
// dangling token issue waiting forever.
const INIT_SESSION_TTL_SEC = 5 * 60;

interface PendingInitSession {
  state: 'pending';
  created_at: number;
  ip: string;
  asn: number;
}

interface VerifiedInitSession {
  state: 'verified';
  token: string;
  refresh_token: string;
  user_id: string;
  handle: string;
  color: string;
  // Mirrors the access-token TTL the client should expect; pure observability.
  created_at: number;
}

type StoredInitSession = PendingInitSession | VerifiedInitSession;

async function handleInit(env: Env, request: Request): Promise<Response> {
  const ip = getClientIp(request);
  if (!ip) return jsonResponse({ error: 'missing_ip' }, 400);

  // Pre-parse the body if any. /auth/init has historically accepted no
  // body at all (the captcha flow only sends a header), so a parse failure
  // is non-fatal, fall back to no body. We only care about the body when
  // the TUI's session-token relay is in play.
  let body: Record<string, unknown> = {};
  try {
    const text = await request.clone().text();
    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    /* body optional; ignore parse failure */
  }
  const requestSession = body.request_session === true;
  const sessionTokenIn =
    typeof body.session_token === 'string' ? body.session_token : null;

  const cf = request.cf;
  const initCtx: InitContext = {
    ip,
    asn: typeof cf?.asn === 'number' ? cf.asn : 0,
    country: typeof cf?.country === 'string' ? cf.country : 'XX',
    ua: request.headers.get('User-Agent') ?? '',
    subnet24: subnetPrefix(ip),
    turnstileToken: request.headers.get('cf-turnstile-response') ?? undefined,
  };

  const gate = await gateAccountCreation(env, initCtx);

  if (gate.decision === 'reject') {
    return jsonResponse({ error: gate.reason }, 429);
  }

  if (gate.decision === 'captcha') {
    if (!initCtx.turnstileToken) {
      const hostname = env.TURNSTILE_HOSTNAME ?? TURNSTILE_HOSTNAME_DEFAULT;
      // TUI relay branch: no widget reachable → mint a session_token, park
      // a pending row in KV, and respond 202 with a verify URL the user
      // can open in a real browser. The TUI polls /auth/init/status until
      // the verify page POSTs back to /auth/init with the widget token.
      if (requestSession) {
        const sessionToken = generateSessionToken();
        const pending: PendingInitSession = {
          state: 'pending',
          created_at: Date.now(),
          ip,
          asn: initCtx.asn,
        };
        await env.AUTH_KV.put(
          `${INIT_SESSION_PREFIX}${sessionToken}`,
          JSON.stringify(pending),
          { expirationTtl: INIT_SESSION_TTL_SEC },
        );
        return jsonResponse(
          {
            error: 'captcha_required',
            verify_url: `https://${hostname}/verify?session=${sessionToken}`,
            session_token: sessionToken,
            session_expires_at: pending.created_at + INIT_SESSION_TTL_SEC * 1_000,
            poll_url: `/auth/init/status?session=${sessionToken}`,
          },
          202,
        );
      }
      // Legacy / browser-direct branch: 403 with the bare verify URL.
      return jsonResponse(
        {
          error: 'captcha_required',
          verify_url: `https://${hostname}/verify`,
        },
        403,
      );
    }
    const ok = await verifyTurnstile(initCtx.turnstileToken, env, initCtx);
    if (!ok) return jsonResponse({ error: 'captcha_failed' }, 403);
  }

  // Final defense in depth: the atomic per-IP SQL gate (Phase 1). KV
  // counters above are eventually consistent; this catches anything that
  // slipped past during a write-skew window.
  const db = getDb(env);
  const limit = await db.checkAndConsumeAccountLimit(ip);
  if (!limit.allowed) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const result = await db.createUser();
  if ('error' in result) {
    return jsonResponse({ error: result.error }, 503);
  }

  const pair = await issueTokenPair(env, result.id);

  // If this /auth/init was the verify-page POST that completes a TUI
  // session-token flow, also write the verified payload into the relay
  // KV row so the TUI's poll picks it up. The verify page's own browser
  // tab ALSO gets the regular 200 below, same payload, two delivery
  // surfaces (browser + TUI poll).
  if (sessionTokenIn) {
    const verified: VerifiedInitSession = {
      state: 'verified',
      token: pair.token,
      refresh_token: pair.refresh_token,
      user_id: result.id,
      handle: result.handle,
      color: result.color,
      created_at: Date.now(),
    };
    // Reuse the same TTL, the TUI has at most INIT_SESSION_TTL_SEC to
    // poll. /auth/init/status one-shot-consumes (deletes on read) so a
    // late poll past the window returns 410.
    await env.AUTH_KV.put(
      `${INIT_SESSION_PREFIX}${sessionTokenIn}`,
      JSON.stringify(verified),
      { expirationTtl: INIT_SESSION_TTL_SEC },
    );
  }

  return jsonResponse({
    token: pair.token,
    refresh_token: pair.refresh_token,
    user_id: result.id,
    handle: result.handle,
    color: result.color,
  });
}

// 32-byte hex token used as the KV key for /auth/init session relays.
// crypto.randomUUID().replace(/-/g, '') is 32 hex chars from a v4 UUID,
// which is plenty of entropy (122 bits) for a 5-minute single-use token.
function generateSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

async function handleInitStatus(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sessionToken = url.searchParams.get('session');
  if (!sessionToken) {
    return jsonResponse({ error: 'missing_session' }, 400);
  }
  const key = `${INIT_SESSION_PREFIX}${sessionToken}`;
  const raw = await env.AUTH_KV.get(key);
  if (!raw) {
    return jsonResponse({ state: 'expired' }, 410);
  }
  let parsed: StoredInitSession;
  try {
    parsed = JSON.parse(raw) as StoredInitSession;
  } catch {
    // Corrupt row, treat as expired and clean it up so the next call is fast.
    await env.AUTH_KV.delete(key);
    return jsonResponse({ state: 'expired' }, 410);
  }
  if (parsed.state === 'pending') {
    return jsonResponse({ state: 'pending' }, 202);
  }
  // Verified: hand the payload back ONCE and delete the KV row. The TUI
  // is the only legitimate consumer; the browser tab that completed the
  // verify page got the same payload via the /auth/init 200 response.
  await env.AUTH_KV.delete(key);
  return jsonResponse(
    {
      state: 'verified',
      token: parsed.token,
      refresh_token: parsed.refresh_token,
      user_id: parsed.user_id,
      handle: parsed.handle,
      color: parsed.color,
    },
    200,
  );
}

async function handleWsTicket(env: Env, request: Request): Promise<Response> {
  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  // Mirror the 426 protocol-version check from handleWsConnect. Without
  // this, an outdated client burns a ticket on /auth/ws-ticket, hits the
  // ws upgrade with the bad version, gets 426 there, but the ticket has
  // already been minted (and consumed by the failed upgrade attempt). By
  // checking here first, the client sees 426 BEFORE issuing the ticket and
  // can switch into outdated-client UX without round-tripping through a
  // wasted WS attempt.
  const url = new URL(request.url);
  const protocolError = checkProtocolVersion(env, url);
  if (protocolError) return protocolError;

  const ticket = await getDb(env).issueTicket(user.id);
  return jsonResponse({ ticket });
}

async function handleMe(env: Env, request: Request): Promise<Response> {
  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  return jsonResponse({
    user_id: user.id,
    handle: user.handle,
    color: user.color,
  });
}

function checkProtocolVersion(env: Env, url: URL): Response | null {
  const required = env.PROTOCOL_VERSION || '1';
  const requestedRaw = url.searchParams.get('v');
  // Major-version match: "1" matches "1", "1.x", anything outside major === required is rejected.
  const requestedMajor = requestedRaw == null ? null : requestedRaw.split('.')[0];
  if (requestedMajor !== required.split('.')[0]) {
    return jsonResponse(
      {
        error: 'protocol_unsupported',
        required_version: required,
        upgrade_hint: `Append ?v=${required} to the WebSocket URL or upgrade your client.`,
      },
      426,
    );
  }
  return null;
}

async function handleWsConnect(env: Env, request: Request): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const origin = request.headers.get('Origin');
  const tui = isTuiRequest(request);
  if (!tui) {
    if (!origin || !getAllowedOrigin(origin, env)) {
      return new Response('forbidden origin', { status: 403 });
    }
  }

  const url = new URL(request.url);
  const protocolError = checkProtocolVersion(env, url);
  if (protocolError) return protocolError;

  const ticket = url.searchParams.get('ticket');
  if (!ticket) return jsonResponse({ error: 'missing_ticket' }, 401);

  const db = getDb(env);
  const userId = await db.consumeTicket(ticket);
  if (!userId) return jsonResponse({ error: 'invalid_ticket' }, 401);

  const user = await db.getUser(userId);
  if (!user) return jsonResponse({ error: 'user_not_found' }, 404);

  // Shard connections across CHAT_ROOM_SHARD_COUNT RoomDOs by user_id hash.
  // No LobbyDO · the hash is deterministic and runs in-process, so the
  // WS upgrade pays zero extra round-trips vs. the legacy single-room path.
  const roomId = env.ROOM.idFromName(chatRoomNameFor(user.id));
  const roomStub = env.ROOM.get(roomId);
  const params = new URLSearchParams({
    user_id: user.id,
    handle: user.handle,
    color: user.color,
  });
  return roomStub.fetch(`http://internal/connect?${params.toString()}`, {
    headers: request.headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    assertProductionEnv(env);

    const url = new URL(request.url);
    const rawOrigin = request.headers.get('Origin');
    const origin = getAllowedOrigin(rawOrigin, env);
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      // Preflight is intentionally NOT geofenced. Geofencing the OPTIONS
      // would surface as a generic CORS failure in the browser console
      // rather than the explicit 451 we want users to see on the actual
      // request, which then carries our explanatory JSON body.
      return new Response(null, { status: 204, headers });
    }

    // Geofence runs before CORS evaluation and before route dispatch so that
    // EU/UK users get a uniform 451 across every endpoint, including any
    // routes added by parallel work. Bypass via X-Clanky-Geofence-Bypass for
    // ops/CI/Workers-Logs probes.
    if (!isGeofenceBypassed(request, env.GEOFENCE_BYPASS_SECRET)) {
      const country = (request.cf?.country as string | undefined) ?? '';
      const geo = geofenceDecision(country);
      if (geo.blocked) {
        return new Response(
          JSON.stringify({
            error: 'geofenced',
            reason: geo.reason,
            message: geo.message,
            documentation_url: geofenceDocUrl(),
          }),
          {
            status: 451,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    }

    try {
      if (url.pathname === '/auth/init' && request.method === 'POST') {
        return withCors(await handleInit(env, request), headers);
      }
      if (url.pathname === '/auth/init/status' && request.method === 'GET') {
        return withCors(await handleInitStatus(env, request), headers);
      }
      if (url.pathname === '/auth/ws-ticket' && request.method === 'POST') {
        return withCors(await handleWsTicket(env, request), headers);
      }
      if (url.pathname === '/me' && request.method === 'GET') {
        return withCors(await handleMe(env, request), headers);
      }
      if (url.pathname === '/me/stats' && request.method === 'GET') {
        return withCors(await handleMeStats(request, env, ctx), headers);
      }
      if (url.pathname === '/me/state' && request.method === 'GET') {
        return withCors(await handleMeState(request, env), headers);
      }
      if (url.pathname === '/actions/batch' && request.method === 'POST') {
        return withCors(await handleActionsBatch(request, env), headers);
      }
      if (url.pathname === '/events/batch' && request.method === 'POST') {
        return withCors(await handleEventsBatch(request, env), headers);
      }
      if (url.pathname === '/leaderboard' && request.method === 'GET') {
        return withCors(await handleLeaderboard(request, env), headers);
      }
      if (url.pathname === '/leaderboard/series' && request.method === 'GET') {
        return withCors(await handleLeaderboardSeries(request, env), headers);
      }
      if (url.pathname === '/auth/refresh' && request.method === 'POST') {
        return withCors(await handleAuthRefresh(request, env), headers);
      }
      if (url.pathname === '/me/revoke' && request.method === 'POST') {
        return withCors(await handleMeRevoke(request, env), headers);
      }
      if (url.pathname === '/me/erase' && request.method === 'POST') {
        return withCors(await handleMeErase(request, env), headers);
      }
      if (url.pathname === '/moderation/appeal' && request.method === 'POST') {
        return withCors(await handleAppealSubmit(request, env), headers);
      }
      if (url.pathname === '/verify' && request.method === 'GET') {
        // No CORS wrap; this is an HTML page served same-origin to the
        // browser tab opened from a verify_url. Cache headers handled in
        // routes/verify.ts.
        return await handleVerify(request, env);
      }
      if (url.pathname === '/admin/preserve' && request.method === 'POST') {
        // Admin routes intentionally bypass the CORS wrap, they are not
        // browser-fetchable from any approved origin and shouldn't surface
        // CORS-allow headers that imply otherwise. ops uses a direct curl
        // / wrangler-tail-style invocation.
        return await handleAdminPreserve(request, env);
      }
      if (url.pathname === '/admin/stats' && request.method === 'GET') {
        return await handleAdminStats(request, env);
      }
      if (url.pathname === '/ws/chat') {
        // No CORS wrap on a 101 Switching Protocols response; Origin is
        // enforced inside handleWsConnect for the upgrade itself.
        return await handleWsConnect(env, request);
      }
      return withCors(new Response('not found', { status: 404 }), headers);
    } catch (err) {
      console.error(err);
      return withCors(new Response('internal error', { status: 500 }), headers);
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron !== AGGREGATION_CRON) return;

    // Aggregation, erase drain, and appeal review all ride the every-minute
    // cron. Aggregation and erase drain run every tick. Appeal review runs
    // every APPEALS_INTERVAL_MIN minutes, checking minute-of-hour avoids
    // double-firing if Cloudflare drift fires the cron 59s and 61s apart.
    const now = new Date();
    const runAppeals = now.getUTCMinutes() % APPEALS_INTERVAL_MIN === 0;

    const work: Promise<unknown>[] = [
      withCronLock(env, 'cron-lock:aggregate', () => runAggregation(env, ctx)).catch((err) => {
        console.error(JSON.stringify({ evt: 'cron_aggregation_failed', err: String(err) }));
      }),
      withCronLock(env, 'cron-lock:erase', () => runEraseDrain(env, ctx)).catch((err) => {
        console.error(JSON.stringify({ evt: 'cron_erase_failed', err: String(err) }));
      }),
    ];
    if (runAppeals) {
      work.push(
        withCronLock(env, 'cron-lock:appeals', () => runAppealReview(env, ctx)).catch((err) => {
          console.error(JSON.stringify({ evt: 'cron_appeals_failed', err: String(err) }));
        }),
      );
    }
    await Promise.all(work);
  },
} satisfies ExportedHandler<Env>;

// KV-backed best-effort cron lock. Cloudflare cron triggers are normally
// serialized per-deployment, but during deploy/roll/replay two crons can
// briefly overlap. The lock is NOT a perfect mutex, KV is eventually
// consistent, but the cost of a duplicate run is bounded:
//   - aggregate's rollupSince() is transactional, marks-on-read
//   - erase's per-job claim transitions status atomically
//   - appeals deletes `appeal:` KV keys after each verdict, so a second
//     pass is largely a no-op (the missing-record path skips quietly)
// TTL is < 1 min cron interval so a process death doesn't park the lock
// past the next intended run.
const CRON_LOCK_TTL_SEC = 50;

async function withCronLock<T>(
  env: Env,
  lockKey: string,
  body: () => Promise<T>,
): Promise<T | undefined> {
  const myToken = crypto.randomUUID();
  await env.AUTH_KV.put(lockKey, myToken, {
    expirationTtl: CRON_LOCK_TTL_SEC,
    metadata: { acquired_at: Date.now() },
  });
  // Read-after-write to confirm we hold the lock. KV's eventual consistency
  // means a concurrent put could land between our put and read; whoever
  // wrote last wins, the loser quietly skips this tick.
  const held = await env.AUTH_KV.get(lockKey);
  if (held !== myToken) return undefined;
  try {
    return await body();
  } finally {
    // Only delete if we still hold the lock. A late-arriving overlap
    // could have re-claimed the slot between our work and this delete;
    // releasing someone else's lock would re-create the overlap window.
    try {
      const stillHeld = await env.AUTH_KV.get(lockKey);
      if (stillHeld === myToken) {
        await env.AUTH_KV.delete(lockKey);
      }
    } catch {
      /* lock TTLs out anyway; cleanup failure is non-fatal */
    }
  }
}
