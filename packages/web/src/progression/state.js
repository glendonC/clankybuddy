// Persistent meta-progression state, currency + per-character unlocked
// tools / nodes / hotbars / mood-state firsts. Backed by localStorage.
//
// Save format is versioned. v1 → v2 → v3 → v4 → v5 → v6 → v7 migrations in
// ./migrate.js. v5 introduced per-character progression. v6 was a pure
// group-id rewrite (Phase 1 of the 2026-05-02 ability redesign, see
// docs/abilities.md): `g.gifts/blessings.* → g.provision.*`,
// `g.melee.* → g.kinetic.*`, `g.ranged.* → g.ordnance.*`,
// `g.elemental.* → g.corruption.*`, `g.god.* → g.cataclysm.*`. v7 scrubs
// the 5 retired prestige archetype ids from unlockedNodesGlobal and
// refunds their costs (4000/5000/5500/7500/8000) to currency. Shape is
// otherwise unchanged.
//
// Compat shim: legacy code reads `state.unlockedTools`, `state.unlockedNodes`,
// `state.equippedBars`, `state.visibleBars`, `state.seenStates` directly.
// We expose those as live mirrors of the *active character's* slice, they
// always point at the same arrays the per-char accessors return. When the
// active character changes, the mirrors swap. Mutations through these
// references go straight to the per-char slice (they ARE the slice).

import { migrate, SAVE_VERSION, makeFreshV5 } from './migrate.js';
import { FREE_STARTER_NODE_IDS, getGroupNode } from './groups/index.js';
import { getNode as getMasterNode } from './trees/index.js';
import { emit as emitTelemetry } from '../telemetry/events.js';
import { PERSONA_IDS } from '@clankybuddy/shared/personas';

const STORAGE_KEY    = 'clankybuddy.save.v8';
const STORAGE_KEY_V7 = 'clankybuddy.save.v7';
const STORAGE_KEY_V6 = 'clankybuddy.save.v6';
const STORAGE_KEY_V5 = 'clankybuddy.save.v5';
const STORAGE_KEY_V4 = 'clankybuddy.save.v4';
const STORAGE_KEY_V3 = 'clankybuddy.save.v3';
const STORAGE_KEY_V2 = 'clankybuddy.save.v2';
const STORAGE_KEY_V1 = 'clankybuddy.save.v1';

// Tools the player starts with, minimal viable kit to play meaningfully.
// These match the cost:0 toolNodes seeded from the group trees below. Grab
// is unlocked too but lives in the fixed system slot left of the hotbar
// (TOOLS_BY_ID.grab.system === true), so it's listed in SYSTEM_TOOLS rather
// than the auto-equip set; the slot-seeder in defaultBars() skips it.
export const SYSTEM_TOOLS          = ['grab'];
export const DEFAULT_UNLOCKED_TOOLS = ['pet', 'feed', 'punch', ...SYSTEM_TOOLS];

// Hotbar geometry. One primary "pick ten" bar, keyboard-row keys 1-9 and 0.
// Older saves may still contain retired extra bars; repair() truncates them.
export const HOTBAR_SLOTS = 10;
export const NUM_BARS     = 1;

const ALL_CHAR_IDS = [...PERSONA_IDS];
// Default character matches the picker's CHARACTERS[0] ('claude' as of this
// writing). Computed at module load so a future re-order in PERSONA_IDS
// doesn't drift.
const DEFAULT_CHAR_ID = ALL_CHAR_IDS[0];

// Active character is mirrored here for state-mutation routing. UI calls
// setActiveCharForProgression() from character-picker.onCharChange so the
// per-char accessors and the compat mirrors swap together.
let _activeCharId = DEFAULT_CHAR_ID;

function emptyBar() { return Array(HOTBAR_SLOTS).fill(null); }
function defaultBars() {
  const bars = Array.from({ length: NUM_BARS }, emptyBar);
  // Seed bar 0 with the starter loadout so the player has things to click
  // on a fresh save. System tools (grab) skip the seed, they have fixed
  // slots outside the hotbar and would be a duplicate UI surface otherwise.
  const seedable = DEFAULT_UNLOCKED_TOOLS.filter(id => !SYSTEM_TOOLS.includes(id));
  seedable.forEach((id, i) => { bars[0][i] = id; });
  return bars;
}
function defaultVisibleBars() {
  const v = Array(NUM_BARS).fill(false);
  v[0] = true;
  return v;
}

function freshState() {
  return makeFreshV5({
    defaultUnlockedTools: DEFAULT_UNLOCKED_TOOLS,
    defaultBars,
    defaultVisibleBars,
    freeStarterNodes: FREE_STARTER_NODE_IDS,
  });
}

function load() {
  // v8 path (current).
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const m = migrate(JSON.parse(raw), DEFAULT_UNLOCKED_TOOLS);
      if (m) return repair(m);
    }
  } catch { /* fall through */ }
  // v7 fallback.
  try {
    const rawV7 = localStorage.getItem(STORAGE_KEY_V7);
    if (rawV7) {
      const m = migrate(JSON.parse(rawV7), DEFAULT_UNLOCKED_TOOLS);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch {}
        try { localStorage.removeItem(STORAGE_KEY_V7); } catch {}
        return repair(m);
      }
    }
  } catch { /* fall through */ }
  // v6 fallback.
  try {
    const rawV6 = localStorage.getItem(STORAGE_KEY_V6);
    if (rawV6) {
      const m = migrate(JSON.parse(rawV6), DEFAULT_UNLOCKED_TOOLS);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch {}
        try { localStorage.removeItem(STORAGE_KEY_V6); } catch {}
        return repair(m);
      }
    }
  } catch { /* fall through */ }
  // v5 fallback.
  try {
    const rawV5 = localStorage.getItem(STORAGE_KEY_V5);
    if (rawV5) {
      const m = migrate(JSON.parse(rawV5), DEFAULT_UNLOCKED_TOOLS);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch {}
        try { localStorage.removeItem(STORAGE_KEY_V5); } catch {}
        return repair(m);
      }
    }
  } catch { /* fall through */ }
  // v4 fallback.
  try {
    const rawV4 = localStorage.getItem(STORAGE_KEY_V4);
    if (rawV4) {
      const m = migrate(JSON.parse(rawV4), DEFAULT_UNLOCKED_TOOLS);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch {}
        try { localStorage.removeItem(STORAGE_KEY_V4); } catch {}
        return repair(m);
      }
    }
  } catch { /* fall through */ }
  // v3 fallback.
  try {
    const rawV3 = localStorage.getItem(STORAGE_KEY_V3);
    if (rawV3) {
      const m = migrate(JSON.parse(rawV3), DEFAULT_UNLOCKED_TOOLS);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch {}
        try { localStorage.removeItem(STORAGE_KEY_V3); } catch {}
        return repair(m);
      }
    }
  } catch { /* fall through */ }
  // v2 fallback.
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const m = migrate(JSON.parse(rawV2), DEFAULT_UNLOCKED_TOOLS);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch {}
        try { localStorage.removeItem(STORAGE_KEY_V2); } catch {}
        return repair(m);
      }
    }
  } catch { /* fall through */ }
  // v1 fallback.
  try {
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const m = migrate(JSON.parse(rawV1), DEFAULT_UNLOCKED_TOOLS);
      if (m) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m)); } catch {}
        try { localStorage.removeItem(STORAGE_KEY_V1); } catch {}
        return repair(m);
      }
    }
  } catch { /* fall through */ }
  return freshState();
}

// Legacy node IDs that have been renamed in-place. Repair() rewrites stored
// per-char unlockedNodes through this map so a returning player keeps their
// unlocks when a tool moves between groups. Map is one-way (old → new).
//
// The freeze entries are pre-Phase-1 (they survived through the
// `g.elemental.freeze` carve-out in migrate.js's PRE_REWRITE_EXACT, but
// are kept here as defense-in-depth in case a save bypasses migration).
//
// The lightning entries are Phase 2 (lightning moved from corruption →
// ordnance). No save-version bump for the move; LEGACY_NODE_ID_MAP is
// the documented mechanism for in-place id changes within a version.
const LEGACY_NODE_ID_MAP = {
  'g.elemental.freeze':          'g.manipulation.freeze',
  'g.elemental.freeze.duration': 'g.manipulation.freeze.duration',
  'g.elemental.freeze.conduct':  'g.manipulation.freeze.conduct',
  'g.corruption.lightning':         'g.ordnance.lightning',
  'g.corruption.lightning.chains':  'g.ordnance.lightning.chains',
  'g.corruption.lightning.zeus':    'g.ordnance.lightning.zeus',
  // Phase 7, `injection` group retired; gaslight folded into corruption.
  'g.injection.gaslight':           'g.corruption.gaslight',
  'g.injection.gaslight.deepcut':   'g.corruption.gaslight.deepcut',
  'g.injection.gaslight.permanent': 'g.corruption.gaslight.permanent',
  // Phase 7, bear_trap + meathook moved from manipulation → kinetic
  // (both deal direct damage + bleed; utility-spine was wrong).
  'g.manipulation.bear_trap':       'g.kinetic.bear_trap',
  'g.manipulation.bear_trap.bite':  'g.kinetic.bear_trap.bite',
  'g.manipulation.meathook':        'g.kinetic.meathook',
  'g.manipulation.meathook.yank':   'g.kinetic.meathook.yank',
};

// Ensure the v5 envelope is well-formed and every character slice is shaped
// correctly. Defensive, repair never throws even if storage was hand-edited.
function repair(s) {
  if (typeof s.currency !== 'number' || !Number.isFinite(s.currency)) s.currency = 0;
  if (typeof s.lifetimeEarned !== 'number') s.lifetimeEarned = 0;
  if (typeof s.lifetimeSpent  !== 'number') s.lifetimeSpent  = 0;
  if (!Array.isArray(s.unlockedNodesGlobal)) s.unlockedNodesGlobal = [];
  s.unlockedNodesGlobal = [...new Set(s.unlockedNodesGlobal)];
  if (!s.flags || typeof s.flags !== 'object') s.flags = {};
  if (typeof s.clientId !== 'string' || !s.clientId.length) s.clientId = makeClientId();
  if (typeof s.updatedAt !== 'number') s.updatedAt = Date.now();
  if (!s.byCharacter || typeof s.byCharacter !== 'object') s.byCharacter = {};

  // Drop unknown char keys so renamed/retired personas don't leave orphans.
  for (const k of Object.keys(s.byCharacter)) {
    if (!ALL_CHAR_IDS.includes(k)) delete s.byCharacter[k];
  }
  // Ensure every persona has a slice.
  for (const charId of ALL_CHAR_IDS) {
    if (!s.byCharacter[charId]) s.byCharacter[charId] = blankCharSlice();
    repairCharSlice(s.byCharacter[charId]);
  }
  return s;
}

function blankCharSlice() {
  const now = Date.now();
  return {
    unlockedTools: [...DEFAULT_UNLOCKED_TOOLS],
    unlockedNodes: [...FREE_STARTER_NODE_IDS],
    equippedBars:  defaultBars(),
    visibleBars:   defaultVisibleBars(),
    lifetimeEarned: 0,
    lifetimeSpent:  0,
    seenStates: {},
    firstSeenAt:  now,
    lastPlayedAt: now,
    modeState: {},
    schemaPatch: 0,
  };
}

function repairCharSlice(c) {
  if (!Array.isArray(c.unlockedTools)) c.unlockedTools = [...DEFAULT_UNLOCKED_TOOLS];
  for (const t of DEFAULT_UNLOCKED_TOOLS) {
    if (!c.unlockedTools.includes(t)) c.unlockedTools.push(t);
  }
  if (!Array.isArray(c.unlockedNodes)) c.unlockedNodes = [...FREE_STARTER_NODE_IDS];
  // Rewrite legacy node ids in place, then dedupe + reseed free starters.
  c.unlockedNodes = [...new Set(c.unlockedNodes.map((id) => LEGACY_NODE_ID_MAP[id] || id))];
  for (const id of FREE_STARTER_NODE_IDS) {
    if (!c.unlockedNodes.includes(id)) c.unlockedNodes.push(id);
  }
  if (typeof c.lifetimeEarned !== 'number') c.lifetimeEarned = 0;
  if (typeof c.lifetimeSpent  !== 'number') c.lifetimeSpent  = 0;

  // Normalize equippedBars shape, pad/truncate to match current NUM_BARS
  // and HOTBAR_SLOTS so a schema bump doesn't lose user data.
  if (!Array.isArray(c.equippedBars)) c.equippedBars = defaultBars();
  while (c.equippedBars.length < NUM_BARS) c.equippedBars.push(emptyBar());
  c.equippedBars.length = NUM_BARS;
  for (let b = 0; b < NUM_BARS; b++) {
    if (!Array.isArray(c.equippedBars[b])) c.equippedBars[b] = emptyBar();
    while (c.equippedBars[b].length < HOTBAR_SLOTS) c.equippedBars[b].push(null);
    c.equippedBars[b].length = HOTBAR_SLOTS;
    // Drop entries pointing at tools the player no longer owns (defensive).
    c.equippedBars[b] = c.equippedBars[b].map((id) =>
      (id && c.unlockedTools.includes(id)) ? id : null);
  }
  if (!Array.isArray(c.visibleBars)) c.visibleBars = defaultVisibleBars();
  while (c.visibleBars.length < NUM_BARS) c.visibleBars.push(false);
  c.visibleBars.length = NUM_BARS;
  c.visibleBars[0] = true; // bar 0 is always visible, primary action bar

  if (!c.seenStates || typeof c.seenStates !== 'object') c.seenStates = {};
  if (typeof c.firstSeenAt  !== 'number') c.firstSeenAt  = Date.now();
  if (typeof c.lastPlayedAt !== 'number') c.lastPlayedAt = Date.now();
  if (!c.modeState || typeof c.modeState !== 'object') c.modeState = {};
  if (typeof c.schemaPatch !== 'number') c.schemaPatch = 0;
}

function makeClientId() {
  try {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let state = load();
const listeners = [];
const charChangeListeners = [];

// Compat mirrors, point at the active char's slice. Re-aliased on every
// active-character switch so `state.unlockedTools` etc. always reflect the
// current persona without callers needing to migrate.
function aliasMirrors() {
  const slice = state.byCharacter[_activeCharId];
  state.unlockedTools  = slice.unlockedTools;
  state.unlockedNodes  = slice.unlockedNodes;
  state.equippedBars   = slice.equippedBars;
  state.visibleBars    = slice.visibleBars;
  state.seenStates     = slice.seenStates;
  // lifetimeEarned/lifetimeSpent at top level remain GLOBAL, don't shadow.
}
aliasMirrors();

function persist() {
  state.updatedAt = Date.now();
  // Mirror fields are aliases, JSON.stringify will write them as duplicate
  // keys of the active char's arrays, but the byCharacter slice is the
  // source of truth on reload (repair() drops the loose fields). Strip the
  // mirrors before persisting to keep the on-disk shape clean.
  const persisted = { ...state };
  delete persisted.unlockedTools;
  delete persisted.unlockedNodes;
  delete persisted.equippedBars;
  delete persisted.visibleBars;
  delete persisted.seenStates;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted)); } catch { /* private mode etc. */ }
}

function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.warn('progression listener threw', e); }
  }
}

export function onChange(fn) {
  listeners.push(fn);
  fn(state);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// Apply-upgrades subscribes to this so it can blow away its applied-set and
// re-walk the per-character unlocked nodes whenever the active char swaps.
export function onCharChangeProgression(fn) {
  charChangeListeners.push(fn);
  return () => {
    const i = charChangeListeners.indexOf(fn);
    if (i >= 0) charChangeListeners.splice(i, 1);
  };
}

// Wired from src/main.js boot via character-picker.onCharChange. Keeping the
// call edge there (instead of an import here) avoids a state.js → ui edge
// that would balloon the import graph.
export function setActiveCharForProgression(charId) {
  if (!ALL_CHAR_IDS.includes(charId) || charId === _activeCharId) return;
  _activeCharId = charId;
  aliasMirrors();
  state.byCharacter[_activeCharId].lastPlayedAt = Date.now();
  persist();
  for (const fn of charChangeListeners) {
    try { fn(_activeCharId); } catch (e) { console.warn('charChange listener threw', e); }
  }
  notify();
}

export function getActiveProgressionChar() { return _activeCharId; }

// Resolve a character's slice by id (defaults to active). Caller-side reads.
function slice(charId) {
  return state.byCharacter[charId || _activeCharId] || state.byCharacter[_activeCharId];
}

export function getState() { return state; }
export function getCurrency() { return state.currency; }
export function getUnlockedTools(charId) { return slice(charId).unlockedTools; }
export function getUnlockedNodes(charId) { return slice(charId).unlockedNodes; }
export function getUnlockedNodesGlobal() { return state.unlockedNodesGlobal; }
export function getCharSlice(charId) { return slice(charId); }

// ----- multi-bar hotbar API -----

export function getEquippedBars(charId) { return slice(charId).equippedBars; }
export function getEquippedBar(barIdx, charId) {
  return slice(charId).equippedBars[barIdx] ?? emptyBar();
}
export function getVisibleBars(charId) { return slice(charId).visibleBars; }
export function getVisibleBarCount(charId) { return slice(charId).visibleBars.filter(Boolean).length; }
export function isBarVisible(barIdx, charId) { return !!slice(charId).visibleBars[barIdx]; }

export function setBarVisible(barIdx, visible, charId) {
  if (barIdx < 0 || barIdx >= NUM_BARS) return false;
  if (barIdx === 0) return false; // bar 0 always visible
  const c = slice(charId);
  const v = !!visible;
  if (c.visibleBars[barIdx] === v) return false;
  c.visibleBars[barIdx] = v;
  persist();
  notify();
  return true;
}

// Reveal the next hidden bar in order. Returns the bar index revealed, or -1
// if all bars are already visible.
export function showNextBar(charId) {
  const c = slice(charId);
  for (let b = 1; b < NUM_BARS; b++) {
    if (!c.visibleBars[b]) {
      c.visibleBars[b] = true;
      persist();
      notify();
      return b;
    }
  }
  return -1;
}

// Dismiss a revealed bar. Bar 0 cannot be hidden. Slot bindings are kept on
// disk so re-revealing the bar restores them.
export function hideBar(barIdx, charId) {
  if (barIdx <= 0 || barIdx >= NUM_BARS) return false;
  const c = slice(charId);
  if (!c.visibleBars[barIdx]) return false;
  c.visibleBars[barIdx] = false;
  persist();
  notify();
  return true;
}

export function isToolUnlocked(id, charId) {
  return slice(charId).unlockedTools.includes(id);
}

export function isNodeUnlocked(id, charId) {
  // Master-tree node ids are global; group-tree ids are per-char.
  if (typeof id === 'string' && !id.startsWith('g.')) {
    return state.unlockedNodesGlobal.includes(id);
  }
  return slice(charId).unlockedNodes.includes(id);
}

// "Equipped" now means "present in any visible bar slot" of the given char.
export function isToolEquipped(id, charId) {
  const c = slice(charId);
  for (let b = 0; b < NUM_BARS; b++) {
    if (!c.visibleBars[b]) continue;
    if (c.equippedBars[b].includes(id)) return true;
  }
  return false;
}

// Locate (barIdx, slotIdx) for a tool. Returns { bar, slot } or null. Searches
// only visible bars so dev'd-in slots on hidden bars don't claim ownership.
export function findEquippedSlot(id, charId) {
  const c = slice(charId);
  for (let b = 0; b < NUM_BARS; b++) {
    if (!c.visibleBars[b]) continue;
    const s = c.equippedBars[b].indexOf(id);
    if (s >= 0) return { bar: b, slot: s };
  }
  return null;
}

// Equip a tool into the next free slot of the lowest visible bar. Returns
// { bar, slot } on success, null if no free slot anywhere.
export function equipTool(id, charId) {
  const c = slice(charId);
  if (!c.unlockedTools.includes(id)) return null;
  const existing = findEquippedSlot(id, charId);
  if (existing) return existing;
  for (let b = 0; b < NUM_BARS; b++) {
    if (!c.visibleBars[b]) continue;
    const s = c.equippedBars[b].indexOf(null);
    if (s >= 0) {
      c.equippedBars[b][s] = id;
      persist();
      notify();
      emitToolEquip(b, s, id);
      return { bar: b, slot: s };
    }
  }
  return null;
}

// Equip a tool into a specific (bar, slot). Swaps the previous occupant
// out (still owned, just unequipped) and de-dupes from any other slot.
export function equipToolInSlot(id, bar, slot, charId) {
  if (bar < 0 || bar >= NUM_BARS) return false;
  if (slot < 0 || slot >= HOTBAR_SLOTS) return false;
  const c = slice(charId);
  if (id !== null && !c.unlockedTools.includes(id)) return false;
  const previous = c.equippedBars[bar][slot] ?? null;
  // De-dupe: if this id is already in another slot anywhere, clear it.
  if (id) {
    for (let b = 0; b < NUM_BARS; b++) {
      const dup = c.equippedBars[b].indexOf(id);
      if (dup >= 0 && !(b === bar && dup === slot)) {
        c.equippedBars[b][dup] = null;
        emitToolEquip(b, dup, null);
      }
    }
  }
  c.equippedBars[bar][slot] = id;
  persist();
  notify();
  if (previous !== id) emitToolEquip(bar, slot, id);
  return true;
}

export function unequipTool(id, charId) {
  const c = slice(charId);
  let changed = false;
  for (let b = 0; b < NUM_BARS; b++) {
    const s = c.equippedBars[b].indexOf(id);
    if (s >= 0) {
      c.equippedBars[b][s] = null;
      changed = true;
      emitToolEquip(b, s, null);
    }
  }
  if (changed) { persist(); notify(); }
  return changed;
}

export function addCurrency(n) {
  if (!Number.isFinite(n) || n === 0) return;
  state.currency = Math.max(0, state.currency + n);
  if (n > 0) {
    state.lifetimeEarned += n;
    state.byCharacter[_activeCharId].lifetimeEarned += n;
  }
  persist();
  notify();
}

// Returns true on success, false if locked-by-cost or already-unlocked.
// Operates on the active character.
export function unlockTool(id, cost) {
  const c = state.byCharacter[_activeCharId];
  if (c.unlockedTools.includes(id)) return false;
  if (state.currency < cost) return false;
  state.currency -= cost;
  state.lifetimeSpent += cost;
  c.lifetimeSpent += cost;
  c.unlockedTools.push(id);
  persist();
  notify();
  return true;
}

// Returns true on success, false if currency-locked or already-unlocked.
// Caller is responsible for pre-checking that prereqs are met. Master-tree
// nodes write to the global slot; group-tree nodes write to the active char.
export function unlockNode(id, cost) {
  if (typeof id === 'string' && !id.startsWith('g.')) {
    if (state.unlockedNodesGlobal.includes(id)) return false;
    if (state.currency < cost) return false;
    state.currency -= cost;
    state.lifetimeSpent += cost;
    state.unlockedNodesGlobal.push(id);
    persist();
    notify();
    emitUnlockPurchase(id, cost);
    return true;
  }
  const c = state.byCharacter[_activeCharId];
  if (c.unlockedNodes.includes(id)) return false;
  if (state.currency < cost) return false;
  state.currency -= cost;
  state.lifetimeSpent += cost;
  c.lifetimeSpent += cost;
  c.unlockedNodes.push(id);
  persist();
  notify();
  emitUnlockPurchase(id, cost);
  return true;
}

function emitToolEquip(barIdx, slotIdx, toolId, source = 'picker') {
  emitTelemetry({
    type: 'tool_equip',
    bar_idx: barIdx,
    slot_idx: slotIdx,
    tool_id: toolId,
    source,
  });
}

function emitUnlockPurchase(nodeId, cost) {
  const node = getGroupNode(nodeId) || getMasterNode(nodeId);
  const unlocksKind = node?.kind === 'tool' ? 'tool' : 'stat';
  const unlocksTarget = node?.kind === 'tool'
    ? node.toolId
    : (node?.toolId && node.toolId !== 'master' ? node.toolId : null);
  const clientTs = Date.now();
  emitTelemetry({
    type: 'currency_spent',
    amount: cost,
    reason: 'unlock',
    node_id: nodeId,
  }, { clientTs });
  emitTelemetry({
    type: 'unlock_purchased',
    node_id: nodeId,
    cost,
    unlocks_kind: unlocksKind,
    unlocks_target: unlocksTarget,
  }, { clientTs });
}

// ----- dev/admin helpers -----

export function setCurrency(n) {
  state.currency = Math.max(0, Math.floor(Number(n) || 0));
  persist();
  notify();
}

export function devGrantCurrency(n) {
  if (!Number.isFinite(n)) return;
  state.currency = Math.max(0, state.currency + n);
  persist();
  notify();
}

export function devUnlockTools(ids, charId) {
  const c = slice(charId);
  let changed = false;
  for (const id of ids) {
    if (!c.unlockedTools.includes(id)) { c.unlockedTools.push(id); changed = true; }
  }
  if (changed) { persist(); notify(); }
}

export function devUnlockNodes(ids, charId) {
  let changed = false;
  for (const id of ids) {
    if (typeof id === 'string' && !id.startsWith('g.')) {
      if (!state.unlockedNodesGlobal.includes(id)) { state.unlockedNodesGlobal.push(id); changed = true; }
    } else {
      const c = slice(charId);
      if (!c.unlockedNodes.includes(id)) { c.unlockedNodes.push(id); changed = true; }
    }
  }
  if (changed) { persist(); notify(); }
}

// First time a character has reached a given mood state, caller can award
// bonus. seenStates moved INTO each character's slice in v5; we still accept
// the legacy (charId, stateName) signature so earn.js doesn't need changes.
export function markSeenState(charId, stateName) {
  const c = slice(charId);
  if (c.seenStates[stateName]) return false;
  c.seenStates[stateName] = true;
  persist();
  return true;
}

// Hard reset for testing / "new game".
export function resetSave() {
  state = freshState();
  _activeCharId = DEFAULT_CHAR_ID;
  aliasMirrors();
  persist();
  notify();
  for (const fn of charChangeListeners) {
    try { fn(_activeCharId); } catch { /* ignore */ }
  }
}
// Expose for the dev console: window.__clankyReset = resetSave
if (typeof window !== 'undefined') window.__clankyReset = resetSave;
