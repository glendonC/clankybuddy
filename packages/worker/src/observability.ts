// Workers Analytics Engine sink. AE has a 25B-data-points/month cap on Paid
// (backend-plan.md §Observability); high-cardinality dimensions sample at 1%
// per Challenger §4.6. Default sample rate is 100%.
//
// AE's `writeDataPoint` accepts up to 20 string blobs, 20 doubles, and one
// index. We map named fields onto positional `blobs`/`doubles` slots in
// fixed order so dashboard queries can reference them by index without
// reading this file. The index field is the primary filter key; we use
// `user_id` (or 'anon') so per-user filtering is cheap.
//
// SLOT TABLE, append-only. Reordering or repurposing a slot silently
// rewrites historical dashboards that pin column indexes. Add new fields
// to the end of buildBlobs / buildDoubles, never in the middle.
//
//   blobs:
//     blob1  event_type
//     blob2  user_id
//     blob3  room_id
//     blob4  block_reason
//     blob5  rep_band
//     blob6  asn
//     blob7  country
//     blob8  decision
//     blob9  detail
//     blob10 cache_hit       ("1" | "0"), Plan B 2026-05-15
//
//   doubles:
//     double1 latency_ms
//     double2 cost_usd
//     double3 value
//     double4 budget_usd    , Plan B 2026-05-15
//     double5 pending_delta , Plan B 2026-05-15 (in-memory accumulator at emit-time)

import type { Env } from './types.js';

export interface EventBlobs {
  event_type: string;
  user_id?: string;
  room_id?: string;
  block_reason?: string;
  rep_band?: string;
  asn?: string;
  country?: string;
  decision?: string;
  // Free-form tag for event-specific payload (e.g. tier2_unsafe categories).
  detail?: string;
  // "1" when the tier2 cache short-circuited the AI call, "0" when the path
  // ran live. Letting the dashboard split cache-hit vs miss without joining
  // separate event types.
  cache_hit?: '1' | '0';
}

export interface EventDoubles {
  latency_ms?: number;
  cost_usd?: number;
  // Generic numeric slot, keeps the call sites flexible without growing the
  // struct every time a new event needs a counter (e.g. queue depth).
  value?: number;
  // Configured daily budget at emit time. Carried on cost-shaped events
  // (tier2_decision, kill_switch_flip, mod_cost_snapshot) so dashboards can
  // plot headroom without round-tripping to KV/env.
  budget_usd?: number;
  // In-memory DO counter delta at emit time (pre-flush). Pairs with the
  // KV-backed `mcount:<day>` counter so a query can sum them for the true
  // current-cost view.
  pending_delta?: number;
}

// High-cardinality classes per backend-plan.md §Observability. These sample at
// 1% to stay under AE's monthly-points cap. Anything not in this set ships at
// 100%, operationally important low-cardinality decisions (mode flips, init
// gate decisions) need every datapoint.
const HIGH_CARDINALITY_EVENTS: ReadonlySet<string> = new Set<string>([
  'msg_processed',
  'ws_connect',
  'action_recorded',
]);

const HIGH_CARD_SAMPLE_RATE = 0.01;

// Blob slot order, keep fixed; AE queries reference these by `blob1..blobN`.
// Adding new fields means appending, never reordering.
function buildBlobs(b: EventBlobs): (string | null)[] {
  return [
    b.event_type,
    b.user_id ?? null,
    b.room_id ?? null,
    b.block_reason ?? null,
    b.rep_band ?? null,
    b.asn ?? null,
    b.country ?? null,
    b.decision ?? null,
    b.detail ?? null,
    b.cache_hit ?? null,
  ];
}

function buildDoubles(d?: EventDoubles): number[] {
  if (!d) return [];
  // Trailing zeros are unavoidable, AE doesn't do sparse doubles. Picking 0
  // for absent slots is fine because dashboards filter by event_type before
  // reading numeric fields.
  return [
    d.latency_ms ?? 0,
    d.cost_usd ?? 0,
    d.value ?? 0,
    d.budget_usd ?? 0,
    d.pending_delta ?? 0,
  ];
}

export function logEvent(
  env: Env,
  blobs: EventBlobs,
  doubles?: EventDoubles,
): void {
  // ANALYTICS is optional, alpha environments may not provision the dataset
  // and we don't want a missing binding to crash request handling.
  const ds = env.ANALYTICS;
  if (!ds) return;

  if (HIGH_CARDINALITY_EVENTS.has(blobs.event_type)) {
    if (Math.random() >= HIGH_CARD_SAMPLE_RATE) return;
  }

  try {
    ds.writeDataPoint({
      blobs: buildBlobs(blobs),
      doubles: buildDoubles(doubles),
      indexes: [blobs.user_id ?? 'anon'],
    });
  } catch {
    // AE writes are best-effort telemetry. Never let a logging failure
    // surface to the request path.
  }
}
