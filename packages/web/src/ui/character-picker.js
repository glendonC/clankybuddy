// Character picker, theming, and per-character accent CSS variables.
// Theme accent per character, shown in chrome (toolbar highlight, slot
// active state, character-picker glow). Picked to read on the dark UI
// even when the buddy's body color (c.body) is too dark or too saturated
// to use directly.

import { getActiveChar, setActiveCharId } from '../state/active-character.js';
import { listPersonas } from '../personas/index.js';

export { getActiveChar };

export const ACCENT = {
  claude:   '#d97757',  // Anthropic coral
  gpt:      '#10a37f',  // OpenAI green
  gemini:   '#4285f4',  // Google blue
  grok:     '#f5f5f5',  // xAI white-on-black
  llama:    '#0866ff',  // Meta blue
  deepseek: '#7c8ff5',  // DeepSeek lightened indigo
};

const charListeners = [];

export function onCharChange(fn) { charListeners.push(fn); }

export function setActiveChar(id) {
  setActiveCharId(id);
  document.querySelectorAll('.char-btn').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  const c = listPersonas().find(ch => ch.id === id);
  if (c) applyCharacterTheme(c);
  charListeners.forEach(fn => fn(id));
  // Notify the target-picker (and any other listeners) so the chrome label
  // updates regardless of which path triggered the swap.
  document.dispatchEvent(new CustomEvent('clanky:char-change', { detail: { id } }));
}

export function buildCharacterPicker(rootEl) {
  const root = rootEl ?? document.getElementById('character-picker');
  if (!root) return;
  root.innerHTML = '';
  for (const c of listPersonas()) {
    const btn = document.createElement('button');
    btn.className = 'char-btn';
    btn.dataset.id = c.id;
    btn.textContent = c.displayName;
    btn.title = c.provider || c.displayName;
    // Each chip carries its model's accent color via a CSS var so the dot +
    // active underline render in that color regardless of which model is
    // currently themed globally.
    btn.style.setProperty('--btn-accent', ACCENT[c.id] || '#ededf0');
    btn.addEventListener('click', () => setActiveChar(c.id));
    root.appendChild(btn);
  }
  setActiveChar(getActiveChar());
}

export function applyCharacterTheme(c) {
  const accent = ACCENT[c.id] || '#ededf0';
  const root = document.documentElement;
  root.style.setProperty('--char-accent', accent);
  root.style.setProperty('--char-accent-soft', hexA(accent, 0.10));
  // Stage spotlight, stronger than accent-soft. Used by stage.css for the
  // atmospheric wash behind the buddy and by the wallet num text-shadow.
  // Light theme stays subtler; dark theme can take a bigger pop.
  const isLight = document.body.classList.contains('theme-light');
  root.style.setProperty('--char-accent-glow', hexA(accent, isLight ? 0.12 : 0.24));
  // Contrast-safe variant for any place that draws a solid stroke/fill in
  // the accent color against the page surface (boss-bar, equipped rings,
  // etc.). When the accent is near-white AND the theme is light the raw
  // accent disappears, fall back to ink. Grok's #ffffff was the case
  // that surfaced this.
  const lum = relLuma(accent);
  const strong = (isLight && lum > 0.85) ? '#15161a' : accent;
  root.style.setProperty('--char-accent-strong', strong);
}

// Quick relative-luminance approximation. Skips the sRGB linearization
// step, close enough for "is this color readable on white" branching.
function relLuma(hex) {
  const c = hex.replace('#', '');
  const n = parseInt(c, 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8)  & 0xff) / 255;
  const b = ( n        & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexA(hex, a) {
  const c = hex.replace('#','');
  const num = parseInt(c, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}
