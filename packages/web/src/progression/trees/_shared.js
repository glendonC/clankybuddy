// Helper for declaring a tree node. Validates locally and freezes the result
// so accidental mutation downstream throws.

export function node({ id, parents = [], cost, label, blurb, effect, replaces, iconHint }) {
  if (typeof id !== 'string' || !id.includes('.')) throw new Error(`tree node: invalid id ${id}`);
  if (!Array.isArray(parents)) throw new Error(`tree node ${id}: parents must be array`);
  if (typeof cost !== 'number' || cost <= 0) throw new Error(`tree node ${id}: invalid cost ${cost}`);
  if (typeof label !== 'string' || !label.length) throw new Error(`tree node ${id}: missing label`);
  if (typeof blurb !== 'string' || !blurb.length) throw new Error(`tree node ${id}: missing blurb`);
  if (typeof effect !== 'function') throw new Error(`tree node ${id}: effect must be a function`);
  return Object.freeze({
    id,
    toolId: id.split('.', 1)[0],
    parents: Object.freeze([...parents]),
    cost,
    label,
    blurb,
    effect,
    replaces: replaces ? Object.freeze([...replaces]) : null,
    iconHint: iconHint || null,
  });
}
