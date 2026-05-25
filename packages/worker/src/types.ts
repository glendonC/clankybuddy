export type Env = {
  ROOM: DurableObjectNamespace<import('./room.js').RoomDO>;
  DATABASE: DurableObjectNamespace<import('./database.js').DatabaseDO>;
  ACTION_SHARD: DurableObjectNamespace<
    import('./dos/action_shard.js').ActionShardDO
  >;
  LEADERBOARD: DurableObjectNamespace<
    import('./dos/leaderboard.js').LeaderboardDO
  >;
  AUTH_KV: KVNamespace;
  AI: Ai;
  ENVIRONMENT: string;
  PROTOCOL_VERSION: string;
  MODERATION_MODE: string;
  MODERATION_DAILY_BUDGET_USD: string;
  MODERATION_USER_DAILY_CALLS: string;
  // Turnstile siteverify secret. Sensitive, set via `wrangler secret put
  // TURNSTILE_SECRET`. Optional in alpha; verifyTurnstile fails-closed when
  // missing rather than silently allowing.
  TURNSTILE_SECRET?: string;
  // Hostname used to construct the verify URL handed back to clients that
  // hit the captcha gate. Public, set via [vars].
  TURNSTILE_HOSTNAME?: string;
  // Workers Analytics Engine dataset for structured telemetry. Optional,
  // alpha environments may not provision it; observability.logEvent
  // gracefully degrades when the binding is absent.
  ANALYTICS?: AnalyticsEngineDataset;
  // Shared secret that lets ops/CI bypass the EU/UK geofence via the
  // X-Clanky-Geofence-Bypass header. Sensitive, set via
  // `wrangler secret put GEOFENCE_BYPASS_SECRET`.
  GEOFENCE_BYPASS_SECRET?: string;
  // Public Turnstile sitekey embedded in /verify HTML. Public (not a secret),
  // but kept env-driven so dev/prod can use different widget configs. Pairs
  // with TURNSTILE_SECRET (the matching siteverify secret).
  TURNSTILE_SITEKEY?: string;
  // Bearer token for /admin/* routes. Sensitive, set via
  // `wrangler secret put ADMIN_TOKEN`. Production module-load asserts that
  // this is present; dev/alpha may run without it. The /admin/preserve
  // route fails-closed (503) when unset rather than defaulting to no auth.
  ADMIN_TOKEN?: string;
};

export type User = {
  id: string;
  handle: string;
  color: string;
  created_at: number;
};

export type ChatMessage = {
  type: 'message';
  msg_id: string;
  handle: string;
  color: string;
  content: string;
  timestamp: string;
};

// Server-internal augmentation of ChatMessage. Persisted in the in-memory
// history ring AND DO-storage-backed history rows so that scrubByUserId can
// filter by user_id directly (closing the GDPR gap where a user disconnects
// before the erase cron runs and scrubByUserId could no longer recover the
// handle from the live tag set). user_id is server-side only, stripped on
// emit so the wire shape (`ChatMessage`) is unchanged.
export type StoredChatMessage = ChatMessage & { user_id: string };

// Persisted with the WebSocket via Hibernation tag. Must round-trip through
// JSON without loss, keep flat and primitive-only.
//
// helloSeen tracks whether this socket has either sent a `hello` first frame
// or any other (legacy-mode) frame. Default is false; the first frame the
// session receives in webSocketMessage flips it. Older sessions tagged
// before this field existed parse with helloSeen undefined → treated as
// false. Strict-mode enforcement (close on missing hello after timeout) is
// a future PR; this field exists now so the rollout has a state field to
// flip without another tag-shape migration.
export type SessionTag = {
  userId: string;
  handle: string;
  color: string;
  joinedAt: number;
  helloSeen?: boolean;
};
