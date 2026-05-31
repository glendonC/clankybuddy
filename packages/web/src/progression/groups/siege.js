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
];
