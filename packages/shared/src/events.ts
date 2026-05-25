// Cross-package game event protocol. The hot write path of the stats system:
// the browser game (and the TUI, if/when it gains a play surface) emits typed
// events; the worker appends them to ActionShardDO + R2 archive; cron
// aggregators derive every read surface (leaderboard, /me/stats, time
// buckets, records).
//
// Counter tables are NEVER written directly by clients. The event log is the
// source of truth; counters are advisory caches rebuilt by aggregators on
// schedule (and on-demand for new aggregates / backfills).
//
// Stability contract:
//   - Adding a new EventType is backward-compatible (old aggregators ignore).
//   - Adding an OPTIONAL field to an existing payload is backward-compatible
//     (aggregators handle missing).
//   - Renaming/removing a field, or repurposing an EventType, requires a
//     per-type schema_version bump AND an aggregator that branches on it.
//   - The envelope (event_id, user_id, session_id, client_ts, schema_version,
//     type) is frozen. Envelope changes require EVENT_PROTOCOL_VERSION bump
//     and a worker route migration.

// ──────────────────────────────────────────────────────────────────────────
// Protocol constants
// ──────────────────────────────────────────────────────────────────────────

// Envelope-level major version. Worker rejects batches with mismatched
// majors; clients refuse to upgrade past their own. Bump only when the
// envelope shape (NOT a payload) changes incompatibly.
export const EVENT_PROTOCOL_VERSION = '1';

// Maximum events per /events/batch POST. Worker rejects oversized batches
// with 413. Tuned so a one-second flush at peak input rate (machinegun + a
// projectile-spam tool) fits comfortably.
export const BATCH_MAX_EVENTS = 100;

// Maximum bytes per single serialized event after JSON encoding. Worker
// truncates on ingest by dropping the offending event with a server log
// rather than rejecting the whole batch, keeps a noisy client honest
// without losing the rest of the session.
export const EVENT_MAX_BYTES = 1024;

// Client flush cadence for `/events/batch`. Below this the client batches
// in memory; above this it flushes regardless of fill. Worker has no opinion.
export const FLUSH_DEBOUNCE_MS = 1_000;
export const FLUSH_MAX_BATCH = 50;

// ──────────────────────────────────────────────────────────────────────────
// Domain ids, sourced from src/ as of v0
// ──────────────────────────────────────────────────────────────────────────

// Persona/model id roster. Source of truth is PERSONA_IDS in ./personas;
// re-exporting the type here so existing consumers can keep importing
// `ModelId` from this file without churn.
export type { ModelId } from './personas.js';
import type { ModelId } from './personas.js';

// src/mood.js: MOOD_STATES.
export type MoodState = 'ECSTATIC' | 'HAPPY' | 'CONTENT' | 'WORRIED' | 'HURT' | 'BROKEN';

// src/physics/ragdoll.js:56-59. The ragdoll has six bodies but only four
// part *types* (left/right are symmetric). Heatmaps reuse this; if we ever
// want left/right asymmetry, add a `side: 'L'|'R'|null` to HitLanded.
export type PartType = 'head' | 'torso' | 'arm' | 'leg';

// src/effects/registry.js + src/effects/*.js. Keep snake_case to match
// effect module ids on disk.
export type EffectId =
  | 'on_fire'
  | 'frozen'
  | 'electrified'
  | 'powered'
  | 'in_blackhole'
  | 'concussed';

// src/ui/tools-table.js TAXONOMY. Worth carrying as a typed enum so
// aggregators can group verbs by spine/group without re-deriving the
// taxonomy from the tools table. Worker keeps a parallel copy and
// validates incoming verbs match the registered spine/group.
export type ToolSpine = 'positive' | 'negative' | 'utility';
export type ToolGroup =
  | 'affection'
  | 'gifts'
  | 'blessings'
  | 'melee'
  | 'ranged'
  | 'elemental'
  | 'god'
  | 'manipulation';

// VerbId is the same string as a tool id in src/ui/tools-table.js. Kept as
// `string` rather than a union so adding a new tool doesn't require a
// shared-package version bump, the worker validates against its own
// registered list. The list as of v0:
//   pet, compliment, feed, gift, gpu,
//   punch, hammer, sword, gun, machinegun, shotgun, rocket, grenade,
//   fireball, flamethrower, lightning, freeze, bomb,
//   anvil, blackhole, nuke,
//   grab
export type VerbId = string;

// src/ui/tools-table.js: tool.kind. Carried on tool_fire so we can later
// distinguish drag-released grenades from click-fires without joining
// against the tools table at query time.
export type ToolKind = 'click' | 'hold' | 'drag' | 'hold+drag';

// Reasons a currency_earned / currency_spent event records.
//   fire          , earnFromFire (per ability fire)
//   state_first   , first-time mood-state bonus (seenStates)
//   state_change  , recurring mood-state transition bonus
//   unlock        , node purchase
export type EarnReason = 'fire' | 'state_first' | 'state_change';
export type SpendReason = 'unlock';

// Why a session ended. `unload` is fired from `pagehide`/`visibilitychange`;
// `idle` is the client-side timeout (no input for N minutes); `explicit` is
// reserved for a future "stop tracking me" button or character switch that
// chooses to reset the session counter.
export type SessionEndReason = 'unload' | 'idle' | 'explicit';

// ──────────────────────────────────────────────────────────────────────────
// Event envelope + payloads
// ──────────────────────────────────────────────────────────────────────────

// Common envelope fields shared by every event. The client supplies all of
// these; the worker decorates with `server_ts` and `ingest_shard` on write
// (see StoredGameEvent below).
//
// Envelope notes:
//   - event_id: ULID. Sortable + collision-resistant + idempotency key for
//     the per-event INSERT OR IGNORE on the server. Replaces the per-batch
//     batch_id from backend-plan §Game-side at finer grain.
//   - user_id: caller's stable id from the bearer; the worker overrides this
//     on ingest (clients can't spoof user_id). Carried in the envelope so
//     the same shape is usable in R2 archives without re-joining.
//   - session_id: ULID minted at session_start. Used to bound combos,
//     records, and per-session aggregates. New session_id on session_start;
//     reused on every event in that session.
//   - client_ts: epoch ms from the user's clock. Used for ordering WITHIN a
//     session only, never trust across sessions or users.
//   - schema_version: bumped per-EventType when the payload shape changes
//     incompatibly. Aggregators branch on this.
//   - type: discriminator.
type Envelope<T extends string, P> = {
  event_id: string;
  user_id: string;
  session_id: string;
  client_ts: number;
  // Per-type version. Bumped only on incompatible payload changes (renaming
  // or removing fields, narrowing a type, repurposing semantics). Adding an
  // optional field does NOT bump. Worker validates against the registries
  // below; clients pull their value from EVENT_SCHEMA_VERSIONS at emit time.
  schema_version: number;
  type: T;
} & P;

// Session boundaries. session_start carries the active character/equip set
// at the moment the session begins; session_end carries the final mood and
// verb count so aggregators can write a session-summary row without
// scanning every event in the session.
export type SessionStart = Envelope<'session_start', {
  character: ModelId;
  bar_idx: number;
  equipped_tools: VerbId[];
  // Browser environment hints the client knows. Worker may discard.
  ua_class?: 'desktop' | 'mobile' | 'tablet';
  reduced_motion?: boolean;
}>;

export type SessionEnd = Envelope<'session_end', {
  reason: SessionEndReason;
  duration_ms: number;
  final_mood: number;          // -100..100
  final_state: MoodState;
  total_fires: number;
  total_hits: number;
  net_currency_delta: number;  // earned - spent, this session
}>;

// A tool fire, fired on mousedown for click, on every interval-tick for
// hold, on mouseup for drag. Carries enough to reconstruct frustration
// signals (cooldown_blocked) and engagement intensity without joining
// against the tools table.
export type ToolFire = Envelope<'tool_fire', {
  verb: VerbId;
  kind: ToolKind;
  spine: ToolSpine;
  group: ToolGroup;
  character: ModelId;       // active character at fire time
  // Optional kind:'drag' release vector. For grab+grenade analytics.
  drag_vec?: { x: number; y: number };
  // True when the fire was throttled by FIRE_INTERVAL, frustration signal.
  cooldown_blocked?: boolean;
}>;

// A successful hit landing on the ragdoll. Emit per part-collision, NOT per
// tool-fire, one rocket can land hits on multiple parts. `mood_delta` is
// post-applied (after damageMul, isBrittle, etc.) so aggregators don't have
// to recompute combo bonuses.
export type HitLanded = Envelope<'hit_landed', {
  verb: VerbId;
  character: ModelId;
  part: PartType;
  impulse: number;             // |Δv| in matter units; useful for DPS curves
  mood_delta: number;          // applied delta to mood.happiness
  active_effects: EffectId[];  // status on the part at impact
  brittle: boolean;            // shatter-eligible (frozen + impact-tier)
  combo_index: number;         // 0 = first hit of combo, 1+ = continuation
}>;

// Mood crossed a state boundary. Fired by the mood classifier, NOT by any
// individual ability. cause_verb is the most-recent tool_fire within the
// last second (or null for spontaneous decay).
export type MoodTransition = Envelope<'mood_transition', {
  character: ModelId;
  from: MoodState;
  to: MoodState;
  mood_value: number;          // happiness at transition
  cause_verb: VerbId | null;
  first_seen: boolean;         // true the first time THIS character hits THIS state
}>;

// Status effect lifecycle. on/off, with the source verb so combo
// aggregators (frozen→shatter, on_fire→combust) can correlate.
export type StatusApplied = Envelope<'status_applied', {
  effect: EffectId;
  character: ModelId;
  part: PartType;
  source_verb: VerbId;
  duration_ms: number;
  intensity?: number;          // effect-specific (e.g. on_fire stack count)
}>;

export type StatusExpired = Envelope<'status_expired', {
  effect: EffectId;
  character: ModelId;
  part: PartType;
  // 'natural' = duration ran out; 'overridden' = opposing effect
  // (fire melts frozen, freeze extinguishes fire); 'cleared' = ragdoll
  // respawn / character switch.
  reason: 'natural' | 'overridden' | 'cleared';
}>;

// Closed-form combo summary. The CLIENT decides combo boundaries (typically
// hits within 600ms with no idle gap) so aggregators don't have to
// reconstruct them from raw HitLanded events. Includes the verb chain in
// order for "combo replay" rendering on the web side.
export type ComboCompleted = Envelope<'combo_completed', {
  character: ModelId;
  verbs: VerbId[];             // ordered, length = hits in combo
  duration_ms: number;
  total_mood_delta: number;
  parts_hit: PartType[];       // parallel to verbs
}>;

// Character roster change. Emitted when the user picks a different model
// in the picker. Counts toward per-character session aggregates.
export type CharacterSwitch = Envelope<'character_switch', {
  from: ModelId;
  to: ModelId;
}>;

// Hotbar equip change. `tool_id: null` means the slot was cleared.
export type ToolEquip = Envelope<'tool_equip', {
  bar_idx: number;
  slot_idx: number;
  tool_id: VerbId | null;
  source: 'picker' | 'shortcut' | 'auto_unlock';
}>;

// Currency events. earn_per_fire is high-frequency; spend is rare.
// `amount` is always positive; the type tells you direction.
export type CurrencyEarned = Envelope<'currency_earned', {
  amount: number;
  reason: EarnReason;
  // For reason='fire', the verb that earned it. Lets us build per-tool
  // earn-rate curves without joining tool_fire to currency_earned by ts.
  verb?: VerbId;
  character?: ModelId;
}>;

export type CurrencySpent = Envelope<'currency_spent', {
  amount: number;
  reason: SpendReason;
  node_id?: string;            // for reason='unlock'
}>;

// Tree-node purchase. Pairs with a CurrencySpent, carry the node id here
// and the cost there so aggregators can join on the same client_ts.
export type UnlockPurchased = Envelope<'unlock_purchased', {
  node_id: string;             // e.g. 'g.melee.sword.dmg2'
  cost: number;
  unlocks_kind: 'tool' | 'stat';
  unlocks_target: VerbId | null;
}>;

// Settings changes. Low volume but useful for cohort analytics ("users
// with reduce_motion enabled play 3× longer sessions").
export type SettingsChanged = Envelope<'settings_changed', {
  setting: 'environment' | 'reduce_motion' | 'mute_sfx' | 'debug_overlay';
  value: string | boolean;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Discriminated union + batch wrapper
// ──────────────────────────────────────────────────────────────────────────

// Every event the client may emit. Aggregators exhaustive-match on `type`;
// adding a new variant requires only a new aggregator (or no change at all
// if existing aggregators ignore unknown types, which they should).
export type GameEvent =
  | SessionStart
  | SessionEnd
  | ToolFire
  | HitLanded
  | MoodTransition
  | StatusApplied
  | StatusExpired
  | ComboCompleted
  | CharacterSwitch
  | ToolEquip
  | CurrencyEarned
  | CurrencySpent
  | UnlockPurchased
  | SettingsChanged;

export type GameEventType = GameEvent['type'];

// ──────────────────────────────────────────────────────────────────────────
// Per-type schema_version registries
// ──────────────────────────────────────────────────────────────────────────
//
// EVENT_SCHEMA_VERSIONS is the version a CURRENT client emits for a given
// event type. Clients import this at emit time so a single bump here
// propagates to every emit site without per-call changes.
//
// EVENT_SCHEMA_MIN_ACCEPTED is the lowest version the worker still ingests
// per type. Default to 1; bump only on a hard deprecation.
//
// Worker accepts schema_version in [MIN_ACCEPTED, CURRENT + 1], the +1
// grace lets a canary client deploy ahead of the worker rollout without
// losing events. Aggregators that don't recognize a version log + skip.
//
// Adding a new EventType = registry entry here, no version bump.
// Bumping a version = update EVENT_SCHEMA_VERSIONS + add a discriminated
// branch in the aggregator that reads the field. See decision log §events.

export const EVENT_SCHEMA_VERSIONS: Record<GameEventType, number> = {
  session_start: 1,
  session_end: 1,
  tool_fire: 1,
  hit_landed: 1,
  mood_transition: 1,
  status_applied: 1,
  status_expired: 1,
  combo_completed: 1,
  character_switch: 1,
  tool_equip: 1,
  currency_earned: 1,
  currency_spent: 1,
  unlock_purchased: 1,
  settings_changed: 1,
};

export const EVENT_SCHEMA_MIN_ACCEPTED: Record<GameEventType, number> = {
  session_start: 1,
  session_end: 1,
  tool_fire: 1,
  hit_landed: 1,
  mood_transition: 1,
  status_applied: 1,
  status_expired: 1,
  combo_completed: 1,
  character_switch: 1,
  tool_equip: 1,
  currency_earned: 1,
  currency_spent: 1,
  unlock_purchased: 1,
  settings_changed: 1,
};

// Server-side decorated form. Worker stamps these on ingest. user_id is
// re-derived from the bearer and OVERWRITES whatever the client supplied
// (clients can't spoof). server_ts is the authoritative ordering clock for
// cross-session / cross-user analytics.
export type StoredGameEvent = GameEvent & {
  server_ts: number;
  ingest_shard: string;        // ActionShardDO id, for resharding migrations
};

// Wire shape for POST /events/batch. The worker validates:
//   - events.length <= BATCH_MAX_EVENTS
//   - every event JSON-encodes to <= EVENT_MAX_BYTES
//   - every event_id is a valid ULID
//   - schema_version is recognized for the type
//   - protocol_version matches EVENT_PROTOCOL_VERSION
// On any failure, returns 400 with the index of the first bad event so the
// client can quarantine it without losing the batch.
export type EventBatchRequest = {
  protocol_version: typeof EVENT_PROTOCOL_VERSION;
  events: GameEvent[];
};

export type EventBatchResponse = {
  accepted: number;
  // Indices of events that were dropped (over-size, schema mismatch, etc.).
  // Client should NOT retry these, the worker has logged them.
  dropped?: number[];
};

// ──────────────────────────────────────────────────────────────────────────
// Stats response shapes
// ──────────────────────────────────────────────────────────────────────────
//
// These are the read-side contracts both the TUI (Ink) and web stats panel
// render from. The schemas live here so adding a field is a single-package
// change. Aggregators populate the underlying tables; the worker assembles
// these shapes on read.

// Granularity for time-bucketed series. The aggregator pre-rolls hour and
// day buckets; finer grains are not retained beyond the hot-event window.
// 'all' is the lifetime aggregate, totals/per-model/per-verb/heatmap are
// derived from cumulative counter tables, NOT the events log; timeseries
// is empty (the events log only retains EVENTS_HOT_RETENTION_MS, so daily
// resolution past that is unavailable until R2 archive ships).
export type StatsGranularity = 'hour' | 'day' | 'all';

// GET /me/stats. All counts are within the requested time window.
export type MeStatsResponse = {
  user_id: string;
  window: { since: string; until: string; granularity: StatsGranularity };
  totals: {
    sessions: number;
    fires: number;
    hits: number;
    help_mood: number;         // sum of positive mood_delta
    hurt_mood: number;         // sum of |negative mood_delta|
    play_ms: number;
  };
  per_model: Record<ModelId, {
    fires: number;
    hits: number;
    help_mood: number;
    hurt_mood: number;
    favorite_verb: VerbId | null;
    state_firsts: MoodState[]; // first-time states seen for this character
  }>;
  per_verb: Record<VerbId, {
    fires: number;
    hits: number;
    mood_delta_sum: number;
    per_model: Record<ModelId, number>;  // hit count per model
  }>;
  // For sparklines + scrubber. One entry per bucket within the window.
  timeseries: Array<{
    bucket_start: number;      // epoch ms of bucket boundary
    fires: number;
    hits: number;
    help_mood: number;
    hurt_mood: number;
  }>;
  records: {
    longest_combo: number;
    biggest_session_hurt: number;
    biggest_session_help: number;
    longest_session_ms: number;
  };
  // Optional, web-only. TUI ignores. Hit count per body part per character.
  hit_heatmap?: Array<{
    character: ModelId;
    part: PartType;
    count: number;
  }>;
  // Optional, web-only. Recent combos suitable for canvas replay.
  combo_log?: Array<{
    ts: number;
    character: ModelId;
    verbs: VerbId[];
    duration_ms: number;
    total_mood_delta: number;
  }>;

  // Per-verb fires/hits per bucket. Drives small-multiples + verb-row
  // sparklines without the client having to estimate from totals × share.
  // Sparse: one row per (bucket_start, verb) that recorded activity.
  per_verb_timeseries?: Array<{
    bucket_start: number;
    verb: VerbId;
    fires: number;
    hits: number;
    mood_delta: number;
  }>;
  // Per-model fires/hits/help/hurt per bucket. Drives the persona overlay
  // on the Pulse chart and per-row sparklines on the persona ladder.
  per_model_timeseries?: Array<{
    bucket_start: number;
    model: ModelId;
    fires: number;
    hits: number;
    help_mood: number;
    hurt_mood: number;
  }>;
  // 7×24 hour-of-week heatmap. Cells with zero activity are omitted.
  // dow: 0=Sun..6=Sat (UTC); hour: 0..23 (UTC). Client may project to
  // local time using its own clock.
  time_of_day_heatmap?: Array<{
    dow: number;
    hour: number;
    fires: number;
    hits: number;
  }>;
  // Per-calendar-day totals for the GitHub-style streak heatmap. `date`
  // is YYYY-MM-DD in UTC. Sparse, quiet days are absent.
  daily_calendar?: Array<{
    date: string;
    fires: number;
    hits: number;
    sessions: number;
    play_ms: number;
  }>;
  // One row per session in the window. Drives the session distribution
  // beeswarm and the session-detail modal. ended_at is null for an
  // in-flight session that started before window-end with no session_end
  // observed yet.
  session_summaries?: Array<{
    session_id: string;
    started_at: number;
    ended_at: number | null;
    duration_ms: number;
    character: ModelId | null;
    fires: number;
    hits: number;
    help_mood: number;
    hurt_mood: number;
    peak_mood: number;
    trough_mood: number;
    end_state: MoodState | null;
    longest_combo: number;
  }>;
};

// GET /leaderboard. Aggregated across all users. Per backend-plan §3.4
// this NEVER includes per-user fields.
export type LeaderboardResponse = {
  window: { since: string; until: string; granularity: StatsGranularity };
  per_model: Record<ModelId, {
    help_count: number;        // hits with mood_delta > 0
    hurt_count: number;        // hits with mood_delta < 0
    sessions: number;
    unique_users: number;      // approximate, HLL-derived
  }>;
  per_verb_meta: Record<VerbId, {
    fires: number;
    most_used_against: ModelId | null;
  }>;
  timeseries: Array<{
    bucket_start: number;
    per_model: Record<ModelId, { help: number; hurt: number }>;
  }>;
};
