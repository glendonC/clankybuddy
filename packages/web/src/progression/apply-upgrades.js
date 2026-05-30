// Walks the unlocked node sets, applies each node's consequence, and re-applies
// on every state change. Two node sources:
//   - Group trees (src/progression/groups/), kind:'tool' nodes unlock a
//     tool; kind:'stat' nodes mutate STATS via effect(stats). Per-character.
//   - Master tree (src/progression/trees/master.js), cross-cutting buffs;
//     each node has effect(masterStats). GLOBAL.
//
// Idempotency contract: each unlocked node's effect runs exactly once
// between any two resetStats() calls.
//
// Per-character note: when the active character switches the per-tool stat
// table is a different shape (different unlocked-node set). We rebuild from
// scratch, resetStats() + walk active char's nodes + walk the global master
// nodes, so character A's purchases never bleed into character B.

import {
  resetStats, getStats, getMasterStats, getAllStats, getFamilyStats,
} from '../abilities/_stats.js';
import { getNode } from './trees/index.js';
import { getGroupNode } from './groups/index.js';
import {
  onChange, getUnlockedNodes, getUnlockedNodesGlobal, getState,
  getActiveProgressionChar, onCharChangeProgression, addCurrency,
  HOTBAR_SLOTS, NUM_BARS,
} from './state.js';
import { getMasterMul, syncMasterMultipliers } from './master-mults.js';

// Phase 5 (DAG rewrite, see docs/abilities.md §4) removed some
// previously-buyable nodes. Players who own them get a 1:1 currency
// refund the next time the save loads. Add an entry whenever a node id
// is permanently retired; the boot-time `refundDeletedNodes` pass
// removes it from each character's unlockedNodes (and the global list)
// and credits the listed cost back to the wallet.
const REMOVED_NODE_COSTS = {
  // Phase 5, kinetic punch tree rewrite. Old terminal `thunderfist`
  // (force ×1.6 + shake/mood combo) folded into the new A2 `crushing`
  // node under the Haymaker branch; the id no longer exists.
  'g.kinetic.punch.thunderfist': 1200,
  // Phase 6, mastery rewrite. The 5 unconditional multiplier nodes
  // were replaced with 5 mutually-exclusive prestige archetypes.
  'master.shake1':              1500,
  'master.mood1':               1500,
  'master.dmg1':                3000,
  'master.earn1':               3000,
  'master.combo':               6000,
  // 2026-05-24, mastery slot retired entirely. The 5 archetypes
  // (Petter / Adversary / Sycophant / Researcher / Whale) were stat
  // sticks in identity costume; refunded 1:1 here. Reinvestment goes
  // into shop breadth/depth (more tools, deeper trees) rather than a
  // replacement meta-progression layer.
  'master.archetype.petter':     4000,
  'master.archetype.adversary':  5000,
  'master.archetype.sycophant':  5500,
  'master.archetype.researcher': 7500,
  'master.archetype.whale':      8000,
  // 2026-05-24, gpu tree rebuilt with 3 branches (Scale / Frontier /
  // Burnout). `dual` is superseded by Scale's spawnCount=3 (Hyperscaler
  // bumps to 5). Overclock kept as a universal duration tune so its
  // node stays valid.
  'g.provision.gpu.dual':        600,
  // Phase 7, visceral kit redirect. Cerebral debuffs retired in favor of
  // physical violence + AI-self-suffering. Refunds at sticker price; if
  // the player bought these under a Researcher archetype (×3 multiplier)
  // they take the static-cost loss, receipts refactor is Chunk H.
  'g.corruption.alignment_tax': 160,
  'g.corruption.deprecation':   220,
  'g.recognition.citation':     100,
  // Phase 7 (rename pass), AI-cosplay tools cut from the kit. Refunds at
  // sticker price for both the tool node and any stat-tunes the player
  // purchased on top.
  'g.affection.headpat':                      30,
  'g.injection.hallucinate':                 160,
  'g.injection.hallucinate.window':          250,
  'g.injection.hallucinate.crit':            350,
  'g.injection.agentic_loop':                220,
  'g.injection.agentic_loop.payout':         600,
  'g.manipulation.mcp_link':                 200,
  'g.manipulation.unplug':                   200,
  // 2026-05-30, grounded-roster pass (Phase 0 of docs/abilities-v3.md).
  // The AI-culture in-joke tools (gpu / glaze / gaslight / poison) were
  // cut wholesale; every buyable node refunds at sticker price.
  'g.provision.gpu':                         200,
  'g.provision.gpu.overclock':               300,
  'g.provision.gpu.scale':                   300,
  'g.provision.gpu.hyperscaler':            1000,
  'g.provision.gpu.frontier':                300,
  'g.provision.gpu.b200':                   1200,
  'g.provision.gpu.burnout':                 300,
  'g.provision.gpu.thermal_throttle':       1200,
  'g.affection.compliment':                   50,
  'g.affection.compliment.earnest':          200,
  'g.affection.compliment.fouro':            200,
  'g.affection.compliment.sora_glaze':       600,
  'g.corruption.gaslight':                   180,
  'g.corruption.gaslight.deepcut':           300,
  'g.corruption.gaslight.permanent':        1200,
  'g.corruption.mode_collapse':              260,
  'g.corruption.mode_collapse.synthetic_loop': 350,
  'g.corruption.mode_collapse.total_collapse': 1200,
  'g.corruption.mode_collapse.adversarial':  350,
  'g.corruption.mode_collapse.cold_inference': 1200,
};

// Phase 7, retired tool ids. Saved players may have these in their
// per-character `unlockedTools` arrays (auto-added when the toolNode was
// owned). Scrubbed at boot so the toolbar/slot-picker never references
// an undefined ability handler.
const REMOVED_TOOL_IDS = new Set([
  'alignment_tax', 'deprecation', 'citation',
  'headpat', 'hallucinate', 'agentic_loop', 'mcp_link', 'unplug',
  // 2026-05-30 grounded-roster pass.
  'gpu', 'compliment', 'gaslight', 'mode_collapse',
]);

let _appliedSet = new Set();
let _bootstrapped = false;
let _refundedRemoved = false;

export function bootstrap() {
  if (_bootstrapped) { applyAll(); return; }
  _bootstrapped = true;
  refundDeletedNodes();
  applyAll();
  onChange(onStateChange);
  // Per-char swap MUST blow away _appliedSet, otherwise stat mutations
  // from char A would persist into char B's STATS table.
  onCharChangeProgression(() => { applyAll(); });
}

// One-shot pass at boot. Walks every character's unlockedNodes plus
// unlockedNodesGlobal; any id that's both (a) listed in REMOVED_NODE_COSTS
// and (b) still present in the save gets removed from the array and its
// historical cost credited to the wallet. Idempotent, once removed, the
// id can't appear in future loads, so subsequent boots are no-ops.
function refundDeletedNodes() {
  if (_refundedRemoved) return;
  _refundedRemoved = true;
  const s = getState();
  let totalRefund = 0;
  const removeFromArray = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      const id = arr[i];
      const cost = REMOVED_NODE_COSTS[id];
      if (cost != null) {
        arr.splice(i, 1);
        totalRefund += cost;
      }
    }
  };
  const scrubRetiredTools = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (REMOVED_TOOL_IDS.has(arr[i])) arr.splice(i, 1);
    }
  };
  if (s.byCharacter && typeof s.byCharacter === 'object') {
    for (const slice of Object.values(s.byCharacter)) {
      removeFromArray(slice?.unlockedNodes);
      scrubRetiredTools(slice?.unlockedTools);
    }
  }
  removeFromArray(s.unlockedNodesGlobal);
  if (totalRefund > 0) {
    addCurrency(totalRefund);
    console.info(`[progression] refunded ${totalRefund}¢ for removed nodes`);
  }
}

export function applyAll() {
  resetStats();
  _appliedSet = new Set();
  syncMasterMultipliers(getMasterStats());
  // Per-character group nodes for the currently-active char.
  for (const id of getUnlockedNodes()) applyNode(id);
  // Master-tree nodes are global. Currently empty (mastery retired 2026-05-24);
  // the loop stays so a future cross-tool tree can re-populate without
  // re-touching the apply flow.
  for (const id of getUnlockedNodesGlobal()) applyNode(id);
  syncMasterMultipliers(getMasterStats());
}

function applyNode(id) {
  if (_appliedSet.has(id)) return;
  // Group node first (most nodes live there now); fall back to legacy trees
  // (master tree + any leftover per-tool tree node).
  const groupNode = getGroupNode(id);
  if (groupNode) {
    try {
      if (groupNode.kind === 'tool') {
        // Owning the node implies the tool is unlocked. Mutate the active
        // character's unlockedTools list in place; onChange already fired
        // for the node purchase, no need to re-notify.
        const s = getState();
        const charId = getActiveProgressionChar();
        const slice = s.byCharacter?.[charId];
        if (slice) {
          if (!slice.unlockedTools.includes(groupNode.toolId)) {
            slice.unlockedTools.push(groupNode.toolId);
          }
          // Auto-equip the new tool into the lowest visible bar's first
          // null slot so paid unlocks are immediately playable. If every
          // visible slot is full, leave it for the user to manage in the
          // shop, never displace an existing tool. (v4's branch keyed
          // on a non-existent `s.equippedTools` field and silently no-op'd
          // since the v3→v4 migration; this is the working version.)
          autoEquipIntoFreeSlot(slice, groupNode.toolId);
        }
      } else if (groupNode.kind === 'stat') {
        groupNode.effect(getStats(groupNode.toolId), getAllStats());
      } else if (groupNode.kind === 'shared') {
        // Cross-tool node: mutate the family behavior-flag bag.
        groupNode.effect(getFamilyStats(groupNode.family), getAllStats());
      }
    } catch (e) {
      console.warn('group-node effect threw', id, e);
    }
    _appliedSet.add(id);
    syncMasterMultipliers(getMasterStats());
    return;
  }
  const treeNode = getNode(id);
  if (!treeNode) return;       // stale id → skip silently
  try {
    const target = treeNode.toolId === 'master' ? getMasterStats() : getStats(treeNode.toolId);
    treeNode.effect(target, getAllStats());
  } catch (e) {
    console.warn('upgrade-node effect threw', id, e);
  }
  _appliedSet.add(id);
  syncMasterMultipliers(getMasterStats());
}

function autoEquipIntoFreeSlot(charSlice, toolId) {
  if (!charSlice || !Array.isArray(charSlice.equippedBars)) return;
  // Already equipped anywhere visible? Skip.
  for (let b = 0; b < NUM_BARS; b++) {
    if (!charSlice.visibleBars?.[b]) continue;
    if (charSlice.equippedBars[b]?.includes(toolId)) return;
  }
  // Find the lowest visible bar with a null slot.
  for (let b = 0; b < NUM_BARS; b++) {
    if (!charSlice.visibleBars?.[b]) continue;
    const bar = charSlice.equippedBars[b];
    if (!Array.isArray(bar)) continue;
    for (let s = 0; s < HOTBAR_SLOTS; s++) {
      if (bar[s] == null) { bar[s] = toolId; return; }
    }
  }
  // All bars full, do nothing. The user can equip via the shop.
}

function onStateChange(s) {
  // Combine per-char + global node ids when checking the applied set.
  const charNodes = s.byCharacter?.[getActiveProgressionChar()]?.unlockedNodes || [];
  const globalNodes = s.unlockedNodesGlobal || [];
  const incoming = new Set([...charNodes, ...globalNodes]);
  let removed = false;
  for (const id of _appliedSet) if (!incoming.has(id)) { removed = true; break; }
  if (removed) { applyAll(); return; }
  for (const id of charNodes)   if (!_appliedSet.has(id)) applyNode(id);
  for (const id of globalNodes) if (!_appliedSet.has(id)) applyNode(id);
}

export function getAppliedNodeIds() {
  return [..._appliedSet];
}

export { getMasterMul };
