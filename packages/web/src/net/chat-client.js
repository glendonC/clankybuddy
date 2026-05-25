// WebSocket chat client, browser port of packages/cli/src/ws.ts.
//
// Uses the global WebSocket. Same connect/reconnect state machine and exponential
// backoff as the TUI. Auto-replies to server `ping` events (unlike the TUI, which
// silently drops them, the server doesn't require pongs but sending one keeps
// the round-trip honest).
//
// Protocol (mirrored from packages/worker/src/room.ts):
//   client → server: { type: 'message', content }            { type: 'pong', t }
//                  | { type: 'hello', protocol_version, client_kind, client_version }
//   server → client: history | join | leave | system | ping | blocked | redact
//                  | slow_mode | welcome | <ChatMessage>
//
// Hello/welcome handshake: on every WS 'open' we send a hello frame
// immediately. The worker's strict-mode rollout will close the socket
// if no hello arrives within HELLO_TIMEOUT_MS; until that flip ships we
// also tolerate a missing welcome by promoting to 'connected' after
// the same timeout (legacy compat). On `welcome { accepted: false }` we
// surface the protocol-outdated path through the onOutdated callback,
// the bootstrap layer renders the overlay; we just stop reconnecting.
//
// Events surface as { onStatus, onMessage, onError, onOutdated }
// callbacks. The caller owns rendering, this module knows nothing
// about the DOM.

import {
  HELLO_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  PROTOCOL_VERSION,
  RECONNECT_BASE_MS,
} from './constants.js';
import { CLIENT_KIND, WEB_CLIENT_VERSION } from './protocol-version.js';

export function createChatClient({ apiBase, getTicket, onStatus, onMessage, onError, onOutdated }) {
  let ws = null;
  let intentional = false;
  let suppressNextClose = false;
  let retryCount = 0;
  let reconnectTimer = null;
  let helloTimer = null;
  let helloAcked = false;
  // Set to true once we've decided this client is on the wrong protocol
  // major, we stop the reconnect loop so the server doesn't see a
  // hot-reconnect storm from outdated tabs.
  let outdated = false;

  const wsBase = apiBase.replace(/^http/, 'ws');

  function emitStatus(s) { onStatus?.(s); }
  function emitError(e)  { onError?.(e); }

  async function connect() {
    if (outdated) return;
    emitStatus(retryCount === 0 ? 'connecting' : 'reconnecting');
    let ticket;
    try {
      ticket = await getTicket();
    } catch (err) {
      emitError(err);
      // ApiError 426 is terminal, bootstrap already rendered the
      // outdated overlay. Don't schedule another connect.
      if (err && typeof err === 'object' && err.status === 426) {
        outdated = true;
        return;
      }
      scheduleReconnect();
      return;
    }

    try {
      const url = `${wsBase}/ws/chat?ticket=${encodeURIComponent(ticket)}&v=${PROTOCOL_VERSION}`;
      ws = new WebSocket(url);
    } catch (err) {
      emitError(err);
      scheduleReconnect();
      return;
    }

    helloAcked = false;

    ws.addEventListener('open', () => {
      retryCount = 0;
      // Send hello first frame. Strict-mode worker (future flip) will
      // close the socket if this is missing; the legacy worker just
      // ignores unknown types.
      send({
        type: 'hello',
        protocol_version: PROTOCOL_VERSION,
        client_kind: CLIENT_KIND,
        client_version: WEB_CLIENT_VERSION,
      });
      // Don't promote to 'connected' yet, wait for `welcome` (or the
      // legacy-compat fallback timer to expire).
      emitStatus('connecting');
      if (helloTimer) clearTimeout(helloTimer);
      helloTimer = setTimeout(() => {
        if (helloAcked || !ws || ws.readyState !== WebSocket.OPEN) return;
        // Legacy worker: no welcome will arrive. Treat as connected so
        // the user can chat. After both surfaces ship hello, the worker
        // will flip into strict mode and this fallback becomes
        // unreachable in practice.
        emitStatus('connected');
      }, HELLO_TIMEOUT_MS);
    });
    ws.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        // Reply to server pings so the room sees liveness signal.
        if (parsed?.type === 'ping') {
          send({ type: 'pong', t: parsed.t });
        }
        if (parsed?.type === 'welcome') {
          helloAcked = true;
          if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
          if (parsed.accepted === false) {
            // Worker rejected our hello (unsupported_client /
            // protocol_mismatch). Surface to bootstrap and stop
            // reconnecting; the user must refresh to update.
            outdated = true;
            const reason = parsed.reason || 'unsupported_client';
            // Synthesize an ApiError-shaped object for onOutdated, so
            // chat-bootstrap's handler can read .body.required_version
            // (server may include it via upgrade_hint). The handler is
            // tolerant to missing fields.
            onOutdated?.({
              status: 426,
              body: {
                required_version: parsed.server_version,
                reason,
                upgrade_hint: parsed.upgrade_hint,
              },
            });
            // Close cleanly so the reconnect loop sees `intentional` style.
            try { ws?.close(); } catch { /* ignore */ }
            return;
          }
          // Welcome with accepted: true → fully connected.
          emitStatus('connected');
          // Don't pass the welcome event up to onMessage, it's a
          // handshake artifact, not a chat event. Bootstrap doesn't
          // need to switch on it.
          return;
        }
        // Worker may emit a session_revoked notice without a welcome
        // round-trip (e.g. policy revocation mid-session). The
        // bootstrap's handleIncoming inspects code:'session_revoked'.
        onMessage?.(parsed);
      } catch (err) {
        emitError(err);
      }
    });
    ws.addEventListener('close', () => {
      ws = null;
      if (helloTimer) { clearTimeout(helloTimer); helloTimer = null; }
      if (suppressNextClose) {
        suppressNextClose = false;
        return;
      }
      if (intentional) return;
      if (outdated) return;
      scheduleReconnect();
    });
    ws.addEventListener('error', (ev) => {
      // Browsers don't expose much on WS error events; just signal.
      emitError(ev);
    });
  }

  function scheduleReconnect() {
    if (intentional || outdated) return;
    retryCount++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, retryCount - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    emitStatus('reconnecting');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { void connect(); }, delay);
  }

  function send(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  void connect();

  return {
    sendMessage(content) {
      return send({ type: 'message', content });
    },
    close() {
      intentional = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (helloTimer) {
        clearTimeout(helloTimer);
        helloTimer = null;
      }
      if (ws) ws.close();
    },
    forceReconnect() {
      if (intentional || outdated) return;
      retryCount = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        suppressNextClose = true;
        ws.close();
      }
      void connect();
    },
  };
}
