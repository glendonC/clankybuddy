// Master-only tree registry. The per-tool legacy trees were retired when
// the group-tree shape (progression/groups/) became the source of truth for
// per-tool unlocks and stats. Only the cross-tool MASTER tree still lives
// here, its nodes mutate STATS.master via apply-upgrades.applyNode.

import master from './master.js';

export const MASTER_TREE = master;

const NODES_BY_ID = new Map();
for (const n of MASTER_TREE) {
  if (NODES_BY_ID.has(n.id)) throw new Error(`master tree: duplicate node id ${n.id}`);
  if (n.toolId !== 'master') throw new Error(`master tree: node ${n.id} toolId mismatch`);
  NODES_BY_ID.set(n.id, n);
}
for (const n of NODES_BY_ID.values()) {
  for (const p of n.parents) {
    if (!NODES_BY_ID.has(p)) {
      throw new Error(`master tree: node ${n.id} has unknown parent ${p}`);
    }
  }
}

const TIER = new Map();
function tierOf(id, seen = new Set()) {
  if (TIER.has(id)) return TIER.get(id);
  if (seen.has(id)) throw new Error(`master tree: cycle detected at ${id}`);
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

export function getNode(id) { return NODES_BY_ID.get(id) || null; }
export function getTier(id) { return TIER.get(id) || 1; }
export function getAllNodes() { return [...NODES_BY_ID.values()]; }
