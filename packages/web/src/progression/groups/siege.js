// Siege group tree (throwables / droppables). Heavy objects dropped from
// above to pancake the buddy. `brick` is the cheap root; bowling ball (roll-
// scatter) and piano (wide multi-part landing) branch off it as distinct
// verbs. Heavier-object variants (fridge, car, wrecking ball) land in later
// phases, see docs/abilities-v3.md.

import { toolNode, statNode } from './_shared.js';

export default [
  toolNode({
    id: 'g.siege.brick', parents: [], cost: 60, toolId: 'brick',
    label: 'brick',
    blurb: 'Drop a brick on your cursor. Pancakes the nearest part.',
  }),
  statNode({
    id: 'g.siege.brick.heavy', parents: ['g.siege.brick'], cost: 150, toolId: 'brick',
    label: 'Cinderblock',
    blurb: 'Heavier payload, mood 12 → 18, denser impact.',
    effect: (s) => { s.density = 0.018; s.mood = 18; },
  }),

  // Bowling ball, the roll-scatter verb.
  toolNode({
    id: 'g.siege.bowling_ball', parents: ['g.siege.brick'], cost: 120, toolId: 'bowling_ball',
    label: 'bowling ball',
    blurb: 'Lands and rolls, scattering parts as it tumbles through.',
  }),

  // Piano, the wide multi-part landing verb.
  toolNode({
    id: 'g.siege.piano', parents: ['g.siege.brick'], cost: 220, toolId: 'piano',
    label: 'piano',
    blurb: 'A wide upright piano lands across multiple parts at once.',
  }),
];
