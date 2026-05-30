// Provision group tree. Folds the former `gifts` and `blessings`
// groups into one: tangible objects you drop on the buddy. `treat` is
// the cost:0 starter; `gift` branches off it.

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

  // Recovery line (root). The grounded replacement for the cut gpu heal
  // niche: a mood bump + clears BLEED / ON_FIRE. Defibrillator / adrenaline
  // branch off it in later phases (docs/abilities-v3.md).
  toolNode({
    id: 'g.provision.first_aid', parents: ['g.provision.feed'], cost: 90, toolId: 'first_aid',
    label: 'first aid',
    blurb: 'Patch them up: +mood and clears BLEED / ON_FIRE off every part.',
  }),
];
