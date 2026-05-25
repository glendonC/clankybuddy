import { DurableObject } from 'cloudflare:workers';
import {
  BLOOM_REFRESH_INTERVAL_MS,
  CHAT_MAX_HISTORY,
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_MAX_PER_MINUTE,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from './constants.js';
import {
  bloomMightContain,
  buildBloom,
  emptyBloom,
  type RevocationBloom,
} from './auth/bloom.js';
import { getDb } from './auth.js';
import { checkContent } from './moderation/index.js';
import { bandOf, type RepEntry } from './moderation/reputation.js';
import { logEvent } from './observability.js';
import type { SystemEventCode } from '../../shared/src/chat.js';
import type { ChatMessage, Env, SessionTag, StoredChatMessage } from './types.js';

type ChatRateLimitEntry = { windowStart: number; count: number };

const HISTORY_KEY = 'history:v1';
const RATE_LIMIT_KEY_PREFIX = 'rl:';
const SLOW_MODE_UNTIL_KEY = 'slowmode:until';
const SLOW_MODE_TIMESTAMPS_KEY = 'slowmode:flagged';

// Slow-mode tuning per backend-plan.md §7e (Challenger §2.3): per-cohort, not
// global. Trip when the room logs ≥ TRIP_THRESHOLD flagged messages in the
// trailing 60s; auto-untrip after UNTRIP_AFTER_MS elapses *and* the trailing
// 60s carries fewer than UNTRIP_QUIET_FLAGS flagged messages.
//
// Lowered from 8 → 3 with the 2026-05-15 chat-room sharding flip. With 16
// shards a diffuse abuse wave sees ~1/16 of the per-shard traffic the
// original threshold was calibrated for, so the absolute volume needed to
// trip ANY shard would be ~16× the pre-shard baseline. Lowering to 3
// restores roughly the original sensitivity per shard; a future iteration
// may piggy-back a cross-shard signal on the kill-switch KV counter.
const SLOW_MODE_TRIP_THRESHOLD = 3;
const SLOW_MODE_UNTRIP_AFTER_MS = 5 * 60_000;
const SLOW_MODE_UNTRIP_QUIET_FLAGS = 2;
const SLOW_MODE_WINDOW_MS = 60_000;
const SLOW_MODE_INTERVAL_MS = 30_000;
const SLOW_MODE_NEW_USER_WINDOW_MS = 24 * 60 * 60_000;

type ClientMessage =
  | { type: 'message'; content: string }
  | { type: 'pong'; t: number }
  | {
      type: 'hello';
      protocol_version: string;
      client_kind: string;
      client_version: string;
    };

type ServerEvent =
  | { type: 'history'; messages: ChatMessage[]; roomCount: number }
  | ChatMessage
  | { type: 'join'; handle: string; color: string; roomCount: number }
  | { type: 'leave'; handle: string; roomCount: number }
  | { type: 'system'; content: string; code?: SystemEventCode }
  | { type: 'ping'; t: number }
  | { type: 'blocked'; msg_id: string; reason_code: string; appeal_token?: string }
  | { type: 'redact'; msg_id: string }
  | { type: 'slow_mode'; until: number; interval_ms: number }
  | {
      type: 'welcome';
      server_version: string;
      accepted: boolean;
      reason?: 'unsupported_client' | 'protocol_mismatch';
      upgrade_hint?: string;
    };

// Code 4426 mirrors HTTP 426 Upgrade Required and is in the application
// close-code range (4000-4999, freely usable). The web/TUI clients close
// the socket and surface an "outdated client" UX on receipt.
const PROTOCOL_MISMATCH_CLOSE_CODE = 4426;

export class RoomDO extends DurableObject<Env> {
  // Storage shape carries user_id server-side. The wire shape is ChatMessage
  // (no user_id), see stripUserId below. Legacy rows (pre-this-migration)
  // parse with user_id missing; loadHistory normalizes them by attaching
  // an empty string. The empty-string sentinel never matches a real user_id
  // (we always assign u_<uuid>), so legacy rows are simply un-scrubbable by
  // direct id match, they fall through to the handle-based path that
  // existed before. New rows written after deploy carry the user_id.
  private history: StoredChatMessage[] = [];
  // Reputation hot cache populated on WS connect; survives until hibernation
  // drops the isolate, after which the next webSocketMessage repopulates from
  // DatabaseDO.
  private repCache = new Map<string, RepEntry>();
  // Slow-mode in-memory mirror of the persisted timestamps. Persisted to DO
  // storage on every change so a hibernate cycle doesn't reset the trip
  // counter mid-burst.
  private flaggedTimestamps: number[] = [];
  private slowModeUntil = 0;
  // Per-user last-send timestamp for slow-mode interval enforcement. NOT
  // persisted: at worst a returning user gets one free message after a
  // hibernate. Acceptable.
  private lastSendByUser = new Map<string, number>();
  // Revocation bloom (≤60s propagation per backend-plan TUI threat model).
  // Refreshed lazily on every webSocketMessage when the cached generation is
  // older than BLOOM_REFRESH_INTERVAL_MS. False-positive hits cross-check
  // DatabaseDO before disconnecting.
  private revocationBloom: RevocationBloom = emptyBloom();
  private bloomLastRefreshedAt = 0;
  private bloomRefreshInFlight: Promise<void> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.blockConcurrencyWhile(async () => {
      const raw =
        (await state.storage.get<(ChatMessage | StoredChatMessage)[]>(HISTORY_KEY)) ?? [];
      // Normalize: legacy rows (pre user_id stamp) inflate to user_id=''
      // so the in-memory ring is uniformly StoredChatMessage. The empty
      // string can't match a real id (`u_<uuid>` shape), so legacy rows
      // are just un-scrubbable by id, exactly the previous behavior.
      this.history = raw.map((m) => {
        const stored = m as StoredChatMessage;
        return typeof stored.user_id === 'string'
          ? stored
          : { ...m, user_id: '' };
      });
      this.flaggedTimestamps = (await state.storage.get<number[]>(SLOW_MODE_TIMESTAMPS_KEY)) ?? [];
      this.slowModeUntil = (await state.storage.get<number>(SLOW_MODE_UNTIL_KEY)) ?? 0;
    });
  }

  // Drop the server-only user_id field before any wire emit. Centralized so
  // a future ChatMessage-shape change can't accidentally leak through one
  // emit site.
  private stripUserId(m: StoredChatMessage): ChatMessage {
    const { user_id: _omit, ...wire } = m;
    return wire;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/connect') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const userId = url.searchParams.get('user_id');
    const handle = url.searchParams.get('handle');
    const color = url.searchParams.get('color');
    if (!userId || !handle || !color) {
      return new Response('missing user data', { status: 400 });
    }

    const session: SessionTag = {
      userId,
      handle,
      color,
      joinedAt: Date.now(),
      // Hello/welcome handshake is rolling out gracefully: the worker
      // accepts but does not require a `hello` first frame. helloSeen flips
      // to true on the first message of either kind. Strict mode (close on
      // missing hello after timeout) is a future PR after both clients
      // ship hello unconditionally.
      helloSeen: false,
    };

    // Warm the rep cache before accepting the socket so the first message
    // doesn't pay a DatabaseDO round-trip on the hot path.
    try {
      const rep = await getDb(this.env).getReputation(userId);
      this.repCache.set(userId, rep);
    } catch {
      // Cache miss is recoverable, first message will refetch.
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server, [JSON.stringify(session)]);

    this.sendTo(server, {
      type: 'history',
      messages: this.history.map((m) => this.stripUserId(m)),
      roomCount: this.roomCount(),
    });

    this.broadcast(
      { type: 'join', handle, color, roomCount: this.roomCount() },
      server,
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const session = this.sessionFor(ws);
    if (!session) {
      try { ws.close(1008, 'no session'); } catch { /* already closed */ }
      return;
    }

    // Revocation enforcement: every WS message checks the bloom filter. A
    // hit triggers a DatabaseDO cross-check (false-positive defense) and, if
    // confirmed, force-disconnects with a system note. The bloom is the fast
    // path; the DB check is the truth.
    await this.maybeRefreshBloom();
    if (bloomMightContain(this.revocationBloom, session.userId)) {
      const revoked = await this.confirmRevocation(session.userId);
      if (revoked) {
        this.sendTo(ws, {
          type: 'system',
          content: 'session revoked',
          code: 'session_revoked',
        });
        try { ws.close(4401, 'session revoked'); } catch { /* already closed */ }
        return;
      }
    }

    let parsed: ClientMessage | null = null;
    try {
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      const obj = JSON.parse(text) as { type?: unknown };
      if (obj && typeof obj === 'object') {
        if (obj.type === 'message' && typeof (obj as { content?: unknown }).content === 'string') {
          parsed = { type: 'message', content: (obj as { content: string }).content };
        } else if (obj.type === 'pong' && typeof (obj as { t?: unknown }).t === 'number') {
          parsed = { type: 'pong', t: (obj as { t: number }).t };
        } else if (obj.type === 'hello') {
          const o = obj as Record<string, unknown>;
          if (
            typeof o.protocol_version === 'string' &&
            typeof o.client_kind === 'string' &&
            typeof o.client_version === 'string'
          ) {
            parsed = {
              type: 'hello',
              protocol_version: o.protocol_version,
              client_kind: o.client_kind,
              client_version: o.client_version,
            };
          }
        }
      }
    } catch {
      return;
    }
    if (!parsed) return;

    // Hello handshake. Recognize the hello frame, validate protocol_version,
    // reply with a welcome (accepted/rejected), and either continue the
    // session normally or close with code 4426 on protocol mismatch. We do
    // NOT enforce hello presence (graceful rollout), non-hello first
    // frames flip helloSeen via the legacy branch below.
    if (parsed.type === 'hello') {
      const required = this.env.PROTOCOL_VERSION || '1';
      const accepted = parsed.protocol_version.split('.')[0] === required.split('.')[0];
      const serverVersion = required;
      if (accepted) {
        this.sendTo(ws, {
          type: 'welcome',
          server_version: serverVersion,
          accepted: true,
        });
        if (!session.helloSeen) this.markHelloSeen(ws);
      } else {
        this.sendTo(ws, {
          type: 'welcome',
          server_version: serverVersion,
          accepted: false,
          reason: 'protocol_mismatch',
          upgrade_hint: `Reconnect with protocol_version="${required}" or upgrade your client.`,
        });
        try {
          ws.close(PROTOCOL_MISMATCH_CLOSE_CODE, 'protocol mismatch');
        } catch {
          /* already closed */
        }
      }
      return;
    }

    // First non-hello frame counts as legacy-mode acknowledgment.
    if (!session.helloSeen) this.markHelloSeen(ws);

    if (parsed.type === 'pong') {
      return;
    }

    await this.handleMessage(ws, session, parsed.content);
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const session = this.sessionFor(ws);
    if (session) {
      this.broadcast(
        {
          type: 'leave',
          handle: session.handle,
          roomCount: this.roomCount(),
        },
        ws,
      );
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    return this.webSocketClose(ws, 1011, 'error', false);
  }

  private async handleMessage(
    ws: WebSocket,
    session: SessionTag,
    content: string,
  ): Promise<void> {
    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > CHAT_MAX_MESSAGE_LENGTH) {
      this.sendTo(ws, {
        type: 'system',
        content: `Message must be 1-${CHAT_MAX_MESSAGE_LENGTH} characters.`,
        code: 'oversize_message',
      });
      return;
    }

    if (!(await this.checkRateLimit(session.userId))) {
      this.sendTo(ws, {
        type: 'system',
        content: `Slow down - max ${CHAT_MAX_PER_MINUTE} messages per minute.`,
        code: 'rate_limited',
      });
      return;
    }

    const rep = await this.loadRep(session.userId);
    const now = Date.now();

    // Per-user slow-mode interval applies only to the cohort that tripped it
    // (suspect/gated by score, OR account < 24h old). Trusted/default users
    // bypass slow-mode entirely, the global broadcast is what they see.
    if (this.slowModeUntil > now && this.userInSlowModeCohort(rep, now)) {
      const last = this.lastSendByUser.get(session.userId) ?? 0;
      if (now - last < SLOW_MODE_INTERVAL_MS) {
        this.sendTo(ws, {
          type: 'system',
          content: 'slow-mode active',
          code: 'slow_mode_active',
        });
        return;
      }
    }

    const decision = await checkContent(
      trimmed,
      session.userId,
      rep,
      this.env,
      // RoomDO doesn't receive an ExecutionContext on webSocketMessage; use the
      // DurableObjectState which exposes waitUntil semantically equivalent for
      // background work scoped to this DO invocation.
      this.adapterCtx(),
    );

    // High-cardinality event, observability.logEvent samples to 1% for us.
    // Aggregate decision dimensions only (no message content).
    logEvent(this.env, {
      event_type: 'msg_processed',
      user_id: session.userId,
      rep_band: bandOf(rep.score, rep.shadow_until, now),
      block_reason: decision.blockReason,
      decision: decision.shadow
        ? 'shadow'
        : decision.allowed
          ? 'allowed'
          : 'blocked',
    });

    if (decision.shadow) {
      // Echo to sender ONLY. Never adds to history; never broadcasts.
      const message: ChatMessage = {
        type: 'message',
        msg_id: decision.msg_id,
        handle: session.handle,
        color: session.color,
        content: decision.normalized.display,
        timestamp: new Date().toISOString(),
      };
      // Shadow echoes don't go to history, so no user_id stamp needed,
      // we send the wire shape directly.
      this.sendTo(ws, message);
      // Shadow doesn't count as a flagged message for slow-mode trip, the
      // user is silently contained, no public signal to suppress.
      return;
    }

    if (!decision.allowed) {
      this.sendTo(ws, {
        type: 'blocked',
        msg_id: decision.msg_id,
        reason_code: decision.blockReason ?? 'unknown',
        ...(decision.appealToken ? { appeal_token: decision.appealToken } : {}),
      });
      await this.recordFlaggedAndMaybeTripSlowMode(now);
      await this.persistRepDelta(session.userId, decision.repDelta, {
        flagged: decision.flagged,
        passed: decision.passed,
      });
      return;
    }

    const stored: StoredChatMessage = {
      type: 'message',
      msg_id: decision.msg_id,
      handle: session.handle,
      color: session.color,
      content: decision.normalized.display,
      timestamp: new Date().toISOString(),
      // Server-side only; stripped on emit. Lets scrubByUserId filter
      // history rows directly even when the user has disconnected before
      // the erase cron runs.
      user_id: session.userId,
    };

    this.history.push(stored);
    if (this.history.length > CHAT_MAX_HISTORY) this.history.shift();
    await this.ctx.storage.put(HISTORY_KEY, this.history);

    this.broadcast(this.stripUserId(stored));

    // Successful broadcast updates lastSendByUser even for users not currently
    // in the slow-mode cohort, so a band drop mid-session doesn't gift them a
    // free immediate message.
    this.lastSendByUser.set(session.userId, now);
    await this.persistRepDelta(session.userId, decision.repDelta, {
      flagged: decision.flagged,
      passed: decision.passed,
    });

    await this.maybeUntripSlowMode(now);
  }

  private adapterCtx(): ExecutionContext {
    // The DurableObjectState exposes waitUntil; ExecutionContext-shaped wrapper
    // lets shared code (moderation orchestrator, tier2 cache writeback) work
    // uniformly inside both Worker fetch handlers and DO methods.
    const state = this.ctx;
    return {
      waitUntil: (p: Promise<unknown>) => state.waitUntil(p),
      passThroughOnException: () => { /* DOs don't pass through */ },
      props: {},
    } as unknown as ExecutionContext;
  }

  private userInSlowModeCohort(rep: RepEntry, now: number): boolean {
    const band = bandOf(rep.score, rep.shadow_until, now);
    if (band === 'suspect' || band === 'gated') return true;
    if (now - rep.created_at < SLOW_MODE_NEW_USER_WINDOW_MS) return true;
    return false;
  }

  private async recordFlaggedAndMaybeTripSlowMode(now: number): Promise<void> {
    const cutoff = now - SLOW_MODE_WINDOW_MS;
    this.flaggedTimestamps = this.flaggedTimestamps.filter((t) => t > cutoff);
    this.flaggedTimestamps.push(now);
    await this.ctx.storage.put(SLOW_MODE_TIMESTAMPS_KEY, this.flaggedTimestamps);

    if (this.slowModeUntil > now) return; // already tripped
    if (this.flaggedTimestamps.length >= SLOW_MODE_TRIP_THRESHOLD) {
      this.slowModeUntil = now + SLOW_MODE_UNTRIP_AFTER_MS;
      await this.ctx.storage.put(SLOW_MODE_UNTIL_KEY, this.slowModeUntil);
      this.broadcast({
        type: 'slow_mode',
        until: this.slowModeUntil,
        interval_ms: SLOW_MODE_INTERVAL_MS,
      });
    }
  }

  private async maybeUntripSlowMode(now: number): Promise<void> {
    if (this.slowModeUntil === 0) return;
    if (now < this.slowModeUntil) return;
    const cutoff = now - SLOW_MODE_WINDOW_MS;
    const recentFlags = this.flaggedTimestamps.filter((t) => t > cutoff);
    if (recentFlags.length < SLOW_MODE_UNTRIP_QUIET_FLAGS) {
      this.slowModeUntil = 0;
      this.flaggedTimestamps = recentFlags;
      await this.ctx.storage.put(SLOW_MODE_UNTIL_KEY, this.slowModeUntil);
      await this.ctx.storage.put(SLOW_MODE_TIMESTAMPS_KEY, this.flaggedTimestamps);
      this.broadcast({ type: 'slow_mode', until: 0, interval_ms: SLOW_MODE_INTERVAL_MS });
    }
  }

  private async loadRep(userId: string): Promise<RepEntry> {
    const cached = this.repCache.get(userId);
    if (cached) return cached;
    const fresh = await getDb(this.env).getReputation(userId);
    this.repCache.set(userId, fresh);
    return fresh;
  }

  private async persistRepDelta(
    userId: string,
    delta: number,
    opts: { flagged: boolean; passed: boolean },
  ): Promise<void> {
    if (delta === 0 && !opts.flagged && !opts.passed) return;
    const updated = await getDb(this.env).adjustReputation(userId, delta, opts);
    this.repCache.set(userId, updated);
  }

  private roomCount(): number {
    return this.ctx.getWebSockets().length;
  }

  private sessionFor(ws: WebSocket): SessionTag | null {
    const tags = this.ctx.getTags(ws);
    const raw = tags[0];
    if (!raw) return null;
    let session: SessionTag;
    try {
      // Tag JSON is the immutable identity (userId/handle/color/joinedAt).
      // Sessions tagged before the helloSeen field existed parse with the
      // field undefined; default it to false so the legacy-mode path
      // matches a brand-new session that hasn't seen any frames yet.
      session = JSON.parse(raw) as SessionTag;
    } catch {
      return null;
    }
    if (session.helloSeen === undefined) session.helloSeen = false;
    // Hello state lives in the WS attachment because it changes after
    // acceptWebSocket. Tags are write-once at accept time; serializeAttachment
    // is the hibernation-safe mutable layer. A missing/corrupt attachment
    // falls back to the tag's value.
    try {
      const attached = ws.deserializeAttachment() as { helloSeen?: boolean } | null;
      if (attached && typeof attached.helloSeen === 'boolean') {
        session.helloSeen = attached.helloSeen;
      }
    } catch {
      /* attachment parse fail, keep the tag default */
    }
    return session;
  }

  // Persist the mutable helloSeen flag via serializeAttachment so it
  // survives isolate hibernation. Cheap call; the flag is one bool.
  private markHelloSeen(ws: WebSocket): void {
    try {
      ws.serializeAttachment({ helloSeen: true });
    } catch {
      // Attachment write-failure is non-fatal: we'd just reprocess the
      // hello on a future frame. Strict mode (future PR) is the only
      // path that would care, and by then we'd have observability on it.
    }
  }

  private sendTo(ws: WebSocket, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // Dead socket; close handler will fire shortly.
    }
  }

  private broadcast(event: ServerEvent, exclude?: WebSocket): void {
    const data = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(data);
      } catch {
        // Dead socket; close handler does cleanup.
      }
    }
  }

  private async checkRateLimit(userId: string): Promise<boolean> {
    const key = `${RATE_LIMIT_KEY_PREFIX}${userId}`;
    const now = Date.now();
    const entry = (await this.ctx.storage.get<ChatRateLimitEntry>(key)) ?? null;

    let next: ChatRateLimitEntry;
    if (!entry || now - entry.windowStart > CHAT_RATE_LIMIT_WINDOW_MS) {
      next = { windowStart: now, count: 1 };
    } else {
      next = { windowStart: entry.windowStart, count: entry.count + 1 };
    }

    await this.ctx.storage.put(key, next);
    return next.count <= CHAT_MAX_PER_MINUTE;
  }

  // ---- Revocation bloom ----

  private async maybeRefreshBloom(): Promise<void> {
    const now = Date.now();
    if (now - this.bloomLastRefreshedAt < BLOOM_REFRESH_INTERVAL_MS) return;
    if (this.bloomRefreshInFlight) return this.bloomRefreshInFlight;
    this.bloomRefreshInFlight = (async () => {
      try {
        const ids = await getDb(this.env).listRevokedUserIds();
        this.revocationBloom = buildBloom(ids);
        this.bloomLastRefreshedAt = Date.now();
      } catch {
        // Refresh failure: keep the stale bloom; the DB cross-check on a
        // hit still gates disconnect, so a stale bloom can only over-check
        // (false positive), never under-check (false negative).
      } finally {
        this.bloomRefreshInFlight = null;
      }
    })();
    return this.bloomRefreshInFlight;
  }

  private async confirmRevocation(userId: string): Promise<boolean> {
    try {
      const ts = await getDb(this.env).getTokensRevokedAt(userId);
      return ts != null;
    } catch {
      // DB unreachable, fail-open on the cross-check (don't disconnect a
      // possibly-legitimate user because of an infra blip). The next message
      // will retry and the bloom is still set, so we'll re-check shortly.
      return false;
    }
  }

  // ---- Erase / scrub RPCs ----

  // Removes all messages authored by `user_id` from the in-memory ring AND
  // the DO-storage-persisted ring. Broadcasts a `redact` event for each so
  // connected clients can drop the message from their local view. Idempotent
  //, running twice is a no-op the second time.
  //
  // History rows now carry `user_id` server-side (StoredChatMessage), so
  // this filter works even when the user has already disconnected before
  // the erase cron runs, closing the prior GDPR gap where handleForUser
  // returned null after tombstone NULLed the handle. Legacy rows persisted
  // before the user_id-stamping rollout have user_id='' and won't match
  // any real id, so this method is a no-op for them (matches prior
  // behavior, no regression).
  async scrubByUserId(user_id: string): Promise<{ scrubbed: number }> {
    if (!user_id) return { scrubbed: 0 };

    const removed: StoredChatMessage[] = [];
    const kept: StoredChatMessage[] = [];
    for (const m of this.history) {
      if (m.user_id === user_id) {
        removed.push(m);
      } else {
        kept.push(m);
      }
    }
    if (removed.length === 0) return { scrubbed: 0 };

    this.history = kept;
    await this.ctx.storage.put(HISTORY_KEY, this.history);

    for (const m of removed) {
      this.broadcast({ type: 'redact', msg_id: m.msg_id });
    }
    return { scrubbed: removed.length };
  }

  // Resolve the user's handle. Connected sessions carry the handle in their
  // tag; if the user has already disconnected we fall through. Retained for
  // any non-scrub consumers (currently none); scrubByUserId no longer needs
  // it now that history rows carry user_id directly.
  private async handleForUser(user_id: string): Promise<string | null> {
    for (const ws of this.ctx.getWebSockets()) {
      const session = this.sessionFor(ws);
      if (session && session.userId === user_id) return session.handle;
    }
    return null;
  }

  async notifyAppealUpheld(user_id: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const session = this.sessionFor(ws);
      if (!session || session.userId !== user_id) continue;
      this.sendTo(ws, {
        type: 'system',
        content: 'Your appeal was upheld. Reputation has been adjusted.',
      });
    }
  }
}
