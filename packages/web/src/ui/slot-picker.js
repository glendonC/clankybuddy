// Unified shop + equip picker, Destiny-inventory two-stage inspect.
//
// PICKER (compact, grid-only): single-column tile grid grouped by spine→group
// + a MASTERY section at the bottom. ~520px wide anchored to a hotbar slot,
// ~600px centered. No right pane, the picker is purely for picking.
//
// HOVER TOOLTIP: a single shared floating element (built once, reused on
// every hover) anchored next to the hovered tile. Compact: small icon,
// name, group · spine, chip row, one-line blurb, ownership state, and a
// "details" button in the footer. Pointer-events: auto so the user can
// move the cursor into the tooltip without it disappearing, the exit
// delay (~180ms) lets brief hover-out flickers settle.
//
// INSPECT OVERLAY: a separate larger modal stacked on top of the picker
// (~720×540). Shows the full detail: big icon, all chips, full blurb,
// per-tool progression chain with buyable pills, and a contextual CTA
// (equip / unlock / etc). Opened via:
//   - click on a LOCKED tool tile (can't equip a locked tool, so jump to inspect)
//   - click the tooltip's "details" button
//   - right-click any tile (mouse or touchpad two-finger)
//   - openPicker({toolId}) from elsewhere boots straight into inspect
// Closed via × button or Esc. Esc cascades: inspect open → close inspect;
// else → close picker.
//
// TOUCH: `@media (hover: none) and (pointer: coarse)` swaps the picker
// into a 2-pane layout where the right pane shows the last-tapped tile's
// detail (no floating tooltip). Tooltip is suppressed on touch since
// hover doesn't exist there.

import { TOOLS, TOOLS_BY_ID, TAXONOMY } from './tools-table.js';
import { ICONS } from './icons.js';
import {
  getUnlockedTools, getUnlockedNodes, getUnlockedNodesGlobal, getCurrency,
  equipTool, equipToolInSlot, unequipTool, findEquippedSlot,
  unlockNode, isToolEquipped,
  onChange as onProgressionChange,
} from '../progression/state.js';
import { getNodesForTool, getSharedNodesForFamily } from '../progression/groups/index.js';
import { MASTER_TREE } from '../progression/trees/index.js';
import { endPress } from '../input/mouse.js';

// ---------- module state ----------

let _root = null;
let _anchor = null;        // null when in centered mode
let _onDocClick = null;
let _barIdx = -1;
let _slotIdx = -1;
let _unsubscribe = null;

// Tooltip state (single shared DOM node, lives on document.body).
let _ttEl       = null;
let _ttFor      = null;    // { kind:'tool'|'master', id, tileEl } currently shown, or null
let _ttHideTimer = 0;
let _ttRepoRaf  = 0;

// Inspect overlay state (stacked modal, lives on document.body when open).
let _ovEl       = null;
let _ovKind     = null;    // 'tool' | 'master'
let _ovId       = null;

const MASTERY = '__mastery__';
const TOOLTIP_HIDE_DELAY_MS = 180;

// ---------- public API ----------

export function isSlotPickerOpen() { return _root !== null; }

export function openSlotPicker(barIdx, slotIdx, anchorEl) {
  _open({ barIdx, slotIdx, anchorEl });
}

export function openPicker(opts = {}) {
  _open({ barIdx: -1, slotIdx: -1, anchorEl: null });
  if (opts.toolId) openInspect('tool', opts.toolId);
}

export function closeSlotPicker() {
  if (!_root) return;
  closeInspect();
  removeTooltip();
  _root.remove();
  _root = null;
  _anchor = null;
  if (_onDocClick) document.removeEventListener('click', _onDocClick);
  _onDocClick = null;
  if (typeof _unsubscribe === 'function') _unsubscribe();
  _unsubscribe = null;
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', position);
}

function _open({ barIdx, slotIdx, anchorEl }) {
  if (_root) closeSlotPicker();
  endPress(); // cancel any held attack so opening doesn't keep firing
  _anchor = anchorEl || null;
  _barIdx = barIdx;
  _slotIdx = slotIdx;
  _root = build();
  document.body.appendChild(_root);
  position();
  _onDocClick = (e) => {
    if (!_root) return;
    if (_root.contains(e.target)) return;
    if (_ovEl && _ovEl.contains(e.target)) return;
    if (_ttEl && _ttEl.contains(e.target)) return;
    if (_anchor && _anchor.contains(e.target)) return;
    closeSlotPicker();
  };
  setTimeout(() => document.addEventListener('click', _onDocClick), 0);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', position);
  _unsubscribe = onProgressionChange(() => {
    if (!_root) return;
    rerenderPicker();
    if (_ovEl) renderInspectOverlay();
  });
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (_ovEl) closeInspect();
  else closeSlotPicker();
}

function rerenderPicker() {
  if (!_root) return;
  _root.innerHTML = '';
  _root.appendChild(buildHeader());
  _root.appendChild(buildLeftPane());
  _root.appendChild(buildFooter());
  position();
}

// ---------- DOM build (picker shell) ----------

function build() {
  const root = document.createElement('div');
  root.className = 'slot-picker';
  if (!_anchor) root.classList.add('centered');
  root.appendChild(buildHeader());
  root.appendChild(buildLeftPane());
  root.appendChild(buildFooter());
  return root;
}

function buildHeader() {
  const head = document.createElement('div');
  head.className = 'slot-picker-header';
  const eyebrow = _anchor ? 'equip into slot' : 'shop';
  const slotChip = _anchor
    ? `<span class="slot-picker-slotchip">${slotLabel(_barIdx, _slotIdx)}</span>`
    : '';
  head.innerHTML = `
    <span class="slot-picker-eyebrow">${eyebrow}</span>
    ${slotChip}
    <button class="slot-picker-close" aria-label="close">×</button>
  `;
  head.querySelector('.slot-picker-close').addEventListener('click', closeSlotPicker);
  return head;
}

function buildLeftPane() {
  const left = document.createElement('div');
  left.className = 'slot-picker-left';
  const owned = new Set(getUnlockedTools());
  for (const spine of TAXONOMY) {
    for (const group of spine.groups) {
      // Skip `system: true` tools (grab), they live in fixed slots outside
      // the hotbar and aren't equippable, so they don't belong in the grid.
      const tools = TOOLS.filter(t =>
        t.spine === spine.spine && t.group === group.id && !t.system
      );
      if (!tools.length) continue;
      left.appendChild(buildGroup(spine.spine, group.id, group.label, tools, owned));
    }
  }
  const mastery = buildMasterySection();
  if (mastery) left.appendChild(mastery);
  // Hide tooltip when the user scrolls the grid, anchor would drift.
  // Also drive the top/bottom edge-fade markers (mirrors log.js pattern).
  const updateFade = () => {
    const atTop = left.scrollTop <= 1;
    const atBottom = (left.scrollHeight - left.scrollTop - left.clientHeight) <= 1;
    left.dataset.atTop = String(atTop);
    left.dataset.atBottom = String(atBottom);
  };
  left.addEventListener('scroll', () => {
    requestRepositionTooltip();
    updateFade();
  });
  // Initial pass deferred until the element is in the DOM and has measurable size.
  requestAnimationFrame(updateFade);
  return left;
}

function buildFooter() {
  const foot = document.createElement('div');
  foot.className = 'slot-picker-footer';
  const clickLabel = _anchor ? 'click to equip' : 'click affordable to buy';
  foot.innerHTML = `
    <span class="slot-picker-hint">
      <span class="sp-hint-item">${HINT_ICON.hover}<span>hover for info</span></span>
      <span class="sp-hint-sep" aria-hidden="true">·</span>
      <span class="sp-hint-item">${HINT_ICON.click}<span>${clickLabel}</span></span>
      <span class="sp-hint-sep" aria-hidden="true">·</span>
      <span class="sp-hint-item">${HINT_ICON.rightclick}<span>right-click for details</span></span>
    </span>
  `;
  return foot;
}

// Small inline pictograms for the footer hint row. 14×14 viewBox,
// stroked at 1.4 so they read at 12px next to the lowercase text.
const HINT_ICON = {
  hover: `<svg class="sp-hint-icon" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="6" cy="6" r="3.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M8.7 8.7 L12 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`,
  click: `<svg class="sp-hint-icon" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 2 L3 11.5 L5.4 9.2 L7 12.6 L8.5 12 L7 8.6 L10.5 8.6 Z"
      fill="currentColor" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/>
  </svg>`,
  rightclick: `<svg class="sp-hint-icon" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M4.5 1.5 H9.5 A3 3 0 0 1 12.5 4.5 V9.5 A3 3 0 0 1 9.5 12.5 H4.5 A3 3 0 0 1 1.5 9.5 V4.5 A3 3 0 0 1 4.5 1.5 Z"
      fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M7 1.6 V6.6 H12.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M7 2 H9.5 A3 3 0 0 1 12.4 4.9 V6.4 H7 Z" fill="currentColor" opacity="0.55"/>
  </svg>`,
};

// State pictograms used in the tooltip footer. Same 14×14 viewBox + 1.3
// stroke as the hint-row icons so the two footers feel like one family.
const STATE_ICON = {
  // checkmark in circle, "you have this"
  owned: `<svg class="sp-state-icon" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M4.5 7.2 L6.3 9 L9.7 5.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  // pin, "slotted in"
  equipped: `<svg class="sp-state-icon" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.5 V6 M4.2 6 H9.8 L11 7.4 H3 Z M7 7.4 V12.5" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
  </svg>`,
  // padlock, "not yet"
  locked: `<svg class="sp-state-icon" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="2.5" y="6.5" width="9" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <path d="M4.5 6.5 V4.5 A2.5 2.5 0 0 1 9.5 4.5 V6.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`,
  // sparkle, "available to buy (mastery)"
  available: `<svg class="sp-state-icon" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1 L8.3 5.7 L13 7 L8.3 8.3 L7 13 L5.7 8.3 L1 7 L5.7 5.7 Z" fill="currentColor"/>
  </svg>`,
};

function buildGroup(spine, groupId, label, tools, owned) {
  const wrap = document.createElement('div');
  wrap.className = 'slot-picker-group';
  wrap.dataset.spine = spine;
  wrap.dataset.group = groupId;
  const head = document.createElement('div');
  head.className = 'slot-picker-group-label';
  head.textContent = label;
  wrap.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'slot-picker-grid';
  for (const t of tools) grid.appendChild(buildTile(t, owned.has(t.id)));
  wrap.appendChild(grid);
  return wrap;
}

function buildMasterySection() {
  // Mastery retired 2026-05-24, when MASTER_TREE is empty, skip the section
  // entirely rather than render an empty header. Caller appends only if non-null.
  if (!MASTER_TREE.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'slot-picker-group';
  wrap.dataset.group = MASTERY;
  const head = document.createElement('div');
  head.className = 'slot-picker-group-label';
  head.textContent = 'mastery';
  wrap.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'slot-picker-mastery-grid';
  for (const n of MASTER_TREE) grid.appendChild(buildMasteryTile(n));
  wrap.appendChild(grid);
  return wrap;
}

function buildTile(tool, isOwned) {
  const btn = document.createElement('button');
  btn.className = 'slot-picker-tile';
  btn.dataset.spine = tool.spine;
  btn.dataset.group = tool.group;
  btn.dataset.tool  = tool.id;
  if (!isOwned) btn.classList.add('locked');

  const equippedAt = isOwned ? findEquippedSlot(tool.id) : null;
  const isHere      = _anchor && equippedAt && equippedAt.bar === _barIdx && equippedAt.slot === _slotIdx;
  const isElsewhere = equippedAt && !isHere;
  if (isHere)            btn.classList.add('equipped-here');
  else if (isElsewhere)  btn.classList.add('equipped-elsewhere');

  const iconSvg = renderIconSvg(tool.id, 'slot-picker-tile-icon');
  const cost = !isOwned && typeof tool.cost === 'number' ? tool.cost : null;
  const overlay = cost != null
    ? `<span class="slot-picker-tile-cost">${cost}¢</span>`
    : (isHere ? `<span class="slot-picker-tile-dot" aria-hidden="true"></span>` : '');
  const tierMarkup = isOwned ? buildTierDots(tool.id) : '';

  btn.innerHTML = `
    ${iconSvg}
    <span class="slot-picker-tile-label">${tool.label}</span>
    ${overlay}
    ${tierMarkup}
  `;

  bindTileHover(btn, 'tool', tool.id);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isOwned) { openInspect('tool', tool.id); return; }
    if (isHere) { closeSlotPicker(); return; }
    if (_anchor) equipToolInSlot(tool.id, _barIdx, _slotIdx);
    else equipTool(tool.id);
    closeSlotPicker();
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInspect('tool', tool.id);
  });
  return btn;
}

function buildMasteryTile(node) {
  const btn = document.createElement('button');
  btn.className = 'slot-picker-mastery-tile';
  btn.dataset.master = node.id;

  // Master tree is GLOBAL (v5), read from the global slot, not the
  // active char's per-char unlockedNodes.
  const owned = new Set(getUnlockedNodesGlobal());
  const isOwned    = owned.has(node.id);
  const parentsOk  = (node.parents || []).every(p => owned.has(p));
  const canAfford  = getCurrency() >= (node.cost || 0);
  const state      = isOwned ? 'owned' : (parentsOk ? (canAfford ? 'affordable' : 'unaffordable') : 'locked');
  btn.dataset.state = state;
  btn.innerHTML = `
    <span class="slot-picker-mastery-bullet" aria-hidden="true"></span>
    <span class="slot-picker-mastery-label">${escapeHTML(node.label)}</span>
    <span class="slot-picker-mastery-cost">${isOwned ? '✓' : node.cost + '¢'}</span>
  `;
  bindTileHover(btn, 'master', node.id);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state === 'affordable') unlockNode(node.id, node.cost);
    else openInspect('master', node.id);
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInspect('master', node.id);
  });
  return btn;
}

function bindTileHover(btn, kind, id) {
  btn.addEventListener('mouseenter', () => showTooltipFor(kind, id, btn));
  btn.addEventListener('focus',     () => showTooltipFor(kind, id, btn));
  btn.addEventListener('mouseleave', scheduleTooltipHide);
  btn.addEventListener('blur',      scheduleTooltipHide);
}

// ---------- floating tooltip ----------

function ensureTooltip() {
  if (_ttEl) return _ttEl;
  _ttEl = document.createElement('div');
  _ttEl.className = 'sp-tooltip';
  _ttEl.setAttribute('role', 'tooltip');
  _ttEl.setAttribute('aria-hidden', 'true');
  // Tooltip stays open while the cursor is over it (so the user can click
  // its "details" button). Schedule-hide when leaving.
  _ttEl.addEventListener('mouseenter', cancelTooltipHide);
  _ttEl.addEventListener('mouseleave', scheduleTooltipHide);
  document.body.appendChild(_ttEl);
  return _ttEl;
}

function removeTooltip() {
  cancelTooltipHide();
  if (_ttEl) { _ttEl.remove(); _ttEl = null; }
  _ttFor = null;
}

function showTooltipFor(kind, id, tileEl) {
  // Suppress the floating tooltip when the inspect overlay is open, the
  // overlay already shows full detail, more would be visual noise.
  if (_ovEl) return;
  cancelTooltipHide();
  const el = ensureTooltip();
  _ttFor = { kind, id, tileEl };
  el.innerHTML = buildTooltipBody(kind, id);
  el.dataset.kind = kind;
  if (kind === 'tool') {
    const t = TOOLS_BY_ID[id];
    el.dataset.spine = t?.spine || '';
    el.dataset.group = t?.group || '';
  } else {
    el.dataset.spine = '';
    el.dataset.group = MASTERY;
  }
  // Wire the "details" button.
  const moreBtn = el.querySelector('.sp-tt-more');
  if (moreBtn) {
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      openInspect(kind, id);
    };
  }
  el.setAttribute('aria-hidden', 'false');
  positionTooltip(tileEl);
}

function scheduleTooltipHide() {
  cancelTooltipHide();
  _ttHideTimer = window.setTimeout(hideTooltip, TOOLTIP_HIDE_DELAY_MS);
}

function cancelTooltipHide() {
  if (_ttHideTimer) { clearTimeout(_ttHideTimer); _ttHideTimer = 0; }
}

function hideTooltip() {
  if (!_ttEl) return;
  _ttEl.setAttribute('aria-hidden', 'true');
  _ttFor = null;
}

function requestRepositionTooltip() {
  if (!_ttFor || !_ttEl) return;
  if (_ttRepoRaf) return;
  _ttRepoRaf = requestAnimationFrame(() => {
    _ttRepoRaf = 0;
    if (_ttFor && _ttEl) positionTooltip(_ttFor.tileEl);
  });
}

// Anchor next to the tile. Prefer right; flip left if it would overflow.
// Vertically center on the tile, clamped to viewport.
function positionTooltip(tileEl) {
  if (!_ttEl || !tileEl) return;
  const a = tileEl.getBoundingClientRect();
  const tw = _ttEl.offsetWidth || 240;
  const th = _ttEl.offsetHeight || 180;
  const margin = 8, gap = 10;
  let left = a.right + gap;
  if (left + tw + margin > window.innerWidth) left = a.left - gap - tw;
  if (left < margin) left = Math.max(margin, Math.min(a.left, window.innerWidth - tw - margin));
  let top = Math.round(a.top + a.height / 2 - th / 2);
  top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
  _ttEl.style.left = left + 'px';
  _ttEl.style.top  = top + 'px';
}

function buildTooltipBody(kind, id) {
  if (kind === 'master') return buildMasterTooltip(id);
  return buildToolTooltip(id);
}

function buildToolTooltip(toolId) {
  const tool = TOOLS_BY_ID[toolId];
  if (!tool) return '';
  const owned = getUnlockedTools().includes(toolId);
  const eq    = owned ? findEquippedSlot(toolId) : null;
  const stateLabel = !owned
    ? `locked · ${tool.cost ?? '—'}¢`
    : (eq ? `equipped · slot ${slotLabel(eq.bar, eq.slot)}` : `owned`);
  const stateKey = !owned ? 'locked' : (eq ? 'equipped' : 'owned');
  const chips = [];
  if (tool.delta) chips.push(`<span class="ip-chip ip-chip-delta">${tool.delta}</span>`);
  if (tool.kind)  chips.push(`<span class="ip-chip">${kindLabel(tool.kind)}</span>`);
  if (tool.cd)    chips.push(`<span class="ip-chip ip-chip-cd">${tool.cd}s cd</span>`);
  if (tool.key)   chips.push(`<span class="ip-chip ip-chip-key">${tool.key}</span>`);
  return `
    <div class="sp-tt-head">
      <div class="sp-tt-icon">${renderIconSvg(toolId, 'sp-tt-icon-svg')}</div>
      <div class="sp-tt-meta">
        <div class="sp-tt-name">${escapeHTML(tool.label)}</div>
      </div>
    </div>
    <div class="sp-tt-chips">${chips.join('')}</div>
    <div class="sp-tt-blurb">${escapeHTML(tool.blurb || '')}</div>
    <div class="sp-tt-foot">
      <span class="sp-tt-state" data-state="${stateKey}">
        ${STATE_ICON[stateKey] || ''}<span>${stateLabel}</span>
      </span>
      <button class="sp-tt-more" type="button">details →</button>
    </div>
  `;
}

function buildMasterTooltip(nodeId) {
  const node = MASTER_TREE.find(n => n.id === nodeId);
  if (!node) return '';
  const owned = new Set(getUnlockedNodesGlobal());
  const isOwned   = owned.has(node.id);
  const parentsOk = (node.parents || []).every(p => owned.has(p));
  const canAfford = getCurrency() >= (node.cost || 0);
  const stateLabel = isOwned ? 'owned' : (parentsOk ? (canAfford ? `available · ${node.cost}¢` : `needs ${node.cost}¢`) : 'locked');
  const stateKey = isOwned ? 'owned' : (parentsOk && canAfford ? 'available' : 'locked');
  return `
    <div class="sp-tt-head">
      <div class="sp-tt-icon" data-mastery="true">
        <svg viewBox="-16 -16 32 32" class="sp-tt-icon-svg" aria-hidden="true">
          <path d="${ICONS.__star.d}" class="icon-stroke"/>
        </svg>
      </div>
      <div class="sp-tt-meta">
        <div class="sp-tt-name">${escapeHTML(node.label)}</div>
      </div>
    </div>
    <div class="sp-tt-chips">
      <span class="ip-chip ip-chip-cd">${node.cost}¢</span>
    </div>
    <div class="sp-tt-blurb">${escapeHTML(node.blurb || '')}</div>
    <div class="sp-tt-foot">
      <span class="sp-tt-state" data-state="${stateKey}">
        ${STATE_ICON[stateKey] || ''}<span>${stateLabel}</span>
      </span>
      <button class="sp-tt-more" type="button">details →</button>
    </div>
  `;
}

// ---------- inspect overlay (stacked on top of picker) ----------

function openInspect(kind, id) {
  hideTooltip();
  _ovKind = kind;
  _ovId = id;
  if (!_ovEl) {
    _ovEl = document.createElement('div');
    _ovEl.className = 'sp-inspect-overlay';
    document.body.appendChild(_ovEl);
  }
  renderInspectOverlay();
}

function closeInspect() {
  if (!_ovEl) return;
  _ovEl.remove();
  _ovEl = null;
  _ovKind = null;
  _ovId = null;
}

function renderInspectOverlay() {
  if (!_ovEl) return;
  if (_ovKind === 'master') {
    renderMasterInspect(_ovEl, _ovId);
    return;
  }
  renderToolInspect(_ovEl, _ovId);
}

function renderToolInspect(host, toolId) {
  const tool = TOOLS_BY_ID[toolId];
  if (!tool) { closeInspect(); return; }
  host.dataset.spine = tool.spine;
  host.dataset.group = tool.group;
  const owned = new Set(getUnlockedTools());
  const isOwned = owned.has(tool.id);
  const equippedAt = isOwned ? findEquippedSlot(tool.id) : null;
  const isHere      = _anchor && equippedAt && equippedAt.bar === _barIdx && equippedAt.slot === _slotIdx;
  const isElsewhere = equippedAt && !isHere;
  host.innerHTML = `
    <div class="sp-inspect-card">
      <div class="sp-inspect-header">
        <button class="sp-inspect-back" type="button" aria-label="back">◀ back</button>
        <span class="sp-inspect-eyebrow">inspect</span>
        <button class="sp-inspect-close" type="button" aria-label="close">×</button>
      </div>
      <div class="slot-picker-right" data-spine="${tool.spine}" data-group="${tool.group}" data-empty="false">
        <div class="slot-picker-inspect-head">
          <div class="slot-picker-inspect-icon">${renderIconSvg(tool.id, 'slot-picker-inspect-icon-svg')}</div>
          <div class="slot-picker-inspect-meta">
            <div class="slot-picker-inspect-name">${escapeHTML(tool.label)}</div>
          </div>
        </div>
        <div class="slot-picker-inspect-chips">${buildToolChips(tool)}</div>
        <div class="slot-picker-inspect-blurb">${escapeHTML(tool.blurb || '')}</div>
        ${buildProgressChain(tool.id)}
        <div class="slot-picker-inspect-footer">${buildToolCta(tool, isOwned, isHere, isElsewhere)}</div>
      </div>
    </div>
  `;
  wireInspectOverlay(host, { kind: 'tool', id: tool.id });
}

function renderMasterInspect(host, nodeId) {
  const node = MASTER_TREE.find(n => n.id === nodeId);
  if (!node) { closeInspect(); return; }
  host.dataset.spine = '';
  host.dataset.group = MASTERY;
  const owned = new Set(getUnlockedNodesGlobal());
  const isOwned   = owned.has(node.id);
  const parentsOk = (node.parents || []).every(p => owned.has(p));
  const canAfford = getCurrency() >= (node.cost || 0);

  let cta;
  if (isOwned) {
    cta = `<button class="slot-picker-cta" data-state="equipped" disabled>owned</button>`;
  } else if (!parentsOk) {
    const missing = node.parents
      .filter(p => !owned.has(p))
      .map(p => MASTER_TREE.find(n => n.id === p)?.label || p)
      .join(' + ');
    cta = `<button class="slot-picker-cta" data-state="locked" disabled>needs ${escapeHTML(missing)}</button>`;
  } else if (!canAfford) {
    cta = `<button class="slot-picker-cta" data-state="locked" disabled>${node.cost}¢ needed</button>`;
  } else {
    cta = `<button class="slot-picker-cta" data-state="buy" data-master="${node.id}" data-cost="${node.cost}">unlock, ${node.cost}¢</button>`;
  }

  const listed = [...MASTER_TREE].sort((a, b) => (a.cost || 0) - (b.cost || 0));
  const pills = listed.map(n => {
    const o = owned.has(n.id);
    const pOk = (n.parents || []).every(p => owned.has(p));
    const can = getCurrency() >= (n.cost || 0);
    const st = o ? 'owned' : (pOk ? (can ? 'affordable' : 'unaffordable') : 'locked');
    const buyable = st === 'affordable';
    const data = buyable ? `data-buyable="true" data-master="${n.id}" data-cost="${n.cost}"` : '';
    return `
      <li class="ip-node" data-state="${st}" data-kind="stat" ${data}>
        <div class="ip-node-bullet" aria-hidden="true"></div>
        <div class="ip-node-body">
          <div class="ip-node-label">${escapeHTML(n.label)}</div>
          <div class="ip-node-blurb">${escapeHTML(n.blurb || '')}</div>
        </div>
        <div class="ip-node-cost" data-state="${st}">${o ? '✓' : n.cost + '¢'}</div>
      </li>
    `;
  }).join('');
  host.innerHTML = `
    <div class="sp-inspect-card">
      <div class="sp-inspect-header">
        <button class="sp-inspect-back" type="button" aria-label="back">◀ back</button>
        <span class="sp-inspect-eyebrow">inspect</span>
        <button class="sp-inspect-close" type="button" aria-label="close">×</button>
      </div>
      <div class="slot-picker-right" data-group="${MASTERY}" data-empty="false">
        <div class="slot-picker-inspect-head">
          <div class="slot-picker-inspect-icon" data-mastery="true">
            <svg viewBox="-16 -16 32 32" class="slot-picker-inspect-icon-svg" aria-hidden="true">
              <path d="${ICONS.__star.d}" class="icon-stroke"/>
            </svg>
          </div>
          <div class="slot-picker-inspect-meta">
            <div class="slot-picker-inspect-name">${escapeHTML(node.label)}</div>
          </div>
        </div>
        <div class="slot-picker-inspect-chips">
          <span class="ip-chip ip-chip-cd">${node.cost}¢</span>
        </div>
        <div class="slot-picker-inspect-blurb">${escapeHTML(node.blurb || '')}</div>
        <div class="slot-picker-inspect-progress">
          <div class="ip-progress-head">
            <span class="ip-progress-title">mastery tree</span>
            <span class="ip-progress-count">${[...MASTER_TREE].filter(n => owned.has(n.id)).length} / ${MASTER_TREE.length}</span>
          </div>
          <ul class="ip-progress-list">${pills}</ul>
        </div>
        <div class="slot-picker-inspect-footer">${cta}</div>
      </div>
    </div>
  `;
  wireInspectOverlay(host, { kind: 'master', id: node.id });
}

function wireInspectOverlay(host, ctx) {
  host.querySelector('.sp-inspect-back')?.addEventListener('click', closeInspect);
  host.querySelector('.sp-inspect-close')?.addEventListener('click', closeInspect);
  // Click on overlay backdrop closes inspect; clicks inside the card don't.
  host.addEventListener('click', (e) => {
    if (e.target === host) closeInspect();
  });
  // Primary CTA.
  const cta = host.querySelector('.slot-picker-cta');
  if (cta) {
    if (cta.dataset.state === 'buy') {
      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeId = cta.dataset.node || cta.dataset.master;
        const cost = Number(cta.dataset.cost) || 0;
        if (!nodeId) return;
        unlockNode(nodeId, cost);
      });
    } else if (cta.dataset.state === 'equip') {
      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = cta.dataset.equip;
        if (!id) return;
        if (_anchor) equipToolInSlot(id, _barIdx, _slotIdx);
        else equipTool(id);
        closeSlotPicker();
      });
    } else if (cta.dataset.state === 'equipped') {
      cta.addEventListener('click', (e) => { e.stopPropagation(); closeSlotPicker(); });
    } else if (cta.dataset.state === 'unequip') {
      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = cta.dataset.equip;
        if (!id) return;
        unequipTool(id);
        closeSlotPicker();
      });
    }
  }
  // Buyable progression pills.
  for (const li of host.querySelectorAll('.ip-node[data-buyable="true"]')) {
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = li.dataset.node || li.dataset.master;
      const cost = Number(li.dataset.cost) || 0;
      if (!id) return;
      unlockNode(id, cost);
    });
    li.style.cursor = 'pointer';
  }
}

// ---------- inspect content helpers (shared with overlay) ----------

// Tier dots, one per stat-upgrade node in a tool's progression chain.
// Filled when owned, hollow when not. Returns '' for tools with no stat
// upgrades so unupgradeable tiles stay clean.
function buildTierDots(toolId) {
  const nodes = getNodesForTool(toolId);
  const stats = nodes.filter(n => n.kind === 'stat');
  if (!stats.length) return '';
  const owned = new Set(getUnlockedNodes());
  const dots = stats
    .map(n => `<span class="slot-picker-tile-tier-dot ${owned.has(n.id) ? 'filled' : ''}"></span>`)
    .join('');
  return `<span class="slot-picker-tile-tier" aria-hidden="true">${dots}</span>`;
}

function buildToolChips(tool) {
  const chips = [];
  if (tool.delta) chips.push(`<span class="ip-chip ip-chip-delta">${tool.delta}</span>`);
  if (tool.kind)  chips.push(`<span class="ip-chip">${kindLabel(tool.kind)}</span>`);
  if (tool.cd)    chips.push(`<span class="ip-chip ip-chip-cd">${tool.cd}s cd</span>`);
  if (tool.key)   chips.push(`<span class="ip-chip ip-chip-key">${tool.key}</span>`);
  return chips.join('');
}

function buildToolCta(tool, isOwned, isHere, isElsewhere) {
  if (!isOwned) {
    const nodes = getNodesForTool(tool.id);
    const toolNode = nodes.find(n => n.kind === 'tool');
    if (!toolNode) return `<button class="slot-picker-cta" data-state="locked" disabled>locked</button>`;
    const owned = new Set(getUnlockedNodes());
    const parentsOk = (toolNode.parents || []).every(p => owned.has(p));
    const canAfford = getCurrency() >= (toolNode.cost || 0);
    if (!parentsOk) {
      const missing = toolNode.parents
        .filter(p => !owned.has(p))
        .map(p => labelForGroupNode(p))
        .join(' + ');
      return `<button class="slot-picker-cta" data-state="locked" disabled>needs ${escapeHTML(missing)}</button>`;
    }
    if (!canAfford) return `<button class="slot-picker-cta" data-state="locked" disabled>${toolNode.cost}¢ needed</button>`;
    return `<button class="slot-picker-cta" data-state="buy" data-node="${toolNode.id}" data-cost="${toolNode.cost}">unlock, ${toolNode.cost}¢</button>`;
  }
  if (isHere) return `<button class="slot-picker-cta" data-state="unequip" data-equip="${tool.id}">unequip</button>`;
  if (_anchor) return `<button class="slot-picker-cta" data-state="equip" data-equip="${tool.id}">${isElsewhere ? 'move here' : 'equip'}</button>`;
  if (isToolEquipped(tool.id)) return `<button class="slot-picker-cta" data-state="unequip" data-equip="${tool.id}">unequip</button>`;
  return `<button class="slot-picker-cta" data-state="equip" data-equip="${tool.id}">equip</button>`;
}

function labelForGroupNode(nodeId) {
  const parts = nodeId.split('.');
  if (parts.length >= 3) {
    const t = TOOLS_BY_ID[parts[2]];
    if (t) return t.label;
  }
  return nodeId;
}

function buildProgressChain(toolId) {
  const tool = TOOLS_BY_ID[toolId];
  // Tools in a family also surface that family's shared (cross-tool) nodes
  // inline in their chain — e.g. every firearm shows "Targeting computer".
  const shared = tool?.family ? getSharedNodesForFamily(tool.family) : [];
  const nodes = [...getNodesForTool(toolId), ...shared];
  if (!nodes.length) return '';
  const sorted = [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'tool' ? -1 : 1;
    return (a.cost || 0) - (b.cost || 0);
  });
  const owned    = new Set(getUnlockedNodes());
  const currency = getCurrency();
  const pills = sorted.map(n => {
    const isOwned    = owned.has(n.id);
    const parentsOk  = (n.parents || []).every(p => owned.has(p));
    const canAfford  = currency >= (n.cost || 0);
    const state      = isOwned ? 'owned' : (parentsOk ? (canAfford ? 'affordable' : 'unaffordable') : 'locked');
    const buyable    = state === 'affordable';
    const data       = buyable ? `data-buyable="true" data-node="${n.id}" data-cost="${n.cost}"` : '';
    const capstone   = n.iconHint === '⚡' ? 'data-capstone="true"' : '';
    return `
      <li class="ip-node" data-state="${state}" data-kind="${n.kind}" ${capstone} ${data}>
        <div class="ip-node-bullet" aria-hidden="true"></div>
        <div class="ip-node-body">
          <div class="ip-node-label">${escapeHTML(n.label)}</div>
          <div class="ip-node-blurb">${escapeHTML(n.blurb || '')}</div>
        </div>
        <div class="ip-node-cost" data-state="${state}">${isOwned ? '✓' : n.cost + '¢'}</div>
      </li>
    `;
  }).join('');
  const ownedCount = sorted.filter(n => owned.has(n.id)).length;
  return `
    <div class="slot-picker-inspect-progress">
      <div class="ip-progress-head">
        <span class="ip-progress-title">progression</span>
        <span class="ip-progress-count">${ownedCount} / ${sorted.length}</span>
      </div>
      <ul class="ip-progress-list">${pills}</ul>
    </div>
  `;
}

// ---------- plain helpers ----------

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

function renderIconSvg(toolId, className) {
  const icon = ICONS[toolId] || ICONS.__unknown;
  return `<svg viewBox="-16 -16 32 32" class="${className}" aria-hidden="true">
    <path d="${icon.d}" class="${icon.fill ? 'icon-fill' : 'icon-stroke'}"/>
  </svg>`;
}

function kindLabel(kind) {
  switch (kind) {
    case 'click':     return 'click';
    case 'hold':      return 'hold';
    case 'drag':      return 'drag';
    case 'hold+drag': return 'hold + drag';
    default:          return kind;
  }
}

function slotLabel(barIdx, slotIdx) {
  const SLOT_KEYS = ['1','2','3','4','5','6','7','8','9','0'];
  return SLOT_KEYS[slotIdx] || '?';
}

// ---------- positioning (picker only) ----------

function position() {
  if (!_root) return;
  if (!_anchor) {
    _root.style.left = '50%';
    _root.style.top = '50%';
    _root.style.transform = 'translate(-50%, -50%)';
    return;
  }
  const a = _anchor.getBoundingClientRect();
  const pw = _root.offsetWidth || 520;
  const ph = _root.offsetHeight || 460;
  const margin = 8;
  let left = Math.round(a.left + a.width / 2 - pw / 2);
  left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
  let top = Math.round(a.top - ph - 10);
  if (top < margin) top = Math.round(a.bottom + 10);
  _root.style.left = `${left}px`;
  _root.style.top = `${top}px`;
  _root.style.bottom = 'auto';
  _root.style.right = 'auto';
  _root.style.transform = '';
  // Tooltip may need to reposition if the picker scrolled or the user
  // resized, but the tooltip's tile rect is still correct, no extra work.
  requestRepositionTooltip();
}
