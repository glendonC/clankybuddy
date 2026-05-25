import { DEV_API, DEV_WEB, PROD_API, PROD_WEB, USER_AGENT } from './constants.js';

export function resolveApiBase(): string {
  if (process.env.CLANKYBUDDY_API) return process.env.CLANKYBUDDY_API;
  if (process.env.NODE_ENV === 'development') return DEV_API;
  return PROD_API;
}

export function resolveWebUrl(): string {
  if (process.env.CLANKYBUDDY_WEB) return process.env.CLANKYBUDDY_WEB;
  if (process.env.NODE_ENV === 'development') return DEV_WEB;
  return PROD_WEB;
}

// Error bodies can carry server-side context (tokens, refresh-ticket ids,
// session/nonce ids, account uuids). Truncate + scrub before any of this
// surfaces in user-facing error messages or logs.
function redactSecrets(text: string): string {
  const MAX = 200;
  let out = text.length > MAX ? `${text.slice(0, MAX)}…` : text;
  // session_/nonce_ added in Workstream C, Turnstile flow uses them as
  // verification-handshake identifiers; they're as sensitive as bearer tokens.
  out = out.replace(
    /(?:tok|rt|tk|tkt|ticket|token|bearer|refresh|session|nonce)_[A-Za-z0-9_-]+/gi,
    '[REDACTED]',
  );
  out = out.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[uuid]');
  return out;
}

function summarize(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return 'no body';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      const pick = rec.error ?? rec.message ?? rec.code;
      if (typeof pick === 'string' && pick.length > 0) return pick;
    }
  } catch {
    // fall through to plain-text path
  }
  return trimmed.slice(0, 80);
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly summary: string;
  public readonly body?: string;

  constructor(status: number, statusText: string, summary: string, body?: string) {
    const safeSummary = redactSecrets(summary);
    super(`${status} ${statusText}, ${safeSummary}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.summary = safeSummary;
    this.body = body === undefined ? undefined : redactSecrets(body);
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, res.statusText, 'invalid JSON response');
  }
}

export type ApiFetchOptions = {
  // 401-retry hook. Invoked at most once per call. Resolves to a fresh
  // bearer token; the original request is replayed with that token. If
  // the retry also 401s, the second ApiError propagates unchanged.
  onUnauthorized?: () => Promise<string>;
};

async function doFetch(
  url: string,
  init: RequestInit,
  baseHeaders: Headers,
  token: string | undefined,
): Promise<Response> {
  const headers = new Headers(baseHeaders);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function apiFetch<T>(
  base: string,
  path: string,
  init: RequestInit = {},
  token?: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  // Headers ex-Authorization are stable across the original request and
  // the 401-retry; Authorization is layered on per-attempt.
  const baseHeaders = new Headers(init.headers);
  baseHeaders.set('User-Agent', USER_AGENT);
  if (init.body && !baseHeaders.has('Content-Type')) {
    baseHeaders.set('Content-Type', 'application/json');
  }
  const url = `${base}${path}`;

  let res = await doFetch(url, init, baseHeaders, token);

  if (res.status === 401 && options.onUnauthorized) {
    // Drain the body of the original 401 so the connection can be reused;
    // we don't care what it says, the retry result is what propagates.
    await res.text().catch(() => '');
    const fresh = await options.onUnauthorized();
    res = await doFetch(url, init, baseHeaders, fresh);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, res.statusText, summarize(body), body);
  }
  return parseJson<T>(res);
}
