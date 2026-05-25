// Hidden admin/dev panel. Toggle with backtick (`). Lets a tester grant
// currency, force-unlock tools/nodes, jump mood states, paint statuses across
// the ragdoll, slow time, and reset the save. Production-safe, panel only
// renders when explicitly toggled, never auto-opens.

import { TOOLS } from './tools-table.js';
import {
  devGrantCurrency, setCurrency, devUnlockTools, devUnlockNodes,
  resetSave, getCurrency, onChange as onProgressionChange,
} from '../progression/state.js';
import { getAllNodes } from '../progression/trees/index.js';
import { getCurrentBuddy, getRagdoll } from '../state/ragdoll-lifecycle.js';
import { engine } from '../state/world.js';
import { applyStatus, clearAll as clearAllStatus } from '../effects/registry.js';
import { MOOD_STATES } from '../mood.js';
import { getStatsDemoMode, setStatsDemoMode, onStatsDemoChange } from './stats-popover.js';

let _root = null;
let _amountEl = null;

export function bindDevPanel() {
  window.addEventListener('keydown', (e) => {
    // Skip when typing into our own inputs.
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '`' || e.key === '~') {
      e.preventDefault();
      toggle();
    }
  });
}

function toggle() {
  if (_root) { hide(); } else { show(); }
}

function show() {
  if (_root) return;
  _root = build();
  document.body.appendChild(_root);
  refreshAmount();
  // Live currency display.
  onProgressionChange(refreshAmount);
}

function hide() {
  if (!_root) return;
  _root.remove();
  _root = null;
  _amountEl = null;
}

function refreshAmount() {
  if (_amountEl) _amountEl.textContent = `¢${getCurrency()}`;
}

function build() {
  const root = document.createElement('div');
  root.className = 'dev-panel';
  root.innerHTML = `
    <div class="dev-panel-header">
      <span>dev</span>
      <span class="dev-panel-amount" data-amount>¢0</span>
      <button class="dev-panel-close" aria-label="close">×</button>
    </div>
    <div class="dev-section">
      <div class="dev-section-title">currency</div>
      <div class="dev-row">
        <button data-act="grant-1000">+1000</button>
        <button data-act="grant-10000">+10k</button>
        <button data-act="grant-100000">+100k</button>
      </div>
      <div class="dev-row">
        <input type="number" min="0" value="0" data-currency-input placeholder="set to…" />
        <button data-act="set-currency">set</button>
      </div>
    </div>
    <div class="dev-section">
      <div class="dev-section-title">unlocks</div>
      <div class="dev-row">
        <button data-act="unlock-tools">unlock all tools</button>
        <button data-act="unlock-nodes">unlock all upgrades</button>
      </div>
    </div>
    <div class="dev-section">
      <div class="dev-section-title">mood</div>
      <div class="dev-row dev-mood"></div>
    </div>
    <div class="dev-section">
      <div class="dev-section-title">status (all parts)</div>
      <div class="dev-row dev-status"></div>
      <div class="dev-row"><button data-act="clear-status">clear all</button></div>
    </div>
    <div class="dev-section">
      <div class="dev-section-title">time scale</div>
      <div class="dev-row dev-time"></div>
    </div>
    <div class="dev-section">
      <div class="dev-section-title">stats dashboard</div>
      <div class="dev-row">
        <label class="dev-toggle">
          <input type="checkbox" data-act="toggle-stats-demo" />
          <span>demo data</span>
        </label>
      </div>
    </div>
    <div class="dev-section">
      <div class="dev-section-title">save</div>
      <div class="dev-row"><button data-act="reset" class="danger">reset save</button></div>
    </div>
    <div class="dev-panel-hint">backtick (\`) to toggle</div>
  `;

  _amountEl = root.querySelector('[data-amount]');
  root.querySelector('.dev-panel-close').addEventListener('click', hide);

  // Mood buttons
  const moodRow = root.querySelector('.dev-mood');
  for (const m of MOOD_STATES) {
    const b = document.createElement('button');
    b.textContent = m.name.toLowerCase();
    b.style.color = m.color;
    b.addEventListener('click', () => setMood(m));
    moodRow.appendChild(b);
  }

  // Status buttons
  const statusRow = root.querySelector('.dev-status');
  for (const id of ['on_fire', 'frozen', 'electrified', 'powered', 'concussed']) {
    const b = document.createElement('button');
    b.textContent = id.replace('_', ' ');
    b.addEventListener('click', () => paintStatus(id));
    statusRow.appendChild(b);
  }

  // Time-scale buttons
  const timeRow = root.querySelector('.dev-time');
  for (const v of [0.1, 0.25, 0.5, 1, 2]) {
    const b = document.createElement('button');
    b.textContent = `${v}×`;
    b.addEventListener('click', () => { engine.timing.timeScale = v; });
    timeRow.appendChild(b);
  }

  // Stats demo toggle, bind state both directions: checkbox writes via
  // setStatsDemoMode, and an external change (e.g. localStorage edit) is
  // mirrored back via onStatsDemoChange.
  const demoBox = root.querySelector('[data-act="toggle-stats-demo"]');
  if (demoBox) {
    demoBox.checked = getStatsDemoMode();
    demoBox.addEventListener('change', () => setStatsDemoMode(demoBox.checked));
    onStatsDemoChange((next) => { demoBox.checked = next; });
  }

  // Action delegation
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    // Skip checkbox toggles, they handle their own change events above.
    if (t.tagName === 'INPUT') return;
    handleAction(t.dataset.act, root);
  });

  return root;
}

function handleAction(act, root) {
  switch (act) {
    case 'grant-1000':   devGrantCurrency(1000);   break;
    case 'grant-10000':  devGrantCurrency(10000);  break;
    case 'grant-100000': devGrantCurrency(100000); break;
    case 'set-currency': {
      const v = Number(root.querySelector('[data-currency-input]')?.value);
      if (Number.isFinite(v)) setCurrency(v);
      break;
    }
    case 'unlock-tools': devUnlockTools(TOOLS.map(t => t.id)); break;
    case 'unlock-nodes': devUnlockNodes(getAllNodes().map(n => n.id)); break;
    case 'clear-status': clearAllStatus(getCurrentBuddy().status); break;
    case 'reset':
      if (confirm('Wipe save (currency + unlocks + first-time bonuses)?')) resetSave();
      break;
  }
}

function setMood(m) {
  // Pin mood to the middle of the band so decay doesn't kick it out instantly.
  // m.min is the lower bound; pick a value 12 above it (or 100/-100 for caps).
  let target = m.min + 12;
  if (m.name === 'ECSTATIC') target = 100;
  if (m.name === 'BROKEN')   target = -100;
  getCurrentBuddy().mood.happiness = Math.max(-100, Math.min(100, target));
}

function paintStatus(effectId) {
  const ragdoll = getRagdoll();
  if (!ragdoll) return;
  // Reasonable defaults so the test painting reads.
  const duration = effectId === 'concussed' ? 6000
                 : effectId === 'on_fire'   ? 6000
                 : effectId === 'frozen'    ? 4000
                 : effectId === 'electrified' ? 3000
                 : 6000;
  const status = getCurrentBuddy().status;
  for (const p of ragdoll.parts) {
    applyStatus(status, p, effectId, { duration, source: 'devpanel' });
  }
}
