// Auth blob persistence + cross-tab notification (v2 schema).
//
// v2 storage shape (clankybuddy.auth.v2):
//   { version: 2,
//     access_token, refresh_token, issued_at,
//     user_id, handle, color,
//     api_base }
//
// `access_token` (was `token` in v1) and `refresh_token` (new) are the
// two halves of the rotating-pair contract. `issued_at` is the wall-clock
// ms at which the access token was last minted; the proactive-refresh
// threshold (auth.js) reads this. `api_base` is captured at creation time
// so a token issued against dev never accidentally gets sent to prod.
//
// Cross-tab coherence: every save fires a BroadcastChannel notification
// on `clankybuddy-auth`. Other tabs subscribed via subscribeAuth() can
// then re-read storage and adopt the new tokens, no polling, no race
// where two tabs each kick off their own /auth/refresh. Web Locks (in
// auth.js) guarantees mutual exclusion across tabs at refresh time;
// BroadcastChannel here is for the post-refresh propagation.
//
// Quota / private mode: Safari private mode and aggressive storage
// quotas can throw on setItem. We catch, fall back to an in-memory
// shadow, and log a one-shot warning so dev sees it but the user keeps
// playing. The shadow is process-local; closing the tab loses it, which
// is acceptable for an anonymous account in private mode.

const STORAGE_KEY = 'clankybuddy.auth.v2';
const LEGACY_STORAGE_KEY = 'clankybuddy.auth.v1';
const STORAGE_VERSION = 2;
const BROADCAST_CHANNEL_NAME = 'clankybuddy-auth';

// Process-local fallback when localStorage rejects writes (private mode,
// quota exceeded). Keeps the rest of the auth flow honest within the tab.
let _memoryFallback = null;
let _memoryWarned = false;

function _safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function _safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!_memoryWarned) {
      _memoryWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-storage] localStorage write failed (private mode / quota?); falling back to in-memory auth, sessions will not persist across tab close.',
        err,
      );
    }
    return false;
  }
}

function _safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Lazy BroadcastChannel, created on first use so SSR/test environments
// without the API don't blow up at module load.
let _channel = null;
function _getChannel() {
  if (_channel) return _channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    _channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  } catch {
    _channel = null;
  }
  return _channel;
}

function _broadcast(message) {
  const ch = _getChannel();
  if (!ch) return;
  try {
    ch.postMessage(message);
  } catch {
    /* swallow, the channel can be closed mid-page-tear-down */
  }
}

function _isValidV2(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.version !== STORAGE_VERSION) return false;
  if (typeof parsed.access_token !== 'string' || !parsed.access_token) return false;
  // refresh_token may legitimately be null on a v1->v2 migrated blob.
  if (parsed.refresh_token != null && typeof parsed.refresh_token !== 'string') return false;
  if (typeof parsed.user_id !== 'string' || !parsed.user_id) return false;
  if (typeof parsed.handle !== 'string' || !parsed.handle) return false;
  if (typeof parsed.color !== 'string' || !parsed.color) return false;
  if (typeof parsed.api_base !== 'string' || !parsed.api_base) return false;
  if (typeof parsed.issued_at !== 'number') return false;
  return true;
}

// Returns the v2 blob or null if missing/corrupt. Reads memory fallback
// first if a previous write failed; otherwise reads localStorage.
export function loadAuth() {
  if (_memoryFallback && _isValidV2(_memoryFallback)) return { ..._memoryFallback };
  const raw = _safeGetItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!_isValidV2(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Merge `partial` into the existing blob (or create a new one) and persist.
// Always stamps `version: 2` so partial updates don't drift the schema.
// Broadcasts on every successful save so peer tabs can re-read.
export function saveAuth(partial) {
  if (!partial || typeof partial !== 'object') return null;
  const existing = loadAuth() || {};
  const next = {
    version: STORAGE_VERSION,
    access_token: existing.access_token ?? '',
    refresh_token: existing.refresh_token ?? null,
    issued_at: existing.issued_at ?? 0,
    user_id: existing.user_id ?? '',
    handle: existing.handle ?? '',
    color: existing.color ?? '',
    api_base: existing.api_base ?? '',
    ...partial,
    version: STORAGE_VERSION,
  };
  const serialized = JSON.stringify(next);
  const ok = _safeSetItem(STORAGE_KEY, serialized);
  if (!ok) {
    _memoryFallback = next;
  } else {
    // Clear shadow once disk is authoritative again.
    _memoryFallback = null;
  }
  _broadcast({ type: 'auth_saved', issued_at: next.issued_at });
  return next;
}

// Wipes both disk and the in-memory shadow. Broadcasts so peer tabs flush.
export function clearAuth() {
  _safeRemoveItem(STORAGE_KEY);
  _memoryFallback = null;
  _broadcast({ type: 'auth_cleared' });
}

// One-shot v1 → v2 migration. v1 stored `{ version: 1, token, user_id,
// handle, color, api_base }`. We translate `token` → `access_token`,
// stamp `refresh_token: null`, `issued_at: 0` (forces a refresh on next
// proactive check), and delete the v1 key so this is idempotent.
//
// Transparent: no logout. The user keeps their handle/color/user_id; the
// access_token is still valid (worker sliding-window TTL). The refresh
// token will be filled in on the next /auth/refresh call.
export function migrateV1IfPresent() {
  const rawV1 = _safeGetItem(LEGACY_STORAGE_KEY);
  if (!rawV1) return null;

  let v1;
  try {
    v1 = JSON.parse(rawV1);
  } catch {
    // Corrupt v1 blob, drop it, force a clean /auth/init on the next call.
    _safeRemoveItem(LEGACY_STORAGE_KEY);
    return null;
  }

  if (!v1 || typeof v1 !== 'object' || v1.version !== 1
      || typeof v1.token !== 'string' || !v1.token
      || typeof v1.user_id !== 'string' || !v1.user_id) {
    // Unrecognized v1 shape, toss it.
    _safeRemoveItem(LEGACY_STORAGE_KEY);
    return null;
  }

  const migrated = {
    version: STORAGE_VERSION,
    access_token: v1.token,
    refresh_token: null,
    issued_at: 0,
    user_id: v1.user_id,
    handle: typeof v1.handle === 'string' ? v1.handle : '',
    color: typeof v1.color === 'string' ? v1.color : '',
    api_base: typeof v1.api_base === 'string' ? v1.api_base : '',
  };

  // Only delete v1 if the v2 write succeeded, so a private-mode failure
  // doesn't leave the user stranded.
  const ok = _safeSetItem(STORAGE_KEY, JSON.stringify(migrated));
  if (ok) {
    _safeRemoveItem(LEGACY_STORAGE_KEY);
    _memoryFallback = null;
  } else {
    _memoryFallback = migrated;
  }
  _broadcast({ type: 'auth_saved', issued_at: 0, source: 'migration_v1_v2' });
  return migrated;
}

// Subscribe to cross-tab auth notifications. Returns an unsubscribe fn.
// The callback fires for both 'auth_saved' and 'auth_cleared' messages;
// callers are expected to re-read via loadAuth() rather than trust the
// payload (which only carries a hint, not the secret material).
export function subscribeAuth(callback) {
  if (typeof callback !== 'function') return () => {};
  const ch = _getChannel();
  if (!ch) return () => {};
  const handler = (ev) => {
    try { callback(ev?.data ?? null); } catch { /* user code */ }
  };
  ch.addEventListener('message', handler);
  return () => {
    try { ch.removeEventListener('message', handler); } catch { /* ignore */ }
  };
}
