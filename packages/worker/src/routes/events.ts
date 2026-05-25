import { authenticate } from '../auth.js';
import {
  EVENT_BATCH_MAX_ITEMS,
  EVENT_MAX_BYTES_SERVER,
  KNOWN_EVENT_TYPES,
  ULID_RE,
  VALID_MODELS,
} from '../constants.js';
import {
  EVENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_VERSIONS,
  EVENT_SCHEMA_MIN_ACCEPTED,
  type GameEvent,
  type GameEventType,
} from '../../../shared/src/events.js';
import type { Env } from '../types.js';

// POST /events/batch, append-only event log ingest. Each event is
// idempotency-keyed by its ULID `event_id` (INSERT OR IGNORE in the DO),
// so client retries are transparent.
//
// Drop-not-fail validation: an event that fails validation is recorded
// in the `dropped` indices array and the batch continues. The whole batch
// only fails on protocol-level problems (bad JSON, oversized batch, wrong
// protocol_version), those return 4xx and the client should NOT retry
// the same payload.
//
// Authoritative user_id: the bearer wins. Whatever user_id the client
// stamped on each event is overwritten in the DO. Clients can't forge.

const VALID_MODEL_SET = new Set<string>(VALID_MODELS);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function shardIdFor(userId: string): string {
  // Same scheme as routes/actions.ts so events and counter rollups land
  // on the same shard for any given user.
  const slice = userId.startsWith('u_') ? userId.slice(2) : userId;
  const ch = slice.charAt(0).toLowerCase();
  return /^[0-9a-f]$/.test(ch) ? ch : '0';
}

interface EventBatchBody {
  protocol_version: string;
  events: unknown[];
}

interface ValidationOutcome {
  accepted: GameEvent[];
  dropped: number[];
}

// Per-event validation. Returns true if the event passes; pushes its
// original index to `dropped` and returns false otherwise. Validates:
//   - shape (object, has type/event_id/session_id/client_ts/schema_version)
//   - event_id matches ULID format
//   - type is in KNOWN_EVENT_TYPES
//   - schema_version === 1 (bump when payloads version)
//   - serialized size ≤ EVENT_MAX_BYTES_SERVER
//   - any model-typed field (character / from / to) is in VALID_MODELS
//
// Per-event-type field validation (e.g. mood_transition.from is a valid
// MoodState) is intentionally NOT enforced here. The payload is JSON in
// the DO; aggregators reject malformed entries when they read. This keeps
// the route fast and avoids lockstep coupling between worker validation
// and the events.ts schema.
function validateEvent(raw: unknown, idx: number, dropped: number[]): GameEvent | null {
  if (!raw || typeof raw !== 'object') {
    dropped.push(idx);
    return null;
  }
  const ev = raw as Record<string, unknown>;

  if (typeof ev.event_id !== 'string' || !ULID_RE.test(ev.event_id)) {
    dropped.push(idx);
    return null;
  }
  if (typeof ev.session_id !== 'string' || ev.session_id.length === 0 || ev.session_id.length > 64) {
    dropped.push(idx);
    return null;
  }
  if (typeof ev.client_ts !== 'number' || !Number.isFinite(ev.client_ts)) {
    dropped.push(idx);
    return null;
  }
  if (typeof ev.type !== 'string' || !KNOWN_EVENT_TYPES.has(ev.type)) {
    dropped.push(idx);
    return null;
  }
  // Per-type version gate. Worker accepts [MIN_ACCEPTED, CURRENT + 1].
  // The +1 grace lets a canary client emit ahead of a worker rollout
  // without losing events; aggregators that don't recognize the higher
  // version log + skip rather than crashing.
  const evType = ev.type as GameEventType;
  const minVer = EVENT_SCHEMA_MIN_ACCEPTED[evType] ?? 1;
  const curVer = EVENT_SCHEMA_VERSIONS[evType] ?? 1;
  if (
    typeof ev.schema_version !== 'number' ||
    !Number.isInteger(ev.schema_version) ||
    ev.schema_version < minVer ||
    ev.schema_version > curVer + 1
  ) {
    dropped.push(idx);
    return null;
  }

  // Model-typed fields are checked because the polarity bucketing and
  // per-model aggregators key off them. A bad value here would silently
  // corrupt counters; better to drop at ingest.
  if (typeof ev.character === 'string' && !VALID_MODEL_SET.has(ev.character)) {
    dropped.push(idx);
    return null;
  }
  if (ev.type === 'character_switch') {
    if (typeof ev.from !== 'string' || !VALID_MODEL_SET.has(ev.from)) {
      dropped.push(idx);
      return null;
    }
    if (typeof ev.to !== 'string' || !VALID_MODEL_SET.has(ev.to)) {
      dropped.push(idx);
      return null;
    }
  }

  // Size guard. Re-encoding is cheap and is the only honest way to know
  // what the row will actually cost in the DO.
  let encoded: string;
  try {
    encoded = JSON.stringify(ev);
  } catch {
    dropped.push(idx);
    return null;
  }
  if (encoded.length > EVENT_MAX_BYTES_SERVER) {
    dropped.push(idx);
    return null;
  }

  return ev as unknown as GameEvent;
}

export async function handleEventsBatch(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await authenticate(env, request);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const candidate = body as Partial<EventBatchBody>;

  if (candidate.protocol_version !== EVENT_PROTOCOL_VERSION) {
    return jsonResponse(
      {
        error: 'protocol_unsupported',
        required_version: EVENT_PROTOCOL_VERSION,
      },
      426,
    );
  }
  if (!Array.isArray(candidate.events)) {
    return jsonResponse({ error: 'invalid_events' }, 400);
  }
  if (candidate.events.length === 0) {
    return jsonResponse({ accepted: 0 }, 200);
  }
  if (candidate.events.length > EVENT_BATCH_MAX_ITEMS) {
    return jsonResponse(
      { error: 'batch_too_large', max_items: EVENT_BATCH_MAX_ITEMS },
      413,
    );
  }

  const outcome: ValidationOutcome = { accepted: [], dropped: [] };
  for (let i = 0; i < candidate.events.length; i++) {
    const ev = validateEvent(candidate.events[i], i, outcome.dropped);
    if (ev) outcome.accepted.push(ev);
  }

  // Nothing valid in the batch, short-circuit so we don't pay for a
  // round-trip to the DO. dropped is still returned so the client can
  // log/quarantine.
  if (outcome.accepted.length === 0) {
    return jsonResponse({ accepted: 0, dropped: outcome.dropped }, 200);
  }

  const shardId = shardIdFor(user.id);
  const stub = env.ACTION_SHARD.get(env.ACTION_SHARD.idFromName(shardId));
  const result = await stub.ingestEvents({
    user_id: user.id,
    events: outcome.accepted,
  });

  return jsonResponse(
    {
      accepted: result.accepted,
      ...(outcome.dropped.length > 0 ? { dropped: outcome.dropped } : {}),
      // duplicates is informational, client doesn't need it for retry
      // logic, but it surfaces idempotency working in observability.
      ...(result.duplicates > 0 ? { duplicates: result.duplicates } : {}),
    },
    200,
  );
}
