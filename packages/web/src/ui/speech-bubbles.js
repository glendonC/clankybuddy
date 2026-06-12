// Floating speech bubbles anchored to a body part. The buddy is "speaking"
// from many sources (mood reactions, ability hits, mode bubbles, status
// effects, hints), without coordination they pile up at the head and
// recycle the same lines. This module is the single throttle gate:
//
//   - At most ONE bubble visible at a time.
//   - 300ms hard throttle between any two bubbles, regardless of source.
//   - 2s dedup window, same exact text twice in a row is dropped.
//   - When a new bubble pre-empts the active one, the old fades out fast
//     (200ms) while the new one rises, no two visible together.

let getMoodState = null;
let getStatusRegistry = null;
let getCurrentRagdoll = null;
let classifyMood = null;
let hasStatusEffect = null;

export function configureSpeechBubbles({
  moodState,
  status,
  ragdoll,
  classify,
  hasStatus,
}) {
  getMoodState = moodState;
  getStatusRegistry = status;
  getCurrentRagdoll = ragdoll;
  classifyMood = classify;
  hasStatusEffect = hasStatus;
}

// Status overrides mood for the prefix, what the buddy is feeling RIGHT NOW
// (on fire, frozen, KO'd) trumps the underlying mood-state read.
const STATUS_ICONS = {
  on_fire:     '🔥',
  electrified: '⚡',
  frozen:      '🥶',
  concussed:   '💫',
  powered:     '✨',
};
const MOOD_ICONS = {
  ECSTATIC: '😄',
  HAPPY:    '🙂',
  CONTENT:  '😐',
  WORRIED:  '😬',
  HURT:     '😣',
  BROKEN:   '😵',
};

function iconFor(part) {
  const ragdoll = getCurrentRagdoll?.();
  if (ragdoll?.koUntil && performance.now() < ragdoll.koUntil) return '😵';
  const statusReg = getStatusRegistry?.();
  if (statusReg && part) {
    for (const [id, icon] of Object.entries(STATUS_ICONS)) {
      if (hasStatusEffect?.(statusReg, part, id)) return icon;
    }
  }
  const mood = getMoodState?.();
  return mood && classifyMood ? MOOD_ICONS[classifyMood(mood).name] || '' : '';
}

const SPAWN_THROTTLE_MS = 300;
const DEDUP_WINDOW_MS   = 2000;
const BUBBLE_LIFE_MS    = 1500;
const FADE_OUT_MS       = 200;

let _active     = null;
let _lastSpawn  = 0;
let _lastText   = '';

export function popBubble(part, text) {
  if (!text || !part) return;
  const layer = document.getElementById('speech-bubbles');
  if (!layer) return;
  const now = performance.now();

  if (now - _lastSpawn < SPAWN_THROTTLE_MS) return;
  if (text === _lastText && now - _lastSpawn < DEDUP_WINDOW_MS) return;

  // Pre-empt the current bubble with a fast fade so two never overlap.
  if (_active) {
    const old = _active;
    old.classList.add('bubble-leaving');
    setTimeout(() => old.remove(), FADE_OUT_MS);
    _active = null;
  }

  const el = document.createElement('div');
  el.className = 'bubble';
  const icon = iconFor(part);
  el.textContent = icon ? `${icon} ${text}` : text;
  el.style.left = `${part.position.x}px`;
  el.style.top  = `${part.position.y}px`;
  layer.appendChild(el);

  _active    = el;
  _lastSpawn = now;
  _lastText  = text;

  setTimeout(() => {
    if (_active === el) _active = null;
    el.remove();
  }, BUBBLE_LIFE_MS);
}

// Clickable variant, used by `hallucinate` to give a 1.5s reaction window.
// `onClick(text)` fires if the player clicks the bubble before it expires.
// `onIgnore()` fires when it expires unclicked. Bypasses popBubble's single-
// active throttle so a hit-window can land even mid-bubble; the existing
// active bubble is still pre-empted.
export function popClickableBubble(part, text, { onClick, onIgnore, lifeMs = 1500 } = {}) {
  if (!text || !part) return;
  const layer = document.getElementById('speech-bubbles');
  if (!layer) return;

  if (_active) {
    const old = _active;
    old.classList.add('bubble-leaving');
    setTimeout(() => old.remove(), FADE_OUT_MS);
    _active = null;
  }

  const el = document.createElement('div');
  el.className = 'bubble bubble-clickable';
  el.textContent = `❓ ${text}`;
  el.style.left = `${part.position.x}px`;
  el.style.top  = `${part.position.y}px`;
  el.style.pointerEvents = 'auto';
  el.style.cursor = 'pointer';
  layer.appendChild(el);

  let consumed = false;
  el.addEventListener('mousedown', (ev) => {
    if (consumed) return;
    consumed = true;
    ev.stopPropagation();
    ev.preventDefault();
    onClick?.(text);
    el.classList.add('bubble-leaving');
    setTimeout(() => el.remove(), FADE_OUT_MS);
  });

  _active    = el;
  _lastSpawn = performance.now();
  _lastText  = text;

  setTimeout(() => {
    if (consumed) return;
    consumed = true;
    if (_active === el) _active = null;
    onIgnore?.();
    el.remove();
  }, lifeMs);
}
