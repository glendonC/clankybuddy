// Corruption group tree (renamed from `elemental` in Phase 1 of the
// 2026-05-02 ability redesign, see docs/abilities.md). Energy /
// status-effect-driven offensive tools. Two damage archetypes, flame
// stream + lobbed magic. Each is its own root so the player can
// specialize in either direction.
// (Freeze moved to manipulation pre-Phase-1 because it's a control/setup
// tool, not raw damage. Lightning moved to `ordnance` in Phase 2 because
// it's a ranged-form damage tool, not a status DoT, see legacy id
// remap in progression/state.js.)

import { toolNode, statNode } from './_shared.js';

export default [
  // Flamethrower branch, cheapest entry, sustained AOE.
  toolNode({
    id: 'g.corruption.flamethrower', parents: [], cost: 140, toolId: 'flamethrower',
    label: 'flamethrower',
    blurb: 'Continuous flame stream.',
  }),
  statNode({
    id: 'g.corruption.flamethrower.range', parents: ['g.corruption.flamethrower'], cost: 300, toolId: 'flamethrower',
    label: 'Long burner',
    blurb: 'Range 180 → 260. Reach across the stage.',
    effect: (s) => { s.range = 260; },
  }),
  statNode({
    id: 'g.corruption.flamethrower.ignite', parents: ['g.corruption.flamethrower'], cost: 300, toolId: 'flamethrower',
    label: 'Stickier flames',
    blurb: 'Ignite chance 0.35 → 0.6, burn 4s → 6s.',
    effect: (s) => { s.igniteChance = 0.6; s.igniteMs = 6000; },
  }),
  statNode({
    id: 'g.corruption.flamethrower.inferno', parents: ['g.corruption.flamethrower.range', 'g.corruption.flamethrower.ignite'], cost: 1200, toolId: 'flamethrower',
    label: 'Inferno',
    iconHint: '⚡',
    blurb: 'Mood drain doubled, push force tripled.',
    effect: (s) => { s.moodPerTick *= 2; s.pushForce *= 3; },
  }),

  // Fireball branch, burst splash + lingering pool.
  toolNode({
    id: 'g.corruption.fireball', parents: [], cost: 180, toolId: 'fireball',
    label: 'fireball',
    blurb: 'Lobbed magic, splash + fire pool on impact.',
  }),
  statNode({
    id: 'g.corruption.fireball.radius', parents: ['g.corruption.fireball'], cost: 300, toolId: 'fireball',
    label: 'Bigger boom',
    blurb: 'Radius 160 → 220, force ×1.3.',
    effect: (s) => { s.radius = 220; s.force *= 1.3; },
  }),
  statNode({
    id: 'g.corruption.fireball.meteor', parents: ['g.corruption.fireball.radius'], cost: 1200, toolId: 'fireball',
    label: 'Meteor',
    iconHint: '⚡',
    blurb: 'Radius 320, force ×1.5, fire pool 8s.',
    effect: (s) => { s.radius = 320; s.force *= 1.5; s.firePoolMs = 8000; },
  }),

  // Acid flask branch (its own root), lobbed caustic flask → lingering
  // corrosion pool that amps damage on whatever wades through it.
  toolNode({
    id: 'g.corruption.acid_flask', parents: [], cost: 180, toolId: 'acid_flask',
    label: 'acid flask',
    blurb: 'Lob a flask of caustic acid; shatters into a corroding green pool.',
  }),
  statNode({
    id: 'g.corruption.acid_flask.pool', parents: ['g.corruption.acid_flask'], cost: 300, toolId: 'acid_flask',
    label: 'Wider spill',
    blurb: 'Pool lasts 5s → 8s. The corrosion lingers longer.',
    effect: (s) => { s.poolMs += 3000; },
  }),
  statNode({
    id: 'g.corruption.acid_flask.deep', parents: ['g.corruption.acid_flask'], cost: 300, toolId: 'acid_flask',
    label: 'Deeper corrosion',
    blurb: 'Corroded coat lasts 8s → 12s. The damage-amp sticks around.',
    effect: (s) => { s.corrodeMs += 4000; },
  }),

  // The `poison`/mode-collapse zone and the `gaslight` speech-hijack were
  // AI-culture gags cut in the grounded-roster pass; nodes refunded via
  // REMOVED_NODE_COSTS. The debounced-pass zone *mechanic* is preserved as
  // a dormant template (transients/mode-collapse-zone.js) for the Phase 3
  // placed-zone tools (tar pit / gas cloud / caltrops), see
  // docs/abilities-v3.md.
];
