// Cross-package chat protocol constants. These are the wire shape of the
// global chat system; changing one without changing the others breaks the
// round-trip. Every value here is consumed by ≥2 packages.

// WebSocket protocol major-version. Worker enforces a major-version match;
// clients append `?v=${PROTOCOL_VERSION}` to the upgrade URL. Bump when the
// wire shape changes incompatibly. The worker also reads env.PROTOCOL_VERSION
// as an override but defaults to this constant.
export const PROTOCOL_VERSION = '1';

// Message length cap. Enforced server-side (room.ts validates and rejects
// over-length sends with a `system` event). Clients also enforce so the user
// gets feedback before the round-trip.
export const CHAT_MAX_MESSAGE_LENGTH = 280;

// Server-side history ring buffer size. Sent in the `history` event on every
// (re)connect.
export const CHAT_MAX_HISTORY = 50;

// Reconnect backoff for clients. 1s → 2s → 4s → 8s → 15s → 15s …
// Worker side has no opinion on these; they're purely client cadence.
export const RECONNECT_BASE_MS = 1_000;
export const MAX_RECONNECT_DELAY_MS = 15_000;

// Single global room id. Retained for dev/legacy paths · still resolvable
// so existing DO storage isn't orphaned (idle DOs cost nothing).
/**
 * @deprecated · use chatRoomNameFor(user_id) from
 * packages/worker/src/util/shard.ts instead. Connections now shard across
 * CHAT_ROOM_SHARD_IDS by user_id hash; this string is kept for backwards
 * compatibility and to leave pre-shard DO storage addressable.
 */
export const GLOBAL_ROOM_ID = 'room-global';

// Chat room sharding · connections fan out across CHAT_ROOM_SHARD_COUNT
// RoomDO instances keyed by hash(user_id). Reuses the same N=16 bucket
// scheme as ActionShardDO (`ACTION_SHARD_COUNT`) so the same
// `shardIdFor(userId)` helper picks the bucket. No LobbyDO indirection ·
// chatRoomNameFor() runs in-process on the WS upgrade hot path.
export const CHAT_ROOM_SHARD_COUNT = 16;
export const CHAT_ROOM_SHARD_IDS: readonly string[] = Array.from(
  { length: CHAT_ROOM_SHARD_COUNT },
  (_, i) => `room-shard-${i.toString(16)}`,
);

// Wire shape for a broadcast chat message. `msg_id` is required: the worker
// stamps every emit (room.ts:263 shadow echo, room.ts:292 broadcast) so
// downstream `redact` events can reference it. Worker maintains its own
// duplicate `ChatMessage` in worker/src/types.ts; the two must stay in sync
// (the worker's copy is the producer of record, this one is the consumer
// contract).
export type ChatMessage = {
  type: 'message';
  msg_id: string;
  handle: string;
  color: string;
  content: string;
  timestamp: string;
};

// Structured codes for `system` lifecycle notices. The plain `content`
// field stays human-readable; clients branch on `code` for programmatic
// behavior (e.g. clear-and-reauth on session_revoked). Adding a new code
// is backward-compatible: old clients see only `content` and treat the
// event as a generic notice.
export type SystemEventCode =
  | 'session_revoked'
  | 'rate_limited'
  | 'slow_mode_active'
  | 'slow_mode_lifted'
  | 'malformed_input'
  | 'oversize_message';

// Discriminated union of every event the worker may send over `ws.send`.
// Source of truth: packages/worker/src/room.ts. Each variant is paired with
// the room.ts emit site so a future divergence is auditable.
//   - history       room.ts:117  (sendTo on connect)
//   - join          room.ts:123  (broadcast on connect)
//   - leave         room.ts:183  (broadcast on close)
//   - message       room.ts:269  (sendTo, shadow echo) and room.ts:303
//                   (broadcast, normal flow), both ChatMessage shape
//   - system        room.ts:146,205,213,229,528 (various sendTo notices)
//   - blocked       room.ts:276  (sendTo on moderation block)
//   - redact        room.ts:501  (broadcast during scrub)
//   - slow_mode     room.ts:346,364 (broadcast on trip / untrip)
//   - ping          declared in room.ts:49 ServerEvent but the worker does
//                   not currently emit one. Kept here so a future heartbeat
//                   path doesn't require a shared-package version bump.
//   - welcome       NEW. Sent by the worker as a reply to a client `hello`
//                   first frame. During the rollout grace period the worker
//                   only emits `welcome` when the client opened with
//                   `hello`; legacy clients (no hello) get no welcome and
//                   continue under the existing protocol. After both web
//                   and TUI ship hello unconditionally, a future PR will
//                   flip the worker into strict mode (close on missing
//                   hello after HELLO_TIMEOUT_MS).
export type ServerEvent =
  | { type: 'history'; messages: ChatMessage[]; roomCount: number }
  | ChatMessage
  | { type: 'join'; handle: string; color: string; roomCount: number }
  | { type: 'leave'; handle: string; roomCount: number }
  | { type: 'system'; content: string; code?: SystemEventCode }
  | { type: 'blocked'; msg_id: string; reason_code: string; appeal_token?: string }
  | { type: 'redact'; msg_id: string }
  | { type: 'slow_mode'; until: number; interval_ms: number }
  | { type: 'ping'; t: number }
  | {
      type: 'welcome';
      server_version: string;
      accepted: boolean;
      reason?: 'unsupported_client' | 'protocol_mismatch';
      upgrade_hint?: string;
    };

// Identifies the surface speaking the protocol. Reserved values today;
// extend here (and the type below) before adding a new client kind.
export type ClientKind = 'web' | 'tui';

// Outgoing client->server messages. `pong` is type-declared because the
// worker already accepts and silently drops it (room.ts:159-169), keeping
// it here future-proofs the client for a heartbeat path the worker hasn't
// started emitting yet.
//
// `hello` is the first frame both surfaces send on `ws.open`. During the
// rollout grace period the worker treats absence of hello as legacy mode
// (no welcome echoed); during strict mode (future flip) the worker will
// close the socket on missing-hello after HELLO_TIMEOUT_MS. Clients gate
// `connected` UX status on receipt of `welcome` if they sent `hello`.
export type ClientEvent =
  | { type: 'message'; content: string }
  | { type: 'pong'; t: number }
  | {
      type: 'hello';
      protocol_version: string;
      client_kind: ClientKind;
      client_version: string;
    };

// Timeout for awaiting `welcome` after sending `hello`. Past this, the
// client treats the socket as connected anyway (legacy worker compat). The
// strict-mode worker flip will mirror this on the server side.
export const HELLO_TIMEOUT_MS = 5_000;
