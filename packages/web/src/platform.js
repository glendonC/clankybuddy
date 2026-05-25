// Platform / environment shim. Single source of truth for "what kind of input
// device + viewport are we on?" so UI modules don't scatter window.matchMedia
// or navigator probes across the codebase. Updates on viewport change.
//
// Long-term: a future mobile build picks a different scene/layout based on
// `pointerType` and `isCompact`. Today, only the desktop layout exists, but
// every new UI module should consult this rather than baking assumptions in.

const _state = {
  pointerType: 'mouse',     // 'mouse' | 'touch' | 'pen'
  hasHover:    true,
  isCompact:   false,        // true on phone-sized viewports (< 720px wide)
  viewport:    { w: 0, h: 0 },
};
const _listeners = [];

function detect() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  _state.viewport = { w, h };
  _state.isCompact = w < 720;

  // Hover capability is a strong proxy for input class on the open web.
  _state.hasHover = window.matchMedia?.('(hover: hover)').matches ?? true;
  if (window.matchMedia?.('(pointer: coarse)').matches) {
    _state.pointerType = 'touch';
  } else if (window.matchMedia?.('(pointer: fine)').matches) {
    _state.pointerType = 'mouse';
  }
}

detect();
window.addEventListener('resize', () => {
  const wasCompact = _state.isCompact;
  detect();
  if (_state.isCompact !== wasCompact) emit();
});
window.matchMedia?.('(hover: hover)').addEventListener?.('change', () => { detect(); emit(); });
window.matchMedia?.('(pointer: coarse)').addEventListener?.('change', () => { detect(); emit(); });

function emit() {
  for (const fn of _listeners) { try { fn(_state); } catch (e) { console.warn('platform listener', e); } }
}

export function platform()         { return _state; }
export function pointerType()      { return _state.pointerType; }
export function hasHover()         { return _state.hasHover; }
export function isCompact()        { return _state.isCompact; }
export function viewport()         { return _state.viewport; }
export function onPlatformChange(fn) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}
