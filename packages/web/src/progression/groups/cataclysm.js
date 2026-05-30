// Cataclysm group tree (renamed from `god` in Phase 1 of the 2026-05-02
// ability redesign, see docs/abilities.md). Cooldown-gated,
// screen-clearing drama. Anvil → blackhole → nuke. Linear escalation
// since each is much bigger than the last.
// Phase 7, stat tunes added so 1800¢+ buys more than 3 buttons.

import { toolNode, statNode } from './_shared.js';

export default [
  toolNode({
    id: 'g.cataclysm.anvil', parents: [], cost: 300, toolId: 'anvil',
    label: 'anvil',
    blurb: 'A 200-pound anvil falls from the sky onto your cursor.',
  }),
  statNode({
    id: 'g.cataclysm.anvil.weight', parents: ['g.cataclysm.anvil'], cost: 250, toolId: 'anvil',
    label: 'Heavier anvil',
    blurb: 'Anvil weight + impact damage +50%. Cartoon physics.',
    effect: (s) => { s.density = (s.density || 0.02) * 1.5; s.mood = Math.round((s.mood || 30) * 1.5); },
  }),

  toolNode({
    id: 'g.cataclysm.blackhole', parents: ['g.cataclysm.anvil'], cost: 500, toolId: 'blackhole',
    label: 'black hole',
    blurb: 'Singularity sucks them in 3s, then ejection.',
  }),
  statNode({
    id: 'g.cataclysm.blackhole.radius', parents: ['g.cataclysm.blackhole'], cost: 400, toolId: 'blackhole',
    label: 'Wider event horizon',
    blurb: 'Pull radius +40%, hold 3000 → 4500ms. The basin gets deeper.',
    effect: (s) => { s.radius = (s.radius || 200) * 1.4; s.holdMs = 4500; },
  }),

  toolNode({
    id: 'g.cataclysm.nuke', parents: ['g.cataclysm.blackhole'], cost: 1000, toolId: 'nuke',
    label: 'nuke',
    blurb: 'Full-screen white-out · total annihilation.',
  }),
  statNode({
    id: 'g.cataclysm.nuke.fallout', parents: ['g.cataclysm.nuke'], cost: 800, toolId: 'nuke',
    label: 'Fallout',
    iconHint: '⚡',
    blurb: 'Post-detonation fire pools across the stage for 6s. Mood damage +25%.',
    effect: (s) => { s.falloutPoolMs = 6000; s.mood = Math.round((s.mood || 100) * 1.25); },
  }),

  // Coup de grâce. Cheaper than nuke but commits to a status path (1.5s
  // finishing window + mood wipe) instead of a screen-clearing AOE. Gated
  // behind blackhole so the cataclysm chain still grows linearly. Mood-
  // gated finisher: only fires on HURT/BROKEN, distinct from nuke (which
  // opens the round) by being the close-out tool. Tool id stays
  // 'force_quit' (legacy internal id).
  toolNode({
    id: 'g.cataclysm.force_quit', parents: ['g.cataclysm.blackhole'], cost: 800, toolId: 'force_quit',
    label: 'coup de grâce',
    blurb: 'Finisher, only fires on HURT or BROKEN. 1.5s window, then the mood floor drops out.',
  }),
];
