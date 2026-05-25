// Chat panel, bottom-left HUD widget (id stays #log-window for continuity).
// FFXIV-style: no header, no title, no status pill. Two stacked squircles,
// the message list above, the input row below, both translucent, same wash.
// A close button appears top-right only on hover; clicking it collapses the
// list (input stays usable so sending a message is always one click away).
// Connection status is implicit in the input border tint.
//
// API:
//   bindLog(rootEl)
//   logChatMessage({ handle, color, content, timestamp, msg_id?, self? })
//   logChatEvent(text)
//   setChatStatus('connecting'|'connected'|'reconnecting'|'disconnected'|'outdated')
//   attachChatClient({ onSend(text) })
//   redactChatMessage(msg_id)
//
// Connection statuses:
//   - 'idle'         , pre-bootstrap; no auth attempt yet.
//   - 'connecting'   , running /auth/init or /auth/ws-ticket, or awaiting WS welcome.
//   - 'connected'    , WS open and welcome handshake complete (or legacy timeout).
//   - 'reconnecting' , backoff between attempts; same border tint as connecting.
//   - 'disconnected' , terminal soft fail (captcha, rate limit, network).
//   - 'outdated'     , server rejected our protocol version. Renders a non-
//                       dismissable refresh-prompt overlay; reconnect loop is halted.

import { isValidColor } from '@clankybuddy/shared/colors';
import { CHAT_MAX_MESSAGE_LENGTH } from '../net/constants.js';

const MAX_ENTRIES = 240;

let _root        = null;
let _list        = null;
let _input       = null;
let _entries     = [];
let _autoScroll  = true;
let _expanded    = true;
let _chatStatus  = 'idle';
let _onSend      = null;

export function bindLog(rootEl) {
  _root = rootEl ?? document.getElementById('log-window');
  if (!_root) return;
  _root.innerHTML = `
    <div class="log-list" role="log" aria-live="polite"></div>
    <form class="log-input-row">
      <input
        type="text"
        class="log-input"
        autocomplete="off"
        spellcheck="false"
        maxlength="${CHAT_MAX_MESSAGE_LENGTH}"
        placeholder="say something…"
        aria-label="chat message"
      />
      <button type="submit" class="log-input-send" aria-label="send">↵</button>
    </form>
    <button class="log-open-btn" type="button" title="open global chat" aria-label="open global chat">
      <svg class="log-open-glyph" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M 2 4 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 6 a 2 2 0 0 1 -2 2 h -5 l -3 3 v -3 h -0 a 2 2 0 0 1 -2 -2 z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <span class="log-open-label">open global chat</span>
    </button>
    <button class="log-close-btn" type="button" title="hide messages" aria-label="hide chat messages">×</button>
  `;
  _list  = _root.querySelector('.log-list');
  _input = _root.querySelector('.log-input');

  _list.addEventListener('scroll', onScroll);
  _root.querySelector('.log-close-btn').addEventListener('click', toggleExpanded);
  _root.querySelector('.log-open-btn').addEventListener('click', toggleExpanded);
  _root.querySelector('.log-input-row').addEventListener('submit', (e) => {
    e.preventDefault();
    submitInput();
  });

  applyExpansion();
  applyStatus();
  render();
}

function toggleExpanded() {
  _expanded = !_expanded;
  applyExpansion();
}

function applyExpansion() {
  if (!_root) return;
  _root.classList.toggle('expanded', _expanded);
  _root.classList.toggle('collapsed', !_expanded);
  if (_expanded && _list) {
    _list.scrollTop = _list.scrollHeight;
    updateFadeMarkers();
  }
}

function onScroll() {
  if (!_list) return;
  const distFromBottom = _list.scrollHeight - _list.scrollTop - _list.clientHeight;
  _autoScroll = distFromBottom < 8;
  updateFadeMarkers();
}

// Toggle data-at-top / data-at-bottom on the scroll container so the CSS
// mask flattens the corresponding edge when there's nothing scrolled past
// it, no fade clipping the first or last message when you're already at
// that end. Threshold matches the auto-pin threshold for consistency.
function updateFadeMarkers() {
  if (!_list) return;
  const atTop = _list.scrollTop <= 1;
  const atBottom = (_list.scrollHeight - _list.scrollTop - _list.clientHeight) <= 1;
  _list.dataset.atTop = String(atTop);
  _list.dataset.atBottom = String(atBottom);
}

function push(entry) {
  _entries.push(entry);
  if (_entries.length > MAX_ENTRIES) _entries.shift();
  render();
}

function render() {
  if (!_list) return;
  if (
    _list.childElementCount === _entries.length - 1 &&
    _entries.length > 0
  ) {
    _list.appendChild(buildRow(_entries[_entries.length - 1]));
  } else {
    _list.innerHTML = '';
    for (const e of _entries) _list.appendChild(buildRow(e));
  }
  if (_autoScroll) _list.scrollTop = _list.scrollHeight;
  updateFadeMarkers();
}

function buildRow(entry) {
  const row = document.createElement('div');
  row.className = `log-row log-kind-${entry.kind}`;
  if (entry.msg_id) row.dataset.msgId = entry.msg_id;
  if (entry.kind === 'chat') {
    if (entry.self) row.classList.add('log-chat-self');
    // colorCss is an opt-in CSS color expression (e.g. var(--handle-persona-claude))
    // used by the seeded persona chatter to bypass the palette and render
    // brand-true tones. Real server messages fall through to the palette
    // path which resolves to per-theme --handle-color-NAME tokens.
    const colorCss = entry.colorCss
      ?? `var(--handle-color-${isValidColor(entry.color) ? entry.color : 'white'})`;
    const ts = formatTime(entry.timestamp);
    row.innerHTML = `
      <span class="log-chat-time">[${escape(ts)}]</span>
      <span class="log-chat-handle" style="color: ${colorCss}">${escape(entry.handle)}</span>
      <span class="log-text">${escape(entry.content)}</span>
    `;
  } else {
    row.innerHTML = `<span class="log-text">${escape(entry.text)}</span>`;
  }
  return row;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ----- public API -----

export function logChatMessage(msg) {
  push({
    kind: 'chat',
    msg_id: msg.msg_id,
    handle: msg.handle,
    color: msg.color,
    colorCss: msg.colorCss,
    content: msg.content,
    timestamp: msg.timestamp,
    self: !!msg.self,
  });
}

export function logChatEvent(text) {
  push({ kind: 'chat-event', text });
}

export function redactChatMessage(msg_id) {
  if (!msg_id) return;
  let touched = false;
  for (const e of _entries) {
    if (e.msg_id === msg_id && e.kind === 'chat' && !e.redacted) {
      e.redacted = true;
      e.content = '[message removed]';
      touched = true;
    }
  }
  if (touched && _list) {
    _list.innerHTML = '';
    for (const e of _entries) _list.appendChild(buildRow(e));
    if (_autoScroll) _list.scrollTop = _list.scrollHeight;
    updateFadeMarkers();
  }
}

export function setChatStatus(status) {
  _chatStatus = status;
  applyStatus();
}

// Status surfaces as a data-status attribute on the input row so the input
// border can tint when disconnected/reconnecting. No visible header pill.
//
// Special-case 'outdated': also renders a full-viewport overlay prompting
// the user to refresh. Once shown the overlay sticks, there is no
// "dismiss"; the only path off the page is a real reload, which the
// `<a href="">refresh</a>` anchor performs natively (no JS needed).
function applyStatus() {
  if (!_root) return;
  _root.dataset.status = _chatStatus;
  if (_chatStatus === 'outdated') ensureOutdatedOverlay();
  else removeOutdatedOverlay();
}

const OUTDATED_OVERLAY_ID = 'clanky-outdated-overlay';

function ensureOutdatedOverlay() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(OUTDATED_OVERLAY_ID)) return;
  const overlay = document.createElement('div');
  overlay.id = OUTDATED_OVERLAY_ID;
  overlay.className = 'outdated-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'outdated-overlay-title');
  overlay.setAttribute('aria-describedby', 'outdated-overlay-body');
  overlay.innerHTML = `
    <div class="outdated-overlay-card">
      <div class="outdated-overlay-eyebrow">client outdated</div>
      <h2 id="outdated-overlay-title" class="outdated-overlay-title">your client is out of date</h2>
      <p id="outdated-overlay-body" class="outdated-overlay-body">
        the server's running a newer protocol than this tab.
        refresh the page to update.
      </p>
      <a class="outdated-overlay-cta" href="">refresh</a>
    </div>
  `;
  document.body.appendChild(overlay);
}

function removeOutdatedOverlay() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(OUTDATED_OVERLAY_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

export function attachChatClient({ onSend } = {}) {
  _onSend = onSend ?? null;
}

function submitInput() {
  if (!_input) return;
  const value = _input.value.trim();
  if (!value) return;
  if (value.length > CHAT_MAX_MESSAGE_LENGTH) return;
  if (!_onSend) return;
  const sent = _onSend(value);
  if (sent !== false) _input.value = '';
}
