// Versioned save migration. Older versions cascade upward through the chain.
// Pure functions; no localStorage I/O.
//
// v1 → v2: filled in the new fields (unlockedNodes, lifetimeSpent).
// v2 → v3: per-tool tree retired; group-tree replaces it. Old node ids are
//   dropped (refunds out of scope, players keep currency and rebuy under
//   the new shape).
// v3 → v4: hotbar gains FFXIV-style multi-bar architecture. The old flat
//   `equippedTools[10]` is wrapped into bar 0 of `equippedBars[10][12]`.
//   visibleBars defaults to [true, false×9], bar 0 always visible.
// v4 → v5: per-character progression. Currency, lifetime totals, and master-
//   tree node ids stay GLOBAL. Group-tree node ids, unlockedTools, equipped
//   bars, visible bars, and seenStates move INTO each character's slice.
//   v4's flat progression is cloned identically into every PERSONA_ID so a
//   returning player keeps everything they had on their main and finds the
//   same loadout pre-seeded on the other characters. Adds `clientId` and
//   `updatedAt` envelope fields. NO cross-device sync, backup-only.
// v5 → v6: ability-redesign Phase 1 group rename. Pure id rewrite, no
//   shape change. `g.gifts.*` and `g.blessings.*` → `g.provision.*`,
//   `g.melee.*` → `g.kinetic.*`, `g.ranged.*` → `g.ordnance.*`,
//   `g.elemental.*` → `g.corruption.*`, `g.god.*` → `g.cataclysm.*`. Master-
//   tree node ids (anything not starting with `g.`) are unaffected and stay
//   in unlockedNodesGlobal.
// v6 → v7: mastery retirement. The 5 prestige archetype ids
//   (master.archetype.{petter,adversary,sycophant,researcher,whale}) are
//   scrubbed from unlockedNodesGlobal and their costs (4000, 5000, 5500,
//   7500, 8000) refunded to currency. No shape change; pure subtractive.
//   Note: apply-upgrades.refundDeletedNodes also handles these ids at
//   boot via REMOVED_NODE_COSTS, so the migration is belt-and-suspenders
//  , the migration runs once at save bump; the refund pass is idempotent
//   and would catch any ids that snuck through.
// v7 → v8: grab promoted to a fixed system slot left of the hotbar (mirrors
//   the shop button on the right). The hotbar no longer renders grab in any
//   slot, so this pass scrubs grab from every character's equippedBars to
//   prevent the duplicate-UI artifact. Grab stays in unlockedTools, only
//   its hotbar-slot reservation is removed.

import { PERSONA_IDS } from '@clankybuddy/shared/personas';
import { FREE_STARTER_NODE_IDS } from './groups/index.js';

export const SAVE_VERSION = 8;

const RETIRED_ARCHETYPE_COSTS = {
  'master.archetype.petter':     4000,
  'master.archetype.adversary':  5000,
  'master.archetype.sycophant':  5500,
  'master.archetype.researcher': 7500,
  'master.archetype.whale':      8000,
};

// Tools that live in fixed system slots outside the hotbar and are removed
// from equippedBars by the v7 → v8 migration. Mirrors the SYSTEM_TOOLS list
// in state.js (kept in sync manually, both are small).
const V7_SYSTEM_TOOL_IDS = new Set(['grab']);

const NUM_BARS_V4    = 10;
const HOTBAR_SLOTS_V4 = 12;

// PERSONA_IDS is the canonical roster from packages/shared. We keep our own
// frozen copy so this module stays a pure function (no character-picker import).
const ALL_CHAR_IDS = Object.freeze([...PERSONA_IDS]);

export function migrate(parsed, defaultUnlockedTools) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version === SAVE_VERSION) return parsed;
  if (parsed.version === 1) {
    return v7_to_v8(v6_to_v7(v5_to_v6(v4_to_v5(v3_to_v4(v2_to_v3(v1_to_v2(parsed, defaultUnlockedTools), defaultUnlockedTools))))));
  }
  if (parsed.version === 2) {
    return v7_to_v8(v6_to_v7(v5_to_v6(v4_to_v5(v3_to_v4(v2_to_v3(parsed, defaultUnlockedTools))))));
  }
  if (parsed.version === 3) {
    return v7_to_v8(v6_to_v7(v5_to_v6(v4_to_v5(v3_to_v4(parsed)))));
  }
  if (parsed.version === 4) {
    return v7_to_v8(v6_to_v7(v5_to_v6(v4_to_v5(parsed))));
  }
  if (parsed.version === 5) {
    return v7_to_v8(v6_to_v7(v5_to_v6(parsed)));
  }
  if (parsed.version === 6) {
    return v7_to_v8(v6_to_v7(parsed));
  }
  if (parsed.version === 7) {
    return v7_to_v8(parsed);
  }
  // Unknown future versions → null; caller falls back to a fresh save.
  return null;
}

function v1_to_v2(v1, defaults) {
  return {
    version: 2,
    currency: clampNonNeg(v1.currency),
    unlockedTools: Array.isArray(v1.unlockedTools) ? [...v1.unlockedTools] : [...defaults],
    unlockedNodes: [],
    seenStates: (v1.seenStates && typeof v1.seenStates === 'object') ? v1.seenStates : {},
    lifetimeEarned: typeof v1.lifetimeEarned === 'number' ? v1.lifetimeEarned : 0,
    lifetimeSpent: 0,
  };
}

function v2_to_v3(v2, defaults) {
  return {
    version: 3,
    currency: clampNonNeg(v2.currency),
    unlockedTools: Array.isArray(v2.unlockedTools)
      ? [...new Set([...v2.unlockedTools, ...defaults])]
      : [...defaults],
    unlockedNodes: [],
    seenStates: (v2.seenStates && typeof v2.seenStates === 'object') ? v2.seenStates : {},
    lifetimeEarned: typeof v2.lifetimeEarned === 'number' ? v2.lifetimeEarned : 0,
    lifetimeSpent: typeof v2.lifetimeSpent === 'number' ? v2.lifetimeSpent : 0,
    // equippedTools is left undefined here, state.repair() seeds the v3
    // default [4 starters + 6 nulls] when it sees it missing.
  };
}

function v3_to_v4(v3) {
  // Wrap the flat equippedTools[10] into bar 0 of equippedBars[10][12].
  // Slots 10/11 of bar 0 (the new `-` and `=` keys) start empty.
  const bars = Array.from({ length: NUM_BARS_V4 }, () =>
    Array(HOTBAR_SLOTS_V4).fill(null)
  );
  if (Array.isArray(v3.equippedTools)) {
    for (let i = 0; i < Math.min(v3.equippedTools.length, HOTBAR_SLOTS_V4); i++) {
      bars[0][i] = v3.equippedTools[i] ?? null;
    }
  }
  const visible = Array(NUM_BARS_V4).fill(false);
  visible[0] = true;
  return {
    version: 4,
    currency: clampNonNeg(v3.currency),
    unlockedTools: Array.isArray(v3.unlockedTools) ? [...v3.unlockedTools] : [],
    unlockedNodes: Array.isArray(v3.unlockedNodes) ? [...v3.unlockedNodes] : [],
    equippedBars: bars,
    visibleBars: visible,
    seenStates: (v3.seenStates && typeof v3.seenStates === 'object') ? v3.seenStates : {},
    lifetimeEarned: typeof v3.lifetimeEarned === 'number' ? v3.lifetimeEarned : 0,
    lifetimeSpent: typeof v3.lifetimeSpent === 'number' ? v3.lifetimeSpent : 0,
  };
}

// v4 → v5: per-character progression.
// - Currency + lifetimeEarned + lifetimeSpent stay GLOBAL.
// - Group-tree node ids (g.<group>.*) → cloned into each character's
//   unlockedNodes. Master-tree node ids (anything that doesn't start with
//   `g.`) → unlockedNodesGlobal.
// - unlockedTools / equippedBars / visibleBars cloned identically per char.
// - seenStates was already keyed by charId in v4, re-shape so each entry
//   lives on the matching character. Unknown char keys are dropped.
function v4_to_v5(v4) {
  const allNodes = Array.isArray(v4.unlockedNodes) ? v4.unlockedNodes : [];
  const groupNodes  = allNodes.filter((id) => typeof id === 'string' && id.startsWith('g.'));
  const masterNodes = allNodes.filter((id) => typeof id === 'string' && !id.startsWith('g.'));

  const v4SeenStates = (v4.seenStates && typeof v4.seenStates === 'object') ? v4.seenStates : {};
  const now = Date.now();
  const byCharacter = {};
  for (const charId of ALL_CHAR_IDS) {
    const seenForChar = (v4SeenStates[charId] && typeof v4SeenStates[charId] === 'object')
      ? { ...v4SeenStates[charId] }
      : {};
    byCharacter[charId] = {
      unlockedTools: Array.isArray(v4.unlockedTools) ? [...v4.unlockedTools] : [],
      unlockedNodes: [...groupNodes],
      equippedBars:  cloneBars(v4.equippedBars),
      visibleBars:   cloneVisible(v4.visibleBars),
      lifetimeEarned: 0,
      lifetimeSpent:  0,
      seenStates: seenForChar,
      firstSeenAt:  now,
      lastPlayedAt: now,
      modeState: {},
      schemaPatch: 0,
    };
  }

  return {
    version: 5,
    // Global / shared
    currency: clampNonNeg(v4.currency),
    lifetimeEarned: typeof v4.lifetimeEarned === 'number' ? v4.lifetimeEarned : 0,
    lifetimeSpent:  typeof v4.lifetimeSpent  === 'number' ? v4.lifetimeSpent  : 0,
    unlockedNodesGlobal: [...masterNodes],
    flags: {},
    byCharacter,
    // Sync envelope, preserved through v6. Not load-bearing locally.
    clientId: makeClientId(),
    updatedAt: now,
  };
}

// v5 → v6: pure group-id rewrite for the 2026-05-02 ability redesign
// Phase 1 rename. No shape change. Master-tree node ids (no `g.` prefix)
// pass through untouched.
//
// PRE_REWRITE_EXACT handles ids whose target group is NOT the
// straightforward prefix-rewrite destination. Two carve-outs:
//   1. `g.elemental.freeze.*` moved to `g.manipulation.*` pre-Phase-1
//      (control tool, not damage). Without this carve-out the prefix
//      rewrite would land freeze in `g.corruption.*`, the wrong group.
//   2. `g.elemental.lightning.*` moved to `g.ordnance.*` in Phase 2
//      (ranged-form damage, not status DoT). Same issue, prefix
//      rewrite would land it in `g.corruption.*`.
const PRE_REWRITE_EXACT = {
  'g.elemental.freeze':             'g.manipulation.freeze',
  'g.elemental.freeze.duration':    'g.manipulation.freeze.duration',
  'g.elemental.freeze.conduct':     'g.manipulation.freeze.conduct',
  'g.elemental.lightning':          'g.ordnance.lightning',
  'g.elemental.lightning.chains':   'g.ordnance.lightning.chains',
  'g.elemental.lightning.zeus':     'g.ordnance.lightning.zeus',
};

const GROUP_ID_REWRITES = [
  [/^g\.gifts\./,     'g.provision.'],
  [/^g\.blessings\./, 'g.provision.'],
  [/^g\.melee\./,     'g.kinetic.'],
  [/^g\.ranged\./,    'g.ordnance.'],
  [/^g\.elemental\./, 'g.corruption.'],
  [/^g\.god\./,       'g.cataclysm.'],
];

function rewriteGroupNodeId(id) {
  if (typeof id !== 'string') return id;
  if (PRE_REWRITE_EXACT[id]) return PRE_REWRITE_EXACT[id];
  for (const [re, replacement] of GROUP_ID_REWRITES) {
    if (re.test(id)) return id.replace(re, replacement);
  }
  return id;
}

function v5_to_v6(v5) {
  const byCharacter = {};
  for (const [charId, c] of Object.entries(v5.byCharacter || {})) {
    byCharacter[charId] = {
      ...c,
      unlockedNodes: Array.isArray(c.unlockedNodes)
        ? [...new Set(c.unlockedNodes.map(rewriteGroupNodeId))]
        : [],
    };
  }
  return {
    ...v5,
    version: 6,
    byCharacter,
    updatedAt: Date.now(),
  };
}

function v6_to_v7(v6) {
  const globals = Array.isArray(v6.unlockedNodesGlobal) ? v6.unlockedNodesGlobal : [];
  const kept = [];
  let refund = 0;
  for (const id of globals) {
    const cost = RETIRED_ARCHETYPE_COSTS[id];
    if (cost != null) refund += cost;
    else kept.push(id);
  }
  return {
    ...v6,
    version: 7,
    currency: clampNonNeg((v6.currency || 0) + refund),
    unlockedNodesGlobal: kept,
    updatedAt: Date.now(),
  };
}

function v7_to_v8(v7) {
  const byCharacter = {};
  for (const [charId, c] of Object.entries(v7.byCharacter || {})) {
    const equipped = Array.isArray(c.equippedBars) ? c.equippedBars : [];
    const scrubbed = equipped.map(bar => {
      if (!Array.isArray(bar)) return bar;
      return bar.map(slot => (slot && V7_SYSTEM_TOOL_IDS.has(slot)) ? null : slot);
    });
    byCharacter[charId] = { ...c, equippedBars: scrubbed };
  }
  return {
    ...v7,
    version: 8,
    byCharacter,
    updatedAt: Date.now(),
  };
}

function cloneBars(bars) {
  if (!Array.isArray(bars)) {
    return Array.from({ length: NUM_BARS_V4 }, () => Array(HOTBAR_SLOTS_V4).fill(null));
  }
  const out = Array.from({ length: NUM_BARS_V4 }, () => Array(HOTBAR_SLOTS_V4).fill(null));
  for (let b = 0; b < Math.min(NUM_BARS_V4, bars.length); b++) {
    const src = Array.isArray(bars[b]) ? bars[b] : [];
    for (let s = 0; s < Math.min(HOTBAR_SLOTS_V4, src.length); s++) {
      out[b][s] = src[s] ?? null;
    }
  }
  return out;
}

function cloneVisible(v) {
  const out = Array(NUM_BARS_V4).fill(false);
  out[0] = true;
  if (!Array.isArray(v)) return out;
  for (let b = 0; b < Math.min(NUM_BARS_V4, v.length); b++) out[b] = !!v[b];
  out[0] = true; // bar 0 is always visible
  return out;
}

function clampNonNeg(n) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// Lightweight UUID v4-ish for the sync envelope. Browser crypto when
// available, otherwise a Math.random fallback that's still RFC 4122 v4
// shaped (good enough for a non-cryptographic device-id seed).
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

// Exported so state.js's freshState() can use it to build a v5-shape default
// without duplicating logic.
export function makeFreshV5({ defaultUnlockedTools, defaultBars, defaultVisibleBars, freeStarterNodes }) {
  const now = Date.now();
  const byCharacter = {};
  for (const charId of ALL_CHAR_IDS) {
    byCharacter[charId] = {
      unlockedTools: [...defaultUnlockedTools],
      unlockedNodes: [...freeStarterNodes],
      equippedBars:  defaultBars(),
      visibleBars:   defaultVisibleBars(),
      lifetimeEarned: 0,
      lifetimeSpent:  0,
      seenStates: {},
      firstSeenAt: now,
      lastPlayedAt: now,
      modeState: {},
      schemaPatch: 0,
    };
  }
  return {
    version: SAVE_VERSION,
    currency: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    unlockedNodesGlobal: [],
    flags: {},
    byCharacter,
    clientId: makeClientId(),
    updatedAt: now,
  };
}

// Re-export under the historical `makeFreshV5` name for back-compat;
// the v6 shape is identical (group-id rewrite only). State.js imports
// this name. Future schema bumps may rename, keep the export stable.
export { makeFreshV5 as makeFreshSave };

export const _v5Internals = { ALL_CHAR_IDS, FREE_STARTER_NODE_IDS };
