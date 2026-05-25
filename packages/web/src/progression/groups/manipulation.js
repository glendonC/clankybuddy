// Manipulation group tree. True utility / control, neither praise nor
// punish. `grab` is the cost:0 starter; `freeze` is the pure-control
// lock-in tool that sets up combos (freeze → hammer = shatter, freeze +
// lightning = SHOCK SHATTER).
//
// Phase 7, mcp_link and unplug retired in the visceral kit redirect
// (AI-cosplay names, weak gameplay payoff). bear_trap + meathook lived
// here briefly, then moved to `kinetic` once we noticed both deal direct
// damage + bleed (utility-spine was an honest miscategorization).

import { toolNode, statNode } from './_shared.js';

export default [
  toolNode({
    id: 'g.manipulation.grab', parents: [], cost: 0, toolId: 'grab',
    label: 'grab',
    blurb: 'Grab the buddy, drag to throw.',
  }),

  toolNode({
    id: 'g.manipulation.freeze', parents: ['g.manipulation.grab'], cost: 100, toolId: 'freeze',
    label: 'ice',
    blurb: 'Freezes them ~2s, sets up shatter combos. Cauterizes bleed.',
  }),
  statNode({
    id: 'g.manipulation.freeze.duration', parents: ['g.manipulation.freeze'], cost: 150, toolId: 'freeze',
    label: 'Deep freeze',
    blurb: 'Freeze duration 1800 → 3000ms.',
    effect: (s) => { s.freezeMs = 3000; s.conductedMs = 5000; },
  }),
  statNode({
    id: 'g.manipulation.freeze.conduct', parents: ['g.manipulation.freeze.duration'], cost: 600, toolId: 'freeze',
    label: 'Cryo-conductor',
    blurb: 'CONDUCT lockout 5000 → 7000ms, buddy locked longer for follow-up.',
    effect: (s) => { s.conductedMs = 7000; },
  }),
];
