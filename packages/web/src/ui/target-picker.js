// Target picker, fighting-game character select. Centered modal, dimmed
// stage, portrait-dominant grid. Each card is a big persona-body-colored
// square with the logo dead-center, name underneath. Active card outlined
// in the persona accent. No taglines, no stats, no signature teaser, the
// portrait + name carries the identity, the same way SF6/Tekken/Smash
// rosters do. Stats and signature copy live in the shop, where they
// belong with progression chrome.
//
// Identity itself lives in the top-center boss nameplate; this module no
// longer owns a primary trigger button. Anything tagged
// [data-action="open-target-picker"] (currently the bottom-left "switch"
// button in the chat-actions row) opens the picker.

import { listPersonas } from '../personas/index.js';
import { setActiveChar, getActiveChar } from './character-picker.js';

let _root = null;
let _onDocClick = null;

export function bindTargetPicker() {
  for (const trigger of document.querySelectorAll('[data-action="open-target-picker"]')) {
    bindTrigger(trigger);
  }
}

function bindTrigger(el) {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_root) close(); else open();
  });
}

function open() {
  _root = document.createElement('div');
  _root.className = 'target-modal';
  _root.setAttribute('role', 'dialog');
  _root.setAttribute('aria-modal', 'true');
  _root.setAttribute('aria-label', 'select target');
  _root.innerHTML = `
    <div class="target-modal-backdrop"></div>
    <div class="target-modal-panel">
      <div class="target-modal-eyebrow">select target</div>
      <div class="target-grid"></div>
    </div>
  `;
  const grid = _root.querySelector('.target-grid');
  const activeId = getActiveChar();
  for (const persona of listPersonas()) {
    grid.appendChild(buildCard(persona, persona.id === activeId));
  }
  _root.querySelector('.target-modal-backdrop').addEventListener('click', close);
  document.body.appendChild(_root);
  _onDocClick = (e) => {
    if (_root && !_root.contains(e.target)) close();
  };
  setTimeout(() => document.addEventListener('click', _onDocClick), 0);
  window.addEventListener('keydown', onEsc, true);
}

function buildCard(persona, isActive) {
  const card = document.createElement('button');
  card.className = 'target-card';
  card.type = 'button';
  if (isActive) card.classList.add('active');

  // Inline CSS vars so per-persona accent + body flow into borders, glow,
  // and the portrait fill without per-id stylesheet branches.
  card.style.setProperty('--persona-body', persona.body || '#888');
  card.style.setProperty('--persona-accent', persona.accent || '#fff');

  card.innerHTML = `
    <div class="target-card-portrait">
      <div class="target-card-logo">${persona.logoSvg || ''}</div>
    </div>
    <div class="target-card-name">${escapeHTML(persona.displayName)}</div>
  `;
  card.addEventListener('click', () => {
    setActiveChar(persona.id);
    close();
  });
  return card;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function close() {
  if (!_root) return;
  _root.remove();
  _root = null;
  if (_onDocClick) document.removeEventListener('click', _onDocClick);
  _onDocClick = null;
  window.removeEventListener('keydown', onEsc, true);
}

function onEsc(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); }
}
