// Group-tree node helpers. A group's DAG mixes two node kinds:
//   - tool: buying it unlocks a tool onto the toolbar (id added to
//     unlockedTools). No stat effect, the tool's own defaultStats apply.
//   - stat: buying it mutates the named tool's STATS via effect(stats).
//
// Node ids are dotted: `g.<group>.<tool>` or `g.<group>.<tool>.<suffix>`.
// The `g.` prefix keeps them distinct from legacy per-tool tree nodes so a
// stale save's unlocked-node ids never collide with new ones.
//
// Both helpers freeze the result so accidental mutation downstream throws.

const ID_RE = /^g\.[a-z]+\.[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function validateCommon({ id, parents, label, blurb, cost, allowZeroCost }) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`group node: invalid id ${id}`);
  if (!Array.isArray(parents)) throw new Error(`group node ${id}: parents must be array`);
  if (typeof label !== 'string' || !label.length) throw new Error(`group node ${id}: missing label`);
  if (typeof blurb !== 'string' || !blurb.length) throw new Error(`group node ${id}: missing blurb`);
  if (allowZeroCost) {
    if (typeof cost !== 'number' || cost < 0) throw new Error(`group node ${id}: invalid cost ${cost}`);
  } else {
    if (typeof cost !== 'number' || cost <= 0) throw new Error(`group node ${id}: invalid cost ${cost}`);
  }
}

// Tool-unlock node. cost=0 means "default unlocked / free starter."
export function toolNode({ id, parents = [], cost = 0, label, blurb, toolId, iconHint }) {
  validateCommon({ id, parents, label, blurb, cost, allowZeroCost: true });
  if (typeof toolId !== 'string' || !toolId.length) throw new Error(`group node ${id}: missing toolId`);
  return Object.freeze({
    id, kind: 'tool',
    toolId,
    parents: Object.freeze([...parents]),
    cost, label, blurb,
    iconHint: iconHint || null,
  });
}

// Stat-tune node. effect mutates the parent tool's STATS slot.
export function statNode({ id, parents = [], cost, label, blurb, effect, toolId, iconHint }) {
  validateCommon({ id, parents, label, blurb, cost, allowZeroCost: false });
  if (typeof toolId !== 'string' || !toolId.length) throw new Error(`group node ${id}: missing toolId`);
  if (typeof effect !== 'function') throw new Error(`group node ${id}: effect must be a function`);
  return Object.freeze({
    id, kind: 'stat',
    toolId,
    parents: Object.freeze([...parents]),
    cost, label, blurb, effect,
    iconHint: iconHint || null,
  });
}
