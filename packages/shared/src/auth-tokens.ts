// Cross-package auth token TTL contracts. Single source of truth so the
// worker, web client, and TUI never disagree on when a token is "stale."
//
// Worker is the producer of record:
//   - packages/worker/src/constants.ts:16  TOKEN_TTL_SEC = 90 * 24 * 3600
//   - packages/worker/src/constants.ts:20  REFRESH_TOKEN_TTL_SEC = 30 * 24 * 3600
// The worker's `_SEC` constants stay because Cloudflare KV / SQL APIs work
// in seconds; this module exposes the same numbers in milliseconds for the
// browser/TUI Date.now() math, plus the proactive-refresh thresholds.
//
// Threshold rationale: refresh at 80% of TTL so a single offline window
// shorter than 20% of TTL still recovers without a re-init. Mismatched
// thresholds across surfaces would create scenarios where one surface
// silently lets a token expire while another would have refreshed; this
// module exists to make that bug impossible.

// Access token sliding-window TTL (90 days). Worker rotates `tokens.last_used_at`
// on every authed request; expiry is `last_used_at + this`.
export const ACCESS_TOKEN_TTL_MS = 90 * 24 * 3600 * 1_000;

// Refresh token absolute TTL (30 days). Rotated on every /auth/refresh; the
// returned new refresh token gets a fresh 30-day window.
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600 * 1_000;

// Proactively refresh the access token when it's older than 80% of its TTL
// (72 days). Driven by `Date.now() - access_token_issued_at`. Web boots and
// TUI launches both honor this number.
export const ACCESS_TOKEN_REFRESH_THRESHOLD_MS = Math.floor(
  ACCESS_TOKEN_TTL_MS * 0.8,
);

// Proactively rotate the refresh token when it's older than 80% of its TTL
// (24 days). Drives "boot-time refresh" on both surfaces; lets a user be
// offline for ≤ 20% of refresh TTL and still recover seamlessly. After this
// threshold, the next /auth/refresh call also rotates the refresh token.
export const REFRESH_TOKEN_PROACTIVE_THRESHOLD_MS = Math.floor(
  REFRESH_TOKEN_TTL_MS * 0.8,
);
