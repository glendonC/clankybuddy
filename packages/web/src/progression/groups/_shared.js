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

// Cross-tool FAMILY behavior keys (mirror of FAMILY_DEFAULTS in
// abilities/_stats.js). A shared node names one of these families + a `flag`.
const FAMILIES = new Set(['firearms', 'ordnance', 'melee', 'hazard', 'summons']);

// Shared (cross-tool) node. Unlike stat nodes it mutates a FAMILY bag
// (STATS.fam.<family>) rather than one tool's STATS, so a single purchase
// affects every tool in the family.
//
// SCALAR-REJECTION GUARD (docs/abilities-v3.md §1/§4.1): a shared node MUST
// flip a behavior FLAG, never a pure scalar (+dmg/+radius). We enforce that
// declaratively by REQUIRING a `flag` field naming the boolean/behavior key
// the effect sets. A node that wants to "just add a number" can't name a
// flag, so it can't be a shared node — it has to be an off-spine per-tool
// statNode instead. This keeps cross-tool progression about new verbs, not
// global multipliers.
export function sharedNode({ id, parents = [], cost, label, blurb, family, flag, effect, iconHint }) {
  validateCommon({ id, parents, label, blurb, cost, allowZeroCost: false });
  if (!FAMILIES.has(family)) throw new Error(`shared node ${id}: unknown family '${family}'`);
  if (typeof flag !== 'string' || !flag.length) {
    throw new Error(`shared node ${id}: requires a 'flag' naming the behavior key it sets (no scalar-only shared nodes)`);
  }
  if (typeof effect !== 'function') throw new Error(`shared node ${id}: effect must be a function`);
  return Object.freeze({
    id, kind: 'shared',
    family, flag,
    parents: Object.freeze([...parents]),
    cost, label, blurb, effect,
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
