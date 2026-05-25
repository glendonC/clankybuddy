// Provision group tree (Phase 1 of the 2026-05-02 ability redesign,
// see docs/abilities.md). Folds the former `gifts` and `blessings`
// groups into one: tangible objects you drop on the buddy + sustained
// god-tier positive buffs. `treat` is the cost:0 starter; `gift`
// branches off it; `gpu` is its own root (sustained-buff archetype,
// distinct progression branch from the consumable food chain).
// Phase 7, stat tunes added so a Petter-prestige run has real spend
// targets on the positive spine.

import { toolNode, statNode } from './_shared.js';

export default [
  // Treat → gift branch (former `gifts`).
  toolNode({
    id: 'g.provision.feed', parents: [], cost: 0, toolId: 'feed',
    label: 'treat',
    blurb: 'Drops a cookie they bite. Reliable +mood.',
  }),
  statNode({
    id: 'g.provision.feed.snack', parents: ['g.provision.feed'], cost: 150, toolId: 'feed',
    label: 'Snack tray',
    blurb: 'Mood 4 → 6, joy spike 35 → 55. Heartier helping.',
    effect: (s) => { s.mood = 6; s.joySpike = 55; },
  }),

  toolNode({
    id: 'g.provision.gift', parents: ['g.provision.feed'], cost: 80, toolId: 'gift',
    label: 'gift',
    blurb: 'Wrapped box, biggest standard boost.',
  }),
  statNode({
    id: 'g.provision.gift.deluxe', parents: ['g.provision.gift'], cost: 200, toolId: 'gift',
    label: 'Deluxe wrapping',
    blurb: 'Mood 10 → 16, joy spike 60 → 90.',
    effect: (s) => { s.mood = 16; s.joySpike = 90; },
  }),

  // GPU branch, three philosophical forks per the 2026-05 redesign
  // (docs/abilities.md §4). Scale: more cards, smaller boost each
  // (hyperscaler camp). Frontier: one bigger card (OpenAI / Anthropic
  // camp). Burnout: over-pet'd buddy starts smoking, mood gain halved,
  // sets up corruption combos (open-weight tinkerer's self-poisoning
  // path). Overclock stays as a universal duration tune that pairs
  // with any branch. Old `dual` retired (Scale supersedes); refunded
  // via REMOVED_NODE_COSTS.
  toolNode({
    id: 'g.provision.gpu', parents: [], cost: 200, toolId: 'gpu',
    label: 'gpu',
    blurb: 'Drop a graphics card, buddy glows for ~5s, big sustained boost.',
  }),
  statNode({
    id: 'g.provision.gpu.overclock', parents: ['g.provision.gpu'], cost: 300, toolId: 'gpu',
    label: 'Overclock',
    blurb: 'Powered duration 5000 → 7500ms (contact); wireless 2500 → 4500ms. Stacks with any branch below.',
    effect: (s) => { s.contactDuration = 7500; s.wirelessDuration = 4500; },
  }),

  // A: Scale, more cards, smaller boost each. The hyperscaler camp.
  statNode({
    id: 'g.provision.gpu.scale', parents: ['g.provision.gpu'], cost: 300, toolId: 'gpu',
    label: 'Scale',
    blurb: '3 cards per cast, each at 0.6× boost. The hyperscaler bet, flood the buddy with compute.',
    effect: (s) => { s.spawnCount = 3; s.moodGainMul = 0.6; },
  }),
  statNode({
    id: 'g.provision.gpu.hyperscaler', parents: ['g.provision.gpu.scale'], cost: 1000, toolId: 'gpu',
    label: 'Hyperscaler',
    iconHint: '⚡',
    blurb: '5 cards per cast at 0.7× boost each. Rack arrangement on stage.',
    effect: (s) => { s.spawnCount = 5; s.moodGainMul = 0.7; },
  }),

  // B: Frontier, one bigger card. The OpenAI / Anthropic camp.
  statNode({
    id: 'g.provision.gpu.frontier', parents: ['g.provision.gpu'], cost: 300, toolId: 'gpu',
    label: 'Frontier',
    blurb: 'Single card per cast at 2× boost. Concentrate the spend on one flagship part.',
    effect: (s) => { s.spawnCount = 1; s.moodGainMul = 2.0; },
  }),
  statNode({
    id: 'g.provision.gpu.b200', parents: ['g.provision.gpu.frontier'], cost: 1200, toolId: 'gpu',
    label: 'B200',
    iconHint: '⚡',
    blurb: 'Single card at 3× boost. The flagship, heat shimmer + RGB-LED bloom on the sprite.',
    effect: (s) => { s.spawnCount = 1; s.moodGainMul = 3.0; },
  }),

  // C: Burnout, over-pet'd buddy starts smoking. Self-poisoning ceiling.
  // The open-weight tinkerer's path: positive tool that sets up corruption.
  statNode({
    id: 'g.provision.gpu.burnout', parents: ['g.provision.gpu'], cost: 300, toolId: 'gpu',
    label: 'Burnout',
    blurb: 'Cast applies ON_FIRE to the buddy for 1.5s. Mood gain halved while smoking. Sets up corruption combos.',
    effect: (s) => { s.onFireOnCast = true; s.onFireDurationMs = 1500; s.onFireIntensity = 1; s.moodGainMul = 0.5; },
  }),
  statNode({
    id: 'g.provision.gpu.thermal_throttle', parents: ['g.provision.gpu.burnout'], cost: 1200, toolId: 'gpu',
    label: 'Thermal Throttle',
    iconHint: '⚡',
    blurb: 'ON_FIRE 3s, intensity 2, mood gain ×0.25. The buddy steams continuously between casts.',
    effect: (s) => { s.onFireDurationMs = 3000; s.onFireIntensity = 2; s.moodGainMul = 0.25; },
  }),
];
