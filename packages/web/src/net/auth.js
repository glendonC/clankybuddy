// Anonymous account bootstrap, refresh-token rotation, and WS ticket
// issuance for the global chat. Mirrors packages/cli/src/auth.ts but
// uses fetch + localStorage on the browser side.
//
// =====================================================================
// Refresh policy (single source of truth)
// =====================================================================
// Two tokens, one storage blob (clankybuddy.auth.v2):
//   - access_token , bearer used on every authed request. Worker uses
//     a sliding-window TTL keyed on `last_used_at`; we proactively
//     rotate at 80% of TTL (ACCESS_TOKEN_REFRESH_THRESHOLD_MS, ~72d)
//     so a single offline window <20% TTL still recovers seamlessly.
//   - refresh_token, long-lived (30d absolute), one-shot rotated on
//     every /auth/refresh hit. Sent in the request body (worker
//     contract: routes/auth.ts reads body.refresh_token).
//
// ensureAuth() is the boot/lazy entry point:
//   1. migrate v1 -> v2 if a v1 blob is on disk (transparent; no logout).
//   2. if Date.now() - issued_at > ACCESS_TOKEN_REFRESH_THRESHOLD_MS,
//      kick off a non-blocking refreshAuth() (fire-and-forget) so the
//      next call observes a fresh access token without delaying boot.
//   3. if no auth on disk, run /auth/init and persist.
//
// refreshAuth() is the lock-guarded entry point used by both:
//   - the proactive boot path (above), and
//   - the reactive 401 path: any authed call that gets a 401 calls
//     refreshAuth() exactly once and retries the original request. If
//     the retry also 401s, clearAuth() and rerun ensureAuth() to
//     bootstrap a fresh anon account.
//
// Cross-tab serialization: refreshAuth() runs inside
// navigator.locks.request('clankybuddy.auth.refresh', ...). Inside the
// lock we re-read storage; if `issued_at` is newer than the value the
// caller saw, another tab won and we just return the winner without
// hitting the network. Web Locks is mandatory in evergreen browsers; no
// polyfill (per workstream constraints).
//
// Cross-tab propagation: every successful refresh broadcasts via
// auth-storage's BroadcastChannel so other tabs adopt the new tokens
// without polling. Storage writes are also strictly larger, so a tab
// that loads the blob after our save wins-by-default at next call.
//
// Telemetry: every refresh attempt emits a console-only AuthLifecycleEvent
// (token_refresh_attempted/succeeded/failed). These events do NOT flow
// through /events/batch, they're for devtools, not analytics.

import {
  ACCESS_TOKEN_REFRESH_THRESHOLD_MS,
} from '@clankybuddy/shared/auth-tokens';
import { PROTOCOL_VERSION } from '@clankybuddy/shared/chat';
import { resolveApiBase } from './constants.js';
import {
  clearAuth as clearAuthStorage,
  loadAuth as loadAuthStorage,
  migrateV1IfPresent,
  saveAuth as saveAuthStorage,
} from './auth-storage.js';
import { emitAuthLifecycle } from '../telemetry/events.js';

const REFRESH_LOCK_NAME = 'clankybuddy.auth.refresh';
const CLIENT_KIND = 'web';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function apiFetch(base, path, init = {}, token) {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    let body = null;
    const text = await res.text().catch(() => '');
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
  }
  return res.json();
}

export async function authInit(base) {
  return apiFetch(base, '/auth/init', { method: 'POST' });
}

export async function authWsTicket(base, token) {
  // Worker rejects ticket requests without the wire-version param with
  // HTTP 426 protocol_unsupported. Match the gate or we never get a
  // ticket and the WS upgrade never happens. Both surfaces (web + TUI)
  // pin to PROTOCOL_VERSION from @clankybuddy/shared/chat so the value
  // stays in lockstep with the rest of the chat protocol.
  const path = `/auth/ws-ticket?v=${encodeURIComponent(PROTOCOL_VERSION)}`;
  return apiFetch(base, path, { method: 'POST' }, token);
}

// POST /auth/refresh. Worker contract (packages/worker/src/routes/auth.ts):
// the refresh token rides the JSON body, NOT a Bearer header, refresh
// tokens are never used as request auth, only as a one-shot rotation
// credential. Returns { token, refresh_token, user_id } on success.
export async function authRefresh(base, refresh_token) {
  return apiFetch(base, '/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token }),
  });
}

// Re-export storage primitives so existing call sites (events-sink,
// stats, chat-bootstrap) continue to import from './auth.js'.
export function loadAuth() { return loadAuthStorage(); }
export function clearAuth() { return clearAuthStorage(); }

// Internal helper: persist a successful refresh result and stamp issued_at.
function persistRefreshed(result) {
  const now = Date.now();
  return saveAuthStorage({
    access_token: result.token,
    // Server returns a fresh refresh_token on every rotation. Worker
    // also rotates lazily, null guard preserves the old one if the
    // server somehow omitted it (defensive; it shouldn't happen).
    refresh_token: result.refresh_token ?? null,
    issued_at: now,
    // user_id is part of the response; preserve through merge if absent
    // (it shouldn't be, but a partial server payload mustn't blow away
    // the cached identity).
    ...(result.user_id ? { user_id: result.user_id } : {}),
  });
}

// Lock-guarded refresh. Returns the new (or unchanged) auth blob, or
// throws ApiError on hard failure (caller decides what to do).
//
// Concurrency model: only one tab/window in the same origin runs the
// network call at a time. Inside the lock we double-check storage,
// if another tab already won (issued_at moved forward since we entered
// the lock), we return the winner instead of redundantly burning a
// refresh_token rotation.
export async function refreshAuth() {
  // Capture pre-lock issued_at so we can detect a peer-tab winner.
  const preEntry = loadAuthStorage();
  const preIssuedAt = preEntry?.issued_at ?? 0;

  return navigator.locks.request(REFRESH_LOCK_NAME, async () => {
    // Re-read inside the lock, another tab may have already refreshed
    // while we were queueing.
    const inside = loadAuthStorage();
    if (inside && inside.issued_at > preIssuedAt && inside.refresh_token) {
      // Peer tab won. Trust its result; no telemetry emit for the
      // unwinder (the winner already emitted token_refresh_succeeded).
      return inside;
    }

    if (!inside?.refresh_token) {
      // No refresh token to spend, caller must fall back to /auth/init.
      // Surface as a 401 so the catch path treats this like a hard fail.
      const err = new ApiError(401, 'no_refresh_token', null);
      emitAuthLifecycle({
        type: 'token_refresh_failed',
        client_kind: CLIENT_KIND,
        status: 401,
        reason: 'no_refresh_token',
      });
      throw err;
    }

    emitAuthLifecycle({
      type: 'token_refresh_attempted',
      client_kind: CLIENT_KIND,
    });
    const startedAt = performance.now();
    try {
      const base = inside.api_base || resolveApiBase();
      const result = await authRefresh(base, inside.refresh_token);
      const saved = persistRefreshed(result);
      emitAuthLifecycle({
        type: 'token_refresh_succeeded',
        client_kind: CLIENT_KIND,
        latency_ms: Math.round(performance.now() - startedAt),
      });
      return saved;
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const reason = err instanceof ApiError
        ? (typeof err.body === 'object' && err.body?.error) || err.message
        : (err?.message || 'network_error');
      emitAuthLifecycle({
        type: 'token_refresh_failed',
        client_kind: CLIENT_KIND,
        status,
        reason: String(reason),
      });
      throw err;
    }
  });
}

// Returns existing auth or runs /auth/init and persists. Throws ApiError on
// failure; callers should branch on err.status:
//   403 + body.error === 'captcha_required' → show body.verify_url
//   429                                      → rate-limited; surface message
//
// Migrates v1 → v2 transparently on every call (cheap; the helper bails
// out fast if no v1 blob exists). Kicks off a non-blocking proactive
// refresh if the access_token is past the 80%-TTL threshold.
export async function ensureAuth() {
  // Always run migration before reading, the first ensureAuth() after
  // an upgrade is when the v1 blob converts.
  migrateV1IfPresent();

  let existing = loadAuthStorage();

  if (existing) {
    // Proactive refresh: if the token is within the rotation window,
    // fire-and-forget a refresh so the next request sees a fresh one.
    // We don't await, boot path stays fast even if the network is
    // slow. The reactive 401 path catches the worst case.
    if (
      existing.refresh_token &&
      existing.issued_at > 0 &&
      Date.now() - existing.issued_at > ACCESS_TOKEN_REFRESH_THRESHOLD_MS
    ) {
      // Don't propagate failures here, refresh failure on a still-valid
      // access token is a soft signal, not a fatal error. The reactive
      // 401 path will pick up if the access token actually expires.
      void refreshAuth().catch(() => { /* noop, see above */ });
    }
    return existing;
  }

  // First-time bootstrap. /auth/init mints both tokens.
  const base = resolveApiBase();
  const result = await authInit(base);
  const now = Date.now();
  const saved = saveAuthStorage({
    access_token: result.token,
    refresh_token: result.refresh_token ?? null,
    issued_at: now,
    user_id: result.user_id,
    handle: result.handle,
    color: result.color,
    api_base: base,
  });
  return saved;
}

// Dev-console nuke: clears save state + auth + age-gate in one call.
// Distinct from window.__clankyReset (progression/state.js), which only
// wipes save state, auth and age-gate are intentionally separate
// surfaces (see CLAUDE.md "save format" + age-gate.ts comment) so a
// dev iterating on currency doesn't accidentally re-trigger the age
// modal or burn an /auth/init quota.
//
// Gated behind import.meta.env.DEV so production builds don't ship a
// scary footgun on `window`. Vite tree-shakes the whole branch in
// production builds.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__clankyResetAll = () => {
    try {
      // Save state, same path as __clankyReset.
      if (typeof window.__clankyReset === 'function') {
        window.__clankyReset();
      }
    } catch { /* ignore */ }
    try {
      // Auth blob (v2 + any leftover v1).
      clearAuth();
      try { localStorage.removeItem('clankybuddy.auth.v1'); } catch { /* ignore */ }
    } catch { /* ignore */ }
    try {
      // Age-gate (storage key from @clankybuddy/shared/age-gate comment).
      localStorage.removeItem('clankybuddy.age_gate.v1');
    } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.info('[clankybuddy] __clankyResetAll: cleared save + auth + age-gate. Reload to re-bootstrap.');
  };
}

// Helper for callers that wrap an authed fetch and want lazy 401 retry.
// Runs `attempt(auth)` once with current auth; if it throws ApiError 401,
// refreshes, retries once. If the retry also 401s, clears auth so the
// next ensureAuth() bootstraps a fresh anon account, and emits the
// auth_init_after_refresh_failed lifecycle event.
//
// Not used everywhere yet (chat ticket has bespoke handling per B3); add
// callers incrementally as we hit the next 401 footgun.
export async function withAuthRetry(attempt) {
  let auth = await ensureAuth();
  try {
    return await attempt(auth);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    try {
      auth = await refreshAuth();
    } catch {
      // Refresh failed too, drop and re-init.
      clearAuth();
      emitAuthLifecycle({
        type: 'auth_init_after_refresh_failed',
        client_kind: CLIENT_KIND,
      });
      auth = await ensureAuth();
      return attempt(auth);
    }
    try {
      return await attempt(auth);
    } catch (err2) {
      if (err2 instanceof ApiError && err2.status === 401) {
        clearAuth();
        emitAuthLifecycle({
          type: 'auth_init_after_refresh_failed',
          client_kind: CLIENT_KIND,
        });
        auth = await ensureAuth();
        return attempt(auth);
      }
      throw err2;
    }
  }
}
