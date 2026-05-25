// Dashboard shell: backdrop, panel, header (title route + filter trigger
// + range buttons), the model filter popover, the bottom command bar,
// and the events that drive them. Pure chrome; the body is rendered by
// stats-dashboard.js.
//
// State lives on the root element's dataset (audience, range,
// activeSection, selectedModels CSV, calendarView, filterOpen). The
// dashboard module owns the data; this module owns the chrome.
//
// API:
//   renderShellHTML(deps)       -> initial HTML for the panel
//   bindShell(root, deps)       -> wires events; returns teardown()
//   updateHeaderTitle(root,deps)-> re-renders the title route only
//   updateCommandBar(root,deps) -> re-renders the bottom command list only
//   getSelectedSet(root)        -> Set<personaId> from dataset CSV
//   setSelectedSet(root, set)   -> writes dataset CSV + chip pressed state
//   bindScrollFades(body)       -> toggles top/bottom fade classes on scroll
//
// `deps` is the callbacks contract:
//   {
//     closeDashboard(),
//     loadDashboard(),
//     renderBodyFromCache(),
//     goToOverview(),
//     toggleAudience(),
//     getSectionLabel(id),
//     getDemoMode(),
//   }
// State is read directly from `root.dataset`, never threaded through
// deps, so updates that mutate dataset can simply call the relevant
// updater (e.g. updateCommandBar) without rebuilding a state bag.

import { loadAuth } from '../../net/auth-storage.js';
import { escapeHTML } from './format.js';
import { personaAccent, personaLogoSvg, PERSONA_IDS, PERSONA_LABELS } from './persona-present.js';

// Funnel glyph used for the model selector; avoids reading as search.
const FILTER_ICON_SVG = `
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none">
    <path d="M3 4.25h10L9.25 8.4v3.1l-2.5 1.25V8.4L3 4.25Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  </svg>
`;


// Inline persona-logo helper. Injects the raw SVG directly so `fill="currentColor"`
// inherits the chip's text color (which encodes selection state via accent
// saturation). The earlier mask-image path was broken by a quote collision
// inside the inline `style` attribute, so the icons rendered as empty boxes.
function personaIconHTML(id, size = 14) {
  const raw = personaLogoSvg(id);
  if (!raw) {
    return `<span class="sd-pchip-icon sd-pchip-icon-fallback" style="--icon-size:${size}px;"></span>`;
  }
  const sized = raw
    .replace(/\swidth="[^"]*"/i, ` width="${size}"`)
    .replace(/\sheight="[^"]*"/i, ` height="${size}"`);
  return `<span class="sd-pchip-icon" aria-hidden="true">${sized}</span>`;
}

export function renderShellHTML(deps) {
  return `
    <div class="sd-backdrop"></div>
    <aside class="sd-panel" aria-label="analytics panel">
      ${renderHeader(deps)}
      <div class="sd-body" data-state="loading">
        ${renderLoading()}
      </div>
      <footer class="sd-bottom-footer">
        <div class="sd-command-bar">
          ${renderCommandList('overview')}
        </div>
      </footer>
    </aside>
  `;
}

function renderLoading() {
  return `<div class="sd-loading"><span class="sd-loading-pulse"></span>reading hot event log…</div>`;
}

function renderHeader(deps) {
  const auth = (() => { try { return loadAuth(); } catch { return null; } })();
  const handle = auth?.handle || 'guest';
  const demoBadge = deps.getDemoMode() ? '<span class="sd-eyebrow-pill">demo</span>' : '';
  return `
    <header class="sd-head">
      <div class="sd-head-inner">
        <div class="sd-head-title">
          <div class="sd-eyebrow">${escapeHTML(handle)} ${demoBadge}</div>
          ${renderTitleRoute('overview', deps)}
        </div>
        <div class="sd-head-controls">
          <span class="sd-filter-label" aria-hidden="true">Filter</span>
          ${renderFilterTrigger(new Set(), false)}
          <div class="sd-range" role="tablist" aria-label="time range">
            <button type="button" class="sd-range-btn" data-range="7">7d</button>
            <button type="button" class="sd-range-btn active" data-range="30">30d</button>
            <button type="button" class="sd-range-btn" data-range="90">90d</button>
            <button type="button" class="sd-range-btn" data-range="all">All</button>
          </div>
        </div>
      </div>
      ${renderFilterPopover(new Set(), false)}
    </header>
  `;
}

function renderTitleRoute(activeId, deps) {
  if (activeId === 'overview') {
    return `<h1 class="sd-h1 sd-title-route" data-title-route><span class="sd-title-current">Stats</span></h1>`;
  }
  const label = deps.getSectionLabel(activeId);
  return `
    <h1 class="sd-h1 sd-title-route" data-title-route>
      <button type="button" class="sd-title-link" data-title-overview>Stats</button>
      <span class="sd-title-sep" aria-hidden="true">›</span>
      <span class="sd-title-current">${escapeHTML(label)}</span>
    </h1>
  `;
}

function renderCommandList(activeId) {
  const overview = activeId !== 'overview'
    ? `<button type="button" class="sd-command sd-command-button" data-command-overview>
         <kbd>O</kbd><span>Overview</span>
       </button>`
    : '';
  return `
    <div class="sd-command-list" aria-label="dashboard commands">
      <span class="sd-command"><kbd>←</kbd><kbd>→</kbd><span>Sections</span></span>
      ${overview}
      <button type="button" class="sd-command sd-command-button" data-close>
        <kbd>Esc</kbd><span>Close</span>
      </button>
    </div>
  `;
}

function renderFilterTrigger(selectedSet, open) {
  const count = selectedSet.size;
  return `
    <button type="button" class="sd-filter-trigger ${count > 0 ? 'has-active' : ''} ${open ? 'is-open' : ''}"
            data-filter-trigger aria-haspopup="true" aria-expanded="${open ? 'true' : 'false'}">
      ${FILTER_ICON_SVG}
      <span class="sd-filter-trigger-label">Models</span>
      <span class="sd-filter-trigger-count" data-filter-count>${count > 0 ? `· ${count}` : ''}</span>
    </button>
  `;
}

function renderFilterPopover(selectedSet, open) {
  const allActive = selectedSet.size === 0;
  const personaPills = PERSONA_IDS.map((id) => {
    const active = selectedSet.has(id);
    return `
      <button type="button" class="sd-pchip ${active ? 'active' : ''}"
              data-persona-chip="${id}"
              style="--chip-accent:${personaAccent(id)};"
              aria-pressed="${active ? 'true' : 'false'}">
        ${personaIconHTML(id, 14)}
        <span class="sd-pchip-label">${escapeHTML(PERSONA_LABELS[id])}</span>
      </button>
    `;
  }).join('');
  return `
    <div class="sd-filter-popover" data-filter-popover ${open ? '' : 'hidden'} role="group" aria-label="select models">
      <div class="sd-filter-popover-inner">
        <div class="sd-filter-popover-head">
          <span class="sd-filter-popover-title">Models</span>
          <button type="button" class="sd-filter-clear ${allActive ? 'is-disabled' : ''}"
                  data-filter-all aria-pressed="${allActive ? 'true' : 'false'}">
            ${allActive ? 'All shown' : 'Show all'}
          </button>
        </div>
        <div class="sd-filter-popover-grid">
          ${personaPills}
        </div>
      </div>
    </div>
  `;
}

export function bindShell(root, deps) {
  // Backdrop + close.
  root.querySelector('.sd-backdrop')?.addEventListener('click', deps.closeDashboard);
  root.querySelector('[data-close]')?.addEventListener('click', deps.closeDashboard);

  root.querySelector('.sd-bottom-footer')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      deps.closeDashboard();
      return;
    }
    if (e.target.closest('[data-command-overview]')) {
      deps.goToOverview();
    }
  });
  root.querySelector('.sd-head-title')?.addEventListener('click', (e) => {
    if (!e.target.closest('[data-title-overview]')) return;
    deps.goToOverview();
  });

  // Time-range tabs in the header.
  for (const btn of root.querySelectorAll('[data-range]')) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.range;
      if (next === root.dataset.range) return;
      root.dataset.range = next;
      root.querySelectorAll('[data-range]').forEach((el) =>
        el.classList.toggle('active', el === btn));
      deps.loadDashboard();
    });
  }

  bindFilterTrigger(root);
  bindFilterPopover(root, deps);

  // Click-outside closes the filter popover.
  const onDocClick = (e) => onDocClickForFilter(root, e);
  document.addEventListener('mousedown', onDocClick, true);

  return function teardown() {
    document.removeEventListener('mousedown', onDocClick, true);
  };
}

function bindFilterTrigger(root) {
  const trigger = root.querySelector('[data-filter-trigger]');
  if (!trigger) return;
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFilterPopover(root);
  });
}

function bindFilterPopover(root, deps) {
  for (const chip of root.querySelectorAll('[data-persona-chip]')) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = chip.dataset.personaChip;
      const set = getSelectedSet(root);
      if (set.has(id)) set.delete(id); else set.add(id);
      setSelectedSet(root, set);
      deps.renderBodyFromCache();
    });
  }
  root.querySelector('[data-filter-all]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (getSelectedSet(root).size === 0) return;
    setSelectedSet(root, new Set());
    deps.renderBodyFromCache();
  });
  // Stop clicks inside the popover from bubbling to the doc-level closer.
  root.querySelector('[data-filter-popover]')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
}

function toggleFilterPopover(root, force) {
  const want = force ?? (root.dataset.filterOpen !== '1');
  root.dataset.filterOpen = want ? '1' : '';
  const pop = root.querySelector('[data-filter-popover]');
  const trig = root.querySelector('[data-filter-trigger]');
  if (pop) {
    if (want) pop.removeAttribute('hidden'); else pop.setAttribute('hidden', '');
  }
  if (trig) {
    trig.classList.toggle('is-open', want);
    trig.setAttribute('aria-expanded', want ? 'true' : 'false');
  }
}

function onDocClickForFilter(root, e) {
  if (!root || root.dataset.filterOpen !== '1') return;
  const trig = root.querySelector('[data-filter-trigger]');
  const pop = root.querySelector('[data-filter-popover]');
  if (trig?.contains(e.target) || pop?.contains(e.target)) return;
  toggleFilterPopover(root, false);
}

export function getSelectedSet(root) {
  const csv = root?.dataset?.selectedModels || '';
  return new Set(csv.split(',').filter(Boolean));
}

export function setSelectedSet(root, set) {
  if (!root) return;
  root.dataset.selectedModels = [...set].join(',');
  // Reflect into chip pressed state inside the popover.
  for (const item of root.querySelectorAll('[data-persona-chip]')) {
    const on = set.has(item.dataset.personaChip);
    item.classList.toggle('active', on);
    item.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  // "Show all" affordance: only meaningful when filter is engaged.
  const allBtn = root.querySelector('[data-filter-all]');
  if (allBtn) {
    const isAll = set.size === 0;
    allBtn.classList.toggle('is-disabled', isAll);
    allBtn.setAttribute('aria-pressed', isAll ? 'true' : 'false');
    allBtn.textContent = isAll ? 'All shown' : 'Show all';
  }
  // Trigger badge: show count when filtered, blank when "all".
  const trigger = root.querySelector('[data-filter-trigger]');
  if (trigger) {
    trigger.classList.toggle('has-active', set.size > 0);
    const countEl = trigger.querySelector('[data-filter-count]');
    if (countEl) countEl.textContent = set.size > 0 ? `· ${set.size}` : '';
  }
}

export function updateHeaderTitle(root, deps) {
  const current = root?.querySelector('[data-title-route]');
  if (!current) return;
  current.outerHTML = renderTitleRoute(root.dataset.activeSection || 'overview', deps);
}

export function updateCommandBar(root) {
  const bar = root?.querySelector('.sd-command-bar');
  if (!bar) return;
  bar.innerHTML = renderCommandList(root.dataset.activeSection || 'overview');
}

export function bindScrollFades(body) {
  const sync = () => updateScrollFades(body);
  body.onscroll = sync;
  requestAnimationFrame(sync);
}

function updateScrollFades(body) {
  if (!body) return;
  const max = Math.max(0, body.scrollHeight - body.clientHeight);
  const y = body.scrollTop;
  body.classList.toggle('has-overflow', max > 1);
  body.classList.toggle('at-top', y <= 1);
  body.classList.toggle('at-bottom', y >= max - 1);
}
