import { PROTOCOL_VERSION } from '../../shared/src/chat.js';
import { ApiError, type ApiFetchOptions, apiFetch } from './api.js';
import {
  ACCESS_TOKEN_REFRESH_THRESHOLD_MS,
  VERIFY_POLL_BACKOFF_MAX_MS,
  VERIFY_POLL_INTERVAL_MS,
} from './constants.js';
import { type Config, accessTokenAge, writeConfig } from './config.js';

// Worker /auth/init may take two shapes depending on whether the call was
// gated by Turnstile (no widget on TUI) or returned a verified user pair
// directly (rare, only when the IP/ASN gate let us skip captcha entirely).
//
// `request_session: true` tells the worker "I'm a TUI and can't render a
// captcha widget, give me a session_token I can hand to the user via a
// browser link instead." The worker either skips captcha (200 verified) or
// mints a session and returns 202.

export type InitVerified = {
  kind: 'verified';
  token: string;
  refresh_token: string;
  user_id: string;
  handle: string;
  color: string;
};

export type InitSession = {
  kind: 'session';
  session_token: string;
  verify_url: string;
  expires_at: number; // epoch ms
};

export type InitResult = InitVerified | InitSession;

// Worker raw shapes. The 200 verified payload is the historical /auth/init
// response (now with refresh_token); 202 is new in Workstream B.
type RawInitVerified = {
  token: string;
  refresh_token: string;
  user_id: string;
  handle: string;
  color: string;
};

type RawInitSession = {
  session_token: string;
  verify_url: string;
  // Worker MAY emit either `session_expires_at` (newer) or `expires_at`
  // (older); accept both for forward/backward compat during rollout.
  session_expires_at?: number;
  expires_at?: number;
};

export type TicketResponse = { ticket: string };

// /auth/init returns 200 with a verified pair OR 202 with a session token.
// We let the underlying fetch handle the body; on 202 the worker returns
// the session payload and apiFetch's `res.ok` covers both 200 and 202.
//
// Implementation note: apiFetch throws on non-2xx, so 200 and 202 both
// flow through the success path, we discriminate on payload shape.
export async function authInit(base: string): Promise<InitResult> {
  const raw = await apiFetch<RawInitVerified | RawInitSession>(base, '/auth/init', {
    method: 'POST',
    body: JSON.stringify({ request_session: true }),
  });
  if ('token' in raw && typeof raw.token === 'string') {
    return {
      kind: 'verified',
      token: raw.token,
      refresh_token: raw.refresh_token,
      user_id: raw.user_id,
      handle: raw.handle,
      color: raw.color,
    };
  }
  if ('session_token' in raw && typeof raw.session_token === 'string') {
    const expires_at = raw.session_expires_at ?? raw.expires_at ?? 0;
    return {
      kind: 'session',
      session_token: raw.session_token,
      verify_url: raw.verify_url,
      expires_at,
    };
  }
  throw new Error('auth/init: unrecognized response shape');
}

export type VerifyStatus =
  | { state: 'pending' }
  | {
      state: 'verified';
      token: string;
      refresh_token: string;
      user_id: string;
      handle: string;
      color: string;
    }
  | { state: 'expired' };

type RawVerifyStatus =
  | { state: 'pending' }
  | {
      state: 'verified';
      token: string;
      refresh_token: string;
      user_id: string;
      handle: string;
      color: string;
    }
  | { state: 'expired' };

// Single-shot poll. Caller wraps in a backoff loop (pollForToken below).
export async function pollVerifyStatus(
  base: string,
  session_token: string,
): Promise<VerifyStatus> {
  const path = `/auth/init/status?session=${encodeURIComponent(session_token)}`;
  return apiFetch<RawVerifyStatus>(base, path, { method: 'GET' });
}

export type PollOpts = {
  // Hard deadline in epoch ms; once Date.now() crosses, abort to 'expired'.
  // The verify screen passes the worker's session expires_at here.
  expires_at: number;
  // Cooperative cancel from the verify screen (Esc, unmount, parent abort).
  signal?: AbortSignal;
  // Optional per-tick callback so the verify screen can show "still
  // waiting" without rendering off the polling loop's internal state.
  onTick?: (status: VerifyStatus) => void;
};

export type PollResult =
  | {
      kind: 'verified';
      token: string;
      refresh_token: string;
      user_id: string;
      handle: string;
      color: string;
    }
  | { kind: 'expired' }
  | { kind: 'cancelled' };

// 1.5s → 3s → 6s capped exponential backoff. Stops on verified, expired,
// signal abort, or hard deadline. Network errors don't abort the loop,
// they fold into the backoff cadence (transient DNS / sleeping laptop).
export async function pollForToken(
  base: string,
  session_token: string,
  opts: PollOpts,
): Promise<PollResult> {
  let interval = VERIFY_POLL_INTERVAL_MS;

  while (true) {
    if (opts.signal?.aborted) return { kind: 'cancelled' };
    if (Date.now() >= opts.expires_at) return { kind: 'expired' };

    let status: VerifyStatus;
    try {
      status = await pollVerifyStatus(base, session_token);
    } catch {
      // Tolerate transient errors: keep polling on the backoff cadence.
      // The deadline check above is the final escape hatch.
      status = { state: 'pending' };
    }

    opts.onTick?.(status);

    if (status.state === 'verified') {
      return {
        kind: 'verified',
        token: status.token,
        refresh_token: status.refresh_token,
        user_id: status.user_id,
        handle: status.handle,
        color: status.color,
      };
    }
    if (status.state === 'expired') return { kind: 'expired' };

    // pending → sleep with backoff, but break early on abort/deadline.
    const wait = Math.min(interval, VERIFY_POLL_BACKOFF_MAX_MS);
    const sleptCleanly = await sleepCancellable(wait, opts.signal, opts.expires_at);
    if (!sleptCleanly.ok) {
      return sleptCleanly.reason === 'abort' ? { kind: 'cancelled' } : { kind: 'expired' };
    }
    interval = Math.min(interval * 2, VERIFY_POLL_BACKOFF_MAX_MS);
  }
}

function sleepCancellable(
  ms: number,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<{ ok: true } | { ok: false; reason: 'abort' | 'deadline' }> {
  return new Promise((resolve) => {
    const remaining = Math.min(ms, Math.max(0, deadline - Date.now()));
    const timer = setTimeout(() => {
      cleanup();
      resolve(Date.now() >= deadline ? { ok: false, reason: 'deadline' } : { ok: true });
    }, remaining);
    const onAbort = () => {
      cleanup();
      resolve({ ok: false, reason: 'abort' });
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (signal) {
      if (signal.aborted) {
        cleanup();
        resolve({ ok: false, reason: 'abort' });
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export type RefreshResponse = {
  token: string;
  refresh_token: string;
  user_id: string;
};

// /auth/refresh, rotate the access (and possibly refresh) token. The
// worker rotates the refresh token if it's past the proactive threshold;
// caller treats the returned refresh_token as the new source of truth.
export async function refreshAccessToken(
  base: string,
  refresh_token: string,
): Promise<RefreshResponse> {
  return apiFetch<RefreshResponse>(base, '/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token }),
  });
}

// Returns a usable access token, refreshing in-place if the current one
// is past the proactive threshold AND we have a refresh_token to spend.
//
// `persist` is the caller's writeConfig wrapper (cli.tsx owns the React
// state side; we don't import it here to keep auth.ts UI-free). The
// updated config object passed to persist already carries the new
// access_token, access_token_issued_at, and (rotated) refresh_token.
//
// On refresh failure (network / 401 invalid_or_expired) we fall back to
// the existing access_token, let the calling endpoint's 401 trigger a
// hard re-init. Bubbling the refresh error here would break the
// happy-path call that prompted the refresh.
export async function getValidAccessToken(
  cfg: Config,
  persist: (next: Config) => Promise<void>,
  opts: { force?: boolean } = {},
): Promise<string> {
  const stale = accessTokenAge(cfg) > ACCESS_TOKEN_REFRESH_THRESHOLD_MS;
  if (!opts.force && (!stale || !cfg.refresh_token)) return cfg.access_token;
  // Force-refresh path with no refresh_token = the token is dead and we
  // have no way to renew it. Surface a real 401 so the api.ts retry path
  // propagates to chat.tsx's onTokenRejected handler, which deletes the
  // dead config and bootstraps a fresh anonymous identity. Returning the
  // dead token here would just loop the caller into another 401 with no
  // progress.
  if (!cfg.refresh_token) {
    if (opts.force) {
      throw new ApiError(401, 'Unauthorized', 'unauthorized');
    }
    return cfg.access_token;
  }

  try {
    const fresh = await refreshAccessToken(cfg.api_base, cfg.refresh_token);
    const next: Config = {
      ...cfg,
      access_token: fresh.token,
      access_token_issued_at: Date.now(),
      refresh_token: fresh.refresh_token,
    };
    await persist(next);
    return fresh.token;
  } catch (err) {
    // A 401 here means the refresh_token itself is dead. The calling
    // endpoint will then return 401, the api.ts onUnauthorized hook will
    // retry once with whatever this fallback returns (also 401), and
    // chat.tsx routes the second 401 to onTokenRejected.
    if (err instanceof ApiError && err.status === 401) {
      return cfg.access_token;
    }
    // Network error / other: same fallback. Don't gate the call path on
    // refresh, the access_token is still valid for ~20% of TTL by design.
    return cfg.access_token;
  }
}

export async function authWsTicket(
  base: string,
  token: string,
  options: ApiFetchOptions = {},
): Promise<TicketResponse> {
  // The worker gates ticket minting on the wire protocol version, a
  // ticket-without-version means a client too old to speak the current
  // chat shape, and the worker returns HTTP 426. Pass the version as a
  // query param so both surfaces (TUI + future web) agree on the wire
  // contract before the WebSocket upgrade even starts.
  const path = `/auth/ws-ticket?v=${encodeURIComponent(PROTOCOL_VERSION)}`;
  return apiFetch<TicketResponse>(base, path, { method: 'POST' }, token, options);
}
