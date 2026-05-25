// Boss-fight nameplate. Pure-aesthetic transient, logo + name + provider
// + thin accent underline. Plays a one-shot intro→hold→outro on every
// call (boot, character switch, anything). No persistent surface, no
// mood binding; once the cycle ends the nameplate is invisible.

import { CHARACTERS, LOGO_SVG } from '../physics/characters.js';

let _root  = null;
let _logo  = null;
let _name  = null;
let _sub   = null;
let _animTimer = null;

// Must match the boss-cycle keyframe duration in styles/chrome.css.
const ANIM_MS = 2800;

export function bindBossNameplate() {
  _root = document.getElementById('boss-nameplate');
  if (!_root) return;
  _logo = _root.querySelector('.boss-logo');
  _name = _root.querySelector('.boss-name');
  _sub  = _root.querySelector('.boss-subtitle');
}

export function showBossNameplate(charId) {
  if (!_root || !_name || !_sub) return;
  const c = CHARACTERS.find(ch => ch.id === charId);
  if (!c) return;
  if (_logo) _logo.innerHTML = LOGO_SVG[charId] || '';
  _name.textContent = c.name;
  _sub.textContent  = c.provider || '';

  _root.classList.remove('boss-anim');
  // Force reflow so re-adding the class restarts the animation cleanly
  // when callers re-trigger before the previous cycle finishes.
  void _root.offsetWidth;
  _root.classList.add('boss-anim');
  if (_animTimer) clearTimeout(_animTimer);
  _animTimer = setTimeout(() => _root.classList.remove('boss-anim'), ANIM_MS);
}
