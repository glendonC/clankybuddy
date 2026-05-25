// Mode bus, the registry + dispatcher for "modes" (anything that wants a
// per-frame tick that's separately gated/toggleable). Per the Phase B
// roadmap, this is PR1 of the Mode rework: ship the bus + adapter Modes
// for the existing tickers (live, panic-moves, plumbing). The
// capability validator was deferred (red-team rescope); capability fields
// on a Mode object are accepted but not validated yet.
//
// A Mode shape:
//   {
//     id: string,                  // unique
//     phase: 'physics' | 'frame',  // when its tick runs in main.js
//     defaultEnabled?: boolean,    // initial isEnabled() value
//     mutuallyExclusiveWith?: string[],  // ids that auto-disable on enable
//     capabilities?: string[],     // accepted, NOT validated in PR1
//     init?: (ctx) => void,        // first time enabled
//     teardown?: (ctx) => void,    // on disable / unregister
//     tick?: (ctx, dt) => void,    // per phase
//     onCharChange?: (ctx) => void,
//   }
//
// Toggle changes during a tickModes() pass are queued and applied AFTER
// the current pass completes. This prevents mid-step mutation (e.g. a
// physics tick disables itself or re-enables a mutually exclusive peer)
// from leaving the registry in an inconsistent state mid-iteration.

const _modes = new Map();              // id -> mode
const _enabled = new Set();            // ids currently enabled
const _initted = new Set();            // ids that have run init()
let _ticking = false;                  // re-entrancy guard
let _pendingToggles = [];              // [{ id, on, ctx }]

export function register(mode) {
  if (!mode || typeof mode !== 'object' || typeof mode.id !== 'string') {
    throw new Error('modeBus.register: mode must be an object with a string id');
  }
  if (_modes.has(mode.id)) {
    throw new Error(`modeBus.register: duplicate id '${mode.id}'`);
  }
  if (mode.phase !== 'physics' && mode.phase !== 'frame') {
    throw new Error(`modeBus.register: mode '${mode.id}' has invalid phase '${mode.phase}'`);
  }
  _modes.set(mode.id, mode);
  if (mode.defaultEnabled) _enabled.add(mode.id);
}

export function unregister(id) {
  if (!_modes.has(id)) return;
  if (_enabled.has(id)) _enabled.delete(id);
  _initted.delete(id);
  _modes.delete(id);
}

export function isEnabled(id) {
  return _enabled.has(id);
}

export function getActive() {
  return [..._enabled];
}

export function list({ phase, enabledOnly } = {}) {
  const out = [];
  for (const m of _modes.values()) {
    if (phase && m.phase !== phase) continue;
    if (enabledOnly && !_enabled.has(m.id)) continue;
    out.push(m);
  }
  return out;
}

// Enable/disable. If called during a tick, the change is queued. Mutex
// resolution: turning a mode ON auto-disables every other mode whose
// mutuallyExclusiveWith set includes it (or that this mode lists).
export function setEnabled(id, on, ctx = null) {
  if (!_modes.has(id)) return;
  if (_ticking) {
    _pendingToggles.push({ id, on: !!on, ctx });
    return;
  }
  _applyToggle(id, !!on, ctx);
}

function _applyToggle(id, on, ctx) {
  const mode = _modes.get(id);
  if (!mode) return;
  const wasEnabled = _enabled.has(id);
  if (on === wasEnabled) return;

  if (on) {
    // Resolve mutex: turn off any peer in the exclusive set.
    const peers = collectMutex(mode);
    for (const peerId of peers) {
      if (_enabled.has(peerId)) {
        _applyToggle(peerId, false, ctx);
      }
    }
    _enabled.add(id);
    if (!_initted.has(id) && typeof mode.init === 'function') {
      try { mode.init(ctx); } catch (e) { console.error(`mode '${id}' init failed`, e); }
      _initted.add(id);
    }
  } else {
    _enabled.delete(id);
    _initted.delete(id);
    if (typeof mode.teardown === 'function') {
      try { mode.teardown(ctx); } catch (e) { console.error(`mode '${id}' teardown failed`, e); }
    }
  }
}

function collectMutex(mode) {
  const out = new Set();
  if (Array.isArray(mode.mutuallyExclusiveWith)) {
    for (const peer of mode.mutuallyExclusiveWith) out.add(peer);
  }
  // Symmetric: also disable any other mode that lists THIS one in its set.
  for (const m of _modes.values()) {
    if (m.id === mode.id) continue;
    if (Array.isArray(m.mutuallyExclusiveWith) && m.mutuallyExclusiveWith.includes(mode.id)) {
      out.add(m.id);
    }
  }
  return out;
}

// Run all enabled modes for the given phase in registration order.
// Toggles requested during ticks are queued and flushed after the loop
// completes, prevents mid-iteration state mutation.
export function tickModes(ctx, dt, phase) {
  _ticking = true;
  try {
    for (const m of _modes.values()) {
      if (m.phase !== phase) continue;
      if (!_enabled.has(m.id)) continue;
      // Lazy init for modes that became enabled outside setEnabled (e.g.
      // defaultEnabled flag, first tick is the trigger).
      if (!_initted.has(m.id) && typeof m.init === 'function') {
        try { m.init(ctx); } catch (e) { console.error(`mode '${m.id}' init failed`, e); }
        _initted.add(m.id);
      }
      if (typeof m.tick === 'function') {
        try { m.tick(ctx, dt); } catch (e) { console.error(`mode '${m.id}' tick failed`, e); }
      }
    }
  } finally {
    _ticking = false;
    if (_pendingToggles.length) {
      const queued = _pendingToggles;
      _pendingToggles = [];
      for (const t of queued) _applyToggle(t.id, t.on, t.ctx);
    }
  }
}

// Fan out to each enabled mode's onCharChange. Cheap, just an enabled-set
// walk plus a method check.
export function onCharChange(ctx) {
  for (const m of _modes.values()) {
    if (!_enabled.has(m.id)) continue;
    if (typeof m.onCharChange === 'function') {
      try { m.onCharChange(ctx); } catch (e) { console.error(`mode '${m.id}' onCharChange failed`, e); }
    }
  }
}

// Test-only, drops every mode and clears state. NOT exported in the
// barrel; callers must import by path.
export function _resetForTests() {
  _modes.clear();
  _enabled.clear();
  _initted.clear();
  _pendingToggles = [];
  _ticking = false;
}
