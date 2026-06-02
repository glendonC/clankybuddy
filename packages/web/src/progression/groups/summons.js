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

  // Sentry turret — independent TURRET root (the first static + ranged summon).
  // Flak cannon / Tesla coil are FUTURE child toolNodes (their tools don't exist
  // yet → would throw at boot), deferred. Leaves cash distinct reads.
  toolNode({
    id: 'g.summons.sentry_turret', parents: [], cost: 360, toolId: 'sentry_turret',
    label: 'sentry turret',
    blurb: 'Plant a static auto-turret on the floor. It tracks the buddy and fires bullets on its own until it runs dry — set it and walk away.',
  }),
  statNode({
    id: 'g.summons.sentry_turret.ext_mag', parents: ['g.summons.sentry_turret'], cost: 320, toolId: 'sentry_turret',
    label: 'Extended magazine',
    blurb: 'A bigger drum and a hotter barrel — fires faster and hits harder (a shot every 0.8s → 0.55s, 7 → 11 damage).',
    effect: (s) => { s.fireIntervalMs = 550; s.damage = 11; },
  }),
  statNode({
    id: 'g.summons.sentry_turret.optics', parents: ['g.summons.sentry_turret'], cost: 260, toolId: 'sentry_turret',
    label: 'Targeting optics',
    blurb: 'A rangier emplacement that holds the field longer — reaches farther across the floor (range 520 → 760) and runs longer before it empties (14s → 20s).',
    effect: (s) => { s.range = 760; s.lifeMs = 20000; },
  }),

  // Hornet swarm — independent NEST root (the first air-flyer + first swarm).
  // Rat swarm + Locusts are FUTURE child toolNodes of this root (their tools
  // don't exist yet → would throw at boot), deferred. Leaves cash distinct reads.
  toolNode({
    id: 'g.summons.hornet_swarm', parents: [], cost: 300, toolId: 'hornet_swarm',
    label: 'hornet swarm',
    blurb: 'Loose a buzzing cloud of hornets that swarms the buddy in the air — each tiny sting barely moves them, but a dozen needling at once chips them down and keeps a light bleed open. Cast it and let the cloud work.',
  }),
  statNode({
    id: 'g.summons.hornet_swarm.nest', parents: ['g.summons.hornet_swarm'], cost: 320, toolId: 'hornet_swarm',
    label: 'Wasp nest',
    blurb: 'A bigger, angrier cloud — twelve stingers per cast (8 → 12) needling faster (sting every 0.6s → 0.42s).',
    effect: (s) => { s.swarmCount = 12; s.stingIntervalMs = 420; },
  }),
  statNode({
    id: 'g.summons.hornet_swarm.venom', parents: ['g.summons.hornet_swarm'], cost: 280, toolId: 'hornet_swarm',
    label: 'Venomous stings',
    blurb: 'Each sting is likelier to draw blood and the wound lingers longer (bleed chance 0.3 → 0.45, bleed 4s → 6s).',
    effect: (s) => { s.bleedChance = 0.45; s.bleedMs = 6000; },
  }),
  statNode({
    id: 'g.summons.hornet_swarm.agitated', parents: ['g.summons.hornet_swarm'], cost: 240, toolId: 'hornet_swarm',
    label: 'Agitated swarm',
    blurb: 'A rangier, longer-lived cloud — it reaches farther to sting (range 44 → 56) and buzzes the field longer (7s → 11s).',
    effect: (s) => { s.stingRange = 56; s.lifeMs = 11000; },
  }),

  // Rat swarm <- Hornet swarm (NEST). A distinct TERRORIZE-INTO-FLEEING verb: a
  // GROUND swarm (vs the hornet's air cloud) whose gnaw is near-cosmetic — the
  // headline is the buddy's FEAR breaking it into a flee-to-corner. The first
  // hostile to feed mood.fear from a sustained controller. Leaves cash distinct
  // reads; bleed stays FLAT (the dog/hornet model, never the snake's stack).
  toolNode({
    id: 'g.summons.rat_swarm', parents: ['g.summons.hornet_swarm'], cost: 320, toolId: 'rat_swarm',
    label: 'rat swarm',
    blurb: 'Loose a swarm of rats that pours across the floor and gnaws at the buddy\'s feet. The bites barely sting — but the crawling mass terrifies them, and the fear builds until the buddy breaks and runs for the corner. Cast it and watch them flee.',
  }),
  statNode({
    id: 'g.summons.rat_swarm.colony', parents: ['g.summons.rat_swarm'], cost: 320, toolId: 'rat_swarm',
    label: 'Breeding colony',
    blurb: 'A bigger, faster infestation — twelve rats per cast (8 → 12) gnawing quicker (every 0.6s → 0.45s) so the terror climbs sooner.',
    effect: (s) => { s.swarmCount = 12; s.gnawIntervalMs = 450; },
  }),
  statNode({
    id: 'g.summons.rat_swarm.diseased', parents: ['g.summons.rat_swarm'], cost: 280, toolId: 'rat_swarm',
    label: 'Diseased bite',
    blurb: 'Filthy teeth — each gnaw is likelier to draw blood and the wound festers longer (bleed chance 0.3 → 0.5, bleed 4s → 6.5s).',
    effect: (s) => { s.bleedChance = 0.5; s.bleedMs = 6500; },
  }),
  statNode({
    id: 'g.summons.rat_swarm.frenzied', parents: ['g.summons.rat_swarm'], cost: 260, toolId: 'rat_swarm',
    label: 'Frenzied swarm',
    blurb: 'A more harrowing, longer-lived swarm — each gnaw spikes the buddy\'s fear harder (10 → 18) and the rats linger on the floor longer (9s → 14s), holding the panic up.',
    effect: (s) => { s.fear = 18; s.lifeMs = 14000; },
  }),
];
