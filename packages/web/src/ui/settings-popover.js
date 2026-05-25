// Gear-icon popover. Owns the visible UI for src/state/settings.js, toggles,
// environment grid, mode picker. Renders on demand; closes on outside click
// or Escape. localStorage persistence lives in settings.js.

import {
  getSetting, setSetting, onSettingsChange,
} from '../state/settings.js';
import { setMuted } from '../audio/core.js';

let _btn = null;
let _popover = null;

export function bindSettings(btnEl) {
  // Initial mute sync (in case user reloaded with muteSFX:true).
  setMuted(getSetting('muteSFX'));

  _btn = btnEl ?? document.getElementById('settings-btn');
  if (!_btn) return;
  _btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_popover) close(); else open();
  });

  // Mutual exclusion with sibling chat-action popovers (stats, etc).
  // The chat-actions row acts like a tab strip with one shared popover
  // slot, opening any sibling closes us.
  window.addEventListener('chat-action-popover-open', (e) => {
    if (e.detail?.id !== 'settings' && _popover) close();
  });

  // React to mute changes from other code paths (e.g. dev panel later).
  onSettingsChange((key, val) => {
    if (key === 'muteSFX') setMuted(val);
  });

  // Esc to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _popover) close();
  });
}

function open() {
  window.dispatchEvent(new CustomEvent('chat-action-popover-open', { detail: { id: 'settings' } }));
  _popover = build();
  document.body.appendChild(_popover);
  positionBesideChatActions();
  _btn?.classList.add('active');
  window.addEventListener('resize', positionBesideChatActions);
  // Defer the outside-click listener one tick so the *opening* click doesn't
  // immediately close it.
  requestAnimationFrame(() => {
    document.addEventListener('click', onOutside);
  });
}

// Anchored to the RIGHT of the chat-actions row, bottom-aligned with it.
// Grows upward into the lower-left stage. Never overlaps the chat panel
// above the gear, chat is a persistent identity surface, settings is a
// transient toggle visit, so the popover gets out of chat's way.
function positionBesideChatActions() {
  if (!_popover || !_btn) return;
  const anchor = _btn.closest('.chat-actions') || _btn;
  const r = anchor.getBoundingClientRect();
  _popover.style.left = `${Math.round(r.right + 12)}px`;
  const bottom = Math.round(window.innerHeight - r.bottom);
  _popover.style.bottom = `${bottom}px`;
  _popover.style.maxHeight = `${Math.max(360, Math.round(window.innerHeight - bottom - 32))}px`;
  _popover.style.top = 'auto';
  _popover.style.right = 'auto';
}

function close() {
  if (!_popover) return;
  _popover.remove();
  _popover = null;
  _btn?.classList.remove('active');
  document.removeEventListener('click', onOutside);
  window.removeEventListener('resize', positionBesideChatActions);
}

function onOutside(e) {
  if (!_popover) return;
  if (_popover.contains(e.target) || _btn.contains(e.target)) return;
  close();
}

function build() {
  const root = document.createElement('div');
  root.className = 'settings-popover popover-sheet';

  root.innerHTML = `
    <div class="popover-header">
      <div class="popover-title">settings</div>
    </div>

    <section class="popover-section">
      <div class="popover-section-title">experience</div>
      <label class="popover-row settings-toggle">
        <input type="checkbox" data-key="theme" data-on-value="light" data-off-value="dark" />
        <span class="popover-row-copy">
          <span class="popover-label">light theme</span>
          <span class="popover-hint">bright surfaces, dark text</span>
        </span>
        <span class="switch-control" aria-hidden="true"></span>
      </label>
      <label class="popover-row settings-toggle">
        <input type="checkbox" data-key="muteSFX" />
        <span class="popover-row-copy">
          <span class="popover-label">mute sfx</span>
          <span class="popover-hint">silences all audio</span>
        </span>
        <span class="switch-control" aria-hidden="true"></span>
      </label>
      <label class="popover-row settings-toggle">
        <input type="checkbox" data-key="debugOverlay" />
        <span class="popover-row-copy">
          <span class="popover-label">debug overlay</span>
          <span class="popover-hint">body ids, constraints, status registry</span>
        </span>
        <span class="switch-control" aria-hidden="true"></span>
      </label>
      <label class="popover-row settings-toggle">
        <input type="checkbox" data-key="liveMode" />
        <span class="popover-row-copy">
          <span class="popover-label">live mode</span>
          <span class="popover-hint">buddy walks, dodges, panics</span>
        </span>
        <span class="switch-control" aria-hidden="true"></span>
      </label>
    </section>

    <section class="popover-section settings-controls">
      <div class="popover-section-title">controls</div>
      <ul class="controls-list">
        <li>
          <span class="controls-keys"><kbd>1</kbd><span>–</span><kbd>=</kbd></span>
          <span class="controls-desc">activate hotbar slot</span>
        </li>
        <li>
          <span class="controls-keys"><kbd>space</kbd></span>
          <span class="controls-desc">grab the buddy (drag to throw)</span>
        </li>
        <li>
          <span class="controls-keys">click slot</span>
          <span class="controls-desc">activate the tool there</span>
        </li>
        <li>
          <span class="controls-keys"><kbd>shift</kbd><span>+</span><span>click slot</span></span>
          <span class="controls-desc">swap the tool in that slot</span>
        </li>
        <li>
          <span class="controls-keys">right-click slot</span>
          <span class="controls-desc">remove the tool from the bar</span>
        </li>
        <li>
          <span class="controls-keys">drag slot → slot</span>
          <span class="controls-desc">rearrange or swap tools</span>
        </li>
        <li>
          <span class="controls-keys">drag slot → off bar</span>
          <span class="controls-desc">remove the tool</span>
        </li>
        <li>
          <span class="controls-keys">click empty slot</span>
          <span class="controls-desc">pick a tool to equip</span>
        </li>
        <li>
          <span class="controls-keys"><kbd>esc</kbd></span>
          <span class="controls-desc">close any popover or modal</span>
        </li>
      </ul>
    </section>
  `;

  // Wire toggles. data-on-value/data-off-value let a checkbox drive a string
  // setting (e.g. theme: 'light' / 'dark') instead of a boolean.
  for (const cb of root.querySelectorAll('input[type=checkbox][data-key]')) {
    const key = cb.dataset.key;
    const onValue  = cb.dataset.onValue  ?? true;
    const offValue = cb.dataset.offValue ?? false;
    const current = getSetting(key);
    cb.checked = current === onValue || current === true;
    cb.addEventListener('change', () => setSetting(key, cb.checked ? onValue : offValue));
  }

  return root;
}
