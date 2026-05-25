// Lifetime stats popover, small flyout anchored to the bottom-left
// `#stats-btn`. Hover the button to peek a wallet snapshot + milestones;
// click the button to jump straight to the full analytics dashboard
// (stats-dashboard.js). Matches the shop slot-picker's hover-to-inspect,
// click-to-commit pattern. On touch / (hover: none) devices the peek is
// skipped and tap opens the dashboard.

import { onChange as onProgressionChange, getState } from '../progression/state.js';
import { listPersonas } from '../personas/index.js';
import {
  openStatsDashboard,
  getStatsDemoMode,
  setStatsDemoMode,
  onStatsDemoChange,
} from './stats-dashboard.js';

// Re-exports kept so dev-panel.js can keep its existing import shape.
export { getStatsDemoMode, setStatsDemoMode, onStatsDemoChange };

const HOVER_OPEN_DELAY_MS = 140;
const HOVER_CLOSE_GRACE_MS = 160;

let _root = null;
let _btn  = null;
let _unsubscribe = null;
let _openTimer = null;
let _closeTimer = null;

function hasHover() {
  try { return window.matchMedia('(hover: hover)').matches; }
  catch { return true; }
}

export function bindStatsPopover(btnEl) {
  _btn = btnEl ?? document.getElementById('stats-btn');
  if (!_btn) return;

  // Click always opens the full dashboard. The popover is a passive peek.
  _btn.addEventListener('click', (e) => {
    e.stopPropagation();
    cancelOpen();
    closePopover();
    openStatsDashboard();
  });

  if (hasHover()) {
    _btn.addEventListener('mouseenter', scheduleOpen);
    _btn.addEventListener('mouseleave', scheduleClose);
    _btn.addEventListener('focus', scheduleOpen);
    _btn.addEventListener('blur', scheduleClose);
  }

  // Mutual exclusion with sibling chat-action popovers (settings, etc).
  window.addEventListener('chat-action-popover-open', (e) => {
    if (e.detail?.id !== 'stats' && _root) closePopover();
  });
}

export function isStatsOpen() { return _root !== null; }

function scheduleOpen() {
  cancelClose();
  if (_root || _openTimer) return;
  _openTimer = setTimeout(() => { _openTimer = null; openPopover(); }, HOVER_OPEN_DELAY_MS);
}
function cancelOpen() {
  if (_openTimer) { clearTimeout(_openTimer); _openTimer = null; }
}
function scheduleClose() {
  cancelOpen();
  if (!_root || _closeTimer) return;
  _closeTimer = setTimeout(() => { _closeTimer = null; closePopover(); }, HOVER_CLOSE_GRACE_MS);
}
function cancelClose() {
  if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
}

function openPopover() {
  window.dispatchEvent(new CustomEvent('chat-action-popover-open', { detail: { id: 'stats' } }));
  _root = document.createElement('div');
  _root.className = 'stats-popover stats-popover-bl';
  _root.innerHTML = `
    <div class="stats-popover-title">lifetime stats</div>
    <div class="stats-grid">
      <div class="stats-row"><span class="stats-label">balance</span><span class="stats-value" data-stat="currency">0</span></div>
      <div class="stats-row"><span class="stats-label">earned</span><span class="stats-value" data-stat="lifetimeEarned">0</span></div>
      <div class="stats-row"><span class="stats-label">spent</span><span class="stats-value" data-stat="lifetimeSpent">0</span></div>
      <div class="stats-divider"></div>
      <div class="stats-row"><span class="stats-label">tools owned</span><span class="stats-value" data-stat="toolsOwned">0</span></div>
      <div class="stats-row"><span class="stats-label">upgrades</span><span class="stats-value" data-stat="nodesOwned">0</span></div>
      <div class="stats-row"><span class="stats-label">buddies met</span><span class="stats-value" data-stat="charsSeen">0</span></div>
    </div>
    <div class="stats-popover-hint">click for analytics</div>
  `;
  document.body.appendChild(_root);
  // Keep the popover open while the cursor is inside it.
  _root.addEventListener('mouseenter', cancelClose);
  _root.addEventListener('mouseleave', scheduleClose);
  positionBesideChatActions();
  _btn?.classList.add('active');
  refresh(getState());
  _unsubscribe = onProgressionChange(refresh);

  window.addEventListener('keydown', onEsc, true);
  window.addEventListener('resize', positionBesideChatActions);
}

function closePopover() {
  cancelClose();
  if (!_root) return;
  _root.remove();
  _root = null;
  _btn?.classList.remove('active');
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = null;
  window.removeEventListener('keydown', onEsc, true);
  window.removeEventListener('resize', positionBesideChatActions);
}

function onEsc(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  closePopover();
}

function positionBesideChatActions() {
  if (!_root || !_btn) return;
  const anchor = _btn.closest('.chat-actions') || _btn;
  const r = anchor.getBoundingClientRect();
  _root.style.left = `${Math.round(r.right + 12)}px`;
  _root.style.bottom = `${Math.round(window.innerHeight - r.bottom)}px`;
  _root.style.top = 'auto';
  _root.style.right = 'auto';
}

function refresh(s) {
  if (!_root) return;
  const set = (key, val) => {
    const el = _root.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = String(val);
  };
  const fmt = (n) => Number(n || 0).toLocaleString();
  set('currency', fmt(s.currency));
  set('lifetimeEarned', fmt(s.lifetimeEarned));
  set('lifetimeSpent', fmt(s.lifetimeSpent));
  set('toolsOwned', fmt((s.unlockedTools || []).length));
  set('nodesOwned', fmt((s.unlockedNodes || []).length));
  const totalChars = listPersonas().length;
  const seen = s.seenStates ? Object.keys(s.seenStates).length : 0;
  set('charsSeen', `${seen} / ${totalChars}`);
}
