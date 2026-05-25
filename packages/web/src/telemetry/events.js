// Client-side game-event emit pipeline. Hot write path of the stats system:
// game code calls emit({ type, ...payload }), this module wraps it in the
// envelope, batches, and hands the batch to a swappable sink.
//
// The wire shape (event types, payload fields, batch wrapper) lives in
// @clankybuddy/shared/events, single source of truth shared with the
// worker. Import with the .js extension per the existing pattern in
// src/net/constants.js (Vite + TS resolution).
//
// Design notes:
//   - There is no backend yet. The default sink is console.debug, gated by
//     a runtime flag so production builds don't spam the console. Swap to
//     a fetch-sink in src/net/ once /events/batch lands.
//   - `user_id` is empty string until the auth bootstrap runs (chat does
//     this lazily today). Worker overrides user_id on ingest anyway, so
//     the pre-auth empty string is harmless.
//   - Session lifecycle is owned here: startSession() mints a session_id,
//     endSession(reason) closes it. session_id is also exposed via
//     getSessionId() so callers that derive analytics state (combo
//     detection, "last verb" register for mood_transition cause) can scope
//     to the current session without round-tripping through emit.
//   - Flush is debounced by FLUSH_DEBOUNCE_MS, hard-flushed when the
//     queue reaches FLUSH_MAX_BATCH, and force-flushed on pagehide /
//     visibilitychange so we don't lose end-of-session events.
//   - Per-event size guard: anything exceeding EVENT_MAX_BYTES is dropped
//     (with a console warning in debug) rather than failing the batch.
//   - combo_completed is derived by state/ability-ctx.js from hit_landed
//     clusters, so ability files only report individual hits.

import {
  EVENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_VERSIONS,
  FLUSH_DEBOUNCE_MS,
  FLUSH_MAX_BATCH,
  EVENT_MAX_BYTES,
} from '@clankybuddy/shared/events';

// ──────────────────────────────────────────────────────────────────────────
// Module state
// ──────────────────────────────────────────────────────────────────────────

let userId = '';
let sessionId = '';
let sessionStartedAt = 0;
const queue = [];
let flushTimer = null;

// Tracks the last verb fired and when. mood.js reads this so a
// mood_transition can attribute itself to the most recent tool_fire
// within a 1-second window. Kept inside this module so its lifecycle
// is bounded by the session and the import graph stays one-way.
const lastFire = { verb: null, ts: 0 };
const LAST_FIRE_ATTRIBUTION_WINDOW_MS = 1000;

// Counters reset per-session so session_end can ship totals without the
// ingest needing to scan the event log.
const sessionCounters = { fires: 0, hits: 0, currencyEarned: 0, currencySpent: 0 };

// Default sink: console.debug in dev, no-op in prod. Swap via setSink().
let sink = createDebugSink();
let debugEnabled = true; // default true until we have a build flag plumbed

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

export function setUserId(id) {
  userId = id || '';
}

export function getSessionId() {
  return sessionId;
}

export function getSessionElapsedMs() {
  return sessionStartedAt ? performance.now() - sessionStartedAt : 0;
}

// Set the active sink. The default debug sink logs to console.debug; a
// future net sink will POST to /events/batch with keepalive: true.
export function setSink(fn) {
  sink = fn;
}

export function setDebugEnabled(on) {
  debugEnabled = !!on;
}

// Begin a new session. Pass the active character and equipped tools so
// session_start carries enough context for cohort analytics. Returns the
// new session_id for callers that want to log it.
export function startSession({ character, barIdx = 0, equippedTools = [], uaClass, reducedMotion } = {}) {
  // Close any open session first, defensive, in case startSession is
  // called twice without an intervening endSession.
  if (sessionId) endSession('explicit');

  sessionId = ulid();
  sessionStartedAt = performance.now();
  resetSessionCounters();

  emit({
    type: 'session_start',
    character,
    bar_idx: barIdx,
    equipped_tools: equippedTools,
    ...(uaClass ? { ua_class: uaClass } : {}),
    ...(reducedMotion !== undefined ? { reduced_motion: reducedMotion } : {}),
  });
  return sessionId;
}

// End the current session. Idempotent, calling without an active session
// is a no-op. `final_*` fields are caller-supplied because mood + state
// live outside this module.
export function endSession(reason = 'explicit', { finalMood = 0, finalState = 'CONTENT', netCurrencyDelta } = {}) {
  if (!sessionId) return;
  const durationMs = performance.now() - sessionStartedAt;
  emit({
    type: 'session_end',
    reason,
    duration_ms: Math.round(durationMs),
    final_mood: finalMood,
    final_state: finalState,
    total_fires: sessionCounters.fires,
    total_hits: sessionCounters.hits,
    net_currency_delta:
      netCurrencyDelta !== undefined
        ? netCurrencyDelta
        : sessionCounters.currencyEarned - sessionCounters.currencySpent,
  });
  // Synchronous flush so pagehide doesn't lose the closing event.
  flush();
  sessionId = '';
  sessionStartedAt = 0;
}

// The single emit entry point. Builds the envelope, applies size guard,
// updates per-session counters and the lastFire register, queues, and
// schedules a debounced flush.
export function emit(payload, opts = {}) {
  if (!payload || typeof payload !== 'object' || !payload.type) return;

  // Maintain the lastFire register before envelope-wrap so attribution
  // is consistent regardless of queue/flush timing.
  if (payload.type === 'tool_fire' && payload.verb) {
    lastFire.verb = payload.verb;
    lastFire.ts = performance.now();
    sessionCounters.fires += 1;
  } else if (payload.type === 'hit_landed') {
    sessionCounters.hits += 1;
  } else if (payload.type === 'currency_earned') {
    sessionCounters.currencyEarned += payload.amount || 0;
  } else if (payload.type === 'currency_spent') {
    sessionCounters.currencySpent += payload.amount || 0;
  }

  const event = {
    event_id: ulid(),
    user_id: userId,
    session_id: sessionId,
    client_ts: opts.clientTs ?? Date.now(),
    schema_version: EVENT_SCHEMA_VERSIONS[payload.type] ?? 1,
    ...payload,
  };

  // Drop oversize events instead of failing the whole batch. Encoding
  // length is the safe upper bound for what the worker will see.
  let encoded;
  try {
    encoded = JSON.stringify(event);
  } catch {
    return; // unserializable payload; drop silently
  }
  if (encoded.length > EVENT_MAX_BYTES) {
    if (debugEnabled) {
      // eslint-disable-next-line no-console
      console.warn('[telemetry] dropping oversize event', event.type, encoded.length);
    }
    return;
  }

  queue.push(event);
  if (queue.length >= FLUSH_MAX_BATCH) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }
}

// Read the most-recent fire verb if it falls within the attribution
// window. Used by mood.js to attach cause_verb to mood_transition.
export function getRecentFireVerb(nowMs = performance.now()) {
  if (!lastFire.verb) return null;
  if (nowMs - lastFire.ts > LAST_FIRE_ATTRIBUTION_WINDOW_MS) return null;
  return lastFire.verb;
}

// Auth-lifecycle telemetry sink. INTENTIONALLY does not flow through the
// game-event queue, these events are off-by-design from /events/batch
// (worker rejects unknown types, and storing per-user auth pings would
// just burn write hot-path bandwidth). Console-only for now; if we ever
// want server-side analytics on auth lifecycle we'll add an /auth-events
// route and swap this helper to a fetch sink. Shape lives in
// @clankybuddy/shared/auth-events (AuthLifecycleEvent union).
export function emitAuthLifecycle(event) {
  if (!event || typeof event !== 'object' || !event.type) return;
  if (!debugEnabled) return;
  // eslint-disable-next-line no-console
  console.debug('[auth-lifecycle]', event.type, event);
}

// Drain the queue to the sink. Safe to call repeatedly; no-op when empty.
export function flush() {
  if (!queue.length) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    return;
  }
  const events = queue.splice(0, queue.length);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    sink({ protocol_version: EVENT_PROTOCOL_VERSION, events });
  } catch (e) {
    if (debugEnabled) {
      // eslint-disable-next-line no-console
      console.warn('[telemetry] sink error', e);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function resetSessionCounters() {
  sessionCounters.fires = 0;
  sessionCounters.hits = 0;
  sessionCounters.currencyEarned = 0;
  sessionCounters.currencySpent = 0;
}

// Minimal ULID. 10-char base32 timestamp + 16-char base32 randomness.
// Sortable by time (the property we care about for debugging the event
// log), Crockford-base32 alphabet for readability. Replace with a real
// library only if we ever need cross-language parsing.
const ULID_ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let ts = Date.now();
  let tsPart = '';
  for (let i = 0; i < 10; i++) {
    tsPart = ULID_ALPHA[ts % 32] + tsPart;
    ts = Math.floor(ts / 32);
  }
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  let rndPart = '';
  for (let i = 0; i < 16; i++) rndPart += ULID_ALPHA[rnd[i] % 32];
  return tsPart + rndPart;
}

function createDebugSink() {
  return (batch) => {
    if (!debugEnabled) return;
    // Group by type for readable console output without losing order.
    // eslint-disable-next-line no-console
    console.debug('[telemetry] batch', batch.events.length, batch);
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Window lifecycle: flush on background/unload so we don't drop
// session_end + trailing events. pagehide is the modern unload signal;
// visibilitychange covers tab-backgrounding mid-session.
// ──────────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
  window.addEventListener('pagehide', () => {
    // session_end is the responsibility of the boot orchestrator; we just
    // make sure whatever is queued ships before the page tears down.
    flush();
  });
}
