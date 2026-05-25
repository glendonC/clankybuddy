// Fetch-based sink for the telemetry pipeline. POSTs each batch to
// /events/batch with the cached bearer token. The sink reads auth state
// lazily on every flush so it doesn't have to coordinate with the chat
// startup ordering, pre-auth flushes fall back to console.debug, and
// post-auth flushes ship.
//
// Why fetch + keepalive instead of sendBeacon: sendBeacon can't carry an
// Authorization header, and putting a bearer in the URL is the exact thing
// backend-plan §1.1 told us not to do. fetch with keepalive is the modern
// equivalent that survives tab unload and supports custom headers.

import { loadAuth } from './auth.js';

// In-memory copy of `setUserId`'s callback so this module can hand the
// telemetry layer a user_id once auth is loaded. Avoids a circular import.
let _userIdSetter = null;

export function bindUserIdSetter(fn) {
  _userIdSetter = fn;
  // If auth is already on disk at bind time, push it through immediately
  // so emits within the first flush window carry a real user_id.
  const auth = loadAuth();
  if (auth?.user_id) fn(auth.user_id);
}

// Returns a sink function compatible with telemetry/events.js setSink().
// `debugFallback` is the console-only sink used when no auth is loaded;
// the telemetry module's default sink is fine to pass here.
export function createFetchSink({ debugFallback } = {}) {
  return (batch) => {
    const auth = loadAuth();
    // v2 schema renamed the bearer field `token` -> `access_token`.
    if (!auth?.access_token || !auth?.api_base) {
      // No bearer yet. Fall back so we don't drop events, they're still
      // visible in the console for dev, and post-auth batches start
      // shipping naturally.
      if (debugFallback) debugFallback(batch);
      return;
    }
    // Push user_id back into telemetry so subsequent envelope writes carry
    // it. Cheap; the setter is a single assignment.
    if (_userIdSetter) _userIdSetter(auth.user_id);

    const body = JSON.stringify(batch);
    // keepalive: true ensures the request survives a `pagehide` /
    // tab-close. Browsers cap keepalive payload at 64KB total per origin
    // per page lifetime, well above EVENT_MAX_BYTES × FLUSH_MAX_BATCH.
    fetch(`${auth.api_base}/events/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
      },
      body,
      keepalive: true,
    }).catch((err) => {
      // Network failure on a fire-and-forget batch is recoverable: the
      // events are gone for this user, but the schema is event-sourced
      // and gaps don't corrupt aggregates. Log in dev for visibility;
      // production has Workers Logpush for the request side.
      // eslint-disable-next-line no-console
      console.warn('[telemetry] sink fetch failed', err);
    });
  };
}
