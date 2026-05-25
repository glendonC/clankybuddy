// Lazy bootstrapper for the global chat. Responsibilities:
//   - Defer /auth/init until the user actually opens the chat tab. Players
//     who never look at chat shouldn't generate anonymous accounts.
//   - Run /auth/ws-ticket → open WebSocket → pipe events into log.js.
//   - Surface connection state to the chat status pill.
//   - On 401: try refreshAuth() once, retry. Second 401 → cold start.
//   - On 426: render an "outdated client" overlay; do NOT reconnect.
//   - On `system { code: 'session_revoked' }`: clear, restart from scratch.
//
// Re-entrancy: connect() returns the existing client if already started.

import {
  ApiError,
  authWsTicket,
  clearAuth,
  ensureAuth,
  refreshAuth,
} from './auth.js';
import { createChatClient } from './chat-client.js';
import {
  attachChatClient,
  logChatEvent,
  logChatMessage,
  redactChatMessage,
  setChatStatus,
} from '../ui/log.js';
import { notifyRealActivity } from './chat-seed.js';
import { emitAuthLifecycle } from '../telemetry/events.js';

const CLIENT_KIND = 'web';

let _client = null;
let _starting = null;
let _selfHandle = null;
let _outdated = false;
// Messages typed before the WS handshake completes. The boot shim in
// main.js pushes here (via enqueuePendingMessage) so the input can clear
// immediately; we drain into the live client on the first 'connected'
// status transition. If startup fails terminally, we drain into the chat
// log as system-event lines so the user sees what was dropped instead of
// the text vanishing silently.
let _pending = [];

export function enqueuePendingMessage(text) {
  if (typeof text !== 'string') return;
  const trimmed = text.trim();
  if (!trimmed) return;
  _pending.push(trimmed);
  // Kick the bootstrap. Idempotent, startChat() returns the in-flight
  // promise if one is running. Swallow rejection here; flushPendingFailed
  // (called from handleAuthError) surfaces it to the user.
  void startChat().catch(() => { /* see handleAuthError */ });
}

function flushPendingTo(client) {
  if (!client || !_pending.length) return;
  while (_pending.length) {
    const text = _pending[0];
    if (!client.sendMessage(text)) {
      // WS dropped between 'connected' emit and this send (race). Leave
      // the message at head of queue, the next 'connected' transition
      // will retry.
      break;
    }
    _pending.shift();
  }
}

function flushPendingFailed(reason) {
  if (!_pending.length) return;
  for (const text of _pending) {
    const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    logChatEvent(`couldn't send "${preview}", ${reason}`);
  }
  _pending = [];
}

export function startChat() {
  if (_outdated) return Promise.resolve(null);
  if (_client) return Promise.resolve(_client);
  if (_starting) return _starting;

  _starting = (async () => {
    setChatStatus('connecting');
    let auth;
    try {
      auth = await ensureAuth();
    } catch (err) {
      handleAuthError(err);
      flushPendingFailed(authErrorReason(err));
      _starting = null;
      throw err;
    }
    _selfHandle = auth.handle;

    let client;
    client = createChatClient({
      apiBase: auth.api_base,
      // getTicket performs the lazy-401 dance: try with current access
      // token, on 401 refresh once, retry. A second 401 means the
      // refresh-token is gone too, surface "session revoked" UX, clear
      // local state, and let the reconnect loop bootstrap a fresh anon
      // account on the next pass.
      getTicket: async () => {
        try {
          return await fetchTicket();
        } catch (err) {
          if (err instanceof ApiError && err.status === 426) {
            // Protocol upgrade required. Don't reconnect, the worker
            // will keep saying no. Surface UX once and hold.
            handleProtocolOutdated(err);
            throw err;
          }
          if (err instanceof ApiError && err.status === 401) {
            try {
              await refreshAuth();
            } catch {
              // Refresh failed, fall through to the second-401 path.
              return await fetchTicketAfterFailedRefresh();
            }
            try {
              return await fetchTicket();
            } catch (err2) {
              if (err2 instanceof ApiError && err2.status === 401) {
                return await fetchTicketAfterFailedRefresh();
              }
              throw err2;
            }
          }
          throw err;
        }
      },
      onStatus: (s) => {
        // Don't overwrite the terminal 'outdated' status. Once we've
        // declared the client outdated we want the overlay to stay up
        // even if the underlying client emits one last 'reconnecting'.
        if (_outdated) return;
        setChatStatus(s);
        // Drain any messages the user typed during /auth/init or while
        // the WS was still handshaking. Also runs on every reconnect so
        // messages composed during a flap get delivered once we're back.
        if (s === 'connected') flushPendingTo(client);
      },
      onMessage: handleIncoming,
      onError: () => { /* status pill already reflects retry state */ },
      onOutdated: handleProtocolOutdated,
    });

    attachChatClient({
      onSend: (text) => client.sendMessage(text),
    });

    _client = client;
    return client;
  })();

  return _starting;
}

// Helper: re-read auth, hit /auth/ws-ticket, return the ticket string.
async function fetchTicket() {
  const auth = await ensureAuth();
  const { ticket } = await authWsTicket(auth.api_base, auth.access_token);
  _selfHandle = auth.handle;
  return ticket;
}

// Helper: handle the second-consecutive-401. Both the access AND refresh
// tokens are dead, log a (gentle) message, wipe local state, and run a
// fresh /auth/init. Reuse the same fetchTicket() machinery on the new
// identity so the WS comes back online without a page reload.
async function fetchTicketAfterFailedRefresh() {
  emitAuthLifecycle({
    type: 'auth_init_after_refresh_failed',
    client_kind: CLIENT_KIND,
  });
  emitAuthLifecycle({
    type: 'token_revoked_seen',
    client_kind: CLIENT_KIND,
    source: 'http_401',
  });
  logChatEvent('your session was revoked, reconnecting with a new identity');
  clearAuth();
  _selfHandle = null;
  // ensureAuth() will hit /auth/init (no blob on disk) and persist a
  // fresh pair. Then issue a ticket on the new access token.
  const auth = await ensureAuth();
  _selfHandle = auth.handle;
  const { ticket } = await authWsTicket(auth.api_base, auth.access_token);
  return ticket;
}

function handleProtocolOutdated(err) {
  if (_outdated) return;
  _outdated = true;
  flushPendingFailed('client outdated');
  setChatStatus('outdated');
  const required = (err instanceof ApiError && err.body && typeof err.body === 'object'
    ? err.body.required_version : undefined) || '?';
  emitAuthLifecycle({
    type: 'protocol_outdated_seen',
    client_kind: CLIENT_KIND,
    required_version: String(required),
    client_version: '0.1.0',
  });
  logChatEvent('your client is outdated, refresh the page to update');
  // Tear down any partial connection so the reconnect loop stops trying.
  if (_client) {
    try { _client.close(); } catch { /* ignore */ }
  }
}

function handleIncoming(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'history': {
      // History comes back at every (re)connect. Replace the current chat
      // entries with the server's truth, but keep buddy/system entries.
      // log.js doesn't expose a "clear chat only" right now, for v0 we
      // just append; dedupe by msg_id below.
      for (const m of msg.messages) {
        if (!m?.msg_id) continue;
        logChatMessage({
          msg_id: m.msg_id,
          handle: m.handle,
          color: m.color,
          content: m.content,
          timestamp: m.timestamp,
          self: m.handle === _selfHandle,
        });
      }
      if (msg.messages?.length) notifyRealActivity();
      break;
    }
    case 'join':
      logChatEvent(`${msg.handle} joined`);
      break;
    case 'leave':
      logChatEvent(`${msg.handle} left`);
      break;
    case 'system':
      // Structured codes (chat.ts SystemEventCode) drive programmatic
      // behavior; the human-readable `content` always renders.
      if (msg.code === 'session_revoked') {
        emitAuthLifecycle({
          type: 'token_revoked_seen',
          client_kind: CLIENT_KIND,
          source: 'system_event',
        });
        logChatEvent(msg.content || 'your session was revoked, reconnecting');
        // Fully tear down and re-bootstrap. clearAuth wipes the blob;
        // closing the client stops the reconnect loop on this client
        // instance. We then null out internal state and call startChat
        // again on a fresh tick, the new chat instance will run
        // /auth/init for a fresh anon identity.
        clearAuth();
        _selfHandle = null;
        if (_client) {
          try { _client.close(); } catch { /* ignore */ }
        }
        _client = null;
        _starting = null;
        // Defer one tick so the close() above resolves cleanly before
        // the new bootstrap begins; otherwise the WS close handler
        // would race with the new connect() and look like a flap.
        setTimeout(() => { void startChat(); }, 0);
      } else {
        logChatEvent(msg.content);
      }
      break;
    case 'message':
      logChatMessage({
        msg_id: msg.msg_id,
        handle: msg.handle,
        color: msg.color,
        content: msg.content,
        timestamp: msg.timestamp,
        self: msg.handle === _selfHandle,
      });
      if (msg.handle !== _selfHandle) notifyRealActivity();
      break;
    case 'redact':
      redactChatMessage(msg.msg_id);
      break;
    case 'blocked':
      logChatEvent(`message blocked: ${msg.reason_code ?? 'policy'}`);
      break;
    case 'slow_mode':
      if (msg.until && msg.until > Date.now()) {
        logChatEvent(`slow mode active (1 msg per ${(msg.interval_ms ?? 30_000) / 1000}s)`);
      } else {
        logChatEvent('slow mode lifted');
      }
      break;
    case 'ping':
      // Handled in chat-client (auto-pong).
      break;
  }
}

function authErrorReason(err) {
  if (!(err instanceof ApiError)) return 'connection error';
  if (err.status === 403 && err.body?.error === 'captcha_required') return 'verification required';
  if (err.status === 429) return 'rate-limited';
  return `auth error ${err.status}`;
}

function handleAuthError(err) {
  if (!(err instanceof ApiError)) {
    setChatStatus('disconnected');
    logChatEvent('chat unavailable, check your connection');
    return;
  }
  if (err.status === 403 && err.body?.error === 'captcha_required') {
    setChatStatus('disconnected');
    const url = err.body.verify_url ?? '';
    logChatEvent(url
      ? `verify in browser to enable chat: ${url}`
      : 'verification required, try again later');
    return;
  }
  if (err.status === 429) {
    setChatStatus('disconnected');
    logChatEvent('chat rate-limited from this network, try again later');
    return;
  }
  setChatStatus('disconnected');
  logChatEvent(`chat unavailable (${err.status})`);
}
