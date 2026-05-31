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

  // Cryo / offensive-cold line. Freeze proper lives in `manipulation`
  // (control tool), so cross-group parenting is rejected — these root here
  // as independent corruption roots instead of hanging under the freeze node.
  toolNode({
    id: 'g.corruption.liquid_nitrogen', parents: [], cost: 200, toolId: 'liquid_nitrogen',
    label: 'liquid nitrogen',
    blurb: 'Continuous cryo cone — paints persistent freeze (brittle) onto whatever the stream touches. Hold to lock a region down for shatter follow-ups.',
  }),
  statNode({
    id: 'g.corruption.liquid_nitrogen.range', parents: ['g.corruption.liquid_nitrogen'], cost: 280, toolId: 'liquid_nitrogen',
    label: 'Long lance',
    blurb: 'Range 170 → 250.',
    effect: (s) => { s.range = 250; },
  }),
  statNode({
    id: 'g.corruption.liquid_nitrogen.flow', parents: ['g.corruption.liquid_nitrogen'], cost: 280, toolId: 'liquid_nitrogen',
    label: 'High flow',
    blurb: 'Freeze paint chance 0.6 → 0.9; mood drain 0.4 → 0.6/t.',
    effect: (s) => { s.freezeChance = 0.9; s.moodPerTick = 0.6; },
  }),

  // Flash-freeze (cryo grenade) — lobbed mass-freeze airburst. Own root.
  toolNode({
    id: 'g.corruption.flash_freeze', parents: [], cost: 220, toolId: 'flash_freeze',
    label: 'cryo grenade',
    blurb: 'Lobbed flash-freeze airburst — freezes every limb in the burst radius solid + arrests motion. Mass freeze for shatter combos.',
  }),
  statNode({
    id: 'g.corruption.flash_freeze.radius', parents: ['g.corruption.flash_freeze'], cost: 320, toolId: 'flash_freeze',
    label: 'Wide burst',
    blurb: 'Cryo-burst radius 150 → 210px.',
    effect: (s) => { s.radius = 210; },
  }),
  statNode({
    id: 'g.corruption.flash_freeze.arrest', parents: ['g.corruption.flash_freeze'], cost: 300, toolId: 'flash_freeze',
    label: 'Dead stop',
    blurb: 'Burst arrest 0.55 → 0.85 — caught limbs snap to a near-total halt.',
    effect: (s) => { s.arrest = 0.85; },
  }),

  // Directed-energy line — laser cutter (continuous cutting beam). Own root.
  toolNode({
    id: 'g.corruption.laser_cutter', parents: [], cost: 220, toolId: 'laser_cutter',
    label: 'laser cutter',
    blurb: 'A continuous industrial cutting beam — sweep it across the buddy to slice, burn, and shatter anything frozen.',
  }),
  statNode({
    id: 'g.corruption.laser_cutter.range', parents: ['g.corruption.laser_cutter'], cost: 300, toolId: 'laser_cutter',
    label: 'focusing optics',
    blurb: 'Beam range +90px.',
    effect: (st) => { st.range += 90; },
  }),
  statNode({
    id: 'g.corruption.laser_cutter.ignite', parents: ['g.corruption.laser_cutter'], cost: 300, toolId: 'laser_cutter',
    label: 'thermal lens',
    blurb: 'Ignite chance +0.25.',
    effect: (st) => { st.igniteChance = Math.min(1, st.igniteChance + 0.25); },
  }),
  statNode({
    id: 'g.corruption.laser_cutter.cut', parents: ['g.corruption.laser_cutter.range', 'g.corruption.laser_cutter.ignite'], cost: 1200, toolId: 'laser_cutter',
    label: 'industrial cutting head',
    iconHint: '⚡',
    blurb: 'Push force +0.008, beam width +6px.',
    effect: (st) => { st.pushForce += 0.008; st.beamRadius += 6; },
  }),

  // Taser — directed-energy dart pair. Own root.
  toolNode({
    id: 'g.corruption.taser', parents: [], cost: 200, toolId: 'taser',
    label: 'taser',
    blurb: 'Fire two conductive darts; the wires shock and reel the buddy in.',
  }),
  statNode({
    id: 'g.corruption.taser.shock', parents: ['g.corruption.taser'], cost: 300, toolId: 'taser',
    label: 'Longer charge',
    blurb: 'Convulsion 1.4s → 2.4s.',
    effect: (s) => { s.shockMs = 2400; },
  }),
  statNode({
    id: 'g.corruption.taser.reel', parents: ['g.corruption.taser'], cost: 300, toolId: 'taser',
    label: 'Stronger wires',
    blurb: 'Reel pull ×1.8 — yanks the buddy harder toward the gun.',
    effect: (s) => { s.reelForce *= 1.8; },
  }),

  // The `poison`/mode-collapse zone and the `gaslight` speech-hijack were
  // AI-culture gags cut in the grounded-roster pass; nodes refunded via
  // REMOVED_NODE_COSTS. The debounced-pass zone *mechanic* is preserved as
  // a dormant template (transients/mode-collapse-zone.js) for the Phase 3
  // placed-zone tools (tar pit / gas cloud / caltrops), see
  // docs/abilities-v3.md.
];
