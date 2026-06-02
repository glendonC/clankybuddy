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

  // ── Heavy-object drop verbs (all fork off the brick root, per doc §3) ──
  // CRT monitor: implode + electrify the struck part.
  toolNode({
    id: 'g.siege.crt', parents: ['g.siege.brick'], cost: 260, toolId: 'crt',
    label: 'CRT monitor',
    blurb: 'A boxy tube monitor drops; the glass implodes and electrifies the struck part.',
  }),
  statNode({
    id: 'g.siege.crt.flyback', parents: ['g.siege.crt'], cost: 360, toolId: 'crt',
    label: 'Flyback Transformer',
    blurb: 'Longer high-voltage discharge: electrified 1.2s → 2.2s, mood 30 → 36.',
    effect: (s) => { s.electrifyMs = 2200; s.mood = 36; },
  }),

  // Car: wide-body crush + fuel-tank fireball.
  toolNode({
    id: 'g.siege.car', parents: ['g.siege.brick'], cost: 360, toolId: 'car',
    label: 'car',
    blurb: 'A sedan drops; the chassis flattens whatever it lands on, then the fuel tank ruptures.',
  }),
  statNode({
    id: 'g.siege.car.fuel', parents: ['g.siege.car'], cost: 320, toolId: 'car',
    label: 'Full Tank',
    blurb: 'A longer-burning fuel fire under the wreck (pool 2.6s → 3.8s).',
    effect: (s) => { s.fireDuration += 1200; },
  }),
  statNode({
    id: 'g.siege.car.heft', parents: ['g.siege.car'], cost: 360, toolId: 'car',
    label: 'Armored Sedan',
    blurb: 'Heavier chassis, mood 34 → 42.',
    effect: (s) => { s.density = 0.026; s.mood = 42; },
  }),

  // Office chair: drag-throw ricochet vehicle (forks off the brick root).
  toolNode({
    id: 'g.siege.office_chair', parents: ['g.siege.brick'], cost: 180, toolId: 'office_chair',
    label: 'office chair',
    blurb: 'Drag to fling a rolling chair. Ricochets and clatters into the buddy.',
  }),
  statNode({
    id: 'g.siege.office_chair.gas_lift', parents: ['g.siege.office_chair'], cost: 220, toolId: 'office_chair',
    label: 'Gas Lift',
    blurb: 'Harder clatter, force 0.06 → 0.09.',
    effect: (s) => { s.force = 0.09; },
  }),
  statNode({
    id: 'g.siege.office_chair.exec_model', parents: ['g.siege.office_chair'], cost: 260, toolId: 'office_chair',
    label: 'Executive Model',
    blurb: 'Heavier chair, mood 10 → 16 per knock.',
    effect: (s) => { s.mood = 16; },
  }),

  // ── Siege-engine roots (independent, not droppables) ─────────────
  // Steamroller: kinematic roller that flattens everything it crosses.
  toolNode({
    id: 'g.siege.steamroller', parents: [], cost: 320, toolId: 'steamroller',
    label: 'steamroller',
    blurb: 'A heavy drum rolls across the stage, flattening everything it crosses.',
  }),
  // City bus: scoop-and-carry, child of the steamroller.
  toolNode({
    id: 'g.siege.city_bus', parents: ['g.siege.steamroller'], cost: 480, toolId: 'city_bus',
    label: 'city bus',
    blurb: 'A bus scoops the buddy and carries them clean off the stage.',
  }),

  // Trebuchet: heavy ranged siege engine (independent root). Drag-aim, lob a
  // boulder in a high arc; ground-shaking impact on landing.
  toolNode({
    id: 'g.siege.trebuchet', parents: [], cost: 320, toolId: 'trebuchet',
    label: 'trebuchet',
    blurb: 'Drag to aim, release to lob a boulder in a high arc. Heavy-radius impact on landing.',
  }),
  statNode({
    id: 'g.siege.trebuchet.boulder', parents: ['g.siege.trebuchet'], cost: 280, toolId: 'trebuchet',
    label: 'Granite Boulder',
    blurb: 'Bigger payload, wider blast and harder mood hit (radius 240 → 300, mood 30 → 40).',
    effect: (s) => { s.radius = 300; s.mood = 40; },
  }),

  // Battering ram: swung-mass siege engine (independent root).
  toolNode({
    id: 'g.siege.battering_ram', parents: [], cost: 280, toolId: 'battering_ram',
    label: 'battering ram',
    blurb: 'Swing an iron-shod oak log. One heavy directional shove per part, per swing.',
  }),
  statNode({
    id: 'g.siege.battering_ram.ironclad', parents: ['g.siege.battering_ram'], cost: 240, toolId: 'battering_ram',
    label: 'Ironclad Head',
    blurb: 'Heavier iron cap, force 0.22 → 0.30, mood 16 → 22.',
    effect: (s) => { s.force = 0.30; s.mood = 22; },
  }),

  // Wrecking ball — chained steel ball that swings through the buddy. Forks off
  // the brick drop/throwable root (doc §3); rides on the constraint registry (S3).
  toolNode({
    id: 'g.siege.wrecking_ball', parents: ['g.siege.brick'], cost: 400, toolId: 'wrecking_ball',
    label: 'wrecking ball',
    blurb: 'A chained steel ball swings down through the buddy for two or three demolition passes.',
  }),
  statNode({
    id: 'g.siege.wrecking_ball.head', parents: ['g.siege.wrecking_ball'], cost: 360, toolId: 'wrecking_ball',
    label: 'Demolition Head',
    blurb: 'Heavier head: mood 22 → 30 per pass, force 0.16 → 0.20.',
    effect: (s) => { s.ballRadius = 30; s.density = 0.03; s.mood = 30; s.force = 0.20; },
  }),

  // ── Weather barrages (independent roots, scheduler-driven; docs §3
  // "Directed / siege / weather"). Staggered drops onto a marked zone. ──
  toolNode({
    id: 'g.siege.meteor_shower', parents: [], cost: 420, toolId: 'meteor_shower',
    label: 'meteor shower',
    blurb: 'A staggered barrage of flaming rocks falls from the sky onto a marked zone and detonates with fire.',
  }),
  statNode({
    id: 'g.siege.meteor_shower.dense', parents: ['g.siege.meteor_shower'], cost: 500, toolId: 'meteor_shower',
    label: 'Dense barrage',
    blurb: 'More rocks per cast (6 → 9), tighter interval.',
    effect: (s) => { s.count = 9; s.intervalMs = 190; },
  }),
  statNode({
    id: 'g.siege.meteor_shower.craters', parents: ['g.siege.meteor_shower'], cost: 650, toolId: 'meteor_shower',
    iconHint: '⚡',
    label: 'Impact craters',
    blurb: 'Wider blasts (radius 140 → 182) and each impact leaves a lingering fire pool.',
    effect: (s) => { s.radius = Math.round(s.radius * 1.3); s.fireDuration = 2200; },
  }),

  toolNode({
    id: 'g.siege.hailstorm', parents: [], cost: 360, toolId: 'hailstorm',
    label: 'hailstorm',
    blurb: 'A pelting volley of ice chunks rains down on a marked zone, freezing each limb it strikes brittle.',
  }),
  statNode({
    id: 'g.siege.hailstorm.stones', parents: ['g.siege.hailstorm'], cost: 420, toolId: 'hailstorm',
    label: 'Larger stones',
    blurb: 'Bigger chunks (radius 6 → 9), harder impact (mood 4 → 7).',
    effect: (s) => { s.stoneR = 9; s.mood = 7; s.squashVel = 11; },
  }),
  statNode({
    id: 'g.siege.hailstorm.rain', parents: ['g.siege.hailstorm'], cost: 500, toolId: 'hailstorm',
    iconHint: '⚡',
    label: 'Freezing rain',
    blurb: 'A denser volley — more chunks per cast (10 → 15) to lock the limbs solid.',
    effect: (s) => { s.count = 15; s.intervalMs = 100; },
  }),

  // Strafe run — an aimed swept directional force band (replaces the cut bomb-run
  // airstrike). Independent siege root; the verb is the TRAVELING force window,
  // distinct from the radial force-Modes and the floor-level body rollers.
  toolNode({
    id: 'g.siege.strafe_run', parents: [], cost: 340, toolId: 'strafe_run',
    label: 'strafe run',
    blurb: 'Drag to aim a low pass; a swept gun-run force band rakes a directional shove down your line, dragging every limb it crosses downrange — works mid-air, at any angle.',
  }),
  statNode({
    id: 'g.siege.strafe_run.heavy', parents: ['g.siege.strafe_run'], cost: 320, toolId: 'strafe_run',
    label: 'heavier rounds',
    blurb: 'A harder, angrier pass: more shove (drags limbs farther) and a bigger morale hit (mood 14 → 18).',
    // shove lands at the Mode's MAX_SHOVE clamp (0.012, solver-safe); the Mode
    // clamps regardless, so this can never smuggle a larger applied force.
    effect: (s) => { s.shove = 0.012; s.mood = 18; },
  }),
];
