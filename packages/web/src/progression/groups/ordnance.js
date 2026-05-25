// Ordnance group tree (renamed from `ranged` in Phase 1 of the 2026-05-02
// ability redesign, see docs/abilities.md). Pistol is the entry-tier
// root; everything else branches off it (machinegun + shotgun + rocket
// + grenade).

import { toolNode, statNode } from './_shared.js';

export default [
  // Root: pistol
  toolNode({
    id: 'g.ordnance.gun', parents: [], cost: 75, toolId: 'gun',
    label: 'pistol',
    blurb: 'One-shot pistol, fast aim, light damage.',
  }),
  statNode({
    id: 'g.ordnance.gun.dmg', parents: ['g.ordnance.gun'], cost: 150, toolId: 'gun',
    label: 'JHP rounds',
    blurb: 'Damage 10 → 15.',
    effect: (s) => { s.damage = 15; },
  }),
  statNode({
    id: 'g.ordnance.gun.speed', parents: ['g.ordnance.gun'], cost: 150, toolId: 'gun',
    label: 'Hot loads',
    blurb: 'Bullet speed 22 → 30. Less drop, faster impact.',
    effect: (s) => { s.speed = 30; },
  }),

  // Machinegun branch (sustained DPS)
  toolNode({
    id: 'g.ordnance.machinegun', parents: ['g.ordnance.gun'], cost: 100, toolId: 'machinegun',
    label: 'machine gun',
    blurb: 'Spray bullets, sustained DPS.',
  }),
  statNode({
    id: 'g.ordnance.machinegun.rate', parents: ['g.ordnance.machinegun'], cost: 300, toolId: 'machinegun',
    label: 'High RPM',
    blurb: 'Bullet damage 1.5 → 2.5. Wall of lead.',
    effect: (s) => { s.damage = 2.5; },
  }),
  statNode({
    id: 'g.ordnance.machinegun.choke', parents: ['g.ordnance.machinegun'], cost: 300, toolId: 'machinegun',
    label: 'Tight choke',
    blurb: 'Spread 0.12 → 0.06. Tighter cone, more headshots.',
    effect: (s) => { s.spread = 0.06; },
  }),
  statNode({
    id: 'g.ordnance.machinegun.minigun', parents: ['g.ordnance.machinegun.rate', 'g.ordnance.machinegun.choke'], cost: 1200, toolId: 'machinegun',
    label: 'Minigun mode',
    iconHint: '⚡',
    blurb: 'Damage +60%, speed 26 → 36. The bar takes notes.',
    effect: (s) => { s.damage *= 1.6; s.speed = 36; },
  }),

  // Shotgun branch (burst)
  toolNode({
    id: 'g.ordnance.shotgun', parents: ['g.ordnance.gun'], cost: 120, toolId: 'shotgun',
    label: 'shotgun',
    blurb: 'Close-range cone, massive knockback, falls off with distance.',
  }),
  statNode({
    id: 'g.ordnance.shotgun.pellets', parents: ['g.ordnance.shotgun'], cost: 300, toolId: 'shotgun',
    label: 'More pellets',
    blurb: 'Pellets 9 → 14. The whole part disappears.',
    effect: (s) => { s.pellets = 14; },
  }),
  statNode({
    id: 'g.ordnance.shotgun.slug', parents: ['g.ordnance.shotgun'], cost: 1200, toolId: 'shotgun',
    label: 'Slug round',
    iconHint: '⚡',
    blurb: 'One huge pellet, massive mood damage, tighter spread.',
    // Phase 7, `s.damage` doesn't exist in shotgun's defaultStats (uses
    // `s.mood`); the old mutation was a dead-write. Tightening cone matches
    // the "single projectile" intent. force exists in defaultStats.
    effect: (s) => { s.pellets = 1; s.force *= 4; s.mood *= 3; s.coneRad = 0.05; },
  }),

  // Grenade branch (lobbed)
  toolNode({
    id: 'g.ordnance.grenade', parents: ['g.ordnance.gun'], cost: 120, toolId: 'grenade',
    label: 'molotov',
    blurb: 'Drag to lob, 2s fuse, area boom + lingering fire pool.',
  }),

  // Rocket branch (flagship boom)
  toolNode({
    id: 'g.ordnance.rocket', parents: ['g.ordnance.gun'], cost: 200, toolId: 'rocket',
    label: 'rocket',
    blurb: 'Straight-line projectile + huge splash.',
  }),
  statNode({
    id: 'g.ordnance.rocket.warhead', parents: ['g.ordnance.rocket'], cost: 600, toolId: 'rocket',
    label: 'Bigger warhead',
    blurb: 'Radius 260 → 360, force ×1.6.',
    effect: (s) => { s.radius = 360; s.force *= 1.6; s.mood = Math.round(s.mood * 1.5); },
  }),
  statNode({
    id: 'g.ordnance.rocket.cluster', parents: ['g.ordnance.rocket.warhead'], cost: 1200, toolId: 'rocket',
    label: 'Inferno warhead',
    iconHint: '⚡',
    // Phase 7, relabeled from "Cluster warhead." The original name promised
    // sub-munitions; the implementation only ships radius bump + longer
    // burn, so the name was a check the code couldn't cash. Inferno fits.
    blurb: 'Bigger radius, longer burn (4s), the whole stage shakes.',
    effect: (s) => { s.radius *= 1.2; s.igniteMs = 4000; },
  }),

  // Lightning branch, sky bolt + chains. Joined ordnance in Phase 2
  // (was in `corruption` while the group was still called `elemental`).
  // Independent root, sits parallel to the pistol chain, since it's an
  // unlock you take instead of branching off pistol stat-tunes.
  toolNode({
    id: 'g.ordnance.lightning', parents: [], cost: 250, toolId: 'lightning',
    label: 'lightning',
    blurb: 'Sky bolt + branching forks. Pairs with ice (CONDUCT) and fire (COMBUST).',
  }),
  statNode({
    id: 'g.ordnance.lightning.chains', parents: ['g.ordnance.lightning'], cost: 600, toolId: 'lightning',
    label: 'More chains',
    blurb: 'Chain targets 3 → 5, fork chance 0.55 → 0.75.',
    effect: (s) => { s.chainTargets = 5; s.forkChance = 0.75; },
  }),
  statNode({
    id: 'g.ordnance.lightning.zeus', parents: ['g.ordnance.lightning.chains'], cost: 1200, toolId: 'lightning',
    label: 'Zeus',
    iconHint: '⚡',
    blurb: 'Mood damage +50%, electrified duration doubles.',
    effect: (s) => { s.mood = Math.round(s.mood * 1.5); s.electrifiedMs *= 2; s.shake = 28; },
  }),

  // Saw blade (Phase 7, gore add). Click-throw a spinning disc that
  // ricochets off walls until it bites. Pure impact damage, bleed lives
  // on chainsaw / bear-trap / meathook, sawblade owns the bounce.
  toolNode({
    id: 'g.ordnance.sawblade', parents: ['g.ordnance.gun'], cost: 180, toolId: 'sawblade',
    label: 'saw blade',
    blurb: 'Spinning disc ricochets off walls until it bites.',
  }),
  statNode({
    id: 'g.ordnance.sawblade.edge', parents: ['g.ordnance.sawblade'], cost: 350, toolId: 'sawblade',
    label: 'Toothed edge',
    blurb: 'Damage 12 → 18. Heavier impact + knockback.',
    effect: (s) => { s.damage = 18; },
  }),
  statNode({
    id: 'g.ordnance.sawblade.lodge', parents: ['g.ordnance.sawblade.edge'], cost: 1000, toolId: 'sawblade',
    label: 'Lodge',
    iconHint: '⚡',
    blurb: 'A1, 30% chance the disc embeds in the part on hit and ticks BLEED for 1.5s before falling out (PR5 consumer reads lodgeChance/lodgeBleedMs).',
    effect: (s) => { s.lodgeChance = 0.3; s.lodgeBleedMs = 1500; },
  }),
  statNode({
    id: 'g.ordnance.sawblade.spin', parents: ['g.ordnance.sawblade'], cost: 350, toolId: 'sawblade',
    label: 'Hot rotor',
    blurb: 'Disc lifetime 1400 → 2200ms, more ricochets per cast.',
    effect: (s) => { s.lifeMs = 2200; },
  }),
  statNode({
    id: 'g.ordnance.sawblade.possessed', parents: ['g.ordnance.sawblade.spin'], cost: 1000, toolId: 'sawblade',
    label: 'Possessed Disc',
    iconHint: '⚡',
    blurb: 'B1, Lifetime 2200 → 4000ms. On each wall-bounce, gently homes toward the nearest part (5°/bounce). Feels haunted (PR5 consumer reads bounceHomingDeg).',
    effect: (s) => { s.lifeMs = 4000; s.bounceHomingDeg = 5; },
  }),
];
