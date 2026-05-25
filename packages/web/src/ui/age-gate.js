// First-run age-gate modal. Blocks the boot flow until the user attests
// they're 13+, or stalls forever if they decline. Storage and copy live in
// @clankybuddy/shared/age-gate so the web modal and the TUI screen stay
// in vocabulary lockstep, the legal meaning of the prompt cannot drift
// between surfaces.
//
// Behavior:
//   - Storage key: `clankybuddy.age_gate.v1` (independent of the v3 save).
//     A confirmed record skips the prompt on subsequent loads. Version
//     mismatch → re-prompt (the prompt's legal meaning has changed).
//   - On confirm: write the record, fade out, resolve. Boot continues.
//   - On decline: replace modal contents with the goodbye copy, never
//     resolve. The boot flow is intentionally stalled, pointer/keyboard
//     bindings and the RAF loop never start, so the canvas stays inert.
//   - Survives `__clankyReset()`. The age-gate is a legal artifact about
//     the human at the device; save state is a game artifact about the
//     profile. Independent reset surfaces (per red-team #11).
//
// Telemetry: emits one `age_gate_confirmed` event into the existing
// console-debug sink in src/telemetry/events.js. The type lives in
// @clankybuddy/shared/auth-events.

import {
  AGE_GATE_VERSION,
  AGE_GATE_TITLE,
  AGE_GATE_CONFIRM_LABEL,
  AGE_GATE_DECLINE_LABEL,
  AGE_GATE_DECLINE,
  isAgeGateSatisfied,
} from '@clankybuddy/shared/age-gate';
import { emit } from '../telemetry/events.js';

const STORAGE_KEY = 'clankybuddy.age_gate.v1';
const TOS_URL = 'https://clankybuddy.com/legal/tos';
const PRIVACY_URL = 'https://clankybuddy.com/legal/privacy';
const AGE_GATE_QUESTION = 'Are you 13 or older?';

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(record) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Quota / disabled storage, best effort. The user re-attests next
    // load; not a correctness issue.
  }
}

// Public entry. Returns a Promise that resolves on confirm. On decline the
// promise NEVER resolves so the caller's await stalls indefinitely, that's
// the design: the canvas / WS / RAF loop must not start.
export function ensureAgeGate() {
  const stored = readStored();
  if (isAgeGateSatisfied(stored)) return Promise.resolve();

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'age-gate-backdrop';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'age-gate-title');

    const sheet = document.createElement('div');
    sheet.className = 'age-gate-modal';

    sheet.innerHTML = `
      <div class="age-gate-kicker"></div>
      <h1 class="age-gate-title" id="age-gate-title"></h1>
      <div class="age-gate-buttons">
        <button class="age-gate-decline" type="button"></button>
        <button class="age-gate-confirm" type="button"></button>
      </div>
      <div class="age-gate-tos">
        <span>by continuing you accept the <a href="${TOS_URL}" target="_blank" rel="noopener noreferrer">terms of service</a> and <a href="${PRIVACY_URL}" target="_blank" rel="noopener noreferrer">privacy policy</a>.</span>
      </div>
    `;

    sheet.querySelector('.age-gate-kicker').textContent = AGE_GATE_TITLE;
    sheet.querySelector('.age-gate-title').textContent = AGE_GATE_QUESTION;
    const confirmBtn = sheet.querySelector('.age-gate-confirm');
    const declineBtn = sheet.querySelector('.age-gate-decline');
    confirmBtn.textContent = AGE_GATE_CONFIRM_LABEL;
    declineBtn.textContent = AGE_GATE_DECLINE_LABEL;

    confirmBtn.addEventListener('click', () => {
      const record = { confirmed_at: Date.now(), version: AGE_GATE_VERSION };
      writeStored(record);
      // Telemetry, fire-and-forget; the sink is set up later in main.js
      // but emit() queues against a debug sink at module load so the event
      // is captured either way.
      try {
        emit({ type: 'age_gate_confirmed', client_kind: 'web', version: AGE_GATE_VERSION });
      } catch {
        /* never block on telemetry */
      }
      // Fade out + remove. Resolve after the fade so the next-frame caller
      // can immediately render against an unblocked viewport.
      root.classList.add('age-gate-fade-out');
      setTimeout(() => {
        root.remove();
        resolve();
      }, 160);
    });

    declineBtn.addEventListener('click', () => {
      // Replace contents with the decline copy and a quiet goodbye footer.
      // Promise is never resolved, boot stays stalled, intentionally.
      sheet.innerHTML = `
        <div class="age-gate-kicker"></div>
        <h1 class="age-gate-title"></h1>
        <div class="age-gate-prompt"></div>
        <div class="age-gate-goodbye">Goodbye.</div>
      `;
      sheet.querySelector('.age-gate-kicker').textContent = AGE_GATE_TITLE;
      sheet.querySelector('.age-gate-title').textContent = AGE_GATE_QUESTION;
      sheet.querySelector('.age-gate-prompt').textContent = AGE_GATE_DECLINE;
    });

    root.appendChild(sheet);
    document.body.appendChild(root);
    // Focus the affirmative action by default, keyboard users can hit Enter
    // to proceed. No focus trap (the modal is the only interactive surface
    // until it resolves).
    confirmBtn.focus({ preventScroll: true });
  });
}
