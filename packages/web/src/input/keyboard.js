// Slot-based keyboard for the single "pick ten" hotbar.
//
//   no modifier     → bar 0 (1-9, 0)
//   (Cmd / Alt are reserved for browser shortcuts and skipped.)
//
// Uses e.code (physical key) so shifted "1" still resolves to "Digit1"
// rather than "!". Skips form fields so settings inputs keep working.
// Space remains a hard-bound shortcut to 'grab'.
//
// Persona switching: [ prev, ] next, ` flip to last-used. All single-key,
// browser-safe (no modifier chord conflicts with Cmd+N / Ctrl+T / etc).

import { setActiveTool, setActiveToolByBarSlot } from '../ui/hotbar.js';
import { isToolUnlocked } from '../progression/state.js';
import { openPicker, isSlotPickerOpen, closeSlotPicker } from '../ui/slot-picker.js';
import { setActiveChar, getActiveChar, onCharChange } from '../ui/character-picker.js';
import { listPersonas } from '../personas/index.js';

// Track the previous persona for the ` flip key. Updated on every char-change
// event so it's correct even when the swap came from the mouse picker, not
// this file's bracket keys.
let _prevPersonaId = null;
let _initialized = false;
function initPersonaTracking() {
  if (_initialized) return;
  _initialized = true;
  let lastSeen = getActiveChar();
  onCharChange((id) => {
    if (id !== lastSeen) {
      _prevPersonaId = lastSeen;
      lastSeen = id;
    }
  });
}

function cyclePersona(delta) {
  const personas = listPersonas();
  if (!personas.length) return;
  const ids = personas.map(p => p.id);
  const cur = getActiveChar();
  const i = ids.indexOf(cur);
  const next = ids[((i < 0 ? 0 : i) + delta + ids.length) % ids.length];
  setActiveChar(next);
}

function flipToLastPersona() {
  if (!_prevPersonaId) return;
  setActiveChar(_prevPersonaId);
}

export function bindKeyboard() {
  initPersonaTracking();
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // Modified number keys are reserved for browser/OS text shortcuts and no
    // longer address hidden hotbars.
    if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;

    // Space → grab (always-on shortcut, doesn't depend on hotbar slot).
    if (e.code === 'Space') {
      if (isToolUnlocked('grab')) { e.preventDefault(); setActiveTool('grab'); }
      return;
    }

    // S → toggle shop. Matches the badge on the upgrades button.
    if (e.code === 'KeyS') {
      e.preventDefault();
      if (isSlotPickerOpen()) closeSlotPicker(); else openPicker();
      return;
    }

    // Persona cycling, [ prev, ] next, ` last-used.
    if (e.code === 'BracketLeft')  { e.preventDefault(); cyclePersona(-1); return; }
    if (e.code === 'BracketRight') { e.preventDefault(); cyclePersona(+1); return; }
    if (e.code === 'Backquote')    { e.preventDefault(); flipToLastPersona(); return; }

    const slot = slotFromCode(e.code);
    if (slot < 0) return;
    e.preventDefault();
    setActiveToolByBarSlot(0, slot);
  });
}

function slotFromCode(code) {
  if (code === 'Digit0') return 9;
  if (code.startsWith('Digit')) {
    const n = Number(code.slice(5));
    if (n >= 1 && n <= 9) return n - 1;
  }
  return -1;
}
