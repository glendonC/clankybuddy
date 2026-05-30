// Group-tree registry. Imports each group's DAG, validates the union (cycle /
// unknown-parent / duplicate-id / orphan tool node) at boot, exposes lookups.

import affection    from './affection.js';
import provision    from './provision.js';
import kinetic      from './kinetic.js';
import ordnance     from './ordnance.js';
import corruption   from './corruption.js';
import cataclysm    from './cataclysm.js';
import siege        from './siege.js';
import manipulation from './manipulation.js';

import { TOOLS_BY_ID } from '../../ui/tools-table.js';

// Group keys here MUST match the `group` field on every tool in
// tools-table.js, the validator below checks every node id starts with
// `g.<groupId>.` against these keys. `recognition` and `injection`
// retired in Phase 7's visceral kit redirect (citation folded out;
// gaslight folded into corruption).
export const GROUP_TREES = {
  affection, provision, kinetic, ordnance, corruption, cataclysm, siege, manipulation,
};

const NODES_BY_ID = new Map();
const NODES_BY_GROUP = new Map();
const NODES_BY_TOOL = new Map();
const NODES_BY_FAMILY = new Map();   // kind:'shared' nodes, keyed by family

for (const [groupId, nodes] of Object.entries(GROUP_TREES)) {
  if (!Array.isArray(nodes)) throw new Error(`group ${groupId}: not an array`);
  NODES_BY_GROUP.set(groupId, nodes);
  for (const n of nodes) {
    if (NODES_BY_ID.has(n.id)) throw new Error(`group ${groupId}: duplicate node id ${n.id}`);
    if (!n.id.startsWith(`g.${groupId}.`)) throw new Error(`group ${groupId}: node ${n.id} prefix mismatch`);
    if (n.kind === 'tool' && !TOOLS_BY_ID[n.toolId]) {
      throw new Error(`group ${groupId}: tool node ${n.id} references unknown tool '${n.toolId}'`);
    }
    NODES_BY_ID.set(n.id, n);
    // Shared nodes have no toolId — index them by family instead.
    if (n.toolId) {
      if (!NODES_BY_TOOL.has(n.toolId)) NODES_BY_TOOL.set(n.toolId, []);
      NODES_BY_TOOL.get(n.toolId).push(n);
    } else if (n.kind === 'shared') {
      if (!NODES_BY_FAMILY.has(n.family)) NODES_BY_FAMILY.set(n.family, []);
      NODES_BY_FAMILY.get(n.family).push(n);
    }
  }
}

// Resolve parent ids → cycle / unknown-parent / cross-group check.
for (const n of NODES_BY_ID.values()) {
  for (const p of n.parents) {
    if (!NODES_BY_ID.has(p)) {
      throw new Error(`group: node ${n.id} has unknown parent ${p}`);
    }
    const parent = NODES_BY_ID.get(p);
    const myGroup = n.id.split('.', 2)[1];
    const parentGroup = parent.id.split('.', 2)[1];
    if (myGroup !== parentGroup) {
      throw new Error(`group: node ${n.id} parent ${p} crosses groups`);
    }
  }
}

// Compute and cache tier (longest path from root + 1).
const TIER = new Map();
function tierOf(id, seen = new Set()) {
  if (TIER.has(id)) return TIER.get(id);
  if (seen.has(id)) throw new Error(`group: cycle detected at ${id}`);
  const n = NODES_BY_ID.get(id);
  if (!n) return 1;
  if (!n.parents.length) { TIER.set(id, 1); return 1; }
  seen.add(id);
  let max = 0;
  for (const p of n.parents) max = Math.max(max, tierOf(p, seen));
  seen.delete(id);
  TIER.set(id, max + 1);
  return TIER.get(id);
}
for (const id of NODES_BY_ID.keys()) tierOf(id);

// Children lookup for the renderer.
const CHILDREN = new Map();
for (const n of NODES_BY_ID.values()) {
  for (const p of n.parents) {
    if (!CHILDREN.has(p)) CHILDREN.set(p, []);
    CHILDREN.get(p).push(n.id);
  }
}

export function getGroupNodes(groupId) { return NODES_BY_GROUP.get(groupId) || []; }
export function getGroupNode(id)       { return NODES_BY_ID.get(id) || null; }
export function getGroupTier(id)       { return TIER.get(id) || 1; }
export function getGroupChildren(id)   { return CHILDREN.get(id) || []; }
export function getNodesForTool(toolId) { return NODES_BY_TOOL.get(toolId) || []; }
export function getSharedNodesForFamily(family) { return NODES_BY_FAMILY.get(family) || []; }
export function getAllGroupNodes()     { return [...NODES_BY_ID.values()]; }

// Default-unlocked tool nodes, those with cost: 0 are considered owned at
// boot. apply-upgrades.bootstrap reads this list to seed unlockedNodes for
// fresh saves so the tree shows the starter tools as 'owned'.
export const FREE_STARTER_NODE_IDS = [...NODES_BY_ID.values()]
  .filter(n => n.kind === 'tool' && n.cost === 0)
  .map(n => n.id);
