// Hidden admin/dev panel. Toggle with backtick (`). DEV BUILDS ONLY: main.js
// dynamically imports this module behind `import.meta.env.DEV` so Vite
// tree-shakes it out of the production bundle. Never expose otherwise, the
// panel grants free currency and unlocks every tool.
//
// Design intent: this panel is *registry-derived*, not hand-maintained. The
// character list, status painter, ability spawner, mood jumps and mode
// inspector all read from their source registries (personas, effects, TOOLS
// taxonomy, mood states, mode bus) so adding a persona / effect / tool / mode
// surfaces here automatically with zero edits to this file. A live readout
// strip (mood, fps, wallet) polls real state while the panel is open.

import { TOOLS, TOOLS_BY_ID, TAXONOMY } from './tools-table.js';
import {
  devGrantCurrency, setCurrency, devUnlockTools, devUnlockNodes,
  resetSave, getCurrency, onChange as onProgressionChange, getState,
} from '../progression/state.js';
import { getAllNodes } from '../progression/trees/index.js';
import { getAllGroupNodes } from '../progression/groups/index.js';
import { getCurrentBuddy, getRagdoll } from '../state/ragdoll-lifecycle.js';
import { engine, canvas } from '../state/world.js';
import {
  applyStatus, clearAll as clearAllStatus, buddyHas, getEffect, listEffectIds,
} from '../effects/registry.js';
import { MOOD_STATES, moodState } from '../mood.js';
import { listPersonas } from '../personas/index.js';
import { setActiveChar, getActiveChar, ACCENT } from './character-picker.js';
import { getStatsDemoMode, setStatsDemoMode, onStatsDemoChange } from './stats-popover.js';
import { getSetting, setSetting, onSettingsChange } from '../state/settings.js';
import { list as listModes, isEnabled as modeEnabled } from '../modes/bus.js';
import { applyAbility, applyDragRelease } from '../abilities/index.js';
import { abilityCtx } from '../state/ability-ctx.js';

const TABS = [
  { id: 'buddy',   label: 'buddy',   build: buildBuddyTab },
  { id: 'world',   label: 'world',   build: buildWorldTab },
  { id: 'economy', label: 'economy', build: buildEconomyTab },
  { id: 'spawn',   label: 'spawn',   build: buildSpawnTab },
];

const TIME_SCALES = [0.1, 0.25, 0.5, 1, 2];
const TOGGLE_SETTINGS = [
  { key: 'liveMode',     label: 'live mode' },
  { key: 'debugOverlay', label: 'debug overlay' },
  { key: 'reduceMotion', label: 'reduce motion' },
  { key: 'muteSFX',      label: 'mute sfx' },
];

let _root = null;
let _activeTab = 'buddy';
const _unsubs = [];

// Live-readout element refs, repopulated on each show(). The per-frame loop
// reads real state and writes here; nulled on hide.
let _live = null;
let _rafId = 0;
let _fps = 0;
let _lastFrame = 0;
let _lastPaint = 0;

// ---------- DOM helpers ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(label, onClick, cls) {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}
function section(title) {
  const s = el('div', 'dev-section');
  s.appendChild(el('div', 'dev-section-title', title));
  return s;
}
function row(...kids) {
  const r = el('div', 'dev-row');
  for (const k of kids) r.appendChild(k);
  return r;
}

// ---------- lifecycle ----------
export function bindDevPanel() {
  window.addEventListener('keydown', (e) => {
    // Skip when typing into an input (our own search/number fields included).
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '`' || e.key === '~') {
      e.preventDefault();
      toggle();
    }
  });
}

function toggle() { _root ? hide() : show(); }

function show() {
  if (_root) return;
  _live = {};
  _root = build();
  document.body.appendChild(_root);
  selectTab(_activeTab);

  // External-change subscriptions, kept in sync while the panel is open.
  _unsubs.push(onProgressionChange(() => paintLive()) || (() => {}));
  _unsubs.push(onSettingsChange(syncToggles) || (() => {}));
  _unsubs.push(onStatsDemoChange((next) => {
    if (_live?.demoBox) _live.demoBox.checked = next;
  }) || (() => {}));

  _lastFrame = 0;
  _lastPaint = 0;
  _rafId = requestAnimationFrame(tickLive);
  paintLive();
}

function hide() {
  if (!_root) return;
  cancelAnimationFrame(_rafId);
  _rafId = 0;
  for (const u of _unsubs) { try { u(); } catch {} }
  _unsubs.length = 0;
  _root.remove();
  _root = null;
  _live = null;
}

// ---------- live readout loop ----------
function tickLive(now) {
  if (_lastFrame) {
    const dt = now - _lastFrame;
    if (dt > 0) {
      const inst = 1000 / dt;
      _fps = _fps ? _fps * 0.9 + inst * 0.1 : inst;
    }
  }
  _lastFrame = now;
  // Throttle DOM writes to ~8Hz; FPS is still sampled every frame above.
  if (now - _lastPaint >= 120) { _lastPaint = now; paintLive(); }
  _rafId = requestAnimationFrame(tickLive);
}

function paintLive() {
  if (!_live) return;
  const buddy = getCurrentBuddy();
  const mood = buddy?.mood;

  if (_live.amount) _live.amount.textContent = `¢${getCurrency()}`;
  if (_live.fps) _live.fps.textContent = `${Math.round(_fps)}fps`;

  if (mood && _live.moodChip) {
    const st = moodState(mood);
    _live.moodChip.textContent = `${st.name.toLowerCase()} ${Math.round(mood.happiness)}`;
    _live.moodChip.style.color = st.color;
    // Highlight the matching mood-jump button.
    if (_live.moodBtns) {
      for (const [name, b] of _live.moodBtns) b.classList.toggle('active', name === st.name);
    }
  }

  // Status buttons reflect what's currently painted on the buddy.
  if (_live.statusBtns && buddy?.status) {
    for (const [id, b] of _live.statusBtns) {
      b.classList.toggle('active', buddyHas(buddy.status, id));
    }
  }

  // Active character chip.
  if (_live.charBtns) {
    const active = getActiveChar();
    for (const [id, b] of _live.charBtns) b.classList.toggle('active', id === active);
  }

  // Time-scale active button.
  if (_live.timeBtns) {
    const ts = engine.timing.timeScale;
    for (const [v, b] of _live.timeBtns) b.classList.toggle('active', Math.abs(v - ts) < 1e-6);
  }

  // Mode inspector dots.
  if (_live.modeDots) {
    for (const [id, dot] of _live.modeDots) dot.classList.toggle('on', modeEnabled(id));
  }

  // Lifetime economy figures.
  if (_live.lifetime) {
    const s = getState();
    _live.lifetime.textContent = `earned ${s.lifetimeEarned ?? 0} · spent ${s.lifetimeSpent ?? 0}`;
  }
}

// ---------- shell ----------
function build() {
  const root = el('div', 'dev-panel');

  // Header with live readout strip.
  const header = el('div', 'dev-panel-header');
  header.appendChild(el('span', 'dev-panel-brand', 'dev'));
  const readout = el('div', 'dev-readout');
  _live.moodChip = el('span', 'dev-readout-mood', '—');
  _live.fps = el('span', 'dev-readout-fps', '0fps');
  _live.amount = el('span', 'dev-readout-amount', '¢0');
  readout.append(_live.moodChip, _live.fps, _live.amount);
  header.appendChild(readout);
  const close = btn('×', hide, 'dev-panel-close');
  close.setAttribute('aria-label', 'close');
  header.appendChild(close);
  root.appendChild(header);

  // Tab strip.
  const tabBar = el('div', 'dev-tabs');
  _live.tabBtns = new Map();
  for (const t of TABS) {
    const b = btn(t.label, () => selectTab(t.id), 'dev-tab');
    _live.tabBtns.set(t.id, b);
    tabBar.appendChild(b);
  }
  root.appendChild(tabBar);

  // Body, one panel per tab (built once, shown/hidden).
  const body = el('div', 'dev-body');
  _live.panels = new Map();
  for (const t of TABS) {
    const panel = el('div', 'dev-tabpanel');
    panel.appendChild(t.build());
    _live.panels.set(t.id, panel);
    body.appendChild(panel);
  }
  root.appendChild(body);

  root.appendChild(el('div', 'dev-panel-hint', '` toggle'));
  return root;
}

function selectTab(id) {
  if (!TABS.some(t => t.id === id)) id = 'buddy';
  _activeTab = id;
  if (!_live) return;
  for (const [tid, b] of _live.tabBtns) b.classList.toggle('active', tid === id);
  for (const [tid, p] of _live.panels) p.hidden = tid !== id;
  paintLive();
}

// ---------- buddy tab ----------
function buildBuddyTab() {
  const frag = document.createDocumentFragment();

  // Character switcher, derived from the persona registry.
  const charSec = section('character');
  const charRow = el('div', 'dev-row dev-chips');
  _live.charBtns = new Map();
  for (const p of listPersonas()) {
    const b = btn(p.displayName, () => setActiveChar(p.id), 'dev-chip');
    b.style.setProperty('--chip-accent', ACCENT[p.id] || 'var(--fg)');
    b.title = p.provider || p.displayName;
    _live.charBtns.set(p.id, b);
    charRow.appendChild(b);
  }
  charSec.appendChild(charRow);
  charSec.appendChild(row(btn('respawn', () => setActiveChar(getActiveChar()))));
  frag.appendChild(charSec);

  // Mood jumps, derived from MOOD_STATES.
  const moodSec = section('mood');
  const moodRow = el('div', 'dev-row');
  _live.moodBtns = new Map();
  for (const m of MOOD_STATES) {
    const b = btn(m.name.toLowerCase(), () => setMood(m));
    b.style.setProperty('--btn-tint', m.color);
    _live.moodBtns.set(m.name, b);
    moodRow.appendChild(b);
  }
  moodSec.appendChild(moodRow);
  frag.appendChild(moodSec);

  // Status painter, derived from the effects registry (auto-scales).
  const statusSec = section('status · all parts');
  const statusRow = el('div', 'dev-row');
  _live.statusBtns = new Map();
  for (const id of listEffectIds()) {
    const b = btn(id.replace(/_/g, ' '), () => paintStatus(id));
    _live.statusBtns.set(id, b);
    statusRow.appendChild(b);
  }
  statusSec.appendChild(statusRow);
  statusSec.appendChild(row(btn('clear all', () => {
    const buddy = getCurrentBuddy();
    if (buddy?.status) clearAllStatus(buddy.status);
  }, 'danger')));
  frag.appendChild(statusSec);

  return frag;
}

// ---------- world tab ----------
function buildWorldTab() {
  const frag = document.createDocumentFragment();

  // Time scale.
  const timeSec = section('time scale');
  const timeRow = el('div', 'dev-row');
  _live.timeBtns = new Map();
  for (const v of TIME_SCALES) {
    const b = btn(`${v}×`, () => { engine.timing.timeScale = v; });
    _live.timeBtns.set(v, b);
    timeRow.appendChild(b);
  }
  timeSec.appendChild(timeRow);
  frag.appendChild(timeSec);

  // Settings toggles + theme.
  const setSec = section('settings');
  _live.toggleBoxes = new Map();
  for (const s of TOGGLE_SETTINGS) {
    const label = el('label', 'dev-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!getSetting(s.key);
    box.addEventListener('change', () => setSetting(s.key, box.checked));
    _live.toggleBoxes.set(s.key, box);
    label.append(box, el('span', null, s.label));
    setSec.appendChild(row(label));
  }
  _live.themeBtn = btn('', toggleTheme);
  syncThemeBtn();
  setSec.appendChild(row(_live.themeBtn));
  frag.appendChild(setSec);

  // Mode inspector, derived from the bus (read-only live observability).
  const modeSec = section('modes · live');
  _live.modeDots = new Map();
  const modes = listModes().sort((a, b) => a.id.localeCompare(b.id));
  for (const m of modes) {
    const r = el('div', 'dev-mode-row');
    const dot = el('span', 'dev-mode-dot');
    _live.modeDots.set(m.id, dot);
    r.append(dot, el('span', 'dev-mode-id', m.id), el('span', 'dev-mode-phase', m.phase));
    modeSec.appendChild(r);
  }
  frag.appendChild(modeSec);

  return frag;
}

// ---------- economy tab ----------
function buildEconomyTab() {
  const frag = document.createDocumentFragment();

  const curSec = section('currency');
  curSec.appendChild(row(
    btn('+1k',   () => devGrantCurrency(1000)),
    btn('+10k',  () => devGrantCurrency(10000)),
    btn('+100k', () => devGrantCurrency(100000)),
  ));
  const setInput = el('input');
  setInput.type = 'number';
  setInput.min = '0';
  setInput.value = '0';
  setInput.placeholder = 'set to…';
  curSec.appendChild(row(setInput, btn('set', () => {
    const v = Number(setInput.value);
    if (Number.isFinite(v)) setCurrency(v);
  })));
  _live.lifetime = el('div', 'dev-note', 'earned 0 · spent 0');
  curSec.appendChild(_live.lifetime);
  frag.appendChild(curSec);

  const unlockSec = section('unlocks');
  unlockSec.appendChild(row(
    btn('all tools', () => devUnlockTools(TOOLS.map(t => t.id))),
    btn('all upgrades', () => {
      // Group tool-nodes unlock tools; group stat-nodes + master-tree nodes
      // tune STATS. Unlock everything in one pass so the dev sees a fully
      // upgraded build.
      const ids = [...getAllGroupNodes(), ...getAllNodes()].map(n => n.id);
      devUnlockTools(TOOLS.map(t => t.id));
      devUnlockNodes(ids);
    }),
  ));
  frag.appendChild(unlockSec);

  const statsSec = section('stats dashboard');
  const demoLabel = el('label', 'dev-toggle');
  _live.demoBox = el('input');
  _live.demoBox.type = 'checkbox';
  _live.demoBox.checked = getStatsDemoMode();
  _live.demoBox.addEventListener('change', () => setStatsDemoMode(_live.demoBox.checked));
  demoLabel.append(_live.demoBox, el('span', null, 'demo data'));
  statsSec.appendChild(row(demoLabel));
  frag.appendChild(statsSec);

  const saveSec = section('save');
  saveSec.appendChild(row(btn('reset save', () => {
    if (confirm('Wipe save (currency + unlocks + first-time bonuses)?')) resetSave();
  }, 'danger')));
  frag.appendChild(saveSec);

  return frag;
}

// ---------- spawn tab ----------
function buildSpawnTab() {
  const frag = document.createDocumentFragment();

  const search = el('input', 'dev-search');
  search.type = 'search';
  search.placeholder = 'fire any tool at the buddy…';
  frag.appendChild(search);

  const list = el('div', 'dev-spawn-list');
  const groupBlocks = []; // { groupId, header, buttons:[{el,hay}] }

  // Index tools by group so we render in TAXONOMY order, registry-derived.
  const byGroup = new Map();
  for (const t of TOOLS) {
    if (!byGroup.has(t.group)) byGroup.set(t.group, []);
    byGroup.get(t.group).push(t);
  }

  for (const spine of TAXONOMY) {
    for (const g of spine.groups) {
      const tools = byGroup.get(g.id);
      if (!tools || !tools.length) continue;
      const block = el('div', 'dev-spawn-group');
      block.dataset.group = g.id;
      const header = el('div', 'dev-spawn-group-title', g.label);
      block.appendChild(header);
      const grid = el('div', 'dev-row dev-spawn-grid');
      const buttons = [];
      for (const t of tools) {
        const b = btn(t.label, () => fireTool(t.id), 'dev-spawn-tile');
        b.title = `${t.id} · ${t.kind} · ${t.delta}`;
        if (t.key) b.appendChild(el('kbd', 'dev-key', t.key));
        grid.appendChild(b);
        buttons.push({ el: b, hay: `${t.id} ${t.label} ${g.id}`.toLowerCase() });
      }
      block.appendChild(grid);
      list.appendChild(block);
      groupBlocks.push({ block, header, buttons });
    }
  }
  frag.appendChild(list);

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const grp of groupBlocks) {
      let anyVisible = false;
      for (const item of grp.buttons) {
        const match = !q || item.hay.includes(q);
        item.el.hidden = !match;
        if (match) anyVisible = true;
      }
      grp.block.hidden = !anyVisible;
    }
  });

  return frag;
}

// ---------- actions ----------
function fireTool(id) {
  const rag = getRagdoll();
  const tool = TOOLS_BY_ID[id];
  if (!rag || !tool) return;
  const p = rag.chest?.position || rag.parts?.[1]?.position
        || { x: canvas.width / 2, y: canvas.height / 2 };
  if (tool.kind === 'drag') {
    // Drag tools (grenade, caltrops, grab) read a release vector, not a click.
    // Default to a short upward toss so the throwable lands near the buddy.
    applyDragRelease(id, abilityCtx({
      x: p.x, y: p.y, dx: 0, dy: -220, dragVec: { x: 0, y: -220 }, _verb: id,
    }));
  } else {
    applyAbility(id, abilityCtx({ x: p.x, y: p.y, dx: 0, dy: 0, _verb: id }));
  }
}

function setMood(m) {
  // Pin to the middle of the band so decay doesn't kick it out instantly.
  let target = m.min + 12;
  if (m.name === 'ECSTATIC') target = 100;
  if (m.name === 'BROKEN')   target = -100;
  const buddy = getCurrentBuddy();
  if (buddy?.mood) buddy.mood.happiness = Math.max(-100, Math.min(100, target));
}

function paintStatus(effectId) {
  const ragdoll = getRagdoll();
  const buddy = getCurrentBuddy();
  if (!ragdoll || !buddy) return;
  // Use the effect's own default where it's a finite duration; otherwise give
  // 'persistent' effects a long-but-finite dev window so they auto-clear.
  const dd = getEffect(effectId)?.defaultDuration;
  const duration = (typeof dd === 'number' && dd > 0) ? Math.max(dd, 4000) : 6000;
  for (const p of ragdoll.parts) {
    applyStatus(buddy.status, p, effectId, { duration, source: 'devpanel' });
  }
}

function toggleTheme() {
  setSetting('theme', getSetting('theme') === 'dark' ? 'light' : 'dark');
  syncThemeBtn();
}
function syncThemeBtn() {
  if (_live?.themeBtn) _live.themeBtn.textContent = `theme: ${getSetting('theme')}`;
}

function syncToggles() {
  if (!_live) return;
  if (_live.toggleBoxes) {
    for (const [key, box] of _live.toggleBoxes) box.checked = !!getSetting(key);
  }
  syncThemeBtn();
}
