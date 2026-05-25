// Analytics dashboard: the big side-sheet. Anchored to the right edge,
// 760px wide, 100vh tall. Apple Health / Stocks aesthetic: pure-white
// surface (or near-black in dark), hairline 1px section dividers, no
// card backgrounds, hero numerals at 56–64px tracked tight, gradient-fade
// sparklines, calendar heatmaps, ranked tables. The lifetime stats popover
// (stats-popover.js) is the entry point. Its "open analytics" button calls
// openStatsDashboard() here.
//
// This file is the public entry point and thin orchestrator. The heavy
// lifting lives in feature-folder modules:
//   - shell.js          chrome (header, filter, command bar) + bindings
//   - bento.js          overview grid + tile preview viz
//   - sections.js       drill-down section renderers
//   - charts.js         shared SVG primitives (sparkline, smoothPath)
//   - format.js         number/date/inline-emphasis helpers
//   - insights.js       per-section facts + editorial copy
//   - focused-layout.js full-width-viz drilldown layout
//   - persona-present.js dashboard-tuned persona accents/labels
//   - demo-data.js      synthetic data generator for demo mode
//
// Public API consumed by stats-popover.js (and dev-panel via re-export):
//   openStatsDashboard, closeStatsDashboard, isStatsDashboardOpen,
//   getStatsDemoMode, setStatsDemoMode, onStatsDemoChange.
//
// Data layer: /me/stats (per-user, hot-window or lifetime) and /leaderboard
// (cross-user lifetime per model). The MeStatsResponse shape carries
// per_verb_timeseries, per_model_timeseries, time_of_day_heatmap,
// daily_calendar, and session_summaries (see packages/shared/src/events.ts
// and packages/worker/src/dos/action_shard.ts).

import { fetchMeStats, fetchGlobalStats, fetchLeaderboardSeries } from '../net/stats.js';
import { renderBento } from './stats-dashboard/bento.js';
import {
  buildDemoAllTimeStats,
  buildDemoGlobalStats,
  buildDemoStats,
} from './stats-dashboard/demo-data.js';
import {
  renderAnatomy,
  renderCalendar,
  renderKPIs,
  renderPareto,
  renderPersonaLadder,
  renderPulse,
  renderRecords,
  renderSessions,
  renderVerbTable,
} from './stats-dashboard/sections.js';
import {
  bindScrollFades,
  bindShell,
  getSelectedSet,
  renderShellHTML,
  setSelectedSet,
  updateCommandBar,
  updateHeaderTitle,
} from './stats-dashboard/shell.js';

// --- demo mode (dev-only) ----------------------------------------------
//
// Persisted in localStorage under a dev key. The dev panel toggles it; load
// short-circuits to synthetic data when on. A "DEMO" chip in the header
// makes the state visible so demo curves can never be confused with real
// data.
const DEMO_MODE_KEY = 'clankybuddy.dev.stats_demo.v1';
const _demoListeners = [];
let _demoMode = (() => {
  try { return localStorage.getItem(DEMO_MODE_KEY) === '1'; } catch { return false; }
})();

export function getStatsDemoMode() { return _demoMode; }
export function setStatsDemoMode(on) {
  const next = !!on;
  if (next === _demoMode) return;
  _demoMode = next;
  try { localStorage.setItem(DEMO_MODE_KEY, next ? '1' : '0'); } catch {}
  for (const fn of _demoListeners) fn(next);
  if (_dashboard) loadDashboard();
}
export function onStatsDemoChange(fn) {
  _demoListeners.push(fn);
  return () => {
    const i = _demoListeners.indexOf(fn);
    if (i >= 0) _demoListeners.splice(i, 1);
  };
}

// --- module state ------------------------------------------------------

let _dashboard = null;
let _shellTeardown = null;
let _loadGen = 0;
let _statsCache = null;
let _previousCache = null;
// Global lifetime totals, fetched in parallel when the "vs global" toggle
// is on. Renderers consume via ctx.benchmark, sections opt in; sections
// that have no benchmark counterpart simply ignore it.
let _benchmarkCache = null;
let _benchmarkSeriesCache = null;

// Sections registry: id, plain-English label, drill-down builder, and an
// `myOnly` flag for sections that don't apply to the global view
// (sessions/records/value).
const SECTIONS = [
  { id: 'overview', label: 'Overview',         build: renderKPIs },
  { id: 'activity', label: 'Day by day',       build: renderPulse },
  { id: 'when',     label: 'When you play',    build: renderCalendar },
  { id: 'where',    label: 'Where you hit',    build: renderAnatomy },
  { id: 'tools',    label: 'Most used tools',  build: renderVerbTable },
  { id: 'buddies',  label: 'Buddies',          build: renderPersonaLadder },
  { id: 'sessions', label: 'Sessions',         build: renderSessions, myOnly: true },
  { id: 'records',  label: 'Personal bests',   build: renderRecords,  myOnly: true },
  { id: 'value',    label: 'Best per coin',    build: renderPareto,   myOnly: true },
];

function getSectionLabel(id) {
  return SECTIONS.find((s) => s.id === id)?.label || 'Overview';
}

function visibleSections(ctx) {
  return ctx.isGlobal ? SECTIONS.filter((s) => !s.myOnly) : SECTIONS;
}

function getActiveSectionId(ctx) {
  const visible = visibleSections(ctx);
  const want = _dashboard?.dataset?.activeSection || 'overview';
  return visible.some((s) => s.id === want) ? want : visible[0].id;
}

// Callbacks the shell module needs to drive the dashboard. Built once
// per open() so it stays stable across re-renders.
function shellDeps() {
  return {
    closeDashboard: closeStatsDashboard,
    loadDashboard,
    renderBodyFromCache,
    goToOverview,
    getSectionLabel,
    getDemoMode: () => _demoMode,
  };
}

// --- public entry points -----------------------------------------------

export function openStatsDashboard() {
  if (_dashboard) {
    closeStatsDashboard();
    return;
  }
  _dashboard = document.createElement('div');
  _dashboard.className = 'sd-root';
  _dashboard.dataset.audience = 'my';
  _dashboard.dataset.range = '30';
  _dashboard.dataset.selectedModels = '';
  _dashboard.dataset.calendarView = 'hourgrid';
  _dashboard.dataset.activeSection = 'overview';
  _dashboard.dataset.benchmarkOn = '';
  _dashboard.setAttribute('role', 'dialog');
  _dashboard.setAttribute('aria-modal', 'true');
  _dashboard.setAttribute('aria-label', 'analytics');
  const deps = shellDeps();
  _dashboard.innerHTML = renderShellHTML(deps);
  document.body.appendChild(_dashboard);
  _shellTeardown = bindShell(_dashboard, deps);
  document.addEventListener('keydown', onKeydown, true);
  loadDashboard();
}

export function closeStatsDashboard() {
  if (!_dashboard) return;
  _shellTeardown?.();
  _shellTeardown = null;
  document.removeEventListener('keydown', onKeydown, true);
  _dashboard.remove();
  _dashboard = null;
}

export function isStatsDashboardOpen() { return _dashboard !== null; }

// --- body load + dispatch ----------------------------------------------

async function loadDashboard() {
  if (!_dashboard) return;
  const gen = ++_loadGen;
  const audience = _dashboard.dataset.audience;
  const range = _dashboard.dataset.range;
  const isAllTime = range === 'all';
  const days = isAllTime ? null : Number(range);
  const benchmarkOn = _dashboard.dataset.benchmarkOn === '1' && audience !== 'global';
  const body = _dashboard.querySelector('.sd-body');
  body.dataset.state = 'loading';
  body.innerHTML = renderLoading();

  try {
    let stats;
    let previous = null;
    // Fire the global fetch in parallel with personal so the toggle doesn't
    // double the perceived load time. Errors are non-fatal: if global fails,
    // the dashboard still renders without the overlay.
    const benchmarkPromise = benchmarkOn
      ? (_demoMode
          ? Promise.resolve(buildDemoGlobalStats())
          : fetchGlobalStats().catch(() => null))
      : Promise.resolve(null);
    // Per-day series for the Pulse chart overlay. Only meaningful inside a
    // bounded time range, the `all` range has no personal time series to
    // overlay onto. Demo mode currently has no synthetic global series, so
    // the trend overlay is real-data only.
    const benchmarkSeriesPromise = benchmarkOn && !isAllTime && !_demoMode
      ? (() => {
          const now = Date.now();
          const windowMs = days * 24 * 60 * 60_000;
          const since = new Date(now - windowMs).toISOString().slice(0, 10);
          const until = new Date(now).toISOString().slice(0, 10);
          return fetchLeaderboardSeries({ since, until }).catch(() => null);
        })()
      : Promise.resolve(null);

    if (_demoMode) {
      if (audience === 'global') {
        stats = buildDemoGlobalStats();
      } else if (isAllTime) {
        stats = buildDemoAllTimeStats();
      } else {
        const now = Date.now();
        const windowMs = days * 24 * 60 * 60_000;
        stats = buildDemoStats({
          since: now - windowMs,
          until: now,
          granularity: days <= 7 ? 'hour' : 'day',
        });
        previous = buildDemoStats({
          since: now - 2 * windowMs,
          until: now - windowMs,
          granularity: days <= 7 ? 'hour' : 'day',
          seedShift: 1,
        });
      }
    } else if (audience === 'global') {
      stats = await fetchGlobalStats();
    } else if (isAllTime) {
      stats = await fetchMeStats({ granularity: 'all' });
    } else {
      const now = Date.now();
      const windowMs = days * 24 * 60 * 60_000;
      const granularity = days <= 7 ? 'hour' : 'day';
      const [cur, prev] = await Promise.all([
        fetchMeStats({
          since: new Date(now - windowMs).toISOString(),
          until: new Date(now).toISOString(),
          granularity,
        }),
        fetchMeStats({
          since: new Date(now - 2 * windowMs).toISOString(),
          until: new Date(now - windowMs).toISOString(),
          granularity,
        }),
      ]);
      stats = cur;
      previous = prev;
    }

    const [benchmark, benchmarkSeries] = await Promise.all([benchmarkPromise, benchmarkSeriesPromise]);
    if (gen !== _loadGen || !_dashboard) return;
    _statsCache = stats;
    _previousCache = previous;
    _benchmarkCache = benchmark;
    _benchmarkSeriesCache = benchmarkSeries;
    body.dataset.state = 'ready';
    renderBodyFromCache();
  } catch (err) {
    if (gen !== _loadGen || !_dashboard) return;
    body.dataset.state = 'error';
    body.innerHTML = renderError(err);
  }
}

function renderBodyFromCache() {
  if (!_dashboard || !_statsCache) return;
  const body = _dashboard.querySelector('.sd-body');
  const audience = _dashboard.dataset.audience;
  const range = _dashboard.dataset.range;
  const isAllTime = range === 'all';
  const isGlobal = audience === 'global';
  const selected = getSelectedSet(_dashboard);
  const ctx = {
    stats: _statsCache,
    previous: _previousCache,
    range,
    isAllTime,
    isGlobal,
    selected,
    benchmark: _benchmarkCache,
    benchmarkSeries: _benchmarkSeriesCache,
    benchmarkOn: _dashboard.dataset.benchmarkOn === '1',
    calendarView: _dashboard.dataset.calendarView || 'hourgrid',
  };
  body.dataset.state = 'ready';
  body.innerHTML = renderBody(ctx);
  bindBody(body);
  updateHeaderTitle(_dashboard, shellDeps());
  updateCommandBar(_dashboard);
  bindScrollFades(body);
}

// Body dispatch: 'overview' renders the bento grid (the home / landing
// surface); any other id renders that section's full page with a back
// path through the title route.
function renderBody(ctx) {
  const activeId = getActiveSectionId(ctx);
  if (activeId === 'overview') return renderBento(ctx, visibleSections(ctx));
  const visible = visibleSections(ctx);
  const active = visible.find((s) => s.id === activeId) || visible[0];
  return `
    <main class="sd-page" data-section="${active.id}" role="tabpanel"
          aria-label="${escapeAttr(active.label)}">
      ${active.build(ctx)}
    </main>
  `;
}

function bindBody(body) {
  // Bento tile clicks: drill into that section's full view.
  for (const tile of body.querySelectorAll('[data-tile]')) {
    tile.addEventListener('click', () => {
      const id = tile.dataset.tile;
      if (_dashboard.dataset.activeSection === id) return;
      _dashboard.dataset.activeSection = id;
      renderBodyFromCache();
    });
  }
  // Benchmark toggle button rendered inside the focused-layout aside.
  // Replaces the old audience swap, same slot, layers global onto personal.
  for (const btn of body.querySelectorAll('[data-bench-action]')) {
    btn.addEventListener('click', () => {
      const next = _dashboard.dataset.benchmarkOn === '1' ? '' : '1';
      _dashboard.dataset.benchmarkOn = next;
      loadDashboard();
    });
  }
  // Calendar view toggle (chip on the calendar section).
  for (const chip of body.querySelectorAll('[data-calendar-view]')) {
    chip.addEventListener('click', () => {
      const v = chip.dataset.calendarView;
      _dashboard.dataset.calendarView = v;
      renderBodyFromCache();
    });
  }
  // Persona-ladder row click commits to single-selection.
  for (const row of body.querySelectorAll('[data-ladder-row]')) {
    row.addEventListener('click', () => {
      const id = row.dataset.ladderRow;
      setSelectedSet(_dashboard, new Set([id]));
      renderBodyFromCache();
    });
  }
  // Tooltip plumbing (chart svgs annotate with data-tip).
  bindTooltips(body);
}

// --- shell-callable actions --------------------------------------------

function goToOverview() {
  if (!_dashboard) return;
  _dashboard.dataset.activeSection = 'overview';
  renderBodyFromCache();
}

function stepSection(step, ctx) {
  const visible = visibleSections(ctx);
  const idx = visible.findIndex((s) => s.id === getActiveSectionId(ctx));
  const next = visible[Math.max(0, Math.min(visible.length - 1, idx + step))];
  if (!next || next.id === _dashboard.dataset.activeSection) return;
  _dashboard.dataset.activeSection = next.id;
  renderBodyFromCache();
}

// --- keyboard ----------------------------------------------------------
//
// Esc closes; O jumps to the bento; Arrow Left/Right page between sections
// (honoring the same `visibleSections` list). The global benchmark toggle
// is mouse-only, it lives in the focused-layout aside as a contextual
// pill; no keyboard shortcut by design (it's a settings-style toggle).
// All shortcuts ignore keypresses originating in input/textarea fields.

function onKeydown(e) {
  if (!_dashboard) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeStatsDashboard();
    return;
  }
  if (isTypingTarget()) return;
  const k = e.key.toLowerCase();
  if (k === 'o') {
    if (_dashboard.dataset.activeSection !== 'overview') {
      e.preventDefault();
      goToOverview();
    }
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!_statsCache) return;
    const ctx = {
      stats: _statsCache,
      previous: _previousCache,
      isAllTime: _dashboard.dataset.range === 'all',
      isGlobal: _dashboard.dataset.audience === 'global',
      selected: getSelectedSet(_dashboard),
    };
    e.preventDefault();
    stepSection(e.key === 'ArrowRight' ? 1 : -1, ctx);
  }
}

function isTypingTarget() {
  const tag = (document.activeElement?.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

// --- tooltip layer ----------------------------------------------------
//
// One tooltip element is mounted on the dashboard root; any element with
// [data-tip] surfaces it on mouseenter. Position follows the cursor with
// a small offset. The kind attribute distinguishes data tooltips (chart
// hover) from "explain" tooltips (the underlined-phrase affordance).

function bindTooltips(body) {
  let tipEl = _dashboard.querySelector('.sd-tooltip');
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'sd-tooltip';
    _dashboard.appendChild(tipEl);
  }
  body.addEventListener('mousemove', (e) => {
    const target = e.target?.closest?.('[data-tip]');
    if (!target) {
      tipEl.classList.remove('on');
      tipEl.dataset.kind = '';
      return;
    }
    const text = target.getAttribute('data-tip') || '';
    tipEl.textContent = text;
    tipEl.dataset.kind = target.classList.contains('sd-inline-underline') ? 'explain' : 'data';
    tipEl.classList.add('on');
    const r = _dashboard.getBoundingClientRect();
    const x = e.clientX - r.left + 14;
    const y = e.clientY - r.top + 14;
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  });
  body.addEventListener('mouseleave', () => tipEl.classList.remove('on'));
}

// --- helpers ----------------------------------------------------------

function renderLoading() {
  return `<div class="sd-loading"><span class="sd-loading-pulse"></span>reading hot event log…</div>`;
}

function renderError(err) {
  const status = err?.status ?? 0;
  if (!status) {
    return `<div class="sd-error">
      <div class="sd-error-title">backend offline</div>
      <div class="sd-error-msg">analytics live in the cloudflare worker. start it with <code>npm run dev --workspace packages/worker</code> or check your connection.</div>
    </div>`;
  }
  return `<div class="sd-error">
    <div class="sd-error-title">analytics unavailable (${status})</div>
    <div class="sd-error-msg">the worker returned an error. check the network tab.</div>
  </div>`;
}

// Tiny attribute escaper used only for the dispatch wrapper. Section
// renderers use the shared escapeHTML in format.js for their content.
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
