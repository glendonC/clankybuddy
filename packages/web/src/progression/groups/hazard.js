// Hazard group tree (placed traps). Each trap is a static sensor body the
// buddy triggers by CONTACT — no aiming, you bury/mount it and wait. The four
// roots are independent verbs:
//   - landmine          — bounding-mine UP launch (CANONICAL home for the
//                          Claymore / Bounding-mine forks; they hang here, NOT
//                          under Ordnance).
//   - electrified_panel — a lingering re-zapping field (caltrops' electric cousin).
//   - buzzsaw_wall      — a mounted spinning blade that bites + stacks BLEED.
//   - cryo_mine         — an AOE freeze burst (pure control, sets up the shatter).
//
// CHAIN / REARM are NOT per-tool scalars. They are the two `hazard` FAMILY
// behavior FLAGS (FAMILY_DEFAULTS.hazard = {chain,rearm} in abilities/_stats.js),
// flipped by the two sharedNodes below. A single purchase changes the VERB of
// every placed trap at once — exactly the cross-tool-flag pattern the sharedNode
// guard enforces (it rejects scalar-only shared effects).

import { toolNode, statNode, sharedNode } from './_shared.js';

export default [
  // ── Landmine (canonical hazard root) ──────────────────────────────
  toolNode({
    id: 'g.hazard.landmine', parents: [], cost: 650, toolId: 'landmine',
    label: 'landmine',
    blurb: 'Bury a pressure-plate charge. First contact launches the buddy skyward.',
  }),
  statNode({
    id: 'g.hazard.landmine.dwell', parents: ['g.hazard.landmine'], cost: 200, toolId: 'landmine',
    label: 'Patient fuse',
    blurb: 'An un-triggered mine lingers longer: lifetime 14s → 24s.',
    effect: (s) => { s.lifeMs = 24000; },
  }),

  // ── Electrified panel ─────────────────────────────────────────────
  toolNode({
    id: 'g.hazard.electrified_panel', parents: [], cost: 140, toolId: 'electrified_panel',
    label: 'electrified panel',
    blurb: 'Drop a live sensor plate — anything on it gets ELECTRIFIED every ~0.4s until it burns out.',
  }),
  statNode({
    id: 'g.hazard.electrified_panel.wide', parents: ['g.hazard.electrified_panel'], cost: 160, toolId: 'electrified_panel',
    label: 'Bus-bar plate',
    blurb: 'Wider footprint: max plate width 200 → 320px.',
    effect: (s) => { s.maxWidth = 320; },
  }),
  statNode({
    id: 'g.hazard.electrified_panel.endure', parents: ['g.hazard.electrified_panel'], cost: 220, toolId: 'electrified_panel',
    label: 'Hardened element',
    blurb: 'The plate runs longer before it burns out: lifetime +4s.',
    effect: (s) => { s.lifeMs += 4000; },
  }),

  // ── Buzzsaw wall ──────────────────────────────────────────────────
  toolNode({
    id: 'g.hazard.buzzsaw_wall', parents: [], cost: 180, toolId: 'buzzsaw_wall',
    label: 'buzzsaw wall',
    blurb: 'Mount a spinning blade. Bites anything driven into it and stacks bleed.',
  }),
  statNode({
    id: 'g.hazard.buzzsaw_wall.life', parents: ['g.hazard.buzzsaw_wall'], cost: 200, toolId: 'buzzsaw_wall',
    label: 'Hardened bearings',
    blurb: 'The blade spins longer before it seizes: lifetime 12s → 20s.',
    effect: (s) => { s.lifeMs = 20000; },
  }),
  statNode({
    id: 'g.hazard.buzzsaw_wall.bleed', parents: ['g.hazard.buzzsaw_wall'], cost: 260, toolId: 'buzzsaw_wall',
    label: 'Ragged teeth',
    blurb: 'Deeper wounds: each bite stamps a longer BLEED (6s → 10s).',
    effect: (s) => { s.bleedMs = 10000; },
  }),

  // ── Cryo mine ─────────────────────────────────────────────────────
  toolNode({
    id: 'g.hazard.cryo_mine', parents: [], cost: 220, toolId: 'cryo_mine',
    label: 'cryo mine',
    blurb: 'Bury a cryo charge. Step on it and it vents an AOE freeze burst — control, no damage.',
  }),
  statNode({
    id: 'g.hazard.cryo_mine.dwell', parents: ['g.hazard.cryo_mine'], cost: 200, toolId: 'cryo_mine',
    label: 'Sealed canister',
    blurb: 'An un-triggered charge lingers longer: lifetime 14s → 24s.',
    effect: (s) => { s.lifeMs = 24000; },
  }),

  // ── Gas cloud (independent root) + verb forks ─────────────────────
  // A drifting choking-status dwell zone. The three forks are distinct VERBS
  // (panic-run / stacking DoT / freeze-on-dwell), so they are child toolNodes
  // (each its own equippable tool), all parenting the gas_cloud ROOT.
  toolNode({
    id: 'g.hazard.gas_cloud', parents: [], cost: 200, toolId: 'gas_cloud',
    label: 'gas cloud',
    blurb: 'Pop a chemical canister; anything that dwells in the drifting cloud starts CHOKING — mood bleed, flailing, and a hard time staying on its feet.',
  }),
  toolNode({
    id: 'g.hazard.gas_cloud.tear_gas', parents: ['g.hazard.gas_cloud'], cost: 180, toolId: 'tear_gas',
    label: 'tear gas',
    blurb: 'A drifting irritant cloud that sends the buddy into a blind panic-run instead of just choking it.',
  }),
  toolNode({
    id: 'g.hazard.gas_cloud.chlorine', parents: ['g.hazard.gas_cloud'], cost: 220, toolId: 'chlorine',
    label: 'chlorine',
    blurb: 'A heavier toxic cloud whose choke STACKS the longer the buddy stays inside it.',
  }),
  toolNode({
    id: 'g.hazard.gas_cloud.cryo_fog', parents: ['g.hazard.gas_cloud'], cost: 240, toolId: 'cryo_fog',
    label: 'cryo fog',
    blurb: 'A freezing vapor — dwell in it long enough and the limb frosts over brittle, setting up a shatter.',
  }),

  // ── Gravity well (independent force-field root) + forks ────────────
  // A placed inward SINK driven by a phase:'physics' force Mode. The verb forks
  // are flag-flipping statNodes on the ROOT (user decision: one tool the tree
  // mutates, not separate equippable weapons). A statNode may set a behavior
  // flag freely — the scalar-rejection guard is sharedNode-only.
  toolNode({
    id: 'g.hazard.gravity_well', parents: [], cost: 240, toolId: 'gravity_well',
    label: 'gravity well',
    blurb: 'Drop a sustained gravity well that drags everything nearby inward toward one point — pure pull, it never throws.',
  }),
  statNode({
    id: 'g.hazard.gravity_well.pull', parents: ['g.hazard.gravity_well'], cost: 200, toolId: 'gravity_well',
    label: 'Stronger pull',
    blurb: 'A deeper well — stronger inward force and longer reach.',
    effect: (s) => { s.pull = 0.009; s.range = 320; },
  }),
  statNode({
    id: 'g.hazard.gravity_well.collapse', parents: ['g.hazard.gravity_well'], cost: 380, toolId: 'gravity_well',
    label: 'Collapse',
    blurb: 'The well caves in at the end of its life — a final inward crush that slams everything to the center.',
    effect: (s) => { s.collapse = true; },
  }),

  // ── Flood (independent force-field root) + forks ───────────────────
  // A screen-wide one-shot tide. "Higher tide" raises the LEVEL (capFrac/holdMs),
  // NEVER the buoyancy ceiling — that hard clamp is the no-rocket guarantee.
  toolNode({
    id: 'g.hazard.flood', parents: [], cost: 280, toolId: 'flood',
    label: 'flood',
    blurb: 'Flood the arena: the water rises, floats and drags the buddy, and douses any fire before it drains away.',
  }),
  statNode({
    id: 'g.hazard.flood.tide', parents: ['g.hazard.flood'], cost: 220, toolId: 'flood',
    label: 'Higher tide',
    blurb: 'The water rises higher and holds longer before it drains.',
    effect: (s) => { s.capFrac = 0.6; s.holdMs = 3200; },
  }),
  statNode({
    id: 'g.hazard.flood.whirlpool', parents: ['g.hazard.flood'], cost: 340, toolId: 'flood',
    label: 'Whirlpool',
    blurb: 'The flood spins — submerged parts are dragged toward a central vortex.',
    effect: (s) => { s.whirlpool = true; },
  }),
  statNode({
    id: 'g.hazard.flood.acid', parents: ['g.hazard.flood'], cost: 360, toolId: 'flood',
    label: 'Acid flood',
    blurb: 'Caustic water — submerged parts are corroded, so your follow-up hits on them land harder.',
    effect: (s) => { s.acid = true; },
  }),

  // ── Pin (independent hazard root) + verb-scalar forks ─────────────
  // Nail a limb to a fixed world point (an S3 Matter.Constraint, ownerBody=limb).
  // FIRST constraint to bind a ragdoll PART; shatter() drops it (registry teardown
  // capability b). Pin is PLACEMENT-activated, NOT a contact-triggered trap, so it
  // intentionally does NOT consult getFamilyStats('hazard').chain/rearm — those family
  // flags govern triggered traps only (a player who buys Chain/Re-arm sees no effect on
  // pin; that asymmetry is by design, not missed wiring). The three forks are flag/scalar
  // statNodes on the ROOT — none is a distinct verb (all = "pin a limb", stronger / more
  // / nastier) — which the scalar-rejection guard permits (it's sharedNode-only).
  toolNode({
    id: 'g.hazard.pin', parents: [], cost: 220, toolId: 'pin',
    label: 'pin',
    blurb: 'Drive a stake through a limb and nail it to the floor — the buddy can only thrash around the anchor.',
  }),
  statNode({
    id: 'g.hazard.pin.deeper_drive', parents: ['g.hazard.pin'], cost: 200, toolId: 'pin',
    label: 'Deeper drive',
    blurb: 'The stake bites harder and holds longer: hold 6s → 10s, firmer grip.',
    effect: (s) => { s.lifeMs = 10000; s.stiffness = 0.86; },   // 0.86 < 0.9 ceiling
  }),
  statNode({
    id: 'g.hazard.pin.driven_stakes', parents: ['g.hazard.pin'], cost: 300, toolId: 'pin',
    label: 'Driven stakes',
    blurb: 'Carry a fistful of stakes — pin up to three limbs at once instead of one.',
    effect: (s) => { s.maxPins = 3; },
  }),
  statNode({
    id: 'g.hazard.pin.barbed_stake', parents: ['g.hazard.pin'], cost: 260, toolId: 'pin',
    label: 'Barbed stake',
    blurb: 'A ragged, barbed spike — staking a limb tears it, leaving a lingering BLEED.',
    effect: (s) => { s.barbed = true; },
  }),

  // ── Shared hazard-family behavior FLAGS (cross-trap, never scalars) ──
  // Both parent off the landmine root (the canonical hazard tool) but flip a
  // FAMILY flag that EVERY placed trap reads via getFamilyStats('hazard').
  sharedNode({
    id: 'g.hazard.shared.chain', parents: ['g.hazard.landmine'], cost: 400,
    family: 'hazard', flag: 'chain',
    label: 'Chain detonation',
    iconHint: '⛓',
    blurb: 'A triggered trap arms every other placed trap in range — they fan out in a synchronous wave.',
    effect: (fam) => { fam.chain = true; },
  }),
  sharedNode({
    id: 'g.hazard.shared.rearm', parents: ['g.hazard.landmine'], cost: 450,
    family: 'hazard', flag: 'rearm',
    label: 'Re-arming traps',
    iconHint: '↻',
    blurb: 'Single-use traps survive their trigger and re-arm after a short cooldown instead of expiring.',
    effect: (fam) => { fam.rearm = true; },
  }),
];
