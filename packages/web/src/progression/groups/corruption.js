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

  // Mode-collapse branch (Phase 4, synthetic-data feedback loops as a
  // patient zone trap). The alignment_tax + deprecation branches retired
  // in Phase 7's visceral kit redirect, they were cerebral debuffs that
  // didn't deliver the "see this thing suffer" payoff. Refunded via
  // REMOVED_NODE_COSTS in apply-upgrades.js.
  //
  // Two-branch tree (2026-05-24, per docs/abilities.md §4):
  //   A: Synthetic-Loop, model-eats-its-own-tail. Re-triggers stack
  //      intensity instead of refreshing. Tier-3 Total-Collapse: at 3
  //      stacks the panic move auto-fires and fails (consumer in PR5).
  //   B: Adversarial-Examples, single-shot adversarial input. Drops
  //      passes-required from 3 to 1. Tier-3 Cold-Inference: extra damage
  //      multiplier on POISONED parts (consumer in PR5).
  // Data-Cleansing (defensive flip) was cut by the red-team, it existed
  // only to give a Petter prestige a corruption-tree carve-out, and
  // prestige is retired.
  toolNode({
    id: 'g.corruption.mode_collapse', parents: [], cost: 260, toolId: 'mode_collapse',
    label: 'poison',
    blurb: 'Drag-drops an invisible 80px zone. 3 buddy passes → 12s POISONED (×1.5 damage taken).',
  }),

  // A: Synthetic-Loop, feedback-loop collapse / model-eats-its-own-tail.
  statNode({
    id: 'g.corruption.mode_collapse.synthetic_loop', parents: ['g.corruption.mode_collapse'], cost: 350, toolId: 'mode_collapse',
    label: 'Synthetic Loop',
    blurb: 'Re-triggering on a still-POISONED buddy stacks intensity (cap 3) instead of refreshing duration.',
    effect: (s) => { s.stacking = true; },
  }),
  statNode({
    id: 'g.corruption.mode_collapse.total_collapse', parents: ['g.corruption.mode_collapse.synthetic_loop'], cost: 1200, toolId: 'mode_collapse',
    label: 'Total Collapse',
    iconHint: '⚡',
    blurb: 'At 3 stacks the panic move auto-fires AND fails. Speech bubbles repeat themselves.',
    effect: (s) => { s.panicFailAt3Stacks = true; },
  }),

  // B: Adversarial-Examples, single-shot adversarial input.
  statNode({
    id: 'g.corruption.mode_collapse.adversarial', parents: ['g.corruption.mode_collapse'], cost: 350, toolId: 'mode_collapse',
    label: 'Adversarial Examples',
    blurb: 'Zone triggers on the first pass instead of the third. Faster, less patient.',
    effect: (s) => { s.passesRequired = 1; },
  }),
  statNode({
    id: 'g.corruption.mode_collapse.cold_inference', parents: ['g.corruption.mode_collapse.adversarial'], cost: 1200, toolId: 'mode_collapse',
    label: 'Cold Inference',
    iconHint: '⚡',
    blurb: 'POISONED parts also take +25% damage on top of the base ×1.5. Chroma-split render.',
    effect: (s) => { s.extraDamageMul = 1.25; },
  }),

  // Gaslight branch, folded in from the retired `injection` group. The
  // speech-bubble hijack reads as the model trash-talking itself; same
  // family as poison (head-targeted persistent debuff), so it lives here
  // now. Old `g.injection.gaslight*` ids are remapped via LEGACY_NODE_ID_MAP
  // in state.js so existing saves keep their unlocks.
  toolNode({
    id: 'g.corruption.gaslight', parents: [], cost: 180, toolId: 'gaslight',
    label: 'gaslight',
    blurb: '12s of self-loathing, buddy trash-talks itself, −3 mood per bubble. Disables panic move. Glaze cancels.',
  }),
  statNode({
    id: 'g.corruption.gaslight.deepcut', parents: ['g.corruption.gaslight'], cost: 300, toolId: 'gaslight',
    label: 'Deep cut',
    blurb: 'Duration 12s → 18s. Bubbles pull from the deep persona pool, sharper, more specific.',
    effect: (s) => { s.durationMs = 18000; s.usePool = 'deep'; },
  }),
  statNode({
    id: 'g.corruption.gaslight.permanent', parents: ['g.corruption.gaslight.deepcut'], cost: 1200, toolId: 'gaslight',
    label: 'Permanent record',
    iconHint: '⚡',
    blurb: 'Status persists indefinitely. Only a kinetic/ordnance/cataclysm hit clears it. Mood tick × 1.3.',
    effect: (s) => { s.tier = 'permanent'; s.durationMs = 'persistent'; s.moodTickMul = 1.3; },
  }),
];
