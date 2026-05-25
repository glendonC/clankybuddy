// Global player-facing settings. Persisted to localStorage. Imported anywhere
// chrome / gameplay needs to branch on a toggle (mute SFX, reduce motion,
// debug overlay, live mode).
//
// Keep the surface narrow: anything stored here is something the player can
// see and toggle from the gear popover.

import { emit as emitTelemetry } from '../telemetry/events.js';

const KEY = 'clankybuddy.settings.v2';

const DEFAULTS = {
  reduceMotion: false,
  muteSFX: false,
  debugOverlay: false,
  theme: 'dark',           // 'dark' | 'light', applied as body.theme-<value>
  // Live mode = the buddy has agency: idle walking, cursor/projectile dodge,
  // panic moves. Off by default (per docs/ideas.md "classic mode is the
  // default for purists"), the always-on default was making the buddy glide
  // around on its own and contradicting the stress-relief premise.
  liveMode: false,
};

let _state = load();
const _listeners = [];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const next = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) next[key] = parsed[key];
    }
    return next;
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(_state)); } catch {}
}

export function getSettings() { return _state; }

export function getSetting(key) { return _state[key]; }

export function setSetting(key, value) {
  if (_state[key] === value) return;
  _state[key] = value;
  save();
  emitSettingsChanged(key, value);
  for (const fn of _listeners) fn(key, value, _state);
}

export function onSettingsChange(fn) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

const TELEMETRY_SETTING_KEYS = {
  reduceMotion: 'reduce_motion',
  muteSFX: 'mute_sfx',
  debugOverlay: 'debug_overlay',
};

function emitSettingsChanged(key, value) {
  const setting = TELEMETRY_SETTING_KEYS[key];
  if (!setting) return;
  emitTelemetry({
    type: 'settings_changed',
    setting,
    value,
  });
}
