import WebSocket from 'ws';
import type {
  ClientEvent,
  ServerEvent,
  SystemEventCode,
} from '../../shared/src/chat.js';
import {
  CLI_VERSION,
  HELLO_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  PROTOCOL_VERSION,
  RECONNECT_BASE_MS,
  USER_AGENT,
} from './constants.js';

// 'outdated' added in Workstream C: emitted when the worker sends
// `welcome { accepted: false }` (server is on a wire version we don't
// speak). chat.tsx renders an explicit "client outdated" header, there's
// no point reconnecting since the next attempt would land on the same
// wall.
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'outdated';

// Rendered shape consumed by chat.tsx. `msg_id` is optional here so that
// non-message lines (info/event/system rendered as text) don't have to fake
// one; chat.tsx can dedupe on it when present.
export type ChatLine = {
  handle: string;
  color: string;
  content: string;
  timestamp: string;
  msg_id?: string;
};

export type ChatClientEvents = {
  onStatus: (status: ConnectionStatus) => void;
  onEvent: (event: ServerEvent) => void;
  onError: (err: Error) => void;
  // System-event-driven token revocation. Distinguishes "session_revoked"
  // from a generic system notice so chat.tsx can clear config + re-verify
  // without scraping the human-readable `content` field.
  onTokenRejected?: (code: SystemEventCode) => void;
};

export type ChatClient = {
  send: (content: string) => void;
  close: () => void;
  forceReconnect: () => void;
  hasConnectedOnce: () => boolean;
};

const KNOWN_SERVER_EVENT_TYPES = new Set<ServerEvent['type']>([
  'history',
  'message',
  'join',
  'leave',
  'system',
  'blocked',
  'redact',
  'slow_mode',
  'ping',
  'welcome',
]);

function parseServerEvent(raw: string): ServerEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const t = (parsed as { type?: unknown }).type;
  if (typeof t !== 'string') return null;
  if (!KNOWN_SERVER_EVENT_TYPES.has(t as ServerEvent['type'])) return null;
  // The shared discriminated union is the contract; deeper field validation
  // is the worker's job (it's the producer of record). We've gated on a known
  // discriminator, which is enough to keep a malformed frame from crashing
  // the consumer's switch.
  return parsed as ServerEvent;
}

export function createChatClient(
  apiBase: string,
  getTicket: () => Promise<string>,
  events: ChatClientEvents,
): ChatClient {
  let ws: WebSocket | null = null;
  let intentional = false;
  let suppressNextClose = false;
  let retryCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let helloTimer: ReturnType<typeof setTimeout> | null = null;
  let hasConnectedOnce = false;
  // Per-connection: have we promoted the socket to 'connected' UX yet?
  // Welcome-gating means 'open' alone isn't enough; we wait for either
  // welcome{accepted:true} or HELLO_TIMEOUT_MS.
  let promotedToConnected = false;

  const wsBase = apiBase.replace(/^http/, 'ws');

  function sendEnvelope(event: ClientEvent) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(event));
  }

  function clearHelloTimer() {
    if (helloTimer) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
  }

  function promote() {
    if (promotedToConnected) return;
    promotedToConnected = true;
    clearHelloTimer();
    retryCount = 0;
    hasConnectedOnce = true;
    events.onStatus('connected');
  }

  function normalizeError(err: unknown): Error {
    if (err instanceof Error) return err;
    if (typeof err === 'string') return new Error(err);
    try {
      return new Error(JSON.stringify(err));
    } catch {
      return new Error('unknown error');
    }
  }

  async function connect() {
    promotedToConnected = false;
    events.onStatus(retryCount === 0 ? 'connecting' : 'reconnecting');
    let ticket: string;
    try {
      ticket = await getTicket();
    } catch (err) {
      events.onError(normalizeError(err));
      scheduleReconnect();
      return;
    }

    try {
      const url = `${wsBase}/ws/chat?ticket=${encodeURIComponent(ticket)}&v=${PROTOCOL_VERSION}`;
      ws = new WebSocket(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
    } catch (err) {
      events.onError(normalizeError(err));
      scheduleReconnect();
      return;
    }

    ws.on('open', () => {
      // Send hello immediately on open. Workers running newer code reply
      // with `welcome`; legacy workers ignore it and we fall through the
      // HELLO_TIMEOUT_MS deadline.
      sendEnvelope({
        type: 'hello',
        protocol_version: PROTOCOL_VERSION,
        client_kind: 'tui',
        client_version: CLI_VERSION,
      });
      clearHelloTimer();
      helloTimer = setTimeout(() => {
        // Legacy worker path: no welcome ever arrives. Treat the socket as
        // connected so chat resumes without a perpetual "connecting…" UX.
        promote();
      }, HELLO_TIMEOUT_MS);
    });
    ws.on('message', (data: WebSocket.RawData) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const event = parseServerEvent(text);
      if (!event) {
        process.stderr.write('[ws] malformed message dropped\n');
        return;
      }
      // ping is type-declared but the worker doesn't currently emit one;
      // pong handler is future-proofing for a heartbeat path. Validate `t` at
      // runtime since parseServerEvent only gates on the discriminator.
      if (event.type === 'ping') {
        if (typeof event.t === 'number') sendEnvelope({ type: 'pong', t: event.t });
        return;
      }
      if (event.type === 'welcome') {
        clearHelloTimer();
        if (event.accepted) {
          promote();
        } else {
          // Server explicitly rejected this client. Don't reconnect, the
          // wire shape mismatch isn't a transient error. Caller (chat.tsx
          // header) renders the "client outdated" message; user upgrades.
          events.onStatus('outdated');
          intentional = true;
          if (ws) ws.close();
        }
        return;
      }
      // 'system' with a structured code can carry session_revoked, which
      // is the worker's "drop your token" signal. Surface it through a
      // dedicated callback so chat.tsx can clear config + re-verify;
      // still pass the event through in case other UI cares about content.
      if (event.type === 'system' && event.code === 'session_revoked') {
        events.onTokenRejected?.(event.code);
      }
      events.onEvent(event);
    });
    ws.on('close', () => {
      ws = null;
      clearHelloTimer();
      if (suppressNextClose) {
        suppressNextClose = false;
        return;
      }
      // Intentional close = client being torn down (component unmount or config swap).
      // Don't emit 'disconnected'; the next thing rendered will set its own status.
      if (intentional) return;
      scheduleReconnect();
    });
    ws.on('error', (err) => {
      events.onError(normalizeError(err));
    });
  }

  function scheduleReconnect() {
    if (intentional) return;
    retryCount++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, retryCount - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    events.onStatus('reconnecting');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      void connect();
    }, delay);
  }

  void connect();

  return {
    send(content: string) {
      sendEnvelope({ type: 'message', content });
    },
    close() {
      intentional = true;
      clearHelloTimer();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) ws.close();
    },
    forceReconnect() {
      if (intentional) return;
      retryCount = 0;
      clearHelloTimer();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      // getTicket() is owned by chat.tsx and already calls
      // getValidAccessToken, a stale token gets refreshed before the next
      // ws-ticket attempt. So forceReconnect just restarts the connect
      // loop; the proactive refresh happens in getTicket on the next call.
      if (ws) {
        suppressNextClose = true;
        ws.close();
      }
      void connect();
    },
    hasConnectedOnce() {
      return hasConnectedOnce;
    },
  };
}
