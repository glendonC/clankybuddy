// Summons group tree (autonomous hostile entities — the Phase-5 subsystem).
// Independent emplacement roots, no false grand root (the hazard.js model). All
// summons are HOSTILE — there is no allied/medic axis. Ships the Attack dog root
// + its per-tool stat leaves; snake / pit bull / rat / turret / drone / rival are
// FUTURE child toolNodes (their tools don't exist yet — a tool node referencing
// an unknown toolId throws at boot, so they wait for their own batches). The
// shared `summons.aggression` node is also deferred: with one summon, "uniform
// across the family" is vacuous (the sharedNode scalar-rejection guard exists to
// force a cross-tool verb), so it lands when a 2nd summon gives it meaning. The
// FAMILY hook already exists (STATS.fam.summons + the FAMILIES set), so the
// future aggression node needs zero further plumbing.

import { toolNode, statNode } from './_shared.js';

export default [
  toolNode({
    id: 'g.summons.attack_dog', parents: [], cost: 240, toolId: 'attack_dog',
    label: 'attack dog',
    blurb: 'Loose a hostile dog that charges in, hunts the buddy down across the floor, and bites — it bleeds them out on its own while you do something else.',
  }),
  statNode({
    id: 'g.summons.attack_dog.pack', parents: ['g.summons.attack_dog'], cost: 340, toolId: 'attack_dog',
    label: 'Pack of three',
    blurb: 'Whistle up a whole pack — three dogs per cast instead of one.',
    effect: (s) => { s.pack = 3; },
  }),
  statNode({
    id: 'g.summons.attack_dog.jaws', parents: ['g.summons.attack_dog'], cost: 260, toolId: 'attack_dog',
    label: 'Crushing jaws',
    blurb: 'A nastier bite — more mood damage and a deeper BLEED (5s → 9s) with every chomp.',
    effect: (s) => { s.mood = 11; s.bleedMs = 9000; },
  }),
  statNode({
    id: 'g.summons.attack_dog.leash', parents: ['g.summons.attack_dog'], cost: 220, toolId: 'attack_dog',
    label: 'Long leash',
    blurb: 'A tireless hound — it ranges farther to lunge and lingers longer on the field.',
    effect: (s) => { s.lungeRange = 240; s.lifeMs = 16000; },
  }),

  // Snake <- Attack dog (KENNEL). A distinct CREEPING-ENVENOMER verb: slow crawl,
  // no lunge, near-0 bite, STACKING venom (escalating bleed). Leaves cash reads
  // and keep bleedCap at the family's 5 (deepen venom via faster/longer bite, not
  // a divergent cap that another bleed source would clamp back down).
  toolNode({
    id: 'g.summons.snake', parents: ['g.summons.attack_dog'], cost: 300, toolId: 'snake',
    label: 'snake',
    blurb: 'A slow crawler that bites and bites — each strike sinks the venom deeper, a stacking poison that bleeds faster the longer it clings. Place it and let it work.',
  }),
  statNode({
    id: 'g.summons.snake.fangs', parents: ['g.summons.snake'], cost: 320, toolId: 'snake',
    label: 'Hollow fangs',
    blurb: 'Strikes faster and the wound festers longer (bite every 0.6s → 0.45s, venom lasts 4s → 6s) — the stack climbs to full sooner and holds.',
    effect: (s) => { s.biteIntervalMs = 450; s.bleedMs = 6000; },
  }),
  statNode({
    id: 'g.summons.snake.coil', parents: ['g.summons.snake'], cost: 240, toolId: 'snake',
    label: 'Patient coil',
    blurb: 'A tireless ambusher — it clings far longer on the field (11s → 18s), riding the venom up and keeping it there.',
    effect: (s) => { s.lifeMs = 18000; },
  }),
  statNode({
    id: 'g.summons.snake.brood', parents: ['g.summons.snake'], cost: 360, toolId: 'snake',
    label: 'Nest',
    blurb: 'Two snakes per cast instead of one — twice the wounds creeping open at once.',
    effect: (s) => { s.pack = 2; },
  }),
];
